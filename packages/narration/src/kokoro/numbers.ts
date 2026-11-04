const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen'
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES: [number, string][] = [
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1_000, 'thousand']
]

function belowHundred(value: number): string {
  if (value < 20) return ONES[value]
  const tens = TENS[Math.floor(value / 10)]
  return value % 10 ? `${tens}-${ONES[value % 10]}` : tens
}

function belowThousand(value: number): string {
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  if (!hundreds) return belowHundred(rest)
  return rest ? `${ONES[hundreds]} hundred and ${belowHundred(rest)}` : `${ONES[hundreds]} hundred`
}

/** A whole number in words, the British way ("one hundred and five"). */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (value < 0) return `minus ${numberToWords(-value)}`
  value = Math.floor(value)
  if (value < 1000) return belowThousand(value)
  const parts: string[] = []
  let rest = value
  for (const [size, name] of SCALES) {
    if (rest >= size) {
      parts.push(`${belowThousand(Math.floor(rest / size))} ${name}`)
      rest %= size
    }
  }
  if (rest) parts.push(rest < 100 ? `and ${belowHundred(rest)}` : belowThousand(rest))
  return parts.join(' ')
}

/** 1984 as "nineteen eighty-four", 2005 as "two thousand and five". */
export function yearToWords(value: number): string {
  if (value >= 2000 && value < 2010) return numberToWords(value)
  const high = Math.floor(value / 100)
  const low = value % 100
  if (low === 0) return `${belowHundred(high)} hundred`
  return `${belowHundred(high)} ${low < 10 ? `oh ${ONES[low]}` : belowHundred(low)}`
}

const ORDINAL_WORDS: Record<string, string> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth'
}

export function ordinalToWords(value: number): string {
  const words = numberToWords(value)
  const match = /([a-z]+)$/u.exec(words)
  if (!match) return words
  const last = match[1]
  const ordinal =
    ORDINAL_WORDS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`)
  return words.slice(0, -last.length) + ordinal
}

/** Writes the numbers in a passage as words, so they can be pronounced. */
export function spellNumbers(text: string): string {
  return text
    .replace(/\b(\d{1,2}):(\d{2})\b/gu, (_match, hours: string, minutes: string) => {
      const minute = Number(minutes)
      const hour = numberToWords(Number(hours))
      if (minute === 0) return `${hour} o'clock`
      return `${hour} ${minute < 10 ? `oh ${ONES[minute]}` : belowHundred(minute)}`
    })
    .replace(/\b(\d+)(st|nd|rd|th)\b/giu, (_match, digits: string) =>
      ordinalToWords(Number(digits))
    )
    .replace(
      /(^|[^\d,.£$€])(1[1-9]\d\d|20[0-9]\d)(?!\d|,\d|\.\d)/gu,
      (_match, before, year) => `${before}${yearToWords(Number(year))}`
    )
    .replace(/[£$€](\d+(?:,\d{3})*)(?:\.(\d{2}))?/gu, (match, whole: string, pence?: string) => {
      const symbol = match[0]
      const amount = Number(whole.replace(/,/gu, ''))
      const unit = symbol === '£' ? 'pound' : symbol === '€' ? 'euro' : 'dollar'
      const small = symbol === '£' ? 'pence' : 'cents'
      const main = `${numberToWords(amount)} ${unit}${amount === 1 ? '' : 's'}`
      return pence && Number(pence) ? `${main} and ${numberToWords(Number(pence))} ${small}` : main
    })
    .replace(/\d+(?:,\d{3})*(?:\.\d+)?/gu, (digits) => {
      const [whole, fraction] = digits.replace(/,/gu, '').split('.')
      const words = numberToWords(Number(whole))
      return fraction
        ? `${words} point ${[...fraction].map((digit) => ONES[Number(digit)]).join(' ')}`
        : words
    })
    .replace(/(\d|\b)%/gu, '$1 percent')
}
