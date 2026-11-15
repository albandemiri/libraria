import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useBook, useBookMutations } from '../api/books';
import { ApiError } from '../api/client';
import type { Book, MediaType } from '../api/types';
import AssetPanel from '../components/AssetPanel';
import CoverPanel from '../components/CoverPanel';
import DistributionPanel from '../components/DistributionPanel';
import Notice from '../components/Notice';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { formatMoney, parseEuroInput } from '../lib/format';
import {
  BookCard,
  Button,
  ErrorState,
  Field,
  FormSection,
  Input,
  Select,
  Stepper,
  Textarea,
} from '../ui';
import styles from './BookEditorPage.module.css';
import page from './Page.module.css';
import QueryView from './QueryView';
import { bookLanguageOptions, DEFAULT_BOOK_LANGUAGE } from '../lib/bookLanguages';

/** Cents as the "12.99" text an editor expects; string handling only, no money maths. */
function centsToInput(cents: number): string {
  const digits = String(cents).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

type Banner = { kind: 'error' | 'info'; text: string };

const STEPS = ['info', 'classification', 'commercial', 'files', 'distribution'] as const;

function BookForm({ book }: { book?: Book }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { create, update } = useBookMutations(book?.id);
  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  const [isbn13, setIsbn13] = useState(book?.isbn13 ?? '');
  const [description, setDescription] = useState(book?.description ?? '');
  const [genre, setGenre] = useState(book?.genre ?? '');
  const [language, setLanguage] = useState(book?.language ?? DEFAULT_BOOK_LANGUAGE);
  const [price, setPrice] = useState(book ? centsToInput(book.price.amountCents) : '');
  const [mediaType, setMediaType] = useState<MediaType>(book?.mediaType ?? 'ebook');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<Banner | null>(() =>
    (location.state as { created?: boolean } | null)?.created
      ? { kind: 'info', text: t('editor.created') }
      : null,
  );

  const readOnly = book?.status === 'archived';
  const busy = create.isPending || update.isPending;
  const saving = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [focusTick, setFocusTick] = useState(0);

  // After a failed save, move to the first invalid field (or the banner), so keyboard and
  // screen-reader users land on the problem.
  useEffect(() => {
    if (focusTick === 0) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid ?? bannerRef.current)?.focus();
  }, [focusTick]);

  // After create and redirect, announce the context from the top of the page.
  useEffect(() => {
    if ((location.state as { created?: boolean } | null)?.created) headingRef.current?.focus();
  }, [location.state]);
  const priceCents = parseEuroInput(price);

  // The spec's completion rules. Files and Distribution come from the server's view of the book.
  const complete = [
    title.trim() !== '' && author.trim() !== '',
    genre.trim() !== '' && language.trim() !== '',
    priceCents !== null,
    book?.hasAsset === true,
    book?.status === 'published',
  ];
  const firstOpen = complete.findIndex((done) => !done);

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
      setFocusTick((n) => n + 1);
      return;
    }
    const code = err instanceof ApiError ? err.code : 'generic';
    setBanner({ kind: 'error', text: t(`bookForm.errors.${code}`, t('bookForm.errors.generic')) });
    setFocusTick((n) => n + 1);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setBanner(null);
    setFieldErrors({});
    // A draft needs a title, author, genre and price before the server will take it.
    const missing: Record<string, string> = {};
    if (!title.trim()) missing.title = t('bookForm.fieldErrors.title');
    if (!author.trim()) missing.author = t('bookForm.fieldErrors.author');
    if (!genre.trim()) missing.genre = t('bookForm.fieldErrors.genre');
    if (!language) missing.language = t('bookForm.fieldErrors.language');
    if (priceCents === null) missing.priceCents = t('bookForm.priceInvalid');
    if (Object.keys(missing).length > 0 || priceCents === null) {
      setFieldErrors(missing);
      setBanner({ kind: 'error', text: t('bookForm.fixFields') });
      setFocusTick((n) => n + 1);
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
      mediaType,
      // An ebook has no duration; null clears a stale one left from an audiobook.
      ...(mediaType === 'ebook' ? { durationSeconds: null } : {}),
    };
    if (saving.current) return;
    saving.current = true;
    try {
      if (book) {
        await update.mutateAsync(input);
        setBanner({ kind: 'info', text: t('bookForm.saved') });
      } else {
        const created = await create.mutateAsync(input);
        navigate(`/catalog/${created.id}/edit`, { replace: true, state: { created: true } });
      }
    } catch (err) {
      fail(err);
    } finally {
      saving.current = false;
    }
  }

  const draftLike = !book || (book.status !== 'published' && book.status !== 'withdrawn');

  return (
    <div className={page.page}>
      <div className={styles.head}>
        <h1 ref={headingRef} tabIndex={-1} className={`${page.title} ${styles.heading}`}>
          {t(book ? 'bookForm.editTitle' : 'pages.newBook')}
        </h1>
        {book && (
          <Link to={`/catalog/${book.id}`} className={page.link}>
            {t('editor.viewBook')}
          </Link>
        )}
      </div>
      {banner && (
        <div ref={bannerRef} tabIndex={-1} className={styles.banner}>
          <Notice tone={banner.kind}>{banner.text}</Notice>
        </div>
      )}
      {readOnly && <Notice tone="plain">{t('lifecycle.archivedNotice')}</Notice>}
      <Stepper
        steps={STEPS.map((s) => t(`editor.steps.${s}`))}
        current={firstOpen === -1 ? STEPS.length - 1 : firstOpen}
        complete={complete}
      />
      <div className={styles.layout}>
        <form ref={formRef} className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
          <fieldset className={styles.fieldset} disabled={readOnly}>
            <FormSection title={t('editor.steps.info')} description={t('editor.infoHelp')}>
              <Field label={t('bookForm.title')} error={fieldErrors.title} required>
                {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
              <Field label={t('bookForm.author')} error={fieldErrors.author} required>
                {(p) => <Input {...p} value={author} onChange={(e) => setAuthor(e.target.value)} />}
              </Field>
              <Field label={t('bookForm.isbn13')} error={fieldErrors.isbn13}>
                {(p) => <Input {...p} value={isbn13} onChange={(e) => setIsbn13(e.target.value)} />}
              </Field>
              <Field label={t('bookForm.description')} error={fieldErrors.description}>
                {(p) => (
                  <Textarea
                    {...p}
                    rows={5}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                )}
              </Field>
            </FormSection>

            <FormSection
              title={t('editor.steps.classification')}
              description={t('editor.classificationHelp')}
            >
              <Field label={t('bookForm.genre')} error={fieldErrors.genre} required>
                {(p) => <Input {...p} value={genre} onChange={(e) => setGenre(e.target.value)} />}
              </Field>
              <Field label={t('bookForm.language')} error={fieldErrors.language} required>
                {(p) => (
                  <Select
                    {...p}
                    label={t('bookForm.language')}
                    value={language}
                    onChange={setLanguage}
                    options={bookLanguageOptions(language).map((code) => ({
                      value: code,
                      label: t(`bookLanguages.${code}`, { defaultValue: code.toUpperCase() }),
                    }))}
                  />
                )}
              </Field>
              <Field label={t('bookForm.mediaType')} error={fieldErrors.mediaType}>
                {(p) => (
                  <Select
                    {...p}
                    label={t('bookForm.mediaType')}
                    value={mediaType}
                    onChange={(v) => setMediaType(v as MediaType)}
                    options={[
                      { value: 'ebook', label: t('bookForm.ebook') },
                      { value: 'audiobook', label: t('bookForm.audiobook') },
                    ]}
                  />
                )}
              </Field>
            </FormSection>

            <FormSection
              title={t('editor.steps.commercial')}
              description={t('editor.commercialHelp')}
            >
              <Field label={t('bookForm.price')} error={fieldErrors.priceCents} required>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                )}
              </Field>
            </FormSection>

            <FormSection title={t('editor.steps.files')} description={t('editor.filesHelp')}>
              {book ? (
                <>
                  <CoverPanel book={book} />
                  <AssetPanel bookId={book.id} disabled={readOnly} />
                </>
              ) : (
                <p className={styles.hint}>{t('editor.saveFirst')}</p>
              )}
            </FormSection>

            <FormSection
              title={t('editor.steps.distribution')}
              description={t('editor.distributionHelp')}
            >
              {book ? (
                <DistributionPanel book={book} />
              ) : (
                <p className={styles.hint}>{t('editor.publishLater')}</p>
              )}
            </FormSection>

            {!readOnly && (
              <div className={styles.actions}>
                <Button type="submit" variant="primary" loading={busy}>
                  {t(draftLike ? 'editor.saveDraft' : 'editor.saveChanges')}
                </Button>
                <span className={styles.hint}>{t('editor.required')}</span>
              </div>
            )}
          </fieldset>
        </form>

        <aside className={styles.preview} aria-labelledby="preview-title">
          <h2 id="preview-title">{t('editor.preview')}</h2>
          <BookCard
            title={title.trim() || t('editor.untitled')}
            author={author.trim() || null}
            cover={book?.coverThumbUrl ?? book?.coverImageUrl ?? null}
            meta={
              <>
                {genre.trim() && <span>{genre.trim()}</span>}
                {priceCents !== null && <span>{formatMoney(priceCents, lang)}</span>}
              </>
            }
          />
          <p className={styles.previewNote}>{t('editor.previewNote')}</p>
        </aside>
      </div>
    </div>
  );
}

function EditBook({ id }: { id: string }) {
  const { t } = useTranslation();
  const book = useBook(id);
  if (book.isError) {
    const missing = book.error instanceof ApiError && book.error.status === 404;
    return (
      <ErrorState
        body={missing ? t('bookPage.notFound') : undefined}
        onRetry={() => void book.refetch()}
      />
    );
  }
  return (
    <QueryView query={book}>
      {book.data && <BookForm key={book.data.id} book={book.data} />}
    </QueryView>
  );
}

export default function BookEditorPage() {
  const { bookId: id } = useParams();
  return <ScopeGate>{id ? <EditBook id={id} /> : <BookForm />}</ScopeGate>;
}
