import { Client, TextChannel } from 'discord.js';
import { getDatabase } from '../../../../../packages/database/src';
import { createModuleLogger } from '../../../../../packages/shared/src';
import { createMonochromeEmbed, createAnimeEmbed } from '../../../../../packages/discord-ui/src';
import { getAnimeServices } from '../hoshika';

const log = createModuleLogger('SchedulerService');

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private recentAotdIds = new Set<number>();

  public start(client?: Client) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick(client).catch((err) => log.warn({ err: String(err) }, 'Scheduler tick error'));
    }, 30_000);
    this.timer.unref();
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async tick(client?: Client) {
    const db = getDatabase();
    const nowIso = new Date().toISOString();

    // 1. Auto-close expired polls
    const expiredPolls = db.sqlite
      .prepare('SELECT id, guild_id, channel_id, question FROM polls WHERE closed = 0 AND ends_at <= ?')
      .all(nowIso) as Array<{ id: string; guild_id: string; channel_id: string; question: string }>;
    for (const poll of expiredPolls) {
      db.sqlite.prepare('UPDATE polls SET closed = 1 WHERE id = ?').run(poll.id);
      if (client) {
        const ch = await client.channels.fetch(poll.channel_id).catch(() => null);
        if (ch && ch.isTextBased()) {
          await (ch as TextChannel)
            .send({
              embeds: [
                createMonochromeEmbed({
                  title: 'Poll Closed',
                  description: `**${poll.question}** has ended. Check the dashboard or message for final results.`,
                }),
              ],
            })
            .catch(() => undefined);
        }
      }
    }

    // 2. Auto-draw expired giveaways
    const expiredGiveaways = db.sqlite
      .prepare('SELECT id, channel_id, prize FROM giveaways WHERE ended = 0 AND ends_at <= ?')
      .all(nowIso) as Array<{ id: string; channel_id: string; prize: string }>;
    for (const gw of expiredGiveaways) {
      const drawn = db.drawGiveawayWinners(gw.id);
      if (client) {
        const ch = await client.channels.fetch(gw.channel_id).catch(() => null);
        if (ch && ch.isTextBased()) {
          const winnersText =
            drawn.winnerIds.length > 0
              ? drawn.winnerIds.map((id) => `<@${id}>`).join(', ')
              : 'No eligible entrants.';
          await (ch as TextChannel)
            .send({
              embeds: [
                createMonochromeEmbed({
                  title: `Giveaway Ended · ${gw.prize}`,
                  description: `Winners: ${winnersText}`,
                }),
              ],
            })
            .catch(() => undefined);
        }
      }
    }

    // 3. Dispatch due reminders
    const dueReminders = db.sqlite
      .prepare('SELECT * FROM reminders WHERE sent = 0 AND remind_at <= ?')
      .all(nowIso) as Array<{ id: string; user_id: string; channel_id: string; message: string }>;
    for (const r of dueReminders) {
      db.sqlite.prepare('UPDATE reminders SET sent = 1 WHERE id = ?').run(r.id);
      if (client) {
        const ch = await client.channels.fetch(r.channel_id).catch(() => null);
        if (ch && ch.isTextBased()) {
          await (ch as TextChannel)
            .send({
              content: `<@${r.user_id}>`,
              embeds: [
                createMonochromeEmbed({
                  title: 'Reminder',
                  description: r.message,
                }),
              ],
            })
            .catch(() => undefined);
        }
      }
    }

    // 4. Expire temporary moderation cases
    db.sqlite
      .prepare('UPDATE moderation_cases SET active = 0 WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?')
      .run(nowIso);
  }

  public async pickAnimeOfTheDay() {
    const { animeService } = getAnimeServices();
    const { items } = await animeService.getTrending('trending', 'en');
    const candidate = items.find((a) => !a.shortId || !this.recentAotdIds.has(a.shortId)) || items[0];
    if (!candidate) return null;
    if (candidate.shortId) {
      this.recentAotdIds.add(candidate.shortId);
      if (this.recentAotdIds.size > 30) {
        const first = this.recentAotdIds.values().next().value;
        if (first !== undefined) this.recentAotdIds.delete(first);
      }
    }
    const hydrated = await animeService.hydrateAnimeItem(candidate, 'en');
    return createAnimeEmbed(hydrated.anime, {
      aniscrollUrl: animeService.linkService.buildUrl(hydrated.anime.shortId),
      detailsFetchError: hydrated.detailsError,
    });
  }
}
