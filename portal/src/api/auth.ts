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

export type InviteInfo = {
  email: string;
  publisherName: string;
  displayName: string | null;
  /** The email already has an account, so accepting would fail. */
  emailTaken: boolean;
};

// The token goes in the body of a POST, never in a URL.
export const inspectInvite = (token: string) =>
  api<InviteInfo>('/auth/invites/inspect', { method: 'POST', body: JSON.stringify({ token }) });

/** Creates the publisher login; the API sets the portal cookie on this response. */
export const acceptInvite = (token: string, password: string, displayName: string) =>
  api<{ user: PortalUser }>('/auth/invites/accept', {
    method: 'POST',
    body: JSON.stringify({ token, password, displayName }),
  }).then((r) => r.user);
