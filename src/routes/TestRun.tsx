import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, outbox } from '../lib/api'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { haptics } from '../lib/haptics'
import { buildChoiceQuestion, MIN_CHOICE_CARDS, shuffle } from '../lib/study'
import { displayAnswer } from '../lib/text'
import { percent } from '../lib/format'
import { hasConjugation } from '../lib/word'
import {
  alsoAccepted,
  dirKey,
  field,
  genderOf,
  nameOf,
  parseDir,
  preferred,
  usableCards,
  variantsOf,
} from '../lib/variants'
import type { Card, ProgressUpdate, StudySet, TestMode } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Bar, Empty, Segmented, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { Conjugation } from '../components/Conjugation'
import { Word } from '../components/Word'
import { Options, WrittenAnswer } from '../components/Answer'
import { FlagButton } from '../components/FlagButton'

type Phase = 'setup' | 'running' | 'roundEnd' | 'done'

type Asked = 'choice' | 'write'

export function TestRun() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t, duration } = useI18n()

  const { front, back } = parseDir(params.get('dir'))
  const dir = dirKey(front, back)

  const [set, setSet] = useState<StudySet | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [mode, setMode] = useState<TestMode>('choice')
  const [phase, setPhase] = useState<Phase>('setup')
  const [advanced, setAdvanced] = useState(false)
  const [limit, setLimit] = useState(0)

  const [queue, setQueue] = useState<Card[]>([])
  /** In a mixed test, how each card is asked this round. */
  const [asks, setAsks] = useState<Map<number, Asked>>(new Map())
  const [index, setIndex] = useState(0)
  const [round, setRound] = useState(1)
  const [missed, setMissed] = useState<Card[]>([])
  const [stumbled, setStumbled] = useState<Card[]>([])
  const [answer, setAnswer] = useState<{ right: boolean; chosen?: number } | null>(null)
  const [verb, setVerb] = useState<Card | null>(null)
  const [firstPass, setFirstPass] = useState({ total: 0, correct: 0 })
  const [partial, setPartial] = useState(false)

  const pending = useRef<ProgressUpdate[]>([])
  const startedAt = useRef(Date.now())
  const advanceTimer = useRef<number | undefined>(undefined)

  // ── Loading ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    api
      .set(slug)
      .then((result) => {
        if (cancelled) {
          return
        }
        const usable = usableCards(result.cards, front, back, variantsOf(result), result.hidden)
        setSet(result)
        setCards(usable)
        setLimit(usable.length)
        setMode(usable.length >= MIN_CHOICE_CARDS ? 'choice' : 'write')
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          toast.error(errorText(t, caught, 'set.loadFailed'))
          navigate(`/s/${slug}`, { replace: true })
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, dir])

  useEffect(() => () => window.clearTimeout(advanceTimer.current), [])

  const flush = useCallback(async () => {
    const updates = pending.current
    if (updates.length === 0) {
      return
    }
    pending.current = []
    try {
      await outbox.saveProgress(dir, updates)
    } catch {
      /* the outbox already kept it */
    }
  }, [dir])

  useEffect(() => () => void flush(), [flush])

  const variants = useMemo(() => (set ? variantsOf(set) : []), [set])
  const card = queue[index]
  const asked: Asked = mode === 'mixed' ? (card ? asks.get(card.id) ?? 'choice' : 'choice') : mode

  const question = useMemo(() => {
    if (!card || asked !== 'choice') {
      return null
    }
    return buildChoiceQuestion(card, cards, front, back)
    // A fresh set of distractors per card, per round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, cards, front, back, asked, round])

  /** Mixed tests ask roughly half the cards each way, freshly per round. */
  const deal = (list: Card[]) =>
    new Map(list.map((item) => [item.id, (Math.random() < 0.5 ? 'choice' : 'write') as Asked]))

  const start = () => {
    const count = Math.max(1, Math.min(limit || cards.length, cards.length))
    const picked = shuffle(cards).slice(0, count)
    setQueue(picked)
    setAsks(deal(picked))
    setPartial(count < cards.length)
    setIndex(0)
    setRound(1)
    setMissed([])
    setStumbled([])
    setAnswer(null)
    setFirstPass({ total: 0, correct: 0 })
    startedAt.current = Date.now()
    setPhase('running')
  }

  /** Moves to the next card, or ends the round. */
  const advance = useCallback(() => {
    window.clearTimeout(advanceTimer.current)
    setAnswer(null)
    if (index + 1 < queue.length) {
      setIndex(index + 1)
      return
    }
    setPhase(missed.length > 0 ? 'roundEnd' : 'done')
  }, [index, queue.length, missed.length])

  const register = (right: boolean, chosen?: number) => {
    if (!card) {
      return
    }
    if (right) {
      pending.current.push({ cardId: card.id, state: 'known', right: true })
    } else {
      pending.current.push({ cardId: card.id, state: 'rehearse', wrong: true })
      setMissed((current) => (current.some((item) => item.id === card.id) ? current : [...current, card]))
      setStumbled((current) => (current.some((item) => item.id === card.id) ? current : [...current, card]))
    }
    if (round === 1) {
      setFirstPass((current) => ({ total: current.total + 1, correct: current.correct + (right ? 1 : 0) }))
    }
    if (pending.current.length >= 8) {
      void flush()
    }
    setAnswer({ right, chosen })

    // Right answers move on by themselves; wrong ones wait so the correct
    // answer, and any note on the card, can actually be read.
    if (right && asked === 'choice' && !card.note) {
      advanceTimer.current = window.setTimeout(advance, 620)
    }
  }

  const choose = (optionIndex: number, right: boolean) => {
    if (answer) {
      return
    }
    right ? haptics.known() : haptics.wrong()
    register(right, optionIndex)
  }

  const nextRound = () => {
    const again = shuffle(missed)
    setQueue(again)
    setAsks(deal(again))
    setMissed([])
    setIndex(0)
    setRound((value) => value + 1)
    setAnswer(null)
    setPhase('running')
  }

  /** A card reported and hidden leaves the test there and then. */
  const drop = (item: string) => {
    const id = Number(item.slice(2))
    setCards((current) => current.filter((other) => other.id !== id))
    setMissed((current) => current.filter((other) => other.id !== id))
    if (queue.length <= 1) {
      setPhase(missed.filter((other) => other.id !== id).length > 0 ? 'roundEnd' : 'done')
      return
    }
    setQueue((current) => current.filter((other) => other.id !== id))
    setAnswer(null)
    setIndex((current) => Math.min(current, queue.length - 2))
  }

  // Enter or space moves on once a multiple-choice answer is in.
  useEffect(() => {
    if (phase !== 'running' || asked !== 'choice' || !answer) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, asked, answer, advance])

  // ── Finishing ─────────────────────────────────────────────────────────────

  const recorded = useRef(false)
  useEffect(() => {
    if (phase !== 'done' || !set || recorded.current) {
      return
    }
    recorded.current = true
    haptics.finish()
    void flush().then(() =>
      outbox
        .recordResult({
          setId: set.id,
          dir,
          mode,
          total: firstPass.total,
          correct: firstPass.correct,
          durationMs: Date.now() - startedAt.current,
          partial,
        })
        .catch(() => undefined),
    )
  }, [phase, set, dir, mode, firstPass, flush, partial])

  // ── Rendering ─────────────────────────────────────────────────────────────

  if (!set) {
    return (
      <Shell immersive>
        <Spinner />
      </Shell>
    )
  }

  const fromLabel = nameOf(variants, front)
  const toLabel = nameOf(variants, back)

  if (cards.length === 0 && phase === 'setup') {
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={set.title} />
        <Empty icon="cards" title={t('test.nothingTitle')}>
          {set.cards.length > 0
            ? t('cards.nothingPair', { front: fromLabel, back: toLabel })
            : t('test.nothingBody')}
        </Empty>
      </Shell>
    )
  }

  if (phase === 'setup') {
    const choiceOk = cards.length >= MIN_CHOICE_CARDS
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={t('test.title')} />
        <div className="stack enter" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
          <div>
            <h1 className="sethead__title">{t('test.setupTitle')}</h1>
            <p className="muted small" style={{ marginTop: '0.4rem' }}>
              {t('test.setupBody', {
                cards: t('set.cards', { n: cards.length }),
                from: fromLabel,
                to: toLabel,
              })}
            </p>
          </div>

          <Segmented
            label={t('test.modeLabel')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'choice', label: t('test.choice') },
              { value: 'write', label: t('test.write') },
              { value: 'mixed', label: t('test.mixed') },
            ]}
          />

          <div className="panel row" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <Icon
              name={mode === 'choice' ? 'list' : mode === 'write' ? 'keyboard' : 'layers'}
              style={{ color: 'var(--accent)', flex: 'none' }}
            />
            <p className="small grow">
              {mode === 'choice' ? t('test.choiceHint') : mode === 'write' ? t('test.writeHint') : t('test.mixedHint')}
            </p>
          </div>

          {!choiceOk && mode !== 'write' && (
            <p className="field__error small">{t('test.needCards', { n: MIN_CHOICE_CARDS })}</p>
          )}

          <div className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ alignSelf: 'flex-start' }}
              aria-expanded={advanced}
              onClick={() => setAdvanced((value) => !value)}
            >
              <Icon name="settings" />
              {t('test.advanced')}
              <Icon name="chevronDown" style={{ transform: advanced ? 'rotate(180deg)' : undefined }} />
            </button>
            {advanced && (
              <div className="panel stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
                <label className="field">
                  <span className="field__label">{t('test.howMany')}</span>
                  <div className="row" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
                    <input
                      type="range"
                      className="grow"
                      min={1}
                      max={cards.length}
                      value={limit}
                      onChange={(event) => setLimit(Number(event.target.value))}
                    />
                    <input
                      type="number"
                      className="input input--num"
                      min={1}
                      max={cards.length}
                      value={limit}
                      onChange={(event) =>
                        setLimit(Math.max(1, Math.min(cards.length, Number(event.target.value) || 1)))
                      }
                    />
                  </div>
                </label>
                <p className="field__hint">
                  {limit < cards.length ? t('test.partialHint') : t('test.allHint', { n: cards.length })}
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={start}
            disabled={mode !== 'write' && !choiceOk}
          >
            <Icon name="play" />
            {t('test.start')}
          </button>
        </div>
      </Shell>
    )
  }

  if (phase === 'roundEnd') {
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={t('test.round', { n: round })} />
        <div className="result">
          <div className="result__badge result__badge--rehearse">
            <Icon name="rotate" width={28} height={28} />
          </div>
          <div>
            <h1 className="result__headline">{t('test.toRepeat', { n: missed.length })}</h1>
            <p className="muted small" style={{ marginTop: '0.35rem' }}>
              {t('test.roundEndBody', { n: round })}
            </p>
          </div>

          <div className="panel panel--flush wronglist">
            {missed.map((item) => (
              <div className="cardrow" key={item.id}>
                <span className="cardrow__dot cardrow__dot--rehearse" />
                <span className="cardrow__a truncate">{preferred(item, front)}</span>
                <span className="cardrow__b truncate">{displayAnswer(field(item, back))}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={nextRound}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          >
            <Icon name="arrowRight" />
            {t('test.repeatThese', { n: missed.length })}
          </button>
        </div>
      </Shell>
    )
  }

  if (phase === 'done') {
    const score = percent(firstPass.correct, firstPass.total)
    const flawless = stumbled.length === 0

    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={t('test.result')} />
        <div className="result">
          <div>
            <p className="eyebrow">{t('test.firstAttempt')}</p>
            <div
              className="result__score"
              style={{ color: score >= 80 ? 'var(--known)' : score >= 50 ? 'var(--rehearse)' : 'var(--wrong)' }}
            >
              {score}%
            </div>
            <p className="muted small">
              {t('test.rightFirstTime', { correct: firstPass.correct, total: firstPass.total })}
            </p>
            {partial && <p className="tiny faint" style={{ marginTop: '0.3rem' }}>{t('test.partialDone')}</p>}
          </div>

          <h1 className="result__headline">
            {flawless
              ? t('test.perfect')
              : score >= 80
                ? t('test.nicely')
                : score >= 50
                  ? t('test.gettingThere')
                  : t('test.anotherPass')}
          </h1>

          <div className="statgrid" style={{ width: '100%' }}>
            <div className="stat">
              <div className="stat__value">{round}</div>
              <div className="stat__label">{t('test.rounds')}</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stumbled.length}</div>
              <div className="stat__label">{t('test.stumbled')}</div>
            </div>
            <div className="stat">
              <div className="stat__value" style={{ fontSize: '1.1rem' }}>
                {duration(Date.now() - startedAt.current)}
              </div>
              <div className="stat__label">{t('test.time')}</div>
            </div>
          </div>

          {stumbled.length > 0 && (
            <div className="wronglist stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
              <p className="eyebrow">{t('test.worthLook')}</p>
              <div className="panel panel--flush">
                {stumbled.map((item) => (
                  <div className="cardlist__item" key={item.id}>
                    <div className="cardlist__row">
                      <span className="cardrow__a truncate">{preferred(item, front)}</span>
                      <span className="cardrow__b truncate">{displayAnswer(field(item, back))}</span>
                    </div>
                    {item.note && <p className="cardlist__note">{item.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="stack" style={{ '--gap': '0.5rem', width: '100%' } as React.CSSProperties}>
            <button
              type="button"
              className="btn btn--primary btn--lg btn--block"
              onClick={() => {
                recorded.current = false
                setPhase('setup')
              }}
            >
              <Icon name="rotate" />
              {t('test.testAgain')}
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={() => navigate(`/s/${slug}`)}>
              {t('cards.backToSet')}
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // phase === 'running'
  const revealed = answer !== null
  const reveal = card ? displayAnswer(field(card, back)) : ''

  return (
    <Shell immersive>
      <TopBar
        back={`/s/${slug}`}
        title={round > 1 ? t('test.round', { n: round }) : set.title}
        actions={
          <>
            <span className="chip truncate">
              {fromLabel} <Icon name="arrowRight" width={11} height={11} /> {toLabel}
            </span>
            <FlagButton item={card ? `c:${card.id}` : null} onHidden={drop} />
          </>
        }
      />

      <div className="stack" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
        <Bar value={index + (revealed ? 1 : 0)} total={queue.length} />
        <div className="spread tiny faint">
          <span className="num">{t('test.counter', { index: index + 1, total: queue.length })}</span>
          {missed.length > 0 && <span>{t('test.repeatShort', { n: missed.length })}</span>}
        </div>
      </div>

      <div className="quiz">
        <div className="quiz__prompt" key={`${card?.id}-${round}`}>
          <div>
            {card ? (
              <Word word={{ term: preferred(card, front), gender: genderOf(card, front) }} className="quiz__term" />
            ) : (
              <p className="quiz__term" />
            )}
            <p className="quiz__ask">{t('test.inLang', { lang: toLabel })}</p>
          </div>
        </div>

        {asked === 'choice' && question && (
          <Options
            options={question.options}
            isRight={(optionIndex) => optionIndex === question.correctIndex}
            chosen={answer?.chosen ?? null}
            onChoose={choose}
          />
        )}

        {asked === 'write' && card && (
          <WrittenAnswer
            key={`${card.id}-${round}-${index}`}
            accepted={[field(card, back), ...alsoAccepted(card, back, variants)]}
            reveal={reveal}
            placeholder={t('test.typePlaceholder', { lang: toLabel })}
            onSettled={(right) => register(right)}
          />
        )}

        {/* The note is part of the answer: this is where "il gesso is kréta in
            the classroom, but also gipsz" has to be readable. */}
        {revealed && card?.note && (
          <div className="quiz__note">
            <Icon name="sparkle" />
            <span>{card.note}</span>
          </div>
        )}

        {revealed && card && hasConjugation(card) && (
          <button type="button" className="btn btn--block btn--sm" onClick={() => setVerb(card)}>
            <Icon name="list" />
            {t('word.conjugation')}
          </button>
        )}

        {revealed && (
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={advance}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={asked === 'write'}
          >
            {index + 1 < queue.length
              ? t('common.next')
              : missed.length > 0
                ? t('test.seeRepeat')
                : t('common.finish')}
            <Icon name="arrowRight" />
          </button>
        )}
      </div>

      {verb && (
        <Sheet title={`${t('word.conjugation')} — ${verb.a}`} onClose={() => setVerb(null)}>
          <Conjugation card={verb} />
        </Sheet>
      )}
    </Shell>
  )
}
