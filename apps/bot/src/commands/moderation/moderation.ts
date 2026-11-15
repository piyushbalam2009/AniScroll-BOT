import { PermissionFlagsBits, SlashCommandBuilder, TextChannel } from 'discord.js';
import { createErrorEmbed, createMonochromeEmbed } from '../../../../../packages/discord-ui/src';
import { BotSlashCommand } from '../types';

export const moderationCommands: BotSlashCommand[] = [
  {
    name: 'warn',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ModerateMembers],
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Issue or remove member warnings with automatic escalation')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Warn a member')
          .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
          .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true))
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Revoke an active warning by ID')
          .addStringOption((o) => o.setName('warning_id').setDescription('Warning ID').setRequired(true))
      ),
    async execute(interaction, ctx) {
      if (!interaction.guildId || !interaction.guild) return;
      const sub = interaction.options.getSubcommand();
      if (sub === 'remove') {
        const id = interaction.options.getString('warning_id', true);
        const removed = ctx.db.removeWarning(interaction.guildId, id);
        await interaction.reply({
          ephemeral: true,
          embeds: [
            removed
              ? createMonochromeEmbed({ title: 'Warning Removed', description: `Warning \`${id}\` revoked.` })
              : createErrorEmbed('Warning ID not found.'),
          ],
        });
        return;
      }
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const result = ctx.db.issueWarningWithEscalation(interaction.guildId, {
        userId: user.id,
        moderatorId: interaction.user.id,
        reason,
      });

      if (result.escalation.action === 'TIMEOUT' && result.escalation.durationMinutes) {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (member && member.moderatable) {
          await member.timeout(result.escalation.durationMinutes * 60_000, `Warning escalation: ${reason}`).catch(() => undefined);
        }
      }

      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: `Case #${result.modCase.caseNumber} · Warning Issued`,
            description: `Warned <@${user.id}> (${result.totalActiveWarnings} active warnings).\nEscalation action: **${result.escalation.action}**${result.escalation.durationMinutes ? ` (${result.escalation.durationMinutes}m)` : ''}`,
          }),
        ],
      });
    },
  },
  {
    name: 'warnings',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ModerateMembers],
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('View warning history for a member')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const user = interaction.options.getUser('user', true);
      const warnings = ctx.db.listWarnings(interaction.guildId, user.id);
      const lines = warnings.slice(0, 10).map((w) => `\`${w.id.slice(0, 8)}\` · ${w.reason} (by <@${w.moderatorId}>)`);
      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: `Warnings · ${user.username}`,
            description: lines.join('\n') || 'No active warnings.',
          }),
        ],
      });
    },
  },
  {
    name: 'timeout',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ModerateMembers],
    data: new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Timeout a member')
      .addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true))
      .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true)),
    async execute(interaction, ctx) {
      if (!interaction.guildId || !interaction.guild) return;
      const user = interaction.options.getUser('user', true);
      const minutes = interaction.options.getInteger('minutes', true);
      const reason = interaction.options.getString('reason', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member || !member.moderatable) {
        await interaction.reply({ ephemeral: true, embeds: [createErrorEmbed('Cannot moderate that member due to role hierarchy.')] });
        return;
      }
      await member.timeout(minutes * 60_000, reason);
      const c = ctx.db.createModerationCase(interaction.guildId, {
        targetUserId: user.id,
        moderatorId: interaction.user.id,
        action: 'TIMEOUT',
        reason,
        durationMinutes: minutes,
      });
      await interaction.reply({
        embeds: [createMonochromeEmbed({ title: `Case #${c.caseNumber} · Timeout`, description: `<@${user.id}> timed out for **${minutes}m**.\nReason: ${reason}` })],
      });
    },
  },
  {
    name: 'untimeout',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ModerateMembers],
    data: new SlashCommandBuilder()
      .setName('untimeout')
      .setDescription('Remove timeout from a member')
      .addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason')),
    async execute(interaction, ctx) {
      if (!interaction.guildId || !interaction.guild) return;
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'Manual untimeout';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member && member.moderatable) await member.timeout(null, reason);
      const c = ctx.db.createModerationCase(interaction.guildId, {
        targetUserId: user.id,
        moderatorId: interaction.user.id,
        action: 'UNTIMEOUT',
        reason,
      });
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: `Case #${c.caseNumber} · Timeout Removed`, description: `Removed timeout from <@${user.id}>.` })] });
    },
  },
  {
    name: 'kick',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.KickMembers],
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member from the server')
      .addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true)),
    async execute(interaction, ctx) {
      if (!interaction.guildId || !interaction.guild) return;
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member || !member.kickable) {
        await interaction.reply({ ephemeral: true, embeds: [createErrorEmbed('Cannot kick this member.')] });
        return;
      }
      await member.kick(reason);
      const c = ctx.db.createModerationCase(interaction.guildId, {
        targetUserId: user.id,
        moderatorId: interaction.user.id,
        action: 'KICK',
        reason,
      });
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: `Case #${c.caseNumber} · Kicked`, description: `<@${user.id}> kicked. Reason: ${reason}` })] });
    },
  },
  {
    name: 'ban',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.BanMembers],
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member permanently or temporarily')
      .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true))
      .addIntegerOption((o) => o.setName('days').setDescription('Optional temp-ban duration in days').setMinValue(1).setMaxValue(365)),
    async execute(interaction, ctx) {
      if (!interaction.guildId || !interaction.guild) return;
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const days = interaction.options.getInteger('days');
      await interaction.guild.members.ban(user.id, { reason });
      const c = ctx.db.createModerationCase(interaction.guildId, {
        targetUserId: user.id,
        moderatorId: interaction.user.id,
        action: days ? 'TEMP_BAN' : 'BAN',
        reason,
        durationMinutes: days ? days * 1440 : null,
      });
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: `Case #${c.caseNumber} · Banned`, description: `<@${user.id}> banned. Reason: ${reason}` })] });
    },
  },
  {
    name: 'unban',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.BanMembers],
    data: new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban a user by Discord ID')
      .addStringOption((o) => o.setName('user_id').setDescription('Discord User ID').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason')),
    async execute(interaction, ctx) {
      if (!interaction.guildId || !interaction.guild) return;
      const userId = interaction.options.getString('user_id', true);
      const reason = interaction.options.getString('reason') || 'Manual unban';
      await interaction.guild.members.unban(userId, reason);
      const c = ctx.db.createModerationCase(interaction.guildId, {
        targetUserId: userId,
        moderatorId: interaction.user.id,
        action: 'UNBAN',
        reason,
      });
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: `Case #${c.caseNumber} · Unbanned`, description: `Unbanned \`${userId}\`.` })] });
    },
  },
  {
    name: 'softban',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.BanMembers],
    data: new SlashCommandBuilder()
      .setName('softban')
      .setDescription('Ban and immediately unban to purge recent messages')
      .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true)),
    async execute(interaction, ctx) {
      if (!interaction.guildId || !interaction.guild) return;
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      await interaction.guild.members.ban(user.id, { deleteMessageSeconds: 86400, reason });
      await interaction.guild.members.unban(user.id, 'Softban message purge');
      const c = ctx.db.createModerationCase(interaction.guildId, {
        targetUserId: user.id,
        moderatorId: interaction.user.id,
        action: 'SOFTBAN',
        reason,
      });
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: `Case #${c.caseNumber} · Softbanned`, description: `<@${user.id}> softbanned and messages cleared.` })] });
    },
  },
  {
    name: 'purge',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ManageMessages],
    data: new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Bulk delete messages in this channel')
      .addIntegerOption((o) => o.setName('amount').setDescription('Messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount', true);
      const ch = interaction.channel as TextChannel | null;
      if (!ch || !('bulkDelete' in ch)) return;
      const deleted = await ch.bulkDelete(amount, true);
      await interaction.reply({ ephemeral: true, embeds: [createMonochromeEmbed({ title: 'Messages Purged', description: `Deleted **${deleted.size}** messages.` })] });
    },
  },
  {
    name: 'slowmode',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ManageChannels],
    data: new SlashCommandBuilder()
      .setName('slowmode')
      .setDescription('Set channel slowmode in seconds')
      .addIntegerOption((o) => o.setName('seconds').setDescription('Cooldown seconds (0-21600)').setRequired(true).setMinValue(0).setMaxValue(21600)),
    async execute(interaction) {
      const sec = interaction.options.getInteger('seconds', true);
      const ch = interaction.channel as TextChannel | null;
      if (ch && 'setRateLimitPerUser' in ch) await ch.setRateLimitPerUser(sec);
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: 'Slowmode Updated', description: `Slowmode set to **${sec}s**.` })] });
    },
  },
  {
    name: 'lock',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ManageChannels],
    data: new SlashCommandBuilder().setName('lock').setDescription('Lock the current text channel for @everyone'),
    async execute(interaction) {
      if (!interaction.guild) return;
      const ch = interaction.channel as TextChannel | null;
      if (ch) await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: 'Channel Locked', description: 'Members can no longer send messages here.' })] });
    },
  },
  {
    name: 'unlock',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ManageChannels],
    data: new SlashCommandBuilder().setName('unlock').setDescription('Unlock the current text channel'),
    async execute(interaction) {
      if (!interaction.guild) return;
      const ch = interaction.channel as TextChannel | null;
      if (ch) await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: 'Channel Unlocked', description: 'Channel messaging permissions restored.' })] });
    },
  },
  {
    name: 'nickname',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ManageNicknames],
    data: new SlashCommandBuilder()
      .setName('nickname')
      .setDescription('Change or reset a member’s nickname')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('name').setDescription('New nickname (omit to reset)')),
    async execute(interaction) {
      if (!interaction.guild) return;
      const user = interaction.options.getUser('user', true);
      const name = interaction.options.getString('name') || null;
      const member = await interaction.guild.members.fetch(user.id);
      await member.setNickname(name);
      await interaction.reply({ embeds: [createMonochromeEmbed({ title: 'Nickname Updated', description: `Updated <@${user.id}> nickname to **${name || 'Default'}**.` })] });
    },
  },
  {
    name: 'cases',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ModerateMembers],
    data: new SlashCommandBuilder()
      .setName('cases')
      .setDescription('List recent moderation cases')
      .addUserOption((o) => o.setName('user').setDescription('Filter by user')),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const user = interaction.options.getUser('user');
      const cases = ctx.db.listModerationCases(interaction.guildId, user?.id);
      const lines = cases.slice(0, 10).map((c) => `**#${c.caseNumber}** · ${c.action} · <@${c.targetUserId}> — ${c.reason}`);
      await interaction.reply({
        ephemeral: true,
        embeds: [createMonochromeEmbed({ title: 'Moderation Cases', description: lines.join('\n') || 'No moderation cases recorded.' })],
      });
    },
  },
  {
    name: 'modstats',
    category: 'moderation',
    requiredPermissions: [PermissionFlagsBits.ModerateMembers],
    data: new SlashCommandBuilder().setName('modstats').setDescription('View moderation action summary for this server'),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const cases = ctx.db.listModerationCases(interaction.guildId);
      const warnings = ctx.db.listWarnings(interaction.guildId);
      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: 'Moderation Statistics',
            description: `Total Cases: **${cases.length}** · Active Warnings: **${warnings.length}**`,
          }),
        ],
      });
    },
  },
  {
    name: 'appeal',
    category: 'moderation',
    data: new SlashCommandBuilder()
      .setName('appeal')
      .setDescription('Submit a moderation case appeal')
      .addIntegerOption((o) => o.setName('case_number').setDescription('Case number').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Appeal explanation').setRequired(true)),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const caseNum = interaction.options.getInteger('case_number', true);
      const text = interaction.options.getString('reason', true);
      ctx.db.submitAppeal(interaction.guildId, caseNum, text);
      await interaction.reply({
        ephemeral: true,
        embeds: [createMonochromeEmbed({ title: `Appeal Submitted · Case #${caseNum}`, description: 'Staff will review your appeal in the moderation dashboard.' })],
      });
    },
  },
];
