import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import LanguageSwitcher from '../layout/LanguageSwitcher';

export default function LoginPage() {
  const { t } = useTranslation();
  const { status, accessDenied, expired, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
    return <Navigate to={from ?? '/'} replace />;
  }

  const shownCode = errorCode ?? (accessDenied ? 'PORTAL_ACCESS_DENIED' : null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorCode(null);
    try {
      await login(email, password, rememberMe);
    } catch (err) {
      setErrorCode(err instanceof ApiError ? err.code : 'generic');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-lang">
        <LanguageSwitcher />
      </div>
      <form className="card login-card" onSubmit={onSubmit}>
        <h1>{t('app.name')}</h1>
        <p className="muted">{t('login.title')}</p>
        {expired && !shownCode && (
          <p role="alert" className="alert">
            {t('login.sessionExpired')}
          </p>
        )}
        {shownCode && (
          <p role="alert" className="alert">
            {t(`login.errors.${shownCode}`, { defaultValue: t('login.errors.generic') })}
          </p>
        )}
        <label className="field">
          <span>{t('login.email')}</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('login.password')}</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <span>{t('login.remember')}</span>
        </label>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
