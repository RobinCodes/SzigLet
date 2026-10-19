import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useI18n } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { fold } from '../lib/text'
import type { Author, Course, CourseNode, SetSummary } from '../lib/types'
import { Shell, TopBar } from '../components/Shell'
import { Spinner } from '../components/Bits'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { AuthorPicker } from '../components/AuthorPicker'

export function CourseEditor() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const { t, tx } = useI18n()

  const [existing, setExisting] = useState<Course | null>(null)
  const [loading, setLoading] = useState(Boolean(slug))
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [published, setPublished] = useState(true)
  const [authors, setAuthors] = useState<Author[]>(user ? [{ id: user.id, username: user.username }] : [])
  const [setIds, setSetIds] = useState<number[]>([])
  const [nodes, setNodes] = useState<CourseNode[]>([])
  const [library, setLibrary] = useState<SetSummary[]>([])
  const [filter, setFilter] = useState('')
  const [newNode, setNewNode] = useState('')
  const [removing, setRemoving] = useState<CourseNode | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    api
      .sets()
      .then(setLibrary)
      .catch(() => undefined)
    if (!slug) return
    api
      .course(slug)
      .then((result) => {
        setExisting(result)
        setTitle(result.title)
        setDescription(result.description ?? '')
        setPublished(result.published)
        setAuthors(result.authors)
        setSetIds(result.sets.map((set) => set.id))
        setNodes(result.nodes)
      })
      .catch((caught: unknown) => {
        toast.error(errorText(t, caught, 'course.loadFailed'))
        navigate('/', { replace: true })
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const save = async (andThen?: (course: Course) => void) => {
    if (!title.trim()) {
      toast.error(t('editor.needTitle'))
      return
    }
    setSaving(true)
    try {
      const body = {
        title: title.trim(),
        description: description.trim(),
        published,
        authors: authors.map((author) => author.id),
        sets: setIds,
        nodeOrder: nodes.map((node) => node.id),
      }
      const result = existing ? await api.updateCourse(existing.id, body) : await api.createCourse(body)
      setExisting(result)
      setNodes(result.nodes)
      if (andThen) {
        andThen(result)
      } else {
        toast.success(existing ? t('course.saved') : t('course.created'))
        navigate(`/c/${result.slug}`, { replace: true })
      }
    } catch (caught) {
      toast.error(errorText(t, caught, 'editor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  /** A node needs a course to live in, so a new course is saved first. */
  const addNode = async () => {
    const name = newNode.trim()
    if (!name) return
    const create = async (course: Course) => {
      try {
        const { id } = await api.createNode(course.id, name)
        setNewNode('')
        navigate(`/n/${id}/edit`)
      } catch (caught) {
        toast.error(errorText(t, caught, 'editor.saveFailed'))
      }
    }
    await save(create)
  }

  const removeNode = async (node: CourseNode) => {
    try {
      await api.deleteNode(node.id)
      setNodes((current) => current.filter((other) => other.id !== node.id))
      setRemoving(null)
      toast.success(t('course.nodeRemoved'))
    } catch (caught) {
      toast.error(errorText(t, caught, 'editor.deleteFailed'))
    }
  }

  const moveNode = (index: number, offset: number) =>
    setNodes((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = current.slice()
      const a = next[index]!
      next[index] = next[target]!
      next[target] = a
      return next
    })

  const destroy = async () => {
    if (!existing) return
    try {
      await api.deleteCourse(existing.id)
      toast.success(t('course.deleted'))
      navigate('/', { replace: true })
    } catch (caught) {
      toast.error(errorText(t, caught, 'editor.deleteFailed'))
    }
  }

  if (loading) {
    return (
      <Shell>
        <TopBar back="/" />
        <Spinner />
      </Shell>
    )
  }

  const needle = fold(filter)
  const shown = library.filter((set) => !needle || fold(set.title).includes(needle) || setIds.includes(set.id))

  return (
    <Shell>
      <TopBar
        back={existing ? `/c/${existing.slug}` : '/'}
        title={existing ? t('course.editTitle') : t('course.newTitle')}
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void save()} disabled={saving}>
            {saving ? <span className="spinner" /> : <Icon name="check" />}
            {t('common.save')}
          </button>
        }
      />

      <div className="stack" style={{ '--gap': '1.5rem' } as React.CSSProperties}>
        <section className="stack" style={{ '--gap': '0.875rem' } as React.CSSProperties}>
          <div className="field">
            <label className="field__label" htmlFor="ctitle">
              {t('editor.title')}
            </label>
            <input
              id="ctitle"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('course.titlePlaceholder')}
              maxLength={120}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="cdesc">
              {t('editor.description')} <span className="faint">{t('editor.optional')}</span>
            </label>
            <input
              id="cdesc"
              className="input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
          </div>
          <AuthorPicker value={authors} onChange={setAuthors} />
          <label className="switch">
            <input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} />
            <span className="switch__track" />
            <span className="small">{published ? t('editor.visible') : t('editor.draftOnly')}</span>
          </label>
        </section>

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <p className="eyebrow">{t('course.path', { n: nodes.length })}</p>
          {nodes.length > 0 && (
            <div className="panel panel--flush">
              {nodes.map((node, index) => (
                <div className="cardrow" key={node.id}>
                  <span className="tiny faint num" style={{ width: '1.4rem' }}>
                    {index + 1}
                  </span>
                  <Link to={`/n/${node.id}/edit`} className="grow truncate" style={{ fontWeight: 560 }}>
                    {node.title}
                  </Link>
                  <span className="tiny faint">
                    {t('course.steps', { n: node.content.subnodes.length })}
                  </span>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={t('editor.moveUp')}
                    disabled={index === 0}
                    onClick={() => moveNode(index, -1)}
                  >
                    <Icon name="chevronDown" style={{ transform: 'rotate(180deg)' }} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={t('editor.moveDown')}
                    disabled={index === nodes.length - 1}
                    onClick={() => moveNode(index, 1)}
                  >
                    <Icon name="chevronDown" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={t('course.removeNode')}
                    onClick={() => setRemoving(node)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form
            className="row"
            style={{ '--gap': '0.4rem' } as React.CSSProperties}
            onSubmit={(event) => {
              event.preventDefault()
              void addNode()
            }}
          >
            <input
              className="input grow"
              value={newNode}
              onChange={(event) => setNewNode(event.target.value)}
              placeholder={t('course.nodePlaceholder')}
              maxLength={120}
            />
            <button type="submit" className="btn" disabled={!newNode.trim() || saving}>
              <Icon name="plus" />
              {t('course.addNode')}
            </button>
          </form>
          <p className="field__hint">{t('course.pathHint')}</p>
        </section>

        <section className="stack" style={{ '--gap': '0.6rem' } as React.CSSProperties}>
          <p className="eyebrow">{t('course.setsTitle', { n: setIds.length })}</p>
          <p className="field__hint">{t('course.setsHint')}</p>
          {library.length > 6 && (
            <input
              className="input"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('library.search')}
            />
          )}
          <div className="panel panel--flush pickerlist">
            {shown.map((set) => (
              <label key={set.id} className="cardrow cardrow--link">
                <input
                  type="checkbox"
                  checked={setIds.includes(set.id)}
                  onChange={(event) =>
                    setSetIds((current) =>
                      event.target.checked ? [...current, set.id] : current.filter((id) => id !== set.id),
                    )
                  }
                />
                <Icon
                  name={set.kind === 'questions' ? 'help' : 'cards'}
                  style={{ color: 'var(--accent)', flex: 'none' }}
                  width={16}
                  height={16}
                />
                <span className="grow truncate">{set.title}</span>
                <span className="tiny faint">
                  {set.kind === 'questions'
                    ? t('set.questions', { n: set.questionCount ?? 0 })
                    : t('set.cards', { n: set.cardCount })}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="stack" style={{ '--gap': '0.5rem' } as React.CSSProperties}>
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? <span className="spinner" /> : <Icon name="check" />}
            {existing ? t('editor.saveChanges') : t('course.create')}
          </button>
          {existing && (
            <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" />
              {t('course.delete')}
            </button>
          )}
        </section>
      </div>

      {removing && (
        <Sheet
          title={t('course.removeNodeTitle', { title: removing.title })}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className="btn btn--danger btn--block" onClick={() => void removeNode(removing)}>
                <Icon name="trash" />
                {t('editor.deleteConfirm')}
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={() => setRemoving(null)}>
                {t('common.keep')}
              </button>
            </>
          }
        >
          <p className="muted small">{t('course.removeNodeBody')}</p>
        </Sheet>
      )}

      {confirmDelete && existing && (
        <Sheet
          title={t('course.deleteTitle')}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" className="btn btn--danger btn--block" onClick={destroy}>
                <Icon name="trash" />
                {t('editor.deleteConfirm')}
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirmDelete(false)}>
                {t('common.keep')}
              </button>
            </>
          }
        >
          <p className="muted small">{tx('course.deleteBody', { title: <strong>{existing.title}</strong> })}</p>
        </Sheet>
      )}
    </Shell>
  )
}
