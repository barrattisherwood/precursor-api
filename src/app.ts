import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import * as Sentry from '@sentry/node';
import { clustersRouter } from './routes/clusters.route';
import { elementsRouter } from './routes/elements.route';
import { economyRouter } from './routes/economy.route';
import { healthRouter } from './routes/health.route';
import { attributionHeader } from './middleware/attribution';
import { rateLimiter } from './middleware/rate-limit';
import { logger } from './logger';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
  environment: process.env.NODE_ENV,
});

export async function connectDb(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI!);
  logger.info('MongoDB connected');
}

const ALLOWED_ORIGINS = [
  'https://precursor.nexus',
  'https://www.precursor.nexus',
  ...(process.env.NODE_ENV === 'development' ? ['http://localhost:4200'] : []),
];

const app = express();

app.use(express.json());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    methods: ['GET'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  }),
);

app.use(attributionHeader);
app.use(rateLimiter);

app.use('/health', healthRouter);
app.use('/api/clusters', clustersRouter);
app.use('/api/elements', elementsRouter);
app.use('/api/economy', economyRouter);

Sentry.setupExpressErrorHandler(app);

process.on('unhandledRejection', reason => {
  Sentry.captureException(reason);
  logger.error({ reason }, 'Unhandled rejection');
});

const PORT = process.env.PORT ?? 3000;

if (require.main === module) {
  connectDb()
    .then(() => app.listen(PORT, () => logger.info({ port: PORT }, 'API running')))
    .catch(err => {
      logger.error({ err }, 'MongoDB connection failed');
      process.exit(1);
    });
}

export default app;
