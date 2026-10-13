import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A bottom sheet on phones, a centred dialog on wider screens.
 *
 * Two things stop the primary button from hiding, which it used to do in the
 * "paste a list" sheet on a phone:
 *
 *   - `footer` is pinned below a scrolling body, so however long the content
 *     gets the action stays on screen and the body scrolls instead.
 *   - the on-screen keyboard is measured with `visualViewport` and published
 *     as `--kb` and `--vvh`. iOS does not shrink the layout viewport when the
 *     keyboard opens, so a `position: fixed` sheet would otherwise sit behind
 *     it — which is exactly why the button only appeared in fullscreen.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
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

    // A text field is worth focusing; a destructive button is not — Enter
    // would fire it straight away.
    const field = panel.current?.querySelector<HTMLElement>('input, textarea, select')
    if (field) {
      field.focus()
    } else {
      panel.current?.focus()
    }

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

  // Keep the sheet above the on-screen keyboard.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) {
      return
    }
    const measure = () => {
      const node = panel.current
      if (!node) {
        return
      }
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      node.style.setProperty('--kb', `${Math.round(covered)}px`)
      node.style.setProperty('--vvh', `${Math.round(viewport.height)}px`)
    }
    measure()
    viewport.addEventListener('resize', measure)
    viewport.addEventListener('scroll', measure)
    return () => {
      viewport.removeEventListener('resize', measure)
      viewport.removeEventListener('scroll', measure)
    }
  }, [])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
      >
        <div className="sheet__grip" />
        <h2 className="sheet__title">{title}</h2>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__actions">{footer}</div>}
      </div>
    </>
  )
}
