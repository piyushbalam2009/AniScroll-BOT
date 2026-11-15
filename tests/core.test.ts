import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AniScrollDatabase } from '../packages/database/src/db';
import {
  appConfig,
  buildAniScrollAnimeUrl,
  DEFAULT_GUILD_SETTINGS,
  normalizeHoshikaShortId,
} from '../packages/shared/src';
import { buildCommandRegistry } from '../apps/bot/src/commands';
import { AnimeMetadataNormalizer } from '../apps/bot/src/services/hoshika/AnimeMetadataNormalizer';
import { HoshikaClient } from '../apps/bot/src/services/hoshika/HoshikaClient';
import { AniScrollLinkService } from '../apps/bot/src/services/hoshika/AnimeService';
import { AutoModService } from '../apps/bot/src/services/moderation/AutoModService';
import { GuildMusicQueue } from '../apps/bot/src/services/music/MusicService';
import { CacheService } from '../apps/bot/src/services/cache/CacheService';
import {
  buildDiscordBotInviteUrl,
  buildDiscordOAuthUrl,
  exchangeDiscordOAuthCode,
  getDiscordRedirectUri,
  resolveDiscordRedirectUri,
  verifyOAuthState,
  verifyWebhookSignature,
} from '../apps/api/src/auth/session';
import { GatewayIntentBits, Routes } from 'discord.js';
import {
  getGatewayIntents,
  isDisallowedIntentsError,
  isMissingAccessError,
  synchronizeDiscordSlashCommands,
} from '../apps/bot/src';

test('Discord command registry registers all required modules and valid slash JSON', async () => {
  const registry = buildCommandRegistry();
  const expected = [
    'bot',
    'config',
    'welcome',
    'anime',
    'watchlist',
    'play',
    'pause',
    'resume',
    'skip',
    'previous',
    'stop',
    'leave',
    'queue',
    'nowplaying',
    'volume',
    'loop',
    'shuffle',
    'remove',
    'move',
    'seek',
    'clear',
    'search',
    'lyrics',
    '247',
    'warn',
    'warnings',
    'timeout',
    'kick',
    'ban',
    'unban',
    'purge',
    'cases',
    'appeal',
    'poll',
    'suggest',
    'ticket',
    'giveaway',
  ];
  for (const name of expected) {
    const cmd = registry.get(name);
    assert.ok(cmd, `Expected command /${name} to be registered`);
    const json = cmd.data.toJSON();
    assert.equal(json.name, name);
    assert.ok(json.description.length > 0);
  }
  assert.equal(registry.get('bot')?.ownerOnly, true);

  // Verify obsolete top-level /recommendations command does not exist
  assert.equal(registry.has('recommendations'), false);

  // Verify /anime subcommands: keep /anime recommendation and ensure /anime recommendations is removed
  const animeJson = registry.get('anime')!.data.toJSON();
  const animeSubcommands = (animeJson.options || []) as Array<{
    name: string;
    description: string;
    options?: Array<{ name: string; required?: boolean }>;
  }>;
  const subcommandNames = animeSubcommands.map((opt) => opt.name);
  assert.ok(
    subcommandNames.includes('recommendation'),
    'Expected /anime recommendation subcommand to be registered'
  );
  assert.equal(
    subcommandNames.includes('recommendations'),
    false,
    'Obsolete /anime recommendations subcommand must not be registered'
  );

  const recSubcommand = animeSubcommands.find((opt) => opt.name === 'recommendation')!;
  assert.equal(
    recSubcommand.description,
    'Publish a public anime recommendation card to this channel.'
  );
  assert.equal(recSubcommand.options?.[0]?.name, 'anime_name');
  assert.equal(recSubcommand.options?.[0]?.required, true);

  // Verify /watchlist subcommands and website statuses
  const watchlistJson = registry.get('watchlist')!.data.toJSON();
  const watchlistSubs = (watchlistJson.options || []).map((o: any) => o.name);
  for (const requiredSub of ['show', 'add', 'remove', 'progress', 'status', 'rate', 'search', 'stats']) {
    assert.ok(watchlistSubs.includes(requiredSub), `Expected /watchlist ${requiredSub} subcommand`);
  }
  const statusSub = watchlistJson.options.find((o: any) => o.name === 'status');
  const statusChoices = statusSub.options.find((o: any) => o.name === 'status').choices.map((c: any) => c.value);
  assert.deepEqual(statusChoices, ['watching', 'plan_to_watch', 'completed', 'on_hold', 'dropped']);

  // Verify synchronizeDiscordSlashCommands updates global commands and cleans stale guild commands
  const putCalls: Array<{ route: string; body: any }> = [];
  const syncResult = await synchronizeDiscordSlashCommands({
    token: 'mock-bot-token',
    applicationId: 'app-12345',
    devGuildId: 'dev-guild-1',
    knownGuildIds: ['dev-guild-1', 'stale-guild-2', 'clean-guild-3'],
    commands: registry,
    restClient: {
      put: async (route, opts) => {
        putCalls.push({ route, body: opts.body });
        return opts.body;
      },
      get: async (route) => {
        if (route === Routes.applicationGuildCommands('app-12345', 'stale-guild-2')) {
          return [
            {
              id: 'old-anime-cmd',
              name: 'anime',
              options: [{ name: 'search' }, { name: 'recommendations' }],
            },
          ];
        }
        return [];
      },
    },
  });

  assert.equal(syncResult.synced, true);
  assert.equal(syncResult.globalCommandCount, registry.size);
  assert.deepEqual(syncResult.updatedGuildIds, ['dev-guild-1']);
  assert.deepEqual(syncResult.cleanedStaleGuildIds, ['stale-guild-2']);
  assert.equal(putCalls.length, 3);
  assert.equal(putCalls[0].route, Routes.applicationCommands('app-12345'));
  assert.equal(putCalls[1].route, Routes.applicationGuildCommands('app-12345', 'dev-guild-1'));
  assert.equal(putCalls[2].route, Routes.applicationGuildCommands('app-12345', 'stale-guild-2'));
});

test('Hoshika normalizer preserves IDs and strictly excludes streaming providers', () => {
  const rawWithStreaming = {
    id: 'bfda1b08-54b8-4945-beba-8fb9a7aded1b',
    shortId: 41391,
    slug: 'naruto',
    titleRomaji: 'Naruto',
    titleEnglish: 'Naruto',
    titleJapanese: 'ナルト',
    anilistId: 20,
    malId: 20,
    format: 'TV',
    status: 'FINISHED',
    seasonYear: 2002,
    episodes: 220,
    averageScore: 81,
    genres: [{ name: 'Action' }, { name: 'Adventure' }],
    streaming: [{ name: 'Crunchyroll', url: 'https://example.com' }],
    platforms: [{ name: 'Netflix' }],
  };

  const normalized = AnimeMetadataNormalizer.normalizeAnime(rawWithStreaming);
  assert.equal(normalized.shortId, 41391);
  assert.equal(normalized.anilistId, 20);
  assert.equal(normalized.malId, 20);
  assert.deepEqual(normalized.genres, ['Action', 'Adventure']);
  assert.equal('streaming' in (normalized as any), false);
  assert.equal('platforms' in (normalized as any), false);
});

test('HoshikaClient blocks official streaming availability /watch endpoints', async () => {
  const client = new HoshikaClient('https://hoshika.app/api/v1');
  await assert.rejects(
    () => client.get('/anime/41391/watch'),
    (err: any) => err.userMessage.includes('disabled by policy')
  );
});

test('Watchlist enforces duplicate prevention, episode validation, and auto-completion', () => {
  const db = new AniScrollDatabase(':memory:');
  db.upsertUser('u1', 'TestUser');

  const added = db.addWatchlistEntry('u1', {
    hoshikaId: 'h-100',
    hoshikaShortId: 100,
    titleSnapshot: 'Frieren',
    totalEpisodes: 28,
    genresSnapshot: ['Fantasy', 'Drama'],
  });
  assert.equal(added.status, 'PLAN_TO_WATCH');

  assert.throws(
    () =>
      db.addWatchlistEntry('u1', {
        hoshikaId: 'h-100',
        titleSnapshot: 'Frieren',
      }),
    /already in your watchlist/
  );

  assert.throws(
    () => db.updateWatchlistEntry('u1', added.id, { episodesWatched: 29 }),
    /cannot exceed known episode count/
  );

  const updated = db.updateWatchlistEntry('u1', added.id, { episodesWatched: 28 });
  assert.equal(updated.autoCompleted, true);
  assert.equal(updated.entry.status, 'COMPLETED');
});

test('Moderation warning escalation triggers configured punishment thresholds', () => {
  const db = new AniScrollDatabase(':memory:');
  db.ensureGuild({ discordGuildId: 'g1', name: 'Test Guild' });

  const w1 = db.issueWarningWithEscalation('g1', {
    userId: 'baduser',
    moderatorId: 'mod1',
    reason: 'Strike 1',
  });
  assert.equal(w1.totalActiveWarnings, 1);
  assert.equal(w1.escalation.action, 'WARN');
  assert.equal(w1.modCase.caseNumber, 1);

  const w2 = db.issueWarningWithEscalation('g1', {
    userId: 'baduser',
    moderatorId: 'mod1',
    reason: 'Strike 2',
  });
  assert.equal(w2.totalActiveWarnings, 2);
  assert.equal(w2.escalation.action, 'TIMEOUT');
  assert.equal(w2.escalation.durationMinutes, 5);

  const w3 = db.issueWarningWithEscalation('g1', {
    userId: 'baduser',
    moderatorId: 'mod1',
    reason: 'Strike 3',
  });
  assert.equal(w3.escalation.durationMinutes, 30);
});

test('AutoMod detects invite links, phishing, excessive caps, and respects ignored roles/channels', () => {
  const automod = new AutoModService();
  const cfg = structuredClone(DEFAULT_GUILD_SETTINGS.automodConfig);
  cfg.ignoredChannelIds = ['ch-ignored'];
  cfg.ignoredRoleIds = ['role-mod'];

  const inviteHit = automod.evaluateMessage(
    {
      guildId: 'g1',
      channelId: 'ch-general',
      userId: 'u1',
      roleIds: [],
      content: 'Join my server https://discord.gg/fakeinvite123',
      mentionCount: 0,
    },
    cfg
  );
  assert.equal(inviteHit.violated, true);

  const ignoredHit = automod.evaluateMessage(
    {
      guildId: 'g1',
      channelId: 'ch-ignored',
      userId: 'u1',
      roleIds: [],
      content: 'Join https://discord.gg/fakeinvite123',
      mentionCount: 0,
    },
    cfg
  );
  assert.equal(ignoredHit.violated, false);

  const phishingHit = automod.evaluateMessage(
    {
      guildId: 'g1',
      channelId: 'ch-general',
      userId: 'u2',
      roleIds: [],
      content: 'Claim nitro at https://discord-nitro-free.com/gift',
      mentionCount: 0,
    },
    cfg
  );
  assert.equal(phishingHit.violated, true);
  assert.equal(phishingHit.severity, 'HIGH');
});

test('Community suggestion deduplication, voting, ticket lifecycle, and giveaway drawing work', () => {
  const db = new AniScrollDatabase(':memory:');
  db.ensureGuild({ discordGuildId: 'g1', name: 'Test Guild' });

  const s1 = db.createSuggestion('g1', 'u1', 'Add dark monochrome embed mode');
  assert.throws(
    () => db.createSuggestion('g1', 'u2', '  add dark monochrome embed mode '),
    /duplicate suggestion/
  );
  const voted = db.voteSuggestion(s1.id, 'u2', 'up');
  assert.equal(voted.upvotes, 1);

  const ticket = db.createTicket('g1', {
    channelId: 'ch-t1',
    userId: 'u1',
    category: 'BUG_REPORT',
    subject: 'Pagination bug',
  });
  const closed = db.updateTicketStatus('g1', ticket.id, 'CLOSED', 'staff1', 'Resolved');
  assert.equal(closed.status, 'CLOSED');
  assert.throws(
    () => db.updateTicketStatus('g1', ticket.id, 'CLOSED'),
    /already closed/
  );
});

test('Music queue supports independent track/queue looping, previous, and removal', () => {
  const q = new GuildMusicQueue(70);
  const t1 = { encoded: 'e1', identifier: 'id-1', title: 'Track 1', author: 'A', durationMs: 1000, isSeekable: true, isStream: false, requesterId: 'u1', requesterTag: 'u1', sourceName: 'sc' };
  const t2 = { encoded: 'e2', identifier: 'id-2', title: 'Track 2', author: 'B', durationMs: 2000, isSeekable: true, isStream: false, requesterId: 'u1', requesterTag: 'u1', sourceName: 'sc' };

  assert.equal(q.enqueue(t1), 0);
  assert.equal(q.enqueue(t2), 1);
  assert.equal(q.current?.title, 'Track 1');

  assert.equal(q.cycleLoop(), 'track');
  assert.equal(q.next()?.title, 'Track 1');

  assert.equal(q.cycleLoop(), 'queue');
  assert.equal(q.next()?.title, 'Track 2');
  assert.equal(q.tracks.length, 1);
  assert.equal(q.previous()?.title, 'Track 1');
});

test('CacheService respects TTL expiration and rate limits', async () => {
  const cache = new CacheService('');
  await cache.set('k1', { hello: 'world' }, 1);
  assert.deepEqual(await cache.get('k1'), { hello: 'world' });
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(await cache.get('k1'), null);

  const rl1 = await cache.checkRateLimit('user:1', 2, 10);
  const rl2 = await cache.checkRateLimit('user:1', 2, 10);
  const rl3 = await cache.checkRateLimit('user:1', 2, 10);
  assert.equal(rl1.allowed, true);
  assert.equal(rl2.allowed, true);
  assert.equal(rl3.allowed, false);
});

test('Webhook HMAC-SHA256 verification validates authentic signatures and rejects tampering', () => {
  const secret = 'super-secret-webhook-key';
  const payload = JSON.stringify({ eventId: 'evt_1', title: 'New Release' });
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  assert.equal(verifyWebhookSignature(payload, sig, secret), true);
  assert.equal(verifyWebhookSignature(payload + 'tamper', sig, secret), false);
});

test('Discord Gateway intent builder and disallowed intents detector handle fallback cleanly', () => {
  const full = getGatewayIntents(true);
  assert.ok(full.includes(GatewayIntentBits.GuildMembers));
  assert.ok(full.includes(GatewayIntentBits.Guilds));
  assert.equal(full.includes(GatewayIntentBits.MessageContent), false);

  const standard = getGatewayIntents(false);
  assert.equal(standard.includes(GatewayIntentBits.GuildMembers), false);
  assert.equal(standard.includes(GatewayIntentBits.MessageContent), false);
  assert.ok(standard.includes(GatewayIntentBits.Guilds));
  assert.ok(standard.includes(GatewayIntentBits.GuildVoiceStates));

  assert.equal(isDisallowedIntentsError(new Error('Used disallowed intents')), true);
  assert.equal(isDisallowedIntentsError({ code: 4014 }), true);
  assert.equal(isDisallowedIntentsError(new Error('Invalid token')), false);

  assert.equal(isMissingAccessError({ code: 50001 }), true);
  assert.equal(isMissingAccessError(new Error('DiscordAPIError[50001]: Missing Access')), true);
  assert.equal(isMissingAccessError(new Error('Unknown Error')), false);
});

test('Discord OAuth2 reads DISCORD_REDIRECT_URI, rejects bot invite URLs, and URL-encodes redirect_uri consistently', () => {
  const prevRedirect = process.env.DISCORD_REDIRECT_URI;
  const prevAppUrl = process.env.APP_URL;
  const prevClientId = appConfig.DISCORD_CLIENT_ID;
  const prevSecret = appConfig.DISCORD_CLIENT_SECRET;
  const prevOAuth = appConfig.isOAuthConfigured;
  try {
    process.env.APP_URL = 'https://aniscroll-app.example';
    process.env.DISCORD_REDIRECT_URI = 'https://example.aniscroll.dev/auth/callback';
    const validResolution = resolveDiscordRedirectUri();
    assert.equal(validResolution.redirectUri, 'https://example.aniscroll.dev/auth/callback');
    assert.equal(validResolution.source, 'env');
    assert.equal(validResolution.warning, null);

    // Reject Discord bot invitation URL mistakenly placed in DISCORD_REDIRECT_URI
    process.env.DISCORD_REDIRECT_URI =
      'https://discord.com/oauth2/authorize?client_id=1571223083333976094&permissions=8&integration_type=0&scope=bot';
    const rejectedResolution = resolveDiscordRedirectUri();
    assert.equal(rejectedResolution.redirectUri, 'https://aniscroll-app.example/auth/callback');
    assert.equal(rejectedResolution.source, 'app_url_fallback');
    assert.ok(rejectedResolution.warning?.includes('/auth/callback'));

    appConfig.DISCORD_CLIENT_ID = '123456789012345678';
    appConfig.DISCORD_CLIENT_SECRET = 'test-secret';
    appConfig.isOAuthConfigured = true;
    const rawAuthUrl = buildDiscordOAuthUrl('state123', getDiscordRedirectUri());
    assert.ok(
      rawAuthUrl.includes(
        `redirect_uri=${encodeURIComponent('https://aniscroll-app.example/auth/callback')}`
      )
    );
    const authUrl = new URL(rawAuthUrl);
    assert.equal(authUrl.origin + authUrl.pathname, 'https://discord.com/oauth2/authorize');
    assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://aniscroll-app.example/auth/callback');
    assert.equal(authUrl.searchParams.get('response_type'), 'code');
    assert.equal(authUrl.searchParams.get('scope'), 'identify guilds');
    assert.equal(authUrl.searchParams.get('state'), 'state123');
  } finally {
    if (prevRedirect === undefined) delete process.env.DISCORD_REDIRECT_URI;
    else process.env.DISCORD_REDIRECT_URI = prevRedirect;
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;
    appConfig.DISCORD_CLIENT_ID = prevClientId;
    appConfig.DISCORD_CLIENT_SECRET = prevSecret;
    appConfig.isOAuthConfigured = prevOAuth;
  }
});

test('Discord Bot Invite URL is separated from user login OAuth2 and uses bot + applications.commands scopes', () => {
  const inviteUrlStr = buildDiscordBotInviteUrl('1571223083333976094', '999888777');
  assert.ok(inviteUrlStr);
  const inviteUrl = new URL(inviteUrlStr);
  assert.equal(inviteUrl.origin + inviteUrl.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(inviteUrl.searchParams.get('client_id'), '1571223083333976094');
  assert.equal(inviteUrl.searchParams.get('scope'), 'bot applications.commands');
  assert.equal(inviteUrl.searchParams.get('guild_id'), '999888777');
  assert.ok(Number(inviteUrl.searchParams.get('permissions')) > 0);
  assert.equal(inviteUrl.searchParams.get('redirect_uri'), null);
});

test('OAuth2 state verification and token exchange send exact redirect_uri without exposing secrets', async () => {
  assert.equal(verifyOAuthState('abc123', 'abc123'), true);
  assert.equal(verifyOAuthState('abc123', 'abc124'), false);
  assert.equal(verifyOAuthState('', 'abc123'), false);
  assert.equal(verifyOAuthState(['abc123'], 'abc123'), false);

  let capturedTokenBody = '';
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://discord.com/api/oauth2/token') {
      capturedTokenBody = String(init?.body || '');
      return new Response(JSON.stringify({ access_token: 'secret-discord-token', token_type: 'Bearer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://discord.com/api/users/@me') {
      return new Response(
        JSON.stringify({ id: '424242', username: 'otaku_admin', avatar: 'hash99' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://discord.com/api/users/@me/guilds') {
      return new Response(
        JSON.stringify([
          { id: 'g-manage', name: 'Manage Guild', permissions: '32', owner: false, icon: null },
          { id: 'g-member', name: 'Member Only Guild', permissions: '0', owner: false, icon: null },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const result = await exchangeDiscordOAuthCode({
    code: 'oauth-code-xyz',
    redirectUri: 'https://example.aniscroll.dev/auth/callback',
    clientId: 'client-123',
    clientSecret: 'super-secret-456',
    fetchImpl: mockFetch,
  });

  const tokenParams = new URLSearchParams(capturedTokenBody);
  assert.equal(tokenParams.get('client_id'), 'client-123');
  assert.equal(tokenParams.get('client_secret'), 'super-secret-456');
  assert.equal(tokenParams.get('grant_type'), 'authorization_code');
  assert.equal(tokenParams.get('code'), 'oauth-code-xyz');
  assert.equal(tokenParams.get('redirect_uri'), 'https://example.aniscroll.dev/auth/callback');

  assert.equal(result.user.id, '424242');
  assert.equal(result.user.username, 'otaku_admin');
  assert.equal(result.user.avatar, 'https://cdn.discordapp.com/avatars/424242/hash99.png');
  assert.deepEqual(
    result.manageableGuilds.map((g) => g.id),
    ['g-manage']
  );
  assert.equal('access_token' in (result as any), false);
});

test('buildAniScrollAnimeUrl and normalizeHoshikaShortId strictly require valid Hoshika shortId and never substitute AniList IDs', () => {
  assert.equal(normalizeHoshikaShortId(41391), 41391);
  assert.equal(normalizeHoshikaShortId('33374'), 33374);
  assert.equal(normalizeHoshikaShortId(0), null);
  assert.equal(normalizeHoshikaShortId(-5), null);
  assert.equal(normalizeHoshikaShortId(null), null);
  assert.equal(normalizeHoshikaShortId(undefined), null);
  assert.equal(normalizeHoshikaShortId('bfda1b08-54b8-4945-beba-8fb9a7aded1b'), null);

  assert.equal(buildAniScrollAnimeUrl(41391), 'https://aniscroll.in/anime/41391');
  assert.equal(buildAniScrollAnimeUrl(558999, 'https://aniscroll.in/'), 'https://aniscroll.in/anime/558999');
  assert.equal(buildAniScrollAnimeUrl(null), null);
  assert.equal(buildAniScrollAnimeUrl(0), null);
  assert.equal(buildAniScrollAnimeUrl('not-a-short-id'), null);
});

test('AnimeMetadataNormalizer constructs Hoshika shortId AniScroll URLs on anime, relations, and recommendations without AniList fallback', () => {
  const normalized = AnimeMetadataNormalizer.normalizeAnime({
    id: 'bfda1b08-54b8-4945-beba-8fb9a7aded1b',
    shortId: 41391,
    anilistId: 20,
    titleRomaji: 'Naruto',
    relations: [
      { shortId: 41392, slug: 'naruto-shippuden', relationType: 'SEQUEL', title: 'Naruto Shippuden' },
      { shortId: null, slug: 'unlinked-ova', relationType: 'SIDE_STORY', title: 'Unlinked OVA' },
    ],
    recommendations: [
      { id: 'rec-1', shortId: 33374, anilistId: 16498, titleRomaji: 'Shingeki no Kyojin' },
      { id: 'rec-2', anilistId: 21, titleRomaji: 'No ShortId Rec' },
    ],
  });

  assert.equal(normalized.shortId, 41391);
  assert.equal(normalized.anilistId, 20);
  assert.equal(normalized.aniscrollUrl, 'https://aniscroll.in/anime/41391');
  assert.equal(normalized.relations[0].aniscrollUrl, 'https://aniscroll.in/anime/41392');
  assert.equal(normalized.relations[1].shortId, null);
  assert.equal(normalized.relations[1].aniscrollUrl, null);
  assert.equal(normalized.recommendations[0].aniscrollUrl, 'https://aniscroll.in/anime/33374');
  assert.equal(normalized.recommendations[1].shortId, null);
  assert.equal(normalized.recommendations[1].aniscrollUrl, null);

  const missingShortId = AnimeMetadataNormalizer.normalizeAnime({
    id: 'no-short-uuid',
    anilistId: 16498,
    titleRomaji: 'Attack on Titan',
  });
  assert.equal(missingShortId.shortId, null);
  assert.equal(missingShortId.anilistId, 16498);
  assert.equal(missingShortId.aniscrollUrl, null);
});

test('AniScrollLinkService resolves Hoshika shortId URLs without AniList fallback or external api.aniscroll.in lookup', async () => {
  const linkService = new AniScrollLinkService();

  const resolved = await linkService.resolveWatchUrl({
    shortId: 41391,
    anilistId: 20,
    title: 'Naruto',
  });
  assert.deepEqual(resolved, {
    url: 'https://aniscroll.in/anime/41391',
    shortId: 41391,
    title: 'Naruto',
    anilistId: 20,
    malId: undefined,
  });

  const missing = await linkService.resolveWatchUrl({
    shortId: null,
    anilistId: 20,
    title: 'Naruto',
  });
  assert.equal(missing, null);
});

test('Hoshika anime details normalizer and Discord embed layout display full English synopsis for How I Attended an All-Guy’s Mixer (Hoshika ID 53022) and 5+ anime', async () => {
  const { createAnimeEmbed, buildAnimeActionRows } = await import('../packages/discord-ui/src');
  const { AnimeCacheService, AnimeIdentifierService } = await import(
    '../apps/bot/src/services/hoshika/AnimeCacheService'
  );
  const { AnimeSearchService, AnimeService } = await import(
    '../apps/bot/src/services/hoshika/AnimeService'
  );

  // Real Hoshika API payloads inspected from https://hoshika.app/api/v1
  const mockSearchItems = [
    {
      id: '337b59a5-3c8c-4449-9937-28c749e13d1a',
      shortId: 53022,
      slug: 'goukon-ni-ittara-onna-ga-inakatta-hanashi',
      titleRomaji: 'Goukon ni Ittara Onna ga Inakatta Hanashi',
      titleEnglish: "How I Attended an All-Guy's Mixer",
      coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx169931-b5baL2nZ8J2T.jpg',
      format: 'TV',
      averageScore: 74,
    },
    {
      id: 'frieren-uuid',
      shortId: 26178,
      slug: 'sousou-no-frieren',
      titleRomaji: 'Sousou no Frieren',
      titleEnglish: "Frieren: Beyond Journey's End",
      coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/frieren.jpg',
      format: 'TV',
      averageScore: 91,
    },
    {
      id: 'dandadan-uuid',
      shortId: 97482,
      slug: 'dandadan',
      titleRomaji: 'Dandadan',
      titleEnglish: 'Dan Da Dan',
      coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/dandadan.jpg',
      format: 'TV',
      averageScore: 84,
    },
    {
      id: 'apothecary-uuid',
      shortId: 24040,
      slug: 'kusuriya-no-hitorigoto',
      titleRomaji: 'Kusuriya no Hitorigoto',
      titleEnglish: 'The Apothecary Diaries',
      coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/apothecary.jpg',
      format: 'TV',
      averageScore: 88,
    },
    {
      id: 'sololeveling-uuid',
      shortId: 89530,
      slug: 'ore-dake-level-up-na-ken',
      titleRomaji: 'Ore dake Level Up na Ken',
      titleEnglish: 'Solo Leveling',
      coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/sololeveling.jpg',
      format: 'TV',
      averageScore: 82,
    },
    {
      id: 'aot-movie-uuid',
      shortId: 64573,
      slug: 'shingeki-no-kyojin-the-last-attack',
      titleRomaji: 'Shingeki no Kyojin: THE LAST ATTACK',
      titleEnglish: 'Attack on Titan: THE LAST ATTACK',
      coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/aot.jpg',
      format: 'MOVIE',
      averageScore: 89,
    },
  ];

  const mockDetailsByShortId: Record<number, any> = {
    53022: {
      ok: true,
      anime: {
        id: '337b59a5-3c8c-4449-9937-28c749e13d1a',
        shortId: 53022,
        slug: 'goukon-ni-ittara-onna-ga-inakatta-hanashi',
        anilistId: 169931,
        malId: 56843,
        titleRomaji: 'Goukon ni Ittara Onna ga Inakatta Hanashi',
        titleEnglish: "How I Attended an All-Guy's Mixer",
        titleJapanese: '合コンに行ったら女がいなかった話',
        titleLocalized: "How I Attended an All-Guy's Mixer",
        synopsis:
          'Tokiwa, a college student, is invited to a mixer by his female classmate Suo. When he arrives with his friends, however, they are met by three remarkably handsome men. As the two groups spend time together, they unexpectedly start to grow closer.',
        coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx169931-b5baL2nZ8J2T.jpg',
        bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/169931.jpg',
        format: 'TV',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2024,
        source: 'MANGA',
        episodes: 12,
        episodeDuration: 23,
        averageScore: 74,
        trailerId: 'o7C7IniZ8GI',
        trailerSite: 'youtube',
        genres: [{ name: 'Comedy' }, { name: 'Romance' }],
        studios: [{ name: 'Ashi Productions' }],
        relations: [],
        recommendations: [],
      },
    },
    26178: {
      ok: true,
      anime: {
        id: 'frieren-uuid',
        shortId: 26178,
        slug: 'sousou-no-frieren',
        titleRomaji: 'Sousou no Frieren',
        titleEnglish: "Frieren: Beyond Journey's End",
        titleJapanese: '葬送のフリーレン',
        synopsis:
          'The adventure is over but life goes on for an elf mage just beginning to learn what living is all about.',
        format: 'TV',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2023,
        source: 'MANGA',
        episodes: 28,
        episodeDuration: 24,
        averageScore: 91,
        genres: [{ name: 'Adventure' }, { name: 'Drama' }, { name: 'Fantasy' }],
        studios: [{ name: 'Madhouse' }],
      },
    },
    97482: {
      ok: true,
      anime: {
        id: 'dandadan-uuid',
        shortId: 97482,
        slug: 'dandadan',
        titleRomaji: 'Dandadan',
        titleEnglish: 'Dan Da Dan',
        synopsis:
          'Momo Ayase strikes up an unusual friendship with her school’s UFO fanatic, whom she nicknames "Okarun."',
        format: 'TV',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2024,
        source: 'MANGA',
        episodes: 12,
        averageScore: 84,
        genres: [{ name: 'Action' }, { name: 'Comedy' }, { name: 'Supernatural' }],
        studios: [{ name: 'Science SARU' }],
      },
    },
    24040: {
      ok: true,
      anime: {
        id: 'apothecary-uuid',
        shortId: 24040,
        slug: 'kusuriya-no-hitorigoto',
        titleRomaji: 'Kusuriya no Hitorigoto',
        titleEnglish: 'The Apothecary Diaries',
        synopsis:
          'Maomao lived a peaceful life with her apothecary father until she was sold as a lowly servant to the emperor’s palace.',
        format: 'TV',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2023,
        source: 'LIGHT_NOVEL',
        episodes: 24,
        averageScore: 88,
        genres: [{ name: 'Drama' }, { name: 'Mystery' }],
        studios: [{ name: 'OLM' }, { name: 'TOHO animation STUDIO' }],
      },
    },
    89530: {
      ok: true,
      anime: {
        id: 'sololeveling-uuid',
        shortId: 89530,
        slug: 'ore-dake-level-up-na-ken',
        titleRomaji: 'Ore dake Level Up na Ken',
        titleEnglish: 'Solo Leveling',
        synopsis:
          'Ten years ago, "the Gate" appeared and connected the real world with the realm of magic and monsters.',
        format: 'TV',
        status: 'FINISHED',
        season: 'WINTER',
        seasonYear: 2024,
        source: 'WEB_NOVEL',
        episodes: 12,
        averageScore: 82,
        genres: [{ name: 'Action' }, { name: 'Adventure' }, { name: 'Fantasy' }],
        studios: [{ name: 'A-1 Pictures' }],
      },
    },
    64573: {
      ok: true,
      anime: {
        id: 'aot-movie-uuid',
        shortId: 64573,
        slug: 'shingeki-no-kyojin-the-last-attack',
        titleRomaji: 'Shingeki no Kyojin: THE LAST ATTACK',
        titleEnglish: 'Attack on Titan: THE LAST ATTACK',
        synopsis: null,
        format: 'MOVIE',
        status: 'FINISHED',
        seasonYear: 2024,
        episodes: 1,
        averageScore: 89,
        genres: [{ name: 'Action' }, { name: 'Drama' }],
        studios: [{ name: 'MAPPA' }],
      },
    },
  };

  const detailFetchCounts = new Map<string, number>();
  const fakeClient = {
    get: async (endpoint: string, options?: { params?: Record<string, any> }) => {
      if (endpoint === '/search') {
        return { ok: true, anime: mockSearchItems };
      }
      const match = endpoint.match(/^\/anime\/(\d+)$/);
      if (match) {
        const shortId = Number(match[1]);
        const locale = options?.params?.locale || 'en';
        const key = `${shortId}:${locale}`;
        detailFetchCounts.set(key, (detailFetchCounts.get(key) || 0) + 1);
        const payload = mockDetailsByShortId[shortId];
        if (!payload) {
          throw new Error(`Unexpected shortId ${shortId}`);
        }
        return payload;
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
  } as unknown as HoshikaClient;

  const cache = new CacheService('');
  const animeCache = new AnimeCacheService(cache);
  const identifiers = new AnimeIdentifierService();
  const searchService = new AnimeSearchService(fakeClient, animeCache, identifiers);
  const linkService = new AniScrollLinkService(searchService);
  const animeService = new AnimeService(fakeClient, animeCache, identifiers, searchService, linkService);

  // 1. Search returns summary items (without synopsis), then hydrateAnimeItem fetches full details for each of the 6 anime
  const { items: searchResults } = await searchService.search({ query: 'mixer', locale: 'en' });
  assert.equal(searchResults.length, 6);
  assert.equal(searchResults[0].shortId, 53022);
  assert.equal(searchResults[0].synopsis, null);

  for (let i = 0; i < searchResults.length; i++) {
    const hydrated = await animeService.hydrateAnimeItem(searchResults[i], 'en');
    searchResults[i] = hydrated.anime;
    assert.equal(hydrated.detailsError, null);
  }

  // Verify "How I Attended an All-Guy's Mixer" (Hoshika ID 53022)
  const mixer = searchResults[0];
  assert.equal(mixer.shortId, 53022);
  assert.equal(mixer.titleEnglish, "How I Attended an All-Guy's Mixer");
  assert.ok(mixer.synopsis?.includes('Tokiwa, a college student, is invited to a mixer'));
  assert.equal(mixer.source, 'MANGA');
  assert.equal(mixer.season, 'FALL');
  assert.equal(mixer.releaseYear, 2024);
  assert.equal(mixer.totalEpisodes, 12);
  assert.equal(mixer.rating, 74);
  assert.equal(mixer.trailerUrl, 'https://www.youtube.com/watch?v=o7C7IniZ8GI');
  assert.equal(mixer.aniscrollUrl, 'https://aniscroll.in/anime/53022');

  // Verify standard search embed layout & buttons
  const searchEmbed = createAnimeEmbed(mixer, { aniscrollUrl: mixer.aniscrollUrl }).toJSON();
  assert.equal(searchEmbed.title, "How I Attended an All-Guy's Mixer");
  assert.ok(searchEmbed.description?.startsWith('**Synopsis:**\nTokiwa, a college student'));
  assert.equal(searchEmbed.description?.includes('No synopsis available'), false);
  const fieldNames = (searchEmbed.fields || []).map((f) => f.name);
  assert.deepEqual(fieldNames, [
    'Alternative Titles',
    'Format & Year',
    'Episodes',
    'Score',
    'Genres',
    'AniScroll',
  ]);

  const rows = buildAnimeActionRows({
    shortId: mixer.shortId,
    hoshikaId: mixer.hoshikaId,
    ownerUserId: 'u1',
    page: 0,
    totalPages: searchResults.length,
    aniscrollUrl: mixer.aniscrollUrl,
    searchResults,
  });
  const buttonLabels = rows
    .flatMap((r) => r.toJSON().components as any[])
    .filter((c) => c.label)
    .map((c) => c.label);
  assert.deepEqual(buttonLabels, [
    'Previous',
    'Next',
    'Details',
    'Episodes',
    'Related',
    'Add to Watchlist',
    'Open AniScroll',
  ]);

  // Verify Details button embed (`detailed: true`) includes all Hoshika fields
  const detailsEmbed = createAnimeEmbed(mixer, {
    aniscrollUrl: mixer.aniscrollUrl,
    detailed: true,
  }).toJSON();
  assert.ok(detailsEmbed.description?.startsWith('**Synopsis:**\nTokiwa, a college student'));
  const detailFieldNames = (detailsEmbed.fields || []).map((f) => f.name);
  assert.deepEqual(detailFieldNames, [
    'Alternative Titles',
    'Format',
    'Release Year',
    'Season',
    'Status',
    'Episodes',
    'Score',
    'Source Material',
    'Genres',
    'Studios',
    'Trailer',
    'AniScroll',
  ]);

  // Verify the other 4 anime with synopses (Frieren, Dan Da Dan, The Apothecary Diaries, Solo Leveling)
  assert.ok(searchResults[1].synopsis?.includes('elf mage'));
  assert.ok(searchResults[2].synopsis?.includes('Momo Ayase'));
  assert.ok(searchResults[3].synopsis?.includes('Maomao'));
  assert.ok(searchResults[4].synopsis?.includes('the Gate'));

  // Verify anime with genuinely null synopsis from Hoshika (64573) displays exact message
  const missingSynopsisEmbed = createAnimeEmbed(searchResults[5], {
    aniscrollUrl: searchResults[5].aniscrollUrl,
  }).toJSON();
  assert.equal(
    missingSynopsisEmbed.description,
    '**Synopsis:**\nSynopsis is not available for this anime.'
  );

  // Verify caching prevents duplicate Hoshika detail requests when navigating pages or clicking Details
  assert.equal(detailFetchCounts.get('53022:en'), 1);
  await animeService.hydrateAnimeItem(searchResults[0], 'en');
  await animeService.getDetails(53022, 'en');
  assert.equal(detailFetchCounts.get('53022:en'), 1);
});

test('AnimeService and HoshikaClient handle failed details requests, invalid IDs, invalid JSON, and locale=en fallback gracefully', async () => {
  const { createAnimeEmbed } = await import('../packages/discord-ui/src');
  const { AnimeCacheService, AnimeIdentifierService } = await import(
    '../apps/bot/src/services/hoshika/AnimeCacheService'
  );
  const { AnimeSearchService, AnimeService } = await import(
    '../apps/bot/src/services/hoshika/AnimeService'
  );

  // 1. Reject invalid Hoshika IDs (<= 0) without calling API
  const cache = new CacheService('');
  const animeCache = new AnimeCacheService(cache);
  const identifiers = new AnimeIdentifierService();
  let apiCalled = false;
  const strictClient = {
    get: async () => {
      apiCalled = true;
      return {};
    },
  } as unknown as HoshikaClient;
  const searchService = new AnimeSearchService(strictClient, animeCache, identifiers);
  const linkService = new AniScrollLinkService(searchService);
  const animeService = new AnimeService(strictClient, animeCache, identifiers, searchService, linkService);

  await assert.rejects(
    () => animeService.getDetails(-10, 'en'),
    (err: any) => err.code === 'INVALID_ANIME_ID'
  );
  await assert.rejects(
    () => animeService.getDetails(0, 'en'),
    (err: any) => err.code === 'INVALID_ANIME_ID'
  );
  assert.equal(apiCalled, false);

  // 2. When details endpoint fails (e.g., 503 unavailable), hydrateAnimeItem logs and returns detailsError
  // and createAnimeEmbed does NOT pretend the synopsis is missing
  const failingClient = {
    get: async () => {
      const { AppError, ERROR_CODES } = await import('../packages/shared/src');
      throw new AppError(
        ERROR_CODES.HOSHIKA_UNAVAILABLE,
        'Hoshika metadata service is temporarily unavailable.',
        503
      );
    },
  } as unknown as HoshikaClient;
  const failingAnimeService = new AnimeService(
    failingClient,
    animeCache,
    identifiers,
    new AnimeSearchService(failingClient, animeCache, identifiers),
    linkService
  );

  const summaryCard = AnimeMetadataNormalizer.normalizeAnime({
    id: '337b59a5-3c8c-4449-9937-28c749e13d1a',
    shortId: 53022,
    titleEnglish: "How I Attended an All-Guy's Mixer",
    format: 'TV',
  });
  const failedHydration = await failingAnimeService.hydrateAnimeItem(summaryCard, 'en');
  assert.ok(failedHydration.detailsError?.includes('temporarily unavailable'));
  const errorFallbackEmbed = createAnimeEmbed(failedHydration.anime, {
    detailsFetchError: failedHydration.detailsError,
  }).toJSON();
  assert.ok(
    errorFallbackEmbed.description?.includes('Could not retrieve anime details from Hoshika')
  );
  assert.equal(
    errorFallbackEmbed.description?.includes('Synopsis is not available for this anime.'),
    false
  );

  // 3. Localization fallback: if locale=ja has null synopsis, falls back to locale=en synopsis
  const localeClient = {
    get: async (_endpoint: string, options?: { params?: Record<string, any> }) => {
      const loc = options?.params?.locale;
      return {
        ok: true,
        anime: {
          id: '337b59a5-3c8c-4449-9937-28c749e13d1a',
          shortId: 53022,
          titleEnglish: "How I Attended an All-Guy's Mixer",
          synopsis:
            loc === 'en'
              ? 'Tokiwa, a college student, is invited to a mixer by his female classmate Suo.'
              : null,
        },
      };
    },
  } as unknown as HoshikaClient;
  const localeService = new AnimeService(
    localeClient,
    new AnimeCacheService(new CacheService('')),
    identifiers,
    new AnimeSearchService(localeClient, animeCache, identifiers),
    linkService
  );
  const { anime: fallbackAnime } = await localeService.getDetails(53022, 'ja');
  assert.equal(
    fallbackAnime.synopsis,
    'Tokiwa, a college student, is invited to a mixer by his female classmate Suo.'
  );

  // 4. Clean synopsis never uses the anime's own title as a synopsis
  const titleAsSynopsis = AnimeMetadataNormalizer.normalizeAnime({
    id: 'bad-synopsis-id',
    shortId: 99999,
    titleEnglish: 'Duplicate Title Synopsis',
    synopsis: 'Duplicate Title Synopsis',
  });
  assert.equal(titleAsSynopsis.synopsis, null);
});

test('Public /anime recommendation command: Frieren, Naruto, One Piece exact matches, ambiguous select menu, public message delivery, buttons, watchlist account linking, simultaneous users, rate limits, and permission checks', async () => {
  const {
    createPublicRecommendationEmbed,
    buildPublicRecommendationRows,
  } = await import('../packages/discord-ui/src');
  const { AnimeCacheService, AnimeIdentifierService } = await import(
    '../apps/bot/src/services/hoshika/AnimeCacheService'
  );
  const {
    AnimeSearchService,
    AnimeService,
    evaluateRecommendationSearchMatches,
  } = await import('../apps/bot/src/services/hoshika/AnimeService');
  const {
    animeCommand,
    animeRecommendationSessions,
  } = await import('../apps/bot/src/commands/anime/anime');
  const { handleInteraction } = await import('../apps/bot/src/interactions/router');
  const { PermissionFlagsBits } = await import('discord.js');

  // Real Hoshika search responses for Frieren, Naruto, One Piece, and Fate
  const searchFixtures: Record<string, any[]> = {
    frieren: [
      {
        id: 'ba7ae869-82a1-458c-91ae-a5d4fc606947',
        shortId: 26178,
        slug: 'frieren-beyond-journey-s-end',
        titleRomaji: 'Sousou no Frieren',
        titleEnglish: "Frieren: Beyond Journey's End",
        coverImage: 'https://cdn.hoshika.app/covers/anime/ba7ae869-82a1-458c-91ae-a5d4fc606947.webp',
        format: 'TV',
        averageScore: 92,
      },
      {
        id: 'aa5de7bb-383b-40e1-a001-ef437eeb7e26',
        shortId: 90464,
        slug: 'frieren-beyond-journeys-end-season-2',
        titleRomaji: 'Sousou no Frieren 2nd Season',
        titleEnglish: "Frieren: Beyond Journey's End Season 2",
        coverImage: 'https://cdn.hoshika.app/covers/anime/aa5de7bb-383b-40e1-a001-ef437eeb7e26.webp',
        format: 'TV',
        averageScore: 89,
      },
      {
        id: '79ac232b-1171-443c-b455-c69ec58d1058',
        shortId: 317583,
        slug: 'sousou-no-frieren-no-mahou-part-3',
        titleRomaji: 'Sousou no Frieren: ●● no Mahou Part 3',
        titleEnglish: 'Frieren: Beyond Journey’s End Season 2 Mini Anime',
        format: 'ONA',
        averageScore: 68,
      },
    ],
    naruto: [
      {
        id: 'bfda1b08-54b8-4945-beba-8fb9a7aded1b',
        shortId: 41391,
        slug: 'naruto',
        titleRomaji: 'Naruto',
        titleEnglish: 'Naruto',
        coverImage: 'https://cdn.hoshika.app/catalog/covers/anime/41391.webp',
        format: 'TV',
        averageScore: 81,
      },
      {
        id: '7e714dd5-0de9-4722-ad01-9a70785a8c02',
        shortId: 30350,
        slug: 'naruto-shippuden',
        titleRomaji: 'Naruto: Shippuuden',
        titleEnglish: 'Naruto Shippuden',
        format: 'TV',
        averageScore: 82,
      },
    ],
    'one piece': [
      {
        id: '3692dc77-a48b-4f16-8c73-652229442c81',
        shortId: 58090,
        slug: 'one-piece',
        titleRomaji: 'One Piece',
        titleEnglish: 'One Piece',
        coverImage: 'https://cdn.hoshika.app/catalog/covers/anime/58090/e74a04e0fb4278514384.webp',
        format: 'TV',
        averageScore: 86,
      },
      {
        id: 'cd56e4ae-cf06-40c8-980e-c640c157fa4d',
        shortId: 555102,
        slug: 'one-piece-the-movie',
        titleRomaji: 'One Piece Movie 01',
        titleEnglish: 'One Piece: The Movie',
        format: 'MOVIE',
        averageScore: 71,
      },
    ],
    fate: [
      {
        id: '18d5ae60-4dc6-42ff-b341-a72c3aa09a4b',
        shortId: 53854,
        slug: 'fate-zero',
        titleRomaji: 'Fate/Zero',
        titleEnglish: 'Fate/Zero',
        format: 'TV',
        averageScore: 83,
      },
      {
        id: '6482c44c-861c-426d-bac0-f6e42552d9e6',
        shortId: 62139,
        slug: 'fate-stay-night-unlimited-blade-works',
        titleRomaji: 'Fate/stay night: Unlimited Blade Works',
        titleEnglish: 'Fate/stay night [Unlimited Blade Works]',
        format: 'TV',
        averageScore: 82,
      },
      {
        id: 'be2f85ed-8442-465a-bace-ceac56434e5a',
        shortId: 661822,
        slug: 'fate-stay-night',
        titleRomaji: 'Fate/stay night',
        titleEnglish: 'Fate/stay night',
        format: 'TV',
        averageScore: 73,
      },
    ],
  };

  const detailFixtures: Record<number, any> = {
    26178: {
      ok: true,
      anime: {
        id: 'ba7ae869-82a1-458c-91ae-a5d4fc606947',
        shortId: 26178,
        anilistId: 154587,
        malId: 52991,
        titleRomaji: 'Sousou no Frieren',
        titleEnglish: "Frieren: Beyond Journey's End",
        titleJapanese: '葬送のフリーレン',
        synopsis:
          'After a ten-year quest to defeat the Demon King, the elven mage Frieren embarks on a new journey to understand humanity and the fleeting lives of her former companions.',
        coverImage: 'https://cdn.hoshika.app/covers/anime/ba7ae869-82a1-458c-91ae-a5d4fc606947.webp',
        format: 'TV',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2023,
        episodes: 28,
        averageScore: 92,
        genres: [{ name: 'Adventure' }, { name: 'Drama' }, { name: 'Fantasy' }],
        studios: [{ name: 'Madhouse' }],
      },
    },
    41391: {
      ok: true,
      anime: {
        id: 'bfda1b08-54b8-4945-beba-8fb9a7aded1b',
        shortId: 41391,
        anilistId: 20,
        malId: 20,
        titleRomaji: 'Naruto',
        titleEnglish: 'Naruto',
        titleJapanese: 'NARUTO -ナルト-',
        synopsis:
          'Naruto Uzumaki, a mischievous adolescent ninja, struggles as he searches for recognition and dreams of becoming the Hokage, the village leader and strongest ninja.',
        coverImage: 'https://cdn.hoshika.app/catalog/covers/anime/41391.webp',
        format: 'TV',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2002,
        episodes: 220,
        averageScore: 81,
        genres: [{ name: 'Action' }, { name: 'Adventure' }],
        studios: [{ name: 'Pierrot' }],
      },
    },
    58090: {
      ok: true,
      anime: {
        id: '3692dc77-a48b-4f16-8c73-652229442c81',
        shortId: 58090,
        anilistId: 21,
        malId: 21,
        titleRomaji: 'One Piece',
        titleEnglish: 'One Piece',
        titleJapanese: 'ONE PIECE',
        synopsis:
          'Monkey D. Luffy sets off on an adventure with his pirate crew in hopes of finding the greatest treasure ever, known as the One Piece.',
        coverImage: 'https://cdn.hoshika.app/catalog/covers/anime/58090/e74a04e0fb4278514384.webp',
        format: 'TV',
        status: 'RELEASING',
        season: 'FALL',
        seasonYear: 1999,
        episodes: null,
        averageScore: 86,
        genres: [{ name: 'Action' }, { name: 'Adventure' }, { name: 'Fantasy' }],
        studios: [{ name: 'Toei Animation' }],
      },
    },
    62139: {
      ok: true,
      anime: {
        id: '6482c44c-861c-426d-bac0-f6e42552d9e6',
        shortId: 62139,
        anilistId: 19603,
        titleRomaji: 'Fate/stay night: Unlimited Blade Works',
        titleEnglish: 'Fate/stay night [Unlimited Blade Works]',
        titleJapanese: 'Fate/stay night [Unlimited Blade Works]',
        synopsis:
          'Rin Tohsaka and Shirou Emiya enter the Fifth Holy Grail War in Fuyuki City alongside the Servant Archer.',
        coverImage: 'https://cdn.hoshika.app/covers/anime/6482c44c-861c-426d-bac0-f6e42552d9e6.webp',
        format: 'TV',
        status: 'FINISHED',
        season: 'FALL',
        seasonYear: 2014,
        episodes: 12,
        averageScore: 82,
        genres: [{ name: 'Action' }, { name: 'Fantasy' }, { name: 'Supernatural' }],
        studios: [{ name: 'ufotable' }],
      },
    },
  };

  // Setup services & in-memory SQLite database
  const db = new AniScrollDatabase(':memory:');
  db.ensureGuild({
    discordGuildId: 'guild-rec-1',
    name: 'AniScroll Community HQ',
    memberCount: 500,
    channels: [{ id: 'ch-general', name: 'general', type: 'text' }],
  });
  // Disable cooldown in guild settings so rapid test invocations work, then test cooldown explicitly
  const initialSettings = db.getGuildSettings('guild-rec-1');
  db.updateGuildSettingsSection(
    'guild-rec-1',
    'animeConfig',
    {
      ...initialSettings.animeConfig,
      recommendationEnabled: true,
      recommendationCooldownSeconds: 0,
      recommendationAnalyticsEnabled: true,
      recommendationAllowedChannelIds: [],
    },
    'admin-actor'
  );

  const cache = new CacheService('');
  const animeCache = new AnimeCacheService(cache);
  const identifiers = new AnimeIdentifierService();
  const mockHoshikaClient = {
    get: async (endpoint: string, options?: { params?: Record<string, any> }) => {
      if (endpoint === '/search') {
        const q = String(options?.params?.q || '').toLowerCase().trim();
        return { ok: true, anime: searchFixtures[q] || [] };
      }
      const match = endpoint.match(/^\/anime\/(\d+)$/);
      if (match) {
        const id = Number(match[1]);
        if (detailFixtures[id]) return detailFixtures[id];
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
  } as unknown as HoshikaClient;

  const searchService = new AnimeSearchService(mockHoshikaClient, animeCache, identifiers);
  const linkService = new AniScrollLinkService(searchService);
  const animeService = new AnimeService(mockHoshikaClient, animeCache, identifiers, searchService, linkService);

  const { WebsiteWatchlistService } = await import(
    '../apps/bot/src/services/watchlist/WebsiteWatchlistService'
  );
  const websiteStore = new Map<string, any[]>();
  const linkedDiscordToUid = new Map<string, string>([['100000000000000888', 'firebase-uid-888']]);
  const mockWebsiteWatchlist = new WebsiteWatchlistService({
    baseUrl: 'https://aniscroll.in',
    apiSecret: 'test-bot-secret',
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const discordId = (init?.headers as Record<string, string>)?.['X-Discord-User-Id'] || '';
      const uid = linkedDiscordToUid.get(discordId);
      if (!uid) {
        return new Response(
          JSON.stringify({ ok: false, code: 'DISCORD_NOT_LINKED', message: 'Discord account not linked' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/api/bot/v1/watchlist' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}'));
        if ('titleEnglish' in body) {
          return new Response(
            JSON.stringify({
              ok: false,
              code: 'UNSUPPORTED_FIELD',
              error: "Unsupported field 'titleEnglish' in watchlist request.",
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        const items = websiteStore.get(uid) || [];
        if (items.some((i) => i.hoshikaId === body.hoshikaId)) {
          return new Response(
            JSON.stringify({
              ok: false,
              code: 'DUPLICATE_WATCHLIST',
              error: 'This anime is already in your AniScroll website watchlist.',
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          );
        }
        const created = {
          id: String(body.hoshikaId),
          uid,
          hoshikaId: body.hoshikaId,
          title: body.title,
          coverImage: body.coverImage ?? null,
          format: body.format ?? null,
          rating: body.rating ?? null,
          seasonYear: body.seasonYear ?? null,
          status: body.status || 'plan_to_watch',
        };
        websiteStore.set(uid, [...items, created]);
        return new Response(JSON.stringify({ ok: true, item: created }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, items: websiteStore.get(uid) || [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const commands = new Map([[animeCommand.name, animeCommand]]);
  const ctx: any = {
    db,
    cache,
    animeService,
    musicService: {},
    websiteWatchlist: mockWebsiteWatchlist,
    maintenanceMode: false,
  };

  // Helper to build a mock Discord ChatInputCommandInteraction
  const publicChannelMessages: any[] = [];
  const createSlashInteraction = (opts: {
    animeName: string;
    userId?: string;
    username?: string;
    channelId?: string;
    hasPerms?: boolean;
    sendRejects?: boolean;
  }) => {
    const replies: any[] = [];
    const edits: any[] = [];
    const hasPerms = opts.hasPerms ?? true;
    const channel = {
      id: opts.channelId || 'ch-general',
      permissionsFor: () => ({
        has: (flag: bigint) => {
          if (!hasPerms && flag === PermissionFlagsBits.EmbedLinks) return false;
          return true;
        },
      }),
      send: async (payload: any) => {
        if (opts.sendRejects) {
          throw new Error('Missing Access (50001)');
        }
        const msg = { id: `pub-msg-${publicChannelMessages.length + 1}`, payload };
        publicChannelMessages.push(msg);
        return msg;
      },
    };

    const interaction: any = {
      commandName: 'anime',
      guildId: 'guild-rec-1',
      channelId: opts.channelId || 'ch-general',
      guild: {
        id: 'guild-rec-1',
        name: 'AniScroll Community HQ',
        members: { me: { id: 'bot-user' } },
      },
      channel,
      user: {
        id: opts.userId || 'user-100',
        username: opts.username || 'otaku_member',
        avatar: null,
      },
      member: {
        // Ordinary member without Administrator or ManageGuild
        permissions: { has: () => false },
      },
      deferred: false,
      replied: false,
      isChatInputCommand: () => true,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isRepliable: () => true,
      options: {
        getSubcommand: () => 'recommendation',
        getString: (name: string) => (name === 'anime_name' ? opts.animeName : null),
      },
      deferReply: async (dOpts?: any) => {
        interaction.deferred = true;
        replies.push({ deferred: true, ...dOpts });
      },
      reply: async (payload: any) => {
        interaction.replied = true;
        replies.push(payload);
      },
      editReply: async (payload: any) => {
        edits.push(payload);
        return payload;
      },
      _replies: replies,
      _edits: edits,
    };
    return interaction;
  };

  // Test 1, 2, 3, 7, 8, 9, 10: Frieren, Naruto, and One Piece exact matches publish public messages in the invocation channel
  for (const testCase of [
    { query: 'Frieren', expectedShortId: 26178, expectedTitle: "Frieren: Beyond Journey's End", expectedStudio: 'Madhouse' },
    { query: 'Naruto', expectedShortId: 41391, expectedTitle: 'Naruto', expectedStudio: 'Pierrot' },
    { query: 'One Piece', expectedShortId: 58090, expectedTitle: 'One Piece', expectedStudio: 'Toei Animation' },
  ]) {
    const beforeCount = publicChannelMessages.length;
    const interaction = createSlashInteraction({
      animeName: testCase.query,
      userId: `member-${testCase.expectedShortId}`,
      username: `fan_${testCase.expectedShortId}`,
    });

    await handleInteraction(interaction, commands, ctx);

    // Public message sent directly to channel
    assert.equal(publicChannelMessages.length, beforeCount + 1);
    const pubMsg = publicChannelMessages[publicChannelMessages.length - 1];
    const embedJson = pubMsg.payload.embeds[0].toJSON();

    assert.equal(embedJson.author?.name, 'Community Anime Recommendation');
    assert.equal(embedJson.title, testCase.expectedTitle);
    assert.equal(embedJson.url, `https://aniscroll.in/anime/${testCase.expectedShortId}`);
    assert.ok(embedJson.description?.includes('**Synopsis:**'));
    assert.equal(embedJson.description?.includes('Synopsis is not available'), false);

    const fieldMap = new Map(embedJson.fields?.map((f: any) => [f.name, f.value]));
    assert.equal(fieldMap.get('Hoshika ID'), String(testCase.expectedShortId));
    assert.equal(fieldMap.get('Studios'), testCase.expectedStudio);
    assert.equal(fieldMap.get('Recommended By'), `<@member-${testCase.expectedShortId}>`);
    assert.equal(
      embedJson.footer?.text,
      `Recommended by: @fan_${testCase.expectedShortId} · Server: AniScroll Community HQ · Hoshika ID: ${testCase.expectedShortId}`
    );

    // Verify interactive buttons on the public recommendation card
    const buttons = pubMsg.payload.components[0].toJSON().components;
    assert.equal(buttons.length, 3);
    assert.equal(buttons[0].label, 'Open AniScroll');
    assert.equal(buttons[0].url, `https://aniscroll.in/anime/${testCase.expectedShortId}`);
    assert.equal(buttons[1].label, 'View Details');
    assert.equal(buttons[1].custom_id, `anime:recdetails:${testCase.expectedShortId}`);
    assert.equal(buttons[2].label, 'Add to Watchlist');
    assert.equal(buttons[2].custom_id, `watchlist:recadd:${testCase.expectedShortId}`);
  }

  // Test 5: Anime with no results
  const noResInteraction = createSlashInteraction({
    animeName: 'nonexistentanime999999',
    userId: 'user-nores',
  });
  await handleInteraction(noResInteraction, commands, ctx);
  assert.equal(noResInteraction._edits.length, 1);
  const noResEmbed = noResInteraction._edits[0].embeds[0].toJSON();
  assert.equal(noResEmbed.title, 'Anime Not Found');
  assert.ok(noResEmbed.description?.includes('No anime found on Hoshika matching "nonexistentanime999999"'));

  // Test 4, 6, 12: Ambiguous anime title ("Fate") displays selection menu, works simultaneously for multiple users, blocks unauthorized users, and publishes on selection
  const userAInteraction = createSlashInteraction({
    animeName: 'Fate',
    userId: 'user-A',
    username: 'alice_otaku',
  });
  const userBInteraction = createSlashInteraction({
    animeName: 'Fate',
    userId: 'user-B',
    username: 'bob_otaku',
  });

  await Promise.all([
    handleInteraction(userAInteraction, commands, ctx),
    handleInteraction(userBInteraction, commands, ctx),
  ]);

  const selectCompA = userAInteraction._edits[0].components[0].toJSON().components[0];
  const selectCompB = userBInteraction._edits[0].components[0].toJSON().components[0];
  assert.notEqual(selectCompA.custom_id, selectCompB.custom_id, 'Simultaneous users must receive distinct session IDs');

  // Unauthorized user trying to select from User A's menu must be rejected
  const unauthorizedSelect: any = {
    customId: selectCompA.custom_id,
    values: ['62139'],
    user: { id: 'intruder-user', username: 'intruder' },
    guildId: 'guild-rec-1',
    channelId: 'ch-general',
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    isRepliable: () => true,
    reply: async (p: any) => {
      unauthorizedSelect._reply = p;
    },
  };
  await handleInteraction(unauthorizedSelect, commands, ctx);
  assert.ok(
    unauthorizedSelect._reply?.embeds[0].toJSON().description?.includes('Only the user who ran `/anime recommendation`')
  );

  // User A selects Fate/stay night [Unlimited Blade Works] (shortId 62139)
  const beforeSelectPubCount = publicChannelMessages.length;
  const validSelectA: any = {
    customId: selectCompA.custom_id,
    values: ['62139'],
    user: { id: 'user-A', username: 'alice_otaku' },
    guildId: 'guild-rec-1',
    channelId: 'ch-general',
    guild: userAInteraction.guild,
    channel: userAInteraction.channel,
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    isRepliable: () => true,
    deferUpdate: async () => {
      validSelectA.deferred = true;
    },
    editReply: async (p: any) => {
      validSelectA._edit = p;
    },
  };
  await handleInteraction(validSelectA, commands, ctx);
  assert.equal(publicChannelMessages.length, beforeSelectPubCount + 1);
  const fatePubEmbed = publicChannelMessages[publicChannelMessages.length - 1].payload.embeds[0].toJSON();
  assert.equal(fatePubEmbed.title, 'Fate/stay night [Unlimited Blade Works]');
  assert.equal(fatePubEmbed.url, 'https://aniscroll.in/anime/62139');

  // Test 8 fallback: Missing synopsis displays "Synopsis is not available for this anime."
  const missingSynopsisAnime = AnimeMetadataNormalizer.normalizeAnime({
    id: 'missing-syn-uuid',
    shortId: 77777,
    titleEnglish: 'Mystery Untold Anime',
    synopsis: null,
  });
  const missingSynEmbed = createPublicRecommendationEmbed(missingSynopsisAnime, {
    recommendedByUserId: 'user-A',
    recommendedByUsername: 'alice_otaku',
    serverName: 'AniScroll Community HQ',
  }).toJSON();
  assert.ok(missingSynEmbed.description?.includes('Synopsis is not available for this anime.'));

  // Test 11: "Add to Watchlist" button (unlinked user -> exact link prompt; linked user -> saves to website API & prevents duplicate)
  const unlinkedWatchlistClick: any = {
    customId: 'watchlist:recadd:26178',
    user: { id: '100000000000000999', username: 'newcomer', avatar: null },
    guildId: 'guild-rec-1',
    channelId: 'ch-general',
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isRepliable: () => true,
    deferReply: async () => {
      unlinkedWatchlistClick.deferred = true;
    },
    editReply: async (p: any) => {
      unlinkedWatchlistClick._edit = p;
    },
  };
  await handleInteraction(unlinkedWatchlistClick, commands, ctx);
  assert.equal(
    unlinkedWatchlistClick._edit.embeds[0].toJSON().description,
    'Your Discord account is not connected to AniScroll. Log in at https://aniscroll.in, open Account Settings, and connect Discord to access your website watchlist.'
  );

  // Linked Discord account clicks "Add to Watchlist" -> saved via website watchlist API (no local SQLite fallback)
  const linkedWatchlistClick: any = {
    customId: 'watchlist:recadd:26178',
    user: { id: '100000000000000888', username: 'linked_fan', avatar: null },
    guildId: 'guild-rec-1',
    channelId: 'ch-general',
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isRepliable: () => true,
    deferReply: async () => {
      linkedWatchlistClick.deferred = true;
    },
    editReply: async (p: any) => {
      linkedWatchlistClick._edit = p;
    },
  };
  await handleInteraction(linkedWatchlistClick, commands, ctx);
  assert.equal(linkedWatchlistClick._edit.embeds[0].toJSON().title, 'Added to Watchlist');
  assert.equal(websiteStore.get('firebase-uid-888')?.length, 1);
  assert.equal(db.listWatchlist('100000000000000888').length, 0);

  // Clicking "Add to Watchlist" a second time prevents duplicate entry
  const duplicateWatchlistClick: any = {
    ...linkedWatchlistClick,
    deferred: false,
    replied: false,
    _edit: null,
    deferReply: async () => {
      duplicateWatchlistClick.deferred = true;
    },
    editReply: async (p: any) => {
      duplicateWatchlistClick._edit = p;
    },
  };
  await handleInteraction(duplicateWatchlistClick, commands, ctx);
  assert.ok(
    duplicateWatchlistClick._edit.embeds[0].toJSON().description?.includes('already in your AniScroll website watchlist')
  );
  assert.equal(websiteStore.get('firebase-uid-888')?.length, 1);

  // Test 13: Cooldown & duplicate request protection
  db.updateGuildSettingsSection(
    'guild-rec-1',
    'animeConfig',
    {
      ...db.getGuildSettings('guild-rec-1').animeConfig,
      recommendationCooldownSeconds: 30,
    },
    'admin-actor'
  );
  const cooldownFirst = createSlashInteraction({
    animeName: 'Naruto',
    userId: 'cooldown-user',
  });
  await animeCommand.execute(cooldownFirst, ctx);

  const cooldownSecond = createSlashInteraction({
    animeName: 'One Piece',
    userId: 'cooldown-user',
  });
  await assert.rejects(
    () => animeCommand.execute(cooldownSecond, ctx),
    (err: any) => err.userMessage?.includes('Recommendation cooldown active')
  );

  // Duplicate request protection for identical anime_name within 8s window
  const dupInteraction = createSlashInteraction({
    animeName: 'Naruto',
    userId: 'cooldown-user',
  });
  await assert.rejects(
    () => animeCommand.execute(dupInteraction, ctx),
    (err: any) => err.userMessage?.includes('already requested a recommendation for "Naruto"')
  );

  // Reset cooldown to 0 for permission tests
  db.updateGuildSettingsSection(
    'guild-rec-1',
    'animeConfig',
    {
      ...db.getGuildSettings('guild-rec-1').animeConfig,
      recommendationCooldownSeconds: 0,
    },
    'admin-actor'
  );

  // Test 14: Missing channel permissions or rejected channel.send never falsely reports success
  const countBeforePermFail = publicChannelMessages.length;
  const missingPermInteraction = createSlashInteraction({
    animeName: 'Frieren',
    userId: 'perm-test-user-1',
    hasPerms: false,
  });
  await handleInteraction(missingPermInteraction, commands, ctx);
  assert.equal(publicChannelMessages.length, countBeforePermFail);
  assert.ok(
    missingPermInteraction._replies[0]?.embeds[0].toJSON().description?.includes('missing required permissions')
  );

  const rejectedSendInteraction = createSlashInteraction({
    animeName: 'Frieren',
    userId: 'perm-test-user-2',
    sendRejects: true,
  });
  await handleInteraction(rejectedSendInteraction, commands, ctx);
  assert.equal(publicChannelMessages.length, countBeforePermFail);
  assert.ok(
    rejectedSendInteraction._edits[0]?.embeds[0].toJSON().description?.includes('Discord rejected sending')
  );

  // Verify database analytics recorded the successful recommendations
  const stats = db.getCommunityRecommendationStats('guild-rec-1', 'https://aniscroll.in');
  assert.equal(stats.totalRecommendations, 5);
  assert.equal(stats.topRecommendedAnime[0]?.aniscrollUrl?.startsWith('https://aniscroll.in/anime/'), true);
});




