import { useTranslation } from 'react-i18next';
import { Construction } from 'lucide-react';
import { EmptyState, PageHeader } from '../../components/ui';

export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <div data-testid="page-placeholder">
      <PageHeader title={t(titleKey)} />
      <EmptyState icon={<Construction className="size-8" aria-hidden />} title={t('common.comingSoon')} />
    </div>
  );
}

export function NotFound() {
  const { t } = useTranslation();
  return <EmptyState title={t('errors.pageNotFound')} />;
}
