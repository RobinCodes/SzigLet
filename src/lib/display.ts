import { ATTRIBUTES, SHOW_NONE, type Attribute, type Show } from './word'

/**
 * Which word attributes a set shows while studying.
 *
 * Per set and per device, like the study direction: whether you want articles
 * in front of every noun depends on the set and on what you are working on
 * this week, not on an account-wide preference.
 */

const KEY = 'sziglet.show'

export function readShow(slug: string): Show {
  try {
    const saved = localStorage.getItem(`${KEY}.${slug}`)
    if (saved === null) {
      return SHOW_NONE
    }
    const on = new Set(saved.split(',').filter(Boolean))
    return ATTRIBUTES.reduce<Show>(
      (show, attribute) => ({ ...show, [attribute]: on.has(attribute) }),
      { ...SHOW_NONE },
    )
  } catch {
    return SHOW_NONE
  }
}

export function storeShow(slug: string, show: Show): void {
  try {
    const on = ATTRIBUTES.filter((attribute) => show[attribute])
    localStorage.setItem(`${KEY}.${slug}`, on.join(','))
  } catch {
    /* storage blocked */
  }
}

export function toggle(show: Show, attribute: Attribute): Show {
  return { ...show, [attribute]: !show[attribute] }
}
