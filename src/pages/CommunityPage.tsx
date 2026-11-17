import React, { useCallback, useEffect, useState } from 'react';
import { apiRequest, GuildSummary } from '../lib/api';

interface CommunityPageProps {
  guild: GuildSummary;
  onToast: (msg: string) => void;
}

type CommunityTab = 'recommendations' | 'welcome' | 'roles' | 'suggestions' | 'tickets' | 'polls';

export function CommunityPage({ guild, onToast }: CommunityPageProps) {
  const [tab, setTab] = useState<CommunityTab>('recommendations');
  const [welcome, setWelcome] = useState<any>(null);
  const [animeConfig, setAnimeConfig] = useState<any>(null);
  const [community, setCommunity] = useState<any>(null);

  const [newSuggestion, setNewSuggestion] = useState('');
  const [newTicketSubject, setNewTicketSubject] = useState('');
  const [newPollQuestion, setNewPollQuestion] = useState('');
  const [newPollOptions, setNewPollOptions] = useState('Yes, No');
  const [newGiveawayPrize, setNewGiveawayPrize] = useState('');
  const [panelTitle, setPanelTitle] = useState('');
  const [panelRoleId, setPanelRoleId] = useState(guild.roles[0]?.id || '');

  const load = useCallback(async () => {
    try {
      const [settingsRes, commRes] = await Promise.all([
        apiRequest(`/api/v1/guilds/${guild.discordGuildId}/settings`),
        apiRequest(`/api/v1/guilds/${guild.discordGuildId}/community`),
      ]);
      setWelcome(settingsRes.settings.welcomeConfig);
      setAnimeConfig({
        recommendationEnabled: true,
        recommendationCooldownSeconds: 15,
        recommendationAnalyticsEnabled: true,
        recommendationAllowedChannelIds: [],
        ...settingsRes.settings.animeConfig,
      });
      setCommunity(commRes);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to load community data.');
    }
  }, [guild.discordGuildId, onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const saveRecommendationSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!animeConfig) return;
    try {
      await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/settings/animeConfig`, {
        method: 'PUT',
        body: JSON.stringify(animeConfig),
      });
      onToast('Community recommendation settings saved.');
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to save recommendation settings.');
    }
  };

  const toggleAllowedRecommendationChannel = (channelId: string) => {
    if (!animeConfig) return;
    const current: string[] = Array.isArray(animeConfig.recommendationAllowedChannelIds)
      ? animeConfig.recommendationAllowedChannelIds
      : [];
    const next = current.includes(channelId)
      ? current.filter((id) => id !== channelId)
      : [...current, channelId];
    setAnimeConfig({ ...animeConfig, recommendationAllowedChannelIds: next });
  };

  const saveWelcome = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/settings/welcomeConfig`, {
        method: 'PUT',
        body: JSON.stringify(welcome),
      });
      onToast('Welcome settings saved.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to save welcome settings.');
    }
  };

  const createSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSuggestion.trim()) return;
    try {
      await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/community/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ content: newSuggestion }),
      });
      setNewSuggestion('');
      onToast('Suggestion created.');
      load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to create suggestion.');
    }
  };

  const voteSuggestion = async (id: string, vote: 'up' | 'down') => {
    await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/community/suggestions/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote }),
    });
    load();
  };

  const updateSuggestionStatus = async (id: string, status: string) => {
    await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/community/suggestions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    onToast(`Suggestion marked ${status}.`);
    load();
  };

  const createTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicketSubject.trim()) return;
    await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/community/tickets`, {
      method: 'POST',
      body: JSON.stringify({ subject: newTicketSubject, category: 'GENERAL_SUPPORT' }),
    });
    setNewTicketSubject('');
    onToast('Ticket created.');
    load();
  };

  const updateTicket = async (id: string, status: 'CLAIMED' | 'CLOSED' | 'OPEN') => {
    await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/community/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    onToast(`Ticket ${status.toLowerCase()}.`);
    load();
  };

  const createPoll = async (e: React.FormEvent) => {
    e.preventDefault();
    const options = newPollOptions.split(',').map((s) => s.trim()).filter(Boolean);
    if (!newPollQuestion.trim() || options.length < 2) {
      onToast('Provide a question and at least 2 comma-separated options.');
      return;
    }
    await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/community/polls`, {
      method: 'POST',
      body: JSON.stringify({
        channelId: guild.channels[0]?.id || '110000000000000001',
        question: newPollQuestion,
        options,
        allowMultiple: false,
        durationMinutes: 1440,
      }),
    });
    setNewPollQuestion('');
    onToast('Poll created.');
    load();
  };

  const createGiveaway = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGiveawayPrize.trim()) return;
    await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/community/giveaways`, {
      method: 'POST',
      body: JSON.stringify({
        channelId: guild.channels[0]?.id || '110000000000000001',
        prize: newGiveawayPrize,
        winnerCount: 1,
        durationMinutes: 1440,
      }),
    });
    setNewGiveawayPrize('');
    onToast('Giveaway created.');
    load();
  };

  const drawGiveaway = async (id: string) => {
    await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/community/giveaways/${id}/draw`, {
      method: 'POST',
    });
    onToast('Giveaway winners drawn.');
    load();
  };

  const createPanel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!panelTitle.trim() || !panelRoleId) return;
    const roleObj = guild.roles.find((r) => r.id === panelRoleId);
    await apiRequest(`/api/v1/guilds/${guild.discordGuildId}/community/reaction-roles`, {
      method: 'POST',
      body: JSON.stringify({
        channelId: guild.channels[0]?.id || '110000000000000001',
        title: panelTitle,
        description: 'Self-assignable community role panel',
        mode: 'BUTTON',
        exclusive: false,
        maxSelections: 1,
        roles: [{ roleId: panelRoleId, label: roleObj?.name || 'Member Role' }],
      }),
    });
    setPanelTitle('');
    onToast('Reaction role panel saved.');
    load();
  };

  if (!welcome || !community || !animeConfig) {
    return (
      <div className="space-y-6">
        <div className="h-12 bg-[#111114] border border-[#27272A] rounded-lg animate-pulse" />
        <div className="h-64 bg-[#111114] border border-[#27272A] rounded-lg animate-pulse" />
      </div>
    );
  }

  const recStats = community.recommendations || {
    totalRecommendations: 0,
    topRecommendedAnime: [],
    topRecommendingMembers: [],
    channelActivity: [],
    recentRecommendations: [],
  };

  const resolveChannelName = (channelId: string) => {
    const ch = guild.channels.find((c) => c.id === channelId);
    return ch ? `#${ch.name}` : `#${channelId}`;
  };

  return (
    <div className="space-y-6">
      {/* Segmented Tab Navigation */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#111114] border border-[#27272A] rounded-md">
        {[
          { id: 'recommendations', label: 'Recommendations' },
          { id: 'welcome', label: 'Welcome' },
          { id: 'roles', label: 'Reaction Roles' },
          { id: 'suggestions', label: 'Suggestions' },
          { id: 'tickets', label: 'Support Tickets' },
          { id: 'polls', label: 'Polls & Giveaways' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as CommunityTab)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              tab === t.id ? 'bg-white text-black font-semibold' : 'text-[#A1A1AA] hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'recommendations' && (
        <div className="space-y-6">
          {/* KPI Summary Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#111114] border border-[#27272A] rounded-lg p-4">
              <div className="text-xs text-[#A1A1AA]">Total Recommendations</div>
              <div className="mt-1.5 text-2xl font-semibold text-white font-mono tabular-nums">
                {recStats.totalRecommendations}
              </div>
              <div className="mt-1 text-xs text-[#71717A]">Public cards via /anime recommendation</div>
            </div>

            <div className="bg-[#111114] border border-[#27272A] rounded-lg p-4">
              <div className="text-xs text-[#A1A1AA]">Top Recommended Anime</div>
              <div className="mt-1.5 text-sm font-semibold text-white truncate">
                {recStats.topRecommendedAnime[0]?.animeTitle || 'No recommendations yet'}
              </div>
              <div className="mt-1 text-xs text-[#71717A] font-mono tabular-nums">
                {recStats.topRecommendedAnime[0]
                  ? `ID #${recStats.topRecommendedAnime[0].hoshikaShortId} · ${recStats.topRecommendedAnime[0].count}x`
                  : 'Waiting for activity'}
              </div>
            </div>

            <div className="bg-[#111114] border border-[#27272A] rounded-lg p-4">
              <div className="text-xs text-[#A1A1AA]">Top Recommending Member</div>
              <div className="mt-1.5 text-sm font-semibold text-white truncate">
                {recStats.topRecommendingMembers[0]
                  ? `@${recStats.topRecommendingMembers[0].username}`
                  : 'No active members'}
              </div>
              <div className="mt-1 text-xs text-[#71717A] font-mono tabular-nums">
                {recStats.topRecommendingMembers[0]
                  ? `${recStats.topRecommendingMembers[0].count} published`
                  : 'Run /anime recommendation'}
              </div>
            </div>

            <div className="bg-[#111114] border border-[#27272A] rounded-lg p-4">
              <div className="text-xs text-[#A1A1AA]">Command Status</div>
              <div className="mt-1.5 text-sm font-semibold text-white font-mono">
                {animeConfig.recommendationEnabled !== false ? 'ENABLED' : 'DISABLED'}
              </div>
              <div className="mt-1 text-xs text-[#71717A] font-mono tabular-nums">
                Cooldown: {animeConfig.recommendationCooldownSeconds ?? 15}s
              </div>
            </div>
          </div>

          {/* Administrator Configuration */}
          <form
            onSubmit={saveRecommendationSettings}
            className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#27272A] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-white">/anime recommendation Settings</h2>
                <p className="text-xs text-[#A1A1AA] mt-0.5">
                  Control channel restrictions, per-user cooldowns, and public card publishing.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={animeConfig.recommendationEnabled !== false}
                    onChange={(e) =>
                      setAnimeConfig({ ...animeConfig, recommendationEnabled: e.target.checked })
                    }
                    className="accent-white"
                  />
                  <span>Enable Command</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={animeConfig.recommendationAnalyticsEnabled !== false}
                    onChange={(e) =>
                      setAnimeConfig({
                        ...animeConfig,
                        recommendationAnalyticsEnabled: e.target.checked,
                      })
                    }
                    className="accent-white"
                  />
                  <span>Analytics</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="rec-cooldown" className="block text-xs text-[#A1A1AA] mb-1.5">
                  Per-User Cooldown (seconds)
                </label>
                <input
                  id="rec-cooldown"
                  type="number"
                  min={0}
                  max={3600}
                  value={animeConfig.recommendationCooldownSeconds ?? 15}
                  onChange={(e) =>
                    setAnimeConfig({
                      ...animeConfig,
                      recommendationCooldownSeconds: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono tabular-nums"
                />
              </div>

              <div className="md:col-span-2">
                <span className="block text-xs text-[#A1A1AA] mb-1.5">
                  Restrict Recommendation Channels (leave empty to allow all text channels)
                </span>
                <div className="flex flex-wrap gap-2 p-2.5 bg-[#18181C] border border-[#27272A] rounded-md">
                  {guild.channels
                    .filter((c) => c.type === 'text')
                    .map((c) => {
                      const selected =
                        Array.isArray(animeConfig.recommendationAllowedChannelIds) &&
                        animeConfig.recommendationAllowedChannelIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleAllowedRecommendationChannel(c.id)}
                          className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
                            selected
                              ? 'bg-white text-black border-white font-semibold'
                              : 'bg-[#111114] text-[#A1A1AA] border-[#27272A] hover:text-white'
                          }`}
                        >
                          #{c.name}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-[#71717A] font-mono">
                Uses Hoshika API (GET /api/v1/search &amp; /api/v1/anime/&#123;shortId&#125;)
              </span>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7]"
              >
                Save Recommendation Settings
              </button>
            </div>
          </form>

          {/* Analytics Breakdown Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-3">
              <h3 className="text-xs font-semibold text-white">Most Recommended Anime</h3>
              {recStats.topRecommendedAnime.length === 0 ? (
                <p className="text-xs text-[#71717A]">No recommendations recorded yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {recStats.topRecommendedAnime.map((item: any, idx: number) => (
                    <div
                      key={item.hoshikaShortId}
                      className="flex items-center justify-between gap-2 border-b border-[#1E1E24] pb-2 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {idx + 1}. {item.animeTitle}
                        </div>
                        <div className="text-[11px] font-mono text-[#71717A]">
                          ID #{item.hoshikaShortId}
                        </div>
                      </div>
                      <span className="text-xs font-mono font-semibold text-white tabular-nums shrink-0">
                        {item.count}x
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-3">
              <h3 className="text-xs font-semibold text-white">Top Recommending Members</h3>
              {recStats.topRecommendingMembers.length === 0 ? (
                <p className="text-xs text-[#71717A]">No member activity recorded yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {recStats.topRecommendingMembers.map((member: any, idx: number) => (
                    <div
                      key={member.discordUserId}
                      className="flex items-center justify-between gap-2 border-b border-[#1E1E24] pb-2 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {idx + 1}. @{member.username}
                        </div>
                        <div className="text-[11px] font-mono text-[#71717A]">
                          ID: {member.discordUserId}
                        </div>
                      </div>
                      <span className="text-xs font-mono font-semibold text-white tabular-nums shrink-0">
                        {member.count} posted
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#111111] border border-[#27272A] rounded-lg p-5 space-y-3">
              <h3 className="text-xs font-semibold text-white">Channel Activity</h3>
              {recStats.channelActivity.length === 0 ? (
                <p className="text-xs text-[#71717A]">No channel activity recorded yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {recStats.channelActivity.map((ch: any) => (
                    <div
                      key={ch.channelId}
                      className="flex items-center justify-between gap-2 border-b border-[#1E1E24] pb-2 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-mono font-medium text-white truncate">
                          {resolveChannelName(ch.channelId)}
                        </div>
                        <div className="text-[11px] font-mono text-[#71717A]">
                          ID: {ch.channelId}
                        </div>
                      </div>
                      <span className="text-xs font-mono font-semibold text-white tabular-nums shrink-0">
                        {ch.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Recommendations Table */}
          <div className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#27272A]">
              <h3 className="text-xs font-semibold text-white">Recent Public Recommendations</h3>
              <span className="text-xs font-mono text-[#71717A] tabular-nums">
                Showing {recStats.recentRecommendations.length} of {recStats.totalRecommendations}
              </span>
            </div>

            {recStats.recentRecommendations.length === 0 ? (
              <p className="text-xs text-[#71717A]">
                No public recommendations posted yet. Run{' '}
                <code className="text-white">/anime recommendation</code> in Discord.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#27272A] text-[#71717A] font-medium">
                      <th className="py-2 pr-4">Anime Title</th>
                      <th className="py-2 px-4">Hoshika ID</th>
                      <th className="py-2 px-4">Recommended By</th>
                      <th className="py-2 px-4">Channel</th>
                      <th className="py-2 px-4">Published At</th>
                      <th className="py-2 pl-4 text-right">AniScroll Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E1E24]">
                    {recStats.recentRecommendations.map((rec: any) => (
                      <tr key={rec.id} className="hover:bg-[#18181C]/60">
                        <td className="py-2.5 pr-4 font-medium text-white">{rec.animeTitle}</td>
                        <td className="py-2.5 px-4 font-mono text-[#A1A1AA] tabular-nums">
                          #{rec.hoshikaShortId}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#A1A1AA]">
                          @{rec.username || rec.discordUserId}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#A1A1AA]">
                          {resolveChannelName(rec.channelId)}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#71717A] tabular-nums">
                          {String(rec.createdAt).slice(0, 16).replace('T', ' ')} UTC
                        </td>
                        <td className="py-2.5 pl-4 text-right font-mono">
                          {rec.aniscrollUrl ? (
                            <a
                              href={rec.aniscrollUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-white underline hover:text-[#E4E4E7]"
                            >
                              Open AniScroll
                            </a>
                          ) : (
                            <span className="text-[#71717A]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'welcome' && (
        <form
          onSubmit={saveWelcome}
          className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#27272A]">
            <h2 className="text-sm font-semibold text-white">Welcome &amp; Farewell System</h2>
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={welcome.enabled}
                onChange={(e) => setWelcome({ ...welcome, enabled: e.target.checked })}
                className="accent-white"
              />
              <span>Enable Welcome</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="welcome-ch" className="block text-xs text-[#A1A1AA] mb-1">
                Welcome Channel
              </label>
              <select
                id="welcome-ch"
                value={welcome.channelId || ''}
                onChange={(e) => setWelcome({ ...welcome, channelId: e.target.value || null })}
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
              >
                <option value="">Select channel...</option>
                {guild.channels
                  .filter((c) => c.type === 'text')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor="welcome-title" className="block text-xs text-[#A1A1AA] mb-1">
                Embed Title
              </label>
              <input
                id="welcome-title"
                type="text"
                value={welcome.embedTitle}
                onChange={(e) => setWelcome({ ...welcome, embedTitle: e.target.value })}
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono"
              />
            </div>
          </div>

          <div>
            <label htmlFor="welcome-msg" className="block text-xs text-[#A1A1AA] mb-1">
              Message Template (supports {'{user}'}, {'{username}'}, {'{server}'},{' '}
              {'{memberCount}'})
            </label>
            <textarea
              id="welcome-msg"
              rows={2}
              value={welcome.messageTemplate}
              onChange={(e) => setWelcome({ ...welcome, messageTemplate: e.target.value })}
              className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white font-mono"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7]"
          >
            Save Welcome Settings
          </button>
        </form>
      )}

      {tab === 'roles' && (
        <div className="space-y-4">
          <form
            onSubmit={createPanel}
            className="bg-[#111114] border border-[#27272A] rounded-lg p-5 flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="rr-title" className="block text-xs text-[#A1A1AA] mb-1">
                Panel Title
              </label>
              <input
                id="rr-title"
                type="text"
                value={panelTitle}
                onChange={(e) => setPanelTitle(e.target.value)}
                placeholder="e.g. Genre Opt-In Roles"
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label htmlFor="rr-role" className="block text-xs text-[#A1A1AA] mb-1">
                Role
              </label>
              <select
                id="rr-role"
                value={panelRoleId}
                onChange={(e) => setPanelRoleId(e.target.value)}
                className="bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
              >
                {guild.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7]"
            >
              Create Role Panel
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {community.reactionRoles.map((p: any) => (
              <div key={p.id} className="bg-[#111114] border border-[#27272A] rounded-lg p-5">
                <div className="text-sm font-semibold text-white">{p.title}</div>
                <div className="mt-1 text-xs text-[#A1A1AA] font-mono">
                  Mode: {p.mode} · Roles: {p.roles.map((r: any) => r.label).join(', ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'suggestions' && (
        <div className="space-y-4">
          <form
            onSubmit={createSuggestion}
            className="bg-[#111114] border border-[#27272A] rounded-lg p-5 flex gap-3"
          >
            <input
              type="text"
              value={newSuggestion}
              onChange={(e) => setNewSuggestion(e.target.value)}
              placeholder="Submit a new community suggestion..."
              className="flex-1 bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7] whitespace-nowrap"
            >
              Submit Suggestion
            </button>
          </form>

          <div className="space-y-3">
            {community.suggestions.map((s: any) => (
              <div
                key={s.id}
                className="bg-[#111114] border border-[#27272A] rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <div className="text-sm text-white">{s.content}</div>
                  <div className="mt-1 text-xs text-[#A1A1AA] font-mono tabular-nums">
                    Status: {s.status} · Upvotes: {s.upvotes} · Downvotes: {s.downvotes}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => voteSuggestion(s.id, 'up')}
                    className="px-2.5 py-1 text-xs border border-[#27272A] rounded hover:border-white/70"
                  >
                    Upvote
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSuggestionStatus(s.id, 'APPROVED')}
                    className="px-2.5 py-1 text-xs border border-[#27272A] rounded hover:border-white/70"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSuggestionStatus(s.id, 'IMPLEMENTED')}
                    className="px-2.5 py-1 text-xs bg-white text-black rounded font-medium"
                  >
                    Implemented
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'tickets' && (
        <div className="space-y-4">
          <form
            onSubmit={createTicket}
            className="bg-[#111114] border border-[#27272A] rounded-lg p-5 flex gap-3"
          >
            <input
              type="text"
              value={newTicketSubject}
              onChange={(e) => setNewTicketSubject(e.target.value)}
              placeholder="Ticket subject..."
              className="flex-1 bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7] whitespace-nowrap"
            >
              Open Ticket
            </button>
          </form>

          <div className="space-y-3">
            {community.tickets.map((t: any) => (
              <div
                key={t.id}
                className="bg-[#111114] border border-[#27272A] rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="text-sm font-medium text-white">{t.subject || 'Support Ticket'}</div>
                  <div className="text-xs text-[#A1A1AA] font-mono mt-0.5">
                    {t.category} · Status: {t.status} · User {t.userId}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {t.status !== 'CLOSED' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => updateTicket(t.id, 'CLAIMED')}
                        className="px-2.5 py-1 text-xs border border-[#27272A] rounded hover:border-white/70"
                      >
                        Claim
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTicket(t.id, 'CLOSED')}
                        className="px-2.5 py-1 text-xs bg-white text-black rounded font-medium"
                      >
                        Close
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => updateTicket(t.id, 'OPEN')}
                      className="px-2.5 py-1 text-xs border border-[#27272A] rounded hover:border-white/70"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'polls' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <form
              onSubmit={createPoll}
              className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-3"
            >
              <h2 className="text-sm font-semibold text-white">Create Poll</h2>
              <input
                type="text"
                value={newPollQuestion}
                onChange={(e) => setNewPollQuestion(e.target.value)}
                placeholder="Poll question..."
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
              />
              <input
                type="text"
                value={newPollOptions}
                onChange={(e) => setNewPollOptions(e.target.value)}
                placeholder="Comma-separated options"
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7]"
              >
                Launch Poll
              </button>
            </form>
            {community.polls.map((p: any) => (
              <div key={p.id} className="bg-[#111114] border border-[#27272A] rounded-lg p-4">
                <div className="text-sm font-medium text-white">{p.question}</div>
                <div className="mt-1 text-xs text-[#A1A1AA]">{p.options.join(' · ')}</div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <form
              onSubmit={createGiveaway}
              className="bg-[#111114] border border-[#27272A] rounded-lg p-5 space-y-3"
            >
              <h2 className="text-sm font-semibold text-white">Start Giveaway</h2>
              <input
                type="text"
                value={newGiveawayPrize}
                onChange={(e) => setNewGiveawayPrize(e.target.value)}
                placeholder="Giveaway prize..."
                className="w-full bg-[#18181C] border border-[#27272A] rounded-md px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E4E4E7]"
              >
                Start Giveaway
              </button>
            </form>
            {community.giveaways.map((g: any) => (
              <div
                key={g.id}
                className="bg-[#111114] border border-[#27272A] rounded-lg p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-sm font-medium text-white">{g.prize}</div>
                  <div className="text-xs text-[#A1A1AA] font-mono mt-0.5">
                    {g.ended ? `Ended · Winners: ${g.winnerIds.length}` : `Active · ${g.winnerCount} winner(s)`}
                  </div>
                </div>
                {!g.ended && (
                  <button
                    type="button"
                    onClick={() => drawGiveaway(g.id)}
                    className="px-3 py-1.5 text-xs border border-[#27272A] rounded hover:border-white/70"
                  >
                    Draw Now
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
