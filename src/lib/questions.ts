import type { Question } from './types'
import { shuffle } from './study'
import { gradeAny, normalize, type Grade } from './text'

/** Where a missing-word question puts the answer. */
export const GAP = '___'

export function rightAnswers(question: Question): string[] {
  return question.answers.filter((answer) => answer.ok).map((answer) => answer.t)
}

export function wrongAnswers(question: Question): string[] {
  return question.answers.filter((answer) => !answer.ok).map((answer) => answer.t)
}

/** The text around the gap. A question with no gap is all `before`. */
export function splitGap(body: string): { before: string; after: string; hasGap: boolean } {
  const at = body.indexOf(GAP)
  if (at < 0) {
    return { before: body, after: '', hasGap: false }
  }
  // Any run of underscores is one gap.
  const end = body.slice(at).match(/^_+/)?.[0].length ?? GAP.length
  return { before: body.slice(0, at), after: body.slice(at + end), hasGap: true }
}

/**
 * The options a multiple-choice question offers. A short list is shown
 * whole; a long one — a whole word set imported as answers — is cut down to
 * one right answer and five wrong ones, so it stays a question and not a
 * scroll.
 */
export function choiceOptions(question: Question, limit = 6): string[] {
  const right = rightAnswers(question)
  const wrong = wrongAnswers(question)
  if (right.length + wrong.length <= limit) {
    return shuffle([...right, ...wrong])
  }
  const one = shuffle(right).slice(0, 1)
  return shuffle([...one, ...shuffle(wrong).slice(0, limit - 1)])
}

/** Whether a picked option is one of the right ones. */
export function isRight(question: Question, option: string): boolean {
  return rightAnswers(question).some((answer) => normalize(answer) === normalize(option))
}

export function gradeTyped(question: Question, typed: string): Grade {
  return gradeAny(typed, rightAnswers(question))
}

/** The first right answer: what is revealed after a miss. */
export function mainAnswer(question: Question): string {
  return rightAnswers(question)[0] ?? ''
}
