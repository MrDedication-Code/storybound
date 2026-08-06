import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const projectRoot = resolve(import.meta.dirname, '..')
const source = join(projectRoot, 'build', 'icon.svg')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'storybound-icons-'))

try {
  // JavaScript build utility; a TypeScript return annotation is not available in .mjs.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const render = async (size, destination) => {
    await sharp(source).resize(size, size).png().toFile(destination)
  }

  const mainPng = join(projectRoot, 'build', 'icon.png')
  await render(512, mainPng)
  await copyFile(mainPng, join(projectRoot, 'resources', 'icon.png'))

  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoInputs = []
  for (const size of icoSizes) {
    const destination = join(temporaryRoot, `icon-${size}.png`)
    await render(size, destination)
    icoInputs.push(destination)
  }
  await writeFile(join(projectRoot, 'build', 'icon.ico'), await pngToIco(icoInputs))

  if (process.platform === 'darwin') {
    const iconset = join(temporaryRoot, 'Storybound.iconset')
    await mkdir(iconset)
    const iconsetSizes = [16, 32, 128, 256, 512]
    for (const size of iconsetSizes) {
      await render(size, join(iconset, `icon_${size}x${size}.png`))
      await render(size * 2, join(iconset, `icon_${size}x${size}@2x.png`))
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(projectRoot, 'build', 'icon.icns')])
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
