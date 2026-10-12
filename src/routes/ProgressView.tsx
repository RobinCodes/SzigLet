import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { duration, percent, plural, relativeTime } from '../lib/format'
import type { Stats } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Empty, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'

/** Thirty days of activity as a simple density strip. */
function ActivityStrip({ activity }: { activity: Stats['activity'] }) {
  const today = Math.floor(Date.now() / 1000 / 86400)
  const byDay = new Map(activity.map((entry) => [entry.day, entry.runs]))
  const days = Array.from({ length: 30 }, (_, index) => today - 29 + index)
  const busiest = Math.max(1, ...activity.map((entry) => entry.runs))

  return (
    <div
      style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '2.5rem' }}
      aria-hidden="true"
    >
      {days.map((day) => {
        const runs = byDay.get(day) ?? 0
        const share = runs / busiest
        return (
          <div
            key={day}
            style={{
              flex: 1,
              height: runs === 0 ? '18%' : `${25 + share * 75}%`,
              borderRadius: '3px',
              background: runs === 0 ? 'var(--surface-3)' : 'var(--accent)',
              opacity: runs === 0 ? 1 : 0.45 + share * 0.55,
              transition: 'height var(--t-slow) var(--ease)',
            }}
          />
        )
      })}
    </div>
  )
}

export function ProgressView() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Could not load your progress.')
      })
  }, [])

  if (error) {
    return (
      <Shell>
        <TopBar title="Progress" />
        <Empty icon="cloudOff" title="Could not load your progress">
          {error}
        </Empty>
      </Shell>
    )
  }

  if (!stats) {
    return (
      <Shell>
        <TopBar title="Progress" />
        <Spinner />
      </Shell>
    )
  }

  const accuracy = percent(stats.correct, stats.answered)
  const nothingYet = stats.runs === 0 && stats.known === 0

  return (
    <Shell>
      <TopBar title="Progress" />

      {nothingYet ? (
        <Empty icon="sparkle" title="No sessions yet">
          Swipe through a set and take a test — your numbers will show up here.
        </Empty>
      ) : (
        <div className="stack enter" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
          <div
            className="panel row"
            style={{
              '--gap': '0.875rem',
              background:
                stats.streak > 0
                  ? 'linear-gradient(135deg, var(--accent-dim), var(--surface))'
                  : undefined,
              borderColor: stats.streak > 0 ? 'var(--accent-line)' : undefined,
            } as React.CSSProperties}
          >
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                width: '3rem',
                height: '3rem',
                flex: 'none',
                borderRadius: 'var(--r-full)',
                background: stats.streak > 0 ? 'var(--rehearse-dim)' : 'var(--surface-2)',
                color: stats.streak > 0 ? 'var(--rehearse)' : 'var(--ink-faint)',
              }}
            >
              <Icon name="flame" width={24} height={24} />
            </div>
            <div className="grow">
              <div style={{ fontSize: '1.5rem', fontWeight: 680, letterSpacing: '-0.03em' }}>
                {stats.streak === 0 ? 'No streak' : plural(stats.streak, 'day', 'days')}
              </div>
              <div className="small muted">
                {stats.streak === 0
                  ? 'Study today to start one.'
                  : stats.streak === 1
                    ? 'Come back tomorrow to keep it.'
                    : 'Keep it going.'}
              </div>
            </div>
          </div>

          <section className="statgrid">
            <div className="stat">
              <div className="stat__value" style={{ color: 'var(--known)' }}>
                {stats.known}
              </div>
              <div className="stat__label">Known</div>
            </div>
            <div className="stat">
              <div className="stat__value">{accuracy}%</div>
              <div className="stat__label">Accuracy</div>
            </div>
            <div className="stat">
              <div className="stat__value" style={{ fontSize: '1.1rem' }}>
                {duration(stats.studyMs)}
              </div>
              <div className="stat__label">Time</div>
            </div>
          </section>

          <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <div className="spread">
              <p className="eyebrow">Last 30 days</p>
              <span className="tiny faint">{plural(stats.runs, 'test', 'tests')}</span>
            </div>
            <div className="panel">
              <ActivityStrip activity={stats.activity} />
            </div>
          </section>

          {stats.recent.length > 0 && (
            <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
              <p className="eyebrow">Recent tests</p>
              <div className="panel panel--flush">
                {stats.recent.map((run, index) => {
                  const score = percent(run.correct, run.total)
                  return (
                    <Link
                      to={`/s/${run.slug}`}
                      className="cardrow"
                      key={`${run.at}-${index}`}
                      style={{ alignItems: 'center' }}
                    >
                      <span
                        className="chip"
                        style={{
                          background:
                            score >= 80
                              ? 'var(--known-dim)'
                              : score >= 50
                                ? 'var(--rehearse-dim)'
                                : 'var(--wrong-dim)',
                          color:
                            score >= 80
                              ? 'var(--known)'
                              : score >= 50
                                ? 'var(--rehearse)'
                                : 'var(--wrong)',
                          borderColor: 'transparent',
                          minWidth: '3rem',
                          justifyContent: 'center',
                        }}
                      >
                        {score}%
                      </span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="truncate" style={{ fontWeight: 560 }}>
                          {run.title}
                        </div>
                        <div className="tiny faint">
                          {run.mode === 'choice' ? 'Multiple choice' : 'Written'} ·{' '}
                          {run.correct}/{run.total} · {relativeTime(run.at)}
                        </div>
                      </div>
                      <Icon
                        name="chevronRight"
                        style={{ color: 'var(--ink-faint)', flex: 'none' }}
                      />
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {stats.rehearse > 0 && (
            <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
              <Icon name="rotate" style={{ color: 'var(--rehearse)', flex: 'none' }} />
              <p className="small grow">
                {plural(stats.rehearse, 'card', 'cards')} still marked for rehearsing across
                your sets.
              </p>
            </div>
          )}
        </div>
      )}
    </Shell>
  )
}
