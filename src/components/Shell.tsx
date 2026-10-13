import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { useIsInstalled } from '../lib/platform'
import { Icon, type IconName } from './Icon'

type TabDefinition = { to: string; label: string; icon: IconName }

export function TabBar() {
  const { isOwner } = useAuth()
  const { t } = useI18n()
  const installed = useIsInstalled()

  // Install earns a tab only until it has been done. Afterwards the guide is
  // still reachable from Account, where it belongs once it is a one-off.
  const tabs: TabDefinition[] = [
    { to: '/', label: t('nav.library'), icon: 'library' },
    { to: '/progress', label: t('nav.progress'), icon: 'chart' },
    ...(installed
      ? []
      : [{ to: '/install', label: t('nav.install'), icon: 'install' as IconName }]),
    ...(isOwner ? [{ to: '/admin', label: t('nav.admin'), icon: 'shield' as IconName }] : []),
    { to: '/account', label: t('nav.account'), icon: 'user' },
  ]

  return (
    <nav className="tabbar" aria-label={t('nav.main')}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} className="tab" end={tab.to === '/'}>
          <Icon name={tab.icon} />
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

type TopBarProps = {
  title?: string
  back?: string | (() => void)
  actions?: ReactNode
}

export function TopBar({ title, back, actions }: TopBarProps) {
  const navigate = useNavigate()
  const { t } = useI18n()

  return (
    <header className="topbar">
      {back !== undefined && (
        <button
          type="button"
          className="icon-btn"
          aria-label={t('common.back')}
          onClick={() => (typeof back === 'function' ? back() : navigate(back))}
        >
          <Icon name="chevronLeft" />
        </button>
      )}
      <span className="topbar__title grow truncate">{title}</span>
      {actions}
    </header>
  )
}

type ShellProps = {
  children: ReactNode
  /** Study screens fill the viewport and hide the tab bar. */
  immersive?: boolean
  tabs?: boolean
}

export function Shell({ children, immersive = false, tabs = true }: ShellProps) {
  return (
    <div className={`shell${immersive ? ' shell--immersive' : ''}`}>
      <main className="shell__main">{children}</main>
      {tabs && !immersive && <TabBar />}
    </div>
  )
}
