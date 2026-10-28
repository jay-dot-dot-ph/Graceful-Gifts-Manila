import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const root = resolve('hosting-dist');
if (!existsSync(resolve(root, 'api/catalog.json'))) throw new Error('Run npm run build:firebase before starting the local preview.');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
function cacheControl(relative) {
  if (/^(images|feedback)\/.+/.test(relative) || /^(app-|styles-|chunk-|index\.esm-).+\.(?:js|css)$/.test(relative)) return 'public, max-age=31536000, immutable';
  if (relative === 'api/catalog.json') return 'public, max-age=300, stale-while-revalidate=86400';
  if (relative === 'firebase-config.json' || relative === 'push-config.json' || relative === 'media-config.json') return 'public, max-age=300';
  return 'public, max-age=0, must-revalidate';
}
http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname);
    let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (/^watch\/[A-Z0-9-]+$/i.test(relative)) relative += '.html';
    else if (/^admin\/(chat|staff)$/.test(relative)) relative = 'admin.html';
    else if (/^(watches(?:\/[a-z0-9-]+)?|brands|favorites|contact)$/.test(relative)) relative = 'index.html';
    let path = resolve(root, relative);
    if (!path.startsWith(root + sep) || !existsSync(path)) path = resolve(root, '404.html');
    response.writeHead(path.endsWith('404.html') ? 404 : 200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': cacheControl(relative) });
    response.end(readFileSync(path));
  } catch (error) {
    console.error(error);
    response.writeHead(500); response.end('Server error');
  }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
