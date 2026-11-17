import crypto from 'node:crypto';
import {
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  VoiceBasedChannel,
} from 'discord.js';
import { Track } from 'shoukaku';
import { AppError, ERROR_CODES } from '../../../../../packages/shared/src';
import {
  buildMusicControlRows,
  buildMusicSearchSelectRow,
  createErrorEmbed,
  createMonochromeEmbed,
  createNowPlayingEmbed,
} from '../../../../../packages/discord-ui/src';
import {
  checkBotVoiceChannelPermissions,
  checkVoiceControlPermission,
  formatDuration,
  parseSeekPositionMs,
  PreferredMusicSource,
} from '../../services/music/MusicService';
import { BotCommandContext, BotSlashCommand } from '../types';

export interface MusicSearchSession {
  ownerUserId: string;
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  shardId: number;
  requesterTag: string;
  tracks: Track[];
  expiresAt: number;
}

export const musicSearchSessions = new Map<string, MusicSearchSession>();

function pruneExpiredSearchSessions() {
  const now = Date.now();
  for (const [k, v] of musicSearchSessions.entries()) {
    if (v.expiresAt <= now) {
      musicSearchSessions.delete(k);
    }
  }
}

export function getMemberVoiceChannel(interaction: any): VoiceBasedChannel | null {
  const member = interaction.member as GuildMember | null;
  return member?.voice?.channel ?? null;
}

export function assertMusicControlAccess(interaction: any, ctx: BotCommandContext): VoiceBasedChannel {
  if (!interaction.guildId || !interaction.guild) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Music commands can only be used inside a Discord server.', 400);
  }
  const member = interaction.member as GuildMember | null;
  const voiceChannel = member?.voice?.channel ?? null;
  const queue = ctx.musicService.getQueue(interaction.guildId);
  const settings = ctx.db.getGuildSettings(interaction.guildId).musicConfig;

  if (!settings.enabled) {
    throw new AppError(ERROR_CODES.USER_MISSING_PERMISSIONS, 'Music commands are disabled in this server.', 403);
  }

  const hasGuildAdminOrManage = Boolean(
    member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
      member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
  const memberRoleIds = member?.roles?.cache?.map((r) => r.id) || [];

  checkVoiceControlPermission({
    memberVoiceChannelId: voiceChannel?.id,
    botVoiceChannelId: queue.voiceChannelId || interaction.guild.members?.me?.voice?.channelId,
    hasGuildAdminOrManage,
    memberRoleIds,
    djRoleIds: settings.djRoleIds,
  });

  if (!voiceChannel) {
    throw new AppError(
      ERROR_CODES.USER_NOT_IN_VOICE,
      'You must be connected to a voice channel to use music commands.',
      400
    );
  }

  const botMember = interaction.guild.members?.me;
  if (botMember && typeof voiceChannel.permissionsFor === 'function') {
    checkBotVoiceChannelPermissions(voiceChannel.permissionsFor(botMember));
  }

  return voiceChannel;
}

export const musicCommands: BotSlashCommand[] = [
  {
    name: 'play',
    category: 'music',
    cooldownSeconds: 2,
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play or queue a song, YouTube video/playlist, or Spotify track/album/playlist')
      .addStringOption((o) =>
        o
          .setName('query')
          .setDescription('Song title, artist, YouTube link/playlist, or Spotify track/album/playlist URL')
          .setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName('source')
          .setDescription('Preferred search source when not using a direct URL')
          .addChoices(
            { name: 'Auto (YouTube / URL)', value: 'auto' },
            { name: 'YouTube', value: 'youtube' },
            { name: 'Spotify (via LavaSrc)', value: 'spotify' },
            { name: 'SoundCloud', value: 'soundcloud' }
          )
      ),
    async execute(interaction, ctx) {
      if (!interaction.guildId || !interaction.guild) return;
      const voiceChannel = assertMusicControlAccess(interaction, ctx);
      await interaction.deferReply();

      const settings = ctx.db.getGuildSettings(interaction.guildId).musicConfig;
      const query = interaction.options.getString('query', true);
      const source = (interaction.options.getString('source') || 'auto') as PreferredMusicSource;

      const result = await ctx.musicService.playInVoice({
        guildId: interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        shardId: interaction.guild.shardId,
        query,
        source,
        requesterId: interaction.user.id,
        requesterTag: interaction.user.tag,
        defaultVolume: settings.defaultVolume,
        maxQueueSize: settings.maxQueueSize,
        emptyLeaveDelaySeconds: settings.emptyLeaveDelaySeconds,
      });

      const { track, position, queue, isPlaylist, playlistName, addedCount, skippedDueToLimit } = result;

      if (isPlaylist) {
        const descLines = [
          `Imported **${addedCount}** tracks from **${playlistName || 'Playlist'}**.`,
          position === 0 ? `Now playing **${track.title}** — ${track.author}.` : `Queued starting at position **#${position}**.`,
        ];
        if (skippedDueToLimit > 0) {
          descLines.push(`Skipped **${skippedDueToLimit}** tracks due to server queue cap (${settings.maxQueueSize}).`);
        }
        const embed = createMonochromeEmbed({
          title: 'Playlist Imported',
          description: descLines.join('\n'),
        }).addFields(
          { name: 'Queue Length', value: `${queue.tracks.length} queued`, inline: true },
          { name: 'Source', value: track.sourceName.toUpperCase(), inline: true },
          { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true }
        );
        if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);

        const msg = await interaction.editReply({
          embeds: [embed],
          components: buildMusicControlRows(queue.paused, queue.loopMode, Boolean(queue.current)),
        });
        ctx.musicService.setNowPlayingMessage(interaction.guildId, msg as any);
        return;
      }

      if (position === 0) {
        const embed = createNowPlayingEmbed(queue, 0, 'Now Playing');
        const msg = await interaction.editReply({
          embeds: [embed],
          components: buildMusicControlRows(queue.paused, queue.loopMode, true),
        });
        ctx.musicService.setNowPlayingMessage(interaction.guildId, msg as any);
      } else {
        const embed = createMonochromeEmbed({
          title: `Queued (#${position})`,
          description: `${track.uri ? `[${track.title}](${track.uri})` : `**${track.title}**`} — ${track.author}`,
        }).addFields(
          { name: 'Duration', value: formatDuration(track.durationMs, track.isStream), inline: true },
          { name: 'Source', value: track.sourceName.toUpperCase(), inline: true },
          { name: 'Queue Length', value: `${queue.tracks.length} queued`, inline: true },
          { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true }
        );
        if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);
        await interaction.editReply({
          embeds: [embed],
          components: buildMusicControlRows(queue.paused, queue.loopMode, Boolean(queue.current)),
        });
      }
    },
  },
  {
    name: 'search',
    category: 'music',
    cooldownSeconds: 2,
    data: new SlashCommandBuilder()
      .setName('search')
      .setDescription('Search up to 10 tracks and pick one to play or queue')
      .addStringOption((o) => o.setName('query').setDescription('Song title or artist').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('source')
          .setDescription('Music source to search')
          .addChoices(
            { name: 'YouTube', value: 'youtube' },
            { name: 'Spotify (via LavaSrc)', value: 'spotify' },
            { name: 'SoundCloud', value: 'soundcloud' }
          )
      ),
    async execute(interaction, ctx) {
      if (!interaction.guildId || !interaction.guild) return;
      const voiceChannel = assertMusicControlAccess(interaction, ctx);
      await interaction.deferReply();

      const query = interaction.options.getString('query', true);
      const source = (interaction.options.getString('source') || 'youtube') as PreferredMusicSource;
      let tracks: Track[] = [];
      try {
        const lava = await ctx.musicService.searchLavaSearch(query, ['tracks', 'albums', 'playlists', 'artists']);
        tracks = lava.tracks.slice(0, 10);
      } catch {
        // fallback
      }
      if (tracks.length === 0) {
        const resolved = await ctx.musicService.searchTracks(query, { source, limit: 10 });
        tracks = resolved.tracks.slice(0, 10);
      }
      const top10 = tracks;

      if (top10.length === 0) {
        await interaction.editReply({
          embeds: [createErrorEmbed('No matching tracks were found for that query.')],
        });
        return;
      }

      pruneExpiredSearchSessions();
      const sessionId = crypto.randomBytes(6).toString('hex');
      musicSearchSessions.set(sessionId, {
        ownerUserId: interaction.user.id,
        guildId: interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        shardId: interaction.guild.shardId,
        requesterTag: interaction.user.tag,
        tracks: top10,
        expiresAt: Date.now() + 10 * 60_000,
      });

      const lines = top10.map(
        (t, i) =>
          `**${i + 1}.** ${t.info.uri ? `[${t.info.title}](${t.info.uri})` : t.info.title} — ${t.info.author} \`[${formatDuration(t.info.length, t.info.isStream)} · ${t.info.sourceName}]\``
      );

      const embed = createMonochromeEmbed({
        title: `Search Results (${source.toUpperCase()})`,
        description: lines.join('\n'),
        footerText: `Requested by ${interaction.user.tag} · Select a track below within 10 minutes`,
      });
      if (top10[0]?.info.artworkUrl) {
        embed.setThumbnail(top10[0].info.artworkUrl);
      }

      await interaction.editReply({
        embeds: [embed],
        components: buildMusicSearchSelectRow(
          interaction.user.id,
          sessionId,
          top10.map((t) => ({
            title: t.info.title,
            author: t.info.author,
            durationMs: t.info.length,
            sourceName: t.info.sourceName,
          }))
        ),
      });
    },
  },
  {
    name: 'queue',
    category: 'music',
    data: new SlashCommandBuilder()
      .setName('queue')
      .setDescription('Show the current server music queue')
      .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const queue = ctx.musicService.getQueue(interaction.guildId);
      const pageSize = 10;
      const totalPages = Math.max(1, Math.ceil(queue.tracks.length / pageSize));
      const page = Math.min(totalPages, interaction.options.getInteger('page') || 1);
      const start = (page - 1) * pageSize;
      const slice = queue.tracks.slice(start, start + pageSize);

      const upNext = slice.map(
        (t, i) =>
          `**${start + i + 1}.** ${t.title} — ${t.author} \`[${formatDuration(t.durationMs, t.isStream)}]\` (<@${t.requesterId}>)`
      );

      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: `Server Queue · Page ${page}/${totalPages}`,
            description:
              (queue.current
                ? `**Now Playing:** ${queue.current.title} — ${queue.current.author} \`[${formatDuration(queue.current.durationMs, queue.current.isStream)}]\`\n\n`
                : 'Nothing playing.\n\n') + (upNext.join('\n') || 'Queue is empty.'),
            footerText: `${queue.tracks.length} queued · Loop ${queue.loopMode.toUpperCase()} · Volume ${queue.volume}%`,
          }),
        ],
      });
    },
  },
  {
    name: 'nowplaying',
    category: 'music',
    data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show interactive Now Playing controls'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const queue = ctx.musicService.getQueue(interaction.guildId);
      if (!queue.current) {
        await interaction.reply({ ephemeral: true, embeds: [createErrorEmbed('No track is currently playing.')] });
        return;
      }
      const positionMs = ctx.musicService.getLivePositionMs(interaction.guildId);
      const msg = await interaction.reply({
        fetchReply: true,
        embeds: [createNowPlayingEmbed(queue, positionMs)],
        components: buildMusicControlRows(queue.paused, queue.loopMode, true),
      });
      ctx.musicService.setNowPlayingMessage(interaction.guildId, msg as any);
    },
  },
  {
    name: 'pause',
    category: 'music',
    data: new SlashCommandBuilder().setName('pause').setDescription('Pause the active music track'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const queue = await ctx.musicService.pause(interaction.guildId, true);
      await interaction.reply({
        embeds: [createMonochromeEmbed({ title: 'Playback Paused', description: `Paused **${queue.current?.title || 'track'}**. Use \`/resume\` to continue.` })],
      });
    },
  },
  {
    name: 'resume',
    category: 'music',
    data: new SlashCommandBuilder().setName('resume').setDescription('Resume paused music playback'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const queue = await ctx.musicService.pause(interaction.guildId, false);
      await interaction.reply({
        embeds: [createMonochromeEmbed({ title: 'Playback Resumed', description: `Resumed **${queue.current?.title || 'track'}**.` })],
      });
    },
  },
  {
    name: 'skip',
    category: 'music',
    data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const currentTitle = ctx.musicService.getQueue(interaction.guildId).current?.title;
      await ctx.musicService.skip(interaction.guildId);
      await interaction.reply({
        embeds: [createMonochromeEmbed({ title: 'Track Skipped', description: `Skipped **${currentTitle || 'current track'}**.` })],
      });
    },
  },
  {
    name: 'previous',
    category: 'music',
    data: new SlashCommandBuilder().setName('previous').setDescription('Play the previously played track'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const { track, queue } = await ctx.musicService.previous(interaction.guildId);
      await interaction.reply({
        embeds: [createNowPlayingEmbed(queue, 0, 'Playing Previous Track')],
        components: buildMusicControlRows(queue.paused, queue.loopMode, Boolean(track)),
      });
    },
  },
  {
    name: 'stop',
    category: 'music',
    data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      await ctx.musicService.stop(interaction.guildId);
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: 'Playback Stopped', description: 'Stopped audio and cleared the server queue.' })] });
    },
  },
  {
    name: 'clear',
    category: 'music',
    data: new SlashCommandBuilder().setName('clear').setDescription('Clear all upcoming tracks from the queue'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      ctx.musicService.getQueue(interaction.guildId).clear();
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: 'Queue Cleared', description: 'All upcoming tracks removed.' })] });
    },
  },
  {
    name: 'leave',
    category: 'music',
    data: new SlashCommandBuilder().setName('leave').setDescription('Disconnect the bot from the voice channel and clear queue'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      await ctx.musicService.leaveVoice(interaction.guildId);
      await interaction.reply({
        embeds: [createMonochromeEmbed({ title: 'Left Voice Channel', description: 'Disconnected from voice and cleared the queue.' })],
      });
    },
  },
  {
    name: 'volume',
    category: 'music',
    data: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Adjust playback volume')
      .addIntegerOption((o) => o.setName('percent').setDescription('Volume percentage (0-120)').setRequired(true).setMinValue(0).setMaxValue(120)),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const maxVol = ctx.db.getGuildSettings(interaction.guildId).musicConfig.maxVolume;
      const next = await ctx.musicService.setVolume(interaction.guildId, interaction.options.getInteger('percent', true), maxVol);
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: 'Volume Updated', description: `Volume set to **${next}%**.` })] });
    },
  },
  {
    name: 'loop',
    category: 'music',
    data: new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Set or cycle loop mode (off / track / queue)')
      .addStringOption((o) =>
        o
          .setName('mode')
          .setDescription('Loop mode')
          .addChoices(
            { name: 'Off', value: 'off' },
            { name: 'Current Track', value: 'track' },
            { name: 'Entire Queue', value: 'queue' }
          )
      ),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const modeArg = interaction.options.getString('mode') as 'off' | 'track' | 'queue' | null;
      const queue = ctx.musicService.getQueue(interaction.guildId);
      const mode = modeArg ? queue.setLoop(modeArg) : queue.cycleLoop();
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: 'Loop Mode Updated', description: `Loop mode: **${mode.toUpperCase()}**.` })] });
    },
  },
  {
    name: 'shuffle',
    category: 'music',
    data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle queued tracks'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const queue = ctx.musicService.getQueue(interaction.guildId);
      if (queue.tracks.length < 2) {
        await interaction.reply({ ephemeral: true, embeds: [createErrorEmbed('Need at least 2 queued tracks to shuffle.')] });
        return;
      }
      queue.shuffle();
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: 'Queue Shuffled', description: `Shuffled **${queue.tracks.length}** upcoming tracks.` })] });
    },
  },
  {
    name: 'remove',
    category: 'music',
    data: new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove a track from the queue by position')
      .addIntegerOption((o) => o.setName('position').setDescription('1-based queue index').setRequired(true).setMinValue(1)),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const removed = ctx.musicService.getQueue(interaction.guildId).removeAt(interaction.options.getInteger('position', true));
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: 'Track Removed', description: `Removed **${removed.title}** from the queue.` })] });
    },
  },
  {
    name: 'move',
    category: 'music',
    data: new SlashCommandBuilder()
      .setName('move')
      .setDescription('Move a queued track to a new position')
      .addIntegerOption((o) => o.setName('from').setDescription('Current 1-based position').setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName('to').setDescription('Target 1-based position').setRequired(true).setMinValue(1)),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const from = interaction.options.getInteger('from', true);
      const to = interaction.options.getInteger('to', true);
      const moved = ctx.musicService.getQueue(interaction.guildId).move(from, to);
      await interaction.reply({
        embeds: [createMonochromeEmbed({ title: 'Queue Reordered', description: `Moved **${moved.title}** from #${from} to #${to}.` })],
      });
    },
  },
  {
    name: 'seek',
    category: 'music',
    data: new SlashCommandBuilder()
      .setName('seek')
      .setDescription('Seek to a timestamp in the currently playing track')
      .addStringOption((o) => o.setName('position').setDescription('Timestamp e.g. 1:30 or 90').setRequired(true)),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const queue = ctx.musicService.getQueue(interaction.guildId);
      if (!queue.current) {
        await interaction.reply({ ephemeral: true, embeds: [createErrorEmbed('Nothing is currently playing.')] });
        return;
      }
      const posMs = parseSeekPositionMs(interaction.options.getString('position', true), queue.current.durationMs);
      await ctx.musicService.seek(interaction.guildId, posMs);
      await interaction.reply({
        embeds: [createMonochromeEmbed({ title: 'Playback Seeked', description: `Seeked **${queue.current.title}** to **${formatDuration(posMs)}**.` })],
      });
    },
  },
  {
    name: 'lyrics',
    category: 'music',
    data: new SlashCommandBuilder()
      .setName('lyrics')
      .setDescription('Show track metadata for the currently playing song'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const current = ctx.musicService.getQueue(interaction.guildId).current;
      if (!current) {
        await interaction.reply({ ephemeral: true, embeds: [createErrorEmbed('No track is currently playing.')] });
        return;
      }
      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: `Track Metadata · ${current.title}`,
            description: `Artist: **${current.author}** · Duration: **${formatDuration(current.durationMs, current.isStream)}** · Source: **${current.sourceName.toUpperCase()}**\nFull copyrighted lyrics reproduction is disabled by policy.`,
          }),
        ],
      });
    },
  },
  {
    name: '247',
    category: 'music',
    data: new SlashCommandBuilder()
      .setName('247')
      .setDescription('Toggle 24/7 voice channel persistence for this server'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const settings = ctx.db.getGuildSettings(interaction.guildId).musicConfig;
      const next = !settings.stay247;
      ctx.db.updateGuildSettingsSection(interaction.guildId, 'musicConfig', { ...settings, stay247: next }, interaction.user.id);
      ctx.musicService.getQueue(interaction.guildId).stay247 = next;
      await interaction.reply({
        embeds: [createMonochromeEmbed({ title: '24/7 Mode Updated', description: `24/7 mode is now **${next ? 'ENABLED' : 'DISABLED'}**.` })],
      });
    },
  },
  {
    name: 'chapters',
    category: 'music',
    data: new SlashCommandBuilder()
      .setName('chapters')
      .setDescription('Display available YouTube chapters for the currently playing track'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const queue = ctx.musicService.getQueue(interaction.guildId);
      if (!queue.current) {
        await interaction.reply({ ephemeral: true, embeds: [createErrorEmbed('No track is currently playing.')] });
        return;
      }
      if (!queue.chapters || queue.chapters.length === 0) {
        await interaction.reply({ ephemeral: true, embeds: [createMonochromeEmbed({ title: 'No Chapters Available', description: `No chapters were found for **${queue.current.title}**.` })] });
        return;
      }

      const lines = queue.chapters.map(
        (ch, i) => `**${i + 1}.** ${ch.title} — \`${formatDuration(ch.start)}\``
      );

      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: `Chapters · ${queue.current.title}`,
            description: lines.join('\n'),
          }),
        ],
      });
    },
  },
  {
    name: 'sponsorblock',
    category: 'music',
    data: new SlashCommandBuilder()
      .setName('sponsorblock')
      .setDescription('Configure SponsorBlock categories for skipping sponsors and self-promo')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((o) =>
        o
          .setName('mode')
          .setDescription('SponsorBlock mode')
          .setRequired(true)
          .addChoices(
            { name: 'Default (Sponsor & Self-Promo)', value: 'default' },
            { name: 'All Categories', value: 'all' },
            { name: 'Disable SponsorBlock', value: 'off' }
          )
      ),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      assertMusicControlAccess(interaction, ctx);
      const mode = interaction.options.getString('mode', true);
      let categories: string[] = [];
      if (mode === 'default') {
        categories = ['sponsor', 'selfpromo'];
      } else if (mode === 'all') {
        categories = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'music_offtopic'];
      } else if (mode === 'off') {
        categories = [];
      }

      await ctx.musicService.setSponsorBlockCategories(interaction.guildId, categories);

      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: 'SponsorBlock Configured',
            description: `SponsorBlock mode set to **${mode.toUpperCase()}** (${categories.length > 0 ? categories.join(', ') : 'disabled'}).`,
          }),
        ],
      });
    },
  },
];
