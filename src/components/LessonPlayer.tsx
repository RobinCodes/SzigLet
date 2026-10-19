import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { outbox } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { haptics } from '../lib/haptics'
import { exerciseItems, type Exercise } from '../lib/lesson'
import type { ItemUpdate } from '../lib/types'
import { Shell } from './Shell'
import { Bar, Empty } from './Bits'
import { Icon } from './Icon'
import { FlagButton } from './FlagButton'
import {
  CompareExercise,
  IntroExercise,
  MatchExercise,
  QuestionExercise,
  VocabExercise,
} from './Exercises'

export type LessonSummary = {
  attempts: ItemUpdate[]
  /** Exercises asked, introductions not counted. */
  total: number
  /** Right the first time round. */
  correct: number
  durationMs: number
}

type Slot = { exercise: Exercise; key: string; tries: number }

/** A missed exercise comes back at the end, at most this many times. */
const MAX_TRIES = 3

/**
 * Plays a list of exercises, Duolingo-style: one at a time, a bar across the
 * top, and whatever was missed queued again at the end until it is right.
 * Every attempt is saved as it happens, so leaving halfway loses nothing.
 */
export function LessonPlayer({
  exercises,
  back,
  renderEnd,
}: {
  exercises: Exercise[]
  /** Where the close button leads. */
  back: string
  renderEnd: (summary: LessonSummary) => ReactNode
}) {
  const { t } = useI18n()
  const navigate = useNavigate()

  const [queue, setQueue] = useState<Slot[]>(() =>
    exercises.map((exercise, index) => ({ exercise, key: `e${index}`, tries: 1 })),
  )
  const [index, setIndex] = useState(0)
  const [answered, setAnswered] = useState<boolean | null>(null)
  const [summary, setSummary] = useState<LessonSummary | null>(null)

  const attempts = useRef<ItemUpdate[]>([])
  const pending = useRef<ItemUpdate[]>([])
  const first = useRef(new Map<string, boolean>())
  const startedAt = useRef(Date.now())

  const flush = useCallback(async () => {
    const updates = pending.current
    if (updates.length === 0) return
    pending.current = []
    try {
      await outbox.saveItems(updates)
    } catch {
      /* the outbox kept it */
    }
  }, [])

  useEffect(() => () => void flush(), [flush])

  const slot = queue[index]

  const onAttempt = useCallback(
    (item: string, ok: boolean | null) => {
      const update = { item, ok }
      attempts.current.push(update)
      pending.current.push(update)
      if (pending.current.length >= 10) void flush()
    },
    [flush],
  )

  const onAnswered = useCallback(
    (right: boolean) => {
      if (!slot) return
      setAnswered(right)
      const origin = slot.key.split('~')[0]!
      if (slot.exercise.type !== 'intro' && !first.current.has(origin)) {
        first.current.set(origin, right)
      }
      if (!right && slot.tries < MAX_TRIES) {
        setQueue((current) => [
          ...current,
          { exercise: slot.exercise, key: `${origin}~${slot.tries + 1}`, tries: slot.tries + 1 },
        ])
      }
    },
    [slot],
  )

  const finish = useCallback(() => {
    haptics.finish()
    const firsts = [...first.current.values()]
    setSummary({
      attempts: attempts.current.slice(),
      total: firsts.length,
      correct: firsts.filter(Boolean).length,
      durationMs: Date.now() - startedAt.current,
    })
    void flush()
  }, [flush])

  const next = useCallback(() => {
    setAnswered(null)
    if (index + 1 < queue.length) {
      setIndex(index + 1)
    } else {
      finish()
    }
  }, [index, queue.length, finish])

  /** A reported and hidden item leaves the lesson, every copy of it. */
  const drop = (item: string) => {
    const rest = queue.filter((other, i) => i < index || !exerciseItems(other.exercise).includes(item))
    setQueue(rest)
    setAnswered(null)
    if (index >= rest.length) {
      finish()
    }
  }

  // Enter moves on once an exercise is done, wherever the focus is.
  useEffect(() => {
    if (answered === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === 'Enter' && !(target instanceof HTMLButtonElement)) {
        event.preventDefault()
        next()
      }
    }
    // Wait a tick, so the Enter that submitted the answer is not also the one
    // that skips past it.
    const timer = window.setTimeout(() => window.addEventListener('keydown', onKeyDown), 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [answered, next])

  if (summary) {
    return <>{renderEnd(summary)}</>
  }

  if (!slot) {
    return (
      <Shell>
        <Empty icon="sparkle" title={t('lesson.nothingTitle')}>
          {t('lesson.nothingBody')}
        </Empty>
        <button type="button" className="btn btn--block" onClick={() => navigate(back)}>
          {t('common.back')}
        </button>
      </Shell>
    )
  }

  const items = exerciseItems(slot.exercise)
  const flaggable = slot.exercise.type !== 'match' && slot.exercise.type !== 'compare' ? items[0] ?? null : null
  const props = { onAttempt, onAnswered }

  return (
    <Shell immersive>
      <header className="topbar lesson__top">
        <button
          type="button"
          className="icon-btn"
          aria-label={t('lesson.quit')}
          onClick={() => {
            void flush()
            navigate(back)
          }}
        >
          <Icon name="x" />
        </button>
        <div className="grow">
          <Bar value={index + (answered !== null ? 1 : 0)} total={queue.length} tone="known" />
        </div>
        <FlagButton item={flaggable} onHidden={drop} />
      </header>

      {slot.tries > 1 && (
        <p className="lesson__again tiny">
          <Icon name="rotate" width={12} height={12} /> {t('lesson.again')}
        </p>
      )}

      <div className="lesson__body" key={slot.key}>
        {slot.exercise.type === 'intro' && <IntroExercise exercise={slot.exercise} {...props} />}
        {slot.exercise.type === 'vocab' && <VocabExercise exercise={slot.exercise} {...props} />}
        {slot.exercise.type === 'match' && <MatchExercise exercise={slot.exercise} {...props} />}
        {slot.exercise.type === 'question' && <QuestionExercise exercise={slot.exercise} {...props} />}
        {slot.exercise.type === 'compare' && <CompareExercise exercise={slot.exercise} {...props} />}
      </div>

      {answered !== null && (
        <div className={`lesson__foot lesson__foot--${slot.exercise.type === 'intro' ? 'intro' : answered ? 'right' : 'wrong'}`}>
          {slot.exercise.type !== 'intro' && (
            <span className="lesson__verdict">
              <Icon name={answered ? 'check' : 'x'} />
              {answered ? t('lesson.right') : t('lesson.wrong')}
            </span>
          )}
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={next}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          >
            {index + 1 < queue.length ? t('lesson.continue') : t('common.finish')}
            <Icon name="arrowRight" />
          </button>
        </div>
      )}
    </Shell>
  )
}
