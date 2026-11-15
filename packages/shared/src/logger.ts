import pino from 'pino';

export const logger = pino({
  name: 'aniscroll-bot',
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.token',
      '*.password',
      '*.apiKey',
      '*.secret',
      'DISCORD_TOKEN',
      'DISCORD_CLIENT_SECRET',
      'HOSHIKA_API_KEY',
      'LAVALINK_PASSWORD',
      'SESSION_SECRET',
    ],
    censor: '[REDACTED]',
  },
});

export function createModuleLogger(moduleName: string) {
  return logger.child({ module: moduleName });
}
