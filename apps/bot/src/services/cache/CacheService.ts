import Redis from 'ioredis';
import { appConfig, createModuleLogger } from '../../../../../packages/shared/src';

const log = createModuleLogger('CacheService');

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

export class CacheService {
  private redis: Redis | null = null;
  private redisConnected = false;
  private memory = new Map<string, MemoryEntry>();
  private inflight = new Map<string, Promise<unknown>>();
  private version = 'v1';

  constructor(redisUrl: string = appConfig.REDIS_URL) {
    if (redisUrl && redisUrl.startsWith('redis')) {
      try {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 2,
          lazyConnect: true,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 250, 2000)),
        });
        this.redis.on('ready', () => {
          this.redisConnected = true;
          log.info('Redis connection ready');
        });
        this.redis.on('error', (err) => {
          this.redisConnected = false;
          log.warn({ err: err.message }, 'Redis unavailable, using memory cache fallback');
        });
        this.redis.connect().catch(() => {
          this.redisConnected = false;
        });
      } catch {
        this.redisConnected = false;
      }
    }
  }

  public getStatus() {
    return {
      backend: this.redisConnected ? 'redis' : 'memory-fallback',
      connected: this.redisConnected,
      configured: Boolean(appConfig.REDIS_URL && appConfig.REDIS_URL.startsWith('redis')),
      memoryKeys: this.memory.size,
      version: this.version,
    };
  }

  public key(namespace: string, identifier: string): string {
    return `${appConfig.CACHE_PREFIX}:${this.version}:${namespace}:${identifier}`;
  }

  public async get<T>(key: string): Promise<T | null> {
    if (this.redis && this.redisConnected) {
      try {
        const raw = await this.redis.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        // fallback to memory
      }
    }
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memory.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  }

  public async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (this.redis && this.redisConnected) {
      try {
        await this.redis.setex(key, ttlSeconds, serialized);
        return;
      } catch {
        // fallback to memory
      }
    }
    this.memory.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  public async del(key: string): Promise<void> {
    this.memory.delete(key);
    if (this.redis && this.redisConnected) {
      try {
        await this.redis.del(key);
      } catch {
        // ignore
      }
    }
  }

  public async clearNamespace(prefix = ''): Promise<number> {
    let cleared = 0;
    const matchPrefix = prefix
      ? `${appConfig.CACHE_PREFIX}:${this.version}:${prefix}`
      : `${appConfig.CACHE_PREFIX}:`;
    for (const k of this.memory.keys()) {
      if (k.startsWith(matchPrefix)) {
        this.memory.delete(k);
        cleared++;
      }
    }
    if (this.redis && this.redisConnected) {
      try {
        const keys = await this.redis.keys(`${matchPrefix}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          cleared += keys.length;
        }
      } catch {
        // ignore
      }
    }
    return cleared;
  }

  public async dedupe<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<{ data: T; cached: boolean }> {
    const hit = await this.get<T>(key);
    if (hit !== null) {
      return { data: hit, cached: true };
    }
    const existingPromise = this.inflight.get(key) as Promise<T> | undefined;
    if (existingPromise) {
      const data = await existingPromise;
      return { data, cached: true };
    }
    const promise = (async () => {
      try {
        const result = await loader();
        await this.set(key, result, ttlSeconds);
        return result;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    const data = await promise;
    return { data, cached: false };
  }

  public async checkRateLimit(bucketKey: string, maxRequests: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
    const fullKey = this.key('ratelimit', bucketKey);
    const current = (await this.get<{ count: number; resetAt: number }>(fullKey)) || {
      count: 0,
      resetAt: Date.now() + windowSeconds * 1000,
    };
    if (Date.now() > current.resetAt) {
      const next = { count: 1, resetAt: Date.now() + windowSeconds * 1000 };
      await this.set(fullKey, next, windowSeconds);
      return { allowed: true, remaining: maxRequests - 1, retryAfterSeconds: 0 };
    }
    if (current.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - Date.now()) / 1000)),
      };
    }
    current.count += 1;
    const ttlLeft = Math.max(1, Math.ceil((current.resetAt - Date.now()) / 1000));
    await this.set(fullKey, current, ttlLeft);
    return { allowed: true, remaining: maxRequests - current.count, retryAfterSeconds: 0 };
  }

  public async close() {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }
}

let sharedCache: CacheService | null = null;
export function getCacheService(): CacheService {
  if (!sharedCache) sharedCache = new CacheService();
  return sharedCache;
}
