import type { CarButton } from '../../modules/storybound-car'
import type { ListeningSnapshot } from '../narration/listeningSession'

/** The phone's player acts on a press within this time of the car session hearing about it. */
const SAME_PRESS_MS = 600

/**
 * Tells whether a press of a car button has already been acted on. The same press can reach the
 * phone's own player as well as the car; the player's change then shows up here first.
 */
export class CarButtonGuard {
  private running: boolean | null = null
  private passage: string | null = null
  private runningChangedAt = -Infinity
  private passageChangedAt = -Infinity

  constructor(private readonly now: () => number = Date.now) {}

  observe(snapshot: ListeningSnapshot): void {
    const running = snapshot.status === 'playing' || snapshot.status === 'loading'
    if (this.running !== null && running !== this.running) this.runningChangedAt = this.now()
    this.running = running
    // A chapter's title and its first paragraph start at the same place, so both ends count.
    const passage = snapshot.passage ? `${snapshot.passage.start}-${snapshot.passage.end}` : null
    if (passage !== null && this.passage !== null && passage !== this.passage) {
      this.passageChangedAt = this.now()
    }
    if (passage !== null) this.passage = passage
  }

  alreadyActedOn(button: CarButton): boolean {
    const changedAt = button === 'toggle' ? this.runningChangedAt : this.passageChangedAt
    return this.now() - changedAt < SAME_PRESS_MS
  }
}
