import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from './ui';

/** Decimal amount field (inputmode=decimal, LTR digits inside RTL). Value is the typed text. */
export const AmountInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function AmountInput(props, ref) {
  return <Input ref={ref} inputMode="decimal" dir="ltr" autoComplete="off" className="tabular text-end" {...props} />;
});
