import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  AllGuildSettings,
  AppError,
  DEFAULT_GUILD_SETTINGS,
  ERROR_CODES,
  ModerationAction,
  NotificationType,
  SuggestionStatus,
  TicketCategory,
  WatchStatus,
} from '../../shared/src/types';

export interface WatchlistRecord {
  id: string;
  discordUserId: string;
  hoshikaId: string;
  hoshikaShortId: number | null;
  anilistId: number | null;
  malId: number | null;
  titleSnapshot: string;
  posterSnapshot: string | null;
  genresSnapshot: string[];
  totalEpisodes: number | null;
  status: WatchStatus;
  episodesWatched: number;
  personalRating: number | null;
  notes: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GuildRecord {
  id: string;
  discordGuildId: string;
  name: string;
  icon: string | null;
  memberCount: number;
  botInstalled: boolean;
  channels: Array<{ id: string; name: string; type: 'text' | 'category' | 'voice' }>;
  roles: Array<{ id: string; name: string; position: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationCaseRecord {
  id: string;
  caseNumber: number;
  guildId: string;
  targetUserId: string;
  moderatorId: string;
  action: ModerationAction;
  reason: string;
  evidence: string | null;
  staffNotes: string | null;
  appealStatus: string | null;
  appealText: string | null;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface WarningRecord {
  id: string;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  active: boolean;
  createdAt: string;
}

export interface SuggestionRecord {
  id: string;
  guildId: string;
  userId: string;
  messageId: string | null;
  content: string;
  contentHash: string;
  status: SuggestionStatus;
  upvotes: number;
  downvotes: number;
  voterIds: Record<string, 'up' | 'down'>;
  staffResponse: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketRecord {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  category: TicketCategory;
  subject: string | null;
  assignedStaffId: string | null;
  status: 'OPEN' | 'CLAIMED' | 'CLOSED';
  transcriptUrl: string | null;
  transcriptText: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface PollRecord {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  creatorId: string;
  question: string;
  options: string[];
  votes: Record<string, number[]>;
  allowMultiple: boolean;
  closed: boolean;
  endsAt: string;
  createdAt: string;
}

export interface GiveawayRecord {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  hostId: string;
  prize: string;
  winnerCount: number;
  requiredRoleId: string | null;
  minLevel: number | null;
  entrants: string[];
  winnerIds: string[];
  ended: boolean;
  endsAt: string;
  createdAt: string;
}

export interface ReactionRolePanelRecord {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string;
  mode: 'BUTTON' | 'SELECT' | 'EMOJI';
  exclusive: boolean;
  maxSelections: number;
  roles: Array<{ roleId: string; label: string; emoji?: string | null }>;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRecord {
  id: string;
  guildId: string;
  type: NotificationType;
  destinationChannelId: string;
  title: string;
  payload: Record<string, unknown>;
  deliveryStatus: string;
  errorMessage: string | null;
  dedupeKey: string | null;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  guildId: string;
  actorId: string;
  action: string;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface UserProfileRecord {
  discordUserId: string;
  username: string;
  favoriteAnime: string[];
  preferredGenres: string[];
  experiencePoints: number;
  level: number;
  quizStatistics: { played: number; won: number; score: number };
  birthday: string | null;
  updatedAt: string;
}

export interface CommunityRecommendationRecord {
  id: string;
  guildId: string;
  channelId: string;
  discordUserId: string;
  username: string;
  hoshikaShortId: number;
  animeTitle: string;
  messageId: string | null;
  createdAt: string;
}

export class AniScrollDatabase {
  public readonly sqlite: Database.Database;

  constructor(dbPath: string = process.env.SQLITE_DB_PATH || './data/aniscroll.db') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        discord_id TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        avatar TEXT,
        preferences TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guilds (
        id TEXT PRIMARY KEY,
        discord_guild_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        icon TEXT,
        member_count INTEGER NOT NULL DEFAULT 0,
        bot_installed INTEGER NOT NULL DEFAULT 1,
        channels_json TEXT NOT NULL DEFAULT '[]',
        roles_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guild_settings (
        id TEXT PRIMARY KEY,
        guild_id TEXT UNIQUE NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        welcome_config TEXT NOT NULL,
        moderation_config TEXT NOT NULL,
        automod_config TEXT NOT NULL,
        music_config TEXT NOT NULL,
        anime_config TEXT NOT NULL,
        logging_config TEXT NOT NULL,
        notification_config TEXT NOT NULL,
        community_config TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS watchlist (
        id TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        hoshika_id TEXT NOT NULL,
        hoshika_short_id INTEGER,
        anilist_id INTEGER,
        mal_id INTEGER,
        title_snapshot TEXT NOT NULL,
        poster_snapshot TEXT,
        genres_snapshot TEXT NOT NULL DEFAULT '[]',
        total_episodes INTEGER,
        status TEXT NOT NULL DEFAULT 'PLAN_TO_WATCH',
        episodes_watched INTEGER NOT NULL DEFAULT 0,
        personal_rating INTEGER,
        notes TEXT,
        is_public INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(discord_user_id, hoshika_id)
      );
      CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(discord_user_id);
      CREATE INDEX IF NOT EXISTS idx_watchlist_user_status ON watchlist(discord_user_id, status);

      CREATE TABLE IF NOT EXISTS moderation_cases (
        id TEXT PRIMARY KEY,
        case_number INTEGER NOT NULL,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        target_user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence TEXT,
        staff_notes TEXT,
        appeal_status TEXT,
        appeal_text TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(guild_id, case_number)
      );
      CREATE INDEX IF NOT EXISTS idx_cases_guild_target ON moderation_cases(guild_id, target_user_id);

      CREATE TABLE IF NOT EXISTS warnings (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON warnings(guild_id, user_id);

      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        channel_id TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        subject TEXT,
        assigned_staff_id TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN',
        transcript_url TEXT,
        transcript_text TEXT,
        created_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS suggestions (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        message_id TEXT,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        upvotes INTEGER NOT NULL DEFAULT 0,
        downvotes INTEGER NOT NULL DEFAULT 0,
        voter_ids TEXT NOT NULL DEFAULT '{}',
        staff_response TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(guild_id, content_hash)
      );

      CREATE TABLE IF NOT EXISTS polls (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        creator_id TEXT NOT NULL,
        question TEXT NOT NULL,
        options TEXT NOT NULL DEFAULT '[]',
        votes TEXT NOT NULL DEFAULT '{}',
        allow_multiple INTEGER NOT NULL DEFAULT 0,
        closed INTEGER NOT NULL DEFAULT 0,
        ends_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS giveaways (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        host_id TEXT NOT NULL,
        prize TEXT NOT NULL,
        winner_count INTEGER NOT NULL DEFAULT 1,
        required_role_id TEXT,
        min_level INTEGER,
        entrants TEXT NOT NULL DEFAULT '[]',
        winner_ids TEXT NOT NULL DEFAULT '[]',
        ended INTEGER NOT NULL DEFAULT 0,
        ends_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reaction_role_panels (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'BUTTON',
        exclusive INTEGER NOT NULL DEFAULT 0,
        max_selections INTEGER NOT NULL DEFAULT 1,
        roles TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS music_playlists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        tracks TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        UNIQUE(user_id, name)
      );

      CREATE TABLE IF NOT EXISTS user_profiles (
        discord_user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL DEFAULT 'Member',
        favorite_anime TEXT NOT NULL DEFAULT '[]',
        preferred_genres TEXT NOT NULL DEFAULT '[]',
        experience_points INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        quiz_statistics TEXT NOT NULL DEFAULT '{"played":0,"won":0,"score":0}',
        birthday TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        destination_channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        payload TEXT NOT NULL,
        delivery_status TEXT NOT NULL DEFAULT 'PENDING',
        error_message TEXT,
        dedupe_key TEXT UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_id TEXT,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS command_metrics (
        id TEXT PRIMARY KEY,
        guild_id TEXT,
        command_name TEXT NOT NULL,
        category TEXT NOT NULL,
        user_id TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 1,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS anime_search_metrics (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        hoshika_id TEXT,
        title TEXT,
        genres TEXT NOT NULL DEFAULT '[]',
        user_id TEXT NOT NULL,
        guild_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        guild_id TEXT,
        channel_id TEXT NOT NULL,
        message TEXT NOT NULL,
        remind_at TEXT NOT NULL,
        sent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS afk_statuses (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        since TEXT NOT NULL,
        UNIQUE(guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS community_recommendations (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT 'Member',
        hoshika_short_id INTEGER NOT NULL,
        anime_title TEXT NOT NULL,
        message_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_comm_rec_guild_created ON community_recommendations(guild_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_comm_rec_guild_anime ON community_recommendations(guild_id, hoshika_short_id);
      CREATE INDEX IF NOT EXISTS idx_comm_rec_guild_user ON community_recommendations(guild_id, discord_user_id);
    `);
  }

  private now() {
    return new Date().toISOString();
  }

  public getUserByDiscordId(discordId: string): { id: string; discordId: string; username: string; avatar: string | null } | null {
    const r = this.sqlite
      .prepare('SELECT id, discord_id, username, avatar FROM users WHERE discord_id = ?')
      .get(discordId) as { id: string; discord_id: string; username: string; avatar: string | null } | undefined;
    if (!r) return null;
    return {
      id: r.id,
      discordId: r.discord_id,
      username: r.username,
      avatar: r.avatar,
    };
  }

  public upsertUser(discordId: string, username: string, avatar?: string | null) {
    const now = this.now();
    const existing = this.sqlite
      .prepare('SELECT id FROM users WHERE discord_id = ?')
      .get(discordId) as { id: string } | undefined;
    if (existing) {
      this.sqlite
        .prepare('UPDATE users SET username = ?, avatar = ?, updated_at = ? WHERE discord_id = ?')
        .run(username, avatar ?? null, now, discordId);
      return existing.id;
    }
    const id = crypto.randomUUID();
    this.sqlite
      .prepare(
        'INSERT INTO users (id, discord_id, username, avatar, preferences, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, discordId, username, avatar ?? null, '{}', now, now);
    return id;
  }

  public ensureGuild(input: {
    discordGuildId: string;
    name: string;
    icon?: string | null;
    memberCount?: number;
    botInstalled?: boolean;
    channels?: GuildRecord['channels'];
    roles?: GuildRecord['roles'];
  }): GuildRecord {
    const now = this.now();
    const existing = this.sqlite
      .prepare('SELECT * FROM guilds WHERE discord_guild_id = ?')
      .get(input.discordGuildId) as any;

    if (existing) {
      this.sqlite
        .prepare(
          'UPDATE guilds SET name = ?, icon = ?, member_count = ?, bot_installed = ?, channels_json = ?, roles_json = ?, updated_at = ? WHERE id = ?'
        )
        .run(
          input.name,
          input.icon ?? existing.icon,
          input.memberCount ?? existing.member_count,
          input.botInstalled !== undefined ? (input.botInstalled ? 1 : 0) : existing.bot_installed,
          input.channels ? JSON.stringify(input.channels) : existing.channels_json,
          input.roles ? JSON.stringify(input.roles) : existing.roles_json,
          now,
          existing.id
        );
      return this.getGuildByDiscordId(input.discordGuildId)!;
    }

    const id = crypto.randomUUID();
    const defaultChannels = input.channels || [
      { id: '110000000000000001', name: 'announcements', type: 'text' },
      { id: '110000000000000002', name: 'welcome', type: 'text' },
      { id: '110000000000000003', name: 'mod-logs', type: 'text' },
      { id: '110000000000000004', name: 'suggestions', type: 'text' },
      { id: '110000000000000005', name: 'anime-releases', type: 'text' },
      { id: '110000000000000006', name: 'Voice Lounge', type: 'voice' },
    ];
    const defaultRoles = input.roles || [
      { id: '210000000000000001', name: 'Admin', position: 10 },
      { id: '210000000000000002', name: 'Moderator', position: 8 },
      { id: '210000000000000003', name: 'DJ', position: 6 },
      { id: '210000000000000004', name: 'Anime Club', position: 4 },
      { id: '210000000000000005', name: 'Release Ping', position: 2 },
    ];

    this.sqlite
      .prepare(
        'INSERT INTO guilds (id, discord_guild_id, name, icon, member_count, bot_installed, channels_json, roles_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        input.discordGuildId,
        input.name,
        input.icon ?? null,
        input.memberCount ?? 0,
        input.botInstalled === false ? 0 : 1,
        JSON.stringify(defaultChannels),
        JSON.stringify(defaultRoles),
        now,
        now
      );

    this.sqlite
      .prepare(
        `INSERT INTO guild_settings (id, guild_id, welcome_config, moderation_config, automod_config, music_config, anime_config, logging_config, notification_config, community_config, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        id,
        JSON.stringify(DEFAULT_GUILD_SETTINGS.welcomeConfig),
        JSON.stringify(DEFAULT_GUILD_SETTINGS.moderationConfig),
        JSON.stringify(DEFAULT_GUILD_SETTINGS.automodConfig),
        JSON.stringify(DEFAULT_GUILD_SETTINGS.musicConfig),
        JSON.stringify(DEFAULT_GUILD_SETTINGS.animeConfig),
        JSON.stringify(DEFAULT_GUILD_SETTINGS.loggingConfig),
        JSON.stringify(DEFAULT_GUILD_SETTINGS.notificationConfig),
        JSON.stringify(DEFAULT_GUILD_SETTINGS.communityConfig),
        now
      );

    return this.getGuildByDiscordId(input.discordGuildId)!;
  }

  public listGuilds(): GuildRecord[] {
    const rows = this.sqlite.prepare('SELECT * FROM guilds ORDER BY member_count DESC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      discordGuildId: r.discord_guild_id,
      name: r.name,
      icon: r.icon,
      memberCount: r.member_count,
      botInstalled: Boolean(r.bot_installed),
      channels: JSON.parse(r.channels_json || '[]'),
      roles: JSON.parse(r.roles_json || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public getGuildByDiscordId(discordGuildId: string): GuildRecord | null {
    const r = this.sqlite
      .prepare('SELECT * FROM guilds WHERE discord_guild_id = ?')
      .get(discordGuildId) as any;
    if (!r) return null;
    return {
      id: r.id,
      discordGuildId: r.discord_guild_id,
      name: r.name,
      icon: r.icon,
      memberCount: r.member_count,
      botInstalled: Boolean(r.bot_installed),
      channels: JSON.parse(r.channels_json || '[]'),
      roles: JSON.parse(r.roles_json || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public getGuildSettings(discordGuildId: string): AllGuildSettings {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    }
    const row = this.sqlite
      .prepare('SELECT * FROM guild_settings WHERE guild_id = ?')
      .get(guild.id) as any;
    if (!row) return structuredClone(DEFAULT_GUILD_SETTINGS);
    return {
      welcomeConfig: { ...DEFAULT_GUILD_SETTINGS.welcomeConfig, ...JSON.parse(row.welcome_config) },
      moderationConfig: { ...DEFAULT_GUILD_SETTINGS.moderationConfig, ...JSON.parse(row.moderation_config) },
      automodConfig: { ...DEFAULT_GUILD_SETTINGS.automodConfig, ...JSON.parse(row.automod_config) },
      musicConfig: { ...DEFAULT_GUILD_SETTINGS.musicConfig, ...JSON.parse(row.music_config) },
      animeConfig: { ...DEFAULT_GUILD_SETTINGS.animeConfig, ...JSON.parse(row.anime_config) },
      loggingConfig: { ...DEFAULT_GUILD_SETTINGS.loggingConfig, ...JSON.parse(row.logging_config) },
      notificationConfig: { ...DEFAULT_GUILD_SETTINGS.notificationConfig, ...JSON.parse(row.notification_config) },
      communityConfig: { ...DEFAULT_GUILD_SETTINGS.communityConfig, ...JSON.parse(row.community_config) },
    };
  }

  public updateGuildSettingsSection<K extends keyof AllGuildSettings>(
    discordGuildId: string,
    section: K,
    payload: AllGuildSettings[K],
    actorId: string
  ): AllGuildSettings {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    }
    const columnMap: Record<keyof AllGuildSettings, string> = {
      welcomeConfig: 'welcome_config',
      moderationConfig: 'moderation_config',
      automodConfig: 'automod_config',
      musicConfig: 'music_config',
      animeConfig: 'anime_config',
      loggingConfig: 'logging_config',
      notificationConfig: 'notification_config',
      communityConfig: 'community_config',
    };
    const col = columnMap[section];
    const now = this.now();
    const res = this.sqlite
      .prepare(`UPDATE guild_settings SET ${col} = ?, updated_at = ? WHERE guild_id = ?`)
      .run(JSON.stringify(payload), now, guild.id);
    if (res.changes === 0) {
      this.sqlite
        .prepare(
          `INSERT INTO guild_settings (id, guild_id, welcome_config, moderation_config, automod_config, music_config, anime_config, logging_config, notification_config, community_config, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          guild.id,
          JSON.stringify(DEFAULT_GUILD_SETTINGS.welcomeConfig),
          JSON.stringify(DEFAULT_GUILD_SETTINGS.moderationConfig),
          JSON.stringify(DEFAULT_GUILD_SETTINGS.automodConfig),
          JSON.stringify(DEFAULT_GUILD_SETTINGS.musicConfig),
          JSON.stringify(DEFAULT_GUILD_SETTINGS.animeConfig),
          JSON.stringify(DEFAULT_GUILD_SETTINGS.loggingConfig),
          JSON.stringify(DEFAULT_GUILD_SETTINGS.notificationConfig),
          JSON.stringify(DEFAULT_GUILD_SETTINGS.communityConfig),
          now
        );
      this.sqlite
        .prepare(`UPDATE guild_settings SET ${col} = ?, updated_at = ? WHERE guild_id = ?`)
        .run(JSON.stringify(payload), now, guild.id);
    }
    this.recordAuditLog(guild.id, actorId, `CONFIG_UPDATE_${section.toUpperCase()}`, guild.discordGuildId, {
      section,
    });
    return this.getGuildSettings(discordGuildId);
  }

  // ==================== WATCHLIST ====================

  public addWatchlistEntry(
    discordUserId: string,
    input: {
      hoshikaId: string;
      hoshikaShortId?: number | null;
      anilistId?: number | null;
      malId?: number | null;
      titleSnapshot: string;
      posterSnapshot?: string | null;
      genresSnapshot?: string[];
      totalEpisodes?: number | null;
      status?: WatchStatus;
      isPublic?: boolean;
    }
  ): WatchlistRecord {
    const existing = this.sqlite
      .prepare(
        `SELECT id FROM watchlist
         WHERE discord_user_id = ?
           AND (hoshika_id = ? OR (? IS NOT NULL AND hoshika_short_id = ?))`
      )
      .get(
        discordUserId,
        input.hoshikaId,
        input.hoshikaShortId ?? null,
        input.hoshikaShortId ?? null
      ) as { id: string } | undefined;
    if (existing) {
      throw new AppError(
        ERROR_CODES.DUPLICATE_WATCHLIST,
        'This anime is already in your watchlist.',
        409
      );
    }
    const id = crypto.randomUUID();
    const now = this.now();
    this.sqlite
      .prepare(
        `INSERT INTO watchlist (id, discord_user_id, hoshika_id, hoshika_short_id, anilist_id, mal_id, title_snapshot, poster_snapshot, genres_snapshot, total_episodes, status, episodes_watched, personal_rating, notes, is_public, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?)`
      )
      .run(
        id,
        discordUserId,
        input.hoshikaId,
        input.hoshikaShortId ?? null,
        input.anilistId ?? null,
        input.malId ?? null,
        input.titleSnapshot,
        input.posterSnapshot ?? null,
        JSON.stringify(input.genresSnapshot ?? []),
        input.totalEpisodes ?? null,
        input.status ?? 'PLAN_TO_WATCH',
        input.isPublic ? 1 : 0,
        now,
        now
      );
    return this.getWatchlistEntryById(id)!;
  }

  public getWatchlistEntryById(id: string): WatchlistRecord | null {
    const r = this.sqlite.prepare('SELECT * FROM watchlist WHERE id = ?').get(id) as any;
    return r ? this.mapWatchlist(r) : null;
  }

  public listWatchlist(
    discordUserId: string,
    filters?: { status?: WatchStatus; genre?: string; query?: string; sort?: 'title' | 'date' }
  ): WatchlistRecord[] {
    let rows = this.sqlite
      .prepare('SELECT * FROM watchlist WHERE discord_user_id = ? ORDER BY updated_at DESC')
      .all(discordUserId) as any[];
    let items = rows.map((r) => this.mapWatchlist(r));
    if (filters?.status) {
      items = items.filter((i) => i.status === filters.status);
    }
    if (filters?.genre) {
      const g = filters.genre.toLowerCase();
      items = items.filter((i) => i.genresSnapshot.some((x) => x.toLowerCase() === g));
    }
    if (filters?.query) {
      const q = filters.query.toLowerCase();
      items = items.filter((i) => i.titleSnapshot.toLowerCase().includes(q));
    }
    if (filters?.sort === 'title') {
      items.sort((a, b) => a.titleSnapshot.localeCompare(b.titleSnapshot));
    } else if (filters?.sort === 'date') {
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return items;
  }

  public updateWatchlistEntry(
    discordUserId: string,
    entryId: string,
    patch: {
      status?: WatchStatus;
      episodesWatched?: number;
      personalRating?: number | null;
      notes?: string | null;
      isPublic?: boolean;
    }
  ): { entry: WatchlistRecord; autoCompleted: boolean } {
    const current = this.sqlite
      .prepare('SELECT * FROM watchlist WHERE id = ? AND discord_user_id = ?')
      .get(entryId, discordUserId) as any;
    if (!current) {
      throw new AppError(ERROR_CODES.ANIME_NOT_FOUND, 'Watchlist entry not found.', 404);
    }

    const totalEpisodes: number | null = current.total_episodes;
    let episodesWatched =
      patch.episodesWatched !== undefined ? patch.episodesWatched : current.episodes_watched;

    if (episodesWatched < 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Episodes watched cannot be negative.', 400);
    }
    if (totalEpisodes !== null && totalEpisodes > 0 && episodesWatched > totalEpisodes) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `Episodes watched (${episodesWatched}) cannot exceed known episode count (${totalEpisodes}).`,
        400
      );
    }

    let nextStatus: WatchStatus = patch.status ?? current.status;
    let autoCompleted = false;
    if (
      patch.episodesWatched !== undefined &&
      totalEpisodes !== null &&
      totalEpisodes > 0 &&
      episodesWatched === totalEpisodes &&
      patch.status === undefined &&
      current.status !== 'COMPLETED'
    ) {
      nextStatus = 'COMPLETED';
      autoCompleted = true;
    }

    const now = this.now();
    this.sqlite
      .prepare(
        `UPDATE watchlist SET status = ?, episodes_watched = ?, personal_rating = ?, notes = ?, is_public = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        nextStatus,
        episodesWatched,
        patch.personalRating !== undefined ? patch.personalRating : current.personal_rating,
        patch.notes !== undefined ? patch.notes : current.notes,
        patch.isPublic !== undefined ? (patch.isPublic ? 1 : 0) : current.is_public,
        now,
        entryId
      );

    return { entry: this.getWatchlistEntryById(entryId)!, autoCompleted };
  }

  public removeWatchlistEntry(discordUserId: string, entryIdOrHoshikaId: string): boolean {
    const res = this.sqlite
      .prepare(
        'DELETE FROM watchlist WHERE discord_user_id = ? AND (id = ? OR hoshika_id = ?)'
      )
      .run(discordUserId, entryIdOrHoshikaId, entryIdOrHoshikaId);
    return res.changes > 0;
  }

  public getWatchlistStats(discordUserId?: string) {
    const rows = discordUserId
      ? (this.sqlite
          .prepare('SELECT * FROM watchlist WHERE discord_user_id = ?')
          .all(discordUserId) as any[])
      : (this.sqlite.prepare('SELECT * FROM watchlist').all() as any[]);
    const items = rows.map((r) => this.mapWatchlist(r));
    const byStatus: Record<WatchStatus, number> = {
      PLAN_TO_WATCH: 0,
      WATCHING: 0,
      COMPLETED: 0,
      ON_HOLD: 0,
      DROPPED: 0,
    };
    let totalEpisodes = 0;
    let ratingSum = 0;
    let ratingCount = 0;
    const genreCounts: Record<string, number> = {};

    for (const item of items) {
      byStatus[item.status]++;
      totalEpisodes += item.episodesWatched;
      if (item.personalRating !== null) {
        ratingSum += item.personalRating;
        ratingCount++;
      }
      for (const g of item.genresSnapshot) {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      }
    }

    return {
      totalEntries: items.length,
      totalEpisodesWatched: totalEpisodes,
      averageRating: ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(2)) : null,
      byStatus,
      topGenres: Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([genre, count]) => ({ genre, count })),
    };
  }

  private mapWatchlist(r: any): WatchlistRecord {
    return {
      id: r.id,
      discordUserId: r.discord_user_id,
      hoshikaId: r.hoshika_id,
      hoshikaShortId: r.hoshika_short_id,
      anilistId: r.anilist_id,
      malId: r.mal_id,
      titleSnapshot: r.title_snapshot,
      posterSnapshot: r.poster_snapshot,
      genresSnapshot: JSON.parse(r.genres_snapshot || '[]'),
      totalEpisodes: r.total_episodes,
      status: r.status as WatchStatus,
      episodesWatched: r.episodes_watched,
      personalRating: r.personal_rating,
      notes: r.notes,
      isPublic: Boolean(r.is_public),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ==================== MODERATION & WARNINGS ====================

  public createModerationCase(
    discordGuildId: string,
    input: {
      targetUserId: string;
      moderatorId: string;
      action: ModerationAction;
      reason: string;
      evidence?: string | null;
      staffNotes?: string | null;
      durationMinutes?: number | null;
    }
  ): ModerationCaseRecord {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);

    const maxRow = this.sqlite
      .prepare('SELECT MAX(case_number) as maxNum FROM moderation_cases WHERE guild_id = ?')
      .get(guild.id) as { maxNum: number | null };
    const caseNumber = (maxRow?.maxNum || 0) + 1;
    const id = crypto.randomUUID();
    const now = this.now();
    const expiresAt =
      input.durationMinutes && input.durationMinutes > 0
        ? new Date(Date.now() + input.durationMinutes * 60_000).toISOString()
        : null;

    this.sqlite
      .prepare(
        `INSERT INTO moderation_cases (id, case_number, guild_id, target_user_id, moderator_id, action, reason, evidence, staff_notes, active, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        id,
        caseNumber,
        guild.id,
        input.targetUserId,
        input.moderatorId,
        input.action,
        input.reason,
        input.evidence ?? null,
        input.staffNotes ?? null,
        expiresAt,
        now
      );

    this.recordAuditLog(guild.id, input.moderatorId, `MOD_${input.action}`, input.targetUserId, {
      caseNumber,
      reason: input.reason,
    });

    return this.getCaseById(id)!;
  }

  public getCaseById(id: string): ModerationCaseRecord | null {
    const r = this.sqlite.prepare('SELECT * FROM moderation_cases WHERE id = ?').get(id) as any;
    return r ? this.mapCase(r) : null;
  }

  public listModerationCases(discordGuildId: string, targetUserId?: string): ModerationCaseRecord[] {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return [];
    const rows = targetUserId
      ? (this.sqlite
          .prepare(
            'SELECT * FROM moderation_cases WHERE guild_id = ? AND target_user_id = ? ORDER BY case_number DESC'
          )
          .all(guild.id, targetUserId) as any[])
      : (this.sqlite
          .prepare('SELECT * FROM moderation_cases WHERE guild_id = ? ORDER BY case_number DESC LIMIT 100')
          .all(guild.id) as any[]);
    return rows.map((r) => this.mapCase(r));
  }

  public submitAppeal(discordGuildId: string, caseNumber: number, appealText: string) {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    const res = this.sqlite
      .prepare(
        `UPDATE moderation_cases SET appeal_status = 'PENDING', appeal_text = ? WHERE guild_id = ? AND case_number = ?`
      )
      .run(appealText, guild.id, caseNumber);
    if (res.changes === 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Moderation case not found.', 404);
    }
  }

  public issueWarningWithEscalation(
    discordGuildId: string,
    input: { userId: string; moderatorId: string; reason: string }
  ) {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    const settings = this.getGuildSettings(discordGuildId);
    const now = this.now();
    const warningId = crypto.randomUUID();

    this.sqlite
      .prepare(
        'INSERT INTO warnings (id, guild_id, user_id, moderator_id, reason, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
      )
      .run(warningId, guild.id, input.userId, input.moderatorId, input.reason, now);

    const countRow = this.sqlite
      .prepare('SELECT COUNT(*) as cnt FROM warnings WHERE guild_id = ? AND user_id = ? AND active = 1')
      .get(guild.id, input.userId) as { cnt: number };
    const totalActiveWarnings = countRow.cnt;

    const modCase = this.createModerationCase(discordGuildId, {
      targetUserId: input.userId,
      moderatorId: input.moderatorId,
      action: 'WARN',
      reason: input.reason,
    });

    const sortedSteps = [...settings.moderationConfig.escalation].sort((a, b) => b.threshold - a.threshold);
    const matchedStep = sortedSteps.find((s) => totalActiveWarnings >= s.threshold) || {
      threshold: 1,
      action: 'WARN' as const,
    };

    return {
      warningId,
      totalActiveWarnings,
      modCase,
      escalation: matchedStep,
    };
  }

  public listWarnings(discordGuildId: string, userId?: string): WarningRecord[] {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return [];
    const rows = userId
      ? (this.sqlite
          .prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? AND active = 1 ORDER BY created_at DESC')
          .all(guild.id, userId) as any[])
      : (this.sqlite
          .prepare('SELECT * FROM warnings WHERE guild_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 100')
          .all(guild.id) as any[]);
    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      userId: r.user_id,
      moderatorId: r.moderator_id,
      reason: r.reason,
      active: Boolean(r.active),
      createdAt: r.created_at,
    }));
  }

  public removeWarning(discordGuildId: string, warningId: string): boolean {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return false;
    const res = this.sqlite
      .prepare('UPDATE warnings SET active = 0 WHERE id = ? AND guild_id = ?')
      .run(warningId, guild.id);
    return res.changes > 0;
  }

  private mapCase(r: any): ModerationCaseRecord {
    return {
      id: r.id,
      caseNumber: r.case_number,
      guildId: r.guild_id,
      targetUserId: r.target_user_id,
      moderatorId: r.moderator_id,
      action: r.action as ModerationAction,
      reason: r.reason,
      evidence: r.evidence,
      staffNotes: r.staff_notes,
      appealStatus: r.appeal_status,
      appealText: r.appeal_text,
      active: Boolean(r.active),
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    };
  }

  // ==================== COMMUNITY: SUGGESTIONS, TICKETS, POLLS, GIVEAWAYS, REACTION ROLES ====================

  public createSuggestion(discordGuildId: string, userId: string, content: string): SuggestionRecord {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    const normalized = content.trim().toLowerCase().replace(/\s+/g, ' ');
    const contentHash = crypto.createHash('sha256').update(normalized).digest('hex');

    const dup = this.sqlite
      .prepare('SELECT id FROM suggestions WHERE guild_id = ? AND content_hash = ?')
      .get(guild.id, contentHash);
    if (dup) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'A duplicate suggestion already exists in this server.',
        409
      );
    }

    const id = crypto.randomUUID();
    const now = this.now();
    this.sqlite
      .prepare(
        `INSERT INTO suggestions (id, guild_id, user_id, content, content_hash, status, upvotes, downvotes, voter_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', 0, 0, '{}', ?, ?)`
      )
      .run(id, guild.id, userId, content.trim(), contentHash, now, now);

    return this.getSuggestionById(id)!;
  }

  public getSuggestionById(id: string): SuggestionRecord | null {
    const r = this.sqlite.prepare('SELECT * FROM suggestions WHERE id = ?').get(id) as any;
    return r ? this.mapSuggestion(r) : null;
  }

  public listSuggestions(discordGuildId: string): SuggestionRecord[] {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return [];
    const rows = this.sqlite
      .prepare('SELECT * FROM suggestions WHERE guild_id = ? ORDER BY created_at DESC')
      .all(guild.id) as any[];
    return rows.map((r) => this.mapSuggestion(r));
  }

  public voteSuggestion(suggestionId: string, userId: string, vote: 'up' | 'down'): SuggestionRecord {
    const s = this.getSuggestionById(suggestionId);
    if (!s) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Suggestion not found.', 404);
    const voters = { ...s.voterIds };
    if (voters[userId] === vote) {
      delete voters[userId];
    } else {
      voters[userId] = vote;
    }
    const upvotes = Object.values(voters).filter((v) => v === 'up').length;
    const downvotes = Object.values(voters).filter((v) => v === 'down').length;
    this.sqlite
      .prepare('UPDATE suggestions SET upvotes = ?, downvotes = ?, voter_ids = ?, updated_at = ? WHERE id = ?')
      .run(upvotes, downvotes, JSON.stringify(voters), this.now(), suggestionId);
    return this.getSuggestionById(suggestionId)!;
  }

  public updateSuggestionStatus(
    discordGuildId: string,
    suggestionId: string,
    status: SuggestionStatus,
    staffResponse?: string | null,
    actorId = 'staff'
  ): SuggestionRecord {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    this.sqlite
      .prepare('UPDATE suggestions SET status = ?, staff_response = ?, updated_at = ? WHERE id = ? AND guild_id = ?')
      .run(status, staffResponse ?? null, this.now(), suggestionId, guild.id);
    this.recordAuditLog(guild.id, actorId, 'SUGGESTION_STATUS_UPDATE', suggestionId, { status });
    return this.getSuggestionById(suggestionId)!;
  }

  private mapSuggestion(r: any): SuggestionRecord {
    return {
      id: r.id,
      guildId: r.guild_id,
      userId: r.user_id,
      messageId: r.message_id,
      content: r.content,
      contentHash: r.content_hash,
      status: r.status as SuggestionStatus,
      upvotes: r.upvotes,
      downvotes: r.downvotes,
      voterIds: JSON.parse(r.voter_ids || '{}'),
      staffResponse: r.staff_response,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public createTicket(
    discordGuildId: string,
    input: { channelId: string; userId: string; category: TicketCategory; subject?: string }
  ): TicketRecord {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    const id = crypto.randomUUID();
    const now = this.now();
    this.sqlite
      .prepare(
        `INSERT INTO tickets (id, guild_id, channel_id, user_id, category, subject, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?)`
      )
      .run(id, guild.id, input.channelId, input.userId, input.category, input.subject ?? null, now);
    return this.getTicketById(id)!;
  }

  public getTicketById(id: string): TicketRecord | null {
    const r = this.sqlite.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    return r ? this.mapTicket(r) : null;
  }

  public listTickets(discordGuildId: string): TicketRecord[] {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return [];
    const rows = this.sqlite
      .prepare('SELECT * FROM tickets WHERE guild_id = ? ORDER BY created_at DESC')
      .all(guild.id) as any[];
    return rows.map((r) => this.mapTicket(r));
  }

  public updateTicketStatus(
    discordGuildId: string,
    ticketId: string,
    status: 'OPEN' | 'CLAIMED' | 'CLOSED',
    staffId?: string | null,
    transcriptText?: string | null
  ): TicketRecord {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    const current = this.getTicketById(ticketId);
    if (!current) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Ticket not found.', 404);
    if (status === 'CLOSED' && current.status === 'CLOSED') {
      throw new AppError(ERROR_CODES.TICKET_ALREADY_CLOSED, 'This ticket is already closed.', 400);
    }
    const closedAt = status === 'CLOSED' ? this.now() : null;
    this.sqlite
      .prepare(
        'UPDATE tickets SET status = ?, assigned_staff_id = COALESCE(?, assigned_staff_id), transcript_text = COALESCE(?, transcript_text), closed_at = ? WHERE id = ? AND guild_id = ?'
      )
      .run(status, staffId ?? null, transcriptText ?? null, closedAt, ticketId, guild.id);
    return this.getTicketById(ticketId)!;
  }

  private mapTicket(r: any): TicketRecord {
    return {
      id: r.id,
      guildId: r.guild_id,
      channelId: r.channel_id,
      userId: r.user_id,
      category: r.category as TicketCategory,
      subject: r.subject,
      assignedStaffId: r.assigned_staff_id,
      status: r.status,
      transcriptUrl: r.transcript_url,
      transcriptText: r.transcript_text,
      createdAt: r.created_at,
      closedAt: r.closed_at,
    };
  }

  public createPoll(
    discordGuildId: string,
    input: {
      channelId: string;
      creatorId: string;
      question: string;
      options: string[];
      allowMultiple: boolean;
      durationMinutes: number;
    }
  ): PollRecord {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    const id = crypto.randomUUID();
    const now = this.now();
    const endsAt = new Date(Date.now() + input.durationMinutes * 60_000).toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO polls (id, guild_id, channel_id, creator_id, question, options, votes, allow_multiple, closed, ends_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '{}', ?, 0, ?, ?)`
      )
      .run(
        id,
        guild.id,
        input.channelId,
        input.creatorId,
        input.question,
        JSON.stringify(input.options),
        input.allowMultiple ? 1 : 0,
        endsAt,
        now
      );
    return this.listPolls(discordGuildId).find((p) => p.id === id)!;
  }

  public listPolls(discordGuildId: string): PollRecord[] {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return [];
    const rows = this.sqlite
      .prepare('SELECT * FROM polls WHERE guild_id = ? ORDER BY created_at DESC')
      .all(guild.id) as any[];
    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      channelId: r.channel_id,
      messageId: r.message_id,
      creatorId: r.creator_id,
      question: r.question,
      options: JSON.parse(r.options || '[]'),
      votes: JSON.parse(r.votes || '{}'),
      allowMultiple: Boolean(r.allow_multiple),
      closed: Boolean(r.closed),
      endsAt: r.ends_at,
      createdAt: r.created_at,
    }));
  }

  public votePoll(pollId: string, userId: string, optionIndex: number): PollRecord {
    const r = this.sqlite.prepare('SELECT * FROM polls WHERE id = ?').get(pollId) as any;
    if (!r) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Poll not found.', 404);
    if (r.closed) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Poll is already closed.', 400);
    const options: string[] = JSON.parse(r.options || '[]');
    if (optionIndex < 0 || optionIndex >= options.length) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid poll option.', 400);
    }
    const votes: Record<string, number[]> = JSON.parse(r.votes || '{}');
    const current = votes[userId] || [];
    if (r.allow_multiple) {
      votes[userId] = current.includes(optionIndex)
        ? current.filter((i) => i !== optionIndex)
        : [...current, optionIndex];
    } else {
      votes[userId] = [optionIndex];
    }
    this.sqlite.prepare('UPDATE polls SET votes = ? WHERE id = ?').run(JSON.stringify(votes), pollId);
    const updated = this.sqlite.prepare('SELECT * FROM polls WHERE id = ?').get(pollId) as any;
    return {
      id: updated.id,
      guildId: updated.guild_id,
      channelId: updated.channel_id,
      messageId: updated.message_id,
      creatorId: updated.creator_id,
      question: updated.question,
      options,
      votes,
      allowMultiple: Boolean(updated.allow_multiple),
      closed: Boolean(updated.closed),
      endsAt: updated.ends_at,
      createdAt: updated.created_at,
    };
  }

  public createGiveaway(
    discordGuildId: string,
    input: {
      channelId: string;
      hostId: string;
      prize: string;
      winnerCount: number;
      requiredRoleId?: string | null;
      minLevel?: number | null;
      durationMinutes: number;
    }
  ): GiveawayRecord {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    const id = crypto.randomUUID();
    const now = this.now();
    const endsAt = new Date(Date.now() + input.durationMinutes * 60_000).toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO giveaways (id, guild_id, channel_id, host_id, prize, winner_count, required_role_id, min_level, entrants, winner_ids, ended, ends_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 0, ?, ?)`
      )
      .run(
        id,
        guild.id,
        input.channelId,
        input.hostId,
        input.prize,
        input.winnerCount,
        input.requiredRoleId ?? null,
        input.minLevel ?? null,
        endsAt,
        now
      );
    return this.listGiveaways(discordGuildId).find((g) => g.id === id)!;
  }

  public listGiveaways(discordGuildId: string): GiveawayRecord[] {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return [];
    const rows = this.sqlite
      .prepare('SELECT * FROM giveaways WHERE guild_id = ? ORDER BY created_at DESC')
      .all(guild.id) as any[];
    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      channelId: r.channel_id,
      messageId: r.message_id,
      hostId: r.host_id,
      prize: r.prize,
      winnerCount: r.winner_count,
      requiredRoleId: r.required_role_id,
      minLevel: r.min_level,
      entrants: JSON.parse(r.entrants || '[]'),
      winnerIds: JSON.parse(r.winner_ids || '[]'),
      ended: Boolean(r.ended),
      endsAt: r.ends_at,
      createdAt: r.created_at,
    }));
  }

  public drawGiveawayWinners(giveawayId: string): GiveawayRecord {
    const r = this.sqlite.prepare('SELECT * FROM giveaways WHERE id = ?').get(giveawayId) as any;
    if (!r) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Giveaway not found.', 404);
    const entrants: string[] = JSON.parse(r.entrants || '[]');
    const pool = [...entrants];
    const winners: string[] = [];
    for (let i = 0; i < r.winner_count && pool.length > 0; i++) {
      const idx = crypto.randomInt(0, pool.length);
      winners.push(pool.splice(idx, 1)[0]);
    }
    this.sqlite
      .prepare('UPDATE giveaways SET winner_ids = ?, ended = 1 WHERE id = ?')
      .run(JSON.stringify(winners), giveawayId);
    const updated = this.sqlite.prepare('SELECT * FROM giveaways WHERE id = ?').get(giveawayId) as any;
    return {
      id: updated.id,
      guildId: updated.guild_id,
      channelId: updated.channel_id,
      messageId: updated.message_id,
      hostId: updated.host_id,
      prize: updated.prize,
      winnerCount: updated.winner_count,
      requiredRoleId: updated.required_role_id,
      minLevel: updated.min_level,
      entrants,
      winnerIds: winners,
      ended: true,
      endsAt: updated.ends_at,
      createdAt: updated.created_at,
    };
  }

  public createReactionRolePanel(
    discordGuildId: string,
    input: {
      channelId: string;
      title: string;
      description?: string;
      mode: 'BUTTON' | 'SELECT' | 'EMOJI';
      exclusive: boolean;
      maxSelections: number;
      roles: Array<{ roleId: string; label: string; emoji?: string | null }>;
    }
  ): ReactionRolePanelRecord {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    const id = crypto.randomUUID();
    const now = this.now();
    this.sqlite
      .prepare(
        `INSERT INTO reaction_role_panels (id, guild_id, channel_id, title, description, mode, exclusive, max_selections, roles, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        guild.id,
        input.channelId,
        input.title,
        input.description ?? '',
        input.mode,
        input.exclusive ? 1 : 0,
        input.maxSelections,
        JSON.stringify(input.roles),
        now,
        now
      );
    return this.listReactionRolePanels(discordGuildId).find((p) => p.id === id)!;
  }

  public listReactionRolePanels(discordGuildId: string): ReactionRolePanelRecord[] {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return [];
    const rows = this.sqlite
      .prepare('SELECT * FROM reaction_role_panels WHERE guild_id = ? ORDER BY created_at DESC')
      .all(guild.id) as any[];
    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      channelId: r.channel_id,
      messageId: r.message_id,
      title: r.title,
      description: r.description,
      mode: r.mode,
      exclusive: Boolean(r.exclusive),
      maxSelections: r.max_selections,
      roles: JSON.parse(r.roles || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // ==================== NOTIFICATIONS, METRICS & PROFILES ====================

  public createNotification(
    discordGuildId: string,
    input: {
      type: NotificationType;
      destinationChannelId: string;
      title: string;
      payload: Record<string, unknown>;
      deliveryStatus: string;
      errorMessage?: string | null;
      dedupeKey?: string | null;
    }
  ): NotificationRecord {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    const id = crypto.randomUUID();
    const now = this.now();
    this.sqlite
      .prepare(
        `INSERT INTO notifications (id, guild_id, type, destination_channel_id, title, payload, delivery_status, error_message, dedupe_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        guild.id,
        input.type,
        input.destinationChannelId,
        input.title,
        JSON.stringify(input.payload),
        input.deliveryStatus,
        input.errorMessage ?? null,
        input.dedupeKey ?? null,
        now
      );
    return this.listNotifications(discordGuildId).find((n) => n.id === id)!;
  }

  public listNotifications(discordGuildId: string): NotificationRecord[] {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return [];
    const rows = this.sqlite
      .prepare('SELECT * FROM notifications WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(guild.id) as any[];
    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      type: r.type as NotificationType,
      destinationChannelId: r.destination_channel_id,
      title: r.title,
      payload: JSON.parse(r.payload || '{}'),
      deliveryStatus: r.delivery_status,
      errorMessage: r.error_message,
      dedupeKey: r.dedupe_key,
      createdAt: r.created_at,
    }));
  }

  public recordAuditLog(
    guildInternalId: string,
    actorId: string,
    action: string,
    targetId: string | null,
    details: Record<string, unknown> = {}
  ) {
    this.sqlite
      .prepare(
        'INSERT INTO audit_logs (id, guild_id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(crypto.randomUUID(), guildInternalId, actorId, action, targetId, JSON.stringify(details), this.now());
  }

  public listAuditLogs(discordGuildId: string): AuditLogRecord[] {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return [];
    const rows = this.sqlite
      .prepare('SELECT * FROM audit_logs WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(guild.id) as any[];
    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      actorId: r.actor_id,
      action: r.action,
      targetId: r.target_id,
      details: JSON.parse(r.details || '{}'),
      createdAt: r.created_at,
    }));
  }

  public recordCommandMetric(input: {
    guildId?: string | null;
    commandName: string;
    category: string;
    userId: string;
    success: boolean;
    durationMs: number;
  }) {
    this.sqlite
      .prepare(
        'INSERT INTO command_metrics (id, guild_id, command_name, category, user_id, success, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        crypto.randomUUID(),
        input.guildId ?? null,
        input.commandName,
        input.category,
        input.userId,
        input.success ? 1 : 0,
        input.durationMs,
        this.now()
      );
  }

  public recordAnimeSearchMetric(input: {
    query: string;
    hoshikaId?: string | null;
    title?: string | null;
    genres?: string[];
    userId: string;
    guildId?: string | null;
  }) {
    this.sqlite
      .prepare(
        'INSERT INTO anime_search_metrics (id, query, hoshika_id, title, genres, user_id, guild_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        crypto.randomUUID(),
        input.query.trim().toLowerCase(),
        input.hoshikaId ?? null,
        input.title ?? null,
        JSON.stringify(input.genres ?? []),
        input.userId,
        input.guildId ?? null,
        this.now()
      );
  }

  public addXp(discordUserId: string, username: string, xpGain: number): UserProfileRecord {
    const existing = this.sqlite
      .prepare('SELECT * FROM user_profiles WHERE discord_user_id = ?')
      .get(discordUserId) as any;
    const now = this.now();
    const currentXp = existing ? existing.experience_points : 0;
    const nextXp = currentXp + xpGain;
    const nextLevel = Math.max(1, Math.floor(Math.sqrt(nextXp / 100)) + 1);

    if (existing) {
      this.sqlite
        .prepare('UPDATE user_profiles SET username = ?, experience_points = ?, level = ?, updated_at = ? WHERE discord_user_id = ?')
        .run(username, nextXp, nextLevel, now, discordUserId);
    } else {
      this.sqlite
        .prepare(
          'INSERT INTO user_profiles (discord_user_id, username, experience_points, level, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(discordUserId, username, nextXp, nextLevel, now);
    }
    return this.getUserProfile(discordUserId)!;
  }

  public getUserProfile(discordUserId: string): UserProfileRecord | null {
    const r = this.sqlite
      .prepare('SELECT * FROM user_profiles WHERE discord_user_id = ?')
      .get(discordUserId) as any;
    if (!r) return null;
    return {
      discordUserId: r.discord_user_id,
      username: r.username,
      favoriteAnime: JSON.parse(r.favorite_anime || '[]'),
      preferredGenres: JSON.parse(r.preferred_genres || '[]'),
      experiencePoints: r.experience_points,
      level: r.level,
      quizStatistics: JSON.parse(r.quiz_statistics || '{"played":0,"won":0,"score":0}'),
      birthday: r.birthday,
      updatedAt: r.updated_at,
    };
  }

  public listLeaderboard(limit = 10): UserProfileRecord[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM user_profiles ORDER BY experience_points DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map((r) => ({
      discordUserId: r.discord_user_id,
      username: r.username,
      favoriteAnime: JSON.parse(r.favorite_anime || '[]'),
      preferredGenres: JSON.parse(r.preferred_genres || '[]'),
      experiencePoints: r.experience_points,
      level: r.level,
      quizStatistics: JSON.parse(r.quiz_statistics || '{"played":0,"won":0,"score":0}'),
      birthday: r.birthday,
      updatedAt: r.updated_at,
    }));
  }

  public getAnalytics(discordGuildId?: string) {
    const topCommands = this.sqlite
      .prepare(
        `SELECT command_name as name, category, COUNT(*) as count
         FROM command_metrics
         GROUP BY command_name, category
         ORDER BY count DESC LIMIT 10`
      )
      .all() as Array<{ name: string; category: string; count: number }>;

    const topSearches = this.sqlite
      .prepare(
        `SELECT COALESCE(title, query) as label, COUNT(*) as count
         FROM anime_search_metrics
         GROUP BY label
         ORDER BY count DESC LIMIT 8`
      )
      .all() as Array<{ label: string; count: number }>;

    const musicUsage = this.sqlite
      .prepare(
        `SELECT command_name as name, COUNT(*) as count
         FROM command_metrics WHERE category = 'music'
         GROUP BY command_name ORDER BY count DESC`
      )
      .all() as Array<{ name: string; count: number }>;

    const guild = discordGuildId ? this.getGuildByDiscordId(discordGuildId) : null;
    const modBreakdown = guild
      ? (this.sqlite
          .prepare(
            'SELECT action, COUNT(*) as count FROM moderation_cases WHERE guild_id = ? GROUP BY action ORDER BY count DESC'
          )
          .all(guild.id) as Array<{ action: string; count: number }>)
      : [];

    const totalCommands = (
      this.sqlite.prepare('SELECT COUNT(*) as cnt FROM command_metrics').get() as { cnt: number }
    ).cnt;

    const searchRows = this.sqlite
      .prepare('SELECT genres FROM anime_search_metrics')
      .all() as Array<{ genres: string }>;
    const genreCounts: Record<string, number> = {};
    for (const row of searchRows) {
      const arr: string[] = JSON.parse(row.genres || '[]');
      for (const g of arr) {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      }
    }

    const dailyRows = this.sqlite
      .prepare(
        `SELECT substr(created_at, 1, 10) as day, COUNT(*) as count
         FROM command_metrics
         GROUP BY day
         ORDER BY day ASC LIMIT 14`
      )
      .all() as Array<{ day: string; count: number }>;

    return {
      totalCommands,
      topCommands,
      topSearches,
      musicUsage,
      modBreakdown,
      popularGenres: Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([genre, count]) => ({ genre, count })),
      dailyActivity: dailyRows,
      leaderboard: this.listLeaderboard(5),
    };
  }

  public recordCommunityRecommendation(
    discordGuildIdOrInput:
      | string
      | {
          guildId: string;
          channelId: string;
          discordUserId: string;
          username?: string;
          hoshikaShortId: number;
          animeTitle: string;
          messageId?: string | null;
        },
    maybeInput?: {
      channelId: string;
      discordUserId: string;
      username?: string;
      hoshikaShortId: number;
      animeTitle: string;
      messageId?: string | null;
    }
  ): CommunityRecommendationRecord | null {
    const discordGuildId =
      typeof discordGuildIdOrInput === 'string'
        ? discordGuildIdOrInput
        : discordGuildIdOrInput.guildId;
    const input =
      typeof discordGuildIdOrInput === 'string' ? maybeInput! : discordGuildIdOrInput;
    if (!discordGuildId || !input) return null;

    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return null;
    const settings = this.getGuildSettings(discordGuildId);
    if (settings.animeConfig.recommendationAnalyticsEnabled === false) {
      return null;
    }
    const id = crypto.randomUUID();
    const now = this.now();
    this.sqlite
      .prepare(
        `INSERT INTO community_recommendations (id, guild_id, channel_id, discord_user_id, username, hoshika_short_id, anime_title, message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        guild.id,
        input.channelId,
        input.discordUserId,
        input.username || 'Member',
        input.hoshikaShortId,
        input.animeTitle,
        input.messageId ?? null,
        now
      );
    return {
      id,
      guildId: guild.id,
      channelId: input.channelId,
      discordUserId: input.discordUserId,
      username: input.username || 'Member',
      hoshikaShortId: input.hoshikaShortId,
      animeTitle: input.animeTitle,
      messageId: input.messageId ?? null,
      createdAt: now,
    };
  }

  public listCommunityRecommendations(discordGuildId: string, limit = 30): CommunityRecommendationRecord[] {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) return [];
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM community_recommendations
         WHERE guild_id = ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(guild.id, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      channelId: r.channel_id,
      discordUserId: r.discord_user_id,
      username: r.username || 'Member',
      hoshikaShortId: r.hoshika_short_id,
      animeTitle: r.anime_title,
      messageId: r.message_id,
      createdAt: r.created_at,
    }));
  }

  public getCommunityRecommendationStats(discordGuildId: string, webBaseUrl = 'https://aniscroll.in') {
    const guild = this.getGuildByDiscordId(discordGuildId);
    if (!guild) {
      return {
        totalRecommendations: 0,
        mostRecommendedAnime: [],
        topRecommendedAnime: [],
        mostActiveRecommenders: [],
        topRecommendingMembers: [],
        channelActivity: [],
        recentRecommendations: [],
      };
    }

    const cleanWebBase = webBaseUrl.replace(/\/+$/, '');
    const channelMap = new Map<string, string>();
    for (const ch of guild.channels || []) {
      channelMap.set(ch.id, ch.name);
    }

    const totalRecommendations = (
      this.sqlite
        .prepare('SELECT COUNT(*) as cnt FROM community_recommendations WHERE guild_id = ?')
        .get(guild.id) as { cnt: number }
    ).cnt;

    const topAnimeRows = this.sqlite
      .prepare(
        `SELECT hoshika_short_id as hoshikaShortId, MAX(anime_title) as animeTitle, COUNT(*) as count
         FROM community_recommendations
         WHERE guild_id = ?
         GROUP BY hoshika_short_id
         ORDER BY count DESC, MAX(created_at) DESC
         LIMIT 8`
      )
      .all(guild.id) as Array<{ hoshikaShortId: number; animeTitle: string; count: number }>;

    const topUsersRows = this.sqlite
      .prepare(
        `SELECT discord_user_id as discordUserId, MAX(username) as username, COUNT(*) as count
         FROM community_recommendations
         WHERE guild_id = ?
         GROUP BY discord_user_id
         ORDER BY count DESC, MAX(created_at) DESC
         LIMIT 8`
      )
      .all(guild.id) as Array<{ discordUserId: string; username: string; count: number }>;

    const channelRows = this.sqlite
      .prepare(
        `SELECT channel_id as channelId, COUNT(*) as count
         FROM community_recommendations
         WHERE guild_id = ?
         GROUP BY channel_id
         ORDER BY count DESC`
      )
      .all(guild.id) as Array<{ channelId: string; count: number }>;

    const recent = this.listCommunityRecommendations(discordGuildId, 20).map((rec) => ({
      ...rec,
      channelName: channelMap.get(rec.channelId) || rec.channelId,
      aniscrollUrl: rec.hoshikaShortId > 0 ? `${cleanWebBase}/anime/${rec.hoshikaShortId}` : null,
    }));

    const formattedTopAnime = topAnimeRows.map((a) => ({
      ...a,
      aniscrollUrl: a.hoshikaShortId > 0 ? `${cleanWebBase}/anime/${a.hoshikaShortId}` : null,
    }));

    return {
      totalRecommendations,
      mostRecommendedAnime: formattedTopAnime,
      topRecommendedAnime: formattedTopAnime,
      mostActiveRecommenders: topUsersRows,
      topRecommendingMembers: topUsersRows,
      channelActivity: channelRows.map((c) => ({
        channelId: c.channelId,
        channelName: channelMap.get(c.channelId) || c.channelId,
        count: c.count,
      })),
      recentRecommendations: recent,
    };
  }
}
