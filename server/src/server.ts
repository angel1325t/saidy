import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './lib/env.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { circulationRouter } from './routes/circulation.js';
import { digitalRouter } from './routes/digital.js';
import { adminRouter } from './routes/admin.js';

export function createServer() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true
    })
  );
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'saidy-server' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/circulation', circulationRouter);
  app.use('/api/digital', digitalRouter);
  app.use('/api/admin', adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ message: 'Route not found' });
  });

  return app;
}
