import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import { Button, Field, Input } from '../ui';
import styles from './LoginPage.module.css';

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
    <div className={styles.page}>
      <div className={styles.lang}>
        <LanguageSwitcher />
      </div>
      <main className={styles.card}>
        <p className={styles.wordmark}>{t('app.name')}</p>
        <h1 className={styles.title}>{t('login.title')}</h1>
        <form className={styles.form} onSubmit={onSubmit}>
          {expired && !shownCode && (
            <p role="alert" className={styles.alert}>
              {t('login.sessionExpired')}
            </p>
          )}
          {shownCode && (
            <p role="alert" className={styles.alert}>
              {t(`login.errors.${shownCode}`, { defaultValue: t('login.errors.generic') })}
            </p>
          )}
          <Field label={t('login.email')}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('login.password')}>
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <label className={styles.remember}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span>{t('login.remember')}</span>
          </label>
          <Button type="submit" variant="primary" className={styles.submit} disabled={submitting}>
            {submitting ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
      </main>
      <p className={styles.tagline}>{t('app.tagline')}</p>
    </div>
  );
}
