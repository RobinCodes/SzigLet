import { useEffect, useState } from 'react'
import { appUpdate } from '../lib/update'
import { useI18n } from '../lib/i18n'
import { Icon } from './Icon'

/**
 * Shown when a newer build is parked and waiting. It never steals focus and
 * never reloads mid-swipe: the reader decides when the app restarts.
 */
export function UpdateBanner() {
  const { t } = useI18n()
  const [ready, setReady] = useState(appUpdate.ready)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => appUpdate.subscribe(setReady), [])

  if (!ready || dismissed) {
    return null
  }

  return (
    <div className="updatebar" role="status">
      <Icon name="sparkle" style={{ color: 'var(--accent)', flex: 'none' }} />
      <span className="small grow">{t('update.available')}</span>
      <button type="button" className="btn btn--primary btn--sm" onClick={appUpdate.apply}>
        {t('update.reload')}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('common.cancel')}
        style={{ width: '2rem', height: '2rem' }}
        onClick={() => setDismissed(true)}
      >
        <Icon name="x" style={{ width: 16, height: 16 }} />
      </button>
    </div>
  )
}
