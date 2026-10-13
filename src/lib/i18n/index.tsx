import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { it, type Dict } from './it'
import { hu } from './hu'
import { en } from './en'

/**
 * Interface languages.
 *
 * Italian is the default because that is the language being learned and the
 * one the shared library is written in; Hungarian and English are there for
 * whoever prefers them. The cards themselves are never translated — those are
 * whatever the editors typed.
 */
export type Lang = 'it' | 'hu' | 'en'

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'it', label: 'Italiano' },
  { value: 'hu', label: 'Magyar' },
  { value: 'en', label: 'English' },
]

export const DEFAULT_LANG: Lang = 'it'

const DICTS: Record<Lang, Dict> = { it, hu, en }

/** Used for dates, numbers and relative times. */
const LOCALE: Record<Lang, string> = { it: 'it-IT', hu: 'hu-HU', en: 'en-GB' }

const STORAGE_KEY = 'sziglet.lang'

// ── Key typing ───────────────────────────────────────────────────────────────
// A mistyped key is a build error rather than a raw string on screen.

type Plural = { one: string; other: string }
type Leaf = string | Plural

type Paths<T> = T extends Leaf
  ? never
  : { [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${Paths<T[K]>}` }[keyof T & string]

export type Key = Paths<Dict>

export type Vars = Record<string, string | number>

// ── Lookup and interpolation ─────────────────────────────────────────────────

function resolve(dict: Dict, key: string): Leaf | undefined {
  let node: unknown = dict
  for (const step of key.split('.')) {
    if (typeof node !== 'object' || node === null) {
      return undefined
    }
    node = (node as Record<string, unknown>)[step]
  }
  if (typeof node === 'string') {
    return node
  }
  if (
    typeof node === 'object' &&
    node !== null &&
    typeof (node as Plural).one === 'string' &&
    typeof (node as Plural).other === 'string'
  ) {
    return node as Plural
  }
  return undefined
}

/** The template for a key, falling back to Italian and then to the key itself. */
function template(lang: Lang, key: string, vars?: Vars): string {
  const found = resolve(DICTS[lang], key) ?? resolve(it, key)
  if (found === undefined) {
    return key
  }
  if (typeof found === 'string') {
    return found
  }
  const n = Number(vars?.n ?? 0)
  return n === 1 ? found.one : found.other
}

function fill(text: string, vars?: Vars): string {
  if (!vars) {
    return text
  }
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

/** Splits a template so that `{name}` placeholders become React nodes. */
function fillNodes(text: string, parts: Record<string, ReactNode>): ReactNode {
  const pieces = text.split(/(\{\w+\})/g)
  return (
    <>
      {pieces.map((piece, index) => {
        const match = /^\{(\w+)\}$/.exec(piece)
        const name = match?.[1]
        if (name !== undefined && name in parts) {
          return <Fragment key={index}>{parts[name]}</Fragment>
        }
        return <Fragment key={index}>{piece}</Fragment>
      })}
    </>
  )
}

// ── Stored preference ────────────────────────────────────────────────────────

export function readLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'it' || saved === 'hu' || saved === 'en') {
      return saved
    }
  } catch {
    /* storage blocked */
  }
  return DEFAULT_LANG
}

/** Keeps `<html lang>` honest, which screen readers and hyphenation rely on. */
export function applyLang(lang: Lang): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang
  }
}

function storeLang(lang: Lang): void {
  try {
    if (lang === DEFAULT_LANG) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, lang)
    }
  } catch {
    /* storage blocked */
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

export type I18n = {
  lang: Lang
  locale: string
  setLang: (lang: Lang) => void
  /** A translated string. Counted keys read `{ n }` out of the variables. */
  t: (key: Key, vars?: Vars) => string
  /** Same, but `{placeholders}` may be React nodes — used for inline markup. */
  tx: (key: Key, parts: Record<string, ReactNode>) => ReactNode
  /** "3 days ago", localised. */
  relative: (unixSeconds: number) => string
  /** "12m 30s", localised. */
  duration: (ms: number) => string
  /** The time-of-day greeting on the library screen. */
  greeting: () => string
}

const I18nContext = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readLang())

  useEffect(() => applyLang(lang), [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    storeLang(next)
    applyLang(next)
  }, [])

  const value = useMemo<I18n>(() => {
    const t = (key: Key, vars?: Vars) => fill(template(lang, key, vars), vars)

    return {
      lang,
      locale: LOCALE[lang],
      setLang,
      t,
      tx: (key, parts) => fillNodes(template(lang, key), parts),

      relative: (unixSeconds: number) => {
        const diff = Math.floor(Date.now() / 1000) - unixSeconds
        if (diff < 60) {
          return t('time.justNow')
        }
        const rtf = new Intl.RelativeTimeFormat(LOCALE[lang], { numeric: 'auto' })
        if (diff < 3600) {
          return rtf.format(-Math.floor(diff / 60), 'minute')
        }
        if (diff < 86400) {
          return rtf.format(-Math.floor(diff / 3600), 'hour')
        }
        const days = Math.floor(diff / 86400)
        if (days < 30) {
          return rtf.format(-days, 'day')
        }
        if (days < 365) {
          return rtf.format(-Math.floor(days / 30), 'month')
        }
        return new Date(unixSeconds * 1000).toLocaleDateString(LOCALE[lang])
      },

      duration: (ms: number) => {
        const seconds = Math.max(0, Math.round(ms / 1000))
        if (seconds < 60) {
          return `${seconds}${t('time.seconds')}`
        }
        const minutes = Math.floor(seconds / 60)
        if (minutes < 60) {
          return `${minutes}${t('time.minutes')} ${seconds % 60}${t('time.seconds')}`
        }
        const hours = Math.floor(minutes / 60)
        return `${hours}${t('time.hours')} ${minutes % 60}${t('time.minutes')}`
      },

      greeting: () => {
        const hour = new Date().getHours()
        if (hour < 5) return t('greeting.night')
        if (hour < 12) return t('greeting.morning')
        if (hour < 18) return t('greeting.afternoon')
        return t('greeting.evening')
      },
    }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const value = useContext(I18nContext)
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider')
  }
  return value
}
