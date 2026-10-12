import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Icon } from '../components/Icon'

type Tone = 'neutral' | 'success' | 'error'
type Toast = { id: number; message: string; tone: Tone }

type ToastValue = {
  show: (message: string, tone?: Tone) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastValue | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, tone: Tone = 'neutral') => {
    const id = nextId++
    setToasts((current) => [...current.slice(-2), { id, message, tone }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, tone === 'error' ? 5200 : 3000)
  }, [])

  const value = useMemo<ToastValue>(
    () => ({
      show,
      success: (message: string) => show(message, 'success'),
      error: (message: string) => show(message, 'error'),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            {toast.tone !== 'neutral' && (
              <Icon name={toast.tone === 'success' ? 'check' : 'alert'} />
            )}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext)
  if (!value) {
    throw new Error('useToast must be used inside ToastProvider')
  }
  return value
}
