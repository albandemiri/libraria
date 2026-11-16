import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SectionHeader } from '../books/SectionHeader';
import { coverSrcById } from '../lib/format';
import type { DiscoverSection } from '../lib/types';
import styles from './GenreTiles.module.css';

type Genre = Extract<DiscoverSection, { type: 'genres' }>['genres'][number];

/** One cover of a fan. The feed only gives ids, so a missing cover simply drops out. */
function FanCover({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className={styles.cover}
      src={coverSrcById(id, 'thumb')}
      alt=""
      width={160}
      height={240}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** Genre tiles, each with a count and a fan of three covers. */
export function GenreTiles({ genres }: { genres: Genre[] }) {
  const { t } = useTranslation();
  return (
    <section data-section="genres">
      <SectionHeader
        kicker={t('discover.genreTiles.kicker')}
        title={t('discover.genreTiles.title')}
      />
      <ul className={styles.tiles}>
        {genres.map(({ genre, bookCount, coverBookIds }) => (
          <li key={genre} className={styles.tile}>
            <Link to={`/eksploro/${encodeURIComponent(genre)}`} className={styles.link}>
              <h3 className={styles.name}>{t(`genres.${genre}`, { defaultValue: genre })}</h3>
              <span className={styles.count}>{t('discover.books', { count: bookCount })}</span>
              <span className={styles.fan} aria-hidden="true">
                {coverBookIds.slice(0, 3).map((id) => (
                  <FanCover key={id} id={id} />
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
