import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonInteraction,
  GatewayIntentBits,
  IntentsBitField,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  AppError,
  CharacterGuessCandidate,
  createModuleLogger,
  ERROR_CODES,
} from '../../../../../packages/shared/src';
import {
  ANI_GUESS_ROUND_SECONDS,
  ANI_GUESS_TOTAL_ROUNDS,
  buildAniGuessPlayAgainRow,
  buildAniGuessRoundRow,
  createAniGuessCorrectEmbed,
  createAniGuessResultsEmbed,
  createAniGuessRoundEmbed,
  createAniGuessTimeoutEmbed,
} from '../../../../../packages/discord-ui/src';
import { AnimeService } from '../hoshika/AnimeService';

const log = createModuleLogger('AniGuessService');

export interface AniGuessTextChannel {
  id: string;
  send: (payload: any) => Promise<any>;
}

export interface AniGuessIncomingMessage {
  author: { id: string; bot?: boolean; username?: string };
  guildId: string | null;
  channelId: string;
  content: string;
  attachments?: { size: number };
  mentions?: { users?: { size: number } };
  client?: { user?: { id?: string } | null } | null;
}

export interface AniGuessRoundState {
  roundNumber: number;
  candidate: CharacterGuessCandidate;
  characterId: string;
  correctCharacterName: string;
  acceptedNames: string[];
  animeShortId: number;
  animeTitle: string;
  characterImageUrl: string;
  startedAt: number;
  expiresAt: number;
  resolved: boolean;
  timer: NodeJS.Timeout | null;
  roundToken: string;
}

export interface AniGuessGameSession {
  gameId: string;
  gameKey: string;
  guildId: string;
  channelId: string;
  userId: string;
  username: string;
  channel: AniGuessTextChannel;
  botUserId: string | null;
  hasMessageContentIntent: boolean;
  warnedMissingMessageContent: boolean;
  rounds: CharacterGuessCandidate[];
  totalRounds: number;
  roundIndex: number;
  score: number;
  status: 'active' | 'completed' | 'cancelled';
  transitioning: boolean;
  currentRound: AniGuessRoundState | null;
  createdAt: number;
}

export interface AniGuessStartOptions {
  guildId: string | null;
  channelId: string;
  userId: string;
  username: string;
  channel: AniGuessTextChannel;
  botUserId?: string | null;
  client?: { options?: { intents?: any } } | null;
  locale?: string;
  sendInitialRound: (payload: { embeds: any[]; components: any[] }) => Promise<any>;
}

/**
 * Normalizes a character guess or official character name for strict, punctuation-tolerant matching:
 * - Unicode NFKD normalization + stripping combining diacritics
 * - Lowercasing
 * - Stripping apostrophes/smart quotes
 * - Replacing '&' with 'and'
 * - Replacing punctuation with spaces and collapsing whitespace
 */
export function normalizeAniGuessText(input: string | null | undefined): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasLatinLetters(value: string): boolean {
  return /[a-zA-Z]/.test(value);
}

/**
 * Extracts the official character name and official alternative character names returned by Hoshika.
 * Supports "Last, First" -> "First Last" ordering when Hoshika lists comma-separated names,
 * without inventing partial nicknames or enabling permissive fuzzy matching.
 */
export function extractAcceptedCharacterNames(candidate: {
  characterName: string;
  alternativeNames?: string[];
}): string[] {
  const names = new Set<string>();
  const addWithCommaFlip = (raw: string | null | undefined) => {
    const trimmed = raw?.trim();
    if (!trimmed || !hasLatinLetters(trimmed)) return;
    names.add(trimmed);
    if (trimmed.includes(',')) {
      const parts = trimmed
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 2) {
        names.add(`${parts[1]} ${parts[0]}`);
      }
    }
  };

  addWithCommaFlip(candidate.characterName);
  for (const alt of candidate.alternativeNames || []) {
    addWithCommaFlip(alt);
  }

  return Array.from(names);
}

export function isAniGuessAnswerCorrect(guess: string, acceptedNames: string[]): boolean {
  const normGuess = normalizeAniGuessText(guess);
  if (!normGuess) return false;

  for (const name of acceptedNames) {
    const normName = normalizeAniGuessText(name);
    if (!normName) continue;
    if (normGuess === normName) {
      return true;
    }
  }
  return false;
}

export function extractGuessContentFromMessage(
  rawContent: string,
  botUserId?: string | null
): string {
  let text = (rawContent || '').trim();
  if (botUserId) {
    const mentionRegex = new RegExp(`^<@!?${botUserId}>\\s*`, 'i');
    text = text.replace(mentionRegex, '').trim();
  }
  return text;
}

export class AniGuessService {
  private readonly animeService: AnimeService;
  private readonly roundDurationMs: number;
  private readonly totalRounds: number;
  private readonly activeGames = new Map<string, AniGuessGameSession>();
  private readonly recentPlayedCharacterIds = new Map<string, string[]>();

  constructor(options: {
    animeService: AnimeService;
    roundDurationMs?: number;
    totalRounds?: number;
  }) {
    this.animeService = options.animeService;
    this.roundDurationMs = Math.max(20, options.roundDurationMs ?? ANI_GUESS_ROUND_SECONDS * 1000);
    this.totalRounds = Math.max(1, options.totalRounds ?? ANI_GUESS_TOTAL_ROUNDS);
  }

  public getGameKey(guildId: string | null | undefined, userId: string): string {
    return `${guildId || 'dm'}:${userId}`;
  }

  public getActiveGame(guildId: string | null | undefined, userId: string): AniGuessGameSession | null {
    const game = this.activeGames.get(this.getGameKey(guildId, userId));
    if (!game || game.status !== 'active') return null;
    return game;
  }

  public getActiveGameCount(): number {
    return this.activeGames.size;
  }

  public disposeAll() {
    for (const game of this.activeGames.values()) {
      game.status = 'cancelled';
      if (game.currentRound?.timer) {
        clearTimeout(game.currentRound.timer);
        game.currentRound.timer = null;
      }
    }
    this.activeGames.clear();
  }

  public async startGame(options: AniGuessStartOptions): Promise<AniGuessGameSession> {
    const gameKey = this.getGameKey(options.guildId, options.userId);
    const existing = this.activeGames.get(gameKey);
    if (existing && existing.status === 'active') {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `You already have an active \`/aniguess\` game in <#${existing.channelId}>. Finish that game first before starting a new one.`,
        409
      );
    }

    const recentIds = this.recentPlayedCharacterIds.get(gameKey) || [];
    const pool = await this.animeService.getRandomCharacterGuessPool({
      count: this.totalRounds,
      excludeCharacterIds: recentIds,
      locale: options.locale || 'en',
    });

    if (pool.length < this.totalRounds) {
      throw new AppError(
        ERROR_CODES.HOSHIKA_UNAVAILABLE,
        `Could not gather ${this.totalRounds} unique anime characters with character portraits from Hoshika right now. Please try again in a moment.`,
        503
      );
    }

    const selected = pool.slice(0, this.totalRounds);
    const playedNow = selected.map((c) => c.characterId).filter(Boolean);
    this.recentPlayedCharacterIds.set(gameKey, [...recentIds, ...playedNow].slice(-40));

    // Double-check nobody raced into activeGames while fetching from Hoshika
    const raceExisting = this.activeGames.get(gameKey);
    if (raceExisting && raceExisting.status === 'active') {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `You already have an active \`/aniguess\` game in <#${raceExisting.channelId}>. Finish that game first before starting a new one.`,
        409
      );
    }

    let hasMessageContentIntent = true;
    if (options.guildId && options.client?.options?.intents !== undefined) {
      try {
        hasMessageContentIntent = new IntentsBitField(options.client.options.intents).has(
          GatewayIntentBits.MessageContent
        );
      } catch {
        hasMessageContentIntent = true;
      }
    }

    const session: AniGuessGameSession = {
      gameId: crypto.randomUUID(),
      gameKey,
      guildId: options.guildId || 'dm',
      channelId: options.channelId,
      userId: options.userId,
      username: options.username,
      channel: options.channel,
      botUserId: options.botUserId ?? null,
      hasMessageContentIntent,
      warnedMissingMessageContent: false,
      rounds: selected,
      totalRounds: this.totalRounds,
      roundIndex: 0,
      score: 0,
      status: 'active',
      transitioning: false,
      currentRound: null,
      createdAt: Date.now(),
    };

    this.activeGames.set(gameKey, session);

    try {
      await this.launchRound(session, 0, options.sendInitialRound);
      return session;
    } catch (err) {
      this.cleanupGame(session);
      throw err;
    }
  }

  private async launchRound(
    session: AniGuessGameSession,
    roundIndex: number,
    customSender?: (payload: { embeds: any[]; components: any[] }) => Promise<any>
  ) {
    if (session.status !== 'active') return;

    const candidate = session.rounds[roundIndex];
    const characterId = candidate?.characterId?.trim();
    const characterName = candidate?.characterName?.trim();
    const characterImageUrl = candidate?.characterImageUrl?.trim();
    const animeTitle = candidate?.animeTitle?.trim();

    if (!candidate || !characterId || !characterName || !characterImageUrl || !animeTitle) {
      throw new AppError(
        ERROR_CODES.HOSHIKA_UNAVAILABLE,
        'Selected character is missing required portrait image or name metadata.',
        502
      );
    }

    const acceptedNames = extractAcceptedCharacterNames(candidate);
    if (acceptedNames.length === 0) {
      throw new AppError(
        ERROR_CODES.HOSHIKA_UNAVAILABLE,
        'Selected character has no guessable name.',
        502
      );
    }

    const roundNumber = roundIndex + 1;
    const roundToken = crypto.randomUUID();
    const now = Date.now();

    const roundState: AniGuessRoundState = {
      roundNumber,
      candidate,
      characterId,
      correctCharacterName: characterName,
      acceptedNames,
      animeShortId: candidate.animeShortId,
      animeTitle,
      characterImageUrl,
      startedAt: now,
      expiresAt: now + this.roundDurationMs,
      resolved: false,
      timer: null,
      roundToken,
    };

    session.roundIndex = roundIndex;
    session.currentRound = roundState;
    session.transitioning = false;

    const roundEmbed = createAniGuessRoundEmbed({
      roundNumber,
      totalRounds: session.totalRounds,
      score: session.score,
      characterImageUrl: roundState.characterImageUrl,
      roundSeconds: Math.max(1, Math.round(this.roundDurationMs / 1000)),
      hasMessageContentIntent: session.hasMessageContentIntent,
    });
    const roundRow = buildAniGuessRoundRow({
      userId: session.userId,
      gameId: session.gameId,
    });

    if (customSender) {
      await customSender({ embeds: [roundEmbed], components: [roundRow] });
    } else {
      await session.channel.send({ embeds: [roundEmbed], components: [roundRow] });
    }

    // Re-check status in case game was resolved/cancelled while sending
    if (session.status !== 'active' || session.currentRound?.roundToken !== roundToken || roundState.resolved) {
      return;
    }

    roundState.timer = setTimeout(() => {
      void this.handleRoundTimeout(session, roundToken);
    }, this.roundDurationMs);
    if (typeof roundState.timer.unref === 'function') {
      roundState.timer.unref();
    }
  }

  private async handleRoundTimeout(session: AniGuessGameSession, roundToken: string) {
    const round = session.currentRound;
    if (
      session.status !== 'active' ||
      !round ||
      round.roundToken !== roundToken ||
      round.resolved ||
      session.transitioning
    ) {
      return;
    }

    round.resolved = true;
    round.timer = null;
    session.transitioning = true;

    const nextRoundUpcoming = session.roundIndex + 1 < session.totalRounds;
    try {
      await session.channel.send({
        embeds: [
          createAniGuessTimeoutEmbed({
            roundNumber: round.roundNumber,
            totalRounds: session.totalRounds,
            score: session.score,
            revealedCharacterName: round.correctCharacterName,
            revealedAnimeTitle: round.animeTitle,
            nextRoundUpcoming,
          }),
        ],
      });
      await this.advanceOrFinish(session);
    } catch (err) {
      log.warn(
        { gameId: session.gameId, channelId: session.channelId, err: err instanceof Error ? err.message : String(err) },
        'Stopping AniGuess game after channel send failure on timeout'
      );
      this.cleanupGame(session);
    }
  }

  public async handleMessage(message: AniGuessIncomingMessage): Promise<boolean> {
    if (!message || message.author?.bot) return false;

    const game = this.getActiveGame(message.guildId, message.author.id);
    if (!game) return false;
    if (message.channelId !== game.channelId) return false;

    const botId = message.client?.user?.id || game.botUserId;
    const guessText = extractGuessContentFromMessage(message.content, botId);

    // If MessageContent intent is disabled in Developer Portal, guild messages arrive with empty string "".
    // Warn the player once instead of silently ignoring their message.
    if (!guessText) {
      if (
        !game.hasMessageContentIntent &&
        !game.warnedMissingMessageContent &&
        (!message.attachments || message.attachments.size === 0)
      ) {
        game.warnedMissingMessageContent = true;
        await game.channel
          .send({
            content: `⚠️ <@${game.userId}> I received your message with empty text because Discord's **Message Content Intent** is not enabled in the Developer Portal yet.\nPlease click the **Submit Answer** button on the round embed or mention me like \`<@${botId || game.botUserId || 'bot'}> <character name>\`!`,
          })
          .catch(() => undefined);
      }
      return false;
    }

    await this.submitGuess({
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      rawGuess: guessText,
    });

    return true;
  }

  public async submitGuess(params: {
    guildId: string | null | undefined;
    channelId: string;
    userId: string;
    rawGuess: string;
  }): Promise<{
    accepted: boolean;
    correct: boolean;
    score: number;
    roundNumber: number;
    completed: boolean;
  }> {
    const game = this.getActiveGame(params.guildId, params.userId);
    if (!game || game.channelId !== params.channelId) {
      return { accepted: false, correct: false, score: 0, roundNumber: 0, completed: false };
    }

    const round = game.currentRound;
    if (!round || round.resolved || game.transitioning || Date.now() > round.expiresAt) {
      return {
        accepted: false,
        correct: false,
        score: game.score,
        roundNumber: round?.roundNumber ?? game.roundIndex + 1,
        completed: game.status === 'completed',
      };
    }

    const guessText = params.rawGuess.trim();
    if (!guessText) {
      return {
        accepted: false,
        correct: false,
        score: game.score,
        roundNumber: round.roundNumber,
        completed: false,
      };
    }

    const correct = isAniGuessAnswerCorrect(guessText, round.acceptedNames);
    if (!correct) {
      // 0 points, do NOT reveal character name or anime title, allow user to continue guessing this round
      await game.channel
        .send({
          content: `❌ Not quite, <@${game.userId}>! Keep guessing — Round ${round.roundNumber}/${game.totalRounds} is still active.`,
        })
        .catch(() => undefined);

      return {
        accepted: true,
        correct: false,
        score: game.score,
        roundNumber: round.roundNumber,
        completed: false,
      };
    }

    // Lock synchronously before awaiting any network calls to prevent duplicate scoring
    round.resolved = true;
    game.transitioning = true;
    if (round.timer) {
      clearTimeout(round.timer);
      round.timer = null;
    }

    game.score += 1;
    const isFinalRound = game.roundIndex + 1 >= game.totalRounds;

    try {
      await game.channel.send({
        embeds: [
          createAniGuessCorrectEmbed({
            roundNumber: round.roundNumber,
            totalRounds: game.totalRounds,
            score: game.score,
            revealedCharacterName: round.correctCharacterName,
            revealedAnimeTitle: round.animeTitle,
            nextRoundUpcoming: !isFinalRound,
          }),
        ],
      });

      await this.advanceOrFinish(game);
    } catch (err) {
      log.warn(
        { gameId: game.gameId, channelId: game.channelId, err: err instanceof Error ? err.message : String(err) },
        'Stopping AniGuess game after channel send failure on correct answer'
      );
      this.cleanupGame(game);
    }

    return {
      accepted: true,
      correct: true,
      score: game.score,
      roundNumber: round.roundNumber,
      completed: isFinalRound,
    };
  }

  private async advanceOrFinish(session: AniGuessGameSession) {
    if (session.status !== 'active') return;

    const nextIndex = session.roundIndex + 1;
    if (nextIndex < session.totalRounds) {
      await this.launchRound(session, nextIndex);
      return;
    }

    session.status = 'completed';
    session.transitioning = false;
    if (session.currentRound?.timer) {
      clearTimeout(session.currentRound.timer);
      session.currentRound.timer = null;
    }
    this.activeGames.delete(session.gameKey);

    await session.channel.send({
      embeds: [
        createAniGuessResultsEmbed({
          userId: session.userId,
          username: session.username,
          score: session.score,
          totalRounds: session.totalRounds,
        }),
      ],
      components: [buildAniGuessPlayAgainRow(session.userId)],
    });
  }

  private cleanupGame(session: AniGuessGameSession) {
    session.status = 'cancelled';
    session.transitioning = false;
    if (session.currentRound?.timer) {
      clearTimeout(session.currentRound.timer);
      session.currentRound.timer = null;
    }
    const stored = this.activeGames.get(session.gameKey);
    if (stored?.gameId === session.gameId) {
      this.activeGames.delete(session.gameKey);
    }
  }

  public async handlePlayAgainButton(interaction: ButtonInteraction, ownerUserId: string) {
    if (interaction.user.id !== ownerUserId) {
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        'Only the player who finished this game can click Play Again. Run `/aniguess` to start your own game!',
        403
      );
    }

    const channel = interaction.channel as AniGuessTextChannel | null;
    if (!channel || typeof channel.send !== 'function') {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Unable to access this Discord channel to start a new game.',
        400
      );
    }

    const existing = this.getActiveGame(interaction.guildId, interaction.user.id);
    if (existing) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `You already have an active \`/aniguess\` game in <#${existing.channelId}>. Finish that game first before starting a new one.`,
        409
      );
    }

    await interaction.deferReply();
    await this.startGame({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      username: interaction.user.username,
      channel,
      botUserId: interaction.client?.user?.id ?? null,
      client: interaction.client,
      sendInitialRound: async (payload) => interaction.editReply(payload),
    });
  }

  public async handleOpenAnswerModalButton(
    interaction: ButtonInteraction,
    ownerUserId: string,
    gameId: string
  ) {
    if (interaction.user.id !== ownerUserId) {
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        'Only the player running this `/aniguess` session can submit answers for it.',
        403
      );
    }

    const game = this.getActiveGame(interaction.guildId, ownerUserId);
    if (!game || game.gameId !== gameId || !game.currentRound || game.currentRound.resolved) {
      throw new AppError(
        ERROR_CODES.INTERACTION_EXPIRED,
        'This round has already ended. Run `/aniguess` if you want to start a new game.',
        410
      );
    }

    const modal = new ModalBuilder()
      .setCustomId(`aniguess:submit:${ownerUserId}:${gameId}`)
      .setTitle(`Round ${game.currentRound.roundNumber}/${game.totalRounds} · Guess the Character`);

    const input = new TextInputBuilder()
      .setCustomId('guess_character')
      .setLabel('Character Name')
      .setPlaceholder('Enter the name of this anime character...')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(150);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
  }

  public async handleAnswerModalSubmit(
    interaction: ModalSubmitInteraction,
    ownerUserId: string,
    gameId: string
  ) {
    if (interaction.user.id !== ownerUserId) {
      throw new AppError(
        ERROR_CODES.USER_MISSING_PERMISSIONS,
        'Only the player running this `/aniguess` session can submit answers for it.',
        403
      );
    }

    const game = this.getActiveGame(interaction.guildId, ownerUserId);
    if (!game || game.gameId !== gameId || !game.currentRound || game.currentRound.resolved) {
      throw new AppError(
        ERROR_CODES.INTERACTION_EXPIRED,
        'That `/aniguess` round has already ended or expired.',
        410
      );
    }

    let rawGuess = '';
    try {
      rawGuess = interaction.fields.getTextInputValue('guess_character') || '';
    } catch {
      rawGuess = interaction.fields.getTextInputValue('guess_title') || '';
    }
    await interaction.deferReply({ ephemeral: true });

    const res = await this.submitGuess({
      guildId: interaction.guildId,
      channelId: interaction.channelId || game.channelId,
      userId: interaction.user.id,
      rawGuess,
    });

    if (!res.accepted) {
      await interaction.editReply({
        content: 'That round ended right before your guess arrived.',
      });
      return;
    }

    await interaction.editReply({
      content: res.correct
        ? `✅ Correct! Score: **${res.score}/${game.totalRounds}**`
        : `❌ Incorrect guess. Try again before the round timer ends!`,
    });
  }
}

let sharedAniGuessService: AniGuessService | null = null;
export function getAniGuessService(animeService?: AnimeService): AniGuessService {
  if (!sharedAniGuessService) {
    if (!animeService) {
      throw new Error('AniGuessService must be initialized with AnimeService on first call');
    }
    sharedAniGuessService = new AniGuessService({ animeService });
  }
  return sharedAniGuessService;
}
