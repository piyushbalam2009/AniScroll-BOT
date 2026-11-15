import { SlashCommandBuilder } from 'discord.js';
import { appConfig } from '../../../../../packages/shared/src';
import { createMonochromeEmbed } from '../../../../../packages/discord-ui/src';
import { getAnimeServices } from '../../services/hoshika';
import { BotSlashCommand } from '../types';

export const botAdminCommand: BotSlashCommand = {
  name: 'bot',
  category: 'admin',
  ownerOnly: true,
  cooldownSeconds: 3,
  data: new SlashCommandBuilder()
    .setName('bot')
    .setDescription('Owner-only bot diagnostics and runtime administration')
    .addSubcommand((s) => s.setName('info').setDescription('Show AniScroll Bot build and architecture info'))
    .addSubcommand((s) => s.setName('status').setDescription('Check service health across DB, Redis, Hoshika, and Lavalink'))
    .addSubcommand((s) => s.setName('ping').setDescription('Measure Discord Gateway and WebSocket latency'))
    .addSubcommand((s) => s.setName('diagnostics').setDescription('Show safe runtime diagnostics (no secrets)'))
    .addSubcommand((s) => s.setName('reload').setDescription('Reload slash command registry'))
    .addSubcommand((s) =>
      s
        .setName('maintenance')
        .setDescription('Toggle maintenance mode for non-owner commands')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable maintenance mode').setRequired(true))
    )
    .addSubcommandGroup((g) =>
      g
        .setName('cache')
        .setDescription('Cache administration')
        .addSubcommand((s) =>
          s
            .setName('clear')
            .setDescription('Clear cached keys')
            .addStringOption((o) => o.setName('namespace').setDescription('Optional namespace e.g. anime'))
        )
    ),
  async execute(interaction, ctx) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'cache' && sub === 'clear') {
      const ns = interaction.options.getString('namespace') || '';
      const count = await ctx.cache.clearNamespace(ns);
      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: 'Cache Cleared',
            description: `Cleared **${count}** cached entries${ns ? ` in namespace \`${ns}\`` : ''}.`,
          }),
        ],
      });
      return;
    }

    if (sub === 'ping') {
      const wsPing = interaction.client.ws.ping;
      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: 'Gateway Latency',
            description: `WebSocket ping: **${wsPing}ms**`,
          }),
        ],
      });
      return;
    }

    if (sub === 'info') {
      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: 'AniScroll Bot',
            description:
              'All-in-one Discord community, Hoshika anime discovery, personal watchlist, Lavalink v4 music, and moderation platform.',
          }).addFields(
            { name: 'Guilds', value: String(interaction.client.guilds.cache.size), inline: true },
            { name: 'Uptime', value: `${Math.floor(process.uptime())}s`, inline: true },
            { name: 'Runtime', value: `Node ${process.version}`, inline: true }
          ),
        ],
      });
      return;
    }

    if (sub === 'status' || sub === 'diagnostics') {
      const cacheStatus = ctx.cache.getStatus();
      const musicStatus = ctx.musicService.getStatus();
      const hoshikaStatus = getAnimeServices().client.getHealthState();
      const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);

      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: 'System Diagnostics',
            description: `Maintenance mode: **${ctx.maintenanceMode ? 'Enabled' : 'Disabled'}**`,
          }).addFields(
            { name: 'Cache', value: `${cacheStatus.backend} (${cacheStatus.memoryKeys} mem keys)`, inline: true },
            { name: 'Lavalink v4', value: musicStatus.connected ? 'Connected' : 'Disconnected', inline: true },
            { name: 'Hoshika API', value: hoshikaStatus.lastError ? `Degraded (${hoshikaStatus.lastError})` : 'Nominal', inline: true },
            { name: 'Memory RSS', value: `${memMb} MB`, inline: true },
            { name: 'Environment', value: appConfig.NODE_ENV, inline: true }
          ),
        ],
      });
      return;
    }

    if (sub === 'reload') {
      const total = await ctx.reloadCommands();
      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: 'Commands Reloaded',
            description: `Registered **${total}** command modules in runtime registry.`,
          }),
        ],
      });
      return;
    }

    if (sub === 'maintenance') {
      const enabled = interaction.options.getBoolean('enabled', true);
      ctx.setMaintenanceMode(enabled);
      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: 'Maintenance Mode Updated',
            description: `Maintenance mode is now **${enabled ? 'ENABLED' : 'DISABLED'}**.`,
          }),
        ],
      });
    }
  },
};
