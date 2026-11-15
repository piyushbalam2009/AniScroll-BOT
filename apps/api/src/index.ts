import express from 'express';
import cookieParser from 'cookie-parser';
import { createApiV1Router, registerOAuthCallbackRoute } from './routes/v1';

export function createApiApp(options?: { oauthFetch?: typeof fetch }): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (req.path === '/api/v1/webhooks/aniscroll') {
      next();
    } else {
      express.json({ limit: '1mb' })(req, res, next);
    }
  });

  app.use('/api/v1', createApiV1Router());
  registerOAuthCallbackRoute(app, options?.oauthFetch ? { fetchImpl: options.oauthFetch } : undefined);
  return app;
}
