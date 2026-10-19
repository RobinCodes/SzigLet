import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, outbox } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { fold } from '../lib/text'
import type { CourseSummary, SetSummary } from '../lib/types'
import { mastery, masteryPercent } from '../lib/word'
import { Shell } from '../components/Shell'
import { DualRing, Empty, Ring, SkeletonList } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { useIsInstalled } from '../lib/platform'

function SetCard({ set, index }: { set: SetSummary; index: number }) {
  const { t } = useI18n()

  if (set.kind === 'questions') {
    const total = set.questionCount ?? 0
    const solved = set.questionsSolved ?? 0
    return (
      <Link to={`/s/${set.slug}`} className="setcard" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
        <Ring
          value={total > 0 ? solved / total : 0}
          label={t('library.questionsAria', { solved, total })}
          icon="help"
        />
        <div className="setcard__body">
          <div className="row" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
            <span className="setcard__title truncate">{set.title}</span>
            {!set.published && <span className="chip">{t('common.draft')}</span>}
          </div>
          <div className="setcard__meta">
            <span>{t('kinds.questions')}</span>
            <span>·</span>
            <span>{t('set.questions', { n: total })}</span>
          </div>
        </div>
        <Icon name="chevronRight" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
      </Link>
    )
  }

  // Two measures rather than one average: a set can be solid one way round
  // and barely started the other, and that is the thing worth knowing
  // before tapping into it.
  const ab = masteryPercent(set.known.ab, set.cardCount, set.tests?.ab)
  const ba = masteryPercent(set.known.ba, set.cardCount, set.tests?.ba)
  return (
    <Link to={`/s/${set.slug}`} className="setcard" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
      <DualRing
        outer={mastery(set.known.ab, set.cardCount, set.tests?.ab)}
        inner={mastery(set.known.ba, set.cardCount, set.tests?.ba)}
        label={`${t('mastery.ariaRing', { from: set.langA, to: set.langB, percent: ab })}. ${t('mastery.ariaRing', {
          from: set.langB,
          to: set.langA,
          percent: ba,
        })}`}
      />
      <div className="setcard__body">
        <div className="row" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
          <span className="setcard__title truncate">{set.title}</span>
          {!set.published && <span className="chip">{t('common.draft')}</span>}
        </div>
        <div className="setcard__meta">
          <span className="setcard__pair">
            {set.langA}
            <Icon name="swap" />
            {set.langB}
          </span>
          <span>·</span>
          <span>{t('set.cards', { n: set.cardCount })}</span>
        </div>
        {ab + ba > 0 && (
          <div className="setcard__scores">
            <span className="truncate">
              {set.langA} <Icon name="arrowRight" /> {set.langB}
              <strong>{ab}%</strong>
            </span>
            <span className="truncate">
              {set.langB} <Icon name="arrowRight" /> {set.langA}
              <strong>{ba}%</strong>
            </span>
          </div>
        )}
      </div>
      <Icon name="chevronRight" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
    </Link>
  )
}

function CourseCard({ course, index }: { course: CourseSummary; index: number }) {
  const { t } = useI18n()
  const fraction = course.nodeCount > 0 ? Math.min(1, course.nodesDone / course.nodeCount) : 0
  return (
    <Link
      to={`/c/${course.slug}`}
      className="setcard setcard--course"
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <Ring
        value={fraction}
        label={t('library.courseAria', { done: course.nodesDone, total: course.nodeCount })}
        icon="path"
      />
      <div className="setcard__body">
        <div className="row" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
          <span className="setcard__title truncate">{course.title}</span>
          {!course.published && <span className="chip">{t('common.draft')}</span>}
        </div>
        <div className="setcard__meta">
          <span>{t('kinds.course')}</span>
          <span>·</span>
          <span>{t('course.nodes', { n: course.nodeCount })}</span>
          {course.nodesDone > 0 && (
            <>
              <span>·</span>
              <span>{t('course.nodesDone', { n: course.nodesDone })}</span>
            </>
          )}
        </div>
      </div>
      <Icon name="chevronRight" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
    </Link>
  )
}

export function Library() {
  const { user, canEdit } = useAuth()
  const { t, greeting } = useI18n()
  const navigate = useNavigate()
  const installed = useIsInstalled()

  const [sets, setSets] = useState<SetSummary[] | null>(null)
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(0)
  const [reports, setReports] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .sets()
      .then((result) => {
        if (!cancelled) {
          setSets(result)
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(errorText(t, caught, 'library.loadFailed'))
          setSets([])
        }
      })
    api
      .courses()
      .then((result) => !cancelled && setCourses(result))
      .catch(() => undefined)
    if (canEdit) {
      api
        .flags()
        .then((result) => !cancelled && setReports(result.length))
        .catch(() => undefined)
    }
    setPending(outbox.pending)
    return () => {
      cancelled = true
    }
    // The translator is stable per language; reloading the library on a
    // language change would be pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const needle = fold(query)
  const visible = useMemo(() => {
    if (!sets) {
      return []
    }
    if (!needle) {
      return sets
    }
    return sets.filter(
      (set) =>
        fold(set.title).includes(needle) ||
        fold(set.description ?? '').includes(needle) ||
        fold(`${set.langA} ${set.langB}`).includes(needle),
    )
  }, [sets, needle])

  const visibleCourses = courses.filter(
    (course) => !needle || fold(course.title).includes(needle) || fold(course.description ?? '').includes(needle),
  )
  const wordSets = visible.filter((set) => (set.kind ?? 'words') === 'words')
  const questionSets = visible.filter((set) => set.kind === 'questions')
  const everything = (sets?.length ?? 0) + courses.length

  return (
    <Shell>
      <div className="hero">
        <p className="eyebrow">{greeting()}</p>
        <h1 className="hero__greeting">{user?.username}</h1>
      </div>

      {pending > 0 && (
        <div
          className="panel row"
          style={{ marginBottom: '0.75rem', borderColor: 'var(--rehearse)', padding: '0.7rem 0.875rem' }}
        >
          <Icon name="cloudOff" style={{ color: 'var(--rehearse)', flex: 'none' }} />
          <span className="small grow">{t('library.pending', { n: pending })}</span>
        </div>
      )}

      {reports > 0 && (
        <Link to="/reports" className="panel row" style={{ marginBottom: '0.75rem', padding: '0.7rem 0.875rem' }}>
          <Icon name="flag" style={{ color: 'var(--wrong)', flex: 'none' }} />
          <span className="small grow">{t('flags.waiting', { n: reports })}</span>
          <Icon name="chevronRight" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
        </Link>
      )}

      {everything > 3 && (
        <div className="field" style={{ marginBottom: '0.875rem' }}>
          <div style={{ position: 'relative' }}>
            <Icon
              name="search"
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-faint)',
                width: 18,
                height: 18,
              }}
            />
            <input
              className="input"
              style={{ paddingLeft: '2.4rem' }}
              placeholder={t('library.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              autoCapitalize="none"
            />
          </div>
        </div>
      )}

      {visibleCourses.length > 0 && (
        <section style={{ marginBottom: '1.25rem' }}>
          <p className="eyebrow" style={{ marginBottom: '0.6rem' }}>
            {t('library.courses', { n: visibleCourses.length })}
          </p>
          <ul className="setlist">
            {visibleCourses.map((course, index) => (
              <li key={course.id}>
                <CourseCard course={course} index={index} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="spread" style={{ marginBottom: '0.6rem' }}>
        <p className="eyebrow">
          {sets === null ? t('nav.library') : t('library.sets', { n: wordSets.length })}
        </p>
        {canEdit && (
          <button type="button" className="btn btn--sm" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            {t('library.new')}
          </button>
        )}
      </div>

      {sets === null && <SkeletonList rows={4} />}

      {error && sets?.length === 0 && (
        <Empty icon="cloudOff" title={t('library.loadFailedTitle')}>
          {error}
        </Empty>
      )}

      {sets !== null && sets.length === 0 && courses.length === 0 && !error && (
        <Empty icon="book" title={t('library.emptyTitle')}>
          {canEdit ? t('library.emptyEditor') : t('library.emptyViewer')}
        </Empty>
      )}

      {sets !== null && everything > 0 && visible.length === 0 && visibleCourses.length === 0 && (
        <Empty icon="search" title={t('library.noMatchTitle')}>
          {t('library.noMatch', { query })}
        </Empty>
      )}

      <ul className="setlist">
        {wordSets.map((set, index) => (
          <li key={set.id}>
            <SetCard set={set} index={index} />
          </li>
        ))}
      </ul>

      {questionSets.length > 0 && (
        <section style={{ marginTop: '1.25rem' }}>
          <p className="eyebrow" style={{ marginBottom: '0.6rem' }}>
            {t('library.questionSets', { n: questionSets.length })}
          </p>
          <ul className="setlist">
            {questionSets.map((set, index) => (
              <li key={set.id}>
                <SetCard set={set} index={index} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!installed && sets !== null && sets.length > 0 && (
        <Link to="/install" className="panel row" style={{ marginTop: '1.25rem', padding: '0.8rem 0.875rem' }}>
          <Icon name="install" style={{ color: 'var(--accent)', flex: 'none' }} />
          <span className="small grow">
            <strong style={{ fontWeight: 620 }}>{t('library.installTitle')}</strong>
            <br />
            <span className="faint">{t('library.installBody')}</span>
          </span>
          <Icon name="chevronRight" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
        </Link>
      )}

      {creating && (
        <Sheet title={t('library.newTitle')} onClose={() => setCreating(false)}>
          <div className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
            {(
              [
                { to: '/new', icon: 'cards', title: t('kinds.words'), body: t('library.newWordsBody') },
                { to: '/new?kind=questions', icon: 'help', title: t('kinds.questions'), body: t('library.newQuestionsBody') },
                { to: '/new/course', icon: 'path', title: t('kinds.course'), body: t('library.newCourseBody') },
              ] as const
            ).map((option) => (
              <button
                key={option.to}
                type="button"
                className="choice"
                onClick={() => {
                  setCreating(false)
                  navigate(option.to)
                }}
              >
                <Icon name={option.icon} style={{ color: 'var(--accent)', flex: 'none' }} />
                <span className="grow">
                  <strong>{option.title}</strong>
                  <span className="tiny faint">{option.body}</span>
                </span>
                <Icon name="chevronRight" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </Shell>
  )
}
