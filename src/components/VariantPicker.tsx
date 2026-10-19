import { useI18n } from '../lib/i18n'
import type { Variant } from '../lib/types'
import { Icon } from './Icon'

/**
 * Which variation goes on the front of the card and which on the back.
 *
 * Two selects rather than a segmented control: a set with a plural and an
 * article-led form already has a dozen sensible pairs.
 */
export function VariantPicker({
  variants,
  front,
  back,
  onChange,
}: {
  variants: Variant[]
  front: string
  back: string
  onChange: (front: string, back: string) => void
}) {
  const { t } = useI18n()

  const choose = (side: 'front' | 'back', key: string) => {
    if (side === 'front') {
      // Picking the back's variation for the front swaps the two.
      onChange(key, key === back ? front : back)
    } else {
      onChange(key === front ? back : front, key)
    }
  }

  return (
    <div className="pairpick">
      <label className="field grow">
        <span className="field__label">{t('variants.front')}</span>
        <select className="select" value={front} onChange={(event) => choose('front', event.target.value)}>
          {variants.map((variant) => (
            <option key={variant.key} value={variant.key}>
              {variant.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="icon-btn pairpick__swap"
        aria-label={t('variants.swap')}
        onClick={() => onChange(back, front)}
      >
        <Icon name="swap" />
      </button>
      <label className="field grow">
        <span className="field__label">{t('variants.back')}</span>
        <select className="select" value={back} onChange={(event) => choose('back', event.target.value)}>
          {variants.map((variant) => (
            <option key={variant.key} value={variant.key}>
              {variant.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
