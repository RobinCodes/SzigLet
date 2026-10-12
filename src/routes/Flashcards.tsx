import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api, outbox } from '../lib/api'
import { useToast } from '../lib/toast'
import { haptics } from '../lib/haptics'
import { answerLang, buildRound, isDeckCleared, promptLang, requeue } from '../lib/study'
import { plural } from '../lib/format'
import type { Card, Direction, ProgressUpdate, StudySet } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Bar, Empty, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { SwipeDeck, type DeckHandle, type Verdict } from '../components/SwipeDeck'

/** Verdicts are batched so a round does not fire one request per card. */
const FLUSH_EVERY = 6

export function Flashcards() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()

  const dir: Direction = params.get('dir') === 'ba' ? 'ba' : 'ab'

  const [set, setSet] = useState<StudySet | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [queue, setQueue] = useState<Card[]>([])
  const [done, setDone] = useState(false)

  const deck = useRef<DeckHandle | null>(null)
  const pending = useRef<ProgressUpdate[]>([])
  const startedAt = useRef(Date.now())
  const seenCount = useRef(0)

  const flush = useCallback(async () => {
    const updates = pending.current
    if (updates.length === 0) {
      return
    }
    pending.current = []
    try {
      const sent = await outbox.saveProgress(dir, updates)
      if (!sent) {
        toast.show('Saved on this device — will sync later.')
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        toast.error(caught.message)
      }
    }
  }, [dir, toast])

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
        startedAt.current = Date.now()
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          toast.error(caught instanceof ApiError ? caught.message : 'Could not load this set.')
          navigate(`/s/${slug}`, { replace: true })
        }
      })
    return () => {
      cancelled = true
    }
    // The toast helper is stable; re-running on it would reload the set.
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
      seenCount.current += 1
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
            total: seenCount.current,
            correct: cards.filter((card) => card.state[dir] === 'known').length,
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
        <Empty icon="cards" title="Nothing to study">
          This set has no cards yet.
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
              {cleared ? 'Every card is known' : 'Round finished'}
            </h1>
            <p className="muted small" style={{ marginTop: '0.35rem' }}>
              {cleared
                ? `All ${plural(cards.length, 'card', 'cards')} swiped to Known. Tests are unlocked.`
                : `${knownCount} of ${cards.length} known so far.`}
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
                Take the test
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--lg btn--block"
                onClick={() => {
                  setQueue(buildRound(cards, dir))
                  seenCount.current = 0
                  startedAt.current = Date.now()
                  setDone(false)
                }}
              >
                <Icon name="rotate" />
                Keep going
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate(`/s/${slug}`)}
            >
              Back to the set
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
          <span>{knownCount} known</span>
          <span>{plural(queue.length, 'card left', 'cards left')}</span>
        </div>
      </div>

      <SwipeDeck
        queue={queue}
        dir={dir}
        promptLabel={promptLang(set, dir)}
        answerLabel={answerLang(set, dir)}
        onVerdict={onVerdict}
        handle={deck}
      />

      <div className="deck__actions">
        <button
          type="button"
          className="verdict-btn verdict-btn--rehearse"
          onClick={() => deck.current?.swipe('rehearse')}
        >
          <Icon name="rotate" />
          Rehearse
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Flip the card"
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
          I know it
        </button>
      </div>
    </Shell>
  )
}
