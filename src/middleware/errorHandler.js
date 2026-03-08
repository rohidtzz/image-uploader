// Centralized error handler — mount as last middleware in index.js
const errorHandler = (err, req, res, next) => {
  const status = err.status ?? 500;
  const message = err.message ?? 'Internal Server Error';

  if (process.env.NODE_ENV !== 'production') {
    console.error(`[${req.method}] ${req.path} →`, err);
  }

  res.status(status).json({ error: message });
};

export default errorHandler;
