import { getCacheService } from '../cache/CacheService';
import { HoshikaClient } from './HoshikaClient';
import { AnimeCacheService, AnimeIdentifierService } from './AnimeCacheService';
import { AnimeSearchService, AnimeService, AniScrollLinkService } from './AnimeService';

export * from './HoshikaClient';
export * from './AnimeMetadataNormalizer';
export * from './AnimeCacheService';
export * from './AnimeService';

let singleton: {
  client: HoshikaClient;
  animeService: AnimeService;
  identifiers: AnimeIdentifierService;
} | null = null;

export function getAnimeServices() {
  if (!singleton) {
    const client = new HoshikaClient();
    const cache = getCacheService();
    const animeCache = new AnimeCacheService(cache);
    const identifiers = new AnimeIdentifierService();
    const searchService = new AnimeSearchService(client, animeCache, identifiers);
    const linkService = new AniScrollLinkService(searchService);
    const animeService = new AnimeService(client, animeCache, identifiers, searchService, linkService);
    singleton = { client, animeService, identifiers };
  }
  return singleton;
}
