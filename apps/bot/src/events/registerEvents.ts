import { Client, Events, GuildMember, Message, TextChannel } from 'discord.js';
import { createModuleLogger } from '../../../../packages/shared/src';
import { createMonochromeEmbed } from '../../../../packages/discord-ui/src';
import { BotCommandContext, BotSlashCommand } from '../commands';
import { AutoModService } from '../services/moderation/AutoModService';
import { handleInteraction } from '../interactions/router';
import { dispatchWelcomeMessage } from '../services/welcome/WelcomeService';

const log = createModuleLogger('DiscordEvents');
const registeredClients = new WeakSet<Client>();

export function registerDiscordEvents(
  client: Client,
  commands: Map<string, BotSlashCommand>,
  ctx: BotCommandContext
) {
  if (registeredClients.has(client)) {
    log.warn('Skipping duplicate Discord event registration for client instance');
    return;
  }
  registeredClients.add(client);

  const automod = new AutoModService();

  client.on(Events.InteractionCreate, async (interaction) => {
    await handleInteraction(interaction, commands, ctx);
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    ctx.musicService.handleVoiceStateUpdate(oldState, newState);
  });

  client.on(Events.GuildCreate, (guild) => {
    ctx.db.ensureGuild({
      discordGuildId: guild.id,
      name: guild.name,
      icon: guild.icon,
      memberCount: guild.memberCount,
      botInstalled: true,
    });
    log.info({ guildId: guild.id, name: guild.name }, 'Joined guild');
  });

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    log.info(
      {
        event: Events.GuildMemberAdd,
        guildId: member.guild?.id ?? null,
        guildName: member.guild?.name ?? null,
        memberId: member.id,
        username: member.user?.username ?? null,
        isBot: Boolean(member.user?.bot),
      },
      'Received Discord guildMemberAdd event'
    );

    if (member.user?.bot || !member.guild) {
      log.info(
        {
          event: Events.GuildMemberAdd,
          guildId: member.guild?.id ?? null,
          memberId: member.id,
          isBot: Boolean(member.user?.bot),
        },
        'Ignoring guildMemberAdd event for bot account or missing guild'
      );
      return;
    }

    try {
      ctx.db.ensureGuild({
        discordGuildId: member.guild.id,
        name: member.guild.name,
        memberCount: member.guild.memberCount,
      });
      const settings = ctx.db.getGuildSettings(member.guild.id);

      log.info(
        {
          event: Events.GuildMemberAdd,
          guildId: member.guild.id,
          memberId: member.id,
          welcomeEnabled: settings.welcomeConfig.enabled,
          welcomeChannelId: settings.welcomeConfig.channelId,
        },
        'Loaded guild settings for guildMemberAdd'
      );

      const joinEval = automod.evaluateMemberJoin(
        member.guild.id,
        member.user.createdTimestamp,
        settings.automodConfig
      );
      if (joinEval.raidTriggered || joinEval.suspiciousAccount) {
        const modLogId =
          settings.loggingConfig.moderationLogChannelId || settings.moderationConfig.modLogChannelId;
        if (modLogId) {
          const ch = await member.guild.channels.fetch(modLogId).catch(() => null);
          if (ch && ch.isTextBased()) {
            await (ch as TextChannel)
              .send({
                embeds: [
                  createMonochromeEmbed({
                    title: 'Security Alert',
                    description: `<@${member.id}> (${member.user.tag}): ${joinEval.reason}`,
                  }),
                ],
              })
              .catch(() => undefined);
          }
        }
      }

      if (settings.welcomeConfig.enabled && settings.welcomeConfig.channelId) {
        await dispatchWelcomeMessage({
          guild: member.guild,
          member,
          db: ctx.db,
          isTest: false,
        }).catch((err) => {
          log.warn(
            {
              guildId: member.guild.id,
              userId: member.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'Handled welcome message dispatch failure safely'
          );
        });
      } else {
        log.info(
          {
            guildId: member.guild.id,
            userId: member.id,
            welcomeEnabled: settings.welcomeConfig.enabled,
            welcomeChannelId: settings.welcomeConfig.channelId,
          },
          'Welcome message not dispatched on member join (disabled or channel unset)'
        );
      }
    } catch (err) {
      log.error(
        {
          guildId: member.guild?.id,
          userId: member.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'Unexpected error in GuildMemberAdd handler'
      );
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const settings = ctx.db.getGuildSettings(member.guild.id);
    if (settings.welcomeConfig.farewellEnabled && settings.welcomeConfig.farewellChannelId) {
      const ch = await member.guild.channels.fetch(settings.welcomeConfig.farewellChannelId).catch(() => null);
      if (ch && ch.isTextBased()) {
        const msg = settings.welcomeConfig.farewellTemplate
          .replace(/\{username\}/g, member.user.username)
          .replace(/\{server\}/g, member.guild.name)
          .replace(/\{memberCount\}/g, String(member.guild.memberCount));
        await (ch as TextChannel).send(msg).catch(() => undefined);
      }
    }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.guildId || !message.guild) return;

    const settings = ctx.db.getGuildSettings(message.guildId);
    const memberRoleIds = message.member?.roles.cache.map((r) => r.id) || [];

    // 1. AutoMod Evaluation
    const evalResult = automod.evaluateMessage(
      {
        guildId: message.guildId,
        channelId: message.channelId,
        userId: message.author.id,
        roleIds: memberRoleIds,
        content: message.content,
        mentionCount: message.mentions.users.size + message.mentions.roles.size,
        attachmentNames: message.attachments.map((a) => a.name || ''),
      },
      settings.automodConfig
    );

    if (evalResult.violated) {
      await message.delete().catch(() => undefined);
      ctx.db.createModerationCase(message.guildId, {
        targetUserId: message.author.id,
        moderatorId: client.user?.id || 'automod',
        action: evalResult.recommendedAction === 'DELETE_TIMEOUT' ? 'AUTOMOD_TIMEOUT' : 'AUTOMOD_DELETE',
        reason: evalResult.reasons.join('; '),
      });
      if (evalResult.recommendedAction === 'DELETE_TIMEOUT' && message.member?.moderatable) {
        await message.member
          .timeout(settings.automodConfig.timeoutMinutes * 60_000, 'AutoMod violation')
          .catch(() => undefined);
      }
      return;
    }

    // 2. Clear AFK if author speaks
    ctx.db.sqlite
      .prepare('DELETE FROM afk_statuses WHERE guild_id = ? AND user_id = ?')
      .run(message.guildId, message.author.id);

    // 3. Leveling XP with cooldown
    if (settings.communityConfig.levelingEnabled && message.content.length >= 6) {
      const xpGate = await ctx.cache.checkRateLimit(
        `xp:${message.guildId}:${message.author.id}`,
        1,
        settings.communityConfig.xpCooldownSeconds
      );
      if (xpGate.allowed) {
        ctx.db.addXp(message.author.id, message.author.username, settings.communityConfig.xpPerMessage);
      }
    }
  });

  log.info(
    {
      guildMemberAddEvent: Events.GuildMemberAdd,
      guildMemberAddListeners: client.listenerCount(Events.GuildMemberAdd),
      guildCreateListeners: client.listenerCount(Events.GuildCreate),
      interactionCreateListeners: client.listenerCount(Events.InteractionCreate),
    },
    'Registered Discord event listeners'
  );
}
