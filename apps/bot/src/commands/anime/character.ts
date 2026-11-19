import crypto from 'node:crypto';
import { SlashCommandBuilder } from 'discord.js';
import { AppError, ERROR_CODES, NormalizedCharacter } from '../../../../../packages/shared/src';
import {
  buildCharacterActionRows,
  createCharacterEmbed,
  createErrorEmbed,
} from '../../../../../packages/discord-ui/src';
import { BotSlashCommand } from '../types';
import { getAnimeServices } from '../../services/hoshika';

export const CHARACTER_SESSION_TTL_MS = 5 * 60_000;

export interface CharacterSearchSession {
  sessionId: string;
  ownerId: string;
  query: string;
  locale: string;
  results: NormalizedCharacter[];
  currentPage: number;
  expiresAt: number;
}

export const characterSearchSessions = new Map<string, CharacterSearchSession>();

export function cleanupExpiredCharacterSessions(now: number = Date.now()): void {
  for (const [key, session] of characterSearchSessions.entries()) {
    if (now > session.expiresAt) {
      characterSearchSessions.delete(key);
    }
  }
}

export const characterCommand: BotSlashCommand = {
  name: 'character',
  category: 'anime',
  cooldownSeconds: 4,
  data: new SlashCommandBuilder()
    .setName('character')
    .setDescription('Search anime characters via Hoshika')
    .addSubcommand((s) =>
      s
        .setName('search')
        .setDescription('Search for an anime character by name')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Character name (e.g., Satoru Gojo, Naruto Uzumaki)')
            .setRequired(true)
            .setMaxLength(100)
        )
    ),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'search') return;

    const rawName = interaction.options.getString('name', true);
    const query = rawName.trim();
    if (!query) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Please provide a non-empty character name to search.',
        400
      );
    }

    cleanupExpiredCharacterSessions();
    await interaction.deferReply();

    const locale =
      interaction.guildId && ctx.db.getGuildByDiscordId(interaction.guildId)
        ? ctx.db.getGuildSettings(interaction.guildId).animeConfig.locale
        : 'en';

    const charService = ctx.characterService ?? getAnimeServices().characterService;
    const { results, topDetailsError } = await charService.searchCharacters(query, locale);

    if (results.length === 0) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(
            `No character found matching "${query}". Check the spelling or try another name.`,
            'Character Not Found'
          ),
        ],
      });
      return;
    }

    const sessionId = crypto.randomUUID().slice(0, 8);
    const sessionKey = `${interaction.user.id}:${sessionId}`;
    characterSearchSessions.set(sessionKey, {
      sessionId,
      ownerId: interaction.user.id,
      query,
      locale,
      results,
      currentPage: 0,
      expiresAt: Date.now() + CHARACTER_SESSION_TTL_MS,
    });

    const first = results[0];
    await interaction.editReply({
      embeds: [
        createCharacterEmbed(first, {
          page: 0,
          totalPages: results.length,
          detailsError: topDetailsError,
        }),
      ],
      components: buildCharacterActionRows({
        ownerUserId: interaction.user.id,
        sessionId,
        character: first,
        page: 0,
        totalPages: results.length,
        results,
      }),
    });
  },
};
