import { Link } from 'react-router';
import { Kicker } from './Kicker';
import styles from './SectionHeader.module.css';

type Props = {
  kicker?: string;
  title: string;
  description?: string;
  action?: { href: string; label: string };
  /** Heading level; sections sit under the page's h1. */
  as?: 'h2' | 'h3';
  onDark?: boolean;
};

export function SectionHeader({
  kicker,
  title,
  description,
  action,
  as: Heading = 'h2',
  onDark,
}: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {kicker ? <Kicker onDark={onDark}>{kicker}</Kicker> : null}
        <Heading className={styles.title}>{title}</Heading>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {action ? (
        <Link to={action.href} className={styles.action}>
          {action.label}
        </Link>
      ) : null}
    </header>
  );
}
