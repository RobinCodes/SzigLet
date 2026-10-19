import type { Card, CardState, Direction } from './types'
import { field, preferred } from './variants'
import { normalize } from './text'

export function stateOf(card: Card, dir: Direction): CardState {
  return card.state?.[dir] ?? 'new'
}

/** Fisher-Yates, on a copy. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return out
}

export function countStates(cards: readonly Card[], dir: Direction): Record<CardState, number> {
  const tally: Record<CardState, number> = { new: 0, rehearse: 0, known: 0 }
  for (const card of cards) {
    tally[stateOf(card, dir)]++
  }
  return tally
}

/** True once every card in the set is marked known for this direction. */
export function isDeckCleared(cards: readonly Card[], dir: Direction): boolean {
  return cards.length > 0 && cards.every((card) => stateOf(card, dir) === 'known')
}

/**
 * The order cards are shown in a flashcard round: everything not yet known,
 * with cards already marked "rehearse" first so they get the most attention.
 * A fully-known set replays in full, for revision.
 */
export function buildRound(cards: readonly Card[], dir: Direction): Card[] {
  const rehearse = cards.filter((card) => stateOf(card, dir) === 'rehearse')
  const fresh = cards.filter((card) => stateOf(card, dir) === 'new')
  if (rehearse.length + fresh.length === 0) {
    return shuffle(cards)
  }
  return [...shuffle(rehearse), ...shuffle(fresh)]
}

/**
 * Puts a card the learner did not know back into the queue - far enough ahead
 * that they have to recall it rather than echo it, close enough that it stays
 * in the same sitting.
 */
export function requeue<T>(queue: readonly T[], card: T): T[] {
  const gap = Math.min(queue.length, 3)
  const next = queue.slice()
  next.splice(gap, 0, card)
  return next
}

// -- Multiple choice ---------------------------------------------------------

export type ChoiceQuestion = {
  card: Card
  prompt: string
  answer: string
  options: string[]
  correctIndex: number
}

/**
 * Picks `count` distractors for `answer` from `candidates`, preferring ones of
 * a similar length so the right answer cannot be spotted by its shape.
 */
export function distractors(answer: string, candidates: readonly string[], count: number): string[] {
  const seen = new Set([normalize(answer)])
  const unique = candidates.filter((text) => {
    const key = normalize(text)
    if (!key || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
  const byClosestLength = unique.sort(
    (x, y) => Math.abs(x.length - answer.length) - Math.abs(y.length - answer.length),
  )
  // Shortlist plausible lengths, then randomise within it so the same card
  // does not always draw the same wrong answers.
  const shortlist = byClosestLength.slice(0, Math.max(count * 3, 9))
  return shuffle(shortlist).slice(0, count)
}

/** Builds one ABCD question, with distractors from the same pool. */
export function buildChoiceQuestion(
  card: Card,
  pool: readonly Card[],
  front: string,
  back: string,
  optionCount = 4,
): ChoiceQuestion {
  const answer = preferred(card, back)
  const others = pool
    .filter((other) => other.id !== card.id && field(other, back).trim())
    .map((other) => preferred(other, back))
  const options = shuffle([answer, ...distractors(answer, others, optionCount - 1)])

  return {
    card,
    prompt: preferred(card, front),
    answer,
    options,
    correctIndex: options.indexOf(answer),
  }
}

/** A set needs a few cards before ABCD makes any sense. */
export const MIN_CHOICE_CARDS = 4
