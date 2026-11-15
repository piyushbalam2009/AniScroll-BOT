import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { TICKET_CATEGORIES, TicketCategory } from '../../../../../packages/shared/src';
import { createMonochromeEmbed } from '../../../../../packages/discord-ui/src';
import { BotSlashCommand } from '../types';

export const communityCommands: BotSlashCommand[] = [
  {
    name: 'afk',
    category: 'utility',
    data: new SlashCommandBuilder()
      .setName('afk')
      .setDescription('Set your AFK status for this server')
      .addStringOption((o) => o.setName('reason').setDescription('AFK message')),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const reason = interaction.options.getString('reason') || 'AFK';
      ctx.db.sqlite
        .prepare(
          'INSERT OR REPLACE INTO afk_statuses (id, guild_id, user_id, reason, since) VALUES (?, ?, ?, ?, ?)'
        )
        .run(`${interaction.guildId}:${interaction.user.id}`, interaction.guildId, interaction.user.id, reason, new Date().toISOString());
      await interaction.reply({
        embeds: [createMonochromeEmbed({ title: 'AFK Enabled', description: `${interaction.user.username} is now AFK: **${reason}**` })],
      });
    },
  },
  {
    name: 'remind',
    category: 'utility',
    data: new SlashCommandBuilder()
      .setName('remind')
      .setDescription('Schedule a personal reminder')
      .addIntegerOption((o) => o.setName('minutes').setDescription('Delay in minutes').setRequired(true).setMinValue(1).setMaxValue(43200))
      .addStringOption((o) => o.setName('message').setDescription('Reminder text').setRequired(true)),
    async execute(interaction, ctx) {
      const minutes = interaction.options.getInteger('minutes', true);
      const message = interaction.options.getString('message', true);
      const remindAt = new Date(Date.now() + minutes * 60_000).toISOString();
      ctx.db.sqlite
        .prepare(
          'INSERT INTO reminders (id, user_id, guild_id, channel_id, message, remind_at, sent, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
        )
        .run(
          crypto.randomUUID(),
          interaction.user.id,
          interaction.guildId,
          interaction.channelId,
          message,
          remindAt,
          new Date().toISOString()
        );
      await interaction.reply({
        ephemeral: true,
        embeds: [createMonochromeEmbed({ title: 'Reminder Scheduled', description: `I will remind you in **${minutes} minute(s)**: ${message}` })],
      });
    },
  },
  {
    name: 'serverinfo',
    category: 'utility',
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('Display server information'),
    async execute(interaction) {
      if (!interaction.guild) return;
      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: interaction.guild.name,
            description: `Server ID: \`${interaction.guild.id}\``,
          }).addFields(
            { name: 'Members', value: String(interaction.guild.memberCount), inline: true },
            { name: 'Channels', value: String(interaction.guild.channels.cache.size), inline: true },
            { name: 'Roles', value: String(interaction.guild.roles.cache.size), inline: true }
          ),
        ],
      });
    },
  },
  {
    name: 'userinfo',
    category: 'utility',
    data: new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Display member details')
      .addUserOption((o) => o.setName('user').setDescription('Target member')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: user.username,
            description: `Discord ID: \`${user.id}\`\nCreated: <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
          }).setThumbnail(user.displayAvatarURL()),
        ],
      });
    },
  },
  {
    name: 'avatar',
    category: 'utility',
    data: new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('Show a user’s full-size avatar')
      .addUserOption((o) => o.setName('user').setDescription('Target user')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      await interaction.reply({
        embeds: [createMonochromeEmbed({ title: `${user.username}'s Avatar` }).setImage(user.displayAvatarURL({ size: 1024 }))],
      });
    },
  },
  {
    name: 'roleinfo',
    category: 'utility',
    data: new SlashCommandBuilder()
      .setName('roleinfo')
      .setDescription('Inspect role permissions and metadata')
      .addRoleOption((o) => o.setName('role').setDescription('Target role').setRequired(true)),
    async execute(interaction) {
      const role = interaction.options.getRole('role', true);
      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: `Role · ${role.name}`,
            description: `ID: \`${role.id}\` · Position: **${role.position}**`,
          }),
        ],
      });
    },
  },
  {
    name: 'poll',
    category: 'community',
    data: new SlashCommandBuilder()
      .setName('poll')
      .setDescription('Create a timed community poll')
      .addSubcommand((s) =>
        s
          .setName('create')
          .setDescription('Create a new poll')
          .addStringOption((o) => o.setName('question').setDescription('Poll question').setRequired(true))
          .addStringOption((o) => o.setName('options').setDescription('Comma-separated options (2-6)').setRequired(true))
          .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes').setMinValue(1).setMaxValue(10080))
          .addBooleanOption((o) => o.setName('multiple').setDescription('Allow multiple choices'))
      ),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const question = interaction.options.getString('question', true);
      const rawOptions = interaction.options.getString('options', true).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
      const minutes = interaction.options.getInteger('minutes') || 60;
      const allowMultiple = interaction.options.getBoolean('multiple') || false;

      const poll = ctx.db.createPoll(interaction.guildId, {
        channelId: interaction.channelId,
        creatorId: interaction.user.id,
        question,
        options: rawOptions.length >= 2 ? rawOptions : ['Yes', 'No'],
        allowMultiple,
        durationMinutes: minutes,
      });

      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: `Poll · ${poll.question}`,
            description: poll.options.map((opt, idx) => `**${idx + 1}.** ${opt}`).join('\n'),
            footerText: `Closes in ${minutes}m · ID ${poll.id.slice(0, 8)}`,
          }),
        ],
      });
    },
  },
  {
    name: 'suggest',
    category: 'community',
    data: new SlashCommandBuilder()
      .setName('suggest')
      .setDescription('Submit a community suggestion')
      .addStringOption((o) => o.setName('idea').setDescription('Your suggestion').setRequired(true)),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const idea = interaction.options.getString('idea', true);
      const s = ctx.db.createSuggestion(interaction.guildId, interaction.user.id, idea);
      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: 'Suggestion Submitted',
            description: s.content,
            footerText: `Status: ${s.status} · ID ${s.id.slice(0, 8)}`,
          }),
        ],
      });
    },
  },
  {
    name: 'ticket',
    category: 'community',
    data: new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Create or manage support tickets')
      .addSubcommand((s) =>
        s
          .setName('create')
          .setDescription('Open a private support ticket')
          .addStringOption((o) => o.setName('subject').setDescription('Short subject').setRequired(true))
          .addStringOption((o) =>
            o
              .setName('category')
              .setDescription('Ticket category')
              .addChoices(...TICKET_CATEGORIES.map((c) => ({ name: c.replace(/_/g, ' '), value: c })))
          )
      ),
    async execute(interaction, ctx) {
      if (!interaction.guildId || !interaction.guild) return;
      const subject = interaction.options.getString('subject', true);
      const category = (interaction.options.getString('category') as TicketCategory | null) || 'GENERAL_SUPPORT';
      const settings = ctx.db.getGuildSettings(interaction.guildId).communityConfig;

      const createdChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username.toLowerCase().slice(0, 12)}-${Math.floor(Math.random() * 900 + 100)}`,
        type: ChannelType.GuildText,
        parent: settings.ticketsCategoryId || undefined,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ],
      });

      const ticket = ctx.db.createTicket(interaction.guildId, {
        channelId: createdChannel.id,
        userId: interaction.user.id,
        category,
        subject,
      });

      await createdChannel.send({
        embeds: [
          createMonochromeEmbed({
            title: `Ticket · ${category.replace(/_/g, ' ')}`,
            description: `Opened by <@${interaction.user.id}>\nSubject: **${subject}**`,
            footerText: `Ticket ID: ${ticket.id}`,
          }),
        ],
      });

      await interaction.reply({
        ephemeral: true,
        embeds: [createMonochromeEmbed({ title: 'Ticket Created', description: `Your ticket is open at <#${createdChannel.id}>.` })],
      });
    },
  },
  {
    name: 'giveaway',
    category: 'community',
    requiredPermissions: [PermissionFlagsBits.ManageGuild],
    data: new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Manage community giveaways')
      .addSubcommand((s) =>
        s
          .setName('start')
          .setDescription('Start a new giveaway')
          .addStringOption((o) => o.setName('prize').setDescription('Giveaway prize').setRequired(true))
          .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1).setMaxValue(20))
          .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(43200))
      ),
    async execute(interaction, ctx) {
      if (!interaction.guildId) return;
      const prize = interaction.options.getString('prize', true);
      const winners = interaction.options.getInteger('winners', true);
      const minutes = interaction.options.getInteger('minutes', true);
      const gw = ctx.db.createGiveaway(interaction.guildId, {
        channelId: interaction.channelId,
        hostId: interaction.user.id,
        prize,
        winnerCount: winners,
        durationMinutes: minutes,
      });
      await interaction.reply({
        embeds: [
          createMonochromeEmbed({
            title: `Giveaway · ${gw.prize}`,
            description: `Hosted by <@${interaction.user.id}> · **${gw.winnerCount}** winner(s) · Ends in **${minutes}m**.`,
            footerText: `Giveaway ID: ${gw.id.slice(0, 8)}`,
          }),
        ],
      });
    },
  },
];
