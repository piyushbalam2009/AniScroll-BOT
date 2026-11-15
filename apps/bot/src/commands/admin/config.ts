import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createModuleLogger } from '../../../../../packages/shared/src';
import { createMonochromeEmbed } from '../../../../../packages/discord-ui/src';
import { BotSlashCommand } from '../types';
import { resolveAndValidateWelcomeChannel } from '../../services/welcome/WelcomeService';

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
        .setDescription('Configure anime discovery & AOTD')
        .addChannelOption((o) => o.setName('aotd_channel').setDescription('Anime of the Day channel'))
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
      const ch = interaction.options.getChannel('aotd_channel');
      const locale = interaction.options.getString('locale') as any;
      ctx.db.updateGuildSettingsSection(
        interaction.guildId,
        'animeConfig',
        {
          ...settings.animeConfig,
          aotdChannelId: ch?.id ?? settings.animeConfig.aotdChannelId,
          locale: locale ?? settings.animeConfig.locale,
        },
        interaction.user.id
      );
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
