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

interface NavGroup {
  groupLabel: string;
  items: Array<{
    route: DashboardRoute;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupLabel: 'Operations',
    items: [
      { route: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { route: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    groupLabel: 'Moderation & Community',
    items: [
      { route: '/moderation', label: 'Moderation', icon: Shield },
      { route: '/community', label: 'Community', icon: Users },
      { route: '/welcome', label: 'Welcome Messages', icon: MessageSquare },
      { route: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    groupLabel: 'Media & Catalog',
    items: [
      { route: '/anime', label: 'Anime & Watchlist', icon: Sparkles },
      { route: '/music', label: 'Music', icon: Disc3 },
    ],
  },
  {
    groupLabel: 'System',
    items: [{ route: '/settings', label: 'Settings', icon: Settings }],
  },
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
    <div className="flex flex-col h-full bg-[#111114] border-r border-[#27272A]">
      <div className="px-5 py-4 border-b border-[#27272A] flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-md"
        >
          <AniScrollLogo size={24} />
          <span className="font-semibold text-sm tracking-tight text-white whitespace-nowrap shrink-0">
            AniScroll Bot
          </span>
        </button>
        <button
          type="button"
          aria-label="Close navigation drawer"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-2 text-[#A1A1AA] hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 border-b border-[#27272A]">
        <label htmlFor="guild-switcher" className="block text-xs text-[#A1A1AA] mb-1.5">
          Active server
        </label>
        <div className="relative">
          <select
            id="guild-switcher"
            value={selectedGuild?.discordGuildId || ''}
            onChange={(e) => onSelectGuild(e.target.value)}
            className="w-full appearance-none bg-[#18181C] border border-[#27272A] text-white text-sm rounded-md px-3 py-2 pr-8 focus:outline-none focus:border-white/70"
          >
            {guilds.map((g) => (
              <option key={g.discordGuildId} value={g.discordGuildId}>
                {g.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-[#A1A1AA] pointer-events-none absolute right-2.5 top-2.5" />
        </div>
        {selectedGuild && (
          <div className="mt-2 flex items-center justify-between text-[11px] text-[#71717A] font-mono tabular-nums">
            <span>{selectedGuild.memberCount.toLocaleString()} members</span>
            <button
              type="button"
              onClick={() => onNavigate('/servers')}
              className="inline-flex items-center gap-1 text-[#A1A1AA] hover:text-white transition-colors font-sans"
            >
              <Server className="w-3 h-3" />
              <span>Directory</span>
            </button>
          </div>
        )}
      </div>

      <nav aria-label="Dashboard sections" className="flex-1 p-3 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.groupLabel} className="space-y-1">
            <div className="px-3 pb-1 text-[11px] font-medium text-[#71717A]">
              {group.groupLabel}
            </div>
            {group.items.map((item) => {
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
                  aria-current={active ? 'page' : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#1F1F24] text-white font-medium border border-[#323238]'
                      : 'text-[#A1A1AA] hover:text-white hover:bg-[#18181C]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-[#27272A] bg-[#0D0D10]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{user.username}</div>
            <div className="text-xs text-[#71717A] truncate">
              {user.mode === 'discord_oauth' ? 'Discord OAuth2' : 'Local Admin Sandbox'}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
            className="p-2 rounded-md border border-[#27272A] text-[#A1A1AA] hover:text-white hover:bg-[#18181C] transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#09090B] text-[#FAFAFA] flex">
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
            className="flex-1 bg-black/75"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-[#09090B]/95 backdrop-blur border-b border-[#27272A] px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-md border border-[#27272A] text-[#A1A1AA] hover:text-white"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-xs text-[#71717A] truncate">
                {selectedGuild?.name || 'Workspace'} · {title}
              </div>
              <h1 className="text-lg font-semibold tracking-tight text-white truncate">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('/anime')}
              className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-[#18181C] border border-[#27272A] rounded-md text-white hover:border-[#3F3F46] transition-colors whitespace-nowrap shrink-0"
            >
              <Activity className="w-3.5 h-3.5 text-[#A1A1AA]" />
              <span>Hoshika Search</span>
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-8 py-6 max-w-[1280px] w-full mx-auto">
          {subtitle && <p className="text-sm text-[#A1A1AA] mb-6">{subtitle}</p>}
          {children}
        </main>
      </div>
    </div>
  );
}
