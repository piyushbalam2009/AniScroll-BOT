import {
  AppError,
  createModuleLogger,
  ERROR_CODES,
  NormalizedCharacter,
} from '../../../../../packages/shared/src';
import { HoshikaClient } from '../hoshika/HoshikaClient';
import { AnimeCacheService } from '../hoshika/AnimeCacheService';
import { AnimeMetadataNormalizer } from '../hoshika/AnimeMetadataNormalizer';

const log = createModuleLogger('CharacterService');

interface HoshikaCharacterLookupItem {
  id: string;
  name: string;
  sub?: string | null;
  image?: string | null;
}

export function normalizeCharacterSearchText(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/['’`,.!?]/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function foldHepburn(value: string): string {
  return value.replace(/ou/g, 'o').replace(/uu/g, 'u');
}

function buildNameVariants(name: string): string[] {
  const norm = normalizeCharacterSearchText(name);
  if (!norm) return [];
  const variants = new Set<string>([norm, foldHepburn(norm)]);
  if (name.includes(',')) {
    const parts = name
      .split(',')
      .map((p) => normalizeCharacterSearchText(p))
      .filter(Boolean);
    if (parts.length >= 2) {
      const flipped = `${parts.slice(1).join(' ')} ${parts[0]}`.trim();
      variants.add(flipped);
      variants.add(foldHepburn(flipped));
    }
  }
  return Array.from(variants);
}

export function scoreCharacterMatch(query: string, candidate: NormalizedCharacter): number {
  const normQuery = normalizeCharacterSearchText(query);
  if (!normQuery) return 0;
  const foldedQuery = foldHepburn(normQuery);
  const queryTokens = foldedQuery.split(' ').filter(Boolean);

  const allNameSources = [
    candidate.name,
    candidate.nativeName,
    ...(candidate.alternativeNames || []),
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);

  let bestScore = 0;

  for (let idx = 0; idx < allNameSources.length; idx++) {
    const isPrimary = idx === 0;
    const isNative = idx === 1 && Boolean(candidate.nativeName);
    const variants = buildNameVariants(allNameSources[idx]);

    for (const v of variants) {
      const foldedV = foldHepburn(v);

      if (v === normQuery || foldedV === foldedQuery) {
        bestScore = Math.max(bestScore, isPrimary ? 1000 : isNative ? 950 : 900);
        continue;
      }

      const vTokens = foldedV.split(' ').filter(Boolean);
      if (queryTokens.length > 0 && queryTokens.every((qt) => vTokens.includes(qt))) {
        bestScore = Math.max(bestScore, isPrimary ? 800 : 750);
        continue;
      }

      if (
        queryTokens.length > 0 &&
        queryTokens.every((qt) => vTokens.some((vt) => vt.startsWith(qt) || vt.includes(qt)))
      ) {
        bestScore = Math.max(bestScore, isPrimary ? 650 : 600);
        continue;
      }

      if (foldedV.startsWith(foldedQuery) || v.startsWith(normQuery)) {
        bestScore = Math.max(bestScore, isPrimary ? 550 : 500);
        continue;
      }

      if (foldedV.includes(foldedQuery) || foldedQuery.includes(foldedV)) {
        bestScore = Math.max(bestScore, isPrimary ? 400 : 350);
        continue;
      }

      if (queryTokens.length > 0) {
        const matched = queryTokens.filter((qt) =>
          vTokens.some((vt) => vt.includes(qt) || qt.includes(vt))
        ).length;
        if (matched > 0) {
          const ratioScore = Math.round((matched / queryTokens.length) * 250);
          bestScore = Math.max(bestScore, ratioScore);
        }
      }
    }
  }

  return bestScore;
}

export class CharacterService {
  constructor(
    private readonly client: HoshikaClient,
    private readonly animeCache: AnimeCacheService
  ) {}

  private async lookupCharactersRaw(query: string): Promise<HoshikaCharacterLookupItem[]> {
    const res = await this.client.get<{
      ok?: boolean;
      results?: HoshikaCharacterLookupItem[];
    }>('/lookup', {
      params: { type: 'character', q: query },
    });
    return Array.isArray(res?.results) ? res.results.filter((r) => Boolean(r?.id && r?.name)) : [];
  }

  public async getCharacterDetails(
    characterId: string,
    locale = 'en'
  ): Promise<{ character: NormalizedCharacter; cached: boolean }> {
    const cleanId = (characterId || '').trim();
    if (!cleanId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Character ID cannot be empty.', 400);
    }
    const requestedLocale = (locale || 'en').trim() || 'en';
    const res = await this.animeCache.getOrFetchCharacterDetails(cleanId, requestedLocale, async () => {
      const raw = await this.client.get<unknown>(`/character/${encodeURIComponent(cleanId)}`, {
        params: { locale: requestedLocale },
      });
      return AnimeMetadataNormalizer.normalizeCharacter(raw);
    });
    return { character: res.data, cached: res.cached };
  }

  public async hydrateCharacter(
    character: NormalizedCharacter,
    locale = 'en'
  ): Promise<{ character: NormalizedCharacter; detailsError: string | null; cached: boolean }> {
    if (!character?.id) {
      return { character, detailsError: 'Missing character ID.', cached: false };
    }

    try {
      const { character: detailed, cached } = await this.getCharacterDetails(character.id, locale);
      const mergedAlt = Array.from(
        new Set([
          ...(detailed.alternativeNames || []),
          ...(character.alternativeNames || []),
          ...(character.name && character.name !== detailed.name ? [character.name] : []),
        ])
      );
      return {
        character: {
          ...character,
          ...detailed,
          nativeName: detailed.nativeName || character.nativeName || null,
          image: detailed.image || character.image || null,
          alternativeNames: mergedAlt,
        },
        detailsError: null,
        cached,
      };
    } catch (err) {
      const msg =
        err instanceof AppError
          ? err.userMessage
          : err instanceof Error
          ? err.message
          : 'Character details request failed';
      log.warn({ characterId: character.id, err: msg }, 'Failed to hydrate character details');
      return { character, detailsError: msg, cached: false };
    }
  }

  public async searchCharacters(
    query: string,
    locale = 'en'
  ): Promise<{ results: NormalizedCharacter[]; cached: boolean; topDetailsError?: string | null }> {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Please provide a non-empty character name to search.',
        400
      );
    }

    const requestedLocale = (locale || 'en').trim() || 'en';
    const keySuffix = `${trimmed.toLowerCase().replace(/\s+/g, ' ')}:${requestedLocale}`;

    const searchRes = await this.animeCache.getOrFetchCharacterSearch(keySuffix, async () => {
      const byId = new Map<string, HoshikaCharacterLookupItem>();
      const addItems = (items: HoshikaCharacterLookupItem[]) => {
        for (const item of items) {
          if (item?.id && !byId.has(item.id)) {
            byId.set(item.id, item);
          }
        }
      };

      const primary = await this.lookupCharactersRaw(trimmed);
      addItems(primary);

      // Hoshika's character index often stores names in "Last, First" Hepburn romaji (e.g. "Gojou, Satoru").
      // If direct multi-word lookup returns nothing, query comma-flipped form and individual tokens.
      if (byId.size === 0) {
        const words = trimmed
          .replace(/,/g, ' ')
          .split(/\s+/)
          .map((w) => w.trim())
          .filter((w) => w.length >= 2);

        if (words.length >= 2) {
          const lastFirst = `${words[words.length - 1]}, ${words.slice(0, -1).join(' ')}`;
          const flippedRes = await this.lookupCharactersRaw(lastFirst).catch(() => []);
          addItems(flippedRes);

          if (byId.size === 0) {
            const tokensByLength = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 3);
            for (const token of tokensByLength) {
              const tokenRes = await this.lookupCharactersRaw(token).catch(() => []);
              addItems(tokenRes);
              if (byId.size >= 10) break;
            }
          }
        }
      }

      const normalized = Array.from(byId.values()).map((item) =>
        AnimeMetadataNormalizer.normalizeCharacter(item)
      );

      const indexed = normalized.map((char, index) => ({
        char,
        index,
        score: scoreCharacterMatch(trimmed, char),
      }));

      indexed.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      });

      return indexed.map((entry) => entry.char).slice(0, 20);
    });

    const results = [...searchRes.data];
    if (results.length === 0) {
      return { results: [], cached: searchRes.cached };
    }

    const hydratedTop = await this.hydrateCharacter(results[0], requestedLocale);
    results[0] = hydratedTop.character;

    return {
      results,
      cached: searchRes.cached,
      topDetailsError: hydratedTop.detailsError,
    };
  }
}
