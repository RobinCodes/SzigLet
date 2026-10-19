import type { Card, Direction, Gender, Side, Variant } from './types'
import { PERSONS, type Person } from './types'

/**
 * Variations: the ways a card can be shown.
 *
 * Every set has its two languages, `a` and `b`. It may add more — a plural,
 * the noun with its article — and a verb card adds its six persons. A round
 * picks any two of them, one for the front and one for the back.
 */

/** The pronouns are Italian whatever the interface language: they are what is being learned. */
export const PRONOUN: Record<Person, string> = {
  io: 'io',
  tu: 'tu',
  lui: 'lui / lei',
  noi: 'noi',
  voi: 'voi',
  loro: 'loro',
}

export function isPerson(key: string): key is Person {
  return (PERSONS as readonly string[]).includes(key)
}

export function baseVariants(set: { langA: string; langB: string }): Variant[] {
  return [
    { key: 'a', name: set.langA, side: 'a' },
    { key: 'b', name: set.langB, side: 'b' },
  ]
}

/**
 * The set's variations, plus the verb persons when any card has them. A copy
 * of a set cached before variations existed has none listed, and gets the
 * two languages.
 */
export function variantsOf(set: {
  langA: string
  langB: string
  variants?: Variant[]
  cards?: readonly Card[]
}): Variant[] {
  const listed = set.variants && set.variants.length >= 2 ? set.variants : baseVariants(set)
  // The base names follow the languages even if the list was saved earlier.
  const named = listed.map((variant) =>
    variant.key === 'a'
      ? { ...variant, name: set.langA }
      : variant.key === 'b'
        ? { ...variant, name: set.langB }
        : variant,
  )
  const persons = PERSONS.filter((person) =>
    (set.cards ?? []).some((card) => Boolean(card.extras?.conj?.[person])),
  )
  return [
    ...named,
    ...persons.map<Variant>((person) => ({ key: person, name: `${set.langA} · ${PRONOUN[person]}`, side: 'a' })),
  ]
}

/** What a card says for one variation, or '' when it has nothing there. */
export function field(card: Card, key: string): string {
  if (key === 'a') return card.a
  if (key === 'b') return card.b
  if (isPerson(key)) return card.extras?.conj?.[key] ?? ''
  return card.extras?.v?.[key] ?? ''
}

export function sideOf(variants: readonly Variant[], key: string): Side {
  return variants.find((variant) => variant.key === key)?.side ?? (key === 'b' ? 'b' : 'a')
}

export function nameOf(variants: readonly Variant[], key: string): string {
  return variants.find((variant) => variant.key === key)?.name ?? key
}

/** The progress key for a pair. The two classic directions keep their old names. */
export function dirKey(front: string, back: string): Direction {
  if (front === 'a' && back === 'b') return 'ab'
  if (front === 'b' && back === 'a') return 'ba'
  return `${front}>${back}`
}

export function parseDir(dir: string | null | undefined): { front: string; back: string } {
  if (!dir || dir === 'ab') return { front: 'a', back: 'b' }
  if (dir === 'ba') return { front: 'b', back: 'a' }
  const [front, back] = dir.split('>')
  return front && back && front !== back ? { front, back } : { front: 'a', back: 'b' }
}

/** "ház; épület" is two answers. */
export function alternatives(text: string): string[] {
  return text
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * The form shown when a field is the question: the preferred alternatives
 * only, so a card does not ask about three words at once. The first one
 * unless an editor picked otherwise.
 */
export function preferred(card: Card, key: string): string {
  const options = alternatives(field(card, key))
  if (options.length <= 1) {
    return options[0] ?? ''
  }
  const chosen = (card.extras?.pref?.[key] ?? [0]).filter((index) => index < options.length)
  const picked = (chosen.length > 0 ? chosen : [0]).map((index) => options[index]!)
  return picked.join(' / ')
}

/** Gender belongs to the plain word on a side, not to a plural or a verb form. */
export function genderOf(card: Card, key: string): Gender | undefined {
  return key === 'a' || key === 'b' ? card.extras?.gender?.[key] : undefined
}

/**
 * Whether a card can be asked front→back: it needs both fields, and a card
 * marked one-way is only ever asked from its own language. A pair inside one
 * language — singular to plural — is never one-way.
 */
export function askable(card: Card, front: string, back: string, variants: readonly Variant[]): boolean {
  if (!field(card, front).trim() || !field(card, back).trim()) {
    return false
  }
  const only = card.extras?.only
  const from = sideOf(variants, front)
  const to = sideOf(variants, back)
  return !only || from === to || from === only
}

export function usableCards(
  cards: readonly Card[],
  front: string,
  back: string,
  variants: readonly Variant[],
  hidden: readonly string[] = [],
): Card[] {
  const skip = new Set(hidden)
  return cards.filter((card) => !skip.has(`c:${card.id}`) && askable(card, front, back, variants))
}

/** Variations at least one card fills in, in the set's order. */
export function filledVariants(cards: readonly Card[], variants: readonly Variant[]): Variant[] {
  return variants.filter((variant) => cards.some((card) => field(card, variant.key).trim()))
}

/**
 * Other forms a typed answer may take. Someone shown "il gesso" all round
 * should not be marked wrong for typing it back where the answer is "gesso",
 * so a same-language variation that is the plain word with something in
 * front of it — the article — counts too. A plural does not.
 */
export function alsoAccepted(card: Card, back: string, variants: readonly Variant[]): string[] {
  if (back !== 'a' && back !== 'b') {
    return []
  }
  const plain = alternatives(field(card, back)).map((option) => option.toLowerCase())
  return variants
    .filter((variant) => variant.key !== back && variant.side === back && !isPerson(variant.key))
    .map((variant) => field(card, variant.key))
    .filter((value) => {
      const lower = value.trim().toLowerCase()
      return lower && plain.some((word) => lower !== word && lower.endsWith(word) && /['’\s]$/.test(lower.slice(0, -word.length)))
    })
}
