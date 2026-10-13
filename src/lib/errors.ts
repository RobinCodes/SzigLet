import { ApiError } from './api'
import type { I18n, Key } from './i18n'

/**
 * Turns whatever a request threw into something worth showing a reader.
 *
 * The two failures the client invents itself — no connection, and a reply that
 * was not JSON — are translated. Everything else is a sentence the API wrote,
 * and is passed through: the server speaks one language, and inventing a
 * second copy of its validation messages here would only let the two drift.
 */
export function errorText(t: I18n['t'], caught: unknown, fallback: Key): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'offline') {
      return t('errors.offline')
    }
    if (caught.code === 'bad_response') {
      return t('errors.badResponse')
    }
    return caught.message
  }
  return t(fallback)
}
