import type { Answer, Gender, Person, QuestionKind, Side, Variant } from './types'
import { PERSONS } from './types'
import { GAP } from './questions'
import { normalize } from './text'

/**
 * Sets as plain text, to copy out of one set and paste into another.
 *
 * Word sets are tab-separated with a header line naming the columns, so a
 * spreadsheet opens them as they are:
 *
 *   #Italian    Hungarian   Italian — plural   #note
 *   la cucina   konyha      le cucine          the room, not the cooking
 *
 * A list without a header is read the way the paste box always read one:
 * two sides per line, split on a tab, a comma, a semicolon or a dash.
 *
 * Question sets are one line per thing, a symbol in front saying what:
 *
 *   ! Choose the right article      (instruction, optional)
 *   ? ___ casa è grande             (the question; ___ is the gap)
 *   + La                            (a right answer)
 *   - Il                            (a wrong one)
 *   > casa is feminine              (a note, optional)
 */

export type WordRecord = {
  fields: Record<string, string>
  note?: string
  gender?: Partial<Record<Side, Gender>>
  conj?: Partial<Record<Person, string>>
  only?: Side
  pref?: Record<string, number[]>
}

const clean = (value: string) => value.replace(/[\t\r\n]+/g, ' ').trim()

export function exportWords(variants: readonly Variant[], records: readonly WordRecord[]): string {
  const used = variants.filter((variant) => records.some((record) => record.fields[variant.key]?.trim()))
  const persons = PERSONS.filter((person) => records.some((record) => record.conj?.[person]))
  const any = (test: (record: WordRecord) => unknown) => records.some((record) => Boolean(test(record)))

  const columns: { head: string; cell: (record: WordRecord) => string }[] = [
    ...used.map((variant) => ({
      head: variant.name,
      cell: (record: WordRecord) => record.fields[variant.key] ?? '',
    })),
    ...persons.map((person) => ({
      head: `#${person}`,
      cell: (record: WordRecord) => record.conj?.[person] ?? '',
    })),
  ]
  if (any((record) => record.note)) {
    columns.push({ head: '#note', cell: (record) => record.note ?? '' })
  }
  if (any((record) => record.gender && Object.keys(record.gender).length)) {
    columns.push({
      head: '#gender',
      cell: (record) =>
        Object.entries(record.gender ?? {})
          .map(([side, gender]) => `${side}:${gender}`)
          .join(' '),
    })
  }
  if (any((record) => record.only)) {
    columns.push({ head: '#only', cell: (record) => record.only ?? '' })
  }
  if (any((record) => record.pref && Object.keys(record.pref).length)) {
    columns.push({
      head: '#pref',
      cell: (record) =>
        Object.entries(record.pref ?? {})
          .map(([key, indices]) => `${key}:${indices.join(',')}`)
          .join(' '),
    })
  }

  const lines = [`#${columns.map((column) => clean(column.head)).join('\t')}`]
  for (const record of records) {
    lines.push(columns.map((column) => clean(column.cell(record))).join('\t'))
  }
  return lines.join('\n')
}

export type ParsedWords = { records: WordRecord[]; added: Variant[] }

/**
 * @param variants the set's variations; header names are matched against
 *   them, and any name not found becomes a new one.
 */
export function parseWords(text: string, variants: readonly Variant[]): ParsedWords {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  const first = lines[0]
  if (!first || !first.trimStart().startsWith('#')) {
    return { records: parsePairs(lines), added: [] }
  }

  const heads = first.trimStart().slice(1).split('\t').map((head) => head.trim())
  const added: Variant[] = []
  const known = [...variants]
  const nextKey = () => {
    let n = 1
    while (known.some((variant) => variant.key === `v${n}`)) n++
    return `v${n}`
  }
  const second = variants.find((variant) => variant.key === 'b')?.name ?? ''

  type Column = { kind: 'field'; key: string } | { kind: 'meta'; name: string } | { kind: 'skip' }
  const columns: Column[] = heads.map((head) => {
    if (head.startsWith('#')) {
      const name = head.slice(1).toLowerCase()
      return ['note', 'gender', 'only', 'pref', ...PERSONS].includes(name)
        ? { kind: 'meta', name }
        : { kind: 'skip' }
    }
    if (!head) {
      return { kind: 'skip' }
    }
    const match = known.find((variant) => normalize(variant.name) === normalize(head))
    if (match) {
      return { kind: 'field', key: match.key }
    }
    const fresh: Variant = {
      key: nextKey(),
      name: head.slice(0, 40),
      side: second && normalize(head).startsWith(normalize(second)) ? 'b' : 'a',
    }
    known.push(fresh)
    added.push(fresh)
    return { kind: 'field', key: fresh.key }
  })

  const records: WordRecord[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    const record: WordRecord = { fields: {} }
    columns.forEach((column, index) => {
      const value = cells[index]?.trim() ?? ''
      if (!value || column.kind === 'skip') {
        return
      }
      if (column.kind === 'field') {
        record.fields[column.key] = value
        return
      }
      switch (column.name) {
        case 'note':
          record.note = value
          break
        case 'only':
          if (value === 'a' || value === 'b') record.only = value
          break
        case 'gender':
          for (const pair of value.split(/\s+/)) {
            const [side, gender] = pair.split(':')
            if ((side === 'a' || side === 'b') && (gender === 'm' || gender === 'f')) {
              record.gender = { ...record.gender, [side]: gender }
            }
          }
          break
        case 'pref':
          for (const pair of value.split(/\s+/)) {
            const [key, list] = pair.split(':')
            const indices = (list ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0)
            if (key && indices.length) {
              record.pref = { ...record.pref, [key]: indices }
            }
          }
          break
        default:
          record.conj = { ...record.conj, [column.name as Person]: value }
      }
    })
    const filled = Object.values(record.fields).filter(Boolean).length + Object.keys(record.conj ?? {}).length
    if (filled >= 2) {
      records.push(record)
    }
  }
  return { records, added }
}

/**
 * The old paste format: one pair per line, split on a tab, a semicolon, a
 * comma or a dash — whichever appears first, since people paste from
 * spreadsheets, notes apps and their own handwriting alike.
 */
function parsePairs(lines: string[]): WordRecord[] {
  const records: WordRecord[] = []
  for (const line of lines) {
    const match = line.trim().match(/^(.*?)(\t+|\s*;\s*|\s*,\s*|\s+[–—-]\s+)(.*)$/)
    if (!match || !match[1]?.trim() || !match[3]?.trim()) {
      continue
    }
    records.push({ fields: { a: match[1].trim(), b: match[3].trim() } })
  }
  return records
}

// ── Questions ────────────────────────────────────────────────────────────────

export type QuestionRecord = {
  kind: QuestionKind
  instruction: string
  body: string
  answers: Answer[]
  note: string
}

export function exportQuestions(questions: readonly QuestionRecord[]): string {
  return questions
    .map((question) => {
      const lines: string[] = []
      if (question.instruction.trim()) lines.push(`! ${clean(question.instruction)}`)
      for (const line of question.body.split('\n')) lines.push(`? ${line.trim()}`)
      for (const answer of question.answers) lines.push(`${answer.ok ? '+' : '-'} ${clean(answer.t)}`)
      if (question.note.trim()) lines.push(`> ${clean(question.note)}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

export function parseQuestions(text: string): QuestionRecord[] {
  const out: QuestionRecord[] = []
  let current: QuestionRecord | null = null
  let answered = false

  const finish = () => {
    if (current && current.body.trim() && current.answers.some((answer) => answer.ok)) {
      current.kind = current.body.includes(GAP) ? 'gap' : 'answer'
      out.push(current)
    }
    current = null
    answered = false
  }
  const open = (): QuestionRecord => {
    if (!current) {
      current = { kind: 'answer', instruction: '', body: '', answers: [], note: '' }
    }
    return current
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      finish()
      continue
    }
    const symbol = line[0]
    const rest = line.slice(1).trim()
    // A new instruction or question after answers starts the next question,
    // so blank lines between them are optional.
    if ((symbol === '!' || symbol === '?') && answered) {
      finish()
    }
    const question = open()
    switch (symbol) {
      case '!':
        question.instruction = rest
        break
      case '?':
        question.body = question.body ? `${question.body}\n${rest}` : rest
        break
      case '+':
      case '-':
        if (rest) {
          question.answers.push({ t: rest, ok: symbol === '+' })
          answered = true
        }
        break
      case '>':
        question.note = rest
        break
      default:
        question.body = question.body ? `${question.body}\n${line}` : line
    }
  }
  finish()
  return out
}
