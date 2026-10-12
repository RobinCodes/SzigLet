import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api, outbox } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fold } from '../lib/text'
import { greeting, plural } from '../lib/format'
import type { SetSummary } from '../lib/types'
import { Shell } from '../components/Shell'
import { Empty, Ring, SkeletonList } from '../components/Bits'
import { Icon } from '../components/Icon'
import { isInstalled } from '../lib/platform'

export function Library() {
  const { user, canEdit } = useAuth()
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
          setError(caught instanceof ApiError ? caught.message : 'Could not load the library.')
          setSets([])
        }
      })
    setPending(outbox.pending)
    return () => {
      cancelled = true
    }
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
          <span className="small grow">
            {plural(pending, 'change', 'changes')} saved on this device, waiting for a connection.
          </span>
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
              placeholder="Search sets"
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
          {sets === null ? 'Library' : plural(sets.length, 'set', 'sets')}
        </p>
        {canEdit && (
          <Link to="/new" className="btn btn--sm">
            <Icon name="plus" />
            New set
          </Link>
        )}
      </div>

      {sets === null && <SkeletonList rows={4} />}

      {error && sets?.length === 0 && (
        <Empty icon="cloudOff" title="Could not load the library">
          {error}
        </Empty>
      )}

      {sets !== null && sets.length === 0 && !error && (
        <Empty icon="book" title="The library is empty">
          {canEdit
            ? 'Add the first set and everybody will see it here.'
            : 'Nothing has been added yet. Check back soon.'}
        </Empty>
      )}

      {sets !== null && sets.length > 0 && visible.length === 0 && (
        <Empty icon="search" title="No match">
          Nothing matches “{query}”.
        </Empty>
      )}

      <ul className="setlist">
        {visible.map((set, index) => {
          const mastered = set.known.ab + set.known.ba
          const possible = set.cardCount * 2
          return (
            <li key={set.id}>
              <Link
                to={`/s/${set.slug}`}
                className="setcard"
                style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
              >
                <Ring
                  value={mastered}
                  total={possible}
                  tone={mastered === possible && possible > 0 ? 'known' : 'accent'}
                />
                <div className="setcard__body">
                  <div className="row" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
                    <span className="setcard__title truncate">{set.title}</span>
                    {!set.published && <span className="chip">Draft</span>}
                  </div>
                  <div className="setcard__meta">
                    <span className="setcard__pair">
                      {set.langA}
                      <Icon name="swap" />
                      {set.langB}
                    </span>
                    <span>·</span>
                    <span>{plural(set.cardCount, 'card', 'cards')}</span>
                  </div>
                </div>
                <Icon name="chevronRight" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
              </Link>
            </li>
          )
        })}
      </ul>

      {!isInstalled() && sets !== null && sets.length > 0 && (
        <Link
          to="/install"
          className="panel row"
          style={{ marginTop: '1.25rem', padding: '0.8rem 0.875rem' }}
        >
          <Icon name="install" style={{ color: 'var(--accent)', flex: 'none' }} />
          <span className="small grow">
            <strong style={{ fontWeight: 620 }}>Install SzigLet</strong>
            <br />
            <span className="faint">Opens like an app, works offline.</span>
          </span>
          <Icon name="chevronRight" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
        </Link>
      )}
    </Shell>
  )
}
