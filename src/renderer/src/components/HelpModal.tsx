import { BookOpen, Download, Keyboard, LibraryBig, PencilLine, ShieldCheck } from 'lucide-react'
import { Button, Modal } from './ui'

interface HelpModalProps {
  onClose: () => void
  onCreateBook: () => void
}

const SHORTCUTS = [
  ['New book', 'Ctrl/⌘ N'],
  ['New chapter', 'Ctrl/⌘ Shift N'],
  ['Save chapter', 'Ctrl/⌘ S'],
  ['Find in chapter', 'Ctrl/⌘ F'],
  ['Search library', 'Ctrl/⌘ K'],
  ['Settings', 'Ctrl/⌘ ,']
] as const

export function HelpModal({ onClose, onCreateBook }: HelpModalProps): React.JSX.Element {
  return (
    <Modal
      description="A quick map of the calmest path through Storybound."
      onClose={onClose}
      size="large"
      title="Getting started"
    >
      <div className="help-guide">
        <section className="help-guide__steps" aria-label="Getting started steps">
          <article>
            <span>
              <LibraryBig aria-hidden="true" size={21} />1
            </span>
            <div>
              <h3>Collect a story</h3>
              <p>
                Create a book or use Import text to turn a copied AI conversation into chapters.
              </p>
            </div>
          </article>
          <article>
            <span>
              <PencilLine aria-hidden="true" size={21} />2
            </span>
            <div>
              <h3>Continue writing</h3>
              <p>
                Paste into the expanded editor. Autosave, recovery drafts, and versions protect
                changes.
              </p>
            </div>
          </article>
          <article>
            <span>
              <BookOpen aria-hidden="true" size={21} />3
            </span>
            <div>
              <h3>Read comfortably</h3>
              <p>
                Continue from your last place, tune typography, bookmark, annotate, or read aloud
                locally.
              </p>
            </div>
          </article>
          <article>
            <span>
              <Download aria-hidden="true" size={21} />4
            </span>
            <div>
              <h3>Keep a second copy</h3>
              <p>
                Schedule local backups or export an encrypted vault before moving between computers.
              </p>
            </div>
          </article>
        </section>
        <section className="help-guide__shortcuts">
          <div className="help-guide__section-title">
            <Keyboard aria-hidden="true" size={19} />
            <h3>Keyboard shortcuts</h3>
          </div>
          <dl>
            {SHORTCUTS.map(([label, shortcut]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <kbd>{shortcut}</kbd>
                </dd>
              </div>
            ))}
          </dl>
          <div className="help-guide__privacy">
            <ShieldCheck aria-hidden="true" size={20} />
            <p>
              Stories stay local by default. Network access occurs only for an AI request you
              explicitly approve.
            </p>
          </div>
        </section>
      </div>
      <div className="modal__actions">
        <Button onClick={onClose}>Close</Button>
        <Button
          onClick={() => {
            onClose()
            onCreateBook()
          }}
          variant="primary"
        >
          Create a book
        </Button>
      </div>
    </Modal>
  )
}
