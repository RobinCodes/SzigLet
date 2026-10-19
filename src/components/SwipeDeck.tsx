import { useCallback, useEffect, useRef, useState } from 'react'
import { haptics } from '../lib/haptics'
import { displayAnswer } from '../lib/text'
import { useI18n } from '../lib/i18n'
import type { Card } from '../lib/types'
import { field, genderOf, preferred } from '../lib/variants'
import { hasConjugation } from '../lib/word'
import { Icon } from './Icon'
import { Word } from './Word'

export type Verdict = 'known' | 'rehearse'

/** Lets the parent trigger the same animated swipe the buttons use. */
export type DeckHandle = { swipe: (verdict: Verdict) => void; flip: () => void }

type Props = {
  /** The card on top, plus the next few to suggest a stack behind it. */
  queue: Card[]
  /** The variation on the front of the card, and the one on the back. */
  front: string
  back: string
  promptLabel: string
  answerLabel: string
  onVerdict: (card: Card, verdict: Verdict) => void
  /** Opens the verb table. Omitted when the screen has nowhere to put it. */
  onConjugation?: (card: Card) => void
  handle?: React.RefObject<DeckHandle | null>
}

/** Fraction of the card width a drag must cover to count as a decision. */
const DISTANCE_RATIO = 0.26
/** px per ms; a quick flick counts even if it did not travel far. */
const VELOCITY_THRESHOLD = 0.45
/** Must match --t-swipe in study.css, or the queue changes mid-flight. */
const EXIT_MS = 260

export function SwipeDeck({
  queue,
  front: frontKey,
  back: backKey,
  promptLabel,
  answerLabel,
  onVerdict,
  onConjugation,
  handle,
}: Props) {
  const { t } = useI18n()
  const [flipped, setFlipped] = useState(false)
  const [leaving, setLeaving] = useState<Verdict | null>(null)

  const cardRef = useRef<HTMLDivElement>(null)
  const knownStamp = useRef<HTMLSpanElement>(null)
  const rehearseStamp = useRef<HTMLSpanElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)

  const drag = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startTime: 0,
    dx: 0,
    dy: 0,
    moved: false,
  })

  /** Latest pointer offset, drained once per frame. */
  const frame = useRef(0)
  const offset = useRef({ dx: 0, dy: 0 })

  const top = queue[0]
  const behind = queue.slice(1, 3)

  const paintStamps = useCallback((dx: number) => {
    const width = cardRef.current?.offsetWidth ?? 320
    const intensity = Math.min(1, Math.abs(dx) / (width * DISTANCE_RATIO))
    if (knownStamp.current) {
      knownStamp.current.style.opacity = dx > 0 ? String(intensity) : '0'
    }
    if (rehearseStamp.current) {
      rehearseStamp.current.style.opacity = dx < 0 ? String(intensity) : '0'
    }
    if (hintRef.current) {
      hintRef.current.style.opacity = String(Math.max(0, 1 - intensity * 1.6))
    }
  }, [])

  // One transform write per frame. A phone fires pointermove faster than it
  // paints, and writing the style on every event is what made the swipe feel
  // like it was catching.
  const paint = useCallback(() => {
    frame.current = 0
    const { dx, dy } = offset.current
    const node = cardRef.current
    if (node) {
      // Vertical movement is damped: this is a horizontal gesture.
      node.style.transform =
        `translate3d(${dx.toFixed(2)}px, ${(dy * 0.28).toFixed(2)}px, 0) rotate(${(dx / 22).toFixed(3)}deg)`
    }
    paintStamps(dx)
  }, [paintStamps])

  const schedule = useCallback(() => {
    if (frame.current === 0) {
      frame.current = requestAnimationFrame(paint)
    }
  }, [paint])

  const cancelFrame = useCallback(() => {
    if (frame.current !== 0) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [])

  useEffect(() => cancelFrame, [cancelFrame])

  /**
   * Every new presentation starts face-up and untransformed.
   *
   * This keys off the queue rather than the card id on purpose. Rehearsing the
   * only card left puts that same card straight back on top, so the id does
   * not change — and the deck used to stay stuck in its "leaving" state with
   * the card parked off screen, refusing every further swipe.
   */
  useEffect(() => {
    setFlipped(false)
    setLeaving(null)
    cancelFrame()
    offset.current = { dx: 0, dy: 0 }
    drag.current.active = false

    const node = cardRef.current
    if (node) {
      // The exit transition is still on the element at this point, so the
      // reset has to be made outside of it or the card would glide back.
      node.style.transition = 'none'
      node.style.transform = ''
      node.style.opacity = ''
      void node.offsetWidth
      node.style.transition = ''
    }
    paintStamps(0)
  }, [queue, paintStamps, cancelFrame])

  /** Sends the top card off screen, then reports the verdict. */
  const commit = useCallback(
    (verdict: Verdict) => {
      const card = top
      const node = cardRef.current
      if (!card || leaving) {
        return
      }

      verdict === 'known' ? haptics.known() : haptics.rehearse()
      cancelFrame()
      setLeaving(verdict)

      if (node) {
        const direction = verdict === 'known' ? 1 : -1
        const travel = (window.innerWidth || 420) * 1.15 * direction
        node.style.transform =
          `translate3d(${travel}px, ${offset.current.dy}px, 0) rotate(${direction * 18}deg)`
        node.style.opacity = '0'
      }

      // Matches --t-swipe so the card is gone before the queue changes.
      window.setTimeout(() => onVerdict(card, verdict), EXIT_MS)
    },
    [top, leaving, onVerdict, cancelFrame],
  )

  const flip = useCallback(() => {
    haptics.tap()
    setFlipped((value) => !value)
  }, [])

  useEffect(() => {
    if (handle) {
      handle.current = { swipe: commit, flip }
    }
  }, [handle, commit, flip])

  // ── Pointer handling ──────────────────────────────────────────────────────

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (leaving || event.button !== 0) {
      return
    }
    const node = cardRef.current
    if (!node) {
      return
    }
    node.setPointerCapture(event.pointerId)
    node.classList.add('flashcard--dragging')
    node.classList.remove('flashcard--settling')

    offset.current = { dx: 0, dy: 0 }
    drag.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: performance.now(),
      dx: 0,
      dy: 0,
      moved: false,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state.active || event.pointerId !== state.pointerId) {
      return
    }
    state.dx = event.clientX - state.startX
    state.dy = event.clientY - state.startY
    if (Math.abs(state.dx) > 6 || Math.abs(state.dy) > 6) {
      state.moved = true
    }

    offset.current = { dx: state.dx, dy: state.dy }
    schedule()
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state.active || event.pointerId !== state.pointerId) {
      return
    }
    state.active = false
    cancelFrame()

    const node = cardRef.current
    node?.classList.remove('flashcard--dragging')

    const width = node?.offsetWidth ?? 320
    const elapsed = Math.max(1, performance.now() - state.startTime)
    const velocity = state.dx / elapsed

    const decided =
      Math.abs(state.dx) > width * DISTANCE_RATIO ||
      (Math.abs(velocity) > VELOCITY_THRESHOLD && Math.abs(state.dx) > 24)

    if (decided) {
      commit(state.dx > 0 ? 'known' : 'rehearse')
      return
    }

    // A tap rather than a drag: flip the card.
    if (!state.moved && elapsed < 400) {
      flip()
    }

    node?.classList.add('flashcard--settling')
    if (node) {
      node.style.transform = ''
    }
    offset.current = { dx: 0, dy: 0 }
    paintStamps(0)
  }

  // ── Keyboard, for laptop use ──────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        commit('known')
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        commit('rehearse')
      } else if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        flip()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commit, flip])

  if (!top) {
    return null
  }

  // The front asks about the preferred form only; the back shows every
  // accepted answer.
  const front = preferred(top, frontKey)
  const back = displayAnswer(field(top, backKey))
  const frontWord = { term: front, gender: genderOf(top, frontKey) }
  const backWord = { term: back, gender: genderOf(top, backKey) }

  return (
    <div className="deck">
      <div className="deck__stage">
        {/* The cards behind, drawn first so they sit underneath. */}
        {behind
          .map((card, index) => (
            <div
              key={card.id}
              className="flashcard flashcard--stacked"
              aria-hidden="true"
              style={{
                transform: `translate3d(0, ${(index + 1) * 13}px, 0) scale(${1 - (index + 1) * 0.045})`,
                opacity: 1 - (index + 1) * 0.3,
                zIndex: 1,
              }}
            >
              <div className="flashcard__face" />
            </div>
          ))
          .reverse()}

        <div
          ref={cardRef}
          className={`flashcard${leaving ? ' flashcard--leaving' : ''}`}
          style={{ zIndex: 3 }}
          role="button"
          tabIndex={0}
          aria-label={t('cards.cardAria', {
            prompt: promptLabel,
            front,
            answer: answerLabel,
          })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="stamp stamp--known" ref={knownStamp}>
            {t('cards.stampKnown')}
          </span>
          <span className="stamp stamp--rehearse" ref={rehearseStamp}>
            {t('cards.stampRehearse')}
          </span>

          <div
            className="flashcard__inner"
            style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
          >
            <div className="flashcard__face">
              <span className="flashcard__lang">{promptLabel}</span>
              <div>
                <Word
                  word={frontWord}
                  className={`flashcard__term${front.length > 28 ? ' flashcard__term--long' : ''}`}
                />
              </div>
              <div className="flashcard__hint" ref={hintRef}>
                {t('cards.tapToReveal')}
              </div>
            </div>

            <div className="flashcard__face flashcard__face--back">
              <span className="flashcard__lang">{answerLabel}</span>
              <div>
                <Word
                  word={backWord}
                  className={`flashcard__term${back.length > 28 ? ' flashcard__term--long' : ''}`}
                />
                {top.note && <p className="flashcard__note">{top.note}</p>}

                {onConjugation && hasConjugation(top) && (
                  <div className="revealrow">
                    <button
                      type="button"
                      className="chip chip--button chip--accent"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        onConjugation(top)
                      }}
                    >
                      <Icon name="list" width={11} height={11} />
                      {t('word.conjugation')}
                    </button>
                  </div>
                )}
              </div>
              <div className="flashcard__hint">{t('cards.swipeHint')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
