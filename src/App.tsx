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
import { CourseView } from './routes/CourseView'
import { CourseEditor } from './routes/CourseEditor'
import { NodeView } from './routes/NodeView'
import { NodeEditor } from './routes/NodeEditor'
import { Lesson, Practice } from './routes/Lesson'
import { Reports } from './routes/Reports'
import { AuthorStats } from './routes/AuthorStats'

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
      <Route path="/s/:slug/practice" element={<Private><Practice /></Private>} />
      <Route path="/s/:slug/stats" element={<Private editor><AuthorStats kind="set" /></Private>} />

      <Route path="/c/:slug" element={<Private><CourseView /></Private>} />
      <Route path="/c/:slug/edit" element={<Private editor><CourseEditor /></Private>} />
      <Route path="/c/:slug/stats" element={<Private editor><AuthorStats kind="course" /></Private>} />
      <Route path="/new/course" element={<Private editor><CourseEditor /></Private>} />
      <Route path="/n/:id" element={<Private><NodeView /></Private>} />
      <Route path="/n/:id/edit" element={<Private editor><NodeEditor /></Private>} />
      <Route path="/n/:id/lesson" element={<Private><Lesson /></Private>} />
      <Route path="/reports" element={<Private editor><Reports /></Private>} />

      <Route path="/admin" element={<Private owner><Admin /></Private>} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
