import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, onSessionExpired } from './api';

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'tm_csrf=abc.def; path=/';
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('sends credentials and the CSRF header on writes', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: { id: '1' } }));
    await api.post('/tasks', { title: 'x' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/tasks');
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['x-csrf-token']).toBe('abc.def');
  });

  it('refreshes once on 401 and retries the original request', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired', requestId: 'r' } }),
      )
      .mockResolvedValueOnce(json(200, { data: { user: {} } })) // refresh
      .mockResolvedValueOnce(json(200, { data: [1, 2] }));
    const res = await api.get<{ data: number[] }>('/tasks');
    expect(res.data).toEqual([1, 2]);
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/auth/refresh');
  });

  it('notifies listeners and throws when the session cannot be refreshed', async () => {
    const listener = vi.fn();
    const off = onSessionExpired(listener);
    fetchMock
      .mockResolvedValueOnce(
        json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired', requestId: 'r' } }),
      )
      .mockResolvedValueOnce(
        json(401, { error: { code: 'UNAUTHENTICATED', message: 'no', requestId: 'r' } }),
      );
    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();
    off();
  });

  it('does not try to refresh after a failed login', async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password', requestId: 'r' } }),
    );
    await expect(api.post('/auth/login', {})).rejects.toThrow('Invalid email or password');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps network failures and server errors to ApiError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const netErr = await api.get('/tasks').catch((e: unknown) => e);
    expect(netErr).toBeInstanceOf(ApiError);
    expect((netErr as ApiError).code).toBe('NETWORK_ERROR');
    expect((netErr as ApiError).isRetryable).toBe(true);

    fetchMock.mockResolvedValueOnce(
      json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'bad',
          requestId: 'r',
          details: [{ path: 'title', message: 'Required' }],
        },
      }),
    );
    const v = (await api.post('/tasks', {}).catch((e: unknown) => e)) as ApiError;
    expect(v.details[0]?.path).toBe('title');
    expect(v.isRetryable).toBe(false);
  });
});
