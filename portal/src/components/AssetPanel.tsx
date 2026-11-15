import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTerminal, useAssetMutations, useBookAssets } from '../api/assets';
import { ApiError } from '../api/client';
import type { AssetState, BookAsset } from '../api/types';
import { currentLanguage } from '../i18n';
import { formatBytes, formatDate } from '../lib/format';
import QueryView from '../pages/QueryView';
import { Button, type Column, DataTable, FileDrop, StatusBadge, type Tone } from '../ui';
import styles from './AssetPanel.module.css';
import Notice from './Notice';

const TONE: Record<AssetState, Tone> = {
  uploaded: 'pending',
  validating: 'pending',
  scanning: 'pending',
  encrypting: 'pending',
  storing: 'pending',
  ready: 'positive',
  rejected: 'negative',
  failed: 'negative',
};

/** EPUB versions of one book: upload, watch processing, choose which is live. */
export default function AssetPanel({
  bookId,
  disabled = false,
}: {
  bookId: string;
  /** Archived books are read-only: no upload and no switching the live version. */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const assets = useBookAssets(bookId);
  const { upload, activate } = useAssetMutations(bookId);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  // When processing finishes the book's derived status changes (draft/processing to ready), so
  // refetch the book once the poll sees every version settle.
  const client = useQueryClient();
  const processing = assets.data?.some((a) => !isTerminal(a.state));
  const wasProcessing = useRef(false);
  useEffect(() => {
    if (processing === undefined) return;
    if (wasProcessing.current && !processing) {
      void client.invalidateQueries({ queryKey: ['books'] });
    }
    wasProcessing.current = processing;
  }, [processing, client]);

  function fail(err: unknown) {
    const code = err instanceof ApiError ? err.code : 'generic';
    setError(t(`assets.errors.${code}`, t('assets.errors.generic')));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      await upload.mutateAsync(file);
    } catch (err) {
      fail(err);
    }
  }

  async function onActivate(assetId: string) {
    setError(null);
    setConfirming(null);
    try {
      await activate.mutateAsync(assetId);
    } catch (err) {
      fail(err);
    }
  }

  const columns: Array<Column<BookAsset>> = [
    {
      key: 'version',
      header: t('assets.versionColumn'),
      cell: (a) => <strong>{t('assets.version', { n: a.version })}</strong>,
    },
    {
      key: 'state',
      header: t('status.label'),
      cell: (a) => (
        <>
          <div className={styles.badges}>
            <StatusBadge tone={TONE[a.state]}>{t(`assets.states.${a.state}`)}</StatusBadge>
            {a.isCurrent && <StatusBadge tone="positive">{t('assets.live')}</StatusBadge>}
          </div>
          {a.reasonCode && (
            <p className={styles.reason}>
              {t(`assets.reasons.${a.reasonCode}`, t('assets.reasons.generic'))}
            </p>
          )}
        </>
      ),
    },
    {
      key: 'size',
      header: t('assets.size'),
      align: 'end',
      cell: (a) => formatBytes(a.originalSizeBytes, lang),
    },
    {
      key: 'uploaded',
      header: t('assets.uploadedOn'),
      cell: (a) => formatDate(a.createdAt, lang),
    },
    {
      key: 'action',
      header: <span className="ui-sr-only">{t('assets.actions')}</span>,
      cell: (a) => {
        if (a.state !== 'ready' || a.isCurrent || disabled) return null;
        if (confirming !== a.id) {
          return (
            <Button size="sm" onClick={() => setConfirming(a.id)}>
              {t('assets.activate')}
            </Button>
          );
        }
        return (
          <div className={styles.confirm}>
            <span>{t('assets.confirm')}</span>
            <Button
              size="sm"
              variant="primary"
              disabled={activate.isPending}
              onClick={() => void onActivate(a.id)}
            >
              {t('assets.confirmYes')}
            </Button>
            <Button size="sm" onClick={() => setConfirming(null)}>
              {t('assets.cancel')}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className={styles.panel}>
      {error && <Notice tone="error">{error}</Notice>}
      <FileDrop
        title={t('assets.upload')}
        accept=".epub,application/epub+zip"
        hint={t('assets.uploadHint')}
        disabled={upload.isPending || disabled}
        onFiles={(files) => void onFile(files[0])}
      />
      <QueryView query={assets} isEmpty={assets.data?.length === 0} emptyBody={t('assets.empty')}>
        <DataTable
          ariaLabel={t('assets.title')}
          rows={assets.data ?? []}
          rowKey={(a) => a.id}
          columns={columns}
        />
      </QueryView>
    </div>
  );
}
