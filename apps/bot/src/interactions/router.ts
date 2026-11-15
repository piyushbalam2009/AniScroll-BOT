import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  Interaction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  appConfig,
  AppError,
  createModuleLogger,
  ERROR_CODES,
  WEBSITE_WATCH_STATUS_LABELS,
} from '../../../../packages/shared/src';
import {
  buildAnimeActionRows,
  buildMusicControlRows,
  createAnimeEmbed,
  createErrorEmbed,
  createMonochromeEmbed,
  createNowPlayingEmbed,
  createWebsiteWatchlistEntryEmbed,
} from '../../../../packages/discord-ui/src';
import { BotCommandContext, BotSlashCommand } from '../commands';
import {
  animePaginationSessions,
  animeRecommendationSessions,
  publishPublicRecommendation,
} from '../commands/anime/anime';
import {
  addAnimeToWebsiteWatchlist,
  watchlistAddSessions,
} from '../commands/watchlist/watchlist';
import { assertMusicControlAccess, musicSearchSessions } from '../commands/music/music';
import { formatDuration } from '../services/music/MusicService';

const log = createModuleLogger('InteractionRouter');

export async function handleInteraction(
  interaction: Interaction,
  commands: Map<string, BotSlashCommand>,
  ctx: BotCommandContext
) {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction, commands, ctx);
    } else if (interaction.isButton()) {
      await handleButton(interaction, ctx);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction, ctx);
    }
  } catch (err) {
    const userMessage =
      err instanceof AppError
        ? err.userMessage
        : 'An unexpected error occurred while processing your request.';
    if (!(err instanceof AppError)) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'Unhandled interaction error');
    }
    const payload = { embeds: [createErrorEmbed(userMessage)], ephemeral: true };
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [createErrorEmbed(userMessage)], components: [] }).catch(() => undefined);
      } else {
        await interaction.reply(payload).catch(() => undefined);
      }
    }
  }
}

async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  commands: Map<string, BotSlashCommand>,
  ctx: BotCommandContext
) {
  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;

  const isOwner = appConfig.ownerIds.includes(interaction.user.id);
  if (ctx.maintenanceMode && !isOwner) {
    await interaction.reply({
      ephemeral: true,
      embeds: [createErrorEmbed('AniScroll Bot is currently in maintenance mode. Please try again shortly.')],
    });
    return;
  }

  if (cmd.ownerOnly && !isOwner) {
    throw new AppError(ERROR_CODES.USER_MISSING_PERMISSIONS, 'This command is restricted to bot owners.', 403);
  }

  if (cmd.requiredPermissions && interaction.guild) {
    const member = interaction.member as GuildMember | null;
    if (!member || !member.permissions.has(cmd.requiredPermissions)) {
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        'You do not have the required server permissions for this command.',
        403
      );
    }
  }

  const cooldown = cmd.cooldownSeconds ?? 2;
  const rl = await ctx.cache.checkRateLimit(`cmd:${cmd.name}:${interaction.user.id}`, 1, cooldown);
  if (!rl.allowed) {
    throw new AppError(
      ERROR_CODES.RATE_LIMIT_EXCEEDED,
      `Please wait ${rl.retryAfterSeconds}s before using \`/${cmd.name}\` again.`,
      429
    );
  }

  const start = Date.now();
  let success = true;
  try {
    await cmd.execute(interaction, ctx);
  } catch (e) {
    success = false;
    throw e;
  } finally {
    const sub = interaction.options.getSubcommand(false);
    const fullName = sub ? `${cmd.name} ${sub}` : cmd.name;
    const guildRecord = interaction.guildId ? ctx.db.getGuildByDiscordId(interaction.guildId) : null;
    ctx.db.recordCommandMetric({
      guildId: guildRecord?.id ?? null,
      commandName: fullName,
      category: cmd.category,
      userId: interaction.user.id,
      success,
      durationMs: Date.now() - start,
    });
  }
}

async function handleButton(interaction: ButtonInteraction, ctx: BotCommandContext) {
  const parts = interaction.customId.split(':');
  const domain = parts[0];

  if (domain === 'anime') {
    const action = parts[1];

    // Public recommendation card "View Details" button — open to all channel members
    if (action === 'recdetails') {
      const targetShortId = Number(parts[2]);
      await interaction.deferReply({ ephemeral: true });
      const locale = interaction.guildId
        ? ctx.db.getGuildSettings(interaction.guildId).animeConfig.locale
        : 'en';
      const { anime } = await ctx.animeService.getDetails(targetShortId, locale);
      const aniscrollUrl = ctx.animeService.linkService.buildUrl(anime.shortId);
      await interaction.editReply({
        embeds: [
          createAnimeEmbed(anime, { aniscrollUrl, detailed: true }).setFooter({
            text: `Anime Details · ${anime.shortId ? `Hoshika ID ${anime.shortId}` : 'Hoshika ID unavailable'}`,
          }),
        ],
      });
      return;
    }

    // Cancel pending recommendation selection
    if (action === 'reccancel') {
      const ownerUserId = parts[2];
      const sessionId = parts[3];
      if (interaction.user.id !== ownerUserId) {
        throw new AppError(
          ERROR_CODES.USER_MISSING_PERMISSIONS,
          'Only the user who initiated this recommendation can cancel it.',
          403
        );
      }
      if (sessionId) {
        animeRecommendationSessions.delete(sessionId);
      }
      await interaction.update({
        embeds: [
          createMonochromeEmbed({
            title: 'Recommendation Cancelled',
            description: 'Anime selection cancelled. No public message was sent.',
          }),
        ],
        components: [],
      });
      return;
    }

    const [, , ownerUserId, target] = parts;
    if (interaction.user.id !== ownerUserId) {
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        'Only the user who ran this search can control these buttons.',
        403
      );
    }
    const sessionKey = `${ownerUserId}:${interaction.channelId}`;
    const session = animePaginationSessions.get(sessionKey);

    if (action === 'page') {
      if (!session || Date.now() > session.expiresAt) {
        throw new AppError(ERROR_CODES.INTERACTION_EXPIRED, 'This search session has expired. Run `/anime search` again.', 410);
      }
      const nextIdx = Math.max(0, Math.min(session.results.length - 1, Number(target)));
      const locale = interaction.guildId
        ? ctx.db.getGuildSettings(interaction.guildId).animeConfig.locale
        : 'en';
      const hydrated = await ctx.animeService.hydrateAnimeItem(session.results[nextIdx], locale);
      session.results[nextIdx] = hydrated.anime;
      const anime = hydrated.anime;
      const aniscrollUrl = ctx.animeService.linkService.buildUrl(anime.shortId);
      await interaction.update({
        embeds: [
          createAnimeEmbed(anime, {
            aniscrollUrl,
            detailsFetchError: hydrated.detailsError,
          }).setFooter({
            text: `Result ${nextIdx + 1} of ${session.results.length} · ${anime.shortId ? `Hoshika ID ${anime.shortId}` : 'Hoshika ID unavailable'}`,
          }),
        ],
        components: buildAnimeActionRows({
          shortId: anime.shortId,
          hoshikaId: anime.hoshikaId,
          ownerUserId,
          page: nextIdx,
          totalPages: session.results.length,
          aniscrollUrl,
          searchResults: session.results,
        }),
      });
      return;
    }

    if (action === 'details') {
      await interaction.deferReply({ ephemeral: true });
      const locale = interaction.guildId
        ? ctx.db.getGuildSettings(interaction.guildId).animeConfig.locale
        : 'en';
      const { anime } = await ctx.animeService.getDetails(Number(target), locale);
      if (session) {
        const idx = session.results.findIndex((r) => r.shortId === anime.shortId);
        if (idx >= 0) {
          session.results[idx] = anime;
        }
      }
      const aniscrollUrl = ctx.animeService.linkService.buildUrl(anime.shortId);
      await interaction.editReply({
        embeds: [
          createAnimeEmbed(anime, { aniscrollUrl, detailed: true }).setFooter({
            text: `Anime Details · ${anime.shortId ? `Hoshika ID ${anime.shortId}` : 'Hoshika ID unavailable'}`,
          }),
        ],
      });
      return;
    }

    if (action === 'episodes') {
      await interaction.deferReply({ ephemeral: true });
      const { episodes } = await ctx.animeService.getEpisodes(Number(target), 0, 12, 'en');
      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: 'Episode List',
            description: episodes.map((e) => `**${e.number}.** ${e.title}`).join('\n') || 'No episodes listed.',
          }),
        ],
      });
      return;
    }

    if (action === 'related') {
      await interaction.deferReply({ ephemeral: true });
      const { anime } = await ctx.animeService.getDetails(Number(target), 'en');
      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: `Related · ${anime.titleEnglish || anime.titleRomaji}`,
            description:
              anime.relations
                .map((r) => {
                  const url = ctx.animeService.linkService.buildUrl(r.shortId);
                  return `**${r.relationType}** · ${url ? `[${r.title}](${url})` : r.title}`;
                })
                .join('\n') || 'No related titles found.',
          }),
        ],
      });
      return;
    }
  }

  // Cancel /watchlist add selection
  if (domain === 'watchlist' && parts[1] === 'addcancel') {
    const ownerUserId = parts[2];
    const sessionId = parts[3];
    if (interaction.user.id !== ownerUserId) {
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        'Only the user who ran `/watchlist add` can cancel this selection.',
        403
      );
    }
    if (sessionId) {
      watchlistAddSessions.delete(sessionId);
    }
    await interaction.update({
      embeds: [
        createMonochromeEmbed({
          title: 'Watchlist Addition Cancelled',
          description: 'Anime selection cancelled. Nothing was added to your AniScroll website watchlist.',
        }),
      ],
      components: [],
    });
    return;
  }

  // Public recommendation card "Add to Watchlist" button — open to all members via website watchlist API
  if (domain === 'watchlist' && parts[1] === 'recadd') {
    const shortId = Number(parts[2]);
    await interaction.deferReply({ ephemeral: true });

    const locale = interaction.guildId
      ? ctx.db.getGuildSettings(interaction.guildId).animeConfig.locale
      : 'en';
    const saved = await addAnimeToWebsiteWatchlist(ctx, interaction.user.id, shortId, {
      status: 'plan_to_watch',
      locale,
    });

    await interaction.editReply({
      embeds: [
        createWebsiteWatchlistEntryEmbed(saved, {
          title: 'Added to Watchlist',
          description: `Saved **${saved.title}** (\`Hoshika ID: ${saved.shortId}\`) to your AniScroll website watchlist under **${WEBSITE_WATCH_STATUS_LABELS[saved.status]}**.`,
        }),
      ],
    });
    return;
  }

  if (domain === 'watchlist' && parts[1] === 'quickadd') {
    const [, , ownerUserId, shortId] = parts;
    if (interaction.user.id !== ownerUserId) {
      throw new AppError(ERROR_CODES.USER_MISSING_PERMISSIONS, 'Use `/watchlist add` to add to your own watchlist.', 403);
    }
    await interaction.deferReply({ ephemeral: true });

    const locale = interaction.guildId
      ? ctx.db.getGuildSettings(interaction.guildId).animeConfig.locale
      : 'en';
    const saved = await addAnimeToWebsiteWatchlist(ctx, interaction.user.id, Number(shortId), {
      status: 'plan_to_watch',
      locale,
    });

    await interaction.editReply({
      embeds: [
        createWebsiteWatchlistEntryEmbed(saved, {
          title: 'Added to Watchlist',
          description: `Saved **${saved.title}** to your AniScroll website watchlist under **${WEBSITE_WATCH_STATUS_LABELS[saved.status]}**.`,
        }),
      ],
    });
    return;
  }

  if (domain === 'music' && interaction.guildId) {
    const action = parts[1];

    if (action === 'searchcancel') {
      const ownerUserId = parts[2];
      const sessionId = parts[3];
      if (interaction.user.id !== ownerUserId) {
        throw new AppError(ERROR_CODES.USER_MISSING_PERMISSIONS, 'Only the search author can cancel this search.', 403);
      }
      if (sessionId) musicSearchSessions.delete(sessionId);
      await interaction.update({
        embeds: [createMonochromeEmbed({ title: 'Search Cancelled', description: 'Track selection cancelled.' })],
        components: [],
      });
      return;
    }

    if (action === 'queue') {
      const queue = ctx.musicService.getQueue(interaction.guildId);
      const upNext = queue.tracks
        .slice(0, 10)
        .map((t, i) => `**${i + 1}.** ${t.title} — ${t.author} \`[${formatDuration(t.durationMs, t.isStream)}]\` (<@${t.requesterId}>)`);
      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: 'Server Queue',
            description:
              (queue.current
                ? `**Now Playing:** ${queue.current.title} — ${queue.current.author}\n\n`
                : 'Nothing playing.\n\n') + (upNext.join('\n') || 'Queue is empty.'),
            footerText: `${queue.tracks.length} queued · Loop ${queue.loopMode.toUpperCase()} · Volume ${queue.volume}%`,
          }),
        ],
      });
      return;
    }

    assertMusicControlAccess(interaction, ctx);
    const queue = ctx.musicService.getQueue(interaction.guildId);
    const maxVol = ctx.db.getGuildSettings(interaction.guildId).musicConfig.maxVolume;

    if (action === 'toggle') {
      await ctx.musicService.pause(interaction.guildId, !queue.paused);
    } else if (action === 'skip') {
      await ctx.musicService.skip(interaction.guildId);
    } else if (action === 'stop') {
      await ctx.musicService.stop(interaction.guildId);
    } else if (action === 'loop') {
      queue.cycleLoop();
    } else if (action === 'shuffle') {
      queue.shuffle();
    } else if (action === 'voldown') {
      await ctx.musicService.setVolume(interaction.guildId, queue.volume - 10, maxVol);
    } else if (action === 'volup') {
      await ctx.musicService.setVolume(interaction.guildId, queue.volume + 10, maxVol);
    } else if (action === 'prev') {
      await ctx.musicService.previous(interaction.guildId);
    }

    const posMs = ctx.musicService.getLivePositionMs(interaction.guildId);
    const updatedEmbed = queue.current
      ? createNowPlayingEmbed(queue, posMs)
      : createMonochromeEmbed({ title: 'Playback Stopped', description: 'No tracks remaining in queue.' });

    await interaction.update({
      embeds: [updatedEmbed],
      components: buildMusicControlRows(queue.paused, queue.loopMode, Boolean(queue.current)),
    });
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction, ctx: BotCommandContext) {
  const [domain, action, ownerUserId, sessionId] = interaction.customId.split(':');

  if (domain === 'watchlist' && action === 'addselect') {
    if (interaction.user.id !== ownerUserId) {
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        'Only the user who ran `/watchlist add` can select an anime from this menu.',
        403
      );
    }
    const addSession = sessionId ? watchlistAddSessions.get(sessionId) : undefined;
    if (!addSession || Date.now() > addSession.expiresAt) {
      if (sessionId) watchlistAddSessions.delete(sessionId);
      throw new AppError(
        ERROR_CODES.INTERACTION_EXPIRED,
        'This watchlist selection menu has expired. Please run `/watchlist add` again.',
        410
      );
    }

    const selectedShortId = Number(interaction.values[0]);
    if (!Number.isInteger(selectedShortId) || selectedShortId <= 0) {
      throw new AppError(ERROR_CODES.INVALID_ANIME_ID, 'Invalid Hoshika anime selection.', 400);
    }

    await interaction.deferUpdate();
    watchlistAddSessions.delete(sessionId);

    const saved = await addAnimeToWebsiteWatchlist(ctx, interaction.user.id, selectedShortId, {
      status: addSession.status,
      locale: addSession.locale,
    });

    await interaction.editReply({
      embeds: [
        createWebsiteWatchlistEntryEmbed(saved, {
          title: `Added to Watchlist · ${saved.title}`,
          description: `Added to your **AniScroll** website watchlist under **${WEBSITE_WATCH_STATUS_LABELS[saved.status]}**.`,
        }),
      ],
      components: [],
    });
    return;
  }

  if (domain === 'anime' && action === 'recselect') {
    if (interaction.user.id !== ownerUserId) {
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        'Only the user who ran `/anime recommendation` can select an anime from this menu.',
        403
      );
    }
    const recSession = sessionId ? animeRecommendationSessions.get(sessionId) : undefined;
    if (!recSession || Date.now() > recSession.expiresAt) {
      if (sessionId) animeRecommendationSessions.delete(sessionId);
      throw new AppError(
        ERROR_CODES.INTERACTION_EXPIRED,
        'This recommendation selection menu has expired. Please run `/anime recommendation` again.',
        410
      );
    }

    const selectedShortId = Number(interaction.values[0]);
    if (!Number.isInteger(selectedShortId) || selectedShortId <= 0) {
      throw new AppError(ERROR_CODES.INVALID_ANIME_ID, 'Invalid anime selection.', 400);
    }

    await interaction.deferUpdate();
    animeRecommendationSessions.delete(sessionId);

    const published = await publishPublicRecommendation(interaction, ctx, selectedShortId, {
      userId: recSession.ownerId,
      username: recSession.username,
      guildId: recSession.guildId,
      guildName: recSession.guildName,
      channelId: recSession.channelId,
      locale: recSession.locale,
    });

    const title = published.anime.titleEnglish || published.anime.titleRomaji || `Anime #${published.shortId}`;
    await interaction
      .editReply({
        embeds: [
          createMonochromeEmbed({
            title: 'Recommendation Published',
            description: `Your public recommendation for **${title}** (\`Hoshika ID: ${published.shortId}\`) has been posted in <#${recSession.channelId}>.`,
          }),
        ],
        components: [],
      })
      .catch((err) => {
        log.warn(
          { sessionId, err: err instanceof Error ? err.message : String(err) },
          'Selection message was already deleted or could not be edited after publishing recommendation'
        );
      });
    return;
  }

  if (domain === 'anime' && action === 'select') {
    if (interaction.user.id !== ownerUserId) {
      throw new AppError(ERROR_CODES.USER_MISSING_PERMISSIONS, 'Only the search author can use this menu.', 403);
    }
    const shortId = Number(interaction.values[0]);
    const locale = interaction.guildId
      ? ctx.db.getGuildSettings(interaction.guildId).animeConfig.locale
      : 'en';
    const sessionKey = `${ownerUserId}:${interaction.channelId}`;
    const session = animePaginationSessions.get(sessionKey);
    const selectedIdx = session ? session.results.findIndex((r) => r.shortId === shortId) : -1;

    let anime;
    let detailsFetchError: string | null = null;
    if (session && selectedIdx >= 0) {
      const hydrated = await ctx.animeService.hydrateAnimeItem(session.results[selectedIdx], locale);
      session.results[selectedIdx] = hydrated.anime;
      anime = hydrated.anime;
      detailsFetchError = hydrated.detailsError;
    } else {
      const res = await ctx.animeService.getDetails(shortId, locale);
      anime = res.anime;
    }

    const aniscrollUrl = ctx.animeService.linkService.buildUrl(anime.shortId);
    const embed = createAnimeEmbed(anime, { aniscrollUrl, detailsFetchError });
    if (session && selectedIdx >= 0) {
      embed.setFooter({
        text: `Result ${selectedIdx + 1} of ${session.results.length} · ${anime.shortId ? `Hoshika ID ${anime.shortId}` : 'Hoshika ID unavailable'}`,
      });
    }

    await interaction.update({
      embeds: [embed],
      components: buildAnimeActionRows({
        shortId: anime.shortId,
        hoshikaId: anime.hoshikaId,
        ownerUserId,
        page: selectedIdx >= 0 ? selectedIdx : undefined,
        totalPages: session?.results.length,
        aniscrollUrl,
        searchResults: session?.results,
      }),
    });
    return;
  }

  if (domain === 'music' && action === 'pick') {
    if (interaction.user.id !== ownerUserId) {
      throw new AppError(ERROR_CODES.USER_MISSING_PERMISSIONS, 'Only the user who ran `/search` can select a track.', 403);
    }
    if (!interaction.guildId || !interaction.guild) return;

    const searchSession = sessionId ? musicSearchSessions.get(sessionId) : undefined;
    if (!searchSession || Date.now() > searchSession.expiresAt) {
      throw new AppError(ERROR_CODES.INTERACTION_EXPIRED, 'This search session has expired. Run `/search` again.', 410);
    }

    const idx = Number(interaction.values[0]);
    const chosen = searchSession.tracks[idx];
    if (!chosen) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Invalid track selection.', 400);
    }

    const voiceChannel = assertMusicControlAccess(interaction, ctx);
    const settings = ctx.db.getGuildSettings(interaction.guildId).musicConfig;

    await interaction.deferUpdate();
    musicSearchSessions.delete(sessionId);

    const result = await ctx.musicService.playInVoice({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
      shardId: interaction.guild.shardId,
      preResolvedTracks: [chosen],
      requesterId: interaction.user.id,
      requesterTag: interaction.user.tag,
      defaultVolume: settings.defaultVolume,
      maxQueueSize: settings.maxQueueSize,
      emptyLeaveDelaySeconds: settings.emptyLeaveDelaySeconds,
    });

    const { track, position, queue } = result;
    const embed =
      position === 0
        ? createNowPlayingEmbed(queue, 0, 'Now Playing')
        : createMonochromeEmbed({
            title: `Queued (#${position})`,
            description: `${track.uri ? `[${track.title}](${track.uri})` : `**${track.title}**`} — ${track.author}`,
          }).addFields(
            { name: 'Duration', value: formatDuration(track.durationMs, track.isStream), inline: true },
            { name: 'Source', value: track.sourceName.toUpperCase(), inline: true },
            { name: 'Queue Length', value: `${queue.tracks.length} queued`, inline: true },
            { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true }
          );
    if (position !== 0 && track.artworkUrl) {
      embed.setThumbnail(track.artworkUrl);
    }

    const msg = await interaction.editReply({
      embeds: [embed],
      components: buildMusicControlRows(queue.paused, queue.loopMode, Boolean(queue.current)),
    });
    if (position === 0) {
      ctx.musicService.setNowPlayingMessage(interaction.guildId, msg as any);
    }
  }
}
