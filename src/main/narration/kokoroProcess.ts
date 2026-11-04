import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'

/** How long the free voice's process waits for another passage before closing to free memory. */
const IDLE_MS = 3 * 60 * 1000

type Pending = { resolve: (wav: Uint8Array) => void; reject: (error: Error) => void }

/**
 * Runs the free voice in a background process of its own, started when a passage is needed and
 * closed when it has been idle for a few minutes.
 */
export function createKokoroProcessRunner(
  folder: string,
  modelName: string
): (text: string, voiceId: string) => Promise<Uint8Array> {
  let child: UtilityProcess | null = null
  let nextId = 1
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<number, Pending>()

  const start = (): UtilityProcess => {
    if (child) return child
    const created = utilityProcess.fork(join(__dirname, 'kokoroWorker.js'), [], {
      serviceName: 'Storybound free voice'
    })
    created.on('message', (message: { id: number; wav?: Uint8Array; error?: string }) => {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.wav) request.resolve(new Uint8Array(message.wav))
      else request.reject(new Error(message.error ?? 'The free voice could not read this passage.'))
      scheduleIdle()
    })
    created.on('exit', () => {
      if (child === created) child = null
      for (const request of pending.values()) {
        request.reject(new Error('The free voice stopped unexpectedly. Press play to try again.'))
      }
      pending.clear()
    })
    child = created
    return created
  }

  const scheduleIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (pending.size === 0) {
        child?.kill()
        child = null
      }
    }, IDLE_MS)
  }

  return (text, voiceId) =>
    new Promise<Uint8Array>((resolve, reject) => {
      if (idleTimer) clearTimeout(idleTimer)
      const id = nextId++
      pending.set(id, { resolve, reject })
      start().postMessage({ id, folder, modelName, text, voiceId })
    })
}
