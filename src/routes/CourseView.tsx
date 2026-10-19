import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { nodeState, presenceOf, type NodeState } from '../lib/lesson'
import type { Course } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Empty, Ring, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'

/**
 * Where each node of a course stands for this learner, and which are open.
 * A node opens once every node before it is complete; editors can walk in
 * anywhere, to check their work.
 */
export function courseStates(course: Course): { state: NodeState; unlocked: boolean }[] {
  const present = presenceOf(null, null, new Set(course.hidden))
  let open = true
  return course.nodes.map((node) => {
    const state = nodeState(node.content, course.progress, present)
    const unlocked = open
    open = open && state.complete
    return { state, unlocked }
  })
}

export function CourseView() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { canEdit } = useAuth()
  const { t } = useI18n()

  const [course, setCourse] = useState<Course | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .course(slug)
      .then((result) => !cancelled && setCourse(result))
      .catch((caught: unknown) => !cancelled && setError(errorText(t, caught, 'course.loadFailed')))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const states = useMemo(() => (course ? courseStates(course) : []), [course])

  if (error) {
    return (
      <Shell>
        <TopBar back="/" />
        <Empty icon="search" title={t('course.notFound')}>
          {error}
        </Empty>
      </Shell>
    )
  }
  if (!course) {
    return (
      <Shell>
        <TopBar back="/" />
        <Spinner />
      </Shell>
    )
  }

  const next = states.findIndex((entry) => entry.unlocked && !entry.state.complete)
  const done = states.filter((entry) => entry.state.complete).length

  return (
    <Shell>
      <TopBar
        back="/"
        actions={
          <>
            {course.canSeeStats && (
              <Link to={`/c/${course.slug}/stats`} className="icon-btn" aria-label={t('stats.title')}>
                <Icon name="chart" />
              </Link>
            )}
            {canEdit && (
              <Link to={`/c/${course.slug}/edit`} className="icon-btn" aria-label={t('course.edit')}>
                <Icon name="edit" />
              </Link>
            )}
          </>
        }
      />

      <div className="sethead enter">
        <div className="row" style={{ '--gap': '0.4rem', marginBottom: '0.4rem' } as React.CSSProperties}>
          <span className="chip chip--accent">
            <Icon name="path" width={11} height={11} /> {t('kinds.course')}
          </span>
          {!course.published && <span className="chip">{t('common.draft')}</span>}
        </div>
        <h1 className="sethead__title">{course.title}</h1>
        {course.description && <p className="sethead__desc">{course.description}</p>}
        <p className="tiny faint" style={{ marginTop: '0.5rem' }}>
          {t('course.nodesDoneOf', { done, total: course.nodes.length })}
          {course.authors.length > 0 &&
            ` · ${t('set.by', { author: course.authors.map((author) => author.username).join(', ') })}`}
        </p>
      </div>

      {course.nodes.length === 0 ? (
        <Empty icon="path" title={t('course.emptyTitle')}>
          {canEdit ? t('course.emptyEditor') : t('course.emptyViewer')}
        </Empty>
      ) : (
        <ol className="path">
          {course.nodes.map((node, index) => {
            const { state, unlocked } = states[index]!
            const reachable = unlocked || canEdit
            const isNext = index === next
            // A gentle zig-zag, like a path up a hill.
            const offset = Math.round(Math.sin(index * 1.1) * 28)
            return (
              <li key={node.id} className="path__step" style={{ '--offset': `${offset}%` } as React.CSSProperties}>
                <button
                  type="button"
                  className={`node${state.complete ? ' node--done' : ''}${isNext ? ' node--next' : ''}${
                    unlocked ? '' : ' node--locked'
                  }`}
                  disabled={!reachable}
                  onClick={() => navigate(`/n/${node.id}`)}
                  aria-label={`${node.title}${unlocked ? '' : ` — ${t('course.locked')}`}`}
                >
                  <Ring
                    value={state.fraction}
                    size={76}
                    label={t('course.nodeAria', { title: node.title, percent: Math.round(state.fraction * 100) })}
                    tone={state.complete ? 'known' : undefined}
                  />
                  <span className="node__icon">
                    <Icon name={state.complete ? 'check' : unlocked ? (isNext ? 'play' : 'star') : 'lock'} size={26} />
                  </span>
                </button>
                <span className="node__title">{node.title}</span>
                {isNext && <span className="chip chip--accent node__start">{t('course.start')}</span>}
              </li>
            )
          })}
        </ol>
      )}

      {course.sets.length > 0 && (
        <section style={{ marginTop: '1.5rem' }}>
          <p className="eyebrow" style={{ marginBottom: '0.6rem' }}>
            {t('course.sets')}
          </p>
          <div className="panel panel--flush">
            {course.sets.map((set) => (
              <Link key={set.id} to={`/s/${set.slug}`} className="cardrow cardrow--link">
                <Icon
                  name={set.kind === 'questions' ? 'help' : 'cards'}
                  style={{ color: 'var(--accent)', flex: 'none' }}
                  width={18}
                  height={18}
                />
                <span className="grow truncate" style={{ fontWeight: 560 }}>
                  {set.title}
                </span>
                <span className="tiny faint">
                  {set.kind === 'questions'
                    ? t('set.questions', { n: set.questionCount })
                    : t('set.cards', { n: set.cardCount })}
                </span>
                <Icon name="chevronRight" style={{ color: 'var(--ink-faint)', flex: 'none' }} width={16} height={16} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </Shell>
  )
}
