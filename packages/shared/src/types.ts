export const BRAND_THEME = {
  background: 0x000000,
  surfacePrimary: 0x111111,
  surfaceSecondary: 0x181818,
  surfaceElevated: 0x222222,
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A0',
  border: '#2A2A2A',
  success: 0x16a34a,
  warning: 0xd97706,
  error: 0xdc2626,
  embedHex: 0x111111,
} as const;

export const WATCH_STATUSES = [
  'PLAN_TO_WATCH',
  'WATCHING',
  'COMPLETED',
  'ON_HOLD',
  'DROPPED',
] as const;

export type WatchStatus = (typeof WATCH_STATUSES)[number];

export const WATCH_STATUS_LABELS: Record<WatchStatus, string> = {
  PLAN_TO_WATCH: 'Plan to Watch',
  WATCHING: 'Watching',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  DROPPED: 'Dropped',
};

export const WEBSITE_WATCH_STATUSES = [
  'watching',
  'plan_to_watch',
  'completed',
  'on_hold',
  'dropped',
] as const;

export type WebsiteWatchStatus = (typeof WEBSITE_WATCH_STATUSES)[number];

export const WEBSITE_WATCH_STATUS_LABELS: Record<WebsiteWatchStatus, string> = {
  watching: 'Watching',
  plan_to_watch: 'Plan to Watch',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
};

export function normalizeWebsiteWatchStatus(
  status: string | null | undefined
): WebsiteWatchStatus | null {
  if (!status || typeof status !== 'string') return null;
  const normalized = status.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((WEBSITE_WATCH_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as WebsiteWatchStatus;
  }
  return null;
}

export interface WebsiteWatchlistItem {
  id: string;
  discordUserId?: string;
  firebaseUid?: string;
  shortId: number;
  hoshikaId?: string | null;
  anilistId?: number | null;
  malId?: number | null;
  title: string;
  titleRomaji?: string | null;
  poster?: string | null;
  format?: string | null;
  seasonYear?: number | null;
  genres: string[];
  status: WebsiteWatchStatus;
  episodesWatched: number;
  totalEpisodes: number | null;
  rating: number | null;
  notes?: string | null;
  aniscrollUrl: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface WebsiteWatchlistStats {
  totalEntries: number;
  totalEpisodesWatched: number;
  averageRating: number | null;
  ratedCount: number;
  completionRate: number;
  byStatus: Record<WebsiteWatchStatus, number>;
  topGenres: Array<{ genre: string; count: number }>;
}

export const MODERATION_ACTIONS = [
  'WARN',
  'TIMEOUT',
  'UNTIMEOUT',
  'KICK',
  'BAN',
  'TEMP_BAN',
  'UNBAN',
  'SOFTBAN',
  'AUTOMOD_DELETE',
  'AUTOMOD_TIMEOUT',
] as const;

export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const SUGGESTION_STATUSES = [
  'PENDING',
  'UNDER_CONSIDERATION',
  'APPROVED',
  'REJECTED',
  'IMPLEMENTED',
] as const;

export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const TICKET_CATEGORIES = [
  'GENERAL_SUPPORT',
  'BUG_REPORT',
  'FEATURE_REQUEST',
  'PARTNERSHIP',
  'STAFF_APPLICATION',
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const NOTIFICATION_TYPES = [
  'WEBSITE_RELEASE',
  'FEATURE_RELEASE',
  'MAINTENANCE',
  'SERVICE_STATUS',
  'COMMUNITY_ANNOUNCEMENT',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NormalizedAnime {
  hoshikaId: string;
  shortId: number | null;
  slug: string;
  aniscrollUrl?: string | null;
  anilistId?: number | null;
  malId?: number | null;
  titleEnglish?: string | null;
  titleRomaji?: string | null;
  titleNative?: string | null;
  alternativeTitles: string[];
  synopsis?: string | null;
  poster?: string | null;
  banner?: string | null;
  genres: string[];
  studios: string[];
  releaseYear?: number | null;
  season?: string | null;
  type?: string | null;
  status?: string | null;
  totalEpisodes?: number | null;
  episodeDuration?: number | null;
  rating?: number | null;
  canonScore?: number | null;
  ageRating?: string | null;
  source?: string | null;
  trailerUrl?: string | null;
  isDetailHydrated?: boolean;
  nextEpisodeNumber?: number | null;
  nextEpisodeAiringAt?: string | null;
  relations: Array<{
    relationType: string;
    shortId: number | null;
    slug: string;
    aniscrollUrl?: string | null;
    title: string;
    format?: string | null;
    coverImage?: string | null;
  }>;
  recommendations: Array<{
    shortId: number | null;
    slug: string;
    aniscrollUrl?: string | null;
    title: string;
    format?: string | null;
    coverImage?: string | null;
    averageScore?: number | null;
  }>;
  characters?: NormalizedAnimeCharacterRef[];
  sourceUpdatedAt?: string | null;
}

export interface NormalizedAnimeCharacterRef {
  id: string;
  name: string;
  role?: string | null;
  avatar?: string | null;
}

export interface CharacterGuessCandidate {
  characterId: string;
  characterName: string;
  alternativeNames: string[];
  characterImageUrl: string;
  animeShortId: number;
  animeTitle: string;
  role?: string | null;
}

export interface NormalizedEpisode {
  id: string;
  number: number;
  title: string;
  synopsis?: string | null;
  thumbnail?: string | null;
  aired?: string | null;
  filler: boolean;
  recap: boolean;
  averageScore?: number | null;
}

export interface NormalizedCharacter {
  id: string;
  name: string;
  nativeName?: string | null;
  alternativeNames?: string[];
  image?: string | null;
  description?: string | null;
  appearances: Array<{
    shortId?: number;
    title: string;
    role?: string | null;
  }>;
}

export interface WelcomeConfig {
  enabled: boolean;
  channelId: string | null;
  messageTemplate: string;
  embedEnabled: boolean;
  embedTitle: string;
  embedDescription: string;
  embedColor: string;
  embedThumbnail: string | null;
  embedImage: string | null;
  embedFooter: string | null;
  showMemberAvatar: boolean;
  successCount: number;
  lastWelcomeAt: string | null;
  lastError: string | null;
  farewellEnabled: boolean;
  farewellChannelId: string | null;
  farewellTemplate: string;
  bannerUrl: string | null;
  dmEnabled: boolean;
  dmTemplate: string;
  rulesChannelId?: string | null;
  introChannelId?: string | null;
}

export interface EscalationStep {
  threshold: number;
  action: 'WARN' | 'TIMEOUT' | 'STAFF_REVIEW';
  durationMinutes?: number;
}

export interface ModerationConfig {
  modLogChannelId: string | null;
  appealChannelId: string | null;
  staffRoleIds: string[];
  dmOnPunishment: boolean;
  escalation: EscalationStep[];
}

export interface AutomodConfig {
  enabled: boolean;
  antiSpam: boolean;
  spamThreshold: number;
  spamWindowSeconds: number;
  duplicateDetection: boolean;
  maxMentions: number;
  blockDiscordInvites: boolean;
  phishingFilter: boolean;
  excessiveCapsPercent: number;
  floodDetection: boolean;
  raidDetection: boolean;
  raidJoinThreshold: number;
  suspiciousAccountAgeHours: number;
  attachmentRestrictions: boolean;
  blockedExtensions: string[];
  blockedWords: string[];
  linkAllowlist: string[];
  ignoredChannelIds: string[];
  ignoredRoleIds: string[];
  punishmentMode: 'DELETE_WARN' | 'DELETE_TIMEOUT' | 'ESCALATE';
  timeoutMinutes: number;
}

export interface MusicConfig {
  enabled: boolean;
  djRoleIds: string[];
  defaultVolume: number;
  maxVolume: number;
  maxQueueSize: number;
  autoplayEnabled: boolean;
  stay247: boolean;
  emptyLeaveDelaySeconds: number;
  announceNowPlaying: boolean;
}

export interface AnimeConfig {
  enabled: boolean;
  aotdChannelId: string | null;
  aotdHourUtc: number;
  locale: 'en' | 'es' | 'es-la' | 'fr' | 'de' | 'pt-BR' | 'ja';
  showAniScrollLinks: boolean;
  quizChannelId: string | null;
  recommendationEnabled?: boolean;
  recommendationCooldownSeconds?: number;
  recommendationAnalyticsEnabled?: boolean;
  recommendationAllowedChannelIds?: string[];
}

export interface LoggingConfig {
  enabled: boolean;
  messageLogChannelId: string | null;
  memberLogChannelId: string | null;
  moderationLogChannelId: string | null;
  ticketLogChannelId: string | null;
  commandLogChannelId: string | null;
}

export interface NotificationConfig {
  enabled: boolean;
  defaultChannelId: string | null;
  categories: Record<NotificationType, string | null>;
}

export interface CommunityConfig {
  suggestionsChannelId: string | null;
  ticketsCategoryId: string | null;
  ticketsStaffRoleIds: string[];
  levelingEnabled: boolean;
  xpPerMessage: number;
  xpCooldownSeconds: number;
  levelUpChannelId: string | null;
  levelRoleRewards: Array<{ level: number; roleId: string }>;
}

export interface AllGuildSettings {
  welcomeConfig: WelcomeConfig;
  moderationConfig: ModerationConfig;
  automodConfig: AutomodConfig;
  musicConfig: MusicConfig;
  animeConfig: AnimeConfig;
  loggingConfig: LoggingConfig;
  notificationConfig: NotificationConfig;
  communityConfig: CommunityConfig;
}

export const DEFAULT_GUILD_SETTINGS: AllGuildSettings = {
  welcomeConfig: {
    enabled: false,
    channelId: null,
    messageTemplate: 'Welcome to **{server}**, {user}! 🎉',
    embedEnabled: true,
    embedTitle: 'Welcome to {server}',
    embedDescription:
      "Welcome to **{server}**, {user}! 🎉\n\nYou're member #{memberCount}.\n\nWelcome to the AniScroll community! Enjoy anime discussions, recommendations, and everything anime.",
    embedColor: '#FFFFFF',
    embedThumbnail: null,
    embedImage: null,
    embedFooter: 'AniScroll · Community Welcome',
    showMemberAvatar: true,
    successCount: 0,
    lastWelcomeAt: null,
    lastError: null,
    farewellEnabled: false,
    farewellChannelId: null,
    farewellTemplate: '{username} has left {server}.',
    bannerUrl: null,
    dmEnabled: false,
    dmTemplate: 'Welcome to {server}! Use /anime search or /watchlist show to get started.',
    rulesChannelId: null,
    introChannelId: null,
  },
  moderationConfig: {
    modLogChannelId: null,
    appealChannelId: null,
    staffRoleIds: [],
    dmOnPunishment: true,
    escalation: [
      { threshold: 1, action: 'WARN' },
      { threshold: 2, action: 'TIMEOUT', durationMinutes: 5 },
      { threshold: 3, action: 'TIMEOUT', durationMinutes: 30 },
      { threshold: 4, action: 'TIMEOUT', durationMinutes: 1440 },
      { threshold: 5, action: 'STAFF_REVIEW' },
    ],
  },
  automodConfig: {
    enabled: true,
    antiSpam: true,
    spamThreshold: 5,
    spamWindowSeconds: 6,
    duplicateDetection: true,
    maxMentions: 5,
    blockDiscordInvites: true,
    phishingFilter: true,
    excessiveCapsPercent: 75,
    floodDetection: true,
    raidDetection: true,
    raidJoinThreshold: 8,
    suspiciousAccountAgeHours: 24,
    attachmentRestrictions: false,
    blockedExtensions: ['.exe', '.scr', '.bat', '.vbs'],
    blockedWords: [],
    linkAllowlist: ['aniscroll.in', 'hoshika.app', 'discord.com'],
    ignoredChannelIds: [],
    ignoredRoleIds: [],
    punishmentMode: 'DELETE_WARN',
    timeoutMinutes: 10,
  },
  musicConfig: {
    enabled: true,
    djRoleIds: [],
    defaultVolume: 65,
    maxVolume: 120,
    maxQueueSize: 250,
    autoplayEnabled: false,
    stay247: false,
    emptyLeaveDelaySeconds: 180,
    announceNowPlaying: true,
  },
  animeConfig: {
    enabled: true,
    aotdChannelId: null,
    aotdHourUtc: 14,
    locale: 'en',
    showAniScrollLinks: true,
    quizChannelId: null,
    recommendationEnabled: true,
    recommendationCooldownSeconds: 15,
    recommendationAnalyticsEnabled: true,
    recommendationAllowedChannelIds: [],
  },
  loggingConfig: {
    enabled: true,
    messageLogChannelId: null,
    memberLogChannelId: null,
    moderationLogChannelId: null,
    ticketLogChannelId: null,
    commandLogChannelId: null,
  },
  notificationConfig: {
    enabled: true,
    defaultChannelId: null,
    categories: {
      WEBSITE_RELEASE: null,
      FEATURE_RELEASE: null,
      MAINTENANCE: null,
      SERVICE_STATUS: null,
      COMMUNITY_ANNOUNCEMENT: null,
    },
  },
  communityConfig: {
    suggestionsChannelId: null,
    ticketsCategoryId: null,
    ticketsStaffRoleIds: [],
    levelingEnabled: true,
    xpPerMessage: 20,
    xpCooldownSeconds: 60,
    levelUpChannelId: null,
    levelRoleRewards: [],
  },
};

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly userMessage: string;

  constructor(code: string, userMessage: string, statusCode = 400, detail?: string) {
    super(detail || userMessage);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
  }
}

export const ERROR_CODES = {
  ANIME_NOT_FOUND: 'ANIME_NOT_FOUND',
  HOSHIKA_UNAVAILABLE: 'HOSHIKA_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  MUSIC_SOURCE_UNAVAILABLE: 'MUSIC_SOURCE_UNAVAILABLE',
  USER_NOT_IN_VOICE: 'USER_NOT_IN_VOICE',
  BOT_MISSING_PERMISSIONS: 'BOT_MISSING_PERMISSIONS',
  USER_MISSING_PERMISSIONS: 'USER_MISSING_PERMISSIONS',
  LAVALINK_DISCONNECTED: 'LAVALINK_DISCONNECTED',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  INVALID_ANIME_ID: 'INVALID_ANIME_ID',
  DUPLICATE_WATCHLIST: 'DUPLICATE_WATCHLIST',
  DISCORD_NOT_LINKED: 'DISCORD_NOT_LINKED',
  WEBSITE_API_UNAVAILABLE: 'WEBSITE_API_UNAVAILABLE',
  TICKET_ALREADY_CLOSED: 'TICKET_ALREADY_CLOSED',
  INTERACTION_EXPIRED: 'INTERACTION_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;
