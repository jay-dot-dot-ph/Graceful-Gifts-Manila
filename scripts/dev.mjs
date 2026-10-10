import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const worker = (await import(pathToFileURL(resolve('dist/server/index.js')).href)).default;
const port = Number(process.env.PORT || 4173);
http.createServer(async (req, res) => {
  try {
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method });
    const response = await worker.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500); res.end('Server error');
  }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
