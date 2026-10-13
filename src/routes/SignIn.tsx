import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { Icon, Logo } from '../components/Icon'
import { Bar, Segmented } from '../components/Bits'

type Mode = 'signin' | 'register'

export function SignIn() {
  const { user, loading, registrationOpen, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()

  const [mode, setMode] = useState<Mode>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(0)
  const [error, setError] = useState<string | null>(null)

  /** Honeypot: a field no human ever sees, let alone fills in. */
  const [trap, setTrap] = useState('')
  /** When the form appeared, so the server can reject instant submissions. */
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    mountedAt.current = Date.now()
    setError(null)
  }, [mode])

  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== '/signin' ? from : '/'} replace />
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) {
      return
    }
    setError(null)

    if (mode === 'register' && password !== confirm) {
      setError(t('signin.mismatch'))
      return
    }

    setBusy(true)
    setVerifying(0.02)

    const credentials = {
      username: username.trim(),
      password,
      elapsedMs: Date.now() - mountedAt.current,
      website: trap,
    }

    try {
      const action = mode === 'signin' ? login : register
      await action(credentials, setVerifying)
      navigate('/', { replace: true })
    } catch (caught) {
      // A proof-of-work failure arrives as a plain Error, not an ApiError.
      setError(
        caught instanceof Error && !(caught instanceof ApiError)
          ? caught.message
          : errorText(t, caught, 'errors.generic'),
      )
      // A fresh challenge is needed for the next attempt anyway.
      mountedAt.current = Date.now() - 2000
    } finally {
      setBusy(false)
      setVerifying(0)
    }
  }

  return (
    <div className="shell">
      <main
        className="shell__main"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minHeight: '100dvh',
          paddingBottom: 'calc(var(--safe-bottom) + 2rem)',
        }}
      >
        <div className="enter" style={{ display: 'grid', gap: '1.5rem' }}>
          <div className="center stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <div
              style={{ color: 'var(--accent)', display: 'grid', placeItems: 'center' }}
              aria-hidden="true"
            >
              <Logo size={44} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.9rem', letterSpacing: '-0.04em' }}>SzigLet</h1>
              <p className="muted small" style={{ marginTop: '0.2rem' }}>
                {t('signin.tagline')}
              </p>
            </div>
          </div>

          {registrationOpen && (
            <Segmented
              label={t('signin.modeLabel')}
              value={mode}
              onChange={(next) => setMode(next)}
              options={[
                { value: 'signin', label: t('signin.signin') },
                { value: 'register', label: t('signin.createAccount') },
              ]}
            />
          )}

          <form onSubmit={submit} className="stack" style={{ '--gap': '0.875rem' } as React.CSSProperties}>
            <div className="field">
              <label className="field__label" htmlFor="username">
                {t('signin.name')}
              </label>
              <input
                id="username"
                className="input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                required
                minLength={3}
                maxLength={24}
                placeholder={t('signin.namePlaceholder')}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="password">
                {t('signin.password')}
              </label>
              <input
                id="password"
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                maxLength={200}
                enterKeyHint={mode === 'signin' ? 'go' : 'next'}
                placeholder={mode === 'register' ? t('signin.passwordPlaceholder') : ''}
              />
              {mode === 'register' && (
                <p className="field__hint">{t('signin.noReset')}</p>
              )}
            </div>

            {mode === 'register' && (
              <div className="field">
                <label className="field__label" htmlFor="confirm">
                  {t('signin.passwordAgain')}
                </label>
                <input
                  id="confirm"
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  required
                  enterKeyHint="go"
                />
              </div>
            )}

            {/* Bots fill this in; people never see it. */}
            <div className="trap" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                id="website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={trap}
                onChange={(event) => setTrap(event.target.value)}
              />
            </div>

            {error && (
              <p className="field__error row" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
                <Icon name="alert" width={16} height={16} />
                <span>{error}</span>
              </p>
            )}

            <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner" />
                  <span>{t('signin.verifying')}</span>
                </>
              ) : (
                <>
                  <span>{mode === 'signin' ? t('signin.signin') : t('signin.createAccount')}</span>
                  <Icon name="arrowRight" />
                </>
              )}
            </button>

            {busy && (
              <div className="stack" style={{ '--gap': '0.35rem' } as React.CSSProperties}>
                <Bar value={verifying * 100} total={100} />
                <p className="tiny faint center">{t('signin.powHint')}</p>
              </div>
            )}
          </form>

          {!registrationOpen && mode === 'signin' && (
            <p className="tiny faint center">{t('signin.closed')}</p>
          )}

          <p className="tiny faint center">
            {t('signin.onPhone')}{' '}
            <a href="/install" style={{ color: 'var(--accent-soft)', fontWeight: 600 }}>
              {t('signin.addToHome')}
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
