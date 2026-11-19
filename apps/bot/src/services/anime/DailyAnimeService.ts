import { Client, Guild, PermissionFlagsBits, TextBasedChannel } from 'discord.js';
import {
  AniScrollDatabase,
  DailyAnimeConfigRecord,
  DailyAnimeRecord,
} from '../../../../../packages/database/src';
import {
  AppError,
  createModuleLogger,
  ERROR_CODES,
  NormalizedAnime,
  normalizeHoshikaShortId,
} from '../../../../../packages/shared/src';
import { buildDailyAnimeRows, createDailyAnimeEmbed } from '../../../../../packages/discord-ui/src';
import { AnimeService } from '../hoshika/AnimeService';

const log = createModuleLogger('DailyAnimeService');

export interface ZonedDateTimeParts {
  dateKey: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function isValidIanaTimezone(timezone: string | null | undefined): boolean {
  if (!timezone || typeof timezone !== 'string' || !timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone.trim() });
    return true;
  } catch {
    return false;
  }
}

export function getZonedDateTimeParts(
  date: Date = new Date(),
  timezone = 'Asia/Kolkata'
): ZonedDateTimeParts {
  const tz = isValidIanaTimezone(timezone) ? timezone.trim() : 'Asia/Kolkata';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const minute = Number(map.minute);

  const dateKey = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { dateKey, year, month, day, hour, minute };
}

export function isDailyScheduleDue(
  now: Date,
  config: Pick<DailyAnimeConfigRecord, 'enabled' | 'channelId' | 'hour' | 'minute' | 'timezone'>
): { due: boolean; dateKey: string; currentHour: number; currentMinute: number } {
  if (!config.enabled || !config.channelId || !isValidIanaTimezone(config.timezone)) {
    const fallbackParts = getZonedDateTimeParts(now, 'Asia/Kolkata');
    return {
      due: false,
      dateKey: fallbackParts.dateKey,
      currentHour: fallbackParts.hour,
      currentMinute: fallbackParts.minute,
    };
  }

  const parts = getZonedDateTimeParts(now, config.timezone);
  const currentTotalMinutes = parts.hour * 60 + parts.minute;
  const scheduledTotalMinutes = config.hour * 60 + config.minute;

  return {
    due: currentTotalMinutes >= scheduledTotalMinutes,
    dateKey: parts.dateKey,
    currentHour: parts.hour,
    currentMinute: parts.minute,
  };
}

export async function validateDailyAnimeChannel(
  guild: Guild,
  channelId: string
): Promise<TextBasedChannel & { id: string; name?: string; send: (payload: any) => Promise<any> }> {
  let ch: any = null;
  try {
    ch = await guild.channels.fetch(channelId);
  } catch (err: any) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : null;
    if (code === 50001) {
      throw new AppError(
        ERROR_CODES.BOT_MISSING_PERMISSIONS,
        `Bot is missing access to view <#${channelId}>.`,
        403
      );
    }
  }

  if (!ch) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Channel <#${channelId}> was not found in this Discord server.`,
      404
    );
  }

  const chGuildId = 'guildId' in ch && typeof ch.guildId === 'string' ? ch.guildId : guild.id;
  if (chGuildId !== guild.id) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'Selected channel does not belong to this Discord server.',
      400
    );
  }

  const isText =
    (typeof ch.isDMBased !== 'function' || !ch.isDMBased()) &&
    typeof ch.isTextBased === 'function' &&
    ch.isTextBased() &&
    typeof ch.send === 'function';

  if (!isText) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Channel <#${channelId}> is not a text-based channel where daily anime can be posted.`,
      400
    );
  }

  let me = guild.members?.me ?? null;
  if (!me && guild.members?.fetchMe) {
    me = await guild.members.fetchMe().catch(() => null);
  }

  if (me && typeof ch.permissionsFor === 'function') {
    const perms = ch.permissionsFor(me);
    if (perms) {
      const missing: string[] = [];
      if (!perms.has(PermissionFlagsBits.ViewChannel)) missing.push('View Channel');
      if (!perms.has(PermissionFlagsBits.SendMessages)) missing.push('Send Messages');
      if (!perms.has(PermissionFlagsBits.EmbedLinks)) missing.push('Embed Links');
      if (missing.length > 0) {
        throw new AppError(
          ERROR_CODES.BOT_MISSING_PERMISSIONS,
          `Bot is missing required permissions in <#${channelId}>: ${missing.join(', ')}.`,
          403
        );
      }
    }
  }

  return ch as TextBasedChannel & { id: string; name?: string; send: (payload: any) => Promise<any> };
}

export class DailyAnimeService {
  constructor(
    private readonly db: AniScrollDatabase,
    private readonly animeService: AnimeService,
    private readonly rng: () => number = () => Math.random()
  ) {}

  public resolveDateKeyForGuild(discordGuildId: string, now: Date = new Date()): string {
    if (discordGuildId === 'global') {
      return getZonedDateTimeParts(now, 'Asia/Kolkata').dateKey;
    }
    const config = this.db.getDailyAnimeConfig(discordGuildId);
    const tz = isValidIanaTimezone(config.timezone) ? config.timezone : 'Asia/Kolkata';
    return getZonedDateTimeParts(now, tz).dateKey;
  }

  private async fetchCandidatePool(locale: string): Promise<NormalizedAnime[]> {
    const byShortId = new Map<number, NormalizedAnime>();
    const collect = (items: NormalizedAnime[]) => {
      for (const item of items) {
        const sid = normalizeHoshikaShortId(item.shortId);
        if (sid && !byShortId.has(sid)) {
          byShortId.set(sid, { ...item, shortId: sid });
        }
      }
    };

    try {
      const trending = await this.animeService.getTrending('trending', locale);
      collect(trending.items);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Trending anime fetch failed for daily pool');
    }

    if (byShortId.size === 0) {
      try {
        const top = await this.animeService.getTrending('top', locale);
        collect(top.items);
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Top anime fallback fetch failed for daily pool');
      }
    }

    if (byShortId.size === 0) {
      const seasonal = await this.animeService.getSeasonal(locale).catch(() => ({ items: [] as NormalizedAnime[] }));
      collect(seasonal.items);
    }

    const pool = Array.from(byShortId.values());
    if (pool.length === 0) {
      throw new AppError(
        ERROR_CODES.HOSHIKA_UNAVAILABLE,
        'Could not retrieve anime candidates from Hoshika right now. Please try again shortly.',
        503
      );
    }
    return pool;
  }

  public async getOrCreateDailyRecommendation(
    discordGuildId: string,
    locale = 'en',
    options?: {
      dateKey?: string;
      forceRefresh?: boolean;
      excludeShortIds?: number[];
      now?: Date;
    }
  ): Promise<{ record: DailyAnimeRecord; isNew: boolean }> {
    const dateKey = options?.dateKey || this.resolveDateKeyForGuild(discordGuildId, options?.now);
    const existing = this.db.getDailyAnimeForDate(discordGuildId, dateKey);

    if (existing && !options?.forceRefresh) {
      return { record: existing, isNew: false };
    }

    const pool = await this.fetchCandidatePool(locale);
    const recentIds = this.db.getRecentDailyAnimeShortIds(discordGuildId, 30);
    const excluded = new Set<number>([...recentIds, ...(options?.excludeShortIds || [])]);
    if (options?.forceRefresh && existing?.hoshikaShortId) {
      excluded.add(existing.hoshikaShortId);
    }

    let eligible = pool.filter((item) => item.shortId !== null && !excluded.has(item.shortId));
    if (eligible.length === 0) {
      // Fallback gracefully when 30-day history covers the entire candidate pool
      const withoutCurrent = existing?.hoshikaShortId
        ? pool.filter((item) => item.shortId !== existing.hoshikaShortId)
        : pool;
      eligible = withoutCurrent.length > 0 ? withoutCurrent : pool;
    }

    const idx = Math.min(eligible.length - 1, Math.max(0, Math.floor(this.rng() * eligible.length)));
    const picked = eligible[idx];
    const hydrated = await this.animeService.hydrateAnimeItem(picked, locale);
    const anime = hydrated.anime;
    const shortId = normalizeHoshikaShortId(anime.shortId) ?? picked.shortId!;
    const title = anime.titleEnglish || anime.titleRomaji || anime.titleNative || `Anime #${shortId}`;

    const saved = this.db.saveDailyAnime({
      discordGuildId,
      dateKey,
      hoshikaShortId: shortId,
      hoshikaId: anime.hoshikaId,
      title,
      animeSnapshot: {
        ...anime,
        shortId,
        aniscrollUrl: this.animeService.linkService.buildUrl(shortId) ?? anime.aniscrollUrl ?? null,
      },
      status: options?.forceRefresh && existing?.status === 'POSTED' ? 'POSTED' : 'PENDING',
      overwrite: Boolean(options?.forceRefresh),
    });

    this.db.recordDailyAnimeHistory(discordGuildId, dateKey, shortId, title);

    return { record: saved, isNew: true };
  }

  public buildDailyMessagePayload(
    record: DailyAnimeRecord,
    options: {
      mode: 'manual' | 'public';
      ownerUserId?: string;
    }
  ) {
    const anime = record.animeSnapshot;
    const aniscrollUrl =
      this.animeService.linkService.buildUrl(record.hoshikaShortId) ?? anime.aniscrollUrl ?? null;

    const embed = createDailyAnimeEmbed(anime, {
      aniscrollUrl,
      dateKey: record.dateKey,
    });

    const components = buildDailyAnimeRows({
      shortId: record.hoshikaShortId,
      aniscrollUrl,
      mode: options.mode,
      guildKey: record.discordGuildId,
      dateKey: record.dateKey,
      ownerUserId: options.ownerUserId,
    });

    return { embeds: [embed], components };
  }

  public async postDailyAnimeToGuild(
    client: Client,
    discordGuildId: string,
    options?: { isTest?: boolean; now?: Date }
  ): Promise<{
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    channelId?: string | null;
    messageId?: string | null;
    record?: DailyAnimeRecord;
  }> {
    const isTest = Boolean(options?.isTest);
    const now = options?.now || new Date();
    const config = this.db.getDailyAnimeConfig(discordGuildId);

    if (!config.channelId) {
      if (isTest) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'No Daily Anime channel is configured for this server.',
          400
        );
      }
      return { ok: false, skipped: true, reason: 'No daily channel configured.' };
    }

    if (!isValidIanaTimezone(config.timezone)) {
      const msg = `Invalid IANA timezone "${config.timezone}".`;
      if (isTest) throw new AppError(ERROR_CODES.VALIDATION_ERROR, msg, 400);
      return { ok: false, reason: msg };
    }

    const dateKey = getZonedDateTimeParts(now, config.timezone).dateKey;

    if (!isTest) {
      const existing = this.db.getDailyAnimeForDate(discordGuildId, dateKey);
      if (existing && existing.status === 'POSTED') {
        return { ok: true, skipped: true, reason: 'Daily anime already posted for today.', record: existing };
      }
    }

    const guild =
      client.guilds?.cache?.get(discordGuildId) ||
      (client.guilds?.fetch ? await client.guilds.fetch(discordGuildId).catch(() => null) : null);

    if (!guild) {
      const msg = `Bot is not connected to Discord server ${discordGuildId}.`;
      if (isTest) throw new AppError(ERROR_CODES.VALIDATION_ERROR, msg, 404);
      return { ok: false, reason: msg };
    }

    let channel;
    try {
      channel = await validateDailyAnimeChannel(guild, config.channelId);
    } catch (err) {
      const msg = err instanceof AppError ? err.userMessage : err instanceof Error ? err.message : String(err);
      if (!isTest) {
        const existing = this.db.getDailyAnimeForDate(discordGuildId, dateKey);
        if (existing && existing.status !== 'POSTED') {
          this.db.markDailyAnimeFailed(discordGuildId, dateKey, msg);
        }
      }
      if (isTest) throw err;
      log.warn({ guildId: discordGuildId, channelId: config.channelId, err: msg }, 'Daily anime channel validation failed');
      return { ok: false, reason: msg };
    }

    const guildRow = this.db.getGuildByDiscordId(discordGuildId);
    const locale = guildRow ? this.db.getGuildSettings(discordGuildId).animeConfig.locale : 'en';

    const { record } = await this.getOrCreateDailyRecommendation(discordGuildId, locale, {
      dateKey,
      now,
    });

    if (!isTest) {
      const claimed = this.db.claimDailyAnimeForPosting(discordGuildId, dateKey, channel.id);
      if (!claimed) {
        const current = this.db.getDailyAnimeForDate(discordGuildId, dateKey);
        return {
          ok: true,
          skipped: true,
          reason: 'Daily anime already claimed or posted for today.',
          record: current ?? record,
        };
      }
    }

    try {
      const payload = this.buildDailyMessagePayload(record, { mode: 'public' });
      const sent = await channel.send(payload);
      const messageId = sent && typeof sent === 'object' && 'id' in sent ? String((sent as any).id) : null;

      if (!isTest) {
        const postedRecord = this.db.markDailyAnimePosted(discordGuildId, dateKey, channel.id, messageId);
        log.info(
          { guildId: discordGuildId, channelId: channel.id, dateKey, shortId: record.hoshikaShortId, messageId },
          'Posted automatic daily anime recommendation'
        );
        return {
          ok: true,
          channelId: channel.id,
          messageId,
          record: postedRecord ?? record,
        };
      }

      return {
        ok: true,
        channelId: channel.id,
        messageId,
        record,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isTest) {
        this.db.markDailyAnimeFailed(discordGuildId, dateKey, msg);
      }
      log.warn(
        { guildId: discordGuildId, channelId: channel.id, dateKey, err: msg },
        'Failed to post daily anime message to Discord'
      );
      if (isTest) {
        throw new AppError(
          ERROR_CODES.BOT_MISSING_PERMISSIONS,
          `Failed to send daily anime test message to <#${channel.id}>: ${msg}`,
          403
        );
      }
      return { ok: false, reason: msg };
    }
  }

  public async processDueGuilds(
    client: Client,
    now: Date = new Date()
  ): Promise<Array<{ guildId: string; ok: boolean; skipped?: boolean; reason?: string }>> {
    const configs = this.db.listEnabledDailyAnimeConfigs();
    const results: Array<{ guildId: string; ok: boolean; skipped?: boolean; reason?: string }> = [];

    for (const cfg of configs) {
      try {
        const dueCheck = isDailyScheduleDue(now, cfg);
        if (!dueCheck.due) {
          results.push({ guildId: cfg.discordGuildId, ok: true, skipped: true, reason: 'Not due yet.' });
          continue;
        }

        const existing = this.db.getDailyAnimeForDate(cfg.discordGuildId, dueCheck.dateKey);
        if (existing && (existing.status === 'POSTED' || existing.status === 'POSTING')) {
          results.push({ guildId: cfg.discordGuildId, ok: true, skipped: true, reason: 'Already posted.' });
          continue;
        }

        const postRes = await this.postDailyAnimeToGuild(client, cfg.discordGuildId, { now });
        results.push({
          guildId: cfg.discordGuildId,
          ok: postRes.ok,
          skipped: postRes.skipped,
          reason: postRes.reason,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ guildId: cfg.discordGuildId, err: msg }, 'Unhandled error processing daily anime guild');
        results.push({ guildId: cfg.discordGuildId, ok: false, reason: msg });
      }
    }

    return results;
  }
}
