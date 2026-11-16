import { useTranslation } from 'react-i18next';
import { Form, Link, useActionData, useNavigation, useSearchParams } from 'react-router';
import { Button, Field } from '../ui';
import type { AuthActionData, AuthMode } from './auth.server';
import styles from './AuthForm.module.css';

/** The route (and its `returnTo`) the other form lives at. */
const OTHER: Record<AuthMode, string> = { signIn: '/regjistrohu', register: '/hyr' };

export function AuthForm({ mode }: { mode: AuthMode }) {
  const { t } = useTranslation();
  const data = useActionData() as AuthActionData | undefined;
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo');
  const busy = navigation.state !== 'idle' && navigation.formMethod?.toLowerCase() === 'post';
  const isRegister = mode === 'register';
  const copy = isRegister ? 'auth.register' : 'auth.signIn';
  const other = returnTo ? `${OTHER[mode]}?returnTo=${encodeURIComponent(returnTo)}` : OTHER[mode];
  const errors = data?.fieldErrors;

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <p className={styles.kicker}>{t(`${copy}.kicker`)}</p>
        <h1 className={styles.title}>{t(`${copy}.title`)}</h1>
        <p className={styles.lede}>{t(`${copy}.lede`)}</p>
      </header>

      <Form method="post" noValidate className={styles.form}>
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

        {data?.formError ? (
          <p role="alert" className={styles.alert}>
            {t(data.formError)}
          </p>
        ) : null}
        {data?.portal ? (
          <p role="alert" className={styles.alert}>
            {t('auth.portal.message')} <a href={data.portalUrl}>{t('auth.portal.link')}</a>
          </p>
        ) : null}

        <Field
          label={t('auth.email')}
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={data?.values.email}
          error={errors?.email ? t(errors.email) : undefined}
          required
        />
        {isRegister ? (
          <Field
            label={t('auth.displayName')}
            name="displayName"
            autoComplete="name"
            defaultValue={data?.values.displayName}
            hint={t('auth.displayNameHint')}
            error={errors?.displayName ? t(errors.displayName) : undefined}
          />
        ) : null}
        <Field
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          hint={isRegister ? t('auth.passwordHint') : undefined}
          error={errors?.password ? t(errors.password) : undefined}
          required
        />

        <Button type="submit" size="lg" loading={busy}>
          {t(`${copy}.submit`)}
        </Button>
      </Form>

      <p className={styles.switch}>
        {t(isRegister ? 'auth.register.haveAccount' : 'auth.signIn.noAccount')}{' '}
        <Link to={other}>
          {t(isRegister ? 'auth.register.toSignIn' : 'auth.signIn.toRegister')}
        </Link>
      </p>
    </main>
  );
}
