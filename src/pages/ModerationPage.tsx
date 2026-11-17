import React, { useCallback, useEffect, useState } from 'react';
import { Search, Shield } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { filterModerationCases } from '../lib/dashboardUtils';

interface ModerationPageProps {
  guildId: string;
  onToast: (msg: string) => void;
}

const ACTION_FILTERS = ['ALL', 'WARN', 'TIMEOUT', 'KICK', 'BAN'] as const;

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

  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [caseQuery, setCaseQuery] = useState('');

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

  const activeFiltersCount = [
    automod.antiSpam,
    automod.duplicateDetection,
    automod.blockDiscordInvites,
    automod.phishingFilter,
    automod.floodDetection,
    automod.raidDetection,
  ].filter(Boolean).length;

  const severeCount = cases.filter((c) => c.action === 'BAN' || c.action === 'KICK').length;
  const filteredCases = filterModerationCases(cases, actionFilter, caseQuery);

  return (
    <div className="space-y-6">
      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-4">
          <div className="text-xs text-[#A1A1AA]">Recorded Cases</div>
          <div className="mt-1.5 text-2xl font-semibold text-white font-mono tabular-nums">
            {cases.length}
          </div>
          <div className="mt-1 text-xs text-[#71717A] tabular-nums">Full guild audit trail</div>
        </div>
        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-4">
          <div className="text-xs text-[#A1A1AA]">Active Warnings</div>
          <div className="mt-1.5 text-2xl font-semibold text-white font-mono tabular-nums">
            {warnings.length}
          </div>
          <div className="mt-1 text-xs text-[#71717A]">Subject to auto-escalation</div>
        </div>
        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-4">
          <div className="text-xs text-[#A1A1AA]">Kicks &amp; Bans</div>
          <div className="mt-1.5 text-2xl font-semibold text-white font-mono tabular-nums">
            {severeCount}
          </div>
          <div className="mt-1 text-xs text-[#71717A]">High-severity actions</div>
        </div>
        <div className="bg-[#111114] border border-[#27272A] rounded-lg p-4">
          <div className="text-xs text-[#A1A1AA]">AutoMod Shield</div>
          <div
            className={`mt-1.5 text-base font-semibold font-mono ${
              automod.enabled ? 'text-emerald-400' : 'text-[#A1A1AA]'
            }`}
          >
            {automod.enabled ? 'Active' : 'Disabled'}
          </div>
          <div className="mt-1 text-xs text-[#71717A] font-mono tabular-nums">
            {activeFiltersCount}/6 protection modules enabled
          </div>
        </div>
      </div>

      {/* Issue Action & AutoMod Config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={handleCreateCase}
          className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#27272A]">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#A1A1AA]" />
              <span>Issue Moderation Action</span>
            </h2>
            <span className="text-xs text-[#71717A]">Persisted immediately</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="mod-user-id" className="block text-xs text-[#A1A1AA] mb-1.5">
                Target Discord User ID
              </label>
              <input
                id="mod-user-id"
                type="text"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                placeholder="e.g. 100000000000000099"
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-white/70"
              />
            </div>
            <div>
              <label htmlFor="mod-action" className="block text-xs text-[#A1A1AA] mb-1.5">
                Action
              </label>
              <select
                id="mod-action"
                value={action}
                onChange={(e) => setAction(e.target.value as any)}
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white/70"
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
              <label htmlFor="mod-duration" className="block text-xs text-[#A1A1AA] mb-1.5">
                Timeout Duration (minutes)
              </label>
              <input
                id="mod-duration"
                type="number"
                min={1}
                max={40320}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono tabular-nums focus:outline-none focus:border-white/70"
              />
            </div>
          )}

          <div>
            <label htmlFor="mod-reason" className="block text-xs text-[#A1A1AA] mb-1.5">
              Reason
            </label>
            <input
              id="mod-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the rule violation"
              className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white/70"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7] disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Execute Action'}
          </button>
        </form>

        <form
          onSubmit={handleSaveAutomod}
          className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#27272A]">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
            {[
              { key: 'antiSpam', label: 'Anti-Spam Rate Limiter' },
              { key: 'duplicateDetection', label: 'Duplicate Messages' },
              { key: 'blockDiscordInvites', label: 'Discord Invite Filter' },
              { key: 'phishingFilter', label: 'Phishing & Scam Domains' },
              { key: 'floodDetection', label: 'Message Flood Detection' },
              { key: 'raidDetection', label: 'Join Spike Raid Guard' },
            ].map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between py-2 border-b border-[#1E1E24] cursor-pointer hover:text-white"
              >
                <span className="text-[#E4E4E7]">{item.label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(automod[item.key])}
                  onChange={(e) => setAutomod({ ...automod, [item.key]: e.target.checked })}
                  className="accent-white"
                />
              </label>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1">
            <div>
              <label htmlFor="am-mentions" className="block text-xs text-[#A1A1AA] mb-1">
                Max Mentions
              </label>
              <input
                id="am-mentions"
                type="number"
                min={1}
                max={50}
                value={automod.maxMentions}
                onChange={(e) => setAutomod({ ...automod, maxMentions: Number(e.target.value) })}
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-1.5 text-sm text-white font-mono tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="am-caps" className="block text-xs text-[#A1A1AA] mb-1">
                Caps %
              </label>
              <input
                id="am-caps"
                type="number"
                min={30}
                max={100}
                value={automod.excessiveCapsPercent}
                onChange={(e) =>
                  setAutomod({ ...automod, excessiveCapsPercent: Number(e.target.value) })
                }
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-1.5 text-sm text-white font-mono tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="am-mode" className="block text-xs text-[#A1A1AA] mb-1">
                Punishment
              </label>
              <select
                id="am-mode"
                value={automod.punishmentMode}
                onChange={(e) => setAutomod({ ...automod, punishmentMode: e.target.value })}
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-2 py-1.5 text-xs text-white"
              >
                <option value="DELETE_WARN">Delete &amp; Warn</option>
                <option value="DELETE_TIMEOUT">Delete &amp; Timeout</option>
                <option value="ESCALATE">Escalate</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7]"
          >
            Save AutoMod Rules
          </button>
        </form>
      </div>

      {/* Active Warnings */}
      <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#27272A]">
          <h2 className="text-sm font-semibold text-white">Active Warnings ({warnings.length})</h2>
          <span className="text-xs text-[#71717A]">Revoking updates escalation score</span>
        </div>
        {warnings.length === 0 ? (
          <p className="text-sm text-[#A1A1AA] pt-4">No active warnings in this server.</p>
        ) : (
          <div className="overflow-x-auto pt-2">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#27272A] text-xs text-[#71717A]">
                  <th className="py-2 pr-4 font-medium">User ID</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Moderator</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E1E24]">
                {warnings.map((w) => (
                  <tr key={w.id} className="hover:bg-[#18181C]/60">
                    <td className="py-2.5 pr-4 font-mono text-xs text-white">{w.userId}</td>
                    <td className="py-2.5 pr-4 text-xs text-[#E4E4E7]">{w.reason}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-[#A1A1AA]">{w.moderatorId}</td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleRevokeWarning(w.id)}
                        className="px-2.5 py-1 text-xs border border-[#27272A] rounded text-[#A1A1AA] hover:text-white hover:border-white/70"
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

      {/* Filterable Case History */}
      <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#27272A]">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Moderation Case Log ({filteredCases.length}
              {filteredCases.length !== cases.length ? ` of ${cases.length}` : ''})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center p-0.5 bg-[#18181C] border border-[#27272A] rounded-md">
              {ACTION_FILTERS.map((act) => (
                <button
                  key={act}
                  type="button"
                  onClick={() => setActionFilter(act)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors ${
                    actionFilter === act
                      ? 'bg-white text-black font-semibold'
                      : 'text-[#A1A1AA] hover:text-white'
                  }`}
                >
                  {act}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-52">
              <Search className="w-3.5 h-3.5 text-[#71717A] absolute left-2.5 top-2 pointer-events-none" />
              <input
                type="text"
                aria-label="Search moderation cases"
                value={caseQuery}
                onChange={(e) => setCaseQuery(e.target.value)}
                placeholder="Search #case, user, reason..."
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-[#71717A] focus:outline-none focus:border-white/70"
              />
            </div>
          </div>
        </div>

        {filteredCases.length === 0 ? (
          <p className="text-sm text-[#A1A1AA]">
            {cases.length === 0
              ? 'No moderation cases recorded.'
              : 'No moderation cases match the selected action or search filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#27272A] text-xs text-[#71717A]">
                  <th className="py-2 pr-4 font-medium">Case</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 pr-4 font-medium">Target</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E1E24]">
                {filteredCases.map((c) => (
                  <tr key={c.id} className="hover:bg-[#18181C]/60">
                    <td className="py-2.5 pr-4 font-mono text-xs text-white tabular-nums">
                      #{c.caseNumber}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-white">{c.action}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-[#A1A1AA]">{c.targetUserId}</td>
                    <td className="py-2.5 pr-4 text-xs text-[#E4E4E7]">{c.reason}</td>
                    <td className="py-2.5 font-mono text-xs text-[#71717A] text-right tabular-nums">
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
