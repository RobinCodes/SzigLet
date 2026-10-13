/*
 * SzigLet service worker.
 *
 * Three caches, three strategies:
 *   shell   — the app itself, so an installed SzigLet opens with no network.
 *   assets  — hashed build output, immutable, cache-first forever.
 *   api     — the last good answer for GET requests, so sets stay readable
 *             underground. Cleared on sign-out so nothing leaks between people
 *             sharing a device.
 *
 * Two things make offline actually work rather than nearly work:
 *
 *   - The whole build is precached at install. PRECACHE is written in by
 *     `scripts/sw-manifest.mjs` after `vite build`, because the worker is
 *     registered on `load` — too late to intercept the very first request for
 *     the JavaScript that drew the page. Without it, the first visit cached
 *     the HTML and none of the code it needs.
 *   - `/api/auth/me` is cached too. Without it an offline launch could not
 *     answer "who is signed in", and bounced the reader to the sign-in screen
 *     with their whole library sitting in the cache behind it.
 *
 * The worker never activates over a running page on its own: it waits for the
 * reader to accept the new version (see lib/update.ts), then takes over.
 */

// sl-version:start
const VERSION = 'dev'
// sl-version:end

// sl-precache:start
const PRECACHE = []
// sl-precache:end

const SHELL_CACHE = `sziglet-shell-${VERSION}`
const ASSET_CACHE = `sziglet-assets-${VERSION}`
// Versioned: responses cached before cards carried grammar, or before sets
// carried per-direction test results, are a different shape. The activate
// handler sweeps any sziglet-* cache that is not one of these three.
const API_CACHE = 'sziglet-api-v2'

const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/favicon.svg',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE)
      // One missing file must not fail the whole install.
      await Promise.allSettled(SHELL_FILES.map((file) => shell.add(file)))

      const assets = await caches.open(ASSET_CACHE)
      await Promise.allSettled(PRECACHE.map((file) => assets.add(file)))
    })(),
  )
  // Deliberately no skipWaiting(): swapping the worker under a page that is
  // already running would leave it asking for chunks this build no longer has.
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('sziglet-') &&
                key !== SHELL_CACHE &&
                key !== ASSET_CACHE &&
                key !== API_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'clear-api-cache') {
    event.waitUntil(caches.delete(API_CACHE))
  }
  if (event.data === 'skip-waiting') {
    // The reader accepted the update; the page reloads on controllerchange.
    self.skipWaiting()
  }
})

/** Cache.match, ignoring Vary — a proxy may add headers we never asked for. */
function lookup(cache, request) {
  return cache.match(request, { ignoreVary: true })
}

async function keep(cache, request, response) {
  try {
    await cache.put(request, response)
  } catch {
    /* quota, or an opaque response — not worth failing the request over */
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await lookup(cache, request)
  if (hit) {
    return hit
  }
  const response = await fetch(request)
  if (response.ok) {
    await keep(cache, request, response.clone())
  }
  return response
}

async function networkFirst(request, cacheName, fallback) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) {
      await keep(cache, request, response.clone())
    }
    return response
  } catch (error) {
    const hit = await lookup(cache, request)
    if (hit) {
      return hit
    }
    if (fallback) {
      const shell = await caches.open(SHELL_CACHE)
      const page = await lookup(shell, new Request(fallback))
      if (page) {
        return page
      }
    }
    throw error
  }
}

/** The reads that are worth replaying offline. Never the auth endpoints. */
function isCacheableApi(pathname) {
  return (
    pathname.startsWith('/api/sets') ||
    pathname === '/api/me/stats' ||
    pathname === '/api/auth/me'
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return
  }

  // Client-side routing: any navigation falls back to the app shell.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/index.html'))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
    return
  }

  if (url.pathname.startsWith('/api/')) {
    if (isCacheableApi(url.pathname)) {
      event.respondWith(networkFirst(request, API_CACHE))
    }
    return
  }

  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(request, SHELL_CACHE))
  }
})
