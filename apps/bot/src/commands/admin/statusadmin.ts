import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { BotSlashCommand } from '../types';
import { getDatabase } from '../../../../../packages/database/src';
import { createMonochromeEmbed } from '../../../../../packages/discord-ui/src';

const serviceChoices = [
  { name: 'AniScroll Website', value: 'website' },
  { name: 'Hoshika Metadata API', value: 'hoshika' },
  { name: 'Discord Bot', value: 'discord_bot' },
  { name: 'Lavalink Music Node', value: 'lavalink' },
  { name: 'All Services', value: 'all' },
];

export const announceCommand: BotSlashCommand = {
  name: 'announce',
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Publish an AniScroll website announcement')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) => opt.setName('title').setDescription('Announcement title').setRequired(true))
    .addStringOption((opt) => opt.setName('description').setDescription('Announcement content / body').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('category')
        .setDescription('Announcement category')
        .setRequired(false)
        .addChoices(
          { name: 'Update', value: 'UPDATE' },
          { name: 'Patch Notes', value: 'PATCH' },
          { name: 'Announcement', value: 'ANNOUNCEMENT' },
          { name: 'Maintenance', value: 'MAINTENANCE' },
          { name: 'Feature', value: 'FEATURE' }
        )
    )
    .addStringOption((opt) => opt.setName('version').setDescription('Version number (e.g. 1.2.0)').setRequired(false))
    .addStringOption((opt) => opt.setName('link').setDescription('Website or release URL').setRequired(false)),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const db = getDatabase();
    const title = interaction.options.getString('title', true);
    const description = interaction.options.getString('description', true);
    const category = (interaction.options.getString('category') || 'UPDATE') as any;
    const version = interaction.options.getString('version');
    const link = interaction.options.getString('link');

    const config = db.getStatusConfig(interaction.guildId);
    const targetChannelId = config.updatesChannelId || process.env.ANISCROLL_UPDATES_CHANNEL_ID || interaction.channelId;

    const fullContent = `${description}${link ? `\n\n🌐 [Open Link](${link})` : ''}`;
    db.createWebsiteAnnouncement(title, fullContent, interaction.user.id, version, category, targetChannelId);

    const embed = createMonochromeEmbed({
      title: `🚀 ANISCROLL WEBSITE [${category}]`,
      description: `**${title}**${version ? ` (v${version})` : ''}\n\n${description}${link ? `\n\n🌐 ${link}` : ''}`,
      footerText: `Published by @${interaction.user.tag} • AniScroll Updates`,
    });

    try {
      const channel = await interaction.guild?.channels.fetch(targetChannelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        const pingRole = config.pingRoleId ? `<@&${config.pingRoleId}>` : '';
        await channel.send({ content: pingRole, embeds: [embed] });
      }
    } catch {
      // Ignore send error if lacking permissions
    }

    await interaction.editReply({ content: `✅ Successfully published announcement **${title}** to <#${targetChannelId}>!` });
  },
};

export const maintenanceCommand: BotSlashCommand = {
  name: 'maintenance',
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('Manage AniScroll scheduled and active maintenance windows')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start maintenance immediately for a service')
        .addStringOption((opt) =>
          opt.setName('service').setDescription('Target service').setRequired(true).addChoices(...serviceChoices)
        )
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for maintenance').setRequired(true))
        .addStringOption((opt) => opt.setName('expected_end').setDescription('Expected end time (optional)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('schedule')
        .setDescription('Schedule a future maintenance window')
        .addStringOption((opt) =>
          opt.setName('service').setDescription('Target service').setRequired(true).addChoices(...serviceChoices)
        )
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for maintenance').setRequired(true))
        .addStringOption((opt) => opt.setName('start_time').setDescription('Start time (IST / ISO)').setRequired(true))
        .addStringOption((opt) => opt.setName('end_time').setDescription('End time (optional)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('End active maintenance for a service')
        .addStringOption((opt) =>
          opt.setName('service').setDescription('Target service').setRequired(true).addChoices(...serviceChoices)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel scheduled maintenance for a service')
        .addStringOption((opt) =>
          opt.setName('service').setDescription('Target service').setRequired(true).addChoices(...serviceChoices)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List active and scheduled maintenance windows')),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const service = interaction.options.getString('service', sub !== 'list');
    const db = getDatabase();
    const config = db.getStatusConfig(interaction.guildId);
    const targetChannelId = config.statusChannelId || process.env.ANISCROLL_STATUS_CHANNEL_ID || interaction.channelId;

    if (sub === 'start') {
      const reason = interaction.options.getString('reason', true);
      const expectedEnd = interaction.options.getString('expected_end');
      const serviceKeys = service === 'all' ? ['website', 'hoshika_api', 'discord_bot', 'lavalink'] : [service!];

      for (const sk of serviceKeys) {
        db.updateServiceStatus(sk, sk, 'MAINTENANCE', 0, { reason }, reason);
        db.createIncident(sk, 'Scheduled Maintenance', reason, 'MAJOR');
      }

      db.createScheduledMaintenance(`Maintenance: ${service}`, reason, serviceKeys, new Date().toISOString(), expectedEnd || 'TBD');

      const embed = createMonochromeEmbed({
        title: '🛠️ ANISCROLL SYSTEM MAINTENANCE STARTED',
        description: `Service(s): **${service}**\nReason: **${reason}**\n${expectedEnd ? `Expected End: **${expectedEnd}** (IST)\n` : ''}\nServices under maintenance have been marked accordingly.`,
        footerText: 'AniScroll Maintenance Operations',
      });

      await announceToChannel(interaction, targetChannelId, embed);
      await interaction.reply({ content: `✅ Maintenance started successfully for **${service}**!`, ephemeral: true });
    } else if (sub === 'schedule') {
      const reason = interaction.options.getString('reason', true);
      const startTime = interaction.options.getString('start_time', true);
      const endTime = interaction.options.getString('end_time') || 'TBD';
      const serviceKeys = service === 'all' ? ['website', 'hoshika_api', 'discord_bot', 'lavalink'] : [service!];

      db.createScheduledMaintenance(`Scheduled Maintenance: ${service}`, reason, serviceKeys, startTime, endTime);

      const embed = createMonochromeEmbed({
        title: '📅 ANISCROLL MAINTENANCE SCHEDULED',
        description: `Service(s): **${service}**\nReason: **${reason}**\nStart Time: **${startTime}** (IST)\nEnd Time: **${endTime}** (IST)`,
        footerText: 'AniScroll Maintenance Schedule',
      });

      await announceToChannel(interaction, targetChannelId, embed);
      await interaction.reply({ content: `✅ Maintenance scheduled successfully for **${service}**!`, ephemeral: true });
    } else if (sub === 'end') {
      const serviceKeys = service === 'all' ? ['website', 'hoshika_api', 'discord_bot', 'lavalink'] : [service!];

      for (const sk of serviceKeys) {
        db.updateServiceStatus(sk, sk, 'ONLINE', 120, {}, null);
      }

      const embed = createMonochromeEmbed({
        title: '🟢 ANISCROLL MAINTENANCE COMPLETED',
        description: `Maintenance for **${service}** has concluded. All services are restored to operational status.`,
        footerText: 'AniScroll Maintenance Operations',
      });

      await announceToChannel(interaction, targetChannelId, embed);
      await interaction.reply({ content: `✅ Maintenance ended for **${service}**. Services restored to online.`, ephemeral: true });
    } else if (sub === 'cancel') {
      const embed = createMonochromeEmbed({
        title: '❌ ANISCROLL MAINTENANCE CANCELLED',
        description: `Scheduled maintenance for **${service}** has been cancelled.`,
        footerText: 'AniScroll Maintenance Schedule',
      });

      await announceToChannel(interaction, targetChannelId, embed);
      await interaction.reply({ content: `✅ Cancelled maintenance for **${service}**.`, ephemeral: true });
    } else if (sub === 'list') {
      const list = db.listScheduledMaintenance();
      const embed = createMonochromeEmbed({
        title: '🛠️ Maintenance Windows & History',
        description: list.length > 0
          ? list.map((m) => `### ${m.title} [${m.status}]\n${m.description}\n🕒 **Start:** ${m.scheduledStartAt} **End:** ${m.scheduledEndAt}`).join('\n\n')
          : 'No maintenance records found.',
        footerText: 'AniScroll Maintenance Manager',
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};

async function announceToChannel(interaction: ChatInputCommandInteraction, channelId: string, embed: any) {
  try {
    const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
    }
  } catch {
    // Ignore if channel is inaccessible
  }
}

export const statusConfigCommand: BotSlashCommand = {
  name: 'statusconfig',
  category: 'admin',
  data: new SlashCommandBuilder()
    .setName('statusconfig')
    .setDescription('Configure status monitoring channels and ping roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) => opt.setName('status_channel').setDescription('Channel for live service status alerts').setRequired(false))
    .addChannelOption((opt) => opt.setName('updates_channel').setDescription('Channel for website updates and announcements').setRequired(false))
    .addRoleOption((opt) => opt.setName('ping_role').setDescription('Role to ping for important maintenance/outages').setRequired(false)),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const statusChannel = interaction.options.getChannel('status_channel');
    const updatesChannel = interaction.options.getChannel('updates_channel');
    const pingRole = interaction.options.getRole('ping_role');

    const db = getDatabase();
    const updated = db.updateStatusConfig(interaction.guildId, {
      statusChannelId: statusChannel ? statusChannel.id : undefined,
      updatesChannelId: updatesChannel ? updatesChannel.id : undefined,
      pingRoleId: pingRole ? pingRole.id : undefined,
    });

    const embed = createMonochromeEmbed({
      title: '⚙️ Status Monitoring Configuration Updated',
      description: `• **Status Alerts Channel:** ${updated.statusChannelId ? `<#${updated.statusChannelId}>` : 'Not set'}\n• **Updates Channel:** ${updated.updatesChannelId ? `<#${updated.updatesChannelId}>` : 'Not set'}\n• **Ping Role:** ${updated.pingRoleId ? `<@&${updated.pingRoleId}>` : 'Not set'}`,
      footerText: 'AniScroll Status Configuration',
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export const statusAdminCommands = [announceCommand, maintenanceCommand, statusConfigCommand];
