import { ChannelType, GuildMember, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { AppError, createModuleLogger, ERROR_CODES } from '../../../../../packages/shared/src';
import { createMonochromeEmbed } from '../../../../../packages/discord-ui/src';
import { BotSlashCommand } from '../types';
import {
  dispatchWelcomeMessage,
  resolveAndValidateWelcomeChannel,
  runWelcomeDiagnostics,
} from '../../services/welcome/WelcomeService';

const log = createModuleLogger('WelcomeCommand');

export const welcomeCommand: BotSlashCommand = {
  name: 'welcome',
  category: 'admin',
  cooldownSeconds: 4,
  requiredPermissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure, test, and diagnose welcome messages for new server members')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Select the welcome channel and enable welcome messages for this server')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Text channel where welcome messages will be sent')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addChannelOption((o) =>
          o
            .setName('rules_channel')
            .setDescription('Optional rules channel to mention in the welcome embed')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addChannelOption((o) =>
          o
            .setName('intro_channel')
            .setDescription('Optional introductions channel to mention in the welcome embed')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addBooleanOption((o) =>
          o
            .setName('enabled')
            .setDescription('Enable or disable automated welcome messages (default: enabled)')
        )
    )
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Send a preview welcome message to the configured welcome channel')
    )
    .addSubcommand((s) =>
      s
        .setName('diagnose')
        .setDescription('Run live diagnostics on intents, event registration, DB config, and channel permissions')
        .addBooleanOption((o) =>
          o
            .setName('send_test')
            .setDescription('Also send a real test message to the configured welcome channel')
        )
    ),

  async execute(interaction, ctx) {
    if (!interaction.guildId || !interaction.guild) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Welcome commands can only be used inside a Discord server.',
        400
      );
    }

    ctx.db.ensureGuild({
      discordGuildId: interaction.guildId,
      name: interaction.guild.name,
      memberCount: interaction.guild.memberCount,
    });

    const sub = interaction.options.getSubcommand();
    const settings = ctx.db.getGuildSettings(interaction.guildId);

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const rulesChannel = interaction.options.getChannel('rules_channel');
      const introChannel = interaction.options.getChannel('intro_channel');
      const enabled = interaction.options.getBoolean('enabled') ?? true;

      // Verify bot permissions in the target channel up front
      await resolveAndValidateWelcomeChannel(interaction.guild, channel.id);

      const nextConfig = {
        ...settings.welcomeConfig,
        enabled,
        channelId: channel.id,
        rulesChannelId: rulesChannel ? rulesChannel.id : settings.welcomeConfig.rulesChannelId ?? null,
        introChannelId: introChannel ? introChannel.id : settings.welcomeConfig.introChannelId ?? null,
        lastError: null,
      };

      ctx.db.updateGuildSettingsSection(
        interaction.guildId,
        'welcomeConfig',
        nextConfig,
        interaction.user.id
      );

      log.info(
        {
          guildId: interaction.guildId,
          channelId: channel.id,
          enabled,
          rulesChannelId: nextConfig.rulesChannelId,
          introChannelId: nextConfig.introChannelId,
          actorId: interaction.user.id,
        },
        'Saved /welcome setup configuration'
      );

      const embed = createMonochromeEmbed({
        title: 'Welcome System Configured',
        description: `Automated welcome messages are **${enabled ? 'Enabled' : 'Disabled'}** and will be delivered to <#${channel.id}>.`,
        footerText: `Configured by @${interaction.user.username}`,
      }).addFields(
        { name: 'Welcome Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Status', value: enabled ? 'Enabled' : 'Disabled', inline: true }
      );

      if (nextConfig.rulesChannelId) {
        embed.addFields({ name: 'Rules Channel', value: `<#${nextConfig.rulesChannelId}>`, inline: true });
      }
      if (nextConfig.introChannelId) {
        embed.addFields({ name: 'Intro Channel', value: `<#${nextConfig.introChannelId}>`, inline: true });
      }

      await interaction.reply({
        ephemeral: true,
        embeds: [embed],
      });
      return;
    }

    if (sub === 'test') {
      await interaction.deferReply({ ephemeral: true });

      const member =
        (interaction.member as GuildMember | null) ||
        (interaction.guild.members?.fetch
          ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
          : null);

      const result = await dispatchWelcomeMessage({
        guild: interaction.guild,
        member,
        user: interaction.user,
        db: ctx.db,
        isTest: true,
      });

      await interaction.editReply({
        embeds: [
          createMonochromeEmbed({
            title: 'Welcome Preview Sent',
            description: `Sent a test welcome message to <#${result.channelId}>.`,
            footerText: 'AniScroll · Welcome Diagnostics',
          }),
        ],
      });
      return;
    }

    if (sub === 'diagnose') {
      await interaction.deferReply({ ephemeral: true });
      const sendTest = interaction.options.getBoolean('send_test') ?? false;
      const { getBotRuntime } = await import('../../index');
      const runtime = getBotRuntime();

      const report = await runWelcomeDiagnostics({
        client: interaction.client ?? runtime.client,
        status: runtime.client ? runtime.status : 'ready',
        privilegedIntentsActive:
          runtime.client === interaction.client ? runtime.privilegedIntentsActive : true,
        intentWarning: runtime.intentWarning,
        guildId: interaction.guildId,
        db: ctx.db,
        sendTestMessage: sendTest,
        actorUser: interaction.user,
      });

      const formatFlag = (ok: boolean | null) => (ok === true ? 'PASS' : ok === false ? 'FAIL' : 'SKIP');

      const embed = createMonochromeEmbed({
        title: `Welcome Diagnostics · ${report.overallOk ? 'All Checks Passed' : 'Attention Required'}`,
        description: report.simulationNotice,
        footerText: `AniScroll · Welcome Diagnostics (${interaction.guildId})`,
      }).addFields(
        {
          name: `[${formatFlag(report.checks.botOnline.ok)}] Bot Online`,
          value: report.checks.botOnline.detail,
          inline: false,
        },
        {
          name: `[${formatFlag(report.checks.guildMembersIntent.ok)}] GuildMembers Intent`,
          value: `${report.checks.guildMembersIntent.detail}\nIntents: \`${report.checks.guildMembersIntent.enabledIntents.join(', ') || 'none'}\``,
          inline: false,
        },
        {
          name: `[${formatFlag(report.checks.eventListener.ok)}] guildMemberAdd Listener`,
          value: report.checks.eventListener.detail,
          inline: false,
        },
        {
          name: `[${formatFlag(report.checks.welcomeConfig.ok)}] Database Config`,
          value: report.checks.welcomeConfig.detail,
          inline: false,
        },
        {
          name: `[${formatFlag(report.checks.channelAccessible.ok)}] Channel & Permissions`,
          value: report.checks.channelAccessible.detail,
          inline: false,
        },
        {
          name: `[${formatFlag(report.checks.testMessage.ok)}] Live Channel Test Send`,
          value: report.checks.testMessage.detail,
          inline: false,
        }
      );

      await interaction.editReply({ embeds: [embed] });
    }
  },
};
