import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { AniScrollDatabase } from '../packages/database/src/db';
import { AppError, ERROR_CODES } from '../packages/shared/src';
import {
  createCharacterEmbed,
  createDailyAnimeEmbed,
  validateHttpsImageUrl,
} from '../packages/discord-ui/src';
import { buildCommandRegistry } from '../apps/bot/src/commands';
import {
  characterSearchSessions,
  cleanupExpiredCharacterSessions,
} from '../apps/bot/src/commands/anime/character';
import { handleInteraction } from '../apps/bot/src/interactions/router';
import { runCommandDeployment } from '../apps/bot/src/scripts/deployCommands';
import { CacheService } from '../apps/bot/src/services/cache/CacheService';
import { AnimeCacheService, AnimeIdentifierService } from '../apps/bot/src/services/hoshika/AnimeCacheService';
import { AnimeSearchService, AnimeService, AniScrollLinkService } from '../apps/bot/src/services/hoshika/AnimeService';
import { CharacterService } from '../apps/bot/src/services/anime/CharacterService';
import {
  DailyAnimeService,
  getZonedDateTimeParts,
  isDailyScheduleDue,
  isValidIanaTimezone,
} from '../apps/bot/src/services/anime/DailyAnimeService';

function createTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aniscroll-char-daily-'));
  return { dir, dbPath: path.join(dir, 'test.db') };
}

function makeFakeInteraction(overrides: Record<string, any> = {}) {
  const replies: any[] = [];
  const edits: any[] = [];
  const updates: any[] = [];
  const followUps: any[] = [];
  const interaction: any = {
    id: `int-${Math.random().toString(36).slice(2, 8)}`,
    user: { id: 'user-1', username: 'Tester', tag: 'Tester#0001' },
    member: {
      permissions: {
        has: (perm: any) => {
          if (Array.isArray(perm)) return perm.every((p) => overrides._perms?.includes(p));
          return Boolean(overrides._perms?.includes(perm));
        },
      },
    },
    guildId: 'guild-1',
    guild: {
      id: 'guild-1',
      name: 'AniScroll Test Guild',
      memberCount: 42,
      members: { me: { id: 'bot-1' } },
      channels: {
        fetch: async (id: string) => overrides._channelMap?.get(id) ?? null,
      },
    },
    channelId: 'chan-1',
    channel: {
      id: 'chan-1',
      send: async (p: any) => ({ id: 'sent-msg-1', ...p }),
      permissionsFor: () => ({ has: () => true }),
    },
    deferred: false,
    replied: false,
    isChatInputCommand: () => overrides.kind === 'command',
    isButton: () => overrides.kind === 'button',
    isStringSelectMenu: () => overrides.kind === 'select',
    isModalSubmit: () => false,
    isRepliable: () => true,
    deferReply: async (opts?: any) => {
      interaction.deferred = true;
      interaction._deferOpts = opts;
    },
    deferUpdate: async () => {
      interaction.deferred = true;
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
    update: async (payload: any) => {
      updates.push(payload);
      return payload;
    },
    followUp: async (payload: any) => {
      followUps.push(payload);
      return payload;
    },
    options: {
      _sub: overrides.sub || null,
      _strings: overrides.strings || {},
      _booleans: overrides.booleans || {},
      _integers: overrides.integers || {},
      _channels: overrides.channels || {},
      getSubcommand: (required?: boolean) => {
        if (overrides.sub) return overrides.sub;
        if (required === false) return null;
        return null;
      },
      getString: (name: string, required?: boolean) => {
        const val = overrides.strings?.[name] ?? null;
        if (required && (val === null || val === undefined)) throw new Error(`Missing string ${name}`);
        return val;
      },
      getBoolean: (name: string) => overrides.booleans?.[name] ?? null,
      getInteger: (name: string) => overrides.integers?.[name] ?? null,
      getChannel: (name: string) => overrides.channels?.[name] ?? null,
    },
    _replies: replies,
    _edits: edits,
    _updates: updates,
    _followUps: followUps,
    ...overrides,
  };
  return interaction;
}

function makeFakeTextChannel(options: {
  id: string;
  guildId?: string;
  isText?: boolean;
  isDM?: boolean;
  perms?: bigint[];
  sendImpl?: (payload: any) => Promise<any>;
}) {
  const permSet = new Set(
    options.perms ?? [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ]
  );
  return {
    id: options.id,
    name: `channel-${options.id}`,
    guildId: options.guildId ?? 'guild-1',
    type: 0,
    isDMBased: () => Boolean(options.isDM),
    isTextBased: () => options.isText !== false,
    permissionsFor: () => ({
      has: (flag: bigint) => permSet.has(flag),
    }),
    send:
      options.sendImpl ||
      (async (payload: any) => ({
        id: `msg-${Math.random().toString(36).slice(2, 8)}`,
        payload,
      })),
  };
}

function createSampleAnime(shortId: number, overrides: Record<string, any> = {}) {
  return {
    id: `hoshika-${shortId}`,
    shortId,
    slug: `anime-${shortId}`,
    titleEnglish: `Test Anime ${shortId}`,
    titleRomaji: `Tesuto Anime ${shortId}`,
    titleJapanese: `テストアニメ ${shortId}`,
    synopsis: `Synopsis for anime ${shortId}.`,
    coverImage: `https://cdn.hoshika.app/poster-${shortId}.jpg`,
    bannerImage: `https://cdn.hoshika.app/banner-${shortId}.jpg`,
    genres: ['Action', 'Fantasy'],
    studios: ['Studio MAPPA'],
    seasonYear: 2024,
    season: 'WINTER',
    format: 'TV',
    status: 'FINISHED',
    episodes: 12,
    episodeDuration: 24,
    averageScore: 86,
  };
}

// =========================================================================
// 1. REGISTRY & DEPLOYMENT VALIDATION
// =========================================================================

test('Command registry includes /character search and /anime daily with no duplicates', async () => {
  const registry = buildCommandRegistry();
  const names = Array.from(registry.keys());
  assert.equal(new Set(names).size, names.length);

  const charCmd = registry.get('character');
  assert.ok(charCmd, 'Expected /character command to be registered');
  const charJson = charCmd.data.toJSON();
  const charSubs = charJson.options || [];
  assert.equal(charSubs.length, 1);
  assert.equal(charSubs[0].name, 'search');
  assert.equal(charSubs[0].options[0].name, 'name');
  assert.equal(charSubs[0].options[0].required, true);

  const animeCmd = registry.get('anime')!;
  const animeSubs = (animeCmd.data.toJSON().options || []).map((o: any) => o.name);
  assert.ok(animeSubs.includes('daily'), 'Expected /anime daily subcommand');
  assert.ok(animeSubs.includes('recommendation'), 'Expected /anime recommendation subcommand');
  assert.ok(animeSubs.includes('search'), 'Expected /anime search subcommand');

  const deployed = await runCommandDeployment();
  assert.ok(deployed.animeSubcommands.includes('daily'));
  assert.ok(deployed.characterSubcommands.includes('search'));
});

// =========================================================================
// 2. CHARACTER SEARCH TESTS
// =========================================================================

test('CharacterService handles exact match, alt/Last-First Hepburn fallback, and ranking', async () => {
  const lookupCalls: string[] = [];
  const fakeClient: any = {
    get: async (url: string, opts?: any) => {
      if (url === '/lookup') {
        const q = String(opts?.params?.q || '');
        lookupCalls.push(q);
        if (q === 'Gojo Satoru') {
          return { ok: true, results: [] };
        }
        if (q === 'Satoru, Gojo') {
          return { ok: true, results: [] };
        }
        if (q === 'Satoru' || q === 'Gojo') {
          return {
            ok: true,
            results: [
              { id: 'char-other', name: 'Satoru Fujinuma', sub: '藤沼悟', image: 'https://cdn.hoshika.app/fujinuma.jpg' },
              { id: 'char-gojo', name: 'Gojou, Satoru', sub: '五条悟', image: 'https://cdn.hoshika.app/gojo.jpg' },
            ],
          };
        }
        return { ok: true, results: [] };
      }
      if (url === '/character/char-gojo') {
        return {
          ok: true,
          character: {
            id: 'char-gojo',
            name: 'Satoru Gojo',
            nameJapanese: '五条悟',
            avatarUrl: 'https://cdn.hoshika.app/gojo-full.jpg',
            description: 'Strongest sorcerer. ~!Sealed in Prison Realm.!~',
            gender: 'Male',
            age: '28',
          },
          seiyuu: [{ id: 'va-1', name: 'Yuuichi Nakamura', language: 'Japanese' }],
          appearances: {
            anime: [
              { shortId: 113415, slug: 'jujutsu-kaisen', title: 'JUJUTSU KAISEN', role: 'MAIN' },
            ],
          },
        };
      }
      throw new Error(`Unexpected Hoshika URL ${url}`);
    },
  };

  const cache = new CacheService(undefined);
  const animeCache = new AnimeCacheService(cache);
  const charService = new CharacterService(fakeClient, animeCache);

  const { results } = await charService.searchCharacters('Gojo Satoru', 'en');
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'char-gojo', 'Gojou, Satoru should rank above Satoru Fujinuma for Gojo Satoru');
  assert.equal(results[0].name, 'Satoru Gojo');
  assert.equal(results[0].nativeName, '五条悟');
  assert.ok(results[0].description?.includes('||Sealed in Prison Realm.||'));
  assert.equal(results[0].gender, 'Male');
  assert.equal(results[0].age, '28');
  assert.equal(results[0].voiceActors?.[0]?.name, 'Yuuichi Nakamura');
  assert.equal(results[0].appearances[0].aniscrollUrl, 'https://aniscroll.in/anime/113415');
  assert.ok(lookupCalls.includes('Gojo Satoru'));
  assert.ok(lookupCalls.includes('Gojo') || lookupCalls.includes('Satoru'));

  // Empty query rejected cleanly
  await assert.rejects(
    () => charService.searchCharacters('   ', 'en'),
    (err: any) => err instanceof AppError && err.code === ERROR_CODES.VALIDATION_ERROR
  );
});

test('Character embed handles missing image, invalid HTTP image, and missing biography gracefully', () => {
  assert.equal(validateHttpsImageUrl('http://insecure.example/img.png'), null);
  assert.equal(validateHttpsImageUrl('not-a-url'), null);
  assert.equal(validateHttpsImageUrl('https://cdn.hoshika.app/ok.png'), 'https://cdn.hoshika.app/ok.png');

  const embed = createCharacterEmbed({
    id: 'c-min',
    name: 'Minimal Character',
    nativeName: null,
    alternativeNames: [],
    image: 'http://invalid-non-https.example/a.png',
    description: null,
    appearances: [],
  });

  const json = embed.toJSON();
  assert.equal(json.title, 'Minimal Character');
  assert.equal(json.thumbnail, undefined);
  assert.equal(json.description, 'Biography is not available for this character.');
  assert.equal(json.fields, undefined);
});

test('/character search pagination, select menu, ownership, and expiration lifecycle', async () => {
  characterSearchSessions.clear();
  const { dir, dbPath } = createTempDbPath();
  const db = new AniScrollDatabase(dbPath);
  const cache = new CacheService(undefined);
  const animeCache = new AnimeCacheService(cache);

  const fakeClient: any = {
    get: async (url: string) => {
      if (url === '/lookup') {
        return {
          ok: true,
          results: [
            { id: 'c1', name: 'Rem', sub: 'レム', image: 'https://cdn.hoshika.app/rem.jpg' },
            { id: 'c2', name: 'Ram', sub: 'ラム', image: 'https://cdn.hoshika.app/ram.jpg' },
          ],
        };
      }
      if (url === '/character/c1') {
        return {
          ok: true,
          character: { id: 'c1', name: 'Rem', nameJapanese: 'レム', description: 'Maid of Roswaal mansion.' },
          appearances: { anime: [{ shortId: 21355, title: 'Re:ZERO', role: 'MAIN' }] },
        };
      }
      if (url === '/character/c2') {
        return {
          ok: true,
          character: { id: 'c2', name: 'Ram', nameJapanese: 'ラム', description: 'Twin sister of Rem.' },
          appearances: { anime: [{ shortId: 21355, title: 'Re:ZERO', role: 'SUPPORTING' }] },
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  };

  const charService = new CharacterService(fakeClient, animeCache);
  const animeService = new AnimeService(
    fakeClient,
    animeCache,
    new AnimeIdentifierService(),
    new AnimeSearchService(fakeClient, animeCache, new AnimeIdentifierService()),
    new AniScrollLinkService()
  );

  const ctx: any = {
    db,
    cache,
    animeService,
    characterService: charService,
    musicService: {} as any,
    websiteWatchlist: {} as any,
    maintenanceMode: false,
    setMaintenanceMode: () => {},
    reloadCommands: async () => 0,
  };
  const commands = buildCommandRegistry();

  // 1. Run /character search
  const searchInt = makeFakeInteraction({
    kind: 'command',
    commandName: 'character',
    sub: 'search',
    strings: { name: 'Rem' },
  });
  await handleInteraction(searchInt, commands, ctx);
  assert.equal(searchInt._edits.length, 1);
  assert.equal(searchInt._edits[0].embeds[0].toJSON().title, 'Rem');

  const btnRow = searchInt._edits[0].components[0].toJSON();
  const nextCustomId = btnRow.components[1].custom_id as string;
  const selectCustomId = searchInt._edits[0].components[1].toJSON().components[0].custom_id as string;
  assert.equal(btnRow.components[0].disabled, true, 'Previous button should be disabled on page 1');
  assert.equal(btnRow.components[1].disabled, false, 'Next button should be enabled');
  assert.equal(btnRow.components[2].label, 'Open Anime');
  assert.equal(btnRow.components[2].url, 'https://aniscroll.in/anime/21355');

  // 2. Unauthorized user blocked from pagination
  const intruderBtn = makeFakeInteraction({
    kind: 'button',
    customId: nextCustomId,
    user: { id: 'intruder-99', username: 'Intruder' },
  });
  await handleInteraction(intruderBtn, commands, ctx);
  assert.ok(intruderBtn._replies[0].embeds[0].toJSON().description.includes('Only the user who ran `/character search`'));

  // 3. Owner clicks Next -> lazy hydration of c2
  const nextBtn = makeFakeInteraction({
    kind: 'button',
    customId: nextCustomId,
  });
  await handleInteraction(nextBtn, commands, ctx);
  assert.equal(nextBtn._edits.length, 1);
  assert.equal(nextBtn._edits[0].embeds[0].toJSON().title, 'Ram');
  assert.ok(nextBtn._edits[0].embeds[0].toJSON().footer.text.includes('Result 2 of 2'));

  // 4. Owner selects index 0 from select menu -> switches back to Rem
  const selectInt = makeFakeInteraction({
    kind: 'select',
    customId: selectCustomId,
    values: ['0'],
  });
  await handleInteraction(selectInt, commands, ctx);
  assert.equal(selectInt._edits[0].embeds[0].toJSON().title, 'Rem');

  // 5. Expired session returns clean expired error
  for (const s of characterSearchSessions.values()) {
    s.expiresAt = Date.now() - 1000;
  }
  const expiredBtn = makeFakeInteraction({
    kind: 'button',
    customId: nextCustomId,
  });
  await handleInteraction(expiredBtn, commands, ctx);
  assert.ok(expiredBtn._replies[0].embeds[0].toJSON().description.includes('expired'));
  cleanupExpiredCharacterSessions();
  assert.equal(characterSearchSessions.size, 0);

  db.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('/character search handles no results and Hoshika rate limit / unavailability gracefully', async () => {
  const { dir, dbPath } = createTempDbPath();
  const db = new AniScrollDatabase(dbPath);
  const cache = new CacheService(undefined);
  const animeCache = new AnimeCacheService(cache);
  let mode: 'empty' | 'error' = 'empty';

  const fakeClient: any = {
    get: async () => {
      if (mode === 'error') {
        throw new AppError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Hoshika rate limit reached. Try again shortly.', 429);
      }
      return { ok: true, results: [] };
    },
  };

  const charService = new CharacterService(fakeClient, animeCache);
  const animeService = new AnimeService(
    fakeClient,
    animeCache,
    new AnimeIdentifierService(),
    new AnimeSearchService(fakeClient, animeCache, new AnimeIdentifierService()),
    new AniScrollLinkService()
  );
  const ctx: any = {
    db,
    cache,
    animeService,
    characterService: charService,
    musicService: {} as any,
    websiteWatchlist: {} as any,
    maintenanceMode: false,
    setMaintenanceMode: () => {},
    reloadCommands: async () => 0,
  };
  const commands = buildCommandRegistry();

  const emptyInt = makeFakeInteraction({
    kind: 'command',
    commandName: 'character',
    sub: 'search',
    strings: { name: 'NonexistentCharacterXYZ' },
  });
  await handleInteraction(emptyInt, commands, ctx);
  assert.equal(emptyInt._edits[0].embeds[0].toJSON().title, 'Character Not Found');

  mode = 'error';
  const errInt = makeFakeInteraction({
    kind: 'command',
    commandName: 'character',
    sub: 'search',
    user: { id: 'user-2', username: 'Tester2' },
    strings: { name: 'OtherQuery' },
  });
  await handleInteraction(errInt, commands, ctx);
  assert.ok(errInt._edits[0].embeds[0].toJSON().description.includes('rate limit'));

  db.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// 3. DAILY ANIME SELECTION, HISTORY, TIMEZONES & SCHEDULER TESTS
// =========================================================================

test('DailyAnimeService selects randomly, excludes 30-day history, falls back when exhausted, and persists per guild', async () => {
  const { dir, dbPath } = createTempDbPath();
  const db = new AniScrollDatabase(dbPath);
  const cache = new CacheService(undefined);
  const animeCache = new AnimeCacheService(cache);
  const identifiers = new AnimeIdentifierService();

  const pool = [createSampleAnime(101), createSampleAnime(102), createSampleAnime(103)];
  const fakeClient: any = {
    get: async (url: string) => {
      if (url === '/browse') return { ok: true, items: pool };
      const match = url.match(/^\/anime\/(\d+)$/);
      if (match) {
        const sid = Number(match[1]);
        const found = pool.find((a) => a.shortId === sid);
        return { ok: true, anime: found };
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  };

  const searchService = new AnimeSearchService(fakeClient, animeCache, identifiers);
  const animeService = new AnimeService(fakeClient, animeCache, identifiers, searchService, new AniScrollLinkService(searchService));

  // Use RNG returning 0.9 so it picks index 2 (not index 0)
  const dailyService = new DailyAnimeService(db, animeService, () => 0.9);

  const resA = await dailyService.getOrCreateDailyRecommendation('guild-A', 'en', { dateKey: '2026-05-01' });
  assert.equal(resA.isNew, true);
  assert.equal(resA.record.hoshikaShortId, 103);

  // Same guild + same date returns persisted selection without re-rolling
  const resA2 = await dailyService.getOrCreateDailyRecommendation('guild-A', 'en', { dateKey: '2026-05-01' });
  assert.equal(resA2.isNew, false);
  assert.equal(resA2.record.hoshikaShortId, 103);

  // Next day excludes 103 (30-day history) and picks from [101, 102]
  const resANextDay = await dailyService.getOrCreateDailyRecommendation('guild-A', 'en', { dateKey: '2026-05-02' });
  assert.equal(resANextDay.isNew, true);
  assert.notEqual(resANextDay.record.hoshikaShortId, 103);

  // Day 3 excludes 103 & 102 -> picks remaining 101
  const resADay3 = await dailyService.getOrCreateDailyRecommendation('guild-A', 'en', { dateKey: '2026-05-03' });
  assert.equal(resADay3.record.hoshikaShortId, 101);

  // Day 4: all 3 in 30-day history -> falls back cleanly instead of throwing
  const resADay4 = await dailyService.getOrCreateDailyRecommendation('guild-A', 'en', { dateKey: '2026-05-04' });
  assert.ok([101, 102, 103].includes(resADay4.record.hoshikaShortId));

  // Guild B is completely independent of Guild A's 30-day history
  const resB = await dailyService.getOrCreateDailyRecommendation('guild-B', 'en', { dateKey: '2026-05-01' });
  assert.equal(resB.isNew, true);
  assert.equal(resB.record.hoshikaShortId, 103);

  // Verify persistence across DB re-open (simulated restart)
  db.sqlite.close();
  const reopenedDb = new AniScrollDatabase(dbPath);
  const persisted = reopenedDb.getDailyAnimeForDate('guild-A', '2026-05-01');
  assert.ok(persisted);
  assert.equal(persisted.hoshikaShortId, 103);

  reopenedDb.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Timezone validation and schedule evaluation across IANA timezones', () => {
  assert.equal(isValidIanaTimezone('Asia/Kolkata'), true);
  assert.equal(isValidIanaTimezone('America/New_York'), true);
  assert.equal(isValidIanaTimezone('UTC'), true);
  assert.equal(isValidIanaTimezone('Mars/OlympusMons'), false);
  assert.equal(isValidIanaTimezone(''), false);

  // 2026-05-10T03:30:00Z is 09:00 in Asia/Kolkata (+05:30)
  const utcAt9amIst = new Date('2026-05-10T03:30:00.000Z');
  const istParts = getZonedDateTimeParts(utcAt9amIst, 'Asia/Kolkata');
  assert.equal(istParts.dateKey, '2026-05-10');
  assert.equal(istParts.hour, 9);
  assert.equal(istParts.minute, 0);

  assert.equal(
    isDailyScheduleDue(utcAt9amIst, {
      enabled: true,
      channelId: 'c1',
      hour: 9,
      minute: 0,
      timezone: 'Asia/Kolkata',
    }).due,
    true
  );

  // 08:59 IST should NOT be due for 09:00 IST
  const utcAt859Ist = new Date('2026-05-10T03:29:00.000Z');
  assert.equal(
    isDailyScheduleDue(utcAt859Ist, {
      enabled: true,
      channelId: 'c1',
      hour: 9,
      minute: 0,
      timezone: 'Asia/Kolkata',
    }).due,
    false
  );

  // Disabled config should never be due
  assert.equal(
    isDailyScheduleDue(utcAt9amIst, {
      enabled: false,
      channelId: 'c1',
      hour: 9,
      minute: 0,
      timezone: 'Asia/Kolkata',
    }).due,
    false
  );
});

test('createDailyAnimeEmbed prefers banner, falls back to poster, omits invalid URLs, and excludes streaming', () => {
  const withBanner = createDailyAnimeEmbed(
    {
      hoshikaId: 'h1',
      shortId: 500,
      slug: 'sample',
      aniscrollUrl: 'https://aniscroll.in/anime/500',
      titleEnglish: 'Frieren',
      titleRomaji: 'Sousou no Frieren',
      alternativeTitles: [],
      synopsis: 'Journey beyond the end.',
      banner: 'https://cdn.hoshika.app/banner.jpg',
      poster: 'https://cdn.hoshika.app/poster.jpg',
      genres: ['Adventure', 'Drama'],
      studios: ['Madhouse'],
      releaseYear: 2023,
      type: 'TV',
      status: 'FINISHED',
      totalEpisodes: 28,
      rating: 91,
      relations: [],
      recommendations: [],
    },
    { aniscrollUrl: 'https://aniscroll.in/anime/500' }
  ).toJSON();

  assert.equal(withBanner.title, "✨ HAIMIYA'S DAILY ANIME");
  assert.equal(withBanner.footer?.text, 'Haimiya Senpaiz • Daily Anime');
  assert.equal(withBanner.image?.url, 'https://cdn.hoshika.app/banner.jpg');
  assert.equal(withBanner.thumbnail?.url, 'https://cdn.hoshika.app/poster.jpg');
  assert.ok(!JSON.stringify(withBanner).toLowerCase().includes('crunchyroll'));

  const posterFallback = createDailyAnimeEmbed({
    hoshikaId: 'h2',
    shortId: 501,
    slug: 'sample2',
    titleEnglish: 'Solo Poster',
    alternativeTitles: [],
    banner: null,
    poster: 'https://cdn.hoshika.app/only-poster.jpg',
    genres: [],
    studios: [],
    relations: [],
    recommendations: [],
  }).toJSON();

  assert.equal(posterFallback.image?.url, 'https://cdn.hoshika.app/only-poster.jpg');
  assert.equal(posterFallback.thumbnail, undefined);

  const noImages = createDailyAnimeEmbed({
    hoshikaId: 'h3',
    shortId: 502,
    slug: 'sample3',
    titleEnglish: 'No Images',
    alternativeTitles: [],
    banner: 'http://insecure/b.jpg',
    poster: '',
    genres: [],
    studios: [],
    relations: [],
    recommendations: [],
  }).toJSON();

  assert.equal(noImages.image, undefined);
  assert.equal(noImages.thumbnail, undefined);
});

test('/anime daily works ephemerally in guild and DM, and Refresh enforces ownership, permissions & cooldown', async () => {
  const { dir, dbPath } = createTempDbPath();
  const db = new AniScrollDatabase(dbPath);
  const cache = new CacheService(undefined);
  const animeCache = new AnimeCacheService(cache);
  const identifiers = new AnimeIdentifierService();

  const pool = [createSampleAnime(201), createSampleAnime(202), createSampleAnime(203)];
  const fakeClient: any = {
    get: async (url: string) => {
      if (url === '/browse') return { ok: true, items: pool };
      const match = url.match(/^\/anime\/(\d+)$/);
      if (match) return { ok: true, anime: pool.find((a) => a.shortId === Number(match[1])) };
      throw new Error(`Unexpected URL ${url}`);
    },
  };

  const searchService = new AnimeSearchService(fakeClient, animeCache, identifiers);
  const animeService = new AnimeService(fakeClient, animeCache, identifiers, searchService, new AniScrollLinkService(searchService));
  let pickIdx = 0;
  const dailyService = new DailyAnimeService(db, animeService, () => {
    const val = (pickIdx % 3) * 0.34;
    pickIdx++;
    return val;
  });

  const ctx: any = {
    db,
    cache,
    animeService,
    dailyAnimeService: dailyService,
    musicService: {} as any,
    websiteWatchlist: {} as any,
    maintenanceMode: false,
    setMaintenanceMode: () => {},
    reloadCommands: async () => 0,
  };
  const commands = buildCommandRegistry();

  // 1. DM execution (/anime daily with guildId = null)
  const dmInt = makeFakeInteraction({
    kind: 'command',
    commandName: 'anime',
    sub: 'daily',
    guildId: null,
    guild: null,
  });
  await handleInteraction(dmInt, commands, ctx);
  assert.equal(dmInt._deferOpts?.ephemeral, true);
  assert.equal(dmInt._edits.length, 1);
  assert.equal(dmInt._edits[0].embeds[0].toJSON().title, "✨ HAIMIYA'S DAILY ANIME");

  const dmButtons = dmInt._edits[0].components[0].toJSON().components;
  assert.equal(dmButtons[0].label, 'Add to Watchlist');
  assert.ok(dmButtons[0].custom_id.startsWith('watchlist:recadd:'));
  assert.equal(dmButtons[1].label, 'View Anime');
  assert.ok(dmButtons[1].url.startsWith('https://aniscroll.in/anime/'));
  assert.equal(dmButtons[2].label, 'Refresh');
  assert.ok(dmButtons[2].custom_id.startsWith('daily:refresh:manual:global:user-1'));

  // 2. Non-owner blocked from refreshing manual card
  const intruderRefresh = makeFakeInteraction({
    kind: 'button',
    customId: dmButtons[2].custom_id,
    user: { id: 'other-user', username: 'Other' },
  });
  await handleInteraction(intruderRefresh, commands, ctx);
  assert.ok(intruderRefresh._replies[0].embeds[0].toJSON().description.includes('Only the user who requested'));

  // 3. Owner refreshes manual card -> succeeds first time, cooldown blocks immediate second click
  const ownerRefresh = makeFakeInteraction({
    kind: 'button',
    customId: dmButtons[2].custom_id,
  });
  await handleInteraction(ownerRefresh, commands, ctx);
  assert.equal(ownerRefresh._edits.length, 1);

  const ownerRefreshFast = makeFakeInteraction({
    kind: 'button',
    customId: dmButtons[2].custom_id,
  });
  await handleInteraction(ownerRefreshFast, commands, ctx);
  assert.ok(ownerRefreshFast._replies[0].embeds[0].toJSON().description.includes('wait'));

  // 4. Public Refresh button requires ManageGuild permission
  const publicNonAdmin = makeFakeInteraction({
    kind: 'button',
    customId: 'daily:refresh:public:guild-1:2026-05-10',
    _perms: [],
  });
  await handleInteraction(publicNonAdmin, commands, ctx);
  assert.ok(publicNonAdmin._replies[0].embeds[0].toJSON().description.includes('Manage Server'));

  const publicAdmin = makeFakeInteraction({
    kind: 'button',
    customId: 'daily:refresh:public:guild-1:2026-05-10',
    _perms: [PermissionFlagsBits.ManageGuild],
  });
  await handleInteraction(publicAdmin, commands, ctx);
  assert.equal(publicAdmin._edits.length, 1);

  db.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('/config anime validates permissions, timezone, channel, and runs test post', async () => {
  const { dir, dbPath } = createTempDbPath();
  const db = new AniScrollDatabase(dbPath);
  const cache = new CacheService(undefined);
  const animeCache = new AnimeCacheService(cache);
  const identifiers = new AnimeIdentifierService();
  const pool = [createSampleAnime(301)];
  const fakeClient: any = {
    get: async (url: string) => {
      if (url === '/browse') return { ok: true, items: pool };
      return { ok: true, anime: pool[0] };
    },
  };
  const searchService = new AnimeSearchService(fakeClient, animeCache, identifiers);
  const animeService = new AnimeService(fakeClient, animeCache, identifiers, searchService, new AniScrollLinkService(searchService));
  const dailyService = new DailyAnimeService(db, animeService);

  const sentPayloads: any[] = [];
  const validChannel = makeFakeTextChannel({
    id: 'daily-chan-1',
    guildId: 'guild-1',
    sendImpl: async (p) => {
      sentPayloads.push(p);
      return { id: 'test-msg-99' };
    },
  });
  const missingPermChannel = makeFakeTextChannel({
    id: 'daily-chan-noperm',
    guildId: 'guild-1',
    perms: [PermissionFlagsBits.ViewChannel], // missing SendMessages & EmbedLinks
  });
  const otherGuildChannel = makeFakeTextChannel({
    id: 'daily-chan-other',
    guildId: 'guild-999',
  });
  const channelMap = new Map<string, any>([
    ['daily-chan-1', validChannel],
    ['daily-chan-noperm', missingPermChannel],
    ['daily-chan-other', otherGuildChannel],
  ]);

  const fakeDiscordClient: any = {
    guilds: {
      cache: new Map([
        [
          'guild-1',
          {
            id: 'guild-1',
            name: 'Guild One',
            members: { me: { id: 'bot-1' } },
            channels: { fetch: async (id: string) => channelMap.get(id) ?? null },
          },
        ],
      ]),
    },
  };

  const ctx: any = {
    db,
    cache,
    animeService,
    dailyAnimeService: dailyService,
    musicService: {} as any,
    websiteWatchlist: {} as any,
    maintenanceMode: false,
    setMaintenanceMode: () => {},
    reloadCommands: async () => 0,
  };
  const commands = buildCommandRegistry();

  // 1. Non-admin rejected
  const nonAdminInt = makeFakeInteraction({
    kind: 'command',
    commandName: 'config',
    sub: 'anime',
    _perms: [],
  });
  await handleInteraction(nonAdminInt, commands, ctx);
  assert.ok(nonAdminInt._replies[0].embeds[0].toJSON().description.includes('permissions'));

  // 2. View mode (no options) returns current settings
  const viewInt = makeFakeInteraction({
    kind: 'command',
    commandName: 'config',
    sub: 'anime',
    user: { id: 'admin-view', username: 'AdminView' },
    _perms: [PermissionFlagsBits.ManageGuild],
  });
  await handleInteraction(viewInt, commands, ctx);
  assert.ok(viewInt._replies[0].embeds[0].toJSON().title.includes('Anime & Daily Anime Configuration'));

  // 3. Invalid timezone rejected
  const badTzInt = makeFakeInteraction({
    kind: 'command',
    commandName: 'config',
    sub: 'anime',
    user: { id: 'admin-tz', username: 'AdminTz' },
    _perms: [PermissionFlagsBits.ManageGuild],
    strings: { daily_timezone: 'Invalid/Timezone' },
  });
  await handleInteraction(badTzInt, commands, ctx);
  assert.ok(badTzInt._replies[0].embeds[0].toJSON().description.includes('Invalid IANA timezone'));

  // 4. Missing bot permissions channel rejected
  const noPermChanInt = makeFakeInteraction({
    kind: 'command',
    commandName: 'config',
    sub: 'anime',
    user: { id: 'admin-perm', username: 'AdminPerm' },
    _perms: [PermissionFlagsBits.ManageGuild],
    booleans: { daily_enabled: true },
    channels: { daily_channel: { id: 'daily-chan-noperm' } },
    _channelMap: channelMap,
  });
  await handleInteraction(noPermChanInt, commands, ctx);
  assert.ok(noPermChanInt._replies[0].embeds[0].toJSON().description.includes('missing required permissions'));

  // 5. Cross-guild channel rejected
  const crossGuildInt = makeFakeInteraction({
    kind: 'command',
    commandName: 'config',
    sub: 'anime',
    user: { id: 'admin-cross', username: 'AdminCross' },
    _perms: [PermissionFlagsBits.ManageGuild],
    booleans: { daily_enabled: true },
    channels: { daily_channel: { id: 'daily-chan-other' } },
    _channelMap: channelMap,
  });
  await handleInteraction(crossGuildInt, commands, ctx);
  assert.ok(crossGuildInt._replies[0].embeds[0].toJSON().description.includes('does not belong'));

  // 6. Valid config save + live test post
  const saveAndTestInt = makeFakeInteraction({
    kind: 'command',
    commandName: 'config',
    sub: 'anime',
    user: { id: 'admin-save', username: 'AdminSave' },
    _perms: [PermissionFlagsBits.ManageGuild],
    booleans: { daily_enabled: true, test_post: true },
    integers: { daily_hour: 10, daily_minute: 30 },
    strings: { daily_timezone: 'Asia/Kolkata' },
    channels: { daily_channel: { id: 'daily-chan-1' } },
    _channelMap: channelMap,
    client: fakeDiscordClient,
  });
  await handleInteraction(saveAndTestInt, commands, ctx);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].embeds[0].toJSON().title, "✨ HAIMIYA'S DAILY ANIME");
  assert.ok(saveAndTestInt._edits[0].embeds[0].toJSON().description.includes('Test post sent'));

  const savedCfg = db.getDailyAnimeConfig('guild-1');
  assert.equal(savedCfg.enabled, true);
  assert.equal(savedCfg.channelId, 'daily-chan-1');
  assert.equal(savedCfg.hour, 10);
  assert.equal(savedCfg.minute, 30);
  assert.equal(savedCfg.timezone, 'Asia/Kolkata');

  db.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Automatic scheduler posts once per guild/day, survives 30s ticks & restarts, and isolates per-guild failures', async () => {
  const { dir, dbPath } = createTempDbPath();
  const db = new AniScrollDatabase(dbPath);
  const cache = new CacheService(undefined);
  const animeCache = new AnimeCacheService(cache);
  const identifiers = new AnimeIdentifierService();
  const pool = [createSampleAnime(401), createSampleAnime(402)];

  const fakeClient: any = {
    get: async (url: string) => {
      if (url === '/browse') return { ok: true, items: pool };
      const sid = Number(url.split('/').pop());
      return { ok: true, anime: pool.find((a) => a.shortId === sid) };
    },
  };
  const searchService = new AnimeSearchService(fakeClient, animeCache, identifiers);
  const animeService = new AnimeService(fakeClient, animeCache, identifiers, searchService, new AniScrollLinkService(searchService));
  const dailyService = new DailyAnimeService(db, animeService);

  const okSends: any[] = [];
  let failSend = true;
  const okChannel = makeFakeTextChannel({
    id: 'ch-ok',
    guildId: 'guild-ok',
    sendImpl: async (p) => {
      okSends.push(p);
      return { id: `ok-msg-${okSends.length}` };
    },
  });
  const flakyChannel = makeFakeTextChannel({
    id: 'ch-flaky',
    guildId: 'guild-flaky',
    sendImpl: async (p) => {
      if (failSend) throw new Error('Discord 50013 Missing Permissions');
      return { id: 'flaky-recovered-msg', p };
    },
  });

  db.upsertDailyAnimeConfig('guild-ok', {
    enabled: true,
    channelId: 'ch-ok',
    hour: 9,
    minute: 0,
    timezone: 'UTC',
  });
  db.upsertDailyAnimeConfig('guild-flaky', {
    enabled: true,
    channelId: 'ch-flaky',
    hour: 9,
    minute: 0,
    timezone: 'UTC',
  });
  db.upsertDailyAnimeConfig('guild-disabled', {
    enabled: false,
    channelId: 'ch-dis',
    hour: 9,
    minute: 0,
    timezone: 'UTC',
  });

  const mockDiscordClient: any = {
    guilds: {
      cache: new Map([
        ['guild-ok', { id: 'guild-ok', members: { me: { id: 'bot' } }, channels: { fetch: async () => okChannel } }],
        ['guild-flaky', { id: 'guild-flaky', members: { me: { id: 'bot' } }, channels: { fetch: async () => flakyChannel } }],
      ]),
    },
  };

  // Before due time (08:59 UTC): nothing posted
  const beforeDue = new Date('2026-06-01T08:59:00.000Z');
  await dailyService.processDueGuilds(mockDiscordClient, beforeDue);
  assert.equal(okSends.length, 0);

  // At due time (09:00 UTC): guild-ok posts, guild-flaky marks FAILED without blocking guild-ok
  const atDue = new Date('2026-06-01T09:00:00.000Z');
  const tick1 = await dailyService.processDueGuilds(mockDiscordClient, atDue);
  assert.equal(okSends.length, 1);
  assert.equal(tick1.find((r) => r.guildId === 'guild-ok')?.ok, true);
  assert.equal(tick1.find((r) => r.guildId === 'guild-flaky')?.ok, false);
  assert.equal(db.getDailyAnimeForDate('guild-ok', '2026-06-01')?.status, 'POSTED');
  assert.equal(db.getDailyAnimeForDate('guild-flaky', '2026-06-01')?.status, 'FAILED');

  // Subsequent 30s tick: guild-ok must NOT post duplicate; guild-flaky recovers when permission is restored
  failSend = false;
  const tick2Time = new Date('2026-06-01T09:00:30.000Z');
  await dailyService.processDueGuilds(mockDiscordClient, tick2Time);
  assert.equal(okSends.length, 1, 'guild-ok must not post twice on same day');
  assert.equal(db.getDailyAnimeForDate('guild-flaky', '2026-06-01')?.status, 'POSTED');

  // Simulate process restart later the same day: still must NOT post duplicate
  db.sqlite.close();
  const restartedDb = new AniScrollDatabase(dbPath);
  const restartedDaily = new DailyAnimeService(restartedDb, animeService);
  await restartedDaily.processDueGuilds(mockDiscordClient, new Date('2026-06-01T14:00:00.000Z'));
  assert.equal(okSends.length, 1, 'guild-ok must not duplicate after bot restart');

  restartedDb.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
