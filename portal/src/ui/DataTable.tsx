import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import styles from './DataTable.module.css';
import { SortIcon } from './icons';

export type SortState = { key: string; order: 'asc' | 'desc' };

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'start' | 'end';
  /** Server-side sort key; columns without one are not sortable. */
  sortKey?: string;
  /** Renders this column's cells as row headers (`<th scope="row">`), for the name column. */
  rowHeader?: boolean;
};

export type Pagination = {
  /** 1-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
};

type Props<T> = {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  sort?: SortState;
  /** Sorting is server-side: the table never reorders rows itself. */
  onSortChange?: (next: SortState) => void;
  onRowClick?: (row: T) => void;
  pagination?: Pagination;
  /** Keeps the header visible while the body scrolls. Caps the table height (CSS `--table-max-h`, default 70vh). */
  stickyHeader?: boolean;
  ariaLabel?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  onRowClick,
  pagination,
  stickyHeader = false,
  ariaLabel,
}: Props<T>) {
  const { t } = useTranslation();

  const ariaSort = (col: Column<T>) =>
    col.sortKey && sort?.key === col.sortKey
      ? sort.order === 'asc'
        ? ('ascending' as const)
        : ('descending' as const)
      : undefined;

  const requestSort = (key: string) =>
    onSortChange?.({ key, order: sort?.key === key && sort.order === 'asc' ? 'desc' : 'asc' });

  // Clicks on controls inside a row (links, buttons, inputs) belong to them, not to the row.
  const onClickRow = (e: MouseEvent<HTMLTableRowElement>, row: T) => {
    const inner = (e.target as HTMLElement).closest('a,button,input,select,textarea,label');
    if (inner && e.currentTarget.contains(inner)) return;
    onRowClick?.(row);
  };

  return (
    <div>
      {/* A scrolling table must be reachable by keyboard; it scrolls instead of squashing. */}
      <div
        className={`${styles.wrap} ${stickyHeader ? styles.sticky : ''}`}
        {...(ariaLabel ? { role: 'region', 'aria-label': ariaLabel, tabIndex: 0 } : {})}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={styles.th}
                  data-align={col.align ?? 'start'}
                  aria-sort={ariaSort(col)}
                >
                  {col.sortKey && onSortChange ? (
                    <button
                      type="button"
                      className={styles.sortBtn}
                      // biome-ignore lint/style/noNonNullAssertion: guarded by the condition above
                      onClick={() => requestSort(col.sortKey!)}
                    >
                      {col.header}
                      <SortIcon dir={sort?.key === col.sortKey ? sort.order : undefined} />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={`${styles.tr} ${onRowClick ? styles.clickable : ''}`}
                onClick={onRowClick ? (e) => onClickRow(e, row) : undefined}
              >
                {columns.map((col) =>
                  col.rowHeader ? (
                    <th
                      key={col.key}
                      scope="row"
                      className={`${styles.td} ${styles.rowHeader}`}
                      data-align={col.align ?? 'start'}
                    >
                      {col.cell(row)}
                    </th>
                  ) : (
                    <td key={col.key} className={styles.td} data-align={col.align ?? 'start'}>
                      {col.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && (
        <div className={styles.footer}>
          <span>
            {t('ui.pageOf', { page: pagination.page, count: Math.max(1, pagination.pageCount) })}
          </span>
          <Button
            size="sm"
            disabled={pagination.page <= 1}
            onClick={() => pagination.onPageChange(pagination.page - 1)}
          >
            {t('common.previous')}
          </Button>
          <Button
            size="sm"
            disabled={pagination.page >= pagination.pageCount}
            onClick={() => pagination.onPageChange(pagination.page + 1)}
          >
            {t('common.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
