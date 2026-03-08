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

// Log to file (combined) + console (dev)
app.use(morgan('combined', { stream: logStream }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limit: max 5 uploads per IP per hour
const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many uploads from this IP, please try again after 1 hour.' },
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
