import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ErrorState, FullPageLoader } from '@/components/states';
import { useAuth } from './AuthProvider';

export function RequireAuth() {
  const { user, status, error, retry } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader label="Checking your session" />;
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-md pt-24">
        <ErrorState error={error} onRetry={retry} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function PublicOnly() {
  const { user, status } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
