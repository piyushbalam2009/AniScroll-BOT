-- AniScroll Bot — Initial PostgreSQL Migration (0001_init)
-- Mirrors prisma/schema.prisma with indexes, foreign keys, and unique constraints.

CREATE TYPE "WatchStatus" AS ENUM ('PLAN_TO_WATCH', 'WATCHING', 'COMPLETED', 'ON_HOLD', 'DROPPED');
CREATE TYPE "ModerationAction" AS ENUM ('WARN', 'TIMEOUT', 'UNTIMEOUT', 'KICK', 'BAN', 'TEMP_BAN', 'UNBAN', 'SOFTBAN', 'AUTOMOD_DELETE', 'AUTOMOD_TIMEOUT');
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'UNDER_CONSIDERATION', 'APPROVED', 'REJECTED', 'IMPLEMENTED');
CREATE TYPE "TicketCategory" AS ENUM ('GENERAL_SUPPORT', 'BUG_REPORT', 'FEATURE_REQUEST', 'PARTNERSHIP', 'STAFF_APPLICATION');
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'CLAIMED', 'CLOSED');
CREATE TYPE "NotificationType" AS ENUM ('WEBSITE_RELEASE', 'FEATURE_RELEASE', 'MAINTENANCE', 'SERVICE_STATUS', 'COMMUNITY_ANNOUNCEMENT');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "discordId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "avatar" TEXT,
  "preferences" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");
CREATE INDEX "User_discordId_idx" ON "User"("discordId");

CREATE TABLE "Guild" (
  "id" TEXT NOT NULL,
  "discordGuildId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT,
  "memberCount" INTEGER NOT NULL DEFAULT 0,
  "botInstalled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Guild_discordGuildId_key" ON "Guild"("discordGuildId");
CREATE INDEX "Guild_discordGuildId_idx" ON "Guild"("discordGuildId");

CREATE TABLE "GuildSettings" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "welcomeConfig" JSONB NOT NULL DEFAULT '{}',
  "moderationConfig" JSONB NOT NULL DEFAULT '{}',
  "automodConfig" JSONB NOT NULL DEFAULT '{}',
  "musicConfig" JSONB NOT NULL DEFAULT '{}',
  "animeConfig" JSONB NOT NULL DEFAULT '{}',
  "loggingConfig" JSONB NOT NULL DEFAULT '{}',
  "notificationConfig" JSONB NOT NULL DEFAULT '{}',
  "communityConfig" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuildSettings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GuildSettings_guildId_key" ON "GuildSettings"("guildId");

CREATE TABLE "Watchlist" (
  "id" TEXT NOT NULL,
  "discordUserId" TEXT NOT NULL,
  "hoshikaId" TEXT NOT NULL,
  "hoshikaShortId" INTEGER,
  "anilistId" INTEGER,
  "malId" INTEGER,
  "titleSnapshot" TEXT NOT NULL,
  "posterSnapshot" TEXT,
  "genresSnapshot" JSONB NOT NULL DEFAULT '[]',
  "totalEpisodes" INTEGER,
  "status" "WatchStatus" NOT NULL DEFAULT 'PLAN_TO_WATCH',
  "episodesWatched" INTEGER NOT NULL DEFAULT 0,
  "personalRating" INTEGER,
  "notes" TEXT,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Watchlist_discordUserId_fkey" FOREIGN KEY ("discordUserId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Watchlist_discordUserId_hoshikaId_key" ON "Watchlist"("discordUserId", "hoshikaId");
CREATE INDEX "Watchlist_discordUserId_idx" ON "Watchlist"("discordUserId");
CREATE INDEX "Watchlist_discordUserId_status_idx" ON "Watchlist"("discordUserId", "status");
CREATE INDEX "Watchlist_hoshikaId_idx" ON "Watchlist"("hoshikaId");

CREATE TABLE "ModerationCase" (
  "id" TEXT NOT NULL,
  "caseNumber" INTEGER NOT NULL,
  "guildId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "moderatorId" TEXT NOT NULL,
  "action" "ModerationAction" NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" TEXT,
  "staffNotes" TEXT,
  "appealStatus" TEXT,
  "appealText" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModerationCase_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ModerationCase_guildId_caseNumber_key" ON "ModerationCase"("guildId", "caseNumber");
CREATE INDEX "ModerationCase_guildId_targetUserId_idx" ON "ModerationCase"("guildId", "targetUserId");

CREATE TABLE "Warning" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "moderatorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Warning_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Warning_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Warning_guildId_userId_idx" ON "Warning"("guildId", "userId");

CREATE TABLE "Ticket" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" "TicketCategory" NOT NULL DEFAULT 'GENERAL_SUPPORT',
  "subject" TEXT,
  "assignedStaffId" TEXT,
  "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "transcriptUrl" TEXT,
  "transcriptText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Ticket_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Ticket_channelId_key" ON "Ticket"("channelId");
CREATE INDEX "Ticket_guildId_status_idx" ON "Ticket"("guildId", "status");

CREATE TABLE "Suggestion" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "messageId" TEXT,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "upvotes" INTEGER NOT NULL DEFAULT 0,
  "downvotes" INTEGER NOT NULL DEFAULT 0,
  "voterIds" JSONB NOT NULL DEFAULT '{}',
  "staffResponse" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Suggestion_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Suggestion_guildId_contentHash_key" ON "Suggestion"("guildId", "contentHash");
CREATE INDEX "Suggestion_guildId_status_idx" ON "Suggestion"("guildId", "status");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "destinationChannelId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT,
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_guildId_createdAt_idx" ON "Notification"("guildId", "createdAt");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditLog_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");
