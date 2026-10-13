import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, outbox } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { fold } from '../lib/text'
import type { SetSummary } from '../lib/types'
import { mastery, masteryPercent } from '../lib/word'
import { Shell } from '../components/Shell'
import { DualRing, Empty, SkeletonList } from '../components/Bits'
import { Icon } from '../components/Icon'
import { useIsInstalled } from '../lib/platform'

export function Library() {
  const { user, canEdit } = useAuth()
  const { t, greeting } = useI18n()
  const installed = useIsInstalled()

  const [sets, setSets] = useState<SetSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(0)

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
    setPending(outbox.pending)
    return () => {
      cancelled = true
    }
    // The translator is stable per language; reloading the library on a
    // language change would be pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = useMemo(() => {
    if (!sets) {
      return []
    }
    const needle = fold(query)
    if (!needle) {
      return sets
    }
    return sets.filter(
      (set) =>
        fold(set.title).includes(needle) ||
        fold(set.description ?? '').includes(needle) ||
        fold(`${set.langA} ${set.langB}`).includes(needle),
    )
  }, [sets, query])

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

      {sets !== null && sets.length > 3 && (
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

      <div className="spread" style={{ marginBottom: '0.6rem' }}>
        <p className="eyebrow">
          {sets === null ? t('nav.library') : t('library.sets', { n: sets.length })}
        </p>
        {canEdit && (
          <Link to="/new" className="btn btn--sm">
            <Icon name="plus" />
            {t('library.newSet')}
          </Link>
        )}
      </div>

      {sets === null && <SkeletonList rows={4} />}

      {error && sets?.length === 0 && (
        <Empty icon="cloudOff" title={t('library.loadFailedTitle')}>
          {error}
        </Empty>
      )}

      {sets !== null && sets.length === 0 && !error && (
        <Empty icon="book" title={t('library.emptyTitle')}>
          {canEdit ? t('library.emptyEditor') : t('library.emptyViewer')}
        </Empty>
      )}

      {sets !== null && sets.length > 0 && visible.length === 0 && (
        <Empty icon="search" title={t('library.noMatchTitle')}>
          {t('library.noMatch', { query })}
        </Empty>
      )}

      <ul className="setlist">
        {visible.map((set, index) => {
          // Two measures rather than one average: a set can be solid one way
          // round and barely started the other, and that is the thing worth
          // knowing before tapping into it.
          const ab = masteryPercent(set.known.ab, set.cardCount, set.tests?.ab)
          const ba = masteryPercent(set.known.ba, set.cardCount, set.tests?.ba)
          return (
            <li key={set.id}>
              <Link
                to={`/s/${set.slug}`}
                className="setcard"
                style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
              >
                <DualRing
                  outer={mastery(set.known.ab, set.cardCount, set.tests?.ab)}
                  inner={mastery(set.known.ba, set.cardCount, set.tests?.ba)}
                  label={`${t('mastery.ariaRing', {
                    from: set.langA,
                    to: set.langB,
                    percent: ab,
                  })}. ${t('mastery.ariaRing', {
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
            </li>
          )
        })}
      </ul>

      {!installed && sets !== null && sets.length > 0 && (
        <Link
          to="/install"
          className="panel row"
          style={{ marginTop: '1.25rem', padding: '0.8rem 0.875rem' }}
        >
          <Icon name="install" style={{ color: 'var(--accent)', flex: 'none' }} />
          <span className="small grow">
            <strong style={{ fontWeight: 620 }}>{t('library.installTitle')}</strong>
            <br />
            <span className="faint">{t('library.installBody')}</span>
          </span>
          <Icon name="chevronRight" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
        </Link>
      )}
    </Shell>
  )
}
