import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import { getDatabase } from '../../../../packages/database/src';
import {
  appConfig,
  AppError,
  buildAniScrollAnimeUrl,
  createModuleLogger,
  ERROR_CODES,
} from '../../../../packages/shared/src';
import {
  animeConfigSchema,
  automodConfigSchema,
  giveawayCreateSchema,
  moderationCreateSchema,
  musicConfigSchema,
  notificationSendSchema,
  pollCreateSchema,
  reactionRolePanelSchema,
  suggestionCreateSchema,
  suggestionStatusSchema,
  ticketCreateSchema,
  warningCreateSchema,
  watchlistAddSchema,
  watchlistUpdateSchema,
  welcomeConfigSchema,
} from '../../../../packages/validation/src';
import { getBotRuntime } from '../../../bot/src';
import { getCacheService } from '../../../bot/src/services/cache/CacheService';
import { getAnimeServices } from '../../../bot/src/services/hoshika';
import { getMusicService } from '../../../bot/src/services/music/MusicService';
import { getWebsiteWatchlistService } from '../../../bot/src/services/watchlist/WebsiteWatchlistService';
import { TextChannel } from 'discord.js';
import { createMonochromeEmbed } from '../../../../packages/discord-ui/src';
import {
  buildDiscordBotInviteUrl,
  buildDiscordOAuthUrl,
  clearOAuthStateCookie,
  clearSessionCookie,
  DISCORD_OAUTH_CALLBACK_ROUTE,
  exchangeDiscordOAuthCode,
  getDiscordRedirectUri,
  getSessionFromRequest,
  readOAuthStateCookie,
  requireAuth,
  requireCsrf,
  resolveDiscordRedirectUri,
  SessionPayload,
  setOAuthStateCookie,
  setSessionCookie,
  verifyOAuthState,
  verifyWebhookSignature,
} from '../auth/session';

const log = createModuleLogger('ApiV1');

export function createApiV1Router(): Router {
  const router = Router();
  const db = getDatabase();
  const cache = getCacheService();
  const { animeService, client: hoshikaClient, identifiers } = getAnimeServices();
  const musicService = getMusicService();

  // Rate limit protection for API endpoints
  router.use(async (req, res, next) => {
    const ip = req.ip || 'unknown';
    const rl = await cache.checkRateLimit(`api:${ip}`, 180, 60);
    if (!rl.allowed) {
      res.status(429).json({ ok: false, code: ERROR_CODES.RATE_LIMIT_EXCEEDED, message: 'Too many requests.' });
      return;
    }
    next();
  });

  // ==================== HEALTH & STATUS ====================
  router.get('/health', (_req, res) => {
    const bot = getBotRuntime().getDiagnostics();
    const redirectResolution = resolveDiscordRedirectUri();
    const clientId = bot.applicationId || appConfig.DISCORD_CLIENT_ID || null;
    res.json({
      ok: true,
      service: 'aniscroll-bot-api',
      uptimeSeconds: Math.floor(process.uptime()),
      database: { connected: true, engine: appConfig.DATABASE_URL ? 'postgresql-ready (sqlite active)' : 'sqlite' },
      cache: cache.getStatus(),
      hoshika: hoshikaClient.getHealthState(),
      lavalink: musicService.getStatus(),
      websiteWatchlist: getWebsiteWatchlistService().getDiagnostics(),
      discord: {
        configured: bot.configured,
        oauthConfigured: appConfig.isOAuthConfigured,
        clientId,
        status: bot.status,
        tag: bot.tag,
        guildCount: bot.guildCount,
        connectedGuildIds: bot.connectedGuildIds,
        pingMs: bot.pingMs,
        commandCount: bot.commandCount,
        privilegedIntentsActive: bot.privilegedIntentsActive,
        hasGuildMembersIntent: bot.hasGuildMembersIntent,
        hasMessageContentIntent: bot.hasMessageContentIntent,
        enabledIntents: bot.enabledIntents,
        eventsRegistered: bot.eventsRegistered,
        guildMemberAddListenerCount: bot.guildMemberAddListenerCount,
        intentWarning: bot.intentWarning,
        lastError: bot.lastError,
        lastCommandSync: bot.lastCommandSync,
        commands: bot.commands,
      },
      oauthCallbackRoute: DISCORD_OAUTH_CALLBACK_ROUTE,
      oauthCallbackUrl: redirectResolution.redirectUri,
      redirectUriSource: redirectResolution.source,
      redirectUriWarning: redirectResolution.warning,
      botInviteUrl: clientId ? buildDiscordBotInviteUrl(clientId) : null,
    });
  });

  router.get('/discord/commands', async (_req, res, next) => {
    try {
      const live = await getBotRuntime().fetchLiveDiscordCommands();
      res.json(live);
    } catch (err) {
      next(err);
    }
  });

  // ==================== AUTHENTICATION ====================
  router.get('/auth/session', (req, res) => {
    const session = getSessionFromRequest(req);
    const bot = getBotRuntime().getDiagnostics();
    const redirectResolution = resolveDiscordRedirectUri();
    const clientId = bot.applicationId || appConfig.DISCORD_CLIENT_ID || '';
    res.json({
      ok: true,
      authenticated: Boolean(session),
      oauthConfigured: appConfig.isOAuthConfigured,
      callbackRoute: DISCORD_OAUTH_CALLBACK_ROUTE,
      callbackUrl: redirectResolution.redirectUri,
      redirectUriSource: redirectResolution.source,
      redirectUriWarning: redirectResolution.warning,
      botInviteUrl: buildDiscordBotInviteUrl(clientId),
      user: session
        ? {
            userId: session.userId,
            username: session.username,
            avatar: session.avatar,
            mode: session.mode,
            csrfToken: session.csrfToken,
          }
        : null,
    });
  });

  router.get('/auth/discord/url', (_req, res, next) => {
    try {
      const state = crypto.randomBytes(24).toString('hex');
      setOAuthStateCookie(res, state);
      const resolution = resolveDiscordRedirectUri();
      if (resolution.warning) {
        log.warn({ warning: resolution.warning }, 'Ignoring invalid DISCORD_REDIRECT_URI override');
      }
      const url = buildDiscordOAuthUrl(state, resolution.redirectUri);
      res.json({
        ok: true,
        url,
        redirectUri: resolution.redirectUri,
        callbackRoute: DISCORD_OAUTH_CALLBACK_ROUTE,
        warning: resolution.warning,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/sandbox', (_req, res) => {
    const guilds = db.listGuilds().map((g) => g.discordGuildId);
    const payload: SessionPayload = {
      userId: '100000000000000001',
      username: 'AniScrollAdmin',
      avatar: null,
      mode: 'local_sandbox',
      csrfToken: crypto.randomBytes(20).toString('hex'),
      guildIds: guilds,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
    };
    db.upsertUser(payload.userId, payload.username, payload.avatar);
    setSessionCookie(res, payload);
    res.json({
      ok: true,
      user: {
        userId: payload.userId,
        username: payload.username,
        avatar: payload.avatar,
        mode: payload.mode,
        csrfToken: payload.csrfToken,
      },
    });
  });

  router.post('/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ==================== ANIME (LIVE HOSHIKA) ====================
  router.get('/anime/status', (_req, res) => {
    res.json({
      ok: true,
      hoshika: hoshikaClient.getHealthState(),
      cache: cache.getStatus(),
      ttls: {
        search: appConfig.CACHE_TTL_SEARCH_SECONDS,
        details: appConfig.CACHE_TTL_DETAILS_SECONDS,
        episodes: appConfig.CACHE_TTL_EPISODES_SECONDS,
        trending: appConfig.CACHE_TTL_TRENDING_SECONDS,
        seasonal: appConfig.CACHE_TTL_SEASONAL_SECONDS,
        genres: appConfig.CACHE_TTL_GENRES_SECONDS,
      },
    });
  });

  router.get('/anime/search', async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim();
      const genre = req.query.genre ? String(req.query.genre) : undefined;
      const year = req.query.year ? Number(req.query.year) : undefined;
      const format = req.query.format ? String(req.query.format) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      if (!q && !genre && !format && !status) {
        res.json({ ok: true, items: [], cached: false });
        return;
      }
      const result = await animeService.searchService.search({
        query: q,
        genre,
        year: Number.isFinite(year) ? year : undefined,
        format,
        status,
        limit: 12,
      });
      if (q && result.items.length > 0) {
        const session = getSessionFromRequest(req);
        db.recordAnimeSearchMetric({
          query: q,
          hoshikaId: result.items[0].hoshikaId,
          title: result.items[0].titleEnglish || result.items[0].titleRomaji || q,
          genres: result.items[0].genres,
          userId: session?.userId || 'dashboard-guest',
        });
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.get('/anime/trending', async (_req, res, next) => {
    try {
      const result = await animeService.getTrending('trending', 'en');
      res.json({ ok: true, items: result.items.slice(0, 12), cached: result.cached });
    } catch (err) {
      next(err);
    }
  });

  router.get('/anime/genres', async (_req, res, next) => {
    try {
      const genres = await animeService.getGenres();
      res.json({ ok: true, genres });
    } catch (err) {
      next(err);
    }
  });

  router.get('/anime/:shortId', async (req, res, next) => {
    try {
      const result = await animeService.getDetails(req.params.shortId, 'en');
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  // ==================== WATCHLIST ====================
  router.get('/watchlist', requireAuth, (req, res) => {
    const session: SessionPayload = (req as any).session;
    const status = req.query.status ? (String(req.query.status) as any) : undefined;
    const sort = req.query.sort ? (String(req.query.sort) as 'title' | 'date') : undefined;
    const query = req.query.q ? String(req.query.q) : undefined;
    const items = db.listWatchlist(session.userId, { status, sort, query }).map((item) => ({
      ...item,
      aniscrollUrl: buildAniScrollAnimeUrl(item.hoshikaShortId, appConfig.ANISCROLL_WEB_BASE_URL),
    }));
    const stats = db.getWatchlistStats(session.userId);
    res.json({ ok: true, items, stats });
  });

  router.post('/watchlist', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const session: SessionPayload = (req as any).session;
      const body = watchlistAddSchema.parse(req.body);
      if (body.hoshikaShortId === undefined && body.hoshikaId) {
        const resolved = identifiers.resolve(body.hoshikaId);
        if (resolved && resolved.shortId != null && resolved.shortId > 0) {
          body.hoshikaShortId = resolved.shortId;
        }
      }
      if (body.hoshikaShortId != null && (body.totalEpisodes == null || !body.genresSnapshot || body.genresSnapshot.length === 0)) {
        try {
          const detail = await animeService.getDetails(body.hoshikaShortId, 'en');
          if (body.totalEpisodes == null && detail.anime.totalEpisodes != null) {
            body.totalEpisodes = detail.anime.totalEpisodes;
          }
          if ((!body.genresSnapshot || body.genresSnapshot.length === 0) && detail.anime.genres.length > 0) {
            body.genresSnapshot = detail.anime.genres;
          }
        } catch {
          // Graceful fallback if Hoshika details lookup is unavailable
        }
      }
      const entry = db.addWatchlistEntry(session.userId, body);
      res.status(201).json({
        ok: true,
        entry: {
          ...entry,
          aniscrollUrl: buildAniScrollAnimeUrl(entry.hoshikaShortId, appConfig.ANISCROLL_WEB_BASE_URL),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/watchlist/:id', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const session: SessionPayload = (req as any).session;
      const body = watchlistUpdateSchema.parse(req.body);
      const result = db.updateWatchlistEntry(session.userId, String(req.params.id), body);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/watchlist/:id', requireAuth, requireCsrf, (req, res) => {
    const session: SessionPayload = (req as any).session;
    const removed = db.removeWatchlistEntry(session.userId, String(req.params.id));
    res.json({ ok: true, removed });
  });

  router.get('/watchlist/export', requireAuth, (req, res) => {
    const session: SessionPayload = (req as any).session;
    const items = db.listWatchlist(session.userId);
    res.setHeader('Content-Disposition', `attachment; filename="aniscroll-watchlist-${session.userId}.json"`);
    res.json({ exportedAt: new Date().toISOString(), items });
  });

  // ==================== GUILDS & SETTINGS ====================
  router.get('/guilds', requireAuth, (req, res) => {
    const session: SessionPayload = (req as any).session;
    const all = db.listGuilds();
    const visible =
      session.mode === 'local_sandbox'
        ? all
        : all.filter((g) => session.guildIds.includes(g.discordGuildId));
    res.json({ ok: true, guilds: visible });
  });

  const assertGuildAccess = (req: Request, guildId: string) => {
    const session: SessionPayload = (req as any).session;
    if (session.mode !== 'local_sandbox' && !session.guildIds.includes(guildId)) {
      throw new AppError(ERROR_CODES.USER_MISSING_PERMISSIONS, 'Missing Manage Server permission for this guild.', 403);
    }
    const guild = db.getGuildByDiscordId(guildId);
    if (!guild) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Guild not found.', 404);
    }
    return { session, guild };
  };

  router.get('/guilds/:guildId/overview', requireAuth, (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      const settings = db.getGuildSettings(guild.discordGuildId);
      const cases = db.listModerationCases(guild.discordGuildId);
      const warnings = db.listWarnings(guild.discordGuildId);
      const tickets = db.listTickets(guild.discordGuildId);
      const suggestions = db.listSuggestions(guild.discordGuildId);
      const auditLogs = db.listAuditLogs(guild.discordGuildId);
      const analytics = db.getAnalytics(guild.discordGuildId);
      const bot = getBotRuntime().getDiagnostics();
      const music = musicService.getStatus();

      const recommendations = db.getCommunityRecommendationStats(
        guild.discordGuildId,
        appConfig.ANISCROLL_WEB_BASE_URL
      );

      res.json({
        ok: true,
        guild,
        settings,
        stats: {
          memberCount: guild.memberCount,
          totalCommands: analytics.totalCommands,
          moderationCasesCount: cases.length,
          activeWarningsCount: warnings.length,
          openTicketsCount: tickets.filter((t) => t.status !== 'CLOSED').length,
          suggestionsCount: suggestions.length,
          recommendationsCount: recommendations.totalRecommendations,
          activeMusicQueues: music.activeGuildQueues,
          uptimeSeconds: Math.floor(process.uptime()),
        },
        analytics: {
          topCommands: analytics.topCommands.slice(0, 5),
          popularGenres: analytics.popularGenres.slice(0, 5),
        },
        recentEvents: auditLogs.slice(0, 12),
        system: {
          botStatus: bot.status,
          botTag: bot.tag,
          pingMs: bot.pingMs,
          commandCount: bot.commandCount,
          hasGuildMembersIntent: bot.hasGuildMembersIntent,
          hasMessageContentIntent: bot.hasMessageContentIntent,
          guildMemberAddListenerCount: bot.guildMemberAddListenerCount,
          lastCommandSync: bot.lastCommandSync,
          lavalinkConnected: music.connected,
          lavalinkStatusLabel: music.statusLabel,
          hoshikaLastError: hoshikaClient.getHealthState().lastError,
          websiteWatchlistConfigured: getWebsiteWatchlistService().getDiagnostics().configured,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/guilds/:guildId/settings', requireAuth, (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      res.json({ ok: true, guild, settings: db.getGuildSettings(guild.discordGuildId) });
    } catch (err) {
      next(err);
    }
  });

  router.put('/guilds/:guildId/settings/:section', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const section = String(req.params.section);
      let validated: any;
      if (section === 'welcomeConfig') validated = welcomeConfigSchema.parse(req.body);
      else if (section === 'automodConfig') validated = automodConfigSchema.parse(req.body);
      else if (section === 'musicConfig') validated = musicConfigSchema.parse(req.body);
      else if (section === 'animeConfig') validated = animeConfigSchema.parse(req.body);
      else if (
        section === 'moderationConfig' ||
        section === 'loggingConfig' ||
        section === 'notificationConfig' ||
        section === 'communityConfig'
      ) {
        validated = req.body;
      } else {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid settings section.', 400);
      }
      const updated = db.updateGuildSettingsSection(guild.discordGuildId, section as any, validated, session.userId);
      res.json({ ok: true, settings: updated });
    } catch (err) {
      next(err);
    }
  });

  router.get('/guilds/:guildId/channels', requireAuth, async (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      const bot = getBotRuntime();
      const discordGuild = bot.client
        ? bot.client.guilds.cache.get(guild.discordGuildId) ||
          (await bot.client.guilds.fetch(guild.discordGuildId).catch(() => null))
        : null;

      if (!discordGuild) {
        res.json({ ok: true, channels: (guild.channels || []).filter((c: any) => c.type === 'text') });
        return;
      }

      const me = discordGuild.members.me;
      const channels = discordGuild.channels.cache
        .filter((c) => c.isTextBased())
        .map((c: any) => {
          const hasPerms = me ? c.permissionsFor(me)?.has(['ViewChannel', 'SendMessages']) : true;
          return {
            id: c.id,
            name: c.name,
            canSend: hasPerms ?? true,
          };
        })
        .filter((c) => c.canSend);

      res.json({ ok: true, channels });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/welcome/test', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const config = welcomeConfigSchema.parse(req.body);

      if (!config.channelId) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Select a welcome channel before testing.', 400);
      }

      const bot = getBotRuntime();
      const discordGuild = bot.client
        ? bot.client.guilds.cache.get(guild.discordGuildId) ||
          (await bot.client.guilds.fetch(guild.discordGuildId).catch(() => null))
        : null;

      if (!discordGuild) {
        throw new AppError(ERROR_CODES.BOT_MISSING_PERMISSIONS, 'Bot is not connected to this Discord server.', 400);
      }

      const testUsername = session.username || 'TestMember';
      const testUserId = session.userId || '123456789012345678';
      const testAvatarUrl = session.avatar
        ? `https://cdn.discordapp.com/avatars/${testUserId}/${session.avatar}.png`
        : 'https://cdn.discordapp.com/embed/avatars/0.png';

      const {
        resolveAndValidateWelcomeChannel,
        buildWelcomeMessagePayload,
      } = await import('../../../bot/src/services/welcome/WelcomeService');

      const validatedChannel = await resolveAndValidateWelcomeChannel(discordGuild, config.channelId);
      const payload = buildWelcomeMessagePayload(
        config,
        {
          userId: testUserId,
          username: testUsername,
          displayName: testUsername,
          avatarUrl: testAvatarUrl,
          accountCreatedAt: new Date(),
          guildId: discordGuild.id,
          guildName: discordGuild.name,
          memberCount: discordGuild.memberCount || 42,
        },
        { isTest: true }
      );

      await validatedChannel.send(payload);

      const currentSettings = db.getGuildSettings(guild.discordGuildId);
      currentSettings.welcomeConfig.lastError = null;
      db.updateGuildSettingsSection(guild.discordGuildId, 'welcomeConfig', currentSettings.welcomeConfig, session.userId);

      res.json({ ok: true, message: 'Test welcome message sent successfully.' });
    } catch (err) {
      next(err);
    }
  });

  router.get('/guilds/:guildId/welcome/diagnostics', requireAuth, async (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      const bot = getBotRuntime();
      const { runWelcomeDiagnostics } = await import('../../../bot/src/services/welcome/WelcomeService');
      const report = await runWelcomeDiagnostics({
        client: bot.client,
        status: bot.status,
        privilegedIntentsActive: bot.privilegedIntentsActive,
        intentWarning: bot.intentWarning,
        guildId: guild.discordGuildId,
        db,
        sendTestMessage: false,
      });
      res.json({ ok: true, diagnostics: report });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/welcome/diagnostics', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const bot = getBotRuntime();
      const { runWelcomeDiagnostics } = await import('../../../bot/src/services/welcome/WelcomeService');
      const sendTestMessage = Boolean(req.body?.sendTestMessage);
      const report = await runWelcomeDiagnostics({
        client: bot.client,
        status: bot.status,
        privilegedIntentsActive: bot.privilegedIntentsActive,
        intentWarning: bot.intentWarning,
        guildId: guild.discordGuildId,
        db,
        sendTestMessage,
        actorUser: {
          id: session.userId,
          username: session.username || 'Admin',
          createdAt: new Date(),
          displayAvatarURL: () =>
            session.avatar
              ? `https://cdn.discordapp.com/avatars/${session.userId}/${session.avatar}.png`
              : 'https://cdn.discordapp.com/embed/avatars/0.png',
        } as any,
      });
      res.json({ ok: true, diagnostics: report });
    } catch (err) {
      next(err);
    }
  });

  // ==================== MODERATION ====================
  router.get('/guilds/:guildId/moderation', requireAuth, (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      res.json({
        ok: true,
        cases: db.listModerationCases(guild.discordGuildId),
        warnings: db.listWarnings(guild.discordGuildId),
        settings: db.getGuildSettings(guild.discordGuildId),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/moderation/cases', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const body = moderationCreateSchema.parse({ ...req.body, moderatorId: session.userId });
      if (body.action === 'WARN') {
        const resWarn = db.issueWarningWithEscalation(guild.discordGuildId, {
          userId: body.targetUserId,
          moderatorId: session.userId,
          reason: body.reason,
        });
        res.status(201).json({ ok: true, ...resWarn });
        return;
      }
      const modCase = db.createModerationCase(guild.discordGuildId, body);
      res.status(201).json({ ok: true, modCase });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/moderation/warnings', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const body = warningCreateSchema.parse({ ...req.body, moderatorId: session.userId });
      const result = db.issueWarningWithEscalation(guild.discordGuildId, body);
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/guilds/:guildId/moderation/warnings/:warningId', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      const removed = db.removeWarning(guild.discordGuildId, String(req.params.warningId));
      res.json({ ok: true, removed });
    } catch (err) {
      next(err);
    }
  });

  // ==================== COMMUNITY ====================
  router.get('/guilds/:guildId/community', requireAuth, (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      const settings = db.getGuildSettings(guild.discordGuildId);
      res.json({
        ok: true,
        suggestions: db.listSuggestions(guild.discordGuildId),
        tickets: db.listTickets(guild.discordGuildId),
        polls: db.listPolls(guild.discordGuildId),
        giveaways: db.listGiveaways(guild.discordGuildId),
        reactionRoles: db.listReactionRolePanels(guild.discordGuildId),
        recommendations: db.getCommunityRecommendationStats(
          guild.discordGuildId,
          appConfig.ANISCROLL_WEB_BASE_URL
        ),
        animeConfig: settings.animeConfig,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/guilds/:guildId/recommendations', requireAuth, (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      const settings = db.getGuildSettings(guild.discordGuildId);
      res.json({
        ok: true,
        stats: db.getCommunityRecommendationStats(
          guild.discordGuildId,
          appConfig.ANISCROLL_WEB_BASE_URL
        ),
        animeConfig: settings.animeConfig,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/community/suggestions', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const body = suggestionCreateSchema.parse({ userId: session.userId, content: req.body.content });
      const suggestion = db.createSuggestion(guild.discordGuildId, body.userId, body.content);
      res.status(201).json({ ok: true, suggestion });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/community/suggestions/:id/vote', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session } = assertGuildAccess(req, String(req.params.guildId));
      const vote = req.body.vote === 'down' ? 'down' : 'up';
      const suggestion = db.voteSuggestion(String(req.params.id), session.userId, vote);
      res.json({ ok: true, suggestion });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/guilds/:guildId/community/suggestions/:id', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const body = suggestionStatusSchema.parse(req.body);
      const suggestion = db.updateSuggestionStatus(
        guild.discordGuildId,
        String(req.params.id),
        body.status,
        body.staffResponse,
        session.userId
      );
      res.json({ ok: true, suggestion });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/community/tickets', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const body = ticketCreateSchema.parse({ ...req.body, userId: session.userId });
      const ticket = db.createTicket(guild.discordGuildId, {
        channelId: `dash-${crypto.randomUUID().slice(0, 8)}`,
        userId: body.userId,
        category: body.category,
        subject: body.subject,
      });
      res.status(201).json({ ok: true, ticket });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/guilds/:guildId/community/tickets/:id', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const status = req.body.status as 'OPEN' | 'CLAIMED' | 'CLOSED';
      const ticket = db.updateTicketStatus(
        guild.discordGuildId,
        String(req.params.id),
        status,
        session.userId,
        req.body.transcriptText
      );
      res.json({ ok: true, ticket });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/community/polls', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const body = pollCreateSchema.parse({ ...req.body, creatorId: session.userId });
      const poll = db.createPoll(guild.discordGuildId, body);
      res.status(201).json({ ok: true, poll });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/community/polls/:id/vote', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session } = assertGuildAccess(req, String(req.params.guildId));
      const poll = db.votePoll(String(req.params.id), session.userId, Number(req.body.optionIndex));
      res.json({ ok: true, poll });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/community/giveaways', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const body = giveawayCreateSchema.parse({ ...req.body, hostId: session.userId });
      const giveaway = db.createGiveaway(guild.discordGuildId, body);
      res.status(201).json({ ok: true, giveaway });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/community/giveaways/:id/draw', requireAuth, requireCsrf, (req, res, next) => {
    try {
      assertGuildAccess(req, String(req.params.guildId));
      const giveaway = db.drawGiveawayWinners(String(req.params.id));
      res.json({ ok: true, giveaway });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/community/reaction-roles', requireAuth, requireCsrf, (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      const body = reactionRolePanelSchema.parse(req.body);
      const panel = db.createReactionRolePanel(guild.discordGuildId, body);
      res.status(201).json({ ok: true, panel });
    } catch (err) {
      next(err);
    }
  });

  // ==================== NOTIFICATIONS & ANALYTICS ====================
  router.get('/guilds/:guildId/notifications', requireAuth, (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      res.json({ ok: true, notifications: db.listNotifications(guild.discordGuildId) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/guilds/:guildId/notifications', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const { session, guild } = assertGuildAccess(req, String(req.params.guildId));
      const body = notificationSendSchema.parse(req.body);
      const botClient = getBotRuntime().client;
      let deliveryStatus = 'RECORDED_OFFLINE';
      let errorMessage: string | null = 'Discord bot gateway is offline; saved to notification log.';

      if (botClient && botClient.isReady()) {
        try {
          const channel = await botClient.channels.fetch(body.destinationChannelId);
          if (channel && channel.isTextBased() && 'send' in channel) {
            await channel.send({
              embeds: [
                {
                  title: body.title,
                  description: body.message,
                  color: 0x111111,
                  url: body.url,
                  footer: { text: `AniScroll Announcement · ${body.type}` },
                },
              ],
            });
            deliveryStatus = 'DELIVERED';
            errorMessage = null;
          }
        } catch (err) {
          deliveryStatus = 'FAILED';
          errorMessage = err instanceof Error ? err.message : 'Channel send failed';
        }
      }

      const record = db.createNotification(guild.discordGuildId, {
        type: body.type,
        destinationChannelId: body.destinationChannelId,
        title: body.title,
        payload: { message: body.message, url: body.url, actorId: session.userId },
        deliveryStatus,
        errorMessage,
      });
      res.status(201).json({ ok: true, notification: record });
    } catch (err) {
      next(err);
    }
  });

  router.post('/webhooks/aniscroll', express.raw({ type: 'application/json' }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
    const sig = req.header('x-aniscroll-signature');
    if (
      !appConfig.ANISCROLL_WEBHOOK_SECRET ||
      !verifyWebhookSignature(raw, sig, appConfig.ANISCROLL_WEBHOOK_SECRET)
    ) {
      res.status(401).json({ ok: false, code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid webhook signature.' });
      return;
    }
    const parsed = JSON.parse(raw);
    const dedupeKey = parsed.eventId ? `aniscroll:${parsed.eventId}` : null;
    const guilds = db.listGuilds();
    for (const g of guilds) {
      const notifCfg = db.getGuildSettings(g.discordGuildId).notificationConfig;
      const dest = notifCfg.defaultChannelId;
      if (notifCfg.enabled && dest) {
        try {
          db.createNotification(g.discordGuildId, {
            type: 'WEBSITE_RELEASE',
            destinationChannelId: dest,
            title: parsed.title || 'AniScroll Update',
            payload: parsed,
            deliveryStatus: 'QUEUED',
            dedupeKey: dedupeKey ? `${dedupeKey}:${g.discordGuildId}` : null,
          });
        } catch {
          // Deduplicated duplicate event
        }
      }
    }
    res.json({ ok: true });
  });

  router.get('/guilds/:guildId/analytics', requireAuth, (req, res, next) => {
    try {
      const { guild } = assertGuildAccess(req, String(req.params.guildId));
      res.json({
        ok: true,
        analytics: db.getAnalytics(guild.discordGuildId),
        watchlistGlobal: db.getWatchlistStats(),
        auditLogs: db.listAuditLogs(guild.discordGuildId),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/cache/clear', requireAuth, requireCsrf, async (req, res) => {
    const ns = req.body?.namespace ? String(req.body.namespace) : '';
    const cleared = await cache.clearNamespace(ns);
    res.json({ ok: true, cleared });
  });

  router.get('/admin/music/status', requireAuth, (_req, res) => {
    res.json({ ok: true, lavalink: musicService.getStatus() });
  });

  router.post('/admin/music/test', requireAuth, requireCsrf, async (_req, res) => {
    const result = await musicService.testConnection();
    res.json({ ok: true, result, lavalink: musicService.getStatus() });
  });

  // Error handler (structured, never exposes stack traces)
  router.use((err: unknown, _req: Request, res: Response, _next: any) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ ok: false, code: err.code, message: err.userMessage });
      return;
    }
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(400).json({ ok: false, code: ERROR_CODES.VALIDATION_ERROR, message: 'Validation failed.', details: (err as any).issues });
      return;
    }
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'API error');
    res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Internal server error.' });
  });

  return router;
}

export function registerOAuthCallbackRoute(
  app: express.Application,
  deps?: { fetchImpl?: typeof fetch }
) {
  const db = getDatabase();
  app.get([DISCORD_OAUTH_CALLBACK_ROUTE, `${DISCORD_OAUTH_CALLBACK_ROUTE}/`], async (req, res) => {
    const { code, state, error } = req.query;
    const expectedState = readOAuthStateCookie(req);
    clearOAuthStateCookie(res);

    const isOAuthConfigured =
      appConfig.isOAuthConfigured ||
      Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);

    if (
      error ||
      typeof code !== 'string' ||
      !code.trim() ||
      !verifyOAuthState(state, expectedState) ||
      !isOAuthConfigured
    ) {
      const reason = error
        ? 'Discord authorization was denied or returned an error.'
        : !isOAuthConfigured
          ? 'Discord OAuth2 server credentials are missing.'
          : 'Invalid or expired OAuth2 state/code parameter.';
      res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:24px;">
          <p>${reason}</p>
          <script>if(window.opener){window.opener.postMessage({type:'OAUTH_AUTH_ERROR'},window.location.origin);setTimeout(()=>window.close(),1500);}</script>
        </body></html>
      `);
      return;
    }

    try {
      const redirectUri = getDiscordRedirectUri();
      const result = await exchangeDiscordOAuthCode({
        code: code.trim(),
        redirectUri,
        clientId: process.env.DISCORD_CLIENT_ID || appConfig.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET || appConfig.DISCORD_CLIENT_SECRET,
        fetchImpl: deps?.fetchImpl,
      });

      const botClient = getBotRuntime().client;
      for (const g of result.manageableGuilds) {
        db.ensureGuild({
          discordGuildId: g.id,
          name: g.name,
          icon: g.icon,
          botInstalled: Boolean(botClient?.guilds.cache.has(g.id)),
        });
      }

      db.upsertUser(result.user.id, result.user.username, result.user.avatar);
      setSessionCookie(res, {
        userId: result.user.id,
        username: result.user.username,
        avatar: result.user.avatar,
        mode: 'discord_oauth',
        csrfToken: crypto.randomBytes(20).toString('hex'),
        guildIds: result.manageableGuilds.map((g) => g.id),
        issuedAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
      });

      res.send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:24px;">
          <p>Authentication successful. Closing window...</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, window.location.origin);
              window.close();
            } else {
              window.location.href = '/servers';
            }
          </script>
        </body></html>
      `);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Discord OAuth2 callback exchange failed'
      );
      res.status(502).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:24px;">
          <p>Discord OAuth2 token exchange failed. Verify your DISCORD_REDIRECT_URI and Discord Developer Portal settings.</p>
          <script>if(window.opener){window.opener.postMessage({type:'OAUTH_AUTH_ERROR'},window.location.origin);setTimeout(()=>window.close(),1500);}</script>
        </body></html>
      `);
    }
  });
}
