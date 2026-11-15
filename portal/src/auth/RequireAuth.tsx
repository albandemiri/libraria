import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingState } from '../ui';
import { useAuth } from './AuthProvider';

export default function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <LoadingState />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}
