import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useToast } from '../lib/toast'
import { plural } from '../lib/format'
import type { StudySet } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'

type Row = { key: string; id?: number; a: string; b: string; note: string }

let rowCounter = 0
const newRow = (): Row => ({ key: `row-${rowCounter++}`, a: '', b: '', note: '' })

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
              }))
            : [newRow(), newRow(), newRow()],
        )
      })
      .catch((caught: unknown) => {
        toast.error(caught instanceof ApiError ? caught.message : 'Could not load this set.')
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

  const applyPaste = () => {
    const parsed = parsePaste(pasteText)
    if (parsed.length === 0) {
      toast.error('No pairs found. Put one pair per line, separated by a tab or a comma.')
      return
    }
    setRows((current) => {
      const kept = current.filter((row) => row.a.trim() || row.b.trim())
      return [...kept, ...parsed]
    })
    setPasteText('')
    setPasting(false)
    toast.success(`Added ${plural(parsed.length, 'card', 'cards')}.`)
  }

  const save = async () => {
    const cards = rows
      .filter((row) => row.a.trim() && row.b.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        a: row.a.trim(),
        b: row.b.trim(),
        ...(row.note.trim() ? { note: row.note.trim() } : {}),
      }))

    if (!title.trim()) {
      toast.error('Give the set a title.')
      return
    }
    if (!langA.trim() || !langB.trim()) {
      toast.error('Name both sides of the cards.')
      return
    }
    if (cards.length === 0) {
      toast.error('Add at least one complete pair.')
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
      toast.success(existing ? 'Set updated.' : 'Set created.')
      navigate(`/s/${result.slug}`, { replace: true })
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Could not save.')
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
      toast.success('Set deleted.')
      navigate('/', { replace: true })
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Could not delete.')
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
        title={existing ? 'Edit set' : 'New set'}
        actions={
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={save}
            disabled={saving}
          >
            {saving ? <span className="spinner" /> : <Icon name="check" />}
            Save
          </button>
        }
      />

      <div className="stack" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
        <section className="stack" style={{ '--gap': '0.875rem' } as React.CSSProperties}>
          <div className="field">
            <label className="field__label" htmlFor="title">
              Title
            </label>
            <input
              id="title"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Unit 4 — in the kitchen"
              maxLength={120}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="description">
              Description <span className="faint">(optional)</span>
            </label>
            <input
              id="description"
              className="input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this set covers"
              maxLength={500}
            />
          </div>

          <div className="row" style={{ '--gap': '0.5rem', alignItems: 'flex-end' } as React.CSSProperties}>
            <div className="field grow">
              <label className="field__label" htmlFor="langA">
                Front side
              </label>
              <input
                id="langA"
                className="input"
                value={langA}
                onChange={(event) => setLangA(event.target.value)}
                placeholder="Italian"
                maxLength={40}
              />
            </div>
            <Icon name="swap" style={{ color: 'var(--ink-faint)', marginBottom: '0.9rem' }} />
            <div className="field grow">
              <label className="field__label" htmlFor="langB">
                Back side
              </label>
              <input
                id="langB"
                className="input"
                value={langB}
                onChange={(event) => setLangB(event.target.value)}
                placeholder="Hungarian"
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
              {published ? 'Visible to everyone' : 'Draft — only editors can see it'}
            </span>
          </label>
        </section>

        <section>
          <div className="spread" style={{ marginBottom: '0.6rem' }}>
            <p className="eyebrow">{plural(complete, 'card', 'cards')}</p>
            <button type="button" className="btn btn--sm" onClick={() => setPasting(true)}>
              <Icon name="list" />
              Paste a list
            </button>
          </div>

          <div className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
            {rows.map((row, index) => (
              <div key={row.key} className="editrow">
                <input
                  className="input"
                  value={row.a}
                  onChange={(event) => update(row.key, { a: event.target.value })}
                  placeholder={langA || 'Front'}
                  aria-label={`${langA || 'Front'}, card ${index + 1}`}
                  maxLength={300}
                />
                <input
                  className="input"
                  value={row.b}
                  onChange={(event) => update(row.key, { b: event.target.value })}
                  placeholder={langB || 'Back'}
                  aria-label={`${langB || 'Back'}, card ${index + 1}`}
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
                    aria-label="Move up"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  >
                    <Icon name="chevronDown" style={{ transform: 'rotate(180deg)', width: 16, height: 16 }} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: '2rem', height: '1.4rem' }}
                    aria-label="Remove card"
                    onClick={() => remove(row.key)}
                  >
                    <Icon name="trash" style={{ width: 15, height: 15 }} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: '2rem', height: '1.4rem' }}
                    aria-label="Move down"
                    onClick={() => move(index, 1)}
                    disabled={index === rows.length - 1}
                  >
                    <Icon name="chevronDown" style={{ width: 16, height: 16 }} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn btn--block"
            style={{ marginTop: '0.6rem' }}
            onClick={() => setRows((current) => [...current, newRow()])}
          >
            <Icon name="plus" />
            Add a card
          </button>

          <p className="field__hint" style={{ marginTop: '0.75rem' }}>
            Separate alternative answers with a semicolon, like{' '}
            <code>ház; épület</code>. Anything in brackets is optional when typing.
          </p>
        </section>

        <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={save}
            disabled={saving}
          >
            {saving ? <span className="spinner" /> : <Icon name="check" />}
            {existing ? 'Save changes' : 'Create set'}
          </button>
          {existing && (
            <button
              type="button"
              className="btn btn--danger btn--block"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" />
              Delete this set
            </button>
          )}
        </section>
      </div>

      {pasting && (
        <Sheet title="Paste a word list" onClose={() => setPasting(false)}>
          <p className="muted small" style={{ marginBottom: '0.75rem' }}>
            One pair per line. Separate the two sides with a tab, a comma, a semicolon or a
            dash.
          </p>
          <textarea
            className="input"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={'la cucina, konyha\nil frigorifero, hűtő\nil coltello, kés'}
            rows={8}
          />
          <div className="stack" style={{ '--gap': '0.5rem', marginTop: '0.75rem' } as React.CSSProperties}>
            <button type="button" className="btn btn--primary btn--block" onClick={applyPaste}>
              Add {parsePaste(pasteText).length > 0 ? plural(parsePaste(pasteText).length, 'card', 'cards') : 'cards'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => setPasting(false)}
            >
              Cancel
            </button>
          </div>
        </Sheet>
      )}

      {confirmDelete && existing && (
        <Sheet title="Delete this set?" onClose={() => setConfirmDelete(false)}>
          <p className="muted small" style={{ marginBottom: '1rem' }}>
            <strong>{existing.title}</strong> and all of its cards are removed for everyone,
            along with their progress. This cannot be undone.
          </p>
          <div className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
            <button type="button" className="btn btn--danger btn--block" onClick={destroy}>
              <Icon name="trash" />
              Delete permanently
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => setConfirmDelete(false)}
            >
              Keep it
            </button>
          </div>
        </Sheet>
      )}
    </Shell>
  )
}
