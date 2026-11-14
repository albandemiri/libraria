import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import LanguageSwitcher from './LanguageSwitcher';
import { PublisherScopeProvider, usePublisherScope } from './PublisherScope';

const NAV_GROUPS = [
  {
    key: 'money',
    items: [
      { to: '/', key: 'overview', end: true },
      { to: '/sales', key: 'sales', end: false },
      { to: '/earnings', key: 'earnings', end: false },
    ],
  },
  {
    key: 'catalogue',
    items: [
      { to: '/books', key: 'books', end: true },
      { to: '/books/new', key: 'newBook', end: false },
    ],
  },
  { key: 'account', items: [{ to: '/contract', key: 'contract', end: false }] },
];

function PublisherPicker() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isAdmin, publisherId, setPublisherId, publishers } = usePublisherScope();

  if (!isAdmin) {
    return <span className="publisher-name">{user?.displayName ?? user?.email}</span>;
  }
  return (
    <label className="publisher-picker">
      <span className="sr-only">{t('topbar.publisher')}</span>
      <select value={publisherId ?? ''} onChange={(e) => setPublisherId(e.target.value)}>
        <option value="" disabled>
          {t('topbar.pickPublisher')}
        </option>
        {publishers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function AppLayout() {
  const { t } = useTranslation();
  const { logout } = useAuth();

  return (
    <PublisherScopeProvider>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <strong>{t('app.name')}</strong>
            <span className="muted">{t('app.tagline')}</span>
          </div>
          <nav aria-label={t('nav.label')}>
            {NAV_GROUPS.map((group) => (
              <div key={group.key} className="nav-group">
                <h2>{t(`nav.groups.${group.key}`)}</h2>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink to={item.to} end={item.end}>
                        {t(`nav.${item.key}`)}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>
        <div className="main">
          <header className="topbar">
            <PublisherPicker />
            <div className="topbar-actions">
              <LanguageSwitcher />
              <button type="button" className="btn btn-secondary" onClick={() => void logout()}>
                {t('topbar.logout')}
              </button>
            </div>
          </header>
          <main className="content">
            <Suspense fallback={<p className="muted">{t('common.loading')}</p>}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </PublisherScopeProvider>
  );
}
