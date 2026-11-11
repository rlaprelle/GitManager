// Packs PNG images into a Windows .ico file. Every entry is stored as PNG, which Windows has
// read at all sizes since Vista; it keeps the file small and avoids a BMP encoder.

export interface IcoImage {
  /** Width and height in pixels, 1–256. */
  size: number
  png: Uint8Array
}

const HEADER_BYTES = 6
const ENTRY_BYTES = 16
const ICON_TYPE = 1
const COLOR_PLANES = 1
const BITS_PER_PIXEL = 32

export function packIco(images: IcoImage[]): Uint8Array {
  assertPackable(images)
  const sorted = [...images].sort((a, b) => a.size - b.size)
  const dataStart = HEADER_BYTES + ENTRY_BYTES * sorted.length
  const total = dataStart + sorted.reduce((sum, image) => sum + image.png.length, 0)
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)

  view.setUint16(2, ICON_TYPE, true)
  view.setUint16(4, sorted.length, true)

  let offset = dataStart
  sorted.forEach((image, index) => {
    writeEntry(view, HEADER_BYTES + ENTRY_BYTES * index, image, offset)
    bytes.set(image.png, offset)
    offset += image.png.length
  })
  return bytes
}

function writeEntry(view: DataView, at: number, image: IcoImage, dataOffset: number): void {
  // A dimension byte of 0 means 256.
  view.setUint8(at, image.size % 256)
  view.setUint8(at + 1, image.size % 256)
  view.setUint16(at + 4, COLOR_PLANES, true)
  view.setUint16(at + 6, BITS_PER_PIXEL, true)
  view.setUint32(at + 8, image.png.length, true)
  view.setUint32(at + 12, dataOffset, true)
}

function assertPackable(images: IcoImage[]): void {
  if (images.length === 0) throw new Error('An .ico needs at least one image')
  const sizes = images.map((image) => image.size)
  const invalid = sizes.find((size) => !Number.isInteger(size) || size < 1 || size > 256)
  if (invalid !== undefined) throw new Error(`Icon size ${invalid} is outside 1–256`)
  if (new Set(sizes).size !== sizes.length) throw new Error('Icon sizes must be unique')
}

export interface IcoEntry {
  size: number
  bytes: number
  offset: number
}

/** Reads back the directory of an .ico: what Windows sees when it picks a size. */
export function readIcoDirectory(ico: Uint8Array): IcoEntry[] {
  const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength)
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== ICON_TYPE) {
    throw new Error('Not an .ico file')
  }
  return Array.from({ length: view.getUint16(4, true) }, (_, index) => {
    const at = HEADER_BYTES + ENTRY_BYTES * index
    return {
      size: view.getUint8(at) || 256,
      bytes: view.getUint32(at + 8, true),
      offset: view.getUint32(at + 12, true),
    }
  })
}
