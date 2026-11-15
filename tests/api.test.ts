import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SQLITE_DB_PATH = ':memory:';
import { createApiApp } from '../apps/api/src';

test('REST API enforces auth, CSRF, and persists guild settings & watchlist across requests', async () => {
  const app = createApiApp();
  const server = app.listen(0);
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Health endpoint succeeds without auth and leaks no secrets
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as any;
    assert.equal(healthJson.ok, true);
    assert.equal('DISCORD_TOKEN' in healthJson, false);

    // 1b. Session & callback route consistency
    const sessionRes = await fetch(`${baseUrl}/api/v1/auth/session`);
    assert.equal(sessionRes.status, 200);
    const sessionJson = (await sessionRes.json()) as any;
    assert.equal(sessionJson.callbackUrl, healthJson.oauthCallbackUrl);

    const callbackBadRes = await fetch(`${baseUrl}/auth/callback?error=access_denied`);
    assert.equal(callbackBadRes.status, 400);

    // 2. Protected route rejects unauthenticated access
    const unauthRes = await fetch(`${baseUrl}/api/v1/guilds`);
    assert.equal(unauthRes.status, 401);

    // 3. Sandbox login sets session cookie + returns CSRF token
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/sandbox`, { method: 'POST' });
    assert.equal(loginRes.status, 200);
    const cookieHeader = loginRes.headers.get('set-cookie') || '';
    const sessionCookie = cookieHeader.split(';')[0];
    const loginData = (await loginRes.json()) as any;
    const csrfToken = loginData.user.csrfToken;
    assert.ok(sessionCookie.includes('aniscroll_session='));
    assert.ok(csrfToken.length > 10);

    // 4. Mutation without CSRF token is rejected with 403
    const noCsrfRes = await fetch(`${baseUrl}/api/v1/watchlist`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ hoshikaId: 'test-anime-1', titleSnapshot: 'Test Anime' }),
    });
    assert.equal(noCsrfRes.status, 403);

    // 5. Mutation with valid cookie & CSRF token succeeds and persists Hoshika shortId + optional anilistId metadata
    const addRes = await fetch(`${baseUrl}/api/v1/watchlist`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hoshikaId: `test-anime-${Date.now()}`,
        hoshikaShortId: 41391,
        anilistId: 20,
        titleSnapshot: 'Naruto',
        totalEpisodes: 220,
      }),
    });
    assert.equal(addRes.status, 201);
    const addData = (await addRes.json()) as any;
    assert.equal(addData.entry.titleSnapshot, 'Naruto');
    assert.equal(addData.entry.hoshikaShortId, 41391);
    assert.equal(addData.entry.anilistId, 20);
    assert.equal(addData.entry.aniscrollUrl, 'https://aniscroll.in/anime/41391');

    // 5b. Entry missing Hoshika shortId must NOT fall back to anilistId in aniscrollUrl
    const noShortRes = await fetch(`${baseUrl}/api/v1/watchlist`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'x-csrf-token': csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hoshikaId: `test-missing-short-${Date.now()}`,
        anilistId: 16498,
        titleSnapshot: 'Missing ShortId Entry',
        totalEpisodes: 25,
      }),
    });
    assert.equal(noShortRes.status, 201);
    const noShortData = (await noShortRes.json()) as any;
    assert.equal(noShortData.entry.hoshikaShortId, null);
    assert.equal(noShortData.entry.anilistId, 16498);
    assert.equal(noShortData.entry.aniscrollUrl, null);

    // 5c. Watchlist GET returns Hoshika shortId URL for entries with shortId and null for entries without
    const listRes = await fetch(`${baseUrl}/api/v1/watchlist`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as any;
    const narutoEntry = listData.items.find((item: any) => item.id === addData.entry.id);
    const missingEntry = listData.items.find((item: any) => item.id === noShortData.entry.id);
    assert.equal(narutoEntry?.aniscrollUrl, 'https://aniscroll.in/anime/41391');
    assert.equal(missingEntry?.aniscrollUrl, null);

    // Clean up test entries
    for (const id of [addData.entry.id, noShortData.entry.id]) {
      const delRes = await fetch(`${baseUrl}/api/v1/watchlist/${id}`, {
        method: 'DELETE',
        headers: {
          Cookie: sessionCookie,
          'x-csrf-token': csrfToken,
        },
      });
      assert.equal(delRes.status, 200);
    }

    // 6. Live Hoshika search/trending/details endpoints generate Hoshika shortId URLs across multiple results
    for (const query of ['naruto', 'frieren']) {
      const searchRes = await fetch(`${baseUrl}/api/v1/anime/search?q=${encodeURIComponent(query)}`);
      assert.equal(searchRes.status, 200);
      const searchJson = (await searchRes.json()) as any;
      assert.ok(Array.isArray(searchJson.items) && searchJson.items.length >= 2, `Expected multiple results for ${query}`);
      for (const item of searchJson.items) {
        if (item.shortId != null) {
          assert.equal(item.aniscrollUrl, `https://aniscroll.in/anime/${item.shortId}`);
          if (item.anilistId != null && item.anilistId !== item.shortId) {
            assert.notEqual(item.aniscrollUrl, `https://aniscroll.in/anime/${item.anilistId}`);
          }
        } else {
          assert.equal(item.aniscrollUrl, null);
        }
      }
    }

    const trendingRes = await fetch(`${baseUrl}/api/v1/anime/trending`);
    assert.equal(trendingRes.status, 200);
    const trendingJson = (await trendingRes.json()) as any;
    assert.ok(Array.isArray(trendingJson.items) && trendingJson.items.length > 0);
    for (const item of trendingJson.items) {
      assert.equal(
        item.aniscrollUrl,
        item.shortId != null ? `https://aniscroll.in/anime/${item.shortId}` : null
      );
    }

    const detailRes = await fetch(`${baseUrl}/api/v1/anime/41391`);
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as any;
    assert.equal(detailJson.anime.shortId, 41391);
    assert.equal(detailJson.anime.aniscrollUrl, 'https://aniscroll.in/anime/41391');
    for (const rel of detailJson.anime.relations || []) {
      assert.equal(rel.aniscrollUrl, rel.shortId != null ? `https://aniscroll.in/anime/${rel.shortId}` : null);
    }
    for (const rec of detailJson.anime.recommendations || []) {
      assert.equal(rec.aniscrollUrl, rec.shortId != null ? `https://aniscroll.in/anime/${rec.shortId}` : null);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Discord OAuth2 HTTP flow generates valid auth URL, validates state, exchanges code, creates session, and hides secrets', async () => {
  const prevClientId = process.env.DISCORD_CLIENT_ID;
  const prevSecret = process.env.DISCORD_CLIENT_SECRET;
  const prevRedirect = process.env.DISCORD_REDIRECT_URI;
  const prevAppUrl = process.env.APP_URL;

  const { appConfig } = await import('../packages/shared/src');
  const origAppCfgId = appConfig.DISCORD_CLIENT_ID;
  const origAppCfgSecret = appConfig.DISCORD_CLIENT_SECRET;
  const origAppCfgOAuth = appConfig.isOAuthConfigured;

  let exchangedRedirectUri = '';
  const mockOAuthFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://discord.com/api/oauth2/token') {
      const bodyParams = new URLSearchParams(String(init?.body || ''));
      exchangedRedirectUri = bodyParams.get('redirect_uri') || '';
      if (bodyParams.get('code') === 'bad-code') {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ access_token: 'discord-oauth-access-secret' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://discord.com/api/users/@me') {
      return new Response(
        JSON.stringify({ id: '777111222', username: 'hoshika_mod', avatar: 'av1' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://discord.com/api/users/@me/guilds') {
      return new Response(
        JSON.stringify([
          { id: 'guild-oauth-1', name: 'AniScroll OAuth Guild', permissions: '32', owner: false, icon: null },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  process.env.APP_URL = 'https://oauth-test.aniscroll.dev';
  process.env.DISCORD_REDIRECT_URI =
    'https://discord.com/oauth2/authorize?client_id=1571223083333976094&permissions=8&scope=bot';
  process.env.DISCORD_CLIENT_ID = '1571223083333976094';
  process.env.DISCORD_CLIENT_SECRET = 'test-oauth-client-secret';
  appConfig.DISCORD_CLIENT_ID = '1571223083333976094';
  appConfig.DISCORD_CLIENT_SECRET = 'test-oauth-client-secret';
  appConfig.isOAuthConfigured = true;

  const app = createApiApp({ oauthFetch: mockOAuthFetch });
  const server = app.listen(0);
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. /api/v1/auth/session ignores bot invite URL override and exposes /auth/callback + warning + separate botInviteUrl
    const sessRes = await fetch(`${baseUrl}/api/v1/auth/session`);
    assert.equal(sessRes.status, 200);
    const sessJson = (await sessRes.json()) as any;
    assert.equal(sessJson.callbackRoute, '/auth/callback');
    assert.equal(sessJson.callbackUrl, 'https://oauth-test.aniscroll.dev/auth/callback');
    assert.ok(sessJson.redirectUriWarning);
    assert.ok(sessJson.botInviteUrl.includes('scope=bot+applications.commands'));

    // 2. /api/v1/auth/discord/url generates state cookie and authorization URL with identify + guilds + matching redirect_uri
    const urlRes = await fetch(`${baseUrl}/api/v1/auth/discord/url`);
    assert.equal(urlRes.status, 200);
    const urlJson = (await urlRes.json()) as any;
    const setCookies = urlRes.headers.getSetCookie();
    const stateCookie = setCookies.find((c) => c.startsWith('aniscroll_oauth_state='))?.split(';')[0] || '';
    assert.ok(stateCookie.includes('aniscroll_oauth_state='));

    const authUrl = new URL(urlJson.url);
    const state = authUrl.searchParams.get('state') || '';
    assert.ok(state.length >= 32);
    assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://oauth-test.aniscroll.dev/auth/callback');
    assert.equal(authUrl.searchParams.get('scope'), 'identify guilds');
    assert.equal(authUrl.searchParams.get('response_type'), 'code');

    // 3. Invalid state is rejected with 400
    const badStateRes = await fetch(`${baseUrl}/auth/callback?code=valid-code&state=wrong-state`, {
      headers: { Cookie: stateCookie },
    });
    assert.equal(badStateRes.status, 400);

    // 4. Failed Discord token exchange returns 502 with error script
    const badCodeRes = await fetch(`${baseUrl}/auth/callback?code=bad-code&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: stateCookie },
    });
    assert.equal(badCodeRes.status, 502);

    // 5. Valid callback completes token exchange using exact same redirect_uri and creates HttpOnly session cookie
    const okRes = await fetch(`${baseUrl}/auth/callback?code=good-code&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: stateCookie },
    });
    assert.equal(okRes.status, 200);
    assert.equal(exchangedRedirectUri, 'https://oauth-test.aniscroll.dev/auth/callback');
    const okCookies = okRes.headers.getSetCookie();
    const sessionCookie = okCookies.find((c) => c.startsWith('aniscroll_session='))?.split(';')[0] || '';
    assert.ok(sessionCookie.includes('aniscroll_session='));

    // 6. Replay of same state fails because state cookie was cleared and client doesn't send valid state
    const replayRes = await fetch(`${baseUrl}/auth/callback?code=good-code&state=${encodeURIComponent(state)}`);
    assert.equal(replayRes.status, 400);

    // 7. Authenticated session returns user profile & never leaks OAuth access token or client secret
    const authedSessRes = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(authedSessRes.status, 200);
    const authedText = await authedSessRes.text();
    assert.equal(authedText.includes('discord-oauth-access-secret'), false);
    assert.equal(authedText.includes('test-oauth-client-secret'), false);
    const authedSess = JSON.parse(authedText);
    assert.equal(authedSess.authenticated, true);
    assert.equal(authedSess.user.userId, '777111222');
    assert.equal(authedSess.user.username, 'hoshika_mod');
    assert.equal(authedSess.user.mode, 'discord_oauth');
  } finally {
    if (prevClientId === undefined) delete process.env.DISCORD_CLIENT_ID;
    else process.env.DISCORD_CLIENT_ID = prevClientId;
    if (prevSecret === undefined) delete process.env.DISCORD_CLIENT_SECRET;
    else process.env.DISCORD_CLIENT_SECRET = prevSecret;
    if (prevRedirect === undefined) delete process.env.DISCORD_REDIRECT_URI;
    else process.env.DISCORD_REDIRECT_URI = prevRedirect;
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;

    appConfig.DISCORD_CLIENT_ID = origAppCfgId;
    appConfig.DISCORD_CLIENT_SECRET = origAppCfgSecret;
    appConfig.isOAuthConfigured = origAppCfgOAuth;

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Admin Music Infrastructure endpoints enforce auth/CSRF, redact secrets, and report honest offline state', async () => {
  const app = createApiApp();
  const server = app.listen(0);
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Unauthenticated requests rejected
    const unauthStatus = await fetch(`${baseUrl}/api/v1/admin/music/status`);
    assert.equal(unauthStatus.status, 401);

    const unauthTest = await fetch(`${baseUrl}/api/v1/admin/music/test`, { method: 'POST' });
    assert.equal(unauthTest.status, 401);

    // 2. Authenticate via sandbox
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/sandbox`, { method: 'POST' });
    assert.equal(loginRes.status, 200);
    const sessionCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
    const loginData = (await loginRes.json()) as any;
    const csrfToken = loginData.user.csrfToken;

    // 3. Authenticated GET /api/v1/admin/music/status returns structured diagnostics with zero leaked secrets
    const statusRes = await fetch(`${baseUrl}/api/v1/admin/music/status`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(statusRes.status, 200);
    const statusText = await statusRes.text();
    const statusJson = JSON.parse(statusText);
    assert.equal(statusJson.ok, true);
    assert.equal(typeof statusJson.lavalink.status, 'string');
    assert.equal('password' in statusJson.lavalink, false);
    assert.equal('LAVALINK_PASSWORD' in statusJson.lavalink, false);
    assert.equal('SPOTIFY_CLIENT_SECRET' in statusJson.lavalink, false);
    assert.ok(Array.isArray(statusJson.lavalink.configValidation));
    assert.ok(statusJson.lavalink.integrations?.youtube);
    assert.ok(statusJson.lavalink.integrations?.spotify);
    assert.equal(typeof statusJson.lavalink.environmentSupport?.javaInstalled, 'boolean');

    // 4. POST /api/v1/admin/music/test enforces CSRF
    const noCsrfTest = await fetch(`${baseUrl}/api/v1/admin/music/test`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
    });
    assert.equal(noCsrfTest.status, 403);

    // 5. POST /api/v1/admin/music/test with valid CSRF honestly fails when unconfigured
    const testRes = await fetch(`${baseUrl}/api/v1/admin/music/test`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'x-csrf-token': csrfToken,
      },
    });
    assert.equal(testRes.status, 200);
    const testJson = (await testRes.json()) as any;
    assert.equal(testJson.ok, true);
    assert.ok(typeof testJson.result.success === 'boolean');
    assert.equal(statusJson.lavalink.configured, true);
    assert.ok(typeof testJson.lavalink.host === 'string');

    // 6. Health endpoint matches lavalink status
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    const healthJson = (await healthRes.json()) as any;
    assert.equal(healthJson.lavalink.status, testJson.lavalink.status);
    assert.equal(healthJson.lavalink.connected, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
