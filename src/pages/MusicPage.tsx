import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Server, XCircle } from 'lucide-react';
import { apiRequest, GuildSummary } from '../lib/api';

interface MusicPageProps {
  guild: GuildSummary;
  health: any;
  onToast: (msg: string) => void;
}

function getStatusBadgeClass(status: string | undefined): string {
  switch (status) {
    case 'online':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400';
    case 'connecting':
    case 'reconnecting':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    case 'auth_failed':
      return 'border-red-500/50 bg-red-500/10 text-red-400';
    default:
      return 'border-[#2A2A2A] bg-[#181818] text-[#D4D4D4]';
  }
}

export function MusicPage({ guild, health, onToast }: MusicPageProps) {
  const [music, setMusic] = useState<any>(null);
  const [lavalink, setLavalink] = useState<any>(health?.lavalink || null);
  const [testing, setTesting] = useState(false);
  const [lastTestResult, setLastTestResult] = useState<any>(null);

  const loadMusicInfra = useCallback(() => {
    apiRequest('/api/v1/admin/music/status')
      .then((res: any) => {
        if (res.lavalink) setLavalink(res.lavalink);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    apiRequest(`/api/v1/guilds/${guild.discordGuildId}/settings`)
      .then((res) => setMusic(res.settings.musicConfig))
      .catch((err) => onToast(err.message));
    loadMusicInfra();
  }, [guild.discordGuildId, loadMusicInfra, onToast]);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await apiRequest<{ result: any; lavalink?: any }>('/api/v1/admin/music/test', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setLastTestResult(res.result);
      if (res.lavalink) setLavalink(res.lavalink);
      if (res.result?.success) {
        onToast(`Lavalink ${res.result.version || 'v4'} responded in ${res.result.latencyMs ?? 0}ms.`);
      } else {
        onToast(res.result?.error || 'Lavalink v4 connection test failed.');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Lavalink v4 connection test failed.');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/settings/musicConfig`, {
        method: 'PUT',
        body: JSON.stringify(music),
      });
      onToast('Music settings saved.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to save music settings.');
    }
  };

  if (!music) {
    return <div className="h-48 bg-[#111111] border border-[#2A2A2A] rounded-lg animate-pulse" />;
  }

  const infra = lavalink || health?.lavalink || {};
  const validationItems: Array<{ key: string; ok: boolean; required: boolean; message: string }> =
    infra.configValidation || [];
  const historyItems: Array<{
    timestamp: string;
    status: string;
    attempt: number;
    delayMs: number | null;
    message: string;
  }> = infra.reconnectionHistory || [];

  return (
    <div className="space-y-6">
      {/* Music Infrastructure Section */}
      <section
        aria-labelledby="music-infra-heading"
        className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#2A2A2A] pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <Server className="w-4 h-4 text-white" />
              <h2 id="music-infra-heading" className="text-sm font-semibold text-white">
                Music Infrastructure · Lavalink v4
              </h2>
              <span
                data-testid="lavalink-status-badge"
                className={`px-2 py-0.5 text-[11px] font-mono border rounded ${getStatusBadgeClass(infra.status)}`}
              >
                {infra.statusLabel || (infra.connected ? 'Online' : 'Offline')}
              </span>
            </div>
            <p className="text-xs text-[#A0A0A0] font-mono">
              Node: {infra.host ? `${infra.host}:${infra.port}` : 'Not configured'} · Protocol:{' '}
              {infra.secure ? 'WSS / HTTPS' : 'WS / HTTP'}
              {infra.version ? ` · Lavalink ${infra.version}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadMusicInfra}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#181818] border border-[#2A2A2A] text-[#D4D4D4] rounded-md hover:border-white hover:text-white"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              disabled={testing}
              onClick={handleTestConnection}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5] disabled:opacity-50"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{testing ? 'Testing...' : 'Test Connection'}</span>
            </button>
          </div>
        </div>

        {/* Live Telemetry Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-3.5">
            <div className="text-[11px] text-[#A0A0A0]">Lavalink Version</div>
            <div className="text-base font-semibold font-mono text-white mt-1 tabular-nums">
              {infra.version || 'Unavailable'}
            </div>
            <div className="text-[11px] text-[#A0A0A0] font-mono mt-0.5 truncate">
              {infra.activeNode?.name || 'No active node'}
            </div>
          </div>

          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-3.5">
            <div className="text-[11px] text-[#A0A0A0]">Player Count</div>
            <div className="text-base font-semibold font-mono text-white mt-1 tabular-nums">
              {infra.playerCount ?? 0}
            </div>
            <div className="text-[11px] text-[#A0A0A0] font-mono mt-0.5">
              Playing: {infra.playingPlayerCount ?? 0}
            </div>
          </div>

          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-3.5">
            <div className="text-[11px] text-[#A0A0A0]">Active Voice Connections</div>
            <div className="text-base font-semibold font-mono text-white mt-1 tabular-nums">
              {infra.activeVoiceConnections ?? 0}
            </div>
            <div className="text-[11px] text-[#A0A0A0] font-mono mt-0.5">
              Guild Queues: {infra.activeGuildQueues ?? 0}
            </div>
          </div>

          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-3.5">
            <div className="text-[11px] text-[#A0A0A0]">Total Queued Tracks</div>
            <div className="text-base font-semibold font-mono text-white mt-1 tabular-nums">
              {infra.totalQueuedTracks ?? 0}
            </div>
            <div className="text-[11px] text-[#A0A0A0] font-mono mt-0.5">
              {infra.activeNode?.memoryUsedMb != null
                ? `Heap: ${infra.activeNode.memoryUsedMb}MB`
                : 'Awaiting node stats'}
            </div>
          </div>
        </div>

        {/* Source Integrations: YouTube & Spotify */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-4 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">YouTube Integration</span>
              <span className="text-[11px] font-mono text-[#A0A0A0]">
                {infra.integrations?.youtube?.ready ? 'Ready' : 'Offline / Unverified'}
              </span>
            </div>
            <p className="text-xs text-[#D4D4D4]">
              {infra.integrations?.youtube?.statusText || 'Waiting for Lavalink v4 YouTube source status.'}
            </p>
            <p className="text-[11px] font-mono text-[#A0A0A0]">
              YouTube OAuth Refresh Token:{' '}
              {infra.integrations?.youtube?.oauthConfigured ? 'Configured' : 'Not set (optional)'}
            </p>
          </div>

          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-4 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">Spotify Integration</span>
              <span className="text-[11px] font-mono text-[#A0A0A0]">
                {infra.integrations?.spotify?.ready ? 'Ready' : 'Not Active'}
              </span>
            </div>
            <p className="text-xs text-[#D4D4D4]">
              {infra.integrations?.spotify?.statusText || 'Waiting for Spotify credentials & metadata resolution.'}
            </p>
            <p className="text-[11px] font-mono text-[#A0A0A0]">
              Spotify Client Credentials:{' '}
              {infra.integrations?.spotify?.credentialsConfigured ? 'Configured' : 'Not set (required for Spotify URLs)'}
            </p>
          </div>
        </div>

        {/* Active Node Plugins (if connected) */}
        {infra.activeNode && (
          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-4 space-y-2 text-xs">
            <div className="font-semibold text-white">Active Node Details</div>
            <div className="font-mono text-[#A0A0A0] break-all">
              Node: {infra.activeNode.name || 'primary-lavalink-v4'} · Session: {infra.activeNode.sessionId || 'Pending'}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {(infra.activeNode.plugins || []).map((p: any) => (
                <span
                  key={`${p.name}-${p.version}`}
                  className="px-2 py-0.5 bg-black border border-[#2A2A2A] rounded font-mono text-[11px] text-white"
                >
                  {p.name}@{p.version}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Last Connection Error & Real Test Result */}
        {(infra.lastError || lastTestResult) && (
          <div className="space-y-2">
            {infra.lastError && (
              <div
                data-testid="lavalink-last-error"
                className="p-3.5 bg-[#181818] border border-red-900/60 rounded-md text-xs text-red-300 flex items-start gap-2.5"
              >
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold text-red-200">Last Connection Error</div>
                  <div className="font-mono break-words">{infra.lastError}</div>
                </div>
              </div>
            )}

            {lastTestResult && (
              <div
                data-testid="lavalink-test-result"
                className={`p-3 bg-[#181818] border rounded-md text-xs flex items-start gap-2.5 ${
                  lastTestResult.success
                    ? 'border-emerald-500/40 text-emerald-300'
                    : 'border-amber-500/40 text-amber-200'
                }`}
              >
                {lastTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="font-semibold">
                    Live Connection Test: {lastTestResult.success ? 'Reachable' : 'Failed'} (
                    {lastTestResult.statusLabel})
                    {lastTestResult.latencyMs != null ? ` · ${lastTestResult.latencyMs}ms` : ''}
                  </div>
                  {lastTestResult.error && <div className="font-mono break-words">{lastTestResult.error}</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Environment Runtime Note */}
        {infra.environmentSupport && !infra.environmentSupport.javaInstalled && (
          <div className="p-3 bg-[#181818] border border-[#2A2A2A] rounded-md text-xs text-[#A0A0A0]">
            <span className="text-white font-medium">Hosting Architecture Note:</span>{' '}
            {infra.environmentSupport.note}
          </div>
        )}

        {/* Configuration Validation */}
        {validationItems.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-white">Configuration Validation</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {validationItems.map((item) => (
                <div
                  key={item.key}
                  className="bg-[#181818] border border-[#2A2A2A] rounded-md p-3 flex items-start gap-2.5 text-xs"
                >
                  {item.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : item.required ? (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-[#A0A0A0] shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="font-mono text-white">
                      {item.key}{' '}
                      <span className="text-[10px] text-[#A0A0A0]">
                        ({item.required ? 'Required' : 'Optional'})
                      </span>
                    </div>
                    <div className="text-[#A0A0A0] mt-0.5 break-words">{item.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reconnection History */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-white">Reconnection History</h3>
          {historyItems.length === 0 ? (
            <p className="text-xs text-[#A0A0A0]">No connection events logged yet.</p>
          ) : (
            <div className="bg-[#181818] border border-[#2A2A2A] rounded-md divide-y divide-[#2A2A2A] max-h-48 overflow-y-auto">
              {historyItems.slice(0, 8).map((ev, idx) => (
                <div key={`${ev.timestamp}-${idx}`} className="px-3 py-2 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div className="min-w-0">
                    <span className="font-mono text-white uppercase mr-2">[{ev.status}]</span>
                    <span className="text-[#D4D4D4] break-words">{ev.message}</span>
                  </div>
                  <span className="font-mono text-[11px] text-[#A0A0A0] shrink-0 tabular-nums">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Guild Playback & Queue Settings */}
      <form onSubmit={handleSave} className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Playback &amp; Queue Configuration</h3>
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={music.enabled}
              onChange={(e) => setMusic({ ...music, enabled: e.target.checked })}
              className="accent-white"
            />
            <span>Music Commands Enabled</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="m-vol" className="block text-xs text-[#A0A0A0] mb-1">
              Default Volume ({music.defaultVolume}%)
            </label>
            <input
              id="m-vol"
              type="range"
              min={0}
              max={120}
              value={music.defaultVolume}
              onChange={(e) => setMusic({ ...music, defaultVolume: Number(e.target.value) })}
              className="w-full accent-white"
            />
          </div>
          <div>
            <label htmlFor="m-maxvol" className="block text-xs text-[#A0A0A0] mb-1">
              Max Volume Cap
            </label>
            <input
              id="m-maxvol"
              type="number"
              min={10}
              max={150}
              value={music.maxVolume}
              onChange={(e) => setMusic({ ...music, maxVolume: Number(e.target.value) })}
              className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white font-mono tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="m-q" className="block text-xs text-[#A0A0A0] mb-1">
              Max Queue Size
            </label>
            <input
              id="m-q"
              type="number"
              min={10}
              max={1000}
              value={music.maxQueueSize}
              onChange={(e) => setMusic({ ...music, maxQueueSize: Number(e.target.value) })}
              className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white font-mono tabular-nums"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label className="flex items-center gap-2 p-3 bg-[#181818] border border-[#2A2A2A] rounded-md cursor-pointer">
            <input
              type="checkbox"
              checked={music.stay247}
              onChange={(e) => setMusic({ ...music, stay247: e.target.checked })}
              className="accent-white"
            />
            <span>24/7 Voice Persistence</span>
          </label>
          <label className="flex items-center gap-2 p-3 bg-[#181818] border border-[#2A2A2A] rounded-md cursor-pointer">
            <input
              type="checkbox"
              checked={music.autoplayEnabled}
              onChange={(e) => setMusic({ ...music, autoplayEnabled: e.target.checked })}
              className="accent-white"
            />
            <span>Autoplay Related Tracks</span>
          </label>
          <label className="flex items-center gap-2 p-3 bg-[#181818] border border-[#2A2A2A] rounded-md cursor-pointer">
            <input
              type="checkbox"
              checked={music.announceNowPlaying}
              onChange={(e) => setMusic({ ...music, announceNowPlaying: e.target.checked })}
              className="accent-white"
            />
            <span>Announce Now Playing</span>
          </label>
        </div>

        <div>
          <span className="block text-xs text-[#A0A0A0] mb-2">DJ Roles</span>
          <div className="flex flex-wrap gap-2">
            {guild.roles.map((role) => {
              const selected = music.djRoleIds.includes(role.id);
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => {
                    const next = selected
                      ? music.djRoleIds.filter((id: string) => id !== role.id)
                      : [...music.djRoleIds, role.id];
                    setMusic({ ...music, djRoleIds: next });
                  }}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    selected
                      ? 'bg-white text-black border-white font-medium'
                      : 'bg-[#181818] text-[#A0A0A0] border-[#2A2A2A] hover:text-white'
                  }`}
                >
                  {role.name}
                </button>
              );
            })}
          </div>
        </div>

        <button type="submit" className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5]">
          Save Music Settings
        </button>
      </form>
    </div>
  );
}
