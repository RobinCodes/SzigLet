import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * Two concentric arcs, one per study direction.
 *
 * One number averaged over both directions was hiding the thing worth seeing:
 * which way round a set still needs work. Italian→Hungarian is the outer ring.
 */
export function DualRing({
  outer,
  inner,
  size = 46,
  label,
}: {
  /** 0 to 1. */
  outer: number
  inner: number
  size?: number
  label: string
}) {
  const stroke = 4
  const outerRadius = (size - stroke) / 2
  const innerRadius = outerRadius - stroke - 2

  const arc = (radius: number, fraction: number, className: string) => {
    const circumference = 2 * Math.PI * radius
    return (
      <>
        <circle
          className="ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className={className}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, fraction)))}
        />
      </>
    )
  }

  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size}>
        {arc(outerRadius, outer, 'ring__value')}
        {arc(innerRadius, inner, 'ring__value ring__value--second')}
      </svg>
    </div>
  )
}

/** One arc around an icon: a course's path, a question set's solved share. */
export function Ring({
  value,
  label,
  icon,
  size = 46,
  tone,
}: {
  /** 0 to 1. */
  value: number
  label: string
  icon?: IconName
  size?: number
  tone?: 'known'
}) {
  const stroke = 4
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size}>
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
        <circle
          className={`ring__value${tone === 'known' || value >= 1 ? ' ring__value--known' : ''}`}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, value)))}
        />
      </svg>
      {icon && (
        <span className="ring__label">
          <Icon name={icon} width={18} height={18} />
        </span>
      )}
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
