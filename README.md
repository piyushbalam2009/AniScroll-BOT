# AniScroll Bot

All-in-one Discord community management, direct Hoshika anime discovery, personal watchlists, Lavalink v4 music playback, Dyno-style moderation & AutoMod, Carl-bot community utilities, and monochrome web dashboard.

## Architecture Highlights

- **Independent Monorepo**: Separate from the existing AniScroll website backend. Zero modifications are made to `api.aniscroll.in`.
- **Direct Hoshika Integration**: Communicates directly with `https://hoshika.app/api/v1` via `HoshikaClient`, `AnimeMetadataNormalizer`, `AnimeCacheService`, and `AnimeSearchService`. Streaming provider endpoints (`/watch` and `streaming`/`platforms` fields) are strictly excluded.
- **Persistent Storage**: Full PostgreSQL Prisma schema (`prisma/schema.prisma` + `prisma/migrations/0001_init/migration.sql`) and zero-config SQLite runtime store (`better-sqlite3`).
- **Music Playback**: Lavalink v4 audio node (`lavalink.cloudewave.in:2336` default) with independent per-guild queues and graceful offline recovery.
- **Monochrome Dashboard**: Pure black/white/neutral interface (`#000000`, `#111111`, `#181818`, `#222222`, `#FFFFFF`) with Discord OAuth2 popup flow, CSRF protection, and real database-backed analytics.

## Local Development

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000` for the landing page and web dashboard.

## Running Tests

```bash
npm run lint
npm test
```

## Docker Production Deployment

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for full Discord application creation, OAuth2 callback setup, PostgreSQL migrations, Lavalink v4 configuration, backups, and monitoring.
