import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { haptics } from '../lib/haptics'
import { buildChoiceQuestion, shuffle } from '../lib/study'
import { displayAnswer, normalize } from '../lib/text'
import { field, genderOf, preferred } from '../lib/variants'
import { choiceOptions, isRight, mainAnswer, rightAnswers, splitGap, wrongAnswers } from '../lib/questions'
import { cardItem, questionItem, type Exercise } from '../lib/lesson'
import type { NodeCard, Question } from '../lib/types'
import { Options, WrittenAnswer } from './Answer'
import { Icon } from './Icon'
import { Word } from './Word'

/**
 * The exercises a lesson is made of. Each reports every attempt as it
 * happens (`onAttempt`), and says once when it is finished and whether it
 * went right (`onAnswered`); the player around it decides what comes next.
 */
export type ExerciseProps<T extends Exercise['type']> = {
  exercise: Extract<Exercise, { type: T }>
  onAttempt: (item: string, ok: boolean | null) => void
  onAnswered: (right: boolean) => void
}

const sides = (dir: 'ab' | 'ba') => (dir === 'ab' ? { front: 'a', back: 'b' } : { front: 'b', back: 'a' })
const langOf = (card: NodeCard, key: string) => (key === 'a' ? card.langA : card.langB)

function Note({ text }: { text: string | null | undefined }) {
  if (!text) return null
  return (
    <div className="quiz__note">
      <Icon name="sparkle" />
      <span>{text}</span>
    </div>
  )
}

/** Runs once on mount — the exercises report their first state without waiting for input. */
function useOnce(effect: () => void) {
  const done = useRef(false)
  useEffect(() => {
    if (!done.current) {
      done.current = true
      effect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

// ── A new word ──────────────────────────────────────────────────────────────

export function IntroExercise({ exercise, onAttempt, onAnswered }: ExerciseProps<'intro'>) {
  const { t } = useI18n()
  const { card } = exercise
  const { front, back } = sides(exercise.dir)

  useOnce(() => {
    onAttempt(cardItem(card.id), null)
    onAnswered(true)
  })

  return (
    <div className="quiz">
      <p className="lesson__kicker">
        <Icon name="sparkle" width={14} height={14} /> {t('lesson.newWord')}
      </p>
      <div className="quiz__prompt intro">
        <div>
          <span className="flashcard__lang">{langOf(card, front)}</span>
          <Word word={{ term: preferred(card, front), gender: genderOf(card, front) }} className="quiz__term" />
          <div className="intro__line" />
          <span className="flashcard__lang">{langOf(card, back)}</span>
          <Word
            word={{ term: displayAnswer(field(card, back)), gender: genderOf(card, back) }}
            className="quiz__term quiz__term--answer"
          />
        </div>
      </div>
      <Note text={card.note} />
    </div>
  )
}

// ── One word, four options or typed ─────────────────────────────────────────

export function VocabExercise({ exercise, onAttempt, onAnswered }: ExerciseProps<'vocab'>) {
  const { t } = useI18n()
  const { card } = exercise
  const { front, back } = sides(exercise.dir)
  const [chosen, setChosen] = useState<number | null>(null)
  const [settled, setSettled] = useState(false)
  const question = useMemo(
    () => buildChoiceQuestion(card, exercise.pool, front, back),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercise],
  )

  const finish = (right: boolean) => {
    onAttempt(cardItem(card.id), right)
    setSettled(true)
    onAnswered(right)
  }

  return (
    <div className="quiz">
      <div className="quiz__prompt">
        <div>
          <Word word={{ term: preferred(card, front), gender: genderOf(card, front) }} className="quiz__term" />
          <p className="quiz__ask">{t('test.inLang', { lang: langOf(card, back) })}</p>
        </div>
      </div>

      {exercise.mode === 'choice' ? (
        <Options
          options={question.options}
          isRight={(index) => index === question.correctIndex}
          chosen={chosen}
          onChoose={(index, right) => {
            if (chosen !== null) return
            right ? haptics.known() : haptics.wrong()
            setChosen(index)
            finish(right)
          }}
        />
      ) : (
        <WrittenAnswer
          accepted={[field(card, back)]}
          reveal={displayAnswer(field(card, back))}
          placeholder={t('test.typePlaceholder', { lang: langOf(card, back) })}
          onSettled={finish}
        />
      )}
      {settled && <Note text={card.note} />}
    </div>
  )
}

// ── Five pairs ──────────────────────────────────────────────────────────────

/**
 * Words on the left, their counterparts shuffled on the right; tap one on
 * each side to pair them. Tapping another word on the same side moves the
 * selection there, and tapping the selected word again lets it go.
 */
export function MatchExercise({ exercise, onAttempt, onAnswered }: ExerciseProps<'match'>) {
  const { t } = useI18n()
  const { front, back } = sides(exercise.dir)
  const cards = exercise.cards
  const right = useMemo(() => shuffle(cards), [cards])

  const [left, setLeft] = useState<number | null>(null)
  const [rightSel, setRightSel] = useState<number | null>(null)
  const [doneLeft, setDoneLeft] = useState<ReadonlySet<number>>(new Set())
  const [doneRight, setDoneRight] = useState<ReadonlySet<number>>(new Set())
  const [mistakes, setMistakes] = useState<ReadonlySet<number>>(new Set())
  const [flash, setFlash] = useState<{ left: number; right: number } | null>(null)
  const finished = useRef(false)

  const answerOf = (card: NodeCard) => normalize(preferred(card, back))

  const tryPair = (l: number, r: number) => {
    const leftCard = cards.find((card) => card.id === l)!
    const rightCard = cards.find((card) => card.id === r)!
    setLeft(null)
    setRightSel(null)
    // Two cards with the same answer are interchangeable.
    if (l === r || answerOf(leftCard) === answerOf(rightCard)) {
      haptics.known()
      const nextLeft = new Set(doneLeft).add(l)
      setDoneLeft(nextLeft)
      setDoneRight(new Set(doneRight).add(r))
      if (nextLeft.size === cards.length && !finished.current) {
        finished.current = true
        for (const card of cards) {
          onAttempt(cardItem(card.id), !mistakes.has(card.id))
        }
        onAnswered(mistakes.size === 0)
      }
    } else {
      haptics.wrong()
      setMistakes(new Set(mistakes).add(l))
      setFlash({ left: l, right: r })
      window.setTimeout(() => setFlash(null), 450)
    }
  }

  const pickLeft = (id: number) => {
    if (doneLeft.has(id)) return
    if (left === id) {
      setLeft(null)
      return
    }
    haptics.tap()
    if (rightSel !== null) {
      tryPair(id, rightSel)
    } else {
      setLeft(id)
    }
  }

  const pickRight = (id: number) => {
    if (doneRight.has(id)) return
    if (rightSel === id) {
      setRightSel(null)
      return
    }
    haptics.tap()
    if (left !== null) {
      tryPair(left, id)
    } else {
      setRightSel(id)
    }
  }

  if (exercise.mode === 'write') {
    return <MatchWritten exercise={exercise} onAttempt={onAttempt} onAnswered={onAnswered} />
  }

  const tile = (id: number, text: string, selected: boolean, done: boolean, wrong: boolean, onClick: () => void) => (
    <button
      key={id}
      type="button"
      className={`tile${selected ? ' tile--selected' : ''}${done ? ' tile--done' : ''}${wrong ? ' tile--wrong' : ''}`}
      aria-pressed={selected}
      disabled={done}
      onClick={onClick}
    >
      {text}
    </button>
  )

  return (
    <div className="quiz">
      <p className="lesson__kicker">{t('lesson.matchPairs')}</p>
      <div className="match">
        <div className="match__col">
          {cards.map((card) =>
            tile(card.id, preferred(card, front), left === card.id, doneLeft.has(card.id), flash?.left === card.id, () =>
              pickLeft(card.id),
            ),
          )}
        </div>
        <div className="match__col">
          {right.map((card) =>
            tile(card.id, preferred(card, back), rightSel === card.id, doneRight.has(card.id), flash?.right === card.id, () =>
              pickRight(card.id),
            ),
          )}
        </div>
      </div>
    </div>
  )
}

/** The written version: every word of the group, each with its own answer. */
function MatchWritten({ exercise, onAttempt, onAnswered }: ExerciseProps<'match'>) {
  const { t } = useI18n()
  const { front, back } = sides(exercise.dir)
  const results = useRef(new Map<number, boolean>())

  return (
    <div className="quiz">
      <p className="lesson__kicker">{t('lesson.writeAll')}</p>
      <div className="stack" style={{ '--gap': '0.9rem' } as React.CSSProperties}>
        {exercise.cards.map((card) => (
          <div key={card.id} className="writerow">
            <Word word={{ term: preferred(card, front), gender: genderOf(card, front) }} className="writerow__prompt" />
            <WrittenAnswer
              compact
              accepted={[field(card, back)]}
              reveal={displayAnswer(field(card, back))}
              placeholder={langOf(card, back)}
              onSettled={(right) => {
                onAttempt(cardItem(card.id), right)
                results.current.set(card.id, right)
                if (results.current.size === exercise.cards.length) {
                  onAnswered([...results.current.values()].every(Boolean))
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Questions ───────────────────────────────────────────────────────────────

/** The question text, with the gap filled by whatever has been picked. */
function Body({ question, fill, state }: { question: Question; fill?: string; state?: 'right' | 'wrong' }) {
  const { before, after, hasGap } = splitGap(question.body)
  return (
    <p className="qbody">
      {before}
      {hasGap && (
        <span className={`gap${fill ? ' gap--filled' : ''}${state ? ` gap--${state}` : ''}`}>{fill || '   '}</span>
      )}
      {after}
    </p>
  )
}

export function QuestionExercise({ exercise, onAttempt, onAnswered }: ExerciseProps<'question'>) {
  const { t } = useI18n()
  const { question } = exercise
  const options = useMemo(() => choiceOptions(question), [question])
  const [chosen, setChosen] = useState<number | null>(null)
  const [typed, setTyped] = useState<{ right: boolean } | null>(null)

  const finish = (right: boolean) => {
    onAttempt(questionItem(question.id), right)
    onAnswered(right)
  }

  // Once answered, the gap shows what was picked — or, after typing, the answer.
  const fill = chosen !== null ? options[chosen] : typed ? mainAnswer(question) : undefined
  const state =
    chosen !== null
      ? isRight(question, options[chosen]!)
        ? 'right'
        : 'wrong'
      : typed
        ? typed.right
          ? 'right'
          : 'wrong'
        : undefined

  return (
    <div className="quiz">
      {question.instruction && <p className="lesson__kicker">{question.instruction}</p>}
      <div className="quiz__prompt quiz__prompt--text">
        <Body question={question} fill={fill} state={state} />
      </div>

      {exercise.mode === 'choice' ? (
        <Options
          options={options}
          isRight={(index) => isRight(question, options[index]!)}
          chosen={chosen}
          onChoose={(index, right) => {
            if (chosen !== null) return
            right ? haptics.known() : haptics.wrong()
            setChosen(index)
            finish(right)
          }}
        />
      ) : (
        <WrittenAnswer
          accepted={rightAnswers(question)}
          reveal={rightAnswers(question).join(' / ')}
          placeholder={t('lesson.typeAnswer')}
          onSettled={(right) => {
            setTyped({ right })
            finish(right)
          }}
        />
      )}
      {(chosen !== null || typed) && <Note text={question.note} />}
    </div>
  )
}

/**
 * Two or three questions side by side with one pool of answers — the
 * exercise for telling apart things that look alike: "c'è / ci sono",
 * "il / lo / l'". Tap a question's slot, then an answer; or type each.
 */
export function CompareExercise({ exercise, onAttempt, onAnswered }: ExerciseProps<'compare'>) {
  const { t } = useI18n()
  const { questions } = exercise
  const pool = useMemo(() => {
    const picked = questions.map((q) => shuffle(rightAnswers(q))[0] ?? '')
    const seen = new Set(picked.map(normalize))
    const extras = shuffle(questions.flatMap(wrongAnswers)).filter((text) => {
      const key = normalize(text)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return shuffle([...picked, ...extras.slice(0, Math.max(1, 6 - picked.length))])
  }, [questions])

  const [fills, setFills] = useState<(number | null)[]>(() => questions.map(() => null))
  const [active, setActive] = useState(0)
  const [checked, setChecked] = useState<boolean[] | null>(null)
  const typed = useRef(new Map<number, boolean>())

  if (exercise.mode === 'write') {
    return (
      <div className="quiz">
        <p className="lesson__kicker">{questions[0]?.instruction || t('lesson.compareWrite')}</p>
        <div className="stack" style={{ '--gap': '1rem' } as React.CSSProperties}>
          {questions.map((question) => (
            <div key={question.id} className="compare__item">
              <Body question={question} />
              <WrittenAnswer
                compact
                accepted={rightAnswers(question)}
                reveal={mainAnswer(question)}
                placeholder={t('lesson.typeAnswer')}
                onSettled={(right) => {
                  onAttempt(questionItem(question.id), right)
                  typed.current.set(question.id, right)
                  if (typed.current.size === questions.length) {
                    onAnswered([...typed.current.values()].every(Boolean))
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const used = new Set(fills.filter((fill): fill is number => fill !== null))

  const pickSlot = (index: number) => {
    if (checked) return
    if (fills[index] !== null) {
      setFills(fills.map((fill, i) => (i === index ? null : fill)))
    }
    setActive(index)
  }

  const pickChip = (chip: number) => {
    if (checked || used.has(chip)) return
    haptics.tap()
    const next = fills.map((fill, i) => (i === active ? chip : fill))
    setFills(next)
    const empty = next.findIndex((fill) => fill === null)
    setActive(empty >= 0 ? empty : active)
  }

  const check = () => {
    const results = questions.map((question, i) => isRight(question, pool[fills[i]!] ?? ''))
    results.forEach((right, i) => onAttempt(questionItem(questions[i]!.id), right))
    results.every(Boolean) ? haptics.known() : haptics.wrong()
    setChecked(results)
    onAnswered(results.every(Boolean))
  }

  return (
    <div className="quiz">
      <p className="lesson__kicker">{questions[0]?.instruction || t('lesson.compare')}</p>
      <div className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
        {questions.map((question, index) => {
          const fill = fills[index]
          const state = checked ? (checked[index] ? 'right' : 'wrong') : undefined
          return (
            <button
              key={question.id}
              type="button"
              className={`compare__item compare__slot${active === index && !checked ? ' compare__slot--active' : ''}`}
              onClick={() => pickSlot(index)}
              aria-pressed={active === index}
            >
              <Body question={question} fill={fill != null ? pool[fill] : undefined} state={state} />
              {checked && !checked[index] && (
                <span className="tiny" style={{ color: 'var(--known)' }}>
                  {t('lesson.shouldBe', { answer: mainAnswer(question) })}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="pool">
        {pool.map((chip, index) => (
          <button
            key={`${chip}-${index}`}
            type="button"
            className={`tile tile--chip${used.has(index) ? ' tile--used' : ''}`}
            disabled={Boolean(checked) || used.has(index)}
            onClick={() => pickChip(index)}
          >
            {chip}
          </button>
        ))}
      </div>
      {!checked && (
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={fills.some((fill) => fill === null)}
          onClick={check}
        >
          {t('test.check')}
        </button>
      )}
      {checked && questions.map((question) => <Note key={question.id} text={question.note} />)}
    </div>
  )
}
