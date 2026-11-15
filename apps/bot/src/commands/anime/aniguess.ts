import { GuildMember, PermissionFlagsBits, SlashCommandBuilder, TextBasedChannel } from 'discord.js';
import { AppError, ERROR_CODES } from '../../../../../packages/shared/src';
import { BotSlashCommand } from '../types';
import { AniGuessTextChannel, getAniGuessService } from '../../services/anime/AniGuessService';

export const aniguessCommand: BotSlashCommand = {
  name: 'aniguess',
  category: 'anime',
  cooldownSeconds: 3,
  data: new SlashCommandBuilder()
    .setName('aniguess')
    .setDescription('Play a 10-round anime character guessing game powered by Hoshika'),
  async execute(interaction, ctx) {
    const channel = interaction.channel as (TextBasedChannel & AniGuessTextChannel) | null;
    if (!channel || typeof channel.send !== 'function') {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Could not access this channel to host `/aniguess`.',
        400
      );
    }

    const aniGuess = ctx.aniGuessService || getAniGuessService(ctx.animeService);

    // Reject duplicate active games quickly before deferring
    const existing = aniGuess.getActiveGame(interaction.guildId, interaction.user.id);
    if (existing) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `You already have an active \`/aniguess\` game in <#${existing.channelId}>. Finish that game first before starting a new one.`,
        409
      );
    }

    // Acknowledge within Discord's 3-second deadline before any REST fetches
    await interaction.deferReply();

    if (interaction.guild && 'permissionsFor' in channel) {
      const me =
        interaction.guild.members.me ||
        (interaction.client.user
          ? ((await interaction.guild.members
              .fetch(interaction.client.user.id)
              .catch(() => null)) as GuildMember | null)
          : null);
      if (me) {
        const perms = channel.permissionsFor(me);
        if (
          !perms?.has(PermissionFlagsBits.ViewChannel) ||
          !perms?.has(PermissionFlagsBits.SendMessages) ||
          !perms?.has(PermissionFlagsBits.EmbedLinks)
        ) {
          throw new AppError(
            ERROR_CODES.BOT_MISSING_PERMISSIONS,
            'AniScroll Bot needs **View Channel**, **Send Messages**, and **Embed Links** permissions in this channel to run `/aniguess`.',
            403
          );
        }
      }
    }

    await aniGuess.startGame({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      username: interaction.user.username,
      channel,
      botUserId: interaction.client?.user?.id ?? null,
      client: interaction.client,
      locale: 'en',
      sendInitialRound: async (payload) => interaction.editReply(payload),
    });
  },
};
