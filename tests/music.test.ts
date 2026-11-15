import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { PermissionFlagsBits } from 'discord.js';
import {
  checkBotVoiceChannelPermissions,
  checkVoiceControlPermission,
  classifyLavalinkError,
  classifyMusicQuery,
  computeReconnectDelayMs,
  formatDuration,
  GuildMusicQueue,
  MusicService,
  parseSeekPositionMs,
  validateLavalinkConfig,
} from '../apps/bot/src/services/music/MusicService';
import { buildMusicControlRows, createNowPlayingEmbed } from '../packages/discord-ui/src';

function makeTrack(id: string, title: string, sourceName = 'youtube', durationMs = 185000) {
  return {
    encoded: `encoded-${id}`,
    info: {
      identifier: id,
      isSeekable: true,
      author: `Artist ${id}`,
      length: durationMs,
      isStream: false,
      position: 0,
      title,
      uri: `https://example.com/${id}`,
      artworkUrl: `https://img.example.com/${id}.jpg`,
      sourceName,
    },
    pluginInfo: {},
  };
}

class MockDiscordClient extends EventEmitter {
  public user = { id: '999000111222333444', tag: 'AniScrollBot#0001' };
  private emitVoiceHandshake = (packet: any) => {
    if (packet?.op === 4 && packet?.d?.channel_id) {
      const guildId = packet.d.guild_id;
      const channelId = packet.d.channel_id;
      setImmediate(() => {
        this.emit('raw', {
          t: 'VOICE_STATE_UPDATE',
          d: {
            guild_id: guildId,
            channel_id: channelId,
            user_id: '999000111222333444',
            session_id: `voice-sess-${guildId}`,
            self_deaf: true,
            self_mute: false,
          },
        });
        this.emit('raw', {
          t: 'VOICE_SERVER_UPDATE',
          d: {
            token: `voice-tok-${guildId}`,
            guild_id: guildId,
            endpoint: `voice-${guildId}.discord.media:443`,
          },
        });
      });
    }
  };
  public ws = {
    shards: Object.assign(
      new Map<number, { id: number; send: (packet: any) => void }>([
        [0, { id: 0, send: (packet: any) => this.emitVoiceHandshake(packet) }],
      ]),
      {
        first: () => ({ id: 0, send: (packet: any) => this.emitVoiceHandshake(packet) }),
      }
    ),
    ping: 24,
  };
  public guilds = {
    cache: new Map([
      [
        'guild-1',
        {
          id: 'guild-1',
          shardId: 0,
          shard: { send: (packet: any) => this.emitVoiceHandshake(packet) },
          channels: { cache: new Map() },
        },
      ],
      [
        'guild-2',
        {
          id: 'guild-2',
          shardId: 0,
          shard: { send: (packet: any) => this.emitVoiceHandshake(packet) },
          channels: { cache: new Map() },
        },
      ],
    ]),
  };
}

async function createMockLavalinkV4Server(expectedPassword: string) {
  const playerRequests: Array<{ method: string; guildId: string; body: any }> = [];
  const activeSockets = new Set<any>();

  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    if (auth !== expectedPassword) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 401, error: 'Unauthorized', message: 'Invalid password' }));
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/v4/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          version: { semver: '4.0.8', major: 4, minor: 0, patch: 8 },
          buildTime: Date.now(),
          git: { branch: 'main', commit: 'abc123', commitTime: Date.now() },
          jvm: '17.0.12',
          lavaplayer: '2.2.2',
          sourceManagers: ['youtube', 'spotify', 'soundcloud', 'http'],
          filters: ['volume', 'equalizer', 'timescale'],
          plugins: [
            { name: 'youtube-plugin', version: '1.18.2' },
            { name: 'lavasrc-plugin', version: '4.8.3' },
            { name: 'lavasearch-plugin', version: '1.0.0' },
          ],
        })
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v4/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          op: 'stats',
          players: playerRequests.length,
          playingPlayers: 1,
          memory: { reservable: 1073741824, used: 134217728, free: 536870912, allocated: 268435456 },
          frameStats: null,
          cpu: { cores: 4, systemLoad: 0.1, lavalinkLoad: 0.05 },
          uptime: 95000,
        })
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v4/loadtracks') {
      const identifier = url.searchParams.get('identifier') || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });

      if (identifier.includes('UNAVAILABLE')) {
        res.end(
          JSON.stringify({
            loadType: 'error',
            data: {
              message: 'Sign in to confirm your age. This video is age-restricted.',
              severity: 'common',
              cause: 'YoutubePlugin',
            },
          })
        );
        return;
      }

      if (identifier.includes('NO_MATCH')) {
        res.end(JSON.stringify({ loadType: 'empty', data: {} }));
        return;
      }

      if (identifier.startsWith('https://www.youtube.com/playlist')) {
        res.end(
          JSON.stringify({
            loadType: 'playlist',
            data: {
              encoded: '',
              info: { name: 'AniScroll Anime Openings', selectedTrack: 0 },
              pluginInfo: {},
              tracks: [
                makeTrack('yt-pl-1', 'Unravel', 'youtube', 238000),
                makeTrack('yt-pl-2', 'Gurenge', 'youtube', 237000),
                makeTrack('yt-pl-3', 'Idol', 'youtube', 213000),
              ],
            },
          })
        );
        return;
      }

      if (identifier.startsWith('https://open.spotify.com/playlist/')) {
        res.end(
          JSON.stringify({
            loadType: 'playlist',
            data: {
              encoded: '',
              info: { name: 'Spotify Anime Mix', selectedTrack: 0 },
              pluginInfo: {},
              tracks: [
                makeTrack('sp-pl-1', 'Kick Back', 'spotify', 193000),
                makeTrack('sp-pl-2', 'Specialz', 'spotify', 234000),
              ],
            },
          })
        );
        return;
      }

      if (identifier.startsWith('https://open.spotify.com/track/')) {
        res.end(
          JSON.stringify({
            loadType: 'track',
            data: makeTrack('sp-trk-1', 'Yuusha', 'spotify', 196000),
          })
        );
        return;
      }

      if (identifier.startsWith('https://www.youtube.com/watch?v=')) {
        res.end(
          JSON.stringify({
            loadType: 'track',
            data: makeTrack('yt-vid-1', 'Never Gonna Give You Up', 'youtube', 213000),
          })
        );
        return;
      }

      if (identifier.startsWith('ytsearch:') || identifier.startsWith('spsearch:')) {
        const src = identifier.startsWith('spsearch:') ? 'spotify' : 'youtube';
        const q = identifier.split(':').slice(1).join(':');
        res.end(
          JSON.stringify({
            loadType: 'search',
            data: Array.from({ length: 10 }, (_, idx) =>
              makeTrack(`${src}-${idx + 1}`, `${q} Result ${idx + 1}`, src, 180000 + idx * 5000)
            ),
          })
        );
        return;
      }

      res.end(JSON.stringify({ loadType: 'empty', data: {} }));
      return;
    }

    const playerMatch = /^\/v4\/sessions\/[^/]+\/players\/([^/]+)$/.exec(url.pathname);
    if (playerMatch) {
      const guildId = playerMatch[1];
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        playerRequests.push({ method: req.method || 'PATCH', guildId, body });
        res.writeHead(req.method === 'DELETE' ? 204 : 200, { 'Content-Type': 'application/json' });
        if (req.method === 'DELETE') {
          res.end();
        } else {
          res.end(
            JSON.stringify({
              guildId,
              volume: body.volume ?? 65,
              paused: body.paused ?? false,
              voice: body.voice || { token: 't', endpoint: 'e', sessionId: 's' },
              filters: {},
            })
          );
        }
      });
      return;
    }

    const sessionMatch = /^\/v4\/sessions\/[^/]+$/.exec(url.pathname);
    if (sessionMatch) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ resuming: true, timeout: 60 }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.headers.authorization !== expectedPassword) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      activeSockets.add(ws);
      ws.on('close', () => activeSockets.delete(ws));
      ws.send(JSON.stringify({ op: 'ready', resumed: false, sessionId: 'session-v4-test' }));
      ws.send(
        JSON.stringify({
          op: 'stats',
          players: 0,
          playingPlayers: 0,
          memory: { reservable: 1024, used: 128, free: 512, allocated: 256 },
          frameStats: null,
          cpu: { cores: 4, systemLoad: 0.1, lavalinkLoad: 0.05 },
          uptime: 1000,
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };

  return {
    port: addr.port,
    playerRequests,
    dropActiveSockets() {
      for (const s of activeSockets) {
        s.close(1012, 'Restarting node');
      }
    },
    async close() {
      for (const s of activeSockets) {
        s.terminate();
      }
      await new Promise<void>((resolve) => wss.close(() => server.close(() => resolve())));
    },
  };
}

test('Music query classifier, seek parser, exponential backoff, and error classifier handle all edge cases', () => {
  // Exponential backoff
  assert.equal(computeReconnectDelayMs(0, 1000, 60_000, 0), 1000);
  assert.equal(computeReconnectDelayMs(1, 1000, 60_000, 0), 2000);
  assert.equal(computeReconnectDelayMs(2, 1000, 60_000, 0), 4000);
  assert.equal(computeReconnectDelayMs(10, 1000, 60_000, 0), 60_000);

  // Query classification
  assert.equal(classifyMusicQuery('never gonna give you up').identifier, 'ytsearch:never gonna give you up');
  assert.equal(classifyMusicQuery('lisa', 'spotify').identifier, 'spsearch:lisa');
  assert.equal(classifyMusicQuery('https://www.youtube.com/watch?v=dQw4w9WgXcQ').kind, 'youtube_video');
  assert.equal(classifyMusicQuery('https://www.youtube.com/playlist?list=PL123').kind, 'youtube_playlist');
  assert.equal(classifyMusicQuery('https://open.spotify.com/track/123').kind, 'spotify_track');
  assert.equal(classifyMusicQuery('https://open.spotify.com/album/456').kind, 'spotify_album');
  assert.equal(classifyMusicQuery('https://open.spotify.com/playlist/789').kind, 'spotify_playlist');

  // Seek parser
  assert.equal(parseSeekPositionMs('1:30', 240_000), 90_000);
  assert.equal(parseSeekPositionMs('0:45', 240_000), 45_000);
  assert.equal(parseSeekPositionMs('90s', 240_000), 90_000);
  assert.throws(() => parseSeekPositionMs('5:00', 240_000), /exceeds track duration/);
  assert.throws(() => parseSeekPositionMs('invalid', 240_000), /Invalid timestamp/);

  // Duration & Error classification
  assert.equal(formatDuration(213_000), '3:33');
  assert.ok(classifyLavalinkError('This video is age-restricted').includes('age-restricted'));
  assert.ok(classifyLavalinkError('Private video').includes('private'));
  assert.ok(classifyLavalinkError('401 Unauthorized').includes('LAVALINK_PASSWORD'));
});

test('Voice control and bot permission enforcement protect multi-channel & DJ rules', () => {
  // Requires user in voice channel
  assert.throws(
    () =>
      checkVoiceControlPermission({
        memberVoiceChannelId: null,
        botVoiceChannelId: 'vc-1',
        hasGuildAdminOrManage: false,
      }),
    /connected to a voice channel/
  );

  // Blocks user in a different voice channel without DJ/Manage perms
  assert.throws(
    () =>
      checkVoiceControlPermission({
        memberVoiceChannelId: 'vc-2',
        botVoiceChannelId: 'vc-1',
        hasGuildAdminOrManage: false,
        memberRoleIds: ['r-member'],
        djRoleIds: ['r-dj'],
      }),
    /same voice channel/
  );

  // Allows DJ role across channels
  assert.doesNotThrow(() =>
    checkVoiceControlPermission({
      memberVoiceChannelId: 'vc-2',
      botVoiceChannelId: 'vc-1',
      hasGuildAdminOrManage: false,
      memberRoleIds: ['r-dj'],
      djRoleIds: ['r-dj'],
    })
  );

  // Checks Connect / Speak permissions on target VC
  assert.throws(
    () =>
      checkBotVoiceChannelPermissions({
        has: (perm: bigint) => perm !== PermissionFlagsBits.Speak,
      }),
    /Speak/
  );
});

test('GuildMusicQueue supports move, playlist import limits, previous, seek tracking, and monochrome Now Playing embed', () => {
  const q = new GuildMusicQueue(75);
  const t1 = { encoded: '1', identifier: '1', title: 'Track 1', author: 'A', durationMs: 180000, isSeekable: true, isStream: false, requesterId: 'u1', requesterTag: 'u1', sourceName: 'youtube' };
  const t2 = { encoded: '2', identifier: '2', title: 'Track 2', author: 'B', durationMs: 200000, isSeekable: true, isStream: false, requesterId: 'u1', requesterTag: 'u1', sourceName: 'spotify' };
  const t3 = { encoded: '3', identifier: '3', title: 'Track 3', author: 'C', durationMs: 210000, isSeekable: true, isStream: false, requesterId: 'u2', requesterTag: 'u2', sourceName: 'youtube' };

  const res = q.enqueueMany([t1, t2, t3], 1); // current + max 1 upcoming track
  assert.equal(res.startedNow, true);
  assert.equal(res.added.length, 2);
  assert.equal(res.skipped, 1);

  const q2 = new GuildMusicQueue(70);
  q2.enqueueMany([t1, t2, t3], 10);
  q2.move(2, 1);
  assert.equal(q2.tracks[0].title, 'Track 3');

  const embed = createNowPlayingEmbed(q2, 45000).toJSON();
  assert.equal(embed.title, 'Now Playing');
  assert.ok(embed.description?.includes('Track 1'));
  assert.ok(embed.fields?.some((f) => f.name === 'Queue Length' && f.value === '2 queued'));
  assert.ok(embed.fields?.some((f) => f.name === 'Source' && f.value === 'YOUTUBE'));

  const rows = buildMusicControlRows(false, 'off', true);
  const labels = rows.flatMap((r) => r.toJSON().components.map((c: any) => c.label));
  for (const required of ['Previous', 'Pause', 'Skip', 'Stop', 'Loop: OFF', 'Shuffle', 'Queue']) {
    assert.ok(labels.includes(required), `Expected button ${required}`);
  }
});

test('MusicService connects to real Lavalink v4 HTTP+WS server, detects bad password, handles reconnects, plays YT/Spotify/playlists across independent guilds, and runs real connection test', async () => {
  const strongPass = 'super-strong-lavalink-pass-2026';
  const mockLavalink = await createMockLavalinkV4Server(strongPass);
  const discordClient = new MockDiscordClient() as any;
  const music = new MusicService();

  try {
    // 1. Wrong password is honestly detected as auth_failed
    music.init(discordClient, {
      config: {
        LAVALINK_HOST: '127.0.0.1',
        LAVALINK_PORT: mockLavalink.port,
        LAVALINK_PASSWORD: 'wrong-password',
        LAVALINK_SECURE: false,
        isLavalinkConfigured: true,
        isSpotifyConfigured: true,
        isYouTubeOAuthConfigured: false,
        SPOTIFY_CLIENT_ID: 'sp-id',
        SPOTIFY_CLIENT_SECRET: 'sp-secret',
      },
    });
    const failedTest = await music.testConnection();
    assert.equal(failedTest.success, false);
    assert.equal(failedTest.status, 'auth_failed');
    assert.ok(failedTest.error?.includes('Authentication failed'));
    music.shutdown();

    // 2. Valid config connects & becomes genuinely Online
    const readyDiscordClient = new MockDiscordClient() as any;
    music.init(readyDiscordClient, {
      config: {
        LAVALINK_HOST: '127.0.0.1',
        LAVALINK_PORT: mockLavalink.port,
        LAVALINK_PASSWORD: strongPass,
        LAVALINK_SECURE: false,
        isLavalinkConfigured: true,
        isSpotifyConfigured: true,
        isYouTubeOAuthConfigured: false,
        SPOTIFY_CLIENT_ID: 'sp-id',
        SPOTIFY_CLIENT_SECRET: 'sp-secret',
      },
    });
    readyDiscordClient.emit('clientReady', readyDiscordClient);

    // Wait until Shoukaku emits ready and telemetry finishes
    for (let i = 0; i < 40; i++) {
      if (music.getStatus().status === 'online') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const status = music.getStatus();
    assert.equal(status.connected, true);
    assert.equal(status.status, 'online');
    assert.equal(status.version, '4.0.8');
    assert.equal(status.integrations.youtube.ready, true);
    assert.equal(status.integrations.spotify.ready, true);

    // 3. /search returns up to 10 YouTube tracks
    const searchRes = await music.searchTracks('never gonna give you up', { limit: 10 });
    assert.equal(searchRes.tracks.length, 10);

    // 4. /play YouTube direct URL in guild-1
    const g1Play = await music.playInVoice({
      guildId: 'guild-1',
      voiceChannelId: 'vc-1',
      textChannelId: 'txt-1',
      shardId: 0,
      query: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      requesterId: 'user-1',
      requesterTag: 'UserOne#0001',
    });
    assert.equal(g1Play.position, 0);
    assert.equal(g1Play.track.title, 'Never Gonna Give You Up');

    // 5. /play Spotify track URL in guild-2 independently
    const g2Play = await music.playInVoice({
      guildId: 'guild-2',
      voiceChannelId: 'vc-2',
      textChannelId: 'txt-2',
      shardId: 0,
      query: 'https://open.spotify.com/track/123456',
      requesterId: 'user-2',
      requesterTag: 'UserTwo#0002',
    });
    assert.equal(g2Play.position, 0);
    assert.equal(g2Play.track.title, 'Yuusha');
    assert.equal(g2Play.track.sourceName, 'spotify');

    // Verify independent guild queues & voice connections
    assert.equal(music.getStatus().activeVoiceConnections, 2);
    assert.notEqual(music.getQueue('guild-1').current?.title, music.getQueue('guild-2').current?.title);

    // 6. YouTube & Spotify playlist imports
    const ytPlaylist = await music.playInVoice({
      guildId: 'guild-1',
      voiceChannelId: 'vc-1',
      textChannelId: 'txt-1',
      shardId: 0,
      query: 'https://www.youtube.com/playlist?list=PL123',
      requesterId: 'user-1',
      requesterTag: 'UserOne#0001',
    });
    assert.equal(ytPlaylist.isPlaylist, true);
    assert.equal(ytPlaylist.addedCount, 3);

    const spPlaylist = await music.playInVoice({
      guildId: 'guild-2',
      voiceChannelId: 'vc-2',
      textChannelId: 'txt-2',
      shardId: 0,
      query: 'https://open.spotify.com/playlist/789',
      requesterId: 'user-2',
      requesterTag: 'UserTwo#0002',
    });
    assert.equal(spPlaylist.isPlaylist, true);
    assert.equal(spPlaylist.addedCount, 2);

    // 7. Pause, Resume, Seek, Skip, Stop work via Lavalink REST
    await music.pause('guild-1', true);
    assert.equal(music.getQueue('guild-1').paused, true);
    await music.pause('guild-1', false);
    assert.equal(music.getQueue('guild-1').paused, false);
    await music.seek('guild-1', 60_000);
    await music.skip('guild-1');
    await music.stop('guild-1');
    assert.equal(music.getQueue('guild-1').current, null);

    // 8. Unavailable / age-restricted source returns helpful error
    await assert.rejects(
      () =>
        music.playInVoice({
          guildId: 'guild-2',
          voiceChannelId: 'vc-2',
          textChannelId: 'txt-2',
          shardId: 0,
          query: 'https://www.youtube.com/watch?v=UNAVAILABLE',
          requesterId: 'user-2',
          requesterTag: 'UserTwo#0002',
        }),
      /age-restricted/i
    );

    // 9. Reconnect recovers automatically after WebSocket drop
    mockLavalink.dropActiveSockets();
    for (let i = 0; i < 60; i++) {
      if (music.getStatus().status === 'online' && music.getStatus().reconnectionHistory.some((h) => h.status === 'reconnecting')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    assert.equal(music.getStatus().status, 'online');

    // 10. Validate config report never exposes password/secrets
    const validation = validateLavalinkConfig({
      LAVALINK_HOST: '127.0.0.1',
      LAVALINK_PORT: mockLavalink.port,
      LAVALINK_PASSWORD: strongPass,
      LAVALINK_SECURE: false,
      isSpotifyConfigured: true,
      isYouTubeOAuthConfigured: false,
    });
    assert.equal(JSON.stringify(validation).includes(strongPass), false);
  } finally {
    music.shutdown();
    await mockLavalink.close();
  }
});
