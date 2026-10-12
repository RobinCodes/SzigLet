import { useCallback, useEffect, useRef, useState } from 'react'
import { haptics } from '../lib/haptics'
import { displayAnswer } from '../lib/text'
import type { Card, Direction } from '../lib/types'
import { answerSide, promptSide } from '../lib/study'

export type Verdict = 'known' | 'rehearse'

/** Lets the parent trigger the same animated swipe the buttons use. */
export type DeckHandle = { swipe: (verdict: Verdict) => void; flip: () => void }

type Props = {
  /** The card on top, plus the next few to suggest a stack behind it. */
  queue: Card[]
  dir: Direction
  promptLabel: string
  answerLabel: string
  onVerdict: (card: Card, verdict: Verdict) => void
  handle?: React.RefObject<DeckHandle | null>
}

/** Fraction of the card width a drag must cover to count as a decision. */
const DISTANCE_RATIO = 0.26
/** px per ms; a quick flick counts even if it did not travel far. */
const VELOCITY_THRESHOLD = 0.45

export function SwipeDeck({ queue, dir, promptLabel, answerLabel, onVerdict, handle }: Props) {
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

  // A new card arrives face-up and untransformed.
  useEffect(() => {
    setFlipped(false)
    setLeaving(null)
    const node = cardRef.current
    if (node) {
      node.style.transform = ''
      node.style.opacity = ''
    }
    paintStamps(0)
  }, [top?.id, paintStamps])

  /** Sends the top card off screen, then reports the verdict. */
  const commit = useCallback(
    (verdict: Verdict) => {
      const card = top
      const node = cardRef.current
      if (!card || leaving) {
        return
      }

      verdict === 'known' ? haptics.known() : haptics.rehearse()
      setLeaving(verdict)

      if (node) {
        const direction = verdict === 'known' ? 1 : -1
        const travel = (window.innerWidth || 420) * 1.15 * direction
        node.style.transform = `translate3d(${travel}px, ${drag.current.dy}px, 0) rotate(${direction * 18}deg)`
        node.style.opacity = '0'
      }

      // Matches the .flashcard--leaving transition so the card is gone before
      // the queue changes underneath it.
      window.setTimeout(() => onVerdict(card, verdict), 240)
    },
    [top, leaving, onVerdict],
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
  // Styles are written straight to the node while dragging; going through
  // React state here would drop frames on a mid-range phone.

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

    const node = cardRef.current
    if (node) {
      // Vertical movement is damped: this is a horizontal gesture.
      node.style.transform =
        `translate3d(${state.dx}px, ${state.dy * 0.28}px, 0) rotate(${state.dx / 22}deg)`
    }
    paintStamps(state.dx)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state.active || event.pointerId !== state.pointerId) {
      return
    }
    state.active = false

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

  const front = promptSide(top, dir)
  const back = displayAnswer(answerSide(top, dir))

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
          aria-label={`${promptLabel}: ${front}. Tap to reveal the ${answerLabel}.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="stamp stamp--known" ref={knownStamp}>
            Known
          </span>
          <span className="stamp stamp--rehearse" ref={rehearseStamp}>
            Rehearse
          </span>

          <div
            className="flashcard__inner"
            style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
          >
            <div className="flashcard__face">
              <span className="flashcard__lang">{promptLabel}</span>
              <div>
                <p className={`flashcard__term${front.length > 28 ? ' flashcard__term--long' : ''}`}>
                  {front}
                </p>
              </div>
              <div className="flashcard__hint" ref={hintRef}>
                Tap to reveal
              </div>
            </div>

            <div className="flashcard__face flashcard__face--back">
              <span className="flashcard__lang">{answerLabel}</span>
              <div>
                <p className={`flashcard__term${back.length > 28 ? ' flashcard__term--long' : ''}`}>
                  {back}
                </p>
                {top.note && <p className="flashcard__note">{top.note}</p>}
              </div>
              <div className="flashcard__hint">Swipe right if you knew it</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
