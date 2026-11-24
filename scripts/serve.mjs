import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || 4173);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
createServer(async(req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname !== '/' && pathname !== '/index.html' && !pathname.startsWith('/src/')) {res.writeHead(404).end('Ressource introuvable');return;}
    if (pathname.split('/').some(segment => segment.startsWith('.'))) {res.writeHead(403).end();return;}
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) {res.writeHead(403).end();return;}
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, {'Content-Type':mime[extname(file)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(data);
  } catch {res.writeHead(404).end('Ressource introuvable');}
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
