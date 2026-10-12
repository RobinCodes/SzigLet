import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { countStates, isDeckCleared, MIN_CHOICE_CARDS } from '../lib/study'
import { plural, relativeTime } from '../lib/format'
import type { Direction, StudySet } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Empty, Segmented, SplitBar, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'

const DIRECTION_KEY = 'sziglet.dir'

/** Remembering the direction per set is the difference between one tap and three. */
function readDirection(slug: string): Direction {
  try {
    return localStorage.getItem(`${DIRECTION_KEY}.${slug}`) === 'ba' ? 'ba' : 'ab'
  } catch {
    return 'ab'
  }
}

export function storeDirection(slug: string, dir: Direction): void {
  try {
    localStorage.setItem(`${DIRECTION_KEY}.${slug}`, dir)
  } catch {
    /* storage blocked */
  }
}

export function SetView() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { canEdit } = useAuth()

  const [set, setSet] = useState<StudySet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dir, setDir] = useState<Direction>(() => readDirection(slug))
  const [confirmReset, setConfirmReset] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(() => {
    api
      .set(slug)
      .then((result) => {
        setSet(result)
        setError(null)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Could not load this set.')
      })
  }, [slug])

  useEffect(load, [load])

  const changeDirection = (next: Direction) => {
    setDir(next)
    storeDirection(slug, next)
  }

  if (error) {
    return (
      <Shell>
        <TopBar back="/" />
        <Empty icon="search" title="Set not found">
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

  const tally = countStates(set.cards, dir)
  const total = set.cards.length
  const cleared = isDeckCleared(set.cards, dir)
  const fromLabel = dir === 'ab' ? set.langA : set.langB
  const toLabel = dir === 'ab' ? set.langB : set.langA

  const reset = async () => {
    try {
      await api.resetProgress(set.id, 'both')
      setConfirmReset(false)
      toast.success('Progress cleared.')
      load()
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Could not reset.')
    }
  }

  return (
    <Shell>
      <TopBar
        back="/"
        actions={
          canEdit ? (
            <Link to={`/s/${set.slug}/edit`} className="icon-btn" aria-label="Edit this set">
              <Icon name="edit" />
            </Link>
          ) : undefined
        }
      />

      <div className="sethead enter">
        <div className="row" style={{ '--gap': '0.4rem', marginBottom: '0.4rem' } as React.CSSProperties}>
          <span className="chip chip--accent">
            {set.langA} <Icon name="swap" width={11} height={11} /> {set.langB}
          </span>
          {!set.published && <span className="chip">Draft</span>}
        </div>
        <h1 className="sethead__title">{set.title}</h1>
        {set.description && <p className="sethead__desc">{set.description}</p>}
        <p className="tiny faint" style={{ marginTop: '0.5rem' }}>
          {plural(total, 'card', 'cards')}
          {set.author && ` · by ${set.author}`} · updated {relativeTime(set.updatedAt)}
        </p>
      </div>

      {total === 0 ? (
        <Empty icon="cards" title="No cards yet">
          {canEdit ? 'Add some cards to get started.' : 'This set is still empty.'}
        </Empty>
      ) : (
        <div className="stack" style={{ '--gap': '1.25rem' } as React.CSSProperties}>
          <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <p className="eyebrow">Which way round?</p>
            <Segmented
              label="Study direction"
              value={dir}
              onChange={changeDirection}
              options={[
                { value: 'ab', label: `${set.langA} → ${set.langB}` },
                { value: 'ba', label: `${set.langB} → ${set.langA}` },
              ]}
            />
            <p className="tiny faint">
              You will see the {fromLabel} side and recall the {toLabel} one. Each direction
              is tracked separately.
            </p>
          </section>

          <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <SplitBar known={tally.known} rehearse={tally.rehearse} total={total} />
            <div className="statgrid">
              <div className="stat">
                <div className="stat__value" style={{ color: 'var(--known)' }}>
                  {tally.known}
                </div>
                <div className="stat__label">Known</div>
              </div>
              <div className="stat">
                <div className="stat__value" style={{ color: 'var(--rehearse)' }}>
                  {tally.rehearse}
                </div>
                <div className="stat__label">Rehearsing</div>
              </div>
              <div className="stat">
                <div className="stat__value">{tally.new}</div>
                <div className="stat__label">Untouched</div>
              </div>
            </div>
          </section>

          <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <button
              type="button"
              className="btn btn--primary btn--lg btn--block"
              onClick={() => navigate(`/s/${set.slug}/cards?dir=${dir}`)}
            >
              <Icon name="cards" />
              {cleared ? 'Review the flashcards' : tally.known > 0 ? 'Continue flashcards' : 'Start flashcards'}
            </button>

            {cleared ? (
              <button
                type="button"
                className="btn btn--lg btn--block"
                onClick={() => navigate(`/s/${set.slug}/test?dir=${dir}`)}
              >
                <Icon name="trophy" />
                Take a test
              </button>
            ) : (
              <div className="panel stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                <div className="row" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
                  <Icon name="lock" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
                  <span className="small grow">
                    Tests unlock once every card is swiped to <strong>Known</strong> in this
                    direction — {plural(total - tally.known, 'card', 'cards')} to go.
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => navigate(`/s/${set.slug}/test?dir=${dir}`)}
                >
                  I already know these — test me anyway
                </button>
              </div>
            )}

            {total < MIN_CHOICE_CARDS && (
              <p className="tiny faint center">
                Multiple choice needs at least {MIN_CHOICE_CARDS} cards; this set will use
                written answers.
              </p>
            )}
          </section>

          <section>
            <div className="spread" style={{ marginBottom: '0.5rem' }}>
              <p className="eyebrow">All cards</p>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmReset(true)}
              >
                <Icon name="rotate" />
                Reset progress
              </button>
            </div>
            <div className="panel panel--flush">
              {(showAll ? set.cards : set.cards.slice(0, 12)).map((card) => (
                <div className="cardrow" key={card.id}>
                  <span className={`cardrow__dot cardrow__dot--${card.state[dir]}`} />
                  <span className="cardrow__a truncate">{dir === 'ab' ? card.a : card.b}</span>
                  <span className="cardrow__b truncate">{dir === 'ab' ? card.b : card.a}</span>
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
                Show all {set.cards.length}
                <Icon name="chevronDown" />
              </button>
            )}
          </section>
        </div>
      )}

      {confirmReset && (
        <Sheet title="Reset your progress?" onClose={() => setConfirmReset(false)}>
          <p className="muted small" style={{ marginBottom: '1rem' }}>
            Every card in <strong>{set.title}</strong> goes back to untouched, in both
            directions. This only affects you — the set itself is unchanged.
          </p>
          <div className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
            <button type="button" className="btn btn--danger btn--block" onClick={reset}>
              <Icon name="rotate" />
              Reset my progress
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => setConfirmReset(false)}
            >
              Keep it
            </button>
          </div>
        </Sheet>
      )}
    </Shell>
  )
}
