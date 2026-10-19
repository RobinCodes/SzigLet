import type {
  Completion,
  ItemRecord,
  NodeCard,
  NodeContent,
  Part,
  PartMode,
  Question,
  Requirement,
  Subnode,
} from './types'
import { shuffle } from './study'

/**
 * The rules of the path: what a lesson is drawn from, when a part counts as
 * done, and what unlocks what.
 *
 * A node is a list of sub-nodes, a sub-node a list of parts. Every card and
 * question in a part is an item ("c:12", "q:7"), and the learner's record is
 * kept per item — so a word met in one node is not new in the next.
 */

export type Progress = Record<string, ItemRecord>

export type Dir = 'ab' | 'ba'
export type Mode = 'choice' | 'write'

export type Exercise =
  /** A word met for the first time: shown, not asked. */
  | { type: 'intro'; partId: string; card: NodeCard; dir: Dir }
  | { type: 'vocab'; partId: string; card: NodeCard; dir: Dir; mode: Mode; pool: NodeCard[] }
  | { type: 'match'; partId: string; cards: NodeCard[]; dir: Dir; mode: Mode }
  | { type: 'question'; partId: string; question: Question; mode: Mode }
  | { type: 'compare'; partId: string; questions: Question[]; mode: Mode }

export const MATCH_SIZE = 5

export function cardItem(id: number): string {
  return `c:${id}`
}

export function questionItem(id: number): string {
  return `q:${id}`
}

/** The items a part is made of. Questions not saved yet have no item. */
export function itemsOf(part: Part): string[] {
  return [
    ...part.cards.map(cardItem),
    ...part.questions.filter((q): q is number => typeof q === 'number').map(questionItem),
  ]
}

export function findPart(content: NodeContent, partId: string): Part | undefined {
  for (const sub of content.subnodes) {
    const part = sub.parts.find((candidate) => candidate.id === partId)
    if (part) return part
  }
  return undefined
}

const EMPTY: ItemRecord = { seen: 0, solved: 0, wrong: 0, lastOk: false }

export function recordOf(progress: Progress, item: string): ItemRecord {
  return progress[item] ?? EMPTY
}

/** "Seen" is any encounter; "solved" is having got it right at least once. */
export function meets(record: ItemRecord, need: 'seen' | 'solved'): boolean {
  return need === 'seen' ? record.seen > 0 : record.solved > 0
}

/** Whether one item satisfies its part's completion rule. */
export function itemDone(record: ItemRecord, complete: Completion): boolean {
  switch (complete.need) {
    case 'none':
      return true
    case 'seen':
      return record.seen > 0
    case 'solved':
      // Solved the last time it came up — not just once, long ago.
      return record.lastOk
    default:
      return record.solved >= Math.max(1, complete.times)
  }
}

/**
 * Items that no longer exist, or that this learner hid with a report, do not
 * hold anything up: a deleted card cannot be learned.
 */
export type Present = (item: string) => boolean

export function partComplete(part: Part, progress: Progress, present: Present): boolean {
  if (part.complete.need === 'none') {
    return true
  }
  return itemsOf(part)
    .filter(present)
    .every((item) => itemDone(recordOf(progress, item), part.complete))
}

/** How many of a part's items are done, for progress bars. */
export function partCount(part: Part, progress: Progress, present: Present): { done: number; total: number } {
  if (part.complete.need === 'none') {
    return { done: 0, total: 0 }
  }
  const items = itemsOf(part).filter(present)
  return {
    done: items.filter((item) => itemDone(recordOf(progress, item), part.complete)).length,
    total: items.length,
  }
}

export function subnodeComplete(sub: Subnode, progress: Progress, present: Present): boolean {
  return sub.parts.every((part) => partComplete(part, progress, present))
}

export function subnodeCount(sub: Subnode, progress: Progress, present: Present): { done: number; total: number } {
  return sub.parts.reduce(
    (sum, part) => {
      const count = partCount(part, progress, present)
      return { done: sum.done + count.done, total: sum.total + count.total }
    },
    { done: 0, total: 0 },
  )
}

export type NodeState = {
  /** Sub-nodes complete, in order from the start: the first incomplete is next. */
  completed: number
  total: number
  complete: boolean
  /** Index of the sub-node a learner would study next. */
  current: number
  /** Items done over items counted, across the node. */
  fraction: number
}

export function nodeState(content: NodeContent, progress: Progress, present: Present): NodeState {
  const subs = content.subnodes
  let completed = 0
  while (completed < subs.length && subnodeComplete(subs[completed]!, progress, present)) {
    completed++
  }
  const counts = subs.reduce(
    (sum, sub) => {
      const count = subnodeCount(sub, progress, present)
      return { done: sum.done + count.done, total: sum.total + count.total }
    },
    { done: 0, total: 0 },
  )
  const complete = subs.every((sub) => subnodeComplete(sub, progress, present))
  return {
    completed,
    total: subs.length,
    complete,
    current: Math.min(completed, Math.max(0, subs.length - 1)),
    fraction: complete ? 1 : counts.total > 0 ? counts.done / counts.total : 0,
  }
}

/** True when a requirement is met. A part with nothing left in it is met. */
export function requirementMet(
  requirement: Requirement,
  content: NodeContent,
  progress: Progress,
  present: Present,
): boolean {
  if (requirement.ref.startsWith('part:')) {
    const part = findPart(content, requirement.ref.slice(5))
    if (!part) return true
    return itemsOf(part)
      .filter(present)
      .every((item) => meets(recordOf(progress, item), requirement.need))
  }
  return !present(requirement.ref) || meets(recordOf(progress, requirement.ref), requirement.need)
}

export function partUnlocked(part: Part, content: NodeContent, progress: Progress, present: Present): boolean {
  return part.requires.every((requirement) => requirementMet(requirement, content, progress, present))
}

// ── Building a lesson ────────────────────────────────────────────────────────

type Unit = {
  exercise: Exclude<Exercise, { type: 'intro' }>
  items: string[]
  /** Something in it still counts towards completing the part. */
  pending: boolean
  /** How often its items have been solved: fewer first. */
  weight: number
  /** Cards in it never seen before, which get introduced first. */
  fresh: NodeCard[]
}

const pick = <T,>(options: readonly T[]): T => options[Math.floor(Math.random() * options.length)]!

function resolveMode(mode: PartMode, unseen: boolean): Mode {
  if (mode === 'both') {
    // A word nobody has seen is easier to meet as a choice than to spell.
    return unseen ? 'choice' : pick<Mode>(['choice', 'write'])
  }
  return mode
}

/** Which way a card can be asked, honouring one-way cards. */
function directionFor(part: Part, card: NodeCard): Dir | null {
  const ways: Dir[] = part.dirs === 'both' ? ['ab', 'ba'] : [part.dirs]
  const allowed = ways.filter((way) => {
    if (!card.a.trim() || !card.b.trim()) return false
    const only = card.extras?.only
    return !only || only === way[0]
  })
  return allowed.length > 0 ? pick(allowed) : null
}

export type LessonInput = {
  content: NodeContent
  sub: Subnode
  cards: ReadonlyMap<number, NodeCard>
  questions: ReadonlyMap<number, Question>
  progress: Progress
  hidden: ReadonlySet<string>
  size: number
}

/**
 * Draws a lesson from one sub-node.
 *
 * Only parts whose prerequisites are met take part. What still counts
 * towards completion comes first, least-practised first; the rest of the
 * lesson is review. A card never seen before is introduced right before it
 * is first asked. So two learners on the same sub-node get different lessons,
 * and the same learner gets a different one each time.
 */
export function buildLesson(input: LessonInput): Exercise[] {
  const { content, sub, cards, questions, progress, hidden, size } = input
  const present: Present = (item) => !hidden.has(item) && exists(item, cards, questions)
  const allCards = [...cards.values()].filter((card) => !hidden.has(cardItem(card.id)))
  const units: Unit[] = []

  for (const part of sub.parts) {
    if (!partUnlocked(part, content, progress, present)) {
      continue
    }
    const done = (item: string) => itemDone(recordOf(progress, item), part.complete)
    const solvedCount = (item: string) => recordOf(progress, item).solved
    const partCards = part.cards
      .map((id) => cards.get(id))
      .filter((card): card is NodeCard => Boolean(card) && !hidden.has(cardItem(card!.id)))
    const partQuestions = part.questions
      .map((id) => (typeof id === 'number' ? questions.get(id) : undefined))
      .filter((q): q is Question => Boolean(q) && !hidden.has(questionItem(q!.id)))

    if (part.kind === 'vocab') {
      for (const card of partCards) {
        const dir = directionFor(part, card)
        if (!dir) continue
        const item = cardItem(card.id)
        const unseen = recordOf(progress, item).seen === 0
        // Distractors come from the part first, then from the rest of the node.
        const pool = partCards.length >= 4 ? partCards : allCards
        units.push({
          exercise: { type: 'vocab', partId: part.id, card, dir, mode: resolveMode(part.mode, unseen), pool },
          items: [item],
          pending: !done(item),
          weight: solvedCount(item),
          fresh: unseen ? [card] : [],
        })
      }
    } else if (part.kind === 'match') {
      const usable = partCards.filter((card) => card.a.trim() && card.b.trim())
      if (usable.length < 2) continue
      // Unfinished cards first, then the least practised, in groups of five.
      const ordered = [
        ...shuffle(usable.filter((card) => !done(cardItem(card.id)))),
        ...shuffle(usable.filter((card) => done(cardItem(card.id)))).sort(
          (x, y) => solvedCount(cardItem(x.id)) - solvedCount(cardItem(y.id)),
        ),
      ]
      // As even as possible, at most five a side: six cards are two rounds
      // of three, not five and a lonely one.
      const groups = Math.ceil(ordered.length / MATCH_SIZE)
      for (let g = 0, start = 0; g < groups; g++) {
        const size = Math.floor(ordered.length / groups) + (g < ordered.length % groups ? 1 : 0)
        const group = ordered.slice(start, start + size)
        start += size
        const items = group.map((card) => cardItem(card.id))
        const fresh = group.filter((card) => recordOf(progress, cardItem(card.id)).seen === 0)
        units.push({
          exercise: {
            type: 'match',
            partId: part.id,
            cards: group,
            dir: part.dirs === 'both' ? pick<Dir>(['ab', 'ba']) : part.dirs,
            mode: resolveMode(part.mode, fresh.length > 0),
          },
          items,
          pending: items.some((item) => !done(item)),
          weight: Math.min(...items.map(solvedCount)),
          fresh,
        })
      }
    } else if (part.kind === 'question') {
      for (const question of partQuestions) {
        const item = questionItem(question.id)
        units.push({
          exercise: {
            type: 'question',
            partId: part.id,
            question,
            mode: resolveMode(part.mode, recordOf(progress, item).seen === 0),
          },
          items: [item],
          pending: !done(item),
          weight: solvedCount(item),
          fresh: [],
        })
      }
    } else if (partQuestions.length > 0) {
      const items = partQuestions.map((q) => questionItem(q.id))
      units.push({
        exercise: {
          type: 'compare',
          partId: part.id,
          questions: shuffle(partQuestions),
          mode: resolveMode(part.mode, items.every((item) => recordOf(progress, item).seen === 0)),
        },
        items,
        pending: items.some((item) => !done(item)),
        weight: Math.min(...items.map(solvedCount)),
        fresh: [],
      })
    }
  }

  const byWeight = (list: Unit[]) =>
    shuffle(list).sort((x, y) => x.weight - y.weight)
  const chosen = [...byWeight(units.filter((u) => u.pending)), ...shuffle(units.filter((u) => !u.pending))]
    .slice(0, Math.max(1, size))

  // Mix the order, but never let a question about a word come before the
  // word's introduction: introductions travel with their exercise.
  const out: Exercise[] = []
  const introduced = new Set<number>()
  for (const unit of shuffle(chosen)) {
    for (const card of unit.fresh) {
      if (!introduced.has(card.id)) {
        introduced.add(card.id)
        const dir = unit.exercise.type === 'vocab' || unit.exercise.type === 'match' ? unit.exercise.dir : 'ab'
        out.push({ type: 'intro', partId: unit.exercise.partId, card, dir })
      }
    }
    out.push(unit.exercise)
  }
  return out
}

function exists(
  item: string,
  cards: ReadonlyMap<number, NodeCard>,
  questions: ReadonlyMap<number, Question>,
): boolean {
  const id = Number(item.slice(2))
  return item.startsWith('c:') ? cards.has(id) : questions.has(id)
}

/** The same check, for screens that have the maps but not a lesson. */
export function presenceOf(
  cards: ReadonlyMap<number, NodeCard> | null,
  questions: ReadonlyMap<number, Question> | null,
  hidden: ReadonlySet<string>,
): Present {
  return (item) => {
    if (hidden.has(item)) return false
    // Without the details (the course screen), every item counts.
    if (!cards || !questions) return true
    return exists(item, cards, questions)
  }
}

/** Every item an exercise asks about, for recording the answer. */
export function exerciseItems(exercise: Exercise): string[] {
  switch (exercise.type) {
    case 'intro':
    case 'vocab':
      return [cardItem(exercise.card.id)]
    case 'match':
      return exercise.cards.map((card) => cardItem(card.id))
    case 'question':
      return [questionItem(exercise.question.id)]
    case 'compare':
      return exercise.questions.map((q) => questionItem(q.id))
  }
}

/** Applies a batch of attempts to a local copy of the progress record. */
export function applyAttempts(progress: Progress, attempts: { item: string; ok: boolean | null }[]): Progress {
  const next = { ...progress }
  for (const { item, ok } of attempts) {
    const record = { ...recordOf(next, item) }
    record.seen += 1
    if (ok === true) {
      record.solved += 1
      record.lastOk = true
    } else if (ok === false) {
      record.wrong += 1
      record.lastOk = false
    }
    next[item] = record
  }
  return next
}

/** Unlocked parts in a sub-node that have something to ask. */
export function hasPlayableParts(input: Omit<LessonInput, 'size'>): boolean {
  return buildLesson({ ...input, size: 1 }).length > 0
}
