import type { Card, Direction, Gender, Side, TestsDone } from './types'
import { PERSONS } from './types'

/**
 * Reading a card's grammar, and scoring a set.
 *
 * The two sides of a card are `a` and `b`; which of them is the Italian one is
 * not something the app knows, because `langA` and `langB` are free text an
 * editor typed. So every attribute is stored and read per side.
 */

export type Attribute = 'article' | 'plural' | 'gender'

export const ATTRIBUTES: Attribute[] = ['article', 'plural', 'gender']

/** Which attributes a round shows without being asked. */
export type Show = Record<Attribute, boolean>

export const SHOW_NONE: Show = { article: false, plural: false, gender: false }

export function promptKey(dir: Direction): Side {
  return dir === 'ab' ? 'a' : 'b'
}

export function answerKey(dir: Direction): Side {
  return dir === 'ab' ? 'b' : 'a'
}

/** What a card actually carries on one side, whatever the round is showing. */
export function has(card: Card, side: Side, attribute: Attribute): boolean {
  return Boolean(card.extras?.[attribute]?.[side])
}

export function hasConjugation(card: Card): boolean {
  return PERSONS.some((person) => Boolean(card.extras?.conj?.[person]))
}

/** True when at least one card in the set could show this attribute. */
export function anyHas(cards: readonly Card[], side: Side, attribute: Attribute): boolean {
  return cards.some((card) => has(card, side, attribute))
}

export type WordParts = {
  /** "il", shown in front of the term. */
  article?: string
  term: string
  /** Rendered as (m) or (f) after the term. */
  gender?: Gender
  /** The plural, on a line of its own. */
  plural?: string
}

/**
 * The word as a round should display it: the term itself, plus whichever
 * attributes are switched on and actually present.
 */
export function parts(card: Card, side: Side, show: Show): WordParts {
  const extras = card.extras ?? {}
  const out: WordParts = { term: side === 'a' ? card.a : card.b }

  if (show.article && extras.article?.[side]) {
    out.article = extras.article[side]
  }
  if (show.gender && extras.gender?.[side]) {
    out.gender = extras.gender[side]
  }
  if (show.plural && extras.plural?.[side]) {
    out.plural = extras.plural[side]
  }
  return out
}

/** The same word on one line, for places with no room to lay it out. */
export function flatten(word: WordParts): string {
  const head = word.article ? `${word.article} ${word.term}` : word.term
  return word.gender ? `${head} (${word.gender})` : head
}

/**
 * Extra spellings a typed answer may take, beyond the card side itself.
 *
 * Someone who has been shown "il gesso" all round should not be marked wrong
 * for typing it back, so the article-led form always counts — whether or not
 * articles are switched on for this round.
 */
export function alsoAccepted(card: Card, side: Side): string[] {
  const article = card.extras?.article?.[side]
  const term = side === 'a' ? card.a : card.b
  return article ? [`${article} ${term}`] : []
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
