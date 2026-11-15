import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { packIco, readIcoDirectory } from '../ico'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function fakePng(length: number): Uint8Array {
  const png = new Uint8Array(length)
  png.set(PNG_SIGNATURE)
  return png
}

function startsWithPngSignature(ico: Uint8Array, offset: number): boolean {
  return PNG_SIGNATURE.every((byte, index) => ico[offset + index] === byte)
}

describe('packIco', () => {
  it('writes an icon header, one directory entry per image, then the images', () => {
    const ico = packIco([
      { size: 32, png: fakePng(40) },
      { size: 16, png: fakePng(20) },
    ])
    const view = new DataView(ico.buffer)

    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([0, 1, 2])
    expect(readIcoDirectory(ico)).toEqual([
      { size: 16, bytes: 20, offset: 6 + 2 * 16 },
      { size: 32, bytes: 40, offset: 6 + 2 * 16 + 20 },
    ])
    expect(ico.length).toBe(6 + 2 * 16 + 20 + 40)
  })

  it('records 32-bit colour and one plane, as Windows expects', () => {
    const view = new DataView(packIco([{ size: 48, png: fakePng(10) }]).buffer)
    expect([view.getUint16(6 + 4, true), view.getUint16(6 + 6, true)]).toEqual([1, 32])
  })

  it('stores 256 as 0 in the dimension bytes and reads it back as 256', () => {
    const ico = packIco([{ size: 256, png: fakePng(10) }])
    expect([ico[6], ico[7]]).toEqual([0, 0])
    expect(readIcoDirectory(ico)[0]!.size).toBe(256)
  })

  it('rejects images it cannot represent', () => {
    expect(() => packIco([])).toThrow('at least one')
    expect(() => packIco([{ size: 512, png: fakePng(10) }])).toThrow('outside')
    expect(() => packIco([{ size: 16, png: fakePng(10) }, { size: 16, png: fakePng(10) }])).toThrow('unique')
  })
})

// Guards the committed file the installer embeds: regenerated with `npm run icon`.
describe('build/icon.ico', () => {
  const committedIco = () => new Uint8Array(readFileSync('build/icon.ico'))

  it('has every size Windows asks for, from 16 px up to 256 px', () => {
    expect(readIcoDirectory(committedIco()).map((entry) => entry.size)).toEqual([16, 20, 24, 32, 40, 48, 64, 128, 256])
  })

  it('holds a PNG image at every entry', () => {
    const ico = committedIco()
    for (const entry of readIcoDirectory(ico)) {
      expect(startsWithPngSignature(ico, entry.offset), `${entry.size} px`).toBe(true)
      expect(entry.offset + entry.bytes).toBeLessThanOrEqual(ico.length)
    }
  })
})
