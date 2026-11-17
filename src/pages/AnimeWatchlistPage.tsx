import React, { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, Info, Plus, Search, Trash2, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { buildAniScrollAnimeUrl } from '../../packages/shared/src/animeUrl';
import { filterAndSortWatchlist, WatchlistSortKey } from '../lib/dashboardUtils';

interface AnimeWatchlistPageProps {
  guildId: string;
  onToast: (msg: string) => void;
}

const WATCH_STATUS_OPTIONS = [
  { value: 'PLAN_TO_WATCH', label: 'Plan to Watch' },
  { value: 'WATCHING', label: 'Watching' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'DROPPED', label: 'Dropped' },
];

export function AnimeWatchlistPage({ guildId, onToast }: AnimeWatchlistPageProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const [trending, setTrending] = useState<any[]>([]);
  const [selectedAnime, setSelectedAnime] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [watchlistSearch, setWatchlistSearch] = useState('');
  const [watchlistSort, setWatchlistSort] = useState<WatchlistSortKey>('updated');

  const [animeStatusInfo, setAnimeStatusInfo] = useState<any>(null);
  const [animeConfig, setAnimeConfig] = useState<any>(null);
  const [brokenPosters, setBrokenPosters] = useState<Record<string, boolean>>({});

  const loadWatchlist = useCallback(async () => {
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    const data = await apiRequest(`/api/v1/watchlist${qs}`);
    setWatchlist(data.items);
    setStats(data.stats);
  }, [statusFilter]);

  useEffect(() => {
    loadWatchlist().catch((err) => onToast(err.message));
    apiRequest('/api/v1/anime/status').then(setAnimeStatusInfo).catch(() => undefined);
    apiRequest<{ items: any[] }>('/api/v1/anime/trending')
      .then((res) => setTrending(res.items || []))
      .catch(() => undefined);
    apiRequest(`/api/v1/guilds/${guildId}/settings`)
      .then((res) => setAnimeConfig(res.settings.animeConfig))
      .catch(() => undefined);
  }, [guildId, loadWatchlist, onToast]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await apiRequest<{ items: any[]; cached: boolean }>(
        `/api/v1/anime/search?q=${encodeURIComponent(query.trim())}`
      );
      setResults(res.items);
      if (res.items.length === 0) onToast('No anime found on Hoshika.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Hoshika search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleInspectDetails = async (shortId: number | null | undefined) => {
    if (!shortId || shortId <= 0) {
      onToast('Hoshika shortId is unavailable for this entry.');
      return;
    }
    setLoadingDetails(true);
    try {
      const res = await apiRequest<{ anime: any }>(`/api/v1/anime/${shortId}`);
      setSelectedAnime(res.anime);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to load anime details.');
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleAddWatchlist = async (anime: any) => {
    try {
      await apiRequest('/api/v1/watchlist', {
        method: 'POST',
        body: JSON.stringify({
          hoshikaId: anime.hoshikaId,
          hoshikaShortId: anime.shortId ?? null,
          anilistId: anime.anilistId ?? null,
          malId: anime.malId ?? null,
          titleSnapshot: anime.titleEnglish || anime.titleRomaji || 'Untitled',
          posterSnapshot: anime.poster,
          genresSnapshot: anime.genres || [],
          totalEpisodes: anime.totalEpisodes,
          status: 'PLAN_TO_WATCH',
        }),
      });
      onToast(`Added ${anime.titleEnglish || anime.titleRomaji} to watchlist.`);
      loadWatchlist();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to add anime.');
    }
  };

  const handleUpdateEntry = async (id: string, patch: any) => {
    try {
      const res = await apiRequest(`/api/v1/watchlist/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (res.autoCompleted) onToast('Episode count reached total — marked Completed.');
      loadWatchlist();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  const handleDeleteEntry = async (id: string) => {
    await apiRequest(`/api/v1/watchlist/${id}`, { method: 'DELETE' });
    onToast('Removed entry from watchlist.');
    loadWatchlist();
  };

  const handleSaveAnimeConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!animeConfig) return;
    await apiRequest(`/api/v1/guilds/${guildId}/settings/animeConfig`, {
      method: 'PUT',
      body: JSON.stringify(animeConfig),
    });
    onToast('Anime command configuration saved.');
  };

  const renderPoster = (src: string | undefined, alt: string, keyId: string, sizeClass: string) => {
    if (!src || brokenPosters[keyId]) {
      return (
        <div
          className={`${sizeClass} bg-[#1E1E24] border border-[#27272A] rounded flex items-center justify-center text-[11px] font-mono text-[#71717A] shrink-0`}
        >
          {alt.slice(0, 2).toUpperCase()}
        </div>
      );
    }
    return (
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setBrokenPosters((prev) => ({ ...prev, [keyId]: true }))}
        className={`${sizeClass} object-cover rounded bg-[#1E1E24] shrink-0`}
      />
    );
  };

  const renderAnimeCard = (anime: any, keyPrefix: string) => {
    const title = anime.titleEnglish || anime.titleRomaji || anime.title || 'Untitled';
    const aniscrollUrl = anime.aniscrollUrl || buildAniScrollAnimeUrl(anime.shortId);
    const hasShortId = Boolean(anime.shortId && anime.shortId > 0);
    const keyId = `${keyPrefix}-${anime.hoshikaId || anime.shortId || title}`;
    return (
      <div
        key={keyId}
        className="bg-[#18181C] border border-[#27272A] rounded-md p-3.5 flex gap-3 hover:border-[#3F3F46] transition-colors"
      >
        {renderPoster(anime.poster, title, keyId, 'w-16 h-24')}
        <div className="min-w-0 flex-1 flex flex-col justify-between gap-2">
          <div>
            {aniscrollUrl ? (
              <a
                href={aniscrollUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-white hover:underline truncate block"
              >
                {title}
              </a>
            ) : (
              <h3 className="text-sm font-medium text-white truncate">{title}</h3>
            )}
            <div className="text-xs text-[#A1A1AA] font-mono tabular-nums mt-0.5">
              {anime.type || 'TV'} · {hasShortId ? `#${anime.shortId}` : 'ID unavailable'}
              {anime.rating ? ` · ${anime.rating}/100` : ''}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {aniscrollUrl ? (
              <a
                href={aniscrollUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-[#111114] border border-[#27272A] text-white rounded hover:border-white/70"
              >
                <span>Open</span>
                <ExternalLink className="w-3 h-3 text-[#A1A1AA]" />
              </a>
            ) : (
              <span className="px-2 py-1 text-[11px] text-[#71717A] font-mono">Link unavailable</span>
            )}
            {hasShortId && (
              <button
                type="button"
                onClick={() => handleInspectDetails(anime.shortId)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-[#27272A] text-[#E4E4E7] rounded hover:border-white/70 hover:text-white"
              >
                <Info className="w-3 h-3" />
                <span>Details</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleAddWatchlist(anime)}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-white text-black rounded hover:bg-[#E4E4E7]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const selectedAniScrollUrl = selectedAnime
    ? selectedAnime.aniscrollUrl || buildAniScrollAnimeUrl(selectedAnime.shortId)
    : null;

  const visibleWatchlist = filterAndSortWatchlist(watchlist, watchlistSearch, watchlistSort);

  return (
    <div className="space-y-6">
      {/* Hoshika Status + Cache TTLs */}
      {animeStatusInfo && (
        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Hoshika Direct Integration</h2>
            <p className="text-xs text-[#A1A1AA] font-mono mt-1">
              Endpoint: {animeStatusInfo.hoshika.baseUrl} · Cache: {animeStatusInfo.cache.backend} · Links: Hoshika shortId
            </p>
          </div>
          <div className="text-xs font-mono text-[#A1A1AA] tabular-nums">
            Search TTL: {animeStatusInfo.ttls.search}s · Details TTL: {animeStatusInfo.ttls.details}s
          </div>
        </div>
      )}

      {/* Live Hoshika Search Test Tool */}
      <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Live Hoshika Search Tool</h2>
          <span className="text-xs font-mono text-[#71717A]">aniscroll.in/anime/&#123;shortId&#125;</span>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <label htmlFor="hoshika-search-input" className="sr-only">
            Search Hoshika anime
          </label>
          <input
            id="hoshika-search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search live Hoshika catalog (e.g. Frieren, Naruto, Bleach)..."
            className="flex-1 bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white placeholder:text-[#71717A] focus:outline-none focus:border-white/70"
          />
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7] disabled:opacity-50 whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5" />
            <span>{searching ? 'Searching...' : 'Search Hoshika'}</span>
          </button>
        </form>

        {results.length > 0 && (
          <div
            data-testid="anime-search-results"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2"
          >
            {results.map((anime) => renderAnimeCard(anime, 'search'))}
          </div>
        )}
      </div>

      {/* Selected Anime Details, Relations & Recommendations */}
      {(loadingDetails || selectedAnime) && (
        <div
          data-testid="anime-detail-panel"
          className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-5"
        >
          {loadingDetails ? (
            <div className="h-32 bg-[#18181C] rounded animate-pulse" />
          ) : (
            selectedAnime && (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    {renderPoster(
                      selectedAnime.poster,
                      selectedAnime.titleEnglish || selectedAnime.titleRomaji || 'Anime',
                      `detail-${selectedAnime.shortId}`,
                      'w-20 h-28'
                    )}
                    <div className="min-w-0 space-y-1.5">
                      <h2 className="text-base font-semibold text-white">
                        {selectedAnime.titleEnglish || selectedAnime.titleRomaji}
                      </h2>
                      <div className="text-xs font-mono text-[#A1A1AA] tabular-nums">
                        {selectedAnime.type || 'TV'} ·{' '}
                        {selectedAnime.shortId
                          ? `Hoshika #${selectedAnime.shortId}`
                          : 'Hoshika ID unavailable'}
                        {selectedAnime.totalEpisodes ? ` · ${selectedAnime.totalEpisodes} ep` : ''}
                        {selectedAnime.rating ? ` · ${selectedAnime.rating}/100` : ''}
                      </div>
                      {selectedAnime.synopsis && (
                        <p className="text-xs text-[#D4D4D8] line-clamp-3 max-w-3xl">
                          {selectedAnime.synopsis}
                        </p>
                      )}
                      <div className="pt-1 flex flex-wrap items-center gap-2">
                        {selectedAniScrollUrl ? (
                          <a
                            href={selectedAniScrollUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white text-black rounded hover:bg-[#E4E4E7]"
                          >
                            <span>Open on AniScroll</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-xs text-[#A1A1AA]">
                            Hoshika ID unavailable — cannot generate AniScroll link
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Close anime details"
                    onClick={() => setSelectedAnime(null)}
                    className="p-1.5 border border-[#27272A] rounded text-[#A1A1AA] hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {Array.isArray(selectedAnime.recommendations) &&
                  selectedAnime.recommendations.length > 0 && (
                    <div className="space-y-2.5 pt-4 border-t border-[#27272A]">
                      <h3 className="text-xs font-semibold text-white">Similar Recommendations</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {selectedAnime.recommendations.slice(0, 8).map((rec: any) => {
                          const recUrl = rec.aniscrollUrl || buildAniScrollAnimeUrl(rec.shortId);
                          const recKey = `rec-${rec.shortId ?? rec.title}`;
                          return (
                            <div
                              key={recKey}
                              className="bg-[#18181C] border border-[#27272A] rounded-md p-3 flex items-center gap-2.5"
                            >
                              {renderPoster(rec.coverImage, rec.title || 'Rec', recKey, 'w-10 h-14')}
                              <div className="min-w-0 flex-1">
                                {recUrl ? (
                                  <a
                                    href={recUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs font-medium text-white hover:underline truncate block"
                                  >
                                    {rec.title}
                                  </a>
                                ) : (
                                  <div className="text-xs font-medium text-white truncate">
                                    {rec.title}
                                  </div>
                                )}
                                <div className="text-[11px] text-[#A1A1AA] font-mono tabular-nums mt-0.5">
                                  {rec.shortId ? `#${rec.shortId}` : 'ID missing'}
                                  {rec.averageScore ? ` · ${rec.averageScore}/100` : ''}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                {Array.isArray(selectedAnime.relations) && selectedAnime.relations.length > 0 && (
                  <div className="space-y-2.5 pt-4 border-t border-[#27272A]">
                    <h3 className="text-xs font-semibold text-white">Related Titles</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedAnime.relations.slice(0, 8).map((rel: any) => {
                        const relUrl = rel.aniscrollUrl || buildAniScrollAnimeUrl(rel.shortId);
                        return relUrl ? (
                          <a
                            key={`${rel.relationType}-${rel.shortId}`}
                            href={relUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[#18181C] border border-[#27272A] rounded hover:border-white/70 text-white"
                          >
                            <span className="text-[#A1A1AA] font-mono">{rel.relationType}</span>
                            <span>{rel.title}</span>
                            <ExternalLink className="w-3 h-3 text-[#A1A1AA]" />
                          </a>
                        ) : (
                          <span
                            key={`${rel.relationType}-${rel.title}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[#A1A1AA]"
                          >
                            <span className="font-mono">{rel.relationType}</span>
                            <span>{rel.title}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </div>
      )}

      {/* Trending Anime Discovery */}
      {trending.length > 0 && (
        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Trending on Hoshika</h2>
            <span className="text-xs font-mono text-[#71717A] tabular-nums">
              Top {Math.min(6, trending.length)} titles
            </span>
          </div>
          <div
            data-testid="anime-trending-results"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {trending.slice(0, 6).map((anime) => renderAnimeCard(anime, 'trending'))}
          </div>
        </div>
      )}

      {/* Personal Watchlist Table */}
      <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#27272A]">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Personal Watchlist ({stats?.totalEntries ?? watchlist.length})
            </h2>
            {stats && (
              <p className="text-xs text-[#A1A1AA] font-mono tabular-nums mt-0.5">
                Episodes Watched: {stats.totalEpisodesWatched} · Avg Rating:{' '}
                {stats.averageRating ?? 'N/A'}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-48">
              <Search className="w-3.5 h-3.5 text-[#71717A] absolute left-2.5 top-2 pointer-events-none" />
              <input
                type="text"
                aria-label="Filter watchlist by title or ID"
                value={watchlistSearch}
                onChange={(e) => setWatchlistSearch(e.target.value)}
                placeholder="Filter title or #ID..."
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-[#71717A] focus:outline-none focus:border-white/70"
              />
            </div>

            <select
              aria-label="Filter watchlist by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#18181C] border border-[#27272A] rounded-md px-3 py-1.5 text-xs text-white"
            >
              <option value="">All Statuses</option>
              {WATCH_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Sort watchlist"
              value={watchlistSort}
              onChange={(e) => setWatchlistSort(e.target.value as WatchlistSortKey)}
              className="bg-[#18181C] border border-[#27272A] rounded-md px-3 py-1.5 text-xs text-white"
            >
              <option value="updated">Sort: Recently Updated</option>
              <option value="title">Sort: Title A–Z</option>
              <option value="progress">Sort: Episodes Watched</option>
              <option value="rating">Sort: Personal Rating</option>
            </select>

            <a
              href="/api/v1/watchlist/export"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[#27272A] rounded-md text-[#A1A1AA] hover:text-white hover:border-white/60"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </a>
          </div>
        </div>

        {visibleWatchlist.length === 0 ? (
          <p className="text-sm text-[#A1A1AA]">
            {watchlist.length === 0
              ? 'Your watchlist is empty. Search Hoshika above to add anime.'
              : 'No watchlist entries match your title filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#27272A] text-xs text-[#71717A]">
                  <th className="py-2 pr-4 font-medium">Title</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Progress</th>
                  <th className="py-2 pr-4 font-medium">Rating</th>
                  <th className="py-2 text-right font-medium">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E1E24]">
                {visibleWatchlist.map((item) => {
                  const itemUrl =
                    item.aniscrollUrl || buildAniScrollAnimeUrl(item.hoshikaShortId);
                  return (
                    <tr key={item.id} className="hover:bg-[#18181C]/60">
                      <td className="py-3 pr-4 font-medium text-white">
                        {itemUrl ? (
                          <a
                            href={itemUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 hover:underline"
                          >
                            <span>{item.titleSnapshot}</span>
                            <ExternalLink className="w-3 h-3 text-[#A1A1AA]" />
                          </a>
                        ) : (
                          <span>{item.titleSnapshot}</span>
                        )}
                        <div className="text-[11px] text-[#71717A] font-mono tabular-nums">
                          {item.hoshikaShortId
                            ? `Hoshika #${item.hoshikaShortId}`
                            : 'Hoshika ID unavailable'}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <select
                          aria-label={`Status for ${item.titleSnapshot}`}
                          value={item.status}
                          onChange={(e) => handleUpdateEntry(item.id, { status: e.target.value })}
                          className="bg-[#18181C] border border-[#27272A] rounded px-2 py-1 text-xs text-white"
                        >
                          {WATCH_STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs tabular-nums">
                        <div className="inline-flex items-center gap-2">
                          <span>
                            {item.episodesWatched}/{item.totalEpisodes ?? '?'}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateEntry(item.id, {
                                episodesWatched: item.episodesWatched + 1,
                              })
                            }
                            className="px-2 py-0.5 border border-[#27272A] rounded hover:border-white/70"
                          >
                            +1 Ep
                          </button>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <select
                          aria-label={`Rating for ${item.titleSnapshot}`}
                          value={item.personalRating ?? ''}
                          onChange={(e) =>
                            handleUpdateEntry(item.id, {
                              personalRating: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          className="bg-[#18181C] border border-[#27272A] rounded px-2 py-1 text-xs text-white font-mono"
                        >
                          <option value="">—</option>
                          {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>
                              {n}/10
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          aria-label={`Remove ${item.titleSnapshot}`}
                          onClick={() => handleDeleteEntry(item.id)}
                          className="p-1.5 text-[#A1A1AA] hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Guild Anime Command Configuration */}
      {animeConfig && (
        <form
          onSubmit={handleSaveAnimeConfig}
          className="bg-[#111114] border border-[#27272A] rounded-lg p-5 flex flex-wrap items-end gap-4"
        >
          <div>
            <label htmlFor="anime-locale" className="block text-xs text-[#A1A1AA] mb-1">
              Hoshika Metadata Locale
            </label>
            <select
              id="anime-locale"
              value={animeConfig.locale}
              onChange={(e) => setAnimeConfig({ ...animeConfig, locale: e.target.value })}
              className="bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
            >
              <option value="en">English (en)</option>
              <option value="ja">Japanese (ja)</option>
              <option value="es">Spanish (es)</option>
              <option value="fr">French (fr)</option>
              <option value="de">German (de)</option>
              <option value="pt-BR">Portuguese BR (pt-BR)</option>
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-xs pb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={animeConfig.showAniScrollLinks}
              onChange={(e) =>
                setAnimeConfig({ ...animeConfig, showAniScrollLinks: e.target.checked })
              }
              className="accent-white"
            />
            <span>Include Verified AniScroll Links</span>
          </label>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7]"
          >
            Save Anime Settings
          </button>
        </form>
      )}
    </div>
  );
}
