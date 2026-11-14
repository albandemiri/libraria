import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useBook, useBookMutations } from '../api/books';
import { ApiError } from '../api/client';
import type { Book, MediaType } from '../api/types';
import DataState from '../components/DataState';
import ScopeGate from '../components/ScopeGate';
import { parseEuroInput } from '../lib/format';

/** Cents as the "12.99" text an editor expects; string handling only, no money maths. */
function centsToInput(cents: number): string {
  const digits = String(cents).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

type Banner = { kind: 'error' | 'info'; text: string };
type ControlProps = {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
};

function BookForm({ book }: { book?: Book }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { create, update, setPublished } = useBookMutations(book?.id);
  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  const [isbn13, setIsbn13] = useState(book?.isbn13 ?? '');
  const [description, setDescription] = useState(book?.description ?? '');
  const [genre, setGenre] = useState(book?.genre ?? '');
  const [language, setLanguage] = useState(book?.language ?? 'en');
  const [price, setPrice] = useState(book ? centsToInput(book.price.amountCents) : '');
  const [coverImageUrl, setCoverImageUrl] = useState(book?.coverImageUrl ?? '');
  const [mediaType, setMediaType] = useState<MediaType>(book?.mediaType ?? 'ebook');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [live, setLive] = useState(book?.isAvailable ?? false);

  const busy = create.isPending || update.isPending || setPublished.isPending;

  function fail(err: unknown) {
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && err.details.length > 0) {
      const next: Record<string, string> = {};
      // Backend wording is English-only; show our own message for the field instead.
      for (const d of err.details) {
        const name = d.path.split('.').pop() ?? d.path;
        next[name] = t(`bookForm.fieldErrors.${name}`, {
          defaultValue: t('bookForm.fieldErrors.generic'),
        });
      }
      setFieldErrors(next);
      setBanner({ kind: 'error', text: t('bookForm.fixFields') });
      return;
    }
    const code = err instanceof ApiError ? err.code : 'generic';
    setBanner({ kind: 'error', text: t(`bookForm.errors.${code}`, t('bookForm.errors.generic')) });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});
    const priceCents = parseEuroInput(price);
    if (priceCents === null) {
      setFieldErrors({ priceCents: t('bookForm.priceInvalid') });
      return;
    }
    const input = {
      title,
      author,
      isbn13: isbn13.trim() || null,
      description: description.trim() || null,
      genre,
      language,
      priceCents,
      coverImageUrl: coverImageUrl.trim() || null,
      mediaType,
      // An ebook has no duration; null clears a stale one left from an audiobook.
      ...(mediaType === 'ebook' ? { durationSeconds: null } : {}),
    };
    try {
      if (book) {
        await update.mutateAsync(input);
        setBanner({ kind: 'info', text: t('bookForm.saved') });
      } else {
        const created = await create.mutateAsync(input);
        navigate(`/books/${created.id}`);
      }
    } catch (err) {
      fail(err);
    }
  }

  async function toggle(publish: boolean) {
    setBanner(null);
    setFieldErrors({});
    try {
      await setPublished.mutateAsync(publish);
      setLive(publish);
      setBanner({ kind: 'info', text: t(publish ? 'bookForm.published' : 'bookForm.unpublished') });
    } catch (err) {
      fail(err);
    }
  }

  const field = (name: string, label: string, control: (p: ControlProps) => ReactNode) => (
    <div className="field">
      <label htmlFor={`f-${name}`}>{label}</label>
      {control({
        id: `f-${name}`,
        ...(fieldErrors[name]
          ? { 'aria-invalid': true as const, 'aria-describedby': `e-${name}` }
          : {}),
      })}
      {fieldErrors[name] && (
        <span id={`e-${name}`} className="field-error">
          {fieldErrors[name]}
        </span>
      )}
    </div>
  );

  return (
    <div className="page">
      <h1>{t(book ? 'bookForm.editTitle' : 'pages.newBook')}</h1>
      {banner && (
        <div role={banner.kind === 'error' ? 'alert' : 'status'} className="alert state">
          {banner.text}
        </div>
      )}
      <form className="card book-form" onSubmit={(e) => void onSubmit(e)} noValidate>
        {field('title', t('books.title'), (p) => (
          <input {...p} value={title} onChange={(e) => setTitle(e.target.value)} required />
        ))}
        {field('author', t('bookForm.author'), (p) => (
          <input {...p} value={author} onChange={(e) => setAuthor(e.target.value)} required />
        ))}
        {field('isbn13', t('bookForm.isbn13'), (p) => (
          <input {...p} value={isbn13} onChange={(e) => setIsbn13(e.target.value)} />
        ))}
        {field('description', t('bookForm.description'), (p) => (
          <textarea
            {...p}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        ))}
        {field('genre', t('bookForm.genre'), (p) => (
          <input {...p} value={genre} onChange={(e) => setGenre(e.target.value)} required />
        ))}
        {field('language', t('bookForm.language'), (p) => (
          <input
            {...p}
            maxLength={2}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            required
          />
        ))}
        {field('priceCents', t('bookForm.price'), (p) => (
          <input
            {...p}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        ))}
        {field('coverImageUrl', t('bookForm.coverImageUrl'), (p) => (
          <input
            {...p}
            type="url"
            value={coverImageUrl}
            onChange={(e) => setCoverImageUrl(e.target.value)}
          />
        ))}
        {field('mediaType', t('bookForm.mediaType'), (p) => (
          <select
            {...p}
            value={mediaType}
            onChange={(e) => setMediaType(e.target.value as MediaType)}
          >
            <option value="ebook">{t('bookForm.ebook')}</option>
            <option value="audiobook">{t('bookForm.audiobook')}</option>
          </select>
        ))}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t(book ? 'bookForm.save' : 'bookForm.create')}
          </button>
          {book && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void toggle(!live)}
            >
              {t(live ? 'bookForm.unpublish' : 'bookForm.publish')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function EditBook({ id }: { id: string }) {
  const book = useBook(id);
  return (
    <DataState
      isPending={book.isPending}
      isError={book.isError}
      onRetry={() => void book.refetch()}
    >
      {book.data && <BookForm key={book.data.id} book={book.data} />}
    </DataState>
  );
}

export default function BookFormPage() {
  const { id } = useParams();
  return <ScopeGate>{id ? <EditBook id={id} /> : <BookForm />}</ScopeGate>;
}
