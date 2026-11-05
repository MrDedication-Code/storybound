import { describe, expect, it } from 'vitest'
import { CarButtonGuard } from '../src/car/carButtonGuard'
import type { ListeningSnapshot } from '../src/narration/listeningSession'

const snapshot = (
  status: ListeningSnapshot['status'],
  start: number | null = 0
): ListeningSnapshot => ({
  status,
  bookId: 'book',
  bookTitle: 'Book',
  chapterId: 'chapter',
  chapterTitle: 'Chapter',
  passage: start === null ? null : { start, end: start + 10 },
  speed: 1,
  error: ''
})

function guardAt(): { guard: CarButtonGuard; advance: (ms: number) => void } {
  let time = 10_000
  return {
    guard: new CarButtonGuard(() => time),
    advance: (ms) => {
      time += ms
    }
  }
}

describe('CarButtonGuard', () => {
  it('acts on a press when nothing has just changed', () => {
    const { guard, advance } = guardAt()
    guard.observe(snapshot('playing'))
    advance(5000)
    expect(guard.alreadyActedOn('toggle')).toBe(false)
    expect(guard.alreadyActedOn('next')).toBe(false)
  })

  it('leaves a press alone when the phone has just paused for it', () => {
    const { guard, advance } = guardAt()
    guard.observe(snapshot('playing'))
    advance(5000)
    guard.observe(snapshot('paused'))
    advance(150)
    expect(guard.alreadyActedOn('toggle')).toBe(true)
  })

  it('leaves a skip alone when the phone has just moved passage', () => {
    const { guard, advance } = guardAt()
    guard.observe(snapshot('playing', 0))
    advance(5000)
    guard.observe(snapshot('playing', 200))
    advance(450)
    expect(guard.alreadyActedOn('next')).toBe(true)
    expect(guard.alreadyActedOn('toggle')).toBe(false)
  })

  it('notices a move from the title to the first paragraph, which start at the same place', () => {
    const { guard, advance } = guardAt()
    guard.observe({ ...snapshot('playing'), passage: { start: 0, end: 0 } })
    advance(5000)
    guard.observe({ ...snapshot('playing'), passage: { start: 0, end: 300 } })
    expect(guard.alreadyActedOn('next')).toBe(true)
  })

  it('accepts the next press once the moment has passed', () => {
    const { guard, advance } = guardAt()
    guard.observe(snapshot('playing'))
    guard.observe(snapshot('paused'))
    advance(700)
    expect(guard.alreadyActedOn('toggle')).toBe(false)
  })

  it('does not count waiting for the next passage as a pause', () => {
    const { guard, advance } = guardAt()
    guard.observe(snapshot('playing'))
    advance(5000)
    guard.observe(snapshot('loading'))
    expect(guard.alreadyActedOn('toggle')).toBe(false)
  })
})
