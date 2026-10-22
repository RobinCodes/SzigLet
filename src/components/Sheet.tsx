import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A bottom sheet on phones, a centred dialog on wider screens.
 *
 * Two things stop the primary button from hiding, which it used to do in the
 * "paste a list" sheet on a phone:
 *
 *   - `footer` is pinned below a scrolling body, so however long the content
 *     gets the action stays on screen and the body scrolls instead.
 *   - on phones the sheet is placed from `visualViewport`: its bottom edge at
 *     the bottom of what is visible, its height capped at the visible height
 *     (`--vvh`). iOS does not shrink the layout viewport when the keyboard
 *     opens, so a `position: fixed` sheet would otherwise sit behind it.
 *
 * It is rendered straight into `<body>`. A sheet opened from inside the top
 * bar — the report button — used to be positioned against the bar instead of
 * the screen, because the bar's `backdrop-filter` makes it the containing
 * block for anything fixed inside it; the sheet then sat half above the top.
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

  // Keep the sheet inside what is actually visible.
  //
  // It is placed by its top edge, worked out from `visualViewport` alone:
  // where the visible area starts and how tall it is. An earlier version
  // measured the keyboard as `innerHeight` minus the visible height, but iOS
  // sometimes shrinks `innerHeight` along with the keyboard — then the
  // keyboard measured as nothing and the sheet sat underneath it, its text
  // box and buttons out of reach.
  useEffect(() => {
    const viewport = window.visualViewport
    const node = panel.current
    if (!viewport || !node) {
      return
    }
    // Wider screens show a centred dialog, which CSS positions on its own.
    const phone = window.matchMedia('(max-width: 42rem)')

    const measure = () => {
      node.style.setProperty('--vvh', `${Math.round(viewport.height)}px`)
      if (!phone.matches) {
        node.style.top = ''
        node.style.bottom = ''
        return
      }
      const top = viewport.offsetTop + viewport.height - node.offsetHeight
      node.style.top = `${Math.max(viewport.offsetTop, Math.round(top))}px`
      node.style.bottom = 'auto'
    }

    measure()
    // The sheet's own height changes as its content does.
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    viewport.addEventListener('resize', measure)
    viewport.addEventListener('scroll', measure)
    phone.addEventListener('change', measure)
    return () => {
      observer.disconnect()
      viewport.removeEventListener('resize', measure)
      viewport.removeEventListener('scroll', measure)
      phone.removeEventListener('change', measure)
    }
  }, [])

  return createPortal(
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
    </>,
    document.body,
  )
}
