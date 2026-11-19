import {
  appConfig,
  buildAniScrollAnimeUrl,
  NormalizedAnime,
  NormalizedCharacter,
  NormalizedEpisode,
  normalizeHoshikaShortId,
} from '../../../../../packages/shared/src';
import {
  hoshikaAnimeDetailSchema,
  hoshikaAnimeSummarySchema,
  hoshikaEpisodeSchema,
} from '../../../../../packages/validation/src';

export class AnimeMetadataNormalizer {
  /**
   * Normalizes Hoshika summary or detail payloads into a strict schema.
   * Explicitly omits any `streaming` or `platforms` fields per project exclusions.
   * Generates AniScroll URLs strictly from Hoshika `shortId` (never from `anilistId`).
   */
  public static cleanSynopsis(
    rawSynopsis: string | null | undefined,
    titlesToReject: Array<string | null | undefined> = []
  ): string | null {
    if (typeof rawSynopsis !== 'string') return null;
    const cleaned = rawSynopsis
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!cleaned) return null;
    if (/^no synopsis available\.?$/i.test(cleaned)) return null;

    const normalizedCleaned = cleaned.toLowerCase();
    for (const t of titlesToReject) {
      if (t && t.trim() && t.trim().toLowerCase() === normalizedCleaned) {
        return null;
      }
    }

    return cleaned;
  }

  public static normalizeAnime(rawInput: unknown): NormalizedAnime {
    // Support both unwrapped anime objects and `{ ok: true, anime: { ... } }` detail wrappers
    const inputObj = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>;
    const unwrapped =
      inputObj.anime && typeof inputObj.anime === 'object' && !inputObj.id
        ? (inputObj.anime as Record<string, unknown>)
        : inputObj;

    // Strip forbidden streaming provider fields before parsing
    const sanitized = { ...unwrapped };
    delete sanitized.streaming;
    delete sanitized.platforms;

    const parsed = hoshikaAnimeDetailSchema.safeParse(sanitized);
    const data = parsed.success
      ? parsed.data
      : hoshikaAnimeSummarySchema.parse(sanitized);

    const genres = (data.genres || []).map((g) => (typeof g === 'string' ? g : g.name));
    const studios = (data.studios || []).map((s) => (typeof s === 'string' ? s : s.name));

    const altSet = new Set<string>();
    if (data.titleEnglish) altSet.add(data.titleEnglish);
    if (data.titleRomaji) altSet.add(data.titleRomaji);
    if (data.titleJapanese) altSet.add(data.titleJapanese);
    if (data.titleLocalized) altSet.add(data.titleLocalized);
    if (Array.isArray(data.synonyms)) {
      for (const syn of data.synonyms) {
        if (typeof syn === 'string' && syn.trim()) altSet.add(syn.trim());
      }
    }
    if (Array.isArray(data.alternativeTitles)) {
      for (const alt of data.alternativeTitles) {
        if (typeof alt === 'string' && alt.trim()) altSet.add(alt.trim());
      }
    }
    const primaryTitle = data.titleEnglish || data.titleRomaji || data.titleLocalized || '';
    altSet.delete(primaryTitle);

    const detailData = parsed.success ? parsed.data : null;
    const shortId = normalizeHoshikaShortId(data.shortId);
    const webBase = appConfig.ANISCROLL_WEB_BASE_URL;

    const synopsis = AnimeMetadataNormalizer.cleanSynopsis(data.synopsis, [
      data.titleEnglish,
      data.titleRomaji,
      data.titleJapanese,
      data.titleLocalized,
    ]);

    let trailerUrl: string | null = null;
    if (data.trailerId && (!data.trailerSite || data.trailerSite.toLowerCase() === 'youtube')) {
      trailerUrl = `https://www.youtube.com/watch?v=${data.trailerId}`;
    } else if (detailData?.videos && detailData.videos.length > 0 && detailData.videos[0].youtubeId) {
      trailerUrl = `https://www.youtube.com/watch?v=${detailData.videos[0].youtubeId}`;
    }

    const isDetailHydrated = Boolean(
      unwrapped.synopsis !== undefined ||
        data.source ||
        data.trailerId ||
        (data.studios && data.studios.length > 0)
    );

    return {
      hoshikaId: data.id,
      shortId,
      slug: data.slug || '',
      aniscrollUrl: buildAniScrollAnimeUrl(shortId, webBase),
      anilistId: data.anilistId ?? data.anilist_id ?? null,
      malId: data.malId ?? data.mal_id ?? null,
      titleEnglish: data.titleEnglish ?? null,
      titleRomaji: data.titleRomaji ?? null,
      titleNative: data.titleJapanese ?? null,
      alternativeTitles: Array.from(altSet).filter(Boolean),
      synopsis,
      poster: data.coverImage ?? null,
      banner: data.bannerImage ?? null,
      genres,
      studios,
      releaseYear: data.seasonYear ?? null,
      season: data.season ?? null,
      type: data.format ?? null,
      status: data.status ?? null,
      totalEpisodes: data.episodes ?? null,
      episodeDuration: data.episodeDuration ?? null,
      rating: data.averageScore ?? null,
      canonScore: data.canonScore ?? null,
      ageRating: detailData?.rating ?? null,
      source: data.source ?? null,
      trailerUrl,
      isDetailHydrated,
      nextEpisodeNumber: detailData?.nextEpisodeNumber ?? null,
      nextEpisodeAiringAt: detailData?.nextEpisodeAiringAt ?? null,
      relations: (detailData?.relations || []).map((r) => {
        const relShortId = normalizeHoshikaShortId(r.shortId);
        return {
          relationType: r.relationType,
          shortId: relShortId,
          slug: r.slug,
          aniscrollUrl: buildAniScrollAnimeUrl(relShortId, webBase),
          title: r.title,
          format: r.format ?? null,
          coverImage: r.coverImage ?? null,
        };
      }),
      recommendations: (detailData?.recommendations || []).map((rec) => {
        const recShortId = normalizeHoshikaShortId(rec.shortId);
        return {
          shortId: recShortId,
          slug: rec.slug,
          aniscrollUrl: buildAniScrollAnimeUrl(recShortId, webBase),
          title: rec.title || rec.titleEnglish || rec.titleRomaji || 'Untitled',
          format: rec.format ?? null,
          coverImage: rec.coverImage ?? null,
          averageScore: rec.averageScore ?? null,
        };
      }),
      characters: (detailData?.characters || [])
        .filter((c) => Boolean(c?.id && c?.name))
        .map((c) => ({
          id: String(c.id),
          name: String(c.name).trim(),
          role: c.role ?? null,
          avatar: c.avatar ?? null,
        })),
      sourceUpdatedAt: new Date().toISOString(),
    };
  }

  public static normalizeEpisodes(items: unknown[]): NormalizedEpisode[] {
    return items.map((raw) => {
      const parsed = hoshikaEpisodeSchema.parse(raw);
      return {
        id: parsed.id,
        number: parsed.number,
        title: parsed.title || `Episode ${parsed.number}`,
        synopsis: parsed.synopsis ?? null,
        thumbnail: parsed.thumbnail ?? null,
        aired: parsed.aired ?? null,
        filler: parsed.filler,
        recap: parsed.recap,
        averageScore: parsed.averageScore ?? null,
      };
    });
  }

  public static validateHttpsImageUrl(url: string | null | undefined): string | null {
    if (typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed || !/^https:\/\//i.test(trimmed)) return null;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  public static cleanCharacterDescription(rawDesc: string | null | undefined): string | null {
    if (typeof rawDesc !== 'string') return null;
    const withSpoilers = rawDesc.replace(/~!([\s\S]*?)!~/g, '||$1||');
    return AnimeMetadataNormalizer.cleanSynopsis(withSpoilers);
  }

  public static normalizeCharacter(raw: any): NormalizedCharacter {
    const ch = raw?.character && typeof raw.character === 'object' ? raw.character : raw;
    const webBase = appConfig.ANISCROLL_WEB_BASE_URL;

    const rawAppearances =
      raw?.appearances?.anime ||
      ch?.appearances?.anime ||
      (Array.isArray(ch?.appearances) ? ch.appearances : null) ||
      (Array.isArray(raw?.appearances) ? raw.appearances : []);

    const altNames = new Set<string>();
    for (const field of ['alternativeNames', 'aliases', 'nicknames', 'otherNames']) {
      if (Array.isArray(ch?.[field])) {
        for (const entry of ch[field]) {
          if (typeof entry === 'string' && entry.trim()) {
            altNames.add(entry.trim());
          }
        }
      }
    }
    const primaryName =
      typeof ch?.name === 'string' && ch.name.trim()
        ? ch.name.trim()
        : typeof raw?.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : 'Unknown Character';
    if (typeof raw?.name === 'string' && raw.name.trim() && raw.name.trim() !== primaryName) {
      altNames.add(raw.name.trim());
    }

    const rawSeiyuu =
      (Array.isArray(raw?.seiyuu) ? raw.seiyuu : null) ||
      (Array.isArray(ch?.seiyuu) ? ch.seiyuu : null) ||
      (Array.isArray(raw?.voiceActors) ? raw.voiceActors : null) ||
      (Array.isArray(ch?.voiceActors) ? ch.voiceActors : []);

    const voiceActors = rawSeiyuu
      .filter((va: any) => Boolean(va && typeof va.name === 'string' && va.name.trim()))
      .map((va: any) => ({
        id: va.id ? String(va.id) : undefined,
        name: String(va.name).trim(),
        language: typeof va.language === 'string' && va.language.trim() ? va.language.trim() : null,
        avatar: AnimeMetadataNormalizer.validateHttpsImageUrl(va.avatar || va.avatarUrl || va.image || null),
        jp: typeof va.jp === 'boolean' ? va.jp : undefined,
      }));

    const appearances = Array.isArray(rawAppearances)
      ? rawAppearances
          .filter((a: any) => Boolean(a && (a.title || a.anime?.titleEnglish || a.anime?.titleRomaji)))
          .map((a: any) => {
            const shortId = normalizeHoshikaShortId(a.shortId ?? a.anime?.shortId);
            return {
              shortId,
              slug: typeof a.slug === 'string' ? a.slug : typeof a.anime?.slug === 'string' ? a.anime.slug : undefined,
              title: String(a.title || a.anime?.titleEnglish || a.anime?.titleRomaji || 'Unknown').trim(),
              role: typeof a.role === 'string' && a.role.trim() ? a.role.trim() : null,
              coverImage: AnimeMetadataNormalizer.validateHttpsImageUrl(
                a.coverImage || a.anime?.coverImage || null
              ),
              aniscrollUrl: buildAniScrollAnimeUrl(shortId, webBase),
            };
          })
      : [];

    let dateOfBirth: string | null = null;
    const rawDob = ch?.dateOfBirth ?? ch?.dob ?? null;
    if (typeof rawDob === 'string' && rawDob.trim()) {
      dateOfBirth = rawDob.trim();
    } else if (rawDob && typeof rawDob === 'object') {
      const parts = [rawDob.year, rawDob.month, rawDob.day].filter((p) => p !== null && p !== undefined);
      if (parts.length > 0) {
        dateOfBirth = parts.map((p) => String(p).padStart(2, '0')).join('-');
      }
    }

    const cleanStr = (val: unknown): string | null =>
      typeof val === 'string' && val.trim() ? val.trim() : null;
    const cleanNum = (val: unknown): number | null =>
      typeof val === 'number' && Number.isFinite(val) ? val : null;
    const cleanAge = (val: unknown): string | number | null => {
      if (typeof val === 'number' && Number.isFinite(val)) return val;
      if (typeof val === 'string' && val.trim()) return val.trim();
      return null;
    };

    return {
      id: String(ch?.id ?? raw?.id ?? ''),
      name: primaryName,
      nativeName: cleanStr(ch?.nativeName) || cleanStr(ch?.nameJapanese) || cleanStr(raw?.sub) || null,
      alternativeNames: Array.from(altNames),
      image: AnimeMetadataNormalizer.validateHttpsImageUrl(
        ch?.avatarUrl || ch?.image || ch?.avatar || raw?.image || null
      ),
      description: AnimeMetadataNormalizer.cleanCharacterDescription(ch?.description || ch?.bio || null),
      gender: cleanStr(ch?.gender),
      age: cleanAge(ch?.age),
      dateOfBirth,
      bloodType: cleanStr(ch?.bloodType),
      occupation: cleanStr(ch?.occupation),
      species: cleanStr(ch?.species),
      role: cleanStr(ch?.role) || cleanStr(raw?.role),
      favourites: cleanNum(ch?.favourites),
      popularity: cleanNum(ch?.popularity),
      voiceActors,
      appearances,
    };
  }
}
