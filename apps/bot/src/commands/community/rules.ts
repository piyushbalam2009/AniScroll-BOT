import { SlashCommandBuilder } from 'discord.js';
import { createMonochromeEmbed } from '../../../../../packages/discord-ui/src';
import { BotSlashCommand } from '../types';

const RULES_TEXT = `👋 Welcome to AniScroll! We're glad to have you here. Whether you're here to talk about anime, share memes, discover new shows, or just hang out, we want everyone to feel comfortable and welcome.

To keep things that way, please take a moment to read and follow these rules.

**🤝 01 — Respect Everyone**
We're all here to enjoy the community, so please treat each other with respect. Harassment, bullying, discrimination, and personal attacks have no place here.

**🚫 02 — No Spam**
Please don't flood chats with repeated messages, emojis, mentions, links, or advertisements. Keep the conversations enjoyable for everyone.

**💬 03 — Keep Discussions Appropriate**
Make sure your conversations and shared content are suitable for the community. Everyone is also expected to follow Discord's Terms of Service and Community Guidelines.

**🔞 04 — No NSFW Content**
AniScroll is a community for everyone, so keep things safe and appropriate. NSFW images, videos, links, explicit content, and sexually suggestive material are not allowed anywhere in the server.

**📌 05 — Use the Correct Channels**
We've created different channels for a reason! Keep anime discussions, memes, support questions, and suggestions in their respective channels so everything stays organised.

**⚠️ 06 — Mark Spoilers**
Nobody likes having a major plot twist ruined! Please use Discord's spoiler formatting when discussing important events, character deaths, or major story reveals. For unrestricted spoiler discussions, use the designated spoiler channel.

**📢 07 — No Unsolicited Promotion**
Please don't advertise other websites, Discord servers, or services without getting permission from the staff first.

**🔗 08 — No Malicious Links**
Phishing links, scams, malware, suspicious downloads, and anything that could put another member at risk are strictly prohibited.

**🎭 09 — No Impersonation**
Don't pretend to be an AniScroll developer, moderator, staff member, or another community member. Be yourself!

**🛡️ 10 — Follow Staff Instructions**
Our moderators are here to keep the community safe and welcoming. Please cooperate with them and follow their instructions. If you have an issue, reach out to the staff team respectfully.

### ⚖️ RULE ENFORCEMENT
We understand that mistakes happen, but repeated or serious rule violations may lead to action. Depending on the situation, this could mean a warning, message deletion, timeout, kick, or permanent ban.

By being part of AniScroll, you're agreeing to follow these rules and help us maintain a friendly community.

**🖤 Thanks for being here and making AniScroll a great place for anime fans. Enjoy your stay! 🎌**`;

export const rulesCommand: BotSlashCommand = {
  name: 'rules',
  category: 'community',
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('View the official AniScroll community rules'),
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const embed = createMonochromeEmbed({
      title: '🖤 ANISCROLL COMMUNITY RULES',
      description: RULES_TEXT,
      footerText: 'AniScroll Community • Please follow the rules',
      color: 0x111111,
    });

    await interaction.reply({
      embeds: [embed],
    });
  },
};
