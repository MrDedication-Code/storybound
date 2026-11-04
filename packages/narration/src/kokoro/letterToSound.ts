/**
 * Spelling-to-sound rules for words that are not in the pronunciation dictionary, which in
 * fiction are mostly invented names. Based on the public-domain letter-to-sound rules published
 * by the US Naval Research Laboratory (Elovitz et al., 1976), written out afresh here and giving
 * Kokoro's phoneme symbols directly.
 *
 * Each rule reads `left[match]right=sounds`. In the contexts:
 *   #  one or more vowels          :  zero or more consonants   ^  one consonant
 *   .  a voiced consonant          +  e, i or y                 %  a suffix (er, e, es, ed, ing, ely)
 *   @  t s r d l z n j (and th ch sh, written as the single letters)
 *   (space)  the start or end of the word
 * Sounds use ARPAbet names and are turned into Kokoro's symbols below.
 */
const RULES: Record<string, string[]> = {
  A: [
    ' [A] =AX',
    ' [ARE] =AA R',
    ' [AR]O=AX R',
    '[AR]#=EH R',
    ' ^[AS]#=EY S',
    '[A]WA=AX',
    '[AW]=AO',
    ' :[ANY]=EH N IY',
    '[A]^+#=EY',
    '#:[ALLY]=AX L IY',
    ' [AL]#=AX L',
    '[AGAIN]=AX G EH N',
    '#:[AG]E=IH JH',
    '[A]^+:#=AE',
    ' :[A]^+ =EY',
    '[A]^%=EY',
    ' [ARR]=AX R',
    '[ARR]=AE R',
    ' :[AR] =AA R',
    '[AR] =ER',
    '[AR]=AA R',
    '[AIR]=EH R',
    '[AI]=EY',
    '[AE]=EY',
    '[AY]=EY',
    '[AU]=AO',
    '#:[AL] =AX L',
    '#:[ALS] =AX L Z',
    '[ALK]=AO K',
    '[AL]^=AO L',
    ' :[ABLE]=EY B AX L',
    '[ABLE]=AX B AX L',
    '[ANG]+=EY N JH',
    '#:[A] =AX',
    '[A]=AE'
  ],
  B: [' [BE]^#=B IH', '[BEING]=B IY IH NG', '[BB]=B', '[B]=B'],
  C: [
    ' [CH]^=K',
    '^E[CH]=K',
    '[CH]=CH',
    ' S[CI]#=S AY',
    '[CI]A=SH',
    '[CI]O=SH',
    '[CI]EN=SH',
    '[C]+=S',
    '[CK]=K',
    '[CC]+=K S',
    '[CC]=K',
    '[COM]%=K AH M',
    '[C]=K'
  ],
  D: [
    '#:[DED] =D IH D',
    '.E[D] =D',
    '#^:E[D] =T',
    ' [DE]^#=D IH',
    '[DU]A=JH UW',
    '[DD]=D',
    '[D]=D'
  ],
  E: [
    '#:[E] =',
    "' :[E] =",
    ' :[E] =IY',
    '#[ED] =D',
    '#:[E]D =',
    '[EV]ER=EH V',
    '[E]^%=IY',
    '[ERI]#=IY R IY',
    '[ERI]=EH R IH',
    '#:[ER]#=ER',
    '[ER]#=EH R',
    '[ER]=ER',
    ' [EVEN]=IY V EH N',
    '#:[E]W=',
    '@[EW]=UW',
    '[EW]=Y UW',
    '[E]O=IY',
    '#:S[ES] =IH Z',
    '#:C[ES] =IH Z',
    '#:G[ES] =IH Z',
    '#:Z[ES] =IH Z',
    '#:X[ES] =IH Z',
    '#:J[ES] =IH Z',
    '#:[E]S =',
    '#:[ELY] =L IY',
    '#:[EMENT]=M EH N T',
    '[EFUL]=F UH L',
    '[EE]=IY',
    '[EARN]=ER N',
    ' [EAR]^=ER',
    '[EAD]=EH D',
    '#:[EA] =IY AX',
    '[EA]SU=EH',
    '[EA]=IY',
    '[EIGH]=EY',
    '[EI]=IY',
    ' [EYE]=AY',
    '[EY]=EY',
    '[EU]=Y UW',
    '[E]=EH'
  ],
  F: ['[FUL]=F UH L', '[FF]=F', '[F]=F'],
  G: [
    '[GIV]=G IH V',
    ' [G]I^=G',
    '[GE]T=G EH',
    'SU[GGES]=G JH EH S',
    '[GG]=G',
    ' B#[G]=G',
    '[G]+=JH',
    '#[GH]=',
    '[GH]=G',
    '[G]=G'
  ],
  H: [' [HOUR]=AW ER', '[H]#=HH', '[H]='],
  I: [
    ' [IN]=IH N',
    ' [I] =AY',
    '[IN]D=AY N',
    '[IER]=IY ER',
    '#:R[IED]=IY D',
    '[IED] =AY D',
    '[IEN]=IY EH N',
    '[IE]T=AY EH',
    ' :[I]%=AY',
    '[I]%=IY',
    '[IE]=IY',
    '[IA]=IY AX',
    '[I]^+:#=IH',
    '[IR]#=AY R',
    '[IZ]%=AY Z',
    '[IS]%=AY Z',
    '[I]D%=AY',
    '+^[I]^+=IH',
    '[I]T%=AY',
    '#^:[I]^+=IH',
    '[I]^+=AY',
    '[IR]=ER',
    '[IGH]=AY',
    '[ILD]=AY L D',
    '[IGN] =AY N',
    '[IGN]^=AY N',
    '[IGN]%=AY N',
    '[IQUE]=IY K',
    '[I] =IY',
    '[I]=IH'
  ],
  J: ['[J]=JH'],
  K: [' [K]N=', '[KH]=K', '[K]=K'],
  L: ['[LO]C#=L OW', 'L[L]=', '#^:[L]%=AX L', '[L]=L'],
  M: ['[MM]=M', '[M]=M'],
  N: [
    'E[NG]+=N JH',
    '[NG]R=NG G',
    '[NG]#=NG G',
    '[NGL]%=NG G AX L',
    '[NG]=NG',
    '[NK]=NG K',
    '[NN]=N',
    '[N]=N'
  ],
  O: [
    '[OF] =AX V',
    '[OROUGH]=ER OW',
    '#:[OR] =ER',
    '#:[ORS] =ER Z',
    '[OR]=AO R',
    ' [ONE]=W AH N',
    '[OW]EN=OW W',
    '[OW]=OW',
    ' [OVER]=OW V ER',
    '[O]^%=OW',
    '[OV]=AH V',
    '[O]^EN=OW',
    '[O]^I#=OW',
    '[OL]D=OW L',
    '[OUGHT]=AO T',
    '[OUGH]=AH F',
    ' [OU]=AW',
    'H[OU]S#=AW',
    '[OUS]=AX S',
    '[OUR]=AO R',
    '[OULD]=UH D',
    '^[OU]^L=AH',
    '[OUP]=UW P',
    '[OU]=AW',
    '[OY]=OY',
    '[OING]=OW IH NG',
    '[OI]=OY',
    '[OOR]=AO R',
    '[OOK]=UH K',
    '[OOD]=UH D',
    '[OO]=UW',
    '[O]E=OW',
    '[O] =OW',
    '[OA]=OW',
    'C[O]N=AA',
    '[O]NG=AO',
    ' :^[O]N=AH',
    'I[ON]=AX N',
    '#:[ON] =AX N',
    '#^[ON]=AX N',
    '[O]ST =OW',
    '[OF]^=AO F',
    '[OTHER]=AH DH ER',
    '[OSS] =AO S',
    '#^:[OM]=AH M',
    '[O]=AA'
  ],
  P: ['[PH]=F', '[PP]=P', '[P]=P'],
  Q: ['[QUAR]=K W AO R', '[QU]=K W', '[Q]=K'],
  R: [' [RE]^#=R IY', '[RR]=R', '[RH]=R', '[R]=R'],
  S: [
    '[SH]=SH',
    '#[SION]=ZH AX N',
    '#[SUR]#=ZH ER',
    '[SUR]#=SH ER',
    '#[SU]#=ZH UW',
    '#[SSU]#=SH UW',
    '#[SED] =Z D',
    '#[S]#=Z',
    '^[SION]=SH AX N',
    '[S]S=',
    '.[S] =Z',
    '#:.E[S] =Z',
    '#^:##[S] =Z',
    '#^:#[S] =S',
    'U[S] =S',
    ' :#[S] =Z',
    ' [SCH]=S K',
    '[S]C+=',
    '#[SM]=Z M',
    '[S]=S'
  ],
  T: [
    '[TH]=TH',
    '#:[TED] =T IH D',
    'S[TI]#N=CH',
    '[TI]O=SH',
    '[TI]A=SH',
    '[TIEN]=SH AX N',
    '[TUR]#=CH ER',
    '[TU]A=CH UW',
    '[TCH]=CH',
    '[TT]=T',
    '[T]=T'
  ],
  U: [
    ' [UN]I=Y UW N',
    ' [UN]=AH N',
    '@[UR]#=UH R',
    '[UR]#=Y UH R',
    '[UR]=ER',
    '[U]^ =AH',
    '[U]^^=AH',
    '[UY]=AY',
    ' G[U]#=',
    'G[U]%=',
    'G[U]#=W',
    '#N[U]=Y UW',
    '@[U]=UW',
    '[U]=Y UW'
  ],
  V: ['[V]=V'],
  W: ['[WA]S=W AA', '[WA]T=W AA', '[WH]=W', '[WAR]=W AO R', '[WOR]^=W ER', ' [WR]=R', '[W]=W'],
  X: [' [X]=Z', '[X]=K S'],
  Y: [
    ' [Y]#=Y',
    '#^:[Y] =IY',
    '#^:[Y]I=IY',
    ' :[Y] =AY',
    ' :[Y]#=AY',
    ' :[Y]^+:#=IH',
    ' :[Y]^#=AY',
    '[Y]#=Y',
    '[Y]=IH'
  ],
  Z: ['[ZZ]=Z', '[Z]=Z']
}

const CONTEXT: Record<string, string> = {
  '#': '[AEIOUY]+',
  ':': '[^AEIOUY ]*',
  '^': '[^AEIOUY ]',
  '.': '[BDVGJLMNRWZ]',
  '+': '[EIY]',
  '%': '(?:ER|E|ES|ED|ING|ELY)',
  '@': '[TSRDLZNJ]',
  ' ': ' ',
  "'": "'"
}

function contextPattern(context: string): string {
  return [...context].map((symbol) => CONTEXT[symbol] ?? symbol).join('')
}

interface Rule {
  match: string
  left: RegExp | null
  right: RegExp | null
  sounds: string[]
}

const compiled = new Map<string, Rule[]>()
for (const [letter, rules] of Object.entries(RULES)) {
  compiled.set(
    letter,
    rules.map((rule) => {
      const parsed = /^(.*)\[(.+)\](.*)=(.*)$/u.exec(rule)
      if (!parsed) throw new Error(`Bad letter-to-sound rule: ${rule}`)
      const [, left, match, right, sounds] = parsed
      return {
        match,
        left: left ? new RegExp(`${contextPattern(left)}$`, 'u') : null,
        right: right ? new RegExp(`^${contextPattern(right)}`, 'u') : null,
        sounds: sounds.trim() ? sounds.trim().split(/\s+/u) : []
      }
    })
  )
}

/** ARPAbet to Kokoro's symbols (the misaki American set: A=eɪ, I=aɪ, O=oʊ, W=aʊ, Y=ɔɪ). */
const KOKORO: Record<string, string> = {
  AA: 'ɑ',
  AE: 'æ',
  AH: 'ʌ',
  AO: 'ɔ',
  AW: 'W',
  AX: 'ə',
  AY: 'I',
  EH: 'ɛ',
  ER: 'ɜɹ',
  EY: 'A',
  IH: 'ɪ',
  IY: 'i',
  OW: 'O',
  OY: 'Y',
  UH: 'ʊ',
  UW: 'u',
  B: 'b',
  CH: 'ʧ',
  D: 'd',
  DH: 'ð',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  JH: 'ʤ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  P: 'p',
  R: 'ɹ',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ'
}
const VOWEL_SOUNDS = new Set([
  'AA',
  'AE',
  'AH',
  'AO',
  'AW',
  'AX',
  'AY',
  'EH',
  'ER',
  'EY',
  'IH',
  'IY',
  'OW',
  'OY',
  'UH',
  'UW'
])

function soundsFor(word: string): string[] {
  const text = ` ${word} `
  const sounds: string[] = []
  let index = 1
  while (index < text.length - 1) {
    const letter = text[index]
    const rules = compiled.get(letter)
    if (!rules) {
      index += 1
      continue
    }
    let matched = false
    for (const rule of rules) {
      if (!text.startsWith(rule.match, index)) continue
      if (rule.left && !rule.left.test(text.slice(0, index))) continue
      if (rule.right && !rule.right.test(text.slice(index + rule.match.length))) continue
      sounds.push(...rule.sounds)
      index += rule.match.length
      matched = true
      break
    }
    if (!matched) index += 1
  }
  return sounds
}

/** Which vowel carries the stress: names of three or more syllables ending in a vowel sound
 *  (Aurelia, Kaelina) lean on the one before last, the rest on the first full vowel. */
function stressedVowel(sounds: string[], word: string): number {
  const vowels = sounds.flatMap((sound, index) => (VOWEL_SOUNDS.has(sound) ? [index] : []))
  if (!vowels.length) return -1
  const full = vowels.filter((index) => sounds[index] !== 'AX')
  if (vowels.length >= 3 && /[AIO]$|IA$|ELLE$|ETTE$|INE$/u.test(word)) {
    return vowels[vowels.length - 2]
  }
  return full[0] ?? vowels[0]
}

const VOWEL_SYMBOLS = 'aeiouæɑɒɔəɛɜɪʊʌAIOWYQ'

/**
 * American sounds as British English, the way Kokoro's British dictionary writes them: "oh" is
 * Q, long vowels are marked, and an r with no vowel after it is not sounded.
 */
export function britishSounds(phonemes: string): string {
  const symbols = [...phonemes]
  let result = ''
  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index]
    const next = symbols[index + 1]
    if (next === 'ɹ' && !VOWEL_SYMBOLS.includes(symbols[index + 2] ?? '')) {
      const joined: Record<string, string> = {
        ɑ: 'ɑː',
        ɔ: 'ɔː',
        ɜ: 'ɜː',
        ə: 'ə',
        ɛ: 'ɛə',
        ɪ: 'ɪə',
        ʊ: 'ʊə'
      }
      if (joined[symbol]) {
        result += joined[symbol]
        index += 1
        continue
      }
    }
    if (symbol === 'O') result += 'Q'
    else if (symbol === 'ɑ') result += 'ɒ'
    else if ((symbol === 'i' || symbol === 'u') && index < symbols.length - 1)
      result += `${symbol}ː`
    else result += symbol
  }
  return result
}

/** A word's sounds in Kokoro's symbols, with the stress mark before the stressed vowel. */
export function guessPronunciation(word: string, british = false): string {
  const american = guessAmerican(word)
  return british ? britishSounds(american) : american
}

function guessAmerican(word: string): string {
  const letters = word.toUpperCase().replace(/[^A-Z']/gu, '')
  if (!letters.replace(/'/gu, '')) return ''
  const sounds = soundsFor(letters)
  const stressed = stressedVowel(sounds, letters.replace(/'/gu, ''))
  let result = ''
  sounds.forEach((sound, index) => {
    if (index === stressed) {
      result += 'ˈ'
      // A stressed schwa is the full "uh" sound.
      result += sound === 'AX' ? 'ʌ' : KOKORO[sound]
      return
    }
    result += sound === 'ER' ? 'əɹ' : (KOKORO[sound] ?? '')
  })
  return result
}
