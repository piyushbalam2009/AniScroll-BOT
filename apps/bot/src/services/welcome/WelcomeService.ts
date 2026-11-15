import {
  Client,
  Events,
  GatewayIntentBits,
  Guild,
  GuildMember,
  IntentsBitField,
  PermissionFlagsBits,
  TextBasedChannel,
  User,
} from 'discord.js';
import { AniScrollDatabase } from '../../../../../packages/database/src';
import {
  AppError,
  BRAND_THEME,
  createModuleLogger,
  DEFAULT_GUILD_SETTINGS,
  ERROR_CODES,
  WelcomeConfig,
} from '../../../../../packages/shared/src';
import { createWelcomeEmbed } from '../../../../../packages/discord-ui/src';

const log = createModuleLogger('WelcomeService');

export const REQUIRED_WELCOME_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
] as const;

export interface WelcomeFormatContext {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accountCreatedAt: Date;
  guildId: string;
  guildName: string;
  memberCount: number;
}

export interface WelcomeChannelValidationDetails {
  channelId: string;
  channelName: string | null;
  channelType: number | null;
  sameGuild: boolean;
  isTextBased: boolean;
  botMemberResolved: boolean;
  permissions: {
    viewChannel: boolean | null;
    sendMessages: boolean | null;
    embedLinks: boolean | null;
  };
}

export interface WelcomeDiagnosticReport {
  guildId: string;
  timestamp: string;
  overallOk: boolean;
  simulationNotice: string;
  checks: {
    botOnline: {
      ok: boolean;
      status: string;
      tag: string | null;
      pingMs: number | null;
      detail: string;
    };
    guildMembersIntent: {
      ok: boolean;
      privilegedIntentsActive: boolean;
      clientHasGuildMembersIntent: boolean;
      clientHasGuildsIntent: boolean;
      enabledIntents: string[];
      intentWarning: string | null;
      detail: string;
    };
    eventListener: {
      ok: boolean;
      eventName: string;
      listenerCount: number;
      detail: string;
    };
    welcomeConfig: {
      ok: boolean;
      guildFoundInDb: boolean;
      enabled: boolean;
      channelId: string | null;
      embedEnabled: boolean;
      successCount: number;
      lastWelcomeAt: string | null;
      lastError: string | null;
      detail: string;
    };
    channelAccessible: {
      ok: boolean;
      guildFoundOnDiscord: boolean;
      channelId: string | null;
      channelName: string | null;
      channelType: number | null;
      sameGuild: boolean;
      isTextBased: boolean;
      permissions: {
        viewChannel: boolean | null;
        sendMessages: boolean | null;
        embedLinks: boolean | null;
      };
      errorCode: string | number | null;
      detail: string;
    };
    testMessage: {
      attempted: boolean;
      ok: boolean | null;
      messageId: string | null;
      errorCode: string | number | null;
      detail: string;
    };
  };
}

function extractDiscordErrorInfo(err: unknown): {
  code: string | number | null;
  status: number | null;
  message: string;
} {
  if (typeof err === 'object' && err !== null) {
    const anyErr = err as { code?: unknown; status?: unknown; message?: unknown };
    return {
      code:
        typeof anyErr.code === 'string' || typeof anyErr.code === 'number' ? anyErr.code : null,
      status: typeof anyErr.status === 'number' ? anyErr.status : null,
      message:
        typeof anyErr.message === 'string'
          ? anyErr.message
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
  return {
    code: null,
    status: null,
    message: err instanceof Error ? err.message : String(err),
  };
}

export function formatWelcomeTemplate(template: string, ctx: WelcomeFormatContext): string {
  return (template || '')
    .replace(/\{user\}/g, `<@${ctx.userId}>`)
    .replace(/\{memberMention\}/g, `<@${ctx.userId}>`)
    .replace(/\{username\}/g, ctx.username)
    .replace(/\{displayName\}/g, ctx.displayName || ctx.username)
    .replace(/\{server\}/g, ctx.guildName)
    .replace(/\{serverName\}/g, ctx.guildName)
    .replace(/\{memberCount\}/g, String(ctx.memberCount))
    .replace(/\{userId\}/g, ctx.userId)
    .replace(/\{serverId\}/g, ctx.guildId)
    .replace(/\{createdAt\}/g, ctx.accountCreatedAt.toISOString().slice(0, 10));
}

export function parseWelcomeColor(hexColor?: string | null): number {
  if (hexColor && /^#[0-9a-fA-F]{6}$/.test(hexColor.trim())) {
    return parseInt(hexColor.trim().slice(1), 16);
  }
  return BRAND_THEME.embedHex;
}

export function buildWelcomeMessagePayload(
  config: WelcomeConfig,
  ctx: WelcomeFormatContext,
  options?: { isTest?: boolean }
) {
  const isTest = Boolean(options?.isTest);
  const defaultTitle = DEFAULT_GUILD_SETTINGS.welcomeConfig.embedTitle;
  const defaultDescription = DEFAULT_GUILD_SETTINGS.welcomeConfig.embedDescription;
  const defaultPlain = DEFAULT_GUILD_SETTINGS.welcomeConfig.messageTemplate;

  const formattedPlain = formatWelcomeTemplate(config.messageTemplate || defaultPlain, ctx).trim();

  if (config.embedEnabled) {
    const rawTitle = formatWelcomeTemplate(config.embedTitle || defaultTitle, ctx).trim();
    const title = isTest ? `[TEST] ${rawTitle}` : rawTitle;
    const description = formatWelcomeTemplate(config.embedDescription || defaultDescription, ctx).trim();

    const thumbnailUrl = config.showMemberAvatar
      ? ctx.avatarUrl
      : config.embedThumbnail || null;
    const imageUrl = config.embedImage || config.bannerUrl || null;
    const footerText = config.embedFooter
      ? formatWelcomeTemplate(config.embedFooter, ctx)
      : 'AniScroll · Community Welcome';

    const embed = createWelcomeEmbed({
      title,
      description,
      color: parseWelcomeColor(config.embedColor),
      thumbnailUrl,
      imageUrl,
      footerText,
      serverName: ctx.guildName,
      memberCount: ctx.memberCount,
      rulesChannelId: config.rulesChannelId ?? null,
      introChannelId: config.introChannelId ?? null,
    });

    return {
      content: formattedPlain || undefined,
      embeds: [embed],
    };
  }

  const plainBody = formattedPlain || `Welcome to **${ctx.guildName}**, <@${ctx.userId}>!`;
  return {
    content: isTest ? `[TEST PREVIEW] ${plainBody}` : plainBody,
  };
}

export async function inspectWelcomeChannel(
  guild: Guild,
  channelId: string
): Promise<{
  channel: (TextBasedChannel & { id: string; name?: string; send: (payload: any) => Promise<any> }) | null;
  details: WelcomeChannelValidationDetails;
  error: AppError | null;
  errorCode: string | number | null;
}> {
  let ch: any = null;
  let fetchErrInfo: { code: string | number | null; status: number | null; message: string } | null = null;
  try {
    ch = await guild.channels.fetch(channelId);
  } catch (err) {
    fetchErrInfo = extractDiscordErrorInfo(err);
  }

  if (!ch) {
    log.warn(
      {
        guildId: guild.id,
        channelId,
        found: false,
        errorCode: fetchErrInfo?.code ?? null,
        status: fetchErrInfo?.status ?? null,
        err: fetchErrInfo?.message ?? 'Channel not returned by Discord API',
      },
      'Welcome channel fetch failed'
    );
    const detailMsg =
      fetchErrInfo?.code === 50001
        ? `Bot lacks access to view welcome channel <#${channelId}> (Discord error 50001: Missing Access).`
        : 'The configured welcome channel no longer exists or is not accessible in this Discord server.';
    return {
      channel: null,
      details: {
        channelId,
        channelName: null,
        channelType: null,
        sameGuild: false,
        isTextBased: false,
        botMemberResolved: Boolean(guild.members?.me),
        permissions: { viewChannel: null, sendMessages: null, embedLinks: null },
      },
      error: new AppError(
        fetchErrInfo?.code === 50001 ? ERROR_CODES.BOT_MISSING_PERMISSIONS : ERROR_CODES.VALIDATION_ERROR,
        detailMsg,
        fetchErrInfo?.code === 50001 ? 403 : 404
      ),
      errorCode: fetchErrInfo?.code ?? null,
    };
  }

  const chGuildId = 'guildId' in ch && typeof ch.guildId === 'string' ? ch.guildId : guild.id;
  const sameGuild = chGuildId === guild.id;
  const channelName = 'name' in ch && typeof ch.name === 'string' ? ch.name : null;
  const channelType = 'type' in ch && typeof ch.type === 'number' ? ch.type : null;
  const isTextBased = !ch.isDMBased() && ch.isTextBased() && typeof (ch as any).send === 'function';

  if (!sameGuild) {
    log.warn(
      {
        guildId: guild.id,
        channelId,
        channelGuildId: chGuildId,
        channelName,
        channelType,
      },
      'Configured welcome channel belongs to a different guild'
    );
    return {
      channel: null,
      details: {
        channelId,
        channelName,
        channelType,
        sameGuild: false,
        isTextBased,
        botMemberResolved: Boolean(guild.members?.me),
        permissions: { viewChannel: null, sendMessages: null, embedLinks: null },
      },
      error: new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'The configured welcome channel does not belong to this Discord server.',
        400
      ),
      errorCode: null,
    };
  }

  if (!isTextBased) {
    log.warn(
      {
        guildId: guild.id,
        channelId,
        channelName,
        channelType,
        isTextBased: false,
      },
      'Configured welcome channel is not a text-based channel'
    );
    return {
      channel: null,
      details: {
        channelId,
        channelName,
        channelType,
        sameGuild: true,
        isTextBased: false,
        botMemberResolved: Boolean(guild.members?.me),
        permissions: { viewChannel: null, sendMessages: null, embedLinks: null },
      },
      error: new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'The configured welcome channel no longer exists or is not a server text channel.',
        400
      ),
      errorCode: null,
    };
  }

  let me = guild.members.me;
  if (!me && guild.members?.fetchMe) {
    me = await guild.members.fetchMe().catch(() => null);
  }

  let viewChannel: boolean | null = null;
  let sendMessages: boolean | null = null;
  let embedLinks: boolean | null = null;

  if (me && typeof ch.permissionsFor === 'function') {
    const perms = ch.permissionsFor(me);
    viewChannel = Boolean(perms?.has(PermissionFlagsBits.ViewChannel));
    sendMessages = Boolean(perms?.has(PermissionFlagsBits.SendMessages));
    embedLinks = Boolean(perms?.has(PermissionFlagsBits.EmbedLinks));

    const missing: string[] = [];
    if (!viewChannel) missing.push('View Channel');
    if (!sendMessages) missing.push('Send Messages');
    if (!embedLinks) missing.push('Embed Links');

    log.info(
      {
        guildId: guild.id,
        channelId,
        channelName,
        channelType,
        sameGuild,
        isTextBased,
        viewChannel,
        sendMessages,
        embedLinks,
        missingPermissions: missing,
      },
      'Inspected welcome channel and bot permissions'
    );

    if (missing.length > 0) {
      return {
        channel: null,
        details: {
          channelId,
          channelName,
          channelType,
          sameGuild: true,
          isTextBased: true,
          botMemberResolved: true,
          permissions: { viewChannel, sendMessages, embedLinks },
        },
        error: new AppError(
          ERROR_CODES.BOT_MISSING_PERMISSIONS,
          `Bot is missing required permission(s) in <#${channelId}>: ${missing.join(', ')}.`,
          403
        ),
        errorCode: 50013,
      };
    }
  } else {
    log.warn(
      {
        guildId: guild.id,
        channelId,
        channelName,
        channelType,
        botMemberResolved: Boolean(me),
      },
      'Resolved welcome channel without cached bot member permission bitfield'
    );
  }

  return {
    channel: ch as TextBasedChannel & { id: string; name?: string; send: (payload: any) => Promise<any> },
    details: {
      channelId,
      channelName,
      channelType,
      sameGuild: true,
      isTextBased: true,
      botMemberResolved: Boolean(me),
      permissions: { viewChannel, sendMessages, embedLinks },
    },
    error: null,
    errorCode: null,
  };
}

export async function resolveAndValidateWelcomeChannel(
  guild: Guild,
  channelId: string
): Promise<TextBasedChannel & { id: string; send: (payload: any) => Promise<any> }> {
  const inspection = await inspectWelcomeChannel(guild, channelId);
  if (inspection.error || !inspection.channel) {
    throw (
      inspection.error ??
      new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'The configured welcome channel no longer exists or is not a server text channel.',
        404
      )
    );
  }
  return inspection.channel;
}

export async function dispatchWelcomeMessage(params: {
  guild: Guild;
  member?: GuildMember | null;
  user?: User;
  db: AniScrollDatabase;
  configOverride?: WelcomeConfig;
  isTest?: boolean;
}): Promise<{ channelId: string; messageId?: string | null; skipped?: boolean }> {
  const { guild, member, user, db, configOverride, isTest = false } = params;
  const settings = db.getGuildSettings(guild.id);
  const wc: WelcomeConfig = {
    ...settings.welcomeConfig,
    ...(configOverride || {}),
  };

  log.info(
    {
      guildId: guild.id,
      guildName: guild.name,
      memberId: member?.id ?? user?.id ?? null,
      enabled: wc.enabled,
      channelId: wc.channelId,
      embedEnabled: wc.embedEnabled,
      isTest,
    },
    'Welcome configuration lookup completed'
  );

  if (!isTest && !wc.enabled) {
    log.info(
      { guildId: guild.id, memberId: member?.id ?? null },
      'Welcome message skipped because welcome system is disabled'
    );
    return { channelId: wc.channelId || '', skipped: true };
  }

  if (!wc.channelId) {
    if (!isTest) {
      log.info(
        { guildId: guild.id, memberId: member?.id ?? null },
        'Welcome message skipped because no welcome channel is configured'
      );
      return { channelId: '', skipped: true };
    }
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'No welcome channel is configured for this server. Run `/welcome setup` first.',
      400
    );
  }

  try {
    const channel = await resolveAndValidateWelcomeChannel(guild, wc.channelId);
    const resolvedUser = member?.user ?? user;
    if (!resolvedUser) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Could not resolve member identity for welcome message.', 400);
    }

    const avatarUrl =
      typeof resolvedUser.displayAvatarURL === 'function'
        ? resolvedUser.displayAvatarURL({ size: 256 })
        : null;

    const formatCtx: WelcomeFormatContext = {
      userId: resolvedUser.id,
      username: resolvedUser.username,
      displayName: member?.displayName || resolvedUser.username,
      avatarUrl,
      accountCreatedAt: resolvedUser.createdAt ?? new Date(),
      guildId: guild.id,
      guildName: guild.name,
      memberCount: guild.memberCount || 1,
    };

    const payload = buildWelcomeMessagePayload(wc, formatCtx, { isTest });
    const sent = await channel.send(payload);
    const messageId = sent && typeof sent === 'object' && 'id' in sent ? String((sent as any).id) : null;

    log.info(
      {
        guildId: guild.id,
        channelId: channel.id,
        memberId: resolvedUser.id,
        messageId,
        isTest,
      },
      'Welcome message delivered successfully'
    );

    if (isTest) {
      const latest = db.getGuildSettings(guild.id).welcomeConfig;
      latest.lastError = null;
      db.updateGuildSettingsSection(guild.id, 'welcomeConfig', latest, resolvedUser.id);
    } else {
      wc.successCount = (wc.successCount || 0) + 1;
      wc.lastWelcomeAt = new Date().toISOString();
      wc.lastError = null;
      db.updateGuildSettingsSection(guild.id, 'welcomeConfig', wc, 'bot');
    }

    return { channelId: channel.id, messageId };
  } catch (err) {
    const info = extractDiscordErrorInfo(err);
    const errMsg = info.message;
    const latest = db.getGuildSettings(guild.id).welcomeConfig;
    latest.lastError = errMsg;
    db.updateGuildSettingsSection(guild.id, 'welcomeConfig', latest, 'bot');
    log.warn(
      {
        guildId: guild.id,
        channelId: wc.channelId,
        memberId: member?.id ?? user?.id ?? null,
        isTest,
        errorCode: info.code,
        status: info.status,
        err: errMsg,
      },
      'Welcome message dispatch failed'
    );
    throw err;
  }
}

export async function runWelcomeDiagnostics(params: {
  client: Client | null;
  status: string;
  privilegedIntentsActive: boolean;
  intentWarning: string | null;
  guildId: string;
  db: AniScrollDatabase;
  sendTestMessage?: boolean;
  actorUser?: User;
}): Promise<WelcomeDiagnosticReport> {
  const {
    client,
    status,
    privilegedIntentsActive,
    intentWarning,
    guildId,
    db,
    sendTestMessage = false,
    actorUser,
  } = params;

  const botReady = Boolean(client && status === 'ready' && (typeof client.isReady !== 'function' || client.isReady()));
  const bitfield = client?.options?.intents ? new IntentsBitField(client.options.intents) : null;
  const enabledIntents = bitfield ? bitfield.toArray() : [];
  const clientHasGuildMembersIntent = Boolean(bitfield?.has(GatewayIntentBits.GuildMembers));
  const clientHasGuildsIntent = Boolean(bitfield?.has(GatewayIntentBits.Guilds));
  const intentOk = clientHasGuildMembersIntent && privilegedIntentsActive;

  const listenerCount =
    client && typeof client.listenerCount === 'function'
      ? client.listenerCount(Events.GuildMemberAdd)
      : 0;
  const listenerOk = listenerCount === 1;

  const guildRow = db.getGuildByDiscordId(guildId);
  const settings = guildRow ? db.getGuildSettings(guildId) : structuredClone(DEFAULT_GUILD_SETTINGS);
  const wc = settings.welcomeConfig;
  const configOk = Boolean(guildRow && wc.enabled && wc.channelId);

  let guildFoundOnDiscord = false;
  let channelInspection: Awaited<ReturnType<typeof inspectWelcomeChannel>> | null = null;
  let discordGuild: Guild | null = null;

  if (client && wc.channelId) {
    discordGuild =
      client.guilds?.cache?.get(guildId) ||
      (client.guilds?.fetch ? await client.guilds.fetch(guildId).catch(() => null) : null);
    guildFoundOnDiscord = Boolean(discordGuild);
    if (discordGuild) {
      channelInspection = await inspectWelcomeChannel(discordGuild, wc.channelId);
    }
  } else if (client) {
    discordGuild =
      client.guilds?.cache?.get(guildId) ||
      (client.guilds?.fetch ? await client.guilds.fetch(guildId).catch(() => null) : null);
    guildFoundOnDiscord = Boolean(discordGuild);
  }

  const channelOk = Boolean(
    discordGuild &&
      wc.channelId &&
      channelInspection &&
      !channelInspection.error &&
      channelInspection.channel
  );

  let testResult: WelcomeDiagnosticReport['checks']['testMessage'] = {
    attempted: false,
    ok: null,
    messageId: null,
    errorCode: null,
    detail: 'Test send not requested (run with sendTestMessage=true or /welcome test to send a live channel test message).',
  };

  if (sendTestMessage) {
    testResult.attempted = true;
    if (!discordGuild || !wc.channelId) {
      testResult.ok = false;
      testResult.detail = !discordGuild
        ? 'Cannot send test message: bot is not connected to this guild.'
        : 'Cannot send test message: welcome channelId is not configured.';
    } else {
      try {
        const res = await dispatchWelcomeMessage({
          guild: discordGuild,
          user: actorUser ?? (client?.user as unknown as User | undefined),
          db,
          isTest: true,
        });
        testResult.ok = true;
        testResult.messageId = res.messageId ?? null;
        testResult.detail = `Test welcome message delivered to <#${res.channelId}> (not a simulated guildMemberAdd event).`;
      } catch (err) {
        const info = extractDiscordErrorInfo(err);
        testResult.ok = false;
        testResult.errorCode = info.code;
        testResult.detail = info.message;
      }
    }
  }

  const report: WelcomeDiagnosticReport = {
    guildId,
    timestamp: new Date().toISOString(),
    overallOk:
      botReady &&
      intentOk &&
      listenerOk &&
      configOk &&
      channelOk &&
      (!testResult.attempted || testResult.ok === true),
    simulationNotice:
      'Diagnostic checks inspect the live bot client, intent bitfield, event listener registry, SQLite persistence, and Discord channel access. Sending a test message tests Discord REST delivery only and does NOT simulate a real Discord Gateway GUILD_MEMBER_ADD event; a real member join requires a live user joining the server while Server Members Intent is active.',
    checks: {
      botOnline: {
        ok: botReady,
        status,
        tag: client?.user?.tag ?? null,
        pingMs: client?.ws?.ping ?? null,
        detail: botReady
          ? `Bot online as ${client?.user?.tag ?? 'connected client'}.`
          : `Bot is not ready (status: ${status}).`,
      },
      guildMembersIntent: {
        ok: intentOk,
        privilegedIntentsActive,
        clientHasGuildMembersIntent,
        clientHasGuildsIntent,
        enabledIntents,
        intentWarning,
        detail: intentOk
          ? 'GatewayIntentBits.GuildMembers is active on the live Discord client.'
          : intentWarning ||
            'GatewayIntentBits.GuildMembers is NOT active on the live Discord client.',
      },
      eventListener: {
        ok: listenerOk,
        eventName: Events.GuildMemberAdd,
        listenerCount,
        detail:
          listenerCount === 1
            ? `Event "${Events.GuildMemberAdd}" is registered once.`
            : listenerCount === 0
              ? `Event "${Events.GuildMemberAdd}" has 0 registered listeners.`
              : `Event "${Events.GuildMemberAdd}" is registered ${listenerCount} times (expected 1).`,
      },
      welcomeConfig: {
        ok: configOk,
        guildFoundInDb: Boolean(guildRow),
        enabled: wc.enabled,
        channelId: wc.channelId,
        embedEnabled: wc.embedEnabled,
        successCount: wc.successCount ?? 0,
        lastWelcomeAt: wc.lastWelcomeAt ?? null,
        lastError: wc.lastError ?? null,
        detail: !guildRow
          ? 'Guild record not found in SQLite database.'
          : !wc.enabled
            ? 'Welcome system is disabled in SQLite welcomeConfig.'
            : !wc.channelId
              ? 'No welcome channelId saved in SQLite welcomeConfig.'
              : `Welcome system enabled in SQLite for channel ${wc.channelId}.`,
      },
      channelAccessible: {
        ok: channelOk,
        guildFoundOnDiscord,
        channelId: wc.channelId,
        channelName: channelInspection?.details.channelName ?? null,
        channelType: channelInspection?.details.channelType ?? null,
        sameGuild: channelInspection?.details.sameGuild ?? false,
        isTextBased: channelInspection?.details.isTextBased ?? false,
        permissions: channelInspection?.details.permissions ?? {
          viewChannel: null,
          sendMessages: null,
          embedLinks: null,
        },
        errorCode: channelInspection?.errorCode ?? null,
        detail: !wc.channelId
          ? 'No welcome channel configured.'
          : !discordGuild
            ? 'Bot is not connected to this Discord server.'
            : channelInspection?.error
              ? channelInspection.error.userMessage
              : `Channel #${channelInspection?.details.channelName || wc.channelId} is accessible with ViewChannel, SendMessages, and EmbedLinks.`,
      },
      testMessage: testResult,
    },
  };

  log.info(
    {
      guildId,
      overallOk: report.overallOk,
      botOnline: report.checks.botOnline.ok,
      guildMembersIntent: report.checks.guildMembersIntent.ok,
      listenerCount,
      configOk,
      channelOk,
      testAttempted: testResult.attempted,
      testOk: testResult.ok,
    },
    'Completed welcome system diagnostics'
  );

  return report;
}
