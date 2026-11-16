import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import { createI18n } from '../i18n';
import {
  Breadcrumbs,
  Button,
  Checkbox,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Pagination,
  ProgressBar,
  Radio,
  Select,
  Sheet,
  Skeleton,
  Toggle,
} from './index';

// jsdom has no canvas, so axe cannot compute colours; contrast is checked in the design package.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

function renderUi(ui: ReactElement) {
  return render(<I18nextProvider i18n={createI18n('sq')}>{ui}</I18nextProvider>);
}

describe('Button', () => {
  it('blocks clicks and sets aria-busy while loading', async () => {
    const onClick = vi.fn();
    renderUi(
      <Button loading onClick={onClick}>
        Blej
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Blej' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('hides the plain-text label while loading but keeps the accessible name', () => {
    renderUi(
      <Button loading variant="primary">
        Blej
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Blej' });
    const label = screen.getByText('Blej');
    expect(label.className).toContain('content');
    expect(button.className).toContain('loading');
    expect(button.querySelector('[class*="spinner"]')).not.toBeNull();
  });

  it('does not run an asChild child onClick while blocked', async () => {
    const childClick = vi.fn();
    renderUi(
      <Button asChild loading>
        <a href="/x" onClick={childClick}>
          Go
        </a>
      </Button>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Go' }));
    expect(childClick).not.toHaveBeenCalled();
  });

  it('fires onClick when idle and supports asChild', async () => {
    const onClick = vi.fn();
    renderUi(
      <>
        <Button onClick={onClick}>Ok</Button>
        <Button asChild variant="onDark">
          <a href="/hyr">Hyr</a>
        </Button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ok' }));
    expect(onClick).toHaveBeenCalledOnce();
    const link = screen.getByRole('link', { name: 'Hyr' });
    expect(link).toHaveAttribute('href', '/hyr');
    expect(link.className).toContain('onDark');
    expect(link).toHaveClass('focusOnDark');
  });

  it('keeps the loading asChild link inert', async () => {
    const onClick = vi.fn();
    renderUi(
      <Button asChild loading onClick={onClick}>
        <a href="/x">Go</a>
      </Button>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Go' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Pagination', () => {
  const hrefFor = (p: number) => `?page=${p}`;

  it('marks the current page and links the others', () => {
    renderUi(<Pagination page={2} totalPages={5} hrefFor={hrefFor} />);
    expect(screen.getByRole('link', { name: /2/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Para/ })).toHaveAttribute('href', '?page=1');
    expect(screen.getByRole('link', { name: /Pas/ })).toHaveAttribute('href', '?page=3');
  });

  it('hides Para on page 1 and Pas on the last page', () => {
    const { unmount } = renderUi(<Pagination page={1} totalPages={3} hrefFor={hrefFor} />);
    expect(screen.queryByText(/Para/)).toBeNull();
    expect(screen.getByText(/Pas/)).toBeInTheDocument();
    unmount();
    renderUi(<Pagination page={3} totalPages={3} hrefFor={hrefFor} />);
    expect(screen.queryByText(/Pas/)).toBeNull();
    expect(screen.getByText(/Para/)).toBeInTheDocument();
  });
});

describe('Chip, ProgressBar, Breadcrumbs', () => {
  it('gives the remove control an accessible name and calls onRemove', async () => {
    const onRemove = vi.fn();
    renderUi(
      <Chip onRemove={onRemove} removeLabel="Hiq filtrin Ura">
        Ura
      </Chip>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Hiq filtrin Ura' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('exposes the progress value', () => {
    renderUi(<ProgressBar value={42} label="Leximi" />);
    const bar = screen.getByRole('progressbar', { name: 'Leximi' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
  });

  it('never exposes NaN as the progress value', () => {
    renderUi(<ProgressBar value={Number.NaN} label="Leximi" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('marks the last crumb as the current page', () => {
    renderUi(<Breadcrumbs items={[{ label: 'Ballina', href: '/' }, { label: 'Libri' }]} />);
    expect(screen.getByRole('link', { name: 'Ballina' })).toHaveAttribute('href', '/');
    expect(screen.getByText('Libri')).toHaveAttribute('aria-current', 'page');
  });
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Filtra
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Filtrat" footer={<Button>Apliko</Button>}>
        <Checkbox label="Fshih librat" />
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('traps focus, closes on Escape and returns focus', async () => {
    const user = userEvent.setup();
    renderUi(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Filtra' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Filtrat' });
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('axe', () => {
  it('has no violations across the primitives', async () => {
    const { container } = renderUi(
      <main>
        <Button>Primary</Button>
        <Button variant="secondary" size="lg" loading>
          Loading
        </Button>
        <Button variant="ghost" disabled>
          Ghost
        </Button>
        <Button asChild variant="onDark">
          <a href="/x">Dark</a>
        </Button>
        <Field label="Email" hint="Hint" error="Error" type="email" />
        <Checkbox label="Check" />
        <Radio name="r" label="Radio" />
        <Toggle checked onCheckedChange={() => {}} label="Toggle" />
        <Select label="Rendit">
          <option>Më të rejat</option>
        </Select>
        <Select label="Hidden" hideLabel>
          <option>A</option>
        </Select>
        <Chip onRemove={() => {}} removeLabel="Hiq">
          Ura
        </Chip>
        <Pagination page={3} totalPages={9} hrefFor={(p) => `?page=${p}`} />
        <Breadcrumbs items={[{ label: 'A', href: '/' }, { label: 'B' }]} />
        <ProgressBar value={10} label="Progres" />
        <EmptyState description="Bosh" />
        <ErrorState />
        <Skeleton />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no violations with the sheet open', async () => {
    renderUi(
      <Sheet open onOpenChange={() => {}} title="Filtrat">
        <Checkbox label="Fshih" />
      </Sheet>,
    );
    await screen.findByRole('dialog');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
