import { useI18n } from '../lib/i18n'
import type { Attribute, WordParts } from '../lib/word'
import { Icon } from './Icon'

/**
 * A word with whatever grammar the round is showing: the article in front,
 * the gender after, the plural on a line of its own.
 */
export function Word({ word, className }: { word: WordParts; className?: string }) {
  return (
    <>
      <p className={className}>
        {word.article && <span className="word__article">{word.article} </span>}
        {word.term}
        {word.gender && <span className="word__gender">({word.gender})</span>}
      </p>
      {word.plural && <p className="word__plural">{word.plural}</p>}
    </>
  )
}

/**
 * The other half of the same idea: an attribute this card carries but that the
 * round is not showing is offered as a button rather than hidden outright, so
 * a reader can check the gender of one awkward noun without turning gender on
 * for the whole set.
 */
export function RevealChips({
  attributes,
  onReveal,
}: {
  attributes: Attribute[]
  onReveal: (attribute: Attribute) => void
}) {
  const { t } = useI18n()

  if (attributes.length === 0) {
    return null
  }

  return (
    <div className="revealrow">
      {attributes.map((attribute) => (
        <button
          key={attribute}
          type="button"
          className="chip chip--button"
          onClick={(event) => {
            // The card underneath treats a tap as a flip.
            event.stopPropagation()
            onReveal(attribute)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Icon name="plus" width={11} height={11} />
          {t(`word.${attribute}`)}
        </button>
      ))}
    </div>
  )
}
