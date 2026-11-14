import type { ItemStatus } from './base';

export interface SalesLine {
  paidAt: string;
  transactionId: string;
  book: { id: string; title: string };
  country: string | null;
  status: ItemStatus;
  unitPriceCents: number;
  taxCents: number;
  feeCents: number | null;
  commissionRateBps: number | null;
  commissionCents: number;
  earningsCents: number;
  refundedCents: number;
  split: 'done' | 'pending' | 'no_rate';
}

/** RFC 4180 quoting, plus a leading apostrophe so spreadsheets don't run formulas. */
export function csvField(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Cents as a decimal string with 2 places, using integer arithmetic only. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const CSV_HEADERS: Record<'en' | 'sq', string[]> = {
  en: [
    'Paid at',
    'Transaction ID',
    'Book ID',
    'Title',
    'Country',
    'Status',
    'Unit price',
    'VAT',
    'Fee',
    'Commission (%)',
    'Commission',
    'Earnings',
    'Refunded',
    'Split',
  ],
  sq: [
    'Data e pagesës',
    'ID e transaksionit',
    'ID e librit',
    'Titulli',
    'Shteti',
    'Statusi',
    'Çmimi',
    'TVSH',
    'Tarifa',
    'Komisioni (%)',
    'Komisioni',
    'Fitimi',
    'Rimbursuar',
    'Ndarja',
  ],
};

export function toCsvRow(line: SalesLine): string {
  // Amounts are formatted numbers (a leading "-" is a sign, not a formula), so
  // only free text goes through csvField's neutralising.
  return [
    csvField(line.paidAt),
    csvField(line.transactionId),
    csvField(line.book.id),
    csvField(line.book.title),
    csvField(line.country),
    csvField(line.status),
    formatCents(line.unitPriceCents),
    formatCents(line.taxCents),
    line.feeCents === null ? '' : formatCents(line.feeCents),
    // bps/100 with 2 decimals is the same digits as cents/100.
    line.commissionRateBps === null ? '' : formatCents(line.commissionRateBps),
    formatCents(line.commissionCents),
    formatCents(line.earningsCents),
    formatCents(line.refundedCents),
    csvField(line.split),
  ].join(',');
}
