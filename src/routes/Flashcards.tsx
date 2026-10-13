import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, outbox } from '../lib/api'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { haptics } from '../lib/haptics'
import { answerLang, buildRound, isDeckCleared, promptLang, requeue } from '../lib/study'
import type { Card, Direction, ProgressUpdate, StudySet } from '../lib/types'
import { readShow } from '../lib/display'
import { Shell, TopBar } from '../components/Shell'
import { Bar, Empty, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { Conjugation } from '../components/Conjugation'
import { SwipeDeck, type DeckHandle, type Verdict } from '../components/SwipeDeck'

/** Verdicts are batched so a round does not fire one request per card. */
const FLUSH_EVERY = 6

export function Flashcards() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useI18n()

  const dir: Direction = params.get('dir') === 'ba' ? 'ba' : 'ab'

  const [set, setSet] = useState<StudySet | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [queue, setQueue] = useState<Card[]>([])
  const [done, setDone] = useState(false)
  const [verb, setVerb] = useState<Card | null>(null)

  // Set once per round: changing what is shown mid-deck would make the cards
  // already swiped incomparable with the ones still to come.
  const [show] = useState(() => readShow(slug))

  const deck = useRef<DeckHandle | null>(null)
  const pending = useRef<ProgressUpdate[]>([])
  const startedAt = useRef(Date.now())

  /**
   * How the round went on first sight of each card. A card pushed to rehearse
   * comes round again, so counting every verdict would make a round of ten
   * cards report fifteen answers and an accuracy nobody can interpret.
   */
  const seen = useRef(new Set<number>())
  const firstPass = useRef({ total: 0, correct: 0 })

  const resetRound = useCallback(() => {
    seen.current = new Set<number>()
    firstPass.current = { total: 0, correct: 0 }
    startedAt.current = Date.now()
  }, [])

  const flush = useCallback(async () => {
    const updates = pending.current
    if (updates.length === 0) {
      return
    }
    pending.current = []
    try {
      const sent = await outbox.saveProgress(dir, updates)
      if (!sent) {
        toast.show(t('cards.savedLocally'))
      }
    } catch (caught) {
      toast.error(errorText(t, caught, 'errors.generic'))
    }
    // The toast helper and the translator are both stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir])

  useEffect(() => {
    let cancelled = false
    api
      .set(slug)
      .then((result) => {
        if (cancelled) {
          return
        }
        setSet(result)
        setCards(result.cards)
        setQueue(buildRound(result.cards, dir))
        resetRound()
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

  // Whatever is still unsent when leaving the screen goes out now.
  useEffect(() => () => void flush(), [flush])

  const onVerdict = useCallback(
    (card: Card, verdict: Verdict) => {
      const state = verdict === 'known' ? 'known' : 'rehearse'

      setCards((current) =>
        current.map((item) =>
          item.id === card.id ? { ...item, state: { ...item.state, [dir]: state } } : item,
        ),
      )

      pending.current.push({ cardId: card.id, state })
      if (!seen.current.has(card.id)) {
        seen.current.add(card.id)
        firstPass.current = {
          total: firstPass.current.total + 1,
          correct: firstPass.current.correct + (verdict === 'known' ? 1 : 0),
        }
      }
      if (pending.current.length >= FLUSH_EVERY) {
        void flush()
      }

      setQueue((current) => {
        const rest = current.slice(1)
        return verdict === 'known'
          ? rest
          : requeue(rest, { ...card, state: { ...card.state, [dir]: 'rehearse' } })
      })
    },
    [dir, flush],
  )

  // A round is over when nothing is left to show.
  useEffect(() => {
    if (set && queue.length === 0 && cards.length > 0 && !done) {
      setDone(true)
      haptics.finish()
      void flush().then(() =>
        outbox
          .recordResult({
            setId: set.id,
            dir,
            mode: 'flashcards',
            total: firstPass.current.total,
            correct: firstPass.current.correct,
            durationMs: Date.now() - startedAt.current,
          })
          .catch(() => undefined),
      )
    }
  }, [queue.length, set, cards, dir, done, flush])

  const cleared = useMemo(() => isDeckCleared(cards, dir), [cards, dir])
  const knownCount = useMemo(
    () => cards.filter((card) => card.state[dir] === 'known').length,
    [cards, dir],
  )

  if (!set) {
    return (
      <Shell immersive>
        <Spinner />
      </Shell>
    )
  }

  if (cards.length === 0) {
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={set.title} />
        <Empty icon="cards" title={t('cards.nothingTitle')}>
          {t('cards.nothingBody')}
        </Empty>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <TopBar back={`/s/${slug}`} title={set.title} />
        <div className="result">
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              width: '4.5rem',
              height: '4.5rem',
              borderRadius: '999px',
              background: cleared ? 'var(--known-dim)' : 'var(--accent-dim)',
              color: cleared ? 'var(--known)' : 'var(--accent)',
              animation: 'pop 420ms var(--ease-spring) both',
            }}
          >
            <Icon name={cleared ? 'check' : 'sparkle'} width={30} height={30} />
          </div>

          <div>
            <h1 className="result__headline">
              {cleared ? t('cards.allKnownTitle') : t('cards.roundFinished')}
            </h1>
            <p className="muted small" style={{ marginTop: '0.35rem' }}>
              {cleared
                ? t('cards.allKnownBody', { n: cards.length })
                : t('cards.roundBody', { known: knownCount, total: cards.length })}
            </p>
          </div>

          <div
            className="stack"
            style={{ '--gap': '0.5rem', width: '100%' } as React.CSSProperties}
          >
            {cleared ? (
              <button
                type="button"
                className="btn btn--primary btn--lg btn--block"
                onClick={() => navigate(`/s/${slug}/test?dir=${dir}`)}
              >
                <Icon name="trophy" />
                {t('cards.takeTheTest')}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--lg btn--block"
                onClick={() => {
                  setQueue(buildRound(cards, dir))
                  resetRound()
                  setDone(false)
                }}
              >
                <Icon name="rotate" />
                {t('cards.keepGoing')}
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate(`/s/${slug}`)}
            >
              {t('cards.backToSet')}
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell immersive>
      <TopBar
        back={`/s/${slug}`}
        title={set.title}
        actions={
          <span className="chip">
            {promptLang(set, dir)} <Icon name="arrowRight" width={11} height={11} />{' '}
            {answerLang(set, dir)}
          </span>
        }
      />

      <div className="stack" style={{ '--gap': '0.4rem' } as React.CSSProperties}>
        <Bar value={knownCount} total={cards.length} tone="known" />
        <div className="spread tiny faint">
          <span>{t('cards.knownCount', { n: knownCount })}</span>
          <span>{t('cards.left', { n: queue.length })}</span>
        </div>
        {/* The one case where the deck looks stuck: a single card that keeps
            coming straight back because it is the only one not yet known. */}
        {queue.length === 1 && cards.length > 1 && knownCount === cards.length - 1 && (
          <p className="tiny faint center">{t('cards.lastOne')}</p>
        )}
      </div>

      <SwipeDeck
        queue={queue}
        dir={dir}
        promptLabel={promptLang(set, dir)}
        answerLabel={answerLang(set, dir)}
        show={show}
        onVerdict={onVerdict}
        onConjugation={setVerb}
        handle={deck}
      />

      <div className="deck__actions">
        <button
          type="button"
          className="verdict-btn verdict-btn--rehearse"
          onClick={() => deck.current?.swipe('rehearse')}
        >
          <Icon name="rotate" />
          {t('cards.rehearse')}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('cards.flip')}
          onClick={() => deck.current?.flip()}
        >
          <Icon name="eye" size={22} />
        </button>
        <button
          type="button"
          className="verdict-btn verdict-btn--known"
          onClick={() => deck.current?.swipe('known')}
        >
          <Icon name="check" />
          {t('cards.iKnowIt')}
        </button>
      </div>

      {verb && (
        <Sheet title={`${t('word.conjugation')} — ${verb.a}`} onClose={() => setVerb(null)}>
          <Conjugation card={verb} />
        </Sheet>
      )}
    </Shell>
  )
}
