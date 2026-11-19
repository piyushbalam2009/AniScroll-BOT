import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { AppError, createModuleLogger, ERROR_CODES } from '../../../../../packages/shared/src';
import { createMonochromeEmbed } from '../../../../../packages/discord-ui/src';
import { BotSlashCommand } from '../types';
import { resolveAndValidateWelcomeChannel } from '../../services/welcome/WelcomeService';
import {
  DailyAnimeService,
  isValidIanaTimezone,
  validateDailyAnimeChannel,
} from '../../services/anime/DailyAnimeService';

const log = createModuleLogger('ConfigCommand');

export const configCommand: BotSlashCommand = {
  name: 'config',
  category: 'admin',
  cooldownSeconds: 4,
  requiredPermissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure AniScroll Bot modules for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('overview').setDescription('View all module settings for this server'))
    .addSubcommand((s) =>
      s
        .setName('welcome')
        .setDescription('Configure welcome messages')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable welcome messages').setRequired(true))
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Welcome channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('automod')
        .setDescription('Configure AutoMod protection')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable AutoMod').setRequired(true))
        .addIntegerOption((o) => o.setName('max_mentions').setDescription('Max mentions per message'))
    )
    .addSubcommand((s) =>
      s
        .setName('moderation')
        .setDescription('Configure moderation log channel')
        .addChannelOption((o) => o.setName('log_channel').setDescription('Moderation log channel').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('logging')
        .setDescription('Configure audit logging')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable logging').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Log destination channel'))
    )
    .addSubcommand((s) =>
      s
        .setName('roles')
        .setDescription('Configure staff/DJ roles')
        .addRoleOption((o) => o.setName('dj_role').setDescription('DJ role for music commands'))
        .addRoleOption((o) => o.setName('staff_role').setDescription('Staff role for moderation/tickets'))
    )
    .addSubcommand((s) =>
      s
        .setName('suggestions')
        .setDescription('Configure suggestions channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Suggestions channel').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('tickets')
        .setDescription('Configure tickets category')
        .addChannelOption((o) => o.setName('category').setDescription('Ticket parent category').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('music')
        .setDescription('Configure music defaults')
        .addIntegerOption((o) => o.setName('default_volume').setDescription('Default volume (0-120)').setMinValue(0).setMaxValue(120))
        .addBooleanOption((o) => o.setName('stay_247').setDescription('Enable 24/7 voice presence'))
    )
    .addSubcommand((s) =>
      s
        .setName('anime')
        .setDescription('Configure anime discovery & Daily Anime auto-posting')
        .addBooleanOption((o) =>
          o.setName('daily_enabled').setDescription('Enable or disable automatic Daily Anime posting')
        )
        .addChannelOption((o) =>
          o
            .setName('daily_channel')
            .setDescription('Text channel for automatic Daily Anime posts')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addIntegerOption((o) =>
          o
            .setName('daily_hour')
            .setDescription('Hour of day to post Daily Anime (0-23)')
            .setMinValue(0)
            .setMaxValue(23)
        )
        .addIntegerOption((o) =>
          o
            .setName('daily_minute')
            .setDescription('Minute of hour to post Daily Anime (0-59)')
            .setMinValue(0)
            .setMaxValue(59)
        )
        .addStringOption((o) =>
          o
            .setName('daily_timezone')
            .setDescription('IANA timezone (e.g. Asia/Kolkata, America/New_York, UTC)')
        )
        .addBooleanOption((o) =>
          o.setName('test_post').setDescription('Post a live test Daily Anime message to the configured channel')
        )
        .addChannelOption((o) =>
          o
            .setName('aotd_channel')
            .setDescription('Legacy alias for Daily Anime channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addStringOption((o) =>
          o
            .setName('locale')
            .setDescription('Metadata language')
            .addChoices(
              { name: 'English', value: 'en' },
              { name: 'Japanese', value: 'ja' },
              { name: 'Spanish', value: 'es' },
              { name: 'Portuguese (BR)', value: 'pt-BR' }
            )
        )
    )
    .addSubcommand((s) =>
      s
        .setName('notifications')
        .setDescription('Configure announcement destination channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Default announcement channel').setRequired(true))
    )
    .addSubcommand((s) => s.setName('permissions').setDescription('Inspect role permissions for AniScroll Bot')),

  async execute(interaction, ctx) {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({ ephemeral: true, content: 'Server commands require a Discord server.' });
      return;
    }

    ctx.db.ensureGuild({
      discordGuildId: interaction.guildId,
      name: interaction.guild.name,
      memberCount: interaction.guild.memberCount,
    });

    const sub = interaction.options.getSubcommand();
    const settings = ctx.db.getGuildSettings(interaction.guildId);

    if (sub === 'overview' || sub === 'permissions') {
      const dailyCfg = ctx.db.getDailyAnimeConfig(interaction.guildId);
      const timeStr = `${String(dailyCfg.hour).padStart(2, '0')}:${String(dailyCfg.minute).padStart(2, '0')} (${dailyCfg.timezone})`;
      await interaction.reply({
        ephemeral: true,
        embeds: [
          createMonochromeEmbed({
            title: `Configuration · ${interaction.guild.name}`,
            description: 'Current server settings persisted in database.',
          }).addFields(
            { name: 'Welcome', value: settings.welcomeConfig.enabled ? `Enabled (<#${settings.welcomeConfig.channelId || 'unset'}>)` : 'Disabled', inline: true },
            { name: 'AutoMod', value: settings.automodConfig.enabled ? `Enabled (${settings.automodConfig.punishmentMode})` : 'Disabled', inline: true },
            { name: 'Music', value: `Vol ${settings.musicConfig.defaultVolume}% · 24/7: ${settings.musicConfig.stay247 ? 'On' : 'Off'}`, inline: true },
            { name: 'Anime Locale', value: settings.animeConfig.locale, inline: true },
            {
              name: 'Daily Anime',
              value: dailyCfg.enabled
                ? `Enabled · ${dailyCfg.channelId ? `<#${dailyCfg.channelId}>` : 'No channel'} · ${timeStr}`
                : `Disabled · ${timeStr}`,
              inline: true,
            },
            { name: 'Logging', value: settings.loggingConfig.enabled ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Staff Roles', value: settings.moderationConfig.staffRoleIds.length ? settings.moderationConfig.staffRoleIds.map((r) => `<@&${r}>`).join(', ') : 'Admin Only', inline: true }
          ),
        ],
      });
      return;
    }

    if (sub === 'welcome') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const ch = interaction.options.getChannel('channel');
      const targetChannelId = ch?.id ?? settings.welcomeConfig.channelId;
      if (enabled && targetChannelId) {
        await resolveAndValidateWelcomeChannel(interaction.guild, targetChannelId);
      }
      ctx.db.updateGuildSettingsSection(
        interaction.guildId,
        'welcomeConfig',
        {
          ...settings.welcomeConfig,
          enabled,
          channelId: targetChannelId,
          lastError: null,
        },
        interaction.user.id
      );
      log.info(
        {
          guildId: interaction.guildId,
          channelId: targetChannelId,
          enabled,
          actorId: interaction.user.id,
        },
        'Updated welcomeConfig via /config welcome'
      );
    } else if (sub === 'automod') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const maxMentions = interaction.options.getInteger('max_mentions');
      ctx.db.updateGuildSettingsSection(
        interaction.guildId,
        'automodConfig',
        {
          ...settings.automodConfig,
          enabled,
          maxMentions: maxMentions ?? settings.automodConfig.maxMentions,
        },
        interaction.user.id
      );
    } else if (sub === 'moderation') {
      const ch = interaction.options.getChannel('log_channel', true);
      ctx.db.updateGuildSettingsSection(
        interaction.guildId,
        'moderationConfig',
        { ...settings.moderationConfig, modLogChannelId: ch.id },
        interaction.user.id
      );
    } else if (sub === 'logging') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const ch = interaction.options.getChannel('channel');
      ctx.db.updateGuildSettingsSection(
        interaction.guildId,
        'loggingConfig',
        {
          ...settings.loggingConfig,
          enabled,
          moderationLogChannelId: ch?.id ?? settings.loggingConfig.moderationLogChannelId,
        },
        interaction.user.id
      );
    } else if (sub === 'roles') {
      const dj = interaction.options.getRole('dj_role');
      const staff = interaction.options.getRole('staff_role');
      if (dj) {
        const nextDj = Array.from(new Set([...settings.musicConfig.djRoleIds, dj.id]));
        ctx.db.updateGuildSettingsSection(interaction.guildId, 'musicConfig', { ...settings.musicConfig, djRoleIds: nextDj }, interaction.user.id);
      }
      if (staff) {
        const nextStaff = Array.from(new Set([...settings.moderationConfig.staffRoleIds, staff.id]));
        ctx.db.updateGuildSettingsSection(interaction.guildId, 'moderationConfig', { ...settings.moderationConfig, staffRoleIds: nextStaff }, interaction.user.id);
      }
    } else if (sub === 'suggestions') {
      const ch = interaction.options.getChannel('channel', true);
      ctx.db.updateGuildSettingsSection(
        interaction.guildId,
        'communityConfig',
        { ...settings.communityConfig, suggestionsChannelId: ch.id },
        interaction.user.id
      );
    } else if (sub === 'tickets') {
      const cat = interaction.options.getChannel('category', true);
      ctx.db.updateGuildSettingsSection(
        interaction.guildId,
        'communityConfig',
        { ...settings.communityConfig, ticketsCategoryId: cat.id },
        interaction.user.id
      );
    } else if (sub === 'music') {
      const defaultVolume = interaction.options.getInteger('default_volume');
      const stay247 = interaction.options.getBoolean('stay_247');
      ctx.db.updateGuildSettingsSection(
        interaction.guildId,
        'musicConfig',
        {
          ...settings.musicConfig,
          defaultVolume: defaultVolume ?? settings.musicConfig.defaultVolume,
          stay247: stay247 ?? settings.musicConfig.stay247,
        },
        interaction.user.id
      );
    } else if (sub === 'anime') {
      const dailyEnabledOpt = interaction.options.getBoolean('daily_enabled');
      const dailyChannelOpt = interaction.options.getChannel('daily_channel');
      const aotdChannelOpt = interaction.options.getChannel('aotd_channel');
      const dailyHourOpt = interaction.options.getInteger('daily_hour');
      const dailyMinuteOpt = interaction.options.getInteger('daily_minute');
      const dailyTimezoneOpt = interaction.options.getString('daily_timezone');
      const testPostOpt = interaction.options.getBoolean('test_post');
      const localeOpt = interaction.options.getString('locale') as any;

      const currentDaily = ctx.db.getDailyAnimeConfig(interaction.guildId);

      // View mode when /config anime is run with no options
      if (
        dailyEnabledOpt === null &&
        dailyChannelOpt === null &&
        aotdChannelOpt === null &&
        dailyHourOpt === null &&
        dailyMinuteOpt === null &&
        dailyTimezoneOpt === null &&
        testPostOpt === null &&
        localeOpt === null
      ) {
        const timeStr = `${String(currentDaily.hour).padStart(2, '0')}:${String(currentDaily.minute).padStart(2, '0')}`;
        await interaction.reply({
          ephemeral: true,
          embeds: [
            createMonochromeEmbed({
              title: `Anime & Daily Anime Configuration · ${interaction.guild.name}`,
              description: 'Use `/config anime` options to enable, schedule, or test automatic Daily Anime posts.',
            }).addFields(
              { name: 'Daily Anime Status', value: currentDaily.enabled ? 'Enabled' : 'Disabled', inline: true },
              { name: 'Post Channel', value: currentDaily.channelId ? `<#${currentDaily.channelId}>` : 'Not set', inline: true },
              { name: 'Schedule', value: `${timeStr} (${currentDaily.timezone})`, inline: true },
              { name: 'Metadata Locale', value: settings.animeConfig.locale, inline: true }
            ),
          ],
        });
        return;
      }

      if (dailyTimezoneOpt !== null && !isValidIanaTimezone(dailyTimezoneOpt)) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          `Invalid IANA timezone "${dailyTimezoneOpt}". Examples: Asia/Kolkata, America/New_York, Europe/London, UTC.`,
          400
        );
      }

      if (dailyHourOpt !== null && (dailyHourOpt < 0 || dailyHourOpt > 23)) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Daily hour must be between 0 and 23.', 400);
      }
      if (dailyMinuteOpt !== null && (dailyMinuteOpt < 0 || dailyMinuteOpt > 59)) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Daily minute must be between 0 and 59.', 400);
      }

      const targetChannelId = dailyChannelOpt?.id ?? aotdChannelOpt?.id ?? currentDaily.channelId;
      const nextEnabled = dailyEnabledOpt !== null ? dailyEnabledOpt : currentDaily.enabled;
      const nextHour = dailyHourOpt !== null ? dailyHourOpt : currentDaily.hour;
      const nextMinute = dailyMinuteOpt !== null ? dailyMinuteOpt : currentDaily.minute;
      const nextTimezone = dailyTimezoneOpt !== null ? dailyTimezoneOpt.trim() : currentDaily.timezone;

      if (nextEnabled && !targetChannelId) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'Please provide `daily_channel` before enabling automatic Daily Anime posting.',
          400
        );
      }

      if (testPostOpt) {
        await interaction.deferReply({ ephemeral: true });
      }

      if (targetChannelId && (nextEnabled || dailyChannelOpt || aotdChannelOpt || testPostOpt)) {
        await validateDailyAnimeChannel(interaction.guild, targetChannelId);
      }

      if (localeOpt) {
        ctx.db.updateGuildSettingsSection(
          interaction.guildId,
          'animeConfig',
          {
            ...settings.animeConfig,
            locale: localeOpt,
          },
          interaction.user.id
        );
      }

      const savedDaily = ctx.db.upsertDailyAnimeConfig(
        interaction.guildId,
        {
          enabled: nextEnabled,
          channelId: targetChannelId,
          hour: nextHour,
          minute: nextMinute,
          timezone: nextTimezone,
        },
        interaction.user.id
      );

      let testSummary = '';
      if (testPostOpt) {
        const dailyService = ctx.dailyAnimeService ?? new DailyAnimeService(ctx.db, ctx.animeService);
        const testResult = await dailyService.postDailyAnimeToGuild(interaction.client, interaction.guildId, {
          isTest: true,
        });
        testSummary = testResult.ok
          ? `\nTest post sent to <#${testResult.channelId}> (message ID \`${testResult.messageId || 'sent'}\`).`
          : `\nTest post failed: ${testResult.reason || 'Unknown error'}`;
      }

      const timeStr = `${String(savedDaily.hour).padStart(2, '0')}:${String(savedDaily.minute).padStart(2, '0')}`;
      const replyPayload = {
        embeds: [
          createMonochromeEmbed({
            title: 'Anime Configuration Saved',
            description:
              `Daily Anime: **${savedDaily.enabled ? 'Enabled' : 'Disabled'}**\n` +
              `Channel: ${savedDaily.channelId ? `<#${savedDaily.channelId}>` : 'Not set'}\n` +
              `Schedule: **${timeStr}** (\`${savedDaily.timezone}\`)\n` +
              `Locale: **${localeOpt ?? settings.animeConfig.locale}**` +
              testSummary,
          }),
        ],
      };

      if (testPostOpt) {
        await interaction.editReply(replyPayload);
      } else {
        await interaction.reply({ ...replyPayload, ephemeral: true });
      }
      return;
    } else if (sub === 'notifications') {
      const ch = interaction.options.getChannel('channel', true);
      ctx.db.updateGuildSettingsSection(
        interaction.guildId,
        'notificationConfig',
        { ...settings.notificationConfig, defaultChannelId: ch.id },
        interaction.user.id
      );
    }

    await interaction.reply({
      ephemeral: true,
      embeds: [
        createMonochromeEmbed({
          title: 'Configuration Saved',
          description: `Updated **${sub}** settings in PostgreSQL/SQLite persistence.`,
        }),
      ],
    });
  },
};
