export type Role = 'viewer' | 'editor' | 'owner'

/**
 * Which pair of variations a round shows: front, then back.
 *
 * `ab` and `ba` are the two languages either way round, as they always were.
 * Any other pair reads `front>back` — `a>pla` is Italian to Italian plural.
 * Progress and test results are kept per direction.
 */
export type Direction = string

export type CardState = 'new' | 'rehearse' | 'known'

export type TestMode = 'choice' | 'write' | 'mixed'

/** Which language a variation belongs to: the set's first or second. */
export type Side = 'a' | 'b'

export type Gender = 'm' | 'f'

/** The six persons of an Italian present tense, in the order they are taught. */
export const PERSONS = ['io', 'tu', 'lui', 'noi', 'voi', 'loro'] as const
export type Person = (typeof PERSONS)[number]

/**
 * A way a card can be shown: the two languages, and anything else a set
 * adds — "Italian plural", "Italian with article". `a` and `b` are the two
 * languages and are always there.
 */
export type Variant = {
  key: string
  name: string
  side: Side
}

/**
 * Everything on a card beyond its two base sides.
 *
 * Stored as JSON in one column rather than a column per feature: most cards
 * carry little of it, and the list keeps growing.
 */
export type CardExtras = {
  /** The card's other variations, by key. */
  v?: Record<string, string>
  /** Shown as (m) or (f) after the word. */
  gender?: Partial<Record<Side, Gender>>
  /** A verb's six present-tense forms. */
  conj?: Partial<Record<Person, string>>
  /**
   * Which of a field's alternatives ("ház; épület") are shown when that field
   * is the question. Absent means the first.
   */
  pref?: Record<string, number[]>
  /** Only ever asked from this language towards the other. */
  only?: Side
  type?: 'verb'
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
  state: Partial<Record<Direction, CardState>>
}

/** A card as a node sees it: it can come from any set. */
export type NodeCard = Card & {
  setId: number
  setTitle: string
  langA: string
  langB: string
}

export type Answer = { t: string; ok: boolean }

export type QuestionKind = 'answer' | 'gap'

export type Question = {
  id: number
  setId: number | null
  nodeId: number | null
  kind: QuestionKind
  instruction: string | null
  /** For a gap question, the gap is written as ___. */
  body: string
  answers: Answer[]
  note: string | null
}

export type SetKind = 'words' | 'questions'

/** A learner's record for one card or question inside lessons. */
export type ItemRecord = { seen: number; solved: number; wrong: number; lastOk: boolean }

export type Author = { id: number; username: string }

export type SetSummary = {
  id: number
  slug: string
  title: string
  description: string | null
  langA: string
  langB: string
  kind?: SetKind
  published: boolean
  author: string | null
  authors?: string[]
  cardCount: number
  questionCount?: number
  questionsSolved?: number
  updatedAt: number
  known: Record<'ab' | 'ba', number>
  /** Which tests have been completed, per direction. Feeds the mastery score. */
  tests: Record<'ab' | 'ba', TestsDone>
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
  kind?: SetKind
  published: boolean
  author: string | null
  authors?: Author[]
  updatedAt: number
  variants?: Variant[]
  defaults?: string[]
  tests: Partial<Record<Direction, TestsDone>>
  cards: Card[]
  questions?: Question[]
  progress?: Record<string, ItemRecord>
  hidden?: string[]
  canSeeStats?: boolean
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
  /** A test over only some of the cards: kept, but not towards mastery. */
  partial?: boolean
}

/** One attempt at a lesson item. `ok` is null when a word was only shown. */
export type ItemUpdate = { item: string; ok: boolean | null }

export type LessonResult = {
  nodeId: number
  subnode: string
  total: number
  correct: number
  durationMs: number
  completedSub: boolean
  completedNode: boolean
}

// ── Courses ──────────────────────────────────────────────────────────────────

export type PartKind = 'vocab' | 'match' | 'question' | 'compare'
export type PartMode = 'choice' | 'write' | 'both'

/** What makes a part count as done: per item, for every item in it. */
export type Completion = { need: 'none' | 'seen' | 'times' | 'solved'; times: number }

/**
 * A prerequisite: a whole part (`part:p3`) or one card or question (`c:12`,
 * `q:7`), either merely seen or solved.
 */
export type Requirement = { ref: string; need: 'seen' | 'solved' }

export type Part = {
  id: string
  kind: PartKind
  title: string
  mode: PartMode
  /** Which way round vocabulary is asked. */
  dirs: 'ab' | 'ba' | 'both'
  cards: number[]
  /** Ids, or `new:<key>` for a question written in the node and not saved yet. */
  questions: (number | string)[]
  requires: Requirement[]
  complete: Completion
}

export type Subnode = { id: string; title: string; parts: Part[] }

export type NodeContent = { subnodes: Subnode[] }

export type CourseNode = {
  id: number
  title: string
  description: string | null
  position: number
  content: NodeContent
}

export type CourseSummary = {
  id: number
  slug: string
  title: string
  description: string | null
  published: boolean
  authors: string[]
  nodeCount: number
  nodesDone: number
  lessons: number
  updatedAt: number
}

export type CourseSet = {
  id: number
  slug: string
  title: string
  kind: SetKind
  langA: string
  langB: string
  published: boolean
  cardCount: number
  questionCount: number
}

export type Course = {
  id: number
  slug: string
  title: string
  description: string | null
  published: boolean
  authors: Author[]
  updatedAt: number
  sets: CourseSet[]
  nodes: CourseNode[]
  progress: Record<string, ItemRecord>
  hidden: string[]
  canSeeStats: boolean
}

export type NodeDetail = {
  node: CourseNode & { courseId: number; courseSlug: string; courseTitle: string }
  cards: NodeCard[]
  questions: Question[]
  ownQuestions: Question[]
  progress: Record<string, ItemRecord>
  hidden: string[]
}

// ── Reports and statistics ───────────────────────────────────────────────────

export type FlagReport = {
  item: string
  kind: 'card' | 'question'
  text: string
  where: string
  link: string
  reports: number
  latest: number
  reasons: string[]
}

export type SetStats = {
  id: number
  title: string
  slug: string
  kind: SetKind
  cardCount: number
  learners: number
  cleared: number
  tests: { runs: number; people: number; answered: number; correct: number }
  hardest: { id: number; a: string; b: string; right: number; wrong: number }[]
  questions: { id: number; body: string; people: number; right: number; wrong: number }[]
  openFlags: number
}

export type CourseStats = {
  id: number
  slug: string
  title: string
  learners: number
  nodes: {
    id: number
    title: string
    lessons: number
    people: number
    completed: number
    answered: number
    correct: number
  }[]
}

export type Stats = {
  /** Tests and lessons taken. Flashcard rounds are counted in `sessions` instead. */
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
    /** Where the entry leads. Older cached answers carry a slug instead. */
    link?: string
    slug?: string
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
