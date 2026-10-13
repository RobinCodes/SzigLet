import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { percent } from '../lib/format'
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
  const { t, relative, duration } = useI18n()
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch((caught: unknown) => {
        setError(errorText(t, caught, 'progress.loadFailed'))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <Shell>
        <TopBar title={t('progress.title')} />
        <Empty icon="cloudOff" title={t('progress.loadFailedTitle')}>
          {error}
        </Empty>
      </Shell>
    )
  }

  if (!stats) {
    return (
      <Shell>
        <TopBar title={t('progress.title')} />
        <Spinner />
      </Shell>
    )
  }

  const tested = stats.answered > 0
  const accuracy = percent(stats.correct, stats.answered)
  const nothingYet = stats.sessions === 0 && stats.known === 0
  const running = stats.weekStreak > 0

  return (
    <Shell>
      <TopBar title={t('progress.title')} />

      {nothingYet ? (
        <Empty icon="sparkle" title={t('progress.nothingTitle')}>
          {t('progress.nothingBody')}
        </Empty>
      ) : (
        <div className="stack enter" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
          {/*
            Weeks, not days. A day streak turns one busy Tuesday into the loss
            of months of work, which made it something to defend rather than a
            description of how anybody actually learns vocabulary. The day
            count is still here, as a detail for whoever is on a run.
          */}
          <div
            className="panel row"
            style={{
              '--gap': '0.875rem',
              background: running
                ? 'linear-gradient(135deg, var(--accent-dim), var(--surface))'
                : undefined,
              borderColor: running ? 'var(--accent-line)' : undefined,
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
                background: running ? 'var(--rehearse-dim)' : 'var(--surface-2)',
                color: running ? 'var(--rehearse)' : 'var(--ink-faint)',
              }}
            >
              <Icon name="flame" width={24} height={24} />
            </div>
            <div className="grow">
              <div style={{ fontSize: '1.5rem', fontWeight: 680, letterSpacing: '-0.03em' }}>
                {running ? t('progress.weeks', { n: stats.weekStreak }) : t('progress.noRhythm')}
              </div>
              <div className="small muted">
                {running ? t('progress.weeksBody') : t('progress.noRhythmBody')}
              </div>
              {stats.activeDays30 > 0 && (
                <div className="tiny faint" style={{ marginTop: '0.2rem' }}>
                  {t('progress.daysStudied', { n: stats.activeDays30 })}
                  {stats.streak > 1 && ` · ${t('progress.dayStreak', { n: stats.streak })}`}
                </div>
              )}
            </div>
          </div>

          <section className="statgrid">
            <div className="stat">
              <div className="stat__value" style={{ color: 'var(--known)' }}>
                {stats.known}
              </div>
              <div className="stat__label">{t('progress.known')}</div>
            </div>
            <div className="stat">
              <div
                className="stat__value"
                style={tested ? undefined : { color: 'var(--ink-faint)' }}
              >
                {tested ? `${accuracy}%` : '—'}
              </div>
              <div className="stat__label">{t('progress.accuracy')}</div>
            </div>
            <div className="stat">
              <div className="stat__value" style={{ fontSize: '1.1rem' }}>
                {duration(stats.studyMs)}
              </div>
              <div className="stat__label">{t('progress.time')}</div>
            </div>
          </section>

          {!tested && <p className="tiny faint center">{t('progress.noTestsYet')}</p>}

          <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <div className="spread">
              <p className="eyebrow">{t('progress.last30')}</p>
              <span className="tiny faint">{t('progress.sessions', { n: stats.sessions })}</span>
            </div>
            <div className="panel">
              <ActivityStrip activity={stats.activity} />
            </div>
          </section>

          {stats.recent.length > 0 && (
            <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
              <p className="eyebrow">{t('progress.recentTests')}</p>
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
                          {run.mode === 'choice'
                            ? t('progress.modeChoice')
                            : run.mode === 'write'
                              ? t('progress.modeWrite')
                              : t('progress.modeFlashcards')}{' '}
                          · {run.correct}/{run.total} · {relative(run.at)}
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
              <p className="small grow">{t('progress.rehearseNote', { n: stats.rehearse })}</p>
            </div>
          )}
        </div>
      )}
    </Shell>
  )
}
