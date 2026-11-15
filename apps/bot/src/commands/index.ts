import { BotSlashCommand } from './types';
import { botAdminCommand } from './admin/bot';
import { configCommand } from './admin/config';
import { welcomeCommand } from './admin/welcome';
import { animeCommand } from './anime/anime';
import { aniguessCommand } from './anime/aniguess';
import { animeEntertainmentCommands } from './anime/entertainment';
import { watchlistCommand } from './watchlist/watchlist';
import { musicCommands } from './music/music';
import { moderationCommands } from './moderation/moderation';
import { communityCommands } from './community/community';

export function buildCommandRegistry(): Map<string, BotSlashCommand> {
  const all: BotSlashCommand[] = [
    botAdminCommand,
    configCommand,
    welcomeCommand,
    animeCommand,
    aniguessCommand,
    ...animeEntertainmentCommands,
    watchlistCommand,
    ...musicCommands,
    ...moderationCommands,
    ...communityCommands,
  ];
  const map = new Map<string, BotSlashCommand>();
  for (const cmd of all) {
    map.set(cmd.name, cmd);
  }
  return map;
}

export * from './types';
