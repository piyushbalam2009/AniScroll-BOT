import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterAndSortWatchlist,
  filterModerationCases,
  formatUptime,
  renderWelcomePreviewText,
  summarizeModuleReadiness,
} from '../src/lib/dashboardUtils';

test('renderWelcomePreviewText interpolates all supported Discord welcome placeholders', () => {
  const output = renderWelcomePreviewText(
    'Welcome {user} ({username} / {displayName}) to {server}! Member #{memberCount} [ID: {userId}]',
    {
      user: '@Akira',
      username: 'akira_99',
      displayName: 'Akira Sato',
      server: 'AniScroll HQ',
      memberCount: 512,
      userId: '100200300',
    }
  );
  assert.equal(
    output,
    'Welcome @Akira (akira_99 / Akira Sato) to AniScroll HQ! Member #512 [ID: 100200300]'
  );
});

test('filterModerationCases filters by action type and search query', () => {
  const cases = [
    {
      id: 'c1',
      caseNumber: 1,
      action: 'WARN',
      targetUserId: '100001',
      moderatorId: '999001',
      reason: 'Spoiler in general chat',
      createdAt: '2026-11-15T00:00:00Z',
    },
    {
      id: 'c2',
      caseNumber: 2,
      action: 'TIMEOUT',
      targetUserId: '100002',
      moderatorId: '999001',
      reason: 'Repeated spam links',
      createdAt: '2026-11-15T01:00:00Z',
    },
    {
      id: 'c3',
      caseNumber: 3,
      action: 'BAN',
      targetUserId: '100003',
      moderatorId: '999002',
      reason: 'Phishing link distribution',
      createdAt: '2026-11-15T02:00:00Z',
    },
  ];

  assert.equal(filterModerationCases(cases, 'ALL', '').length, 3);
  assert.equal(filterModerationCases(cases, 'TIMEOUT', '').length, 1);
  assert.equal(filterModerationCases(cases, 'ALL', 'phishing')[0]?.id, 'c3');
  assert.equal(filterModerationCases(cases, 'ALL', '#2')[0]?.id, 'c2');
  assert.equal(filterModerationCases(cases, 'WARN', 'phishing').length, 0);
});

test('filterAndSortWatchlist filters by query and sorts by title, progress, and rating', () => {
  const items = [
    {
      id: 'w1',
      titleSnapshot: 'Sousou no Frieren',
      hoshikaShortId: 101,
      status: 'WATCHING',
      episodesWatched: 14,
      totalEpisodes: 28,
      personalRating: 10,
      updatedAt: '2026-11-14T10:00:00Z',
    },
    {
      id: 'w2',
      titleSnapshot: 'Bleach: Thousand-Year Blood War',
      hoshikaShortId: 202,
      status: 'COMPLETED',
      episodesWatched: 26,
      totalEpisodes: 26,
      personalRating: 9,
      updatedAt: '2026-11-15T10:00:00Z',
    },
    {
      id: 'w3',
      titleSnapshot: 'Apothecary Diaries',
      hoshikaShortId: 303,
      status: 'PLAN_TO_WATCH',
      episodesWatched: 0,
      totalEpisodes: 24,
      personalRating: null,
      updatedAt: '2026-11-13T10:00:00Z',
    },
  ];

  const byTitle = filterAndSortWatchlist(items, '', 'title');
  assert.deepEqual(
    byTitle.map((i) => i.id),
    ['w3', 'w2', 'w1']
  );

  const byProgress = filterAndSortWatchlist(items, '', 'progress');
  assert.deepEqual(
    byProgress.map((i) => i.id),
    ['w2', 'w1', 'w3']
  );

  const byRating = filterAndSortWatchlist(items, '', 'rating');
  assert.deepEqual(
    byRating.map((i) => i.id),
    ['w1', 'w2', 'w3']
  );

  const filtered = filterAndSortWatchlist(items, '202', 'title');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, 'w2');
});

test('formatUptime formats seconds into compact human-readable durations', () => {
  assert.equal(formatUptime(45), '0m');
  assert.equal(formatUptime(540), '9m');
  assert.equal(formatUptime(7500), '2h 5m');
  assert.equal(formatUptime(90000), '1d 1h');
});

test('summarizeModuleReadiness produces 5 module readiness descriptors', () => {
  const modules = summarizeModuleReadiness({
    welcomeConfig: { enabled: true, channelId: '110000000000000001', embedEnabled: true },
    automodConfig: { enabled: true, antiSpam: true, phishingFilter: true, punishmentMode: 'ESCALATE' },
    animeConfig: { recommendationEnabled: true, recommendationCooldownSeconds: 20, locale: 'en' },
    musicConfig: { enabled: false, defaultVolume: 80, maxQueueSize: 250 },
    loggingConfig: { enabled: true },
  });

  assert.equal(modules.length, 5);
  assert.equal(modules[0]?.enabled, true);
  assert.equal(modules[1]?.detail, '2/6 filters active · ESCALATE');
  assert.equal(modules[3]?.enabled, false);
});
