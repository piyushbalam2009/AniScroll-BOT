import React, { useEffect, useState } from 'react';
import { ArrowRight, ExternalLink, KeyRound, Server, ShieldAlert } from 'lucide-react';
import { AniScrollLogo } from '../components/Logo';
import { apiRequest, GuildSummary, SessionInfo } from '../lib/api';

interface LoginPageProps {
  session: SessionInfo;
  onAuthSuccess: () => Promise<void>;
  onNavigate: (path: string) => void;
}

export function LoginPage({ session, onAuthSuccess, onNavigate }: LoginPageProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        !event.origin.endsWith('.run.app') &&
        !event.origin.includes('localhost') &&
        event.origin !== window.location.origin
      ) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        onAuthSuccess().then(() => onNavigate('/servers'));
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setError('Discord OAuth2 authorization failed or was cancelled.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onAuthSuccess, onNavigate]);

  const handleDiscordOAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      const { url } = await apiRequest<{ url: string }>('/api/v1/auth/discord/url');
      const popup = window.open(url, 'discord_oauth', 'width=560,height=720');
      if (!popup) {
        setError('Popup was blocked by your browser. Please allow popups and try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start Discord OAuth2 flow.');
    } finally {
      setLoading(false);
    }
  };

  const handleSandboxEnter = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiRequest('/api/v1/auth/sandbox', { method: 'POST' });
      await onAuthSuccess();
      onNavigate('/servers');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enter sandbox session.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col justify-center items-center px-6 py-12">
      <div className="w-full max-w-md bg-[#111111] border border-[#2A2A2A] rounded-lg p-7">
        <div className="flex items-center gap-3 mb-6">
          <AniScrollLogo size={32} />
          <div>
            <h1 className="text-xl font-semibold text-white">AniScroll Bot Dashboard</h1>
            <p className="text-xs text-[#A0A0A0]">Authenticate with Discord to manage your servers</p>
          </div>
        </div>

        {error && (
          <div className="mb-5 p-3 bg-[#181818] border border-red-900/60 rounded-md text-xs text-red-400 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            disabled={loading || !session.oauthConfigured}
            onClick={handleDiscordOAuth}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-black text-sm font-semibold rounded-md hover:bg-[#E5E5E5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <KeyRound className="w-4 h-4" />
            <span>Login with Discord OAuth2</span>
          </button>

          {session.callbackUrl && (
            <div className="p-3 bg-[#181818] border border-[#2A2A2A] rounded-md text-xs text-[#A0A0A0] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white font-medium">
                  {session.oauthConfigured ? 'Registered Redirect URI' : 'Discord OAuth2 Not Configured'}
                </span>
                <span className="font-mono text-[10px] text-[#A0A0A0]">
                  Route: {session.callbackRoute || '/auth/callback'}
                </span>
              </div>
              {!session.oauthConfigured && (
                <p>
                  Set <code className="text-white font-mono">DISCORD_CLIENT_ID</code> and{' '}
                  <code className="text-white font-mono">DISCORD_CLIENT_SECRET</code> in your environment and add this callback URL in the Discord Developer Portal:
                </p>
              )}
              <code
                data-testid="registered-redirect-uri"
                className="block p-2 bg-black border border-[#2A2A2A] rounded font-mono text-[11px] text-white break-all select-all"
              >
                {session.callbackUrl}
              </code>
              {session.redirectUriWarning && (
                <div className="p-2 bg-black border border-amber-500/40 rounded text-[11px] text-amber-300 leading-relaxed">
                  {session.redirectUriWarning}
                </div>
              )}
              <p className="text-[11px] text-[#A0A0A0] leading-relaxed">
                Register this exact URL under <span className="text-white">OAuth2 → General → Redirects</span>. Never put a Discord bot invitation URL here.
              </p>
            </div>
          )}

          {session.botInviteUrl && (
            <div className="pt-2">
              <a
                href={session.botInviteUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#181818] border border-[#2A2A2A] text-white text-xs font-medium rounded-md hover:border-white/50 transition-colors"
              >
                <span>Add AniScroll Bot to a Server</span>
                <ExternalLink className="w-3.5 h-3.5 text-[#A0A0A0]" />
              </a>
              <p className="mt-1.5 text-[11px] text-[#A0A0A0] text-center">
                Separate bot invite flow (<code className="font-mono text-white">scope=bot applications.commands</code>).
              </p>
            </div>
          )}

          <div className="pt-3 border-t border-[#2A2A2A]">
            <button
              type="button"
              disabled={loading}
              onClick={handleSandboxEnter}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#181818] border border-[#2A2A2A] text-white text-sm font-medium rounded-md hover:bg-[#222222] transition-colors"
            >
              <span>Enter Local Admin Sandbox</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <p className="mt-2 text-[11px] text-[#A0A0A0] text-center">
              Uses real SQLite database persistence and live Hoshika API calls with pre-seeded guild environments.
            </p>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-[#2A2A2A] flex items-center justify-between text-xs text-[#A0A0A0]">
          <button type="button" onClick={() => onNavigate('/')} className="hover:text-white">
            Back to Home
          </button>
          <a
            href="https://discord.com/developers/applications"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-white"
          >
            <span>Discord Portal</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

interface ServersPageProps {
  guilds: GuildSummary[];
  botInviteUrl?: string | null;
  onSelectGuild: (guildId: string) => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

export function ServersPage({ guilds, botInviteUrl, onSelectGuild, onNavigate, onLogout }: ServersPageProps) {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-[#2A2A2A] px-6 py-4">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AniScrollLogo size={26} />
            <span className="font-semibold text-base">Select Server</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="text-xs text-[#A0A0A0] hover:text-white"
            >
              Home
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-1.5 text-xs border border-[#2A2A2A] rounded-md text-[#A0A0A0] hover:text-white"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 py-10">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">Manageable Discord Servers</h1>
            <p className="mt-1 text-sm text-[#A0A0A0]">
              Choose a guild where you hold Manage Server permissions to configure AniScroll Bot.
            </p>
          </div>
          {botInviteUrl && (
            <a
              href={botInviteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#111111] border border-[#2A2A2A] text-white rounded-md hover:border-white/50 whitespace-nowrap shrink-0"
            >
              <span>Add Bot to Another Server</span>
              <ExternalLink className="w-3.5 h-3.5 text-[#A0A0A0]" />
            </a>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {guilds.map((guild) => {
            const guildInviteHref = botInviteUrl
              ? `${botInviteUrl}&guild_id=${encodeURIComponent(guild.discordGuildId)}&disable_guild_select=false`
              : null;
            return (
              <div
                key={guild.discordGuildId}
                className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-5 flex flex-col justify-between gap-5"
              >
                <div className="flex items-start gap-3.5">
                  {guild.icon ? (
                    <img
                      src={guild.icon}
                      alt={guild.name}
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded-md object-cover bg-[#222222]"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-md bg-[#181818] border border-[#2A2A2A] flex items-center justify-center shrink-0">
                      <Server className="w-5 h-5 text-[#A0A0A0]" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-white truncate">{guild.name}</h2>
                    <div className="text-xs text-[#A0A0A0] font-mono tabular-nums mt-0.5">
                      {guild.memberCount.toLocaleString()} members ·{' '}
                      <span className={guild.botInstalled ? 'text-emerald-500' : 'text-amber-500'}>
                        {guild.botInstalled ? 'Bot Installed' : 'Not Installed'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectGuild(guild.discordGuildId);
                      onNavigate('/dashboard');
                    }}
                    className="flex-1 px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5] transition-colors"
                  >
                    {guild.botInstalled ? 'Manage Server' : 'Open Dashboard'}
                  </button>
                  {!guild.botInstalled && guildInviteHref && (
                    <a
                      href={guildInviteHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#181818] border border-[#2A2A2A] text-white rounded-md hover:border-white/50 whitespace-nowrap"
                    >
                      <span>Invite</span>
                      <ExternalLink className="w-3 h-3 text-[#A0A0A0]" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
