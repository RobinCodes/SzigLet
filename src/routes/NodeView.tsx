import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { LESSON_SIZES, readLessonSize, storeLessonSize } from '../lib/display'
import { hasPlayableParts, presenceOf, subnodeComplete, subnodeCount } from '../lib/lesson'
import type { Course, NodeCard, NodeDetail, Question } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Bar, Empty, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { courseStates } from './CourseView'

export function NodeView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { canEdit } = useAuth()
  const { t } = useI18n()

  const [detail, setDetail] = useState<NodeDetail | null>(null)
  const [course, setCourse] = useState<Course | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState(readLessonSize)

  useEffect(() => {
    let cancelled = false
    api
      .node(Number(id))
      .then((result) => {
        if (cancelled) return
        setDetail(result)
        return api.course(result.node.courseSlug).then((c) => !cancelled && setCourse(c))
      })
      .catch((caught: unknown) => !cancelled && setError(errorText(t, caught, 'course.nodeLoadFailed')))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const maps = useMemo(() => {
    if (!detail) return null
    return {
      cards: new Map<number, NodeCard>(detail.cards.map((card) => [card.id, card])),
      questions: new Map<number, Question>(detail.questions.map((q) => [q.id, q])),
      hidden: new Set(detail.hidden),
    }
  }, [detail])

  if (error) {
    return (
      <Shell>
        <TopBar back="/" />
        <Empty icon="search" title={t('course.nodeNotFound')}>
          {error}
        </Empty>
      </Shell>
    )
  }
  if (!detail || !maps) {
    return (
      <Shell>
        <TopBar back="/" />
        <Spinner />
      </Shell>
    )
  }

  const { node } = detail
  const present = presenceOf(maps.cards, maps.questions, maps.hidden)
  const position = course?.nodes.findIndex((other) => other.id === node.id) ?? -1
  const unlocked = !course || position < 0 || courseStates(course)[position]!.unlocked
  const subs = node.content.subnodes
  // The first sub-node not yet complete is the one to study; earlier ones
  // stay open for practice, later ones wait.
  let current = subs.findIndex((sub) => !subnodeComplete(sub, detail.progress, present))
  if (current < 0) current = subs.length

  const changeSize = (value: number) => {
    setSize(value)
    storeLessonSize(value)
  }

  const start = (subId: string) => navigate(`/n/${node.id}/lesson?sub=${encodeURIComponent(subId)}`)

  return (
    <Shell>
      <TopBar
        back={`/c/${node.courseSlug}`}
        title={node.courseTitle}
        actions={
          canEdit ? (
            <Link to={`/n/${node.id}/edit`} className="icon-btn" aria-label={t('course.editNode')}>
              <Icon name="edit" />
            </Link>
          ) : undefined
        }
      />

      <div className="sethead enter">
        <h1 className="sethead__title">{node.title}</h1>
        {node.description && <p className="sethead__desc">{node.description}</p>}
      </div>

      {!unlocked && (
        <div className="panel row" style={{ marginBottom: '1rem' }}>
          <Icon name="lock" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
          <span className="small grow">{canEdit ? t('course.lockedEditor') : t('course.lockedBody')}</span>
        </div>
      )}

      {subs.every((sub) => sub.parts.length === 0) ? (
        <Empty icon="layers" title={t('course.nodeEmpty')}>
          {canEdit ? t('course.nodeEmptyEditor') : t('course.emptyViewer')}
        </Empty>
      ) : (
        <ol className="steps steps--sub">
          {subs.map((sub, index) => {
            const done = subnodeComplete(sub, detail.progress, present)
            const count = subnodeCount(sub, detail.progress, present)
            const open = (unlocked || canEdit) && index <= current
            const playable =
              open &&
              hasPlayableParts({
                content: node.content,
                sub,
                cards: maps.cards,
                questions: maps.questions,
                progress: detail.progress,
                hidden: maps.hidden,
              })
            return (
              <li key={sub.id} className={`substep${done ? ' substep--done' : ''}${index === current ? ' substep--current' : ''}`}>
                <span className="substep__num">{done ? <Icon name="check" width={16} height={16} /> : index + 1}</span>
                <div className="grow stack" style={{ '--gap': '0.35rem' } as React.CSSProperties}>
                  <span className="substep__title">{sub.title || t('course.step', { n: index + 1 })}</span>
                  {count.total > 0 && <Bar value={count.done} total={count.total} tone="known" />}
                  {open && !playable && <span className="tiny faint">{t('course.waitingFor')}</span>}
                </div>
                {open ? (
                  <button
                    type="button"
                    className={`btn btn--sm${index === current ? ' btn--primary' : ''}`}
                    disabled={!playable}
                    onClick={() => start(sub.id)}
                  >
                    <Icon name={done ? 'rotate' : 'play'} />
                    {done ? t('course.practise') : t('course.startLesson')}
                  </button>
                ) : (
                  <Icon name="lock" style={{ color: 'var(--ink-faint)' }} />
                )}
              </li>
            )
          })}
        </ol>
      )}

      <section className="stack" style={{ '--gap': '0.5rem', marginTop: '1.5rem' } as React.CSSProperties}>
        <p className="eyebrow">{t('course.lessonLength')}</p>
        <div className="togglerow">
          {LESSON_SIZES.map((value) => (
            <button
              key={value}
              type="button"
              className={`chip chip--button${size === value ? ' chip--accent' : ''}`}
              aria-pressed={size === value}
              onClick={() => changeSize(value)}
            >
              {t('course.exercises', { n: value })}
            </button>
          ))}
        </div>
        <p className="tiny faint">{t('course.lessonLengthHint')}</p>
      </section>
    </Shell>
  )
}
