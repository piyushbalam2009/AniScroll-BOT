import crypto from 'crypto';
import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuInteraction } from 'discord.js';
import { AppError, ERROR_CODES, NormalizedAnime, normalizeHoshikaShortId } from '../../../../../packages/shared/src';
import {
  buildAnimeActionRows,
  buildPublicRecommendationRows,
  buildRecommendationSelectRows,
  createAnimeEmbed,
  createErrorEmbed,
  createMonochromeEmbed,
  createPublicRecommendationEmbed,
} from '../../../../../packages/discord-ui/src';
import { BotCommandContext, BotSlashCommand } from '../types';

// Ephemeral session cache for pagination & selection ownership
export const animePaginationSessions = new Map<
  string,
  { ownerId: string; results: NormalizedAnime[]; expiresAt: number }
>();

export interface AnimeRecommendationSession {
  sessionId: string;
  ownerId: string;
  username: string;
  guildId: string | null;
  guildName: string | null;
  channelId: string;
  query: string;
  locale: string;
  candidates: NormalizedAnime[];
  expiresAt: number;
}

// Keyed by unique sessionId so simultaneous users never collide
export const animeRecommendationSessions = new Map<string, AnimeRecommendationSession>();

export function verifyRecommendationChannelPermissions(
  interaction: {
    guildId: string | null;
    channelId: string;
    guild?: any;
    channel?: any;
  },
  ctx: BotCommandContext
): void {
  if (interaction.guildId) {
    const settings = ctx.db.getGuildSettings(interaction.guildId);
    const animeConfig = settings.animeConfig;
    if (animeConfig.recommendationEnabled === false) {
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        'Community anime recommendations are currently disabled in this server.',
        403
      );
    }
    if (
      Array.isArray(animeConfig.recommendationAllowedChannelIds) &&
      animeConfig.recommendationAllowedChannelIds.length > 0 &&
      !animeConfig.recommendationAllowedChannelIds.includes(interaction.channelId)
    ) {
      const allowedList = animeConfig.recommendationAllowedChannelIds.map((id) => `<#${id}>`).join(', ');
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        `Anime recommendations can only be posted in designated channels: ${allowedList}.`,
        403
      );
    }
  }

  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') {
    throw new AppError(
      ERROR_CODES.BOT_MISSING_PERMISSIONS,
      'Cannot send public messages in this channel. Please run `/anime recommendation` in a standard server text channel.',
      403
    );
  }

  const botMember = interaction.guild?.members?.me;
  if (botMember && typeof channel.permissionsFor === 'function') {
    const perms = channel.permissionsFor(botMember);
    if (perms) {
      const missing: string[] = [];
      if (!perms.has(PermissionFlagsBits.ViewChannel)) missing.push('ViewChannel');
      if (!perms.has(PermissionFlagsBits.SendMessages)) missing.push('SendMessages');
      if (!perms.has(PermissionFlagsBits.EmbedLinks)) missing.push('EmbedLinks');
      if (missing.length > 0) {
        throw new AppError(
          ERROR_CODES.BOT_MISSING_PERMISSIONS,
          `AniScroll Bot is missing required permissions in <#${interaction.channelId}>: ${missing.join(', ')}.`,
          403
        );
      }
    }
  }
}

export async function publishPublicRecommendation(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
  ctx: BotCommandContext,
  shortId: number,
  meta: {
    userId: string;
    username: string;
    guildId: string | null;
    guildName: string | null;
    channelId: string;
    locale: string;
  }
) {
  const validShortId = normalizeHoshikaShortId(shortId);
  if (!validShortId) {
    throw new AppError(
      ERROR_CODES.INVALID_ANIME_ID,
      'This anime entry does not have a valid Hoshika shortId.',
      400
    );
  }

  verifyRecommendationChannelPermissions(interaction, ctx);

  const { anime } = await ctx.animeService.getDetails(validShortId, meta.locale || 'en');
  const resolvedShortId = normalizeHoshikaShortId(anime.shortId) ?? validShortId;
  const aniscrollUrl = ctx.animeService.linkService.buildUrl(resolvedShortId);

  const embed = createPublicRecommendationEmbed(anime, {
    recommendedByUserId: meta.userId,
    recommendedByUsername: meta.username,
    serverName: meta.guildName,
    aniscrollUrl,
  });

  const components = buildPublicRecommendationRows({
    shortId: resolvedShortId,
    aniscrollUrl,
  });

  const channel = interaction.channel as any;
  let sentMessage: { id?: string } | null = null;
  try {
    sentMessage = await channel.send({
      embeds: [embed],
      components,
    });
  } catch (err) {
    throw new AppError(
      ERROR_CODES.BOT_MISSING_PERMISSIONS,
      `Discord rejected sending the public recommendation in <#${meta.channelId}>: ${err instanceof Error ? err.message : 'Missing permissions or channel access'}.`,
      403
    );
  }

  if (!sentMessage) {
    throw new AppError(
      ERROR_CODES.BOT_MISSING_PERMISSIONS,
      'Discord did not confirm delivery of the public recommendation message.',
      502
    );
  }

  const animeTitle = anime.titleEnglish || anime.titleRomaji || anime.titleNative || `Anime #${resolvedShortId}`;

  if (meta.guildId) {
    const settings = ctx.db.getGuildSettings(meta.guildId);
    if (settings.animeConfig.recommendationAnalyticsEnabled !== false) {
      ctx.db.recordCommunityRecommendation({
        guildId: meta.guildId,
        channelId: meta.channelId,
        discordUserId: meta.userId,
        username: meta.username,
        hoshikaShortId: resolvedShortId,
        animeTitle,
        messageId: sentMessage.id || null,
      });
    }
  }

  ctx.db.recordAnimeSearchMetric({
    query: animeTitle,
    hoshikaId: anime.hoshikaId,
    title: animeTitle,
    genres: anime.genres,
    userId: meta.userId,
    guildId: meta.guildId,
  });

  return {
    anime,
    shortId: resolvedShortId,
    aniscrollUrl,
    messageId: sentMessage.id || null,
    embed,
    components,
  };
}

export const animeCommand: BotSlashCommand = {
  name: 'anime',
  category: 'anime',
  cooldownSeconds: 3,
  data: new SlashCommandBuilder()
    .setName('anime')
    .setDescription('Discover anime metadata directly from Hoshika')
    .addSubcommand((s) =>
      s
        .setName('recommendation')
        .setDescription('Publish a public anime recommendation card to this channel.')
        .addStringOption((o) =>
          o
            .setName('anime_name')
            .setDescription('Anime title to search on Hoshika and recommend publicly')
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('search')
        .setDescription('Search anime by title with optional filters')
        .addStringOption((o) => o.setName('query').setDescription('Anime title').setRequired(true))
        .addStringOption((o) => o.setName('genre').setDescription('Filter by genre'))
        .addIntegerOption((o) => o.setName('year').setDescription('Filter by release year'))
        .addStringOption((o) =>
          o
            .setName('format')
            .setDescription('Filter by format')
            .addChoices(
              { name: 'TV', value: 'TV' },
              { name: 'Movie', value: 'MOVIE' },
              { name: 'OVA', value: 'OVA' },
              { name: 'ONA', value: 'ONA' }
            )
        )
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Filter by airing status')
            .addChoices(
              { name: 'Releasing', value: 'RELEASING' },
              { name: 'Finished', value: 'FINISHED' },
              { name: 'Upcoming', value: 'NOT_YET_RELEASED' }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName('details')
        .setDescription('Show full metadata card for an anime')
        .addStringOption((o) => o.setName('anime').setDescription('Title or Hoshika shortId').setRequired(true))
    )
    .addSubcommand((s) => s.setName('trending').setDescription('Browse currently trending anime'))
    .addSubcommand((s) => s.setName('popular').setDescription('Browse top-rated popular anime'))
    .addSubcommand((s) =>
      s
        .setName('random')
        .setDescription('Pick a random anime')
        .addStringOption((o) => o.setName('genre').setDescription('Optional genre filter'))
        .addIntegerOption((o) => o.setName('year').setDescription('Optional release year'))
    )
    .addSubcommand((s) => s.setName('genres').setDescription('List all available Hoshika anime genres'))
    .addSubcommand((s) => s.setName('season').setDescription('Browse current anime season premieres'))
    .addSubcommand((s) => s.setName('schedule').setDescription('View this week’s airing schedule'))
    .addSubcommand((s) =>
      s
        .setName('episodes')
        .setDescription('List episodes for an anime')
        .addStringOption((o) => o.setName('anime').setDescription('Title or Hoshika shortId').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('related')
        .setDescription('Show sequels, prequels, and related entries')
        .addStringOption((o) => o.setName('anime').setDescription('Title or Hoshika shortId').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('watch')
        .setDescription('Get verified AniScroll website link for an anime')
        .addStringOption((o) => o.setName('anime').setDescription('Anime title').setRequired(true))
    ),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const locale = interaction.guildId
      ? ctx.db.getGuildSettings(interaction.guildId).animeConfig.locale
      : 'en';

    if (sub === 'recommendation') {
      const rawAnimeName = interaction.options.getString('anime_name', true);
      const animeName = rawAnimeName.trim();
      if (!animeName) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Please provide a non-empty `anime_name` to recommend.', 400);
      }

      verifyRecommendationChannelPermissions(interaction, ctx);

      const guildSettings = interaction.guildId ? ctx.db.getGuildSettings(interaction.guildId) : null;
      const recCooldown = guildSettings?.animeConfig.recommendationCooldownSeconds ?? 15;

      const normKey = animeName.toLowerCase().replace(/\s+/g, ' ');
      const dupCheck = await ctx.cache.checkRateLimit(
        `rec:dup:${interaction.user.id}:${interaction.channelId}:${normKey}`,
        1,
        8
      );
      if (!dupCheck.allowed) {
        throw new AppError(
          ERROR_CODES.RATE_LIMIT_EXCEEDED,
          `You already requested a recommendation for "${animeName}". Please wait ${dupCheck.retryAfterSeconds}s.`,
          429
        );
      }

      if (recCooldown > 0) {
        const userRl = await ctx.cache.checkRateLimit(
          `rec:cooldown:${interaction.guildId || 'dm'}:${interaction.user.id}`,
          1,
          recCooldown
        );
        if (!userRl.allowed) {
          throw new AppError(
            ERROR_CODES.RATE_LIMIT_EXCEEDED,
            `Recommendation cooldown active. Please wait ${userRl.retryAfterSeconds}s before posting another recommendation.`,
            429
          );
        }
      }

      await interaction.deferReply({ ephemeral: true });

      const matchResult = await ctx.animeService.searchForRecommendation(animeName, locale);
      if (matchResult.mode === 'none' || matchResult.candidates.length === 0) {
        await interaction.editReply({
          embeds: [
            createErrorEmbed(
              `No anime found on Hoshika matching "${animeName}". Check the spelling or try its English/Romaji title.`,
              'Anime Not Found'
            ),
          ],
        });
        return;
      }

      if (matchResult.mode === 'exact' && matchResult.selected?.shortId) {
        const published = await publishPublicRecommendation(interaction, ctx, matchResult.selected.shortId, {
          userId: interaction.user.id,
          username: interaction.user.username,
          guildId: interaction.guildId,
          guildName: interaction.guild?.name || null,
          channelId: interaction.channelId,
          locale,
        });

        const title = published.anime.titleEnglish || published.anime.titleRomaji || animeName;
        await interaction.editReply({
          embeds: [
            createMonochromeEmbed({
              title: 'Recommendation Published',
              description: `Your public recommendation for **${title}** (\`Hoshika ID: ${published.shortId}\`) has been posted in <#${interaction.channelId}>.`,
            }),
          ],
          components: [],
        });
        return;
      }

      // Multiple similar matches -> show ephemeral selection menu to the command invoker
      const sessionId = crypto.randomUUID().slice(0, 8);
      const candidates = matchResult.candidates.slice(0, 10);
      animeRecommendationSessions.set(sessionId, {
        sessionId,
        ownerId: interaction.user.id,
        username: interaction.user.username,
        guildId: interaction.guildId,
        guildName: interaction.guild?.name || null,
        channelId: interaction.channelId,
        query: animeName,
        locale,
        candidates,
        expiresAt: Date.now() + 5 * 60_000,
      });

      const listPreview = candidates
        .map((c, idx) => {
          const primary = c.titleEnglish || c.titleRomaji || 'Untitled';
          const alt = c.titleRomaji && c.titleRomaji !== primary ? ` (${c.titleRomaji})` : '';
          const metaParts = [c.type, c.releaseYear ? String(c.releaseYear) : null].filter(Boolean).join(' · ');
          return `**${idx + 1}.** ${primary}${alt}${metaParts ? ` — \`${metaParts}\`` : ''} · ID \`${c.shortId}\``;
        })
        .join('\n');

      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: `Select Anime to Recommend · "${animeName}"`,
            description: `Multiple anime matched your search. Choose the exact entry below to publish your recommendation publicly in <#${interaction.channelId}>:\n\n${listPreview}`,
            footerText: 'Selection expires in 5 minutes · Visible only to you',
          }),
        ],
        components: buildRecommendationSelectRows({
          ownerUserId: interaction.user.id,
          sessionId,
          candidates,
        }),
      });
      return;
    }

    await interaction.deferReply();

    if (sub === 'search') {
      const query = interaction.options.getString('query', true);
      const genre = interaction.options.getString('genre') || undefined;
      const year = interaction.options.getInteger('year') || undefined;
      const format = interaction.options.getString('format') || undefined;
      const status = interaction.options.getString('status') || undefined;

      const { items } = await ctx.animeService.searchService.search({
        query,
        genre,
        year,
        format,
        status,
        locale,
      });

      if (items.length === 0) {
        await interaction.editReply({
          embeds: [createErrorEmbed(`No anime matched "${query}". Try a broader title or fewer filters.`, 'Anime Not Found')],
        });
        return;
      }

      const hydratedFirst = await ctx.animeService.hydrateAnimeItem(items[0], locale);
      items[0] = hydratedFirst.anime;
      const first = items[0];

      ctx.db.recordAnimeSearchMetric({
        query,
        hoshikaId: first.hoshikaId,
        title: first.titleEnglish || first.titleRomaji || query,
        genres: first.genres,
        userId: interaction.user.id,
        guildId: interaction.guildId,
      });

      const sessionKey = `${interaction.user.id}:${interaction.channelId}`;
      animePaginationSessions.set(sessionKey, {
        ownerId: interaction.user.id,
        results: items,
        expiresAt: Date.now() + 10 * 60_000,
      });

      const aniscrollUrl = ctx.animeService.linkService.buildUrl(first.shortId);

      await interaction.editReply({
        embeds: [
          createAnimeEmbed(first, {
            aniscrollUrl,
            detailsFetchError: hydratedFirst.detailsError,
          }).setFooter({
            text: `Result 1 of ${items.length} · ${first.shortId ? `Hoshika ID ${first.shortId}` : 'Hoshika ID unavailable'}`,
          }),
        ],
        components: buildAnimeActionRows({
          shortId: first.shortId,
          hoshikaId: first.hoshikaId,
          ownerUserId: interaction.user.id,
          page: 0,
          totalPages: items.length,
          aniscrollUrl,
          searchResults: items,
        }),
      });
      return;
    }

    if (sub === 'details') {
      const target = interaction.options.getString('anime', true);
      const { anime } = await ctx.animeService.getDetails(target, locale);
      const aniscrollUrl = ctx.animeService.linkService.buildUrl(anime.shortId);
      await interaction.editReply({
        embeds: [
          createAnimeEmbed(anime, { aniscrollUrl, detailed: true }).setFooter({
            text: `Anime Details · ${anime.shortId ? `Hoshika ID ${anime.shortId}` : 'Hoshika ID unavailable'}`,
          }),
        ],
        components: buildAnimeActionRows({
          shortId: anime.shortId,
          hoshikaId: anime.hoshikaId,
          ownerUserId: interaction.user.id,
          aniscrollUrl,
        }),
      });
      return;
    }

    if (sub === 'trending' || sub === 'popular') {
      const sort = sub === 'popular' ? 'top' : 'trending';
      const { items } = await ctx.animeService.getTrending(sort, locale);
      if (items.length === 0) {
        await interaction.editReply({ embeds: [createErrorEmbed('No items returned right now.')] });
        return;
      }
      const hydratedFirst = await ctx.animeService.hydrateAnimeItem(items[0], locale);
      items[0] = hydratedFirst.anime;
      const first = items[0];

      const sessionKey = `${interaction.user.id}:${interaction.channelId}`;
      animePaginationSessions.set(sessionKey, {
        ownerId: interaction.user.id,
        results: items,
        expiresAt: Date.now() + 10 * 60_000,
      });
      const aniscrollUrl = ctx.animeService.linkService.buildUrl(first.shortId);
      await interaction.editReply({
        embeds: [
          createAnimeEmbed(first, {
            aniscrollUrl,
            detailsFetchError: hydratedFirst.detailsError,
          }).setFooter({
            text: `${sub === 'popular' ? 'Popular' : 'Trending'} · 1 of ${items.length} · ${first.shortId ? `Hoshika ID ${first.shortId}` : 'Hoshika ID unavailable'}`,
          }),
        ],
        components: buildAnimeActionRows({
          shortId: first.shortId,
          hoshikaId: first.hoshikaId,
          ownerUserId: interaction.user.id,
          page: 0,
          totalPages: items.length,
          aniscrollUrl,
          searchResults: items,
        }),
      });
      return;
    }

    if (sub === 'random') {
      const genre = interaction.options.getString('genre') || undefined;
      const year = interaction.options.getInteger('year') || undefined;
      const anime = await ctx.animeService.getRandom({ genre, year }, locale);
      const aniscrollUrl = ctx.animeService.linkService.buildUrl(anime.shortId);
      await interaction.editReply({
        embeds: [createAnimeEmbed(anime, { aniscrollUrl })],
        components: buildAnimeActionRows({
          shortId: anime.shortId,
          hoshikaId: anime.hoshikaId,
          ownerUserId: interaction.user.id,
          aniscrollUrl,
        }),
      });
      return;
    }

    if (sub === 'genres') {
      const genres = await ctx.animeService.getGenres();
      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: 'Anime Genres',
            description: genres.join(' · ') || 'No genres available.',
          }),
        ],
      });
      return;
    }

    if (sub === 'season') {
      const res = await ctx.animeService.getSeasonal(locale);
      const list = res.items.slice(0, 10).map((a, idx) => {
        const title = a.titleEnglish || a.titleRomaji || 'Untitled';
        const url = ctx.animeService.linkService.buildUrl(a.shortId);
        const label = url ? `[${title}](${url})` : title;
        return `**${idx + 1}.** ${label} (${a.type || 'TV'})`;
      });
      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: res.season ? `${res.season.season} ${res.season.year} Season` : 'Current Season',
            description: list.join('\n') || 'No seasonal titles found.',
          }),
        ],
      });
      return;
    }

    if (sub === 'schedule') {
      const res = await ctx.animeService.getSchedule(locale);
      const lines = res.items.slice(0, 12).map((item) => {
        const title = item.anime.titleEnglish || item.anime.titleRomaji || 'Untitled';
        const url = ctx.animeService.linkService.buildUrl(item.anime.shortId);
        const label = url ? `[${title}](${url})` : title;
        const ep = item.episode ? `Ep ${item.episode}` : '';
        const date = item.airingAt ? item.airingAt.slice(0, 16).replace('T', ' ') : 'TBA';
        return `**${label}** ${ep} · \`${date} UTC\``;
      });
      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: 'Weekly Airing Schedule',
            description: lines.join('\n') || 'No scheduled airings found.',
          }),
        ],
      });
      return;
    }

    if (sub === 'episodes') {
      const target = interaction.options.getString('anime', true);
      const { anime } = await ctx.animeService.getDetails(target, locale);
      if (!anime.shortId) {
        await interaction.editReply({
          embeds: [createErrorEmbed('Hoshika shortId is unavailable for this anime.')],
        });
        return;
      }
      const { episodes } = await ctx.animeService.getEpisodes(anime.shortId, 0, 15, locale);
      const lines = episodes.map(
        (ep) => `**${ep.number}.** ${ep.title}${ep.filler ? ' (Filler)' : ''}${ep.recap ? ' (Recap)' : ''}`
      );
      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: `Episodes · ${anime.titleEnglish || anime.titleRomaji}`,
            description: lines.join('\n') || 'No episode records found.',
          }),
        ],
      });
      return;
    }

    if (sub === 'related') {
      const target = interaction.options.getString('anime', true);
      const { anime } = await ctx.animeService.getDetails(target, locale);
      const lines = anime.relations.map((r) => {
        const url = ctx.animeService.linkService.buildUrl(r.shortId);
        const label = url ? `[${r.title}](${url})` : r.title;
        return `**${r.relationType}** · ${label} (${r.format || 'Anime'})`;
      });
      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: `Related Anime · ${anime.titleEnglish || anime.titleRomaji}`,
            description: lines.join('\n') || 'No related titles listed.',
          }),
        ],
      });
      return;
    }

    if (sub === 'watch') {
      const target = interaction.options.getString('anime', true);
      const match = await ctx.animeService.linkService.resolveWatchUrl(target);
      if (!match) {
        await interaction.editReply({
          embeds: [
            createErrorEmbed(
              `No Hoshika shortId was found for "${target}". AniList IDs are not used for AniScroll links.`,
              'AniScroll Link Unavailable'
            ),
          ],
        });
        return;
      }
      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: 'Watch on AniScroll',
            description: `Hoshika ID \`${match.shortId}\`: [Open ${match.title || target}](${match.url})`,
          }),
        ],
      });
    }
  },
};
