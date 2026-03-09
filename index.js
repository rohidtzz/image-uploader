import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import fs from 'fs';
import { createStream } from 'rotating-file-stream';
import uploadMiddleware from '#middleware/upload.js';
import errorHandler from '#middleware/errorHandler.js';

const app = express();
const port = process.env.PORT ?? 3000;

// Ensure log directory exists
fs.mkdirSync('./src/logs', { recursive: true });

// Log rotation: new file every day OR when size exceeds 5MB
// Filename format: 2026-03-08.access.log
const logStream = createStream((time, index) => {
  if (!time) return 'access.log';
  const date = time.toISOString().slice(0, 10); // YYYY-MM-DD
  return `${date}${index > 1 ? `-${index}` : ''}.access.log`;
}, {
  interval: '1d',
  size: '5M',
  path: './src/logs',
});

// Trust proxy (needed when behind Cloudflare / reverse proxy)
app.set('trust proxy', true);

// Resolve real client IP:
// 1. CF-Connecting-IP (Cloudflare's injected real visitor IP)
// 2. X-Forwarded-For first entry
// 3. Fallback to socket remote address
app.use((req, _res, next) => {
  req.clientIp =
    req.headers['cf-connecting-ip'] ??
    req.headers['x-forwarded-for']?.split(',')[0].trim() ??
    req.socket.remoteAddress;
  next();
});

// Custom morgan token that uses resolved clientIp
morgan.token('client-ip', (req) => req.clientIp);

// Log to file (combined) + console (dev)
app.use(morgan(':client-ip - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"', { stream: logStream }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limit: max 5 uploads per IP per hour
const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.clientIp,
  message: { error: 'Too many uploads from this IP, please try again after 1 hour.' },
});

// GET / — simple HTML image gallery
app.get('/', async (req, res, next) => {
  try {
    const { list } = await import('#services/storage.js');
    const files = await list();

    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif']);
    const images = files.filter(f => imageExts.has(f.key.slice(f.key.lastIndexOf('.')).toLowerCase()));

    const cards = images.length
      ? images.map(({ key, url }) => `
        <div class="card">
          <img src="${url}" alt="${key}" loading="lazy" />
          <a href="${url}" target="_blank" title="${key}">${key.split('/').pop()}</a>
        </div>`).join('')
      : '<p class="empty">No images uploaded yet.</p>';

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Image Gallery</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: sans-serif; background: #f4f4f5; color: #18181b; padding: 2rem; }
    h1 { margin-bottom: 1.5rem; font-size: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; }
    .card { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
    .card img { width: 100%; height: 160px; object-fit: cover; display: block; }
    .card a { display: block; padding: .5rem .75rem; font-size: .75rem; color: #6366f1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .empty { color: #71717a; }
  </style>
</head>
<body>
  <h1>Image Gallery (${images.length})</h1>
  <div class="grid">${cards}</div>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

// GET /upload — list all uploaded files
app.get('/upload', async (req, res, next) => {
  try {
    const { list } = await import('#services/storage.js');
    const files = await list();
    res.json({ ok: true, total: files.length, files });
  } catch (err) {
    next(err);
  }
});

// POST /upload — upload a file, get URL back
app.post('/upload', uploadRateLimit, uploadMiddleware, (req, res) => {
  const { originalname, mimetype, size, key, url } = req.file;
  res.status(201).json({
    ok: true,
    file: { name: originalname, type: mimetype, size, key, url },
  });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Storage API running on port ${port}`);
});
