import { describe, expect, it } from 'vitest'
import {
  layoutAround,
  layoutArc,
  petalAt,
  type RadialItem
} from '../src/components/radial/radialLayout'

const items = (count: number): RadialItem[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `t${index}`,
    glyph: String(index),
    label: `Tool ${index}`
  }))

describe('radial menu layout', () => {
  it('spreads petals along a quarter circle above and left of the button', () => {
    const petals = layoutArc({ x: 300, y: 500 }, items(3), {
      radius: 100,
      from: 90,
      to: 180,
      size: 48
    })
    expect(petals.map((petal) => [Math.round(petal.x), Math.round(petal.y)])).toEqual([
      [300, 400],
      [229, 429],
      [200, 500]
    ])
  })

  it('opens towards the middle of the screen and stays inside it', () => {
    const bounds = { width: 360, height: 760 }
    const corner = layoutAround({ x: 20, y: 740 }, items(7), bounds)
    for (const petal of corner) {
      expect(petal.x).toBeGreaterThanOrEqual(39)
      expect(petal.x).toBeLessThanOrEqual(321)
      expect(petal.y).toBeGreaterThanOrEqual(39)
      expect(petal.y).toBeLessThanOrEqual(721)
    }
    // From the bottom-left corner, the petals open up and to the right.
    const middle = corner[3]
    expect(middle.x).toBeGreaterThan(20)
    expect(middle.y).toBeLessThan(740)

    const petals = layoutAround({ x: 180, y: 380 }, items(7), bounds)
    for (let index = 1; index < petals.length; index += 1) {
      const gap = Math.hypot(
        petals[index].x - petals[index - 1].x,
        petals[index].y - petals[index - 1].y
      )
      expect(gap).toBeGreaterThan(petals[index].size)
    }
  })

  it('finds the petal under a finger, ignoring disabled ones', () => {
    const petals = layoutArc({ x: 0, y: 0 }, items(2), {
      radius: 100,
      from: 0,
      to: 90,
      size: 50
    })
    expect(petalAt(petals, { x: 96, y: 4 })?.key).toBe('t0')
    expect(petalAt(petals, { x: 50, y: -50 })).toBeNull()
    expect(petalAt([{ ...petals[0], disabled: true }], { x: 100, y: 0 })).toBeNull()
  })
})
