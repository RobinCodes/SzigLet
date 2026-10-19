import type { WordParts } from '../lib/word'

/** A word, with its gender after it when the card records one. */
export function Word({ word, className }: { word: WordParts; className?: string }) {
  return (
    <p className={className}>
      {word.term}
      {word.gender && <span className="word__gender">({word.gender})</span>}
    </p>
  )
}
