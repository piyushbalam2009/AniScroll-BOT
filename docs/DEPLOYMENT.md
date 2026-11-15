# AniScroll Bot — Deployment & Operations Guide

## 1. Discord Application & Bot Invitation

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application named **AniScroll Bot**.
2. Under **Bot**, enable the **Server Members Intent** and **Message Content Intent** (optional; bot falls back to standard intents automatically), then copy the Bot Token into `DISCORD_TOKEN`.
3. Under **OAuth2 → General**, copy the Client ID (`DISCORD_CLIENT_ID`) and Client Secret (`DISCORD_CLIENT_SECRET`).
4. Add your exact OAuth2 Redirect URI:
   - Local development: `http://localhost:3000/auth/callback`
   - Production: `https://<your-domain>/auth/callback`
5. Under **OAuth2 → URL Generator**, select `bot` and `applications.commands` scopes with `Manage Server`, `Manage Roles`, `Manage Channels`, `Moderate Members`, `Kick Members`, `Ban Members`, `Send Messages`, `Embed Links`, `View Channel`, `Connect`, and `Speak`.

## 2. Lavalink v4 Audio Node Configuration (CloudeWave Public Node)

AniScroll Bot connects to a **Lavalink v4** audio node for voice playback. By default, it is pre-configured to connect to the free public CloudeWave node (`https://cloudewave.in/free/`):

```env
LAVALINK_HOST="lavalink.cloudewave.in"
LAVALINK_PORT="2336"
LAVALINK_PASSWORD="cloudewave.in"
LAVALINK_SECURE="false"
```

If you switch to a custom or private Lavalink v4 node, override `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`, and `LAVALINK_SECURE` in your `.env` file.

## 3. Spotify Metadata Lookup & Playable Match Resolution

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and click **Create App**.
2. Copy **Client ID** (`SPOTIFY_CLIENT_ID`) and **Client Secret** (`SPOTIFY_CLIENT_SECRET`).
3. Provide both to **AniScroll Bot** (`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`).
4. Note: Spotify is not streamed directly as an unrestricted audio source. LavaSrc on Lavalink v4 reads Spotify track, album, and playlist metadata and delegates playable audio stream resolution to YouTube / YouTube Music / SoundCloud.

## 4. YouTube Playback & Optional OAuth

1. Lavalink v4 uses the official `youtube-plugin` for YouTube extraction and search (`ytsearch:`, `ytmsearch:`).
2. Optional `YOUTUBE_OAUTH_REFRESH_TOKEN` can be configured for age-restricted track support.

## 5. Hoshika API Configuration

- `HOSHIKA_BASE_URL` defaults to `https://hoshika.app/api/v1`.
- Official streaming availability endpoints (`/api/v1/anime/{shortId}/watch`) are intentionally blocked by `HoshikaClient` and stripped by `AnimeMetadataNormalizer`.

## 6. PostgreSQL & Prisma Migrations

```bash
npx prisma migrate deploy --schema=prisma/schema.prisma
```
