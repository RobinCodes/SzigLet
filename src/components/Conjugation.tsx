import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { PERSONS, type Card, type Person } from '../lib/types'
import { Icon } from './Icon'

/**
 * The pronouns are Italian whatever language the interface is in — they are
 * the thing being learned, not interface furniture.
 */
const PRONOUN: Record<Person, string> = {
  io: 'io',
  tu: 'tu',
  lui: 'lui / lei',
  noi: 'noi',
  voi: 'voi',
  loro: 'loro',
}

/**
 * A verb's six present-tense forms as six little cards, each hiding its form
 * until it is tapped — so the table can be used to test yourself rather than
 * just read, which is the point of having it at all.
 */
export function Conjugation({ card }: { card: Card }) {
  const { t } = useI18n()
  const [open, setOpen] = useState<ReadonlySet<Person>>(new Set())

  const persons = PERSONS.filter((person) => card.extras?.conj?.[person])
  if (persons.length === 0) {
    return null
  }

  const allOpen = persons.every((person) => open.has(person))

  const flip = (person: Person) => {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(person)) {
        next.delete(person)
      } else {
        next.add(person)
      }
      return next
    })
  }

  return (
    <div className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
      <div className="conj">
        {persons.map((person) => {
          const form = card.extras?.conj?.[person] ?? ''
          const shown = open.has(person)
          return (
            <button
              key={person}
              type="button"
              className="conj__card"
              aria-label={`${PRONOUN[person]} — ${shown ? form : t('word.tapToFlip')}`}
              onClick={() => flip(person)}
            >
              <span
                className="conj__inner"
                style={{ transform: shown ? 'rotateX(180deg)' : 'rotateX(0deg)' }}
              >
                <span className="conj__face">{PRONOUN[person]}</span>
                <span className="conj__face conj__face--back">{form}</span>
              </span>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setOpen(allOpen ? new Set() : new Set(persons))}
      >
        <Icon name={allOpen ? 'eye' : 'sparkle'} />
        {allOpen ? t('word.tapToFlip') : t('word.reveal', { what: t('word.conjugation').toLowerCase() })}
      </button>
    </div>
  )
}
