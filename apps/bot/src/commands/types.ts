import { ChatInputCommandInteraction, PermissionResolvable } from 'discord.js';
import { AniScrollDatabase } from '../../../../packages/database/src';
import { CacheService } from '../services/cache/CacheService';
import { AnimeService } from '../services/hoshika/AnimeService';
import { MusicService } from '../services/music/MusicService';
import { WebsiteWatchlistService } from '../services/watchlist/WebsiteWatchlistService';
import { AniGuessService } from '../services/anime/AniGuessService';
import { CharacterService } from '../services/anime/CharacterService';
import { DailyAnimeService } from '../services/anime/DailyAnimeService';

export interface BotCommandContext {
  db: AniScrollDatabase;
  cache: CacheService;
  animeService: AnimeService;
  characterService?: CharacterService;
  dailyAnimeService?: DailyAnimeService;
  aniGuessService?: AniGuessService;
  musicService: MusicService;
  websiteWatchlist: WebsiteWatchlistService;
  maintenanceMode: boolean;
  setMaintenanceMode: (enabled: boolean) => void;
  reloadCommands: () => Promise<number>;
}

export interface BotSlashCommand {
  name: string;
  category: 'admin' | 'anime' | 'watchlist' | 'music' | 'moderation' | 'community' | 'utility';
  cooldownSeconds?: number;
  ownerOnly?: boolean;
  requiredPermissions?: PermissionResolvable[];
  data: { toJSON(): any; name: string; description: string };
  execute: (interaction: ChatInputCommandInteraction, ctx: BotCommandContext) => Promise<void>;
}
