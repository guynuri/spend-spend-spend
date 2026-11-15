import { useTranslation } from 'react-i18next';
import { useCategoryMap } from '../lib/queries';

/** A transaction's display title: its description, else its category name, else "No description". */
export function useTxTitle() {
  const { t } = useTranslation();
  const cats = useCategoryMap();
  return (tx: { description: string; categoryId?: string | null }) => tx.description || (tx.categoryId && cats.get(tx.categoryId)?.name) || t('ledger.noDescription');
}

export function TxTitle({ tx }: { tx: { description: string; categoryId?: string | null } }) {
  return <bdi>{useTxTitle()(tx)}</bdi>;
}
