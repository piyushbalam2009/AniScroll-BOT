import { appConfig } from '../../../../../packages/shared/src';
import { CacheService } from '../cache/CacheService';

export class AnimeCacheService {
  constructor(private readonly cache: CacheService) {}

  public async getOrFetchSearch<T>(keySuffix: string, loader: () => Promise<T>) {
    return this.cache.dedupe(
      this.cache.key('anime:search', keySuffix),
      appConfig.CACHE_TTL_SEARCH_SECONDS,
      loader
    );
  }

  public async getOrFetchDetails<T>(shortId: number | string, locale: string, loader: () => Promise<T>) {
    return this.cache.dedupe(
      this.cache.key('anime:details', `${shortId}:${locale}`),
      appConfig.CACHE_TTL_DETAILS_SECONDS,
      loader
    );
  }

  public async getOrFetchEpisodes<T>(shortId: number | string, after: number, loader: () => Promise<T>) {
    return this.cache.dedupe(
      this.cache.key('anime:episodes', `${shortId}:${after}`),
      appConfig.CACHE_TTL_EPISODES_SECONDS,
      loader
    );
  }

  public async getOrFetchTrending<T>(sort: string, locale: string, loader: () => Promise<T>) {
    return this.cache.dedupe(
      this.cache.key('anime:trending', `${sort}:${locale}`),
      appConfig.CACHE_TTL_TRENDING_SECONDS,
      loader
    );
  }

  public async getOrFetchSeasonal<T>(locale: string, loader: () => Promise<T>) {
    return this.cache.dedupe(
      this.cache.key('anime:seasonal', locale),
      appConfig.CACHE_TTL_SEASONAL_SECONDS,
      loader
    );
  }

  public async getOrFetchGenres<T>(loader: () => Promise<T>) {
    return this.cache.dedupe(
      this.cache.key('anime:genres', 'all'),
      appConfig.CACHE_TTL_GENRES_SECONDS,
      loader
    );
  }
}

export class AnimeIdentifierService {
  private map = new Map<string, { hoshikaId: string; shortId: number | null; anilistId?: number | null; malId?: number | null }>();

  public remember(entry: { hoshikaId: string; shortId: number | null; anilistId?: number | null; malId?: number | null }) {
    this.map.set(entry.hoshikaId, entry);
    if (entry.shortId && entry.shortId > 0) this.map.set(String(entry.shortId), entry);
    if (entry.anilistId) this.map.set(`anilist:${entry.anilistId}`, entry);
    if (entry.malId) this.map.set(`mal:${entry.malId}`, entry);
  }

  public resolve(identifier: string | number) {
    return this.map.get(String(identifier)) || null;
  }
}
