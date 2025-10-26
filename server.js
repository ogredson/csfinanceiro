// Simple static file server for preview in Trae (no npm required)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = process.env.PORT ? Number(process.env.PORT) : 8080;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = types[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURI(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath.startsWith('/#')) {
    return serveFile(path.join(root, 'index.html'), res);
  }
  const filePath = path.join(root, urlPath.replace(/^\//, ''));
  // Prevent directory traversal
  if (!filePath.startsWith(root)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err) {
      // Fallback to index.html for SPA routes
      return serveFile(path.join(root, 'index.html'), res);
    }
    if (stat.isDirectory()) {
      return serveFile(path.join(filePath, 'index.html'), res);
    }
    serveFile(filePath, res);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Preview server running at http://127.0.0.1:${port}/`);
});