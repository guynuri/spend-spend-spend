import { useMe } from '../lib/session';

/** Filled in M7 (sample data). */
export function SampleDataBanner() {
  const me = useMe();
  if (!me?.active?.hasSampleData) return null;
  return null;
}
