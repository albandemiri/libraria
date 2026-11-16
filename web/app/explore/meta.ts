import type { MetaDescriptor } from 'react-router';
import { createI18n, isLang } from '../i18n';
import type { ExploreData } from './ExplorePage';

type MetaArgs = {
  data: ExploreData | undefined;
  error?: unknown;
  matches: ReadonlyArray<{ id: string; data?: unknown } | undefined>;
};

/** Title per mode, a description, and a canonical URL without `view` or `page=1`. */
export function exploreMeta({ data, error, matches }: MetaArgs): MetaDescriptor[] {
  if (!data || error) {
    // The 404 page inside the shell: its language comes from the root loader.
    const rootLang = (matches.find((m) => m?.id === 'root')?.data as { lang?: unknown } | undefined)
      ?.lang;
    const { t } = createI18n(isLang(rootLang) ? rootLang : 'sq');
    return [{ title: t('explore.metaTitle', { title: t('notFound.title') }) }];
  }
  const { t } = createI18n(data.lang);
  const title = t('explore.metaTitle', { title: data.title });
  const description =
    data.description ??
    (data.mode === 'publisher'
      ? t('explore.metaDescription.publisher', { name: data.title })
      : data.mode === 'search'
        ? t('explore.metaDescription.search')
        : t('explore.metaDescription.all'));
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: t('app.name') },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { tagName: 'link', rel: 'canonical', href: data.canonical },
  ];
}
