import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, outbox } from './api'
import type { User } from './types'

type Credentials = { username: string; password: string; elapsedMs: number; website: string }
type Progress = (fraction: number) => void

type AuthValue = {
  user: User | null
  loading: boolean
  registrationOpen: boolean
  canEdit: boolean
  isOwner: boolean
  login: (credentials: Credentials, onProgress?: Progress) => Promise<void>
  register: (credentials: Credentials, onProgress?: Progress) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const me = await api.me()
      setUser(me.user)
      setRegistrationOpen(me.registrationOpen)
    } catch {
      // Offline or the server is down: keep whatever we already had so an
      // installed app does not bounce the reader to the sign-in screen.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Anything queued while offline goes out as soon as there is a connection.
  useEffect(() => {
    if (!user) {
      return
    }
    const flush = () => void outbox.flush().catch(() => undefined)
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [user])

  const login = useCallback(async (credentials: Credentials, onProgress?: Progress) => {
    const session = await api.login(credentials, onProgress)
    setUser(session.user)
  }, [])

  const register = useCallback(async (credentials: Credentials, onProgress?: Progress) => {
    const session = await api.register(credentials, onProgress)
    setUser(session.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      registrationOpen,
      canEdit: user !== null && (user.role === 'editor' || user.role === 'owner'),
      isOwner: user?.role === 'owner',
      login,
      register,
      logout,
      refresh,
    }),
    [user, loading, registrationOpen, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return value
}
