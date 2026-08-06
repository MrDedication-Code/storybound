import { Component, type ErrorInfo, type ReactNode } from 'react'
import { BookOpen, RotateCcw } from 'lucide-react'
import { Button } from './ui'

interface Props {
  children: ReactNode
}
interface State {
  failed: boolean
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Storybound renderer error', error, info)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <main className="fatal-state">
        <BookOpen aria-hidden="true" size={34} />
        <p className="eyebrow">Storybound</p>
        <h1>The page lost its place</h1>
        <p>Your library remains safely stored. Reload the interface to return to it.</p>
        <Button icon={RotateCcw} variant="primary" onClick={() => window.location.reload()}>
          Reload Storybound
        </Button>
      </main>
    )
  }
}
