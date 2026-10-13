import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { countStates, isDeckCleared, MIN_CHOICE_CARDS } from '../lib/study'
import { readShow, storeShow, toggle } from '../lib/display'
import {
  ATTRIBUTES,
  MASTERY,
  NO_TESTS,
  anyHas,
  answerKey,
  masteryPercent,
  promptKey,
  type Attribute,
} from '../lib/word'
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

export function SetView() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { canEdit } = useAuth()
  const { t, relative } = useI18n()

  const [set, setSet] = useState<StudySet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dir, setDir] = useState<Direction>(() => readDirection(slug))
  const [confirmReset, setConfirmReset] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [show, setShow] = useState(() => readShow(slug))

  const flip = (attribute: Attribute) => {
    const next = toggle(show, attribute)
    setShow(next)
    storeShow(slug, next)
  }

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

  const changeDirection = (next: Direction) => {
    setDir(next)
    storeDirection(slug, next)
  }

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

  const tally = countStates(set.cards, dir)
  const total = set.cards.length
  const cleared = isDeckCleared(set.cards, dir)
  const fromLabel = dir === 'ab' ? set.langA : set.langB
  const toLabel = dir === 'ab' ? set.langB : set.langA

  const tests = set.tests?.[dir] ?? NO_TESTS
  const score = masteryPercent(tally.known, total, tests)

  // Only offer a switch for grammar some card in this set actually carries;
  // three dead toggles on a set of plain nouns is just noise.
  const available = ATTRIBUTES.filter(
    (attribute) =>
      anyHas(set.cards, promptKey(dir), attribute) ||
      anyHas(set.cards, answerKey(dir), attribute),
  )

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

  return (
    <Shell>
      <TopBar
        back="/"
        actions={
          canEdit ? (
            <Link to={`/s/${set.slug}/edit`} className="icon-btn" aria-label={t('set.edit')}>
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
          {!set.published && <span className="chip">{t('common.draft')}</span>}
        </div>
        <h1 className="sethead__title">{set.title}</h1>
        {set.description && <p className="sethead__desc">{set.description}</p>}
        <p className="tiny faint" style={{ marginTop: '0.5rem' }}>
          {t('set.cards', { n: total })}
          {set.author && ` · ${t('set.by', { author: set.author })}`} ·{' '}
          {t('set.updated', { when: relative(set.updatedAt) })}
        </p>
      </div>

      {total === 0 ? (
        <Empty icon="cards" title={t('set.noCardsTitle')}>
          {canEdit ? t('set.noCardsEditor') : t('set.noCardsViewer')}
        </Empty>
      ) : (
        <div className="stack" style={{ '--gap': '1.25rem' } as React.CSSProperties}>
          <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
            <p className="eyebrow">{t('set.whichWay')}</p>
            <Segmented
              label={t('set.directionLabel')}
              value={dir}
              onChange={changeDirection}
              options={[
                { value: 'ab', label: `${set.langA} → ${set.langB}` },
                { value: 'ba', label: `${set.langB} → ${set.langA}` },
              ]}
            />
            <p className="tiny faint">
              {t('set.directionHint', { from: fromLabel, to: toLabel })}
            </p>
          </section>

          {available.length > 0 && (
            <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
              <p className="eyebrow">{t('word.showTitle')}</p>
              <div className="togglerow">
                {available.map((attribute) => (
                  <button
                    key={attribute}
                    type="button"
                    className={`chip chip--button${show[attribute] ? ' chip--accent' : ''}`}
                    aria-pressed={show[attribute]}
                    onClick={() => flip(attribute)}
                  >
                    <Icon name={show[attribute] ? 'check' : 'plus'} width={12} height={12} />
                    {t(`word.${attribute}`)}
                  </button>
                ))}
              </div>
              <p className="tiny faint">{t('word.showHint')}</p>
            </section>
          )}

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
              onClick={() => navigate(`/s/${set.slug}/cards?dir=${dir}`)}
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
                onClick={() => navigate(`/s/${set.slug}/test?dir=${dir}`)}
              >
                <Icon name="trophy" />
                {t('set.takeTest')}
              </button>
            ) : (
              <div className="panel stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
                <div className="row" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
                  <Icon name="lock" style={{ color: 'var(--ink-faint)', flex: 'none' }} />
                  <span className="small grow">
                    {t('set.locked', { n: total - tally.known })}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => navigate(`/s/${set.slug}/test?dir=${dir}`)}
                >
                  {t('set.testAnyway')}
                </button>
              </div>
            )}

            {total < MIN_CHOICE_CARDS && (
              <p className="tiny faint center">{t('set.minChoice', { n: MIN_CHOICE_CARDS })}</p>
            )}
          </section>

          <section>
            <div className="spread" style={{ marginBottom: '0.5rem' }}>
              <p className="eyebrow">{t('set.allCards')}</p>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmReset(true)}
              >
                <Icon name="rotate" />
                {t('set.resetProgress')}
              </button>
            </div>
            <div className="panel panel--flush">
              {(showAll ? set.cards : set.cards.slice(0, 12)).map((card) => (
                <div className="cardlist__item" key={card.id}>
                  <div className="cardlist__row">
                    <span className={`cardrow__dot cardrow__dot--${card.state[dir]}`} />
                    <span className="cardrow__a truncate">{dir === 'ab' ? card.a : card.b}</span>
                    <span className="cardrow__b truncate">{dir === 'ab' ? card.b : card.a}</span>
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
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setConfirmReset(false)}
              >
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
