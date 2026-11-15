import React, { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

interface OverviewPageProps {
  guildId: string;
  onToast: (msg: string) => void;
}

export function OverviewPage({ guildId, onToast }: OverviewPageProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest(`/api/v1/guilds/${guildId}/overview`)
      .then(setData)
      .catch((err) => onToast(err.message))
      .finally(() => setLoading(false));
  }, [guildId, onToast]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-[#111111] border border-[#2A2A2A] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-6 text-sm text-[#A0A0A0]">
        Unable to load server overview.
      </div>
    );
  }

  const stats = data.stats;
  const kpis = [
    { label: 'Total Members', value: stats.memberCount.toLocaleString(), sub: 'Server directory' },
    { label: 'Commands Used', value: stats.totalCommands.toLocaleString(), sub: 'Recorded executions' },
    { label: 'Moderation Cases', value: stats.moderationCasesCount.toLocaleString(), sub: `${stats.activeWarningsCount} active warnings` },
    { label: 'Open Tickets', value: stats.openTicketsCount.toLocaleString(), sub: `Uptime ${Math.floor(stats.uptimeSeconds / 60)}m` },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5">
            <div className="text-xs text-[#A0A0A0]">{k.label}</div>
            <div className="mt-2 text-2xl font-semibold text-white font-mono tabular-nums">{k.value}</div>
            <div className="mt-1 text-xs text-[#666666]">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Service Connectivity</h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between py-2 border-b border-[#2A2A2A]">
              <span className="text-[#A0A0A0]">Hoshika API</span>
              <span className={data.system.hoshikaLastError ? 'text-amber-500 font-mono text-xs' : 'text-emerald-500 font-mono text-xs'}>
                {data.system.hoshikaLastError ? 'Degraded' : 'Connected'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[#2A2A2A]">
              <span className="text-[#A0A0A0]">Discord Gateway</span>
              <span className={data.system.botStatus === 'ready' ? 'text-emerald-500 font-mono text-xs' : 'text-amber-500 font-mono text-xs'}>
                {data.system.botStatus === 'ready'
                  ? 'Online'
                  : data.system.botStatus === 'connecting'
                    ? 'Connecting...'
                    : data.system.botStatus === 'error'
                      ? 'Connection Error'
                      : 'Offline (Token Required)'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[#2A2A2A]">
              <span className="text-[#A0A0A0]">Lavalink v4 Node</span>
              <span className={data.system.lavalinkConnected ? 'text-emerald-500 font-mono text-xs' : 'text-amber-500 font-mono text-xs'}>
                {data.system.lavalinkConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[#A0A0A0]">Active Music Queues</span>
              <span className="text-white font-mono text-xs tabular-nums">{stats.activeMusicQueues}</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-[#111111] border border-[#2A2A2A] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Recent Audit Events</h2>
          {data.recentEvents.length === 0 ? (
            <p className="text-sm text-[#A0A0A0]">No audit events recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#2A2A2A] text-xs text-[#A0A0A0]">
                    <th className="py-2 pr-4 font-medium">Action</th>
                    <th className="py-2 pr-4 font-medium">Actor</th>
                    <th className="py-2 font-medium text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentEvents.map((ev: any) => (
                    <tr key={ev.id} className="border-b border-[#1E1E1E] last:border-0">
                      <td className="py-2.5 pr-4 font-mono text-xs text-white">{ev.action}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-[#A0A0A0]">{ev.actorId}</td>
                      <td className="py-2.5 font-mono text-xs text-[#A0A0A0] text-right tabular-nums">
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
