import { api } from './client';
import type { PortalUser, PublisherSummary } from './types';

export const fetchMe = () => api<{ user: PortalUser }>('/auth/me').then((r) => r.user);

export const portalLogin = (email: string, password: string, rememberMe: boolean) =>
  api<{ user: PortalUser }>('/auth/portal/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, rememberMe }),
  }).then((r) => r.user);

export const portalLogout = () => api<void>('/auth/portal/logout', { method: 'POST' });

export const fetchPublishers = () =>
  api<{ publishers: PublisherSummary[] }>('/admin/publishers').then((r) => r.publishers);
