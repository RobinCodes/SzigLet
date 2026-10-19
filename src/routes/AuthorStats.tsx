import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { percent } from '../lib/format'
import type { CourseStats, SetStats } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Empty, Spinner } from '../components/Bits'

/** A share as a bar, for comparing rows at a glance. */
function Meter({ value, total, tone }: { value: number; total: number; tone?: 'wrong' }) {
  const width = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <span className="meter" aria-hidden="true">
      <span className={`meter__fill${tone ? ` meter__fill--${tone}` : ''}`} style={{ width: `${width}%` }} />
    </span>
  )
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  )
}

/**
 * How a set or course is used, for its authors. Everything here is counted
 * across learners; nobody is named.
 */
export function AuthorStats({ kind }: { kind: 'set' | 'course' }) {
  const { slug = '' } = useParams()
  const { t } = useI18n()
  const [setStats, setSetStats] = useState<SetStats | null>(null)
  const [courseStats, setCourseStats] = useState<CourseStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        if (kind === 'set') {
          const set = await api.set(slug)
          const stats = await api.setStats(set.id)
          if (!cancelled) setSetStats(stats)
        } else {
          const course = await api.course(slug)
          const stats = await api.courseStats(course.id)
          if (!cancelled) setCourseStats(stats)
        }
      } catch (caught) {
        if (!cancelled) setError(errorText(t, caught, 'stats.loadFailed'))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, slug])

  const back = kind === 'set' ? `/s/${slug}` : `/c/${slug}`

  if (error) {
    return (
      <Shell>
        <TopBar back={back} title={t('stats.title')} />
        <Empty icon="chart" title={t('stats.unavailable')}>
          {error}
        </Empty>
      </Shell>
    )
  }

  if (setStats) {
    const s = setStats
    const accuracy = percent(s.tests.correct, s.tests.answered)
    return (
      <Shell>
        <TopBar back={back} title={t('stats.title')} />
        <div className="stack" style={{ '--gap': '1.25rem' } as React.CSSProperties}>
          <div>
            <h1 className="sethead__title">{s.title}</h1>
            <p className="tiny faint">{t('stats.anonymous')}</p>
          </div>
          <div className="statgrid">
            <Stat value={s.learners} label={t('stats.learners')} />
            {s.kind === 'words' ? (
              <Stat value={s.cleared} label={t('stats.cleared')} />
            ) : (
              <Stat value={s.questions.reduce((sum, q) => sum + q.right + q.wrong, 0)} label={t('stats.answers')} />
            )}
            <Stat value={s.openFlags} label={t('stats.openFlags')} />
          </div>

          {s.kind === 'words' && (
            <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
              <p className="eyebrow">{t('stats.tests')}</p>
              <div className="statgrid">
                <Stat value={s.tests.runs} label={t('stats.testsTaken')} />
                <Stat value={s.tests.people} label={t('stats.testTakers')} />
                <Stat value={s.tests.answered > 0 ? `${accuracy}%` : '—'} label={t('stats.firstTry')} />
              </div>
            </section>
          )}

          {s.hardest.length > 0 && (
            <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
              <p className="eyebrow">{t('stats.hardest')}</p>
              <div className="panel panel--flush">
                {s.hardest.map((card) => (
                  <div key={card.id} className="cardrow">
                    <span className="cardrow__a truncate">{card.a}</span>
                    <span className="cardrow__b truncate">{card.b}</span>
                    <Meter value={card.wrong} total={card.right + card.wrong} tone="wrong" />
                    <span className="tiny faint num">{percent(card.wrong, card.right + card.wrong)}%</span>
                  </div>
                ))}
              </div>
              <p className="tiny faint">{t('stats.hardestHint')}</p>
            </section>
          )}

          {s.questions.length > 0 && (
            <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
              <p className="eyebrow">{t('stats.byQuestion')}</p>
              <div className="panel panel--flush">
                {s.questions.map((q) => (
                  <div key={q.id} className="cardrow">
                    <span className="grow truncate small">{q.body}</span>
                    <span className="tiny faint">{t('stats.people', { n: q.people })}</span>
                    <Meter value={q.right} total={q.right + q.wrong} />
                    <span className="tiny faint num">
                      {q.right + q.wrong > 0 ? `${percent(q.right, q.right + q.wrong)}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </Shell>
    )
  }

  if (courseStats) {
    const c = courseStats
    const busiest = Math.max(1, ...c.nodes.map((node) => node.people))
    const top = [...c.nodes].sort((x, y) => y.lessons - x.lessons)[0]
    return (
      <Shell>
        <TopBar back={back} title={t('stats.title')} />
        <div className="stack" style={{ '--gap': '1.25rem' } as React.CSSProperties}>
          <div>
            <h1 className="sethead__title">{c.title}</h1>
            <p className="tiny faint">{t('stats.anonymous')}</p>
          </div>
          <div className="statgrid">
            <Stat value={c.learners} label={t('stats.learners')} />
            <Stat value={c.nodes.reduce((sum, node) => sum + node.lessons, 0)} label={t('stats.lessons')} />
            <Stat value={top && top.lessons > 0 ? top.title : '—'} label={t('stats.popular')} />
          </div>
          <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
            <p className="eyebrow">{t('stats.byNode')}</p>
            <div className="panel panel--flush">
              {c.nodes.map((node) => (
                <div key={node.id} className="cardrow statrow">
                  <span className="grow truncate" style={{ fontWeight: 560 }}>
                    {node.title}
                  </span>
                  <Meter value={node.people} total={busiest} />
                  <span className="tiny faint statrow__nums">
                    {t('stats.nodeLine', {
                      people: node.people,
                      done: node.completed,
                      accuracy: node.answered > 0 ? `${percent(node.correct, node.answered)}%` : '—',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <TopBar back={back} title={t('stats.title')} />
      <Spinner />
    </Shell>
  )
}
