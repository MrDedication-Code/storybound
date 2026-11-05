import { requireOptionalNativeModule, type EventSubscription } from 'expo'

/** A physical button in the car, such as on the steering wheel. */
export type CarButton = 'toggle' | 'next' | 'previous'

export type CarCommand =
  | { type: 'play' | 'pause' | 'next' | 'previous' | 'refresh' }
  | { type: 'playBook'; bookId: string }
  | { type: 'button'; button: CarButton }

interface StoryboundCarNative {
  statusBarHeight(): number
  takePendingCommands(): CarCommand[]
  setNowPlaying(
    playing: boolean,
    loading: boolean,
    title: string,
    artist: string,
    album: string,
    bookId: string | null,
    cover: string | null
  ): void
  setLibrary(ids: string[], titles: string[], subtitles: string[], inProgress: boolean[]): void
  addListener(event: 'onCommand', listener: (command: CarCommand) => void): EventSubscription
}

/** Storybound in Android Auto; null where it is not built in (tests, and iOS). */
export const StoryboundCar = requireOptionalNativeModule<StoryboundCarNative>('StoryboundCar')
