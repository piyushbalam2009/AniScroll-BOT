import {
  appConfig,
  AppError,
  buildAniScrollAnimeUrl,
  createModuleLogger,
  ERROR_CODES,
  normalizeHoshikaShortId,
  normalizeWebsiteWatchStatus,
  WEBSITE_WATCH_STATUSES,
  WebsiteWatchlistItem,
  WebsiteWatchlistStats,
  WebsiteWatchStatus,
} from '../../../../../packages/shared/src';

const log = createModuleLogger('WebsiteWatchlistService');

export const UNLINKED_DISCORD_MESSAGE =
  'Your Discord account is not connected to AniScroll. Log in at https://aniscroll.in, open Account Settings, and connect Discord to access your website watchlist.';

export const WEBSITE_SYNC_UNAVAILABLE_MESSAGE =
  'Watchlist synchronization with AniScroll (https://aniscroll.in) is temporarily unavailable. Please try again shortly.';

export const BOT_WATCHLIST_API_PREFIX = '/api/bot/v1/watchlist';

export interface WebsiteWatchlistServiceOptions {
  baseUrl?: string;
  apiSecret?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  allowInsecureLocalhost?: boolean;
}

export interface AddWebsiteWatchlistInput {
  hoshikaId?: number | string | null;
  shortId?: number;
  title: string;
  coverImage?: string | null;
  poster?: string | null;
  format?: string | null;
  rating?: number | null;
  seasonYear?: number | null;
  status?: WebsiteWatchStatus;
}

export interface UpdateWebsiteWatchlistInput {
  status?: WebsiteWatchStatus;
  episodesWatched?: number;
  rating?: number | null;
  notes?: string | null;
}

export interface ListWebsiteWatchlistFilters {
  status?: WebsiteWatchStatus;
  sort?: 'title' | 'date' | 'updated' | 'rating';
  genre?: string;
  query?: string;
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === '127.0.0.1' || lower === 'localhost' || lower === '::1' || lower === '[::1]';
}

function normalizeTimestampValue(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(raw).toISOString();
  }
  if (raw && typeof raw === 'object') {
    const seconds =
      typeof (raw as any).seconds === 'number'
        ? (raw as any).seconds
        : typeof (raw as any)._seconds === 'number'
          ? (raw as any)._seconds
          : null;
    if (seconds !== null) {
      return new Date(seconds * 1000).toISOString();
    }
  }
  return null;
}

export function validateDiscordSnowflake(discordUserId: string): string {
  const clean = (discordUserId || '').trim();
  if (!/^\d{17,22}$/.test(clean)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid Discord user identity.', 400);
  }
  return clean;
}

export function normalizeWebsiteWatchlistItem(
  raw: any,
  expectedDiscordUserId?: string,
  webBaseUrl: string = appConfig.ANISCROLL_WEB_BASE_URL
): WebsiteWatchlistItem {
  if (!raw || typeof raw !== 'object') {
    throw new AppError(
      ERROR_CODES.WEBSITE_API_UNAVAILABLE,
      'Received an invalid watchlist record from AniScroll website API.',
      502
    );
  }

  const returnedDiscordId =
    raw.discordUserId ?? raw.discord_user_id ?? raw.discordId ?? raw.ownerDiscordId ?? null;
  if (
    expectedDiscordUserId &&
    typeof returnedDiscordId === 'string' &&
    returnedDiscordId.trim().length > 0 &&
    returnedDiscordId.trim() !== expectedDiscordUserId
  ) {
    throw new AppError(
      ERROR_CODES.USER_MISSING_PERMISSIONS,
      'Cross-user watchlist access is forbidden.',
      403
    );
  }

  const shortId = normalizeHoshikaShortId(
    raw.shortId ??
      raw.hoshikaShortId ??
      raw.hoshika_short_id ??
      raw.hoshikaId ??
      raw.hoshika_id ??
      raw.animeShortId ??
      raw.animeId ??
      raw.id
  );
  if (!shortId) {
    throw new AppError(
      ERROR_CODES.INVALID_ANIME_ID,
      'Watchlist record from AniScroll website API is missing a valid Hoshika shortId.',
      502
    );
  }

  const status = normalizeWebsiteWatchStatus(raw.status) ?? 'plan_to_watch';
  const episodesRaw =
    raw.episodesWatched ?? raw.episodes_watched ?? raw.progress ?? raw.watchedEpisodes ?? 0;
  const episodesWatched =
    typeof episodesRaw === 'number' && Number.isFinite(episodesRaw) && episodesRaw >= 0
      ? Math.floor(episodesRaw)
      : 0;

  const totalRaw =
    raw.totalEpisodes ?? raw.total_episodes ?? raw.episodes ?? raw.episodeCount ?? null;
  const totalEpisodes =
    typeof totalRaw === 'number' && Number.isFinite(totalRaw) && totalRaw > 0
      ? Math.floor(totalRaw)
      : null;

  const ratingRaw =
    raw.rating ?? raw.score ?? raw.userRating ?? raw.personalRating ?? raw.personal_rating ?? null;
  const rating =
    typeof ratingRaw === 'number' && Number.isFinite(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 10
      ? Number(ratingRaw)
      : null;

  const genresRaw = Array.isArray(raw.genres)
    ? raw.genres
    : Array.isArray(raw.genresSnapshot)
      ? raw.genresSnapshot
      : [];
  const genres = genresRaw
    .map((g: unknown) => {
      if (typeof g === 'string') return g.trim();
      if (g && typeof g === 'object' && 'name' in g && typeof (g as { name?: unknown }).name === 'string') {
        return (g as { name: string }).name.trim();
      }
      return '';
    })
    .filter(Boolean);

  const title = String(
    raw.title ||
      raw.titleEnglish ||
      raw.title_english ||
      raw.titleSnapshot ||
      raw.titleRomaji ||
      raw.title_romaji ||
      raw.name ||
      `Anime #${shortId}`
  ).trim();

  const aniscrollUrl =
    buildAniScrollAnimeUrl(shortId, webBaseUrl) || `https://aniscroll.in/anime/${shortId}`;

  const seasonYearRaw = raw.seasonYear ?? raw.season_year ?? raw.releaseYear ?? null;
  const seasonYear =
    typeof seasonYearRaw === 'number' && Number.isInteger(seasonYearRaw) && seasonYearRaw > 1900
      ? seasonYearRaw
      : null;

  return {
    id: String(raw.id || shortId),
    discordUserId: typeof returnedDiscordId === 'string' ? returnedDiscordId : expectedDiscordUserId,
    firebaseUid:
      typeof (raw.uid ?? raw.firebaseUid) === 'string' ? (raw.uid ?? raw.firebaseUid) : undefined,
    shortId,
    hoshikaId: String(shortId),
    anilistId: typeof raw.anilistId === 'number' ? raw.anilistId : null,
    malId: typeof raw.malId === 'number' ? raw.malId : null,
    title,
    titleRomaji:
      typeof (raw.titleRomaji ?? raw.title_romaji) === 'string'
        ? (raw.titleRomaji ?? raw.title_romaji)
        : null,
    poster:
      typeof (raw.coverImage ?? raw.poster ?? raw.cover_image ?? raw.posterImage ?? raw.posterSnapshot) ===
      'string'
        ? (raw.coverImage ?? raw.poster ?? raw.cover_image ?? raw.posterImage ?? raw.posterSnapshot)
        : null,
    format: typeof raw.format === 'string' && raw.format.trim() ? raw.format.trim() : null,
    seasonYear,
    genres,
    status,
    episodesWatched,
    totalEpisodes,
    rating,
    notes: typeof (raw.notes ?? raw.note) === 'string' ? (raw.notes ?? raw.note) : null,
    aniscrollUrl,
    createdAt: normalizeTimestampValue(raw.createdAt ?? raw.created_at ?? raw.addedAt),
    updatedAt: normalizeTimestampValue(raw.updatedAt ?? raw.updated_at),
  };
}

export function calculateWebsiteWatchlistStats(
  items: WebsiteWatchlistItem[]
): WebsiteWatchlistStats {
  const byStatus: Record<WebsiteWatchStatus, number> = {
    watching: 0,
    plan_to_watch: 0,
    completed: 0,
    on_hold: 0,
    dropped: 0,
  };

  let totalEpisodesWatched = 0;
  let ratingSum = 0;
  let ratedCount = 0;
  const genreCounts: Record<string, number> = {};

  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    totalEpisodesWatched += Math.max(0, item.episodesWatched || 0);
    if (item.rating !== null && item.rating >= 1 && item.rating <= 10) {
      ratingSum += item.rating;
      ratedCount += 1;
    }
    for (const genre of item.genres || []) {
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    }
  }

  const totalEntries = items.length;
  const completionRate =
    totalEntries > 0 ? Number(((byStatus.completed / totalEntries) * 100).toFixed(1)) : 0;

  return {
    totalEntries,
    totalEpisodesWatched,
    averageRating: ratedCount > 0 ? Number((ratingSum / ratedCount).toFixed(2)) : null,
    ratedCount,
    completionRate,
    byStatus,
    topGenres: Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([genre, count]) => ({ genre, count })),
  };
}

export function findMatchingWatchlistItem(
  items: WebsiteWatchlistItem[],
  query: string
): WebsiteWatchlistItem | null {
  const trimmed = query.trim();
  if (!trimmed || items.length === 0) return null;

  const numericId = normalizeHoshikaShortId(trimmed);
  if (numericId) {
    const byShortId = items.find((item) => item.shortId === numericId);
    if (byShortId) return byShortId;
  }

  const lower = trimmed.toLowerCase();
  const exact = items.find(
    (item) =>
      item.id.toLowerCase() === lower ||
      item.title.toLowerCase() === lower ||
      (item.titleRomaji && item.titleRomaji.toLowerCase() === lower)
  );
  if (exact) return exact;

  const prefix = items.find(
    (item) =>
      item.title.toLowerCase().startsWith(lower) ||
      (item.titleRomaji && item.titleRomaji.toLowerCase().startsWith(lower))
  );
  if (prefix) return prefix;

  const partial = items.find(
    (item) =>
      item.title.toLowerCase().includes(lower) ||
      (item.titleRomaji && item.titleRomaji.toLowerCase().includes(lower))
  );
  return partial ?? null;
}

export function filterAndSortWatchlistItems(
  items: WebsiteWatchlistItem[],
  filters?: ListWebsiteWatchlistFilters
): WebsiteWatchlistItem[] {
  let result = [...items];

  if (filters?.status) {
    result = result.filter((item) => item.status === filters.status);
  }
  if (filters?.genre) {
    const genreLower = filters.genre.trim().toLowerCase();
    result = result.filter((item) =>
      item.genres.some((g) => g.toLowerCase().includes(genreLower))
    );
  }
  if (filters?.query) {
    const qLower = filters.query.trim().toLowerCase();
    const numericId = normalizeHoshikaShortId(filters.query);
    result = result.filter(
      (item) =>
        (numericId !== null && item.shortId === numericId) ||
        item.title.toLowerCase().includes(qLower) ||
        (item.titleRomaji ? item.titleRomaji.toLowerCase().includes(qLower) : false)
    );
  }

  if (filters?.sort === 'title') {
    result.sort((a, b) => a.title.localeCompare(b.title));
  } else if (filters?.sort === 'rating') {
    result.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title));
  } else if (filters?.sort === 'date') {
    result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } else if (filters?.sort === 'updated') {
    result.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  return result;
}

export class WebsiteWatchlistService {
  private readonly baseUrlOverride?: string;
  private readonly apiSecretOverride?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly allowInsecureLocalhost: boolean;

  constructor(options?: WebsiteWatchlistServiceOptions) {
    this.baseUrlOverride = options?.baseUrl;
    this.apiSecretOverride = options?.apiSecret;
    this.timeoutMs = options?.timeoutMs ?? 10_000;
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.allowInsecureLocalhost =
      options?.allowInsecureLocalhost ?? process.env.NODE_ENV === 'test';
  }

  public getDiagnostics() {
    const rawUrl = (this.baseUrlOverride ?? appConfig.ANISCROLL_WEBSITE_API_URL ?? 'https://aniscroll.in').trim();
    const secret = (this.apiSecretOverride ?? appConfig.ANISCROLL_BOT_API_SECRET ?? '').trim();
    return {
      apiUrl: rawUrl.replace(/\/+$/, ''),
      apiPathPrefix: BOT_WATCHLIST_API_PREFIX,
      configured: Boolean(rawUrl && secret),
    };
  }

  private resolveValidatedConfig(): { baseUrl: string; secret: string } {
    const rawUrl = (
      this.baseUrlOverride ??
      appConfig.ANISCROLL_WEBSITE_API_URL ??
      'https://aniscroll.in'
    )
      .trim()
      .replace(/\/+$/, '');
    const secret = (
      this.apiSecretOverride ??
      appConfig.ANISCROLL_BOT_API_SECRET ??
      ''
    ).trim();

    if (!rawUrl) {
      throw new AppError(
        ERROR_CODES.WEBSITE_API_UNAVAILABLE,
        WEBSITE_SYNC_UNAVAILABLE_MESSAGE,
        503
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Configured ANISCROLL_WEBSITE_API_URL is invalid.',
        500
      );
    }

    const isHttps = parsed.protocol === 'https:';
    const isLocalTestHttp =
      parsed.protocol === 'http:' &&
      this.allowInsecureLocalhost &&
      isLoopbackHost(parsed.hostname);

    if (!isHttps && !isLocalTestHttp) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'ANISCROLL_WEBSITE_API_URL must use HTTPS.',
        500
      );
    }

    if (!secret) {
      throw new AppError(
        ERROR_CODES.WEBSITE_API_UNAVAILABLE,
        WEBSITE_SYNC_UNAVAILABLE_MESSAGE,
        503
      );
    }

    return { baseUrl: rawUrl, secret };
  }

  private isUnlinkedPayload(status: number, body: any): boolean {
    if (!body || typeof body !== 'object') return false;
    const code = String(body?.code || body?.errorCode || '').toUpperCase();
    const msg = String(body?.error || body?.message || '').toLowerCase();
    if (body?.linked === false) return true;

    const unlinkedCodes = new Set([
      'DISCORD_NOT_LINKED',
      'ACCOUNT_NOT_LINKED',
      'USER_NOT_LINKED',
      'NO_LINKED_ACCOUNT',
      'DISCORD_UNLINKED',
      'ACCOUNT_UNLINKED',
      'NOT_LINKED',
      'UNLINKED',
      'LINK_EXPIRED',
      'LINK_REVOKED',
      'DISCORD_LINK_EXPIRED',
      'DISCORD_LINK_REVOKED',
    ]);
    if (unlinkedCodes.has(code)) return true;

    if (
      (status === 401 || status === 403 || status === 404) &&
      /(not linked|not connected|unlink|no.*linked.*account|discord.*link.*(missing|expired|revoked)|link.*(expired|revoked))/.test(
        msg
      )
    ) {
      return true;
    }

    return false;
  }

  private isDuplicatePayload(status: number, body: any): boolean {
    const code = String(body?.code || body?.errorCode || '').toUpperCase();
    const msg = String(body?.error || body?.message || '').toLowerCase();
    if (status === 409) return true;
    if (
      code.includes('DUPLICATE') ||
      code === 'ALREADY_EXISTS' ||
      code === 'ALREADY_IN_WATCHLIST' ||
      code === 'ITEM_ALREADY_EXISTS'
    ) {
      return true;
    }
    return /already (in|on) (your )?(website )?watchlist|already exists/.test(msg);
  }

  private async requestJson<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    discordUserId: string,
    options?: {
      body?: Record<string, unknown>;
      isItemEndpoint?: boolean;
      retryOn429?: boolean;
    }
  ): Promise<T> {
    const validDiscordId = validateDiscordSnowflake(discordUserId);
    const { baseUrl, secret } = this.resolveValidatedConfig();
    const url = `${baseUrl}${path}`;
    const body = options?.body;
    const isItemEndpoint = options?.isItemEndpoint ?? false;
    const retryOn429 = options?.retryOn429 ?? true;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${secret}`,
      'X-Discord-User-Id': validDiscordId,
      Accept: 'application/json',
      'User-Agent': 'AniScroll-Discord-Bot/1.0',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      log.warn(
        { method, path, err: err instanceof Error ? err.message : String(err) },
        'AniScroll website watchlist API network error'
      );
      throw new AppError(ERROR_CODES.WEBSITE_API_UNAVAILABLE, WEBSITE_SYNC_UNAVAILABLE_MESSAGE, 503);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      const retryAfterRaw = Number(response.headers.get('retry-after') || '0');
      if (retryOn429 && Number.isFinite(retryAfterRaw) && retryAfterRaw > 0 && retryAfterRaw <= 2) {
        await new Promise((r) => setTimeout(r, retryAfterRaw * 1000));
        return this.requestJson<T>(method, path, validDiscordId, {
          body,
          isItemEndpoint,
          retryOn429: false,
        });
      }
      throw new AppError(
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
        'AniScroll website API rate limit reached. Please try again in a few seconds.',
        429
      );
    }

    const contentType = response.headers.get('content-type') || '';
    let jsonBody: any = null;
    if (contentType.includes('application/json') || response.status !== 204) {
      const rawText = await response.text().catch(() => '');
      if (rawText) {
        try {
          jsonBody = JSON.parse(rawText);
        } catch {
          jsonBody = null;
        }
      }
    }

    if (!response.ok) {
      if (this.isUnlinkedPayload(response.status, jsonBody)) {
        throw new AppError(ERROR_CODES.DISCORD_NOT_LINKED, UNLINKED_DISCORD_MESSAGE, 403);
      }

      if (this.isDuplicatePayload(response.status, jsonBody)) {
        throw new AppError(
          ERROR_CODES.DUPLICATE_WATCHLIST,
          jsonBody?.error ||
            jsonBody?.message ||
            'This anime is already in your AniScroll website watchlist.',
          409
        );
      }

      if (response.status === 401 || response.status === 403) {
        log.error(
          { method, path, status: response.status, code: jsonBody?.code },
          'AniScroll website watchlist API rejected bot authentication'
        );
        throw new AppError(
          ERROR_CODES.WEBSITE_API_UNAVAILABLE,
          WEBSITE_SYNC_UNAVAILABLE_MESSAGE,
          503
        );
      }

      if (response.status === 404) {
        // Only treat HTTP 404 as "entry not found" on item endpoints returning valid JSON.
        // Never treat a missing route (HTML 404) or a POST/collection 404 as "anime not found in watchlist".
        if (isItemEndpoint && method !== 'POST' && jsonBody && typeof jsonBody === 'object') {
          throw new AppError(
            ERROR_CODES.ANIME_NOT_FOUND,
            jsonBody?.error ||
              jsonBody?.message ||
              'That anime was not found in your AniScroll website watchlist.',
            404
          );
        }

        log.error(
          { method, path, status: response.status, hasJson: Boolean(jsonBody) },
          'AniScroll website watchlist endpoint returned unexpected 404'
        );
        throw new AppError(
          ERROR_CODES.WEBSITE_API_UNAVAILABLE,
          WEBSITE_SYNC_UNAVAILABLE_MESSAGE,
          503
        );
      }

      if (response.status === 400 || response.status === 422) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          jsonBody?.error ||
            jsonBody?.message ||
            'The AniScroll website rejected this watchlist update.',
          400
        );
      }

      log.warn(
        { method, path, status: response.status },
        'AniScroll website watchlist API returned server error'
      );
      throw new AppError(ERROR_CODES.WEBSITE_API_UNAVAILABLE, WEBSITE_SYNC_UNAVAILABLE_MESSAGE, 503);
    }

    if (response.status !== 204 && !jsonBody) {
      throw new AppError(ERROR_CODES.WEBSITE_API_UNAVAILABLE, WEBSITE_SYNC_UNAVAILABLE_MESSAGE, 503);
    }

    if (jsonBody?.linked === false) {
      throw new AppError(ERROR_CODES.DISCORD_NOT_LINKED, UNLINKED_DISCORD_MESSAGE, 403);
    }

    return (jsonBody ?? { ok: true }) as T;
  }

  public async listWatchlist(
    discordUserId: string,
    filters?: ListWebsiteWatchlistFilters
  ): Promise<WebsiteWatchlistItem[]> {
    const validDiscordId = validateDiscordSnowflake(discordUserId);
    const params = new URLSearchParams({ discordUserId: validDiscordId });
    if (filters?.status) params.set('status', filters.status);
    if (filters?.query) params.set('q', filters.query);
    if (filters?.sort) params.set('sort', filters.sort);

    const payload = await this.requestJson<any>(
      'GET',
      `${BOT_WATCHLIST_API_PREFIX}?${params.toString()}`,
      validDiscordId
    );

    const rawItems = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.watchlist)
        ? payload.watchlist
        : Array.isArray(payload?.entries)
          ? payload.entries
          : Array.isArray(payload?.data)
            ? payload.data
            : [];

    const normalized = rawItems.map((raw: any) =>
      normalizeWebsiteWatchlistItem(raw, validDiscordId)
    );

    return filterAndSortWatchlistItems(normalized, filters);
  }

  public async getEntry(
    discordUserId: string,
    hoshikaShortId: number
  ): Promise<WebsiteWatchlistItem | null> {
    const validDiscordId = validateDiscordSnowflake(discordUserId);
    const validShortId = normalizeHoshikaShortId(hoshikaShortId);
    if (!validShortId) {
      throw new AppError(ERROR_CODES.INVALID_ANIME_ID, 'A valid Hoshika shortId is required.', 400);
    }

    const params = new URLSearchParams({ discordUserId: validDiscordId });
    try {
      const payload = await this.requestJson<any>(
        'GET',
        `${BOT_WATCHLIST_API_PREFIX}/${encodeURIComponent(String(validShortId))}?${params.toString()}`,
        validDiscordId,
        { isItemEndpoint: true }
      );
      const rawItem = payload?.item ?? payload?.entry ?? payload?.data ?? payload;
      return normalizeWebsiteWatchlistItem(rawItem, validDiscordId);
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.ANIME_NOT_FOUND) {
        return null;
      }
      throw err;
    }
  }

  public async addEntry(
    discordUserId: string,
    input: AddWebsiteWatchlistInput
  ): Promise<WebsiteWatchlistItem> {
    const validDiscordId = validateDiscordSnowflake(discordUserId);
    const validShortId = normalizeHoshikaShortId(input.hoshikaId ?? input.shortId);
    if (!validShortId) {
      throw new AppError(ERROR_CODES.INVALID_ANIME_ID, 'A valid Hoshika shortId is required.', 400);
    }

    const status: WebsiteWatchStatus =
      normalizeWebsiteWatchStatus(input.status) ?? 'plan_to_watch';
    const coverImage = input.coverImage ?? input.poster ?? null;
    const format = typeof input.format === 'string' && input.format.trim() ? input.format.trim() : null;
    const rating =
      typeof input.rating === 'number' &&
      Number.isFinite(input.rating) &&
      input.rating >= 1 &&
      input.rating <= 10
        ? Number(input.rating)
        : null;
    const seasonYear =
      typeof input.seasonYear === 'number' &&
      Number.isInteger(input.seasonYear) &&
      input.seasonYear > 1900
        ? input.seasonYear
        : null;

    const payload = await this.requestJson<any>(
      'POST',
      BOT_WATCHLIST_API_PREFIX,
      validDiscordId,
      {
        body: {
          discordUserId: validDiscordId,
          hoshikaId: validShortId,
          title: input.title,
          coverImage,
          format,
          rating,
          seasonYear,
          status,
        },
      }
    );

    const rawItem = payload?.item ?? payload?.entry ?? payload?.data ?? payload;
    return normalizeWebsiteWatchlistItem(rawItem, validDiscordId);
  }

  public async updateEntry(
    discordUserId: string,
    shortId: number,
    patch: UpdateWebsiteWatchlistInput
  ): Promise<{ item: WebsiteWatchlistItem; autoCompleted: boolean }> {
    const validDiscordId = validateDiscordSnowflake(discordUserId);
    const validShortId = normalizeHoshikaShortId(shortId);
    if (!validShortId) {
      throw new AppError(ERROR_CODES.INVALID_ANIME_ID, 'A valid Hoshika shortId is required.', 400);
    }

    const body: Record<string, unknown> = {
      discordUserId: validDiscordId,
      hoshikaId: validShortId,
    };

    if (patch.status !== undefined) {
      const normalizedStatus = normalizeWebsiteWatchStatus(patch.status);
      if (!normalizedStatus || !(WEBSITE_WATCH_STATUSES as readonly string[]).includes(normalizedStatus)) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid website watchlist status.', 400);
      }
      body.status = normalizedStatus;
    }

    if (patch.episodesWatched !== undefined) {
      if (!Number.isInteger(patch.episodesWatched) || patch.episodesWatched < 0) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'Episodes watched must be a non-negative integer.',
          400
        );
      }
      body.episodesWatched = patch.episodesWatched;
    }

    if (patch.rating !== undefined) {
      if (
        patch.rating !== null &&
        (!Number.isInteger(patch.rating) || patch.rating < 1 || patch.rating > 10)
      ) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Rating must be between 1 and 10.', 400);
      }
      body.rating = patch.rating;
    }

    if (patch.notes !== undefined) {
      body.notes = patch.notes;
    }

    const payload = await this.requestJson<any>(
      'PATCH',
      `${BOT_WATCHLIST_API_PREFIX}/${encodeURIComponent(String(validShortId))}`,
      validDiscordId,
      { body, isItemEndpoint: true }
    );

    const rawItem = payload?.item ?? payload?.entry ?? payload?.data ?? payload;
    return {
      item: normalizeWebsiteWatchlistItem(rawItem, validDiscordId),
      autoCompleted: Boolean(payload?.autoCompleted),
    };
  }

  public async removeEntry(
    discordUserId: string,
    shortId: number
  ): Promise<{ removed: boolean; item: WebsiteWatchlistItem | null }> {
    const validDiscordId = validateDiscordSnowflake(discordUserId);
    const validShortId = normalizeHoshikaShortId(shortId);
    if (!validShortId) {
      throw new AppError(ERROR_CODES.INVALID_ANIME_ID, 'A valid Hoshika shortId is required.', 400);
    }

    const params = new URLSearchParams({ discordUserId: validDiscordId });
    const payload = await this.requestJson<any>(
      'DELETE',
      `${BOT_WATCHLIST_API_PREFIX}/${encodeURIComponent(String(validShortId))}?${params.toString()}`,
      validDiscordId,
      { isItemEndpoint: true }
    );

    const rawItem = payload?.item ?? payload?.entry ?? null;
    return {
      removed: payload?.removed !== false,
      item: rawItem ? normalizeWebsiteWatchlistItem(rawItem, validDiscordId) : null,
    };
  }

  public async getStats(discordUserId: string): Promise<WebsiteWatchlistStats> {
    const items = await this.listWatchlist(discordUserId);
    return calculateWebsiteWatchlistStats(items);
  }
}

let sharedWebsiteWatchlist: WebsiteWatchlistService | null = null;
export function getWebsiteWatchlistService(): WebsiteWatchlistService {
  if (!sharedWebsiteWatchlist) {
    sharedWebsiteWatchlist = new WebsiteWatchlistService();
  }
  return sharedWebsiteWatchlist;
}
