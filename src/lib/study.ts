import type { Card, CardState, Direction } from './types'

/** The side the learner is shown, given a direction. */
export function promptSide(card: Card, dir: Direction): string {
  return dir === 'ab' ? card.a : card.b
}

/** The side the learner has to produce. */
export function answerSide(card: Card, dir: Direction): string {
  return dir === 'ab' ? card.b : card.a
}

export function promptLang(set: { langA: string; langB: string }, dir: Direction): string {
  return dir === 'ab' ? set.langA : set.langB
}

export function answerLang(set: { langA: string; langB: string }, dir: Direction): string {
  return dir === 'ab' ? set.langB : set.langA
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
    tally[card.state[dir]]++
  }
  return tally
}

/** True once every card in the set is marked known for this direction. */
export function isDeckCleared(cards: readonly Card[], dir: Direction): boolean {
  return cards.length > 0 && cards.every((card) => card.state[dir] === 'known')
}

/**
 * The order cards are shown in a flashcard round: everything not yet known,
 * with cards already marked "rehearse" first so they get the most attention.
 * A fully-known set replays in full, for revision.
 */
export function buildRound(cards: readonly Card[], dir: Direction): Card[] {
  const rehearse = cards.filter((card) => card.state[dir] === 'rehearse')
  const fresh = cards.filter((card) => card.state[dir] === 'new')
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
export function requeue(queue: readonly Card[], card: Card): Card[] {
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
 * Builds one ABCD question. Distractors come from the same set, preferring
 * answers of a similar length so the right one cannot be spotted by shape.
 */
export function buildChoiceQuestion(
  card: Card,
  pool: readonly Card[],
  dir: Direction,
  optionCount = 4,
): ChoiceQuestion {
  const answer = answerSide(card, dir)
  const seen = new Set([answer.toLowerCase()])

  const candidates = pool
    .filter((other) => other.id !== card.id)
    .map((other) => answerSide(other, dir))
    .filter((text) => {
      const key = text.toLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })

  const byClosestLength = candidates.sort(
    (x, y) => Math.abs(x.length - answer.length) - Math.abs(y.length - answer.length),
  )

  // Shortlist plausible lengths, then randomise within it so the same card
  // does not always draw the same three wrong answers.
  const shortlist = byClosestLength.slice(0, Math.max(optionCount * 3, 9))
  const distractors = shuffle(shortlist).slice(0, optionCount - 1)
  const options = shuffle([answer, ...distractors])

  return {
    card,
    prompt: promptSide(card, dir),
    answer,
    options,
    correctIndex: options.indexOf(answer),
  }
}

/** A set needs a few cards before ABCD makes any sense. */
export const MIN_CHOICE_CARDS = 4
