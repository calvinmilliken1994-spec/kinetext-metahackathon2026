// Teacher diagram (beta): draw a pasted or chosen image to a canvas and re-encode it as PNG (docs/specs/TEACHER-FIGURE.md
// section 4). Re-encoding strips metadata (camera, location) and turns WebP or a clipboard bitmap into PNG. The sizes come
// from lib/teacherFigure.ts (`encodeSizes`: long side at most 1600 px, smaller only when the PNG would exceed the server's
// 4 MB). Browser-only; the maths is tested in lib.
import { base64ByteLength, base64FromDataUrl, encodeSizes, FIGURE_MAX_BYTES, figureInputProblem, sizeProblem } from '../lib/teacherFigure.ts';

export interface PreparedFigure {
  /** PNG bytes, base64 (what POST /api/sources/:id/figure takes). */
  base64: string;
  width: number;
  height: number;
  bytes: number;
  /** A data URL of the same PNG, for the preview. */
  previewUrl: string;
  /** The size the image had before it was scaled down. */
  originalWidth: number;
  originalHeight: number;
}

export class FigurePrepareError extends Error {}

interface Decoded { source: CanvasImageSource; width: number; height: number; close: () => void }

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch { /* fall back to an <img> below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new FigurePrepareError('The image could not be read. Try another file or screenshot.');
  }
}

/** Decode, scale and re-encode one image. Throws FigurePrepareError with a plain sentence when it cannot be used. */
export async function prepareFigure(file: Blob): Promise<PreparedFigure> {
  const problem = figureInputProblem({ type: file.type, size: file.size });
  if (problem !== null) throw new FigurePrepareError(problem);
  const img = await decode(file);
  try {
    for (const size of encodeSizes(img.width, img.height)) {
      const bad = sizeProblem(size.width, size.height);
      if (bad !== null) throw new FigurePrepareError(bad);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new FigurePrepareError('This browser could not prepare the image.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img.source, 0, 0, size.width, size.height);
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = base64FromDataUrl(dataUrl);
      if (base64 === null) throw new FigurePrepareError('This browser could not prepare the image.');
      const bytes = base64ByteLength(base64);
      if (bytes <= FIGURE_MAX_BYTES) {
        return { base64, width: size.width, height: size.height, bytes, previewUrl: dataUrl, originalWidth: img.width, originalHeight: img.height };
      }
    }
    throw new FigurePrepareError('The image is still over 4 MB as a PNG. Use a smaller or simpler image, such as a screenshot of the diagram alone.');
  } finally {
    img.close();
  }
}
