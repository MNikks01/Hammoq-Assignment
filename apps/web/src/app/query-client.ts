import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Retry only transient failures (network/5xx), at most twice, with jittered backoff.
        retry: (count, err) => err instanceof ApiError && err.isRetryable && count < 2,
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000) + Math.floor(Math.random() * 300),
      },
      // Mutations are not idempotent in general; never retry them automatically.
      mutations: { retry: false },
    },
  });
}
