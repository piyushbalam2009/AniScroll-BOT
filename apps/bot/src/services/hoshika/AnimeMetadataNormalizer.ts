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

  public static normalizeCharacter(raw: any): NormalizedCharacter {
    const ch = raw?.character || raw;
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

    return {
      id: String(ch?.id ?? ''),
      name: ch?.name || 'Unknown Character',
      nativeName: ch?.nativeName || ch?.nameJapanese || ch?.sub || null,
      alternativeNames: Array.from(altNames),
      image: ch?.avatarUrl || ch?.image || ch?.avatar || null,
      description: ch?.description || ch?.bio || null,
      appearances: Array.isArray(rawAppearances)
        ? rawAppearances.map((a: any) => ({
            shortId: a.shortId ?? a.anime?.shortId,
            title: a.title || a.anime?.titleEnglish || a.anime?.titleRomaji || 'Unknown',
            role: a.role ?? null,
          }))
        : [],
    };
  }
}
