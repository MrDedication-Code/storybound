/** Wording that depends on the computer Storybound is running on. */
const platform = typeof navigator === 'undefined' ? '' : navigator.platform

export const isMac = platform.startsWith('Mac')
export const isWindows = platform.startsWith('Win')

/** "this Mac" or "this computer", for use in a sentence. */
export const thisComputer = isMac ? 'this Mac' : 'this computer'
