// Tiny hand-built image byte fixtures for the teacher-figure tests (no image library). Not a test file itself, so
// several test files can share it without running each other's tests.

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];

/** PNG signature + an IHDR chunk (CRC not checked by the reader) + IEND, zero-padded to `padTo` bytes. */
export function png(width: number, height: number, padTo = 0): Buffer {
  const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height), 8, 2, 0, 0, 0, 0, 0, 0, 0];
  const tail = [...u32(0), 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  const body = Buffer.from([...head, ...tail]);
  return padTo > body.length ? Buffer.concat([body, Buffer.alloc(padTo - body.length)]) : body;
}

/** SOI, an APP0 segment, optional fill bytes, the SOF segment (0xC0 baseline / 0xC2 progressive), SOS, EOI. */
export function jpeg(width: number, height: number, sof = 0xc0, opts: { fill?: boolean; sosFirst?: boolean } = {}): Buffer {
  const app0 = [0xff, 0xe0, ...u16(16), 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, ...u16(1), ...u16(1), 0, 0];
  const sofSeg = [0xff, sof, ...u16(17), 8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, ...u16(8), 1, 1, 0, 0, 63, 0, 0x12, 0x34];
  const fill = opts.fill === true ? [0xff, 0xff] : [];
  const parts = opts.sosFirst === true ? [...app0, ...sos, ...sofSeg] : [...app0, ...fill, ...sofSeg, ...sos];
  return Buffer.from([0xff, 0xd8, ...parts, 0xff, 0xd9]);
}
