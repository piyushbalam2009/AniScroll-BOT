import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { AniScrollDatabase } from '../packages/database/src/db';
import { CacheService } from '../apps/bot/src/services/cache/CacheService';
import { AnimeCacheService, AnimeIdentifierService } from '../apps/bot/src/services/hoshika/AnimeCacheService';
import { AnimeSearchService, AnimeService, AniScrollLinkService } from '../apps/bot/src/services/hoshika/AnimeService';
import { HoshikaClient } from '../apps/bot/src/services/hoshika/HoshikaClient';
import {
  UNLINKED_DISCORD_MESSAGE,
  WebsiteWatchlistService,
} from '../apps/bot/src/services/watchlist/WebsiteWatchlistService';
import { watchlistCommand } from '../apps/bot/src/commands/watchlist/watchlist';
import { handleInteraction } from '../apps/bot/src/interactions/router';

const USER_A_DISCORD = '111222333444555666';
const USER_B_DISCORD = '999888777666555444';
const UNLINKED_DISCORD = '777666555444333222';
const BOT_SECRET = 'super-secret-website-bot-token-do-not-leak';

function createMockHoshikaAnimeService(cache: CacheService) {
  const searchFixtures: Record<string, any[]> = {
    frieren: [
      {
        id: 'ba7ae869-82a1-458c-91ae-a5d4fc606947',
        shortId: 26178,
        slug: 'frieren-beyond-journey-s-end',
        titleRomaji: 'Sousou no Frieren',
        titleEnglish: "Frieren: Beyond Journey's End",
        coverImage: 'https://cdn.hoshika.app/covers/anime/26178.webp',
        format: 'TV',
        seasonYear: 2023,
        episodes: 28,
        averageScore: 92,
      },
      {
        id: 'aa5de7bb-383b-40e1-a001-ef437eeb7e26',
        shortId: 90464,
        slug: 'frieren-beyond-journeys-end-season-2',
        titleRomaji: 'Sousou no Frieren 2nd Season',
        titleEnglish: "Frieren: Beyond Journey's End Season 2",
        coverImage: 'https://cdn.hoshika.app/covers/anime/90464.webp',
        format: 'TV',
        seasonYear: 2026,
        episodes: 10,
        averageScore: 89,
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
        seasonYear: 2002,
        episodes: 220,
        averageScore: 81,
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
        synopsis: 'Elven mage Frieren embarks on a new journey.',
        coverImage: 'https://cdn.hoshika.app/covers/anime/26178.webp',
        format: 'TV',
        seasonYear: 2023,
        episodes: 28,
        averageScore: 92,
        genres: [{ name: 'Adventure' }, { name: 'Drama' }, { name: 'Fantasy' }],
      },
    },
    90464: {
      ok: true,
      anime: {
        id: 'aa5de7bb-383b-40e1-a001-ef437eeb7e26',
        shortId: 90464,
        anilistId: 182255,
        titleRomaji: 'Sousou no Frieren 2nd Season',
        titleEnglish: "Frieren: Beyond Journey's End Season 2",
        synopsis: 'Continuation of Frieren.',
        coverImage: 'https://cdn.hoshika.app/covers/anime/90464.webp',
        format: 'TV',
        seasonYear: 2026,
        episodes: 10,
        averageScore: 89,
        genres: [{ name: 'Adventure' }, { name: 'Fantasy' }],
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
        synopsis: 'Naruto dreams of becoming Hokage.',
        coverImage: 'https://cdn.hoshika.app/catalog/covers/anime/41391.webp',
        format: 'TV',
        seasonYear: 2002,
        episodes: 220,
        averageScore: 81,
        genres: [{ name: 'Action' }, { name: 'Adventure' }],
      },
    },
  };

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
      throw new Error(`Unexpected Hoshika endpoint ${endpoint}`);
    },
  } as unknown as HoshikaClient;

  const searchService = new AnimeSearchService(mockHoshikaClient, animeCache, identifiers);
  const linkService = new AniScrollLinkService(searchService);
  return new AnimeService(mockHoshikaClient, animeCache, identifiers, searchService, linkService);
}

function createSlashInteraction(opts: {
  subcommand: string;
  userId: string;
  username?: string;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
  booleans?: Record<string, boolean>;
}) {
  const replies: any[] = [];
  const edits: any[] = [];
  const interaction: any = {
    commandName: 'watchlist',
    guildId: 'guild-wl-1',
    channelId: 'ch-wl-1',
    user: {
      id: opts.userId,
      username: opts.username || 'otaku_user',
      avatar: null,
    },
    member: { permissions: { has: () => false } },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isRepliable: () => true,
    options: {
      getSubcommand: () => opts.subcommand,
      getString: (name: string, required?: boolean) => {
        const val = opts.strings?.[name] ?? null;
        if (required && !val) throw new Error(`Missing required string option ${name}`);
        return val;
      },
      getInteger: (name: string, required?: boolean) => {
        const val = opts.integers?.[name] ?? null;
        if (required && val === null) throw new Error(`Missing required integer option ${name}`);
        return val;
      },
      getBoolean: (name: string) => opts.booleans?.[name] ?? null,
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
}

test('AniScroll Website Watchlist integration verifies linking, CRUD, stats, duplicate/cross-user protection, outage, rate limit, and unlinking', async () => {
  // Simulated website Firebase Firestore watchlist store & Discord link registry
  const discordToFirebaseUid = new Map<string, string>([
    [USER_A_DISCORD, 'firebase_uid_alpha'],
    [USER_B_DISCORD, 'firebase_uid_beta'],
  ]);
  const revokedLinks = new Set<string>();
  const firestoreWatchlists = new Map<string, any[]>([
    [
      'firebase_uid_alpha',
      [
        {
          id: 'doc-41391',
          shortId: 41391,
          title: 'Naruto',
          titleRomaji: 'Naruto',
          poster: 'https://cdn.hoshika.app/catalog/covers/anime/41391.webp',
          genres: ['Action', 'Adventure'],
          status: 'watching',
          episodesWatched: 120,
          totalEpisodes: 220,
          rating: 8,
          notes: 'Chunin exams arc',
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-11-10T10:00:00.000Z',
        },
      ],
    ],
    [
      'firebase_uid_beta',
      [
        {
          id: 'doc-90464',
          shortId: 90464,
          title: "Frieren: Beyond Journey's End Season 2",
          genres: ['Adventure', 'Fantasy'],
          status: 'completed',
          episodesWatched: 10,
          totalEpisodes: 10,
          rating: 10,
          createdAt: '2026-11-01T10:00:00.000Z',
          updatedAt: '2026-11-12T10:00:00.000Z',
        },
      ],
    ],
  ]);

  let simulateOutage = false;
  let simulateRateLimitRemaining = 0;
  let simulateCrossUserLeak = false;
  const recordedRequests: Array<{ method: string; path: string; discordUserId: string; authHeader: string }> = [];

  const app = express();
  app.use(express.json());

  const recordedPostBodies: any[] = [];
  let simulateHtml404 = false;

  app.use('/api/bot/v1/watchlist', (req, res, next) => {
    if (simulateHtml404) {
      res.status(404).type('text/html').send('<!DOCTYPE html><html><body>404 Not Found</body></html>');
      return;
    }

    const authHeader = String(req.headers.authorization || '');
    const discordId = String(req.headers['x-discord-user-id'] || req.query.discordUserId || req.body?.discordUserId || '');
    recordedRequests.push({
      method: req.method,
      path: req.originalUrl,
      discordUserId: discordId,
      authHeader: authHeader === `Bearer ${BOT_SECRET}` ? 'valid-bearer' : 'invalid-bearer',
    });

    if (simulateOutage) {
      res.status(503).json({ ok: false, error: 'Firestore maintenance' });
      return;
    }
    if (simulateRateLimitRemaining > 0) {
      simulateRateLimitRemaining -= 1;
      res.setHeader('Retry-After', '1');
      res.status(429).json({ ok: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Slow down' });
      return;
    }
    if (authHeader !== `Bearer ${BOT_SECRET}`) {
      res.status(401).json({ ok: false, code: 'invalid_bot_secret', error: 'Unauthorized bot client' });
      return;
    }
    if (!discordId || !/^\d{17,22}$/.test(discordId)) {
      res.status(400).json({ ok: false, error: 'Missing valid discordUserId' });
      return;
    }
    if (revokedLinks.has(discordId)) {
      res.status(403).json({ ok: false, code: 'LINK_REVOKED', error: 'Discord link expired or revoked' });
      return;
    }
    const firebaseUid = discordToFirebaseUid.get(discordId);
    if (!firebaseUid) {
      res.status(404).json({ ok: false, code: 'DISCORD_NOT_LINKED', error: 'Discord account not linked' });
      return;
    }
    (req as any).firebaseUid = firebaseUid;
    (req as any).discordUserId = discordId;
    next();
  });

  app.get('/api/bot/v1/watchlist', (req, res) => {
    const uid = (req as any).firebaseUid as string;
    const discordId = (req as any).discordUserId as string;
    if (simulateCrossUserLeak) {
      res.json({
        ok: true,
        items: [{ id: 'leak', discordUserId: USER_B_DISCORD, shortId: 90464, title: 'Leaked', status: 'watching', episodesWatched: 1 }],
      });
      return;
    }
    const items = (firestoreWatchlists.get(uid) || []).map((i) => ({ ...i, discordUserId: discordId }));
    res.json({ ok: true, linked: true, items });
  });

  app.get('/api/bot/v1/watchlist/:hoshikaId', (req, res) => {
    const uid = (req as any).firebaseUid as string;
    const discordId = (req as any).discordUserId as string;
    const hoshikaId = Number(req.params.hoshikaId);
    const list = firestoreWatchlists.get(uid) || [];
    const found = list.find((i) => (i.shortId ?? Number(i.hoshikaId ?? i.id)) === hoshikaId);
    if (!found) {
      res.status(404).json({
        ok: false,
        code: 'WATCHLIST_ITEM_NOT_FOUND',
        error: 'That anime was not found in your AniScroll website watchlist.',
      });
      return;
    }
    res.json({ ok: true, item: { ...found, discordUserId: discordId } });
  });

  const ALLOWED_POST_FIELDS = new Set([
    'discordUserId',
    'hoshikaId',
    'title',
    'coverImage',
    'format',
    'rating',
    'seasonYear',
    'status',
  ]);
  const ALLOWED_PATCH_FIELDS = new Set([
    'discordUserId',
    'hoshikaId',
    'status',
    'episodesWatched',
    'rating',
    'notes',
  ]);
  const recordedPatchBodies: any[] = [];

  app.post('/api/bot/v1/watchlist', (req, res) => {
    const uid = (req as any).firebaseUid as string;
    const body = req.body || {};
    recordedPostBodies.push(body);

    for (const key of Object.keys(body)) {
      if (!ALLOWED_POST_FIELDS.has(key)) {
        res.status(400).json({
          ok: false,
          code: 'UNSUPPORTED_FIELD',
          error: `Unsupported field '${key}' in watchlist request.`,
        });
        return;
      }
    }

    const canonicalId = Number(body.hoshikaId);
    if (!Number.isInteger(canonicalId) || canonicalId <= 0) {
      res.status(400).json({ ok: false, code: 'INVALID_HOSHIKA_ID', error: 'Invalid Hoshika ID' });
      return;
    }
    const list = firestoreWatchlists.get(uid) || [];
    if (list.some((i) => (i.shortId ?? Number(i.hoshikaId ?? i.id)) === canonicalId)) {
      res.status(409).json({
        ok: false,
        code: 'ALREADY_IN_WATCHLIST',
        error: 'This anime is already in your AniScroll website watchlist.',
      });
      return;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Simulate real Firestore document shape under /users/{uid}/watchlist/{hoshikaId}
    const created = {
      id: String(canonicalId),
      uid,
      hoshikaId: canonicalId,
      title: body.title,
      coverImage: body.coverImage ?? null,
      format: body.format ?? null,
      rating: body.rating ?? null,
      seasonYear: body.seasonYear ?? null,
      status: body.status || 'plan_to_watch',
      addedAt: { seconds: nowSeconds },
      createdAt: { seconds: nowSeconds },
      updatedAt: { seconds: nowSeconds },
    };
    firestoreWatchlists.set(uid, [...list, created]);
    res.status(201).json({ ok: true, item: created });
  });

  app.patch('/api/bot/v1/watchlist/:hoshikaId', (req, res) => {
    const uid = (req as any).firebaseUid as string;
    const discordId = (req as any).discordUserId as string;
    const body = req.body || {};
    recordedPatchBodies.push(body);

    for (const key of Object.keys(body)) {
      if (!ALLOWED_PATCH_FIELDS.has(key)) {
        res.status(400).json({
          ok: false,
          code: 'UNSUPPORTED_FIELD',
          error: `Unsupported field '${key}' in watchlist request.`,
        });
        return;
      }
    }

    const hoshikaId = Number(req.params.hoshikaId);
    const list = firestoreWatchlists.get(uid) || [];
    const idx = list.findIndex((i) => (i.shortId ?? Number(i.hoshikaId ?? i.id)) === hoshikaId);
    if (idx < 0) {
      res.status(404).json({ ok: false, code: 'WATCHLIST_ITEM_NOT_FOUND', error: 'Item not in watchlist' });
      return;
    }
    const current = list[idx];
    const next = {
      ...current,
      discordUserId: discordId,
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.episodesWatched !== undefined ? { episodesWatched: body.episodesWatched } : {}),
      ...(body.rating !== undefined ? { rating: body.rating } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      updatedAt: new Date().toISOString(),
    };
    list[idx] = next;
    firestoreWatchlists.set(uid, list);
    res.json({ ok: true, item: next });
  });

  app.delete('/api/bot/v1/watchlist/:hoshikaId', (req, res) => {
    const uid = (req as any).firebaseUid as string;
    const discordId = (req as any).discordUserId as string;
    const hoshikaId = Number(req.params.hoshikaId);
    const list = firestoreWatchlists.get(uid) || [];
    const idx = list.findIndex((i) => (i.shortId ?? Number(i.hoshikaId ?? i.id)) === hoshikaId);
    if (idx < 0) {
      res.status(404).json({ ok: false, code: 'WATCHLIST_ITEM_NOT_FOUND', error: 'Item not in watchlist' });
      return;
    }
    const [removedItem] = list.splice(idx, 1);
    firestoreWatchlists.set(uid, list);
    res.json({ ok: true, removed: true, item: { ...removedItem, discordUserId: discordId } });
  });

  const server = app.listen(0);
  const address = server.address() as { port: number };
  const testWebsiteUrl = `http://127.0.0.1:${address.port}`;

  const db = new AniScrollDatabase(':memory:');
  db.ensureGuild({ discordGuildId: 'guild-wl-1', name: 'AniScroll HQ', memberCount: 100 });
  const cache = new CacheService('');
  const animeService = createMockHoshikaAnimeService(cache);
  const websiteWatchlist = new WebsiteWatchlistService({
    baseUrl: testWebsiteUrl,
    apiSecret: BOT_SECRET,
    allowInsecureLocalhost: true,
  });

  const commands = new Map([[watchlistCommand.name, watchlistCommand]]);
  const ctx: any = {
    db,
    cache,
    animeService,
    musicService: {},
    websiteWatchlist,
    maintenanceMode: false,
  };

  const dispatch = async (interaction: any) => {
    await cache.clearNamespace('ratelimit');
    await handleInteraction(interaction, commands, ctx);
  };

  try {
    // 0. Security: HTTPS required for non-localhost URLs & secret never exposed
    const insecureService = new WebsiteWatchlistService({
      baseUrl: 'http://aniscroll.in',
      apiSecret: BOT_SECRET,
    });
    await assert.rejects(
      () => insecureService.listWatchlist(USER_A_DISCORD),
      (err: any) => err.userMessage.includes('HTTPS')
    );

    // 1. Discord user linking: unlinked user gets exact required message on /watchlist show and /watchlist add
    const unlinkedShow = createSlashInteraction({
      subcommand: 'show',
      userId: UNLINKED_DISCORD,
      username: 'unlinked_user',
    });
    await dispatch(unlinkedShow);
    assert.equal(unlinkedShow._edits[0].embeds[0].toJSON().description, UNLINKED_DISCORD_MESSAGE);

    const unlinkedDirectAdd = createSlashInteraction({
      subcommand: 'add',
      userId: UNLINKED_DISCORD,
      username: 'unlinked_user',
      strings: { anime: '26178' },
    });
    await dispatch(unlinkedDirectAdd);
    assert.equal(unlinkedDirectAdd._edits[0].embeds[0].toJSON().description, UNLINKED_DISCORD_MESSAGE);

    // Now link the user on the website, run /watchlist show, and add a new anime directly
    discordToFirebaseUid.set(UNLINKED_DISCORD, 'firebase_uid_gamma');
    firestoreWatchlists.set('firebase_uid_gamma', []);
    const newlyLinkedShow = createSlashInteraction({
      subcommand: 'show',
      userId: UNLINKED_DISCORD,
      username: 'linked_now',
    });
    await dispatch(newlyLinkedShow);
    assert.ok(newlyLinkedShow._edits[0].embeds[0].toJSON().description.includes('watchlist is empty'));

    // 2. Watchlist retrieval: User A retrieves pre-existing website Firestore record (Naruto #41391)
    const showA = createSlashInteraction({
      subcommand: 'show',
      userId: USER_A_DISCORD,
      username: 'alpha',
    });
    await dispatch(showA);
    const showEmbed = showA._edits[0].embeds[0].toJSON();
    assert.ok(showEmbed.title.includes('(1)'));
    assert.ok(showEmbed.description.includes('Naruto'));
    assert.ok(showEmbed.description.includes('https://aniscroll.in/anime/41391'));

    // 3. Anime addition (bugfix regression test):
    // Verify anime #26178 is NOT in watchlist (GET /:id returns null / 404),
    // yet /watchlist add searches Hoshika without any blocking GET and POSTs directly to /api/bot/v1/watchlist
    assert.equal(await websiteWatchlist.getEntry(USER_A_DISCORD, 26178), null);
    const reqCountBeforeAdd = recordedRequests.length;
    const addSearch = createSlashInteraction({
      subcommand: 'add',
      userId: USER_A_DISCORD,
      username: 'alpha',
      strings: { anime: 'Frieren', status: 'watching' },
    });
    await dispatch(addSearch);
    assert.equal(
      recordedRequests.length,
      reqCountBeforeAdd,
      '/watchlist add search must NOT run a prerequisite GET /api/bot/v1/watchlist before searching Hoshika'
    );
    assert.ok(addSearch._edits[0].embeds[0].toJSON().title.includes('Select Anime to Add'));
    const selectCustomId = addSearch._edits[0].components[0].toJSON().components[0].custom_id;
    assert.ok(selectCustomId.startsWith(`watchlist:addselect:${USER_A_DISCORD}:`));

    // Cross-user protection: User B tries to hijack User A's /watchlist add select menu -> rejected
    const crossSelect: any = {
      customId: selectCustomId,
      values: ['26178'],
      user: { id: USER_B_DISCORD, username: 'beta', avatar: null },
      guildId: 'guild-wl-1',
      channelId: 'ch-wl-1',
      deferred: false,
      replied: false,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => true,
      isRepliable: () => true,
      reply: async (p: any) => {
        crossSelect._reply = p;
      },
    };
    await dispatch(crossSelect);
    assert.ok(crossSelect._reply.embeds[0].toJSON().description.includes('Only the user who ran `/watchlist add`'));
    assert.equal(firestoreWatchlists.get('firebase_uid_alpha')!.length, 1);

    // User A selects Frieren (26178) -> saved to website API & returns updated data
    const ownerSelect: any = {
      customId: selectCustomId,
      values: ['26178'],
      user: { id: USER_A_DISCORD, username: 'alpha', avatar: null },
      guildId: 'guild-wl-1',
      channelId: 'ch-wl-1',
      deferred: false,
      replied: false,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => true,
      isRepliable: () => true,
      deferUpdate: async () => {
        ownerSelect.deferred = true;
      },
      editReply: async (p: any) => {
        ownerSelect._edit = p;
      },
    };
    await dispatch(ownerSelect);
    const addedEmbed = ownerSelect._edit.embeds[0].toJSON();
    assert.ok(addedEmbed.title.includes("Frieren: Beyond Journey's End"));
    assert.ok(addedEmbed.fields.some((f: any) => f.name === 'Status' && f.value.includes('watching')));
    assert.equal(firestoreWatchlists.get('firebase_uid_alpha')!.length, 2);
    // Verify exact website Firestore payload schema (no unsupported titleEnglish, shortId, etc.)
    const lastPostBody = recordedPostBodies[recordedPostBodies.length - 1];
    assert.deepEqual(lastPostBody, {
      discordUserId: USER_A_DISCORD,
      hoshikaId: 26178,
      title: "Frieren: Beyond Journey's End",
      coverImage: 'https://cdn.hoshika.app/covers/anime/26178.webp',
      format: 'TV',
      rating: null,
      seasonYear: 2023,
      status: 'watching',
    });
    assert.equal('titleEnglish' in lastPostBody, false);
    assert.equal('shortId' in lastPostBody, false);
    assert.equal('anilistId' in lastPostBody, false);
    assert.equal('malId' in lastPostBody, false);
    // Verify getEntry returns the created website Firestore record with exact schema fields
    const fetchedEntry = await websiteWatchlist.getEntry(USER_A_DISCORD, 26178);
    assert.equal(fetchedEntry?.shortId, 26178);
    assert.equal(fetchedEntry?.title, "Frieren: Beyond Journey's End");
    assert.equal(fetchedEntry?.poster, 'https://cdn.hoshika.app/covers/anime/26178.webp');
    assert.equal(fetchedEntry?.format, 'TV');
    assert.equal(fetchedEntry?.seasonYear, 2023);
    assert.equal(fetchedEntry?.firebaseUid, 'firebase_uid_alpha');
    // Verify ZERO local SQLite watchlist fallback records exist
    assert.equal(db.listWatchlist(USER_A_DISCORD).length, 0);

    // 3b. Adding a second brand-new anime directly by Hoshika shortId (#90464) creates it cleanly
    const directNewAdd = createSlashInteraction({
      subcommand: 'add',
      userId: USER_A_DISCORD,
      username: 'alpha',
      strings: { anime: '90464', status: 'plan_to_watch' },
    });
    await dispatch(directNewAdd);
    assert.ok(directNewAdd._edits[0].embeds[0].toJSON().title.includes("Frieren: Beyond Journey's End Season 2"));
    assert.equal(firestoreWatchlists.get('firebase_uid_alpha')!.length, 3);
    // Remove #90464 afterwards so stats assertions below remain focused on Naruto + Frieren S1
    const removeSecond = createSlashInteraction({
      subcommand: 'remove',
      userId: USER_A_DISCORD,
      strings: { anime: '90464' },
    });
    await dispatch(removeSecond);
    assert.equal(removeSecond._edits[0].embeds[0].toJSON().title, 'Removed from Watchlist');
    assert.equal(firestoreWatchlists.get('firebase_uid_alpha')!.length, 2);

    // 6. Duplicate prevention: Adding Frieren (#26178) again returns clear "already in watchlist" message (409), NOT 404 not-found
    const dupAdd = createSlashInteraction({
      subcommand: 'add',
      userId: USER_A_DISCORD,
      username: 'alpha',
      strings: { anime: '26178' },
    });
    await dispatch(dupAdd);
    const dupMsg = dupAdd._edits[0].embeds[0].toJSON().description;
    assert.ok(dupMsg.includes('already in your AniScroll website watchlist'));
    assert.equal(dupMsg.includes('was not found'), false);

    // Also test server-side 409 directly via WebsiteWatchlistService
    await assert.rejects(
      () =>
        websiteWatchlist.addEntry(USER_A_DISCORD, {
          shortId: 26178,
          title: "Frieren: Beyond Journey's End",
          status: 'plan_to_watch',
        }),
      (err: any) => err.code === 'DUPLICATE_WATCHLIST'
    );

    // Regression: HTML 404 from wrong route must NEVER map to "That anime was not found in your AniScroll website watchlist."
    simulateHtml404 = true;
    await assert.rejects(
      () =>
        websiteWatchlist.addEntry(USER_A_DISCORD, {
          shortId: 90464,
          title: "Frieren: Beyond Journey's End Season 2",
          status: 'plan_to_watch',
        }),
      (err: any) =>
        err.code === 'WEBSITE_API_UNAVAILABLE' &&
        !err.userMessage.includes('was not found in your AniScroll website watchlist')
    );
    simulateHtml404 = false;

    // 5. Status, Progress, and Rating updates on website record
    const statusUpdate = createSlashInteraction({
      subcommand: 'status',
      userId: USER_A_DISCORD,
      strings: { anime: 'Frieren', status: 'on_hold', notes: 'Waiting for dub' },
    });
    await dispatch(statusUpdate);
    assert.ok(statusUpdate._edits[0].embeds[0].toJSON().title.includes('Status Updated'));
    assert.equal(
      firestoreWatchlists
        .get('firebase_uid_alpha')!
        .find((i) => (i.shortId ?? Number(i.hoshikaId ?? i.id)) === 26178)?.status,
      'on_hold'
    );

    // Progress auto-completion (28/28 -> completed)
    const progressUpdate = createSlashInteraction({
      subcommand: 'progress',
      userId: USER_A_DISCORD,
      strings: { anime: 'Frieren' },
      integers: { episodes: 28 },
    });
    await dispatch(progressUpdate);
    assert.ok(progressUpdate._edits[0].embeds[0].toJSON().title.includes('Series Completed'));
    const frierenRecord = firestoreWatchlists
      .get('firebase_uid_alpha')!
      .find((i) => (i.shortId ?? Number(i.hoshikaId ?? i.id)) === 26178);
    assert.equal(frierenRecord?.episodesWatched, 28);
    assert.equal(frierenRecord?.status, 'completed');

    // /watchlist rate
    const rateUpdate = createSlashInteraction({
      subcommand: 'rate',
      userId: USER_A_DISCORD,
      strings: { anime: 'Frieren' },
      integers: { rating: 10 },
    });
    await dispatch(rateUpdate);
    assert.ok(rateUpdate._edits[0].embeds[0].toJSON().title.includes('Rating Updated'));
    assert.ok(rateUpdate._edits[0].embeds[0].toJSON().description.includes('10/10'));

    // /watchlist search & /watchlist stats from live website records
    const searchWatchlist = createSlashInteraction({
      subcommand: 'search',
      userId: USER_A_DISCORD,
      strings: { query: 'Frieren' },
    });
    await dispatch(searchWatchlist);
    assert.ok(searchWatchlist._edits[0].embeds[0].toJSON().description.includes('Frieren'));
    assert.equal(searchWatchlist._edits[0].embeds[0].toJSON().description.includes('Naruto'), false);

    const statsWatchlist = createSlashInteraction({
      subcommand: 'stats',
      userId: USER_A_DISCORD,
      username: 'alpha',
    });
    await dispatch(statsWatchlist);
    const statsEmbed = statsWatchlist._edits[0].embeds[0].toJSON();
    assert.ok(statsEmbed.description.includes('Total Entries: **2**'));
    assert.ok(statsEmbed.description.includes('Total Episodes Watched: **148**'));
    assert.ok(statsEmbed.fields.some((f: any) => f.name === 'Average Rating' && f.value.includes('9/10')));

    // 7. Cross-user access protection: User B cannot remove or see User A's Naruto (#41391)
    const userBRemoveA = createSlashInteraction({
      subcommand: 'remove',
      userId: USER_B_DISCORD,
      strings: { anime: '41391' },
    });
    await dispatch(userBRemoveA);
    assert.ok(userBRemoveA._edits[0].embeds[0].toJSON().description.includes('No anime matching "41391"'));
    assert.ok(firestoreWatchlists.get('firebase_uid_alpha')!.some((i) => i.shortId === 41391));

    // Reject arbitrary non-snowflake Firebase UIDs from ever being sent as Discord ID
    await assert.rejects(
      () => websiteWatchlist.listWatchlist('firebase_uid_alpha'),
      (err: any) => err.code === 'VALIDATION_ERROR'
    );

    // Reject mismatched discordUserId in server response
    simulateCrossUserLeak = true;
    await assert.rejects(
      () => websiteWatchlist.listWatchlist(USER_A_DISCORD),
      (err: any) => err.code === 'USER_MISSING_PERMISSIONS'
    );
    simulateCrossUserLeak = false;

    // 4. Anime removal: User A deletes Naruto (#41391) from website watchlist
    const removeA = createSlashInteraction({
      subcommand: 'remove',
      userId: USER_A_DISCORD,
      strings: { anime: 'Naruto' },
    });
    await dispatch(removeA);
    assert.equal(removeA._edits[0].embeds[0].toJSON().title, 'Removed from Watchlist');
    assert.equal(firestoreWatchlists.get('firebase_uid_alpha')!.some((i) => i.shortId === 41391), false);

    // 8. Rate limit retry handling + Website API outage (never silently falls back to SQLite)
    simulateRateLimitRemaining = 1;
    const rateLimitedShow = createSlashInteraction({
      subcommand: 'show',
      userId: USER_A_DISCORD,
      username: 'alpha',
    });
    await dispatch(rateLimitedShow);
    assert.ok(rateLimitedShow._edits[0].embeds[0].toJSON().description.includes('Frieren'));

    simulateOutage = true;
    const outageShow = createSlashInteraction({
      subcommand: 'show',
      userId: USER_A_DISCORD,
      username: 'alpha',
    });
    await dispatch(outageShow);
    const outageText = JSON.stringify(outageShow._edits[0]);
    assert.ok(outageText.includes('temporarily unavailable'));
    assert.equal(outageText.includes(BOT_SECRET), false);
    simulateOutage = false;

    // Missing bot secret fails safely without exposing secret or touching SQLite
    const noSecretService = new WebsiteWatchlistService({
      baseUrl: testWebsiteUrl,
      apiSecret: '',
      allowInsecureLocalhost: true,
    });
    await assert.rejects(
      () => noSecretService.listWatchlist(USER_A_DISCORD),
      (err: any) => err.code === 'WEBSITE_API_UNAVAILABLE'
    );

    // 9. Account unlinking / revoked Discord link -> then reconnecting & adding an anime
    revokedLinks.add(USER_A_DISCORD);
    const unlinkedAfterRevoke = createSlashInteraction({
      subcommand: 'show',
      userId: USER_A_DISCORD,
      username: 'alpha',
    });
    await dispatch(unlinkedAfterRevoke);
    assert.equal(
      unlinkedAfterRevoke._edits[0].embeds[0].toJSON().description,
      UNLINKED_DISCORD_MESSAGE
    );

    // Reconnect Discord and add Naruto (#41391) back cleanly
    revokedLinks.delete(USER_A_DISCORD);
    const reconnectedAdd = createSlashInteraction({
      subcommand: 'add',
      userId: USER_A_DISCORD,
      username: 'alpha',
      strings: { anime: '41391', status: 'watching' },
    });
    await dispatch(reconnectedAdd);
    assert.ok(reconnectedAdd._edits[0].embeds[0].toJSON().title.includes('Naruto'));
    assert.ok(
      firestoreWatchlists
        .get('firebase_uid_alpha')!
        .some((i) => (i.shortId ?? Number(i.hoshikaId ?? i.id)) === 41391)
    );

    // Verify all outgoing requests carried valid Bearer auth and exact caller Discord IDs
    assert.ok(recordedRequests.length >= 10);
    assert.ok(recordedRequests.every((r) => r.authHeader === 'valid-bearer'));
    assert.ok(recordedRequests.every((r) => r.path.startsWith('/api/bot/v1/watchlist')));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
