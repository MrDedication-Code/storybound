import { ClipboardCopy } from 'lucide-react'
import { useState } from 'react'
import { WRITING_GUIDE } from '@shared/writingGuide'
import { readableError, storyboundApi, unwrap } from '../lib/api'
import { isMac, isWindows } from '../lib/platform'
import { Button, InlineNotice } from './ui'

const CLAUDE_DOWNLOAD = 'https://claude.com/download'
const GOOGLE_KEYS = 'https://aistudio.google.com/apikey'
const RELEASES = 'https://github.com/MrDedication-Code/storybound/releases'

const QUIT_CLAUDE = isMac
  ? 'Click Claude, then press ⌘ Q.'
  : isWindows
    ? 'Closing the window is not enough. Find the Claude icon by the clock in the corner of the screen, right-click it, and choose Quit.'
    : 'Close it completely, not just its window.'
const PASTE = isMac ? '⌘ V' : 'Ctrl V'

function ExternalLink({ href, children }: { href: string; children: string }): React.JSX.Element {
  return (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  )
}

export function WritingGuide(): React.JSX.Element {
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const copyPrompt = async (): Promise<void> => {
    setError('')
    try {
      setNotice(unwrap(await storyboundApi().agentBridge.copy('writing-guide')).message)
    } catch (caught) {
      setNotice('')
      setError(readableError(caught))
    }
  }

  return (
    <div className="help-topic">
      <p>
        Claude plans the book with you, writes it, and saves every chapter straight into Storybound.
        It starts by asking what you like, so the story is yours.
      </p>

      <h3>Set up Claude (once)</h3>
      <ol>
        <li>
          Install Claude Desktop from{' '}
          <ExternalLink href={CLAUDE_DOWNLOAD}>claude.com/download</ExternalLink> and sign in. A
          whole book is a lot of writing, so a paid Claude plan is the comfortable choice.
        </li>
        <li>
          In Storybound, open <strong>Settings</strong>, then <strong>AI assistants</strong>.
        </li>
        <li>
          Turn on <strong>Allow Claude to add to my library</strong>.
        </li>
        <li>
          Click <strong>Add to Claude Desktop</strong>.
        </li>
        <li>Quit Claude completely, then open it again. {QUIT_CLAUDE}</li>
      </ol>

      <h3>Start your book</h3>
      <ol>
        <li>
          Click this button:
          <div className="help-topic__action">
            <Button icon={ClipboardCopy} variant="primary" onClick={() => void copyPrompt()}>
              Copy the prompt
            </Button>
          </div>
          {notice ? <InlineNotice tone="success">{notice}</InlineNotice> : null}
          {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        </li>
        <li>
          In Claude, start a new chat, paste with <kbd>{PASTE}</kbd>, and send it.
        </li>
        <li>
          If Claude asks permission to use Storybound, choose <strong>Always allow</strong>.
        </li>
        <li>
          Answer its questions: genre, setting, what the story is really about, authors you would
          like it to feel like, and how dark or funny it should be. “Surprise me” is a fine answer.
        </li>
        <li>Claude shows you a plan. Nothing is written until you approve it.</li>
        <li>
          Each chapter appears in your library as Claude finishes it. Read it, then tell Claude to
          carry on.
        </li>
      </ol>

      <h3>As the book goes on</h3>
      <ul>
        <li>
          <strong>Give feedback:</strong> in the reader, select any words, then choose{' '}
          <strong>Highlight</strong> or <strong>Add note</strong>. Then tell Claude “I’ve read it,
          check my notes”. It fixes what you flagged and remembers it for later chapters.
        </li>
        <li>
          <strong>The bible:</strong> Claude keeps a record called BIBLE.md of the characters, the
          rules of your world, what you decided, and what is still unresolved, so it stays
          consistent. You can see it on the book’s page under{' '}
          <strong>Story bible &amp; timeline</strong>.
        </li>
        <li>
          <strong>Come back another day:</strong> start a new chat and say “Continue my book [your
          title] in Storybound”. Claude reads where you left off.
        </li>
        <li>
          <strong>Hear it performed:</strong> tell Claude you want performance notes, and it writes
          directions for the voice into each chapter. See the Listening tab.
        </li>
      </ul>

      <h3>If something goes wrong</h3>
      <ul>
        <li>
          <strong>Claude says it cannot see Storybound:</strong> repeat steps 2 to 5 of Set up
          Claude, then start a new chat. The quit in step 5 is the one most often missed.
        </li>
        <li>
          <strong>You moved or reinstalled Storybound:</strong> click{' '}
          <strong>Add to Claude Desktop</strong> again.
        </li>
        <li>
          <strong>Claude stops in the middle of a long chapter:</strong> say “carry on”. It picks up
          from where it stopped.
        </li>
      </ul>

      <details className="help-topic__details">
        <summary>Read the full prompt</summary>
        <pre>{WRITING_GUIDE}</pre>
      </details>
    </div>
  )
}

export function SyncGuide(): React.JSX.Element {
  return (
    <div className="help-topic">
      <p>
        Sync keeps your library the same on your computers and phone. Everything is encrypted on
        your device first, so nobody else can read your books, including whoever runs the server.
      </p>
      <p>
        Use your own account. Everyone has their own private library, so do not share a login with
        anyone else.
      </p>

      <h3>On your computer (first device)</h3>
      <ol>
        <li>
          Open <strong>Settings</strong>, then <strong>Sync &amp; devices</strong>.
        </li>
        <li>
          Type your email and choose a password of at least 10 characters. The buttons stay greyed
          out until the password is long enough.
        </li>
        <li>
          Click <strong>Create account</strong>. If Storybound asks you to check your email, click
          the link in the message, then come back and click <strong>Sign in</strong>.
        </li>
        <li>
          You now see <strong>Unlock this device</strong>. This is your first device, so leave the
          recovery code box empty and click <strong>Create new encrypted vault</strong>.
        </li>
        <li>
          <strong>Save your recovery code now.</strong> It appears in a green box at the bottom of
          the section. Write it down or put it in a password manager. It is shown once, and nobody
          can get it back for you. Without it, a lost device can mean lost books.
        </li>
        <li>
          When you see <strong>Encrypted sync is ready</strong>, you are done. Storybound syncs
          every few minutes while it is open, and <strong>Sync now</strong> does it straight away.
        </li>
      </ol>

      <h3>On your Android phone</h3>
      <ol>
        <li>
          On the phone, open{' '}
          <ExternalLink href={RELEASES}>the Storybound downloads page</ExternalLink>. Find the
          newest entry called Storybound for Android and download the file ending in{' '}
          <strong>.apk</strong>.
        </li>
        <li>
          Open the downloaded file. Android will warn you that it came from outside the Play Store.
          Choose <strong>Settings</strong>, allow installs from this source, go back, then tap{' '}
          <strong>Install</strong>.
        </li>
        <li>
          Open Storybound on the phone and tap the <strong>◎</strong> button at the top of the
          library.
        </li>
        <li>
          Type the same email and password as your computer and tap <strong>Sign in</strong>. Do not
          tap Create account.
        </li>
        <li>
          On your computer, open <strong>Settings</strong>, then <strong>Sync &amp; devices</strong>
          , and leave it open.
        </li>
        <li>
          On the phone, tap <strong>Link to my computer</strong>.
        </li>
        <li>
          Six words appear on both screens. Check they are the same, in the same order. If they are
          not, tap <strong>They don’t match</strong> and start again.
        </li>
        <li>
          Tap <strong>They match</strong> on the phone, and click{' '}
          <strong>The words match, approve</strong> on the computer. The phone finishes by itself
          and your books appear.
        </li>
      </ol>

      <h3>On another computer</h3>
      <ol>
        <li>
          Install Storybound, open <strong>Settings</strong>, then{' '}
          <strong>Sync &amp; devices</strong>, and click <strong>Sign in</strong> with the same
          email and password.
        </li>
        <li>
          Type your recovery code and click <strong>Unlock and sync</strong>.
        </li>
      </ol>

      <h3>Good to know</h3>
      <ul>
        <li>
          <strong>“This build is local-only”:</strong> this copy of Storybound has no sync. Install
          the newest version from the downloads page.
        </li>
        <li>
          <strong>The request never appears on the computer:</strong> make sure sync says it is
          ready there and that Settings is open on Sync &amp; devices. If the request expired, tap{' '}
          <strong>Link to my computer</strong> again.
        </li>
        <li>
          <strong>Conflicting chapter:</strong> if something changed on two devices at once,
          Storybound asks which version to keep. Neither is changed until you choose.
        </li>
        <li>
          <strong>Not carried across:</strong> your Google key and the free voice download stay on
          each device, so set up Listening on each one.
        </li>
        <li>
          <strong>Sync is not a backup:</strong> keep scheduled backups turned on too, in{' '}
          <strong>Settings</strong>, <strong>Data &amp; recovery</strong>.
        </li>
      </ul>
    </div>
  )
}

export function SendingGuide(): React.JSX.Element {
  return (
    <div className="help-topic">
      <p>
        Send a book to someone else’s Storybound, wrapped in brown paper. It goes privately: it is
        sealed on your computer so that only they can open it. You both need sync turned on, and
        sending and unwrapping happen on a computer.
      </p>

      <h3>Find your address</h3>
      <ol>
        <li>
          Open <strong>Settings</strong>, then <strong>Sync &amp; devices</strong>.
        </li>
        <li>
          Under <strong>Your Storybound address</strong>, click <strong>Copy</strong>. It looks like{' '}
          <code>K7QM-2XPD-9RTA-HF4W</code>.
        </li>
        <li>
          Give it to the person who wants to send you a book. It is safe to share, and they send you
          theirs the same way.
        </li>
      </ol>

      <h3>Send a book</h3>
      <ol>
        <li>
          Open the book and click <strong>Send to someone</strong>.
        </li>
        <li>Type your name, their name, and their Storybound address.</li>
        <li>
          Choose <strong>Read only</strong> if they should only read it, or{' '}
          <strong>Editable</strong> to give them their own copy to change.
        </li>
        <li>
          Decide about the story bible. It is off for read-only books because it can spoil what
          happens next.
        </li>
        <li>
          Click <strong>Wrap and send</strong>.
        </li>
      </ol>
      <p>
        Your highlights, notes, bookmarks, reading position and revision history are never sent.
      </p>

      <h3>Receive a book</h3>
      <ol>
        <li>
          A parcel appears in the corner of Storybound. Click it, then click the parcel to unwrap
          it.
        </li>
        <li>Drag the book to turn it, and scroll to zoom in.</li>
        <li>
          Click <strong>Collect</strong> to add it to your library, or <strong>Decline</strong> to
          send it away. It reaches your phone through sync.
        </li>
      </ol>

      <h3>Send more chapters</h3>
      <ol>
        <li>
          Open the book. Under <strong>Who has this book</strong> you can see what they have not had
          yet.
        </li>
        <li>
          Click <strong>Send update</strong>. Nothing goes until you do, so unfinished chapters stay
          with you.
        </li>
      </ol>
      <p>
        They get a small parcel and click <strong>Add to my book</strong>. Their place, highlights
        and notes stay as they are.
      </p>

      <h3>Good to know</h3>
      <ul>
        <li>
          <strong>Read only:</strong> they can read, highlight, take notes and listen, but neither
          they nor Claude can change or export it. It is a lock, not perfect protection, because the
          words are on their device.
        </li>
        <li>
          <strong>Editable:</strong> their copy is their own. If they changed a chapter you later
          revise, they keep theirs and your version goes under Revisions.
        </li>
        <li>
          <strong>Unopened parcels:</strong> they wait for 30 days, then disappear. Just send again.
        </li>
        <li>
          <strong>Updates:</strong> send them from the computer that sent the book.
        </li>
        <li>
          <strong>Phones:</strong> they show shared books and keep them locked, but parcels are
          opened on a computer.
        </li>
      </ul>
    </div>
  )
}

export function BookstoreGuide(): React.JSX.Element {
  return (
    <div className="help-topic">
      <p>
        The Bookstore is a shared shelf of books from other readers. It needs a free account, but
        not sync, and you must be 18 or over.
      </p>

      <h3>Finding a book</h3>
      <ol>
        <li>
          Choose <strong>Bookstore</strong> in the sidebar and create an account or sign in.
        </li>
        <li>Browse by genre, or search by title or author.</li>
        <li>
          Open a book and choose <strong>Add to library</strong>.
        </li>
      </ol>
      <p>
        You can read, highlight, take notes and listen, but not change or export it. New versions
        arrive by themselves, and your place and notes stay as they are.
      </p>

      <h3>Publishing your book</h3>
      <ol>
        <li>
          Open your book and choose <strong>Publish to the Bookstore</strong>.
        </li>
        <li>Choose a pen name, write a blurb, and add a genre and content warnings.</li>
        <li>Say how AI was used, and confirm you have the right to publish it.</li>
        <li>
          Choose <strong>Send for review</strong>. The book’s page shows the result.
        </li>
      </ol>
      <p>
        To change a published book, edit it as usual and choose <strong>Send an update</strong>.
        Readers keep the old version until the new one is approved.
      </p>

      <h3>Good to know</h3>
      <ul>
        <li>
          <strong>A published book is public.</strong> Anyone with an account can read it, and it is
          stored in a way Storybound can read, unlike the books you sync. Its story bible is never
          included.
        </li>
        <li>
          <strong>The rules:</strong> only publish what you have the right to publish. No explicit
          sexual content, and nothing illegal or hateful.
        </li>
        <li>
          <strong>Withdrawing a book:</strong> new readers can’t add it, and people who already have
          it keep their copy.
        </li>
        <li>
          <strong>Books that break the rules:</strong> they are removed from the Bookstore, and
          readers’ copies move to Trash.
        </li>
        <li>
          <strong>Reporting a book:</strong> choose <strong>Report</strong> on its page. The author
          won’t see who sent it.
        </li>
        <li>
          <strong>The lock:</strong> it stops the app and Claude copying a book out, but the words
          are on your device, so it isn’t perfect protection.
        </li>
        <li>
          <strong>Your account:</strong> you can delete it in <strong>Settings</strong>. Your books
          stay on this device, and anything you published leaves the Bookstore.
        </li>
      </ul>
    </div>
  )
}

export function ListeningGuide(): React.JSX.Element {
  return (
    <div className="help-topic">
      <p>
        Storybound can read your books aloud. The page follows along and your place is saved as it
        goes. To listen, open a chapter and click <strong>Listen</strong> in the reader’s toolbar.
        On the phone it keeps going with the screen off.
      </p>

      <h3>Choosing where it starts</h3>
      <p>
        Open the listening controls and they show the opening words of the paragraph it will start
        from, and that paragraph is shaded on the page. Scrolling moves it. After listening, it is
        the paragraph you got to.
      </p>
      <ul>
        <li>
          <strong>Read from a different paragraph:</strong> on a computer, move the pointer over the
          paragraph and click the ▶ beside it. On the phone, tap the paragraph. Reading starts
          straight away, even if it was already playing.
        </li>
        <li>
          <strong>Go back to the beginning:</strong> choose <strong>Start of chapter</strong>.
        </li>
        <li>
          <strong>See the place:</strong> click or tap the opening words in the controls, and the
          page scrolls to them.
        </li>
      </ul>

      <h3>The three voices</h3>
      <div className="help-topic__table">
        <table>
          <thead>
            <tr>
              <th scope="col">Voice</th>
              <th scope="col">Best for</th>
              <th scope="col">Cost</th>
              <th scope="col">Performance notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">System voice</th>
              <td>A quick listen. Computer only. Sounds the most robotic.</td>
              <td>Free</td>
              <td>Skipped</td>
            </tr>
            <tr>
              <th scope="row">Free voice (Kokoro)</th>
              <td>Everyday listening. Natural, private, and works offline after one download.</td>
              <td>Free</td>
              <td>Skipped</td>
            </tr>
            <tr>
              <th scope="row">Google voice</th>
              <td>Audiobook quality. The most natural and expressive, and needs the internet.</td>
              <td>About $4–9 a novel until the end of 2026, then about double</td>
              <td>Performed</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Choose the voice under <strong>Settings</strong>, <strong>Listening</strong>, at the top of
        the section. On the phone, tap the <strong>♪</strong> button at the top of the library.
      </p>

      <h3>Set up the free voice</h3>
      <ol>
        <li>
          Open <strong>Settings</strong>, then <strong>Listening</strong>.
        </li>
        <li>
          Under Free voice, click <strong>Download the free voice</strong> and wait for it to finish
          (about 345 MB on a computer, less on a phone, so use Wi-Fi).
        </li>
        <li>
          Click <strong>Preview</strong> next to a few voices, then <strong>Use</strong> on your
          favourite.
        </li>
        <li>
          At the top of the section, choose <strong>Free voice</strong>.
        </li>
      </ol>

      <h3>Set up the Google voice</h3>
      <p>
        This needs a key from your own Google account, and Google bills you directly. Storybound
        never sees your money.
      </p>
      <ol>
        <li>
          Open <ExternalLink href={GOOGLE_KEYS}>aistudio.google.com/apikey</ExternalLink> and sign
          in with a Google account.
        </li>
        <li>
          Accept the terms. Google creates a project and a key for you. If you do not see a key,
          click <strong>Create API key</strong>.
        </li>
        <li>
          Turn on billing: next to your project, under Billing Tier, click{' '}
          <strong>Set up billing</strong>. Choose your country and add a payment card. Google may
          ask you to prepay at least $5. Do not skip this: on the free tier Google may use what you
          send to improve its products, and it has tight limits.
        </li>
        <li>
          Optional but sensible: set a limit on the <strong>Spend</strong> page, under{' '}
          <strong>Monthly spend cap</strong>, <strong>Edit spend cap</strong>.
        </li>
        <li>
          Copy your key. Treat it like a password: never paste it into a Claude chat, an email, or
          anywhere except Storybound.
        </li>
        <li>
          In Storybound, open <strong>Settings</strong>, then <strong>Listening</strong>. Paste the
          key into <strong>Google API key</strong> and click <strong>Save key</strong>. You should
          see “Google accepted the key.”
        </li>
        <li>
          Tick <strong>Send chapter text to Google to make the audio</strong>. Only the passages you
          listen to are sent.
        </li>
        <li>
          At the top of the section, choose <strong>Google voice</strong>.
        </li>
        <li>
          Optional: use <strong>Find a voice</strong> to search, <strong>Preview</strong> and{' '}
          <strong>Use</strong> one, and describe how you want books read in{' '}
          <strong>Reading style</strong>.
        </li>
        <li>
          On your phone, tap <strong>♪</strong> and do the same with the same key. Keys are never
          synced.
        </li>
      </ol>
      <p>
        Audio you have already heard is kept on the device, so listening again costs nothing. If the
        Google voice suddenly stops, check your balance on the Google page first: prepaid keys stop
        working when the credit runs out.
      </p>

      <h3>The Google voice’s daily limit</h3>
      <p>
        Google limits how many passages it will make each day, however long they are. A new account
        gets about 100, which is around eight chapters or nearly three hours of listening. The limit
        is shared by your computer and phone, and comes back at midnight Pacific time, which is 8am
        in the UK.
      </p>
      <ul>
        <li>
          <strong>When it runs out:</strong> anything you have heard before still plays. If you have
          downloaded the free voice, it carries on from the same place until the limit resets, so
          download it even if you prefer the Google voice.
        </li>
        <li>
          <strong>See where you are:</strong> open{' '}
          <ExternalLink href="https://aistudio.google.com/rate-limit">
            aistudio.google.com/rate-limit
          </ExternalLink>{' '}
          and choose Gemini 3.8 Flash TTS.
        </li>
        <li>
          <strong>Use it wisely:</strong> each paragraph with a performance note is its own passage,
          and previewing voices counts too.
        </li>
      </ul>

      <h3>Performance notes</h3>
      <p>
        These are hidden directions for the voice, also called audible description. They are heard
        when a chapter is read aloud and never shown in the reader, exports or word counts. Only the
        Google voice performs them. The exception is a paragraph containing only a pause, which is a
        silence for every voice.
      </p>
      <ul>
        <li>
          <strong>How a paragraph is read:</strong> put a direction at the very start, such as{' '}
          <code>[[hushed, urgent]]</code>. Any words work.
        </li>
        <li>
          <strong>A sound or beat:</strong> put it where it happens, such as <code>[[sigh]]</code>,{' '}
          <code>[[chuckle]]</code>, <code>[[gasp]]</code> or <code>[[long pause]]</code>.
        </li>
        <li>
          <strong>Add them yourself:</strong> in the editor, put the cursor in place and click{' '}
          <strong>Expression</strong>.
        </li>
        <li>
          <strong>Or ask Claude:</strong> “Add performance notes to chapter 2.” Claude knows how to
          use them, and a light touch of about six a chapter works best.
        </li>
      </ul>
    </div>
  )
}
