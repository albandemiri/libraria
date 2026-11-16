import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Form, useLoaderData, useLocation, useNavigation } from 'react-router';
import { BookCard } from '../books/BookCard';
import type { Lang } from '../i18n';
import type { Facets, PublisherSummary, StoreBook } from '../lib/types';
import { Breadcrumbs, Button, EmptyState, ErrorState, Pagination } from '../ui';
import styles from './ExplorePage.module.css';
import { FilterSheet } from './FilterSheet';
import { FiltersPanel } from './FiltersPanel';
import { GenreBar } from './GenreBar';
import { type ExploreMode, type ExploreState, clearFilters, exploreHref } from './params';
import { ResultsToolbar } from './ResultsToolbar';
import { useExploreDraft } from './useExploreDraft';

export type ExploreData = {
  mode: ExploreMode;
  lang: Lang;
  /** `prompt`: /kerko without a query; `error`: the API could not be reached. */
  status: 'ok' | 'prompt' | 'error';
  state: ExploreState;
  signedIn: boolean;
  books: StoreBook[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  facets: Facets;
  /** The genre bar, in display order. */
  genres: string[];
  publisher: PublisherSummary | null;
  title: string;
  /** The genre intro; other modes have none. */
  description: string | null;
  canonical: string;
};

function SearchPrompt() {
  const { t } = useTranslation();
  return (
    <EmptyState
      title={t('explore.prompt.title')}
      description={t('explore.prompt.description')}
      action={
        <Form method="get" action="/kerko" className={styles.prompt} role="search">
          <input
            type="search"
            name="q"
            maxLength={200}
            className={styles.promptInput}
            aria-label={t('explore.prompt.label')}
            placeholder={t('explore.prompt.label')}
          />
          <Button type="submit">{t('explore.prompt.submit')}</Button>
        </Form>
      }
    />
  );
}

/**
 * One results page for every catalogue view: all books, a genre, search results and a
 * publisher's catalogue. Everything it shows comes from the URL via the loader.
 */
export function ExplorePage() {
  const { t } = useTranslation();
  const data = useLoaderData() as ExploreData;
  const navigation = useNavigation();
  const location = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { mode, state, facets, pagination, books } = data;
  // One draft for the sidebar and the toolbar, so quick successive changes add up.
  const { draft, change } = useExploreDraft(mode, state);

  const crumb =
    mode === 'all'
      ? t('explore.allShort')
      : mode === 'search'
        ? t('explore.searchPrompt')
        : data.title;
  const selected = new Set(state.publisherIds);
  const publisherCount = facets.publishers.filter(
    (p) => p.bookCount > 0 && (selected.size === 0 || selected.has(p.id)),
  ).length;
  const loading =
    navigation.state === 'loading' && navigation.location?.pathname === location.pathname;

  return (
    <div className={styles.page}>
      <div className={styles.crumbs}>
        <Breadcrumbs items={[{ label: t('nav.explore'), href: '/eksploro' }, { label: crumb }]} />
      </div>
      <div className={styles.headWrap}>
        <header className={styles.head}>
          <div>
            <h1 className={styles.title}>{data.title}</h1>
            {data.description ? <p className={styles.intro}>{data.description}</p> : null}
          </div>
          {data.status === 'ok' ? (
            <p className={styles.count}>
              {t('explore.count', {
                books: t('masthead.books', { count: pagination.total }),
                publishers: t('masthead.publishers', { count: publisherCount }),
              })}
            </p>
          ) : null}
        </header>
      </div>

      {data.status === 'prompt' ? (
        <SearchPrompt />
      ) : (
        <>
          <GenreBar mode={mode} state={state} genres={data.genres} />
          <div className={styles.body}>
            <aside className={styles.sidebar} aria-label={t('explore.filters.label')}>
              <FiltersPanel data={data} draft={draft} change={change} />
            </aside>
            <section
              className={styles.results}
              aria-label={t('explore.results')}
              aria-busy={loading || undefined}
            >
              <ResultsToolbar
                data={data}
                draft={draft}
                change={change}
                onOpenFilters={() => setSheetOpen(true)}
              />
              {data.status === 'error' ? (
                <ErrorState
                  title={t('explore.error.title')}
                  description={t('explore.error.description')}
                  action={
                    <Button asChild variant="secondary">
                      <a href={exploreHref(mode, state)}>{t('explore.error.retry')}</a>
                    </Button>
                  }
                />
              ) : books.length === 0 ? (
                <EmptyState
                  title={t('explore.empty.title')}
                  description={t('explore.empty.description')}
                  action={
                    <Button asChild variant="secondary">
                      <a href={exploreHref(mode, clearFilters(state, mode))}>
                        {t('explore.empty.clear')}
                      </a>
                    </Button>
                  }
                />
              ) : (
                <>
                  <ul
                    className={
                      state.view === 'list' ? styles.list : `${styles.list} ${styles.grid}`
                    }
                  >
                    {books.map((book) => (
                      <li key={book.id}>
                        <BookCard book={book} variant={state.view} showPublisher />
                      </li>
                    ))}
                  </ul>
                  <Pagination
                    page={pagination.page}
                    totalPages={pagination.totalPages}
                    hrefFor={(page) => exploreHref(mode, { ...state, page })}
                  />
                </>
              )}
            </section>
          </div>
          <FilterSheet data={data} open={sheetOpen} onOpenChange={setSheetOpen} />
        </>
      )}
    </div>
  );
}
