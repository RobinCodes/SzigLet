import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, type CardInput } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import {
  PERSONS,
  type Author,
  type Card,
  type CardExtras,
  type Gender,
  type Person,
  type SetKind,
  type Side,
  type StudySet,
  type Variant,
} from '../lib/types'
import { PRONOUN, alternatives, field } from '../lib/variants'
import { exportQuestions, exportWords, parseQuestions, parseWords, type WordRecord } from '../lib/exchange'
import { Shell, TopBar } from '../components/Shell'
import { Segmented, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { AuthorPicker } from '../components/AuthorPicker'
import {
  QuestionForm,
  draftKey,
  isBlank,
  newQuestion,
  problemWith,
  toDraft,
  toInput,
  type QuestionDraft,
} from '../components/QuestionForm'
import { ExportSheet } from './SetView'

// ── Cards as the editor holds them ──────────────────────────────────────────

type Row = {
  key: string
  id?: number
  verb: boolean
  /** The variations this card shows, in order. */
  order: string[]
  fields: Record<string, string>
  conj: Partial<Record<Person, string>>
  note: string
  showNote: boolean
  gender: Partial<Record<Side, Gender>>
  only?: Side
  pref: Record<string, number[]>
  showSettings: boolean
}

let rowCounter = 0

function newRow(defaults: string[], verb = false): Row {
  const order = defaults.filter((key) => !(PERSONS as readonly string[]).includes(key))
  return {
    key: `row-${rowCounter++}`,
    verb,
    order: order.length >= 2 ? order : ['a', 'b'],
    fields: {},
    conj: {},
    note: '',
    showNote: false,
    gender: {},
    pref: {},
    showSettings: false,
  }
}

function cardToRow(card: Card, variants: Variant[]): Row {
  const order = variants.map((variant) => variant.key).filter((key) => field(card, key).trim())
  for (const key of ['a', 'b']) {
    if (order.length < 2 && !order.includes(key)) order.push(key)
  }
  return {
    key: `row-${rowCounter++}`,
    id: card.id,
    verb: card.extras?.type === 'verb' || Boolean(card.extras?.conj),
    order,
    fields: Object.fromEntries(order.map((key) => [key, field(card, key)])),
    conj: card.extras?.conj ?? {},
    note: card.note ?? '',
    showNote: Boolean(card.note),
    gender: card.extras?.gender ?? {},
    only: card.extras?.only,
    pref: card.extras?.pref ?? {},
    showSettings: false,
  }
}

function recordToRow(record: WordRecord, variants: Variant[]): Row {
  const order = variants.map((variant) => variant.key).filter((key) => record.fields[key]?.trim())
  return {
    ...newRow(['a', 'b'], Boolean(record.conj && Object.keys(record.conj).length)),
    order: order.length >= 2 || record.conj ? order : ['a', 'b'],
    fields: record.fields,
    conj: record.conj ?? {},
    note: record.note ?? '',
    showNote: Boolean(record.note),
    gender: record.gender ?? {},
    only: record.only,
    pref: record.pref ?? {},
  }
}

function value(row: Row, key: string): string {
  return row.order.includes(key) ? (row.fields[key] ?? '').trim() : ''
}

function rowToRecord(row: Row): WordRecord {
  return {
    fields: Object.fromEntries(row.order.map((key) => [key, value(row, key)])),
    note: row.note.trim() || undefined,
    gender: row.gender,
    conj: row.verb ? row.conj : undefined,
    only: row.only,
    pref: row.pref,
  }
}

/** The card to save; null for an untouched row; 'incomplete' for one side only. */
function rowToInput(row: Row): CardInput | null | 'incomplete' {
  const a = value(row, 'a')
  const b = value(row, 'b')
  const v: Record<string, string> = {}
  for (const key of row.order) {
    if (key !== 'a' && key !== 'b' && value(row, key)) v[key] = value(row, key)
  }
  const conj: Partial<Record<Person, string>> = {}
  if (row.verb) {
    for (const person of PERSONS) {
      const form = row.conj[person]?.trim()
      if (form) conj[person] = form
    }
  }
  const filled = (a ? 1 : 0) + (b ? 1 : 0) + Object.keys(v).length + Object.keys(conj).length
  if (filled === 0) {
    return row.note.trim() ? 'incomplete' : null
  }
  if (filled < 2) {
    return 'incomplete'
  }

  const pref: Record<string, number[]> = {}
  for (const key of row.order) {
    const count = alternatives(value(row, key)).length
    const chosen = (row.pref[key] ?? []).filter((index) => index < count)
    if (count > 1 && chosen.length > 0 && !(chosen.length === 1 && chosen[0] === 0)) {
      pref[key] = chosen
    }
  }
  const gender: Partial<Record<Side, Gender>> = {}
  for (const side of ['a', 'b'] as const) {
    if (row.gender[side] && value(row, side)) gender[side] = row.gender[side]
  }

  const extras: CardExtras = {
    ...(Object.keys(v).length ? { v } : {}),
    ...(Object.keys(conj).length ? { conj } : {}),
    ...(Object.keys(gender).length ? { gender } : {}),
    ...(Object.keys(pref).length ? { pref } : {}),
    ...(row.only ? { only: row.only } : {}),
    ...(row.verb ? { type: 'verb' as const } : {}),
  }
  return {
    ...(row.id ? { id: row.id } : {}),
    a,
    b,
    ...(row.note.trim() ? { note: row.note.trim() } : {}),
    ...(Object.keys(extras).length ? { extras } : {}),
  }
}

function nextVariantKey(variants: Variant[]): string {
  let n = 1
  while (variants.some((variant) => variant.key === `v${n}`)) n++
  return `v${n}`
}

// ── Adding a variation to a card ────────────────────────────────────────────

type Suggestion = { name: string; side: Side }

/**
 * The little + after a card's fields: the set's other variations, a few
 * common ones, or a name of your own.
 */
function FieldAdder({
  available,
  suggestions,
  langA,
  langB,
  onPick,
  onCreate,
}: {
  available: Variant[]
  suggestions: Suggestion[]
  langA: string
  langB: string
  onPick: (key: string) => void
  onCreate: (name: string, side: Side) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState<string | null>(null)
  const [side, setSide] = useState<Side>('a')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const close = (event: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) {
        setOpen(false)
        setCustom(null)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const done = () => {
    setOpen(false)
    setCustom(null)
  }

  return (
    <div className="fieldadd" ref={box}>
      <button
        type="button"
        className="fieldadd__btn"
        aria-label={t('variants.addField')}
        title={t('variants.addField')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="plus" width={16} height={16} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {available.length > 0 && <p className="menu__head">{t('variants.inSet')}</p>}
          {available.map((variant) => (
            <button
              key={variant.key}
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                onPick(variant.key)
                done()
              }}
            >
              {variant.name}
            </button>
          ))}
          {suggestions.length > 0 && <p className="menu__head">{t('variants.common')}</p>}
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.name}
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                onCreate(suggestion.name, suggestion.side)
                done()
              }}
            >
              {suggestion.name}
            </button>
          ))}
          <div className="menu__sep" />
          {custom === null ? (
            <button type="button" role="menuitem" className="menu__item" onClick={() => setCustom('')}>
              <Icon name="edit" width={14} height={14} />
              {t('variants.custom')}
            </button>
          ) : (
            <form
              className="menu__custom"
              onSubmit={(event) => {
                event.preventDefault()
                if (custom.trim()) {
                  onCreate(custom.trim().slice(0, 40), side)
                  done()
                }
              }}
            >
              <input
                className="input"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder={t('variants.customPlaceholder')}
                maxLength={40}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
              <select className="select" value={side} onChange={(event) => setSide(event.target.value as Side)}>
                <option value="a">{langA}</option>
                <option value="b">{langB}</option>
              </select>
              <button type="submit" className="btn btn--primary btn--sm" disabled={!custom.trim()}>
                {t('variants.add')}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

// ── One card ────────────────────────────────────────────────────────────────

function CardEditor({
  row,
  index,
  total,
  variants,
  suggestions,
  langA,
  langB,
  onChange,
  onRemove,
  onMove,
  onCreateVariant,
}: {
  row: Row
  index: number
  total: number
  variants: Variant[]
  suggestions: Suggestion[]
  langA: string
  langB: string
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
  onMove: (offset: number) => void
  onCreateVariant: (name: string, side: Side) => string
}) {
  const { t } = useI18n()
  const nameOf = (key: string) => variants.find((variant) => variant.key === key)?.name ?? key
  const available = variants.filter((variant) => !row.order.includes(variant.key))
  const multi = row.order.filter((key) => alternatives(row.fields[key] ?? '').length > 1)

  const setField = (key: string, text: string) => onChange({ fields: { ...row.fields, [key]: text } })
  const removeField = (key: string) => onChange({ order: row.order.filter((other) => other !== key) })
  const addField = (key: string) => onChange({ order: [...row.order, key] })

  const togglePref = (key: string, alt: number) => {
    const current = row.pref[key] ?? [0]
    const next = current.includes(alt) ? current.filter((i) => i !== alt) : [...current, alt].sort()
    // At least one alternative has to stay preferred.
    if (next.length > 0) {
      onChange({ pref: { ...row.pref, [key]: next } })
    }
  }

  return (
    <div className={`editcard${row.verb ? ' editcard--verb' : ''}`}>
      <div className="editcard__top">
        <span className="tiny faint num">{index + 1}</span>
        {row.verb && <span className="chip chip--accent">{t('word.verb')}</span>}
        <span className="grow" />
        <button
          type="button"
          className={`icon-btn icon-btn--sm${row.showSettings ? ' icon-btn--on' : ''}`}
          aria-label={t('editor.cardSettings')}
          aria-expanded={row.showSettings}
          onClick={() => onChange({ showSettings: !row.showSettings })}
        >
          <Icon name="settings" />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          aria-label={t('editor.moveUp')}
          onClick={() => onMove(-1)}
          disabled={index === 0}
        >
          <Icon name="chevronDown" style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          aria-label={t('editor.moveDown')}
          onClick={() => onMove(1)}
          disabled={index === total - 1}
        >
          <Icon name="chevronDown" />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" aria-label={t('editor.removeCard')} onClick={onRemove}>
          <Icon name="trash" />
        </button>
      </div>

      <div className="vfields">
        {row.order.map((key) => (
          <label className="vfield" key={key}>
            <span className="vfield__label truncate">{nameOf(key)}</span>
            <input
              className="input"
              value={row.fields[key] ?? ''}
              onChange={(event) => setField(key, event.target.value)}
              placeholder={nameOf(key)}
              aria-label={t('editor.sideAria', { lang: nameOf(key), n: index + 1 })}
              maxLength={300}
            />
            {/* Two fields is the least a card can be. */}
            {row.order.length > (row.verb ? 1 : 2) && (
              <button
                type="button"
                className="vfield__x"
                aria-label={t('variants.removeField', { name: nameOf(key) })}
                onClick={(event) => {
                  event.preventDefault()
                  removeField(key)
                }}
              >
                <Icon name="x" width={12} height={12} />
              </button>
            )}
          </label>
        ))}
        <FieldAdder
          available={available}
          suggestions={suggestions}
          langA={langA}
          langB={langB}
          onPick={addField}
          onCreate={(name, side) => addField(onCreateVariant(name, side))}
        />
      </div>

      {row.verb && (
        <div className="editcard__panel">
          <div className="editcard__conj">
            {PERSONS.map((person) => (
              <label className="field" key={person}>
                <span className="field__label">{PRONOUN[person]}</span>
                <input
                  className="input"
                  value={row.conj[person] ?? ''}
                  onChange={(event) => onChange({ conj: { ...row.conj, [person]: event.target.value } })}
                  maxLength={160}
                />
              </label>
            ))}
          </div>
          <p className="field__hint">{t('editor.conjugationHint')}</p>
        </div>
      )}

      {row.showNote && (
        <div className="editcard__note">
          <input
            className="input"
            value={row.note}
            onChange={(event) => onChange({ note: event.target.value })}
            placeholder={t('editor.notePlaceholder')}
            aria-label={t('editor.noteAria', { n: index + 1 })}
            maxLength={300}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={row.note === ''}
          />
          <button
            type="button"
            className="icon-btn"
            style={{ width: '2rem', height: '2.5rem' }}
            aria-label={t('editor.removeNote')}
            onClick={() => onChange({ note: '', showNote: false })}
          >
            <Icon name="x" style={{ width: 15, height: 15 }} />
          </button>
        </div>
      )}

      {row.showSettings && (
        <div className="editcard__panel">
          <div className="field">
            <span className="field__label">{t('editor.askedWhichWay')}</span>
            <Segmented
              label={t('editor.askedWhichWay')}
              value={row.only ?? 'both'}
              onChange={(next) => onChange({ only: next === 'both' ? undefined : (next as Side) })}
              options={[
                { value: 'both', label: t('editor.bothWays') },
                { value: 'a', label: `${langA} → ${langB}` },
                { value: 'b', label: `${langB} → ${langA}` },
              ]}
            />
            <p className="field__hint">{t('editor.oneWayHint')}</p>
          </div>

          {multi.length > 0 && (
            <div className="field">
              <span className="field__label">{t('editor.preferred')}</span>
              {multi.map((key) => (
                <div key={key} className="togglerow">
                  <span className="tiny faint" style={{ minWidth: '5rem' }}>
                    {nameOf(key)}
                  </span>
                  {alternatives(row.fields[key] ?? '').map((alt, altIndex) => {
                    const on = (row.pref[key] ?? [0]).includes(altIndex)
                    return (
                      <button
                        key={alt + altIndex}
                        type="button"
                        className={`chip chip--button${on ? ' chip--accent' : ''}`}
                        aria-pressed={on}
                        onClick={() => togglePref(key, altIndex)}
                      >
                        {on && <Icon name="star" width={11} height={11} />}
                        {alt}
                      </button>
                    )
                  })}
                </div>
              ))}
              <p className="field__hint">{t('editor.preferredHint')}</p>
            </div>
          )}

          <div className="field">
            <span className="field__label">{t('word.gender')}</span>
            <div className="row" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
              {(['a', 'b'] as const).map((side) => (
                <select
                  key={side}
                  className="select grow"
                  value={row.gender[side] ?? ''}
                  onChange={(event) =>
                    onChange({
                      gender: {
                        ...row.gender,
                        [side]: event.target.value === 'm' || event.target.value === 'f' ? event.target.value : undefined,
                      },
                    })
                  }
                  aria-label={t('editor.genderFor', { side: side === 'a' ? langA : langB })}
                >
                  <option value="">
                    {side === 'a' ? langA : langB}: {t('word.none')}
                  </option>
                  <option value="m">
                    {side === 'a' ? langA : langB}: m — {t('word.masculine')}
                  </option>
                  <option value="f">
                    {side === 'a' ? langA : langB}: f — {t('word.feminine')}
                  </option>
                </select>
              ))}
            </div>
          </div>

          <label className="switch">
            <input type="checkbox" checked={row.verb} onChange={(event) => onChange({ verb: event.target.checked })} />
            <span className="switch__track" />
            <span className="small">{t('editor.isVerb')}</span>
          </label>
        </div>
      )}

      {!row.showNote && (
        <div className="editcard__add">
          <button type="button" className="chip chip--button" onClick={() => onChange({ showNote: true })}>
            <Icon name="plus" width={11} height={11} />
            {t('editor.addNote')}
          </button>
        </div>
      )}
    </div>
  )
}

// ── The set's variations ────────────────────────────────────────────────────

function VariantsPanel({
  variants,
  defaults,
  langA,
  langB,
  suggestions,
  onRename,
  onSide,
  onRemove,
  onCreate,
  onDefaults,
}: {
  variants: Variant[]
  defaults: string[]
  langA: string
  langB: string
  suggestions: Suggestion[]
  onRename: (key: string, name: string) => void
  onSide: (key: string, side: Side) => void
  onRemove: (key: string) => void
  onCreate: (name: string, side: Side) => void
  onDefaults: (next: string[]) => void
}) {
  const { t } = useI18n()
  const [custom, setCustom] = useState('')
  const [side, setSide] = useState<Side>('a')

  const toggleDefault = (key: string) => {
    const next = defaults.includes(key) ? defaults.filter((other) => other !== key) : [...defaults, key]
    // Keep the set's order, so new cards lay their fields out the same way.
    const ordered = variants.map((variant) => variant.key).filter((other) => next.includes(other))
    if (ordered.length >= 2) {
      onDefaults(ordered)
    }
  }

  return (
    <div className="panel stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
      <p className="small muted">{t('variants.panelHint')}</p>
      <div className="stack" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
        {variants.map((variant) => {
          const base = variant.key === 'a' || variant.key === 'b'
          return (
            <div className="variantrow" key={variant.key}>
              <label className="variantrow__default" title={t('variants.onNewCards')}>
                <input
                  type="checkbox"
                  checked={defaults.includes(variant.key)}
                  onChange={() => toggleDefault(variant.key)}
                  aria-label={t('variants.onNewCardsFor', { name: variant.name })}
                />
              </label>
              {base ? (
                <span className="grow small" style={{ fontWeight: 600 }}>
                  {variant.name}
                </span>
              ) : (
                <input
                  className="input grow"
                  value={variant.name}
                  onChange={(event) => onRename(variant.key, event.target.value)}
                  maxLength={40}
                  aria-label={t('variants.name')}
                />
              )}
              {base ? (
                <span className="chip">{t('variants.language')}</span>
              ) : (
                <select
                  className="select"
                  value={variant.side}
                  onChange={(event) => onSide(variant.key, event.target.value as Side)}
                  aria-label={t('variants.languageOf', { name: variant.name })}
                >
                  <option value="a">{langA}</option>
                  <option value="b">{langB}</option>
                </select>
              )}
              {!base && (
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  aria-label={t('variants.removeVariant', { name: variant.name })}
                  onClick={() => onRemove(variant.key)}
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <p className="tiny faint">{t('variants.defaultsHint')}</p>
      <div className="togglerow">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.name}
            type="button"
            className="chip chip--button"
            onClick={() => onCreate(suggestion.name, suggestion.side)}
          >
            <Icon name="plus" width={11} height={11} />
            {suggestion.name}
          </button>
        ))}
      </div>
      <form
        className="row"
        style={{ '--gap': '0.4rem' } as React.CSSProperties}
        onSubmit={(event) => {
          event.preventDefault()
          if (custom.trim()) {
            onCreate(custom.trim().slice(0, 40), side)
            setCustom('')
          }
        }}
      >
        <input
          className="input grow"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          placeholder={t('variants.customPlaceholder')}
          maxLength={40}
        />
        <select className="select" value={side} onChange={(event) => setSide(event.target.value as Side)}>
          <option value="a">{langA}</option>
          <option value="b">{langB}</option>
        </select>
        <button type="submit" className="btn btn--sm" disabled={!custom.trim()}>
          {t('variants.add')}
        </button>
      </form>
    </div>
  )
}

// ── The editor ──────────────────────────────────────────────────────────────

export function Editor() {
  const { slug } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const { t, tx } = useI18n()
  const editing = Boolean(slug)

  const [existing, setExisting] = useState<StudySet | null>(null)
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)

  const [kind, setKind] = useState<SetKind>(params.get('kind') === 'questions' ? 'questions' : 'words')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [langA, setLangA] = useState('Italian')
  const [langB, setLangB] = useState('Hungarian')
  const [published, setPublished] = useState(true)
  const [authors, setAuthors] = useState<Author[]>(user ? [{ id: user.id, username: user.username }] : [])
  const [extra, setExtra] = useState<Variant[]>([])
  const [defaults, setDefaults] = useState<string[]>(['a', 'b'])
  const [rows, setRows] = useState<Row[]>(() => [newRow(['a', 'b']), newRow(['a', 'b']), newRow(['a', 'b'])])
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => [newQuestion()])
  const [showVariants, setShowVariants] = useState(false)

  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [exporting, setExporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removing, setRemoving] = useState<Variant | null>(null)

  const variants = useMemo<Variant[]>(
    () => [
      { key: 'a', name: langA || t('editor.front'), side: 'a' },
      { key: 'b', name: langB || t('editor.back'), side: 'b' },
      ...extra,
    ],
    [langA, langB, extra, t],
  )

  const suggestions = useMemo<Suggestion[]>(
    () =>
      [
        { name: t('variants.plural', { lang: langA }), side: 'a' as Side },
        { name: t('variants.withArticle', { lang: langA }), side: 'a' as Side },
        { name: t('variants.articlePlural', { lang: langA }), side: 'a' as Side },
        { name: t('variants.plural', { lang: langB }), side: 'b' as Side },
      ].filter((suggestion) => !variants.some((variant) => variant.name.toLowerCase() === suggestion.name.toLowerCase())),
    [langA, langB, variants, t],
  )

  useEffect(() => {
    if (!slug) {
      return
    }
    api
      .set(slug)
      .then((result) => {
        const loadedVariants = result.variants && result.variants.length >= 2
          ? result.variants
          : [
              { key: 'a', name: result.langA, side: 'a' as Side },
              { key: 'b', name: result.langB, side: 'b' as Side },
            ]
        setExisting(result)
        setKind(result.kind ?? 'words')
        setTitle(result.title)
        setDescription(result.description ?? '')
        setLangA(result.langA)
        setLangB(result.langB)
        setPublished(result.published)
        setAuthors(result.authors ?? [])
        setExtra(loadedVariants.filter((variant) => variant.key !== 'a' && variant.key !== 'b'))
        setDefaults(result.defaults ?? ['a', 'b'])
        setRows(
          result.cards.length > 0
            ? result.cards.map((card) => cardToRow(card, loadedVariants))
            : [newRow(result.defaults ?? ['a', 'b'])],
        )
        setQuestions(result.questions && result.questions.length > 0 ? result.questions.map(toDraft) : [newQuestion()])
      })
      .catch((caught: unknown) => {
        toast.error(errorText(t, caught, 'editor.loadFailed'))
        navigate('/', { replace: true })
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const move = <T,>(list: T[], index: number, offset: number): T[] => {
    const target = index + offset
    if (target < 0 || target >= list.length) {
      return list
    }
    const next = list.slice()
    const a = next[index]!
    next[index] = next[target]!
    next[target] = a
    return next
  }

  /** Adds a variation to the set (or finds one by that name) and returns its key. */
  const createVariant = (name: string, side: Side): string => {
    const found = variants.find((variant) => variant.name.toLowerCase() === name.toLowerCase())
    if (found) {
      return found.key
    }
    const key = nextVariantKey(variants)
    setExtra((current) => [...current, { key, name, side }])
    return key
  }

  const removeVariant = (key: string) => {
    setExtra((current) => current.filter((variant) => variant.key !== key))
    setDefaults((current) => {
      const next = current.filter((other) => other !== key)
      return next.length >= 2 ? next : ['a', 'b']
    })
    setRows((current) => current.map((row) => ({ ...row, order: row.order.filter((other) => other !== key) })))
    setRemoving(null)
  }

  const askRemoveVariant = (key: string) => {
    const variant = extra.find((other) => other.key === key)
    if (!variant) return
    const used = rows.some((row) => row.order.includes(key) && (row.fields[key] ?? '').trim())
    if (used) {
      setRemoving(variant)
    } else {
      removeVariant(key)
    }
  }

  // ── Paste and export ──────────────────────────────────────────────────────

  const parsedWords = kind === 'words' ? parseWords(pasteText, variants) : null
  const parsedQuestions = kind === 'questions' ? parseQuestions(pasteText) : null
  const parsedCount = parsedWords?.records.length ?? parsedQuestions?.length ?? 0

  const applyPaste = () => {
    if (parsedCount === 0) {
      toast.error(t('editor.pasteNone'))
      return
    }
    if (parsedWords) {
      const all = [...variants, ...parsedWords.added]
      setExtra((current) => [...current, ...parsedWords.added])
      setRows((current) => [
        ...current.filter((row) => rowToInput(row) !== null),
        ...parsedWords.records.map((record) => recordToRow(record, all)),
      ])
    } else if (parsedQuestions) {
      setQuestions((current) => [
        ...current.filter((draft) => !isBlank(draft)),
        ...parsedQuestions.map((record) => ({
          key: draftKey(),
          kind: record.kind,
          instruction: record.instruction,
          body: record.body,
          answers: record.answers.map((answer) => ({ key: draftKey('a'), ...answer })),
          note: record.note,
        })),
      ])
    }
    setPasteText('')
    setPasting(false)
    toast.success(t('editor.pasteAdded', { n: parsedCount }))
  }

  const exportText = () =>
    kind === 'words'
      ? exportWords(variants, rows.filter((row) => rowToInput(row) !== null).map(rowToRecord))
      : exportQuestions(
          questions.filter((draft) => !isBlank(draft)).map((draft) => ({
            kind: draft.kind,
            instruction: draft.instruction,
            body: draft.body,
            answers: draft.answers.filter((answer) => answer.t.trim()),
            note: draft.note,
          })),
        )

  // ── Saving ────────────────────────────────────────────────────────────────

  const save = async () => {
    if (!title.trim()) {
      toast.error(t('editor.needTitle'))
      return
    }
    if (kind === 'words' && (!langA.trim() || !langB.trim())) {
      toast.error(t('editor.needLangs'))
      return
    }
    if (extra.some((variant) => !variant.name.trim())) {
      toast.error(t('variants.needName'))
      return
    }

    const payload = {
      title: title.trim(),
      description: description.trim(),
      langA: langA.trim() || 'Italian',
      langB: langB.trim() || 'Hungarian',
      published,
      authors: authors.map((author) => author.id),
    }

    let body
    if (kind === 'words') {
      const converted = rows.map(rowToInput)
      const incomplete = converted.findIndex((card) => card === 'incomplete')
      if (incomplete >= 0) {
        toast.error(t('editor.needTwoSides', { n: incomplete + 1 }))
        return
      }
      const cards = converted.filter((card): card is CardInput => card !== null && card !== 'incomplete')
      if (cards.length === 0) {
        toast.error(t('editor.needPair'))
        return
      }
      body = { ...payload, variants, defaults, cards }
    } else {
      const kept = questions.filter((draft) => !isBlank(draft))
      const broken = kept.findIndex((draft) => problemWith(draft) !== null)
      if (broken >= 0) {
        toast.error(t('questions.fixOne', { n: broken + 1 }))
        return
      }
      if (kept.length === 0) {
        toast.error(t('questions.needOne'))
        return
      }
      body = { ...payload, questions: kept.map(toInput) }
    }

    setSaving(true)
    try {
      const result = existing
        ? await api.updateSet(existing.id, body)
        : await api.createSet({ ...body, kind })
      toast.success(existing ? t('editor.updated') : t('editor.created'))
      navigate(`/s/${result.slug}`, { replace: true })
    } catch (caught) {
      toast.error(errorText(t, caught, 'editor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const destroy = async () => {
    if (!existing) {
      return
    }
    try {
      await api.deleteSet(existing.id)
      toast.success(t('editor.deleted'))
      navigate('/', { replace: true })
    } catch (caught) {
      toast.error(errorText(t, caught, 'editor.deleteFailed'))
    }
  }

  if (loading) {
    return (
      <Shell>
        <TopBar back="/" />
        <Spinner />
      </Shell>
    )
  }

  const complete = rows.filter((row) => {
    const input = rowToInput(row)
    return input !== null && input !== 'incomplete'
  }).length
  const questionCount = questions.filter((draft) => !isBlank(draft)).length

  return (
    <Shell>
      <TopBar
        back={existing ? `/s/${existing.slug}` : '/'}
        title={
          existing
            ? kind === 'words'
              ? t('editor.editSet')
              : t('editor.editQuestionSet')
            : kind === 'words'
              ? t('editor.newSet')
              : t('editor.newQuestionSet')
        }
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : <Icon name="check" />}
            {t('common.save')}
          </button>
        }
      />

      <div className="stack" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
        <section className="stack" style={{ '--gap': '0.875rem' } as React.CSSProperties}>
          <div className="field">
            <label className="field__label" htmlFor="title">
              {t('editor.title')}
            </label>
            <input
              id="title"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={kind === 'words' ? t('editor.titlePlaceholder') : t('editor.questionTitlePlaceholder')}
              maxLength={120}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="description">
              {t('editor.description')} <span className="faint">{t('editor.optional')}</span>
            </label>
            <input
              id="description"
              className="input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('editor.descriptionPlaceholder')}
              maxLength={500}
            />
          </div>

          {kind === 'words' && (
            <div className="row" style={{ '--gap': '0.5rem', alignItems: 'flex-end' } as React.CSSProperties}>
              <div className="field grow">
                <label className="field__label" htmlFor="langA">
                  {t('editor.frontSide')}
                </label>
                <input
                  id="langA"
                  className="input"
                  value={langA}
                  onChange={(event) => setLangA(event.target.value)}
                  placeholder="Italiano"
                  maxLength={40}
                />
              </div>
              <Icon name="swap" style={{ color: 'var(--ink-faint)', marginBottom: '0.9rem' }} />
              <div className="field grow">
                <label className="field__label" htmlFor="langB">
                  {t('editor.backSide')}
                </label>
                <input
                  id="langB"
                  className="input"
                  value={langB}
                  onChange={(event) => setLangB(event.target.value)}
                  placeholder="Magyar"
                  maxLength={40}
                />
              </div>
            </div>
          )}

          <AuthorPicker value={authors} onChange={setAuthors} />

          <label className="switch">
            <input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} />
            <span className="switch__track" />
            <span className="small">{published ? t('editor.visible') : t('editor.draftOnly')}</span>
          </label>
        </section>

        {kind === 'words' && (
          <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <button
              type="button"
              className="spread disclosure"
              aria-expanded={showVariants}
              onClick={() => setShowVariants((value) => !value)}
            >
              <span className="eyebrow">{t('variants.title', { n: variants.length })}</span>
              <Icon name="chevronDown" style={{ transform: showVariants ? 'rotate(180deg)' : undefined }} />
            </button>
            {showVariants && (
              <VariantsPanel
                variants={variants}
                defaults={defaults}
                langA={langA}
                langB={langB}
                suggestions={suggestions}
                onRename={(key, name) =>
                  setExtra((current) => current.map((variant) => (variant.key === key ? { ...variant, name } : variant)))
                }
                onSide={(key, side) =>
                  setExtra((current) => current.map((variant) => (variant.key === key ? { ...variant, side } : variant)))
                }
                onRemove={askRemoveVariant}
                onCreate={(name, side) => void createVariant(name, side)}
                onDefaults={setDefaults}
              />
            )}
          </section>
        )}

        <section>
          <div className="spread" style={{ marginBottom: '0.6rem' }}>
            <p className="eyebrow">
              {kind === 'words' ? t('editor.cards', { n: complete }) : t('set.questions', { n: questionCount })}
            </p>
            <div className="row" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setExporting(true)}>
                <Icon name="share" />
                {t('exchange.export')}
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setPasting(true)}>
                <Icon name="list" />
                {t('editor.pasteList')}
              </button>
            </div>
          </div>

          {kind === 'words' ? (
            <>
              <div className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
                {rows.map((row, index) => (
                  <CardEditor
                    key={row.key}
                    row={row}
                    index={index}
                    total={rows.length}
                    variants={variants}
                    suggestions={suggestions}
                    langA={langA || t('editor.front')}
                    langB={langB || t('editor.back')}
                    onChange={(patch) => update(row.key, patch)}
                    onRemove={() =>
                      setRows((current) =>
                        current.length <= 1 ? [newRow(defaults)] : current.filter((other) => other.key !== row.key),
                      )
                    }
                    onMove={(offset) => setRows((current) => move(current, index, offset))}
                    onCreateVariant={createVariant}
                  />
                ))}
              </div>

              <div className="row" style={{ '--gap': '0.5rem', marginTop: '0.75rem' } as React.CSSProperties}>
                <button
                  type="button"
                  className="btn grow"
                  onClick={() => setRows((current) => [...current, newRow(defaults)])}
                >
                  <Icon name="plus" />
                  {t('editor.addCard')}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setRows((current) => [...current, newRow(['a', 'b'], true)])}
                >
                  <Icon name="plus" />
                  {t('editor.addVerb')}
                </button>
              </div>

              <div className="stack" style={{ '--gap': '0.4rem', marginTop: '0.75rem' } as React.CSSProperties}>
                <p className="field__hint">{t('variants.cardHint')}</p>
                <p className="field__hint">{t('editor.noteHint')}</p>
                <p className="field__hint">{tx('editor.altHint', { example: <code>ház; épület</code> })}</p>
              </div>
            </>
          ) : (
            <>
              <div className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
                {questions.map((draft, index) => (
                  <QuestionForm
                    key={draft.key}
                    draft={draft}
                    index={index}
                    total={questions.length}
                    onChange={(next) =>
                      setQuestions((current) => current.map((other) => (other.key === draft.key ? next : other)))
                    }
                    onRemove={() =>
                      setQuestions((current) =>
                        current.length <= 1 ? [newQuestion()] : current.filter((other) => other.key !== draft.key),
                      )
                    }
                    onMove={(offset) => setQuestions((current) => move(current, index, offset))}
                  />
                ))}
              </div>
              <button
                type="button"
                className="btn btn--block"
                style={{ marginTop: '0.75rem' }}
                onClick={() => setQuestions((current) => [...current, newQuestion()])}
              >
                <Icon name="plus" />
                {t('questions.add')}
              </button>
            </>
          )}
        </section>

        <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : <Icon name="check" />}
            {existing ? t('editor.saveChanges') : t('editor.createSet')}
          </button>
          {existing && (
            <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" />
              {t('editor.deleteSet')}
            </button>
          )}
        </section>
      </div>

      {pasting && (
        <Sheet
          title={kind === 'words' ? t('editor.pasteTitle') : t('questions.pasteTitle')}
          onClose={() => setPasting(false)}
          footer={
            <>
              <button type="button" className="btn btn--primary btn--block" onClick={applyPaste}>
                {parsedCount > 0
                  ? kind === 'words'
                    ? t('editor.pasteAdd', { n: parsedCount })
                    : t('questions.pasteAdd', { n: parsedCount })
                  : t('editor.pasteAddEmpty')}
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={() => setPasting(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <p className="muted small" style={{ marginBottom: '0.75rem' }}>
            {kind === 'words' ? t('editor.pasteBody') : t('questions.pasteBody')}
          </p>
          <textarea
            className="input input--mono"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={
              kind === 'words'
                ? 'la cucina, konyha\nil frigorifero, hűtő\nil coltello, kés'
                : '! Scegli l’articolo\n? ___ casa è grande\n+ La\n- Il\n- Lo'
            }
            rows={8}
          />
          {parsedWords && parsedWords.added.length > 0 && (
            <p className="tiny faint" style={{ marginTop: '0.5rem' }}>
              {t('exchange.newVariants', { names: parsedWords.added.map((variant) => variant.name).join(', ') })}
            </p>
          )}
        </Sheet>
      )}

      {exporting && <ExportSheet text={exportText()} onClose={() => setExporting(false)} />}

      {removing && (
        <Sheet
          title={t('variants.removeTitle', { name: removing.name })}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className="btn btn--danger btn--block" onClick={() => removeVariant(removing.key)}>
                <Icon name="trash" />
                {t('variants.removeConfirm')}
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={() => setRemoving(null)}>
                {t('common.keep')}
              </button>
            </>
          }
        >
          <p className="muted small">{t('variants.removeBody')}</p>
        </Sheet>
      )}

      {confirmDelete && existing && (
        <Sheet
          title={t('editor.deleteTitle')}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" className="btn btn--danger btn--block" onClick={destroy}>
                <Icon name="trash" />
                {t('editor.deleteConfirm')}
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirmDelete(false)}>
                {t('common.keep')}
              </button>
            </>
          }
        >
          <p className="muted small">{tx('editor.deleteBody', { title: <strong>{existing.title}</strong> })}</p>
        </Sheet>
      )}
    </Shell>
  )
}
