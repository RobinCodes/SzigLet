/** Platform sniffing, used only to show the right install instructions. */

export type Platform = 'ios' | 'android' | 'desktop'
export type Browser = 'safari' | 'chrome' | 'firefox' | 'samsung' | 'edge' | 'other'

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent

export function detectPlatform(): Platform {
  if (/iPad|iPhone|iPod/.test(ua)) {
    return 'ios'
  }
  // iPadOS 13+ reports itself as a Mac, but a Mac has no touch points.
  if (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) {
    return 'ios'
  }
  if (/Android/.test(ua)) {
    return 'android'
  }
  return 'desktop'
}

export function detectBrowser(): Browser {
  if (/SamsungBrowser/.test(ua)) return 'samsung'
  if (/EdgA?|Edg\//.test(ua)) return 'edge'
  if (/FxiOS|Firefox/.test(ua)) return 'firefox'
  if (/CriOS|Chrome/.test(ua)) return 'chrome'
  if (/Safari/.test(ua)) return 'safari'
  return 'other'
}

/** True when the page is already running as an installed app. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const standalone = (navigator as { standalone?: boolean }).standalone
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    standalone === true
  )
}

/**
 * Chrome-family browsers fire `beforeinstallprompt`, which lets us install
 * with one tap instead of talking somebody through a menu. The event has to be
 * captured the moment it fires, so this module latches it at import time.
 */
type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPrompt | null = null
const listeners = new Set<(available: boolean) => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as InstallPrompt
    listeners.forEach((listener) => listener(true))
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((listener) => listener(false))
  })
}

export const installPrompt = {
  get available(): boolean {
    return deferred !== null
  },

  subscribe(listener: (available: boolean) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** Returns true if the app was actually installed. */
  async show(): Promise<boolean> {
    if (!deferred) {
      return false
    }
    const prompt = deferred
    deferred = null
    listeners.forEach((listener) => listener(false))
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    return outcome === 'accepted'
  },
}
