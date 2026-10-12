import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/** Circular progress, used for per-set completion. */
export function Ring({
  value,
  total,
  size = 44,
  tone = 'accent',
  label,
}: {
  value: number
  total: number
  size?: number
  tone?: 'accent' | 'known'
  label?: string
}) {
  const stroke = size >= 60 ? 5 : 4
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const fraction = total > 0 ? Math.min(1, value / total) : 0

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle
          className="ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className={`ring__value${tone === 'known' ? ' ring__value--known' : ''}`}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      <span className="ring__label">{label ?? `${Math.round(fraction * 100)}`}</span>
    </div>
  )
}

/** A horizontal bar split into known / rehearsing / untouched. */
export function SplitBar({
  known,
  rehearse,
  total,
}: {
  known: number
  rehearse: number
  total: number
}) {
  const rest = Math.max(0, total - known - rehearse)
  return (
    <div className="bar--split bar" aria-hidden="true">
      {known > 0 && <span style={{ flexGrow: known, background: 'var(--known)' }} />}
      {rehearse > 0 && <span style={{ flexGrow: rehearse, background: 'var(--rehearse)' }} />}
      {rest > 0 && <span style={{ flexGrow: rest, background: 'var(--surface-3)' }} />}
    </div>
  )
}

export function Bar({ value, total, tone }: { value: number; total: number; tone?: 'known' }) {
  const percentage = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div
      className="bar"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div
        className={`bar__fill${tone === 'known' ? ' bar__fill--known' : ''}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  )
}

/** Segmented control. The thumb slides, which makes the state obvious. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  label: string
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  const width = 100 / options.length

  return (
    <div className="segmented" role="tablist" aria-label={label}>
      <div
        className="segmented__thumb"
        style={{
          width: `calc(${width}% - 0.3rem)`,
          transform: `translateX(calc(${index * 100}% + ${index * 0.2}rem))`,
          left: '0.25rem',
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          className="segmented__option"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({
  icon = 'inbox',
  title,
  children,
}: {
  icon?: IconName
  title: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h3>{title}</h3>
      {children && <p className="small">{children}</p>}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row center" style={{ justifyContent: 'center', padding: '2.5rem 0' }}>
      <span className="spinner" />
      {label && <span className="muted small">{label}</span>}
    </div>
  )
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ height: '4.75rem' }} />
      ))}
    </div>
  )
}
