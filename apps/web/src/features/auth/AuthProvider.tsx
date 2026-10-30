import type { LoginInput, RegisterInput, UserDto } from '@taskmanager/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError, onSessionExpired } from '@/lib/api';

type UserResponse = { data: { user: UserDto } };

interface AuthValue {
  user: UserDto | null;
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  retry: () => void;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: UserDto | null) => void;
  /** Clear the signed-in user and all user-specific cached data. */
  endSession: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);
export const ME_KEY = ['auth', 'me'] as const;

/**
 * Session state lives in HttpOnly cookies the page cannot read; the source of truth
 * for "am I signed in" is GET /auth/me (which transparently refreshes once).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async ({ signal }) => {
      try {
        return (await api.get<UserResponse>('/auth/me', signal)).data.user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
  });

  const setUser = useCallback(
    (user: UserDto | null) => {
      qc.setQueryData(ME_KEY, user);
    },
    [qc],
  );

  /**
   * Sign the user out locally and drop every user-specific cached query.
   * The auth query itself is updated, not removed: removing it would detach the
   * observer above, so the UI would keep rendering the previous user.
   */
  const endSession = useCallback(() => {
    setUser(null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
  }, [qc, setUser]);

  useEffect(() => onSessionExpired(endSession), [endSession]);

  const login = useCallback(
    async (input: LoginInput) => setUser((await api.post<UserResponse>('/auth/login', input)).data.user),
    [setUser],
  );
  const register = useCallback(
    async (input: RegisterInput) =>
      setUser((await api.post<UserResponse>('/auth/register', input)).data.user),
    [setUser],
  );
  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      endSession();
    }
  }, [endSession]);

  const value = useMemo<AuthValue>(
    () => ({
      user: me.data ?? null,
      status: me.isPending ? 'loading' : me.isError ? 'error' : 'ready',
      error: me.error,
      retry: () => void me.refetch(),
      login,
      register,
      logout,
      setUser,
      endSession,
    }),
    [me, login, register, logout, setUser, endSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
