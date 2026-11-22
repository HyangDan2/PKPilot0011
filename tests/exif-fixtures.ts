/**
 * Real EXIF bytes for the studio's tests.
 *
 * The metadata reader is only worth testing against actual camera files: a
 * JPEG whose APP1 really carries a TIFF, and a HEIC whose `meta` box really
 * points at an `Exif` item. Both builders here write that structure byte by
 * byte, so `readPhotoMeta` is exercised the way exifr meets a camera's export —
 * not through a stubbed parser.
 */

export interface TiffFields {
  make?: string;
  model?: string;
  lens?: string;
  /** f/1.8 */
  fNumber?: number;
  /** 1/250 */
  exposureTime?: number;
  iso?: number;
  /** 'YYYY:MM:DD HH:MM:SS', the camera's own clock */
  datetime?: string;
}

type Entry = { tag: number; type: number; count: number; value: Uint8Array };

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

function ascii(text: string): { value: Uint8Array; count: number } {
  const bytes = new Uint8Array(text.length + 1);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return { value: bytes, count: bytes.length };
}

function short(value: number): { value: Uint8Array; count: number } {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return { value: bytes, count: 1 };
}

function rational(numerator: number, denominator: number): { value: Uint8Array; count: number } {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, numerator, true);
  view.setUint32(4, denominator, true);
  return { value: bytes, count: 1 };
}

const ifdBytes = (entries: Entry[]) => 2 + entries.length * 12 + 4;

/**
 * A little-endian TIFF: IFD0 with the maker tags, and the Exif sub-IFD a
 * camera writes the exposure triangle and the lens into.
 */
export function buildTiff(fields: TiffFields): Uint8Array {
  const ifd0: Entry[] = [];
  const exifIfd: Entry[] = [];
  const push = (list: Entry[], tag: number, type: number, packed: { value: Uint8Array; count: number } | null) => {
    if (!packed) return;
    list.push({ tag, type, count: packed.count, value: packed.value });
  };
  push(ifd0, 0x010f, ASCII, fields.make ? ascii(fields.make) : null);
  push(ifd0, 0x0110, ASCII, fields.model ? ascii(fields.model) : null);
  push(ifd0, 0x0132, ASCII, fields.datetime ? ascii(fields.datetime) : null);
  push(exifIfd, 0x829a, RATIONAL, fields.exposureTime ? rational(1, Math.round(1 / fields.exposureTime)) : null);
  push(exifIfd, 0x829d, RATIONAL, fields.fNumber ? rational(Math.round(fields.fNumber * 100), 100) : null);
  push(exifIfd, 0x8827, SHORT, fields.iso ? short(fields.iso) : null);
  push(exifIfd, 0x9003, ASCII, fields.datetime ? ascii(fields.datetime) : null);
  push(exifIfd, 0xa434, ASCII, fields.lens ? ascii(fields.lens) : null);
  // 0x8769 points IFD0 at the Exif sub-IFD; the offset is filled in below.
  ifd0.push({ tag: 0x8769, type: LONG, count: 1, value: new Uint8Array(4) });

  const subOffset = 8 + ifdBytes(ifd0);
  const dataStart = subOffset + ifdBytes(exifIfd);
  let dataAt = dataStart;
  const layout: { offset: number; length: number }[] = [];
  const plan = (entry: Entry) => {
    if (entry.value.length <= 4) { layout.push({ offset: -1, length: 0 }); return; }
    layout.push({ offset: dataAt, length: entry.value.length });
    dataAt += entry.value.length;
  };
  ifd0.forEach(plan);
  exifIfd.forEach(plan);

  const out = new Uint8Array(dataAt);
  const view = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49;               // 'II' — little endian
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);                 // IFD0 follows the header

  let slot = 0;
  const writeIfd = (at: number, entries: Entry[]) => {
    view.setUint16(at, entries.length, true);
    entries.forEach((entry, index) => {
      const here = at + 2 + index * 12;
      view.setUint16(here, entry.tag, true);
      view.setUint16(here + 2, entry.type, true);
      view.setUint32(here + 4, entry.count, true);
      const planned = layout[slot++];
      if (planned.offset < 0) {
        out.set(entry.value, here + 8);
      } else {
        view.setUint32(here + 8, planned.offset, true);
        out.set(entry.value, planned.offset);
      }
    });
    view.setUint32(at + 2 + entries.length * 12, 0, true); // no next IFD
  };

  writeIfd(8, ifd0);
  writeIfd(subOffset, exifIfd);
  const pointer = 10 + (ifd0.length - 1) * 12 + 8;
  view.setUint32(pointer, subOffset, true);
  return out;
}

/** A JPEG: SOI, our EXIF APP1, then the base image's own compressed data. */
export function jpegWithExif(base: Uint8Array, tiff: Uint8Array): Uint8Array {
  const head = new Uint8Array([0xff, 0xd8]);
  const app1 = new Uint8Array([0xff, 0xe1, 0x00, 0x00, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // Exif\0\0
  const app1Length = 2 + 6 + tiff.length;
  app1[2] = (app1Length >> 8) & 0xff;
  app1[3] = app1Length & 0xff;
  const body = stripAppSegments(base);
  const out = new Uint8Array(head.length + app1.length + tiff.length + body.length);
  let at = 0;
  for (const part of [head, app1, tiff, body]) { out.set(part, at); at += part.length; }
  return out;
}

/** Drops every APP0–APP15 segment after SOI, so only our EXIF is in the file. */
function stripAppSegments(base: Uint8Array): Uint8Array {
  if (base[0] !== 0xff || base[1] !== 0xd8) return base;
  let at = 2;
  while (at + 4 <= base.length && base[at] === 0xff) {
    const marker = base[at + 1];
    if (marker < 0xe0 || marker > 0xef) break;
    const length = (base[at + 2] << 8) | base[at + 3];
    at += 2 + length;
  }
  return base.slice(at);
}

/**
 * A HEIC/HEIF still: `ftyp` (`heic`), then a `meta` box holding `iinf` (one
 * Exif item) and `iloc` (where that item's bytes are), then `mdat` with the
 * payload exifr expects — a name length, a name, then the TIFF.
 */
export function heicWithExif(tiff: Uint8Array): Uint8Array {
  const box = (kind: string, ...parts: Uint8Array[]): Uint8Array => {
    const bodyLength = parts.reduce((total, part) => total + part.length, 0);
    const out = new Uint8Array(8 + bodyLength);
    new DataView(out.buffer).setUint32(0, out.length, false);
    for (let i = 0; i < 4; i += 1) out[4 + i] = kind.charCodeAt(i);
    let at = 8;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  };
  const u32 = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    return bytes;
  };
  const u16 = (value: number) => {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, false);
    return bytes;
  };
  const asciiBytes = (text: string) => Uint8Array.from([...text].map((character) => character.charCodeAt(0)));

  const ftyp = box('ftyp', asciiBytes('heic'), u32(0), asciiBytes('mif1'), asciiBytes('heic'));

  // infe v2: item_ID, item_protection_index, item_type 'Exif', item_name.
  const infe = box('infe', u32(0x02000000), u16(1), u16(0), asciiBytes('Exif'), new Uint8Array([0]));
  const iinf = box('iinf', u32(0), u16(1), infe);

  // iloc v0: 4-byte offsets and lengths, one item, one extent at the mdat payload.
  const exifPayload = new Uint8Array(4 + tiff.length); // 4-byte name length (0), no name
  exifPayload.set(tiff, 4);
  const ilocLength = 8 + 4 + 2 + 2 + 2 + 2 + 2 + 4 + 4;
  const metaLength = 8 + 4 + iinf.length + ilocLength;
  const exifOffset = ftyp.length + metaLength + 8; // + the mdat box head
  const iloc = box('iloc', u32(0), new Uint8Array([0x44, 0x00]), u16(1), u16(1), u16(0), u16(1), u32(exifOffset), u32(exifPayload.length));
  const meta = box('meta', u32(0), iinf, iloc);
  const mdat = box('mdat', exifPayload);

  const out = new Uint8Array(ftyp.length + meta.length + mdat.length);
  let at = 0;
  for (const part of [ftyp, meta, mdat]) { out.set(part, at); at += part.length; }
  return out;
}
