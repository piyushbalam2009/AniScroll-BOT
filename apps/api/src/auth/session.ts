import crypto from 'node:crypto';
import { CookieOptions, NextFunction, Request, Response } from 'express';
import { appConfig, AppError, ERROR_CODES } from '../../../../packages/shared/src';

export interface SessionPayload {
  userId: string;
  username: string;
  avatar: string | null;
  mode: 'discord_oauth' | 'local_sandbox';
  csrfToken: string;
  guildIds: string[];
  issuedAt: number;
  expiresAt: number;
}

const SESSION_COOKIE_NAME = 'aniscroll_session';
const OAUTH_STATE_COOKIE = 'aniscroll_oauth_state';

function sign(data: string): string {
  return crypto
    .createHmac('sha256', appConfig.SESSION_SECRET)
    .update(data)
    .digest('base64url');
}

export function encodeSession(payload: SessionPayload): string {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${raw}.${sign(raw)}`;
}

export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [raw, sig] = token.split('.');
  const expected = sign(raw);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as SessionPayload;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getIframeCookieOptions(maxAgeMs = 7 * 24 * 3600 * 1000): CookieOptions {
  const isHttps = appConfig.APP_URL.startsWith('https://') || appConfig.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function setSessionCookie(res: Response, payload: SessionPayload) {
  res.cookie(SESSION_COOKIE_NAME, encodeSession(payload), getIframeCookieOptions());
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, { ...getIframeCookieOptions(0), maxAge: 0 });
}

export function setOAuthStateCookie(res: Response, state: string) {
  res.cookie(OAUTH_STATE_COOKIE, state, getIframeCookieOptions(10 * 60 * 1000));
}

export function clearOAuthStateCookie(res: Response) {
  res.clearCookie(OAUTH_STATE_COOKIE, { ...getIframeCookieOptions(0), maxAge: 0 });
}

export function readOAuthStateCookie(req: Request): string | undefined {
  return req.cookies?.[OAUTH_STATE_COOKIE];
}

export function verifyOAuthState(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function getSessionFromRequest(req: Request): SessionPayload | null {
  return decodeSession(req.cookies?.[SESSION_COOKIE_NAME]);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ ok: false, code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required.' });
    return;
  }
  (req as any).session = session;
  next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const session: SessionPayload | undefined = (req as any).session;
  const headerToken = req.header('x-csrf-token');
  if (!session || !headerToken || headerToken !== session.csrfToken) {
    res.status(403).json({ ok: false, code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid CSRF token.' });
    return;
  }
  next();
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.replace(/^sha256=/i, '');
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const DISCORD_OAUTH_CALLBACK_ROUTE = '/auth/callback';

const DISCORD_HOSTNAMES = new Set([
  'discord.com',
  'www.discord.com',
  'discordapp.com',
  'ptb.discord.com',
  'canary.discord.com',
]);

// ViewChannel, Kick, Ban, ManageChannels, ManageRoles, SendMessages, SendMessagesInThreads,
// ManageMessages, EmbedLinks, AttachFiles, ReadMessageHistory, AddReactions, Connect, Speak, ModerateMembers
const ANISCROLL_BOT_PERMISSIONS = '1374661266518';

export interface RedirectUriResolution {
  redirectUri: string;
  source: 'env' | 'app_url_fallback';
  configuredValue: string | null;
  warning: string | null;
}

export function resolveDiscordRedirectUri(): RedirectUriResolution {
  const baseUrl =
    (process.env.APP_URL ?? appConfig.APP_URL).trim().replace(/\/+$/, '') || 'http://localhost:3000';
  const fallback = `${baseUrl}${DISCORD_OAUTH_CALLBACK_ROUTE}`;
  const rawConfigured = (process.env.DISCORD_REDIRECT_URI ?? appConfig.DISCORD_REDIRECT_URI ?? '').trim();

  if (!rawConfigured) {
    return {
      redirectUri: fallback,
      source: 'app_url_fallback',
      configuredValue: null,
      warning: null,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawConfigured);
  } catch {
    return {
      redirectUri: fallback,
      source: 'app_url_fallback',
      configuredValue: rawConfigured,
      warning: `DISCORD_REDIRECT_URI is not a valid URL. Falling back to ${fallback}.`,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      redirectUri: fallback,
      source: 'app_url_fallback',
      configuredValue: rawConfigured,
      warning: `DISCORD_REDIRECT_URI must use http:// or https://. Falling back to ${fallback}.`,
    };
  }

  if (DISCORD_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
    return {
      redirectUri: fallback,
      source: 'app_url_fallback',
      configuredValue: rawConfigured,
      warning: `DISCORD_REDIRECT_URI was set to a Discord URL (${parsed.hostname}) instead of the application callback route (${DISCORD_OAUTH_CALLBACK_ROUTE}). Remove the bot invite URL from DISCORD_REDIRECT_URI and register ${fallback} in Discord Developer Portal.`,
    };
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath !== DISCORD_OAUTH_CALLBACK_ROUTE) {
    return {
      redirectUri: fallback,
      source: 'app_url_fallback',
      configuredValue: rawConfigured,
      warning: `DISCORD_REDIRECT_URI path "${normalizedPath}" does not match the implemented callback route "${DISCORD_OAUTH_CALLBACK_ROUTE}". Falling back to ${fallback}.`,
    };
  }

  if (parsed.search || parsed.hash) {
    return {
      redirectUri: fallback,
      source: 'app_url_fallback',
      configuredValue: rawConfigured,
      warning: `DISCORD_REDIRECT_URI must not contain query parameters or hash fragments. Falling back to ${fallback}.`,
    };
  }

  return {
    redirectUri: `${parsed.origin}${DISCORD_OAUTH_CALLBACK_ROUTE}`,
    source: 'env',
    configuredValue: rawConfigured,
    warning: null,
  };
}

export function getDiscordRedirectUri(): string {
  return resolveDiscordRedirectUri().redirectUri;
}

export function buildDiscordOAuthUrl(
  state: string,
  redirectUri: string = getDiscordRedirectUri(),
  clientId?: string
): string {
  const resolvedClientId = (clientId || appConfig.DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || '').trim();
  const resolvedSecret = (appConfig.DISCORD_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET || '').trim();
  if (!resolvedClientId || (!appConfig.isOAuthConfigured && !resolvedSecret)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'Discord OAuth2 credentials (DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET) are not configured.',
      503
    );
  }
  const params = new URLSearchParams({
    client_id: resolvedClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export function buildDiscordBotInviteUrl(
  clientId: string = appConfig.DISCORD_CLIENT_ID,
  guildId?: string
): string | null {
  const resolvedClientId = (clientId || appConfig.DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || '').trim();
  if (!resolvedClientId) return null;

  const params = new URLSearchParams({
    client_id: resolvedClientId,
    permissions: ANISCROLL_BOT_PERMISSIONS,
    scope: 'bot applications.commands',
  });
  if (guildId) {
    params.set('guild_id', guildId);
    params.set('disable_guild_select', 'false');
  }
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export interface DiscordOAuthGuild {
  id: string;
  name: string;
  icon: string | null;
}

export interface DiscordOAuthExchangeResult {
  user: {
    id: string;
    username: string;
    avatar: string | null;
  };
  manageableGuilds: DiscordOAuthGuild[];
}

export async function exchangeDiscordOAuthCode(params: {
  code: string;
  redirectUri: string;
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
}): Promise<DiscordOAuthExchangeResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const clientId = (params.clientId ?? (appConfig.DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || '')).trim();
  const clientSecret = (params.clientSecret ?? (appConfig.DISCORD_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET || '')).trim();

  if (!clientId || !clientSecret) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'Discord OAuth2 credentials (DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET) are not configured.',
      503
    );
  }

  const tokenRes = await fetchImpl('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  });

  const tokenData = (await tokenRes.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!tokenRes.ok || !tokenData?.access_token) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Discord OAuth2 token exchange failed (${tokenData?.error || tokenRes.status}).`,
      502
    );
  }

  const authHeader = { Authorization: `Bearer ${tokenData.access_token}` };
  const [userRes, guildsRes] = await Promise.all([
    fetchImpl('https://discord.com/api/users/@me', { headers: authHeader }),
    fetchImpl('https://discord.com/api/users/@me/guilds', { headers: authHeader }),
  ]);

  if (!userRes.ok) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Failed to fetch Discord user profile.', 502);
  }

  const userJson = (await userRes.json()) as { id?: string; username?: string; global_name?: string; avatar?: string | null };
  if (!userJson?.id || !userJson?.username) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Discord user profile response was incomplete.', 502);
  }

  const guildsJson = guildsRes.ok ? ((await guildsRes.json().catch(() => [])) as any[]) : [];
  const manageableGuilds: DiscordOAuthGuild[] = Array.isArray(guildsJson)
    ? guildsJson
        .filter((g) => (BigInt(g.permissions || '0') & 0x20n) === 0x20n || Boolean(g.owner))
        .map((g) => ({
          id: String(g.id),
          name: String(g.name || 'Unnamed Server'),
          icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
        }))
    : [];

  return {
    user: {
      id: String(userJson.id),
      username: String(userJson.global_name || userJson.username),
      avatar: userJson.avatar ? `https://cdn.discordapp.com/avatars/${userJson.id}/${userJson.avatar}.png` : null,
    },
    manageableGuilds,
  };
}

