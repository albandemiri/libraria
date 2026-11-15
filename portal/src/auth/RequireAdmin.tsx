import { Outlet } from 'react-router-dom';
import NotFoundPage from '../pages/NotFoundPage';
import { useAuth } from './AuthProvider';

/**
 * Guards the Platform routes: anyone but an admin gets "not found", so a publisher cannot tell
 * the pages exist. The API refuses them as well; this is only the front door.
 */
export default function RequireAdmin() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <NotFoundPage />;
  return <Outlet />;
}
