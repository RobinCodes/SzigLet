import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { errorText } from '../lib/errors'
import type { FlagReport } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Empty, Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'

/**
 * Cards and questions learners have reported, for the people who wrote them.
 * Closing a report — fixed or not a problem — brings the item back for
 * anyone who had hidden it.
 */
export function Reports() {
  const { t, relative } = useI18n()
  const toast = useToast()
  const [flags, setFlags] = useState<FlagReport[] | null>(null)

  useEffect(() => {
    api
      .flags()
      .then(setFlags)
      .catch((caught: unknown) => {
        toast.error(errorText(t, caught, 'flags.loadFailed'))
        setFlags([])
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const settle = async (item: string, status: 'resolved' | 'dismissed') => {
    try {
      await api.settleFlag(item, status)
      setFlags((current) => current?.filter((flag) => flag.item !== item) ?? null)
      toast.success(status === 'resolved' ? t('flags.resolvedToast') : t('flags.dismissedToast'))
    } catch (caught) {
      toast.error(errorText(t, caught, 'errors.generic'))
    }
  }

  return (
    <Shell>
      <TopBar back="/" title={t('flags.inbox')} />
      {flags === null ? (
        <Spinner />
      ) : flags.length === 0 ? (
        <Empty icon="check" title={t('flags.noneTitle')}>
          {t('flags.noneBody')}
        </Empty>
      ) : (
        <div className="stack" style={{ '--gap': '0.75rem' } as React.CSSProperties}>
          <p className="tiny faint">{t('flags.inboxHint')}</p>
          {flags.map((flag) => (
            <div key={flag.item} className="panel stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
              <div className="row" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
                <Icon
                  name={flag.kind === 'card' ? 'cards' : 'help'}
                  style={{ color: 'var(--accent)', flex: 'none' }}
                  width={18}
                  height={18}
                />
                <strong className="grow" style={{ overflowWrap: 'anywhere' }}>
                  {flag.text}
                </strong>
                <span className="chip chip--wrong">{t('flags.count', { n: flag.reports })}</span>
              </div>
              <p className="tiny faint">
                {flag.where} · {relative(flag.latest)}
              </p>
              {flag.reasons.length > 0 && (
                <ul className="reasons">
                  {flag.reasons.slice(0, 5).map((reason, index) => (
                    <li key={index} className="small">
                      “{reason}”
                    </li>
                  ))}
                </ul>
              )}
              <div className="row" style={{ '--gap': '0.4rem', flexWrap: 'wrap' } as React.CSSProperties}>
                <Link to={flag.link} className="btn btn--sm">
                  <Icon name="edit" />
                  {t('flags.open')}
                </Link>
                <button type="button" className="btn btn--sm" onClick={() => void settle(flag.item, 'resolved')}>
                  <Icon name="check" />
                  {t('flags.resolve')}
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => void settle(flag.item, 'dismissed')}
                >
                  {t('flags.dismiss')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}
