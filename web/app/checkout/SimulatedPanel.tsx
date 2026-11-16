import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Form, useNavigation } from 'react-router';
import { Button } from '../ui';
import styles from './SimulatedPanel.module.css';

/**
 * DEVELOPMENT ONLY (PAYMENTS_MODE=simulated): plays the payment provider. Each button posts to the
 * page's action, which sends the matching event through the API's sandbox; the API then runs the
 * same signed-webhook path as a real provider. The page itself never grants anything.
 */
export function SimulatedPanel() {
  const { t } = useTranslation();
  const titleId = useId();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle' && navigation.formData?.has('event') === true;

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {t('checkout.simulated.title')}
      </h2>
      <p className={styles.text}>{t('checkout.simulated.text')}</p>
      <Form method="post" className={styles.actions}>
        <Button type="submit" name="event" value="pay" disabled={busy}>
          {t('checkout.simulated.pay')}
        </Button>
        <Button type="submit" name="event" value="fail" variant="secondary" disabled={busy}>
          {t('checkout.simulated.fail')}
        </Button>
        <Button type="submit" name="event" value="cancel" variant="secondary" disabled={busy}>
          {t('checkout.simulated.cancel')}
        </Button>
      </Form>
    </section>
  );
}
