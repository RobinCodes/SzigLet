import { useState } from 'react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { errorText } from '../lib/errors'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

/**
 * Reports a card or question to its authors. The reader can also ask not to
 * see it again until somebody has looked: drilling a word you believe is
 * wrong teaches the wrong thing.
 */
export function FlagButton({
  item,
  onHidden,
  className = 'icon-btn',
}: {
  /** "c:12" or "q:7"; nothing to report when null. */
  item: string | null
  /** Called when the reader chose to hide the item. */
  onHidden?: (item: string) => void
  className?: string
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [hide, setHide] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!item) {
    return null
  }

  const send = async () => {
    setBusy(true)
    try {
      await api.flag(item, reason.trim(), hide)
      toast.success(t('flags.sent'))
      if (hide) {
        onHidden?.(item)
      }
      setOpen(false)
      setReason('')
      setHide(false)
    } catch (caught) {
      toast.error(errorText(t, caught, 'flags.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={t('flags.report')}
        title={t('flags.report')}
        onClick={() => setOpen(true)}
      >
        <Icon name="flag" />
      </button>
      {open && (
        <Sheet
          title={t('flags.title')}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="btn btn--primary btn--block" onClick={send} disabled={busy}>
                {busy ? <span className="spinner" /> : <Icon name="flag" />}
                {t('flags.send')}
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <div className="stack" style={{ '--gap': '0.875rem' } as React.CSSProperties}>
            <p className="muted small">{t('flags.body')}</p>
            <textarea
              className="input"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('flags.placeholder')}
            />
            <label className="switch">
              <input type="checkbox" checked={hide} onChange={(event) => setHide(event.target.checked)} />
              <span className="switch__track" />
              <span className="small">{t('flags.hide')}</span>
            </label>
          </div>
        </Sheet>
      )}
    </>
  )
}
