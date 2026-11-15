import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { appConfig, createModuleLogger } from './packages/shared/src';
import { createApiApp } from './apps/api/src';
import { getBotRuntime } from './apps/bot/src';
import { getCacheService } from './apps/bot/src/services/cache/CacheService';

const log = createModuleLogger('Server');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap() {
  const app = createApiApp();

  if (appConfig.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const bot = getBotRuntime();
  await bot.start();

  const server = app.listen(appConfig.PORT, '0.0.0.0', () => {
    log.info({ port: appConfig.PORT, env: appConfig.NODE_ENV }, 'AniScroll Bot server listening');
  });

  const shutdown = async () => {
    log.info('Shutting down AniScroll Bot gracefully...');
    server.close();
    await bot.stop();
    await getCacheService().close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  log.error({ err: String(err) }, 'Fatal server startup error');
  process.exit(1);
});
