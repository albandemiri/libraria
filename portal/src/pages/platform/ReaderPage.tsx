import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { type ReaderDevice, useReader, useReaderActions } from '../../api/admin';
import { ApiError } from '../../api/client';
import Notice from '../../components/Notice';
import { currentLanguage } from '../../i18n';
import { formatDate } from '../../lib/format';
import {
  Button,
  type Column,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  LastUpdated,
  LoadingState,
  StatusBadge,
} from '../../ui';
import styles from '../Page.module.css';
import Section from '../Section';
import FocusedNotice from './FocusedNotice';
import local from './Platform.module.css';

type Step = { kind: 'suspend' } | { kind: 'reset' } | { kind: 'device'; device: ReaderDevice };

/** One reader for support: account status, devices and the device-removal allowance. */
export default function ReaderPage() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { readerId = '' } = useParams();
  const detail = useReader(readerId);
  const { status, removeDevice, resetRemovals } = useReaderActions(readerId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const handOver = useRef(false);
  const returnFocus = (event: Event) => {
    if (!handOver.current) return;
    handOver.current = false;
    event.preventDefault();
    headingRef.current?.focus();
  };
  const [step, setStep] = useState<Step | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const error = detail.error;
  // A made-up or malformed id is "not found", not a failure to retry.
  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
    return (
      <div className={styles.page}>
        <EmptyState
          title={t('platform.reader.notFoundTitle')}
          body={t('platform.reader.notFoundBody')}
          action={
            <Link to="/platform/readers" className={styles.link}>
              {t('platform.reader.all')}
            </Link>
          }
        />
      </div>
    );
  }
  if (detail.isError && !detail.data) return <ErrorState onRetry={() => void detail.refetch()} />;
  if (detail.isPending || !detail.data) return <LoadingState />;

  const { reader, booksOwned, devices, removalsThisYear } = detail.data;
  const suspended = reader.status === 'suspended';
  const failure = [status, removeDevice, resetRemovals].find((m) => m.isError)?.error ?? null;

  const resetMessages = () => {
    status.reset();
    removeDevice.reset();
    resetRemovals.reset();
    setDone(null);
  };
  const run = (
    mutation: { mutate: (v: never, o: { onSuccess: () => void; onSettled: () => void }) => void },
    variables: unknown,
    message: string,
  ) => {
    resetMessages();
    mutation.mutate(variables as never, {
      onSuccess: () => {
        setDone(message);
        // The trigger may be gone (a removed device), so the closing dialog hands focus to the heading.
        handOver.current = true;
      },
      onSettled: () => setStep(null),
    });
  };

  const deviceState = (d: ReaderDevice) =>
    d.revokedAt ? 'removed' : d.counted ? 'inUse' : 'inactive';

  const columns: Array<Column<ReaderDevice>> = [
    {
      key: 'name',
      header: t('platform.reader.device'),
      rowHeader: true,
      cell: (d) => <span className={local.wrapCell}>{d.displayName}</span>,
    },
    { key: 'platform', header: t('platform.reader.platform'), cell: (d) => d.platform },
    {
      key: 'state',
      header: t('status.label'),
      cell: (d) => (
        <StatusBadge
          tone={
            deviceState(d) === 'inUse'
              ? 'positive'
              : deviceState(d) === 'removed'
                ? 'negative'
                : 'neutral'
          }
        >
          {t(`platform.reader.deviceState.${deviceState(d)}`)}
        </StatusBadge>
      ),
    },
    {
      key: 'registered',
      header: t('platform.reader.registered'),
      cell: (d) => formatDate(d.registeredAt, lang),
    },
    {
      key: 'seen',
      header: t('platform.reader.lastSeen'),
      cell: (d) => formatDate(d.lastSeenAt, lang),
    },
    {
      key: 'actions',
      header: <span className="ui-sr-only">{t('platform.team.actions')}</span>,
      align: 'end',
      cell: (d) =>
        d.revokedAt ? null : (
          <Button
            size="sm"
            aria-label={t('platform.reader.removeLabel', { name: d.displayName })}
            onClick={() => {
              resetMessages();
              setStep({ kind: 'device', device: d });
            }}
          >
            {t('platform.reader.remove')}
          </Button>
        ),
    },
  ];

  const busy = status.isPending || removeDevice.isPending || resetRemovals.isPending;

  return (
    <div className={styles.page}>
      <Link to="/platform/readers" className={`${styles.link} ${local.back}`}>
        {t('platform.reader.all')}
      </Link>
      <div className={styles.sectionHead}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {reader.email}
        </h1>
        <LastUpdated
          updatedAt={detail.dataUpdatedAt}
          isFetching={detail.isFetching}
          onRefresh={() => void detail.refetch()}
        />
      </div>

      {detail.isError && <Notice tone="error">{t('platform.reader.refreshFailed')}</Notice>}
      {done && <Notice tone="info">{done}</Notice>}
      {failure !== null && <FocusedNotice error={failure} />}

      <dl className={local.facts}>
        <div>
          <dt>{t('platform.team.name')}</dt>
          <dd>{reader.displayName ?? t('common.none')}</dd>
        </div>
        <div>
          <dt>{t('status.label')}</dt>
          <dd>
            <StatusBadge tone={suspended ? 'negative' : 'positive'}>
              {t(`platform.team.status.${reader.status}`)}
            </StatusBadge>
          </dd>
        </div>
        <div>
          <dt>{t('platform.team.created')}</dt>
          <dd>{formatDate(reader.createdAt, lang)}</dd>
        </div>
        <div>
          <dt>{t('platform.reader.booksOwned')}</dt>
          <dd>{booksOwned}</dd>
        </div>
        <div>
          <dt>{t('platform.reader.removals')}</dt>
          <dd>{removalsThisYear}</dd>
        </div>
      </dl>

      <div className={local.rowActions}>
        {suspended ? (
          <Button
            disabled={busy}
            onClick={() => run(status, 'active', t('platform.reader.reactivated'))}
          >
            {t('platform.team.reactivate')}
          </Button>
        ) : (
          <Button
            onClick={() => {
              resetMessages();
              setStep({ kind: 'suspend' });
            }}
          >
            {t('platform.team.suspend')}
          </Button>
        )}
        <Button
          onClick={() => {
            resetMessages();
            setStep({ kind: 'reset' });
          }}
        >
          {t('platform.reader.reset')}
        </Button>
      </div>

      <Section title={t('platform.reader.devices')}>
        {devices.length === 0 ? (
          <p className={`${styles.muted} ${styles.emptyCard}`}>{t('platform.reader.noDevices')}</p>
        ) : (
          <DataTable
            ariaLabel={t('platform.reader.devicesTable')}
            columns={columns}
            rows={devices}
            rowKey={(d) => d.id}
          />
        )}
      </Section>

      {step?.kind === 'suspend' && (
        <Dialog
          open
          onCloseAutoFocus={returnFocus}
          onOpenChange={(open) => !open && setStep(null)}
          title={t('platform.reader.suspendTitle', { email: reader.email })}
          description={t('platform.reader.suspendBody')}
          actions={
            <>
              <Button onClick={() => setStep(null)}>{t('platform.cancel')}</Button>
              <Button
                variant="danger"
                loading={status.isPending}
                onClick={() => run(status, 'suspended', t('platform.reader.suspended'))}
              >
                {t('platform.team.suspend')}
              </Button>
            </>
          }
        >
          {null}
        </Dialog>
      )}
      {step?.kind === 'reset' && (
        <Dialog
          open
          onCloseAutoFocus={returnFocus}
          onOpenChange={(open) => !open && setStep(null)}
          title={t('platform.reader.resetTitle')}
          description={t('platform.reader.resetBody')}
          actions={
            <>
              <Button onClick={() => setStep(null)}>{t('platform.cancel')}</Button>
              <Button
                variant="primary"
                loading={resetRemovals.isPending}
                onClick={() => run(resetRemovals, undefined, t('platform.reader.resetDone'))}
              >
                {t('platform.reader.resetYes')}
              </Button>
            </>
          }
        >
          {null}
        </Dialog>
      )}
      {step?.kind === 'device' && (
        <Dialog
          open
          onCloseAutoFocus={returnFocus}
          onOpenChange={(open) => !open && setStep(null)}
          title={t('platform.reader.removeTitle', { name: step.device.displayName })}
          description={t('platform.reader.removeBody')}
          actions={
            <>
              <Button onClick={() => setStep(null)}>{t('platform.cancel')}</Button>
              <Button
                variant="danger"
                loading={removeDevice.isPending}
                onClick={() =>
                  run(
                    removeDevice,
                    step.device.id,
                    t('platform.reader.removed', { name: step.device.displayName }),
                  )
                }
              >
                {t('platform.reader.remove')}
              </Button>
            </>
          }
        >
          {null}
        </Dialog>
      )}
    </div>
  );
}
