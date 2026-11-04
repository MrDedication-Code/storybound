import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { KokoroFile } from '@storybound/narration'
import { KokoroEngine } from '../../src/main/narration/kokoro'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

function file(name: string, content: string): KokoroFile {
  return {
    name,
    url: `https://example.test/${name}`,
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex')
  }
}

function fakeFetch(contents: Record<string, string>, requested: string[]): typeof fetch {
  return (async (url: string) => {
    requested.push(url)
    const name = url.split('/').pop() ?? ''
    return new Response(contents[name] ?? '', { status: name in contents ? 200 : 404 })
  }) as unknown as typeof fetch
}

describe('free voice download', () => {
  it('downloads each file once, checks it, and remembers it is installed', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'kokoro-'))
    folders.push(folder)
    const contents = { 'model.onnx': 'model bytes', 'voice.bin': 'voice bytes' }
    const files = [
      file('model.onnx', contents['model.onnx']),
      file('voice.bin', contents['voice.bin'])
    ]
    const requested: string[] = []
    const engine = new KokoroEngine(folder, fakeFetch(contents, requested), files[0], files)

    expect(await engine.isInstalled()).toBe(false)
    expect(engine.downloadBytes).toBe(22)
    await engine.install()
    expect(await engine.isInstalled()).toBe(true)
    expect(await readFile(join(folder, 'voice.bin'), 'utf8')).toBe('voice bytes')
    expect(engine.installProgress).toBeNull()

    // Files already in place are checked, not fetched again.
    await writeFile(join(folder, 'installed.json'), '{}')
    await engine.install()
    expect(requested).toHaveLength(2)
    expect(await engine.isInstalled()).toBe(true)

    await engine.remove()
    expect(await engine.isInstalled()).toBe(false)
  })

  it('refuses a file that does not match its checksum', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'kokoro-'))
    folders.push(folder)
    const expected = file('model.onnx', 'the real model')
    const engine = new KokoroEngine(
      folder,
      fakeFetch({ 'model.onnx': 'something else!' }, []),
      expected,
      [expected]
    )
    await expect(engine.install()).rejects.toThrow('damaged')
    expect(await engine.isInstalled()).toBe(false)
    await expect(engine.synthesize('Hello.', 'bm_george')).rejects.toThrow(
      'Download the free voice'
    )
  })
})
