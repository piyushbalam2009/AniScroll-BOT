import crypto from 'node:crypto';
import { SlashCommandBuilder } from 'discord.js';
import {
  AppError,
  ERROR_CODES,
  NormalizedAnime,
  normalizeHoshikaShortId,
  normalizeWebsiteWatchStatus,
  WEBSITE_WATCH_STATUS_LABELS,
  WEBSITE_WATCH_STATUSES,
  WebsiteWatchStatus,
} from '../../../../../packages/shared/src';
import {
  buildWatchlistAddSelectRows,
  createErrorEmbed,
  createMonochromeEmbed,
  createWebsiteWatchlistEntryEmbed,
} from '../../../../../packages/discord-ui/src';
import { BotCommandContext, BotSlashCommand } from '../types';
import { findMatchingWatchlistItem } from '../../services/watchlist/WebsiteWatchlistService';

export interface WatchlistAddSession {
  ownerId: string;
  query: string;
  status: WebsiteWatchStatus;
  locale: string;
  candidates: NormalizedAnime[];
  expiresAt: number;
}

export const watchlistAddSessions = new Map<string, WatchlistAddSession>();

const SESSION_TTL_MS = 5 * 60_000;

function cleanupExpiredWatchlistSessions() {
  const now = Date.now();
  for (const [id, session] of watchlistAddSessions.entries()) {
    if (now > session.expiresAt) {
      watchlistAddSessions.delete(id);
    }
  }
}

export async function addAnimeToWebsiteWatchlist(
  ctx: BotCommandContext,
  discordUserId: string,
  shortIdInput: number,
  options?: {
    status?: WebsiteWatchStatus;
    locale?: string;
  }
) {
  const validShortId = normalizeHoshikaShortId(shortIdInput);
  if (!validShortId) {
    throw new AppError(ERROR_CODES.INVALID_ANIME_ID, 'A valid Hoshika anime shortId is required.', 400);
  }

  const locale = options?.locale || 'en';
  const { anime } = await ctx.animeService.getDetails(validShortId, locale);
  const canonicalShortId = normalizeHoshikaShortId(anime.shortId) ?? validShortId;
  const title = anime.titleEnglish || anime.titleRomaji || anime.titleNative || `Anime #${canonicalShortId}`;

  const savedItem = await ctx.websiteWatchlist.addEntry(discordUserId, {
    hoshikaId: canonicalShortId,
    title,
    coverImage: anime.poster ?? null,
    format: anime.type ?? null,
    rating: null,
    seasonYear: anime.releaseYear ?? null,
    status: options?.status ?? 'plan_to_watch',
  });

  return savedItem;
}

async function resolveWatchlistTarget(
  ctx: BotCommandContext,
  discordUserId: string,
  target: string
) {
  const directShortId = normalizeHoshikaShortId(target);
  if (directShortId) {
    return ctx.websiteWatchlist.getEntry(discordUserId, directShortId);
  }
  const items = await ctx.websiteWatchlist.listWatchlist(discordUserId);
  return findMatchingWatchlistItem(items, target);
}

const STATUS_CHOICES = WEBSITE_WATCH_STATUSES.map((st) => ({
  name: WEBSITE_WATCH_STATUS_LABELS[st],
  value: st,
}));

export const watchlistCommand: BotSlashCommand = {
  name: 'watchlist',
  category: 'watchlist',
  cooldownSeconds: 3,
  data: new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage your synced AniScroll website watchlist (https://aniscroll.in)')
    .addSubcommand((s) =>
      s
        .setName('show')
        .setDescription('Display your AniScroll website watchlist')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Filter by website status')
            .addChoices(...STATUS_CHOICES)
        )
        .addStringOption((o) =>
          o
            .setName('sort')
            .setDescription('Sort order')
            .addChoices(
              { name: 'Recently Updated', value: 'updated' },
              { name: 'Title (A-Z)', value: 'title' },
              { name: 'Date Added', value: 'date' },
              { name: 'Highest Rated', value: 'rating' }
            )
        )
        .addStringOption((o) => o.setName('genre').setDescription('Filter by genre'))
        .addBooleanOption((o) => o.setName('public').setDescription('Show publicly instead of ephemeral'))
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Search Hoshika and add an anime to your AniScroll website watchlist')
        .addStringOption((o) =>
          o.setName('anime').setDescription('Anime title or Hoshika shortId').setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Initial status (default: plan_to_watch)')
            .addChoices(...STATUS_CHOICES)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove an anime from your AniScroll website watchlist')
        .addStringOption((o) =>
          o.setName('anime').setDescription('Anime title or Hoshika shortId in your watchlist').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('progress')
        .setDescription('Update episodes watched on your AniScroll website watchlist')
        .addStringOption((o) =>
          o.setName('anime').setDescription('Anime title or Hoshika shortId in your watchlist').setRequired(true)
        )
        .addIntegerOption((o) =>
          o.setName('episodes').setDescription('Episodes watched').setRequired(true).setMinValue(0)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Update watch status on your AniScroll website watchlist')
        .addStringOption((o) =>
          o.setName('anime').setDescription('Anime title or Hoshika shortId in your watchlist').setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('New website watchlist status')
            .setRequired(true)
            .addChoices(...STATUS_CHOICES)
        )
        .addStringOption((o) => o.setName('notes').setDescription('Optional personal notes'))
    )
    .addSubcommand((s) =>
      s
        .setName('rate')
        .setDescription('Rate an anime in your AniScroll website watchlist (1-10)')
        .addStringOption((o) =>
          o.setName('anime').setDescription('Anime title or Hoshika shortId in your watchlist').setRequired(true)
        )
        .addIntegerOption((o) =>
          o.setName('rating').setDescription('Score from 1 to 10').setRequired(true).setMinValue(1).setMaxValue(10)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('search')
        .setDescription('Search inside your AniScroll website watchlist')
        .addStringOption((o) =>
          o.setName('query').setDescription('Title keyword or Hoshika shortId').setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Optional status filter')
            .addChoices(...STATUS_CHOICES)
        )
    )
    .addSubcommand((s) =>
      s.setName('stats').setDescription('Calculate statistics from your AniScroll website watchlist')
    ),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const isPublic = sub === 'show' && interaction.options.getBoolean('public') === true;
    await interaction.deferReply({ ephemeral: !isPublic });

    // Always bind to the authenticated Discord user's actual Discord ID (never an arbitrary Firebase UID)
    const discordUserId = interaction.user.id;
    const locale = interaction.guildId
      ? ctx.db.getGuildSettings(interaction.guildId).animeConfig.locale
      : 'en';

    if (sub === 'show' || sub === 'search') {
      const statusRaw = interaction.options.getString('status');
      const status = statusRaw ? normalizeWebsiteWatchStatus(statusRaw) ?? undefined : undefined;
      const sort = (interaction.options.getString('sort') as 'title' | 'date' | 'updated' | 'rating' | null) || undefined;
      const genre = interaction.options.getString('genre') || undefined;
      const query = sub === 'search' ? interaction.options.getString('query', true).trim() : undefined;

      const items = await ctx.websiteWatchlist.listWatchlist(discordUserId, {
        status,
        sort,
        genre,
        query,
      });

      if (items.length === 0) {
        const emptyDesc =
          sub === 'search'
            ? `No anime matching **${query}** were found in your AniScroll website watchlist.`
            : status
              ? `No anime with status **${WEBSITE_WATCH_STATUS_LABELS[status]}** in your AniScroll website watchlist.`
              : 'Your AniScroll website watchlist is empty. Use `/watchlist add` to save an anime.';
        await interaction.editReply({
          embeds: [
            createMonochromeEmbed({
              title: `${interaction.user.username}'s AniScroll Watchlist`,
              description: emptyDesc,
              footerText: 'Synced with https://aniscroll.in',
            }),
          ],
        });
        return;
      }

      const lines = items.slice(0, 15).map((item, idx) => {
        const ep = `${item.episodesWatched}/${item.totalEpisodes ?? '?'}`;
        const rating = item.rating !== null ? ` · **${item.rating}/10**` : '';
        return `**${idx + 1}.** [${item.title}](${item.aniscrollUrl}) · ${WEBSITE_WATCH_STATUS_LABELS[item.status]} · \`${ep} ep\`${rating} (\`#${item.shortId}\`)`;
      });

      const titlePrefix = sub === 'search' ? `Watchlist Search · "${query}"` : `${interaction.user.username}'s AniScroll Watchlist`;
      const overflowNote =
        items.length > 15 ? `\n\nShowing first **15** of **${items.length}** synced entries.` : '';

      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: `${titlePrefix} (${items.length})`,
            description: `${lines.join('\n')}${overflowNote}`.slice(0, 4096),
            footerText: 'Synced with https://aniscroll.in · Hoshika shortId',
          }),
        ],
      });
      return;
    }

    if (sub === 'add') {
      const rawAnime = interaction.options.getString('anime', true).trim();
      const statusRaw = interaction.options.getString('status');
      const status: WebsiteWatchStatus =
        (statusRaw ? normalizeWebsiteWatchStatus(statusRaw) : null) ?? 'plan_to_watch';

      if (!rawAnime) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Please enter an anime title or Hoshika shortId.', 400);
      }

      // Direct numeric Hoshika shortId support — POST directly without any prerequisite GET lookup
      const directShortId = normalizeHoshikaShortId(rawAnime);
      if (directShortId) {
        const saved = await addAnimeToWebsiteWatchlist(ctx, discordUserId, directShortId, {
          status,
          locale,
        });
        await interaction.editReply({
          embeds: [
            createWebsiteWatchlistEntryEmbed(saved, {
              title: `Added to Watchlist · ${saved.title}`,
              description: `Added to your **AniScroll** website watchlist under **${WEBSITE_WATCH_STATUS_LABELS[saved.status]}**.`,
            }),
          ],
        });
        return;
      }

      // Search Hoshika and let user select the exact anime
      const searchResult = await ctx.animeService.searchService.search({
        query: rawAnime,
        limit: 10,
        locale,
      });
      const candidates = searchResult.items.filter((item) => item.shortId && item.shortId > 0).slice(0, 10);
      if (candidates.length === 0) {
        await interaction.editReply({
          embeds: [createErrorEmbed(`No anime matching "${rawAnime}" were found on Hoshika.`)],
        });
        return;
      }

      cleanupExpiredWatchlistSessions();
      const sessionId = crypto.randomBytes(6).toString('hex');
      watchlistAddSessions.set(sessionId, {
        ownerId: discordUserId,
        query: rawAnime,
        status,
        locale,
        candidates,
        expiresAt: Date.now() + SESSION_TTL_MS,
      });

      const listLines = candidates.map((item, idx) => {
        const primary = item.titleEnglish || item.titleRomaji || item.titleNative || 'Untitled';
        const meta = [
          item.type || null,
          item.releaseYear !== null && item.releaseYear !== undefined ? String(item.releaseYear) : null,
          item.totalEpisodes ? `${item.totalEpisodes} ep` : null,
          `ID #${item.shortId}`,
        ]
          .filter(Boolean)
          .join(' · ');
        return `**${idx + 1}.** ${primary} (${meta})`;
      });

      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: `Select Anime to Add · "${rawAnime}"`,
            description: `Choose the exact anime below to add it to your **AniScroll** website watchlist as **${WEBSITE_WATCH_STATUS_LABELS[status]}**:\n\n${listLines.join('\n')}`,
            footerText: 'Hoshika Search · Expires in 5 minutes',
          }),
        ],
        components: buildWatchlistAddSelectRows({
          ownerUserId: discordUserId,
          sessionId,
          candidates,
        }),
      });
      return;
    }

    if (sub === 'remove') {
      const target = interaction.options.getString('anime', true).trim();
      const match = await resolveWatchlistTarget(ctx, discordUserId, target);
      if (!match) {
        await interaction.editReply({
          embeds: [createErrorEmbed(`No anime matching "${target}" was found in your AniScroll website watchlist.`)],
        });
        return;
      }

      const removal = await ctx.websiteWatchlist.removeEntry(discordUserId, match.shortId);
      const removedItem = removal.item ?? match;

      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: 'Removed from Watchlist',
            description: `Removed **[${removedItem.title}](${removedItem.aniscrollUrl})** (\`Hoshika ID: ${removedItem.shortId}\`) from your AniScroll website watchlist.`,
            footerText: 'Synced with https://aniscroll.in',
          }),
        ],
      });
      return;
    }

    if (sub === 'progress') {
      const target = interaction.options.getString('anime', true).trim();
      const episodes = interaction.options.getInteger('episodes', true);
      const match = await resolveWatchlistTarget(ctx, discordUserId, target);
      if (!match) {
        await interaction.editReply({
          embeds: [createErrorEmbed(`No anime matching "${target}" was found in your AniScroll website watchlist.`)],
        });
        return;
      }

      let knownTotalEpisodes: number | null = match.totalEpisodes;
      if (knownTotalEpisodes === null) {
        try {
          const { anime } = await ctx.animeService.getDetails(match.shortId, locale);
          knownTotalEpisodes = anime.totalEpisodes ?? null;
        } catch {
          knownTotalEpisodes = null;
        }
      }

      if (knownTotalEpisodes !== null && knownTotalEpisodes > 0 && episodes > knownTotalEpisodes) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          `Episodes watched (${episodes}) cannot exceed total episodes (${knownTotalEpisodes}) for **${match.title}**.`,
          400
        );
      }

      const shouldAutoComplete =
        knownTotalEpisodes !== null &&
        knownTotalEpisodes > 0 &&
        episodes === knownTotalEpisodes &&
        match.status !== 'completed';

      const updated = await ctx.websiteWatchlist.updateEntry(discordUserId, match.shortId, {
        episodesWatched: episodes,
        ...(shouldAutoComplete ? { status: 'completed' } : {}),
      });

      const displayItem =
        updated.item.totalEpisodes === null && knownTotalEpisodes !== null
          ? { ...updated.item, totalEpisodes: knownTotalEpisodes }
          : updated.item;
      const isCompletedNow = updated.autoCompleted || shouldAutoComplete;
      await interaction.editReply({
        embeds: [
          createWebsiteWatchlistEntryEmbed(displayItem, {
            title: isCompletedNow
              ? `Series Completed · ${displayItem.title}`
              : `Progress Updated · ${displayItem.title}`,
            description: isCompletedNow
              ? `Episode progress reached \`${displayItem.episodesWatched}/${displayItem.totalEpisodes ?? '?'}\` and your AniScroll website watchlist status is now **${WEBSITE_WATCH_STATUS_LABELS[displayItem.status]}**.`
              : `Updated progress on your AniScroll website watchlist to \`${displayItem.episodesWatched}/${displayItem.totalEpisodes ?? '?'} ep\`.`,
          }),
        ],
      });
      return;
    }

    if (sub === 'status') {
      const target = interaction.options.getString('anime', true).trim();
      const statusInput = interaction.options.getString('status', true);
      const nextStatus = normalizeWebsiteWatchStatus(statusInput);
      if (!nextStatus) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid website watchlist status.', 400);
      }
      const notes = interaction.options.getString('notes');

      const match = await resolveWatchlistTarget(ctx, discordUserId, target);
      if (!match) {
        await interaction.editReply({
          embeds: [createErrorEmbed(`No anime matching "${target}" was found in your AniScroll website watchlist.`)],
        });
        return;
      }

      const updated = await ctx.websiteWatchlist.updateEntry(discordUserId, match.shortId, {
        status: nextStatus,
        ...(notes !== null ? { notes } : {}),
      });

      await interaction.editReply({
        embeds: [
          createWebsiteWatchlistEntryEmbed(updated.item, {
            title: `Status Updated · ${updated.item.title}`,
            description: `Updated status on your AniScroll website watchlist to **${WEBSITE_WATCH_STATUS_LABELS[updated.item.status]}** (\`${updated.item.status}\`).`,
          }),
        ],
      });
      return;
    }

    if (sub === 'rate') {
      const target = interaction.options.getString('anime', true).trim();
      const rating = interaction.options.getInteger('rating', true);

      const match = await resolveWatchlistTarget(ctx, discordUserId, target);
      if (!match) {
        await interaction.editReply({
          embeds: [createErrorEmbed(`No anime matching "${target}" was found in your AniScroll website watchlist.`)],
        });
        return;
      }

      const updated = await ctx.websiteWatchlist.updateEntry(discordUserId, match.shortId, {
        rating,
      });

      await interaction.editReply({
        embeds: [
          createWebsiteWatchlistEntryEmbed(updated.item, {
            title: `Rating Updated · ${updated.item.title}`,
            description: `Saved rating **${updated.item.rating ?? rating}/10** to your AniScroll website watchlist.`,
          }),
        ],
      });
      return;
    }

    if (sub === 'stats') {
      const stats = await ctx.websiteWatchlist.getStats(discordUserId);
      const embed = createMonochromeEmbed({
        title: `${interaction.user.username}'s AniScroll Watchlist Statistics`,
        description: `Total Entries: **${stats.totalEntries}** · Total Episodes Watched: **${stats.totalEpisodesWatched}** · Completion Rate: **${stats.completionRate}%**`,
        footerText: 'Calculated from live AniScroll website watchlist (https://aniscroll.in)',
      }).addFields(
        { name: 'Watching', value: String(stats.byStatus.watching), inline: true },
        { name: 'Completed', value: String(stats.byStatus.completed), inline: true },
        { name: 'Plan to Watch', value: String(stats.byStatus.plan_to_watch), inline: true },
        { name: 'On Hold', value: String(stats.byStatus.on_hold), inline: true },
        { name: 'Dropped', value: String(stats.byStatus.dropped), inline: true },
        {
          name: 'Average Rating',
          value:
            stats.averageRating !== null
              ? `${stats.averageRating}/10 (${stats.ratedCount} rated)`
              : 'Unrated',
          inline: true,
        }
      );

      if (stats.topGenres.length > 0) {
        embed.addFields({
          name: 'Top Genres',
          value: stats.topGenres.map((g) => `${g.genre} (${g.count})`).join(' · '),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    }
  },
};
