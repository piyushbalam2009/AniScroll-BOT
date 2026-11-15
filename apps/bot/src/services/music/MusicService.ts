import { execFileSync } from 'node:child_process';
import { Client, Message, TextChannel, VoiceState } from 'discord.js';
import {
  Connectors,
  LoadType,
  NodeInfo,
  NodeOption,
  Player,
  Shoukaku,
  Stats,
  Track,
} from 'shoukaku';
import { appConfig, AppError, createModuleLogger, ERROR_CODES } from '../../../../../packages/shared/src';
import {
  classifyLavalinkError,
  classifyMusicQuery,
  computeReconnectDelayMs,
  ConfigValidationItem,
  LAVALINK_STATUS_LABELS,
  LavalinkNodeStatus,
  PreferredMusicSource,
  validateLavalinkConfig,
} from './musicHelpers';

export * from './musicHelpers';

const log = createModuleLogger('MusicService');

export type LoopMode = 'off' | 'track' | 'queue';

export interface QueuedTrack {
  encoded: string;
  identifier: string;
  title: string;
  author: string;
  durationMs: number;
  uri?: string;
  artworkUrl?: string;
  isSeekable: boolean;
  isStream: boolean;
  requesterId: string;
  requesterTag: string;
  sourceName: string;
}

export interface ReconnectionEvent {
  timestamp: string;
  status: LavalinkNodeStatus;
  attempt: number;
  delayMs: number | null;
  message: string;
}

export interface MusicRuntimeConfig {
  LAVALINK_HOST: string;
  LAVALINK_PORT: number;
  LAVALINK_PASSWORD: string;
  LAVALINK_SECURE: boolean;
  isLavalinkConfigured: boolean;
  isSpotifyConfigured: boolean;
  isYouTubeOAuthConfigured: boolean;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
}

export interface NowPlayingRenderHook {
  onTrackChange?: (guildId: string, queue: GuildMusicQueue) => Promise<void> | void;
  onPlaybackStop?: (guildId: string, queue: GuildMusicQueue, reason: string) => Promise<void> | void;
}

let cachedJavaAvailable: boolean | null = null;
function isJavaInstalled(): boolean {
  if (cachedJavaAvailable !== null) return cachedJavaAvailable;
  try {
    execFileSync('java', ['-version'], { stdio: 'ignore', timeout: 1500 });
    cachedJavaAvailable = true;
  } catch {
    cachedJavaAvailable = false;
  }
  return cachedJavaAvailable;
}

export function mapShoukakuTrack(
  track: Track,
  requesterId: string,
  requesterTag: string
): QueuedTrack {
  return {
    encoded: track.encoded,
    identifier: track.info.identifier,
    title: track.info.title || 'Unknown Title',
    author: track.info.author || 'Unknown Artist',
    durationMs: track.info.length || 0,
    uri: track.info.uri,
    artworkUrl: track.info.artworkUrl,
    isSeekable: Boolean(track.info.isSeekable),
    isStream: Boolean(track.info.isStream),
    requesterId,
    requesterTag,
    sourceName: track.info.sourceName || 'unknown',
  };
}

export class GuildMusicQueue {
  public current: QueuedTrack | null = null;
  public tracks: QueuedTrack[] = [];
  public history: QueuedTrack[] = [];
  public loopMode: LoopMode = 'off';
  public volume: number;
  public paused = false;
  public stay247 = false;
  public textChannelId: string | null = null;
  public voiceChannelId: string | null = null;
  public trackStartedAtMs: number | null = null;
  public lastKnownPositionMs = 0;

  constructor(defaultVolume = 65) {
    this.volume = defaultVolume;
  }

  public enqueue(track: QueuedTrack, maxQueueSize = 250): number {
    if (this.tracks.length >= maxQueueSize) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `Queue limit of ${maxQueueSize} tracks reached.`,
        400
      );
    }
    if (!this.current) {
      this.current = track;
      this.paused = false;
      this.trackStartedAtMs = Date.now();
      this.lastKnownPositionMs = 0;
      return 0;
    }
    this.tracks.push(track);
    return this.tracks.length;
  }

  public enqueueMany(
    tracks: QueuedTrack[],
    maxQueueSize = 250
  ): { added: QueuedTrack[]; skipped: number; startedNow: boolean } {
    if (tracks.length === 0) {
      return { added: [], skipped: 0, startedNow: false };
    }
    const added: QueuedTrack[] = [];
    let startedNow = false;
    let skipped = 0;

    for (const track of tracks) {
      if (!this.current) {
        this.current = track;
        this.paused = false;
        this.trackStartedAtMs = Date.now();
        this.lastKnownPositionMs = 0;
        added.push(track);
        startedNow = true;
      } else if (this.tracks.length < maxQueueSize) {
        this.tracks.push(track);
        added.push(track);
      } else {
        skipped += 1;
      }
    }
    return { added, skipped, startedNow };
  }

  public next(): QueuedTrack | null {
    if (this.current) {
      if (this.loopMode === 'track') {
        this.trackStartedAtMs = Date.now();
        this.lastKnownPositionMs = 0;
        return this.current;
      }
      this.history.unshift(this.current);
      if (this.history.length > 50) this.history.pop();
      if (this.loopMode === 'queue') {
        this.tracks.push(this.current);
      }
    }
    const nextTrack = this.tracks.shift() || null;
    this.current = nextTrack;
    this.paused = false;
    this.trackStartedAtMs = nextTrack ? Date.now() : null;
    this.lastKnownPositionMs = 0;
    return nextTrack;
  }

  public previous(): QueuedTrack | null {
    const prev = this.history.shift();
    if (!prev) return null;
    if (this.current) {
      this.tracks.unshift(this.current);
    }
    this.current = prev;
    this.paused = false;
    this.trackStartedAtMs = Date.now();
    this.lastKnownPositionMs = 0;
    return prev;
  }

  public shuffle() {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
  }

  public removeAt(oneBasedIndex: number): QueuedTrack {
    const idx = oneBasedIndex - 1;
    if (idx < 0 || idx >= this.tracks.length) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `Invalid queue position. Enter a number between 1 and ${Math.max(1, this.tracks.length)}.`,
        400
      );
    }
    return this.tracks.splice(idx, 1)[0];
  }

  public move(fromOneBased: number, toOneBased: number): QueuedTrack {
    const fromIdx = fromOneBased - 1;
    const toIdx = toOneBased - 1;
    if (
      fromIdx < 0 ||
      fromIdx >= this.tracks.length ||
      toIdx < 0 ||
      toIdx >= this.tracks.length
    ) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `Queue positions must be between 1 and ${Math.max(1, this.tracks.length)}.`,
        400
      );
    }
    const [moved] = this.tracks.splice(fromIdx, 1);
    this.tracks.splice(toIdx, 0, moved);
    return moved;
  }

  public clear() {
    this.tracks = [];
  }

  public cycleLoop(): LoopMode {
    const order: LoopMode[] = ['off', 'track', 'queue'];
    this.loopMode = order[(order.indexOf(this.loopMode) + 1) % order.length];
    return this.loopMode;
  }

  public setLoop(mode: LoopMode): LoopMode {
    this.loopMode = mode;
    return this.loopMode;
  }
}

export class MusicService {
  private shoukaku: Shoukaku | null = null;
  private client: Client | null = null;
  private config: MusicRuntimeConfig = {
    LAVALINK_HOST: appConfig.LAVALINK_HOST,
    LAVALINK_PORT: appConfig.LAVALINK_PORT,
    LAVALINK_PASSWORD: appConfig.LAVALINK_PASSWORD,
    LAVALINK_SECURE: appConfig.LAVALINK_SECURE,
    isLavalinkConfigured: appConfig.isLavalinkConfigured,
    isSpotifyConfigured: appConfig.isSpotifyConfigured,
    isYouTubeOAuthConfigured: appConfig.isYouTubeOAuthConfigured,
    SPOTIFY_CLIENT_ID: appConfig.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: appConfig.SPOTIFY_CLIENT_SECRET,
  };

  private queues = new Map<string, GuildMusicQueue>();
  private players = new Map<string, Player>();
  private inactivityTimers = new Map<string, NodeJS.Timeout>();
  private emptyDelayByGuild = new Map<string, number>();
  private nowPlayingMessages = new Map<string, Message>();
  private renderHook: NowPlayingRenderHook = {};

  private nodeStatus: LavalinkNodeStatus = 'offline';
  private nodeConnected = false;
  private lastError: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private healthPollTimer: NodeJS.Timeout | null = null;
  private reconnectionHistory: ReconnectionEvent[] = [];
  private nodeInfo: NodeInfo | null = null;
  private nodeStats: Stats | null = null;
  private fetchImpl: typeof fetch = fetch;
  private stopping = false;

  public setRenderHook(hook: NowPlayingRenderHook) {
    this.renderHook = hook;
  }

  public setNowPlayingMessage(guildId: string, message: Message | null) {
    if (message) {
      this.nowPlayingMessages.set(guildId, message);
    } else {
      this.nowPlayingMessages.delete(guildId);
    }
  }

  public getNowPlayingMessage(guildId: string): Message | null {
    return this.nowPlayingMessages.get(guildId) || null;
  }

  private pushHistory(status: LavalinkNodeStatus, message: string, attempt = 0, delayMs: number | null = null) {
    this.reconnectionHistory.unshift({
      timestamp: new Date().toISOString(),
      status,
      attempt,
      delayMs,
      message,
    });
    if (this.reconnectionHistory.length > 20) {
      this.reconnectionHistory.length = 20;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHealthPollTimer() {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = null;
    }
  }

  public init(
    client: Client,
    overrides?: { config?: Partial<MusicRuntimeConfig>; fetchImpl?: typeof fetch }
  ) {
    this.shutdown();
    this.stopping = false;
    this.client = client;
    if (overrides?.fetchImpl) {
      this.fetchImpl = overrides.fetchImpl;
    }
    if (overrides?.config) {
      const c = overrides.config;
      const host = c.LAVALINK_HOST ?? this.config.LAVALINK_HOST;
      const port = c.LAVALINK_PORT ?? this.config.LAVALINK_PORT;
      const password = c.LAVALINK_PASSWORD ?? this.config.LAVALINK_PASSWORD;
      const secure = c.LAVALINK_SECURE ?? this.config.LAVALINK_SECURE;
      const configured = c.isLavalinkConfigured ?? Boolean(host?.trim() && password?.trim());

      this.config = {
        ...this.config,
        ...overrides.config,
        LAVALINK_HOST: host,
        LAVALINK_PORT: port,
        LAVALINK_PASSWORD: password,
        LAVALINK_SECURE: secure,
        isLavalinkConfigured: configured,
      };
    }

    if (!this.config.isLavalinkConfigured || !this.config.LAVALINK_HOST) {
      this.nodeStatus = 'offline';
      this.nodeConnected = false;
      this.lastError =
        'Lavalink v4 is not configured (LAVALINK_HOST or LAVALINK_PASSWORD is missing). Set LAVALINK_HOST, LAVALINK_PORT, and LAVALINK_PASSWORD.';
      this.pushHistory('offline', this.lastError, 0, null);
      log.info({ reason: this.lastError }, 'Lavalink v4 not configured; audio node connection skipped');
      return;
    }

    this.nodeStatus = 'connecting';
    this.nodeConnected = false;
    this.lastError = null;
    this.reconnectAttempt = 0;
    this.pushHistory(
      'connecting',
      `Connecting to Lavalink v4 at ${this.config.LAVALINK_HOST}:${this.config.LAVALINK_PORT}`,
      0,
      null
    );

    const nodes: NodeOption[] = [
      {
        name: 'primary-lavalink-v4',
        url: `${this.config.LAVALINK_HOST}:${this.config.LAVALINK_PORT}`,
        auth: this.config.LAVALINK_PASSWORD,
        secure: this.config.LAVALINK_SECURE,
      },
    ];

    const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
      moveOnDisconnect: false,
      resume: true,
      resumeTimeout: 60,
      resumeByLibrary: true,
      // Keep reconnectTries >= 1 because Shoukaku 4 skips ws initialization when reconnectTries === 0;
      // MusicService manages extended exponential backoff beyond Shoukaku's single initial attempt.
      reconnectTries: 1,
      reconnectInterval: 1,
      restTimeout: 8000,
      voiceConnectionTimeout: 15000,
    });
    this.shoukaku = shoukaku;

    shoukaku.on('ready', async (name, lavalinkResume, libraryResume) => {
      if (this.stopping || this.shoukaku !== shoukaku) return;
      this.clearReconnectTimer();
      this.reconnectAttempt = 0;
      this.nodeConnected = true;
      this.nodeStatus = 'online';
      this.lastError = null;

      await this.refreshNodeTelemetry(name);

      const versionText = this.nodeInfo?.version?.semver || 'v4';
      const pluginNames = (this.nodeInfo?.plugins || []).map((p) => `${p.name}@${p.version}`).join(', ');
      const msg = `Connected to ${name} (Lavalink ${versionText}${pluginNames ? ` · plugins: ${pluginNames}` : ''})`;
      this.pushHistory('online', msg, 0, null);
      log.info(
        {
          node: name,
          version: versionText,
          lavalinkResume,
          libraryResume,
          plugins: this.nodeInfo?.plugins || [],
        },
        'Lavalink v4 node ready'
      );

      this.startHealthPolling(name);
    });

    shoukaku.on('error', (name, error) => {
      if (this.stopping || this.shoukaku !== shoukaku) return;
      const msg = error?.message || String(error);
      const isAuth =
        /\b401\b|\b403\b|unauthorized|forbidden|invalid.*password/i.test(msg);

      this.nodeConnected = false;
      this.clearHealthPollTimer();

      if (isAuth) {
        this.nodeStatus = 'auth_failed';
        this.lastError = `Authentication failed on ${name}: ${msg}. Verify LAVALINK_PASSWORD matches application.yml.`;
        this.clearReconnectTimer();
        this.pushHistory('auth_failed', this.lastError, this.reconnectAttempt, null);
        log.error({ node: name, err: msg }, 'Lavalink v4 authentication failed');
        return;
      }

      this.lastError = msg;
      this.scheduleExponentialReconnect(name, msg);
    });

    shoukaku.on('close', (name, code, reason) => {
      if (this.stopping || this.shoukaku !== shoukaku) {
        this.nodeStatus = 'offline';
        return;
      }
      this.nodeConnected = false;
      this.clearHealthPollTimer();
      const closeReason = `WebSocket closed (code ${code}${reason ? `: ${reason}` : ''})`;
      if (this.nodeStatus !== 'auth_failed') {
        this.lastError = closeReason;
        this.scheduleExponentialReconnect(name, closeReason);
      }
      log.warn({ node: name, code, reason }, 'Lavalink v4 WebSocket closed');
    });

    shoukaku.on('disconnect', (name, count) => {
      if (this.stopping || this.shoukaku !== shoukaku) return;
      this.nodeConnected = false;
      this.clearHealthPollTimer();
      if (this.nodeStatus !== 'auth_failed') {
        this.nodeStatus = 'reconnecting';
        this.scheduleExponentialReconnect(name, `Node ${name} disconnected`);
        log.warn({ node: name, movedPlayers: count }, 'Lavalink v4 node disconnected');
      }
    });
  }

  private scheduleExponentialReconnect(nodeName: string, reason: string) {
    if (this.stopping || !this.shoukaku || this.nodeStatus === 'auth_failed') return;
    if (this.reconnectTimer) return;

    const attempt = this.reconnectAttempt;
    const delayMs = computeReconnectDelayMs(attempt, 1000, 60_000, 0.1);
    this.reconnectAttempt += 1;
    this.nodeStatus = 'reconnecting';
    this.pushHistory(
      'reconnecting',
      `${reason} — retrying in ${(delayMs / 1000).toFixed(1)}s`,
      this.reconnectAttempt,
      delayMs
    );
    log.warn(
      { node: nodeName, attempt: this.reconnectAttempt, delayMs, reason },
      'Scheduling Lavalink v4 exponential backoff reconnect'
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.stopping || !this.shoukaku || this.nodeStatus === 'auth_failed') return;
      this.nodeStatus = 'connecting';
      try {
        const node = this.shoukaku.nodes.get(nodeName);
        if (node) {
          await node.connect();
        } else {
          this.shoukaku.addNode({
            name: nodeName,
            url: `${this.config.LAVALINK_HOST}:${this.config.LAVALINK_PORT}`,
            auth: this.config.LAVALINK_PASSWORD,
            secure: this.config.LAVALINK_SECURE,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.lastError = errMsg;
        this.scheduleExponentialReconnect(nodeName, errMsg);
      }
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private startHealthPolling(nodeName: string) {
    this.clearHealthPollTimer();
    this.healthPollTimer = setInterval(async () => {
      if (this.stopping || !this.nodeConnected) return;
      await this.refreshNodeTelemetry(nodeName);
    }, 30_000);
    this.healthPollTimer.unref?.();
  }

  private async refreshNodeTelemetry(nodeName: string) {
    const node = this.shoukaku?.nodes.get(nodeName);
    if (!node) return;
    try {
      const [info, stats] = await Promise.all([
        node.rest.getLavalinkInfo().catch(() => null),
        node.rest.stats().catch(() => null),
      ]);
      if (info) this.nodeInfo = info;
      if (stats) this.nodeStats = stats;
    } catch {
      // Keep last known info
    }
  }

  public async testConnection(): Promise<{
    success: boolean;
    status: LavalinkNodeStatus;
    statusLabel: string;
    latencyMs: number | null;
    version: string | null;
    plugins: Array<{ name: string; version: string }>;
    sourceManagers: string[];
    spotifyTokenVerified: boolean | null;
    spotifyError: string | null;
    error: string | null;
  }> {
    const started = Date.now();
    const validation = validateLavalinkConfig(this.config);
    const missingRequired = validation.filter((v: any) => v.required && !v.ok);

    if (missingRequired.length > 0) {
      const errMsg = missingRequired.map((m: any) => `${m.key}: ${m.message}`).join(' ');
      this.nodeStatus = 'offline';
      this.nodeConnected = false;
      this.lastError = errMsg;
      this.pushHistory('offline', `Connection test failed: ${errMsg}`, 0, null);
      return {
        success: false,
        status: 'offline',
        statusLabel: LAVALINK_STATUS_LABELS.offline,
        latencyMs: null,
        version: null,
        plugins: [],
        sourceManagers: [],
        spotifyTokenVerified: null,
        spotifyError: null,
        error: errMsg,
      };
    }

    const protocol = this.config.LAVALINK_SECURE ? 'https' : 'http';
    const baseUrl = `${protocol}://${this.config.LAVALINK_HOST}:${this.config.LAVALINK_PORT}`;

    try {
      const infoRes = await this.fetchImpl(`${baseUrl}/v4/info`, {
        headers: {
          Authorization: this.config.LAVALINK_PASSWORD,
        },
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - started;

      if (infoRes.status === 401 || infoRes.status === 403) {
        const errMsg = `Authentication failed (HTTP ${infoRes.status}): LAVALINK_PASSWORD rejected by ${this.config.LAVALINK_HOST}:${this.config.LAVALINK_PORT}.`;
        this.nodeStatus = 'auth_failed';
        this.nodeConnected = false;
        this.lastError = errMsg;
        this.pushHistory('auth_failed', errMsg, 0, null);
        log.warn({ host: this.config.LAVALINK_HOST, port: this.config.LAVALINK_PORT }, errMsg);
        return {
          success: false,
          status: 'auth_failed',
          statusLabel: LAVALINK_STATUS_LABELS.auth_failed,
          latencyMs,
          version: null,
          plugins: [],
          sourceManagers: [],
          spotifyTokenVerified: null,
          spotifyError: null,
          error: errMsg,
        };
      }

      if (!infoRes.ok) {
        const text = await infoRes.text().catch(() => '');
        const errMsg = `Lavalink HTTP ${infoRes.status} at ${baseUrl}/v4/info${text ? `: ${text.slice(0, 160)}` : ''}`;
        this.nodeStatus = 'offline';
        this.lastError = errMsg;
        this.pushHistory('offline', errMsg, 0, null);
        return {
          success: false,
          status: 'offline',
          statusLabel: LAVALINK_STATUS_LABELS.offline,
          latencyMs,
          version: null,
          plugins: [],
          sourceManagers: [],
          spotifyTokenVerified: null,
          spotifyError: null,
          error: errMsg,
        };
      }

      const info = (await infoRes.json()) as NodeInfo;
      this.nodeInfo = info;

      const statsRes = await this.fetchImpl(`${baseUrl}/v4/stats`, {
        headers: { Authorization: this.config.LAVALINK_PASSWORD },
        signal: AbortSignal.timeout(4000),
      }).catch(() => null);
      if (statsRes && statsRes.ok) {
        this.nodeStats = (await statsRes.json().catch(() => null)) as Stats | null;
      }

      let spotifyTokenVerified: boolean | null = null;
      let spotifyError: string | null = null;
      if (this.config.isSpotifyConfigured && this.config.SPOTIFY_CLIENT_ID && this.config.SPOTIFY_CLIENT_SECRET) {
        try {
          const basic = Buffer.from(
            `${this.config.SPOTIFY_CLIENT_ID}:${this.config.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64');
          const spRes = await this.fetchImpl('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
              Authorization: `Basic ${basic}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
            signal: AbortSignal.timeout(5000),
          });
          spotifyTokenVerified = spRes.ok;
          if (!spRes.ok) {
            spotifyError = `Spotify API rejected credentials (HTTP ${spRes.status}).`;
          }
        } catch (spErr) {
          spotifyTokenVerified = false;
          spotifyError = spErr instanceof Error ? spErr.message : 'Spotify API unreachable';
        }
      }

      // If WebSocket is currently not connected yet, trigger a connect attempt now that REST succeeded
      if (this.shoukaku && !this.nodeConnected) {
        const node = this.shoukaku.nodes.get('primary-lavalink-v4');
        if (node && this.nodeStatus === 'auth_failed') {
          this.nodeStatus = 'connecting';
          node.connect().catch(() => undefined);
        }
      }

      const effectiveStatus: LavalinkNodeStatus = this.nodeConnected ? 'online' : this.nodeStatus;
      const version = info.version?.semver || null;
      this.pushHistory(
        effectiveStatus,
        `REST health check succeeded (${latencyMs}ms · Lavalink ${version || 'v4'})`,
        0,
        null
      );

      return {
        success: true,
        status: effectiveStatus,
        statusLabel: LAVALINK_STATUS_LABELS[effectiveStatus],
        latencyMs,
        version,
        plugins: info.plugins || [],
        sourceManagers: info.sourceManagers || [],
        spotifyTokenVerified,
        spotifyError,
        error: this.nodeConnected
          ? null
          : 'Lavalink REST responded, waiting for Discord Gateway + Shoukaku WebSocket session readiness.',
      };
    } catch (err) {
      const causeMsg =
        err instanceof Error && 'cause' in err && (err as any).cause?.message
          ? `${err.message} (${(err as any).cause.message})`
          : err instanceof Error
            ? err.message
            : String(err);
      const errMsg = `Could not reach Lavalink v4 at ${baseUrl}: ${causeMsg}`;
      this.nodeConnected = false;
      if (this.nodeStatus !== 'reconnecting') {
        this.nodeStatus = 'offline';
      }
      this.lastError = errMsg;
      this.pushHistory(this.nodeStatus, errMsg, this.reconnectAttempt, null);
      log.warn({ baseUrl, err: errMsg }, 'Lavalink v4 health check failed');
      return {
        success: false,
        status: this.nodeStatus,
        statusLabel: LAVALINK_STATUS_LABELS[this.nodeStatus],
        latencyMs: Date.now() - started,
        version: null,
        plugins: [],
        sourceManagers: [],
        spotifyTokenVerified: null,
        spotifyError: null,
        error: errMsg,
      };
    }
  }

  public getStatus() {
    const totalQueuedTracks = Array.from(this.queues.values()).reduce(
      (sum, q) => sum + q.tracks.length,
      0
    );
    const activePlayers = Array.from(this.queues.values()).filter((q) => Boolean(q.current)).length;
    const activeVoiceConnections = this.players.size;

    const plugins = this.nodeInfo?.plugins || [];
    const sourceManagers = this.nodeInfo?.sourceManagers || [];
    const ytPluginLoaded = plugins.some((p) => /youtube/i.test(p.name));
    const lavasrcLoaded = plugins.some((p) => /lavasrc/i.test(p.name));
    const lavasearchLoaded = plugins.some((p) => /lavasearch/i.test(p.name));
    const spotifySourceActive = sourceManagers.some((s) => /spotify/i.test(s));
    const ytSourceActive = sourceManagers.some((s) => /youtube/i.test(s));

    const configValidation: ConfigValidationItem[] = validateLavalinkConfig(this.config);
    const javaInstalled = isJavaInstalled();

    return {
      configured: this.config.isLavalinkConfigured,
      connected: this.nodeConnected,
      status: this.nodeStatus,
      statusLabel: LAVALINK_STATUS_LABELS[this.nodeStatus],
      host: this.config.LAVALINK_HOST || null,
      port: this.config.LAVALINK_PORT,
      secure: this.config.LAVALINK_SECURE,
      version: this.nodeInfo?.version?.semver || null,
      activeNode: this.nodeConnected
        ? {
            name: 'primary-lavalink-v4',
            sessionId: this.shoukaku?.nodes.get('primary-lavalink-v4')?.sessionId || null,
            jvm: this.nodeInfo?.jvm || null,
            lavaplayer: this.nodeInfo?.lavaplayer || null,
            uptimeMs: this.nodeStats?.uptime ?? null,
            cpuLoad: this.nodeStats?.cpu?.lavalinkLoad ?? null,
            memoryUsedMb: this.nodeStats?.memory
              ? Math.round(this.nodeStats.memory.used / (1024 * 1024))
              : null,
            memoryAllocatedMb: this.nodeStats?.memory
              ? Math.round(this.nodeStats.memory.allocated / (1024 * 1024))
              : null,
            plugins,
            sourceManagers,
          }
        : null,
      playerCount: this.nodeStats?.players ?? activePlayers,
      playingPlayerCount: this.nodeStats?.playingPlayers ?? activePlayers,
      activeVoiceConnections,
      totalQueuedTracks,
      activeGuildQueues: this.queues.size,
      integrations: {
        youtube: {
          ready: this.nodeConnected && (ytPluginLoaded || ytSourceActive),
          pluginLoaded: ytPluginLoaded,
          oauthConfigured: this.config.isYouTubeOAuthConfigured,
          statusText: !this.nodeConnected
            ? 'Offline (Lavalink node disconnected)'
            : ytPluginLoaded || ytSourceActive
              ? 'Ready (youtube-plugin active)'
              : 'youtube-plugin not detected on node',
        },
        spotify: {
          ready:
            this.nodeConnected &&
            (lavasrcLoaded || spotifySourceActive) &&
            this.config.isSpotifyConfigured,
          pluginLoaded: lavasrcLoaded,
          credentialsConfigured: this.config.isSpotifyConfigured,
          statusText: !this.nodeConnected
            ? 'Offline (Lavalink node disconnected)'
            : !this.config.isSpotifyConfigured
              ? 'Credentials missing (SPOTIFY_CLIENT_ID / SECRET)'
              : lavasrcLoaded || spotifySourceActive
                ? 'Ready (LavaSrc + Spotify API)'
                : 'LavaSrc plugin not detected on node',
        },
        lavasearch: {
          pluginLoaded: lavasearchLoaded,
        },
      },
      lastError: this.lastError,
      reconnectionHistory: this.reconnectionHistory,
      configValidation,
      environmentSupport: {
        javaInstalled,
        note: javaInstalled
          ? 'Java runtime detected locally.'
          : 'No local Java 17+ runtime in this dashboard container; deploy Lavalink v4 via infrastructure/lavalink/Dockerfile or docker-compose.yml on a persistent host.',
      },
    };
  }

  public getQueue(guildId: string, defaultVolume = 65): GuildMusicQueue {
    let q = this.queues.get(guildId);
    if (!q) {
      q = new GuildMusicQueue(defaultVolume);
      this.queues.set(guildId, q);
    }
    return q;
  }

  public getPlayer(guildId: string): Player | null {
    return this.players.get(guildId) || null;
  }

  public getLivePositionMs(guildId: string): number {
    const player = this.players.get(guildId);
    const queue = this.queues.get(guildId);
    if (player && Number.isFinite(player.position) && player.position > 0) {
      return player.position;
    }
    if (!queue?.current) return 0;
    if (queue.paused) return queue.lastKnownPositionMs;
    if (queue.trackStartedAtMs) {
      return Math.min(queue.current.durationMs || 0, Date.now() - queue.trackStartedAtMs);
    }
    return queue.lastKnownPositionMs;
  }

  private requireNode() {
    if (!this.config.isLavalinkConfigured) {
      throw new AppError(
        ERROR_CODES.LAVALINK_DISCONNECTED,
        'Music playback is unavailable because Lavalink v4 is not configured (`LAVALINK_HOST` / `LAVALINK_PASSWORD`).',
        503
      );
    }
    if (this.nodeStatus === 'auth_failed') {
      throw new AppError(
        ERROR_CODES.LAVALINK_DISCONNECTED,
        'Music playback is unavailable because Lavalink v4 authentication failed (`LAVALINK_PASSWORD` rejected).',
        503
      );
    }
    if (!this.shoukaku || !this.nodeConnected) {
      const detail = this.lastError ? ` (${this.lastError})` : '';
      throw new AppError(
        ERROR_CODES.LAVALINK_DISCONNECTED,
        `Music playback is unavailable because the Lavalink v4 audio node is currently offline${detail}.`,
        503
      );
    }
    const node = this.shoukaku.options.nodeResolver(this.shoukaku.nodes);
    if (!node) {
      throw new AppError(
        ERROR_CODES.LAVALINK_DISCONNECTED,
        'No active Lavalink v4 audio node is available.',
        503
      );
    }
    return node;
  }

  public async searchTracks(
    query: string,
    options?: { source?: PreferredMusicSource; limit?: number }
  ): Promise<{
    loadType: LoadType;
    playlistName: string | null;
    tracks: Track[];
    classified: ReturnType<typeof classifyMusicQuery>;
  }> {
    const node = this.requireNode();
    const classified = classifyMusicQuery(query, options?.source || 'auto');

    if (classified.requiresSpotify) {
      const plugins = this.nodeInfo?.plugins || [];
      const sourceManagers = this.nodeInfo?.sourceManagers || [];
      const hasSpotify =
        plugins.some((p) => /lavasrc/i.test(p.name)) ||
        sourceManagers.some((s) => /spotify/i.test(s));
      if (this.nodeInfo && !hasSpotify) {
        throw new AppError(
          ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE,
          'Spotify playback requires the **LavaSrc** plugin (`lavasrc-plugin`) on the Lavalink v4 server.',
          503
        );
      }
      if (!this.config.isSpotifyConfigured) {
        throw new AppError(
          ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE,
          'Spotify search and URLs require `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` configured on the bot and Lavalink server.',
          400
        );
      }
    }

    let result;
    try {
      result = await node.rest.resolve(classified.identifier);
    } catch (err) {
      const friendly = classifyLavalinkError(err, classified);
      log.warn({ query, identifier: classified.identifier, err: String(err) }, 'Lavalink v4 resolve failed');
      throw new AppError(ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE, friendly, 502);
    }

    if (!result || result.loadType === LoadType.EMPTY) {
      throw new AppError(
        ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE,
        classified.requiresSpotify
          ? 'No matching Spotify track or playable audio match was found for that query.'
          : 'No compatible tracks were found for that query.',
        404
      );
    }

    if (result.loadType === LoadType.ERROR) {
      const friendly = classifyLavalinkError(result.data, classified);
      throw new AppError(ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE, friendly, 422);
    }

    if (result.loadType === LoadType.TRACK) {
      return {
        loadType: LoadType.TRACK,
        playlistName: null,
        tracks: [result.data],
        classified,
      };
    }

    if (result.loadType === LoadType.PLAYLIST) {
      if (!result.data.tracks.length) {
        throw new AppError(
          ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE,
          'The requested playlist or album contains no playable tracks.',
          404
        );
      }
      return {
        loadType: LoadType.PLAYLIST,
        playlistName: result.data.info?.name || 'Playlist',
        tracks: result.data.tracks,
        classified,
      };
    }

    if (result.loadType === LoadType.SEARCH) {
      const limit = options?.limit ?? 10;
      return {
        loadType: LoadType.SEARCH,
        playlistName: null,
        tracks: result.data.slice(0, limit),
        classified,
      };
    }

    return {
      loadType: LoadType.EMPTY,
      playlistName: null,
      tracks: [],
      classified,
    };
  }

  private clearInactivityTimer(guildId: string) {
    const existing = this.inactivityTimers.get(guildId);
    if (existing) {
      clearTimeout(existing);
      this.inactivityTimers.delete(guildId);
    }
  }

  public scheduleInactivityDisconnect(guildId: string, delaySeconds?: number) {
    this.clearInactivityTimer(guildId);
    const queue = this.getQueue(guildId);
    if (queue.stay247) return;
    const effectiveSeconds = delaySeconds ?? this.emptyDelayByGuild.get(guildId) ?? 180;
    if (effectiveSeconds <= 0) return;

    const timer = setTimeout(async () => {
      this.inactivityTimers.delete(guildId);
      const currentQueue = this.queues.get(guildId);
      if (!currentQueue || currentQueue.stay247) return;
      await this.leaveVoice(guildId, 'Disconnected due to voice channel inactivity.');
    }, effectiveSeconds * 1000);
    timer.unref?.();
    this.inactivityTimers.set(guildId, timer);
  }

  private async ensurePlayer(options: {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    shardId: number;
    defaultVolume?: number;
    emptyLeaveDelaySeconds?: number;
  }): Promise<{ player: Player; queue: GuildMusicQueue }> {
    this.requireNode();
    const queue = this.getQueue(options.guildId, options.defaultVolume ?? 65);
    queue.textChannelId = options.textChannelId;
    queue.voiceChannelId = options.voiceChannelId;
    if (options.emptyLeaveDelaySeconds !== undefined) {
      this.emptyDelayByGuild.set(options.guildId, options.emptyLeaveDelaySeconds);
    }
    this.clearInactivityTimer(options.guildId);

    let player = this.players.get(options.guildId);
    if (!player) {
      try {
        player = await this.shoukaku!.joinVoiceChannel({
          guildId: options.guildId,
          channelId: options.voiceChannelId,
          shardId: options.shardId,
          deaf: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ guildId: options.guildId, voiceChannelId: options.voiceChannelId, err: msg }, 'Voice channel join failed');
        throw new AppError(
          ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE,
          `Failed to join voice channel: ${msg}`,
          500
        );
      }

      this.players.set(options.guildId, player);
      await player.setGlobalVolume(queue.volume).catch(() => undefined);

      player.on('start', async () => {
        this.clearInactivityTimer(options.guildId);
        queue.trackStartedAtMs = Date.now();
        queue.lastKnownPositionMs = 0;
        await this.renderHook.onTrackChange?.(options.guildId, queue);
      });

      player.on('end', async (event) => {
        if (event.reason === 'replaced') return;
        const next = queue.next();
        if (next && this.players.has(options.guildId)) {
          try {
            await player!.playTrack({ track: { encoded: next.encoded } });
          } catch (err) {
            log.warn({ guildId: options.guildId, err: String(err) }, 'Failed to advance to next track');
          }
        } else {
          this.scheduleInactivityDisconnect(options.guildId);
          await this.renderHook.onPlaybackStop?.(
            options.guildId,
            queue,
            'Queue finished.'
          );
        }
      });

      player.on('exception', async (event) => {
        const friendly = classifyLavalinkError(event.exception);
        log.warn(
          { guildId: options.guildId, track: queue.current?.title, exception: event.exception },
          'Lavalink v4 track exception'
        );
        await this.notifyTextChannel(
          queue.textChannelId,
          `Track playback error for **${queue.current?.title || 'current track'}**: ${friendly}`
        );
        const next = queue.next();
        if (next && this.players.has(options.guildId)) {
          await player!.playTrack({ track: { encoded: next.encoded } }).catch(() => undefined);
        } else {
          this.scheduleInactivityDisconnect(options.guildId);
        }
      });

      player.on('stuck', async (event) => {
        log.warn(
          { guildId: options.guildId, thresholdMs: event.thresholdMs, track: queue.current?.title },
          'Track stuck; advancing queue'
        );
        const next = queue.next();
        if (next && this.players.has(options.guildId)) {
          await player!.playTrack({ track: { encoded: next.encoded } }).catch(() => undefined);
        }
      });

      player.on('closed', async (event) => {
        log.warn(
          { guildId: options.guildId, code: event.code, byRemote: event.byRemote, reason: event.reason },
          'Discord voice WebSocket closed'
        );
        // 4014 = kicked/disconnected by user/admin; clean up local state
        if (event.code === 4014 || event.code === 4006) {
          await this.cleanupGuildPlayer(options.guildId, 'Disconnected from voice channel.');
        }
      });
    }

    return { player, queue };
  }

  private async notifyTextChannel(channelId: string | null, content: string) {
    if (!channelId || !this.client) return;
    try {
      const ch = await this.client.channels.fetch(channelId).catch(() => null);
      if (ch && ch.isTextBased()) {
        await (ch as TextChannel).send(content).catch(() => undefined);
      }
    } catch {
      // Ignore notification delivery errors
    }
  }

  public async playInVoice(options: {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    shardId: number;
    query?: string;
    preResolvedTracks?: Track[];
    playlistName?: string | null;
    source?: PreferredMusicSource;
    requesterId: string;
    requesterTag: string;
    defaultVolume?: number;
    maxQueueSize?: number;
    emptyLeaveDelaySeconds?: number;
  }) {
    this.requireNode();
    let tracksToQueue: Track[] = options.preResolvedTracks || [];
    let isPlaylist = false;
    let playlistName: string | null = options.playlistName ?? null;

    if (tracksToQueue.length === 0) {
      if (!options.query) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Missing query or track selection.', 400);
      }
      const resolved = await this.searchTracks(options.query, { source: options.source, limit: 1 });
      if (resolved.tracks.length === 0) {
        throw new AppError(ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE, 'No playable tracks found.', 404);
      }
      if (resolved.loadType === LoadType.PLAYLIST) {
        isPlaylist = true;
        playlistName = resolved.playlistName;
        tracksToQueue = resolved.tracks;
      } else {
        tracksToQueue = [resolved.tracks[0]];
      }
    }

    const { player, queue } = await this.ensurePlayer(options);
    const maxQ = options.maxQueueSize ?? 250;

    if (isPlaylist || tracksToQueue.length > 1) {
      const mappedList = tracksToQueue.map((t) =>
        mapShoukakuTrack(t, options.requesterId, options.requesterTag)
      );
      const { added, skipped, startedNow } = queue.enqueueMany(mappedList, maxQ);
      if (added.length === 0) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          `Queue limit of ${maxQ} tracks reached; could not import playlist tracks.`,
          400
        );
      }
      if (startedNow) {
        await player.playTrack({ track: { encoded: added[0].encoded } });
      }
      return {
        track: added[0],
        addedCount: added.length,
        skippedDueToLimit: skipped,
        isPlaylist: true,
        playlistName,
        position: startedNow ? 0 : Math.max(1, queue.tracks.length - added.length + 1),
        queue,
      };
    }

    const mapped = mapShoukakuTrack(tracksToQueue[0], options.requesterId, options.requesterTag);
    const wasIdle = !queue.current;
    const position = queue.enqueue(mapped, maxQ);
    if (wasIdle) {
      await player.playTrack({ track: { encoded: mapped.encoded } });
    }
    return {
      track: mapped,
      addedCount: 1,
      skippedDueToLimit: 0,
      isPlaylist: false,
      playlistName: null,
      position,
      queue,
    };
  }

  public async pause(guildId: string, paused: boolean) {
    const queue = this.getQueue(guildId);
    const player = this.players.get(guildId);
    if (!player || !queue.current) {
      throw new AppError(ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE, 'Nothing is currently playing.', 400);
    }
    await player.setPaused(paused);
    if (paused) {
      queue.lastKnownPositionMs = this.getLivePositionMs(guildId);
    } else if (queue.trackStartedAtMs) {
      queue.trackStartedAtMs = Date.now() - queue.lastKnownPositionMs;
    }
    queue.paused = paused;
    return queue;
  }

  public async skip(guildId: string) {
    const queue = this.getQueue(guildId);
    const player = this.players.get(guildId);
    if (!player || !queue.current) {
      throw new AppError(ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE, 'Nothing is currently playing.', 400);
    }
    await player.stopTrack();
    return queue;
  }

  public async previous(guildId: string) {
    const queue = this.getQueue(guildId);
    const player = this.players.get(guildId);
    if (!player) {
      throw new AppError(ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE, 'No active voice player in this server.', 400);
    }
    const prev = queue.previous();
    if (!prev) {
      throw new AppError(ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE, 'No previous track in history.', 400);
    }
    await player.playTrack({ track: { encoded: prev.encoded } });
    return { track: prev, queue };
  }

  public async seek(guildId: string, positionMs: number) {
    const queue = this.getQueue(guildId);
    const player = this.players.get(guildId);
    if (!player || !queue.current) {
      throw new AppError(ERROR_CODES.MUSIC_SOURCE_UNAVAILABLE, 'Nothing is currently playing.', 400);
    }
    if (!queue.current.isSeekable || queue.current.isStream) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'The current track does not support seeking.', 400);
    }
    await player.seekTo(positionMs);
    queue.lastKnownPositionMs = positionMs;
    queue.trackStartedAtMs = Date.now() - positionMs;
    return queue;
  }

  public async stop(guildId: string) {
    const queue = this.getQueue(guildId);
    queue.clear();
    queue.current = null;
    queue.paused = false;
    queue.trackStartedAtMs = null;
    queue.lastKnownPositionMs = 0;
    const player = this.players.get(guildId);
    if (player) {
      await player.stopTrack().catch(() => undefined);
      if (!queue.stay247 && this.shoukaku) {
        await this.shoukaku.leaveVoiceChannel(guildId).catch(() => undefined);
        this.players.delete(guildId);
        queue.voiceChannelId = null;
      } else if (queue.stay247) {
        // Stay connected if 24/7 mode is enabled
      } else {
        this.scheduleInactivityDisconnect(guildId);
      }
    }
    this.clearInactivityTimer(guildId);
    return queue;
  }

  public async leaveVoice(guildId: string, reason?: string) {
    return this.cleanupGuildPlayer(guildId, reason);
  }

  private async cleanupGuildPlayer(guildId: string, reason?: string) {
    this.clearInactivityTimer(guildId);
    const queue = this.getQueue(guildId);
    queue.clear();
    queue.current = null;
    queue.paused = false;
    queue.trackStartedAtMs = null;
    queue.lastKnownPositionMs = 0;
    queue.voiceChannelId = null;

    const player = this.players.get(guildId);
    if (player) {
      await player.stopTrack().catch(() => undefined);
      this.players.delete(guildId);
    }
    if (this.shoukaku) {
      await this.shoukaku.leaveVoiceChannel(guildId).catch(() => undefined);
    }
    if (reason) {
      await this.renderHook.onPlaybackStop?.(guildId, queue, reason);
    }
    return queue;
  }

  public async setVolume(guildId: string, volume: number, maxVolume = 120) {
    const clamped = Math.max(0, Math.min(maxVolume, volume));
    const queue = this.getQueue(guildId);
    queue.volume = clamped;
    const player = this.players.get(guildId);
    if (player) {
      await player.setGlobalVolume(clamped);
    }
    return clamped;
  }

  public handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
    const guildId = newState.guild.id || oldState.guild.id;
    const queue = this.queues.get(guildId);
    if (!queue || !queue.voiceChannelId) return;

    const botUserId = this.client?.user?.id;
    // Bot was moved or disconnected by an admin
    if (botUserId && newState.id === botUserId) {
      if (!newState.channelId) {
        void this.cleanupGuildPlayer(guildId, 'Bot was disconnected from voice channel.');
        return;
      }
      queue.voiceChannelId = newState.channelId;
    }

    const channel = newState.guild.channels.cache.get(queue.voiceChannelId) || oldState.channel;
    if (!channel || !('members' in channel)) return;
    const humanListeners = (channel.members as Map<string, any>).size
      ? Array.from((channel.members as Map<string, any>).values()).filter((m) => !m.user?.bot).length
      : 0;

    if (humanListeners === 0 && !queue.stay247) {
      this.scheduleInactivityDisconnect(guildId);
    } else if (humanListeners > 0) {
      this.clearInactivityTimer(guildId);
    }
  }

  public shutdown() {
    this.stopping = true;
    this.clearReconnectTimer();
    this.clearHealthPollTimer();
    for (const timer of this.inactivityTimers.values()) {
      clearTimeout(timer);
    }
    this.inactivityTimers.clear();
    if (this.shoukaku) {
      const old = this.shoukaku;
      this.shoukaku = null;
      old.removeAllListeners();
      old.on('error', () => undefined);
      for (const node of old.nodes.values()) {
        try {
          node.disconnect(1000, 'Shutdown');
        } catch {
          // ignore
        }
      }
    }
    this.players.clear();
    this.nodeConnected = false;
    this.nodeStatus = 'offline';
  }
}

let sharedMusic: MusicService | null = null;
export function getMusicService(): MusicService {
  if (!sharedMusic) sharedMusic = new MusicService();
  return sharedMusic;
}
