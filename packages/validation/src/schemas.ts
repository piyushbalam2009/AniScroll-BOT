import { z } from 'zod';
import {
  MODERATION_ACTIONS,
  NOTIFICATION_TYPES,
  SUGGESTION_STATUSES,
  TICKET_CATEGORIES,
  WATCH_STATUSES,
} from '../../shared/src/types';

export const hoshikaGenreObjectSchema = z.object({
  name: z.string(),
  slug: z.string().optional(),
});

export const hoshikaAnimeSummarySchema = z.object({
  id: z.string(),
  shortId: z.number().int().positive().nullable().optional().default(null),
  slug: z.string().optional().default(''),
  titleRomaji: z.string().nullable().optional(),
  titleEnglish: z.string().nullable().optional(),
  titleJapanese: z.string().nullable().optional(),
  titleLocalized: z.string().nullable().optional(),
  synonyms: z.array(z.string()).optional(),
  alternativeTitles: z.array(z.string()).optional(),
  synopsis: z.string().nullable().optional(),
  coverImage: z.string().nullable().optional(),
  bannerImage: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  season: z.string().nullable().optional(),
  seasonYear: z.number().int().nullable().optional(),
  source: z.string().nullable().optional(),
  episodes: z.number().int().nullable().optional(),
  episodeDuration: z.number().int().nullable().optional(),
  averageScore: z.number().nullable().optional(),
  canonScore: z.number().nullable().optional(),
  trailerId: z.string().nullable().optional(),
  trailerSite: z.string().nullable().optional(),
  anilistId: z.number().int().nullable().optional(),
  anilist_id: z.number().int().nullable().optional(),
  malId: z.number().int().nullable().optional(),
  mal_id: z.number().int().nullable().optional(),
  genres: z.array(z.union([z.string(), hoshikaGenreObjectSchema])).optional().default([]),
  studios: z.array(z.union([z.string(), hoshikaGenreObjectSchema])).optional().default([]),
});

export const hoshikaAnimeDetailSchema = hoshikaAnimeSummarySchema.extend({
  rating: z.string().nullable().optional(),
  demographic: z.string().nullable().optional(),
  startedAiring: z.string().nullable().optional(),
  finishedAiring: z.string().nullable().optional(),
  nextEpisodeNumber: z.number().int().nullable().optional(),
  nextEpisodeAiringAt: z.string().nullable().optional(),
  videos: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().nullable().optional(),
        youtubeId: z.string().nullable().optional(),
        image: z.string().nullable().optional(),
      })
    )
    .optional()
    .default([]),
  relations: z
    .array(
      z.object({
        relationType: z.string(),
        shortId: z.number().int().positive().nullable().optional().default(null),
        slug: z.string().optional().default(''),
        title: z.string(),
        coverImage: z.string().nullable().optional(),
        format: z.string().nullable().optional(),
      })
    )
    .optional()
    .default([]),
  recommendations: z
    .array(
      z.object({
        shortId: z.number().int().positive().nullable().optional().default(null),
        slug: z.string().optional().default(''),
        title: z.string().optional(),
        titleRomaji: z.string().nullable().optional(),
        titleEnglish: z.string().nullable().optional(),
        coverImage: z.string().nullable().optional(),
        format: z.string().nullable().optional(),
        averageScore: z.number().nullable().optional(),
      })
    )
    .optional()
    .default([]),
  characters: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().nullable().optional(),
        role: z.string().nullable().optional(),
        avatar: z.string().nullable().optional(),
      })
    )
    .optional()
    .default([]),
});

export const hoshikaEpisodeSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string().nullable().optional(),
  synopsis: z.string().nullable().optional(),
  thumbnail: z.string().nullable().optional(),
  aired: z.string().nullable().optional(),
  filler: z.boolean().optional().default(false),
  recap: z.boolean().optional().default(false),
  averageScore: z.number().nullable().optional(),
});

export const watchlistAddSchema = z.object({
  hoshikaId: z.string().min(1),
  hoshikaShortId: z.number().int().positive().optional().nullable(),
  anilistId: z.number().int().positive().optional().nullable(),
  malId: z.number().int().positive().optional().nullable(),
  titleSnapshot: z.string().min(1).max(300),
  posterSnapshot: z.string().url().optional().nullable(),
  genresSnapshot: z.array(z.string()).default([]),
  totalEpisodes: z.number().int().positive().optional().nullable(),
  status: z.enum(WATCH_STATUSES).default('PLAN_TO_WATCH'),
  isPublic: z.boolean().default(false),
});

export const watchlistUpdateSchema = z.object({
  status: z.enum(WATCH_STATUSES).optional(),
  episodesWatched: z.number().int().min(0).optional(),
  personalRating: z.number().int().min(1).max(10).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  isPublic: z.boolean().optional(),
});

export const moderationCreateSchema = z.object({
  targetUserId: z.string().min(1),
  moderatorId: z.string().min(1),
  action: z.enum(MODERATION_ACTIONS),
  reason: z.string().min(1).max(500),
  evidence: z.string().max(1000).optional().nullable(),
  staffNotes: z.string().max(1000).optional().nullable(),
  durationMinutes: z.number().int().positive().max(43200).optional().nullable(),
});

export const warningCreateSchema = z.object({
  userId: z.string().min(1),
  moderatorId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

export const automodConfigSchema = z.object({
  enabled: z.boolean(),
  antiSpam: z.boolean(),
  spamThreshold: z.number().int().min(2).max(30),
  spamWindowSeconds: z.number().int().min(2).max(60),
  duplicateDetection: z.boolean(),
  maxMentions: z.number().int().min(1).max(50),
  blockDiscordInvites: z.boolean(),
  phishingFilter: z.boolean(),
  excessiveCapsPercent: z.number().int().min(30).max(100),
  floodDetection: z.boolean(),
  raidDetection: z.boolean(),
  raidJoinThreshold: z.number().int().min(3).max(50),
  suspiciousAccountAgeHours: z.number().int().min(0).max(720),
  attachmentRestrictions: z.boolean(),
  blockedExtensions: z.array(z.string()),
  blockedWords: z.array(z.string()),
  linkAllowlist: z.array(z.string()),
  ignoredChannelIds: z.array(z.string()),
  ignoredRoleIds: z.array(z.string()),
  punishmentMode: z.enum(['DELETE_WARN', 'DELETE_TIMEOUT', 'ESCALATE']),
  timeoutMinutes: z.number().int().min(1).max(1440),
});

export const welcomeConfigSchema = z.object({
  enabled: z.boolean(),
  channelId: z.string().nullable(),
  messageTemplate: z.string().min(1).max(1500),
  embedEnabled: z.boolean(),
  embedTitle: z.string().min(1).max(256),
  embedDescription: z.string().min(1).max(2000),
  embedColor: z.string().default('#FFFFFF'),
  embedThumbnail: z.string().url().nullable().or(z.literal('')).transform((v) => v || null),
  embedImage: z.string().url().nullable().or(z.literal('')).transform((v) => v || null),
  embedFooter: z.string().max(256).nullable().or(z.literal('')).transform((v) => v || null),
  showMemberAvatar: z.boolean().default(true),
  successCount: z.number().int().default(0),
  lastWelcomeAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  farewellEnabled: z.boolean().optional().default(false),
  farewellChannelId: z.string().nullable().optional().default(null),
  farewellTemplate: z.string().optional().default(''),
  bannerUrl: z.string().url().nullable().or(z.literal('')).transform((v) => v || null).optional().default(null),
  dmEnabled: z.boolean().optional().default(false),
  dmTemplate: z.string().optional().default(''),
  rulesChannelId: z.string().nullable().optional().default(null),
  introChannelId: z.string().nullable().optional().default(null),
});

export const musicConfigSchema = z.object({
  enabled: z.boolean(),
  djRoleIds: z.array(z.string()),
  defaultVolume: z.number().int().min(0).max(150),
  maxVolume: z.number().int().min(10).max(150),
  maxQueueSize: z.number().int().min(10).max(1000),
  autoplayEnabled: z.boolean(),
  stay247: z.boolean(),
  emptyLeaveDelaySeconds: z.number().int().min(10).max(3600),
  announceNowPlaying: z.boolean(),
});

export const animeConfigSchema = z.object({
  enabled: z.boolean(),
  aotdChannelId: z.string().nullable(),
  aotdHourUtc: z.number().int().min(0).max(23),
  locale: z.enum(['en', 'es', 'es-la', 'fr', 'de', 'pt-BR', 'ja']),
  showAniScrollLinks: z.boolean(),
  quizChannelId: z.string().nullable(),
  recommendationEnabled: z.boolean().optional().default(true),
  recommendationCooldownSeconds: z.number().int().min(3).max(600).optional().default(15),
  recommendationAnalyticsEnabled: z.boolean().optional().default(true),
  recommendationAllowedChannelIds: z.array(z.string()).optional().default([]),
  dailyEnabled: z.boolean().optional().default(false),
  dailyChannelId: z.string().nullable().optional().default(null),
  dailyHour: z.number().int().min(0).max(23).optional().default(9),
  dailyMinute: z.number().int().min(0).max(59).optional().default(0),
  dailyTimezone: z.string().optional().default('Asia/Kolkata'),
});

export const suggestionCreateSchema = z.object({
  userId: z.string().min(1),
  content: z.string().min(5).max(1000),
});

export const suggestionStatusSchema = z.object({
  status: z.enum(SUGGESTION_STATUSES),
  staffResponse: z.string().max(1000).optional().nullable(),
});

export const pollCreateSchema = z.object({
  channelId: z.string().min(1),
  creatorId: z.string().min(1),
  question: z.string().min(3).max(300),
  options: z.array(z.string().min(1).max(100)).min(2).max(10),
  allowMultiple: z.boolean().default(false),
  durationMinutes: z.number().int().min(1).max(43200),
});

export const giveawayCreateSchema = z.object({
  channelId: z.string().min(1),
  hostId: z.string().min(1),
  prize: z.string().min(2).max(250),
  winnerCount: z.number().int().min(1).max(20),
  requiredRoleId: z.string().nullable().optional(),
  minLevel: z.number().int().min(1).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(43200),
});

export const ticketCreateSchema = z.object({
  userId: z.string().min(1),
  category: z.enum(TICKET_CATEGORIES).default('GENERAL_SUPPORT'),
  subject: z.string().min(3).max(200),
});

export const reactionRolePanelSchema = z.object({
  channelId: z.string().min(1),
  title: z.string().min(2).max(150),
  description: z.string().max(500).optional().default(''),
  mode: z.enum(['BUTTON', 'SELECT', 'EMOJI']).default('BUTTON'),
  exclusive: z.boolean().default(false),
  maxSelections: z.number().int().min(1).max(25).default(1),
  roles: z
    .array(
      z.object({
        roleId: z.string().min(1),
        label: z.string().min(1).max(80),
        emoji: z.string().optional().nullable(),
      })
    )
    .min(1)
    .max(25),
});

export const notificationSendSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  destinationChannelId: z.string().min(1),
  title: z.string().min(2).max(200),
  message: z.string().min(2).max(2000),
  url: z.string().url().optional().or(z.literal('')).transform((v) => v || undefined),
});
