
'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { paymentFormFields, type PayForm } from '@/lib/orders';
import type { PaymentDetails } from '@/lib/types';

/**
 * The questions a buyer answers to pay a shop by hand: the MTN / Airtel number or PayPal address the money comes
 * from, the name on it, and the transaction ID. Shown at checkout (before paying) and again on the order, where
 * the transaction ID is the one that lets the shop find the money.
 */
export function PaymentDetailsForm({ form, value, onChange, idPrefix, needReference }: {
  form: PayForm | undefined;
  value: PaymentDetails;
  onChange: (next: PaymentDetails) => void;
  idPrefix: string;
  needReference?: boolean;
}) {
  const fields = paymentFormFields(form, needReference);
  if (!fields.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.id} className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-${f.id}`}>
            {f.label}
            {f.required && <span className="text-destructive"> *</span>}
          </Label>
          <Input
            id={`${idPrefix}-${f.id}`}
            value={value[f.id] ?? ''}
            onChange={(e) => onChange({ ...value, [f.id]: e.target.value })}
            placeholder={f.placeholder}
            required={f.required}
            autoComplete={f.id === 'from' && form === 'paypal' ? 'email' : 'off'}
            inputMode={f.id === 'from' && form !== 'paypal' ? 'tel' : 'text'}
          />
        </div>
      ))}
    </div>
  );
}
