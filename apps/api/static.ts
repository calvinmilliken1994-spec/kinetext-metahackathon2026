// Stage 11 slice L — serve the built web app (apps/web/dist) from the API, so `npm start` needs one port.
//
// Used only when ApiOptions.staticDir is set (main.ts: WEB_DIST_DIR). It answers GET and HEAD for
// paths outside /api/. Files come from inside the dist folder and nowhere else:
//   - the path is percent-decoded once; NUL bytes, backslashes, drive-letter colons, `.` / `..` segments
//     and dotfiles are refused before the file system is touched;
//   - the resolved real path (symlinks followed) must still be inside the real dist folder;
//   - only regular files are sent, never directory listings.
// An unknown path without a file extension is a page route of the single-page app and gets index.html;
// an unknown file (one with an extension) is the usual JSON 404. Nothing is logged.

import { createReadStream, realpathSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, isAbsolute, join, relative, sep } from 'node:path';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** Vite names built assets `name-<hash>.ext`: those never change under the same name. */
const HASHED_ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/;

/** The folder when it holds a built app (an index.html), else undefined. */
export function staticDirIfBuilt(dir: string | undefined): string | undefined {
  if (dir === undefined || dir === '') {
    return undefined;
  }
  try {
    return statSync(join(dir, 'index.html')).isFile() ? dir : undefined;
  } catch {
    return undefined;
  }
}

function sendNotFound(res: ServerResponse): void {
  const payload = JSON.stringify({ error: 'NOT_FOUND' });
  res.writeHead(404, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** The request path as clean segments, or null when it could escape or reach something hidden. */
function safeSegments(pathname: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    return null;
  }
  const segments = decoded.split('/').filter(s => s !== '');
  for (const seg of segments) {
    if (seg.startsWith('.') || seg.includes(':')) {
      return null; // `.`, `..`, dotfiles, drive letters and NTFS streams
    }
  }
  return segments;
}

export interface StaticHandler {
  /** Answer a GET/HEAD for a path outside /api/. Always ends the response. */
  serve(req: IncomingMessage, res: ServerResponse, pathname: string): void;
}

export function createStaticHandler(dir: string): StaticHandler {
  const realRoot: string = realpathSync(dir);

  /** A regular file inside the dist folder, or null. */
  function resolveFile(segments: string[]): { path: string; size: number } | null {
    const candidate = join(realRoot, ...segments);
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      return null;
    }
    const rel = relative(realRoot, real);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
      return null;
    }
    try {
      const st = statSync(real);
      return st.isFile() ? { path: real, size: st.size } : null;
    } catch {
      return null;
    }
  }

  function send(req: IncomingMessage, res: ServerResponse, file: { path: string; size: number }, urlPath: string): void {
    const type = MIME[extname(file.path).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': file.size,
      'x-content-type-options': 'nosniff',
      'cache-control': HASHED_ASSET.test(urlPath) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file.path);
    stream.on('error', () => {
      res.destroy();
    });
    stream.pipe(res);
  }

  return {
    serve(req, res, pathname): void {
      const segments = safeSegments(pathname);
      if (segments === null) {
        return sendNotFound(res);
      }
      const urlPath = `/${segments.join('/')}`;
      const direct = segments.length === 0 ? null : resolveFile(segments);
      if (direct !== null) {
        return send(req, res, direct, urlPath);
      }
      const last = segments[segments.length - 1] ?? '';
      if (last.includes('.')) {
        return sendNotFound(res); // a missing file, not a page route
      }
      const index = resolveFile(['index.html']);
      return index !== null ? send(req, res, index, '/index.html') : sendNotFound(res);
    },
  };
}
