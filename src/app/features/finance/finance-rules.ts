import { Party } from '../../core/models/agriculture';
import { FinanceEntry, LedgerKind, Settlement } from '../../core/models/settlement';

/**
 * Every rule of the Finance module, as plain functions over plain data. No
 * `inject`, no signals, no store, no Angular import.
 *
 * The ledger is kept separate from the settlement that produced it so a payment
 * can be recorded without reopening a division both parties have agreed.
 */

export interface FinanceDraft {
  kind: LedgerKind;
  partyId: string;
  settlementId: string;
  amount: number;
  quantity: number;
  raisedOn: string;
  note: string;
}

export function isOpen(entry: FinanceEntry): boolean {
  return entry.status === 'open';
}

/** A produce transfer moves maund, not taka — so its cash amount is nil and its
 *  quantity is what matters. Everything else is the other way round. */
export function isInKind(kind: LedgerKind): boolean {
  return kind === 'transfer';
}

export function validateEntry(
  draft: FinanceDraft,
  context: { parties: Party[]; settlements: Settlement[] },
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!draft.partyId) {
    errors['partyId'] = 'Select the person this is owed to or by.';
  } else if (!context.parties.some((row) => row.id === draft.partyId)) {
    errors['partyId'] = 'That person no longer exists.';
  }

  if (draft.settlementId && !context.settlements.some((row) => row.id === draft.settlementId)) {
    errors['settlementId'] = 'That settlement no longer exists.';
  }

  if (isInKind(draft.kind)) {
    if (!draft.quantity || draft.quantity <= 0) {
      errors['quantity'] = 'Give the quantity transferred, in maund.';
    }
  } else if (!draft.amount || draft.amount <= 0) {
    errors['amount'] = 'Give the amount.';
  } else if (!Number.isInteger(draft.amount)) {
    errors['amount'] = 'Amounts are recorded in whole taka.';
  }

  if (!draft.raisedOn) {
    errors['raisedOn'] = 'Give the date it was raised.';
  }

  return errors;
}

export function entryFromDraft(
  draft: FinanceDraft,
  ids: { id: string; reference: string },
): FinanceEntry {
  return {
    id: ids.id,
    reference: ids.reference,
    kind: draft.kind,
    partyId: draft.partyId,
    settlementId: draft.settlementId || null,
    cycleId: null,
    amount: isInKind(draft.kind) ? 0 : draft.amount,
    quantity: isInKind(draft.kind) ? draft.quantity : 0,
    raisedOn: draft.raisedOn,
    status: 'open',
    settledOn: '',
    note: draft.note.trim(),
  };
}

export function settle(entry: FinanceEntry, on: string): FinanceEntry {
  return { ...entry, status: 'settled', settledOn: on };
}

/** The inverse, for a line marked paid in error. Clears the date too — an open
 *  entry carrying one would read as settled to every total. */
export function reopen(entry: FinanceEntry): FinanceEntry {
  return { ...entry, status: 'open', settledOn: '' };
}

/**
 * What is outstanding, by direction.
 *
 * Receivables are money owed **to** the business, payables money owed **by** it.
 * Payments and transfers are records of movement, not obligations, so neither
 * counts towards an outstanding balance.
 */
export function outstanding(entries: FinanceEntry[]): {
  receivable: number;
  payable: number;
  net: number;
} {
  const open = entries.filter(isOpen);
  const receivable = open
    .filter((row) => row.kind === 'receivable')
    .reduce((total, row) => total + row.amount, 0);
  const payable = open
    .filter((row) => row.kind === 'payable')
    .reduce((total, row) => total + row.amount, 0);
  return { receivable, payable, net: receivable - payable };
}

/** The lines a settlement produces once it is agreed: what the tenant is owed,
 *  and what the owner is owed. Nothing is produced for a nil amount — an empty
 *  payable is a line nobody can act on. */
export function entriesForSettlement(
  settlement: Settlement,
  parties: { ownerId: string; sharecropperId: string },
  ids: { prefix: string; reference: (index: number) => string },
): FinanceEntry[] {
  const entries: FinanceEntry[] = [];
  const push = (kind: LedgerKind, partyId: string, amount: number, note: string) => {
    if (amount <= 0) {
      return;
    }
    entries.push({
      id: `${ids.prefix}-${entries.length}`,
      reference: ids.reference(entries.length),
      kind,
      partyId,
      settlementId: settlement.id,
      cycleId: settlement.cycleId,
      amount,
      quantity: 0,
      raisedOn: settlement.settledOn,
      status: 'open',
      settledOn: '',
      note,
    });
  };

  push(
    'payable',
    parties.sharecropperId,
    settlement.netToSharecropper,
    `${settlement.reference} · sharecropper's share after dadhon`,
  );
  push(
    'receivable',
    parties.ownerId,
    settlement.ownerProceeds,
    `${settlement.reference} · owner's share of the proceeds`,
  );
  return entries;
}

/** `FIN-2025-007` — next in sequence for the year. */
export function nextFinanceReference(entries: FinanceEntry[], year: number, offset = 0): string {
  const prefix = `FIN-${year}-`;
  const highest = entries
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1 + offset).padStart(3, '0')}`;
}
