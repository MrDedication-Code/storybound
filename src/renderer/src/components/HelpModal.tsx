import { BookOpen, Download, Keyboard, LibraryBig, PencilLine, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { ListeningGuide, SendingGuide, SyncGuide, WritingGuide } from './HelpGuideTopics'
import { Button, Modal } from './ui'

interface HelpModalProps {
  onClose: () => void
  onCreateBook: () => void
}

const TOPICS = [
  { id: 'start', label: 'Start here' },
  { id: 'writing', label: 'Write with Claude' },
  { id: 'sync', label: 'Sync' },
  { id: 'sending', label: 'Send a book' },
  { id: 'listening', label: 'Listening' }
] as const

type Topic = (typeof TOPICS)[number]['id']

const SHORTCUTS = [
  ['New book', 'Ctrl/⌘ N'],
  ['New chapter', 'Ctrl/⌘ Shift N'],
  ['Save chapter', 'Ctrl/⌘ S'],
  ['Find in chapter', 'Ctrl/⌘ F'],
  ['Search library', 'Ctrl/⌘ K'],
  ['Settings', 'Ctrl/⌘ ,']
] as const

export function HelpModal({ onClose, onCreateBook }: HelpModalProps): React.JSX.Element {
  const [topic, setTopic] = useState<Topic>('start')

  return (
    <Modal
      description="Everything you need, one step at a time."
      onClose={onClose}
      size="large"
      title="Getting started"
    >
      <div aria-label="Guide topics" className="help-guide__tabs" role="tablist">
        {TOPICS.map((item) => (
          <button
            aria-selected={topic === item.id}
            className={topic === item.id ? 'is-active' : undefined}
            key={item.id}
            role="tab"
            type="button"
            onClick={() => setTopic(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="help-guide__panel" role="tabpanel">
        {topic === 'start' ? <StartHere /> : null}
        {topic === 'writing' ? <WritingGuide /> : null}
        {topic === 'sync' ? <SyncGuide /> : null}
        {topic === 'sending' ? <SendingGuide /> : null}
        {topic === 'listening' ? <ListeningGuide /> : null}
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

function StartHere(): React.JSX.Element {
  return (
    <div className="help-guide">
      <section className="help-guide__steps" aria-label="Getting started steps">
        <article>
          <span>
            <LibraryBig aria-hidden="true" size={21} />1
          </span>
          <div>
            <h3>Collect a story</h3>
            <p>
              Write a whole book with Claude, create one yourself, or use Import text to turn a
              copied AI conversation into chapters. See Write with Claude above.
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
              Continue from your last place, tune typography, bookmark, annotate, or have the book
              read aloud. See Listening above.
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
              Schedule local backups, and use Sync to carry your library to your phone and other
              computers.
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
            Stories stay on this computer unless you turn on sync, which encrypts them first, or
            choose the Google voice or an AI assistant yourself.
          </p>
        </div>
      </section>
    </div>
  )
}
