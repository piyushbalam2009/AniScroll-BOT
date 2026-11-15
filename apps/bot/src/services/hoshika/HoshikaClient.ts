import { appConfig, AppError, createModuleLogger, ERROR_CODES } from '../../../../../packages/shared/src';

const log = createModuleLogger('HoshikaClient');

export interface HoshikaRequestOptions {
  timeoutMs?: number;
  retries?: number;
  params?: Record<string, string | number | undefined | null>;
}

export class HoshikaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private lastHealthyAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    baseUrl: string = appConfig.HOSHIKA_BASE_URL,
    apiKey: string = appConfig.HOSHIKA_API_KEY
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  public getHealthState() {
    return {
      baseUrl: this.baseUrl,
      hasApiKey: Boolean(this.apiKey),
      lastHealthyAt: this.lastHealthyAt,
      lastError: this.lastError,
    };
  }

  public async get<T = unknown>(endpoint: string, options: HoshikaRequestOptions = {}): Promise<T> {
    // Explicit exclusion: never call Hoshika official streaming / watch endpoints
    if (/\/watch(\?|$|\/)/i.test(endpoint)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Streaming availability lookups from Hoshika are disabled by policy.',
        403
      );
    }

    const cleanPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = new URL(`${this.baseUrl}${cleanPath}`);

    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const timeoutMs = options.timeoutMs ?? 8000;
    const maxRetries = options.retries ?? 2;

    let attempt = 0;
    while (true) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          'User-Agent': 'AniScrollBot/1.0',
        };
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const res = await fetch(url.toString(), {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after') || '2');
          log.warn({ endpoint: cleanPath, status: res.status, attempt, retryAfter }, 'Hoshika API rate limited');
          if (attempt <= maxRetries) {
            await this.sleep(Math.min(retryAfter * 1000, 5000));
            continue;
          }
          throw new AppError(
            ERROR_CODES.RATE_LIMIT_EXCEEDED,
            'Hoshika API rate limit exceeded. Please try again shortly.',
            429
          );
        }

        let body: any = null;
        let jsonValid = true;
        try {
          body = await res.json();
        } catch {
          jsonValid = false;
        }

        if (!res.ok || (body && body.ok === false)) {
          const code = body?.code || `http_${res.status}`;
          log.warn({ endpoint: cleanPath, status: res.status, code, attempt }, 'Hoshika HTTP error response');
          if (res.status === 404 || code === 'not_found') {
            throw new AppError(ERROR_CODES.ANIME_NOT_FOUND, 'Anime not found on Hoshika.', 404);
          }
          if (res.status >= 400 && res.status < 500) {
            throw new AppError(
              ERROR_CODES.VALIDATION_ERROR,
              `Hoshika request rejected (${code}).`,
              res.status
            );
          }
          if (attempt <= maxRetries) {
            await this.sleep(250 * Math.pow(2, attempt - 1));
            continue;
          }
          throw new AppError(
            ERROR_CODES.HOSHIKA_UNAVAILABLE,
            'Hoshika metadata service is temporarily unavailable.',
            503
          );
        }

        if (!jsonValid || body === null || typeof body !== 'object') {
          if (attempt <= maxRetries) {
            await this.sleep(250 * Math.pow(2, attempt - 1));
            continue;
          }
          this.lastError = 'invalid_json';
          log.warn({ endpoint: cleanPath }, 'Hoshika returned an invalid JSON response');
          throw new AppError(
            ERROR_CODES.HOSHIKA_UNAVAILABLE,
            'Hoshika returned an invalid JSON response.',
            502
          );
        }

        this.lastHealthyAt = new Date().toISOString();
        this.lastError = null;
        return body as T;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof AppError) {
          this.lastError = err.code;
          throw err;
        }
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (attempt <= maxRetries) {
          await this.sleep(250 * Math.pow(2, attempt - 1));
          continue;
        }
        this.lastError = isAbort ? 'timeout' : 'network_error';
        log.warn({ endpoint: cleanPath, reason: this.lastError }, 'Hoshika request failed');
        throw new AppError(
          ERROR_CODES.HOSHIKA_UNAVAILABLE,
          'Hoshika metadata service is temporarily unavailable.',
          503
        );
      }
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
