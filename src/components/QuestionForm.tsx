import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type QuestionInput } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { errorText } from '../lib/errors'
import { GAP } from '../lib/questions'
import { field, filledVariants, variantsOf } from '../lib/variants'
import { normalize } from '../lib/text'
import type { Question, QuestionKind, SetSummary, StudySet } from '../lib/types'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { Segmented, Spinner } from './Bits'

export type AnswerDraft = { key: string; t: string; ok: boolean }

export type QuestionDraft = {
  key: string
  id?: number
  kind: QuestionKind
  instruction: string
  body: string
  answers: AnswerDraft[]
  note: string
}

let counter = 0
export const draftKey = (prefix = 'q') => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`

export function newQuestion(): QuestionDraft {
  return {
    key: draftKey(),
    kind: 'answer',
    instruction: '',
    body: '',
    answers: [
      { key: draftKey('a'), t: '', ok: true },
      { key: draftKey('a'), t: '', ok: false },
    ],
    note: '',
  }
}

export function toDraft(question: Question): QuestionDraft {
  return {
    key: draftKey(),
    id: question.id,
    kind: question.kind,
    instruction: question.instruction ?? '',
    body: question.body,
    answers: question.answers.map((answer) => ({ key: draftKey('a'), t: answer.t, ok: answer.ok })),
    note: question.note ?? '',
  }
}

/** Blank drafts are dropped rather than rejected: the editor starts with one. */
export function isBlank(draft: QuestionDraft): boolean {
  return !draft.body.trim() && draft.answers.every((answer) => !answer.t.trim())
}

/** Why a draft cannot be saved, or null. */
export function problemWith(draft: QuestionDraft): 'body' | 'gap' | 'right' | null {
  if (!draft.body.trim()) return 'body'
  if (draft.kind === 'gap' && !draft.body.includes(GAP)) return 'gap'
  if (!draft.answers.some((answer) => answer.ok && answer.t.trim())) return 'right'
  return null
}

export function toInput(draft: QuestionDraft): QuestionInput {
  return {
    ...(draft.id ? { id: draft.id } : { tempKey: draft.key }),
    kind: draft.kind,
    instruction: draft.instruction.trim(),
    body: draft.body.trim(),
    answers: draft.answers
      .filter((answer) => answer.t.trim())
      .map((answer) => ({ t: answer.t.trim(), ok: answer.ok })),
    note: draft.note.trim(),
  }
}

/**
 * Takes every card of a word set as a possible answer, so a question like
 * "which of these is a fruit?" does not mean typing the fruit set out again.
 * Each one can be marked right or wrong, or left out.
 */
function ImportAnswers({ onAdd, onClose }: { onAdd: (answers: AnswerDraft[]) => void; onClose: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [sets, setSets] = useState<SetSummary[] | null>(null)
  const [slug, setSlug] = useState('')
  const [set, setSet] = useState<StudySet | null>(null)
  const [variant, setVariant] = useState('a')
  /** Per card: right, wrong, or left out. */
  const [marks, setMarks] = useState<Record<number, 'right' | 'wrong' | 'skip'>>({})

  useEffect(() => {
    api
      .sets()
      .then((all) => setSets(all.filter((s) => (s.kind ?? 'words') === 'words' && s.cardCount > 0)))
      .catch((caught: unknown) => {
        toast.error(errorText(t, caught, 'library.loadFailed'))
        setSets([])
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!slug) {
      setSet(null)
      return
    }
    let cancelled = false
    api
      .set(slug)
      .then((result) => {
        if (!cancelled) {
          setSet(result)
          setVariant('a')
          setMarks({})
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [slug])

  const variants = useMemo(() => (set ? filledVariants(set.cards, variantsOf(set)) : []), [set])
  const rows = (set?.cards ?? []).filter((card) => field(card, variant).trim())

  const add = () => {
    const picked = rows
      .filter((card) => (marks[card.id] ?? 'wrong') !== 'skip')
      .map((card) => ({ key: draftKey('a'), t: field(card, variant).trim(), ok: marks[card.id] === 'right' }))
    onAdd(picked)
    onClose()
  }

  const cycle = (id: number) =>
    setMarks((current) => {
      const now = current[id] ?? 'wrong'
      return { ...current, [id]: now === 'wrong' ? 'right' : now === 'right' ? 'skip' : 'wrong' }
    })

  const count = rows.filter((card) => (marks[card.id] ?? 'wrong') !== 'skip').length

  return (
    <Sheet
      title={t('questions.importTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--primary btn--block" disabled={count === 0} onClick={add}>
            {t('questions.importAdd', { n: count })}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
        <p className="muted small">{t('questions.importBody')}</p>
        {sets === null ? (
          <Spinner />
        ) : (
          <select className="select" value={slug} onChange={(event) => setSlug(event.target.value)}>
            <option value="">{t('questions.pickSet')}</option>
            {sets.map((s) => (
              <option key={s.id} value={s.slug}>
                {s.title}
              </option>
            ))}
          </select>
        )}
        {set && variants.length > 0 && (
          <select className="select" value={variant} onChange={(event) => setVariant(event.target.value)}>
            {variants.map((v) => (
              <option key={v.key} value={v.key}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        {set && rows.length > 0 && (
          <>
            <div className="row" style={{ '--gap': '0.4rem', flexWrap: 'wrap' } as React.CSSProperties}>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setMarks(Object.fromEntries(rows.map((card) => [card.id, 'right'])))}
              >
                {t('questions.allRight')}
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setMarks({})}>
                {t('questions.allWrong')}
              </button>
            </div>
            <p className="tiny faint">{t('questions.importTap')}</p>
            <div className="panel panel--flush">
              {rows.map((card) => {
                const mark = marks[card.id] ?? 'wrong'
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`importrow importrow--${mark}`}
                    onClick={() => cycle(card.id)}
                  >
                    <Icon name={mark === 'right' ? 'check' : mark === 'wrong' ? 'x' : 'trash'} width={16} height={16} />
                    <span className="grow truncate">{field(card, variant)}</span>
                    <span className="tiny">
                      {mark === 'right' ? t('questions.right') : mark === 'wrong' ? t('questions.wrong') : t('questions.leftOut')}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

/** One question, edited in place. */
export function QuestionForm({
  draft,
  index,
  onChange,
  onRemove,
  onMove,
  total,
}: {
  draft: QuestionDraft
  index: number
  onChange: (next: QuestionDraft) => void
  onRemove: () => void
  onMove?: (offset: number) => void
  total?: number
}) {
  const { t } = useI18n()
  const [importing, setImporting] = useState(false)
  const [showNote, setShowNote] = useState(Boolean(draft.note))
  const [showInstruction, setShowInstruction] = useState(Boolean(draft.instruction))
  const body = useRef<HTMLTextAreaElement>(null)

  const set = (patch: Partial<QuestionDraft>) => onChange({ ...draft, ...patch })
  const setAnswer = (key: string, patch: Partial<AnswerDraft>) =>
    set({ answers: draft.answers.map((answer) => (answer.key === key ? { ...answer, ...patch } : answer)) })

  const insertGap = () => {
    const node = body.current
    const at = node?.selectionStart ?? draft.body.length
    const end = node?.selectionEnd ?? at
    const selected = draft.body.slice(at, end).trim()
    const next = `${draft.body.slice(0, at)}${GAP}${draft.body.slice(end)}`
    // Whatever was selected becomes the right answer: write the sentence,
    // select the word, press the button.
    const answers =
      selected && !draft.answers.some((answer) => normalize(answer.t) === normalize(selected))
        ? [{ key: draftKey('a'), t: selected, ok: true }, ...draft.answers.filter((answer) => answer.t.trim())]
        : draft.answers
    onChange({ ...draft, kind: 'gap', body: next, answers })
    window.setTimeout(() => {
      node?.focus()
      node?.setSelectionRange(at + GAP.length, at + GAP.length)
    }, 0)
  }

  const problem = isBlank(draft) ? null : problemWith(draft)

  return (
    <div className="qform">
      <div className="spread">
        <span className="eyebrow">{t('questions.number', { n: index + 1 })}</span>
        <div className="row" style={{ '--gap': '0.1rem' } as React.CSSProperties}>
          {onMove && (
            <>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label={t('editor.moveUp')}
                disabled={index === 0}
                onClick={() => onMove(-1)}
              >
                <Icon name="chevronDown" style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label={t('editor.moveDown')}
                disabled={total !== undefined && index >= total - 1}
                onClick={() => onMove(1)}
              >
                <Icon name="chevronDown" />
              </button>
            </>
          )}
          <button type="button" className="icon-btn icon-btn--sm" aria-label={t('questions.remove')} onClick={onRemove}>
            <Icon name="trash" />
          </button>
        </div>
      </div>

      <Segmented
        label={t('questions.kind')}
        value={draft.kind}
        onChange={(kind) => set({ kind })}
        options={[
          { value: 'answer', label: t('questions.kindAnswer') },
          { value: 'gap', label: t('questions.kindGap') },
        ]}
      />

      {showInstruction ? (
        <input
          className="input"
          value={draft.instruction}
          onChange={(event) => set({ instruction: event.target.value })}
          placeholder={t('questions.instructionPlaceholder')}
          maxLength={300}
          aria-label={t('questions.instruction')}
        />
      ) : null}

      <div className="field">
        <textarea
          ref={body}
          className="input"
          rows={2}
          value={draft.body}
          onChange={(event) => set({ body: event.target.value })}
          placeholder={draft.kind === 'gap' ? t('questions.gapPlaceholder') : t('questions.bodyPlaceholder')}
          maxLength={1000}
          aria-label={t('questions.body')}
        />
        {draft.kind === 'gap' && (
          <div className="row" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
            <button type="button" className="btn btn--sm" onClick={insertGap}>
              <Icon name="plus" />
              {t('questions.insertGap')}
            </button>
            <span className="tiny faint grow">{t('questions.gapHint')}</span>
          </div>
        )}
      </div>

      <div className="stack" style={{ '--gap': '0.35rem' } as React.CSSProperties}>
        <span className="field__label">{t('questions.answers')}</span>
        {draft.answers.map((answer) => (
          <div className="answerrow" key={answer.key}>
            <button
              type="button"
              className={`answerrow__mark answerrow__mark--${answer.ok ? 'right' : 'wrong'}`}
              aria-pressed={answer.ok}
              aria-label={answer.ok ? t('questions.markWrong') : t('questions.markRight')}
              title={answer.ok ? t('questions.right') : t('questions.wrong')}
              onClick={() => setAnswer(answer.key, { ok: !answer.ok })}
            >
              <Icon name={answer.ok ? 'check' : 'x'} width={16} height={16} />
            </button>
            <input
              className="input"
              value={answer.t}
              onChange={(event) => setAnswer(answer.key, { t: event.target.value })}
              placeholder={answer.ok ? t('questions.rightPlaceholder') : t('questions.wrongPlaceholder')}
              maxLength={300}
              onKeyDown={(event) => {
                // Enter on the last answer adds the next one.
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (draft.answers[draft.answers.length - 1]?.key === answer.key) {
                    set({ answers: [...draft.answers, { key: draftKey('a'), t: '', ok: false }] })
                  }
                }
              }}
            />
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              aria-label={t('questions.removeAnswer')}
              onClick={() => set({ answers: draft.answers.filter((other) => other.key !== answer.key) })}
            >
              <Icon name="x" />
            </button>
          </div>
        ))}
        <div className="editcard__add">
          <button
            type="button"
            className="chip chip--button"
            onClick={() => set({ answers: [...draft.answers, { key: draftKey('a'), t: '', ok: false }] })}
          >
            <Icon name="plus" width={11} height={11} />
            {t('questions.addAnswer')}
          </button>
          <button type="button" className="chip chip--button" onClick={() => setImporting(true)}>
            <Icon name="upload" width={11} height={11} />
            {t('questions.importSet')}
          </button>
          {!showInstruction && (
            <button type="button" className="chip chip--button" onClick={() => setShowInstruction(true)}>
              <Icon name="plus" width={11} height={11} />
              {t('questions.instruction')}
            </button>
          )}
          {!showNote && (
            <button type="button" className="chip chip--button" onClick={() => setShowNote(true)}>
              <Icon name="plus" width={11} height={11} />
              {t('editor.addNote')}
            </button>
          )}
        </div>
      </div>

      {showNote && (
        <input
          className="input"
          value={draft.note}
          onChange={(event) => set({ note: event.target.value })}
          placeholder={t('questions.notePlaceholder')}
          maxLength={300}
          aria-label={t('editor.noteAria', { n: index + 1 })}
        />
      )}

      {problem && (
        <p className="field__error small">
          {problem === 'body' ? t('questions.needBody') : problem === 'gap' ? t('questions.needGap') : t('questions.needRight')}
        </p>
      )}

      {importing && (
        <ImportAnswers
          onClose={() => setImporting(false)}
          onAdd={(answers) =>
            set({
              answers: [
                ...draft.answers.filter((answer) => answer.t.trim()),
                ...answers.filter(
                  (incoming) => !draft.answers.some((answer) => normalize(answer.t) === normalize(incoming.t)),
                ),
              ],
            })
          }
        />
      )}
    </div>
  )
}
