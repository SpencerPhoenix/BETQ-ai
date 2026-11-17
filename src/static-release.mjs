import {createHash} from 'node:crypto';

// Capture one release at process startup. Never hash one file version and later
// send different bytes from disk. Only the caller's strict allowlist is exposed.
export function createStaticRelease(assets, read) {
  const files = new Map();
  for (const [path, [file, type]] of assets) {
    const body = Buffer.from(read(file));
    const hash = createHash('sha256').update(body).digest('hex');
    files.set(path, {body, type, hash});
  }
  for (const entry of files.values()) {
    if (!entry.type.startsWith('text/html')) continue;
    entry.body = Buffer.from(entry.body.toString('utf8').replace(
      /(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?#]+)(")/gi,
      (match, before, path, after) => {
        const target = files.get(path);
        if (!target || !/\.(?:js|css)$/.test(path)) return match;
        const integrity = Buffer.from(target.hash, 'hex').toString('base64');
        return `${before}${path}?v=${target.hash}${after} integrity="sha256-${integrity}"`;
      }
    ));
  }
  return {
    get(url) {
      const entry = files.get(url.pathname);
      if (!entry) return null;
      const versions = url.searchParams.getAll('v');
      if (versions.length && (versions.length !== 1 || versions[0] !== entry.hash)) {
        return {status: 409, type: 'text/plain; charset=utf-8', cache: 'no-store',
          body: Buffer.from('This page belongs to a different BETQ release. Reload the page to update.')};
      }
      const immutable = versions.length === 1 && !entry.type.startsWith('text/html');
      return {status: 200, type: entry.type, body: entry.body,
        cache: immutable ? 'public, max-age=31536000, immutable' : 'no-store'};
    }
  };
}
