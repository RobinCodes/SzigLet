/*
 * SzigLet service worker.
 *
 * Three caches, three strategies:
 *   shell   — the app itself, so an installed SzigLet opens with no network.
 *   assets  — hashed build output, immutable, cache-first forever.
 *   api     — the last good answer for GET requests, so sets stay readable
 *             underground. Cleared on sign-out so nothing leaks between people
 *             sharing a device.
 */

const VERSION = 'v1'
const SHELL_CACHE = `sziglet-shell-${VERSION}`
const ASSET_CACHE = `sziglet-assets-${VERSION}`
const API_CACHE = 'sziglet-api'

const SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // One missing file must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL_FILES.map((file) => cache.add(file))))
      .then(() => self.skipWaiting()),
  )
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
})

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) {
    return hit
  }
  const response = await fetch(request)
  if (response.ok) {
    cache.put(request, response.clone())
  }
  return response
}

async function networkFirst(request, cacheName, fallback) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const hit = await cache.match(request)
    if (hit) {
      return hit
    }
    if (fallback) {
      const shell = await caches.open(SHELL_CACHE)
      const page = await shell.match(fallback)
      if (page) {
        return page
      }
    }
    throw error
  }
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
    // Only reads worth replaying offline; never the auth endpoints.
    if (url.pathname.startsWith('/api/sets') || url.pathname === '/api/me/stats') {
      event.respondWith(networkFirst(request, API_CACHE))
    }
    return
  }

  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(request, SHELL_CACHE))
  }
})
