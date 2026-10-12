import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api, outbox } from '../lib/api'
import { useToast } from '../lib/toast'
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
import { duration, percent, plural } from '../lib/format'
import type { Card, Direction, ProgressUpdate, StudySet, TestMode } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Bar, Empty, Segmented, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'

type Phase = 'setup' | 'running' | 'roundEnd' | 'done'

type Answered = { grade: Grade; typed?: string; chosen?: number }

const OPTION_KEYS = ['A', 'B', 'C', 'D']

export function TestRun() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()

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

  const [firstPass, setFirstPass] = useState({ total: 0, correct: 0 })

  const pending = useRef<ProgressUpdate[]>([])
  const startedAt = useRef(Date.now())
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
          toast.error(caught instanceof ApiError ? caught.message : 'Could not load this set.')
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
      // answer can actually be read.
      if (right && mode === 'choice') {
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

  const submitWritten = (event: React.FormEvent) => {
    event.preventDefault()
    if (!card || answered) {
      return
    }
    const verdict = grade(typed, answerSide(card, dir))

    // "Almost" is a spelling nudge, not a mistake: offer the same card again.
    if (verdict === 'close') {
      haptics.tap()
      setAnswered({ grade: 'close', typed })
      return
    }
    register(verdict, { typed })
  }

  const retryWritten = () => {
    setAnswered(null)
    setTyped('')
    answerInput.current?.focus()
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
        <Empty icon="cards" title="Nothing to test">
          This set has no cards yet.
        </Empty>
      </Shell>
    )
  }

  const fromLabel = promptLang(set, dir)
  const toLabel = answerLang(set, dir)

  if (phase === 'setup') {
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title="Test" />
        <div className="stack enter" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
          <div>
            <h1 className="sethead__title">How do you want to be tested?</h1>
            <p className="muted small" style={{ marginTop: '0.4rem' }}>
              {plural(set.cards.length, 'card', 'cards')} · {fromLabel} → {toLabel}. Anything
              you get wrong comes back until you get it right.
            </p>
          </div>

          <Segmented
            label="Test mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'choice', label: 'Multiple choice' },
              { value: 'write', label: 'Write it out' },
            ]}
          />

          <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <Icon
              name={mode === 'choice' ? 'list' : 'keyboard'}
              style={{ color: 'var(--accent)', flex: 'none' }}
            />
            <p className="small grow">
              {mode === 'choice'
                ? 'Four options, one right answer. Quick, and good for recognising words.'
                : 'Type the answer. Accents are forgiven with a nudge, and a near miss lets you try again.'}
            </p>
          </div>

          {set.cards.length < MIN_CHOICE_CARDS && mode === 'choice' && (
            <p className="field__error small">
              Multiple choice needs at least {MIN_CHOICE_CARDS} cards. Use written answers
              for this set.
            </p>
          )}

          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={start}
            disabled={mode === 'choice' && set.cards.length < MIN_CHOICE_CARDS}
          >
            <Icon name="play" />
            Start the test
          </button>
        </div>
      </Shell>
    )
  }

  if (phase === 'roundEnd') {
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={`Round ${round}`} />
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
            <h1 className="result__headline">
              {plural(missed.length, 'card to repeat', 'cards to repeat')}
            </h1>
            <p className="muted small" style={{ marginTop: '0.35rem' }}>
              Round {round} done. These come back now — the test ends when every card is
              right.
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
            Repeat these {missed.length}
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
        <TopBar back={`/s/${slug}`} title="Result" />
        <div className="result">
          <div>
            <p className="eyebrow">First attempt</p>
            <div
              className="result__score"
              style={{ color: score >= 80 ? 'var(--known)' : score >= 50 ? 'var(--rehearse)' : 'var(--wrong)' }}
            >
              {score}%
            </div>
            <p className="muted small">
              {firstPass.correct} of {firstPass.total} right first time
            </p>
          </div>

          <h1 className="result__headline">
            {flawless
              ? 'Perfect run'
              : score >= 80
                ? 'Nicely done'
                : score >= 50
                  ? 'Getting there'
                  : 'Worth another pass'}
          </h1>

          <div className="statgrid" style={{ width: '100%' }}>
            <div className="stat">
              <div className="stat__value">{round}</div>
              <div className="stat__label">Rounds</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stumbled.length}</div>
              <div className="stat__label">Stumbled</div>
            </div>
            <div className="stat">
              <div className="stat__value" style={{ fontSize: '1.1rem' }}>
                {duration(Date.now() - startedAt.current)}
              </div>
              <div className="stat__label">Time</div>
            </div>
          </div>

          {stumbled.length > 0 && (
            <div className="wronglist stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
              <p className="eyebrow">Worth another look</p>
              <div className="panel panel--flush">
                {stumbled.map((item) => (
                  <div className="cardrow" key={item.id}>
                    <span className="cardrow__a truncate">{promptSide(item, dir)}</span>
                    <span className="cardrow__b truncate">
                      {displayAnswer(answerSide(item, dir))}
                    </span>
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
              Test again
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate(`/s/${slug}`)}
            >
              Back to the set
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // phase === 'running'
  const revealed = answered !== null
  const correctAnswer = card ? displayAnswer(answerSide(card, dir)) : ''

  return (
    <Shell immersive>
      <TopBar
        back={`/s/${slug}`}
        title={round > 1 ? `Round ${round}` : set.title}
        actions={
          <span className="chip">
            {fromLabel} <Icon name="arrowRight" width={11} height={11} /> {toLabel}
          </span>
        }
      />

      <div className="stack" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
        <Bar value={index + (revealed ? 1 : 0)} total={queue.length} />
        <div className="spread tiny faint">
          <span className="num">
            {index + 1} / {queue.length}
          </span>
          {missed.length > 0 && <span>{missed.length} to repeat</span>}
        </div>
      </div>

      <div className="quiz">
        <div className="quiz__prompt" key={card?.id}>
          <div>
            <p className="quiz__term">{card ? promptSide(card, dir) : ''}</p>
            <p className="quiz__ask">in {toLabel}</p>
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
              placeholder={`Type the ${toLabel} word`}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              disabled={revealed && answered?.grade !== 'close'}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />

            {!revealed && (
              <button type="submit" className="btn btn--primary btn--block" disabled={!typed.trim()}>
                Check
              </button>
            )}

            {answered?.grade === 'close' && (
              <>
                <div className="verdict verdict--close">
                  <Icon name="alert" />
                  <span>Almost — check your spelling and try once more.</span>
                </div>
                <button type="button" className="btn btn--block" onClick={retryWritten}>
                  <Icon name="undo" />
                  Try again
                </button>
              </>
            )}

            {answered?.grade === 'accent' && (
              <div className="verdict verdict--correct">
                <Icon name="check" />
                <span>
                  Right — mind the accents:{' '}
                  <span className="verdict__answer">{correctAnswer}</span>
                </span>
              </div>
            )}

            {answered?.grade === 'correct' && (
              <div className="verdict verdict--correct">
                <Icon name="check" />
                <span>Correct</span>
              </div>
            )}

            {answered?.grade === 'wrong' && (
              <div className="verdict verdict--wrong">
                <Icon name="x" />
                <span>
                  The answer is <span className="verdict__answer">{correctAnswer}</span>
                </span>
              </div>
            )}
          </form>
        )}

        {revealed && answered.grade !== 'close' && (
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={advance}
            autoFocus={mode === 'write'}
          >
            {index + 1 < queue.length ? 'Next' : missed.length > 0 ? 'See what to repeat' : 'Finish'}
            <Icon name="arrowRight" />
          </button>
        )}
      </div>
    </Shell>
  )
}
