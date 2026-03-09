import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import fs from 'fs';
import multer from 'multer';
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

// Multer instance for the web form (parse only, no S3 upload yet)
const formParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE ?? 10 * 1024 * 1024) },
});

// GET / — file gallery (images + PDFs)
app.get('/', async (req, res, next) => {
  try {
    const { list } = await import('#services/storage.js');
    const files = await list();

    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif']);
    const allowed = files.filter(f => {
      const ext = f.key.slice(f.key.lastIndexOf('.')).toLowerCase();
      return imageExts.has(ext) || ext === '.pdf';
    });

    const rows = allowed.length
      ? allowed.map(({ key, url }) => {
          const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
          const icon = ext === '.pdf' ? '📄' : '🖼️';
          const name = key.split('/').pop();
          return `<tr><td>${icon}</td><td><a href="${url}" target="_blank">${key}</a></td><td>${name.slice(name.lastIndexOf('.') + 1).toUpperCase()}</td></tr>`;
        }).join('')
      : '<tr><td colspan="3" class="empty">No files uploaded yet.</td></tr>';

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>File Gallery</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: sans-serif; background: #f4f4f5; color: #18181b; padding: 2rem; }
    h1 { margin-bottom: 1.5rem; font-size: 1.5rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
    th { background: #e4e4e7; padding: .6rem 1rem; text-align: left; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; }
    td { padding: .6rem 1rem; border-top: 1px solid #f1f1f1; font-size: .875rem; }
    td:first-child { width: 2rem; text-align: center; }
    td:last-child { width: 4rem; color: #71717a; font-size: .75rem; }
    a { color: #6366f1; text-decoration: none; word-break: break-all; }
    a:hover { text-decoration: underline; }
    .empty { text-align: center; padding: 2rem; color: #71717a; }
  </style>
</head>
<body>
  <h1>Files (${allowed.length})</h1>
  <table>
    <thead><tr><th></th><th>Key</th><th>Type</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

// GET /docs — documentation + upload form
app.get('/docs', (req, res) => {
  const { success, key, url, error } = req.query;

  const alert = success
    ? `<div class="alert ok">
        ✅ Upload berhasil!<br>
        <strong>Key:</strong> <code>${key}</code><br>
        <a href="${url}" target="_blank">${url}</a>
      </div>`
    : error === 'no_file'
        ? `<div class="alert err">❌ Pilih file terlebih dahulu.</div>`
        : error === 'rate_limit'
          ? `<div class="alert err">❌ Terlalu banyak upload. Coba lagi 1 jam kemudian.</div>`
          : '';

  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Storage API \u2014 Docs</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:sans-serif;background:#f4f4f5;color:#18181b;padding:2rem;max-width:860px;margin:0 auto}
    h1{font-size:1.6rem;margin-bottom:.25rem}
    .sub{color:#71717a;margin-bottom:2rem;font-size:.9rem}
    h2{font-size:1.1rem;margin:2rem 0 .75rem;border-bottom:1px solid #e4e4e7;padding-bottom:.4rem}
    h3{font-size:.95rem;margin:1.25rem 0 .4rem;color:#3f3f46}
    p{line-height:1.6;font-size:.9rem;margin-bottom:.5rem}
    code{background:#e4e4e7;padding:.1em .35em;border-radius:4px;font-size:.85em}
    pre{background:#18181b;color:#e4e4e7;padding:1rem;border-radius:8px;overflow-x:auto;font-size:.82rem;margin:.5rem 0 1rem}
    pre code{background:none;padding:0;color:inherit}
    table{width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:1rem}
    th{background:#e4e4e7;padding:.5rem .75rem;text-align:left}
    td{padding:.5rem .75rem;border-top:1px solid #f1f1f1}
    .card{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:1.5rem;margin-bottom:1.5rem}
    .form-group{margin-bottom:1rem}
    label{display:block;font-size:.85rem;font-weight:600;margin-bottom:.35rem}
    input[type=file],input[type=password]{width:100%;padding:.5rem .75rem;border:1px solid #d4d4d8;border-radius:6px;font-size:.9rem;background:#fff}
    input[type=password]{font-family:monospace}
    button{background:#6366f1;color:#fff;border:none;padding:.6rem 1.4rem;border-radius:6px;font-size:.9rem;cursor:pointer;font-weight:600}
    button:hover{background:#4f46e5}
    .alert{padding:.75rem 1rem;border-radius:6px;margin-bottom:1.25rem;font-size:.875rem;line-height:1.6}
    .alert.ok{background:#dcfce7;color:#166534}
    .alert.err{background:#fee2e2;color:#991b1b}
    .alert code{background:rgba(0,0,0,.08)}
    a{color:#6366f1}
    nav{margin-bottom:2rem;font-size:.875rem}
    nav a{margin-right:1rem}
  </style>
</head>
<body>
  <h1>Storage API</h1>
  <p class="sub">Upload file ke MinIO, dapat URL langsung.</p>
  <nav><a href="/">\u2190 Gallery</a><a href="/upload">JSON List</a></nav>

  ${alert}

  <div class="card">
    <h2 style="margin-top:0;border:none">Upload File</h2>
    <form action="/docs/upload" method="POST" enctype="multipart/form-data">
      <div class="form-group">
        <label for="file">File</label>
        <input type="file" id="file" name="file" required/>
      </div>
      <button type="submit">Upload</button>
    </form>
  </div>

  <h2>API Reference</h2>

  <div class="card">
    <h3>GET /</h3>
    <p>Gallery HTML \u2014 menampilkan semua gambar dan PDF yang sudah diupload.</p>
  </div>

  <div class="card">
    <h3>POST /upload</h3>
    <p>Upload file via API. Gunakan <code>multipart/form-data</code> dengan field name <code>file</code>.</p>
    <pre><code>curl -F "file=@foto.jpg" https://your-domain/upload</code></pre>
    <p><strong>Response 201:</strong></p>
    <pre><code>{
  "ok": true,
  "file": {
    "name": "foto.jpg",
    "type": "image/jpeg",
    "size": 204800,
    "key": "upload/public/a1b2c3.jpg",
    "url": "https://cdn.example.com/public/upload/public/a1b2c3.jpg"
  }
}</code></pre>
    <p style="margin-top:.75rem;font-size:.82rem;color:#71717a">Rate limit: 5 request per jam per IP. Response <code>429</code> jika terlampaui.</p>
  </div>

  <div class="card">
    <h3>GET /upload</h3>
    <p>List semua file yang sudah diupload dalam format JSON.</p>
    <pre><code>curl https://your-domain/upload</code></pre>
    <p><strong>Response 200:</strong></p>
    <pre><code>{
  "ok": true,
  "total": 2,
  "files": [
    {
      "key": "upload/public/a1b2c3.jpg",
      "url": "https://cdn.example.com/public/upload/public/a1b2c3.jpg",
      "size": 204800,
      "lastModified": "2026-03-09T10:00:00.000Z"
    }
  ]
}</code></pre>
  </div>

  <h2>Konfigurasi</h2>
  <div class="card">
    <table>
      <thead><tr><th>Variabel</th><th>Default</th><th>Keterangan</th></tr></thead>
      <tbody>
        <tr><td><code>MAX_FILE_SIZE</code></td><td><code>10485760</code></td><td>Maks ukuran file (bytes). Default 10MB.</td></tr>
        <tr><td><code>ALLOWED_TYPES</code></td><td><em>kosong</em></td><td>MIME types diizinkan, pisah koma. Kosong = semua.</td></tr>
      </tbody>
    </table>
  </div>
</body>
</html>`);
});

// POST /docs/upload — handle web form upload
app.post('/docs/upload', uploadRateLimit, formParser.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.redirect('/docs?error=no_file');
    }
    const { upload } = await import('#services/storage.js');
    const { key, url } = await upload(req.file.buffer, req.file.originalname, req.file.mimetype);
    return res.redirect(`/docs?success=1&key=${encodeURIComponent(key)}&url=${encodeURIComponent(url)}`);
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
