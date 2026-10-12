import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Icon, type IconName } from './Icon'

type TabDefinition = { to: string; label: string; icon: IconName }

const TABS: TabDefinition[] = [
  { to: '/', label: 'Library', icon: 'library' },
  { to: '/progress', label: 'Progress', icon: 'chart' },
  { to: '/install', label: 'Install', icon: 'install' },
  { to: '/account', label: 'Account', icon: 'user' },
]

export function TabBar() {
  const { isOwner } = useAuth()
  const tabs = isOwner
    ? [...TABS.slice(0, 3), { to: '/admin', label: 'Admin', icon: 'shield' as IconName }, TABS[3]!]
    : TABS

  return (
    <nav className="tabbar" aria-label="Main">
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

  return (
    <header className="topbar">
      {back !== undefined && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Back"
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
