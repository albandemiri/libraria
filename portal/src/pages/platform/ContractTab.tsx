import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type RateInput, useAddRate, usePublisherRates } from '../../api/admin';
import type { CommissionRate } from '../../api/types';
import Notice from '../../components/Notice';
import { currentLanguage } from '../../i18n';
import { useFocusFirstInvalid } from '../../lib/useFocusFirstInvalid';
import { formatDate, formatPercentBps, parseEuroInput } from '../../lib/format';
import {
  Button,
  type Column,
  DataTable,
  Dialog,
  Field,
  Input,
  StatusBadge,
  type Tone,
} from '../../ui';
import styles from '../Page.module.css';
import QueryView from '../QueryView';
import Section from '../Section';
import { adminErrorKey } from './adminErrors';
import local from './Platform.module.css';

const TONE: Record<CommissionRate['status'], Tone> = {
  active: 'positive',
  scheduled: 'pending',
  superseded: 'neutral',
};

const MAX_BPS = 10_000;

function AddRateDialog({ publisherId, onClose }: { publisherId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const add = useAddRate(publisherId);
  const formId = useId();
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState('');
  const [reference, setReference] = useState('');
  const [rateError, setRateError] = useState<string | undefined>();
  const { formRef, request } = useFocusFirstInvalid();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Percent with up to two decimals ("17,5") is the same decimal shape as euros: hundredths.
    const bps = parseEuroInput(rate);
    if (bps === null || bps > MAX_BPS) {
      setRateError(t('platform.contract.errors.rate'));
      request();
      return;
    }
    setRateError(undefined);
    const input: RateInput = { rateBps: bps };
    if (from) input.effectiveFrom = new Date(`${from}T00:00:00Z`).toISOString();
    if (reference.trim()) input.contractReference = reference.trim();
    add.mutate(input, { onSuccess: onClose });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('platform.contract.dialogTitle')}
      actions={
        <>
          <Button onClick={onClose}>{t('platform.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" loading={add.isPending}>
            {t('platform.contract.add')}
          </Button>
        </>
      }
    >
      <form ref={formRef} id={formId} className={local.dialogForm} onSubmit={submit} noValidate>
        {add.isError && <Notice tone="error">{t(adminErrorKey(add.error))}</Notice>}
        <Field label={t('platform.contract.rate')} error={rateError} required>
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              autoComplete="off"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('platform.contract.from')} hint={t('platform.contract.fromHint')}>
          {(props) => (
            <Input {...props} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          )}
        </Field>
        <Field label={t('platform.contract.reference')}>
          {(props) => (
            <Input
              {...props}
              autoComplete="off"
              maxLength={200}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** The publisher's rate history, and a form that adds a rate (rates are never edited). */
export default function ContractTab({ publisherId }: { publisherId: string }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const rates = usePublisherRates(publisherId);
  const [adding, setAdding] = useState(false);
  const rows = rates.data ?? [];

  const columns: Array<Column<CommissionRate>> = [
    {
      key: 'from',
      header: t('contract.effectiveFrom'),
      rowHeader: true,
      cell: (r) => formatDate(r.effectiveFrom, lang),
    },
    {
      key: 'rate',
      header: t('contract.rate'),
      align: 'end',
      cell: (r) => formatPercentBps(r.rateBps, lang),
    },
    {
      key: 'reference',
      header: t('contract.reference'),
      cell: (r) => r.contractReference ?? t('common.none'),
    },
    {
      key: 'status',
      header: t('status.label'),
      cell: (r) => (
        <StatusBadge tone={TONE[r.status]}>{t(`contract.status.${r.status}`)}</StatusBadge>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <Section
        title={t('platform.contract.title')}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t('platform.contract.add')}
          </Button>
        }
      >
        <QueryView
          query={rates}
          isEmpty={rates.isSuccess && rows.length === 0}
          emptyBody={t('platform.contract.empty')}
        >
          <DataTable
            ariaLabel={t('platform.contract.table')}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
          />
        </QueryView>
      </Section>
      {adding && <AddRateDialog publisherId={publisherId} onClose={() => setAdding(false)} />}
    </div>
  );
}
