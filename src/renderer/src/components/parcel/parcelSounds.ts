/**
 * The parcel's sounds, made on the spot from filtered noise, so there are no recordings to
 * license. They only ever play straight after a click.
 */
let context: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext()
    void context.resume()
    return context
  } catch {
    return null
  }
}

function noise(output: AudioContext, seconds: number): AudioBufferSourceNode {
  const buffer = output.createBuffer(1, Math.ceil(output.sampleRate * seconds), output.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1
  const source = output.createBufferSource()
  source.buffer = buffer
  return source
}

/** One short burst of filtered noise. */
function burst(
  output: AudioContext,
  input: {
    at: number
    length: number
    type: BiquadFilterType
    frequency: number
    endFrequency?: number
    quality?: number
    volume: number
  }
): void {
  const start = output.currentTime + input.at
  const source = noise(output, input.length)
  const filter = output.createBiquadFilter()
  filter.type = input.type
  filter.Q.value = input.quality ?? 0.8
  filter.frequency.setValueAtTime(input.frequency, start)
  if (input.endFrequency) {
    filter.frequency.exponentialRampToValueAtTime(input.endFrequency, start + input.length)
  }
  const gain = output.createGain()
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(input.volume, start + input.length * 0.18)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + input.length)
  source.connect(filter).connect(gain).connect(output.destination)
  source.start(start)
}

/** Brown paper being folded or opened: a run of soft crackles. */
export function playPaper(seconds = 1.2): void {
  const output = audio()
  if (!output) return
  for (let at = 0; at < seconds; at += 0.05 + Math.random() * 0.13) {
    burst(output, {
      at,
      length: 0.05 + Math.random() * 0.09,
      type: 'bandpass',
      frequency: 2200 + Math.random() * 3800,
      quality: 1.1,
      volume: 0.04 + Math.random() * 0.07
    })
  }
}

/** The parcel leaving. */
export function playWhoosh(): void {
  const output = audio()
  if (!output) return
  burst(output, {
    at: 0,
    length: 0.75,
    type: 'bandpass',
    frequency: 420,
    endFrequency: 2600,
    quality: 0.9,
    volume: 0.22
  })
}

/** A few pages flicking, then the book settling on the shelf. */
export function playCollect(): void {
  const output = audio()
  if (!output) return
  ;[0, 0.075, 0.145, 0.205].forEach((at, index) => {
    burst(output, {
      at,
      length: 0.075,
      type: 'bandpass',
      frequency: 3300 - index * 320,
      quality: 0.9,
      volume: 0.13 - index * 0.015
    })
  })
  burst(output, { at: 0.3, length: 0.17, type: 'lowpass', frequency: 260, volume: 0.32 })
}
