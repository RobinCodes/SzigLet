import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, outbox } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { errorText } from '../lib/errors'
import { readLessonSize } from '../lib/display'
import { percent } from '../lib/format'
import {
  applyAttempts,
  buildLesson,
  nodeState,
  presenceOf,
  questionItem,
  recordOf,
  subnodeComplete,
  type Exercise,
} from '../lib/lesson'
import { shuffle } from '../lib/study'
import type { NodeCard, NodeDetail, Question, StudySet } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { LessonPlayer, type LessonSummary } from '../components/LessonPlayer'

/** The end of a lesson: how it went, and anything it completed. */
function LessonEnd({
  summary,
  banner,
  primary,
  secondary,
}: {
  summary: LessonSummary
  banner?: string
  primary: { label: string; onClick: () => void }
  secondary?: { label: string; onClick: () => void }
}) {
  const { t, duration } = useI18n()
  const score = percent(summary.correct, summary.total)
  return (
    <Shell>
      <div className="result">
        <div className={`result__badge${banner ? ' result__badge--known' : ''}`}>
          <Icon name={banner ? 'trophy' : 'sparkle'} width={30} height={30} />
        </div>
        <div>
          <h1 className="result__headline">{banner ?? t('lesson.doneTitle')}</h1>
          <p className="muted small" style={{ marginTop: '0.35rem' }}>
            {t('test.rightFirstTime', { correct: summary.correct, total: summary.total })}
          </p>
        </div>
        <div className="statgrid" style={{ width: '100%' }}>
          <div className="stat">
            <div
              className="stat__value"
              style={{ color: score >= 80 ? 'var(--known)' : score >= 50 ? 'var(--rehearse)' : 'var(--wrong)' }}
            >
              {score}%
            </div>
            <div className="stat__label">{t('progress.accuracy')}</div>
          </div>
          <div className="stat">
            <div className="stat__value">{summary.total}</div>
            <div className="stat__label">{t('lesson.exercises')}</div>
          </div>
          <div className="stat">
            <div className="stat__value" style={{ fontSize: '1.1rem' }}>
              {duration(summary.durationMs)}
            </div>
            <div className="stat__label">{t('test.time')}</div>
          </div>
        </div>
        <div className="stack" style={{ '--gap': '0.5rem', width: '100%' } as React.CSSProperties}>
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={primary.onClick}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          >
            {primary.label}
            <Icon name="arrowRight" />
          </button>
          {secondary && (
            <button type="button" className="btn btn--ghost btn--block" onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
        </div>
      </div>
    </Shell>
  )
}

export function Lesson() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useI18n()

  const [detail, setDetail] = useState<NodeDetail | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .node(Number(id))
      .then((result) => !cancelled && setDetail(result))
      .catch((caught: unknown) => {
        if (!cancelled) {
          toast.error(errorText(t, caught, 'course.nodeLoadFailed'))
          navigate(`/n/${id}`, { replace: true })
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const lesson = useMemo(() => {
    if (!detail) return null
    const cards = new Map<number, NodeCard>(detail.cards.map((card) => [card.id, card]))
    const questions = new Map<number, Question>(detail.questions.map((q) => [q.id, q]))
    const hidden = new Set(detail.hidden)
    const subs = detail.node.content.subnodes
    const sub = subs.find((candidate) => candidate.id === params.get('sub')) ?? subs[0]
    if (!sub) return null
    const present = presenceOf(cards, questions, hidden)
    return {
      sub,
      present,
      exercises: buildLesson({
        content: detail.node.content,
        sub,
        cards,
        questions,
        progress: detail.progress,
        hidden,
        size: readLessonSize(),
      }),
      subWasDone: subnodeComplete(sub, detail.progress, present),
      nodeWasDone: nodeState(detail.node.content, detail.progress, present).complete,
    }
    // Drawn once per visit: a re-render must not reshuffle the lesson.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail])

  const recorded = useRef(false)

  if (!detail || !lesson) {
    return (
      <Shell immersive>
        <Spinner />
      </Shell>
    )
  }

  const back = `/n/${detail.node.id}`

  return (
    <LessonPlayer
      exercises={lesson.exercises}
      back={back}
      renderEnd={(summary) => {
        const after = applyAttempts(detail.progress, summary.attempts)
        const subDone = !lesson.subWasDone && subnodeComplete(lesson.sub, after, lesson.present)
        const nodeDone = !lesson.nodeWasDone && nodeState(detail.node.content, after, lesson.present).complete
        if (!recorded.current) {
          recorded.current = true
          void outbox
            .recordLesson({
              nodeId: detail.node.id,
              subnode: lesson.sub.id,
              total: summary.total,
              correct: summary.correct,
              durationMs: summary.durationMs,
              completedSub: subDone,
              completedNode: nodeDone,
            })
            .catch(() => undefined)
        }
        return (
          <LessonEnd
            summary={summary}
            banner={nodeDone ? t('lesson.nodeDone') : subDone ? t('lesson.stepDone') : undefined}
            primary={{
              label: nodeDone ? t('lesson.backToCourse') : t('lesson.continue'),
              onClick: () => navigate(nodeDone ? `/c/${detail.node.courseSlug}` : back),
            }}
            secondary={nodeDone ? { label: t('lesson.backToNode'), onClick: () => navigate(back) } : undefined}
          />
        )
      }}
    />
  )
}

/**
 * Practice for a question set outside any course: its questions, the ones
 * not yet solved first, each asked as a choice or typed.
 */
export function Practice() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useI18n()
  const [set, setSet] = useState<StudySet | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .set(slug)
      .then((result) => !cancelled && setSet(result))
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

  const exercises = useMemo<Exercise[]>(() => {
    if (!set) return []
    const hidden = new Set(set.hidden ?? [])
    const progress = set.progress ?? {}
    const usable = (set.questions ?? []).filter((q) => !hidden.has(questionItem(q.id)))
    const open = shuffle(usable.filter((q) => !recordOf(progress, questionItem(q.id)).lastOk))
    const done = shuffle(usable.filter((q) => recordOf(progress, questionItem(q.id)).lastOk))
    return [...open, ...done].slice(0, readLessonSize()).map((question) => ({
      type: 'question' as const,
      partId: 'practice',
      question,
      mode: Math.random() < 0.5 ? ('choice' as const) : ('write' as const),
    }))
  }, [set])

  if (!set) {
    return (
      <Shell immersive>
        <Spinner />
      </Shell>
    )
  }
  if (exercises.length === 0) {
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={set.title} />
        <p className="muted small">{t('lesson.nothingBody')}</p>
      </Shell>
    )
  }

  return (
    <LessonPlayer
      exercises={exercises}
      back={`/s/${slug}`}
      renderEnd={(summary) => (
        <LessonEnd
          summary={summary}
          primary={{ label: t('cards.backToSet'), onClick: () => navigate(`/s/${slug}`) }}
          secondary={{ label: t('lesson.practiseAgain'), onClick: () => window.location.reload() }}
        />
      )}
    />
  )
}
