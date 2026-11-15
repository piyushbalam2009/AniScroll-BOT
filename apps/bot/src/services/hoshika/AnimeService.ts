import {
  appConfig,
  AppError,
  buildAniScrollAnimeUrl,
  CharacterGuessCandidate,
  createModuleLogger,
  ERROR_CODES,
  NormalizedAnime,
  NormalizedCharacter,
  normalizeHoshikaShortId,
} from '../../../../../packages/shared/src';
import { HoshikaClient } from './HoshikaClient';
import { AnimeMetadataNormalizer } from './AnimeMetadataNormalizer';
import { AnimeCacheService, AnimeIdentifierService } from './AnimeCacheService';

const log = createModuleLogger('AnimeService');

export interface AnimeSearchFilters {
  query?: string;
  genre?: string;
  year?: number;
  format?: string;
  status?: string;
  page?: number;
  limit?: number;
  locale?: string;
}

export class AnimeSearchService {
  constructor(
    private readonly client: HoshikaClient,
    private readonly animeCache: AnimeCacheService,
    private readonly identifiers: AnimeIdentifierService
  ) {}

  public async search(filters: AnimeSearchFilters): Promise<{ items: NormalizedAnime[]; cached: boolean }> {
    const q = (filters.query || '').trim();
    const useCatalog = Boolean(filters.genre || filters.status || (filters.page && filters.page > 1));
    const keySuffix = JSON.stringify({
      q: q.toLowerCase(),
      genre: filters.genre || '',
      year: filters.year || '',
      format: filters.format || '',
      status: filters.status || '',
      page: filters.page || 1,
      locale: filters.locale || 'en',
    });

    const res = await this.animeCache.getOrFetchSearch(keySuffix, async () => {
      if (useCatalog || !q) {
        const catalogRes = await this.client.get<{ ok: boolean; items?: unknown[] }>('/catalog', {
          params: {
            type: 'anime',
            q: q || undefined,
            genre: filters.genre,
            format: filters.format,
            status: filters.status,
            year: filters.year,
            page: filters.page || 1,
            locale: filters.locale || 'en',
          },
        });
        const items = (catalogRes.items || []).map((item) => AnimeMetadataNormalizer.normalizeAnime(item));
        items.forEach((i) => this.identifiers.remember(i));
        return items.slice(0, filters.limit ?? 15);
      }

      const searchRes = await this.client.get<{ ok: boolean; anime?: unknown[] }>('/search', {
        params: {
          q,
          limit: filters.limit ?? 12,
          format: filters.format,
          year: filters.year,
          locale: filters.locale || 'en',
        },
      });
      const items = (searchRes.anime || []).map((item) => AnimeMetadataNormalizer.normalizeAnime(item));
      items.forEach((i) => this.identifiers.remember(i));
      return items;
    });
    return { items: res.data, cached: res.cached };
  }
}

export class AniScrollLinkService {
  constructor(private readonly searchService?: AnimeSearchService) {}

  /**
   * Builds an AniScroll detail URL strictly from a Hoshika shortId.
   * Never uses AniList IDs when constructing URLs, and never falls back to anilistId if shortId is missing.
   */
  public buildUrl(shortId: number | null | undefined): string | null {
    return buildAniScrollAnimeUrl(shortId, appConfig.ANISCROLL_WEB_BASE_URL);
  }

  public async resolveWatchUrl(
    target: string | { shortId?: number | null; title?: string | null; anilistId?: number | null; malId?: number | null }
  ): Promise<{ url: string; shortId: number; title?: string; anilistId?: number; malId?: number } | null> {
    if (typeof target !== 'string') {
      const validShortId = normalizeHoshikaShortId(target.shortId);
      const url = this.buildUrl(validShortId);
      if (!url || !validShortId) return null;
      return {
        url,
        shortId: validShortId,
        title: target.title || undefined,
        anilistId: typeof target.anilistId === 'number' ? target.anilistId : undefined,
        malId: typeof target.malId === 'number' ? target.malId : undefined,
      };
    }

    const query = target.trim();
    if (!query || !this.searchService) return null;

    const directShortId = normalizeHoshikaShortId(query);
    if (directShortId) {
      const url = this.buildUrl(directShortId);
      return url ? { url, shortId: directShortId } : null;
    }

    const searchRes = await this.searchService.search({ query, limit: 1 });
    const first = searchRes.items[0];
    if (!first) return null;

    const validShortId = normalizeHoshikaShortId(first.shortId);
    const url = this.buildUrl(validShortId);
    if (!url || !validShortId) return null;

    return {
      url,
      shortId: validShortId,
      title: first.titleEnglish || first.titleRomaji || undefined,
      anilistId: typeof first.anilistId === 'number' ? first.anilistId : undefined,
      malId: typeof first.malId === 'number' ? first.malId : undefined,
    };
  }
}

export interface RecommendationMatchEvaluation {
  mode: 'none' | 'exact' | 'select';
  selected?: NormalizedAnime;
  candidates: NormalizedAnime[];
}

function normalizeMatchText(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, ' ')
    .trim();
}

function extractColonPrefix(value: string | null | undefined): string | null {
  if (!value || !value.includes(':')) return null;
  const prefix = value.split(':')[0];
  const norm = normalizeMatchText(prefix);
  return norm.length >= 2 ? norm : null;
}

const SEQUEL_OR_SPINOFF_REGEX =
  /\b(season\s*\d+|\d+(?:st|nd|rd|th)\s+season|part\s*\d+|mini\s*anime|movie|film|ova|ona|special|recap|arc|cms)\b/i;

export function evaluateRecommendationSearchMatches(
  query: string,
  rawResults: NormalizedAnime[]
): RecommendationMatchEvaluation {
  const normQuery = normalizeMatchText(query);
  if (!normQuery) {
    return { mode: 'none', candidates: [] };
  }

  const queryTokens = normQuery.split(/\s+/).filter((t) => t.length >= 2);
  const validItems = rawResults.filter((item) => {
    const validId = normalizeHoshikaShortId(item.shortId);
    if (!validId) return false;
    const fields = [
      item.titleEnglish,
      item.titleRomaji,
      item.titleNative,
      item.slug,
      ...(item.alternativeTitles || []),
    ]
      .filter(Boolean)
      .map((f) => normalizeMatchText(f));
    if (fields.length === 0) return false;
    if (fields.some((f) => f.includes(normQuery) || normQuery.includes(f))) {
      return true;
    }
    if (queryTokens.length > 0 && queryTokens.some((tok) => fields.some((f) => f.includes(tok)))) {
      return true;
    }
    return false;
  });

  const candidates = validItems.slice(0, 10);
  if (candidates.length === 0) {
    return { mode: 'none', candidates: [] };
  }

  if (candidates.length === 1) {
    return { mode: 'exact', selected: candidates[0], candidates };
  }

  const exactMatches = candidates.filter((item) => {
    const en = normalizeMatchText(item.titleEnglish);
    const ro = normalizeMatchText(item.titleRomaji);
    const na = normalizeMatchText(item.titleNative);
    const sl = normalizeMatchText(item.slug);
    return en === normQuery || ro === normQuery || na === normQuery || sl === normQuery;
  });

  if (exactMatches.length === 1) {
    return { mode: 'exact', selected: exactMatches[0], candidates };
  }

  const first = candidates[0];
  const firstEnPrefix = extractColonPrefix(first.titleEnglish);
  const firstRoPrefix = extractColonPrefix(first.titleRomaji);
  const firstHasColonMatch = firstEnPrefix === normQuery || firstRoPrefix === normQuery;
  const firstTitleCombined = `${first.titleEnglish || ''} ${first.titleRomaji || ''}`;

  if (firstHasColonMatch && !SEQUEL_OR_SPINOFF_REGEX.test(firstTitleCombined)) {
    const competingNonSequels = candidates.slice(1).filter((other) => {
      const otherEnPrefix = extractColonPrefix(other.titleEnglish);
      const otherRoPrefix = extractColonPrefix(other.titleRomaji);
      const sharesPrefix = otherEnPrefix === normQuery || otherRoPrefix === normQuery;
      if (!sharesPrefix) return false;
      const otherCombined = `${other.titleEnglish || ''} ${other.titleRomaji || ''}`;
      return !SEQUEL_OR_SPINOFF_REGEX.test(otherCombined);
    });

    if (competingNonSequels.length === 0) {
      return { mode: 'exact', selected: first, candidates };
    }
  }

  return { mode: 'select', candidates };
}

export class AnimeService {
  constructor(
    private readonly client: HoshikaClient,
    private readonly animeCache: AnimeCacheService,
    private readonly identifiers: AnimeIdentifierService,
    public readonly searchService: AnimeSearchService,
    public readonly linkService: AniScrollLinkService
  ) {}

  public async searchForRecommendation(
    query: string,
    locale = 'en'
  ): Promise<RecommendationMatchEvaluation & { cached: boolean }> {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Anime name cannot be empty.', 400);
    }
    const { items, cached } = await this.searchService.search({
      query: trimmed,
      limit: 10,
      locale,
    });
    const evaluation = evaluateRecommendationSearchMatches(trimmed, items);
    return { ...evaluation, cached };
  }

  private async fetchDetailsByShortId(shortId: number, locale: string): Promise<{ data: NormalizedAnime; cached: boolean }> {
    return this.animeCache.getOrFetchDetails(shortId, locale, async () => {
      const raw = await this.client.get<{ ok: boolean; anime?: unknown }>(`/anime/${shortId}`, {
        params: { locale },
      });
      if (!raw || typeof raw !== 'object' || !raw.anime || typeof raw.anime !== 'object') {
        throw new AppError(
          ERROR_CODES.ANIME_NOT_FOUND,
          `Anime details not found on Hoshika for ID ${shortId}.`,
          404
        );
      }
      const normalized = AnimeMetadataNormalizer.normalizeAnime(raw.anime);
      normalized.isDetailHydrated = true;
      this.identifiers.remember(normalized);
      return normalized;
    });
  }

  public async getDetails(shortIdOrQuery: string | number, locale = 'en'): Promise<{ anime: NormalizedAnime; cached: boolean }> {
    const requestedLocale = (locale || 'en').trim() || 'en';

    if (typeof shortIdOrQuery === 'number' && (!Number.isInteger(shortIdOrQuery) || shortIdOrQuery <= 0)) {
      throw new AppError(
        ERROR_CODES.INVALID_ANIME_ID,
        `Invalid Hoshika shortId "${shortIdOrQuery}".`,
        400
      );
    }

    const rawStr = String(shortIdOrQuery).trim();
    if (!rawStr) {
      throw new AppError(ERROR_CODES.INVALID_ANIME_ID, 'Anime identifier cannot be empty.', 400);
    }

    let shortId = normalizeHoshikaShortId(shortIdOrQuery);
    if (!shortId) {
      // Reject explicitly negative or zero numeric inputs instead of searching for "-5"
      if (/^-?\d+$/.test(rawStr)) {
        throw new AppError(
          ERROR_CODES.INVALID_ANIME_ID,
          `Invalid Hoshika shortId "${rawStr}".`,
          400
        );
      }

      const remembered = this.identifiers.resolve(rawStr);
      if (remembered && remembered.shortId && remembered.shortId > 0) {
        shortId = remembered.shortId;
      } else {
        const searchRes = await this.searchService.search({ query: rawStr, limit: 1, locale: requestedLocale });
        const matched = searchRes.items[0];
        if (!matched || !matched.shortId || matched.shortId <= 0) {
          throw new AppError(
            ERROR_CODES.ANIME_NOT_FOUND,
            `No anime with a Hoshika shortId found matching "${shortIdOrQuery}".`,
            404
          );
        }
        shortId = matched.shortId;
      }
    }

    let res = await this.fetchDetailsByShortId(shortId, requestedLocale);

    // Fall back to English localization (locale=en) if localized synopsis is unavailable
    if (requestedLocale !== 'en' && !res.data.synopsis) {
      try {
        const enRes = await this.fetchDetailsByShortId(shortId, 'en');
        if (enRes.data.synopsis) {
          res = {
            data: {
              ...res.data,
              synopsis: enRes.data.synopsis,
              titleEnglish: res.data.titleEnglish || enRes.data.titleEnglish,
            },
            cached: res.cached && enRes.cached,
          };
        }
      } catch (fallbackErr) {
        log.warn(
          { shortId, requestedLocale, err: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) },
          'English fallback lookup failed; keeping primary locale response'
        );
      }
    }

    return { anime: res.data, cached: res.cached };
  }

  /**
   * Hydrates a summary search/browse item with complete metadata (including synopsis)
   * from `GET /api/v1/anime/{shortId}?locale=en`.
   * Never throws on detail fetch failure; logs the actual error and returns `detailsError`
   * so the caller can distinguish a failed API request from a genuinely missing synopsis.
   */
  public async hydrateAnimeItem(
    item: NormalizedAnime,
    locale = 'en'
  ): Promise<{ anime: NormalizedAnime; detailsError: string | null; cached: boolean }> {
    if (item.isDetailHydrated && item.synopsis) {
      return { anime: item, detailsError: null, cached: true };
    }

    const validShortId = normalizeHoshikaShortId(item.shortId);
    if (!validShortId) {
      log.warn({ hoshikaId: item.hoshikaId, shortId: item.shortId }, 'Cannot fetch Hoshika details: missing valid shortId');
      return {
        anime: item,
        detailsError: 'Invalid Hoshika ID for this anime.',
        cached: false,
      };
    }

    try {
      const { anime: detailed, cached } = await this.getDetails(validShortId, locale);
      const merged: NormalizedAnime = {
        ...item,
        ...detailed,
        shortId: validShortId,
        aniscrollUrl: detailed.aniscrollUrl || item.aniscrollUrl,
        poster: detailed.poster || item.poster,
        banner: detailed.banner || item.banner,
        isDetailHydrated: true,
      };
      return { anime: merged, detailsError: null, cached };
    } catch (err) {
      const errorMessage =
        err instanceof AppError
          ? err.userMessage
          : err instanceof Error
          ? err.message
          : 'Hoshika details service error';
      log.warn(
        { shortId: validShortId, locale, err: errorMessage },
        'Failed to fetch full anime details from Hoshika'
      );
      return {
        anime: item,
        detailsError: errorMessage,
        cached: false,
      };
    }
  }

  public async getEpisodes(shortId: number, after = 0, limit = 15, locale = 'en') {
    const res = await this.animeCache.getOrFetchEpisodes(shortId, after, async () => {
      const raw = await this.client.get<{ ok: boolean; items?: unknown[] }>(`/anime/${shortId}/episodes`, {
        params: { after, limit, locale },
      });
      return AnimeMetadataNormalizer.normalizeEpisodes(raw.items || []);
    });
    return { episodes: res.data, cached: res.cached };
  }

  public async getTrending(sort: 'trending' | 'top' | 'recent' = 'trending', locale = 'en') {
    const res = await this.animeCache.getOrFetchTrending(sort, locale, async () => {
      const raw = await this.client.get<{ ok: boolean; items?: unknown[] }>('/browse', {
        params: { type: 'anime', sort, locale },
      });
      const items = (raw.items || []).map((i) => AnimeMetadataNormalizer.normalizeAnime(i));
      items.forEach((i) => this.identifiers.remember(i));
      return items;
    });
    return { items: res.data, cached: res.cached };
  }

  public async getSeasonal(locale = 'en') {
    const res = await this.animeCache.getOrFetchSeasonal(locale, async () => {
      const raw = await this.client.get<{
        ok: boolean;
        season?: { season: string; year: number };
        items?: unknown[];
      }>('/season', { params: { locale } });
      const items = (raw.items || []).map((i) => AnimeMetadataNormalizer.normalizeAnime(i));
      items.forEach((i) => this.identifiers.remember(i));
      return { season: raw.season || null, items };
    });
    return { ...res.data, cached: res.cached };
  }

  public async getSchedule(locale = 'en') {
    const raw = await this.client.get<{ ok: boolean; week?: unknown; items?: any[] }>('/schedule', {
      params: { locale },
    });
    const items = (raw.items || []).map((item) => ({
      anime: AnimeMetadataNormalizer.normalizeAnime(item),
      episode: item.episode ?? null,
      airingAt: item.airingAt ?? null,
    }));
    return { week: raw.week || null, items };
  }

  public async getGenres(): Promise<string[]> {
    const res = await this.animeCache.getOrFetchGenres(async () => {
      const raw = await this.client.get<{ ok: boolean; genres?: string[] }>('/genres');
      return raw.genres || [];
    });
    return res.data;
  }

  public async getRandom(filters?: { genre?: string; year?: number; format?: string }, locale = 'en') {
    let picked: NormalizedAnime;
    if (filters?.genre || filters?.year || filters?.format) {
      const search = await this.searchService.search({
        genre: filters.genre,
        year: filters.year,
        format: filters.format,
        limit: 20,
        locale,
      });
      if (search.items.length === 0) {
        throw new AppError(ERROR_CODES.ANIME_NOT_FOUND, 'No anime matched those random filters.', 404);
      }
      picked = search.items[Math.floor(Math.random() * search.items.length)];
    } else {
      const raw = await this.client.get<{ ok: boolean; items?: unknown[] }>('/discover');
      const items = (raw.items || []).map((i) => AnimeMetadataNormalizer.normalizeAnime(i));
      if (items.length === 0) {
        throw new AppError(ERROR_CODES.ANIME_NOT_FOUND, 'No discovery anime returned.', 404);
      }
      picked = items[Math.floor(Math.random() * items.length)];
    }
    const hydrated = await this.hydrateAnimeItem(picked, locale);
    return hydrated.anime;
  }

  public async getRandomGuessPool(options?: {
    count?: number;
    excludeShortIds?: number[];
    locale?: string;
  }): Promise<NormalizedAnime[]> {
    const count = Math.max(1, Math.min(25, options?.count ?? 10));
    const locale = options?.locale || 'en';
    const excluded = new Set<number>(options?.excludeShortIds || []);
    const candidatesByShortId = new Map<number, NormalizedAnime>();

    let skippedInvalid = 0;
    const isValidHttpUrl = (value: string | null | undefined): boolean => {
      if (!value || !/^https?:\/\//i.test(value)) return false;
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
      } catch {
        return false;
      }
    };

    const collectValid = (rawItems: unknown[] | undefined) => {
      if (!Array.isArray(rawItems)) return;
      for (const raw of rawItems) {
        try {
          const item = AnimeMetadataNormalizer.normalizeAnime(raw);
          const sid = normalizeHoshikaShortId(item.shortId);
          if (!sid || excluded.has(sid) || candidatesByShortId.has(sid)) continue;
          if (!item.titleEnglish || !item.titleEnglish.trim()) {
            skippedInvalid++;
            continue;
          }
          if (!isValidHttpUrl(item.poster)) {
            skippedInvalid++;
            continue;
          }
          this.identifiers.remember(item);
          candidatesByShortId.set(sid, item);
        } catch {
          skippedInvalid++;
        }
      }
    };

    const discoverOffsets = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135];
    const pickedOffsets = [...discoverOffsets].sort(() => Math.random() - 0.5).slice(0, 2);
    const browseSorts: Array<'top' | 'trending'> =
      Math.random() < 0.5 ? ['top', 'trending'] : ['trending', 'top'];

    const primaryResults = await Promise.allSettled([
      this.client.get<{ ok: boolean; items?: unknown[] }>('/discover', {
        params: { offset: pickedOffsets[0] },
      }),
      this.client.get<{ ok: boolean; items?: unknown[] }>('/discover', {
        params: { offset: pickedOffsets[1] },
      }),
      this.client.get<{ ok: boolean; items?: unknown[] }>('/browse', {
        params: { type: 'anime', sort: browseSorts[0], locale },
      }),
    ]);

    let lastError: unknown = null;
    for (const res of primaryResults) {
      if (res.status === 'fulfilled') {
        collectValid(res.value.items);
      } else {
        lastError = res.reason;
        log.warn(
          { err: res.reason instanceof Error ? res.reason.message : String(res.reason) },
          'Hoshika guess pool source request failed'
        );
      }
    }

    if (skippedInvalid > 0) {
      log.debug({ skippedInvalid, validCount: candidatesByShortId.size }, 'Filtered incomplete Hoshika guess pool entries');
    }

    if (candidatesByShortId.size < count) {
      try {
        const extraBrowse = await this.client.get<{ ok: boolean; items?: unknown[] }>('/browse', {
          params: { type: 'anime', sort: browseSorts[1], locale },
        });
        collectValid(extraBrowse.items);
      } catch (err) {
        lastError = err;
      }
    }

    if (candidatesByShortId.size < count) {
      const randomPage = Math.floor(Math.random() * 12) + 1;
      try {
        const catalogRes = await this.client.get<{ ok: boolean; items?: unknown[] }>('/catalog', {
          params: { type: 'anime', page: randomPage, locale },
        });
        collectValid(catalogRes.items);
      } catch (err) {
        lastError = err;
      }
    }

    if (candidatesByShortId.size < count && excluded.size > 0) {
      // Allow previously played anime only if fresh unplayed candidates are exhausted
      const allowReuse = Array.from(excluded);
      excluded.clear();
      for (const res of primaryResults) {
        if (res.status === 'fulfilled') {
          collectValid(res.value.items);
        }
      }
      if (candidatesByShortId.size < count && allowReuse.length > 0) {
        try {
          const fallbackBrowse = await this.client.get<{ ok: boolean; items?: unknown[] }>('/browse', {
            params: { type: 'anime', sort: 'top', locale },
          });
          collectValid(fallbackBrowse.items);
        } catch (err) {
          lastError = err;
        }
      }
    }

    const pool = Array.from(candidatesByShortId.values());
    if (pool.length === 0) {
      if (lastError instanceof AppError) {
        throw lastError;
      }
      throw new AppError(
        ERROR_CODES.HOSHIKA_UNAVAILABLE,
        'Could not fetch random anime from Hoshika right now. Please try again in a moment.',
        503
      );
    }

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return pool.slice(0, count);
  }

  public async getCharacterDetails(
    characterId: string,
    locale = 'en'
  ): Promise<NormalizedCharacter> {
    const cleanId = (characterId || '').trim();
    if (!cleanId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Character ID cannot be empty.', 400);
    }
    const raw = await this.client.get<unknown>(`/character/${encodeURIComponent(cleanId)}`, {
      params: { locale },
    });
    return AnimeMetadataNormalizer.normalizeCharacter(raw);
  }

  public async getRandomCharacterGuessPool(options?: {
    count?: number;
    excludeCharacterIds?: string[];
    locale?: string;
  }): Promise<CharacterGuessCandidate[]> {
    const count = Math.max(1, Math.min(25, options?.count ?? 10));
    const locale = options?.locale || 'en';
    const excluded = new Set<string>(options?.excludeCharacterIds || []);

    const isValidCharacterImageUrl = (
      url: string | null | undefined,
      anime?: NormalizedAnime | null
    ): url is string => {
      if (!url || !/^https?:\/\//i.test(url)) return false;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        const lower = parsed.pathname.toLowerCase();
        if (
          lower.includes('questionmark') ||
          lower.includes('placeholder') ||
          lower.includes('no_image') ||
          lower.includes('no-image') ||
          /\/default\.(?:png|jpe?g|webp|gif)$/i.test(lower)
        ) {
          return false;
        }
        if (anime?.poster && url === anime.poster) return false;
        if (anime?.banner && url === anime.banner) return false;
        return true;
      } catch {
        return false;
      }
    };

    const animeByShortId = new Map<number, NormalizedAnime>();
    const collectAnime = (rawItems: unknown[] | undefined) => {
      if (!Array.isArray(rawItems)) return;
      for (const raw of rawItems) {
        try {
          const item = AnimeMetadataNormalizer.normalizeAnime(raw);
          const sid = normalizeHoshikaShortId(item.shortId);
          if (!sid || animeByShortId.has(sid)) continue;
          const animeTitle = item.titleEnglish?.trim() || item.titleRomaji?.trim();
          if (!animeTitle) continue;
          this.identifiers.remember(item);
          animeByShortId.set(sid, item);
        } catch {
          // Skip malformed entries
        }
      }
    };

    const discoverOffsets = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135];
    const pickedOffsets = [...discoverOffsets].sort(() => Math.random() - 0.5).slice(0, 2);
    const browseSorts: Array<'top' | 'trending'> =
      Math.random() < 0.5 ? ['top', 'trending'] : ['trending', 'top'];

    const sourceResponses = await Promise.allSettled([
      this.client.get<{ ok: boolean; items?: unknown[] }>('/browse', {
        params: { type: 'anime', sort: browseSorts[0], locale },
      }),
      this.client.get<{ ok: boolean; items?: unknown[] }>('/discover', {
        params: { offset: pickedOffsets[0] },
      }),
      this.client.get<{ ok: boolean; items?: unknown[] }>('/discover', {
        params: { offset: pickedOffsets[1] },
      }),
    ]);

    let lastError: unknown = null;
    for (const res of sourceResponses) {
      if (res.status === 'fulfilled') {
        collectAnime(res.value.items);
      } else {
        lastError = res.reason;
        log.warn(
          { err: res.reason instanceof Error ? res.reason.message : String(res.reason) },
          'Hoshika character pool anime discovery request failed'
        );
      }
    }

    if (animeByShortId.size < count * 2) {
      try {
        const extraBrowse = await this.client.get<{ ok: boolean; items?: unknown[] }>('/browse', {
          params: { type: 'anime', sort: browseSorts[1], locale },
        });
        collectAnime(extraBrowse.items);
      } catch (err) {
        lastError = err;
      }
    }

    if (animeByShortId.size < count * 2) {
      const randomPage = Math.floor(Math.random() * 10) + 1;
      try {
        const catalogRes = await this.client.get<{ ok: boolean; items?: unknown[] }>('/catalog', {
          params: { type: 'anime', page: randomPage, locale },
        });
        collectAnime(catalogRes.items);
      } catch (err) {
        lastError = err;
      }
    }

    const animePool = Array.from(animeByShortId.values());
    if (animePool.length === 0) {
      if (lastError instanceof AppError) throw lastError;
      throw new AppError(
        ERROR_CODES.HOSHIKA_UNAVAILABLE,
        'Could not fetch anime character sources from Hoshika right now. Please try again in a moment.',
        503
      );
    }

    // Shuffle anime pool and inspect anime details in batches until we have `count` distinct characters
    for (let i = animePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [animePool[i], animePool[j]] = [animePool[j], animePool[i]];
    }

    interface PreliminaryPick {
      characterId: string;
      rawName: string;
      avatarUrl: string;
      role: string | null;
      animeShortId: number;
      animeTitle: string;
      anime: NormalizedAnime;
    }

    const pickedByCharId = new Map<string, PreliminaryPick>();
    const fallbackPicks: PreliminaryPick[] = [];
    const batchSize = 6;

    for (let idx = 0; idx < animePool.length && pickedByCharId.size < count; idx += batchSize) {
      const batch = animePool.slice(idx, idx + batchSize);
      const detailResults = await Promise.allSettled(
        batch.map((item) => this.getDetails(item.shortId!, locale))
      );

      for (const res of detailResults) {
        if (pickedByCharId.size >= count) break;
        if (res.status !== 'fulfilled') {
          lastError = res.reason;
          continue;
        }
        const detailed = res.value.anime;
        const sid = normalizeHoshikaShortId(detailed.shortId);
        const animeTitle =
          detailed.titleEnglish?.trim() || detailed.titleRomaji?.trim() || detailed.titleNative?.trim();
        if (!sid || !animeTitle || !Array.isArray(detailed.characters) || detailed.characters.length === 0) {
          continue;
        }

        const validChars = detailed.characters.filter(
          (ch) =>
            Boolean(ch.id) &&
            Boolean(ch.name?.trim()) &&
            /[a-zA-Z]/.test(ch.name) &&
            isValidCharacterImageUrl(ch.avatar, detailed)
        );
        if (validChars.length === 0) continue;

        const mainChars = validChars.filter((c) => (c.role || '').toUpperCase() === 'MAIN');
        const preferredPool = mainChars.length > 0 ? mainChars : validChars;
        const shuffledChars = [...preferredPool].sort(() => Math.random() - 0.5);

        let chosenThisAnime = false;
        for (const ch of shuffledChars) {
          if (pickedByCharId.has(ch.id)) continue;
          const candidate: PreliminaryPick = {
            characterId: ch.id,
            rawName: ch.name.trim(),
            avatarUrl: ch.avatar!,
            role: ch.role ?? null,
            animeShortId: sid,
            animeTitle,
            anime: detailed,
          };
          if (excluded.has(ch.id)) {
            fallbackPicks.push(candidate);
            continue;
          }
          pickedByCharId.set(ch.id, candidate);
          chosenThisAnime = true;
          break;
        }

        if (!chosenThisAnime && mainChars.length > 0 && validChars.length > mainChars.length) {
          const supporting = validChars.filter((c) => (c.role || '').toUpperCase() !== 'MAIN');
          for (const ch of supporting.sort(() => Math.random() - 0.5)) {
            if (pickedByCharId.has(ch.id) || excluded.has(ch.id)) continue;
            pickedByCharId.set(ch.id, {
              characterId: ch.id,
              rawName: ch.name.trim(),
              avatarUrl: ch.avatar!,
              role: ch.role ?? null,
              animeShortId: sid,
              animeTitle,
              anime: detailed,
            });
            break;
          }
        }
      }
    }

    // Reuse excluded characters only if fresh ones couldn't fill `count`
    if (pickedByCharId.size < count) {
      for (const fb of fallbackPicks) {
        if (pickedByCharId.size >= count) break;
        if (!pickedByCharId.has(fb.characterId)) {
          pickedByCharId.set(fb.characterId, fb);
        }
      }
    }

    const preliminary = Array.from(pickedByCharId.values()).slice(0, count);
    if (preliminary.length === 0) {
      if (lastError instanceof AppError) throw lastError;
      throw new AppError(
        ERROR_CODES.HOSHIKA_UNAVAILABLE,
        'Could not gather anime characters with valid character images from Hoshika right now.',
        503
      );
    }

    // Hydrate selected characters with GET /api/v1/character/{id}?locale=en for canonical names, avatars, and appearances
    const detailResults = await Promise.allSettled(
      preliminary.map((pick) => this.getCharacterDetails(pick.characterId, locale))
    );

    const candidates: CharacterGuessCandidate[] = [];
    for (let i = 0; i < preliminary.length; i++) {
      const pick = preliminary[i];
      const detRes = detailResults[i];
      let canonicalName = pick.rawName;
      let finalAvatar = pick.avatarUrl;
      let animeTitle = pick.animeTitle;
      const altSet = new Set<string>([pick.rawName]);

      if (detRes.status === 'fulfilled') {
        const det = detRes.value;
        if (det.name && /[a-zA-Z]/.test(det.name)) {
          canonicalName = det.name.trim();
          altSet.add(canonicalName);
        }
        if (Array.isArray(det.alternativeNames)) {
          for (const alt of det.alternativeNames) {
            if (alt && /[a-zA-Z]/.test(alt)) altSet.add(alt.trim());
          }
        }
        if (isValidCharacterImageUrl(det.image, pick.anime)) {
          finalAvatar = det.image;
        }
        const matchedAppearance = det.appearances.find((a) => a.shortId === pick.animeShortId);
        if (matchedAppearance?.title && matchedAppearance.title !== 'Unknown') {
          animeTitle = matchedAppearance.title;
        }
      }

      if (!isValidCharacterImageUrl(finalAvatar, pick.anime)) {
        continue;
      }

      candidates.push({
        characterId: pick.characterId,
        characterName: canonicalName,
        alternativeNames: Array.from(altSet),
        characterImageUrl: finalAvatar,
        animeShortId: pick.animeShortId,
        animeTitle,
        role: pick.role,
      });
    }

    // Shuffle final candidates so order isn't tied to batch resolution
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    return candidates;
  }

  public async searchCharacters(query: string) {
    const lookup = await this.client.get<{ ok: boolean; results?: Array<{ id: string; name: string; sub?: string; image?: string }> }>('/lookup', {
      params: { type: 'character', q: query },
    });
    const results = lookup.results || [];
    if (results.length === 0) {
      throw new AppError(ERROR_CODES.ANIME_NOT_FOUND, `No character found matching "${query}".`, 404);
    }
    const first = results[0];
    try {
      const detail = await this.client.get(`/character/${first.id}`);
      return {
        character: AnimeMetadataNormalizer.normalizeCharacter({ ...first, ...(detail as object) }),
        matches: results,
      };
    } catch {
      return {
        character: AnimeMetadataNormalizer.normalizeCharacter(first),
        matches: results,
      };
    }
  }
}
