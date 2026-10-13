import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, outbox } from '../lib/api'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { haptics } from '../lib/haptics'
import {
  answerLang,
  answerSide,
  buildChoiceQuestion,
  MIN_CHOICE_CARDS,
  promptLang,
  promptSide,
  shuffle,
} from '../lib/study'
import { displayAnswer, grade, type Grade } from '../lib/text'
import { percent } from '../lib/format'
import { readShow } from '../lib/display'
import { alsoAccepted, answerKey, hasConjugation, parts, promptKey } from '../lib/word'
import type { Card, Direction, ProgressUpdate, StudySet, TestMode } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Bar, Empty, Segmented, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { Conjugation } from '../components/Conjugation'
import { Word } from '../components/Word'

type Phase = 'setup' | 'running' | 'roundEnd' | 'done'

type Answered = { grade: Grade; typed?: string; chosen?: number }

const OPTION_KEYS = ['A', 'B', 'C', 'D']

export function TestRun() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t, tx, duration } = useI18n()

  const dir: Direction = params.get('dir') === 'ba' ? 'ba' : 'ab'

  const [set, setSet] = useState<StudySet | null>(null)
  const [mode, setMode] = useState<TestMode>('choice')
  const [phase, setPhase] = useState<Phase>('setup')

  const [queue, setQueue] = useState<Card[]>([])
  const [index, setIndex] = useState(0)
  const [round, setRound] = useState(1)
  const [missed, setMissed] = useState<Card[]>([])
  const [stumbled, setStumbled] = useState<Card[]>([])

  const [typed, setTyped] = useState('')
  const [answered, setAnswered] = useState<Answered | null>(null)
  const [verb, setVerb] = useState<Card | null>(null)

  const [show] = useState(() => readShow(slug))

  const [firstPass, setFirstPass] = useState({ total: 0, correct: 0 })

  const pending = useRef<ProgressUpdate[]>([])
  const startedAt = useRef(Date.now())

  /**
   * Near misses already forgiven, per card.
   *
   * A spelling nudge that can be collected over and over is a trap: type the
   * same almost-right word twice and the test never moves on, with nothing on
   * screen offering a way out. One nudge per card, then it counts as wrong.
   */
  const nudges = useRef(new Map<number, number>())
  const answerInput = useRef<HTMLInputElement>(null)
  const advanceTimer = useRef<number | undefined>(undefined)

  // ── Loading ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    api
      .set(slug)
      .then((result) => {
        if (cancelled) {
          return
        }
        setSet(result)
        setMode(result.cards.length >= MIN_CHOICE_CARDS ? 'choice' : 'write')
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          toast.error(errorText(t, caught, 'set.loadFailed'))
          navigate(`/s/${slug}`, { replace: true })
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  useEffect(() => () => window.clearTimeout(advanceTimer.current), [])

  const flush = useCallback(async () => {
    const updates = pending.current
    if (updates.length === 0) {
      return
    }
    pending.current = []
    try {
      await outbox.saveProgress(dir, updates)
    } catch {
      /* the outbox already kept it */
    }
  }, [dir])

  useEffect(() => () => void flush(), [flush])

  // ── Question for the current card ─────────────────────────────────────────

  const card = queue[index]

  const question = useMemo(() => {
    if (!card || !set || mode !== 'choice') {
      return null
    }
    return buildChoiceQuestion(card, set.cards, dir)
    // A fresh set of distractors per card, per round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, set, dir, mode, round])

  const start = () => {
    if (!set) {
      return
    }
    setQueue(shuffle(set.cards))
    setIndex(0)
    setRound(1)
    setMissed([])
    setStumbled([])
    setAnswered(null)
    setTyped('')
    setFirstPass({ total: 0, correct: 0 })
    nudges.current = new Map()
    startedAt.current = Date.now()
    setPhase('running')
  }

  /** Moves to the next card, or ends the round. */
  const advance = useCallback(() => {
    window.clearTimeout(advanceTimer.current)
    setAnswered(null)
    setTyped('')

    if (index + 1 < queue.length) {
      setIndex(index + 1)
      window.setTimeout(() => answerInput.current?.focus(), 60)
      return
    }
    setPhase(missed.length > 0 ? 'roundEnd' : 'done')
  }, [index, queue.length, missed.length])

  const register = useCallback(
    (result: Grade, record: Omit<Answered, 'grade'> = {}) => {
      if (!card) {
        return
      }
      const right = result === 'correct' || result === 'accent'

      if (right) {
        haptics.known()
        pending.current.push({ cardId: card.id, state: 'known', right: true })
      } else {
        haptics.wrong()
        pending.current.push({ cardId: card.id, state: 'rehearse', wrong: true })
        setMissed((current) =>
          current.some((item) => item.id === card.id) ? current : [...current, card],
        )
        setStumbled((current) =>
          current.some((item) => item.id === card.id) ? current : [...current, card],
        )
      }

      if (round === 1) {
        setFirstPass((current) => ({
          total: current.total + 1,
          correct: current.correct + (right ? 1 : 0),
        }))
      }

      if (pending.current.length >= 8) {
        void flush()
      }

      setAnswered({ grade: result, ...record })

      // Right answers move on by themselves; wrong ones wait so the correct
      // answer, and any note on the card, can actually be read.
      if (right && mode === 'choice' && !card.note) {
        advanceTimer.current = window.setTimeout(advance, 620)
      }
    },
    [card, round, flush, mode, advance],
  )

  const choose = (optionIndex: number) => {
    if (!question || answered) {
      return
    }
    const correct = optionIndex === question.correctIndex
    register(correct ? 'correct' : 'wrong', { chosen: optionIndex })
  }

  const retryWritten = useCallback(() => {
    setAnswered(null)
    setTyped('')
    answerInput.current?.focus()
  }, [])

  const submitWritten = (event: React.FormEvent) => {
    event.preventDefault()
    if (!card) {
      return
    }

    // "Almost" leaves the field live so the word can be typed again, and
    // Enter has to do what the Try again button does — otherwise the only way
    // on from a near miss was to reach for the button.
    if (answered?.grade === 'close') {
      retryWritten()
      return
    }
    if (answered) {
      return
    }

    const verdict = grade(typed, answerSide(card, dir), alsoAccepted(card, answerKey(dir)))

    // "Almost" is a spelling nudge, not a mistake: offer the same card again —
    // but only once, so there is no loop to get stuck in.
    if (verdict === 'close' && (nudges.current.get(card.id) ?? 0) === 0) {
      nudges.current.set(card.id, 1)
      haptics.tap()
      setAnswered({ grade: 'close', typed })
      return
    }
    register(verdict === 'close' ? 'wrong' : verdict, { typed })
  }

  const nextRound = () => {
    setQueue(shuffle(missed))
    setMissed([])
    setIndex(0)
    setRound((value) => value + 1)
    setAnswered(null)
    setTyped('')
    setPhase('running')
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'running' || mode !== 'choice') {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (answered) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          advance()
        }
        return
      }
      const position = '1234'.indexOf(event.key)
      const letter = 'abcd'.indexOf(event.key.toLowerCase())
      const pick = position >= 0 ? position : letter
      if (pick >= 0 && question && pick < question.options.length) {
        event.preventDefault()
        choose(pick)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, answered, question, advance])

  // ── Finishing ─────────────────────────────────────────────────────────────

  const recorded = useRef(false)
  useEffect(() => {
    if (phase !== 'done' || !set || recorded.current) {
      return
    }
    recorded.current = true
    haptics.finish()
    void flush().then(() =>
      outbox
        .recordResult({
          setId: set.id,
          dir,
          mode,
          total: firstPass.total,
          correct: firstPass.correct,
          durationMs: Date.now() - startedAt.current,
        })
        .catch(() => undefined),
    )
  }, [phase, set, dir, mode, firstPass, flush])

  // ── Rendering ─────────────────────────────────────────────────────────────

  if (!set) {
    return (
      <Shell immersive>
        <Spinner />
      </Shell>
    )
  }

  if (set.cards.length === 0) {
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={set.title} />
        <Empty icon="cards" title={t('test.nothingTitle')}>
          {t('test.nothingBody')}
        </Empty>
      </Shell>
    )
  }

  const fromLabel = promptLang(set, dir)
  const toLabel = answerLang(set, dir)

  if (phase === 'setup') {
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={t('test.title')} />
        <div className="stack enter" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
          <div>
            <h1 className="sethead__title">{t('test.setupTitle')}</h1>
            <p className="muted small" style={{ marginTop: '0.4rem' }}>
              {t('test.setupBody', {
                cards: t('set.cards', { n: set.cards.length }),
                from: fromLabel,
                to: toLabel,
              })}
            </p>
          </div>

          <Segmented
            label={t('test.modeLabel')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'choice', label: t('test.choice') },
              { value: 'write', label: t('test.write') },
            ]}
          />

          <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <Icon
              name={mode === 'choice' ? 'list' : 'keyboard'}
              style={{ color: 'var(--accent)', flex: 'none' }}
            />
            <p className="small grow">
              {mode === 'choice' ? t('test.choiceHint') : t('test.writeHint')}
            </p>
          </div>

          {set.cards.length < MIN_CHOICE_CARDS && mode === 'choice' && (
            <p className="field__error small">{t('test.needCards', { n: MIN_CHOICE_CARDS })}</p>
          )}

          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={start}
            disabled={mode === 'choice' && set.cards.length < MIN_CHOICE_CARDS}
          >
            <Icon name="play" />
            {t('test.start')}
          </button>
        </div>
      </Shell>
    )
  }

  if (phase === 'roundEnd') {
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={t('test.round', { n: round })} />
        <div className="result">
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              width: '4.5rem',
              height: '4.5rem',
              borderRadius: '999px',
              background: 'var(--rehearse-dim)',
              color: 'var(--rehearse)',
              animation: 'pop 420ms var(--ease-spring) both',
            }}
          >
            <Icon name="rotate" width={28} height={28} />
          </div>
          <div>
            <h1 className="result__headline">{t('test.toRepeat', { n: missed.length })}</h1>
            <p className="muted small" style={{ marginTop: '0.35rem' }}>
              {t('test.roundEndBody', { n: round })}
            </p>
          </div>

          <div className="panel panel--flush wronglist">
            {missed.map((item) => (
              <div className="cardrow" key={item.id}>
                <span className="cardrow__dot cardrow__dot--rehearse" />
                <span className="cardrow__a truncate">{promptSide(item, dir)}</span>
                <span className="cardrow__b truncate">
                  {displayAnswer(answerSide(item, dir))}
                </span>
              </div>
            ))}
          </div>

          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={nextRound}>
            <Icon name="arrowRight" />
            {t('test.repeatThese', { n: missed.length })}
          </button>
        </div>
      </Shell>
    )
  }

  if (phase === 'done') {
    const score = percent(firstPass.correct, firstPass.total)
    const flawless = stumbled.length === 0

    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={t('test.result')} />
        <div className="result">
          <div>
            <p className="eyebrow">{t('test.firstAttempt')}</p>
            <div
              className="result__score"
              style={{ color: score >= 80 ? 'var(--known)' : score >= 50 ? 'var(--rehearse)' : 'var(--wrong)' }}
            >
              {score}%
            </div>
            <p className="muted small">
              {t('test.rightFirstTime', { correct: firstPass.correct, total: firstPass.total })}
            </p>
          </div>

          <h1 className="result__headline">
            {flawless
              ? t('test.perfect')
              : score >= 80
                ? t('test.nicely')
                : score >= 50
                  ? t('test.gettingThere')
                  : t('test.anotherPass')}
          </h1>

          <div className="statgrid" style={{ width: '100%' }}>
            <div className="stat">
              <div className="stat__value">{round}</div>
              <div className="stat__label">{t('test.rounds')}</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stumbled.length}</div>
              <div className="stat__label">{t('test.stumbled')}</div>
            </div>
            <div className="stat">
              <div className="stat__value" style={{ fontSize: '1.1rem' }}>
                {duration(Date.now() - startedAt.current)}
              </div>
              <div className="stat__label">{t('test.time')}</div>
            </div>
          </div>

          {stumbled.length > 0 && (
            <div className="wronglist stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
              <p className="eyebrow">{t('test.worthLook')}</p>
              <div className="panel panel--flush">
                {stumbled.map((item) => (
                  <div className="cardlist__item" key={item.id}>
                    <div className="cardlist__row">
                      <span className="cardrow__a truncate">{promptSide(item, dir)}</span>
                      <span className="cardrow__b truncate">
                        {displayAnswer(answerSide(item, dir))}
                      </span>
                    </div>
                    {item.note && <p className="cardlist__note">{item.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="stack" style={{ '--gap': '0.5rem', width: '100%' } as React.CSSProperties}>
            <button
              type="button"
              className="btn btn--primary btn--lg btn--block"
              onClick={() => {
                recorded.current = false
                setPhase('setup')
              }}
            >
              <Icon name="rotate" />
              {t('test.testAgain')}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate(`/s/${slug}`)}
            >
              {t('cards.backToSet')}
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // phase === 'running'
  const revealed = answered !== null
  const settled = revealed && answered.grade !== 'close'
  const correctAnswer = card ? displayAnswer(answerSide(card, dir)) : ''

  return (
    <Shell immersive>
      <TopBar
        back={`/s/${slug}`}
        title={round > 1 ? t('test.round', { n: round }) : set.title}
        actions={
          <span className="chip">
            {fromLabel} <Icon name="arrowRight" width={11} height={11} /> {toLabel}
          </span>
        }
      />

      <div className="stack" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
        <Bar value={index + (revealed ? 1 : 0)} total={queue.length} />
        <div className="spread tiny faint">
          <span className="num">{t('test.counter', { index: index + 1, total: queue.length })}</span>
          {missed.length > 0 && <span>{t('test.repeatShort', { n: missed.length })}</span>}
        </div>
      </div>

      <div className="quiz">
        <div className="quiz__prompt" key={card?.id}>
          <div>
            {card ? (
              <Word
                word={{ ...parts(card, promptKey(dir), show), term: promptSide(card, dir) }}
                className="quiz__term"
              />
            ) : (
              <p className="quiz__term" />
            )}
            <p className="quiz__ask">{t('test.inLang', { lang: toLabel })}</p>
          </div>
        </div>

        {mode === 'choice' && question && (
          <div className="options">
            {question.options.map((option, optionIndex) => {
              const isCorrect = optionIndex === question.correctIndex
              const isChosen = answered?.chosen === optionIndex
              let className = 'option'
              if (revealed) {
                if (isCorrect) {
                  className += ' option--correct'
                } else if (isChosen) {
                  className += ' option--wrong'
                } else {
                  className += ' option--muted'
                }
              }
              return (
                <button
                  key={`${option}-${optionIndex}`}
                  type="button"
                  className={className}
                  disabled={revealed}
                  onClick={() => choose(optionIndex)}
                >
                  <span className="option__key">{OPTION_KEYS[optionIndex]}</span>
                  <span className="grow">{option}</span>
                  {revealed && isCorrect && <Icon name="check" />}
                  {revealed && isChosen && !isCorrect && <Icon name="x" />}
                </button>
              )
            })}
          </div>
        )}

        {mode === 'write' && (
          <form className="answerbox" onSubmit={submitWritten}>
            <input
              ref={answerInput}
              className="input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={t('test.typePlaceholder', { lang: toLabel })}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              disabled={settled}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />

            {!revealed && (
              <button type="submit" className="btn btn--primary btn--block" disabled={!typed.trim()}>
                {t('test.check')}
              </button>
            )}

            {answered?.grade === 'close' && (
              <>
                <div className="verdict verdict--close">
                  <Icon name="alert" />
                  <span>
                    {t('test.almost')} {t('test.lastNudge')}
                  </span>
                </div>
                {/* Enter in the field above does the same thing. */}
                <button type="submit" className="btn btn--block">
                  <Icon name="undo" />
                  {t('test.tryAgain')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--block btn--sm"
                  onClick={() => card && register('wrong', { typed })}
                >
                  {t('test.giveUp')}
                </button>
              </>
            )}

            {answered?.grade === 'accent' && (
              <div className="verdict verdict--correct">
                <Icon name="check" />
                <span>
                  {t('test.accentRight')}{' '}
                  <span className="verdict__answer">{correctAnswer}</span>
                </span>
              </div>
            )}

            {answered?.grade === 'correct' && (
              <div className="verdict verdict--correct">
                <Icon name="check" />
                <span>{t('test.correct')}</span>
              </div>
            )}

            {answered?.grade === 'wrong' && (
              <div className="verdict verdict--wrong">
                <Icon name="x" />
                <span>
                  {tx('test.theAnswerIs', {
                    answer: <span className="verdict__answer">{correctAnswer}</span>,
                  })}
                </span>
              </div>
            )}
          </form>
        )}

        {/* The note is part of the answer: this is where "il gesso is kréta in
            the classroom, but also gipsz" has to be readable. */}
        {settled && card?.note && (
          <div className="quiz__note">
            <Icon name="sparkle" />
            <span>{card.note}</span>
          </div>
        )}

        {settled && card && hasConjugation(card) && (
          <button
            type="button"
            className="btn btn--block btn--sm"
            onClick={() => setVerb(card)}
          >
            <Icon name="list" />
            {t('word.conjugation')}
          </button>
        )}

        {settled && (
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={advance}
            autoFocus={mode === 'write'}
          >
            {index + 1 < queue.length
              ? t('common.next')
              : missed.length > 0
                ? t('test.seeRepeat')
                : t('common.finish')}
            <Icon name="arrowRight" />
          </button>
        )}
      </div>

      {verb && (
        <Sheet title={`${t('word.conjugation')} — ${verb.a}`} onClose={() => setVerb(null)}>
          <Conjugation card={verb} />
        </Sheet>
      )}
    </Shell>
  )
}
