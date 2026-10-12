/**
 * Tiny vibrations on swipes and answers. Android honours this; iOS Safari
 * ignores it, which is fine - it is garnish, never feedback on its own.
 */

let enabled = true

try {
  enabled = localStorage.getItem('sziglet.haptics') !== 'off'
} catch {
  /* storage blocked */
}

function buzz(pattern: number | number[]): void {
  if (!enabled || typeof navigator === 'undefined' || !('vibrate' in navigator)) {
    return
  }
  try {
    navigator.vibrate(pattern)
  } catch {
    /* some browsers throw when the page is not visible */
  }
}

export const haptics = {
  get enabled(): boolean {
    return enabled
  },

  setEnabled(value: boolean): void {
    enabled = value
    try {
      localStorage.setItem('sziglet.haptics', value ? 'on' : 'off')
    } catch {
      /* storage blocked */
    }
  },

  tap: () => buzz(8),
  known: () => buzz(14),
  rehearse: () => buzz([12, 40, 12]),
  wrong: () => buzz([22, 50, 22]),
  finish: () => buzz([14, 60, 14, 60, 26]),
}
