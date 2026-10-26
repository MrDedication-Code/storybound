import {
  Bot,
  ClipboardCopy,
  FolderInput,
  FolderOpen,
  KeyRound,
  Plug,
  RefreshCw
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AgentBridgeCopyKind, AgentBridgeStatus, OperationResult } from '@shared/types'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { onContentChanged } from '../lib/events'
import { Button, ConfirmDialog, InlineNotice } from './ui'

const STATUS_REFRESH_MILLISECONDS = 8_000

const INBOX_EXAMPLE = `---
book: The Lighthouse Keeper
chapter: Chapter 1: The Storm
---

The wind came in off the water just after dusk…`

interface AssistantSettingsProps {
  notify: (message: string) => void
}

export function AssistantSettings({ notify }: AssistantSettingsProps): React.JSX.Element {
  const [status, setStatus] = useState<AgentBridgeStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(unwrap(await storyboundApi().agentBridge.status()))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(refresh)
    const timer = window.setInterval(() => void refresh(), STATUS_REFRESH_MILLISECONDS)
    const unsubscribe = onContentChanged(() => void refresh())
    return () => {
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [refresh])

  const run = async (name: string, action: () => Promise<void>): Promise<void> => {
    setBusy(name)
    setError('')
    try {
      await action()
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy('')
    }
  }

  const applyStatus = (name: string, request: () => Promise<AgentBridgeStatus>): Promise<void> =>
    run(name, async () => setStatus(await request()))

  const runOperation = (name: string, request: () => Promise<OperationResult>): Promise<void> =>
    run(name, async () => {
      notify((await request()).message)
      await refresh()
    })

  const copy = (kind: AgentBridgeCopyKind): Promise<void> =>
    runOperation(`copy-${kind}`, async () => unwrap(await storyboundApi().agentBridge.copy(kind)))

  return (
    <section className="settings-section" id="assistants">
      <div className="settings-section__heading">
        <div className="settings-icon">
          <Bot size={20} />
        </div>
        <div>
          <h2>AI assistants</h2>
          <p>
            Let Claude save the story it is writing with you straight into your library, or let any
            other AI tool drop chapters into an inbox folder. Both are off until you turn them on.
          </p>
        </div>
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <div className="scheduled-backups assistant-block">
        <div className="scheduled-backups__heading">
          <div>
            <strong>Connect Claude</strong>
            <p>Claude Desktop and Claude Code can create books and add chapters as you write.</p>
          </div>
          <Plug aria-hidden="true" size={21} />
        </div>
        <label className="switch-row">
          <span>
            <strong>Allow Claude to add to my library</strong>
            <small>
              {status?.mcpError
                ? status.mcpError
                : status?.mcpRunning
                  ? 'On. Listening only on this computer.'
                  : 'Off. Claude cannot read or change your library.'}
            </small>
          </span>
          <input
            aria-label="Allow Claude to add to my library"
            checked={status?.mcpEnabled ?? false}
            disabled={!status || Boolean(busy)}
            type="checkbox"
            onChange={(event) => {
              const mcpEnabled = event.target.checked
              void applyStatus('mcp', async () =>
                unwrap(await storyboundApi().agentBridge.update({ mcpEnabled }))
              )
            }}
          />
        </label>
        {status?.mcpEnabled ? (
          <div className="assistant-actions">
            {status.claudeDesktopConfigPath ? (
              <Button
                disabled={Boolean(busy)}
                icon={Plug}
                variant="primary"
                onClick={() =>
                  void runOperation('desktop', async () =>
                    unwrap(await storyboundApi().agentBridge.connectClaudeDesktop())
                  )
                }
              >
                Add to Claude Desktop
              </Button>
            ) : null}
            <Button
              disabled={Boolean(busy)}
              icon={ClipboardCopy}
              onClick={() => void copy('claude-code-command')}
            >
              Copy Claude Code command
            </Button>
            <Button
              disabled={Boolean(busy)}
              icon={ClipboardCopy}
              variant="quiet"
              onClick={() => void copy('claude-desktop-config')}
            >
              Copy Claude Desktop config
            </Button>
          </div>
        ) : null}

        <details className="assistant-guide">
          <summary>How the Claude connection works</summary>
          <ol>
            <li>Turn on “Allow Claude to add to my library”.</li>
            <li>
              <strong>Claude Desktop:</strong> click “Add to Claude Desktop”, then quit and reopen
              Claude Desktop. <strong>Claude Code:</strong> click “Copy Claude Code command”, paste
              it into Terminal and press Return once.
            </li>
            <li>
              Start a new Claude chat and ask it to write with you. Claude checks your library,
              creates the book, and adds each chapter in order once you approve it.
            </li>
          </ol>
          <h4>Things to ask Claude</h4>
          <ul>
            <li>“Let’s write a mystery novel together. Save it to Storybound as we go.”</li>
            <li>“Add the chapter you just wrote to my Storybound book.”</li>
            <li>“Read chapter 4 of The Lighthouse Keeper and revise the ending.”</li>
          </ul>
          <h4>What Claude can do</h4>
          <ul>
            <li>
              See the titles and chapters of books in your active library, and read chapter text.
            </li>
            <li>Create a book, and set its blurb, status, series and author.</li>
            <li>Add chapters to the end of a book, in reading order.</li>
            <li>
              Revise a chapter when you ask. The previous version is kept under Revisions in the
              editor, so nothing is lost.
            </li>
          </ul>
          <h4>What Claude cannot do</h4>
          <ul>
            <li>Delete or trash anything.</li>
            <li>Work in libraries other than your active one.</li>
            <li>Change settings, backups, sync, or anything outside your books and chapters.</li>
          </ul>
          <h4>Privacy</h4>
          <p>
            The connection only exists on this computer and is protected by a private access token
            kept in your Storybound data folder, never in backups or exports. Storybound itself
            sends nothing anywhere. Anything Claude reads through this connection becomes part of
            your Claude conversation, just like text you paste in yourself.
          </p>
          <h4>Good to know</h4>
          <ul>
            <li>
              If Storybound is closed, Claude opens it in the background the first time it saves
              something.
            </li>
            <li>
              If you are editing a chapter when Claude changes it, your unsaved typing is never
              overwritten. Storybound tells you, and Claude’s version stays in Revisions.
            </li>
            <li>
              If you move the Storybound app to a different folder, click “Add to Claude Desktop”
              (or re-run the Claude Code command) again so Claude can find it.
            </li>
          </ul>
        </details>

        {status?.mcpEnabled ? (
          <details className="assistant-guide">
            <summary>Advanced: other MCP apps</summary>
            <p>
              Apps that support MCP over HTTP can connect directly to{' '}
              <code>{status.mcpUrl ?? 'the local endpoint (starting…)'}</code> with the header{' '}
              <code>Authorization: Bearer &lt;access token&gt;</code>. Regenerating the token
              disconnects those apps; the Claude Desktop and Claude Code setups above keep working
              because they read the current token automatically.
            </p>
            <div className="assistant-actions">
              <Button
                disabled={Boolean(busy)}
                icon={KeyRound}
                onClick={() => void copy('http-token')}
              >
                Copy access token
              </Button>
              <Button
                disabled={Boolean(busy)}
                icon={RefreshCw}
                variant="quiet"
                onClick={() => setConfirmRegenerate(true)}
              >
                Regenerate token
              </Button>
            </div>
          </details>
        ) : null}
      </div>

      <div className="scheduled-backups assistant-block">
        <div className="scheduled-backups__heading">
          <div>
            <strong>Inbox folder for other AI tools</strong>
            <p>
              For ChatGPT, Gemini, or any app that can save a file: drop chapter files in a folder
              and Storybound imports them.
            </p>
          </div>
          <FolderInput aria-hidden="true" size={21} />
        </div>
        <label className="switch-row">
          <span>
            <strong>Watch an inbox folder</strong>
            <small>
              {status?.inboxError
                ? status.inboxError
                : status?.inboxEnabled && status.inboxPath
                  ? `Watching ${status.inboxPath}`
                  : 'Off. Turning this on creates “Storybound Inbox” in your Documents folder.'}
            </small>
          </span>
          <input
            aria-label="Watch an inbox folder"
            checked={status?.inboxEnabled ?? false}
            disabled={!status || Boolean(busy)}
            type="checkbox"
            onChange={(event) => {
              const inboxEnabled = event.target.checked
              void applyStatus('inbox', async () =>
                unwrap(await storyboundApi().agentBridge.update({ inboxEnabled }))
              )
            }}
          />
        </label>
        {status?.inboxEnabled ? (
          <div className="assistant-actions">
            <Button
              disabled={Boolean(busy)}
              icon={ClipboardCopy}
              variant="primary"
              onClick={() => void copy('inbox-instructions')}
            >
              Copy instructions for your AI
            </Button>
            <Button
              disabled={Boolean(busy)}
              icon={FolderOpen}
              onClick={() =>
                void runOperation('open-inbox', async () =>
                  unwrap(await storyboundApi().agentBridge.openInbox())
                )
              }
            >
              Open folder
            </Button>
            <Button
              disabled={Boolean(busy)}
              icon={RefreshCw}
              onClick={() =>
                void run('scan', async () => {
                  const result = unwrap(await storyboundApi().agentBridge.scanInbox())
                  notify(
                    result.imported + result.failed === 0
                      ? 'No new files in the inbox.'
                      : `Imported ${result.imported} file${result.imported === 1 ? '' : 's'}${
                          result.failed ? `, ${result.failed} could not be imported` : ''
                        }.`
                  )
                  await refresh()
                })
              }
            >
              Import now
            </Button>
            <Button
              disabled={Boolean(busy)}
              variant="quiet"
              onClick={() =>
                void applyStatus('choose-inbox', async () =>
                  unwrap(await storyboundApi().agentBridge.chooseInbox())
                )
              }
            >
              Choose a different folder
            </Button>
          </div>
        ) : null}

        <details className="assistant-guide">
          <summary>How the inbox works</summary>
          <ol>
            <li>Turn on “Watch an inbox folder”.</li>
            <li>
              Click “Copy instructions for your AI” and paste them into your chat, so the AI knows
              how to format each chapter.
            </li>
            <li>
              Save each chapter the AI writes as a <code>.md</code> or <code>.txt</code> file in the
              inbox. While Storybound is open it checks every few seconds and adds new chapters to
              the end of the book.
            </li>
          </ol>
          <h4>File format</h4>
          <p>Each file starts with a short header naming the book and the chapter:</p>
          <pre>{INBOX_EXAMPLE}</pre>
          <ul>
            <li>
              The <code>book:</code> title must match exactly for every chapter of the same story. A
              new title creates a new book.
            </li>
            <li>
              No header? Put the files in a sub-folder named after the book instead. The chapter
              title then comes from a first-line <code># Heading</code>, or the file name.
            </li>
            <li>
              Name files so they sort in reading order, such as <code>01 Opening.md</code>,{' '}
              <code>02 The Road.md</code>.
            </li>
            <li>
              Optional header lines: <code>blurb:</code>, <code>status: completed</code>,{' '}
              <code>series:</code>, <code>series position: 2</code>, <code>author:</code>.
            </li>
            <li>
              To replace an existing chapter, add <code>mode: replace</code> and use its exact
              chapter title. The old version stays in Revisions.
            </li>
          </ul>
          <h4>What happens to the files</h4>
          <ul>
            <li>
              Imported files move to <code>Imported/</code>, in a folder for each day, so nothing is
              imported twice.
            </li>
            <li>
              Files that can’t be imported move to <code>Failed/</code>, with a note explaining why.
              Fix the file and drop it back into the inbox.
            </li>
            <li>Dropping in a chapter that is already in the book is skipped, not duplicated.</li>
            <li>Files are only read while Storybound is open. Nothing leaves your computer.</li>
          </ul>
        </details>
      </div>

      {status && status.recentActivity.length > 0 ? (
        <div className="assistant-activity">
          <strong>Recent assistant activity</strong>
          <ul>
            {status.recentActivity.map((entry) => (
              <li
                className={entry.failed ? 'assistant-activity__failed' : undefined}
                key={`${entry.at}-${entry.message}`}
              >
                <time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString()}</time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {confirmRegenerate ? (
        <ConfirmDialog
          busy={busy === 'regenerate'}
          confirmLabel="Regenerate token"
          dangerous
          description="Apps connected directly with the current access token will stop working until you give them the new one. Claude Desktop and Claude Code set up from this page are not affected."
          onClose={() => setConfirmRegenerate(false)}
          onConfirm={async () => {
            await applyStatus('regenerate', async () =>
              unwrap(await storyboundApi().agentBridge.regenerateToken())
            )
            setConfirmRegenerate(false)
            notify('Generated a new access token.')
          }}
          title="Regenerate the access token?"
        />
      ) : null}
    </section>
  )
}
