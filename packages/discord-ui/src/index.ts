import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  BRAND_THEME,
  NormalizedAnime,
  WEBSITE_WATCH_STATUS_LABELS,
  WebsiteWatchlistItem,
} from '../../shared/src/types';

export function createMonochromeEmbed(options?: {
  title?: string;
  description?: string;
  footerText?: string;
  color?: number;
}) {
  const embed = new EmbedBuilder()
    .setColor(options?.color ?? BRAND_THEME.embedHex)
    .setTimestamp();
  if (options?.title) embed.setTitle(options.title.slice(0, 256));
  if (options?.description) embed.setDescription(options.description.slice(0, 4096));
  embed.setFooter({
    text: options?.footerText || 'AniScroll Bot · Monochrome Community Platform',
  });
  return embed;
}

export function createErrorEmbed(userMessage: string, title = 'Request could not be completed') {
  return createMonochromeEmbed({
    title,
    description: userMessage,
    color: BRAND_THEME.error,
  });
}

export interface CreateAnimeEmbedOptions {
  aniscrollUrl?: string | null;
  compact?: boolean;
  detailed?: boolean;
  detailsFetchError?: string | null;
}

export function createAnimeEmbed(
  anime: NormalizedAnime,
  options?: CreateAnimeEmbedOptions
) {
  const title = anime.titleEnglish || anime.titleRomaji || anime.titleNative || 'Untitled Anime';
  const maxAlt = options?.detailed ? 6 : 3;
  const altTitles = anime.alternativeTitles.slice(0, maxAlt).join(' · ');

  const maxSynopsisChars = options?.compact ? 350 : 3800;
  const cleanSynopsis = anime.synopsis?.trim() || '';

  let synopsisBody: string;
  if (cleanSynopsis.length > 0) {
    synopsisBody =
      cleanSynopsis.length > maxSynopsisChars
        ? `${cleanSynopsis.slice(0, maxSynopsisChars)}...`
        : cleanSynopsis;
  } else if (options?.detailsFetchError) {
    synopsisBody = `Could not retrieve anime details from Hoshika (${options.detailsFetchError}).`;
  } else {
    synopsisBody = 'Synopsis is not available for this anime.';
  }

  const embed = createMonochromeEmbed({
    title,
    description: `**Synopsis:**\n${synopsisBody}`,
  });

  if (anime.poster) {
    embed.setThumbnail(anime.poster);
  }
  if (!options?.compact && anime.banner) {
    embed.setImage(anime.banner);
  }

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  if (altTitles) {
    fields.push({ name: 'Alternative Titles', value: altTitles.slice(0, 1024), inline: false });
  }

  const resolvedAniScrollUrl = options?.aniscrollUrl ?? anime.aniscrollUrl ?? null;

  if (options?.detailed) {
    if (anime.type) {
      fields.push({ name: 'Format', value: anime.type, inline: true });
    }
    if (anime.releaseYear !== null && anime.releaseYear !== undefined) {
      fields.push({ name: 'Release Year', value: String(anime.releaseYear), inline: true });
    }
    if (anime.season) {
      fields.push({ name: 'Season', value: anime.season, inline: true });
    }
    if (anime.status) {
      fields.push({ name: 'Status', value: anime.status, inline: true });
    }
    if (anime.totalEpisodes !== null && anime.totalEpisodes !== undefined) {
      const epText = anime.episodeDuration
        ? `${anime.totalEpisodes} ep (${anime.episodeDuration} min)`
        : `${anime.totalEpisodes} ep`;
      fields.push({ name: 'Episodes', value: epText, inline: true });
    }
    if (anime.rating !== null && anime.rating !== undefined) {
      fields.push({ name: 'Score', value: `${anime.rating}/100`, inline: true });
    }
    if (anime.source) {
      fields.push({
        name: 'Source Material',
        value: anime.source.replace(/_/g, ' '),
        inline: true,
      });
    }
    if (anime.genres.length > 0) {
      fields.push({
        name: 'Genres',
        value: anime.genres.slice(0, 10).join(' · ').slice(0, 1024),
        inline: false,
      });
    }
    if (anime.studios.length > 0) {
      fields.push({
        name: 'Studios',
        value: anime.studios.slice(0, 8).join(' · ').slice(0, 1024),
        inline: false,
      });
    }
    if (anime.trailerUrl) {
      fields.push({
        name: 'Trailer',
        value: `[Watch Trailer](${anime.trailerUrl})`,
        inline: true,
      });
    }
  } else {
    const formatYearParts = [
      anime.type,
      anime.releaseYear !== null && anime.releaseYear !== undefined ? String(anime.releaseYear) : null,
      anime.status,
    ].filter(Boolean);

    if (formatYearParts.length > 0) {
      fields.push({
        name: 'Format & Year',
        value: formatYearParts.join(' · '),
        inline: true,
      });
    }
    if (anime.totalEpisodes !== null && anime.totalEpisodes !== undefined) {
      fields.push({
        name: 'Episodes',
        value: `${anime.totalEpisodes} ep`,
        inline: true,
      });
    }
    if (anime.rating !== null && anime.rating !== undefined) {
      fields.push({
        name: 'Score',
        value: `${anime.rating}/100`,
        inline: true,
      });
    }
    if (anime.genres.length > 0) {
      fields.push({
        name: 'Genres',
        value: anime.genres.slice(0, 6).join(' · '),
        inline: false,
      });
    }
  }

  if (resolvedAniScrollUrl) {
    fields.push({
      name: 'AniScroll',
      value: `[Open on AniScroll](${resolvedAniScrollUrl})`,
      inline: false,
    });
  }

  if (fields.length > 0) {
    embed.addFields(fields);
  }
  return embed;
}

export function buildAnimeActionRows(options: {
  shortId: number | null;
  hoshikaId: string;
  ownerUserId: string;
  page?: number;
  totalPages?: number;
  aniscrollUrl?: string | null;
  searchResults?: NormalizedAnime[];
}) {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  const navButtons = new ActionRowBuilder<ButtonBuilder>();
  if (options.totalPages && options.totalPages > 1) {
    const page = options.page ?? 0;
    navButtons.addComponents(
      new ButtonBuilder()
        .setCustomId(`anime:page:${options.ownerUserId}:${page - 1}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`anime:page:${options.ownerUserId}:${page + 1}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= options.totalPages - 1)
    );
  }

  if (options.shortId && options.shortId > 0) {
    navButtons.addComponents(
      new ButtonBuilder()
        .setCustomId(`anime:details:${options.ownerUserId}:${options.shortId}`)
        .setLabel('Details')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`anime:episodes:${options.ownerUserId}:${options.shortId}`)
        .setLabel('Episodes')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`anime:related:${options.ownerUserId}:${options.shortId}`)
        .setLabel('Related')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (navButtons.components.length > 0) {
    rows.push(navButtons);
  }

  const secondaryRow = new ActionRowBuilder<ButtonBuilder>();
  if (options.shortId && options.shortId > 0) {
    secondaryRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`watchlist:quickadd:${options.ownerUserId}:${options.shortId}`)
        .setLabel('Add to Watchlist')
        .setStyle(ButtonStyle.Success)
    );
  }

  if (options.aniscrollUrl) {
    secondaryRow.addComponents(
      new ButtonBuilder()
        .setLabel('Open AniScroll')
        .setStyle(ButtonStyle.Link)
        .setURL(options.aniscrollUrl)
    );
  }
  if (secondaryRow.components.length > 0) {
    rows.push(secondaryRow);
  }

  const selectable = (options.searchResults || []).filter((item) => item.shortId && item.shortId > 0);
  if (selectable.length > 1) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`anime:select:${options.ownerUserId}`)
      .setPlaceholder('Select an anime from search results...')
      .addOptions(
        selectable.slice(0, 25).map((item) => ({
          label: (item.titleEnglish || item.titleRomaji || 'Untitled').slice(0, 100),
          description: `${item.type || 'Anime'} · ${item.releaseYear ?? 'TBA'}`.slice(0, 100),
          value: String(item.shortId),
        }))
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  return rows;
}

export interface NowPlayingDisplayTrack {
  title: string;
  author: string;
  durationMs: number;
  uri?: string;
  artworkUrl?: string;
  isStream?: boolean;
  requesterId: string;
  sourceName: string;
}

export interface NowPlayingDisplayQueue {
  current: NowPlayingDisplayTrack | null;
  tracks: NowPlayingDisplayTrack[];
  loopMode: 'off' | 'track' | 'queue';
  volume: number;
  paused: boolean;
}

function formatTrackTime(ms: number, isStream = false): string {
  if (isStream) return 'LIVE';
  if (!ms || ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTrackProgressBar(positionMs: number, durationMs: number, length = 14): string {
  if (!durationMs || durationMs <= 0) return `[${'─'.repeat(length)}]`;
  const clamped = Math.max(0, Math.min(durationMs, positionMs));
  const idx = Math.min(length - 1, Math.max(0, Math.round((clamped / durationMs) * (length - 1))));
  return `[${'━'.repeat(idx)}●${'─'.repeat(Math.max(0, length - 1 - idx))}]`;
}

export function createNowPlayingEmbed(
  queue: NowPlayingDisplayQueue,
  positionMs = 0,
  titleOverride?: string
) {
  const track = queue.current;
  if (!track) {
    return createMonochromeEmbed({
      title: titleOverride || 'Nothing Playing',
      description: 'No track is currently active in this server. Use `/play` or `/search` to queue music.',
    });
  }

  const titleDisplay = track.uri ? `[${track.title}](${track.uri})` : `**${track.title}**`;
  const durationLabel = formatTrackTime(track.durationMs, track.isStream);
  const posLabel = formatTrackTime(positionMs, false);
  const progressLine = track.isStream
    ? '`LIVE STREAM`'
    : `\`${formatTrackProgressBar(positionMs, track.durationMs)}\` \`${posLabel} / ${durationLabel}\``;

  const embed = createMonochromeEmbed({
    title: titleOverride || (queue.paused ? 'Now Playing (Paused)' : 'Now Playing'),
    description: `${titleDisplay}\nby **${track.author}**\n\n${progressLine}`,
    footerText: `AniScroll Music · Volume ${queue.volume}% · Loop ${queue.loopMode.toUpperCase()}`,
  });

  if (track.artworkUrl) {
    embed.setThumbnail(track.artworkUrl);
  }

  embed.addFields(
    { name: 'Duration', value: durationLabel, inline: true },
    { name: 'Source', value: track.sourceName.toUpperCase(), inline: true },
    { name: 'Queue Length', value: `${queue.tracks.length} queued`, inline: true },
    { name: 'Requested By', value: `<@${track.requesterId}>`, inline: true }
  );

  return embed;
}

export function buildMusicControlRows(
  paused: boolean,
  loopMode: 'off' | 'track' | 'queue',
  hasCurrent = true
) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('music:prev')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasCurrent),
    new ButtonBuilder()
      .setCustomId('music:toggle')
      .setLabel(paused ? 'Resume' : 'Pause')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasCurrent),
    new ButtonBuilder()
      .setCustomId('music:skip')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasCurrent),
    new ButtonBuilder()
      .setCustomId('music:stop')
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasCurrent)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('music:loop')
      .setLabel(`Loop: ${loopMode.toUpperCase()}`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:shuffle')
      .setLabel('Shuffle')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:queue')
      .setLabel('Queue')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:voldown')
      .setLabel('Vol -10%')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:volup')
      .setLabel('Vol +10%')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

export function buildMusicSearchSelectRow(
  ownerUserId: string,
  sessionId: string,
  tracks: Array<{ title: string; author: string; durationMs: number; sourceName: string }>
) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`music:pick:${ownerUserId}:${sessionId}`)
    .setPlaceholder('Choose a track to add to the queue...')
    .addOptions(
      tracks.slice(0, 10).map((t, idx) => ({
        label: `${idx + 1}. ${t.title}`.slice(0, 100),
        description: `${t.author} · ${formatTrackTime(t.durationMs)} · ${t.sourceName}`.slice(0, 100),
        value: String(idx),
      }))
    );
  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`music:searchcancel:${ownerUserId}:${sessionId}`)
      .setLabel('Cancel Search')
      .setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2];
}

export interface PublicRecommendationEmbedOptions {
  recommenderId?: string;
  recommendedByUserId?: string;
  recommenderUsername?: string;
  recommendedByUsername?: string;
  recommenderAvatarUrl?: string | null;
  serverName?: string | null;
  aniscrollUrl?: string | null;
  detailsFetchError?: string | null;
}

export function createPublicRecommendationEmbed(
  anime: NormalizedAnime,
  options: PublicRecommendationEmbedOptions
) {
  const title = anime.titleEnglish || anime.titleRomaji || anime.titleNative || 'Untitled Anime';
  const resolvedAniScrollUrl = options.aniscrollUrl ?? anime.aniscrollUrl ?? null;
  const resolvedUserId = options.recommenderId || options.recommendedByUserId || 'unknown';
  const resolvedUsername = options.recommenderUsername || options.recommendedByUsername || 'Member';
  const resolvedServerName = options.serverName || 'Discord Server';

  const maxSynopsisChars = 3400;
  const cleanSynopsis = anime.synopsis?.trim() || '';
  let synopsisBody: string;
  if (cleanSynopsis.length > 0) {
    synopsisBody =
      cleanSynopsis.length > maxSynopsisChars
        ? `${cleanSynopsis.slice(0, maxSynopsisChars)}...`
        : cleanSynopsis;
  } else if (options.detailsFetchError) {
    synopsisBody = `Could not retrieve anime details from Hoshika (${options.detailsFetchError}).`;
  } else {
    synopsisBody = 'Synopsis is not available for this anime.';
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_THEME.embedHex)
    .setAuthor({
      name: 'Community Anime Recommendation',
      iconURL:
        options.recommenderAvatarUrl && /^https?:\/\//i.test(options.recommenderAvatarUrl)
          ? options.recommenderAvatarUrl
          : undefined,
    })
    .setTitle(title.slice(0, 256))
    .setDescription(
      `Recommended by <@${resolvedUserId}>\n\n**Synopsis:**\n${synopsisBody}`.slice(0, 4096)
    )
    .setFooter({
      text: `Recommended by: @${resolvedUsername} · Server: ${resolvedServerName} · Hoshika ID: ${
        anime.shortId ?? 'N/A'
      }`.slice(0, 2048),
    })
    .setTimestamp();

  if (resolvedAniScrollUrl && /^https?:\/\//i.test(resolvedAniScrollUrl)) {
    embed.setURL(resolvedAniScrollUrl);
  }
  if (anime.poster && /^https?:\/\//i.test(anime.poster)) {
    embed.setThumbnail(anime.poster);
  }
  if (anime.banner && /^https?:\/\//i.test(anime.banner)) {
    embed.setImage(anime.banner);
  }

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  if (anime.titleEnglish) {
    fields.push({ name: 'English Title', value: anime.titleEnglish.slice(0, 1024), inline: true });
  }
  if (anime.titleNative) {
    fields.push({ name: 'Japanese Title', value: anime.titleNative.slice(0, 1024), inline: true });
  }
  if (anime.alternativeTitles.length > 0) {
    fields.push({
      name: 'Alternative Titles',
      value: anime.alternativeTitles.slice(0, 5).join(' · ').slice(0, 1024),
      inline: false,
    });
  }
  if (anime.type) {
    fields.push({ name: 'Format', value: anime.type, inline: true });
  }
  if (anime.releaseYear !== null && anime.releaseYear !== undefined) {
    fields.push({ name: 'Release Year', value: String(anime.releaseYear), inline: true });
  }
  if (anime.season) {
    fields.push({ name: 'Season', value: anime.season, inline: true });
  }
  if (anime.totalEpisodes !== null && anime.totalEpisodes !== undefined) {
    const epVal = anime.episodeDuration
      ? `${anime.totalEpisodes} ep (${anime.episodeDuration} min)`
      : `${anime.totalEpisodes} ep`;
    fields.push({ name: 'Episodes', value: epVal, inline: true });
  }
  if (anime.status) {
    fields.push({ name: 'Airing Status', value: anime.status, inline: true });
  }
  if (anime.rating !== null && anime.rating !== undefined) {
    fields.push({ name: 'Score', value: `${anime.rating}/100`, inline: true });
  }
  if (anime.genres.length > 0) {
    fields.push({
      name: 'Genres',
      value: anime.genres.slice(0, 10).join(' · ').slice(0, 1024),
      inline: false,
    });
  }
  if (anime.studios.length > 0) {
    fields.push({
      name: 'Studios',
      value: anime.studios.slice(0, 8).join(' · ').slice(0, 1024),
      inline: false,
    });
  }
  if (anime.shortId && anime.shortId > 0) {
    fields.push({ name: 'Hoshika ID', value: String(anime.shortId), inline: true });
  }
  fields.push({
    name: 'Recommended By',
    value: `<@${resolvedUserId}>`,
    inline: true,
  });

  if (fields.length > 0) {
    embed.addFields(fields.slice(0, 25));
  }

  return embed;
}

export function buildPublicRecommendationRows(options: {
  shortId: number | null;
  aniscrollUrl?: string | null;
}) {
  const row = new ActionRowBuilder<ButtonBuilder>();

  if (options.aniscrollUrl && /^https?:\/\//i.test(options.aniscrollUrl)) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Open AniScroll')
        .setStyle(ButtonStyle.Link)
        .setURL(options.aniscrollUrl)
    );
  }

  if (options.shortId && options.shortId > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`anime:recdetails:${options.shortId}`)
        .setLabel('View Details')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`watchlist:recadd:${options.shortId}`)
        .setLabel('Add to Watchlist')
        .setStyle(ButtonStyle.Success)
    );
  }

  return row.components.length > 0 ? [row] : [];
}

export function buildRecommendationSelectRows(options: {
  ownerUserId: string;
  sessionId: string;
  candidates: NormalizedAnime[];
}) {
  const validCandidates = options.candidates
    .filter((c) => c.shortId && c.shortId > 0)
    .slice(0, 10);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`anime:recselect:${options.ownerUserId}:${options.sessionId}`)
    .setPlaceholder('Select the anime you want to recommend...')
    .addOptions(
      validCandidates.map((item) => {
        const primary = item.titleEnglish || item.titleRomaji || item.titleNative || 'Untitled';
        const alt =
          item.titleRomaji && item.titleRomaji !== primary
            ? item.titleRomaji
            : item.alternativeTitles[0] || item.titleNative || null;
        const descParts = [
          alt,
          item.releaseYear !== null && item.releaseYear !== undefined ? String(item.releaseYear) : null,
          item.type || null,
          `ID #${item.shortId}`,
        ].filter(Boolean);

        return {
          label: primary.slice(0, 100),
          description: descParts.join(' · ').slice(0, 100),
          value: String(item.shortId),
        };
      })
    );

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`anime:reccancel:${options.ownerUserId}:${options.sessionId}`)
      .setLabel('Cancel Recommendation')
      .setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2];
}

export function createWebsiteWatchlistEntryEmbed(
  item: WebsiteWatchlistItem,
  options?: {
    title?: string;
    description?: string;
  }
) {
  const embed = createMonochromeEmbed({
    title: options?.title || item.title,
    description:
      options?.description ||
      `Synced with your **AniScroll** website watchlist.`,
    footerText: `AniScroll Website Watchlist · Hoshika ID: ${item.shortId}`,
  });

  if (item.aniscrollUrl && /^https?:\/\//i.test(item.aniscrollUrl)) {
    embed.setURL(item.aniscrollUrl);
  }
  if (item.poster && /^https?:\/\//i.test(item.poster)) {
    embed.setThumbnail(item.poster);
  }

  embed.addFields(
    {
      name: 'Anime',
      value: `[${item.title}](${item.aniscrollUrl})`,
      inline: false,
    },
    {
      name: 'Status',
      value: `${WEBSITE_WATCH_STATUS_LABELS[item.status]} (\`${item.status}\`)`,
      inline: true,
    },
    {
      name: 'Progress',
      value: `${item.episodesWatched}/${item.totalEpisodes ?? '?'} ep`,
      inline: true,
    },
    {
      name: 'Rating',
      value: item.rating !== null ? `${item.rating}/10` : 'Unrated',
      inline: true,
    }
  );

  if (item.notes) {
    embed.addFields({
      name: 'Notes',
      value: item.notes.slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}

export function buildWatchlistAddSelectRows(options: {
  ownerUserId: string;
  sessionId: string;
  candidates: NormalizedAnime[];
}) {
  const validCandidates = options.candidates
    .filter((c) => c.shortId && c.shortId > 0)
    .slice(0, 10);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`watchlist:addselect:${options.ownerUserId}:${options.sessionId}`)
    .setPlaceholder('Select an anime to add to your AniScroll watchlist...')
    .addOptions(
      validCandidates.map((item) => {
        const primary = item.titleEnglish || item.titleRomaji || item.titleNative || 'Untitled';
        const alt =
          item.titleRomaji && item.titleRomaji !== primary
            ? item.titleRomaji
            : item.alternativeTitles[0] || item.titleNative || null;
        const descParts = [
          alt,
          item.releaseYear !== null && item.releaseYear !== undefined ? String(item.releaseYear) : null,
          item.type || null,
          item.totalEpisodes ? `${item.totalEpisodes} ep` : null,
          `ID #${item.shortId}`,
        ].filter(Boolean);

        return {
          label: primary.slice(0, 100),
          description: descParts.join(' · ').slice(0, 100),
          value: String(item.shortId),
        };
      })
    );

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`watchlist:addcancel:${options.ownerUserId}:${options.sessionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2];
}

export interface CreateWelcomeEmbedOptions {
  title: string;
  description: string;
  color?: number;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  footerText?: string | null;
  serverName: string;
  memberCount: number;
  rulesChannelId?: string | null;
  introChannelId?: string | null;
}

export function createWelcomeEmbed(options: CreateWelcomeEmbedOptions) {
  const embed = createMonochromeEmbed({
    title: options.title,
    description: options.description,
    color: options.color ?? BRAND_THEME.embedHex,
    footerText: options.footerText || 'AniScroll · Community Welcome',
  }).setAuthor({
    name: 'AniScroll · Community Welcome',
  });

  if (options.thumbnailUrl && /^https?:\/\//i.test(options.thumbnailUrl)) {
    embed.setThumbnail(options.thumbnailUrl);
  }
  if (options.imageUrl && /^https?:\/\//i.test(options.imageUrl)) {
    embed.setImage(options.imageUrl);
  }

  embed.addFields(
    {
      name: 'Server',
      value: options.serverName.slice(0, 1024),
      inline: true,
    },
    {
      name: 'Member',
      value: `#${options.memberCount}`,
      inline: true,
    }
  );

  if (options.rulesChannelId) {
    embed.addFields({
      name: 'Server Rules',
      value: `<#${options.rulesChannelId}>`,
      inline: true,
    });
  }

  if (options.introChannelId) {
    embed.addFields({
      name: 'Introductions',
      value: `<#${options.introChannelId}>`,
      inline: true,
    });
  }

  return embed;
}



