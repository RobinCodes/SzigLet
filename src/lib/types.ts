export type Role = 'viewer' | 'editor' | 'owner'

/** Which side of the card is shown first: a→b or b→a. */
export type Direction = 'ab' | 'ba'

export type CardState = 'new' | 'rehearse' | 'known'

export type TestMode = 'choice' | 'write'

export type User = {
  id: number
  username: string
  role: Role
  createdAt: number
}

export type Card = {
  id: number
  a: string
  b: string
  note: string | null
  state: Record<Direction, CardState>
}

export type SetSummary = {
  id: number
  slug: string
  title: string
  description: string | null
  langA: string
  langB: string
  published: boolean
  author: string | null
  cardCount: number
  updatedAt: number
  known: Record<Direction, number>
}

export type StudySet = {
  id: number
  slug: string
  title: string
  description: string | null
  langA: string
  langB: string
  published: boolean
  author: string | null
  updatedAt: number
  cards: Card[]
}

export type ProgressUpdate = {
  cardId: number
  state: CardState
  right?: boolean
  wrong?: boolean
}

export type RunResult = {
  setId: number
  dir: Direction
  mode: 'flashcards' | TestMode
  total: number
  correct: number
  durationMs: number
}

export type Stats = {
  runs: number
  answered: number
  correct: number
  studyMs: number
  known: number
  rehearse: number
  streak: number
  recent: {
    at: number
    mode: string
    dir: Direction
    total: number
    correct: number
    title: string
    slug: string
  }[]
  activity: { day: number; runs: number }[]
}

export type AdminUser = {
  id: number
  username: string
  role: Role
  createdAt: number
  lastSeenAt: number | null
  known: number
  runs: number
  devices: number
}

export type AdminOverview = {
  users: number
  editors: number
  sets: number
  cards: number
  runs: number
  active7d: number
  audit: { at: number; action: string; detail: string; by: string | null }[]
}
