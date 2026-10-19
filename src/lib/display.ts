import type { Direction } from './types'

/**
 * Which pair of variations a set is studied in, per set and per device.
 *
 * Remembering it is the difference between one tap and three. The key is the
 * same one the app has always used, so a direction chosen before variations
 * existed ("ab" or "ba") still reads back as itself.
 */

const KEY = 'sziglet.dir'

export function readDirection(slug: string): Direction {
  try {
    return localStorage.getItem(`${KEY}.${slug}`) ?? 'ab'
  } catch {
    return 'ab'
  }
}

export function storeDirection(slug: string, dir: Direction): void {
  try {
    localStorage.setItem(`${KEY}.${slug}`, dir)
  } catch {
    /* storage blocked */
  }
}

/**
 * How many exercises a lesson has. A per-device preference: ten on the bus,
 * twenty-five at a desk.
 */
const LESSON_KEY = 'sziglet.lessonSize'
export const LESSON_SIZES = [5, 10, 15, 20, 30] as const
export const DEFAULT_LESSON_SIZE = 10

export function readLessonSize(): number {
  try {
    const saved = Number(localStorage.getItem(LESSON_KEY))
    return Number.isFinite(saved) && saved >= 3 && saved <= 60 ? saved : DEFAULT_LESSON_SIZE
  } catch {
    return DEFAULT_LESSON_SIZE
  }
}

export function storeLessonSize(size: number): void {
  try {
    localStorage.setItem(LESSON_KEY, String(size))
  } catch {
    /* storage blocked */
  }
}
