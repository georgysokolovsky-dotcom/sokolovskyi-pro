import { createReadStream, statSync } from 'node:fs';

const fixtureVideoId = 'lab-men-funnel-video-fixture';
const fixtureUrl = new URL('../../assets/staging-webinar-fixture.mp4', import.meta.url);

function mediaHeaders(contentLength) {
  return {
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=300',
    'content-length': contentLength,
    'content-type': 'video/mp4',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
}

function parseRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1, partial: true };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1), partial: true };
}

export function createLocalFixtureMediaSource() {
  const size = statSync(fixtureUrl).size;
  return Object.freeze({
    canServe({ videoId, videoProvider }) {
      return videoId === fixtureVideoId && videoProvider === 'native-html5';
    },
    send(request, response) {
      const range = parseRange(request.headers.range, size);
      if (!range) {
        response.writeHead(416, {
          ...mediaHeaders(0),
          'content-range': `bytes */${size}`,
        });
        return response.end();
      }
      const contentLength = range.end - range.start + 1;
      const headers = mediaHeaders(contentLength);
      if (range.partial) headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`;
      response.writeHead(range.partial ? 206 : 200, headers);
      if (request.method === 'HEAD') return response.end();
      return createReadStream(fixtureUrl, { start: range.start, end: range.end }).pipe(response);
    },
  });
}
