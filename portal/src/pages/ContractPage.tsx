import { useTranslation } from 'react-i18next';
import { useContract } from '../api/books';
import DataState from '../components/DataState';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { formatDate, formatPercentBps } from '../lib/format';

function ContractContent() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const contract = useContract();
  const current = contract.data?.current;

  return (
    <div className="page">
      <h1>{t('pages.contract')}</h1>
      <DataState
        isPending={contract.isPending}
        isError={contract.isError}
        onRetry={() => void contract.refetch()}
      >
        {current ? (
          <dl className="card contract-current">
            <dt>{t('contract.rate')}</dt>
            <dd className="kpi-value">{formatPercentBps(current.rateBps, lang)}</dd>
            <dt>{t('contract.since')}</dt>
            <dd>{formatDate(current.effectiveFrom, lang)}</dd>
            <dt>{t('contract.reference')}</dt>
            <dd>{current.contractReference ?? t('common.none')}</dd>
          </dl>
        ) : (
          <p className="muted state">{t('contract.none')}</p>
        )}
        {contract.data && contract.data.history.length > 0 && (
          <>
            <h2>{t('contract.history')}</h2>
            <div className="table-wrap card">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('contract.since')}</th>
                    <th scope="col" className="num">
                      {t('contract.rate')}
                    </th>
                    <th scope="col">{t('contract.reference')}</th>
                    <th scope="col">{t('status.label')}</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.data.history.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r.effectiveFrom, lang)}</td>
                      <td className="num">{formatPercentBps(r.rateBps, lang)}</td>
                      <td>{r.contractReference ?? t('common.none')}</td>
                      <td>{r.inForce ? t('contract.inForce') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DataState>
    </div>
  );
}

export default function ContractPage() {
  return (
    <ScopeGate>
      <ContractContent />
    </ScopeGate>
  );
}
