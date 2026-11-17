import React, { useCallback, useEffect, useState } from 'react';
import { apiRequest, GuildSummary } from '../lib/api';

interface NotificationsPageProps {
  guild: GuildSummary;
  onToast: (msg: string) => void;
}

const ANNOUNCEMENT_TYPES = [
  { value: 'WEBSITE_RELEASE', label: 'Website Release' },
  { value: 'FEATURE_RELEASE', label: 'Feature Release' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'SERVICE_STATUS', label: 'Service Status' },
  { value: 'COMMUNITY_ANNOUNCEMENT', label: 'Community Announcement' },
];

export function NotificationsPage({ guild, onToast }: NotificationsPageProps) {
  const [history, setHistory] = useState<any[]>([]);
  const [type, setType] = useState('COMMUNITY_ANNOUNCEMENT');
  const [channelId, setChannelId] = useState(
    guild.channels.find((c) => c.type === 'text')?.id || ''
  );
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('');

  const load = useCallback(() => {
    apiRequest(`/api/v1/guilds/${guild.discordGuildId}/notifications`)
      .then((res) => setHistory(res.notifications))
      .catch((err) => onToast(err.message));
  }, [guild.discordGuildId, onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim() || !channelId) {
      onToast('Destination channel, title, and message are required.');
      return;
    }
    try {
      await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/notifications`, {
        method: 'POST',
        body: JSON.stringify({ type, destinationChannelId: channelId, title, message, url }),
      });
      setTitle('');
      setMessage('');
      setUrl('');
      onToast('Announcement logged & dispatched.');
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Announcement failed.');
    }
  };

  const selectedChannelObj = guild.channels.find((c) => c.id === channelId);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSend}
          className="lg:col-span-6 bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4"
        >
          <div>
            <h2 className="text-sm font-semibold text-white">Manual Announcement Composer</h2>
            <p className="text-xs text-[#A1A1AA] mt-1">
              Automatic webhook events activate when <code className="text-white font-mono">ANISCROLL_WEBHOOK_SECRET</code> is configured and signed payloads arrive at <code className="text-white font-mono">/api/v1/webhooks/aniscroll</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="notif-type" className="block text-xs text-[#A1A1AA] mb-1.5">
                Category
              </label>
              <select
                id="notif-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
              >
                {ANNOUNCEMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="notif-ch" className="block text-xs text-[#A1A1AA] mb-1.5">
                Destination Channel
              </label>
              <select
                id="notif-ch"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono"
              >
                {guild.channels
                  .filter((c) => c.type === 'text')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="notif-title" className="block text-xs text-[#A1A1AA] mb-1.5">
              Announcement Title
            </label>
            <input
              id="notif-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fall 2026 Schedule Sync Live"
              className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label htmlFor="notif-msg" className="block text-xs text-[#A1A1AA] mb-1.5">
              Message Body
            </label>
            <textarea
              id="notif-msg"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write the announcement content..."
              className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label htmlFor="notif-url" className="block text-xs text-[#A1A1AA] mb-1.5">
              Optional Link URL
            </label>
            <input
              id="notif-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://aniscroll.in"
              className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7]"
          >
            Send Announcement
          </button>
        </form>

        {/* Live Embed Preview */}
        <div className="lg:col-span-6 bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4 lg:sticky lg:top-24">
          <div className="flex items-center justify-between pb-3 border-b border-[#27272A]">
            <h2 className="text-sm font-semibold text-white">Discord Embed Preview</h2>
            <span className="text-xs font-mono text-[#71717A]">
              Target #{selectedChannelObj?.name || 'channel'}
            </span>
          </div>
          <div className="bg-[#18181C] border border-[#27272A] rounded-md p-4 space-y-2 border-l-2 border-l-white">
            <div className="text-xs font-mono text-[#A1A1AA]">{type.replace(/_/g, ' ')}</div>
            <div className="text-base font-semibold text-white">
              {title || 'Announcement Title Preview'}
            </div>
            <p className="text-sm text-[#D4D4D8] whitespace-pre-wrap leading-relaxed">
              {message || 'Your announcement body will appear here in monochrome Discord embed format.'}
            </p>
            {url && (
              <div className="text-xs font-mono text-white underline truncate block">{url}</div>
            )}
            <div className="pt-2 border-t border-[#27272A] text-[11px] text-[#71717A] font-mono">
              AniScroll Announcement · #{selectedChannelObj?.name || 'channel'}
            </div>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Notification History ({history.length})</h2>
        {history.length === 0 ? (
          <p className="text-sm text-[#A1A1AA]">No notifications sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#27272A] text-xs text-[#71717A]">
                  <th className="py-2 pr-4 font-medium">Title</th>
                  <th className="py-2 pr-4 font-medium">Category</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E1E24]">
                {history.map((n) => (
                  <tr key={n.id} className="hover:bg-[#18181C]/60">
                    <td className="py-2.5 pr-4 text-white font-medium">{n.title}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-[#A1A1AA]">{n.type}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs">
                      <span className={n.deliveryStatus === 'DELIVERED' ? 'text-emerald-400' : 'text-amber-400'}>
                        {n.deliveryStatus}
                      </span>
                    </td>
                    <td className="py-2.5 font-mono text-xs text-[#71717A] text-right tabular-nums">
                      {new Date(n.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function AnalyticsPage({ guildId, onToast }: { guildId: string; onToast: (msg: string) => void }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    apiRequest(`/api/v1/guilds/${guildId}/analytics`)
      .then(setData)
      .catch((err) => onToast(err.message));
  }, [guildId, onToast]);

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 bg-[#111114] border border-[#27272A] rounded-lg animate-pulse" />
          <div className="h-64 bg-[#111114] border border-[#27272A] rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  const a = data.analytics;
  const maxCmd = Math.max(1, ...(a.topCommands || []).map((c: any) => c.count));
  const maxGenre = Math.max(1, ...(a.popularGenres || []).map((g: any) => g.count));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Most Used Commands */}
        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Most Used Commands</h2>
          <div className="space-y-3">
            {a.topCommands.length === 0 ? (
              <p className="text-sm text-[#A1A1AA]">No command metrics recorded yet.</p>
            ) : (
              a.topCommands.map((cmd: any) => (
                <div key={cmd.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-white">/{cmd.name}</span>
                    <span className="font-mono text-[#A1A1AA] tabular-nums">{cmd.count}</span>
                  </div>
                  <div className="h-2 bg-[#18181C] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white"
                      style={{ width: `${Math.round((cmd.count / maxCmd) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Popular Genres */}
        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Popular Anime Search Genres</h2>
          <div className="space-y-3">
            {a.popularGenres.length === 0 ? (
              <p className="text-sm text-[#A1A1AA]">No genre search telemetry yet.</p>
            ) : (
              a.popularGenres.map((g: any) => (
                <div key={g.genre} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white">{g.genre}</span>
                    <span className="font-mono text-[#A1A1AA] tabular-nums">{g.count}</span>
                  </div>
                  <div className="h-2 bg-[#18181C] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#A1A1AA]"
                      style={{ width: `${Math.round((g.count / maxGenre) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Top Searched Anime</h2>
          <div className="space-y-2.5">
            {a.topSearches.length === 0 ? (
              <p className="text-xs text-[#A1A1AA]">No search history recorded.</p>
            ) : (
              a.topSearches.map((s: any) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between text-xs py-1.5 border-b border-[#1E1E24] last:border-0"
                >
                  <span className="text-white truncate pr-2">{s.label}</span>
                  <span className="font-mono text-[#A1A1AA] tabular-nums">{s.count}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Moderation Breakdown</h2>
          {a.modBreakdown.length === 0 ? (
            <p className="text-xs text-[#A1A1AA]">No moderation cases in this server.</p>
          ) : (
            <div className="space-y-2.5">
              {a.modBreakdown.map((m: any) => (
                <div
                  key={m.action}
                  className="flex items-center justify-between text-xs py-1.5 border-b border-[#1E1E24] last:border-0"
                >
                  <span className="font-mono text-white">{m.action}</span>
                  <span className="font-mono text-[#A1A1AA] tabular-nums">{m.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Community XP Leaderboard</h2>
          {a.leaderboard.length === 0 ? (
            <p className="text-xs text-[#A1A1AA]">No community members ranked yet.</p>
          ) : (
            <div className="space-y-2.5">
              {a.leaderboard.map((u: any, idx: number) => (
                <div
                  key={u.discordUserId}
                  className="flex items-center justify-between text-xs py-1.5 border-b border-[#1E1E24] last:border-0"
                >
                  <span className="text-white truncate pr-2">
                    {idx + 1}. {u.username}
                  </span>
                  <span className="font-mono text-[#A1A1AA] tabular-nums shrink-0">
                    Lv {u.level} · {u.experiencePoints} XP
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SettingsPage({
  guild,
  session,
  health,
  onToast,
}: {
  guild: GuildSummary;
  session: any;
  health?: any;
  onToast: (msg: string) => void;
}) {
  const [logging, setLogging] = useState<any>(null);

  useEffect(() => {
    apiRequest(`/api/v1/guilds/${guild.discordGuildId}/settings`)
      .then((res) => setLogging(res.settings.loggingConfig))
      .catch((err) => onToast(err.message));
  }, [guild.discordGuildId, onToast]);

  const handleSaveLogging = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/settings/loggingConfig`, {
      method: 'PUT',
      body: JSON.stringify(logging),
    });
    onToast('Logging configuration saved.');
  };

  const handleClearCache = async () => {
    const res = await apiRequest<{ cleared: number }>('/api/v1/admin/cache/clear', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    onToast(`Cleared ${res.cleared} cached entries.`);
  };

  const copyValue = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => undefined);
    onToast(`${label} copied to clipboard.`);
  };

  if (!logging) {
    return (
      <div className="space-y-6">
        <div className="h-48 bg-[#111114] border border-[#27272A] rounded-lg animate-pulse" />
      </div>
    );
  }

  const activeCallbackUrl = session.callbackUrl || health?.oauthCallbackUrl || '';
  const callbackRoute = session.callbackRoute || health?.oauthCallbackRoute || '/auth/callback';
  const redirectWarning = session.redirectUriWarning || health?.redirectUriWarning || null;
  const botInviteUrl = session.botInviteUrl || health?.botInviteUrl || null;

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSaveLogging}
        className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4"
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#27272A]">
          <h2 className="text-sm font-semibold text-white">Audit &amp; Channel Logging</h2>
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={logging.enabled}
              onChange={(e) => setLogging({ ...logging, enabled: e.target.checked })}
              className="accent-white"
            />
            <span>Logging Enabled</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: 'moderationLogChannelId', label: 'Moderation Log Channel' },
            { key: 'messageLogChannelId', label: 'Message Edit/Delete Channel' },
            { key: 'memberLogChannelId', label: 'Member Join/Leave Channel' },
            { key: 'ticketLogChannelId', label: 'Ticket Transcript Channel' },
          ].map((field) => (
            <div key={field.key}>
              <label htmlFor={field.key} className="block text-xs text-[#A1A1AA] mb-1.5">
                {field.label}
              </label>
              <select
                id={field.key}
                value={logging[field.key] || ''}
                onChange={(e) => setLogging({ ...logging, [field.key]: e.target.value || null })}
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
              >
                <option value="">Disabled</option>
                {guild.channels
                  .filter((c) => c.type === 'text')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
              </select>
            </div>
          ))}
        </div>

        <button
          type="submit"
          className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7]"
        >
          Save Logging Settings
        </button>
      </form>

      {/* Discord OAuth2 & Redirect URI Configuration Debug Panel */}
      <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#27272A]">
          <div>
            <h2 className="text-sm font-semibold text-white">Discord OAuth2 &amp; Bot Configuration</h2>
            <p className="text-xs text-[#A1A1AA] mt-1">
              Separated dashboard login (<code className="font-mono text-white">identify guilds</code>) and server bot invite (<code className="font-mono text-white">bot applications.commands</code>) endpoints.
            </p>
          </div>
          <span className="px-2.5 py-1 text-[11px] font-mono border border-[#27272A] bg-[#18181C] rounded text-white">
            {session.oauthConfigured ? 'OAuth2 Ready' : 'Missing Credentials'}
          </span>
        </div>

        {redirectWarning && (
          <div className="p-3 bg-[#18181C] border border-amber-500/40 rounded-md text-xs text-amber-300 leading-relaxed">
            {redirectWarning}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-[#18181C] border border-[#27272A] rounded-md p-3 space-y-1">
            <div className="text-[#A1A1AA]">Callback Route</div>
            <div className="font-mono text-white">{callbackRoute}</div>
          </div>
          <div className="bg-[#18181C] border border-[#27272A] rounded-md p-3 space-y-1">
            <div className="text-[#A1A1AA]">Redirect URI Resolution</div>
            <div className="font-mono text-white">
              {session.redirectUriSource === 'env' ? 'DISCORD_REDIRECT_URI env' : 'APP_URL fallback'}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-[#A1A1AA]">
              Active OAuth2 Redirect URI (register in Discord Portal → OAuth2 → General → Redirects)
            </span>
            {activeCallbackUrl && (
              <button
                type="button"
                onClick={() => copyValue('Redirect URI', activeCallbackUrl)}
                className="px-2.5 py-1 text-[11px] border border-[#27272A] rounded text-white hover:border-white/70"
              >
                Copy URI
              </button>
            )}
          </div>
          <code
            data-testid="admin-redirect-uri"
            className="block p-2.5 bg-black border border-[#27272A] rounded font-mono text-xs text-white break-all select-all"
          >
            {activeCallbackUrl || 'Not resolved'}
          </code>
        </div>

        {botInviteUrl && (
          <div className="space-y-2 pt-2 border-t border-[#27272A]">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[#A1A1AA]">
                Separate Bot Invitation URL (<code className="font-mono text-white">scope=bot applications.commands</code>)
              </span>
              <button
                type="button"
                onClick={() => copyValue('Bot invite URL', botInviteUrl)}
                className="px-2.5 py-1 text-[11px] border border-[#27272A] rounded text-white hover:border-white/70"
              >
                Copy Invite URL
              </button>
            </div>
            <code
              data-testid="admin-bot-invite-uri"
              className="block p-2.5 bg-black border border-[#27272A] rounded font-mono text-[11px] text-[#D4D4D8] break-all select-all"
            >
              {botInviteUrl}
            </code>
          </div>
        )}
      </div>

      <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Cache Maintenance</h2>
          <p className="text-xs text-[#A1A1AA] mt-1">
            Invalidate cached Hoshika search results, anime details, and rate-limit buckets.
          </p>
        </div>
        <button
          type="button"
          onClick={handleClearCache}
          className="px-4 py-2 text-xs font-medium border border-[#27272A] rounded-md hover:border-white/70 whitespace-nowrap"
        >
          Clear Cache
        </button>
      </div>
    </div>
  );
}
