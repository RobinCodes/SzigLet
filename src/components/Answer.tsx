import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { haptics } from '../lib/haptics'
import { explain, gradeAny, type Grade, type Mark } from '../lib/text'
import { Icon } from './Icon'

/** How many near misses a word gets before it counts as wrong. */
const MAX_NUDGES = 2

/** What was typed, with the characters that are off marked. */
export function Marks({ marks }: { marks: Mark[] }) {
  return (
    <span className="marks" aria-hidden="true">
      {marks.map((mark, index) =>
        mark.kind === 'missing' ? (
          <span key={index} className="marks__missing">
            ‸
          </span>
        ) : (
          <span key={index} className={mark.kind === 'ok' ? undefined : `marks__${mark.kind}`}>
            {mark.ch === ' ' ? ' ' : mark.ch}
          </span>
        ),
      )}
    </span>
  )
}

/**
 * A typed answer, graded.
 *
 * A near miss ("almost") keeps what was typed in the field so it can be
 * fixed rather than retyped, and Enter checks the fixed version — the whole
 * point is that the hands never leave the keyboard. The second near miss
 * also marks where the mistake is. A third counts as wrong, and "show me the
 * answer" is there throughout for anyone who would rather move on.
 */
export function WrittenAnswer({
  accepted,
  reveal,
  placeholder,
  onSettled,
  compact = false,
}: {
  /** Every accepted answer; each may carry its own "a; b" alternatives. */
  accepted: string[]
  /** What to show after a miss. */
  reveal: string
  placeholder: string
  onSettled: (right: boolean, grade: Grade) => void
  /** A smaller field, for several answers on one screen. */
  compact?: boolean
}) {
  const { t, tx } = useI18n()
  const [typed, setTyped] = useState('')
  const [nudges, setNudges] = useState(0)
  const [checked, setChecked] = useState('')
  const [result, setResult] = useState<Grade | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const settled = result !== null && result !== 'close'

  const settle = (grade: Grade) => {
    const right = grade === 'correct' || grade === 'accent'
    right ? haptics.known() : haptics.wrong()
    setResult(grade)
    onSettled(right, grade)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (settled || !typed.trim()) {
      return
    }
    const grade = gradeAny(typed, accepted)
    if (grade === 'close' && nudges < MAX_NUDGES) {
      haptics.tap()
      setNudges(nudges + 1)
      setChecked(typed)
      setResult('close')
      // Keep the cursor where the fixing happens.
      input.current?.focus()
      return
    }
    settle(grade === 'close' ? 'wrong' : grade)
  }

  useEffect(() => {
    if (!compact) {
      input.current?.focus()
    }
  }, [compact])

  return (
    <form className={`answerbox${compact ? ' answerbox--compact' : ''}`} onSubmit={submit}>
      <input
        ref={input}
        className="input"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        disabled={settled}
        aria-invalid={result === 'close' || result === 'wrong'}
      />

      {!settled && (
        <button type="submit" className="btn btn--primary btn--block" disabled={!typed.trim()}>
          {result === 'close' ? t('test.checkAgain') : t('test.check')}
        </button>
      )}

      {result === 'close' && (
        <>
          <div className="verdict verdict--close">
            <Icon name="alert" />
            <span>
              {t('test.almost')}{' '}
              {nudges >= MAX_NUDGES ? t('test.lastNudge') : t('test.nudgeHint')}
            </span>
          </div>
          {nudges >= MAX_NUDGES && (
            <p className="marksline small">
              <span className="faint">{t('test.whereWrong')}</span> <Marks marks={explain(checked, accepted[0] ?? '', accepted.slice(1))} />
            </p>
          )}
          <button type="button" className="btn btn--ghost btn--block btn--sm" onClick={() => settle('wrong')}>
            {t('test.giveUp')}
          </button>
        </>
      )}

      {result === 'accent' && (
        <div className="verdict verdict--correct">
          <Icon name="check" />
          <span>
            {t('test.accentRight')} <span className="verdict__answer">{reveal}</span>
          </span>
        </div>
      )}

      {result === 'correct' && (
        <div className="verdict verdict--correct">
          <Icon name="check" />
          <span>{t('test.correct')}</span>
        </div>
      )}

      {result === 'wrong' && (
        <div className="verdict verdict--wrong">
          <Icon name="x" />
          <span>
            {tx('test.theAnswerIs', { answer: <span className="verdict__answer">{reveal}</span> })}
          </span>
        </div>
      )}
    </form>
  )
}

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F']

/**
 * Multiple choice. 1–6 or A–F pick an answer on a keyboard; once one is
 * picked, the right one lights up and the list is spent.
 */
export function Options({
  options,
  isRight,
  chosen,
  onChoose,
  keys = true,
}: {
  options: string[]
  isRight: (index: number) => boolean
  chosen: number | null
  onChoose: (index: number, right: boolean) => void
  /** Listen for the keyboard. Off when two lists share a screen. */
  keys?: boolean
}) {
  const revealed = chosen !== null

  useEffect(() => {
    if (!keys || revealed) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        return
      }
      const position = '123456'.indexOf(event.key)
      const letter = 'abcdef'.indexOf(event.key.toLowerCase())
      const pick = position >= 0 ? position : letter
      if (pick >= 0 && pick < options.length) {
        event.preventDefault()
        onChoose(pick, isRight(pick))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keys, revealed, options, isRight, onChoose])

  return (
    <div className="options">
      {options.map((option, index) => {
        const right = isRight(index)
        let className = 'option'
        if (revealed) {
          className += right ? ' option--correct' : index === chosen ? ' option--wrong' : ' option--muted'
        }
        return (
          <button
            key={`${option}-${index}`}
            type="button"
            className={className}
            disabled={revealed}
            onClick={() => onChoose(index, right)}
          >
            <span className="option__key">{OPTION_KEYS[index]}</span>
            <span className="grow">{option}</span>
            {revealed && right && <Icon name="check" />}
            {revealed && index === chosen && !right && <Icon name="x" />}
          </button>
        )
      })}
    </div>
  )
}
