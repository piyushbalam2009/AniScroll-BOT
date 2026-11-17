import { Client, Events, GatewayIntentBits, IntentsBitField, REST, Routes } from 'discord.js';
import { getDatabase } from '../../../packages/database/src';
import { appConfig, createModuleLogger } from '../../../packages/shared/src';
import { buildMusicControlRows, createMonochromeEmbed, createNowPlayingEmbed } from '../../../packages/discord-ui/src';
import { buildCommandRegistry } from './commands';
import { registerDiscordEvents } from './events/registerEvents';
import { getCacheService } from './services/cache/CacheService';
import { getAnimeServices } from './services/hoshika';
import { SchedulerService } from './services/jobs/SchedulerService';
import { getMusicService } from './services/music/MusicService';
import { getWebsiteWatchlistService } from './services/watchlist/WebsiteWatchlistService';
import { AniGuessService, getAniGuessService } from './services/anime/AniGuessService';
import { getStatusMonitorService } from './services/status/StatusMonitorService';

const log = createModuleLogger('BotRuntime');

export function getGatewayIntents(
  includePrivileged: boolean,
  includeMessageContent = false
): GatewayIntentBits[] {
  const base = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ];
  if (includePrivileged) {
    base.push(GatewayIntentBits.GuildMembers);
  }
  if (includeMessageContent) {
    base.push(GatewayIntentBits.MessageContent);
  }
  return base;
}

export function isDisallowedIntentsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined;
  return /disallowed intents/i.test(msg) || code === 4014;
}

export function isMissingAccessError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined;
  return code === 50001 || /Missing Access/i.test(msg);
}

export class AniScrollBotRuntime {
  public client: Client | null = null;
  public maintenanceMode = false;
  public status: 'offline' | 'connecting' | 'ready' | 'error' = 'offline';
  public lastError: string | null = null;
  public intentWarning: string | null = null;
  public privilegedIntentsActive = false;
  public eventsRegistered = false;
  public lastCommandSync: (SlashCommandSyncResult & { syncedAt: string; error?: string | null }) | null = null;
  private scheduler = new SchedulerService();
  private commands = buildCommandRegistry();
  private aniGuessService: AniGuessService | null = null;

  public getDiagnostics() {
    const bitfield = this.client?.options?.intents
      ? new IntentsBitField(this.client.options.intents)
      : null;
    const enabledIntents = bitfield ? bitfield.toArray() : [];
    const hasGuildMembersIntent = Boolean(bitfield?.has(GatewayIntentBits.GuildMembers));
    const hasMessageContentIntent = Boolean(bitfield?.has(GatewayIntentBits.MessageContent));
    const guildMemberAddListenerCount = this.client
      ? this.client.listenerCount(Events.GuildMemberAdd)
      : 0;

    return {
      configured: appConfig.isDiscordConfigured,
      status: this.status,
      applicationId: this.client?.application?.id || this.client?.user?.id || appConfig.DISCORD_CLIENT_ID || null,
      tag: this.client?.user?.tag ?? null,
      guildCount: this.client?.guilds.cache.size ?? 0,
      connectedGuildIds: this.client ? Array.from(this.client.guilds.cache.keys()) : [],
      pingMs: this.client?.ws.ping ?? null,
      commandCount: this.commands.size,
      maintenanceMode: this.maintenanceMode,
      privilegedIntentsActive: this.privilegedIntentsActive,
      hasGuildMembersIntent,
      hasMessageContentIntent,
      enabledIntents,
      eventsRegistered: this.eventsRegistered,
      guildMemberAddListenerCount,
      intentWarning: this.intentWarning,
      lastError: this.lastError,
      lastCommandSync: this.lastCommandSync,
      commands: Array.from(this.commands.values()).map((c) => ({
        name: c.name,
        category: c.category,
        description: c.data.description,
      })),
    };
  }

  public async fetchLiveDiscordCommands() {
    const applicationId =
      this.client?.application?.id || this.client?.user?.id || appConfig.DISCORD_CLIENT_ID || null;
    if (!appConfig.DISCORD_TOKEN || !applicationId) {
      return { ok: false, reason: 'Bot token or application ID missing', global: [], guilds: {} };
    }
    const rest = new REST({ version: '10' }).setToken(appConfig.DISCORD_TOKEN);
    const globalCmds = (await rest.get(Routes.applicationCommands(applicationId))) as Array<{
      id: string;
      name: string;
      type?: number;
      handler?: number;
    }>;
    const guilds: Record<string, Array<{ id: string; name: string; type?: number }>> = {};
    const knownGuildIds = this.client ? Array.from(this.client.guilds.cache.keys()) : [];
    for (const gid of knownGuildIds) {
      const gCmds = (await rest.get(Routes.applicationGuildCommands(applicationId, gid)).catch(() => [])) as Array<{
        id: string;
        name: string;
        type?: number;
      }>;
      guilds[gid] = (gCmds || []).map((c) => ({ id: c.id, name: c.name, type: c.type }));
    }
    return {
      ok: true,
      applicationId,
      global: (globalCmds || []).map((c) => ({ id: c.id, name: c.name, type: c.type, handler: c.handler })),
      guilds,
    };
  }

  private buildConfiguredClient(includePrivileged: boolean, includeMessageContent = false): Client {
    const requestedIntents = getGatewayIntents(includePrivileged, includeMessageContent);
    const client = new Client({
      intents: requestedIntents,
    });
    const intentNames = new IntentsBitField(client.options.intents).toArray();

    log.info(
      {
        includePrivileged,
        includeMessageContent,
        privilegedIntentsMode: appConfig.DISCORD_PRIVILEGED_INTENTS,
        enabledIntents: intentNames,
        hasGuildsIntent: new IntentsBitField(client.options.intents).has(GatewayIntentBits.Guilds),
        hasGuildMembersIntent: new IntentsBitField(client.options.intents).has(GatewayIntentBits.GuildMembers),
        hasMessageContentIntent: new IntentsBitField(client.options.intents).has(GatewayIntentBits.MessageContent),
      },
      'Configured Discord Client gateway intents'
    );

    const db = getDatabase();
    const cache = getCacheService();
    const { animeService } = getAnimeServices();
    const aniGuessService = getAniGuessService(animeService);
    this.aniGuessService = aniGuessService;
    const musicService = getMusicService();
    const websiteWatchlist = getWebsiteWatchlistService();

    registerDiscordEvents(client, this.commands, {
      db,
      cache,
      animeService,
      aniGuessService,
      musicService,
      websiteWatchlist,
      maintenanceMode: this.maintenanceMode,
      setMaintenanceMode: (enabled) => {
        this.maintenanceMode = enabled;
      },
      reloadCommands: async () => {
        this.commands = buildCommandRegistry();
        await this.registerSlashCommands();
        return this.commands.size;
      },
    });
    this.eventsRegistered = client.listenerCount(Events.GuildMemberAdd) === 1;

    client.once(Events.ClientReady, async () => {
      this.status = 'ready';
      this.lastError = null;
      const clientIntents = new IntentsBitField(client.options.intents);
      const hasGuildMembers = clientIntents.has(GatewayIntentBits.GuildMembers);
      this.privilegedIntentsActive = includePrivileged && hasGuildMembers;
      if (this.privilegedIntentsActive && includeMessageContent) {
        this.intentWarning = null;
      }

      const guildSummaries = Array.from(client.guilds.cache.values()).map((g) => {
        let wcSummary: { enabled: boolean; channelId: string | null } | null = null;
        try {
          db.ensureGuild({
            discordGuildId: g.id,
            name: g.name,
            icon: g.icon,
            memberCount: g.memberCount,
            botInstalled: true,
          });
          const settings = db.getGuildSettings(g.id);
          wcSummary = {
            enabled: settings.welcomeConfig.enabled,
            channelId: settings.welcomeConfig.channelId,
          };
        } catch {
          wcSummary = null;
        }
        return {
          guildId: g.id,
          name: g.name,
          memberCount: g.memberCount,
          welcome: wcSummary,
        };
      });

      log.info(
        {
          tag: client.user?.tag,
          guilds: client.guilds.cache.size,
          privilegedIntentsActive: this.privilegedIntentsActive,
          hasGuildMembersIntent: hasGuildMembers,
          enabledIntents: clientIntents.toArray(),
          guildMemberAddListenerCount: client.listenerCount(Events.GuildMemberAdd),
          intentWarning: this.intentWarning,
          connectedGuilds: guildSummaries,
        },
        'Discord bot logged in'
      );
      await this.registerSlashCommands().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.lastCommandSync = {
          synced: false,
          applicationId: client.application?.id || client.user?.id || null,
          globalCommandCount: 0,
          updatedGuildIds: [],
          cleanedStaleGuildIds: [],
          syncedAt: new Date().toISOString(),
          error: msg,
        };
        log.warn({ err: msg }, 'Slash command registration warning');
      });
      this.scheduler.start(client);
      getStatusMonitorService().start(client);
    });

    client.on('error', (err) => {
      this.lastError = err.message;
      log.error({ err: err.message }, 'Discord client error');
    });

    musicService.setRenderHook({
      onTrackChange: async (guildId, queue) => {
        const msg = musicService.getNowPlayingMessage(guildId);
        if (!msg) return;
        const posMs = musicService.getLivePositionMs(guildId);
        await msg
          .edit({
            embeds: [createNowPlayingEmbed(queue, posMs)],
            components: buildMusicControlRows(queue.paused, queue.loopMode, Boolean(queue.current)),
          })
          .catch(() => undefined);
      },
      onPlaybackStop: async (guildId, queue, reason) => {
        const msg = musicService.getNowPlayingMessage(guildId);
        if (!msg) return;
        await msg
          .edit({
            embeds: [
              createMonochromeEmbed({
                title: 'Playback Ended',
                description: reason,
              }),
            ],
            components: buildMusicControlRows(queue.paused, queue.loopMode, false),
          })
          .catch(() => undefined);
      },
    });

    musicService.init(client);

    return client;
  }

  public async start() {
    this.scheduler.start(this.client ?? undefined);

    if (!appConfig.isDiscordConfigured) {
      this.status = 'offline';
      this.lastError = 'DISCORD_TOKEN is not configured.';
      log.info('DISCORD_TOKEN not set; bot gateway skipped (dashboard & API remain active)');
      return;
    }

    this.status = 'connecting';
    this.intentWarning = null;
    const tryPrivilegedFirst = appConfig.DISCORD_PRIVILEGED_INTENTS !== 'false';
    if (!tryPrivilegedFirst) {
      this.intentWarning =
        'DISCORD_PRIVILEGED_INTENTS=false disables GatewayIntentBits.GuildMembers; guildMemberAdd events will not fire.';
    }
    const primaryClient = this.buildConfiguredClient(tryPrivilegedFirst, tryPrivilegedFirst);
    this.client = primaryClient;

    try {
      await primaryClient.login(appConfig.DISCORD_TOKEN);
    } catch (err) {
      if (tryPrivilegedFirst && isDisallowedIntentsError(err)) {
        // Step 1 fallback: keep GuildMembers active even if MessageContent is not yet enabled in Developer Portal
        const msgContentWarn =
          'Message Content Intent (GatewayIntentBits.MessageContent) was rejected by Discord (code 4014). Keeping Server Members Intent active; /aniguess supports @mention and Submit Answer modal fallback until Message Content Intent is enabled in the Discord Developer Portal.';
        this.intentWarning = msgContentWarn;
        log.warn({ err: err instanceof Error ? err.message : String(err) }, msgContentWarn);
        await primaryClient.destroy().catch(() => undefined);

        const membersOnlyClient = this.buildConfiguredClient(true, false);
        this.client = membersOnlyClient;
        try {
          await membersOnlyClient.login(appConfig.DISCORD_TOKEN);
          return;
        } catch (membersErr) {
          if (appConfig.DISCORD_PRIVILEGED_INTENTS === 'auto' && isDisallowedIntentsError(membersErr)) {
            const warning =
              'Server Members Intent (GatewayIntentBits.GuildMembers) was rejected by Discord (code 4014). Enable Application -> Bot -> Privileged Gateway Intents -> Server Members Intent in the Discord Developer Portal so member join welcome messages work. Running fallback without GuildMembers.';
            this.intentWarning = warning;
            log.error({ err: membersErr instanceof Error ? membersErr.message : String(membersErr) }, warning);
            await membersOnlyClient.destroy().catch(() => undefined);

            const fallbackClient = this.buildConfiguredClient(false, false);
            this.client = fallbackClient;
            try {
              await fallbackClient.login(appConfig.DISCORD_TOKEN);
              return;
            } catch (fallbackErr) {
              this.status = 'error';
              this.lastError = fallbackErr instanceof Error ? fallbackErr.message : 'Login failed';
              log.error({ err: this.lastError }, 'Discord login failed after fallback');
              return;
            }
          }

          this.status = 'error';
          this.lastError = membersErr instanceof Error ? membersErr.message : 'Login failed';
          log.error({ err: this.lastError }, 'Discord login failed');
          return;
        }
      }

      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : 'Login failed';
      log.error({ err: this.lastError }, 'Discord login failed');
    }
  }

  public async registerSlashCommands() {
    const applicationId =
      this.client?.application?.id || this.client?.user?.id || appConfig.DISCORD_CLIENT_ID;
    const knownGuildIds = this.client ? Array.from(this.client.guilds.cache.keys()) : [];
    const result = await synchronizeDiscordSlashCommands({
      token: appConfig.DISCORD_TOKEN,
      applicationId,
      devGuildId: appConfig.DISCORD_DEV_GUILD_ID,
      knownGuildIds,
      commands: this.commands,
    });
    this.lastCommandSync = {
      ...result,
      syncedAt: new Date().toISOString(),
      error: result.reason ?? null,
    };
    return result;
  }

  public async stop() {
    this.scheduler.stop();
    getStatusMonitorService().stop();
    this.aniGuessService?.disposeAll();
    if (this.client) {
      await this.client.destroy();
    }
  }
}

export interface SlashCommandSyncResult {
  synced: boolean;
  applicationId: string | null;
  globalCommandCount: number;
  updatedGuildIds: string[];
  cleanedStaleGuildIds: string[];
  reason?: string;
}

export async function synchronizeDiscordSlashCommands(options?: {
  token?: string;
  applicationId?: string | null;
  devGuildId?: string | null;
  knownGuildIds?: string[];
  commands?: Map<string, { data: { toJSON: () => any } }>;
  restClient?: {
    put: (route: string, options: { body: unknown }) => Promise<unknown>;
    get?: (route: string) => Promise<unknown>;
  };
}): Promise<SlashCommandSyncResult> {
  const token = options?.token ?? appConfig.DISCORD_TOKEN;
  const applicationId = options?.applicationId ?? appConfig.DISCORD_CLIENT_ID ?? null;
  const devGuildId = options?.devGuildId !== undefined ? options.devGuildId : appConfig.DISCORD_DEV_GUILD_ID;
  const commandMap = options?.commands ?? buildCommandRegistry();

  if (!token || !applicationId) {
    return {
      synced: false,
      applicationId,
      globalCommandCount: 0,
      updatedGuildIds: [],
      cleanedStaleGuildIds: [],
      reason: 'DISCORD_TOKEN or DISCORD_CLIENT_ID is not configured.',
    };
  }

  const rest =
    options?.restClient ??
    (new REST({ version: '10' }).setToken(token) as unknown as {
      put: (route: string, options: { body: unknown }) => Promise<unknown>;
      get: (route: string) => Promise<unknown>;
    });

  const body = Array.from(commandMap.values()).map((c) => c.data.toJSON());

  // 1. Preserve any Discord Activity / Entry Point commands (type === 4) so Discord bulk PUT does not reject
  let globalBody: any[] = [...body];
  if (typeof rest.get === 'function') {
    try {
      const existingGlobalCmds = (await rest.get(Routes.applicationCommands(applicationId))) as
        | Array<Record<string, any>>
        | undefined;
      if (Array.isArray(existingGlobalCmds)) {
        const entryPointCommands = existingGlobalCmds
          .filter((cmd) => cmd && cmd.type === 4)
          .map((cmd) => {
            const preserved: Record<string, any> = {
              id: cmd.id,
              name: cmd.name,
              description: cmd.description,
              type: cmd.type,
            };
            if (cmd.handler !== undefined) preserved.handler = cmd.handler;
            if (cmd.integration_types !== undefined) preserved.integration_types = cmd.integration_types;
            if (cmd.contexts !== undefined) preserved.contexts = cmd.contexts;
            if (cmd.name_localizations !== undefined) preserved.name_localizations = cmd.name_localizations;
            if (cmd.description_localizations !== undefined) {
              preserved.description_localizations = cmd.description_localizations;
            }
            return preserved;
          });
        if (entryPointCommands.length > 0) {
          globalBody = [...body, ...entryPointCommands];
          log.info(
            { entryPointCount: entryPointCommands.length, names: entryPointCommands.map((c) => c.name) },
            'Preserved Discord Entry Point command(s) in global slash command sync'
          );
        }
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'Could not inspect existing global commands before bulk sync');
    }
  }

  // Always synchronize global application commands so removed commands (/aniquiz, /recommendations) are deleted globally
  await rest.put(Routes.applicationCommands(applicationId), { body: globalBody });
  log.info({ count: globalBody.length, slashCount: body.length, applicationId }, 'Synchronized global Discord slash commands');

  const updatedGuildIds: string[] = [];
  const cleanedStaleGuildIds: string[] = [];

  // Gather candidate guild IDs to inspect/synchronize
  const guildIdSet = new Set<string>(options?.knownGuildIds || []);
  if (devGuildId) {
    guildIdSet.add(devGuildId);
  }
  if (!options?.restClient && typeof rest.get === 'function') {
    try {
      const botGuilds = (await rest.get(Routes.userGuilds())) as Array<{ id?: string }> | undefined;
      if (Array.isArray(botGuilds)) {
        for (const g of botGuilds) {
          if (g?.id) guildIdSet.add(g.id);
        }
      }
    } catch {
      // Ignore if userGuilds cannot be listed
    }
  }

  // 2. Synchronize DISCORD_DEV_GUILD_ID if configured, and clean up any stale guild-specific registrations in other guilds
  for (const guildId of guildIdSet) {
    try {
      if (devGuildId && guildId === devGuildId) {
        await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
        updatedGuildIds.push(guildId);
        log.info({ count: body.length, guildId }, 'Synchronized guild Discord slash commands');
        continue;
      }

      if (typeof rest.get === 'function') {
        const existingGuildCmds = (await rest.get(
          Routes.applicationGuildCommands(applicationId, guildId)
        )) as Array<{ id: string; name: string; options?: Array<{ name: string }> }> | undefined;

        if (Array.isArray(existingGuildCmds) && existingGuildCmds.length > 0) {
          const existingNames = new Set(existingGuildCmds.map((c) => c.name));
          const expectedNames = new Set(body.map((c: { name: string }) => c.name));
          const namesMismatch =
            existingNames.size !== expectedNames.size ||
            Array.from(expectedNames).some((name) => !existingNames.has(name));
          const hasStaleCommands =
            namesMismatch ||
            existingGuildCmds.some(
              (cmd) =>
                cmd.name === 'recommendations' ||
                cmd.name === 'aniquiz' ||
                (cmd.name === 'anime' &&
                  Array.isArray(cmd.options) &&
                  cmd.options.some((opt) => opt.name === 'recommendations'))
            );
          if (hasStaleCommands) {
            await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
            cleanedStaleGuildIds.push(guildId);
            log.info(
              { guildId, count: body.length },
              'Synchronized mismatched or stale guild slash commands'
            );
          }
        }
      }
    } catch (err) {
      if (!isMissingAccessError(err)) {
        log.warn({ guildId, err: String(err) }, 'Guild slash command sync warning');
      }
    }
  }

  return {
    synced: true,
    applicationId,
    globalCommandCount: body.length,
    updatedGuildIds,
    cleanedStaleGuildIds,
  };
}

let sharedBot: AniScrollBotRuntime | null = null;
export function getBotRuntime(): AniScrollBotRuntime {
  if (!sharedBot) sharedBot = new AniScrollBotRuntime();
  return sharedBot;
}
