export const VIDEO_MAX_BYTES = 20 * 1024 * 1024
export class VideoError extends Error {
  constructor(
    public status: number,
    code: string
  ) {
    super(code)
  }
}
interface Box {
  start: number
  end: number
  data: number
  type: string
}
/** Bounds-checked ISO BMFF parser. Only ordinary H.264/AAC MP4 tracks are accepted. */
export function sanitizeVideo(input: Uint8Array) {
  if (input.byteLength > VIDEO_MAX_BYTES) throw new VideoError(413, 'VIDEO_TOO_LARGE')
  if (input.byteLength < 64) throw new VideoError(415, 'VIDEO_UNSUPPORTED')
  const data = new Uint8Array(input),
    view = new DataView(data.buffer),
    text = (at: number, n = 4) => String.fromCharCode(...data.subarray(at, at + n))
  let count = 0
  function boxes(start: number, end: number): Box[] {
    const out: Box[] = []
    for (let at = start; at < end; ) {
      if (++count > 30000 || end - at < 8) throw new VideoError(415, 'VIDEO_UNSUPPORTED')
      let size = view.getUint32(at),
        header = 8
      if (size === 1) {
        if (end - at < 16) throw new VideoError(415, 'VIDEO_UNSUPPORTED')
        const wide = view.getBigUint64(at + 8)
        if (wide > BigInt(VIDEO_MAX_BYTES)) throw new VideoError(415, 'VIDEO_UNSUPPORTED')
        size = Number(wide)
        header = 16
      }
      if (size === 0) size = end - at
      if (size < header || at + size > end) throw new VideoError(415, 'VIDEO_UNSUPPORTED')
      out.push({ start: at, end: at + size, data: at + header, type: text(at + 4) })
      at += size
    }
    return out
  }
  const top = boxes(0, data.length),
    ftyp = top.find((b) => b.type === 'ftyp'),
    movies = top.filter((b) => b.type === 'moov')
  if (
    !ftyp ||
    ftyp.end - ftyp.data < 8 ||
    movies.length !== 1 ||
    !top.some((b) => b.type === 'mdat' && b.end > b.data)
  )
    throw new VideoError(415, 'VIDEO_UNSUPPORTED')
  const brands = []
  for (let at = ftyp.data; at + 4 <= ftyp.end; at += 4)
    if (at !== ftyp.data + 4) brands.push(text(at))
  if (
    !brands.some((b) =>
      [
        'isom',
        'iso2',
        'iso3',
        'iso4',
        'iso5',
        'iso6',
        'mp41',
        'mp42',
        'avc1',
        'M4V ',
        'dash'
      ].includes(b)
    )
  )
    throw new VideoError(415, 'VIDEO_UNSUPPORTED')
  const child = (box: Box, type: string) => boxes(box.data, box.end).find((b) => b.type === type)
  let width = 0,
    height = 0,
    duration = 0,
    videoTracks = 0
  for (const track of boxes(movies[0].data, movies[0].end).filter((b) => b.type === 'trak')) {
    const mdia = child(track, 'mdia'),
      hdlr = mdia && child(mdia, 'hdlr'),
      mdhd = mdia && child(mdia, 'mdhd')
    if (!mdia || !hdlr || hdlr.end - hdlr.data < 12 || !mdhd)
      throw new VideoError(415, 'VIDEO_UNSUPPORTED')
    const handler = text(hdlr.data + 8)
    if (!['vide', 'soun'].includes(handler)) throw new VideoError(415, 'VIDEO_UNSUPPORTED')
    const minf = child(mdia, 'minf'),
      stbl = minf && child(minf, 'stbl'),
      stsd = stbl && child(stbl, 'stsd')
    if (!stsd || stsd.end - stsd.data < 8) throw new VideoError(415, 'VIDEO_UNSUPPORTED')
    const descriptions = boxes(stsd.data + 8, stsd.end)
    if (
      !descriptions.length ||
      descriptions.length > 4 ||
      view.getUint32(stsd.data + 4) !== descriptions.length
    )
      throw new VideoError(415, 'VIDEO_UNSUPPORTED')
    if (handler === 'vide') {
      if (
        ++videoTracks !== 1 ||
        descriptions.some((b) => !['avc1', 'avc3'].includes(b.type) || b.end - b.start < 86)
      )
        throw new VideoError(415, 'VIDEO_UNSUPPORTED')
      width = view.getUint16(descriptions[0].start + 32)
      height = view.getUint16(descriptions[0].start + 34)
      const version = data[mdhd.data],
        offset = version === 1 ? 20 : 12
      if (![0, 1].includes(version) || mdhd.end - mdhd.data < offset + (version === 1 ? 12 : 8))
        throw new VideoError(415, 'VIDEO_UNSUPPORTED')
      const scale = view.getUint32(mdhd.data + offset)
      const ticks =
        version === 1
          ? Number(view.getBigUint64(mdhd.data + offset + 4))
          : view.getUint32(mdhd.data + offset + 4)
      if (!scale || !Number.isSafeInteger(ticks)) throw new VideoError(415, 'VIDEO_UNSUPPORTED')
      duration = ticks / scale
    } else if (descriptions.some((b) => b.type !== 'mp4a'))
      throw new VideoError(415, 'VIDEO_UNSUPPORTED')
  }
  if (
    videoTracks !== 1 ||
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    !Number.isFinite(duration)
  )
    throw new VideoError(415, 'VIDEO_UNSUPPORTED')
  // Preserve chunk offsets while removing ordinary location and descriptive metadata.
  // Reject metadata tracks above rather than retaining GPS samples inside mdat.
  const containers = new Set([
    'moov',
    'trak',
    'mdia',
    'minf',
    'stbl',
    'edts',
    'dinf',
    'mvex',
    'moof',
    'traf',
    'mfra'
  ])
  function scrub(items: Box[], depth = 0) {
    if (depth > 10) throw new VideoError(415, 'VIDEO_UNSUPPORTED')
    for (const box of items) {
      if (
        ['udta', 'meta', 'uuid', 'loci', 'gps ', 'geo ', 'XMP_'].includes(box.type) ||
        box.type.startsWith('©')
      ) {
        data.set([102, 114, 101, 101], box.start + 4)
        data.fill(0, box.data, box.end)
      } else if (containers.has(box.type)) scrub(boxes(box.data, box.end), depth + 1)
    }
  }
  scrub(top)
  return { data, width, height, duration: Math.round(duration * 1000) / 1000 }
}
