import { Link } from 'react-router-dom'
import { Shell } from '../components/Shell'
import { Empty } from '../components/Bits'

export function NotFound() {
  return (
    <Shell>
      <Empty icon="search" title="Nothing here">
        That page does not exist.
      </Empty>
      <Link to="/" className="btn btn--primary btn--block">
        Back to the library
      </Link>
    </Shell>
  )
}
