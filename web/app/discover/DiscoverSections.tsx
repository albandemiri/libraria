import { Fragment, type ReactNode } from 'react';
import type { DiscoverSection } from '../lib/types';
import { ContinueReading } from './ContinueReading';
import styles from './DiscoverSections.module.css';
import { FeaturedMasthead } from './FeaturedMasthead';
import { GenreTiles } from './GenreTiles';
import { Interlude } from './Interlude';
import layout from './layout.module.css';
import { MostRead } from './MostRead';
import { NewReleases } from './NewReleases';
import { PublisherSpotlight } from './PublisherSpotlight';
import { Strip } from './Strip';

/** One section, or null for a type this version does not know (a later `collection`, say). */
function renderSection(section: DiscoverSection, now: string, checkoutKey?: string): ReactNode {
  switch (section.type) {
    case 'featured':
      return (
        <FeaturedMasthead book={section.book} related={section.related} checkoutKey={checkoutKey} />
      );
    case 'strip':
      return <Strip items={section.items} />;
    case 'continue_reading':
      return <ContinueReading items={section.items} now={now} />;
    case 'new_releases':
      return <NewReleases lead={section.lead} books={section.books} />;
    case 'most_read':
      return <MostRead books={section.books} />;
    case 'genres':
      return <GenreTiles genres={section.genres} />;
    case 'publisher_spotlight':
      return <PublisherSpotlight publisher={section.publisher} books={section.books} />;
    case 'interlude':
      return (
        <Interlude genre={section.genre} bookCount={section.bookCount} books={section.books} />
      );
    default:
      return null;
  }
}

const SIDE_BY_SIDE = new Set(['most_read', 'genres']);

/** Most read and genre tiles are half-width: they sit in the content column, not full bleed. */
function isHalf(section: DiscoverSection | undefined): boolean {
  return section !== undefined && SIDE_BY_SIDE.has(section.type);
}

/**
 * The Discover feed, in the order received. Most read and the genre tiles share a row when they
 * are adjacent (stacked on phones); unknown section types are skipped.
 */
export function DiscoverSections({
  sections,
  now,
  checkoutKey,
}: {
  sections: DiscoverSection[];
  /** The loader's time (ISO); relative dates are computed against it, never the render clock. */
  now: string;
  /** The page's idempotency key for the masthead's "Bli librin" (see BuyForm). */
  checkoutKey?: string;
}) {
  const out: ReactNode[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const next = sections[i + 1];
    if (isHalf(section) && isHalf(next) && next.type !== section.type) {
      out.push(
        <div key={`pair-${i}`} className={`${layout.wrap} ${styles.pair}`} data-pair="">
          {renderSection(section, now)}
          {renderSection(next, now)}
        </div>,
      );
      i++;
      continue;
    }
    const node = renderSection(section, now, checkoutKey);
    if (node === null) continue;
    out.push(
      isHalf(section) ? (
        <div key={`${section.type}-${i}`} className={layout.wrap}>
          {node}
        </div>
      ) : (
        <Fragment key={`${section.type}-${i}`}>{node}</Fragment>
      ),
    );
  }
  return <>{out}</>;
}
