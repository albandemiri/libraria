import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { presetRange } from '../lib/periods';
import {
  BookCover,
  DataTable,
  BarChart,
  DateRangePicker,
  Dialog,
  Figure,
  FigureRow,
  NotSetUpState,
  SidePanel,
  StatusBadge,
} from './index';

expect.extend(axeMatchers);

// jsdom has no canvas, so axe cannot compute colours; contrast is verified by calculation instead.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

type Row = { id: string; title: string; copies: number };
const rows: Row[] = [
  { id: 'a', title: 'Dritare', copies: 1234 },
  { id: 'b', title: 'Qyteti', copies: 5 },
];
const columns = [
  { key: 'title', header: 'Title', cell: (r: Row) => r.title, sortKey: 'title' },
  { key: 'copies', header: 'Copies', cell: (r: Row) => r.copies, align: 'end' as const },
];

describe('StatusBadge', () => {
  it('renders its label and a non-colour signal', () => {
    const { container } = render(<StatusBadge tone="positive">Live</StatusBadge>);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(container.querySelector('svg, [data-icon]')).not.toBeNull();
  });
  it('uses a custom icon when given', () => {
    render(
      <StatusBadge tone="info" icon={<span data-testid="ic" />}>
        X
      </StatusBadge>,
    );
    expect(screen.getByTestId('ic')).toBeInTheDocument();
  });
});

describe('DataTable', () => {
  it('reports sort changes through the callback', async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'title', order: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Title/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'title', order: 'desc' });
    expect(screen.getByRole('columnheader', { name: /Title/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });
  it('right-aligns numeric columns and keeps row order', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText('1234').closest('td')).toHaveAttribute('data-align', 'end');
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
  it('does not fire onRowClick for controls inside a row', async () => {
    const onRowClick = vi.fn();
    const cols = [
      ...columns,
      { key: 'x', header: 'Act', cell: () => <button type="button">Inner</button> },
    ];
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Inner' })[0] as HTMLElement);
    expect(onRowClick).not.toHaveBeenCalled();
  });
  it('makes the scroll region focusable only when labelled', () => {
    const { container, rerender } = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />,
    );
    expect(container.querySelector('[tabindex]')).toBeNull();
    rerender(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} ariaLabel="Books" />);
    expect(screen.getByRole('region', { name: 'Books' })).toHaveAttribute('tabindex', '0');
  });
  it('keeps clickable rows out of the tab order (a real control inside is the keyboard way in)', () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={() => {}} />,
    );
    expect(container.querySelector('tr[tabindex]')).toBeNull();
  });
  it('calls onRowClick', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );
    await userEvent.click(screen.getByText('Qyteti'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });
});

function DialogHarness({ kind }: { kind: 'dialog' | 'panel' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      {kind === 'dialog' ? (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Confirm"
          description="Sure?"
          actions={<button type="button">Yes</button>}
        >
          <p>Body</p>
        </Dialog>
      ) : (
        <SidePanel open={open} onOpenChange={setOpen} title="Order">
          <button type="button">Inside</button>
        </SidePanel>
      )}
    </>
  );
}

describe.each(['dialog', 'panel'] as const)('%s focus management', (kind) => {
  it('moves focus in, closes on Esc and returns focus to the trigger', async () => {
    render(<DialogHarness kind={kind} />);
    const trigger = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(trigger);
    const dlg = await screen.findByRole('dialog');
    expect(dlg).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('BookCover', () => {
  it('resolves an API cover path against an absolute API base, and leaves it as is otherwise', () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.libraria.example/api/v1');
    const absolute = render(<BookCover title="A" src="/api/v1/books/b1/cover?v=2" size="sm" />);
    expect(absolute.container.querySelector('img')?.getAttribute('src')).toBe(
      'https://api.libraria.example/api/v1/books/b1/cover?v=2',
    );
    absolute.unmount();
    vi.stubEnv('VITE_API_BASE', '/api/v1');
    const same = render(<BookCover title="A" src="/api/v1/books/b1/cover?v=2" size="sm" />);
    expect(same.container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/v1/books/b1/cover?v=2',
    );
    vi.unstubAllEnvs();
  });

  it('falls back to the title initial when the image fails', () => {
    const { container } = render(<BookCover title="Dritare" src="http://x/bad.jpg" size="md" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    if (img) fireEvent.error(img);
    return waitFor(() => expect(screen.getByText('D')).toBeInTheDocument());
  });
  it('falls back immediately when src is null', () => {
    render(<BookCover title="qyteti" src={null} size="sm" />);
    expect(screen.getByText('Q')).toBeInTheDocument();
  });
});

describe('Figure', () => {
  it('renders label, value and caption', () => {
    render(<Figure label="Net" value="€10.00" caption="Net · this month" />);
    expect(screen.getByText('Net · this month')).toBeInTheDocument();
    expect(screen.getByText('€10.00')).toBeInTheDocument();
  });
});

describe('NotSetUpState', () => {
  it('shows no digits', () => {
    const { container } = render(<NotSetUpState title="Payouts" body="Not set up yet." />);
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });
});

describe('DateRangePicker', () => {
  it('presets call onChange with presetRange output', async () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        value={presetRange('this_month', new Date())}
        onChange={onChange}
        presets={['this_month', 'last_month']}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Last month' }));
    expect(onChange).toHaveBeenCalledWith(presetRange('last_month', new Date()));
  });
});

describe('BarChart', () => {
  it('exposes a text summary instead of the graphic', () => {
    render(
      <BarChart
        data={[
          { x: 'Jan', v: 1 },
          { x: 'Feb', v: 2 },
        ]}
        xKey="x"
        series={[{ key: 'v', label: 'Gross' }]}
        ariaLabel="Sales"
      />,
    );
    expect(screen.getByText(/Sales: 2 data points from Jan to Feb/)).toBeInTheDocument();
  });
  it('shows a visible text legend with every series name', () => {
    render(
      <BarChart
        data={[{ x: 'Jan', a: 1, b: 2 }]}
        xKey="x"
        series={[
          { key: 'a', label: 'Gross' },
          { key: 'b', label: 'Net' },
        ]}
        ariaLabel="Sales"
      />,
    );
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getByText('Gross')).toBeVisible();
    expect(within(legend).getByText('Net')).toBeVisible();
  });
});

describe('accessibility', () => {
  it('has no axe violations on a composed sample', async () => {
    const { container } = render(
      <main>
        <FigureRow>
          <Figure label="Gross" value="€10.00" caption="Gross · this month" />
          <Figure label="Net" value="€8.00" caption="Net · this month" emphasis />
        </FigureRow>
        <StatusBadge tone="pending">Processing</StatusBadge>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onSortChange={() => {}} />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
    expect(within(container).getAllByRole('row').length).toBeGreaterThan(0);
  });
});
