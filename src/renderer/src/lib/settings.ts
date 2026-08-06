import type { ApplicationSettings } from '@shared/types'

export const DEFAULT_SETTINGS: ApplicationSettings = {
  appTheme: 'system',
  reducedMotion: false,
  hasSeenGettingStarted: false,
  readerTheme: 'sepia',
  readerFont: 'literary',
  readerFontSize: 19,
  lineHeight: 1.75,
  columnWidth: 720,
  paragraphSpacing: 0.8,
  paragraphIndentation: false,
  textAlignment: 'left',
  defaultLibrarySort: 'recently-opened'
}
