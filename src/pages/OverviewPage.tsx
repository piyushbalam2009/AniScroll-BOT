import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Search,
  Terminal,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatUptime, summarizeModuleReadiness } from '../lib/dashboardUtils';

interface OverviewPageProps {
  guildId: string;
  onNavigate: (path: string) => void;
  onToast: (msg: string) => void;
}

export function OverviewPage({ guildId, onNavigate, onToast }: OverviewPageProps) {
  const [data, setData] = useState<any>(null);
  const [commandsData, setCommandsData] = useState<{ commands?: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditQuery, setAuditQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiRequest(`/api/v1/guilds/${guildId}/overview`),
      apiRequest('/api/v1/discord/commands').catch(() => null),
    ])
      .then(([overviewRes, cmdRes]) => {
        setData(overviewRes);
        if (cmdRes) setCommandsData(cmdRes);
      })
      .catch((err) => onToast(err.message))
      .finally(() => setLoading(false));
  }, [guildId, onToast]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-[#111114] border border-[#27272A] rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-[#111114] border border-[#27272A] rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-[#111114] border border-[#27272A] rounded-lg p-6 text-sm text-[#A1A1AA]">
        Unable to load server overview.
      </div>
    );
  }

  const stats = data.stats;
  const sys = data.system || {};
  const modules = summarizeModuleReadiness(data.settings);
  const topCommands = data.analytics?.topCommands || [];
  const registeredCommands: any[] = commandsData?.commands || [];

  const kpis = [
    {
      label: 'Server Members',
      value: stats.memberCount.toLocaleString(),
      sub: `${stats.recommendationsCount ?? 0} community recommendations`,
    },
    {
      label: 'Commands Executed',
      value: stats.totalCommands.toLocaleString(),
      sub: `${sys.commandCount ?? registeredCommands.length} slash commands registered`,
    },
    {
      label: 'Moderation Cases',
      value: stats.moderationCasesCount.toLocaleString(),
      sub: `${stats.activeWarningsCount} active warnings`,
    },
    {
      label: 'Open Tickets',
      value: stats.openTicketsCount.toLocaleString(),
      sub: `Process uptime ${formatUptime(stats.uptimeSeconds)}`,
    },
  ];

  const filteredEvents = (data.recentEvents || []).filter((ev: any) => {
    const q = auditQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      String(ev.action || '').toLowerCase().includes(q) ||
      String(ev.actorId || '').toLowerCase().includes(q)
    );
  });

  const renderStatusText = (ok: boolean, okLabel: string, badLabel: string) => (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
      <span>{ok ? okLabel : badLabel}</span>
    </span>
  );

  const botReady = sys.botStatus === 'ready';

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-[#111114] border border-[#27272A] rounded-lg p-5">
            <div className="text-xs text-[#A1A1AA]">{k.label}</div>
            <div className="mt-2 text-2xl font-semibold text-white font-mono tabular-nums">
              {k.value}
            </div>
            <div className="mt-1 text-xs text-[#71717A] tabular-nums">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Infrastructure Connectivity + Module Readiness */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-[#111114] border border-[#27272A] rounded-lg p-5">
          <div className="flex items-center justify-between pb-3 border-b border-[#27272A]">
            <h2 className="text-sm font-semibold text-white">Runtime &amp; Gateway Diagnostics</h2>
            <span className="text-xs font-mono text-[#71717A] tabular-nums">
              {sys.pingMs != null ? `${sys.pingMs}ms ping` : 'No ping'}
            </span>
          </div>

          <div className="divide-y divide-[#1E1E24] text-sm">
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-white text-xs font-medium">Discord Gateway</div>
                <div className="text-[11px] text-[#71717A] font-mono">
                  {sys.botTag || 'Bot token inactive'}
                </div>
              </div>
              {renderStatusText(
                botReady,
                'Online',
                sys.botStatus === 'connecting'
                  ? 'Connecting'
                  : sys.botStatus === 'error'
                    ? 'Error'
                    : 'Offline'
              )}
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-white text-xs font-medium">Gateway Intents</div>
                <div className="text-[11px] text-[#71717A] font-mono">
                  GuildMembers: {sys.hasGuildMembersIntent ? 'On' : 'Off'} · Listeners:{' '}
                  {sys.guildMemberAddListenerCount ?? 0}
                </div>
              </div>
              {renderStatusText(
                Boolean(sys.hasGuildMembersIntent),
                'Members Intent Active',
                'Intent Disabled'
              )}
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-white text-xs font-medium">Hoshika Catalog API</div>
                <div className="text-[11px] text-[#71717A] font-mono">
                  Anime search, details, characters
                </div>
              </div>
              {renderStatusText(!sys.hoshikaLastError, 'Connected', 'Degraded')}
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-white text-xs font-medium">Lavalink v4 Node</div>
                <div className="text-[11px] text-[#71717A] font-mono tabular-nums">
                  Active guild queues: {stats.activeMusicQueues}
                </div>
              </div>
              {renderStatusText(
                Boolean(sys.lavalinkConnected),
                sys.lavalinkStatusLabel || 'Connected',
                sys.lavalinkStatusLabel || 'Disconnected'
              )}
            </div>

            <div className="flex items-center justify-between pt-3">
              <div>
                <div className="text-white text-xs font-medium">AniScroll Website Sync</div>
                <div className="text-[11px] text-[#71717A] font-mono">
                  Shared Firebase watchlist API
                </div>
              </div>
              {renderStatusText(
                Boolean(sys.websiteWatchlistConfigured),
                'Configured',
                'Secret Needed'
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 bg-[#111114] border border-[#27272A] rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#27272A]">
              <h2 className="text-sm font-semibold text-white">Server Module Readiness</h2>
              <span className="text-xs text-[#71717A]">Click any module to configure</span>
            </div>

            <div className="divide-y divide-[#1E1E24]">
              {modules.map((mod) => (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => onNavigate(mod.route)}
                  className="w-full py-3 flex items-center justify-between gap-4 text-left hover:bg-[#18181C] -mx-2 px-2 rounded-md transition-colors group"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white flex items-center gap-2">
                      <span>{mod.label}</span>
                    </div>
                    <div className="text-xs text-[#71717A] font-mono truncate mt-0.5">
                      {mod.detail}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-xs font-mono ${
                        mod.enabled ? 'text-emerald-400' : 'text-[#71717A]'
                      }`}
                    >
                      {mod.enabled ? 'Active' : 'Inactive'}
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-[#71717A] group-hover:text-white transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 mt-2 border-t border-[#27272A] flex flex-wrap items-center justify-between gap-2 text-xs text-[#71717A]">
            <span className="inline-flex items-center gap-1.5 font-mono">
              <Terminal className="w-3.5 h-3.5" />
              Last command sync:{' '}
              {sys.lastCommandSync
                ? new Date(sys.lastCommandSync).toLocaleTimeString()
                : 'Not synced in current session'}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('/settings')}
              className="text-[#A1A1AA] hover:text-white transition-colors"
            >
              Inspect OAuth &amp; commands →
            </button>
          </div>
        </div>
      </div>

      {/* Top Commands Activity + Audit Events */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-[#111114] border border-[#27272A] rounded-lg p-5">
          <div className="flex items-center justify-between pb-3 border-b border-[#27272A]">
            <h2 className="text-sm font-semibold text-white">Top Slash Commands</h2>
            <button
              type="button"
              onClick={() => onNavigate('/analytics')}
              className="text-xs text-[#A1A1AA] hover:text-white"
            >
              Full report
            </button>
          </div>
          {topCommands.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <Activity className="w-5 h-5 text-[#71717A] mx-auto" />
              <p className="text-xs text-[#A1A1AA]">
                No command executions recorded in this guild yet.
              </p>
            </div>
          ) : (
            <div className="pt-3 space-y-3">
              {topCommands.map((cmd: any) => {
                const max = Math.max(1, topCommands[0]?.count || 1);
                const pct = Math.round((cmd.count / max) * 100);
                return (
                  <div key={cmd.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-white">/{cmd.name}</span>
                      <span className="font-mono text-[#A1A1AA] tabular-nums">{cmd.count}</span>
                    </div>
                    <div className="h-1.5 bg-[#18181C] rounded-full overflow-hidden">
                      <div className="h-full bg-white" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-8 bg-[#111114] border border-[#27272A] rounded-lg p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#27272A]">
            <h2 className="text-sm font-semibold text-white">Recent Audit Events</h2>
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-[#71717A] absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                aria-label="Filter audit events"
                value={auditQuery}
                onChange={(e) => setAuditQuery(e.target.value)}
                placeholder="Filter action or actor..."
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-[#71717A] focus:outline-none focus:border-white/70"
              />
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <p className="text-sm text-[#A1A1AA] py-6">
              {data.recentEvents.length === 0
                ? 'No audit events recorded yet.'
                : 'No audit events match your filter.'}
            </p>
          ) : (
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#27272A] text-xs text-[#71717A]">
                    <th className="py-2 pr-4 font-medium">Action</th>
                    <th className="py-2 pr-4 font-medium">Actor</th>
                    <th className="py-2 font-medium text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E1E24]">
                  {filteredEvents.map((ev: any) => (
                    <tr key={ev.id} className="hover:bg-[#18181C]/60">
                      <td className="py-2.5 pr-4 font-mono text-xs text-white">{ev.action}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-[#A1A1AA]">{ev.actorId}</td>
                      <td className="py-2.5 font-mono text-xs text-[#71717A] text-right tabular-nums">
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
