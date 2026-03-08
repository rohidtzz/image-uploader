import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import uploadMiddleware from '#middleware/upload.js';
import errorHandler from '#middleware/errorHandler.js';

const app = express();
const port = process.env.PORT ?? 3000;

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

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
app.post('/upload', uploadMiddleware, (req, res) => {
  const { originalname, mimetype, size, key, url } = req.file;
  res.status(201).json({
    ok: true,
    file: { name: originalname, type: mimetype, size, key, url },
  });
});

// DELETE /upload/:key — delete a file from storage
app.delete('/upload/*key', async (req, res, next) => {
  try {
    const { remove } = await import('#services/storage.js');
    await remove(req.params.key);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Storage API running on port ${port}`);
});
