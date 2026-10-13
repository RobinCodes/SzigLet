/**
 * Small presentation helpers, kept out of the components.
 *
 * Anything that reads differently in Italian, Hungarian or English lives in
 * `lib/i18n` instead — counted nouns, relative times, durations, greetings.
 */

export function percent(part: number, whole: number): number {
  if (whole <= 0) {
    return 0
  }
  return Math.round((part / whole) * 100)
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0]}${parts[1]![0]}`
}
