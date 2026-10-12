import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A bottom sheet on phones, a centred dialog on wider screens. Used for the
 * handful of confirmations and small forms in the app.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('input, button, select, textarea')?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
      >
        <div className="sheet__grip" />
        <h2 style={{ marginBottom: '0.75rem' }}>{title}</h2>
        {children}
      </div>
    </>
  )
}
