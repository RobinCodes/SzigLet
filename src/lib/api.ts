import { solveChallenge, type Challenge } from './pow'
import type {
  AdminOverview,
  AdminUser,
  CardExtras,
  Direction,
  ProgressUpdate,
  RunResult,
  SetSummary,
  Stats,
  StudySet,
  User,
} from './types'

const BASE = '/api'
const CSRF_COOKIE = 'sl_csrf'
const CSRF_HEADER = 'X-SzigLet-Csrf'
const OUTBOX_KEY = 'sziglet.outbox'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** True when the request never reached the server. */
  get offline(): boolean {
    return this.status === 0
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`),
  )
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }

  // Plenty of shared hosts answer PATCH and DELETE with a 403 from their WAF
  // before PHP ever sees them, so those verbs ride inside a POST instead.
  const tunnelled = method === 'PATCH' || method === 'DELETE'
  const wireMethod = tunnelled ? 'POST' : method
  if (tunnelled) {
    headers['X-HTTP-Method-Override'] = method
  }

  if (options.body !== undefined || tunnelled) {
    headers['Content-Type'] = 'application/json'
  }
  if (method !== 'GET') {
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf) {
      headers[CSRF_HEADER] = csrf
    }
  }

  let response: Response
  try {
    response = await fetch(BASE + path, {
      method: wireMethod,
      headers,
      credentials: 'same-origin',
      // No `cache` override: the API already answers with `Cache-Control:
      // no-store`, and leaving the request's own cache mode alone is what
      // lets the service worker keep a copy for offline use.
      signal: options.signal,
      body:
        options.body === undefined && !tunnelled
          ? undefined
          : JSON.stringify(options.body ?? {}),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new ApiError(0, 'offline', 'No connection. Your work is saved on this device.')
  }

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ApiError(response.status, 'bad_response', 'The server sent something unexpected.')
    }
  }

  if (!response.ok) {
    const data = (payload ?? {}) as { error?: string; message?: string; retryAfter?: number }
    throw new ApiError(
      response.status,
      data.error ?? 'error',
      data.message ?? 'Something went wrong.',
      data.retryAfter,
    )
  }

  return payload as T
}

// ── Proof of work ─────────────────────────────────────────────────────────────

async function withProof(
  purpose: 'register' | 'login',
  body: Record<string, unknown>,
  onProgress?: (fraction: number) => void,
): Promise<Record<string, unknown>> {
  const challenge = await request<Challenge>('/auth/challenge', {
    method: 'POST',
    body: { purpose },
  })
  const solution = await solveChallenge(challenge, { onProgress })
  return { ...body, pow: solution }
}

/** Drops anything the service worker cached for the signed-in person. */
async function forgetCachedResponses(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage('clear-api-cache')
    if ('caches' in window) {
      // By prefix, so an older build's cache goes too.
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name.startsWith('sziglet-api')).map((name) => caches.delete(name)),
      )
    }
    localStorage.removeItem(OUTBOX_KEY)
  } catch {
    /* nothing useful to do if the browser refuses */
  }
}

// ── Authentication ────────────────────────────────────────────────────────────

/** A card on the way to the server. The id keeps progress across an edit. */
export type CardInput = {
  id?: number
  a: string
  b: string
  note?: string
  extras?: CardExtras
}

export type Session = { user: User; csrf: string }
export type Me = { user: User | null; registrationOpen: boolean; canEdit: boolean }

export const api = {
  me: () => request<Me>('/auth/me'),

  async register(
    input: { username: string; password: string; elapsedMs: number; website: string },
    onProgress?: (fraction: number) => void,
  ): Promise<Session> {
    const body = await withProof('register', { ...input }, onProgress)
    return request<Session>('/auth/register', { method: 'POST', body })
  },

  async login(
    input: { username: string; password: string; elapsedMs: number; website: string },
    onProgress?: (fraction: number) => void,
  ): Promise<Session> {
    const body = await withProof('login', { ...input }, onProgress)
    return request<Session>('/auth/login', { method: 'POST', body })
  },

  async logout(): Promise<void> {
    try {
      await request<{ ok: true }>('/auth/logout', { method: 'POST' })
    } finally {
      // Another person may use this device next; drop the cached answers.
      await forgetCachedResponses()
    }
  },

  changePassword: (current: string, next: string) =>
    request<{ ok: true }>('/auth/password', { method: 'POST', body: { current, next } }),

  async logoutEverywhere(): Promise<void> {
    try {
      await request<{ ok: true }>('/auth/logout-everywhere', { method: 'POST' })
    } finally {
      await forgetCachedResponses()
    }
  },

  // ── Library ────────────────────────────────────────────────────────────────

  sets: () => request<{ sets: SetSummary[] }>('/sets').then((r) => r.sets),

  set: (slug: string, signal?: AbortSignal) => request<StudySet>(`/sets/${slug}`, { signal }),

  createSet: (body: {
    title: string
    description?: string
    langA: string
    langB: string
    published: boolean
    cards?: CardInput[]
  }) => request<StudySet>('/sets', { method: 'POST', body }),

  updateSet: (
    id: number,
    body: Partial<{
      title: string
      description: string
      langA: string
      langB: string
      published: boolean
      sortOrder: number
      cards: CardInput[]
    }>,
  ) => request<StudySet>(`/sets/${id}`, { method: 'PATCH', body }),

  deleteSet: (id: number) => request<{ ok: true }>(`/sets/${id}`, { method: 'DELETE' }),

  // ── Study state ────────────────────────────────────────────────────────────

  saveProgress: (dir: Direction, updates: ProgressUpdate[]) =>
    request<{ updated: number }>('/progress', { method: 'POST', body: { dir, updates } }),

  resetProgress: (setId: number, dir?: Direction | 'both') =>
    request<{ ok: true }>('/progress/reset', {
      method: 'POST',
      body: { setId, dir: dir ?? 'both' },
    }),

  recordResult: (result: RunResult) =>
    request<{ id: number }>('/results', { method: 'POST', body: result }),

  stats: () => request<Stats>('/me/stats'),

  // ── Administration ─────────────────────────────────────────────────────────

  adminUsers: () => request<{ users: AdminUser[] }>('/admin/users').then((r) => r.users),

  setRole: (id: number, role: string) =>
    request<{ ok: true }>(`/admin/users/${id}`, { method: 'PATCH', body: { role } }),

  deleteUser: (id: number) => request<{ ok: true }>(`/admin/users/${id}`, { method: 'DELETE' }),

  adminOverview: () => request<AdminOverview>('/admin/overview'),
}

// ── Offline outbox ────────────────────────────────────────────────────────────

/**
 * Study happens on trains and in basements. Progress and results are queued
 * locally when a write fails, then replayed in order once the connection is
 * back, so a session is never lost because of signal.
 */
type OutboxEntry =
  | { kind: 'progress'; dir: Direction; updates: ProgressUpdate[] }
  | { kind: 'result'; result: RunResult }

function readOutbox(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : []
  } catch {
    return []
  }
}

function writeOutbox(entries: OutboxEntry[]): void {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(OUTBOX_KEY)
    } else {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries.slice(-200)))
    }
  } catch {
    /* storage full or blocked — nothing useful to do */
  }
}

function enqueue(entry: OutboxEntry): void {
  writeOutbox([...readOutbox(), entry])
}

export const outbox = {
  get pending(): number {
    return readOutbox().length
  },

  /** Saves progress, falling back to the queue when the request fails. */
  async saveProgress(dir: Direction, updates: ProgressUpdate[]): Promise<boolean> {
    if (updates.length === 0) {
      return true
    }
    try {
      await api.saveProgress(dir, updates)
      return true
    } catch (error) {
      if (error instanceof ApiError && (error.offline || error.status >= 500)) {
        enqueue({ kind: 'progress', dir, updates })
        return false
      }
      throw error
    }
  },

  async recordResult(result: RunResult): Promise<boolean> {
    try {
      await api.recordResult(result)
      return true
    } catch (error) {
      if (error instanceof ApiError && (error.offline || error.status >= 500)) {
        enqueue({ kind: 'result', result })
        return false
      }
      throw error
    }
  },

  /** Replays everything queued. Stops at the first failure to keep order. */
  async flush(): Promise<number> {
    const entries = readOutbox()
    if (entries.length === 0) {
      return 0
    }
    let sent = 0
    for (const entry of entries) {
      try {
        if (entry.kind === 'progress') {
          await api.saveProgress(entry.dir, entry.updates)
        } else {
          await api.recordResult(entry.result)
        }
        sent++
      } catch (error) {
        if (error instanceof ApiError && !error.offline && error.status < 500) {
          // A rejected entry would block the queue forever; drop it.
          sent++
          continue
        }
        break
      }
    }
    writeOutbox(entries.slice(sent))
    return sent
  },
}
