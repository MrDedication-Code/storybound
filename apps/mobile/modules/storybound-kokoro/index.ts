import { requireOptionalNativeModule, type EventSubscription } from 'expo'

interface StoryboundKokoroNative {
  download(url: string, path: string, sha256: string): Promise<void>
  sha256(path: string): Promise<string | null>
  synthesize(
    modelPath: string,
    voicePath: string,
    pieces: number[][],
    outputPath: string
  ): Promise<number>
  unload(): void
  addListener(
    event: 'onDownloadProgress',
    listener: (event: { path: string; received: number }) => void
  ): EventSubscription
}

/** The phone's free-voice engine; null where it is not built in (tests, and iOS for now). */
export const StoryboundKokoro =
  requireOptionalNativeModule<StoryboundKokoroNative>('StoryboundKokoro')
