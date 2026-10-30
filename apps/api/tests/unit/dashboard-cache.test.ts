import type { DashboardSummary } from '@taskmanager/contracts';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { createDashboardCache, genKey, valueKey, withJitter } from '../../src/cache/dashboard-cache';

/** Minimal in-memory stand-in for the subset of ioredis the cache uses. */
function fakeRedis(status = 'ready') {
  const store = new Map<string, string>();
  const r = {
    status,
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    multi() {
      const ops: Array<() => unknown> = [];
      const chain = {
        incr(k: string) {
          ops.push(() => {
            const n = Number(store.get(k) ?? 0) + 1;
            store.set(k, String(n));
            return n;
          });
          return chain;
        },
        expire() {
          ops.push(() => 1);
          return chain;
        },
        exec: async () => ops.map((op) => [null, op()]),
      };
      return chain;
    },
  };
  return r as unknown as Redis & { store: Map<string, string>; get: ReturnType<typeof vi.fn> };
}

const USER = 'a'.repeat(24);
const summary = (total: number): DashboardSummary => ({
  counts: { total, todo: total, inProgress: 0, completed: 0, overdue: 0 },
  completionRate: 0,
  recent: [],
  upcoming: [],
  generatedAt: new Date().toISOString(),
});

describe('dashboard cache', () => {
  it('computes on miss, then serves hits without recomputing', async () => {
    const redis = fakeRedis();
    const cache = createDashboardCache(redis, 60);
    const compute = vi.fn(async () => summary(1));
    await cache.get(USER, compute);
    await vi.waitFor(() => expect(redis.store.has(valueKey(USER, '0'))).toBe(true));
    await cache.get(USER, compute);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('invalidation bumps the generation so stale entries are never read again', async () => {
    const redis = fakeRedis();
    const cache = createDashboardCache(redis, 60);
    await cache.get(USER, async () => summary(1));
    await vi.waitFor(() => expect(redis.store.size).toBe(1));
    await cache.invalidate(USER);
    expect(redis.store.get(genKey(USER))).toBe('1');
    const fresh = await cache.get(USER, async () => summary(2));
    expect(fresh.counts.total).toBe(2);
  });

  it('coalesces concurrent misses (single flight)', async () => {
    const cache = createDashboardCache(fakeRedis(), 60);
    let resolve!: (s: DashboardSummary) => void;
    const compute = vi.fn(() => new Promise<DashboardSummary>((r) => (resolve = r)));
    const a = cache.get(USER, compute);
    const b = cache.get(USER, compute);
    await vi.waitFor(() => expect(compute).toHaveBeenCalledTimes(1));
    resolve(summary(3));
    expect((await a).counts.total).toBe(3);
    expect((await b).counts.total).toBe(3);
  });

  it('bypasses Redis when it is not ready, and when TTL is 0', async () => {
    const down = fakeRedis('reconnecting');
    const compute = vi.fn(async () => summary(1));
    await createDashboardCache(down, 60).get(USER, compute);
    expect(down.get).not.toHaveBeenCalled();
    await createDashboardCache(undefined, 60).get(USER, compute);
    await createDashboardCache(fakeRedis(), 0).get(USER, compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('falls back to computing when Redis errors', async () => {
    const redis = fakeRedis();
    redis.get.mockRejectedValueOnce(new Error('timeout'));
    const res = await createDashboardCache(redis, 60).get(USER, async () => summary(9));
    expect(res.counts.total).toBe(9);
  });

  it('refuses to build keys from anything but a validated user id', async () => {
    const cache = createDashboardCache(fakeRedis(), 60);
    await expect(cache.get('*', async () => summary(0))).rejects.toThrow();
    await expect(cache.get(`${USER}:other`, async () => summary(0))).rejects.toThrow();
  });
});

describe('withJitter', () => {
  it('stays within +/-10% and never below 1s', () => {
    expect(withJitter(60, () => 0)).toBe(54);
    expect(withJitter(60, () => 1)).toBe(66);
    expect(withJitter(1, () => 0)).toBe(1);
  });
});
