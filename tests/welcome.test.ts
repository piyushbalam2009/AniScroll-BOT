import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Client, Events, GatewayIntentBits, IntentsBitField, PermissionFlagsBits } from 'discord.js';
import { AniScrollDatabase } from '../packages/database/src/db';
import { CacheService } from '../apps/bot/src/services/cache/CacheService';
import { buildCommandRegistry } from '../apps/bot/src/commands';
import { registerDiscordEvents } from '../apps/bot/src/events/registerEvents';
import { handleInteraction } from '../apps/bot/src/interactions/router';
import { getGatewayIntents } from '../apps/bot/src';
import { runWelcomeDiagnostics } from '../apps/bot/src/services/welcome/WelcomeService';

function createMockGuildEnvironment(opts?: {
  guildId?: string;
  guildName?: string;
  memberCount?: number;
  channelId?: string;
  missingPerms?: bigint[];
  sendError?: Error | null;
  deletedChannelIds?: Set<string>;
}) {
  const guildId = opts?.guildId || '990011223344556677';
  const channelId = opts?.channelId || '880011223344556677';
  const sentMessages: Array<{ channelId: string; payload: any }> = [];
  const missingSet = new Set<bigint>(opts?.missingPerms || []);
  const deletedSet = opts?.deletedChannelIds || new Set<string>();

  const makeChannel = (id: string, overrideGuildId?: string) => ({
    id,
    guildId: overrideGuildId ?? guildId,
    name: 'welcome',
    type: 0,
    isDMBased: () => false,
    isTextBased: () => true,
    permissionsFor: () => ({
      has: (perm: bigint) => !missingSet.has(perm),
    }),
    send: async (payload: any) => {
      if (opts?.sendError) {
        throw opts.sendError;
      }
      sentMessages.push({ channelId: id, payload });
      return { id: `msg-${sentMessages.length}` };
    },
  });

  const guild: any = {
    id: guildId,
    name: opts?.guildName || 'AniScroll Test Server',
    memberCount: opts?.memberCount ?? 142,
    members: {
      me: { id: 'bot-999' },
      fetchMe: async () => ({ id: 'bot-999' }),
    },
    channels: {
      fetch: async (id: string) => {
        if (deletedSet.has(id)) return null;
        return makeChannel(id);
      },
    },
  };

  return { guild, channelId, sentMessages, deletedSet, missingSet };
}

function createWelcomeSlashInteraction(opts: {
  subcommand: 'setup' | 'test';
  userId?: string;
  username?: string;
  isAdmin?: boolean;
  guild: any;
  channelOption?: any;
  rulesChannelOption?: any;
  introChannelOption?: any;
  enabledOption?: boolean | null;
}) {
  const replies: any[] = [];
  const edits: any[] = [];
  const interaction: any = {
    commandName: 'welcome',
    guildId: opts.guild.id,
    channelId: 'cmd-ch-1',
    guild: opts.guild,
    user: {
      id: opts.userId || '555444333222111000',
      username: opts.username || 'server_admin',
      displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/555444333222111000/admin.png',
      createdAt: new Date('2022-05-01T00:00:00.000Z'),
    },
    member: {
      displayName: opts.username || 'server_admin',
      permissions: {
        has: (reqs: any) => {
          if (!opts.isAdmin) return false;
          if (Array.isArray(reqs)) {
            return reqs.includes(PermissionFlagsBits.ManageGuild);
          }
          return reqs === PermissionFlagsBits.ManageGuild;
        },
      },
      user: {
        id: opts.userId || '555444333222111000',
        username: opts.username || 'server_admin',
        displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/555444333222111000/admin.png',
        createdAt: new Date('2022-05-01T00:00:00.000Z'),
      },
    },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isRepliable: () => true,
    options: {
      getSubcommand: () => opts.subcommand,
      getChannel: (name: string, required?: boolean) => {
        if (name === 'channel') {
          if (required && !opts.channelOption) throw new Error('Missing channel option');
          return opts.channelOption ?? null;
        }
        if (name === 'rules_channel') return opts.rulesChannelOption ?? null;
        if (name === 'intro_channel') return opts.introChannelOption ?? null;
        return null;
      },
      getBoolean: (name: string) => (name === 'enabled' ? opts.enabledOption ?? null : null),
    },
    deferReply: async (dOpts?: any) => {
      interaction.deferred = true;
      replies.push({ deferred: true, ...dOpts });
    },
    reply: async (payload: any) => {
      interaction.replied = true;
      replies.push(payload);
      return payload;
    },
    editReply: async (payload: any) => {
      edits.push(payload);
      return payload;
    },
    _replies: replies,
    _edits: edits,
  };
  return interaction;
}

test('Welcome system: Gateway intents, /welcome setup & test permissions, guildMemberAdd dispatch, persistence across restart, and error safety', async () => {
  // 1. Gateway intents check: Guilds + GuildMembers included, unnecessary MessageContent excluded
  const intents = getGatewayIntents(true);
  assert.ok(intents.includes(GatewayIntentBits.Guilds));
  assert.ok(intents.includes(GatewayIntentBits.GuildMembers));
  assert.equal(intents.includes(GatewayIntentBits.MessageContent), false);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aniscroll-welcome-test-'));
  const dbPath = path.join(tmpDir, 'bot.db');

  try {
    let db = new AniScrollDatabase(dbPath);
    const cache = new CacheService('');
    const commands = buildCommandRegistry();

    // Verify /welcome slash command structure & ManageGuild default permissions
    const welcomeCmd = commands.get('welcome');
    assert.ok(welcomeCmd, 'Expected /welcome command to be registered');
    const welcomeJson = welcomeCmd.data.toJSON();
    const subNames = (welcomeJson.options || []).map((o: any) => o.name);
    assert.deepEqual(subNames, ['setup', 'test', 'diagnose']);
    assert.equal(
      welcomeJson.default_member_permissions,
      String(PermissionFlagsBits.ManageGuild)
    );

    const { guild, channelId, sentMessages, deletedSet, missingSet } = createMockGuildEnvironment();

    const makeCtx = (database: AniScrollDatabase) =>
      ({
        db: database,
        cache,
        animeService: {},
        musicService: { handleVoiceStateUpdate: () => undefined },
        websiteWatchlist: {},
        maintenanceMode: false,
      }) as any;

    // 2. Ordinary member cannot run /welcome setup or /welcome test
    const nonAdminSetup = createWelcomeSlashInteraction({
      subcommand: 'setup',
      userId: '100000000000000001',
      username: 'regular_member',
      isAdmin: false,
      guild,
      channelOption: { id: channelId },
    });
    await handleInteraction(nonAdminSetup, commands, makeCtx(db));
    assert.ok(
      nonAdminSetup._replies[0].embeds[0]
        .toJSON()
        .description.includes('do not have the required server permissions')
    );

    const nonAdminTest = createWelcomeSlashInteraction({
      subcommand: 'test',
      userId: '100000000000000002',
      username: 'regular_member_2',
      isAdmin: false,
      guild,
    });
    await handleInteraction(nonAdminTest, commands, makeCtx(db));
    assert.ok(
      nonAdminTest._replies[0].embeds[0]
        .toJSON()
        .description.includes('do not have the required server permissions')
    );
    assert.equal(sentMessages.length, 0);

    // 3. Administrator runs /welcome setup with welcome channel + rules & intro channels
    const adminSetup = createWelcomeSlashInteraction({
      subcommand: 'setup',
      isAdmin: true,
      guild,
      channelOption: { id: channelId },
      rulesChannelOption: { id: '770011223344550001' },
      introChannelOption: { id: '770011223344550002' },
    });
    await handleInteraction(adminSetup, commands, makeCtx(db));
    assert.equal(
      adminSetup._replies[0].embeds[0].toJSON().title,
      'Welcome System Configured'
    );

    // 4. Administrator runs /welcome test -> preview message delivered to configured channel
    await cache.clearNamespace('ratelimit');
    const adminTest = createWelcomeSlashInteraction({
      subcommand: 'test',
      isAdmin: true,
      guild,
    });
    await handleInteraction(adminTest, commands, makeCtx(db));
    assert.equal(adminTest._edits[0].embeds[0].toJSON().title, 'Welcome Preview Sent');
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].channelId, channelId);
    const previewEmbed = sentMessages[0].payload.embeds[0].toJSON();
    assert.ok(previewEmbed.title.startsWith('[TEST]'));
    assert.equal(previewEmbed.author?.name, 'AniScroll · Community Welcome');

    // 5. Simulate bot restart by closing & reopening SQLite database from disk
    db.sqlite.close();
    db = new AniScrollDatabase(dbPath);
    const persisted = db.getGuildSettings(guild.id).welcomeConfig;
    assert.equal(persisted.enabled, true);
    assert.equal(persisted.channelId, channelId);
    assert.equal(persisted.rulesChannelId, '770011223344550001');
    assert.equal(persisted.introChannelId, '770011223344550002');

    // Register events on a mock Discord Client (twice to verify duplicate-registration guard!)
    const mockClient = new EventEmitter() as unknown as Client;
    registerDiscordEvents(mockClient, commands, makeCtx(db));
    registerDiscordEvents(mockClient, commands, makeCtx(db));

    // 6. Emit Events.GuildMemberAdd -> welcome embed sent ONCE to configured channel
    const newMember: any = {
      id: '222333444555666777',
      displayName: 'FrierenFan',
      guild,
      user: {
        id: '222333444555666777',
        username: 'frieren_fan',
        tag: 'frieren_fan#0001',
        bot: false,
        createdTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 120,
        createdAt: new Date('2025-01-15T00:00:00.000Z'),
        displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/222333444555666777/avatar.png',
      },
    };

    mockClient.emit(Events.GuildMemberAdd, newMember);
    // Allow async listener to finish
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(sentMessages.length, 2, 'Expected exactly 1 new welcome message (no duplicate listener)');
    const liveMsg = sentMessages[1];
    assert.equal(liveMsg.channelId, channelId);
    const liveEmbed = liveMsg.payload.embeds[0].toJSON();
    assert.equal(liveEmbed.author?.name, 'AniScroll · Community Welcome');
    assert.equal(liveEmbed.title, 'Welcome to AniScroll Test Server');
    assert.ok(liveEmbed.description.includes('<@222333444555666777>'));
    assert.ok(liveEmbed.description.includes("member #142"));
    assert.ok(liveEmbed.description.includes('AniScroll community'));
    assert.equal(
      liveEmbed.thumbnail?.url,
      'https://cdn.discordapp.com/avatars/222333444555666777/avatar.png'
    );
    const fieldsMap = new Map(liveEmbed.fields.map((f: any) => [f.name, f.value]));
    assert.equal(fieldsMap.get('Server'), 'AniScroll Test Server');
    assert.equal(fieldsMap.get('Member'), '#142');
    assert.equal(fieldsMap.get('Server Rules'), '<#770011223344550001>');
    assert.equal(fieldsMap.get('Introductions'), '<#770011223344550002>');

    const updatedStats = db.getGuildSettings(guild.id).welcomeConfig;
    assert.equal(updatedStats.successCount, 1);
    assert.equal(updatedStats.lastError, null);

    // 7. Missing EmbedLinks permission & deleted channel fail safely without crashing bot
    missingSet.add(PermissionFlagsBits.EmbedLinks);
    mockClient.emit(Events.GuildMemberAdd, { ...newMember, id: '222333444555666778' });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(sentMessages.length, 2);
    assert.ok(
      db.getGuildSettings(guild.id).welcomeConfig.lastError?.includes('Embed Links'),
      'Expected missing Embed Links permission to be recorded in lastError'
    );
    missingSet.clear();

    deletedSet.add(channelId);
    mockClient.emit(Events.GuildMemberAdd, { ...newMember, id: '222333444555666779' });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(sentMessages.length, 2);
    assert.ok(
      db.getGuildSettings(guild.id).welcomeConfig.lastError?.includes('no longer exists'),
      'Expected deleted channel error to be recorded safely'
    );
    deletedSet.clear();

    // 8. Diagnostic suite verification (all 6 checks: online, intent, listener, DB config, channel access, test send)
    const diagClient: any = Object.assign(new EventEmitter(), {
      options: { intents: new IntentsBitField(getGatewayIntents(true)) },
      isReady: () => true,
      user: { tag: 'AniScrollTest#0001', id: 'bot-999', username: 'AniScrollTest', createdAt: new Date() },
      ws: { ping: 24 },
      guilds: {
        cache: new Map([[guild.id, guild]]),
        fetch: async (id: string) => (id === guild.id ? guild : null),
      },
    });
    registerDiscordEvents(diagClient as Client, commands, makeCtx(db));
    const report = await runWelcomeDiagnostics({
      client: diagClient as Client,
      status: 'ready',
      privilegedIntentsActive: true,
      intentWarning: null,
      guildId: guild.id,
      db,
      sendTestMessage: true,
    });
    assert.equal(report.overallOk, true);
    assert.equal(report.checks.botOnline.ok, true);
    assert.equal(report.checks.guildMembersIntent.ok, true);
    assert.equal(report.checks.guildMembersIntent.clientHasGuildMembersIntent, true);
    assert.equal(report.checks.eventListener.ok, true);
    assert.equal(report.checks.eventListener.listenerCount, 1);
    assert.equal(report.checks.welcomeConfig.ok, true);
    assert.equal(report.checks.channelAccessible.ok, true);
    assert.equal(report.checks.channelAccessible.sameGuild, true);
    assert.equal(report.checks.testMessage.attempted, true);
    assert.equal(report.checks.testMessage.ok, true);
    assert.ok(report.simulationNotice.includes('does NOT simulate a real Discord Gateway GUILD_MEMBER_ADD'));

    // 9. Reject channel belonging to a different guild
    const wrongGuild = {
      ...guild,
      channels: {
        fetch: async (id: string) => ({
          id,
          guildId: '000000000000000999',
          name: 'foreign-channel',
          type: 0,
          isDMBased: () => false,
          isTextBased: () => true,
          send: async () => ({ id: 'nope' }),
        }),
      },
    };
    const foreignClient: any = Object.assign(new EventEmitter(), {
      options: diagClient.options,
      isReady: diagClient.isReady,
      user: diagClient.user,
      ws: diagClient.ws,
      guilds: { cache: new Map([[guild.id, wrongGuild]]), fetch: async () => wrongGuild },
    });
    registerDiscordEvents(foreignClient as Client, commands, makeCtx(db));
    const foreignReport = await runWelcomeDiagnostics({
      client: foreignClient as Client,
      status: 'ready',
      privilegedIntentsActive: true,
      intentWarning: null,
      guildId: guild.id,
      db,
      sendTestMessage: false,
    });
    assert.equal(foreignReport.overallOk, false);
    assert.equal(foreignReport.checks.channelAccessible.sameGuild, false);
    assert.ok(foreignReport.checks.channelAccessible.detail.includes('does not belong to this Discord server'));

    db.sqlite.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
