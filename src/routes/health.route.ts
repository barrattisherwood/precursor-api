import { Router } from 'express';
import mongoose from 'mongoose';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'ok' : 'error';
  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    db: dbStatus,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
