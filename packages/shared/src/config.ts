import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().default('http://localhost:3000'),
  DASHBOARD_URL: z.string().optional(),

  DISCORD_TOKEN: z.string().optional().default(''),
  DISCORD_CLIENT_ID: z.string().optional().default(''),
  DISCORD_CLIENT_SECRET: z.string().optional().default(''),
  DISCORD_REDIRECT_URI: z.string().optional().default(''),
  DISCORD_OWNER_IDS: z.string().optional().default(''),
  DISCORD_DEV_GUILD_ID: z.string().optional().default(''),
  DISCORD_SUPPORT_SERVER_URL: z.string().default('https://discord.gg/aniscroll'),
  DISCORD_PRIVILEGED_INTENTS: z.enum(['auto', 'true', 'false']).default('auto'),

  DATABASE_URL: z.string().optional().default(''),
  SQLITE_DB_PATH: z.string().default('./data/aniscroll.db'),

  REDIS_URL: z.string().optional().default(''),
  CACHE_PREFIX: z.string().default('aniscroll:v1'),
  CACHE_TTL_SEARCH_SECONDS: z.coerce.number().int().positive().default(300),
  CACHE_TTL_DETAILS_SECONDS: z.coerce.number().int().positive().default(1800),
  CACHE_TTL_EPISODES_SECONDS: z.coerce.number().int().positive().default(900),
  CACHE_TTL_TRENDING_SECONDS: z.coerce.number().int().positive().default(600),
  CACHE_TTL_SEASONAL_SECONDS: z.coerce.number().int().positive().default(3600),
  CACHE_TTL_GENRES_SECONDS: z.coerce.number().int().positive().default(86400),

  HOSHIKA_BASE_URL: z.string().default('https://hoshika.app/api/v1'),
  HOSHIKA_API_KEY: z.string().optional().default(''),

  ANISCROLL_API_BASE_URL: z.string().default('https://api.aniscroll.in'),
  ANISCROLL_WEB_BASE_URL: z.string().default('https://aniscroll.in'),
  ANISCROLL_WEBSITE_API_URL: z.string().default('https://aniscroll.in'),
  ANISCROLL_BOT_API_SECRET: z.string().optional().default(''),
  ANISCROLL_WEBHOOK_SECRET: z.string().optional().default(''),

  LAVALINK_HOST: z.string().optional().default('lavalink.cloudewave.in'),
  LAVALINK_PORT: z.preprocess(
    (v) => (v === '' || v === undefined ? 2347 : v),
    z.coerce.number().int().positive()
  ),
  LAVALINK_PASSWORD: z.string().optional().default(''),
  LAVALINK_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true')
    .default(false),

  SPOTIFY_CLIENT_ID: z.string().optional().default(''),
  SPOTIFY_CLIENT_SECRET: z.string().optional().default(''),
  YOUTUBE_OAUTH_REFRESH_TOKEN: z.string().optional().default(''),

  SESSION_SECRET: z.string().optional().default('aniscroll-dev-session-secret-change-in-production-32chars'),

  ANISCROLL_STATUS_MONITOR_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false')
    .default(true),
  ANISCROLL_STATUS_CHECK_INTERVAL: z.coerce.number().int().positive().default(60),
  ANISCROLL_STATUS_TIMEOUT: z.coerce.number().int().positive().default(10000),
  ANISCROLL_STATUS_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  ANISCROLL_STATUS_RECOVERY_THRESHOLD: z.coerce.number().int().positive().default(2),

  ANISCROLL_WEBSITE_URL: z.string().default('https://aniscroll.in'),
  ANISCROLL_STREAMING_API_URL: z.string().default('https://anivault-scraper-five.vercel.app'),
  ANISCROLL_HOSHIKA_API_URL: z.string().default('https://hoshika.app/api/v1'),

  ANISCROLL_STATUS_CHANNEL_ID: z.string().optional().default(''),
  ANISCROLL_UPDATES_CHANNEL_ID: z.string().optional().default(''),
  ANISCROLL_STATUS_TIMEZONE: z.string().default('Asia/Kolkata'),
});

export type AppConfig = z.infer<typeof envSchema> & {
  ownerIds: string[];
  isDiscordConfigured: boolean;
  isOAuthConfigured: boolean;
  isRedisConfigured: boolean;
  isLavalinkConfigured: boolean;
  isSpotifyConfigured: boolean;
  isYouTubeOAuthConfigured: boolean;
  isWebsiteWatchlistConfigured: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const ownerIds = parsed.DISCORD_OWNER_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const lavalinkHost = (parsed.LAVALINK_HOST || 'lavalink.cloudewave.in').trim();
  const lavalinkPort = Number(parsed.LAVALINK_PORT || 2347);
  const lavalinkPassword = (parsed.LAVALINK_PASSWORD || '').trim();
  const lavalinkSecure = Boolean(parsed.LAVALINK_SECURE ?? false);
  const websiteApiUrl = (parsed.ANISCROLL_WEBSITE_API_URL || 'https://aniscroll.in').trim().replace(/\/+$/, '');

  return {
    ...parsed,
    ANISCROLL_WEBSITE_API_URL: websiteApiUrl,
    LAVALINK_HOST: lavalinkHost,
    LAVALINK_PORT: lavalinkPort,
    LAVALINK_PASSWORD: lavalinkPassword,
    LAVALINK_SECURE: lavalinkSecure,
    DASHBOARD_URL: parsed.DASHBOARD_URL || parsed.APP_URL,
    ownerIds,
    isDiscordConfigured: Boolean(parsed.DISCORD_TOKEN && parsed.DISCORD_TOKEN.length > 20),
    isOAuthConfigured: Boolean(parsed.DISCORD_CLIENT_ID && parsed.DISCORD_CLIENT_SECRET),
    isRedisConfigured: Boolean(parsed.REDIS_URL && parsed.REDIS_URL.startsWith('redis')),
    isLavalinkConfigured: Boolean(lavalinkHost && lavalinkPort),
    isSpotifyConfigured: Boolean(parsed.SPOTIFY_CLIENT_ID.trim() && parsed.SPOTIFY_CLIENT_SECRET.trim()),
    isYouTubeOAuthConfigured: Boolean(parsed.YOUTUBE_OAUTH_REFRESH_TOKEN.trim()),
    isWebsiteWatchlistConfigured: Boolean(websiteApiUrl && parsed.ANISCROLL_BOT_API_SECRET.trim()),
  };
}

export const appConfig = loadConfig();
