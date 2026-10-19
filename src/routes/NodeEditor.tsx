import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import type {
  Completion,
  NodeCard,
  NodeDetail,
  Part,
  PartKind,
  PartMode,
  Question,
  Requirement,
  SetSummary,
  StudySet,
  Subnode,
} from '../lib/types'
import { Segmented, Spinner } from '../components/Bits'
import { Shell, TopBar } from '../components/Shell'
import { Icon, type IconName } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import {
  QuestionForm,
  isBlank,
  newQuestion,
  problemWith,
  toDraft,
  toInput,
  type QuestionDraft,
} from '../components/QuestionForm'

const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 10)}`

const KIND_ICON: Record<PartKind, IconName> = {
  vocab: 'cards',
  match: 'layers',
  question: 'help',
  compare: 'swap',
}

function newPart(kind: PartKind): Part {
  return {
    id: newId('p'),
    kind,
    title: '',
    mode: kind === 'match' ? 'choice' : 'both',
    dirs: 'ab',
    cards: [],
    questions: [],
    requires: [],
    complete: { need: 'times', times: 1 },
  }
}

/** A card as the editor shows it: just enough to recognise it. */
type CardLabel = { id: number; a: string; b: string; setTitle: string }

// ── Pickers ─────────────────────────────────────────────────────────────────

/**
 * Cards from a word set. Everything starts ticked: taking a whole set into a
 * vocabulary part is the common case, and is one tap.
 */
function CardPicker({
  already,
  onAdd,
  onClose,
}: {
  already: number[]
  onAdd: (cards: CardLabel[]) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [sets, setSets] = useState<SetSummary[] | null>(null)
  const [set, setSet] = useState<StudySet | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())

  useEffect(() => {
    api
      .sets()
      .then((all) => setSets(all.filter((s) => (s.kind ?? 'words') === 'words' && s.cardCount > 0)))
      .catch(() => setSets([]))
  }, [])

  const open = (slug: string) => {
    setSet(null)
    if (!slug) return
    api
      .set(slug)
      .then((result) => {
        setSet(result)
        setPicked(new Set(result.cards.filter((card) => !already.includes(card.id)).map((card) => card.id)))
      })
      .catch(() => undefined)
  }

  const add = () => {
    if (!set) return
    onAdd(
      set.cards
        .filter((card) => picked.has(card.id))
        .map((card) => ({ id: card.id, a: card.a, b: card.b, setTitle: set.title })),
    )
    onClose()
  }

  return (
    <Sheet
      title={t('nodeEditor.pickCards')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--primary btn--block" disabled={picked.size === 0} onClick={add}>
            {t('nodeEditor.addCards', { n: picked.size })}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
        {sets === null ? (
          <Spinner />
        ) : (
          <select className="select" defaultValue="" onChange={(event) => open(event.target.value)}>
            <option value="">{t('questions.pickSet')}</option>
            {sets.map((s) => (
              <option key={s.id} value={s.slug}>
                {s.title} ({s.cardCount})
              </option>
            ))}
          </select>
        )}
        {set && (
          <>
            <div className="row" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setPicked(new Set(set.cards.map((card) => card.id)))}
              >
                {t('nodeEditor.all')}
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setPicked(new Set())}>
                {t('nodeEditor.none')}
              </button>
            </div>
            <div className="panel panel--flush pickerlist">
              {set.cards.map((card) => (
                <label key={card.id} className="cardrow cardrow--link">
                  <input
                    type="checkbox"
                    checked={picked.has(card.id)}
                    onChange={(event) =>
                      setPicked((current) => {
                        const next = new Set(current)
                        event.target.checked ? next.add(card.id) : next.delete(card.id)
                        return next
                      })
                    }
                  />
                  <span className="cardrow__a truncate">{card.a || '—'}</span>
                  <span className="cardrow__b truncate">{card.b || '—'}</span>
                  {already.includes(card.id) && <span className="chip">{t('nodeEditor.inPart')}</span>}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

function QuestionPicker({
  already,
  onAdd,
  onClose,
}: {
  already: (number | string)[]
  onAdd: (questions: Question[]) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [sets, setSets] = useState<SetSummary[] | null>(null)
  const [set, setSet] = useState<StudySet | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())

  useEffect(() => {
    api
      .sets()
      .then((all) => setSets(all.filter((s) => s.kind === 'questions' && (s.questionCount ?? 0) > 0)))
      .catch(() => setSets([]))
  }, [])

  const open = (slug: string) => {
    setSet(null)
    if (!slug) return
    api
      .set(slug)
      .then((result) => {
        setSet(result)
        setPicked(new Set())
      })
      .catch(() => undefined)
  }

  const questions = set?.questions ?? []

  return (
    <Sheet
      title={t('nodeEditor.pickQuestions')}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={picked.size === 0}
            onClick={() => {
              onAdd(questions.filter((q) => picked.has(q.id)))
              onClose()
            }}
          >
            {t('nodeEditor.addQuestions', { n: picked.size })}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
        {sets === null ? (
          <Spinner />
        ) : sets.length === 0 ? (
          <p className="muted small">{t('nodeEditor.noQuestionSets')}</p>
        ) : (
          <select className="select" defaultValue="" onChange={(event) => open(event.target.value)}>
            <option value="">{t('questions.pickSet')}</option>
            {sets.map((s) => (
              <option key={s.id} value={s.slug}>
                {s.title} ({s.questionCount})
              </option>
            ))}
          </select>
        )}
        {set && (
          <>
            <button
              type="button"
              className="btn btn--sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setPicked(new Set(questions.map((q) => q.id)))}
            >
              {t('nodeEditor.all')}
            </button>
            <div className="panel panel--flush pickerlist">
              {questions.map((q) => (
                <label key={q.id} className="cardrow cardrow--link">
                  <input
                    type="checkbox"
                    checked={picked.has(q.id)}
                    onChange={(event) =>
                      setPicked((current) => {
                        const next = new Set(current)
                        event.target.checked ? next.add(q.id) : next.delete(q.id)
                        return next
                      })
                    }
                  />
                  <span className="grow truncate">{q.body}</span>
                  {already.includes(q.id) && <span className="chip">{t('nodeEditor.inPart')}</span>}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

/**
 * Picks what a part depends on: a whole other part, or one word or question
 * in it — merely seen, or solved.
 */
function RequirementPicker({
  parts,
  label,
  onAdd,
  onClose,
}: {
  parts: { part: Part; name: string }[]
  label: (ref: string) => string
  onAdd: (requirement: Requirement) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [need, setNeed] = useState<'seen' | 'solved'>('solved')
  const [open, setOpen] = useState<string | null>(null)

  const add = (ref: string) => {
    onAdd({ ref, need })
    onClose()
  }

  return (
    <Sheet title={t('nodeEditor.addRequirement')} onClose={onClose}>
      <div className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
        <Segmented
          label={t('nodeEditor.need')}
          value={need}
          onChange={setNeed}
          options={[
            { value: 'seen', label: t('nodeEditor.needSeen') },
            { value: 'solved', label: t('nodeEditor.needSolved') },
          ]}
        />
        <p className="tiny faint">{need === 'seen' ? t('nodeEditor.needSeenHint') : t('nodeEditor.needSolvedHint')}</p>
        {parts.length === 0 && <p className="muted small">{t('nodeEditor.noOtherParts')}</p>}
        {parts.map(({ part, name }) => {
          const items = [
            ...part.cards.map((id) => `c:${id}`),
            ...part.questions.filter((q): q is number => typeof q === 'number').map((id) => `q:${id}`),
          ]
          return (
            <div key={part.id} className="panel panel--flush">
              <div className="cardrow">
                <Icon name={KIND_ICON[part.kind]} width={16} height={16} style={{ color: 'var(--accent)', flex: 'none' }} />
                <span className="grow truncate" style={{ fontWeight: 600 }}>
                  {name}
                </span>
                <button type="button" className="btn btn--sm" onClick={() => add(`part:${part.id}`)}>
                  {t('nodeEditor.wholePart')}
                </button>
                {items.length > 0 && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-expanded={open === part.id}
                    aria-label={t('nodeEditor.pickOne')}
                    onClick={() => setOpen(open === part.id ? null : part.id)}
                  >
                    <Icon name="chevronDown" style={{ transform: open === part.id ? 'rotate(180deg)' : undefined }} />
                  </button>
                )}
              </div>
              {open === part.id &&
                items.map((ref) => (
                  <button key={ref} type="button" className="cardrow cardrow--link menu__item" onClick={() => add(ref)}>
                    <span className="grow truncate">{label(ref)}</span>
                    <Icon name="plus" width={14} height={14} />
                  </button>
                ))}
              {open === part.id && part.questions.some((q) => typeof q === 'string') && (
                <p className="tiny faint" style={{ padding: '0.5rem 0.875rem' }}>
                  {t('nodeEditor.saveFirst')}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </Sheet>
  )
}

// ── One part ────────────────────────────────────────────────────────────────

function PartEditor({
  part,
  name,
  index,
  total,
  cardLabel,
  questionLabel,
  refLabel,
  otherParts,
  onChange,
  onRemove,
  onMove,
  onNewQuestion,
  onEditQuestion,
  onAddCards,
  onAddQuestions,
}: {
  part: Part
  name: string
  index: number
  total: number
  cardLabel: (id: number) => string
  questionLabel: (ref: number | string) => string
  refLabel: (ref: string) => string
  otherParts: { part: Part; name: string }[]
  onChange: (next: Part) => void
  onRemove: () => void
  onMove: (offset: number) => void
  onNewQuestion: () => void
  onEditQuestion: (ref: number | string) => void
  onAddCards: (cards: CardLabel[]) => void
  onAddQuestions: (questions: Question[]) => void
}) {
  const { t } = useI18n()
  const [picking, setPicking] = useState<'cards' | 'questions' | 'requirement' | null>(null)
  const set = (patch: Partial<Part>) => onChange({ ...part, ...patch })
  const usesCards = part.kind === 'vocab' || part.kind === 'match'

  return (
    <div className="partcard">
      <div className="partcard__head">
        <Icon name={KIND_ICON[part.kind]} style={{ color: 'var(--accent)', flex: 'none' }} />
        <input
          className="input input--bare grow"
          value={part.title}
          onChange={(event) => set({ title: event.target.value })}
          placeholder={name}
          maxLength={80}
          aria-label={t('nodeEditor.partTitle')}
        />
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
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          <Icon name="chevronDown" />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" aria-label={t('nodeEditor.removePart')} onClick={onRemove}>
          <Icon name="trash" />
        </button>
      </div>
      <p className="tiny faint">{t(`nodeEditor.kindHint.${part.kind}`)}</p>

      <div className="partcard__grid">
        <label className="field">
          <span className="field__label">{t('nodeEditor.mode')}</span>
          <select className="select" value={part.mode} onChange={(event) => set({ mode: event.target.value as PartMode })}>
            <option value="choice">{t('nodeEditor.modeChoice')}</option>
            <option value="write">{t('nodeEditor.modeWrite')}</option>
            <option value="both">{t('nodeEditor.modeBoth')}</option>
          </select>
        </label>
        {usesCards && (
          <label className="field">
            <span className="field__label">{t('nodeEditor.direction')}</span>
            <select
              className="select"
              value={part.dirs}
              onChange={(event) => set({ dirs: event.target.value as Part['dirs'] })}
            >
              <option value="ab">{t('nodeEditor.dirAb')}</option>
              <option value="ba">{t('nodeEditor.dirBa')}</option>
              <option value="both">{t('nodeEditor.dirBoth')}</option>
            </select>
          </label>
        )}
      </div>

      {usesCards ? (
        <div className="stack" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
          <span className="field__label">{t('nodeEditor.cards', { n: part.cards.length })}</span>
          {part.cards.length > 0 && (
            <div className="togglerow">
              {part.cards.map((id) => (
                <span key={id} className="chip">
                  {cardLabel(id)}
                  <button
                    type="button"
                    className="chip__x"
                    aria-label={t('nodeEditor.removeItem')}
                    onClick={() => set({ cards: part.cards.filter((other) => other !== id) })}
                  >
                    <Icon name="x" width={11} height={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="editcard__add">
            <button type="button" className="chip chip--button" onClick={() => setPicking('cards')}>
              <Icon name="plus" width={11} height={11} />
              {t('nodeEditor.addFromSet')}
            </button>
            {part.cards.length > 0 && (
              <button type="button" className="chip chip--button" onClick={() => set({ cards: [] })}>
                <Icon name="x" width={11} height={11} />
                {t('nodeEditor.clear')}
              </button>
            )}
          </div>
          {part.kind === 'match' && part.cards.length > 0 && part.cards.length < 3 && (
            <p className="field__error small">{t('nodeEditor.matchMin')}</p>
          )}
        </div>
      ) : (
        <div className="stack" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
          <span className="field__label">{t('nodeEditor.questions', { n: part.questions.length })}</span>
          {part.questions.map((ref) => (
            <div key={String(ref)} className="cardrow qref">
              <span className="grow truncate small">{questionLabel(ref)}</span>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label={t('nodeEditor.editQuestion')}
                onClick={() => onEditQuestion(ref)}
              >
                <Icon name="edit" />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label={t('nodeEditor.removeItem')}
                onClick={() => set({ questions: part.questions.filter((other) => other !== ref) })}
              >
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div className="editcard__add">
            <button type="button" className="chip chip--button" onClick={onNewQuestion}>
              <Icon name="plus" width={11} height={11} />
              {t('nodeEditor.writeQuestion')}
            </button>
            <button type="button" className="chip chip--button" onClick={() => setPicking('questions')}>
              <Icon name="upload" width={11} height={11} />
              {t('nodeEditor.addFromQuestionSet')}
            </button>
          </div>
          {part.kind === 'compare' && (part.questions.length < 2 || part.questions.length > 3) && (
            <p className="field__error small">{t('nodeEditor.compareCount')}</p>
          )}
        </div>
      )}

      <div className="stack" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
        <span className="field__label">{t('nodeEditor.requires')}</span>
        {part.requires.length === 0 && <p className="tiny faint">{t('nodeEditor.noRequirements')}</p>}
        {part.requires.map((requirement, reqIndex) => (
          <div key={`${requirement.ref}-${reqIndex}`} className="cardrow qref">
            <Icon name="lock" width={14} height={14} style={{ color: 'var(--ink-faint)', flex: 'none' }} />
            <span className="grow truncate small">{refLabel(requirement.ref)}</span>
            <select
              className="select select--chip"
              value={requirement.need}
              onChange={(event) =>
                set({
                  requires: part.requires.map((other, i) =>
                    i === reqIndex ? { ...other, need: event.target.value as Requirement['need'] } : other,
                  ),
                })
              }
            >
              <option value="seen">{t('nodeEditor.needSeen')}</option>
              <option value="solved">{t('nodeEditor.needSolved')}</option>
            </select>
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              aria-label={t('nodeEditor.removeItem')}
              onClick={() => set({ requires: part.requires.filter((_, i) => i !== reqIndex) })}
            >
              <Icon name="x" />
            </button>
          </div>
        ))}
        <div className="editcard__add">
          <button type="button" className="chip chip--button" onClick={() => setPicking('requirement')}>
            <Icon name="lock" width={11} height={11} />
            {t('nodeEditor.addRequirement')}
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field__label">{t('nodeEditor.completion')}</span>
        <div className="row" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
          <select
            className="select grow"
            value={part.complete.need}
            onChange={(event) => set({ complete: { ...part.complete, need: event.target.value as Completion['need'] } })}
          >
            <option value="none">{t('nodeEditor.completeNone')}</option>
            <option value="seen">{t('nodeEditor.completeSeen')}</option>
            <option value="times">{t('nodeEditor.completeTimes')}</option>
            <option value="solved">{t('nodeEditor.completeSolved')}</option>
          </select>
          {part.complete.need === 'times' && (
            <input
              type="number"
              className="input input--num"
              min={1}
              max={20}
              value={part.complete.times}
              aria-label={t('nodeEditor.times')}
              onChange={(event) =>
                set({ complete: { ...part.complete, times: Math.max(1, Math.min(20, Number(event.target.value) || 1)) } })
              }
            />
          )}
        </div>
        <p className="field__hint">{t(`nodeEditor.completeHint.${part.complete.need}`, { n: part.complete.times })}</p>
      </div>

      {picking === 'cards' && (
        <CardPicker
          already={part.cards}
          onClose={() => setPicking(null)}
          onAdd={(cards) => {
            onAddCards(cards)
            set({ cards: [...part.cards, ...cards.map((card) => card.id).filter((id) => !part.cards.includes(id))] })
          }}
        />
      )}
      {picking === 'questions' && (
        <QuestionPicker
          already={part.questions}
          onClose={() => setPicking(null)}
          onAdd={(questions) => {
            onAddQuestions(questions)
            set({
              questions: [...part.questions, ...questions.map((q) => q.id).filter((id) => !part.questions.includes(id))],
            })
          }}
        />
      )}
      {picking === 'requirement' && (
        <RequirementPicker
          parts={otherParts}
          label={refLabel}
          onClose={() => setPicking(null)}
          onAdd={(requirement) =>
            set({
              requires: [...part.requires.filter((other) => other.ref !== requirement.ref), requirement],
            })
          }
        />
      )}
    </div>
  )
}

// ── The node ────────────────────────────────────────────────────────────────

export function NodeEditor() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useI18n()

  const [detail, setDetail] = useState<NodeDetail | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [subs, setSubs] = useState<Subnode[]>([])
  const [cards, setCards] = useState<Map<number, CardLabel>>(new Map())
  const [questions, setQuestions] = useState<Map<number, Question>>(new Map())
  /** Questions written in this node, saved or not. */
  const [drafts, setDrafts] = useState<QuestionDraft[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)

  const load = (result: NodeDetail) => {
    setDetail(result)
    setTitle(result.node.title)
    setDescription(result.node.description ?? '')
    setSubs(result.node.content.subnodes)
    setCards(
      new Map(
        result.cards.map((card: NodeCard) => [card.id, { id: card.id, a: card.a, b: card.b, setTitle: card.setTitle }]),
      ),
    )
    setQuestions(new Map([...result.questions, ...result.ownQuestions].map((q) => [q.id, q])))
    setDrafts(result.ownQuestions.map(toDraft))
  }

  useEffect(() => {
    api
      .node(Number(id))
      .then(load)
      .catch((caught: unknown) => {
        toast.error(errorText(t, caught, 'course.nodeLoadFailed'))
        navigate('/', { replace: true })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ── Labels ────────────────────────────────────────────────────────────────

  const kindName = (kind: PartKind) => t(`nodeEditor.kind.${kind}`)
  const partNames = useMemo(() => {
    const names = new Map<string, string>()
    subs.forEach((sub, subIndex) =>
      sub.parts.forEach((part, partIndex) => {
        names.set(
          part.id,
          part.title || `${kindName(part.kind)} · ${t('course.step', { n: subIndex + 1 })}.${partIndex + 1}`,
        )
      }),
    )
    return names
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs, t])

  const draftFor = (ref: number | string) =>
    typeof ref === 'string'
      ? drafts.find((draft) => `new:${draft.key}` === ref)
      : drafts.find((draft) => draft.id === ref)

  const cardLabel = (cardId: number) => {
    const card = cards.get(cardId)
    return card ? `${card.a || '—'} — ${card.b || '—'}` : `#${cardId}`
  }
  const questionLabel = (ref: number | string) => {
    const draft = draftFor(ref)
    if (draft) return draft.body.trim() || t('nodeEditor.untitledQuestion')
    return typeof ref === 'number' ? questions.get(ref)?.body ?? `#${ref}` : t('nodeEditor.untitledQuestion')
  }
  const refLabel = (ref: string) => {
    if (ref.startsWith('part:')) return t('nodeEditor.wholePartLabel', { name: partNames.get(ref.slice(5)) ?? '?' })
    if (ref.startsWith('c:')) return cardLabel(Number(ref.slice(2)))
    return questionLabel(Number(ref.slice(2)))
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  const setSub = (subId: string, patch: Partial<Subnode>) =>
    setSubs((current) => current.map((sub) => (sub.id === subId ? { ...sub, ...patch } : sub)))

  const setPart = (subId: string, next: Part) =>
    setSubs((current) =>
      current.map((sub) =>
        sub.id === subId ? { ...sub, parts: sub.parts.map((part) => (part.id === next.id ? next : part)) } : sub,
      ),
    )

  const swap = <T,>(list: T[], index: number, offset: number): T[] => {
    const target = index + offset
    if (target < 0 || target >= list.length) return list
    const next = list.slice()
    const a = next[index]!
    next[index] = next[target]!
    next[target] = a
    return next
  }

  const removePart = (subId: string, partId: string) => {
    setSubs((current) =>
      current.map((sub) => ({
        ...sub,
        parts: sub.parts
          .filter((part) => !(sub.id === subId && part.id === partId))
          // Nothing may keep depending on a part that is gone.
          .map((part) => ({ ...part, requires: part.requires.filter((req) => req.ref !== `part:${partId}`) })),
      })),
    )
  }

  const writeQuestion = (subId: string, part: Part) => {
    const draft = { ...newQuestion(), kind: part.kind === 'compare' ? ('gap' as const) : ('answer' as const) }
    setDrafts((current) => [...current, draft])
    setPart(subId, { ...part, questions: [...part.questions, `new:${draft.key}`] })
    setEditing(draft.key)
  }

  const editQuestion = (ref: number | string) => {
    const existing = draftFor(ref)
    if (existing) {
      setEditing(existing.key)
      return
    }
    // A question from a question set is edited there, not here.
    const question = typeof ref === 'number' ? questions.get(ref) : undefined
    if (question?.setId) {
      toast.show(t('nodeEditor.editInSet'))
    }
  }

  const editingDraft = drafts.find((draft) => draft.key === editing) ?? null

  // ── Saving ────────────────────────────────────────────────────────────────

  const save = async () => {
    if (!detail) return
    if (!title.trim()) {
      toast.error(t('editor.needTitle'))
      return
    }
    // Only drafts still in use are kept; one removed from every part goes.
    const referenced = new Set(subs.flatMap((sub) => sub.parts.flatMap((part) => part.questions.map(String))))
    const kept = drafts.filter(
      (draft) => !isBlank(draft) && (referenced.has(`new:${draft.key}`) || (draft.id && referenced.has(String(draft.id)))),
    )
    const broken = kept.find((draft) => problemWith(draft) !== null)
    if (broken) {
      setEditing(broken.key)
      toast.error(t('nodeEditor.fixQuestion'))
      return
    }
    // Saved node questions are referenced by id; unsaved ones by their key.
    const content = {
      subnodes: subs.map((sub) => ({
        ...sub,
        parts: sub.parts.map((part) => ({
          ...part,
          questions: part.questions.filter((ref) => {
            const draft = draftFor(ref)
            return !draft || !isBlank(draft)
          }),
        })),
      })),
    }
    setSaving(true)
    try {
      const result = await api.updateNode(detail.node.id, {
        title: title.trim(),
        description: description.trim(),
        content,
        questions: kept.map(toInput),
      })
      load(result)
      toast.success(t('nodeEditor.saved'))
    } catch (caught) {
      toast.error(errorText(t, caught, 'editor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!detail) {
    return (
      <Shell>
        <TopBar back="/" />
        <Spinner />
      </Shell>
    )
  }

  const allParts = subs.flatMap((sub) => sub.parts.map((part) => ({ part, name: partNames.get(part.id) ?? '' })))

  return (
    <Shell>
      <TopBar
        back={`/n/${detail.node.id}`}
        title={t('nodeEditor.title')}
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : <Icon name="check" />}
            {t('common.save')}
          </button>
        }
      />

      <div className="stack" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
        <section className="stack" style={{ '--gap': '0.875rem' } as React.CSSProperties}>
          <p className="tiny faint">
            {t('nodeEditor.inCourse', { course: detail.node.courseTitle })}{' '}
            <button type="button" className="linkish" onClick={() => navigate(`/c/${detail.node.courseSlug}/edit`)}>
              {t('nodeEditor.editCourse')}
            </button>
          </p>
          <div className="field">
            <label className="field__label" htmlFor="ntitle">
              {t('editor.title')}
            </label>
            <input
              id="ntitle"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="ndesc">
              {t('editor.description')} <span className="faint">{t('editor.optional')}</span>
            </label>
            <input
              id="ndesc"
              className="input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
          </div>
          <p className="field__hint">{t('nodeEditor.hint')}</p>
        </section>

        {subs.map((sub, subIndex) => (
          <section key={sub.id} className="subcard">
            <div className="subcard__head">
              <span className="substep__num">{subIndex + 1}</span>
              <input
                className="input input--bare grow"
                value={sub.title}
                onChange={(event) => setSub(sub.id, { title: event.target.value })}
                placeholder={t('course.step', { n: subIndex + 1 })}
                maxLength={80}
                aria-label={t('nodeEditor.stepTitle')}
              />
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label={t('editor.moveUp')}
                disabled={subIndex === 0}
                onClick={() => setSubs((current) => swap(current, subIndex, -1))}
              >
                <Icon name="chevronDown" style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label={t('editor.moveDown')}
                disabled={subIndex === subs.length - 1}
                onClick={() => setSubs((current) => swap(current, subIndex, 1))}
              >
                <Icon name="chevronDown" />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label={t('nodeEditor.removeStep')}
                disabled={subs.length <= 1}
                onClick={() => {
                  for (const part of sub.parts) removePart(sub.id, part.id)
                  setSubs((current) => current.filter((other) => other.id !== sub.id))
                }}
              >
                <Icon name="trash" />
              </button>
            </div>

            <div className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
              {sub.parts.length === 0 && <p className="tiny faint">{t('nodeEditor.emptyStep')}</p>}
              {sub.parts.map((part, partIndex) => (
                <PartEditor
                  key={part.id}
                  part={part}
                  name={partNames.get(part.id) ?? ''}
                  index={partIndex}
                  total={sub.parts.length}
                  cardLabel={cardLabel}
                  questionLabel={questionLabel}
                  refLabel={refLabel}
                  otherParts={allParts.filter((other) => other.part.id !== part.id)}
                  onChange={(next) => setPart(sub.id, next)}
                  onRemove={() => removePart(sub.id, part.id)}
                  onMove={(offset) => setSub(sub.id, { parts: swap(sub.parts, partIndex, offset) })}
                  onNewQuestion={() => writeQuestion(sub.id, part)}
                  onEditQuestion={editQuestion}
                  onAddCards={(added) =>
                    setCards((current) => {
                      const next = new Map(current)
                      for (const card of added) next.set(card.id, card)
                      return next
                    })
                  }
                  onAddQuestions={(added) =>
                    setQuestions((current) => {
                      const next = new Map(current)
                      for (const q of added) next.set(q.id, q)
                      return next
                    })
                  }
                />
              ))}
            </div>

            {adding === sub.id ? (
              <div className="kindpick">
                {(['vocab', 'match', 'question', 'compare'] as PartKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="choice"
                    onClick={() => {
                      setSub(sub.id, { parts: [...sub.parts, newPart(kind)] })
                      setAdding(null)
                    }}
                  >
                    <Icon name={KIND_ICON[kind]} style={{ color: 'var(--accent)', flex: 'none' }} />
                    <span className="grow">
                      <strong>{kindName(kind)}</strong>
                      <span className="tiny faint">{t(`nodeEditor.kindHint.${kind}`)}</span>
                    </span>
                  </button>
                ))}
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAdding(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn--block" onClick={() => setAdding(sub.id)}>
                <Icon name="plus" />
                {t('nodeEditor.addPart')}
              </button>
            )}
          </section>
        ))}

        <button
          type="button"
          className="btn btn--block btn--outline"
          onClick={() => setSubs((current) => [...current, { id: newId('s'), title: '', parts: [] }])}
        >
          <Icon name="plus" />
          {t('nodeEditor.addStep')}
        </button>

        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={save} disabled={saving}>
          {saving ? <span className="spinner" /> : <Icon name="check" />}
          {t('editor.saveChanges')}
        </button>
      </div>

      {editingDraft && (
        <Sheet
          title={t('nodeEditor.questionTitle')}
          onClose={() => setEditing(null)}
          footer={
            <button type="button" className="btn btn--primary btn--block" onClick={() => setEditing(null)}>
              {t('common.done')}
            </button>
          }
        >
          <QuestionForm
            draft={editingDraft}
            index={drafts.indexOf(editingDraft)}
            onChange={(next) => setDrafts((current) => current.map((draft) => (draft.key === next.key ? next : draft)))}
            onRemove={() => {
              const ref = editingDraft.id ?? `new:${editingDraft.key}`
              setSubs((current) =>
                current.map((sub) => ({
                  ...sub,
                  parts: sub.parts.map((part) => ({
                    ...part,
                    questions: part.questions.filter((other) => other !== ref),
                  })),
                })),
              )
              setDrafts((current) => current.filter((draft) => draft.key !== editingDraft.key))
              setEditing(null)
            }}
          />
        </Sheet>
      )}
    </Shell>
  )
}
