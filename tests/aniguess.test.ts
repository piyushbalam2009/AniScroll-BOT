import test from 'node:test';
import assert from 'node:assert/strict';
import { AniScrollDatabase } from '../packages/database/src/db';
import { BRAND_THEME } from '../packages/shared/src';
import { getAniGuessTierMessage } from '../packages/discord-ui/src';
import { buildCommandRegistry } from '../apps/bot/src/commands';
import { aniguessCommand } from '../apps/bot/src/commands/anime/aniguess';
import { handleInteraction } from '../apps/bot/src/interactions/router';
import { CacheService } from '../apps/bot/src/services/cache/CacheService';
import { AnimeCacheService, AnimeIdentifierService } from '../apps/bot/src/services/hoshika/AnimeCacheService';
import { HoshikaClient } from '../apps/bot/src/services/hoshika/HoshikaClient';
import { AnimeSearchService, AnimeService } from '../apps/bot/src/services/hoshika/AnimeService';
import {
  AniGuessService,
  extractAcceptedCharacterNames,
  extractGuessContentFromMessage,
  isAniGuessAnswerCorrect,
  normalizeAniGuessText,
} from '../apps/bot/src/services/anime/AniGuessService';

interface FixtureEntry {
  anime: {
    id: string;
    shortId: number;
    slug: string;
    titleRomaji: string;
    titleEnglish: string;
    titleJapanese?: string;
    coverImage: string;
    bannerImage?: string;
    format: string;
    averageScore: number;
    characters: Array<{
      id: string;
      name: string;
      role: string;
      avatar: string | null;
    }>;
  };
  characterDetail: {
    id: string;
    name: string;
    nameJapanese?: string;
    avatarUrl: string | null;
    alternativeNames?: string[];
  };
}

const FIXTURE_CHARACTER_POOL: FixtureEntry[] = [
  {
    anime: {
      id: 'a-1',
      shortId: 26178,
      slug: 'frieren-beyond-journeys-end',
      titleRomaji: 'Sousou no Frieren',
      titleEnglish: "Frieren: Beyond Journey's End",
      coverImage: 'https://cdn.hoshika.app/covers/anime/a-1.webp',
      bannerImage: 'https://cdn.hoshika.app/banners/anime/a-1.webp',
      format: 'TV',
      averageScore: 92,
      characters: [
        {
          id: 'ch-1',
          name: 'Frieren',
          role: 'MAIN',
          avatar: 'https://cdn.hoshika.app/catalog/characters/184947.webp?v=2',
        },
      ],
    },
    characterDetail: {
      id: 'ch-1',
      name: 'Frieren',
      nameJapanese: 'フリーレン',
      avatarUrl: 'https://cdn.hoshika.app/catalog/characters/184947.webp?v=2',
    },
  },
  {
    anime: {
      id: 'a-2',
      shortId: 41391,
      slug: 'naruto',
      titleRomaji: 'Naruto',
      titleEnglish: 'Naruto',
      coverImage: 'https://cdn.hoshika.app/covers/anime/a-2.webp',
      format: 'TV',
      averageScore: 81,
      characters: [
        {
          id: 'ch-2',
          name: 'Uzumaki, Naruto',
          role: 'MAIN',
          avatar: 'https://cdn.hoshika.app/catalog/characters/17.webp?v=2',
        },
      ],
    },
    characterDetail: {
      id: 'ch-2',
      name: 'Naruto Uzumaki',
      nameJapanese: 'うずまきナルト',
      avatarUrl: 'https://cdn.hoshika.app/catalog/characters/17.webp?v=2',
    },
  },
  {
    anime: {
      id: 'a-3',
      shortId: 58090,
      slug: 'one-piece',
      titleRomaji: 'One Piece',
      titleEnglish: 'One Piece',
      coverImage: 'https://cdn.hoshika.app/covers/anime/a-3.webp',
      format: 'TV',
      averageScore: 88,
      characters: [
        {
          id: 'ch-3',
          name: 'Monkey, D. Luffy',
          role: 'MAIN',
          avatar: 'https://cdn.hoshika.app/catalog/characters/40.webp?v=2',
        },
      ],
    },
    characterDetail: {
      id: 'ch-3',
      name: 'Monkey D. Luffy',
      nameJapanese: 'モンキー・D・ルフィ',
      avatarUrl: 'https://cdn.hoshika.app/catalog/characters/40.webp?v=2',
    },
  },
  {
    anime: {
      id: 'a-4',
      shortId: 13566,
      slug: 'fmab',
      titleRomaji: 'Hagane no Renkinjutsushi',
      titleEnglish: 'Fullmetal Alchemist: Brotherhood',
      coverImage: 'https://cdn.hoshika.app/covers/anime/a-4.webp',
      format: 'TV',
      averageScore: 91,
      characters: [
        {
          id: 'ch-4',
          name: 'Elric, Alphonse',
          role: 'MAIN',
          avatar: 'https://cdn.hoshika.app/catalog/characters/12.webp?v=2',
        },
      ],
    },
    characterDetail: {
      id: 'ch-4',
      name: 'Alphonse Elric',
      nameJapanese: 'アルフォンス・エルリック',
      avatarUrl: 'https://cdn.hoshika.app/catalog/characters/12.webp?v=2',
    },
  },
  {
    anime: {
      id: 'a-5',
      shortId: 13180,
      slug: 'steins-gate',
      titleRomaji: 'Steins;Gate',
      titleEnglish: 'Steins;Gate',
      coverImage: 'https://cdn.hoshika.app/covers/anime/a-5.webp',
      format: 'TV',
      averageScore: 90,
      characters: [
        {
          id: 'ch-5',
          name: 'Okabe, Rintarou',
          role: 'MAIN',
          avatar: 'https://cdn.hoshika.app/catalog/characters/35252.webp?v=2',
        },
      ],
    },
    characterDetail: {
      id: 'ch-5',
      name: 'Rintaro Okabe',
      nameJapanese: '岡部倫太郎',
      avatarUrl: 'https://cdn.hoshika.app/catalog/characters/35252.webp?v=2',
    },
  },
  {
    anime: {
      id: 'a-6',
      shortId: 88291,
      slug: 'bleach-tybw',
      titleRomaji: 'Bleach: Sennen Kessen-hen',
      titleEnglish: 'Bleach: Thousand-Year Blood War',
      coverImage: 'https://cdn.hoshika.app/covers/anime/a-6.webp',
      format: 'TV',
      averageScore: 89,
      characters: [
        {
          id: 'ch-6',
          name: 'Ishida, Uryuu',
          role: 'MAIN',
          avatar: 'https://cdn.hoshika.app/catalog/characters/564.webp?v=2',
        },
      ],
    },
    characterDetail: {
      id: 'ch-6',
      name: 'Uryu Ishida',
      nameJapanese: '石田雨竜',
      avatarUrl: 'https://cdn.hoshika.app/catalog/characters/564.webp?v=2',
    },
  },
  {
    anime: {
      id: 'a-7',
      shortId: 24040,
      slug: 'the-apothecary-diaries',
      titleRomaji: 'Kusuriya no Hitorigoto',
      titleEnglish: 'The Apothecary Diaries',
      coverImage: 'https://cdn.hoshika.app/covers/anime/a-7.webp',
      format: 'TV',
      averageScore: 88,
      characters: [
        {
          id: 'ch-7',
          name: 'Maomao',
          role: 'MAIN',
          avatar: 'https://cdn.hoshika.app/catalog/characters/201901.webp?v=2',
        },
      ],
    },
    characterDetail: {
      id: 'ch-7',
      name: 'Maomao',
      nameJapanese: '猫猫',
      avatarUrl: 'https://cdn.hoshika.app/catalog/characters/201901.webp?v=2',
    },
  },
  {
    anime: {
      id: 'a-8',
      shortId: 66796,
      slug: 'chainsaw-man',
      titleRomaji: 'Chainsaw Man',
      titleEnglish: 'Chainsaw Man',
      coverImage: 'https://cdn.hoshika.app/covers/anime/a-8.webp',
      format: 'TV',
      averageScore: 85,
      characters: [
        {
          id: 'ch-8',
          name: 'Denji',
          role: 'MAIN',
          avatar: 'https://cdn.hoshika.app/catalog/characters/170732.webp?v=2',
        },
      ],
    },
    characterDetail: {
      id: 'ch-8',
      name: 'Denji',
      nameJapanese: 'デンジ',
      avatarUrl: 'https://cdn.hoshika.app/catalog/characters/170732.webp?v=2',
    },
  },
  {
    anime: {
      id: 'a-9',
      shortId: 63020,
      slug: 're-zero',
      titleRomaji: 'Re:Zero kara Hajimeru Isekai Seikatsu',
      titleEnglish: 'Re:ZERO -Starting Life in Another World-',
      coverImage: 'https://cdn.hoshika.app/covers/anime/a-9.webp',
      format: 'TV',
      averageScore: 84,
      characters: [
        {
          id: 'ch-9',
          name: 'Emilia',
          role: 'MAIN',
          avatar: 'https://cdn.hoshika.app/catalog/characters/118737.webp?v=2',
        },
      ],
    },
    characterDetail: {
      id: 'ch-9',
      name: 'Emilia',
      nameJapanese: 'エミリア',
      avatarUrl: 'https://cdn.hoshika.app/catalog/characters/118737.webp?v=2',
    },
  },
  {
    anime: {
      id: 'a-10',
      shortId: 89530,
      slug: 'solo-leveling',
      titleRomaji: 'Ore dake Level Up na Ken',
      titleEnglish: 'Solo Leveling',
      coverImage: 'https://cdn.hoshika.app/covers/anime/a-10.webp',
      format: 'TV',
      averageScore: 83,
      characters: [
        {
          id: 'ch-10',
          name: 'Seong, Jin-Wu',
          role: 'MAIN',
          avatar: 'https://cdn.hoshika.app/catalog/characters/182301.webp?v=2',
        },
      ],
    },
    characterDetail: {
      id: 'ch-10',
      name: 'Sung Jinwoo',
      nameJapanese: '成 旬',
      avatarUrl: 'https://cdn.hoshika.app/catalog/characters/182301.webp?v=2',
      alternativeNames: ['Jinwoo Sung'],
    },
  },
  // Extra 10 characters for Play Again fresh round validation
  ...Array.from({ length: 10 }, (_, idx) => ({
    anime: {
      id: `a-${11 + idx}`,
      shortId: 70001 + idx,
      slug: `extra-anime-${idx + 1}`,
      titleRomaji: `Extra Anime ${idx + 1}`,
      titleEnglish: `Extra Show ${idx + 1}`,
      coverImage: `https://cdn.hoshika.app/covers/anime/a-${11 + idx}.webp`,
      format: 'TV',
      averageScore: 80,
      characters: [
        {
          id: `ch-${11 + idx}`,
          name: `Extra Hero ${idx + 1}`,
          role: 'MAIN',
          avatar: `https://cdn.hoshika.app/catalog/characters/${90001 + idx}.webp?v=2`,
        },
      ],
    },
    characterDetail: {
      id: `ch-${11 + idx}`,
      name: `Extra Hero ${idx + 1}`,
      nameJapanese: `エクストラ${idx + 1}`,
      avatarUrl: `https://cdn.hoshika.app/catalog/characters/${90001 + idx}.webp?v=2`,
    },
  })),
];

function createMockAnimeService(entries: FixtureEntry[] = FIXTURE_CHARACTER_POOL) {
  const animeByShortId = new Map(entries.map((e) => [e.anime.shortId, e.anime]));
  const charById = new Map(entries.map((e) => [e.characterDetail.id, e]));

  const fakeClient = {
    get: async (endpoint: string, options?: { params?: Record<string, any> }) => {
      if (endpoint === '/discover') {
        const offset = Number(options?.params?.offset || 0);
        return {
          ok: true,
          items: offset >= 60 ? entries.slice(10).map((e) => e.anime) : entries.slice(0, 10).map((e) => e.anime),
        };
      }
      if (endpoint === '/browse' || endpoint === '/catalog') {
        return { ok: true, items: entries.map((e) => e.anime) };
      }
      const animeMatch = endpoint.match(/^\/anime\/(\d+)$/);
      if (animeMatch) {
        const item = animeByShortId.get(Number(animeMatch[1]));
        if (!item) throw new Error('Anime not found');
        return { ok: true, anime: item };
      }
      const charMatch = endpoint.match(/^\/character\/(.+)$/);
      if (charMatch) {
        const found = charById.get(decodeURIComponent(charMatch[1]));
        if (!found) throw new Error('Character not found');
        return {
          ok: true,
          character: found.characterDetail,
          appearances: {
            anime: [
              {
                shortId: found.anime.shortId,
                slug: found.anime.slug,
                title: found.anime.titleEnglish,
                coverImage: found.anime.coverImage,
                role: 'MAIN',
              },
            ],
            manga: [],
          },
        };
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    },
  } as unknown as HoshikaClient;

  const cache = new CacheService('');
  const animeCache = new AnimeCacheService(cache);
  const identifiers = new AnimeIdentifierService();
  const searchService = new AnimeSearchService(fakeClient, animeCache, identifiers);
  return new AnimeService(fakeClient, animeCache, identifiers, searchService, {} as any);
}

function createMockChannel(id = 'ch-aniguess') {
  const messages: any[] = [];
  return {
    id,
    messages,
    permissionsFor: () => ({
      has: () => true,
    }),
    send: async (payload: any) => {
      messages.push(payload);
      return { id: `msg-${messages.length}`, ...payload };
    },
  };
}

function createMockSlashInteraction(options: {
  userId: string;
  username: string;
  guildId?: string;
  channel: any;
  botUserId?: string;
}) {
  const replies: any[] = [];
  const edits: any[] = [];
  const interaction: any = {
    commandName: 'aniguess',
    user: { id: options.userId, username: options.username },
    guildId: options.guildId ?? 'guild-1',
    guild:
      options.guildId === null
        ? null
        : { id: options.guildId ?? 'guild-1', members: { me: { id: options.botUserId || 'bot-1' } } },
    channelId: options.channel.id,
    channel: options.channel,
    client: { user: { id: options.botUserId || 'bot-1' } },
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => null,
    },
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    deferReply: async () => {
      interaction.deferred = true;
    },
    reply: async (p: any) => {
      interaction.replied = true;
      replies.push(p);
      return p;
    },
    editReply: async (p: any) => {
      edits.push(p);
      options.channel.messages.push(p);
      return p;
    },
    _replies: replies,
    _edits: edits,
  };
  return interaction;
}

function createMockButtonInteraction(options: {
  customId: string;
  userId: string;
  username: string;
  guildId?: string;
  channel: any;
}) {
  const replies: any[] = [];
  const edits: any[] = [];
  const interaction: any = {
    customId: options.customId,
    user: { id: options.userId, username: options.username },
    guildId: options.guildId ?? 'guild-1',
    channelId: options.channel.id,
    channel: options.channel,
    client: { user: { id: 'bot-1' } },
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    deferReply: async () => {
      interaction.deferred = true;
    },
    reply: async (p: any) => {
      interaction.replied = true;
      replies.push(p);
      return p;
    },
    editReply: async (p: any) => {
      edits.push(p);
      options.channel.messages.push(p);
      return p;
    },
    _replies: replies,
    _edits: edits,
  };
  return interaction;
}

function getCharacterFromRoundImage(imageUrl: string): FixtureEntry {
  const match = FIXTURE_CHARACTER_POOL.find((e) => e.characterDetail.avatarUrl === imageUrl);
  assert.ok(match, `Expected character image URL ${imageUrl} to map to a fixture character`);
  return match;
}

test('1 & 2. /aniquiz is removed and /aniguess is registered with character guessing metadata', () => {
  const registry = buildCommandRegistry();
  assert.equal(registry.has('aniquiz'), false, '/aniquiz must not be registered');
  assert.equal(registry.has('aniguess'), true, '/aniguess must be registered');

  const json = registry.get('aniguess')!.data.toJSON();
  assert.equal(json.name, 'aniguess');
  assert.ok(json.description.toLowerCase().includes('character'));
});

test('3. Character answer validation handles case-insensitivity, whitespace, comma variants, and rejects anime titles or partial/unrelated names', () => {
  assert.equal(normalizeAniGuessText('  Monkey   D.   Luffy! '), 'monkey d luffy');

  const narutoAccepted = extractAcceptedCharacterNames({
    characterName: 'Naruto Uzumaki',
    alternativeNames: ['Uzumaki, Naruto'],
  });
  assert.ok(narutoAccepted.includes('Naruto Uzumaki'));
  assert.ok(narutoAccepted.includes('Uzumaki, Naruto'));

  assert.equal(isAniGuessAnswerCorrect('  NARUTO   uzumaki ', narutoAccepted), true);
  assert.equal(isAniGuessAnswerCorrect('uzumaki naruto', narutoAccepted), true);
  // Must NOT match anime title or partial single word when full name is required
  assert.equal(isAniGuessAnswerCorrect('Naruto', narutoAccepted), false);
  assert.equal(isAniGuessAnswerCorrect('Sasuke Uchiha', narutoAccepted), false);

  const uryuAccepted = extractAcceptedCharacterNames({
    characterName: 'Uryu Ishida',
    alternativeNames: ['Ishida, Uryuu'],
  });
  assert.equal(isAniGuessAnswerCorrect('uryu ishida', uryuAccepted), true);
  assert.equal(isAniGuessAnswerCorrect('Uryuu Ishida', uryuAccepted), true);
  assert.equal(isAniGuessAnswerCorrect('Bleach', uryuAccepted), false);

  const frierenAccepted = extractAcceptedCharacterNames({
    characterName: 'Frieren',
    alternativeNames: [],
  });
  assert.equal(isAniGuessAnswerCorrect('FRIEREN', frierenAccepted), true);
  assert.equal(isAniGuessAnswerCorrect("Frieren: Beyond Journey's End", frierenAccepted), false);
  assert.equal(extractGuessContentFromMessage('<@!bot-1>   Alphonse Elric ', 'bot-1'), 'Alphonse Elric');
});

test('4, 5, 6, 7. Full 10-round character guessing flow: distinct character portraits (no anime posters), answer hidden, character+anime revealed on resolve, accurate final score, and Play Again', async () => {
  const db = new AniScrollDatabase(':memory:');
  const cache = new CacheService('');
  const animeService = createMockAnimeService();
  const aniGuessService = new AniGuessService({
    animeService,
    roundDurationMs: 30_000,
    totalRounds: 10,
  });

  try {
    const commands = buildCommandRegistry();
    const ctx: any = {
      db,
      cache,
      animeService,
      aniGuessService,
      musicService: {},
      websiteWatchlist: {},
      maintenanceMode: false,
    };

    const channel = createMockChannel('ch-play');
    const startInteraction = createMockSlashInteraction({
      userId: 'player-1',
      username: 'otaku_one',
      channel,
    });

    await handleInteraction(startInteraction, commands, ctx);

    const round1Payload = startInteraction._edits[0];
    assert.ok(round1Payload, 'Expected Round 1 payload');
    const round1Embed = round1Payload.embeds[0].toJSON();
    assert.equal(round1Embed.title, '🌸 AniScroll Character Guess');
    assert.equal(round1Embed.description, 'Who is this anime character?');
    assert.ok(round1Embed.image?.url?.startsWith('https://cdn.hoshika.app/catalog/characters/'));

    const round1Fixture = getCharacterFromRoundImage(round1Embed.image.url);
    assert.notEqual(round1Embed.image.url, round1Fixture.anime.coverImage);

    // Ensure neither character name nor anime title is leaked in Round 1 payload
    const serializedRound1 = JSON.stringify(round1Payload).toLowerCase();
    assert.equal(serializedRound1.includes(round1Fixture.characterDetail.name.toLowerCase()), false);
    assert.equal(serializedRound1.includes(round1Fixture.anime.titleEnglish.toLowerCase()), false);

    const fieldMap1 = Object.fromEntries((round1Embed.fields || []).map((f: any) => [f.name, f.value]));
    assert.equal(fieldMap1['Current round'], '1/10');
    assert.equal(fieldMap1['Current score'], '0/10');
    assert.equal(fieldMap1['Timer'], '30 seconds');

    // Duplicate /aniguess blocked while active
    const dupStart = createMockSlashInteraction({
      userId: 'player-1',
      username: 'otaku_one',
      channel,
    });
    await assert.rejects(
      () => aniguessCommand.execute(dupStart, ctx),
      (err: any) => err.userMessage.includes('already have an active `/aniguess` game')
    );

    // Other user cannot answer for player-1
    const intruderHandled = await aniGuessService.handleMessage({
      author: { id: 'player-2', bot: false },
      guildId: 'guild-1',
      channelId: 'ch-play',
      content: round1Fixture.characterDetail.name,
    });
    assert.equal(intruderHandled, false);
    assert.equal(aniGuessService.getActiveGame('guild-1', 'player-1')?.score, 0);

    // Anime title alone is NOT accepted when guessing character name
    const msgCountBeforeWrong = channel.messages.length;
    const wrongHandled = await aniGuessService.handleMessage({
      author: { id: 'player-1', bot: false },
      guildId: 'guild-1',
      channelId: 'ch-play',
      content: 'Completely Wrong Character',
    });
    assert.equal(wrongHandled, true);
    assert.equal(aniGuessService.getActiveGame('guild-1', 'player-1')?.score, 0);
    assert.equal(aniGuessService.getActiveGame('guild-1', 'player-1')?.currentRound?.roundNumber, 1);
    const wrongNotice = JSON.stringify(channel.messages[msgCountBeforeWrong]).toLowerCase();
    assert.equal(wrongNotice.includes(round1Fixture.characterDetail.name.toLowerCase()), false);
    assert.equal(wrongNotice.includes(round1Fixture.anime.titleEnglish.toLowerCase()), false);

    // Play through all 10 rounds verifying unique character images and character+anime reveal
    const seenCharacterIds = new Set<string>();
    const seenCharacterImages = new Set<string>();
    const allCoverUrls = new Set(FIXTURE_CHARACTER_POOL.map((f) => f.anime.coverImage));

    for (let r = 1; r <= 10; r++) {
      const game = aniGuessService.getActiveGame('guild-1', 'player-1')!;
      assert.ok(game, `Expected active game at round ${r}`);
      assert.equal(game.currentRound?.roundNumber, r);

      const roundState = game.currentRound!;
      assert.equal(seenCharacterIds.has(roundState.characterId), false, 'Character must not repeat within game');
      assert.equal(
        seenCharacterImages.has(roundState.characterImageUrl),
        false,
        'Character image must not repeat within game'
      );
      assert.equal(
        allCoverUrls.has(roundState.characterImageUrl),
        false,
        'Round image must never be an anime poster/cover'
      );

      seenCharacterIds.add(roundState.characterId);
      seenCharacterImages.add(roundState.characterImageUrl);

      const answer =
        r === 1
          ? `<@!bot-1> ${roundState.correctCharacterName.toLowerCase()}`
          : r % 2 === 0
            ? `  ${roundState.correctCharacterName.toUpperCase()}  `
            : `  ${roundState.correctCharacterName.toLowerCase()} `;

      const prevCount = channel.messages.length;
      const okHandled = await aniGuessService.handleMessage({
        author: { id: 'player-1', bot: false },
        guildId: 'guild-1',
        channelId: 'ch-play',
        content: answer,
      });
      assert.equal(okHandled, true);

      const successMsg = channel.messages[prevCount];
      const successEmbed = successMsg.embeds[0].toJSON();
      assert.equal(successEmbed.color, BRAND_THEME.success);
      assert.ok(successEmbed.description.includes(roundState.correctCharacterName));
      assert.ok(successEmbed.description.includes(roundState.animeTitle));
    }

    assert.equal(seenCharacterImages.size, 10);
    assert.equal(aniGuessService.getActiveGame('guild-1', 'player-1'), null);

    const resultsPayload = channel.messages[channel.messages.length - 1];
    const resultsEmbed = resultsPayload.embeds[0].toJSON();
    assert.equal(resultsEmbed.title, '🌸 ANI GUESS RESULTS');
    assert.ok(resultsEmbed.description.includes('🏆 Character Master!'));

    const resFields = Object.fromEntries((resultsEmbed.fields || []).map((f: any) => [f.name, f.value]));
    assert.ok(resFields['Player'].includes('otaku_one') && resFields['Player'].includes('<@player-1>'));
    assert.equal(resFields['Correct Answers'], '10');
    assert.equal(resFields['Incorrect Answers'], '0');
    assert.equal(resFields['Score'], '10/10');
    assert.equal(resFields['Percentage'], '100%');

    const playAgainBtn = resultsPayload.components[0].toJSON().components[0];
    assert.equal(playAgainBtn.label, 'Play Again');
    assert.equal(playAgainBtn.custom_id, 'aniguess:playagain:player-1');

    // Other user blocked from clicking Play Again
    const intruderPlayAgain = createMockButtonInteraction({
      customId: playAgainBtn.custom_id,
      userId: 'player-2',
      username: 'intruder',
      channel,
    });
    await handleInteraction(intruderPlayAgain, commands, ctx);
    assert.ok(intruderPlayAgain._replies[0]?.embeds[0].toJSON().description.includes('Only the player'));

    // Original player starts fresh game via Play Again
    const validPlayAgain = createMockButtonInteraction({
      customId: playAgainBtn.custom_id,
      userId: 'player-1',
      username: 'otaku_one',
      channel,
    });
    await handleInteraction(validPlayAgain, commands, ctx);
    const freshRound1 = validPlayAgain._edits[0].embeds[0].toJSON();
    const freshFields = Object.fromEntries((freshRound1.fields || []).map((f: any) => [f.name, f.value]));
    assert.equal(freshFields['Current round'], '1/10');
    assert.equal(freshFields['Current score'], '0/10');
    assert.ok(aniGuessService.getActiveGame('guild-1', 'player-1'));
  } finally {
    aniGuessService.disposeAll();
  }
});

test('1b. Missing, placeholder, or anime-cover character images are rejected and never fall back to anime posters', async () => {
  const brokenPool: FixtureEntry[] = [
    {
      anime: {
        id: 'bad-1',
        shortId: 99001,
        slug: 'bad-anime-1',
        titleRomaji: 'Bad Anime 1',
        titleEnglish: 'Bad Anime 1',
        coverImage: 'https://cdn.hoshika.app/covers/anime/bad-1.webp',
        format: 'TV',
        averageScore: 70,
        characters: [
          { id: 'bad-ch-1', name: 'Missing Avatar', role: 'MAIN', avatar: null },
          {
            id: 'bad-ch-2',
            name: 'Poster Disguised',
            role: 'MAIN',
            avatar: 'https://cdn.hoshika.app/covers/anime/bad-1.webp',
          },
          {
            id: 'bad-ch-3',
            name: 'Placeholder Face',
            role: 'MAIN',
            avatar: 'https://cdn.hoshika.app/catalog/characters/questionmark_404.webp',
          },
        ],
      },
      characterDetail: {
        id: 'bad-ch-1',
        name: 'Missing Avatar',
        avatarUrl: null,
      },
    },
  ];

  const animeService = createMockAnimeService(brokenPool);
  const aniGuessService = new AniGuessService({ animeService, totalRounds: 10 });
  const channel = createMockChannel('ch-broken');

  await assert.rejects(
    () =>
      aniGuessService.startGame({
        guildId: 'guild-broken',
        channelId: channel.id,
        userId: 'user-1',
        username: 'user_one',
        channel,
        sendInitialRound: async () => undefined,
      }),
    (err: any) => err.code === 'HOSHIKA_UNAVAILABLE'
  );
  assert.equal(aniGuessService.getActiveGameCount(), 0);
});

test('8. Round timeout reveals both character name and anime title, awards 0 points, and advances round', async () => {
  const animeService = createMockAnimeService();
  const aniGuessService = new AniGuessService({
    animeService,
    roundDurationMs: 45,
    totalRounds: 10,
  });

  try {
    const channel = createMockChannel('ch-timeout');
    await aniGuessService.startGame({
      guildId: 'guild-timeout',
      channelId: channel.id,
      userId: 'timeout-user',
      username: 'sleepy_fan',
      channel,
      sendInitialRound: async (payload) => {
        channel.messages.push(payload);
      },
    });

    const round1 = aniGuessService.getActiveGame('guild-timeout', 'timeout-user')!.currentRound!;
    await new Promise((r) => setTimeout(r, 110));

    const gameAfterTimeout = aniGuessService.getActiveGame('guild-timeout', 'timeout-user');
    assert.ok(gameAfterTimeout, 'Game should still be active on round 2+');
    assert.equal(gameAfterTimeout.score, 0);
    assert.ok(gameAfterTimeout.currentRound!.roundNumber >= 2);

    const timeoutEmbedMsg = channel.messages.find((m) => m.embeds?.[0]?.toJSON()?.title === "⏰ Time's Up!");
    assert.ok(timeoutEmbedMsg, 'Expected timeout embed');
    const desc = timeoutEmbedMsg.embeds[0].toJSON().description;
    assert.ok(desc.includes(round1.correctCharacterName));
    assert.ok(desc.includes(round1.animeTitle));

    assert.equal(getAniGuessTierMessage(10, 10), '🏆 Character Master!');
    assert.equal(getAniGuessTierMessage(9, 10), '🔥 Anime Expert!');
    assert.equal(getAniGuessTierMessage(7, 10), '⭐ Anime Fan!');
    assert.equal(getAniGuessTierMessage(3, 10), '🌱 Anime Beginner!');
    assert.equal(getAniGuessTierMessage(1, 10), '💪 Keep Practicing!');
  } finally {
    aniGuessService.disposeAll();
  }
});

test('11. Multiple players can play character /aniguess simultaneously and independently in the same channel', async () => {
  const animeService = createMockAnimeService();
  const aniGuessService = new AniGuessService({
    animeService,
    roundDurationMs: 5000,
    totalRounds: 10,
  });

  try {
    const channel = createMockChannel('ch-shared');

    await aniGuessService.startGame({
      guildId: 'guild-shared',
      channelId: channel.id,
      userId: 'user-alpha',
      username: 'alpha',
      channel,
      sendInitialRound: async (payload) => channel.messages.push(payload),
    });

    await aniGuessService.startGame({
      guildId: 'guild-shared',
      channelId: channel.id,
      userId: 'user-beta',
      username: 'beta',
      channel,
      sendInitialRound: async (payload) => channel.messages.push(payload),
    });

    assert.equal(aniGuessService.getActiveGameCount(), 2);

    const alphaChar = aniGuessService.getActiveGame('guild-shared', 'user-alpha')!.currentRound!.correctCharacterName;
    const betaGameBefore = aniGuessService.getActiveGame('guild-shared', 'user-beta')!;

    await aniGuessService.handleMessage({
      author: { id: 'user-alpha', bot: false },
      guildId: 'guild-shared',
      channelId: channel.id,
      content: alphaChar,
    });

    assert.equal(aniGuessService.getActiveGame('guild-shared', 'user-alpha')!.score, 1);
    assert.equal(aniGuessService.getActiveGame('guild-shared', 'user-alpha')!.currentRound!.roundNumber, 2);
    assert.equal(betaGameBefore.score, 0);
    assert.equal(betaGameBefore.currentRound!.roundNumber, 1);
  } finally {
    aniGuessService.disposeAll();
  }
});

test('13. Missing MessageContent intent adapts instructions, warns once on empty message, and Submit Answer character modal works', async () => {
  const { GatewayIntentBits } = await import('discord.js');
  const db = new AniScrollDatabase(':memory:');
  const cache = new CacheService('');
  const animeService = createMockAnimeService();
  const aniGuessService = new AniGuessService({
    animeService,
    roundDurationMs: 5000,
    totalRounds: 10,
  });

  try {
    const commands = buildCommandRegistry();
    const ctx: any = {
      db,
      cache,
      animeService,
      aniGuessService,
      musicService: {},
      websiteWatchlist: {},
      maintenanceMode: false,
    };

    const channel = createMockChannel('ch-no-content-intent');
    const noContentClient = {
      user: { id: 'bot-1' },
      options: {
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
      },
    };

    const startInteraction = createMockSlashInteraction({
      userId: 'modal-player',
      username: 'modal_fan',
      channel,
    });
    startInteraction.client = noContentClient;
    await handleInteraction(startInteraction, commands, ctx);

    const round1Embed = startInteraction._edits[0].embeds[0].toJSON();
    const fieldMap = Object.fromEntries((round1Embed.fields || []).map((f: any) => [f.name, f.value]));
    assert.ok(fieldMap['Instructions'].includes('Submit Answer'));
    assert.ok(fieldMap['Instructions'].includes('Message Content Intent'));

    const handledEmpty = await aniGuessService.handleMessage({
      author: { id: 'modal-player', bot: false },
      guildId: 'guild-1',
      channelId: channel.id,
      content: '',
      attachments: { size: 0 },
      client: noContentClient,
    });
    assert.equal(handledEmpty, false);
    const warningMsg = channel.messages.find(
      (m) => typeof m.content === 'string' && m.content.includes('Message Content Intent')
    );
    assert.ok(warningMsg);

    const game = aniGuessService.getActiveGame('guild-1', 'modal-player')!;
    const openModalBtn = createMockButtonInteraction({
      customId: `aniguess:openmodal:modal-player:${game.gameId}`,
      userId: 'modal-player',
      username: 'modal_fan',
      channel,
    });
    let shownModal: any = null;
    openModalBtn.showModal = async (m: any) => {
      shownModal = m;
    };
    await handleInteraction(openModalBtn, commands, ctx);
    assert.ok(shownModal, 'Expected modal to be shown');
    const modalJson = shownModal.toJSON();
    assert.equal(modalJson.custom_id, `aniguess:submit:modal-player:${game.gameId}`);
    assert.ok(modalJson.title.includes('Guess the Character'));

    const correctCharacterName = game.currentRound!.correctCharacterName;
    const modalSubmit: any = {
      customId: modalJson.custom_id,
      user: { id: 'modal-player', username: 'modal_fan' },
      guildId: 'guild-1',
      channelId: channel.id,
      deferred: false,
      replied: false,
      fields: {
        getTextInputValue: (id: string) => (id === 'guess_character' ? correctCharacterName : ''),
      },
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      isRepliable: () => true,
      deferReply: async () => {
        modalSubmit.deferred = true;
      },
      editReply: async (p: any) => {
        modalSubmit._edit = p;
        return p;
      },
    };
    await handleInteraction(modalSubmit, commands, ctx);
    assert.ok(modalSubmit._edit.content.includes('Correct!'));
    assert.equal(aniGuessService.getActiveGame('guild-1', 'modal-player')?.score, 1);
    assert.equal(aniGuessService.getActiveGame('guild-1', 'modal-player')?.currentRound?.roundNumber, 2);
  } finally {
    aniGuessService.disposeAll();
  }
});
