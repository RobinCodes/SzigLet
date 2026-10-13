import { Link } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { Shell } from '../components/Shell'
import { Empty } from '../components/Bits'

export function NotFound() {
  const { t } = useI18n()

  return (
    <Shell>
      <Empty icon="search" title={t('notFound.title')}>
        {t('notFound.body')}
      </Empty>
      <Link to="/" className="btn btn--primary btn--block">
        {t('notFound.home')}
      </Link>
    </Shell>
  )
}
