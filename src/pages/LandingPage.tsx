import React, { useState } from 'react';
import { ArrowRight, Check, Copy, ExternalLink, Search, Terminal } from 'lucide-react';
import { AniScrollLogo } from '../components/Logo';
import { apiRequest } from '../lib/api';
import { buildAniScrollAnimeUrl } from '../../packages/shared/src/animeUrl';

interface LandingPageProps {
  onNavigate: (path: string) => void;
  health: any;
  authenticated: boolean;
}

export function LandingPage({ onNavigate, health, authenticated }: LandingPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const handleQuickSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const data = await apiRequest<{ items: any[] }>(
        `/api/v1/anime/search?q=${encodeURIComponent(searchQuery.trim())}`
      );
      setSearchResults(data.items.slice(0, 4));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const copyCommand = (cmd: string) => {
    navigator.clipboard?.writeText(cmd).catch(() => undefined);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 1500);
  };

  const clientId = health?.discord?.configured ? 'Configured' : null;
  const inviteHref =
    health?.botInviteUrl ||
    (health?.discord?.clientId
      ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(health.discord.clientId)}&permissions=1374661266518&scope=bot%20applications.commands`
      : 'https://discord.com/developers/applications');

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="border-b border-[#2A2A2A] bg-black/95 sticky top-0 z-30">
        <div className="max-w-[1200px] mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/');
            }}
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <AniScrollLogo size={26} />
            <span>AniScroll Bot</span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#A0A0A0]">
            <a href="#capabilities" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Capabilities
            </a>
            <a href="#hoshika-live" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Live Search
            </a>
            <a href="#commands" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Commands
            </a>
            <a href="#documentation" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Documentation
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onNavigate(authenticated ? '/servers' : '/login')}
              className="px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5] transition-colors whitespace-nowrap shrink-0"
            >
              {authenticated ? 'Open Dashboard' : 'Dashboard Login'}
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="max-w-[1200px] mx-auto px-6 pt-16 pb-20 border-b border-[#2A2A2A]">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-7 flex flex-col justify-between">
              <div>
                <p className="text-xs font-mono text-[#A0A0A0] mb-4 tracking-wide">
                  Discord Community · Hoshika Metadata · Lavalink v4 Audio
                </p>
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.1] max-w-2xl [text-wrap:balance]">
                  One monochrome Discord bot for anime discovery, moderation, and voice.
                </h1>
                <p className="mt-5 text-base text-[#A0A0A0] leading-relaxed max-w-xl">
                  AniScroll Bot unifies Dyno-grade AutoMod, Carl-bot reaction roles and tickets, Lavalink v4 music queues, and direct Hoshika anime metadata with persistent personal watchlists.
                </p>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate(authenticated ? '/servers' : '/login')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5] transition-colors whitespace-nowrap shrink-0"
                >
                  <span>{authenticated ? 'Go to Dashboard' : 'Launch Web Dashboard'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <a
                  href={inviteHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-[#111111] text-white border border-[#2A2A2A] rounded-md hover:bg-[#181818] transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Invite Bot</span>
                  <ExternalLink className="w-3.5 h-3.5 text-[#A0A0A0]" />
                </a>
                <a
                  href="https://discord.gg/aniscroll"
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2.5 text-sm font-medium text-[#A0A0A0] hover:text-white transition-colors whitespace-nowrap shrink-0"
                >
                  Support Server
                </a>
              </div>
            </div>

            {/* Live Hoshika Query Preview Panel */}
            <div id="hoshika-live" className="lg:col-span-5 bg-[#111111] border border-[#2A2A2A] rounded-lg p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-white">Live Hoshika Metadata Probe</h2>
                  <span className="text-xs font-mono text-[#A0A0A0]">api/v1/search</span>
                </div>
                <p className="text-xs text-[#A0A0A0] mb-4">
                  Query Hoshika directly from the bot backend. Streaming availability endpoints are strictly excluded.
                </p>

                <form onSubmit={handleQuickSearch} className="flex gap-2">
                  <label htmlFor="landing-anime-search" className="sr-only">
                    Search anime title
                  </label>
                  <input
                    id="landing-anime-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Try Naruto, Frieren, Apothecary..."
                    className="flex-1 min-w-0 bg-[#181818] border border-[#2A2A2A] rounded-md px-3 py-2 text-sm text-white placeholder:text-[#666666] focus:outline-none focus:border-white"
                  />
                  <button
                    type="submit"
                    disabled={searching}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5] disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{searching ? 'Querying' : 'Search'}</span>
                  </button>
                </form>

                {searchError && (
                  <p className="mt-3 text-xs text-red-400">{searchError}</p>
                )}

                <div className="mt-4 space-y-2.5">
                  {searchResults.length === 0 ? (
                    <div className="border border-dashed border-[#2A2A2A] rounded-md p-4 text-xs text-[#A0A0A0]">
                      Enter an anime title above to inspect normalized Hoshika metadata (<code className="font-mono text-white">shortId</code>, format, score, cover).
                    </div>
                  ) : (
                    searchResults.map((anime) => {
                      const animeUrl = anime.aniscrollUrl || buildAniScrollAnimeUrl(anime.shortId);
                      const cardContent = (
                        <>
                          {anime.poster ? (
                            <img
                              src={anime.poster}
                              alt={anime.titleEnglish || anime.titleRomaji}
                              referrerPolicy="no-referrer"
                              className="w-10 h-14 object-cover rounded bg-[#222222] shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-14 bg-[#222222] rounded shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-white truncate flex items-center justify-between gap-2">
                              <span className="truncate">{anime.titleEnglish || anime.titleRomaji}</span>
                              {animeUrl && <ExternalLink className="w-3.5 h-3.5 text-[#A0A0A0] shrink-0" />}
                            </div>
                            <div className="text-xs text-[#A0A0A0] font-mono tabular-nums mt-0.5">
                              {anime.type || 'Anime'} ·{' '}
                              {anime.shortId ? `ID ${anime.shortId}` : 'Hoshika ID unavailable'}
                              {anime.rating ? ` · Score ${anime.rating}/100` : ''}
                            </div>
                          </div>
                        </>
                      );

                      return animeUrl ? (
                        <a
                          key={anime.hoshikaId}
                          href={animeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-3 p-2.5 bg-[#181818] border border-[#2A2A2A] rounded-md hover:border-white/50 transition-colors"
                        >
                          {cardContent}
                        </a>
                      ) : (
                        <div
                          key={anime.hoshikaId}
                          className="flex items-center gap-3 p-2.5 bg-[#181818] border border-[#2A2A2A] rounded-md opacity-80"
                        >
                          {cardContent}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-[#2A2A2A] flex items-center justify-between text-xs text-[#A0A0A0] font-mono tabular-nums">
                <span>Commands: {health?.discord?.commandCount ?? 40}+</span>
                <span>Discord: {clientId || 'Not Connected'}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities Bento */}
        <section id="capabilities" className="max-w-[1200px] mx-auto px-6 py-16 border-b border-[#2A2A2A]">
          <div className="mb-10">
            <h2 className="text-2xl font-semibold tracking-tight text-white">Platform Architecture</h2>
            <p className="mt-2 text-sm text-[#A0A0A0] max-w-2xl">
              Built as an independent monorepo with clear boundaries between Discord Gateway, Hoshika metadata services, PostgreSQL/Prisma persistence, Redis caching, and Lavalink v4 audio.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="md:col-span-2 bg-[#111111] border border-[#2A2A2A] rounded-lg p-6">
              <div className="text-xs font-mono text-[#A0A0A0] mb-2">01. Hoshika Discovery &amp; Watchlists</div>
              <h3 className="text-lg font-semibold text-white mb-2">Direct Metadata Normalization</h3>
              <p className="text-sm text-[#A0A0A0] leading-relaxed">
                Search English, Romaji, and native titles with genre, year, format, and status filters. Personal watchlists enforce duplicate prevention, episode bounds validation, auto-completion, ratings, and JSON export inside the bot database.
              </p>
            </div>

            <div className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-6">
              <div className="text-xs font-mono text-[#A0A0A0] mb-2">02. Lavalink v4 Audio</div>
              <h3 className="text-lg font-semibold text-white mb-2">Independent Guild Queues</h3>
              <p className="text-sm text-[#A0A0A0] leading-relaxed">
                Dedicated Lavalink v4 client with loop modes, DJ role enforcement, interactive Now Playing buttons, 24/7 persistence, and graceful offline handling.
              </p>
            </div>

            <div className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-6">
              <div className="text-xs font-mono text-[#A0A0A0] mb-2">03. Moderation &amp; AutoMod</div>
              <h3 className="text-lg font-semibold text-white mb-2">Staged Server Protection</h3>
              <p className="text-sm text-[#A0A0A0] leading-relaxed">
                Case numbering, configurable warning escalations, appeals, anti-spam, phishing domain filtering, raid join spikes, and role/channel exclusions.
              </p>
            </div>

            <div className="md:col-span-2 bg-[#111111] border border-[#2A2A2A] rounded-lg p-6">
              <div className="text-xs font-mono text-[#A0A0A0] mb-2">04. Carl-bot Community Suite</div>
              <h3 className="text-lg font-semibold text-white mb-2">Welcome, Reaction Roles, Tickets &amp; Events</h3>
              <p className="text-sm text-[#A0A0A0] leading-relaxed">
                Manage custom welcome embeds, button/select reaction role panels, deduplicated suggestions with staff workflow, private ticket channels with transcripts, timed polls, giveaways, XP leveling, and Anime of the Day.
              </p>
            </div>
          </div>
        </section>

        {/* Slash Command Reference */}
        <section id="commands" className="max-w-[1200px] mx-auto px-6 py-16 border-b border-[#2A2A2A]">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">Slash Command Surface</h2>
              <p className="mt-2 text-sm text-[#A0A0A0]">Click any command to copy its syntax.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { cmd: '/anime search', desc: 'Paginated Hoshika search' },
              { cmd: '/watchlist add', desc: 'Save anime to PostgreSQL' },
              { cmd: '/watchlist progress', desc: 'Track & validate episodes' },
              { cmd: '/play', desc: 'Lavalink v4 voice playback' },
              { cmd: '/warn add', desc: 'Escalating warning cases' },
              { cmd: '/ticket create', desc: 'Private support channels' },
              { cmd: '/suggest', desc: 'Community idea voting' },
              { cmd: '/config overview', desc: 'Server module settings' },
            ].map((item) => (
              <button
                key={item.cmd}
                type="button"
                onClick={() => copyCommand(item.cmd)}
                className="text-left p-4 bg-[#111111] border border-[#2A2A2A] rounded-md hover:border-white/50 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm text-white flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-[#A0A0A0]" />
                    {item.cmd}
                  </span>
                  {copiedCmd === item.cmd ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[#666666] group-hover:text-white" />
                  )}
                </div>
                <p className="mt-1.5 text-xs text-[#A0A0A0]">{item.desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Documentation / Setup Overview */}
        <section id="documentation" className="max-w-[1200px] mx-auto px-6 py-16">
          <div className="bg-[#111111] border border-[#2A2A2A] rounded-lg p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Ready to connect your Discord server?</h2>
              <p className="mt-2 text-sm text-[#A0A0A0] max-w-2xl">
                Review the OAuth2 callback URL, inspect live Hoshika endpoints, or test all moderation, community, music, and watchlist modules inside the Admin Sandbox.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate(authenticated ? '/servers' : '/login')}
              className="px-5 py-2.5 text-sm font-semibold bg-white text-black rounded-md hover:bg-[#E5E5E5] transition-colors whitespace-nowrap shrink-0"
            >
              {authenticated ? 'Open Server Selector' : 'Sign In to Dashboard'}
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#2A2A2A] py-8 px-6">
        <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#A0A0A0]">
          <span>AniScroll Bot · Independent Discord Community &amp; Anime Platform</span>
          <div className="flex items-center gap-6">
            <a href="#capabilities" className="hover:text-white">Architecture</a>
            <a href="#commands" className="hover:text-white">Commands</a>
            <button type="button" onClick={() => onNavigate('/login')} className="hover:text-white">
              Dashboard
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
