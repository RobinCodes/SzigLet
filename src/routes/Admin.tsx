import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { initials } from '../lib/format'
import type { AdminOverview, AdminUser, Role } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Empty, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'

export function Admin() {
  const { user } = useAuth()
  const toast = useToast()
  const { t, tx, relative } = useI18n()

  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<AdminUser | null>(null)
  const [promoting, setPromoting] = useState<AdminUser | null>(null)
  const [showLog, setShowLog] = useState(false)

  const roleLabel = useCallback(
    (role: Role) =>
      role === 'owner'
        ? t('account.roleOwner')
        : role === 'editor'
          ? t('account.roleEditor')
          : t('account.roleLearner'),
    [t],
  )

  const load = useCallback(() => {
    Promise.all([api.adminUsers(), api.adminOverview()])
      .then(([list, summary]) => {
        setUsers(list)
        setOverview(summary)
        setError(null)
      })
      .catch((caught: unknown) => {
        setError(errorText(t, caught, 'admin.loadFailed'))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(load, [load])

  const changeRole = async (target: AdminUser, role: Role) => {
    setPromoting(null)
    // Optimistic: the list snaps back if the server disagrees.
    setUsers((current) =>
      current?.map((item) => (item.id === target.id ? { ...item, role } : item)) ?? null,
    )
    try {
      await api.setRole(target.id, role)
      toast.success(
        t('admin.roleChanged', { name: target.username, role: roleLabel(role).toLowerCase() }),
      )
    } catch (caught) {
      toast.error(errorText(t, caught, 'admin.roleFailed'))
    } finally {
      load()
    }
  }

  const remove = async () => {
    if (!removing) {
      return
    }
    try {
      await api.deleteUser(removing.id)
      toast.success(t('admin.removed', { name: removing.username }))
      setRemoving(null)
      load()
    } catch (caught) {
      toast.error(errorText(t, caught, 'admin.removeFailed'))
    }
  }

  if (error) {
    return (
      <Shell>
        <TopBar title={t('admin.title')} back="/" />
        <Empty icon="alert" title={t('admin.unavailableTitle')}>
          {error}
        </Empty>
      </Shell>
    )
  }

  if (!users || !overview) {
    return (
      <Shell>
        <TopBar title={t('admin.title')} back="/" />
        <Spinner />
      </Shell>
    )
  }

  return (
    <Shell>
      <TopBar
        title={t('admin.title')}
        back="/"
        actions={
          <button
            type="button"
            className="icon-btn"
            aria-label={t('admin.activityLog')}
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
            <div className="stat__label">{t('admin.people')}</div>
          </div>
          <div className="stat">
            <div className="stat__value">{overview.sets}</div>
            <div className="stat__label">{t('admin.sets')}</div>
          </div>
          <div className="stat">
            <div className="stat__value">{overview.cards}</div>
            <div className="stat__label">{t('admin.cards')}</div>
          </div>
        </section>

        <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <Icon name="chart" style={{ color: 'var(--accent)', flex: 'none' }} />
          <p className="small grow">
            {t('admin.weekSummary', {
              people: t('admin.peopleCount', { n: overview.active7d }),
              tests: t('admin.testsCount', { n: overview.runs }),
            })}
          </p>
        </div>

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <div className="spread">
            <p className="eyebrow">{t('admin.people')}</p>
            <span className="tiny faint">
              {t('admin.editorsCount', { n: overview.editors })}
            </span>
          </div>

          <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <Icon name="shield" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
            <p className="small grow">
              {tx('admin.rolesNote', {
                editors: <strong>{t('account.roleEditor')}</strong>,
                owners: <strong>{t('account.roleOwner')}</strong>,
                learners: <strong>{t('account.roleLearner')}</strong>,
              })}
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
                      {isSelf && <span className="chip">{t('admin.youChip')}</span>}
                    </div>
                    <div className="tiny faint">
                      {person.lastSeenAt
                        ? t('admin.seen', { when: relative(person.lastSeenAt) })
                        : t('admin.neverSignedIn')}
                      {person.runs > 0 && ` · ${t('admin.testsCount', { n: person.runs })}`}
                    </div>
                  </div>

                  {isSelf ? (
                    <span className="chip chip--accent">{roleLabel(person.role)}</span>
                  ) : (
                    <>
                      {/*
                        Owner is a real option here. There was no way to hand
                        the keys to a second person before, which left one
                        account as a single point of failure for the whole
                        library.
                      */}
                      <select
                        className="select"
                        value={person.role}
                        aria-label={t('admin.roleFor', { name: person.username })}
                        onChange={(event) => {
                          const role = event.target.value as Role
                          if (role === 'owner') {
                            setPromoting(person)
                            return
                          }
                          void changeRole(person, role)
                        }}
                      >
                        <option value="viewer">{t('account.roleLearner')}</option>
                        <option value="editor">{t('account.roleEditor')}</option>
                        <option value="owner">{t('account.roleOwner')}</option>
                      </select>
                      {person.role !== 'owner' && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t('admin.remove', { name: person.username })}
                          onClick={() => setRemoving(person)}
                        >
                          <Icon name="trash" style={{ width: 17, height: 17 }} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {promoting && (
        <Sheet
          title={t('admin.promoteTitle', { name: promoting.username })}
          onClose={() => setPromoting(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => void changeRole(promoting, 'owner')}
              >
                <Icon name="shield" />
                {t('admin.promoteConfirm')}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setPromoting(null)}
              >
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <p className="muted small">{t('admin.promoteBody')}</p>
        </Sheet>
      )}

      {removing && (
        <Sheet
          title={t('admin.removeTitle', { name: removing.username })}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className="btn btn--danger btn--block" onClick={remove}>
                <Icon name="trash" />
                {t('admin.removeConfirm')}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setRemoving(null)}
              >
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <p className="muted small">{t('admin.removeBody')}</p>
        </Sheet>
      )}

      {showLog && (
        <Sheet title={t('admin.recentActivity')} onClose={() => setShowLog(false)}>
          {overview.audit.length === 0 ? (
            <p className="muted small">{t('admin.nothingLogged')}</p>
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
                  {entry.by ?? t('admin.system')} · {relative(entry.at)}
                </span>
              </div>
            ))
          )}
        </Sheet>
      )}
    </Shell>
  )
}
