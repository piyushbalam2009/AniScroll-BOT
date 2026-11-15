import React, { useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  ChevronDown,
  Disc3,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Server,
  Settings,
  Shield,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { GuildSummary, SessionUser } from '../lib/api';
import { AniScrollLogo } from './Logo';

export type DashboardRoute =
  | '/dashboard'
  | '/moderation'
  | '/community'
  | '/welcome'
  | '/music'
  | '/anime'
  | '/notifications'
  | '/analytics'
  | '/settings';

interface DashboardShellProps {
  activeRoute: DashboardRoute;
  onNavigate: (route: string) => void;
  user: SessionUser;
  guilds: GuildSummary[];
  selectedGuild: GuildSummary | null;
  onSelectGuild: (guildId: string) => void;
  onLogout: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{ route: DashboardRoute; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { route: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { route: '/moderation', label: 'Moderation', icon: Shield },
  { route: '/community', label: 'Community', icon: Users },
  { route: '/welcome', label: 'Welcome Messages', icon: MessageSquare },
  { route: '/music', label: 'Music', icon: Disc3 },
  { route: '/anime', label: 'Anime & Watchlist', icon: Sparkles },
  { route: '/notifications', label: 'Notifications', icon: Bell },
  { route: '/analytics', label: 'Analytics', icon: BarChart3 },
  { route: '/settings', label: 'Settings', icon: Settings },
];

export function DashboardShell({
  activeRoute,
  onNavigate,
  user,
  guilds,
  selectedGuild,
  onSelectGuild,
  onLogout,
  title,
  subtitle,
  children,
}: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#111111] border-r border-[#2A2A2A]">
      <div className="px-5 py-5 border-b border-[#2A2A2A] flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-md"
        >
          <AniScrollLogo size={26} />
          <span className="font-semibold text-base tracking-tight text-white whitespace-nowrap shrink-0">
            AniScroll Bot
          </span>
        </button>
        <button
          type="button"
          aria-label="Close navigation drawer"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-2 text-[#A0A0A0] hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 border-b border-[#2A2A2A]">
        <label htmlFor="guild-switcher" className="block text-xs text-[#A0A0A0] mb-1.5">
          Active Server
        </label>
        <div className="relative">
          <select
            id="guild-switcher"
            value={selectedGuild?.discordGuildId || ''}
            onChange={(e) => onSelectGuild(e.target.value)}
            className="w-full appearance-none bg-[#181818] border border-[#2A2A2A] text-white text-sm rounded-md px-3 py-2 pr-8 focus:outline-none focus:border-white"
          >
            {guilds.map((g) => (
              <option key={g.discordGuildId} value={g.discordGuildId}>
                {g.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-[#A0A0A0] pointer-events-none absolute right-2.5 top-2.5" />
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/servers')}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#A0A0A0] hover:text-white transition-colors"
        >
          <Server className="w-3.5 h-3.5" />
          Switch server directory
        </button>
      </div>

      <nav aria-label="Dashboard sections" className="flex-1 p-3 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeRoute === item.route;
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => {
                onNavigate(item.route);
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[#222222] text-white border border-[#2A2A2A]'
                  : 'text-[#A0A0A0] hover:text-white hover:bg-[#181818]'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[#2A2A2A] bg-[#0B0B0B]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{user.username}</div>
            <div className="text-xs text-[#A0A0A0] truncate">
              {user.mode === 'discord_oauth' ? 'Discord OAuth2' : 'Local Admin Sandbox'}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
            className="p-2 rounded-md border border-[#2A2A2A] text-[#A0A0A0] hover:text-white hover:bg-[#181818] transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[85vw] h-full">{sidebarContent}</div>
          <button
            type="button"
            aria-label="Close menu backdrop"
            className="flex-1 bg-black/70"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-black/95 backdrop-blur border-b border-[#2A2A2A] px-4 sm:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-md border border-[#2A2A2A] text-[#A0A0A0] hover:text-white"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-xs text-[#A0A0A0] truncate">
                {selectedGuild?.name || 'Workspace'} / {title}
              </div>
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-white truncate">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('/anime')}
              className="hidden sm:inline-flex items-center gap-2 px-3 py-2 text-xs font-medium bg-[#111111] border border-[#2A2A2A] rounded-md text-white hover:bg-[#181818] transition-colors whitespace-nowrap shrink-0"
            >
              <Activity className="w-3.5 h-3.5" />
              Hoshika Search
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-8 py-6 max-w-[1280px] w-full mx-auto">
          {subtitle && <p className="text-sm text-[#A0A0A0] mb-6">{subtitle}</p>}
          {children}
        </main>
      </div>
    </div>
  );
}
