import { PermissionFlagsBits } from 'discord.js';
import { AppError, ERROR_CODES } from '../../../../../packages/shared/src';

export type LavalinkNodeStatus =
  | 'online'
  | 'connecting'
  | 'offline'
  | 'reconnecting'
  | 'auth_failed';

export const LAVALINK_STATUS_LABELS: Record<LavalinkNodeStatus, string> = {
  online: 'Online',
  connecting: 'Connecting',
  offline: 'Offline',
  reconnecting: 'Reconnecting',
  auth_failed: 'Authentication failed',
};

export type PreferredMusicSource = 'auto' | 'youtube' | 'spotify' | 'soundcloud';

export interface ClassifiedQuery {
  kind:
    | 'youtube_video'
    | 'youtube_playlist'
    | 'spotify_track'
    | 'spotify_album'
    | 'spotify_playlist'
    | 'spotify_artist'
    | 'url'
    | 'search';
  identifier: string;
  sourceFamily: 'youtube' | 'spotify' | 'soundcloud' | 'http';
  isPlaylist: boolean;
  requiresSpotify: boolean;
  requiresYouTube: boolean;
}

export function computeReconnectDelayMs(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 60_000,
  jitterFactor = 0
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const raw = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, safeAttempt));
  const jitter = jitterFactor > 0 ? Math.round(raw * jitterFactor) : 0;
  return Math.min(maxDelayMs, raw + jitter);
}

export function classifyMusicQuery(
  rawQuery: string,
  preferredSource: PreferredMusicSource = 'auto'
): ClassifiedQuery {
  const query = rawQuery.trim();
  if (!query) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Please enter a song title or media URL.', 400);
  }

  // Explicit Lavalink search prefixes
  if (/^(ytsearch|ytmsearch|spsearch|scsearch):/i.test(query)) {
    const lower = query.toLowerCase();
    const isSpotify = lower.startsWith('spsearch:');
    const isSoundCloud = lower.startsWith('scsearch:');
    return {
      kind: 'search',
      identifier: query,
      sourceFamily: isSpotify ? 'spotify' : isSoundCloud ? 'soundcloud' : 'youtube',
      isPlaylist: false,
      requiresSpotify: isSpotify,
      requiresYouTube: !isSpotify && !isSoundCloud,
    };
  }

  // Spotify URI syntax e.g. spotify:track:xxx
  const spotifyUriMatch = /^spotify:(track|album|playlist|artist):[a-zA-Z0-9]+$/i.exec(query);
  if (spotifyUriMatch) {
    const type = spotifyUriMatch[1].toLowerCase();
    const kind = (`spotify_${type}` as ClassifiedQuery['kind']);
    return {
      kind,
      identifier: query,
      sourceFamily: 'spotify',
      isPlaylist: type === 'album' || type === 'playlist' || type === 'artist',
      requiresSpotify: true,
      requiresYouTube: false,
    };
  }

  // HTTP(S) URL classification
  if (/^https?:\/\//i.test(query)) {
    let parsed: URL;
    try {
      parsed = new URL(query);
    } catch {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'The provided URL is not valid.', 400);
    }

    const host = parsed.hostname.toLowerCase();
    if (host.includes('open.spotify.com')) {
      const path = parsed.pathname.toLowerCase();
      if (path.includes('/playlist/')) {
        return {
          kind: 'spotify_playlist',
          identifier: query,
          sourceFamily: 'spotify',
          isPlaylist: true,
          requiresSpotify: true,
          requiresYouTube: false,
        };
      }
      if (path.includes('/album/')) {
        return {
          kind: 'spotify_album',
          identifier: query,
          sourceFamily: 'spotify',
          isPlaylist: true,
          requiresSpotify: true,
          requiresYouTube: false,
        };
      }
      if (path.includes('/artist/')) {
        return {
          kind: 'spotify_artist',
          identifier: query,
          sourceFamily: 'spotify',
          isPlaylist: true,
          requiresSpotify: true,
          requiresYouTube: false,
        };
      }
      return {
        kind: 'spotify_track',
        identifier: query,
        sourceFamily: 'spotify',
        isPlaylist: false,
        requiresSpotify: true,
        requiresYouTube: false,
      };
    }

    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const hasList = Boolean(parsed.searchParams.get('list'));
      const isPlaylistPage = parsed.pathname.toLowerCase().includes('/playlist');
      return {
        kind: isPlaylistPage || hasList ? 'youtube_playlist' : 'youtube_video',
        identifier: query,
        sourceFamily: 'youtube',
        isPlaylist: isPlaylistPage || hasList,
        requiresSpotify: false,
        requiresYouTube: true,
      };
    }

    return {
      kind: 'url',
      identifier: query,
      sourceFamily: host.includes('soundcloud.com') ? 'soundcloud' : 'http',
      isPlaylist: false,
      requiresSpotify: false,
      requiresYouTube: false,
    };
  }

  // Plain-text search query
  if (preferredSource === 'spotify') {
    return {
      kind: 'search',
      identifier: `spsearch:${query}`,
      sourceFamily: 'spotify',
      isPlaylist: false,
      requiresSpotify: true,
      requiresYouTube: false,
    };
  }
  if (preferredSource === 'soundcloud') {
    return {
      kind: 'search',
      identifier: `scsearch:${query}`,
      sourceFamily: 'soundcloud',
      isPlaylist: false,
      requiresSpotify: false,
      requiresYouTube: false,
    };
  }

  return {
    kind: 'search',
    identifier: `ytsearch:${query}`,
    sourceFamily: 'youtube',
    isPlaylist: false,
    requiresSpotify: false,
    requiresYouTube: true,
  };
}

export function formatDuration(ms: number | null | undefined, isStream = false): string {
  if (isStream) return 'LIVE';
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function buildProgressBar(positionMs: number, durationMs: number, length = 14): string {
  if (!durationMs || durationMs <= 0) return `[${'─'.repeat(length)}]`;
  const clamped = Math.max(0, Math.min(durationMs, positionMs));
  const ratio = clamped / durationMs;
  const knobIndex = Math.min(length - 1, Math.max(0, Math.round(ratio * (length - 1))));
  const left = '━'.repeat(knobIndex);
  const right = '─'.repeat(Math.max(0, length - 1 - knobIndex));
  return `[${left}●${right}]`;
}

export function parseSeekPositionMs(input: string, durationMs: number): number {
  const raw = input.trim().toLowerCase();
  if (!raw) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Specify a seek timestamp (e.g. `1:30` or `90`).', 400);
  }

  let totalSeconds = 0;
  if (/^\d+s?$/.test(raw)) {
    totalSeconds = Number(raw.replace(/s$/, ''));
  } else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
    const parts = raw.split(':').map((n) => Number(n));
    if (parts.length === 2) {
      const [m, s] = parts;
      if (s >= 60) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Seconds in `mm:ss` must be less than 60.', 400);
      }
      totalSeconds = m * 60 + s;
    } else {
      const [h, m, s] = parts;
      if (m >= 60 || s >= 60) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Minutes and seconds in `hh:mm:ss` must be less than 60.', 400);
      }
      totalSeconds = h * 3600 + m * 60 + s;
    }
  } else {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'Invalid timestamp format. Use seconds (`90`) or `mm:ss` (`1:30`).',
      400
    );
  }

  const ms = totalSeconds * 1000;
  if (durationMs > 0 && ms >= durationMs) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Seek position exceeds track duration (${formatDuration(durationMs)}).`,
      400
    );
  }
  return ms;
}

export function classifyLavalinkError(errOrMessage: unknown, classified?: ClassifiedQuery): string {
  const raw =
    typeof errOrMessage === 'string'
      ? errOrMessage
      : errOrMessage instanceof Error
        ? errOrMessage.message
        : typeof errOrMessage === 'object' && errOrMessage !== null && 'message' in errOrMessage
          ? String((errOrMessage as { message?: unknown }).message || 'Unknown audio error')
          : String(errOrMessage || 'Unknown audio error');

  const msg = raw.toLowerCase();

  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('invalid password')) {
    if (msg.includes('spotify')) {
      return 'Spotify metadata lookup failed. Verify `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` on Lavalink v4.';
    }
    return 'Lavalink v4 authentication failed. Verify `LAVALINK_PASSWORD` matches your Lavalink server configuration.';
  }
  if (msg.includes('age') && (msg.includes('restrict') || msg.includes('confirm'))) {
    return 'This video is age-restricted on YouTube and cannot be played without authorized YouTube credentials.';
  }
  if (msg.includes('private') || msg.includes('sign in to confirm')) {
    return 'This track/video is private or requires YouTube authentication.';
  }
  if (msg.includes('country') || msg.includes('geo') || msg.includes('region') || msg.includes('not available in your')) {
    return 'This track is region-restricted and unavailable from the audio server location.';
  }
  if (msg.includes('deleted') || msg.includes('removed') || msg.includes('unavailable') || msg.includes('not found')) {
    return 'This track or video is unavailable, deleted, or private.';
  }
  if (msg.includes('spotify') || (classified?.requiresSpotify && (msg.includes('no matches') || msg.includes('empty')))) {
    return 'Spotify track could not be resolved or matched to an available playable source. Verify Spotify credentials.';
  }
  if (msg.includes('copyright') || msg.includes('blocked')) {
    return 'This track is blocked by copyright or publisher restrictions.';
  }
  if (classified?.requiresYouTube && (msg.includes('extract') || msg.includes('cipher') || msg.includes('signature'))) {
    return 'YouTube extraction failed for this track. Ensure the Lavalink v4 YouTube plugin is up to date.';
  }

  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}

export function checkVoiceControlPermission(params: {
  memberVoiceChannelId: string | null | undefined;
  botVoiceChannelId: string | null | undefined;
  hasGuildAdminOrManage: boolean;
  memberRoleIds?: string[];
  djRoleIds?: string[];
}): void {
  if (!params.memberVoiceChannelId) {
    throw new AppError(
      ERROR_CODES.USER_NOT_IN_VOICE,
      'You must be connected to a voice channel to use music commands.',
      400
    );
  }

  if (params.botVoiceChannelId && params.botVoiceChannelId !== params.memberVoiceChannelId) {
    const isDj =
      params.hasGuildAdminOrManage ||
      Boolean(
        params.djRoleIds?.length &&
          params.memberRoleIds?.some((id) => params.djRoleIds!.includes(id))
      );
    if (!isDj) {
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        'You must be in the same voice channel as the bot (or hold a DJ / Manage Server role) to control playback.',
        403
      );
    }
  }
}

export function checkBotVoiceChannelPermissions(
  permissions: { has: (perm: bigint) => boolean } | null | undefined
): void {
  if (!permissions) return;
  const missing: string[] = [];
  if (!permissions.has(PermissionFlagsBits.ViewChannel)) missing.push('View Channel');
  if (!permissions.has(PermissionFlagsBits.Connect)) missing.push('Connect');
  if (!permissions.has(PermissionFlagsBits.Speak)) missing.push('Speak');
  if (missing.length > 0) {
    throw new AppError(
      ERROR_CODES.BOT_MISSING_PERMISSIONS,
      `I am missing required voice channel permissions: **${missing.join(', ')}**.`,
      403
    );
  }
}

export interface ConfigValidationItem {
  key: string;
  ok: boolean;
  required: boolean;
  message: string;
}

export function validateLavalinkConfig(cfg: {
  LAVALINK_HOST: string;
  LAVALINK_PORT: number;
  LAVALINK_PASSWORD: string;
  LAVALINK_SECURE: boolean;
  isSpotifyConfigured: boolean;
  isYouTubeOAuthConfigured: boolean;
}): ConfigValidationItem[] {
  const hostOk = Boolean(cfg.LAVALINK_HOST && cfg.LAVALINK_HOST.trim().length > 0);
  const portOk = Number.isInteger(cfg.LAVALINK_PORT) && cfg.LAVALINK_PORT > 0 && cfg.LAVALINK_PORT <= 65535;
  const passOk = Boolean(cfg.LAVALINK_PASSWORD && cfg.LAVALINK_PASSWORD.trim().length > 0);
  const isCloudeWave = cfg.LAVALINK_HOST?.includes('cloudewave.in');

  return [
    {
      key: 'LAVALINK_HOST',
      ok: hostOk,
      required: true,
      message: hostOk
        ? `Configured host: ${cfg.LAVALINK_HOST}${isCloudeWave ? ' (CloudeWave public node)' : ''}`
        : 'Not set. Configure LAVALINK_HOST (e.g., lavalink.cloudewave.in).',
    },
    {
      key: 'LAVALINK_PORT',
      ok: portOk,
      required: true,
      message: portOk ? `Port ${cfg.LAVALINK_PORT} (${cfg.LAVALINK_SECURE ? 'HTTPS/WSS' : 'HTTP/WS'})` : 'Invalid port number.',
    },
    {
      key: 'LAVALINK_PASSWORD',
      ok: passOk,
      required: true,
      message: !passOk
        ? 'Not set. Must match your Lavalink v4 node password.'
        : 'Lavalink v4 node authentication password configured.',
    },
    {
      key: 'SPOTIFY_CLIENT_ID / SECRET',
      ok: cfg.isSpotifyConfigured,
      required: false,
      message: cfg.isSpotifyConfigured
        ? 'Spotify API credentials configured for metadata & playlist resolution.'
        : 'Optional: required for Spotify URLs, albums, playlists & spsearch.',
    },
    {
      key: 'YOUTUBE_OAUTH_REFRESH_TOKEN',
      ok: cfg.isYouTubeOAuthConfigured,
      required: false,
      message: cfg.isYouTubeOAuthConfigured
        ? 'YouTube OAuth2 configuration present.'
        : 'Optional: improves YouTube playback reliability & age-restricted support.',
    },
  ];
}
