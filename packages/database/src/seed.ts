import { AniScrollDatabase } from './db';

export function ensureSeedData(db: AniScrollDatabase) {
  const existingGuilds = db.listGuilds();
  if (existingGuilds.length > 0) {
    const hq = existingGuilds.find((g) => g.discordGuildId === '900000000000000001') || existingGuilds[0];
    if (hq && db.listCommunityRecommendations(hq.discordGuildId, 1).length === 0) {
      seedSampleRecommendations(db, hq.discordGuildId);
    }
    return;
  }

  db.upsertUser('100000000000000001', 'AniScrollAdmin', null);
  db.upsertUser('100000000000000002', 'Renji_Mod', null);
  db.upsertUser('100000000000000003', 'HanaChan', null);

  const primaryGuild = db.ensureGuild({
    discordGuildId: '900000000000000001',
    name: 'AniScroll Community HQ',
    icon: null,
    memberCount: 14820,
    botInstalled: true,
    channels: [
      { id: '110000000000000001', name: 'announcements', type: 'text' },
      { id: '110000000000000002', name: 'welcome', type: 'text' },
      { id: '110000000000000003', name: 'mod-logs', type: 'text' },
      { id: '110000000000000004', name: 'suggestions', type: 'text' },
      { id: '110000000000000005', name: 'anime-of-the-day', type: 'text' },
      { id: '110000000000000006', name: 'Music Stage', type: 'voice' },
    ],
    roles: [
      { id: '210000000000000001', name: 'Administrator', position: 10 },
      { id: '210000000000000002', name: 'Moderator', position: 8 },
      { id: '210000000000000003', name: 'DJ', position: 6 },
      { id: '210000000000000004', name: 'Seasonal Watcher', position: 4 },
      { id: '210000000000000005', name: 'Release Ping', position: 2 },
    ],
  });

  db.ensureGuild({
    discordGuildId: '900000000000000002',
    name: 'Shibuya Watch Club',
    icon: null,
    memberCount: 3420,
    botInstalled: true,
  });

  db.ensureGuild({
    discordGuildId: '900000000000000003',
    name: 'Studio Archive',
    icon: null,
    memberCount: 890,
    botInstalled: false,
  });

  db.updateGuildSettingsSection(
    primaryGuild.discordGuildId,
    'welcomeConfig',
    {
      enabled: true,
      channelId: '110000000000000002',
      messageTemplate: 'Welcome {user} to {server}. You are member #{memberCount}.',
      embedEnabled: true,
      embedTitle: 'Welcome to AniScroll Community HQ',
      embedDescription: 'Explore /anime search, track episodes via /watchlist, and queue tracks with /play.',
      embedColor: '#FFFFFF',
      embedThumbnail: null,
      embedImage: null,
      embedFooter: 'AniScroll Bot Community HQ',
      showMemberAvatar: true,
      successCount: 0,
      lastWelcomeAt: null,
      lastError: null,
      farewellEnabled: true,
      farewellChannelId: '110000000000000002',
      farewellTemplate: '{username} departed {server}.',
      bannerUrl: null,
      dmEnabled: false,
      dmTemplate: 'Welcome to {server}!',
    },
    '100000000000000001'
  );

  db.updateGuildSettingsSection(
    primaryGuild.discordGuildId,
    'loggingConfig',
    {
      enabled: true,
      messageLogChannelId: '110000000000000003',
      memberLogChannelId: '110000000000000003',
      moderationLogChannelId: '110000000000000003',
      ticketLogChannelId: '110000000000000003',
      commandLogChannelId: '110000000000000003',
    },
    '100000000000000001'
  );

  // Seed sample moderation & community records
  db.issueWarningWithEscalation(primaryGuild.discordGuildId, {
    userId: '100000000000000099',
    moderatorId: '100000000000000002',
    reason: 'Repeated unapproved invite links in #general',
  });
  db.createModerationCase(primaryGuild.discordGuildId, {
    targetUserId: '100000000000000088',
    moderatorId: '100000000000000002',
    action: 'TIMEOUT',
    reason: 'Flooding channel with duplicate messages (AutoMod escalation)',
    durationMinutes: 30,
  });

  db.createSuggestion(
    primaryGuild.discordGuildId,
    '100000000000000003',
    'Add weekly seasonal premieres digest every Friday at 18:00 UTC in #anime-of-the-day.'
  );
  const s2 = db.createSuggestion(
    primaryGuild.discordGuildId,
    '100000000000000002',
    'Enable reaction role panel for Seasonal Genres (Action, Mystery, Sci-Fi).'
  );
  db.voteSuggestion(s2.id, '100000000000000001', 'up');
  db.voteSuggestion(s2.id, '100000000000000003', 'up');

  db.createTicket(primaryGuild.discordGuildId, {
    channelId: '120000000000000001',
    userId: '100000000000000003',
    category: 'FEATURE_REQUEST',
    subject: 'Custom watchlist CSV export formatting',
  });

  db.createReactionRolePanel(primaryGuild.discordGuildId, {
    channelId: '110000000000000001',
    title: 'Community Notifications',
    description: 'Opt in to seasonal airing alerts and server announcements.',
    mode: 'BUTTON',
    exclusive: false,
    maxSelections: 2,
    roles: [
      { roleId: '210000000000000004', label: 'Seasonal Watcher', emoji: null },
      { roleId: '210000000000000005', label: 'Release Ping', emoji: null },
    ],
  });

  db.createPoll(primaryGuild.discordGuildId, {
    channelId: '110000000000000001',
    creatorId: '100000000000000001',
    question: 'Which Fall 2026 series should we host for Saturday Watch Party?',
    options: ['The Apothecary Diaries S3', 'Frieren Rewatch', 'Dandadan Marathon'],
    allowMultiple: false,
    durationMinutes: 1440,
  });

  db.createGiveaway(primaryGuild.discordGuildId, {
    channelId: '110000000000000001',
    hostId: '100000000000000001',
    prize: 'Community Supporter Role (30 Days)',
    winnerCount: 2,
    durationMinutes: 2880,
  });

  // Seed watchlist for default admin sandbox user
  db.addWatchlistEntry('100000000000000001', {
    hoshikaId: 'ba7ae869-82a1-458c-91ae-a5d4fc606947',
    hoshikaShortId: 26178,
    titleSnapshot: "Frieren: Beyond Journey's End",
    posterSnapshot: 'https://cdn.hoshika.app/covers/anime/ba7ae869-82a1-458c-91ae-a5d4fc606947.webp',
    genresSnapshot: ['Adventure', 'Drama', 'Fantasy'],
    totalEpisodes: 28,
    status: 'WATCHING',
  });

  db.addXp('100000000000000001', 'AniScrollAdmin', 1240);
  db.addXp('100000000000000002', 'Renji_Mod', 890);
  db.addXp('100000000000000003', 'HanaChan', 1650);

  // Seed realistic command & search metrics
  const seedCmds = [
    { name: 'anime search', cat: 'anime', count: 14 },
    { name: 'anime recommendation', cat: 'anime', count: 11 },
    { name: 'watchlist add', cat: 'watchlist', count: 9 },
    { name: 'play', cat: 'music', count: 12 },
    { name: 'queue', cat: 'music', count: 7 },
    { name: 'warn', cat: 'moderation', count: 4 },
    { name: 'anime trending', cat: 'anime', count: 8 },
  ];
  for (const c of seedCmds) {
    for (let i = 0; i < c.count; i++) {
      db.recordCommandMetric({
        guildId: primaryGuild.id,
        commandName: c.name,
        category: c.cat,
        userId: '100000000000000001',
        success: true,
        durationMs: 45 + (i % 35),
      });
    }
  }

  db.recordAnimeSearchMetric({
    query: 'naruto',
    hoshikaId: 'bfda1b08-54b8-4945-beba-8fb9a7aded1b',
    title: 'Naruto',
    genres: ['Action', 'Adventure'],
    userId: '100000000000000001',
    guildId: primaryGuild.id,
  });
  db.recordAnimeSearchMetric({
    query: 'apothecary diaries',
    hoshikaId: '00b35fed-fa64-4ccd-9e59-c5f450a60e0d',
    title: 'The Apothecary Diaries Season 3',
    genres: ['Drama', 'Mystery'],
    userId: '100000000000000003',
    guildId: primaryGuild.id,
  });

  seedSampleRecommendations(db, primaryGuild.discordGuildId);
}

function seedSampleRecommendations(db: AniScrollDatabase, discordGuildId: string) {
  const sampleRecs = [
    {
      channelId: '110000000000000005',
      discordUserId: '100000000000000003',
      username: 'HanaChan',
      hoshikaShortId: 26178,
      animeTitle: "Frieren: Beyond Journey's End",
      messageId: '130000000000000001',
    },
    {
      channelId: '110000000000000004',
      discordUserId: '100000000000000001',
      username: 'AniScrollAdmin',
      hoshikaShortId: 26178,
      animeTitle: "Frieren: Beyond Journey's End",
      messageId: '130000000000000002',
    },
    {
      channelId: '110000000000000005',
      discordUserId: '100000000000000002',
      username: 'Renji_Mod',
      hoshikaShortId: 24040,
      animeTitle: 'The Apothecary Diaries',
      messageId: '130000000000000003',
    },
    {
      channelId: '110000000000000005',
      discordUserId: '100000000000000003',
      username: 'HanaChan',
      hoshikaShortId: 97482,
      animeTitle: 'Dan Da Dan',
      messageId: '130000000000000004',
    },
    {
      channelId: '110000000000000004',
      discordUserId: '100000000000000001',
      username: 'AniScrollAdmin',
      hoshikaShortId: 53022,
      animeTitle: "How I Attended an All-Guy's Mixer",
      messageId: '130000000000000005',
    },
  ];

  for (const r of sampleRecs) {
    db.recordCommunityRecommendation({ guildId: discordGuildId, ...r });
  }
}
