import { createAudioPlaylist, setAudioModeAsync, type AudioPlaylist } from 'expo-audio'
import type { ListeningBackend, NowPlaying } from './listeningSession'

/**
 * The listening queue on expo-audio's playlist, which Android plays from a media service: it
 * keeps going with the screen off and shows controls on the lock screen and in the shade.
 */
export function createExpoBackend(): ListeningBackend {
  let playlist: AudioPlaylist | null = null
  let audioModeSet = false
  let controlsShown = false
  const trackListeners: ((index: number) => void)[] = []
  const statusListeners: ((status: { playing: boolean; finished: boolean }) => void)[] = []

  const ensure = (): AudioPlaylist => {
    if (playlist) return playlist
    const created = createAudioPlaylist({ sources: [], updateInterval: 1000, loop: 'none' })
    created.addListener('trackChanged', ({ currentIndex }) => {
      for (const listener of trackListeners) listener(currentIndex)
    })
    let wasPlaying = false
    created.addListener('playlistStatusUpdate', (status) => {
      const finished = Boolean(status.didJustFinish)
      if (!finished && status.playing === wasPlaying) return
      wasPlaying = status.playing && !finished
      for (const listener of statusListeners) listener({ playing: wasPlaying, finished })
    })
    playlist = created
    return created
  }

  return {
    add(uri) {
      ensure().add({ uri })
    },
    clear() {
      playlist?.clear()
    },
    skipTo(index) {
      ensure().skipTo(index)
    },
    play() {
      const player = ensure()
      if (!audioModeSet) {
        audioModeSet = true
        // Keep reading with the screen off or the app in the background, and stop other apps'
        // sound while reading.
        void setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix'
        }).catch(() => {
          audioModeSet = false
        })
      }
      player.play()
    },
    pause() {
      playlist?.pause()
    },
    setRate(rate) {
      ensure().playbackRate = rate
    },
    get currentIndex() {
      return playlist?.currentIndex ?? 0
    },
    showControls(details: NowPlaying | null) {
      const player = ensure()
      if (!details) {
        if (controlsShown) player.clearLockScreenControls()
        controlsShown = false
        return
      }
      const metadata = { title: details.title, artist: details.artist, albumTitle: details.album }
      if (controlsShown) {
        player.updateLockScreenMetadata(metadata)
        return
      }
      controlsShown = true
      player.setActiveForLockScreen(true, metadata, {
        showNextTrack: true,
        showPreviousTrack: true,
        showSeekForward: false,
        showSeekBackward: false
      })
    },
    onTrackChanged(listener) {
      trackListeners.push(listener)
    },
    onStatus(listener) {
      statusListeners.push(listener)
    }
  }
}
