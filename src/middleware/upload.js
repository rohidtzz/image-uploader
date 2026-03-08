import multer from 'multer';
import { upload as s3Upload } from '#services/storage.js';

const MAX_SIZE = parseInt(process.env.MAX_FILE_SIZE ?? 10 * 1024 * 1024);
const ALLOWED = process.env.ALLOWED_TYPES
  ? process.env.ALLOWED_TYPES.split(',').map((t) => t.trim())
  : null; // null = allow all

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED || ALLOWED.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error(`File type not allowed: ${file.mimetype}`);
      err.status = 415;
      cb(err);
    }
  },
});

/**
 * Middleware: parse multipart, upload to S3, attach result to req.file
 * Usage: router.post('/upload', uploadMiddleware, handler)
 */
const uploadMiddleware = [
  multerInstance.single('file'),
  async (req, res, next) => {
    if (!req.file) {
      const err = new Error('No file uploaded. Use field name "file".');
      err.status = 400;
      return next(err);
    }
    try {
      const { key, url } = await s3Upload(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
      req.file.key = key;
      req.file.url = url;
      next();
    } catch (err) {
      next(err);
    }
  },
];

export default uploadMiddleware;

