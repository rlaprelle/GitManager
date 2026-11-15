// Renders build/icon.svg and build/icon-small.svg at every Windows icon size and packs them
// into build/icon.ico, which electron-builder embeds in the exe and installer.
// Run with `npm run icon` after editing either SVG; the .ico is committed.

import { readFileSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'
import { type IcoImage, packIco } from './ico.ts'

const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
/** Sizes up to this use the simplified small-size artwork. */
const SMALL_ARTWORK_MAX = 32

const fromRoot = (path: string) => new URL(`../${path}`, import.meta.url)

async function renderPng(page: Page, svg: string, size: number): Promise<Uint8Array> {
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<body style="margin:0;background:transparent"><img src="${source}" width="${size}" height="${size}"></body>`,
  )
  await page.locator('img').evaluate((image: HTMLImageElement) => image.decode())
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

async function main(): Promise<void> {
  const largeSvg = readFileSync(fromRoot('build/icon.svg'), 'utf8')
  const smallSvg = readFileSync(fromRoot('build/icon-small.svg'), 'utf8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 })
    const images: IcoImage[] = []
    for (const size of ICON_SIZES) {
      const svg = size <= SMALL_ARTWORK_MAX ? smallSvg : largeSvg
      images.push({ size, png: await renderPng(page, svg, size) })
    }
    writeFileSync(fromRoot('build/icon.ico'), packIco(images))
    console.log(`build/icon.ico: ${ICON_SIZES.join(', ')} px`)
  } finally {
    await browser.close()
  }
}

await main()
