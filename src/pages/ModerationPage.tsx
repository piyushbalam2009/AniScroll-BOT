import React, { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

interface ModerationPageProps {
  guildId: string;
  onToast: (msg: string) => void;
}

export function ModerationPage({ guildId, onToast }: ModerationPageProps) {
  const [cases, setCases] = useState<any[]>([]);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [automod, setAutomod] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [targetUserId, setTargetUserId] = useState('');
  const [action, setAction] = useState<'WARN' | 'TIMEOUT' | 'KICK' | 'BAN'>('WARN');
  const [reason, setReason] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('15');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiRequest(`/api/v1/guilds/${guildId}/moderation`)
      .then((res) => {
        setCases(res.cases);
        setWarnings(res.warnings);
        setAutomod(res.settings.automodConfig);
      })
      .catch((err) => onToast(err.message))
      .finally(() => setLoading(false));
  }, [guildId, onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId.trim() || !reason.trim()) {
      onToast('Target user ID and reason are required.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(`/api/v1/guilds/${guildId}/moderation/cases`, {
        method: 'POST',
        body: JSON.stringify({
          targetUserId: targetUserId.trim(),
          action,
          reason: reason.trim(),
          durationMinutes: action === 'TIMEOUT' ? Number(durationMinutes) || 15 : null,
        }),
      });
      setTargetUserId('');
      setReason('');
      onToast(`Recorded ${action} moderation action.`);
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to issue action.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeWarning = async (warningId: string) => {
    try {
      await apiRequest(`/api/v1/guilds/${guildId}/moderation/warnings/${warningId}`, {
        method: 'DELETE',
      });
      onToast('Warning revoked.');
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to revoke warning.');
    }
  };

  const handleSaveAutomod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!automod) return;
    try {
      await apiRequest(`/api/v1/guilds/${guildId}/settings/automodConfig`, {
        method: 'PUT',
        body: JSON.stringify(automod),
      });
      onToast('AutoMod configuration saved.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to save AutoMod settings.');
    }
  };

  if (loading || !automod) {
    return <div className="h-48 bg-[#111111] border border-[#2A2A2A] rounded-lg animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      {/* Issue Action & AutoMod Config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleCreateCase} className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Issue Moderation Action</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="mod-user-id" className="block text-xs text-[#A0A0A0] mb-1">
                Target Discord User ID
              </label>
              <input
                id="mod-user-id"
                type="text"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                placeholder="e.g. 100000000000000099"
                className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white"
              />
            </div>
            <div>
              <label htmlFor="mod-action" className="block text-xs text-[#A0A0A0] mb-1">
                Action
              </label>
              <select
                id="mod-action"
                value={action}
                onChange={(e) => setAction(e.target.value as any)}
                className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white"
              >
                <option value="WARN">Warn (Auto-Escalation)</option>
                <option value="TIMEOUT">Timeout</option>
                <option value="KICK">Kick</option>
                <option value="BAN">Ban</option>
              </select>
            </div>
          </div>

          {action === 'TIMEOUT' && (
            <div>
              <label htmlFor="mod-duration" className="block text-xs text-[#A0A0A0] mb-1">
                Timeout Duration (minutes)
              </label>
              <input
                id="mod-duration"
                type="number"
                min={1}
                max={40320}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white"
              />
            </div>
          )}

          <div>
            <label htmlFor="mod-reason" className="block text-xs text-[#A0A0A0] mb-1">
              Reason
            </label>
            <input
              id="mod-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the rule violation"
              className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5] disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Execute Action'}
          </button>
        </form>

        <form onSubmit={handleSaveAutomod} className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">AutoMod &amp; Security Rules</h2>
            <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={automod.enabled}
                onChange={(e) => setAutomod({ ...automod, enabled: e.target.checked })}
                className="accent-white"
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            {[
              { key: 'antiSpam', label: 'Anti-Spam' },
              { key: 'duplicateDetection', label: 'Duplicate Messages' },
              { key: 'blockDiscordInvites', label: 'Invite Filtering' },
              { key: 'phishingFilter', label: 'Phishing Filter' },
              { key: 'floodDetection', label: 'Flood Detection' },
              { key: 'raidDetection', label: 'Raid Detection' },
            ].map((item) => (
              <label key={item.key} className="flex items-center gap-2 p-2.5 bg-[#181818] border border-[#2A2A2A] rounded-md cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(automod[item.key])}
                  onChange={(e) => setAutomod({ ...automod, [item.key]: e.target.checked })}
                  className="accent-white"
                />
                <span className="text-white">{item.label}</span>
              </label>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="am-mentions" className="block text-xs text-[#A0A0A0] mb-1">
                Max Mentions
              </label>
              <input
                id="am-mentions"
                type="number"
                min={1}
                max={50}
                value={automod.maxMentions}
                onChange={(e) => setAutomod({ ...automod, maxMentions: Number(e.target.value) })}
                className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-1.5 text-sm text-white font-mono tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="am-caps" className="block text-xs text-[#A0A0A0] mb-1">
                Caps %
              </label>
              <input
                id="am-caps"
                type="number"
                min={30}
                max={100}
                value={automod.excessiveCapsPercent}
                onChange={(e) => setAutomod({ ...automod, excessiveCapsPercent: Number(e.target.value) })}
                className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-1.5 text-sm text-white font-mono tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="am-mode" className="block text-xs text-[#A0A0A0] mb-1">
                Punishment
              </label>
              <select
                id="am-mode"
                value={automod.punishmentMode}
                onChange={(e) => setAutomod({ ...automod, punishmentMode: e.target.value })}
                className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md px-2 py-1.5 text-xs text-white"
              >
                <option value="DELETE_WARN">Delete &amp; Warn</option>
                <option value="DELETE_TIMEOUT">Delete &amp; Timeout</option>
                <option value="ESCALATE">Escalate</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5]"
          >
            Save AutoMod Rules
          </button>
        </form>
      </div>

      {/* Active Warnings */}
      <div className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Active Warnings ({warnings.length})</h2>
        {warnings.length === 0 ? (
          <p className="text-sm text-[#A0A0A0]">No active warnings in this server.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#2A2A2A] text-xs text-[#A0A0A0]">
                  <th className="py-2 pr-4 font-medium">User ID</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Moderator</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {warnings.map((w) => (
                  <tr key={w.id} className="border-b border-[#1E1E1E] last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-xs text-white">{w.userId}</td>
                    <td className="py-2.5 pr-4 text-xs text-[#E5E5E5]">{w.reason}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-[#A0A0A0]">{w.moderatorId}</td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleRevokeWarning(w.id)}
                        className="px-2.5 py-1 text-xs border border-[#2A2A2A] rounded text-[#A0A0A0] hover:text-white hover:border-white"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Case History */}
      <div className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Moderation Case Log ({cases.length})</h2>
        {cases.length === 0 ? (
          <p className="text-sm text-[#A0A0A0]">No moderation cases recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#2A2A2A] text-xs text-[#A0A0A0]">
                  <th className="py-2 pr-4 font-medium">Case</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 pr-4 font-medium">Target</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-b border-[#1E1E1E] last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-xs text-white tabular-nums">#{c.caseNumber}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-white">{c.action}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-[#A0A0A0]">{c.targetUserId}</td>
                    <td className="py-2.5 pr-4 text-xs text-[#E5E5E5]">{c.reason}</td>
                    <td className="py-2.5 font-mono text-xs text-[#A0A0A0] text-right tabular-nums">
                      {new Date(c.createdAt).toLocaleString()}
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
