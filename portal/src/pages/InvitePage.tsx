import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { type InviteInfo, inspectInvite } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import Notice from '../components/Notice';
import { useFocusFirstInvalid } from '../lib/useFocusFirstInvalid';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import { Button, ErrorState, Field, Input, LoadingState } from '../ui';
import styles from './LoginPage.module.css';

const INVALID_REASONS = ['expired', 'used', 'revoked', 'unknown'] as const;
const MIN_PASSWORD = 10;
const MAX_PASSWORD_BYTES = 72;

/**
 * Reads `#token=` and removes the whole fragment from the address bar at once, so the token is
 * never left in the URL, the history entry or a copied address. It is returned to the caller to
 * hold in memory: not stored, not logged, never put in a query string.
 */
function takeTokenFromHash(): string | null {
  const { hash, pathname, search } = window.location;
  if (!hash) return null;
  const token = new URLSearchParams(hash.slice(1)).get('token');
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  return token?.trim() ? token.trim() : null;
}

function invalidReason(error: unknown): (typeof INVALID_REASONS)[number] | null {
  if (!(error instanceof ApiError) || error.code !== 'INVITE_INVALID') return null;
  return INVALID_REASONS.find((reason) => reason === error.reason) ?? 'unknown';
}

/** A malformed token comes back as a 400 at inspect: it reads as an invalid link, not a retry. */
function inspectReason(error: unknown): (typeof INVALID_REASONS)[number] | null {
  if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') return 'unknown';
  return invalidReason(error);
}

function Card({ children, title }: { children: ReactNode; title?: string }) {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <div className={styles.lang}>
        <LanguageSwitcher />
      </div>
      <main className={styles.card}>
        <p className={styles.wordmark}>{t('app.name')}</p>
        {title && <h1 className={styles.title}>{title}</h1>}
        {children}
      </main>
      <p className={styles.tagline}>{t('app.tagline')}</p>
    </div>
  );
}

/** A refusal that leaves nothing to do here except ask for a new invite or sign in. */
function Refusal({ messageKey }: { messageKey: string }) {
  const { t } = useTranslation();
  return (
    <Card title={t('invitePage.heading')}>
      <div className={styles.form}>
        <Notice tone="error">{t(messageKey)}</Notice>
        <Link to="/login">{t('invitePage.signIn')}</Link>
      </div>
    </Card>
  );
}

function TakenCard({ email }: { email: string }) {
  const { t } = useTranslation();
  return (
    <Card title={t('invitePage.heading')}>
      <div className={styles.form}>
        <Notice tone="error">{t('invitePage.taken', { email })}</Notice>
        <Link to="/login">{t('invitePage.signIn')}</Link>
      </div>
    </Card>
  );
}

function AcceptForm({
  token,
  info,
  onRefused,
}: {
  token: string;
  info: InviteInfo;
  onRefused: (messageKey: string) => void;
}) {
  const { t } = useTranslation();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(info.displayName ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ name?: string; password?: string; confirm?: string }>({});
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, request } = useFocusFirstInvalid();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = t('invitePage.errors.nameRequired');
    if (password.length < MIN_PASSWORD) next.password = t('invitePage.errors.passwordShort');
    else if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
      next.password = t('invitePage.errors.passwordLong');
    }
    if (!next.password && confirm !== password) next.confirm = t('invitePage.errors.mismatch');
    setErrors(next);
    setErrorKey(null);
    if (Object.keys(next).length > 0) {
      request();
      return;
    }

    setBusy(true);
    try {
      await acceptInvite(token, password, name.trim());
      navigate('/', { replace: true });
    } catch (error) {
      const reason = invalidReason(error);
      if (reason) onRefused(`invitePage.invalid.${reason}`);
      else if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') onRefused('taken');
      else if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
        setErrorKey('invitePage.errors.RATE_LIMITED');
      } else if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        setErrorKey('invitePage.errors.VALIDATION_FAILED');
      } else setErrorKey('invitePage.errors.generic');
      setBusy(false);
    }
  };

  return (
    <Card title={t('invitePage.title', { publisher: info.publisherName })}>
      <form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate>
        <p>{t('invitePage.intro')}</p>
        {errorKey && <Notice tone="error">{t(errorKey)}</Notice>}
        <dl>
          <dt>{t('invitePage.email')}</dt>
          <dd>{info.email}</dd>
        </dl>
        <Field label={t('invitePage.name')} error={errors.name} required>
          {(props) => (
            <Input
              {...props}
              autoComplete="name"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('invitePage.password')}
          hint={t('invitePage.passwordHint')}
          error={errors.password}
          required
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('invitePage.confirm')} error={errors.confirm} required>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" className={styles.submit} disabled={busy}>
          {busy ? t('invitePage.submitting') : t('invitePage.submit')}
        </Button>
      </form>
    </Card>
  );
}

type Inspection =
  | { status: 'pending' }
  | { status: 'ok'; data: InviteInfo }
  | { status: 'error'; error: unknown; retry: () => void };

/**
 * Asks the API about the invite. Deliberately not a cached query: the sign-in check that runs
 * beside this page clears the query cache when it gets its 401, and the token should not sit in
 * a cache key anyway.
 */
function useInspect(token: string | null): Inspection {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Inspection>({ status: 'pending' });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the check on Retry
  useEffect(() => {
    if (token === null) return;
    let cancelled = false;
    setResult({ status: 'pending' });
    inspectInvite(token).then(
      (data) => !cancelled && setResult({ status: 'ok', data }),
      (error: unknown) =>
        !cancelled && setResult({ status: 'error', error, retry: () => setAttempt((n) => n + 1) }),
    );
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  return result;
}

/**
 * The public page behind an invite link (`/invite#token=...`). The token is read once, cleared
 * from the URL, and kept only in this component's memory.
 */
export default function InvitePage() {
  const { t } = useTranslation();
  // undefined: not read yet; null: the link carried no token.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  // A refusal that arrives while accepting replaces the form: an invite reason key, or 'taken'.
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    const found = takeTokenFromHash();
    // Strict Mode runs this twice; the second pass finds the fragment already gone and must
    // not overwrite what the first one read.
    if (found) setToken(found);
    else setToken((previous) => previous ?? null);
  }, []);

  const hasToken = typeof token === 'string';
  const inspect = useInspect(hasToken ? token : null);

  if (token === undefined || (hasToken && inspect.status === 'pending')) {
    return (
      <Card>
        <LoadingState />
      </Card>
    );
  }
  if (token === null) return <Refusal messageKey="invitePage.invalid.missing" />;

  if (refusal === 'taken') {
    return <TakenCard email={inspect.status === 'ok' ? inspect.data.email : ''} />;
  }
  if (refusal) return <Refusal messageKey={refusal} />;

  if (inspect.status === 'error') {
    const reason = inspectReason(inspect.error);
    if (reason) return <Refusal messageKey={`invitePage.invalid.${reason}`} />;
    return (
      <Card>
        <ErrorState
          body={t(
            inspect.error instanceof ApiError && inspect.error.code === 'RATE_LIMITED'
              ? 'invitePage.errors.RATE_LIMITED'
              : 'invitePage.errors.generic',
          )}
          onRetry={inspect.retry}
        />
      </Card>
    );
  }

  if (inspect.status !== 'ok') return null;
  const info = inspect.data;

  if (info.emailTaken) return <TakenCard email={info.email} />;

  return <AcceptForm token={token} info={info} onRefused={setRefusal} />;
}
