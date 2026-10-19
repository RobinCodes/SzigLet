import type { Card, Gender, TestsDone } from './types'
import { PERSONS } from './types'

export function hasConjugation(card: Card): boolean {
  return PERSONS.some((person) => Boolean(card.extras?.conj?.[person]))
}

export type WordParts = {
  term: string
  /** Rendered as (m) or (f) after the term. */
  gender?: Gender
}

// ── Mastery ──────────────────────────────────────────────────────────────────

/**
 * How far through a set one direction is, from 0 to 1.
 *
 * Swiping every card to known is half of it; the tests are the other half,
 * because recognising a word on a card you have just flipped is not the same
 * as producing it. Writing a set out subsumes multiple choice — it is the
 * harder of the two — so a written pass is worth the whole test half on its
 * own and there is no need to sit the easy one as well.
 */
export const MASTERY = { swiped: 0.5, choice: 0.25, written: 0.25 } as const

export const NO_TESTS: TestsDone = { choice: false, write: false }

/**
 * `tests` is optional because the service worker keeps the last good answer
 * for `/api/sets`, and a copy cached before this release has no such field.
 */
export function mastery(known: number, cardCount: number, tests?: TestsDone): number {
  const done = tests ?? NO_TESTS
  const swiped = cardCount > 0 ? Math.min(1, known / cardCount) * MASTERY.swiped : 0
  const tested = done.write
    ? MASTERY.choice + MASTERY.written
    : done.choice
      ? MASTERY.choice
      : 0
  return swiped + tested
}

export function masteryPercent(known: number, cardCount: number, tests?: TestsDone): number {
  return Math.round(mastery(known, cardCount, tests) * 100)
}
