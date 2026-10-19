import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { Author } from '../lib/types'
import { Icon } from './Icon'

/** The authors of a set or course: any of the editors, in the order given. */
export function AuthorPicker({ value, onChange }: { value: Author[]; onChange: (next: Author[]) => void }) {
  const { t } = useI18n()
  const [editors, setEditors] = useState<Author[]>([])

  useEffect(() => {
    api
      .editors()
      .then(setEditors)
      .catch(() => setEditors([]))
  }, [])

  const available = editors.filter((editor) => !value.some((author) => author.id === editor.id))

  return (
    <div className="field">
      <span className="field__label">{t('authors.title')}</span>
      <div className="togglerow">
        {value.map((author) => (
          <span key={author.id} className="chip chip--accent">
            {author.username}
            {value.length > 1 && (
              <button
                type="button"
                className="chip__x"
                aria-label={t('authors.remove', { name: author.username })}
                onClick={() => onChange(value.filter((other) => other.id !== author.id))}
              >
                <Icon name="x" width={11} height={11} />
              </button>
            )}
          </span>
        ))}
        {available.length > 0 && (
          <select
            className="select select--chip"
            value=""
            aria-label={t('authors.add')}
            onChange={(event) => {
              const picked = editors.find((editor) => editor.id === Number(event.target.value))
              if (picked) onChange([...value, picked])
            }}
          >
            <option value="">+ {t('authors.add')}</option>
            {available.map((editor) => (
              <option key={editor.id} value={editor.id}>
                {editor.username}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="field__hint">{t('authors.hint')}</p>
    </div>
  )
}
