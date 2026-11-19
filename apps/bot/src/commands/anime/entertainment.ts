import { SlashCommandBuilder } from 'discord.js';
import { createErrorEmbed, createMonochromeEmbed, createAnimeEmbed } from '../../../../../packages/discord-ui/src';
import { BotSlashCommand } from '../types';

export const animeEntertainmentCommands: BotSlashCommand[] = [
  {
    name: 'aniroulette',
    category: 'anime',
    cooldownSeconds: 5,
    data: new SlashCommandBuilder()
      .setName('aniroulette')
      .setDescription('Spin the anime roulette with optional genre/year/type filters')
      .addStringOption((o) => o.setName('genre').setDescription('Genre filter'))
      .addIntegerOption((o) => o.setName('year').setDescription('Release year'))
      .addStringOption((o) => o.setName('format').setDescription('Format (TV, MOVIE, OVA)')),
    async execute(interaction, ctx) {
      await interaction.deferReply();
      const anime = await ctx.animeService.getRandom({
        genre: interaction.options.getString('genre') || undefined,
        year: interaction.options.getInteger('year') || undefined,
        format: interaction.options.getString('format') || undefined,
      });
      await interaction.editReply({
        embeds: [createAnimeEmbed(anime).setTitle(`Roulette Pick · ${anime.titleEnglish || anime.titleRomaji}`)],
      });
    },
  },
  {
    name: 'profile',
    category: 'community',
    cooldownSeconds: 4,
    data: new SlashCommandBuilder()
      .setName('profile')
      .setDescription('View your or another member’s AniScroll community profile')
      .addUserOption((o) => o.setName('user').setDescription('Target member')),
    async execute(interaction, ctx) {
      const target = interaction.options.getUser('user') || interaction.user;
      const profile = ctx.db.getUserProfile(target.id) || ctx.db.addXp(target.id, target.username, 0);

      let entriesValue = 'Private (Website Synced)';
      let episodesValue = 'Private';
      if (target.id === interaction.user.id) {
        try {
          const stats = await ctx.websiteWatchlist.getStats(interaction.user.id);
          entriesValue = String(stats.totalEntries);
          episodesValue = String(stats.totalEpisodesWatched);
        } catch (err: any) {
          entriesValue = err?.code === 'DISCORD_NOT_LINKED' ? 'Not Connected' : 'Sync Unavailable';
          episodesValue = '—';
        }
      }

      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: `Community Profile · ${target.username}`,
            description: `Level **${profile.level}** · **${profile.experiencePoints}** XP`,
          })
            .setThumbnail(target.displayAvatarURL())
            .addFields(
              { name: 'Watchlist Entries', value: entriesValue, inline: true },
              { name: 'Episodes Watched', value: episodesValue, inline: true },
              { name: 'Quiz Score', value: String(profile.quizStatistics.score), inline: true }
            ),
        ],
      });
    },
  },
  {
    name: 'leaderboard',
    category: 'community',
    cooldownSeconds: 5,
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Show community XP & level leaderboard'),
    async execute(interaction, ctx) {
      const top = ctx.db.listLeaderboard(10);
      const lines = top.map(
        (u, i) => `**${i + 1}.** ${u.username} · Level ${u.level} (${u.experiencePoints} XP)`
      );
      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: 'Community Leaderboard',
            description: lines.join('\n') || 'No leaderboard entries yet.',
          }),
        ],
      });
    },
  },
];
