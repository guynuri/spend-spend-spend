/** Tunable constants of the domain rules (PLAN D-26). */
import { norm } from '../normalize';

/** Card-issuer patterns: negative rows matching these are card lumps (PLAN §5.3). */
export const CARD_ISSUER_PATTERNS = [
  'ישראכרט', 'isracard', 'כאל', 'cal', 'מקס', 'max it', 'לאומי קארד', 'ויזה', 'visa', 'מסטרקארד', 'mastercard', 'אמריקן אקספרס', 'amex', 'דיינרס', 'diners', 'כרטיסי אשראי',
].map((p) => norm(p));
