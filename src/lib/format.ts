/** Small presentation helpers, kept out of the components. */

export function percent(part: number, whole: number): number {
  if (whole <= 0) {
    return 0
  }
  return Math.round((part / whole) * 100)
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function relativeTime(unixSeconds: number): string {
  const seconds = Math.floor(Date.now() / 1000) - unixSeconds
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  const days = Math.floor(seconds / 86400)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0]}${parts[1]![0]}`
}

export function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
