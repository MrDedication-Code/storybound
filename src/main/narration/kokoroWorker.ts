import { KokoroInference } from './kokoroInference'

/**
 * The free voice's background process. Storybound sends it one passage at a time and gets back
 * WAV audio. Kept apart from the app so the model never freezes the window, and so a failure here
 * cannot close Storybound.
 */
interface SpeakRequest {
  id: number
  folder: string
  modelName: string
  text: string
  voiceId: string
}

let inference: KokoroInference | null = null
let loadedFrom = ''

process.parentPort.on('message', (event) => {
  const request = event.data as SpeakRequest
  void (async () => {
    try {
      const key = `${request.folder}\n${request.modelName}`
      if (!inference || loadedFrom !== key) {
        inference = new KokoroInference(request.folder, request.modelName)
        loadedFrom = key
      }
      const wav = await inference.speak(request.text, request.voiceId)
      process.parentPort.postMessage({ id: request.id, wav })
    } catch (error) {
      process.parentPort.postMessage({
        id: request.id,
        error:
          error instanceof Error ? error.message : 'The free voice could not read this passage.'
      })
    }
  })()
})
