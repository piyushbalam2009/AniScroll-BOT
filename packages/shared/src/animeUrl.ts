export const DEFAULT_ANISCROLL_WEB_BASE_URL = 'https://aniscroll.in';

/**
 * Extracts a valid positive integer Hoshika shortId.
 * Never coerces UUID strings or substitutes external AniList/MAL IDs.
 */
export function normalizeHoshikaShortId(shortId: unknown): number | null {
  if (typeof shortId === 'number') {
    return Number.isInteger(shortId) && shortId > 0 ? shortId : null;
  }
  if (typeof shortId === 'string') {
    const trimmed = shortId.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Builds an AniScroll anime detail URL strictly from a Hoshika shortId.
 * Returns null if shortId is missing or invalid; never falls back to anilistId.
 */
export function buildAniScrollAnimeUrl(
  shortId: unknown,
  webBaseUrl: string = DEFAULT_ANISCROLL_WEB_BASE_URL
): string | null {
  const validShortId = normalizeHoshikaShortId(shortId);
  if (validShortId === null) return null;
  const base = (webBaseUrl || DEFAULT_ANISCROLL_WEB_BASE_URL).trim().replace(/\/+$/, '');
  return `${base}/anime/${validShortId}`;
}
