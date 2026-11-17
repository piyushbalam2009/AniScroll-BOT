import { Client } from 'discord.js';
import { getDatabase } from '../../../../../packages/database/src';
import { appConfig, createModuleLogger } from '../../../../../packages/shared/src';
import { createMonochromeEmbed } from '../../../../../packages/discord-ui/src';

const log = createModuleLogger('StatusMonitorService');

export class StatusMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  public start(client?: Client | null) {
    if (this.isRunning) return;
    if (!appConfig.ANISCROLL_STATUS_MONITOR_ENABLED) {
      log.info('Status monitor is disabled by configuration.');
      return;
    }
    this.isRunning = true;
    const intervalMs = (appConfig.ANISCROLL_STATUS_CHECK_INTERVAL || 60) * 1000;

    log.info({ intervalSeconds: appConfig.ANISCROLL_STATUS_CHECK_INTERVAL }, 'Starting AniScroll status monitor service');

    // Run initial check after 5 seconds
    setTimeout(() => {
      this.checkAll(client).catch((err) => log.error({ err }, 'Error in initial status check'));
    }, 5000);

    this.timer = setInterval(() => {
      this.checkAll(client).catch((err) => log.error({ err }, 'Error in periodic status check'));
    }, intervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    log.info('Stopped status monitor service');
  }

  public async checkAll(client?: Client | null) {
    const db = getDatabase();
    const timeout = appConfig.ANISCROLL_STATUS_TIMEOUT || 10000;

    // 1. AniScroll Website
    await this.checkHttpService(db, 'website', 'AniScroll Website', appConfig.ANISCROLL_WEBSITE_URL, timeout, client);

    // 2. Streaming API
    await this.checkHttpService(db, 'streaming_api', 'Streaming API', appConfig.ANISCROLL_STREAMING_API_URL, timeout, client);

    // 3. Hoshika Metadata API
    await this.checkHttpService(db, 'hoshika_api', 'Hoshika Metadata API', `${appConfig.HOSHIKA_BASE_URL.replace(/\/+$/, '')}/health`, timeout, client);

    // 4. Discord Bot Gateway
    this.checkDiscordBot(db, client);

    // 5. Lavalink Music Node
    const lavalinkProtocol = appConfig.LAVALINK_SECURE ? 'https' : 'http';
    const lavalinkUrl = `${lavalinkProtocol}://${appConfig.LAVALINK_HOST}:${appConfig.LAVALINK_PORT}/version`;
    await this.checkHttpServiceWithAuth(
      db,
      'lavalink',
      'Lavalink Music Node',
      lavalinkUrl,
      appConfig.LAVALINK_PASSWORD,
      timeout,
      client
    );
  }

  private async checkHttpService(
    db: ReturnType<typeof getDatabase>,
    key: string,
    name: string,
    url: string,
    timeout: number,
    client?: Client | null
  ) {
    const start = Date.now();
    let status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' = 'ONLINE';
    let errorMessage: string | null = null;
    let responseTimeMs = 0;

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'AniScrollStatusBot/1.0' } });
      clearTimeout(id);
      responseTimeMs = Date.now() - start;

      if (!res.ok && res.status >= 500) {
        status = 'OFFLINE';
        errorMessage = `HTTP ${res.status}: ${res.statusText}`;
      } else if (!res.ok) {
        status = 'DEGRADED';
        errorMessage = `HTTP ${res.status}: ${res.statusText}`;
      } else if (responseTimeMs > 4000) {
        status = 'DEGRADED';
        errorMessage = `High latency (${responseTimeMs}ms)`;
      }
    } catch (err) {
      responseTimeMs = Date.now() - start;
      status = 'OFFLINE';
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    const statuses = db.getServiceStatuses();
    const existing = statuses.find((s) => s.serviceKey === key);
    const prevStatus = existing ? existing.status : 'ONLINE';

    // If under active maintenance, preserve MAINTENANCE status
    if (existing?.status === 'MAINTENANCE') {
      return;
    }

    db.updateServiceStatus(key, name, status, responseTimeMs, { url }, errorMessage);

    if (prevStatus !== status && client && (status === 'OFFLINE' || status === 'DEGRADED' || prevStatus === 'OFFLINE')) {
      await this.broadcastStatusAlert(client, key, name, prevStatus, status, errorMessage);
    }
  }

  private async checkHttpServiceWithAuth(
    db: ReturnType<typeof getDatabase>,
    key: string,
    name: string,
    url: string,
    authToken: string,
    timeout: number,
    client?: Client | null
  ) {
    const start = Date.now();
    let status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' = 'ONLINE';
    let errorMessage: string | null = null;
    let responseTimeMs = 0;

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'AniScrollStatusBot/1.0',
          Authorization: authToken,
        },
      });
      clearTimeout(id);
      responseTimeMs = Date.now() - start;

      if (!res.ok) {
        status = res.status === 401 ? 'DEGRADED' : 'OFFLINE';
        errorMessage = `HTTP ${res.status}: ${res.statusText}`;
      } else if (responseTimeMs > 4000) {
        status = 'DEGRADED';
        errorMessage = `High latency (${responseTimeMs}ms)`;
      }
    } catch (err) {
      responseTimeMs = Date.now() - start;
      status = 'OFFLINE';
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    const statuses = db.getServiceStatuses();
    const existing = statuses.find((s) => s.serviceKey === key);
    const prevStatus = existing ? existing.status : 'ONLINE';

    if (existing?.status === 'MAINTENANCE') {
      return;
    }

    db.updateServiceStatus(key, name, status, responseTimeMs, { url }, errorMessage);

    if (prevStatus !== status && client && (status === 'OFFLINE' || status === 'DEGRADED' || prevStatus === 'OFFLINE')) {
      await this.broadcastStatusAlert(client, key, name, prevStatus, status, errorMessage);
    }
  }

  private checkDiscordBot(db: ReturnType<typeof getDatabase>, client?: Client | null) {
    const key = 'discord_bot';
    const name = 'Discord Gateway';
    let status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' = 'ONLINE';
    let ping = client?.ws.ping ?? 0;
    let errorMessage: string | null = null;

    if (!client || client.ws.status !== 0) {
      status = 'OFFLINE';
      errorMessage = `Gateway status code: ${client?.ws.status ?? 'disconnected'}`;
    } else if (ping > 500) {
      status = 'DEGRADED';
      errorMessage = `High WS ping (${ping}ms)`;
    }

    const statuses = db.getServiceStatuses();
    const existing = statuses.find((s) => s.serviceKey === key);
    const prevStatus = existing ? existing.status : 'ONLINE';

    if (existing?.status === 'MAINTENANCE') {
      return;
    }

    db.updateServiceStatus(key, name, status, ping, { wsStatus: client?.ws.status }, errorMessage);

    if (prevStatus !== status && client && (status === 'OFFLINE' || prevStatus === 'OFFLINE')) {
      this.broadcastStatusAlert(client, key, name, prevStatus, status, errorMessage).catch(() => undefined);
    }
  }

  private async broadcastStatusAlert(
    client: Client,
    serviceKey: string,
    serviceName: string,
    oldStatus: string,
    newStatus: string,
    errorMessage?: string | null
  ) {
    const db = getDatabase();
    const guilds = client.guilds.cache.values();

    for (const g of guilds) {
      try {
        const config = db.getStatusConfig(g.id);
        if (!config.statusChannelId) continue;
        const channel = await g.channels.fetch(config.statusChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;

        const isRecovery = newStatus === 'ONLINE';
        const emoji = isRecovery ? '🟢' : newStatus === 'DEGRADED' ? '🟡' : '🔴';
        const title = isRecovery ? `Service Recovered: ${serviceName}` : `Service Incident: ${serviceName} is ${newStatus}`;

        const embed = createMonochromeEmbed({
          title: `${emoji} ${title}`,
          description: isRecovery
            ? `**${serviceName}** has recovered and is now fully operational.`
            : `**${serviceName}** status changed from **${oldStatus}** to **${newStatus}**.\n${errorMessage ? `\`\`\`${errorMessage}\`\`\`` : ''}`,
          footerText: 'AniScroll Status Monitor',
        });

        const pingRole = config.pingRoleId ? `<@&${config.pingRoleId}>` : '';
        await channel.send({ content: pingRole, embeds: [embed] }).catch(() => undefined);
      } catch {
        // Ignore guild notification errors
      }
    }
  }
}

let sharedMonitor: StatusMonitorService | null = null;
export function getStatusMonitorService(): StatusMonitorService {
  if (!sharedMonitor) sharedMonitor = new StatusMonitorService();
  return sharedMonitor;
}
