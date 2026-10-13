export type Role = 'viewer' | 'editor' | 'owner'

/** Which side of the card is shown first: a→b or b→a. */
export type Direction = 'ab' | 'ba'

export type CardState = 'new' | 'rehearse' | 'known'

export type TestMode = 'choice' | 'write'

/** Which half of a card a piece of grammar belongs to. */
export type Side = 'a' | 'b'

export type Gender = 'm' | 'f'

/** The six persons of an Italian present tense, in the order they are taught. */
export const PERSONS = ['io', 'tu', 'lui', 'noi', 'voi', 'loro'] as const
export type Person = (typeof PERSONS)[number]

/**
 * The grammar hanging off a word, beyond the two sides themselves.
 *
 * Stored as JSON in one column rather than a column per feature: these are
 * sparse (most cards have none of them), and the set of them is going to keep
 * growing. Every field is per side, because the app cannot know which side is
 * the Italian one -- `langA` and `langB` are free text an editor typed.
 */
export type CardExtras = {
  /** "il", "la" — shown in front of the word. */
  article?: Partial<Record<Side, string>>
  /** The plural form, shown on a second line. */
  plural?: Partial<Record<Side, string>>
  /** Shown as (m) or (f) after the word. */
  gender?: Partial<Record<Side, Gender>>
  /** A verb's six present-tense forms. */
  conj?: Partial<Record<Person, string>>
}

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
  extras: CardExtras
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
  /** Which tests have been completed, per direction. Feeds the mastery score. */
  tests: Record<Direction, TestsDone>
}

/** A test only ends once every card is right, so finishing one is the signal. */
export type TestsDone = { choice: boolean; write: boolean }

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
  tests: Record<Direction, TestsDone>
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
  /** Tests taken. Flashcard rounds are counted in `sessions` instead. */
  runs: number
  /** Every study run, flashcards included — what `studyMs` is measured over. */
  sessions: number
  answered: number
  correct: number
  studyMs: number
  known: number
  rehearse: number
  /** Consecutive days with a run. Kept as a detail, not the headline. */
  streak: number
  /** Consecutive weeks with a run — the figure the Progress screen leads with. */
  weekStreak: number
  activeDays30: number
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
