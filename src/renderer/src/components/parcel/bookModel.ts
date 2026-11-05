import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  type Material
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { coverPalette } from '../../lib/format'
import type { CoverStyle } from '@shared/types'

export const BOOK_WIDTH = 3
export const BOOK_HEIGHT = 4.5
const BOARD = 0.075
const SERIF = 'Georgia, "Times New Roman", serif'

export interface BookDetails {
  seed: string
  title: string
  subtitle: string
  authorName: string
  blurb: string
  coverStyle: CoverStyle
  coverUrl: string | null
  coverPositionX: number
  coverPositionY: number
  wordCount: number
}

/** A longer book makes a thicker book. */
export function bookThickness(wordCount: number): number {
  return Math.min(1.25, Math.max(0.5, 0.5 + (wordCount / 120_000) * 0.75))
}

function canvasOf(
  width: number,
  height: number
): {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
} {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas drawing is not available.')
  return { canvas, context }
}

function textureOf(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function wrapLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\n+/)) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (context.measureText(next).width > width && line) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }
    if (line) lines.push(line)
    lines.push('')
  }
  lines.pop()
  return lines
}

/** The largest size at which the text fits the box, and its lines. */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  font: (size: number) => string,
  width: number,
  height: number,
  largest: number,
  smallest: number,
  leading: number
): { size: number; lines: string[] } {
  for (let size = largest; size > smallest; size -= 2) {
    context.font = font(size)
    const lines = wrapLines(context, text, width)
    if (lines.length * size * leading <= height) return { size, lines }
  }
  context.font = font(smallest)
  const lines = wrapLines(context, text, width)
  const fitting = Math.floor(height / (smallest * leading))
  if (lines.length <= fitting) return { size: smallest, lines }
  return {
    size: smallest,
    lines: [...lines.slice(0, Math.max(1, fitting - 1)), `${lines[fitting - 1] ?? ''}…`]
  }
}

/** A faint weave, so the boards read as bookcloth rather than plastic. */
function addCloth(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save()
  context.globalAlpha = 0.05
  for (let y = 0; y < height; y += 3) {
    context.fillStyle = y % 6 === 0 ? '#ffffff' : '#000000'
    context.fillRect(0, y, width, 1)
  }
  for (let x = 0; x < width; x += 3) {
    context.fillStyle = x % 6 === 0 ? '#000000' : '#ffffff'
    context.fillRect(x, 0, 1, height)
  }
  context.restore()
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

/** The cover's overall colour, so the boards and spine match it. */
function averageColor(image: HTMLImageElement): Color {
  const { canvas, context } = canvasOf(8, 8)
  context.drawImage(image, 0, 0, 8, 8)
  try {
    const { data } = context.getImageData(0, 0, 8, 8)
    let red = 0
    let green = 0
    let blue = 0
    for (let index = 0; index < data.length; index += 4) {
      red += data[index]
      green += data[index + 1]
      blue += data[index + 2]
    }
    const pixels = data.length / 4
    return new Color(
      `rgb(${Math.round(red / pixels)}, ${Math.round(green / pixels)}, ${Math.round(blue / pixels)})`
    )
  } catch {
    return new Color('#3a3128')
  } finally {
    canvas.width = 0
  }
}

function drawHinge(context: CanvasRenderingContext2D, width: number, height: number): void {
  const x = width * 0.055
  const gradient = context.createLinearGradient(x - 16, 0, x + 16, 0)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(0.5, 'rgba(0,0,0,0.3)')
  gradient.addColorStop(1, 'rgba(255,255,255,0.07)')
  context.fillStyle = gradient
  context.fillRect(x - 16, 0, 32, height)
}

function frontCover(
  details: BookDetails,
  image: HTMLImageElement | null,
  palette: ReturnType<typeof coverPalette>
): CanvasTexture {
  const width = 1024
  const height = 1536
  const { canvas, context } = canvasOf(width, height)
  if (image) {
    const scale = Math.max(width / image.width, height / image.height)
    const drawnWidth = image.width * scale
    const drawnHeight = image.height * scale
    context.drawImage(
      image,
      (width - drawnWidth) * (details.coverPositionX / 100),
      (height - drawnHeight) * (details.coverPositionY / 100),
      drawnWidth,
      drawnHeight
    )
  } else {
    const gradient = context.createLinearGradient(0, 0, width * 0.4, height)
    gradient.addColorStop(0, palette.from)
    gradient.addColorStop(1, palette.to)
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
    addCloth(context, width, height)
    context.strokeStyle = palette.ink
    context.globalAlpha = 0.75
    context.lineWidth = 5
    context.strokeRect(110, 60, width - 170, height - 120)
    context.lineWidth = 2
    context.strokeRect(126, 76, width - 202, height - 152)
    context.globalAlpha = 1
    context.fillStyle = palette.ink
    context.textAlign = 'center'
    const title = fitText(
      context,
      details.title,
      (size) => `600 ${size}px ${SERIF}`,
      width - 320,
      620,
      128,
      48,
      1.18
    )
    context.font = `600 ${title.size}px ${SERIF}`
    const lineHeight = title.size * 1.18
    const top = height * 0.4 - (title.lines.length * lineHeight) / 2 + title.size
    title.lines.forEach((line, index) => {
      context.fillText(line, width / 2 + 24, top + index * lineHeight)
    })
    if (details.subtitle) {
      context.font = `italic 38px ${SERIF}`
      const subtitle = wrapLines(context, details.subtitle, width - 340).slice(0, 2)
      subtitle.forEach((line, index) => {
        context.fillText(
          line,
          width / 2 + 24,
          top + title.lines.length * lineHeight + 30 + index * 48
        )
      })
    }
    if (details.authorName) {
      context.font = `500 46px ${SERIF}`
      context.fillText(details.authorName, width / 2 + 24, height - 190)
    }
  }
  drawHinge(context, width, height)
  return textureOf(canvas)
}

function backCover(details: BookDetails, cloth: Color, ink: string): CanvasTexture {
  const width = 1024
  const height = 1536
  const { canvas, context } = canvasOf(width, height)
  context.fillStyle = `#${cloth.getHexString()}`
  context.fillRect(0, 0, width, height)
  addCloth(context, width, height)
  context.fillStyle = ink
  context.textAlign = 'left'
  const margin = 120
  const text = details.blurb.trim() || details.title
  const blurb = fitText(
    context,
    text,
    (size) => `${size}px ${SERIF}`,
    width - margin * 2,
    height - 500,
    50,
    22,
    1.45
  )
  context.font = `${blurb.size}px ${SERIF}`
  blurb.lines.forEach((line, index) => {
    context.fillText(line, margin, 170 + index * blurb.size * 1.45)
  })
  context.globalAlpha = 0.5
  context.fillRect(margin, height - 240, width - margin * 2, 2)
  context.globalAlpha = 1
  context.font = `600 38px ${SERIF}`
  context.fillText(details.title.slice(0, 44), margin, height - 180)
  if (details.authorName) {
    context.font = `32px ${SERIF}`
    context.fillText(details.authorName.slice(0, 50), margin, height - 130)
  }
  // Mirrors the hinge on the far edge, because the back is seen from behind.
  context.translate(width, 0)
  context.scale(-1, 1)
  drawHinge(context, width, height)
  return textureOf(canvas)
}

function spineCover(
  details: BookDetails,
  cloth: Color,
  ink: string,
  thickness: number
): CanvasTexture {
  const width = Math.round(240 * thickness)
  const height = 1536
  const { canvas, context } = canvasOf(width, height)
  context.fillStyle = `#${cloth.getHexString()}`
  context.fillRect(0, 0, width, height)
  addCloth(context, width, height)
  context.fillStyle = ink
  context.globalAlpha = 0.7
  context.fillRect(0, 74, width, 4)
  context.fillRect(0, height - 78, width, 4)
  context.globalAlpha = 1
  context.translate(width / 2, height / 2)
  context.rotate(Math.PI / 2)
  context.textBaseline = 'middle'
  context.textAlign = 'center'
  const available = details.authorName ? height - 560 : height - 240
  let size = Math.min(70, width * 0.5)
  context.font = `600 ${size}px ${SERIF}`
  while (context.measureText(details.title).width > available && size > 22) {
    size -= 2
    context.font = `600 ${size}px ${SERIF}`
  }
  const offset = details.authorName ? -130 : 0
  context.fillText(details.title, offset, 0)
  if (details.authorName) {
    context.font = `${Math.min(36, width * 0.3)}px ${SERIF}`
    context.textAlign = 'right'
    context.fillText(details.authorName.slice(0, 26), height / 2 - 110, 0)
  }
  return textureOf(canvas)
}

function pageEdges(horizontal: boolean): CanvasTexture {
  const { canvas, context } = canvasOf(256, 256)
  context.fillStyle = '#efe6d2'
  context.fillRect(0, 0, 256, 256)
  for (let line = 0; line < 256; line += 2) {
    context.fillStyle = `rgba(120, 100, 70, ${0.08 + Math.random() * 0.16})`
    if (horizontal) context.fillRect(0, line, 256, 1)
    else context.fillRect(line, 0, 1, 256)
  }
  return textureOf(canvas)
}

function standard(color: Color | string, roughness = 0.72): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: 0 })
}

/** Builds a hardcover: boards, a rounded spine, and a block of pages. Front faces +z. */
export async function buildBook(details: BookDetails): Promise<Group> {
  const image = details.coverUrl ? await loadImage(details.coverUrl) : null
  const palette = coverPalette(details.seed, details.coverStyle)
  const cloth = image
    ? averageColor(image).multiplyScalar(0.46)
    : new Color(palette.to).lerp(new Color(palette.from), 0.45)
  const thickness = bookThickness(details.wordCount)
  const book = new Group()
  book.name = 'book'

  const edge = standard(cloth)
  const boardGeometry = new RoundedBoxGeometry(BOOK_WIDTH, BOOK_HEIGHT, BOARD, 3, 0.03)
  const front = new Mesh(boardGeometry, [
    edge,
    edge,
    edge,
    edge,
    new MeshStandardMaterial({
      map: frontCover(details, image, palette),
      roughness: 0.62
    }),
    edge
  ])
  front.position.z = thickness / 2 - BOARD / 2
  const back = new Mesh(boardGeometry, [
    edge,
    edge,
    edge,
    edge,
    edge,
    new MeshStandardMaterial({
      map: backCover(details, cloth, palette.ink),
      roughness: 0.68
    })
  ])
  back.position.z = -thickness / 2 + BOARD / 2

  const pagesDepth = thickness - BOARD * 2
  const side = new MeshStandardMaterial({ map: pageEdges(true), roughness: 0.9 })
  const topEdge = new MeshStandardMaterial({ map: pageEdges(false), roughness: 0.9 })
  const pages = new Mesh(new BoxGeometry(BOOK_WIDTH - 0.17, BOOK_HEIGHT - 0.16, pagesDepth), [
    side,
    side,
    topEdge,
    topEdge,
    standard('#efe6d2', 0.9),
    standard('#efe6d2', 0.9)
  ])
  pages.position.x = 0.03

  const spineRadius = thickness / 2
  const spine = new Mesh(
    new CylinderGeometry(spineRadius, spineRadius, BOOK_HEIGHT, 40, 1, true, Math.PI, Math.PI),
    new MeshStandardMaterial({
      map: spineCover(details, cloth, palette.ink, thickness),
      roughness: 0.68,
      side: DoubleSide
    })
  )
  spine.scale.x = 0.34
  spine.position.x = -BOOK_WIDTH / 2 + 0.02

  const lining = new Mesh(new BoxGeometry(0.1, BOOK_HEIGHT - 0.02, pagesDepth), edge)
  lining.position.x = -BOOK_WIDTH / 2 + 0.05

  for (const part of [front, back, pages, spine, lining]) {
    part.castShadow = true
    part.receiveShadow = true
    book.add(part)
  }
  return book
}

function kraftTexture(): CanvasTexture {
  const { canvas, context } = canvasOf(1024, 1024)
  context.fillStyle = '#b48a5a'
  context.fillRect(0, 0, 1024, 1024)
  for (let patch = 0; patch < 240; patch += 1) {
    const x = Math.random() * 1024
    const y = Math.random() * 1024
    const radius = 40 + Math.random() * 140
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    const tone = Math.random() > 0.5 ? '255,226,180' : '70,42,16'
    gradient.addColorStop(0, `rgba(${tone},0.05)`)
    gradient.addColorStop(1, `rgba(${tone},0)`)
    context.fillStyle = gradient
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }
  for (let fibre = 0; fibre < 5200; fibre += 1) {
    const x = Math.random() * 1024
    const y = Math.random() * 1024
    const angle = Math.random() * Math.PI
    const length = 4 + Math.random() * 20
    context.strokeStyle = Math.random() > 0.5 ? 'rgba(255,232,190,0.14)' : 'rgba(62,36,14,0.16)'
    context.lineWidth = 0.6 + Math.random() * 0.7
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
    context.stroke()
  }
  const texture = textureOf(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  return texture
}

export interface WrappingRig {
  group: Group
  string: Group
  /** 0 is a flat sheet behind the book; 1 is fully wrapped. */
  setWrapped(amount: number): void
  setOpacity(amount: number): void
}

const smooth = (value: number): number => {
  const clamped = Math.min(1, Math.max(0, value))
  return clamped * clamped * (3 - 2 * clamped)
}

/** Brown paper that folds up around a book of this thickness, tied with twine. */
export function buildWrapping(thickness: number): WrappingRig {
  const group = new Group()
  const paper = new MeshStandardMaterial({
    map: kraftTexture(),
    roughness: 0.88,
    side: DoubleSide,
    transparent: true
  })
  const width = BOOK_WIDTH + 0.14
  const height = BOOK_HEIGHT + 0.14
  const depth = thickness + 0.1
  const back = -depth / 2

  const panel = (panelWidth: number, panelHeight: number): Mesh => {
    const mesh = new Mesh(new PlaneGeometry(panelWidth, panelHeight), paper)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }
  const sheet = panel(width, height)
  sheet.position.z = back
  group.add(sheet)

  interface Flap {
    first: Group
    second: Group
    start: number
    end: number
    sign: number
    axis: 'x' | 'y'
  }
  const flaps: Flap[] = []
  const addFlap = (
    axis: 'x' | 'y',
    direction: 1 | -1,
    length: number,
    span: number,
    wall: number,
    start: number,
    end: number
  ): void => {
    const first = new Group()
    const second = new Group()
    const along = axis === 'x' ? 'x' : 'y'
    first.position[along] = (direction * (axis === 'x' ? width : height)) / 2
    first.position.z = back
    const wallPanel = axis === 'x' ? panel(wall, span) : panel(span, wall)
    wallPanel.position[along] = (direction * wall) / 2
    first.add(wallPanel)
    second.position[along] = direction * wall
    const flapPanel = axis === 'x' ? panel(length, span) : panel(span, length)
    flapPanel.position[along] = (direction * length) / 2
    second.add(flapPanel)
    first.add(second)
    group.add(first)
    const sign = axis === 'x' ? -direction : direction
    flaps.push({ first, second, start, end, sign, axis })
  }
  addFlap('x', -1, width / 2 + 0.2, height, depth + 0.004, 0, 0.5)
  addFlap('x', 1, width / 2 + 0.2, height, depth + 0.012, 0.15, 0.65)
  addFlap('y', 1, height / 2 + 0.2, width + 0.02, depth + 0.02, 0.42, 0.85)
  addFlap('y', -1, height / 2 + 0.2, width + 0.02, depth + 0.028, 0.55, 1)

  const string = new Group()
  const twine = new MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.95 })
  const front = depth / 2 + 0.05
  const addStrand = (
    x: number,
    y: number,
    z: number,
    sizeX: number,
    sizeY: number,
    sizeZ: number
  ): void => {
    const strand = new Mesh(new BoxGeometry(sizeX, sizeY, sizeZ), twine)
    strand.position.set(x, y, z)
    strand.castShadow = true
    string.add(strand)
  }
  const thin = 0.035
  addStrand(0, 0, front, width + 0.02, thin, thin)
  addStrand(0, 0, front, thin, height + 0.02, thin)
  addStrand(0, 0, -front, width + 0.02, thin, thin)
  addStrand(0, 0, -front, thin, height + 0.02, thin)
  addStrand(-width / 2 - 0.01, 0, 0, thin, thin, depth + 0.1)
  addStrand(width / 2 + 0.01, 0, 0, thin, thin, depth + 0.1)
  addStrand(0, height / 2 + 0.01, 0, thin, thin, depth + 0.1)
  addStrand(0, -height / 2 - 0.01, 0, thin, thin, depth + 0.1)
  const loop = new TorusGeometry(0.21, 0.022, 8, 30)
  for (const [x, rotation] of [
    [-0.24, 0.35],
    [0.24, -0.35]
  ]) {
    const bow = new Mesh(loop, twine)
    bow.position.set(x, 0.03, front + 0.03)
    bow.scale.set(1.25, 0.72, 1)
    bow.rotation.z = rotation
    bow.castShadow = true
    string.add(bow)
  }
  const knot = new Mesh(new SphereGeometry(0.07, 16, 12), twine)
  knot.position.set(0, 0, front + 0.05)
  string.add(knot)
  for (const [x, rotation] of [
    [-0.11, 0.5],
    [0.11, -0.5]
  ]) {
    addStrand(x, -0.2, front + 0.02, thin, 0.42, thin)
    string.children[string.children.length - 1].rotation.z = rotation
  }
  group.add(string)

  return {
    group,
    string,
    setWrapped(amount) {
      for (const flap of flaps) {
        const progress = smooth((amount - flap.start) / (flap.end - flap.start))
        const angle = (Math.PI / 2) * progress * flap.sign
        const axis = flap.axis === 'x' ? 'y' : 'x'
        flap.first.rotation[axis] = angle
        flap.second.rotation[axis] = angle
      }
    },
    setOpacity(amount) {
      paper.opacity = amount
      twine.opacity = amount
    }
  }
}

export function disposeMaterial(material: Material | Material[]): void {
  for (const item of Array.isArray(material) ? material : [material]) {
    const map = (item as MeshStandardMaterial).map
    map?.dispose()
    item.dispose()
  }
}
