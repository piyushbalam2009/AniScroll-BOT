import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { BotSlashCommand } from '../types';
import { getDatabase } from '../../../../../packages/database/src';
import { createMonochromeEmbed } from '../../../../../packages/discord-ui/src';
import { appConfig } from '../../../../../packages/shared/src';

export const statusCommand: BotSlashCommand = {
  name: 'status',
  category: 'community',
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('View live status and uptime of AniScroll website, APIs, Discord bot, and Lavalink'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const db = getDatabase();
    const statuses = db.getServiceStatuses();
    const incidents = db.listServiceIncidents(5).filter((i) => i.status !== 'RESOLVED');

    // Ensure all 5 standard services are represented even before first check
    const standardKeys = [
      { key: 'website', name: 'AniScroll Website' },
      { key: 'streaming_api', name: 'AniScroll Streaming API' },
      { key: 'hoshika_api', name: 'Hoshika Metadata API' },
      { key: 'discord_bot', name: 'Discord Bot' },
      { key: 'lavalink', name: 'Lavalink Music Node' },
    ];

    const fields = standardKeys.map((sk) => {
      const found = statuses.find((s) => s.serviceKey === sk.key);
      const status = found?.status || 'UNKNOWN';
      const emoji = status === 'ONLINE' ? '🟢' : status === 'DEGRADED' ? '🟡' : status === 'MAINTENANCE' ? '🛠️' : status === 'OFFLINE' ? '🔴' : '⏳';
      const lat = found ? `${found.responseTimeMs}ms` : 'N/A';
      const timeStr = found ? new Date(found.lastCheckedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Pending check';

      return {
        name: `${emoji} ${sk.name}`,
        value: `Status: **${status}** • Latency: \`${lat}\` • Checked (${timeStr} IST)${found?.errorMessage ? `\nError: \`${found.errorMessage}\`` : ''}`,
        inline: false,
      };
    });

    const allOnline = statuses.length > 0 && statuses.every((s) => s.status === 'ONLINE');
    const overallStatus = incidents.length > 0 ? '⚠️ Active Incidents' : allOnline ? '🟢 All Systems Operational' : '🟡 Partial Degradation';

    const embed = createMonochromeEmbed({
      title: '🖤 AniScroll System Status & Uptime',
      description: `**Overall Status:** ${overallStatus}\nTimezone: \`Asia/Kolkata (IST)\`\n${incidents.length > 0 ? `\n⚠️ **Active Incidents:**\n` + incidents.map((i) => `• **${i.title}** (${i.serviceKey}): ${i.description}`).join('\n') : ''}`,
      footerText: `AniScroll Network • Live Status Monitor`,
    });
    embed.addFields(fields);

    await interaction.editReply({ embeds: [embed] });
  },
};

export const websiteCommand: BotSlashCommand = {
  name: 'website',
  category: 'community',
  data: new SlashCommandBuilder()
    .setName('website')
    .setDescription('Display AniScroll website information, APIs, and links'),
  async execute(interaction: ChatInputCommandInteraction) {
    const db = getDatabase();
    const statuses = db.getServiceStatuses();
    const webStatus = statuses.find((s) => s.serviceKey === 'website')?.status || 'UNKNOWN';
    const streamStatus = statuses.find((s) => s.serviceKey === 'streaming_api')?.status || 'UNKNOWN';

    const webEmoji = webStatus === 'ONLINE' ? '🟢' : webStatus === 'DEGRADED' ? '🟡' : '🔴';
    const streamEmoji = streamStatus === 'ONLINE' ? '🟢' : streamStatus === 'DEGRADED' ? '🟡' : '🔴';

    const embed = createMonochromeEmbed({
      title: '🖤 ANISCROLL',
      description: `Your ultimate anime streaming and discovery destination.\n\n🌐 **Website:**\n${appConfig.ANISCROLL_WEBSITE_URL} (${webEmoji} **${webStatus}**)\n\n🚀 **Streaming API:**\n${appConfig.ANISCROLL_STREAMING_API_URL} (${streamEmoji} **${streamStatus}**)\n\n📚 **Metadata API:**\n${appConfig.HOSHIKA_BASE_URL}\n\n✨ **Features:**\n• High-speed anime streaming\n• Personalized watchlists & progress tracking\n• Community recommendations & chat\n• Immersive dark theme`,
      footerText: 'AniScroll Community • Watch Anime Anywhere',
    });

    await interaction.reply({ embeds: [embed] });
  },
};

export const updatesCommand: BotSlashCommand = {
  name: 'updates',
  category: 'community',
  data: new SlashCommandBuilder()
    .setName('updates')
    .setDescription('View recent AniScroll website updates and patch notes'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const db = getDatabase();
    const updates = db.listWebsiteAnnouncements(5);

    const embed = createMonochromeEmbed({
      title: '🖤 AniScroll Website Updates & Patch Notes',
      description: updates.length > 0
        ? updates.map((u) => `### 📌 [${u.category}] ${u.title}${u.version ? ` (v${u.version})` : ''}\n${u.content}\n🕒 *Posted on ${new Date(u.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} IST*`).join('\n\n')
        : 'No website updates or patch notes published yet. Check back soon for new features and improvements!',
      footerText: 'AniScroll Community Updates',
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export const statusCommands = [statusCommand, websiteCommand, updatesCommand];
