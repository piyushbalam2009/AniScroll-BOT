export interface SessionUser {
  userId: string;
  username: string;
  avatar: string | null;
  mode: 'discord_oauth' | 'local_sandbox';
  csrfToken: string;
}

export interface SessionInfo {
  authenticated: boolean;
  oauthConfigured: boolean;
  callbackRoute?: string;
  callbackUrl: string;
  redirectUriSource?: 'env' | 'app_url_fallback';
  redirectUriWarning?: string | null;
  botInviteUrl?: string | null;
  user: SessionUser | null;
}

export interface GuildSummary {
  id: string;
  discordGuildId: string;
  name: string;
  icon: string | null;
  memberCount: number;
  botInstalled: boolean;
  channels: Array<{ id: string; name: string; type: 'text' | 'category' | 'voice' }>;
  roles: Array<{ id: string; name: string; position: number }>;
}

let currentCsrfToken = '';

export function setCsrfToken(token: string) {
  currentCsrfToken = token;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase()) && currentCsrfToken) {
    headers.set('x-csrf-token', currentCsrfToken);
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || (data && data.ok === false)) {
    if (res.status === 401 && window.location.pathname !== '/login' && window.location.pathname !== '/') {
      window.location.href = '/login';
    }
    throw new Error(data?.message || `Request failed (${res.status})`);
  }
  return data as T;
}
