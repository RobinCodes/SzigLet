/**
 * Keeping an installed SzigLet current.
 *
 * The service worker is what makes the app open offline, and it is also what
 * would otherwise pin a phone to the build it first installed. So: the worker
 * never takes over on its own. When a new build is found it waits, this module
 * says so, and the reader is offered a reload — one tap, no app store, no
 * reinstall. A push that reaches the server therefore reaches every phone the
 * next time it is opened.
 */

type Listener = (ready: boolean) => void

const listeners = new Set<Listener>()

let registration: ServiceWorkerRegistration | null = null
let waiting: ServiceWorker | null = null
let reloading = false
let lastCheck = 0

/** Don't hammer the server when the app is switched to and from all day. */
const CHECK_EVERY_MS = 15 * 60 * 1000

function announce(worker: ServiceWorker | null): void {
  waiting = worker
  listeners.forEach((listener) => listener(worker !== null))
}

function watch(reg: ServiceWorkerRegistration): void {
  registration = reg

  // A worker already parked from a previous visit.
  if (reg.waiting && navigator.serviceWorker.controller) {
    announce(reg.waiting)
  }

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing
    if (!installing) {
      return
    }
    installing.addEventListener('statechange', () => {
      // "installed" with a controller present means this is an update rather
      // than the very first install, which should not interrupt anybody.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        announce(installing)
      }
    })
  })
}

/** Registers the worker and starts watching for new builds. */
export function startUpdateWatch(): void {
  if (!('serviceWorker' in navigator)) {
    return
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The new worker has taken over; the page has to be re-fetched to match it.
    if (reloading) {
      return
    }
    reloading = true
    window.location.reload()
  })

  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      watch(reg)
      lastCheck = Date.now()
    })
    .catch(() => {
      // An unavailable service worker only costs offline support.
    })

  // Coming back to the app is the natural moment to look for a new build.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void check()
    }
  })
  window.addEventListener('online', () => void check())
}

/**
 * Asks the server whether a newer build exists. Returns true when one is
 * waiting by the time the check settles.
 */
export async function check(force = false): Promise<boolean> {
  if (!registration) {
    return waiting !== null
  }
  if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) {
    return waiting !== null
  }
  lastCheck = Date.now()
  try {
    await registration.update()
  } catch {
    /* offline, or the worker file is unreachable */
  }
  if (registration.waiting && navigator.serviceWorker.controller) {
    announce(registration.waiting)
  }
  return waiting !== null
}

/** Hands the page over to the new build. The reload follows by itself. */
export function applyUpdate(): void {
  if (!waiting) {
    window.location.reload()
    return
  }
  waiting.postMessage('skip-waiting')
}

export const appUpdate = {
  get ready(): boolean {
    return waiting !== null
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  check,
  apply: applyUpdate,
}
