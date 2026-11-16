import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router';
import { ComingSoon, type ComingSoonKind } from '../layout/ComingSoon';

function kindOf(pathname: string): ComingSoonKind {
  if (pathname.startsWith('/lexo')) return 'reader';
  if (pathname.startsWith('/lista')) return 'lists';
  return 'library';
}

export default function ComingSoonRoute() {
  const { t } = useTranslation();
  const kind = kindOf(useLocation().pathname);
  const { id } = useParams();
  return (
    <>
      <title>{`${t(`comingSoon.${kind}.title`)} · ${t('app.name')}`}</title>
      <ComingSoon kind={kind} bookId={id} />
    </>
  );
}
