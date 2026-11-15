import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, MessageSquare, RefreshCw, Send, Server, Sparkles, ShieldCheck } from 'lucide-react';
import { apiRequest, GuildSummary } from '../lib/api';

interface WelcomeMessagesPageProps {
  guild: GuildSummary;
  onToast: (msg: string) => void;
}

export function WelcomeMessagesPage({ guild, onToast }: WelcomeMessagesPageProps) {
  const [welcome, setWelcome] = useState<any>(null);
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

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

  if (!welcome) {
    return <div className="h-64 bg-[#111111] border border-[#2A2A2A] rounded-lg animate-pulse" />;
  }

  const selectedChannel = channels.find((c) => c.id === welcome.channelId);

  return (
    <div className="space-y-6">
      {/* Header & Status Overview */}
      <section className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#2A2A2A] pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-white" />
              <h2 className="text-sm font-semibold text-white">
                Server Management · Welcome Messages
              </h2>
              <span
                className={`px-2 py-0.5 text-[11px] font-mono border rounded ${
                  welcome.enabled
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border-[#2A2A2A] bg-[#181818] text-[#A0A0A0]'
                }`}
              >
                {welcome.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <p className="text-xs text-[#A0A0A0]">
              Automated greetings sent to new members joining {guild.name}.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#181818] border border-[#2A2A2A] text-[#D4D4D4] rounded-md hover:border-white hover:text-white"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              disabled={testing || !welcome.enabled || !welcome.channelId}
              onClick={handleTestWelcome}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5] disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{testing ? 'Sending Test...' : 'Test Welcome'}</span>
            </button>
          </div>
        </div>

        {/* Analytics & Diagnostics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-3.5">
            <div className="text-[11px] text-[#A0A0A0]">Selected Channel</div>
            <div className="text-sm font-semibold font-mono text-white mt-1 truncate">
              {selectedChannel ? `#${selectedChannel.name}` : 'Not configured'}
            </div>
          </div>

          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-3.5">
            <div className="text-[11px] text-[#A0A0A0]">Successful Welcomes</div>
            <div className="text-base font-semibold font-mono text-white mt-1 tabular-nums">
              {welcome.successCount ?? 0}
            </div>
          </div>

          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-3.5">
            <div className="text-[11px] text-[#A0A0A0]">Last Welcome Time</div>
            <div className="text-xs font-semibold font-mono text-white mt-1 truncate">
              {welcome.lastWelcomeAt ? new Date(welcome.lastWelcomeAt).toLocaleString() : 'Never'}
            </div>
          </div>

          <div className="bg-[#181818] border border-[#2A2A2A] rounded-md p-3.5">
            <div className="text-[11px] text-[#A0A0A0]">Configuration Errors</div>
            <div className="text-xs font-semibold font-mono text-red-400 mt-1 truncate">
              {welcome.lastError || 'None'}
            </div>
          </div>
        </div>
      </section>

      {/* Configuration Form */}
      <form onSubmit={handleSave} className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5 space-y-6">
        <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Welcome Configuration</h3>
            <p className="text-xs text-[#A0A0A0]">Configure message templates, embeds, avatars, and channels.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={welcome.enabled}
              onChange={(e) => setWelcome({ ...welcome, enabled: e.target.checked })}
              className="accent-white"
            />
            <span className="font-semibold text-white">Enable Welcome System</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="welcome-channel" className="block text-xs text-[#A0A0A0] mb-1">
              Welcome Channel
            </label>
            <select
              id="welcome-channel"
              value={welcome.channelId || ''}
              onChange={(e) => setWelcome({ ...welcome, channelId: e.target.value || null })}
              className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white font-mono"
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
            <label htmlFor="embed-color" className="block text-xs text-[#A0A0A0] mb-1">
              Embed Accent Color
            </label>
            <div className="flex items-center gap-2">
              <input
                id="embed-color"
                type="color"
                value={welcome.embedColor || '#ffffff'}
                onChange={(e) => setWelcome({ ...welcome, embedColor: e.target.value })}
                className="w-10 h-9 bg-[#181818] border border-[#2A2A2A] rounded cursor-pointer p-1"
              />
              <input
                type="text"
                value={welcome.embedColor || '#ffffff'}
                onChange={(e) => setWelcome({ ...welcome, embedColor: e.target.value })}
                className="flex-1 bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white font-mono"
              />
            </div>
          </div>
        </div>

        {/* Message Template Editor */}
        <div className="space-y-2">
          <label htmlFor="message-template" className="block text-xs text-[#A0A0A0]">
            Plain Text Message Template
          </label>
          <textarea
            id="message-template"
            rows={2}
            value={welcome.messageTemplate || ''}
            onChange={(e) => setWelcome({ ...welcome, messageTemplate: e.target.value })}
            className="w-full bg-[#181818] border border-[#2A2A2A] rounded-md p-3 text-sm text-white font-mono focus:outline-none focus:border-white"
          />
        </div>

        {/* Embed Settings */}
        <div className="space-y-4 pt-2 border-t border-[#2A2A2A]">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[#A0A0A0]">Rich Embed Options</h4>
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={welcome.embedEnabled}
                onChange={(e) => setWelcome({ ...welcome, embedEnabled: e.target.checked })}
                className="accent-white"
              />
              <span>Enable Embed</span>
            </label>
          </div>

          {welcome.embedEnabled && (
            <div className="space-y-4 p-4 bg-[#181818] border border-[#2A2A2A] rounded-md">
              <div>
                <label htmlFor="embed-title" className="block text-xs text-[#A0A0A0] mb-1">
                  Embed Title
                </label>
                <input
                  id="embed-title"
                  type="text"
                  value={welcome.embedTitle || ''}
                  onChange={(e) => setWelcome({ ...welcome, embedTitle: e.target.value })}
                  className="w-full bg-black border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white font-mono"
                />
              </div>

              <div>
                <label htmlFor="embed-desc" className="block text-xs text-[#A0A0A0] mb-1">
                  Embed Description
                </label>
                <textarea
                  id="embed-desc"
                  rows={3}
                  value={welcome.embedDescription || ''}
                  onChange={(e) => setWelcome({ ...welcome, embedDescription: e.target.value })}
                  className="w-full bg-black border border-[#2A2A2A] rounded-md p-3 text-sm text-white font-mono"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="embed-thumb" className="block text-xs text-[#A0A0A0] mb-1">
                    Custom Thumbnail URL (Optional)
                  </label>
                  <input
                    id="embed-thumb"
                    type="text"
                    placeholder="https://..."
                    value={welcome.embedThumbnail || ''}
                    onChange={(e) => setWelcome({ ...welcome, embedThumbnail: e.target.value || null })}
                    className="w-full bg-black border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="embed-img" className="block text-xs text-[#A0A0A0] mb-1">
                    Banner / Image URL (Optional)
                  </label>
                  <input
                    id="embed-img"
                    type="text"
                    placeholder="https://..."
                    value={welcome.embedImage || ''}
                    onChange={(e) => setWelcome({ ...welcome, embedImage: e.target.value || null })}
                    className="w-full bg-black border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div>
                  <label htmlFor="embed-footer" className="block text-xs text-[#A0A0A0] mb-1">
                    Embed Footer Text
                  </label>
                  <input
                    id="embed-footer"
                    type="text"
                    value={welcome.embedFooter || ''}
                    onChange={(e) => setWelcome({ ...welcome, embedFooter: e.target.value || null })}
                    className="w-full bg-black border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white font-mono"
                  />
                </div>
                <div className="pt-5">
                  <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={welcome.showMemberAvatar}
                      onChange={(e) => setWelcome({ ...welcome, showMemberAvatar: e.target.checked })}
                      className="accent-white"
                    />
                    <span>Show Joining Member Avatar as Thumbnail</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Placeholders Guide */}
        <div className="p-4 bg-[#181818] border border-[#2A2A2A] rounded-md space-y-2 text-xs">
          <div className="font-semibold text-white">Supported Placeholders</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[#A0A0A0]">
            <div><code className="text-white">{"{user}"}</code>: Member mention</div>
            <div><code className="text-white">{"{username}"}</code>: Username</div>
            <div><code className="text-white">{"{displayName}"}</code>: Display name</div>
            <div><code className="text-white">{"{server}"}</code>: Server name</div>
            <div><code className="text-white">{"{memberCount}"}</code>: Member count</div>
            <div><code className="text-white">{"{userId}"}</code>: User ID</div>
            <div><code className="text-white">{"{serverId}"}</code>: Server ID</div>
            <div><code className="text-white">{"{createdAt}"}</code>: Account date</div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5] disabled:opacity-50"
        >
          {saving ? 'Saving Settings...' : 'Save Welcome Settings'}
        </button>
      </form>
    </div>
  );
}
