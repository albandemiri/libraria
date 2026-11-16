import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button, ErrorState } from '../ui';
import styles from './RouteErrorBoundary.module.css';

/**
 * A route-level error boundary. It renders inside the root App's outlet, so the site header and
 * footer stay: a 404 is a calm "not found" page, anything else the generic error state.
 */
export function RouteErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  const back = (
    <Button asChild variant="secondary">
      <a href="/eksploro">{t('notFound.back')}</a>
    </Button>
  );
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>{t('notFound.title')}</h1>
        <p className={styles.text}>{t('notFound.description')}</p>
        {back}
      </div>
    );
  }
  console.error(error);
  return (
    <div className={styles.wrap}>
      <ErrorState action={back} />
    </div>
  );
}
