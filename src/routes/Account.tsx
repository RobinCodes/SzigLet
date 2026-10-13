import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, outbox } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useI18n, LANGS, type Lang } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { haptics } from '../lib/haptics'
import { applyTheme, readTheme, type Theme } from '../lib/theme'
import { useIsInstalled } from '../lib/platform'
import { appUpdate } from '../lib/update'
import { initials } from '../lib/format'
import { Shell, TopBar } from '../components/Shell'
import { Segmented } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'

export function Account() {
  const { user, logout, isOwner, canEdit } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { t, tx, lang, setLang, relative } = useI18n()
  const installed = useIsInstalled()

  const [theme, setTheme] = useState<Theme>(() => readTheme())
  const [buzz, setBuzz] = useState(haptics.enabled)
  const [pending, setPending] = useState(outbox.pending)
  const [changing, setChanging] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)

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
      toast.success(t('account.passwordChanged'))
      setChanging(false)
      setCurrent('')
      setNext('')
    } catch (caught) {
      toast.error(errorText(t, caught, 'account.passwordFailed'))
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
    toast.success(sent > 0 ? t('account.synced', { n: sent }) : t('account.nothingWaiting'))
  }

  /** Looks for a newer build now rather than waiting for the next launch. */
  const checkForUpdate = async () => {
    setChecking(true)
    try {
      if (await appUpdate.check(true)) {
        appUpdate.apply()
        return
      }
      toast.success(t('update.upToDate'))
    } finally {
      setChecking(false)
    }
  }

  const roleLabel =
    user?.role === 'owner'
      ? t('account.roleOwner')
      : user?.role === 'editor'
        ? t('account.roleEditor')
        : t('account.roleLearner')

  return (
    <Shell>
      <TopBar title={t('account.title')} />

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
              <span className={`chip${isOwner ? ' chip--accent' : ''}`}>{roleLabel}</span>
              {user && (
                <span className="tiny faint">
                  {t('account.joined', { when: relative(user.createdAt) })}
                </span>
              )}
            </div>
          </div>
        </div>

        {!canEdit && (
          <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <Icon name="eye" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
            <p className="small grow">
              {tx('account.viewerNote', {
                editor: <strong>{t('account.roleEditor').toLowerCase()}</strong>,
              })}
            </p>
          </div>
        )}

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <p className="eyebrow">{t('account.language')}</p>
          <Segmented
            label={t('account.language')}
            value={lang}
            onChange={(value: Lang) => setLang(value)}
            options={LANGS.map((entry) => ({ value: entry.value, label: entry.label }))}
          />
          <p className="tiny faint">{t('account.languageHint')}</p>
        </section>

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <p className="eyebrow">{t('account.appearance')}</p>
          <Segmented
            label={t('account.theme')}
            value={theme}
            onChange={changeTheme}
            options={[
              { value: 'system', label: t('account.system') },
              { value: 'light', label: t('account.light') },
              { value: 'dark', label: t('account.dark') },
            ]}
          />
        </section>

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <p className="eyebrow">{t('account.study')}</p>
          <div className="panel spread">
            <div>
              <div style={{ fontWeight: 580 }}>{t('account.vibration')}</div>
              <div className="small muted">{t('account.vibrationBody')}</div>
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
              <span className="sr-only">{t('account.vibration')}</span>
            </label>
          </div>

          <button type="button" className="panel spread" onClick={sync} style={{ textAlign: 'left' }}>
            <div>
              <div style={{ fontWeight: 580 }}>{t('account.offlineChanges')}</div>
              <div className="small muted">
                {pending > 0 ? t('account.waiting', { n: pending }) : t('account.allSynced')}
              </div>
            </div>
            <Icon
              name={pending > 0 ? 'cloudOff' : 'check'}
              style={{ color: pending > 0 ? 'var(--rehearse)' : 'var(--known)', flex: 'none' }}
            />
          </button>
        </section>

        <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
          <p className="eyebrow">{t('account.app')}</p>

          {/*
            Install moves here once it has happened: a tab for something you
            can only do once is a tab wasted, and the guide is still worth
            keeping for a second device.
          */}
          {installed ? (
            <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
              <Icon name="check" style={{ color: 'var(--known)', flex: 'none' }} />
              <div className="grow">
                <div className="small" style={{ fontWeight: 580 }}>
                  {t('account.installed')}
                </div>
                <div className="tiny faint">{t('account.installedBody')}</div>
              </div>
            </div>
          ) : (
            <Link to="/install" className="btn btn--block">
              <Icon name="install" />
              {t('account.addToHome')}
            </Link>
          )}

          <button
            type="button"
            className="panel spread"
            onClick={checkForUpdate}
            style={{ textAlign: 'left' }}
            disabled={checking}
          >
            <div>
              <div style={{ fontWeight: 580 }}>
                {checking ? t('update.checking') : t('update.check')}
              </div>
              <div className="small muted">{t('update.autoNote')}</div>
            </div>
            {checking ? (
              <span className="spinner" />
            ) : (
              <Icon name="rotate" style={{ color: 'var(--accent)', flex: 'none' }} />
            )}
          </button>
        </section>

        <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
          <p className="eyebrow">{t('account.title')}</p>

          {isOwner && (
            <Link to="/admin" className="btn btn--block">
              <Icon name="shield" />
              {t('account.managePeople')}
            </Link>
          )}

          <button type="button" className="btn btn--block" onClick={() => setChanging(true)}>
            <Icon name="lock" />
            {t('account.changePassword')}
          </button>

          <button type="button" className="btn btn--block" onClick={signOut}>
            <Icon name="logout" />
            {t('account.signOut')}
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
            {t('account.signOutEverywhere')}
          </button>
        </section>

        <p className="tiny faint center">{t('account.footer')}</p>
      </div>

      {changing && (
        <Sheet
          title={t('account.changePassword')}
          onClose={() => setChanging(false)}
          footer={
            <button
              type="submit"
              form="change-password"
              className="btn btn--primary btn--block"
              disabled={busy}
            >
              {busy ? <span className="spinner" /> : <Icon name="check" />}
              {t('account.changeIt')}
            </button>
          }
        >
          <form
            id="change-password"
            onSubmit={submitPassword}
            className="stack"
            style={{ '--gap': '0.75rem' } as React.CSSProperties}
          >
            <div className="field">
              <label className="field__label" htmlFor="current">
                {t('account.currentPassword')}
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
                {t('account.newPassword')}
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
              <p className="field__hint">{t('account.passwordHint')}</p>
            </div>
          </form>
        </Sheet>
      )}
    </Shell>
  )
}
