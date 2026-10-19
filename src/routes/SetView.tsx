import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { countStates, isDeckCleared, MIN_CHOICE_CARDS } from '../lib/study'
import { readDirection, storeDirection } from '../lib/display'
import { MASTERY, NO_TESTS, masteryPercent } from '../lib/word'
import { dirKey, field, filledVariants, parseDir, preferred, usableCards, variantsOf } from '../lib/variants'
import { displayAnswer } from '../lib/text'
import { exportQuestions, exportWords } from '../lib/exchange'
import { rightAnswers } from '../lib/questions'
import type { StudySet } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Empty, SplitBar, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { VariantPicker } from '../components/VariantPicker'

/** One line of the mastery breakdown: what it is worth, and whether it is in. */
function MasteryRow({
  label,
  detail,
  weight,
  done,
}: {
  label: string
  detail: string
  weight: number
  done: boolean
}) {
  return (
    <div className="cardrow" style={{ alignItems: 'center' }}>
      <Icon
        name={done ? 'check' : 'clock'}
        style={{ color: done ? 'var(--known)' : 'var(--ink-faint)', flex: 'none' }}
        width={17}
        height={17}
      />
      <span className="grow truncate" style={{ fontWeight: 560 }}>
        {label}
      </span>
      <span className="tiny faint num">{detail}</span>
      <span className={`chip${done ? ' chip--known' : ''}`} style={{ minWidth: '2.6rem', justifyContent: 'center' }}>
        {Math.round(weight * 100)}%
      </span>
    </div>
  )
}

/** The set as text, ready to paste into another set. */
export function ExportSheet({ text, onClose }: { text: string; onClose: () => void }) {
  const { t } = useI18n()
  const toast = useToast()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('exchange.copied'))
    } catch {
      toast.error(t('exchange.copyFailed'))
    }
  }

  return (
    <Sheet
      title={t('exchange.exportTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--primary btn--block" onClick={copy}>
            <Icon name="copy" />
            {t('exchange.copy')}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <p className="muted small" style={{ marginBottom: '0.75rem' }}>
        {t('exchange.exportBody')}
      </p>
      <textarea
        className="input input--mono"
        readOnly
        rows={10}
        value={text}
        onFocus={(event) => event.target.select()}
      />
    </Sheet>
  )
}

export function SetView() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { canEdit } = useAuth()
  const { t, relative } = useI18n()

  const [set, setSet] = useState<StudySet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dir, setDir] = useState(() => readDirection(slug))
  const [confirmReset, setConfirmReset] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(() => {
    api
      .set(slug)
      .then((result) => {
        setSet(result)
        setError(null)
      })
      .catch((caught: unknown) => {
        setError(errorText(t, caught, 'set.loadFailed'))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  useEffect(load, [load])

  const variants = useMemo(() => (set ? variantsOf(set) : []), [set])
  const offered = useMemo(() => (set ? filledVariants(set.cards, variants) : []), [set, variants])

  if (error) {
    return (
      <Shell>
        <TopBar back="/" />
        <Empty icon="search" title={t('set.notFoundTitle')}>
          {error}
        </Empty>
      </Shell>
    )
  }

  if (!set) {
    return (
      <Shell>
        <TopBar back="/" />
        <Spinner />
      </Shell>
    )
  }

  const isQuestions = set.kind === 'questions'

  // A remembered pair whose variation has since gone falls back to the two
  // languages.
  let { front, back } = parseDir(dir)
  if (!offered.some((v) => v.key === front) || !offered.some((v) => v.key === back)) {
    front = 'a'
    back = 'b'
  }
  const pair = dirKey(front, back)
  const usable = usableCards(set.cards, front, back, variants, set.hidden)

  const changePair = (nextFront: string, nextBack: string) => {
    const next = dirKey(nextFront, nextBack)
    setDir(next)
    storeDirection(slug, next)
  }

  const tally = countStates(usable, pair)
  const total = usable.length
  const cleared = isDeckCleared(usable, pair)
  const tests = set.tests?.[pair] ?? NO_TESTS
  const score = masteryPercent(tally.known, total, tests)
  const query = `dir=${encodeURIComponent(pair)}`

  const reset = async () => {
    try {
      await api.resetProgress(set.id, 'both')
      setConfirmReset(false)
      toast.success(t('set.resetDone'))
      load()
    } catch (caught) {
      toast.error(errorText(t, caught, 'set.resetFailed'))
    }
  }

  const exportText = () =>
    isQuestions
      ? exportQuestions(
          (set.questions ?? []).map((q) => ({
            kind: q.kind,
            instruction: q.instruction ?? '',
            body: q.body,
            answers: q.answers,
            note: q.note ?? '',
          })),
        )
      : exportWords(
          variantsOf({ ...set, cards: [] }),
          set.cards.map((card) => ({
            fields: Object.fromEntries(
              variantsOf({ ...set, cards: [] }).map((variant) => [variant.key, field(card, variant.key)]),
            ),
            note: card.note ?? undefined,
            gender: card.extras?.gender,
            conj: card.extras?.conj,
            only: card.extras?.only,
            pref: card.extras?.pref,
          })),
        )

  const authors = set.authors?.map((author) => author.username) ?? (set.author ? [set.author] : [])
  const questions = (set.questions ?? []).filter((q) => !(set.hidden ?? []).includes(`q:${q.id}`))
  const solved = questions.filter((q) => set.progress?.[`q:${q.id}`]?.lastOk).length

  return (
    <Shell>
      <TopBar
        back="/"
        actions={
          <>
            {set.canSeeStats && (
              <Link to={`/s/${set.slug}/stats`} className="icon-btn" aria-label={t('stats.title')}>
                <Icon name="chart" />
              </Link>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={t('exchange.export')}
              onClick={() => setExporting(true)}
            >
              <Icon name="share" />
            </button>
            {canEdit && (
              <Link to={`/s/${set.slug}/edit`} className="icon-btn" aria-label={t('set.edit')}>
                <Icon name="edit" />
              </Link>
            )}
          </>
        }
      />

      <div className="sethead enter">
        <div className="row" style={{ '--gap': '0.4rem', marginBottom: '0.4rem' } as React.CSSProperties}>
          {isQuestions ? (
            <span className="chip chip--accent">
              <Icon name="help" width={11} height={11} /> {t('kinds.questions')}
            </span>
          ) : (
            <span className="chip chip--accent">
              {set.langA} <Icon name="swap" width={11} height={11} /> {set.langB}
            </span>
          )}
          {!set.published && <span className="chip">{t('common.draft')}</span>}
        </div>
        <h1 className="sethead__title">{set.title}</h1>
        {set.description && <p className="sethead__desc">{set.description}</p>}
        <p className="tiny faint" style={{ marginTop: '0.5rem' }}>
          {isQuestions ? t('set.questions', { n: questions.length }) : t('set.cards', { n: set.cards.length })}
          {authors.length > 0 && ` · ${t('set.by', { author: authors.join(', ') })}`} ·{' '}
          {t('set.updated', { when: relative(set.updatedAt) })}
        </p>
      </div>

      {isQuestions ? (
        questions.length === 0 ? (
          <Empty icon="help" title={t('set.noQuestionsTitle')}>
            {canEdit ? t('set.noCardsEditor') : t('set.noCardsViewer')}
          </Empty>
        ) : (
          <div className="stack" style={{ '--gap': '1.25rem' } as React.CSSProperties}>
            <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
              <div className="spread">
                <p className="eyebrow">{t('mastery.title')}</p>
                <span className="chip chip--accent">{Math.round((solved / questions.length) * 100)}%</span>
              </div>
              <SplitBar known={solved} rehearse={0} total={questions.length} />
              <p className="tiny faint">{t('set.questionsSolved', { solved, total: questions.length })}</p>
            </section>
            <button
              type="button"
              className="btn btn--primary btn--lg btn--block"
              onClick={() => navigate(`/s/${set.slug}/practice`)}
            >
              <Icon name="play" />
              {t('set.practice')}
            </button>
            <section>
              <div className="spread" style={{ marginBottom: '0.5rem' }}>
                <p className="eyebrow">{t('set.allQuestions')}</p>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(true)}>
                  <Icon name="rotate" />
                  {t('set.resetProgress')}
                </button>
              </div>
              <div className="panel panel--flush">
                {(showAll ? questions : questions.slice(0, 12)).map((q) => (
                  <div className="cardlist__item" key={q.id}>
                    <div className="cardlist__row">
                      <span
                        className={`cardrow__dot${set.progress?.[`q:${q.id}`]?.lastOk ? ' cardrow__dot--known' : ''}`}
                      />
                      <span className="cardrow__a truncate">{q.body.replace(/_{3,}/g, '…')}</span>
                      <span className="cardrow__b truncate">{rightAnswers(q).join(' / ')}</span>
                    </div>
                  </div>
                ))}
              </div>
              {questions.length > 12 && !showAll && (
                <button
                  type="button"
                  className="btn btn--ghost btn--block btn--sm"
                  style={{ marginTop: '0.4rem' }}
                  onClick={() => setShowAll(true)}
                >
                  {t('set.showAll', { n: questions.length })}
                  <Icon name="chevronDown" />
                </button>
              )}
            </section>
          </div>
        )
      ) : set.cards.length === 0 ? (
        <Empty icon="cards" title={t('set.noCardsTitle')}>
          {canEdit ? t('set.noCardsEditor') : t('set.noCardsViewer')}
        </Empty>
      ) : (
        <div className="stack" style={{ '--gap': '1.25rem' } as React.CSSProperties}>
          <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <p className="eyebrow">{t('set.whichWay')}</p>
            <VariantPicker variants={offered} front={front} back={back} onChange={changePair} />
            <p className="tiny faint">
              {usable.length < set.cards.length
                ? t('variants.someCards', { n: usable.length, total: set.cards.length })
                : t('set.directionHint', {
                    from: offered.find((v) => v.key === front)?.name ?? '',
                    to: offered.find((v) => v.key === back)?.name ?? '',
                  })}
            </p>
          </section>

          {total === 0 ? (
            <Empty icon="cards" title={t('cards.nothingTitle')}>
              {t('cards.nothingPair', {
                front: offered.find((v) => v.key === front)?.name ?? '',
                back: offered.find((v) => v.key === back)?.name ?? '',
              })}
            </Empty>
          ) : (
            <>
              {/*
                Mastery, broken out rather than rolled into one number. Swiping a
                deck clear and writing it out from memory are different things, and
                a single percentage hid which of them was still missing.
              */}
              <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                <div className="spread">
                  <p className="eyebrow">{t('mastery.title')}</p>
                  <span className="chip chip--accent">{score}%</span>
                </div>
                <div className="panel panel--flush">
                  <MasteryRow
                    label={t('mastery.swiped')}
                    detail={`${tally.known}/${total}`}
                    weight={MASTERY.swiped}
                    done={total > 0 && tally.known === total}
                  />
                  <MasteryRow
                    label={t('mastery.choice')}
                    detail={tests.choice || tests.write ? t('mastery.done') : t('mastery.todo')}
                    weight={MASTERY.choice}
                    done={tests.choice || tests.write}
                  />
                  <MasteryRow
                    label={t('mastery.written')}
                    detail={tests.write ? t('mastery.done') : t('mastery.todo')}
                    weight={MASTERY.written}
                    done={tests.write}
                  />
                </div>
                <p className="tiny faint">
                  {t('mastery.writtenCovers')} {t('mastery.perDirection')}
                </p>
              </section>

              <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                <SplitBar known={tally.known} rehearse={tally.rehearse} total={total} />
                <div className="statgrid">
                  <div className="stat">
                    <div className="stat__value" style={{ color: 'var(--known)' }}>
                      {tally.known}
                    </div>
                    <div className="stat__label">{t('set.known')}</div>
                  </div>
                  <div className="stat">
                    <div className="stat__value" style={{ color: 'var(--rehearse)' }}>
                      {tally.rehearse}
                    </div>
                    <div className="stat__label">{t('set.rehearsing')}</div>
                  </div>
                  <div className="stat">
                    <div className="stat__value">{tally.new}</div>
                    <div className="stat__label">{t('set.untouched')}</div>
                  </div>
                </div>
              </section>

              <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                <button
                  type="button"
                  className="btn btn--primary btn--lg btn--block"
                  onClick={() => navigate(`/s/${set.slug}/cards?${query}`)}
                >
                  <Icon name="cards" />
                  {cleared
                    ? t('set.reviewFlashcards')
                    : tally.known > 0
                      ? t('set.continueFlashcards')
                      : t('set.startFlashcards')}
                </button>

                {cleared ? (
                  <button
                    type="button"
                    className="btn btn--lg btn--block"
                    onClick={() => navigate(`/s/${set.slug}/test?${query}`)}
                  >
                    <Icon name="trophy" />
                    {t('set.takeTest')}
                  </button>
                ) : (
                  <div className="panel stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                    <div className="row" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
                      <Icon name="lock" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
                      <span className="small grow">{t('set.locked', { n: total - tally.known })}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate(`/s/${set.slug}/test?${query}`)}
                    >
                      {t('set.testAnyway')}
                    </button>
                  </div>
                )}

                {total < MIN_CHOICE_CARDS && (
                  <p className="tiny faint center">{t('set.minChoice', { n: MIN_CHOICE_CARDS })}</p>
                )}
              </section>
            </>
          )}

          <section>
            <div className="spread" style={{ marginBottom: '0.5rem' }}>
              <p className="eyebrow">{t('set.allCards')}</p>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(true)}>
                <Icon name="rotate" />
                {t('set.resetProgress')}
              </button>
            </div>
            <div className="panel panel--flush">
              {(showAll ? set.cards : set.cards.slice(0, 12)).map((card) => (
                <div className="cardlist__item" key={card.id}>
                  <div className="cardlist__row">
                    <span className={`cardrow__dot cardrow__dot--${card.state?.[pair] ?? 'new'}`} />
                    <span className="cardrow__a truncate">{preferred(card, front) || '—'}</span>
                    <span className="cardrow__b truncate">{displayAnswer(field(card, back)) || '—'}</span>
                  </div>
                  {card.note && <p className="cardlist__note">{card.note}</p>}
                </div>
              ))}
            </div>
            {set.cards.length > 12 && !showAll && (
              <button
                type="button"
                className="btn btn--ghost btn--block btn--sm"
                style={{ marginTop: '0.4rem' }}
                onClick={() => setShowAll(true)}
              >
                {t('set.showAll', { n: set.cards.length })}
                <Icon name="chevronDown" />
              </button>
            )}
          </section>
        </div>
      )}

      {exporting && <ExportSheet text={exportText()} onClose={() => setExporting(false)} />}

      {confirmReset && (
        <Sheet
          title={t('set.resetTitle')}
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button type="button" className="btn btn--danger btn--block" onClick={reset}>
                <Icon name="rotate" />
                {t('set.resetConfirm')}
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirmReset(false)}>
                {t('common.keep')}
              </button>
            </>
          }
        >
          <p className="muted small">{t('set.resetBody', { title: set.title })}</p>
        </Sheet>
      )}
    </Shell>
  )
}
