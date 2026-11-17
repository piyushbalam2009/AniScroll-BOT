import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Send,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { apiRequest, GuildSummary } from '../lib/api';
import { renderWelcomePreviewText } from '../lib/dashboardUtils';

interface WelcomeMessagesPageProps {
  guild: GuildSummary;
  onToast: (msg: string) => void;
}

export function WelcomeMessagesPage({ guild, onToast }: WelcomeMessagesPageProps) {
  const [welcome, setWelcome] = useState<any>(null);
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkingDiag, setCheckingDiag] = useState(false);

  const loadData = useCallback(() => {
    Promise.all([
      apiRequest(`/api/v1/guilds/${guild.discordGuildId}/settings`),
      apiRequest(`/api/v1/guilds/${guild.discordGuildId}/channels`),
    ])
      .then(([settingsRes, channelsRes]: [any, any]) => {
        setWelcome(settingsRes.settings.welcomeConfig);
        setChannels(channelsRes.channels || []);
      })
      .catch((err) => onToast(err.message));
  }, [guild.discordGuildId, onToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/settings/welcomeConfig`, {
        method: 'PUT',
        body: JSON.stringify(welcome),
      });
      onToast('Welcome settings saved successfully.');
      loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to save welcome settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestWelcome = async () => {
    setTesting(true);
    try {
      await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/welcome/test`, {
        method: 'POST',
        body: JSON.stringify(welcome),
      });
      onToast('Test welcome message sent successfully to the selected channel.');
      loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Test welcome message failed.');
    } finally {
      setTesting(false);
    }
  };

  const handleDiagnostics = async () => {
    setCheckingDiag(true);
    try {
      const res = await apiRequest<{ diagnostics: any }>(
        `/api/v1/guilds/${guild.discordGuildId}/welcome/diagnostics`
      );
      setDiagnostics(res.diagnostics);
      onToast('Welcome pipeline diagnostics refreshed.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to run diagnostics.');
    } finally {
      setCheckingDiag(false);
    }
  };

  if (!welcome) {
    return (
      <div className="space-y-6">
        <div className="h-28 bg-[#111114] border border-[#27272A] rounded-lg animate-pulse" />
        <div className="h-96 bg-[#111114] border border-[#27272A] rounded-lg animate-pulse" />
      </div>
    );
  }

  const selectedChannel = channels.find((c) => c.id === welcome.channelId);
  const previewCtx = {
    user: '@HarukaSora',
    username: 'harukasora',
    displayName: 'Haruka Sora',
    server: guild.name,
    memberCount: guild.memberCount,
    userId: '100000000000000042',
    serverId: guild.discordGuildId,
    createdAt: '2024-03-15',
  };

  const previewPlainText = renderWelcomePreviewText(welcome.messageTemplate, previewCtx);
  const previewTitle = renderWelcomePreviewText(welcome.embedTitle, previewCtx);
  const previewDescription = renderWelcomePreviewText(welcome.embedDescription, previewCtx);
  const previewFooter = renderWelcomePreviewText(welcome.embedFooter, previewCtx);

  return (
    <div className="space-y-6">
      {/* Header & Summary Strip */}
      <section className="bg-[#111114] border border-[#27272A] rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#27272A]">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <Sparkles className="w-4 h-4 text-white" />
              <h2 className="text-sm font-semibold text-white">Welcome Delivery Pipeline</h2>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-mono ${
                  welcome.enabled ? 'text-emerald-400' : 'text-[#A1A1AA]'
                }`}
              >
                {welcome.enabled ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5" />
                )}
                <span>{welcome.enabled ? 'Enabled' : 'Disabled'}</span>
              </span>
            </div>
            <p className="text-xs text-[#A1A1AA]">
              Automated greetings dispatched via guildMemberAdd for {guild.name}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDiagnostics}
              disabled={checkingDiag}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#18181C] border border-[#27272A] text-[#E4E4E7] rounded-md hover:border-white/60 disabled:opacity-50"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{checkingDiag ? 'Checking...' : 'Diagnostics'}</span>
            </button>
            <button
              type="button"
              onClick={loadData}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#18181C] border border-[#27272A] text-[#E4E4E7] rounded-md hover:border-white/60"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              disabled={testing || !welcome.enabled || !welcome.channelId}
              onClick={handleTestWelcome}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7] disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{testing ? 'Sending Test...' : 'Test Welcome'}</span>
            </button>
          </div>
        </div>

        {/* Flat 4-Column Metric Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
          <div>
            <div className="text-xs text-[#71717A]">Selected Channel</div>
            <div className="text-sm font-semibold font-mono text-white mt-1 truncate">
              {selectedChannel ? `#${selectedChannel.name}` : 'Not configured'}
            </div>
          </div>

          <div>
            <div className="text-xs text-[#71717A]">Successful Welcomes</div>
            <div className="text-base font-semibold font-mono text-white mt-1 tabular-nums">
              {welcome.successCount ?? 0}
            </div>
          </div>

          <div>
            <div className="text-xs text-[#71717A]">Last Welcome Time</div>
            <div className="text-xs font-semibold font-mono text-white mt-1.5 truncate tabular-nums">
              {welcome.lastWelcomeAt ? new Date(welcome.lastWelcomeAt).toLocaleString() : 'Never'}
            </div>
          </div>

          <div>
            <div className="text-xs text-[#71717A]">Configuration Status</div>
            <div
              className={`text-xs font-semibold font-mono mt-1.5 truncate ${
                welcome.lastError ? 'text-red-400' : 'text-emerald-400'
              }`}
            >
              {welcome.lastError || 'Healthy · No errors'}
            </div>
          </div>
        </div>

        {diagnostics && (
          <div className="mt-4 pt-4 border-t border-[#27272A] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
            <div>
              <span className="text-[#71717A]">Gateway Status: </span>
              <span className="text-white">{diagnostics.botStatus || 'unknown'}</span>
            </div>
            <div>
              <span className="text-[#71717A]">Server Members Intent: </span>
              <span className={diagnostics.privilegedIntentsActive ? 'text-emerald-400' : 'text-amber-400'}>
                {diagnostics.privilegedIntentsActive ? 'Active' : 'Missing'}
              </span>
            </div>
            <div>
              <span className="text-[#71717A]">Channel Resolvable: </span>
              <span className={diagnostics.channelValid ? 'text-emerald-400' : 'text-amber-400'}>
                {diagnostics.channelValid ? 'Verified' : diagnostics.reason || 'Unverified'}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Main Split: Configuration Editor + Live Discord Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSave}
          className="lg:col-span-7 bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-[#27272A] pb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Welcome Configuration</h3>
              <p className="text-xs text-[#A1A1AA]">
                Configure message templates, embeds, avatars, and destination channels.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={welcome.enabled}
                onChange={(e) => setWelcome({ ...welcome, enabled: e.target.checked })}
                className="accent-white"
              />
              <span className="font-semibold text-white">Enable Welcome</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="welcome-channel" className="block text-xs text-[#A1A1AA] mb-1.5">
                Welcome Channel
              </label>
              <select
                id="welcome-channel"
                value={welcome.channelId || ''}
                onChange={(e) => setWelcome({ ...welcome, channelId: e.target.value || null })}
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white/70 font-mono"
              >
                <option value="">Select a text channel...</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    #{ch.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="embed-color" className="block text-xs text-[#A1A1AA] mb-1.5">
                Embed Accent Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="embed-color"
                  type="color"
                  value={welcome.embedColor || '#ffffff'}
                  onChange={(e) => setWelcome({ ...welcome, embedColor: e.target.value })}
                  className="w-10 h-9 bg-[#18181C] border border-[#27272A] rounded cursor-pointer p-1 shrink-0"
                />
                <input
                  type="text"
                  value={welcome.embedColor || '#ffffff'}
                  onChange={(e) => setWelcome({ ...welcome, embedColor: e.target.value })}
                  className="flex-1 bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-white/70"
                />
              </div>
            </div>
          </div>

          {/* Message Template Editor */}
          <div className="space-y-1.5">
            <label htmlFor="message-template" className="block text-xs text-[#A1A1AA]">
              Plain Text Message Template
            </label>
            <textarea
              id="message-template"
              rows={2}
              value={welcome.messageTemplate || ''}
              onChange={(e) => setWelcome({ ...welcome, messageTemplate: e.target.value })}
              placeholder="Welcome {user} to {server}! You are member #{memberCount}."
              className="w-full bg-[#18181C] border border-[#27272A] rounded-md p-3 text-sm text-white font-mono focus:outline-none focus:border-white/70"
            />
          </div>

          {/* Embed Settings (hairline divided, no nested cards) */}
          <div className="space-y-4 pt-4 border-t border-[#27272A]">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white">Rich Embed Options</h4>
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={welcome.embedEnabled}
                  onChange={(e) => setWelcome({ ...welcome, embedEnabled: e.target.checked })}
                  className="accent-white"
                />
                <span className="text-[#E4E4E7]">Enable Embed</span>
              </label>
            </div>

            {welcome.embedEnabled && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="embed-title" className="block text-xs text-[#A1A1AA] mb-1.5">
                    Embed Title
                  </label>
                  <input
                    id="embed-title"
                    type="text"
                    value={welcome.embedTitle || ''}
                    onChange={(e) => setWelcome({ ...welcome, embedTitle: e.target.value })}
                    className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-white/70"
                  />
                </div>

                <div>
                  <label htmlFor="embed-desc" className="block text-xs text-[#A1A1AA] mb-1.5">
                    Embed Description
                  </label>
                  <textarea
                    id="embed-desc"
                    rows={3}
                    value={welcome.embedDescription || ''}
                    onChange={(e) => setWelcome({ ...welcome, embedDescription: e.target.value })}
                    className="w-full bg-[#18181C] border border-[#27272A] rounded-md p-3 text-sm text-white font-mono focus:outline-none focus:border-white/70"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="embed-thumb" className="block text-xs text-[#A1A1AA] mb-1.5">
                      Custom Thumbnail URL (Optional)
                    </label>
                    <input
                      id="embed-thumb"
                      type="text"
                      placeholder="https://..."
                      value={welcome.embedThumbnail || ''}
                      onChange={(e) =>
                        setWelcome({ ...welcome, embedThumbnail: e.target.value || null })
                      }
                      className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-white/70"
                    />
                  </div>
                  <div>
                    <label htmlFor="embed-img" className="block text-xs text-[#A1A1AA] mb-1.5">
                      Banner / Image URL (Optional)
                    </label>
                    <input
                      id="embed-img"
                      type="text"
                      placeholder="https://..."
                      value={welcome.embedImage || ''}
                      onChange={(e) =>
                        setWelcome({ ...welcome, embedImage: e.target.value || null })
                      }
                      className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-white/70"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div>
                    <label htmlFor="embed-footer" className="block text-xs text-[#A1A1AA] mb-1.5">
                      Embed Footer Text
                    </label>
                    <input
                      id="embed-footer"
                      type="text"
                      value={welcome.embedFooter || ''}
                      onChange={(e) =>
                        setWelcome({ ...welcome, embedFooter: e.target.value || null })
                      }
                      className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-white/70"
                    />
                  </div>
                  <div className="pt-5">
                    <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={welcome.showMemberAvatar}
                        onChange={(e) =>
                          setWelcome({ ...welcome, showMemberAvatar: e.target.checked })
                        }
                        className="accent-white"
                      />
                      <span className="text-[#E4E4E7]">Show Joining Member Avatar</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Placeholders Reference (flat hairline section) */}
          <div className="pt-4 border-t border-[#27272A] space-y-2 text-xs">
            <div className="font-semibold text-white">Supported Placeholders</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[#71717A]">
              <div>
                <code className="text-white">{'{user}'}</code>: Mention
              </div>
              <div>
                <code className="text-white">{'{username}'}</code>: Username
              </div>
              <div>
                <code className="text-white">{'{displayName}'}</code>: Display name
              </div>
              <div>
                <code className="text-white">{'{server}'}</code>: Server
              </div>
              <div>
                <code className="text-white">{'{memberCount}'}</code>: Count
              </div>
              <div>
                <code className="text-white">{'{userId}'}</code>: User ID
              </div>
              <div>
                <code className="text-white">{'{serverId}'}</code>: Server ID
              </div>
              <div>
                <code className="text-white">{'{createdAt}'}</code>: Join date
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7] disabled:opacity-50"
            >
              {saving ? 'Saving Settings...' : 'Save Welcome Settings'}
            </button>
          </div>
        </form>

        {/* Live Discord Welcome Message Preview */}
        <aside
          aria-label="Live Discord Welcome Preview"
          className="lg:col-span-5 bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4 lg:sticky lg:top-24"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#27272A]">
            <div>
              <h3 className="text-sm font-semibold text-white">Live Discord Preview</h3>
              <p className="text-xs text-[#71717A]">
                Target: {selectedChannel ? `#${selectedChannel.name}` : '#welcome-channel'}
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#71717A]">Sample member: @HarukaSora</span>
          </div>

          {/* Simulated Discord Message Row */}
          <div className="flex items-start gap-3 pt-1">
            <div className="w-9 h-9 rounded-full bg-white text-black font-bold text-xs flex items-center justify-center shrink-0">
              AS
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-white">AniScroll Bot</span>
                <span className="font-mono text-[10px] text-[#A1A1AA]">APP</span>
                <span className="text-[#71717A] text-[11px]">Today at 12:00 PM</span>
              </div>

              {previewPlainText && (
                <p className="text-sm text-[#E4E4E7] whitespace-pre-wrap break-words">
                  {previewPlainText}
                </p>
              )}

              {welcome.embedEnabled && (
                <div
                  className="bg-[#18181C] rounded-r-md p-3.5 space-y-2.5 border-y border-r border-[#27272A]"
                  style={{
                    borderLeftWidth: '2px',
                    borderLeftStyle: 'solid',
                    borderLeftColor: welcome.embedColor || '#ffffff',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="text-sm font-semibold text-white break-words">
                        {previewTitle || `Welcome to ${guild.name}`}
                      </div>
                      <p className="text-xs text-[#D4D4D8] whitespace-pre-wrap break-words leading-relaxed">
                        {previewDescription ||
                          'Glad to have you with us! Check server rules and explore anime with /anime search.'}
                      </p>
                    </div>

                    {(welcome.showMemberAvatar || welcome.embedThumbnail) && (
                      <div className="w-14 h-14 rounded-md bg-[#222228] border border-[#27272A] flex items-center justify-center shrink-0 overflow-hidden">
                        {welcome.embedThumbnail ? (
                          <img
                            src={welcome.embedThumbnail}
                            alt="Embed thumbnail preview"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <UserCheck className="w-6 h-6 text-[#A1A1AA]" />
                        )}
                      </div>
                    )}
                  </div>

                  {welcome.embedImage && (
                    <div className="rounded overflow-hidden border border-[#27272A] max-h-36 bg-[#09090B]">
                      <img
                        src={welcome.embedImage}
                        alt="Embed banner preview"
                        className="w-full h-32 object-cover"
                      />
                    </div>
                  )}

                  {previewFooter && (
                    <div className="pt-2 border-t border-[#27272A] text-[11px] text-[#71717A] font-mono">
                      {previewFooter}
                    </div>
                  )}
                </div>
              )}

              {!previewPlainText && !welcome.embedEnabled && (
                <p className="text-xs text-[#71717A] italic">
                  Enter a message template or enable the rich embed to preview output.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
