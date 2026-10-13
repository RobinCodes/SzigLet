import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { PERSONS, type CardExtras, type Gender, type Person, type Side, type StudySet } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'

type Row = {
  key: string
  id?: number
  a: string
  b: string
  note: string
  extras: CardExtras
  /** Which optional panels are on screen. All of them are the exception. */
  showNote: boolean
  showGrammar: boolean
  showConj: boolean
}

let rowCounter = 0
const newRow = (): Row => ({
  key: `row-${rowCounter++}`,
  a: '',
  b: '',
  note: '',
  extras: {},
  showNote: false,
  showGrammar: false,
  showConj: false,
})

const SIDES: Side[] = ['a', 'b']

/** Empty fields are absence, not empty strings, by the time this is saved. */
function prune(extras: CardExtras): CardExtras | undefined {
  const out: CardExtras = {}

  for (const field of ['article', 'plural'] as const) {
    const sides: Partial<Record<Side, string>> = {}
    for (const side of SIDES) {
      const value = extras[field]?.[side]?.trim()
      if (value) {
        sides[side] = value
      }
    }
    if (Object.keys(sides).length > 0) {
      out[field] = sides
    }
  }

  const gender: Partial<Record<Side, Gender>> = {}
  for (const side of SIDES) {
    const value = extras.gender?.[side]
    if (value === 'm' || value === 'f') {
      gender[side] = value
    }
  }
  if (Object.keys(gender).length > 0) {
    out.gender = gender
  }

  const conj: Partial<Record<Person, string>> = {}
  for (const person of PERSONS) {
    const value = extras.conj?.[person]?.trim()
    if (value) {
      conj[person] = value
    }
  }
  if (Object.keys(conj).length > 0) {
    out.conj = conj
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/** True when a card already carries something worth keeping its panel open. */
function hasGrammar(extras: CardExtras): boolean {
  return Boolean(extras.article || extras.plural || extras.gender)
}

/**
 * Parses pasted word lists. One pair per line, split on a tab, a semicolon,
 * a comma or a dash — whichever appears first, since people paste from
 * spreadsheets, notes apps and their own handwriting alike.
 */
function parsePaste(text: string): Row[] {
  const rows: Row[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const match = trimmed.match(/^(.*?)(\t+|\s*;\s*|\s*,\s*|\s+[–—-]\s+)(.*)$/)
    if (!match || !match[1]?.trim() || !match[3]?.trim()) {
      continue
    }
    rows.push({ ...newRow(), a: match[1].trim(), b: match[3].trim() })
  }
  return rows
}

export function Editor() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t, tx } = useI18n()
  const editing = Boolean(slug)

  const [existing, setExisting] = useState<StudySet | null>(null)
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [langA, setLangA] = useState('Italian')
  const [langB, setLangB] = useState('Hungarian')
  const [published, setPublished] = useState(true)
  const [rows, setRows] = useState<Row[]>([newRow(), newRow(), newRow()])

  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!slug) {
      return
    }
    api
      .set(slug)
      .then((result) => {
        setExisting(result)
        setTitle(result.title)
        setDescription(result.description ?? '')
        setLangA(result.langA)
        setLangB(result.langB)
        setPublished(result.published)
        setRows(
          result.cards.length > 0
            ? result.cards.map((card) => ({
                ...newRow(),
                id: card.id,
                a: card.a,
                b: card.b,
                note: card.note ?? '',
                extras: card.extras ?? {},
                showNote: Boolean(card.note),
                showGrammar: hasGrammar(card.extras ?? {}),
                showConj: Boolean(card.extras?.conj),
              }))
            : [newRow(), newRow(), newRow()],
        )
      })
      .catch((caught: unknown) => {
        toast.error(errorText(t, caught, 'editor.loadFailed'))
        navigate('/', { replace: true })
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const update = (key: string, patch: Partial<Row>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    )
  }

  /** Every write into the nested `extras` goes through here. */
  const editExtras = (key: string, mutate: (extras: CardExtras) => CardExtras) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, extras: mutate(row.extras) } : row)),
    )
  }

  const setSideField = (key: string, field: 'article' | 'plural', side: Side, value: string) =>
    editExtras(key, (extras) => ({ ...extras, [field]: { ...extras[field], [side]: value } }))

  const setGender = (key: string, side: Side, value: string) =>
    editExtras(key, (extras) => ({
      ...extras,
      gender: { ...extras.gender, [side]: value === 'm' || value === 'f' ? value : undefined },
    }))

  const setConj = (key: string, person: Person, value: string) =>
    editExtras(key, (extras) => ({ ...extras, conj: { ...extras.conj, [person]: value } }))

  const remove = (key: string) => {
    setRows((current) => (current.length <= 1 ? [newRow()] : current.filter((row) => row.key !== key)))
  }

  const move = (index: number, offset: number) => {
    setRows((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) {
        return current
      }
      const next = current.slice()
      const a = next[index]!
      const b = next[target]!
      next[index] = b
      next[target] = a
      return next
    })
  }

  const parsed = parsePaste(pasteText)

  const applyPaste = () => {
    if (parsed.length === 0) {
      toast.error(t('editor.pasteNone'))
      return
    }
    setRows((current) => {
      const kept = current.filter((row) => row.a.trim() || row.b.trim())
      return [...kept, ...parsed]
    })
    setPasteText('')
    setPasting(false)
    toast.success(t('editor.pasteAdded', { n: parsed.length }))
  }

  const save = async () => {
    const cards = rows
      .filter((row) => row.a.trim() && row.b.trim())
      .map((row) => {
        const extras = prune(row.extras)
        return {
          ...(row.id ? { id: row.id } : {}),
          a: row.a.trim(),
          b: row.b.trim(),
          ...(row.note.trim() ? { note: row.note.trim() } : {}),
          ...(extras ? { extras } : {}),
        }
      })

    if (!title.trim()) {
      toast.error(t('editor.needTitle'))
      return
    }
    if (!langA.trim() || !langB.trim()) {
      toast.error(t('editor.needLangs'))
      return
    }
    if (cards.length === 0) {
      toast.error(t('editor.needPair'))
      return
    }

    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        langA: langA.trim(),
        langB: langB.trim(),
        published,
        cards,
      }
      const result = existing
        ? await api.updateSet(existing.id, payload)
        : await api.createSet(payload)
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

  const complete = rows.filter((row) => row.a.trim() && row.b.trim()).length

  return (
    <Shell>
      <TopBar
        back={existing ? `/s/${existing.slug}` : '/'}
        title={existing ? t('editor.editSet') : t('editor.newSet')}
        actions={
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={save}
            disabled={saving}
          >
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
              placeholder={t('editor.titlePlaceholder')}
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

          <label className="switch">
            <input
              type="checkbox"
              checked={published}
              onChange={(event) => setPublished(event.target.checked)}
            />
            <span className="switch__track" />
            <span className="small">
              {published ? t('editor.visible') : t('editor.draftOnly')}
            </span>
          </label>
        </section>

        <section>
          <div className="spread" style={{ marginBottom: '0.6rem' }}>
            <p className="eyebrow">{t('editor.cards', { n: complete })}</p>
            <button type="button" className="btn btn--sm" onClick={() => setPasting(true)}>
              <Icon name="list" />
              {t('editor.pasteList')}
            </button>
          </div>

          <div className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
            {rows.map((row, index) => (
              <div key={row.key} className="editcard">
                <div className="editrow">
                  <input
                    className="input"
                    value={row.a}
                    onChange={(event) => update(row.key, { a: event.target.value })}
                    placeholder={langA || t('editor.front')}
                    aria-label={t('editor.sideAria', {
                      lang: langA || t('editor.front'),
                      n: index + 1,
                    })}
                    maxLength={300}
                  />
                  <input
                    className="input"
                    value={row.b}
                    onChange={(event) => update(row.key, { b: event.target.value })}
                    placeholder={langB || t('editor.back')}
                    aria-label={t('editor.sideAria', {
                      lang: langB || t('editor.back'),
                      n: index + 1,
                    })}
                    maxLength={300}
                  />
                  <div
                    className="stack"
                    style={{ '--gap': '0.1rem' } as React.CSSProperties}
                  >
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: '2rem', height: '1.4rem' }}
                      aria-label={t('editor.moveUp')}
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                    >
                      <Icon name="chevronDown" style={{ transform: 'rotate(180deg)', width: 16, height: 16 }} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: '2rem', height: '1.4rem' }}
                      aria-label={t('editor.removeCard')}
                      onClick={() => remove(row.key)}
                    >
                      <Icon name="trash" style={{ width: 15, height: 15 }} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: '2rem', height: '1.4rem' }}
                      aria-label={t('editor.moveDown')}
                      onClick={() => move(index, 1)}
                      disabled={index === rows.length - 1}
                    >
                      <Icon name="chevronDown" style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                </div>

                {row.showNote && (
                  <div className="editcard__note">
                    <input
                      className="input"
                      value={row.note}
                      onChange={(event) => update(row.key, { note: event.target.value })}
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
                      onClick={() => update(row.key, { note: '', showNote: false })}
                    >
                      <Icon name="x" style={{ width: 15, height: 15 }} />
                    </button>
                  </div>
                )}

                {row.showGrammar && (
                  <div className="editcard__panel">
                    {SIDES.map((side) => (
                      <div className="editcard__grammar" key={side}>
                        <span className="editcard__side truncate">
                          {side === 'a' ? langA || t('editor.front') : langB || t('editor.back')}
                        </span>
                        <input
                          className="input"
                          value={row.extras.article?.[side] ?? ''}
                          onChange={(event) =>
                            setSideField(row.key, 'article', side, event.target.value)
                          }
                          placeholder={t('word.article')}
                          aria-label={t('editor.articleFor', {
                            side: side === 'a' ? langA : langB,
                          })}
                          maxLength={80}
                        />
                        <input
                          className="input"
                          value={row.extras.plural?.[side] ?? ''}
                          onChange={(event) =>
                            setSideField(row.key, 'plural', side, event.target.value)
                          }
                          placeholder={t('word.plural')}
                          aria-label={t('editor.pluralFor', {
                            side: side === 'a' ? langA : langB,
                          })}
                          maxLength={160}
                        />
                        <select
                          className="select"
                          value={row.extras.gender?.[side] ?? ''}
                          onChange={(event) => setGender(row.key, side, event.target.value)}
                          aria-label={t('editor.genderFor', {
                            side: side === 'a' ? langA : langB,
                          })}
                        >
                          <option value="">{t('word.none')}</option>
                          <option value="m">m — {t('word.masculine')}</option>
                          <option value="f">f — {t('word.feminine')}</option>
                        </select>
                      </div>
                    ))}
                    <div className="spread">
                      <p className="field__hint grow">{t('editor.attributesHint')}</p>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          // Drops the grammar but keeps any verb table.
                          editExtras(row.key, ({ conj }) => (conj ? { conj } : {}))
                          update(row.key, { showGrammar: false })
                        }}
                      >
                        {t('editor.removeAttributes')}
                      </button>
                    </div>
                  </div>
                )}

                {row.showConj && (
                  <div className="editcard__panel">
                    <div className="editcard__conj">
                      {PERSONS.map((person) => (
                        <label className="field" key={person}>
                          <span className="field__label">{person}</span>
                          <input
                            className="input"
                            value={row.extras.conj?.[person] ?? ''}
                            onChange={(event) => setConj(row.key, person, event.target.value)}
                            maxLength={160}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="spread">
                      <p className="field__hint grow">{t('editor.conjugationHint')}</p>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          editExtras(row.key, ({ conj: _conj, ...rest }) => rest)
                          update(row.key, { showConj: false })
                        }}
                      >
                        {t('editor.removeConjugation')}
                      </button>
                    </div>
                  </div>
                )}

                <div className="editcard__add">
                  {!row.showNote && (
                    <button
                      type="button"
                      className="chip chip--button"
                      onClick={() => update(row.key, { showNote: true })}
                    >
                      <Icon name="plus" width={11} height={11} />
                      {t('editor.addNote')}
                    </button>
                  )}
                  {!row.showGrammar && (
                    <button
                      type="button"
                      className="chip chip--button"
                      onClick={() => update(row.key, { showGrammar: true })}
                    >
                      <Icon name="plus" width={11} height={11} />
                      {t('editor.addAttributes')}
                    </button>
                  )}
                  {!row.showConj && (
                    <button
                      type="button"
                      className="chip chip--button"
                      onClick={() => update(row.key, { showConj: true })}
                    >
                      <Icon name="plus" width={11} height={11} />
                      {t('editor.addConjugation')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn btn--block"
            style={{ marginTop: '0.75rem' }}
            onClick={() => setRows((current) => [...current, newRow()])}
          >
            <Icon name="plus" />
            {t('editor.addCard')}
          </button>

          <div className="stack" style={{ '--gap': '0.4rem', marginTop: '0.75rem' } as React.CSSProperties}>
            <p className="field__hint">{t('editor.noteHint')}</p>
            <p className="field__hint">
              {tx('editor.altHint', { example: <code>ház; épület</code> })}
            </p>
          </div>
        </section>

        <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={save}
            disabled={saving}
          >
            {saving ? <span className="spinner" /> : <Icon name="check" />}
            {existing ? t('editor.saveChanges') : t('editor.createSet')}
          </button>
          {existing && (
            <button
              type="button"
              className="btn btn--danger btn--block"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" />
              {t('editor.deleteSet')}
            </button>
          )}
        </section>
      </div>

      {pasting && (
        <Sheet
          title={t('editor.pasteTitle')}
          onClose={() => setPasting(false)}
          footer={
            <>
              <button type="button" className="btn btn--primary btn--block" onClick={applyPaste}>
                {parsed.length > 0
                  ? t('editor.pasteAdd', { n: parsed.length })
                  : t('editor.pasteAddEmpty')}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setPasting(false)}
              >
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <p className="muted small" style={{ marginBottom: '0.75rem' }}>
            {t('editor.pasteBody')}
          </p>
          <textarea
            className="input"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={'la cucina, konyha\nil frigorifero, hűtő\nil coltello, kés'}
            rows={6}
          />
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
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setConfirmDelete(false)}
              >
                {t('common.keep')}
              </button>
            </>
          }
        >
          <p className="muted small">
            {tx('editor.deleteBody', { title: <strong>{existing.title}</strong> })}
          </p>
        </Sheet>
      )}
    </Shell>
  )
}
