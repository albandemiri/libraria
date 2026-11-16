import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import styles from './GenreBar.module.css';
import { type ExploreMode, type ExploreState, exploreHref } from './params';

type Props = { mode: ExploreMode; state: ExploreState; genres: string[] };

/** "Të gjitha" plus each genre. Other filters are kept; the page goes back to 1. */
export function GenreBar({ mode, state, genres }: Props) {
  const { t } = useTranslation();
  if (genres.length === 0) return null;
  const items = [
    { key: '', label: t('explore.allShort'), genre: undefined },
    ...genres.map((genre) => ({
      key: genre,
      label: t(`genres.${genre}`, { defaultValue: genre }),
      genre,
    })),
  ];
  return (
    <nav className={styles.bar} aria-label={t('explore.genreBar')}>
      <ul className={styles.list}>
        {items.map((item) => {
          const current = (state.genre ?? undefined) === item.genre;
          return (
            <li key={item.key}>
              <Link
                className={styles.link}
                to={exploreHref(mode, { ...state, genre: item.genre, page: 1 })}
                aria-current={current ? 'page' : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
