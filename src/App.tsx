import React, { useCallback, useEffect, useState } from 'react';
import { apiRequest, GuildSummary, SessionInfo, setCsrfToken } from './lib/api';
import { DashboardRoute, DashboardShell } from './components/DashboardShell';
import { LandingPage } from './pages/LandingPage';
import { LoginPage, ServersPage } from './pages/LoginAndServersPage';
import { OverviewPage } from './pages/OverviewPage';
import { ModerationPage } from './pages/ModerationPage';
import { CommunityPage } from './pages/CommunityPage';
import { WelcomeMessagesPage } from './pages/WelcomeMessagesPage';
import { MusicPage } from './pages/MusicPage';
import { AnimeWatchlistPage } from './pages/AnimeWatchlistPage';
import { AnalyticsPage, NotificationsPage, SettingsPage } from './pages/NotificationsAndAnalyticsPage';

const ROUTE_META: Record<DashboardRoute, { title: string; subtitle: string }> = {
  '/dashboard': {
    title: 'Server Overview',
    subtitle: 'Real-time operational metrics, service health, and recent audit activity.',
  },
  '/moderation': {
    title: 'Moderation & AutoMod',
    subtitle: 'Manage warning escalations, moderation cases, and automated security filters.',
  },
  '/community': {
    title: 'Community Management',
    subtitle: 'Configure reaction role panels, suggestions, tickets, polls, and giveaways.',
  },
  '/welcome': {
    title: 'Server Management · Welcome Messages',
    subtitle: 'Configure automated welcome greetings, custom embeds, member avatar previews, and test deliveries.',
  },
  '/music': {
    title: 'Music & Lavalink v4',
    subtitle: 'Configure DJ roles, volume caps, queue limits, and 24/7 voice persistence.',
  },
  '/anime': {
    title: 'Anime & Personal Watchlist',
    subtitle: 'Probe live Hoshika metadata directly and manage your persisted anime watchlist.',
  },
  '/notifications': {
    title: 'Announcements & Notifications',
    subtitle: 'Compose and dispatch server announcements with full delivery history.',
  },
  '/analytics': {
    title: 'Analytics & Telemetry',
    subtitle: 'Metrics aggregated strictly from recorded bot commands, searches, and moderation logs.',
  },
  '/settings': {
    title: 'Server Settings & Cache',
    subtitle: 'Configure audit logging channels and manage runtime cache invalidation.',
  },
};

export default function App() {
  const [path, setPath] = useState<string>(() => window.location.pathname || '/');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string>(() => {
    return window.localStorage.getItem('aniscroll_guild_id') || '';
  });
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const navigate = useCallback((nextPath: string) => {
    if (nextPath !== window.location.pathname) {
      window.history.pushState({}, '', nextPath);
    }
    setPath(nextPath);
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const refreshSessionAndGuilds = useCallback(async () => {
    const [sess, healthRes] = await Promise.all([
      apiRequest<SessionInfo>('/api/v1/auth/session'),
      apiRequest('/api/v1/health').catch(() => null),
    ]);
    setSession(sess);
    if (healthRes) setHealth(healthRes);

    if (sess.authenticated && sess.user) {
      setCsrfToken(sess.user.csrfToken);
      const guildsRes = await apiRequest<{ guilds: GuildSummary[] }>('/api/v1/guilds');
      setGuilds(guildsRes.guilds);
      if (guildsRes.guilds.length > 0) {
        setSelectedGuildId((prev) =>
          guildsRes.guilds.some((g) => g.discordGuildId === prev)
            ? prev
            : guildsRes.guilds[0].discordGuildId
        );
      }
    } else {
      setCsrfToken('');
      setGuilds([]);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      apiRequest('/api/v1/auth/sandbox', { method: 'POST' })
        .then(() => refreshSessionAndGuilds())
        .then(() => navigate('/dashboard'))
        .catch(() => refreshSessionAndGuilds());
    } else {
      refreshSessionAndGuilds().catch(() => undefined);
    }
  }, [navigate, refreshSessionAndGuilds]);

  const handleSelectGuild = (guildId: string) => {
    setSelectedGuildId(guildId);
    window.localStorage.setItem('aniscroll_guild_id', guildId);
  };

  const handleLogout = async () => {
    await apiRequest('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    await refreshSessionAndGuilds();
    navigate('/');
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center text-sm text-[#A0A0A0]">
        Loading AniScroll Bot...
      </div>
    );
  }

  const toastBanner = toast ? (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 bg-[#181818] border border-white/30 text-white text-xs px-4 py-2.5 rounded-md shadow-lg"
    >
      {toast}
    </div>
  ) : null;

  if (path === '/') {
    return (
      <>
        <LandingPage onNavigate={navigate} health={health} authenticated={session.authenticated} />
        {toastBanner}
      </>
    );
  }

  if (path === '/login' || !session.authenticated || !session.user) {
    return (
      <>
        <LoginPage session={session} onAuthSuccess={refreshSessionAndGuilds} onNavigate={navigate} />
        {toastBanner}
      </>
    );
  }

  if (path === '/servers') {
    return (
      <>
        <ServersPage
          guilds={guilds}
          botInviteUrl={session.botInviteUrl || health?.botInviteUrl}
          onSelectGuild={handleSelectGuild}
          onNavigate={navigate}
          onLogout={handleLogout}
        />
        {toastBanner}
      </>
    );
  }

  const activeRoute: DashboardRoute =
    path in ROUTE_META ? (path as DashboardRoute) : '/dashboard';
  const activeGuild =
    guilds.find((g) => g.discordGuildId === selectedGuildId) || guilds[0] || null;
  const meta = ROUTE_META[activeRoute];

  return (
    <>
      <DashboardShell
        activeRoute={activeRoute}
        onNavigate={navigate}
        user={session.user}
        guilds={guilds}
        selectedGuild={activeGuild}
        onSelectGuild={handleSelectGuild}
        onLogout={handleLogout}
        title={meta.title}
        subtitle={meta.subtitle}
      >
        {!activeGuild ? (
          <div className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-6 text-sm text-[#A0A0A0]">
            No manageable servers found.
          </div>
        ) : activeRoute === '/dashboard' ? (
          <OverviewPage guildId={activeGuild.discordGuildId} onToast={showToast} />
        ) : activeRoute === '/moderation' ? (
          <ModerationPage guildId={activeGuild.discordGuildId} onToast={showToast} />
        ) : activeRoute === '/community' ? (
          <CommunityPage guild={activeGuild} onToast={showToast} />
        ) : activeRoute === '/welcome' ? (
          <WelcomeMessagesPage guild={activeGuild} onToast={showToast} />
        ) : activeRoute === '/music' ? (
          <MusicPage guild={activeGuild} health={health} onToast={showToast} />
        ) : activeRoute === '/anime' ? (
          <AnimeWatchlistPage guildId={activeGuild.discordGuildId} onToast={showToast} />
        ) : activeRoute === '/notifications' ? (
          <NotificationsPage guild={activeGuild} onToast={showToast} />
        ) : activeRoute === '/analytics' ? (
          <AnalyticsPage guildId={activeGuild.discordGuildId} onToast={showToast} />
        ) : (
          <SettingsPage guild={activeGuild} session={session} health={health} onToast={showToast} />
        )}
      </DashboardShell>
      {toastBanner}
    </>
  );
}
