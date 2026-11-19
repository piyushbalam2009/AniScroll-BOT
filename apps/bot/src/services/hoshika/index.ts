import { getCacheService } from '../cache/CacheService';
import { HoshikaClient } from './HoshikaClient';
import { AnimeCacheService, AnimeIdentifierService } from './AnimeCacheService';
import { AnimeSearchService, AnimeService, AniScrollLinkService } from './AnimeService';
import { CharacterService } from '../anime/CharacterService';

export * from './HoshikaClient';
export * from './AnimeMetadataNormalizer';
export * from './AnimeCacheService';
export * from './AnimeService';

let singleton: {
  client: HoshikaClient;
  animeCache: AnimeCacheService;
  animeService: AnimeService;
  characterService: CharacterService;
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
    const characterService = new CharacterService(client, animeCache);
    singleton = { client, animeCache, animeService, characterService, identifiers };
  }
  return singleton;
}
