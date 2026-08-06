import type { CoverStyle } from '@shared/types'

export function formatDate(value: string | null): string {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
  }).format(date)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

export function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toLocaleUpperCase())
    .join('')
}

export function coverPalette(
  seed: string,
  style: CoverStyle = 'classic'
): { from: string; to: string; ink: string } {
  let hash = 0
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const palettes = [
    ['#233a38', '#101d1c', '#e9d8ae'],
    ['#542f2b', '#231515', '#f0d8b1'],
    ['#34405a', '#171d2b', '#e8d9bb'],
    ['#56462c', '#211b12', '#f2dfb3'],
    ['#463251', '#1d1522', '#ead7b4'],
    ['#334538', '#151e18', '#eadbb7']
  ] as const
  const styledPalettes: Record<
    Exclude<CoverStyle, 'classic'>,
    readonly [string, string, string]
  > = {
    moonlit: ['#34405a', '#111725', '#e8e0c9'],
    forest: ['#29473b', '#101e18', '#e5d8af'],
    ember: ['#6a382b', '#25120f', '#f2d4aa'],
    ocean: ['#255167', '#102431', '#e7dfc5'],
    rose: ['#694257', '#291723', '#f0d8c5']
  }
  const [from, to, ink] =
    style === 'classic' ? palettes[hash % palettes.length] : styledPalettes[style]
  return { from, to, ink }
}

export function nextChapterTitle(chapterCount: number): string {
  return `Chapter ${chapterCount + 1}`
}
