export interface WelcomePreviewContext {
  user?: string;
  username?: string;
  displayName?: string;
  server?: string;
  memberCount?: number | string;
  userId?: string;
  serverId?: string;
  createdAt?: string;
}

export function renderWelcomePreviewText(
  template: string | null | undefined,
  context: WelcomePreviewContext
): string {
  if (!template) return '';
  const defaults: Required<WelcomePreviewContext> = {
    user: context.user ?? '@HarukaSora',
    username: context.username ?? 'harukasora',
    displayName: context.displayName ?? 'Haruka Sora',
    server: context.server ?? 'AniScroll Community',
    memberCount: context.memberCount ?? 1284,
    userId: context.userId ?? '100000000000000042',
    serverId: context.serverId ?? '900000000000000001',
    createdAt: context.createdAt ?? '2024-03-15',
  };

  return template
    .replace(/\{user\}/g, String(defaults.user))
    .replace(/\{username\}/g, String(defaults.username))
    .replace(/\{displayName\}/g, String(defaults.displayName))
    .replace(/\{server\}/g, String(defaults.server))
    .replace(/\{memberCount\}/g, String(defaults.memberCount))
    .replace(/\{userId\}/g, String(defaults.userId))
    .replace(/\{serverId\}/g, String(defaults.serverId))
    .replace(/\{createdAt\}/g, String(defaults.createdAt));
}

export interface ModerationCaseRecord {
  id: string;
  caseNumber: number;
  action: string;
  targetUserId: string;
  moderatorId?: string;
  reason: string;
  createdAt: string;
}

export function filterModerationCases(
  cases: ModerationCaseRecord[],
  actionFilter: string,
  searchQuery: string
): ModerationCaseRecord[] {
  const normalizedAction = (actionFilter || 'ALL').trim().toUpperCase();
  const q = (searchQuery || '').trim().toLowerCase();

  return cases.filter((item) => {
    if (normalizedAction !== 'ALL' && item.action.toUpperCase() !== normalizedAction) {
      return false;
    }
    if (!q) return true;
    const caseStr = `#${item.caseNumber}`;
    return (
      caseStr.includes(q) ||
      item.targetUserId.toLowerCase().includes(q) ||
      (item.moderatorId && item.moderatorId.toLowerCase().includes(q)) ||
      item.reason.toLowerCase().includes(q) ||
      item.action.toLowerCase().includes(q)
    );
  });
}

export interface WatchlistRecord {
  id: string;
  titleSnapshot: string;
  hoshikaShortId?: number | null;
  status: string;
  episodesWatched: number;
  totalEpisodes?: number | null;
  personalRating?: number | null;
  updatedAt?: string;
  [key: string]: any;
}

export type WatchlistSortKey = 'updated' | 'title' | 'progress' | 'rating';

export function filterAndSortWatchlist(
  items: WatchlistRecord[],
  searchQuery: string,
  sortBy: WatchlistSortKey
): WatchlistRecord[] {
  const q = (searchQuery || '').trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (!q) return true;
    const titleMatch = (item.titleSnapshot || '').toLowerCase().includes(q);
    const idMatch = item.hoshikaShortId ? String(item.hoshikaShortId).includes(q) : false;
    return titleMatch || idMatch;
  });

  return [...filtered].sort((a, b) => {
    if (sortBy === 'title') {
      return (a.titleSnapshot || '').localeCompare(b.titleSnapshot || '');
    }
    if (sortBy === 'progress') {
      return (b.episodesWatched || 0) - (a.episodesWatched || 0);
    }
    if (sortBy === 'rating') {
      return (b.personalRating ?? -1) - (a.personalRating ?? -1);
    }
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return timeB - timeA;
  });
}

export function formatUptime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export interface ModuleReadinessItem {
  id: string;
  label: string;
  route: string;
  enabled: boolean;
  detail: string;
}

export function summarizeModuleReadiness(settings: any): ModuleReadinessItem[] {
  if (!settings) return [];
  const welcome = settings.welcomeConfig || {};
  const automod = settings.automodConfig || {};
  const music = settings.musicConfig || {};
  const anime = settings.animeConfig || {};
  const logging = settings.loggingConfig || {};

  const activeAutomodFilters = [
    automod.antiSpam,
    automod.duplicateDetection,
    automod.blockDiscordInvites,
    automod.phishingFilter,
    automod.floodDetection,
    automod.raidDetection,
  ].filter(Boolean).length;

  return [
    {
      id: 'welcome',
      label: 'Welcome System',
      route: '/welcome',
      enabled: Boolean(welcome.enabled && welcome.channelId),
      detail: welcome.enabled
        ? welcome.channelId
          ? `Channel #${welcome.channelId.slice(-4)} · ${welcome.embedEnabled ? 'Rich embed' : 'Plain text'}`
          : 'Enabled · Channel required'
        : 'Disabled',
    },
    {
      id: 'automod',
      label: 'AutoMod Protection',
      route: '/moderation',
      enabled: Boolean(automod.enabled),
      detail: automod.enabled
        ? `${activeAutomodFilters}/6 filters active · ${automod.punishmentMode || 'DELETE_WARN'}`
        : 'Disabled',
    },
    {
      id: 'recommendations',
      label: 'Public Recommendations',
      route: '/community',
      enabled: anime.recommendationEnabled !== false,
      detail:
        anime.recommendationEnabled !== false
          ? `Cooldown ${anime.recommendationCooldownSeconds ?? 15}s · Locale ${anime.locale || 'en'}`
          : 'Disabled',
    },
    {
      id: 'music',
      label: 'Lavalink v4 Audio',
      route: '/music',
      enabled: Boolean(music.enabled),
      detail: music.enabled
        ? `Default ${music.defaultVolume ?? 80}% vol · Max ${music.maxQueueSize ?? 200} tracks`
        : 'Disabled',
    },
    {
      id: 'logging',
      label: 'Audit & Event Logging',
      route: '/settings',
      enabled: Boolean(logging.enabled),
      detail: logging.enabled ? 'Channel audit streams active' : 'Disabled',
    },
  ];
}
