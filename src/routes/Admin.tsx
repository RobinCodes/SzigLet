import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { initials, plural, relativeTime } from '../lib/format'
import type { AdminOverview, AdminUser, Role } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Empty, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'

const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Learner',
  editor: 'Editor',
  owner: 'Owner',
}

export function Admin() {
  const { user } = useAuth()
  const toast = useToast()

  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<AdminUser | null>(null)
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(() => {
    Promise.all([api.adminUsers(), api.adminOverview()])
      .then(([list, summary]) => {
        setUsers(list)
        setOverview(summary)
        setError(null)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Could not load the admin page.')
      })
  }, [])

  useEffect(load, [load])

  const changeRole = async (target: AdminUser, role: Role) => {
    // Optimistic: the list snaps back if the server disagrees.
    setUsers((current) =>
      current?.map((item) => (item.id === target.id ? { ...item, role } : item)) ?? null,
    )
    try {
      await api.setRole(target.id, role)
      toast.success(`${target.username} is now ${ROLE_LABEL[role].toLowerCase()}.`)
      load()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Could not change the role.')
      load()
    }
  }

  const remove = async () => {
    if (!removing) {
      return
    }
    try {
      await api.deleteUser(removing.id)
      toast.success(`${removing.username} removed.`)
      setRemoving(null)
      load()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Could not remove the account.')
    }
  }

  if (error) {
    return (
      <Shell>
        <TopBar title="Admin" back="/" />
        <Empty icon="alert" title="Admin unavailable">
          {error}
        </Empty>
      </Shell>
    )
  }

  if (!users || !overview) {
    return (
      <Shell>
        <TopBar title="Admin" back="/" />
        <Spinner />
      </Shell>
    )
  }

  return (
    <Shell>
      <TopBar
        title="Admin"
        back="/"
        actions={
          <button
            type="button"
            className="icon-btn"
            aria-label="Activity log"
            onClick={() => setShowLog(true)}
          >
            <Icon name="list" />
          </button>
        }
      />

      <div className="stack enter" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
        <section className="statgrid">
          <div className="stat">
            <div className="stat__value">{overview.users}</div>
            <div className="stat__label">People</div>
          </div>
          <div className="stat">
            <div className="stat__value">{overview.sets}</div>
            <div className="stat__label">Sets</div>
          </div>
          <div className="stat">
            <div className="stat__value">{overview.cards}</div>
            <div className="stat__label">Cards</div>
          </div>
        </section>

        <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <Icon name="chart" style={{ color: 'var(--accent)', flex: 'none' }} />
          <p className="small grow">
            {plural(overview.active7d, 'person', 'people')} studied in the last week ·{' '}
            {plural(overview.runs, 'test', 'tests')} taken all together.
          </p>
        </div>

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <div className="spread">
            <p className="eyebrow">People</p>
            <span className="tiny faint">
              {plural(overview.editors, 'editor', 'editors')}
            </span>
          </div>

          <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <Icon name="shield" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
            <p className="small grow">
              <strong>Editors</strong> can create and change sets for everyone.{' '}
              <strong>Learners</strong> can only study. There is no way back from deleting an
              account.
            </p>
          </div>

          <div className="panel panel--flush">
            {users.map((person) => {
              const isSelf = person.id === user?.id
              return (
                <div className="userrow" key={person.id}>
                  <span className={`avatar${person.role === 'owner' ? ' avatar--owner' : ''}`}>
                    {initials(person.username)}
                  </span>

                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ '--gap': '0.35rem' } as React.CSSProperties}>
                      <span className="truncate" style={{ fontWeight: 580 }}>
                        {person.username}
                      </span>
                      {isSelf && <span className="chip">you</span>}
                    </div>
                    <div className="tiny faint">
                      {person.lastSeenAt
                        ? `seen ${relativeTime(person.lastSeenAt)}`
                        : 'never signed in'}
                      {person.runs > 0 && ` · ${plural(person.runs, 'test', 'tests')}`}
                    </div>
                  </div>

                  {isSelf || person.role === 'owner' ? (
                    <span className="chip chip--accent">{ROLE_LABEL[person.role]}</span>
                  ) : (
                    <>
                      <select
                        className="select"
                        value={person.role}
                        aria-label={`Role for ${person.username}`}
                        onChange={(event) => changeRole(person, event.target.value as Role)}
                      >
                        <option value="viewer">Learner</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove ${person.username}`}
                        onClick={() => setRemoving(person)}
                      >
                        <Icon name="trash" style={{ width: 17, height: 17 }} />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {removing && (
        <Sheet title={`Remove ${removing.username}?`} onClose={() => setRemoving(null)}>
          <p className="muted small" style={{ marginBottom: '1rem' }}>
            Their account, progress and test history are deleted. The shared sets are not
            affected. This cannot be undone.
          </p>
          <div className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
            <button type="button" className="btn btn--danger btn--block" onClick={remove}>
              <Icon name="trash" />
              Remove the account
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => setRemoving(null)}
            >
              Cancel
            </button>
          </div>
        </Sheet>
      )}

      {showLog && (
        <Sheet title="Recent activity" onClose={() => setShowLog(false)}>
          <div style={{ maxHeight: '55vh', overflowY: 'auto', margin: '0 -0.25rem' }}>
            {overview.audit.length === 0 ? (
              <p className="muted small">Nothing logged yet.</p>
            ) : (
              overview.audit.map((entry, index) => (
                <div
                  className="row"
                  key={index}
                  style={{
                    '--gap': '0.5rem',
                    padding: '0.5rem 0.25rem',
                    borderBottom: '1px solid var(--line)',
                  } as React.CSSProperties}
                >
                  <span className="chip">{entry.action.replace(/_/g, ' ')}</span>
                  <span className="grow small truncate">{entry.detail || '—'}</span>
                  <span className="tiny faint" style={{ flex: 'none' }}>
                    {entry.by ?? 'system'} · {relativeTime(entry.at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Sheet>
      )}
    </Shell>
  )
}
