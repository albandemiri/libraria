import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAssetMutations, useBookAssets } from '../api/assets';
import { ApiError } from '../api/client';
import DataState from './DataState';

/** EPUB versions of one book: upload, watch processing, choose which is live. */
export default function AssetPanel({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const assets = useBookAssets(bookId);
  const { upload, activate } = useAssetMutations(bookId);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

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

  return (
    <section className="card asset-panel" aria-labelledby="assets-title">
      <h2 id="assets-title">{t('assets.title')}</h2>
      {error && (
        <div role="alert" className="alert state">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="asset-file">{t('assets.upload')}</label>
        <input
          id="asset-file"
          type="file"
          accept=".epub,application/epub+zip"
          disabled={upload.isPending}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <span>{t('assets.uploadHint')}</span>
      </div>
      <DataState
        isPending={assets.isPending}
        isError={assets.isError}
        onRetry={() => void assets.refetch()}
        isEmpty={assets.data?.length === 0}
        emptyKey="assets.empty"
      >
        <ul className="asset-list">
          {assets.data?.map((a) => (
            <li key={a.id} className="asset-row">
              <strong>{t('assets.version', { n: a.version })}</strong>{' '}
              <span className={`badge badge-${a.state}`}>{t(`assets.states.${a.state}`)}</span>{' '}
              {a.isCurrent && <span className="badge badge-live">{t('assets.live')}</span>}
              {a.reasonCode && (
                <p>{t(`assets.reasons.${a.reasonCode}`, t('assets.reasons.generic'))}</p>
              )}
              {a.state === 'ready' && !a.isCurrent && (
                <div>
                  {confirming === a.id ? (
                    <>
                      <span>{t('assets.confirm')}</span>{' '}
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={activate.isPending}
                        onClick={() => void onActivate(a.id)}
                      >
                        {t('assets.confirmYes')}
                      </button>{' '}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setConfirming(null)}
                      >
                        {t('assets.cancel')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setConfirming(a.id)}
                    >
                      {t('assets.activate')}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </DataState>
    </section>
  );
}
