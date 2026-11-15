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
    name: 'character',
    category: 'anime',
    cooldownSeconds: 4,
    data: new SlashCommandBuilder()
      .setName('character')
      .setDescription('Search anime character metadata via Hoshika')
      .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true)),
    async execute(interaction, ctx) {
      await interaction.deferReply();
      const name = interaction.options.getString('name', true);
      const { character } = await ctx.animeService.searchCharacters(name);
      const embed = createMonochromeEmbed({
        title: character.name,
        description: character.description ? character.description.slice(0, 750) : 'No biography provided.',
      });
      if (character.image) embed.setThumbnail(character.image);
      if (character.nativeName) embed.addFields({ name: 'Native Name', value: character.nativeName, inline: true });
      if (character.appearances.length > 0) {
        embed.addFields({
          name: 'Appearances',
          value: character.appearances.slice(0, 6).map((a) => `${a.title}${a.role ? ` (${a.role})` : ''}`).join('\n'),
        });
      }
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    name: 'aniquiz',
    category: 'anime',
    cooldownSeconds: 8,
    data: new SlashCommandBuilder()
      .setName('aniquiz')
      .setDescription('Start an anime trivia challenge from Hoshika metadata')
      .addStringOption((o) =>
        o
          .setName('difficulty')
          .setDescription('Trivia difficulty')
          .addChoices(
            { name: 'Standard', value: 'standard' },
            { name: 'Hard', value: 'hard' }
          )
      ),
    async execute(interaction, ctx) {
      await interaction.deferReply();
      const { items } = await ctx.animeService.getTrending('trending', 'en');
      const pool = items.filter((a) => a.synopsis && (a.titleEnglish || a.titleRomaji));
      if (pool.length === 0) {
        await interaction.editReply({ embeds: [createErrorEmbed('Quiz pool is temporarily empty.')] });
        return;
      }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const answer = pick.titleEnglish || pick.titleRomaji || 'Unknown';
      const maskedSynopsis = (pick.synopsis || '').replace(new RegExp(answer.split(' ')[0], 'gi'), '[REDACTED]');
      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: 'Anime Trivia Challenge',
            description: `Guess the anime from its synopsis:\n\n${maskedSynopsis.slice(0, 420)}...`,
          }).addFields(
            { name: 'Genres', value: pick.genres.slice(0, 4).join(' · ') || 'Unknown', inline: true },
            { name: 'Release Year', value: String(pick.releaseYear ?? 'Unknown'), inline: true },
            { name: 'Answer Reveal', value: `||${answer}||`, inline: false }
          ),
        ],
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
