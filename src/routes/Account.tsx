import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api, outbox } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { haptics } from '../lib/haptics'
import { applyTheme, readTheme, type Theme } from '../lib/theme'
import { initials, plural, relativeTime } from '../lib/format'
import { Shell, TopBar } from '../components/Shell'
import { Segmented } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'

export function Account() {
  const { user, logout, isOwner, canEdit } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [theme, setTheme] = useState<Theme>(() => readTheme())
  const [buzz, setBuzz] = useState(haptics.enabled)
  const [pending, setPending] = useState(outbox.pending)
  const [changing, setChanging] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setPending(outbox.pending), 4000)
    return () => window.clearInterval(timer)
  }, [])

  const changeTheme = (value: Theme) => {
    setTheme(value)
    applyTheme(value)
  }

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.changePassword(current, next)
      toast.success('Password changed. Other devices were signed out.')
      setChanging(false)
      setCurrent('')
      setNext('')
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Could not change it.')
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    await logout()
    navigate('/signin', { replace: true })
  }

  const sync = async () => {
    const sent = await outbox.flush()
    setPending(outbox.pending)
    toast.success(sent > 0 ? `Synced ${plural(sent, 'change', 'changes')}.` : 'Nothing waiting.')
  }

  return (
    <Shell>
      <TopBar title="Account" />

      <div className="stack enter" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
        <div className="row" style={{ '--gap': '0.875rem' } as React.CSSProperties}>
          <span
            className={`avatar${isOwner ? ' avatar--owner' : ''}`}
            style={{ width: '3.25rem', height: '3.25rem', fontSize: '1.1rem' }}
          >
            {initials(user?.username ?? '?')}
          </span>
          <div className="grow">
            <h1 style={{ fontSize: '1.35rem' }}>{user?.username}</h1>
            <div className="row" style={{ '--gap': '0.4rem', marginTop: '0.2rem' } as React.CSSProperties}>
              <span className={`chip${isOwner ? ' chip--accent' : ''}`}>
                {user?.role === 'owner' ? 'Owner' : user?.role === 'editor' ? 'Editor' : 'Learner'}
              </span>
              {user && (
                <span className="tiny faint">joined {relativeTime(user.createdAt)}</span>
              )}
            </div>
          </div>
        </div>

        {!canEdit && (
          <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <Icon name="eye" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
            <p className="small grow">
              You can study everything in the library. Ask the owner for{' '}
              <strong>editor</strong> rights if you need to add or change sets.
            </p>
          </div>
        )}

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <p className="eyebrow">Appearance</p>
          <Segmented
            label="Theme"
            value={theme}
            onChange={changeTheme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </section>

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <p className="eyebrow">Study</p>
          <div className="panel spread">
            <div>
              <div style={{ fontWeight: 580 }}>Vibration</div>
              <div className="small muted">A small buzz on every swipe and answer.</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={buzz}
                onChange={(event) => {
                  setBuzz(event.target.checked)
                  haptics.setEnabled(event.target.checked)
                  if (event.target.checked) {
                    haptics.known()
                  }
                }}
              />
              <span className="switch__track" />
              <span className="sr-only">Vibration</span>
            </label>
          </div>

          <button type="button" className="panel spread" onClick={sync} style={{ textAlign: 'left' }}>
            <div>
              <div style={{ fontWeight: 580 }}>Offline changes</div>
              <div className="small muted">
                {pending > 0
                  ? `${plural(pending, 'change', 'changes')} waiting to sync.`
                  : 'Everything is synced.'}
              </div>
            </div>
            <Icon
              name={pending > 0 ? 'cloudOff' : 'check'}
              style={{ color: pending > 0 ? 'var(--rehearse)' : 'var(--known)', flex: 'none' }}
            />
          </button>
        </section>

        <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
          <p className="eyebrow">Account</p>

          {isOwner && (
            <Link to="/admin" className="btn btn--block">
              <Icon name="shield" />
              Manage people
            </Link>
          )}

          <Link to="/install" className="btn btn--block">
            <Icon name="install" />
            Add to home screen
          </Link>

          <button type="button" className="btn btn--block" onClick={() => setChanging(true)}>
            <Icon name="lock" />
            Change password
          </button>

          <button type="button" className="btn btn--block" onClick={signOut}>
            <Icon name="logout" />
            Sign out
          </button>

          <button
            type="button"
            className="btn btn--ghost btn--block btn--sm"
            onClick={async () => {
              try {
                await api.logoutEverywhere()
              } finally {
                navigate('/signin', { replace: true })
              }
            }}
          >
            Sign out on every device
          </button>
        </section>

        <p className="tiny faint center">SzigLet · one shared library</p>
      </div>

      {changing && (
        <Sheet title="Change password" onClose={() => setChanging(false)}>
          <form onSubmit={submitPassword} className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
            <div className="field">
              <label className="field__label" htmlFor="current">
                Current password
              </label>
              <input
                id="current"
                className="input"
                type="password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="nextPassword">
                New password
              </label>
              <input
                id="nextPassword"
                className="input"
                type="password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <p className="field__hint">
                At least 8 characters. Every other device will be signed out.
              </p>
            </div>
            <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="check" />}
              Change it
            </button>
          </form>
        </Sheet>
      )}
    </Shell>
  )
}
