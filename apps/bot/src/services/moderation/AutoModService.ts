import { AutomodConfig } from '../../../../../packages/shared/src';

export interface AutoModMessageInput {
  guildId: string;
  channelId: string;
  userId: string;
  roleIds: string[];
  content: string;
  mentionCount: number;
  attachmentNames?: string[];
  timestampMs?: number;
}

export interface AutoModEvaluationResult {
  violated: boolean;
  reasons: string[];
  severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  recommendedAction: 'NONE' | 'DELETE_WARN' | 'DELETE_TIMEOUT' | 'ESCALATE';
}

const KNOWN_PHISHING_DOMAINS = [
  'discord-nitro-free.com',
  'steamcommunlty.com',
  'dlscord.com',
  'discordgift.site',
  'nitro-airdrop.xyz',
];

export class AutoModService {
  private recentMessages = new Map<string, Array<{ content: string; ts: number }>>();
  private recentJoins = new Map<string, number[]>();

  public evaluateMessage(
    input: AutoModMessageInput,
    config: AutomodConfig
  ): AutoModEvaluationResult {
    if (!config.enabled) {
      return { violated: false, reasons: [], severity: 'NONE', recommendedAction: 'NONE' };
    }
    if (config.ignoredChannelIds.includes(input.channelId)) {
      return { violated: false, reasons: [], severity: 'NONE', recommendedAction: 'NONE' };
    }
    if (input.roleIds.some((r) => config.ignoredRoleIds.includes(r))) {
      return { violated: false, reasons: [], severity: 'NONE', recommendedAction: 'NONE' };
    }

    const now = input.timestampMs ?? Date.now();
    const reasons: string[] = [];
    let severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' = 'NONE';
    const rank: Record<'NONE' | 'LOW' | 'MEDIUM' | 'HIGH', number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
    const escalateSeverity = (next: 'LOW' | 'MEDIUM' | 'HIGH') => {
      if (rank[next] > rank[severity]) severity = next;
    };

    const userBucketKey = `${input.guildId}:${input.userId}`;
    const history = (this.recentMessages.get(userBucketKey) || []).filter(
      (m) => now - m.ts <= config.spamWindowSeconds * 1000
    );
    const normalizedContent = input.content.trim().toLowerCase();

    if (config.antiSpam && history.length + 1 >= config.spamThreshold) {
      reasons.push(`Anti-spam threshold exceeded (${history.length + 1} msgs/${config.spamWindowSeconds}s)`);
      escalateSeverity('MEDIUM');
    }

    if (
      config.duplicateDetection &&
      normalizedContent.length >= 6 &&
      history.filter((m) => m.content === normalizedContent).length >= 2
    ) {
      reasons.push('Duplicate message spam detected');
      escalateSeverity('MEDIUM');
    }

    history.push({ content: normalizedContent, ts: now });
    this.recentMessages.set(userBucketKey, history.slice(-15));

    if (input.mentionCount > config.maxMentions) {
      reasons.push(`Excessive mentions (${input.mentionCount} > ${config.maxMentions})`);
      escalateSeverity('HIGH');
    }

    if (config.blockDiscordInvites) {
      const inviteRegex = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-zA-Z0-9-]+/i;
      if (inviteRegex.test(input.content)) {
        const allowlisted = config.linkAllowlist.some((d) =>
          input.content.toLowerCase().includes(d.toLowerCase())
        );
        if (!allowlisted) {
          reasons.push('Unapproved Discord invite link');
          escalateSeverity('MEDIUM');
        }
      }
    }

    if (config.phishingFilter) {
      const urls = input.content.match(/https?:\/\/([^\s/]+)/gi) || [];
      for (const rawUrl of urls) {
        const host = rawUrl.replace(/^https?:\/\//i, '').toLowerCase();
        const isAllowlisted = config.linkAllowlist.some((d) => host === d || host.endsWith(`.${d}`));
        if (!isAllowlisted && KNOWN_PHISHING_DOMAINS.some((bad) => host.includes(bad))) {
          reasons.push(`Suspicious phishing domain (${host})`);
          escalateSeverity('HIGH');
        }
      }
    }

    if (config.blockedWords.length > 0) {
      const lower = input.content.toLowerCase();
      const hit = config.blockedWords.find((w) => w.trim() && lower.includes(w.trim().toLowerCase()));
      if (hit) {
        reasons.push('Contains blocked word or phrase');
        escalateSeverity('LOW');
      }
    }

    const letters = input.content.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 12) {
      const upper = letters.replace(/[^A-Z]/g, '').length;
      const pct = Math.round((upper / letters.length) * 100);
      if (pct >= config.excessiveCapsPercent) {
        reasons.push(`Excessive uppercase (${pct}% >= ${config.excessiveCapsPercent}%)`);
        escalateSeverity('LOW');
      }
    }

    if (config.floodDetection && (input.content.length > 1600 || input.content.split('\n').length > 22)) {
      reasons.push('Message flood / excessive line breaks');
      escalateSeverity('MEDIUM');
    }

    if (config.attachmentRestrictions && input.attachmentNames?.length) {
      const badFile = input.attachmentNames.find((name) =>
        config.blockedExtensions.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase()))
      );
      if (badFile) {
        reasons.push(`Disallowed attachment type (${badFile})`);
        escalateSeverity('HIGH');
      }
    }

    if (reasons.length === 0) {
      return { violated: false, reasons: [], severity: 'NONE', recommendedAction: 'NONE' };
    }

    const currentSeverity = severity as 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
    const recommendedAction =
      currentSeverity === 'HIGH' && config.punishmentMode === 'ESCALATE'
        ? 'ESCALATE'
        : config.punishmentMode;

    return { violated: true, reasons, severity: currentSeverity, recommendedAction };
  }

  public evaluateMemberJoin(
    guildId: string,
    accountCreatedAtMs: number,
    config: AutomodConfig,
    nowMs: number = Date.now()
  ): { raidTriggered: boolean; suspiciousAccount: boolean; reason: string | null } {
    if (!config.enabled) {
      return { raidTriggered: false, suspiciousAccount: false, reason: null };
    }
    const windowMs = 30_000;
    const joins = (this.recentJoins.get(guildId) || []).filter((ts) => nowMs - ts <= windowMs);
    joins.push(nowMs);
    this.recentJoins.set(guildId, joins);

    const raidTriggered = config.raidDetection && joins.length >= config.raidJoinThreshold;
    const accountAgeHours = (nowMs - accountCreatedAtMs) / 3_600_000;
    const suspiciousAccount =
      config.suspiciousAccountAgeHours > 0 && accountAgeHours < config.suspiciousAccountAgeHours;

    let reason: string | null = null;
    if (raidTriggered) {
      reason = `Raid alert: ${joins.length} joins in 30 seconds`;
    } else if (suspiciousAccount) {
      reason = `New account (${accountAgeHours.toFixed(1)}h old < ${config.suspiciousAccountAgeHours}h threshold)`;
    }
    return { raidTriggered, suspiciousAccount, reason };
  }
}
