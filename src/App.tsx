import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { Shell } from './components/Shell'
import { Spinner } from './components/Bits'
import { SignIn } from './routes/SignIn'
import { Library } from './routes/Library'
import { SetView } from './routes/SetView'
import { Flashcards } from './routes/Flashcards'
import { TestRun } from './routes/TestRun'
import { Editor } from './routes/Editor'
import { Admin } from './routes/Admin'
import { Install } from './routes/Install'
import { Account } from './routes/Account'
import { ProgressView } from './routes/ProgressView'
import { NotFound } from './routes/NotFound'

/** Sends signed-out readers to the sign-in screen, remembering where to return. */
function Private({ children, owner = false, editor = false }: {
  children: React.ReactNode
  owner?: boolean
  editor?: boolean
}) {
  const { user, loading, canEdit, isOwner } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <Shell tabs={false}>
        <Spinner />
      </Shell>
    )
  }
  if (!user) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />
  }
  if (owner && !isOwner) {
    return <Navigate to="/" replace />
  }
  if (editor && !canEdit) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/install" element={<Install />} />

      <Route path="/" element={<Private><Library /></Private>} />
      <Route path="/progress" element={<Private><ProgressView /></Private>} />
      <Route path="/account" element={<Private><Account /></Private>} />

      <Route path="/s/:slug" element={<Private><SetView /></Private>} />
      <Route path="/s/:slug/cards" element={<Private><Flashcards /></Private>} />
      <Route path="/s/:slug/test" element={<Private><TestRun /></Private>} />
      <Route path="/s/:slug/edit" element={<Private editor><Editor /></Private>} />
      <Route path="/new" element={<Private editor><Editor /></Private>} />

      <Route path="/admin" element={<Private owner><Admin /></Private>} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
