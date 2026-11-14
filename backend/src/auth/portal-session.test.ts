import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearedCookie,
  isPortalRole,
  PORTAL_COOKIE,
  readCookie,
  sessionCookie,
} from './portal-session';

describe('readCookie', () => {
  it('finds a cookie among several', () => {
    assert.equal(readCookie('a=1; libraria_portal=tok; b=2', PORTAL_COOKIE), 'tok');
  });

  it('returns null when absent or header missing', () => {
    assert.equal(readCookie('a=1; b=2', PORTAL_COOKIE), null);
    assert.equal(readCookie(undefined, PORTAL_COOKIE), null);
  });

  it('does not match a cookie whose name merely ends with the wanted name', () => {
    assert.equal(readCookie('x_libraria_portal=evil', PORTAL_COOKIE), null);
  });
});

describe('sessionCookie', () => {
  it('sets the hardened attributes and a 30-day lifetime when remembered', () => {
    const cookie = sessionCookie('t', true, false);
    assert.match(cookie, /^libraria_portal=t;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\/api/);
    assert.match(cookie, /Max-Age=2592000/);
    assert.doesNotMatch(cookie, /Secure/);
  });

  it('is a session cookie without remember me', () => {
    assert.doesNotMatch(sessionCookie('t', false, false), /Max-Age/);
  });

  it('adds Secure only in production', () => {
    assert.match(sessionCookie('t', false, true), /; Secure/);
    assert.match(clearedCookie(true), /; Secure/);
    assert.doesNotMatch(clearedCookie(false), /Secure/);
  });
});

describe('clearedCookie', () => {
  it('expires immediately on the same path', () => {
    const cookie = clearedCookie(false);
    assert.match(cookie, /^libraria_portal=;/);
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /Path=\/api/);
    assert.match(cookie, /HttpOnly/);
  });
});

describe('isPortalRole', () => {
  it('is an allowlist: publisher and admin only', () => {
    assert.equal(isPortalRole('publisher'), true);
    assert.equal(isPortalRole('admin'), true);
    assert.equal(isPortalRole('reader'), false);
    assert.equal(isPortalRole('moderator'), false);
    assert.equal(isPortalRole(''), false);
  });
});
