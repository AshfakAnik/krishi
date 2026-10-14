import { LotHolder, QualityGrade, Sale, StockLot } from '../../core/models/harvest';

/**
 * Every rule of the Storage & Inventory module, as plain functions over plain
 * data. No `inject`, no signals, no store, no Angular import.
 *
 * A lot is the unit a settlement divides and a sale draws from, so the two
 * things this module guards are: a lot never goes negative, and a pooled lot
 * splits into shares that add back to exactly what was pooled.
 */

/** Loss in store — rats, damp, spillage. Past this, the count was wrong. */
export const MAX_ADJUSTMENT_PERCENT = 25;

export interface LotDraft {
  cycleId: string;
  grade: QualityGrade;
  heldFor: LotHolder;
  quantity: number;
  location: string;
  storedOn: string;
  note: string;
}

/** What is left of a lot after everything sold off it. */
export function remaining(lot: StockLot, sales: Sale[]): number {
  const sold = sales
    .filter((row) => row.lotId === lot.id)
    .reduce((total, row) => total + row.quantity, 0);
  return Math.max(0, lot.quantity - sold);
}

/** Maund in store, by whose it is. */
export function stockByHolder(lots: StockLot[]): Record<LotHolder, number> {
  return lots.reduce(
    (totals, lot) => ({ ...totals, [lot.heldFor]: totals[lot.heldFor] + lot.quantity }),
    { pool: 0, owner: 0, sharecropper: 0 } as Record<LotHolder, number>,
  );
}

export function validateLot(draft: LotDraft): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!draft.cycleId) {
    errors['cycleId'] = 'Select the cycle this produce came off.';
  }

  if (!draft.quantity || draft.quantity <= 0) {
    errors['quantity'] = 'Give the quantity in store, in maund.';
  }

  if (!draft.location.trim()) {
    errors['location'] = 'Say where it is stored, so it can be found.';
  }

  if (!draft.storedOn) {
    errors['storedOn'] = 'Give the date it went into store.';
  }

  return errors;
}

/** What a wastage adjustment may not be. Positive `amount` is a loss. */
export function adjustmentError(lot: StockLot, amount: number, sales: Sale[]): string {
  if (!amount) {
    return 'Give the quantity lost.';
  }
  if (amount < 0) {
    return 'An adjustment records a loss; enter it as a positive figure.';
  }
  const left = remaining(lot, sales);
  if (amount > left) {
    // Selling then losing more than was ever there is how a lot goes negative
    // and a settlement stops reconciling.
    return `Only ${left} maund is left in this lot.`;
  }
  if (lot.quantity && (amount / lot.quantity) * 100 > MAX_ADJUSTMENT_PERCENT) {
    return `That is more than ${MAX_ADJUSTMENT_PERCENT}% of the lot — check the figure.`;
  }
  return '';
}

export function applyAdjustment(lot: StockLot, amount: number): StockLot {
  return { ...lot, quantity: Math.max(0, lot.quantity - amount) };
}

/** The inverse, for an adjustment entered against the wrong lot. */
export function revertAdjustment(lot: StockLot, amount: number): StockLot {
  return { ...lot, quantity: lot.quantity + amount };
}

/**
 * Splits a pooled lot into an owner lot and a sharecropper lot.
 *
 * This is the in-kind half of Lane 5: the owner takes their share as crop
 * rather than cash. The **sharecropper** takes the rounding maund, because the
 * owner's share is the one expressed as a percentage and rounding it down is
 * the reading that favours the party who did the work. Either way the two add
 * back to exactly what was pooled.
 */
export function splitLot(
  lot: StockLot,
  ownerShareFraction: number,
  ids: { ownerId: string; ownerReference: string; tenantId: string; tenantReference: string },
): { owner: StockLot; sharecropper: StockLot } {
  const ownerQuantity = Math.floor(lot.quantity * ownerShareFraction);
  const tenantQuantity = lot.quantity - ownerQuantity;
  const base = { ...lot, batchId: lot.batchId, storedOn: lot.storedOn };
  return {
    owner: {
      ...base,
      id: ids.ownerId,
      reference: ids.ownerReference,
      heldFor: 'owner',
      quantity: ownerQuantity,
      note: `Owner's share of ${lot.reference}`,
    },
    sharecropper: {
      ...base,
      id: ids.tenantId,
      reference: ids.tenantReference,
      heldFor: 'sharecropper',
      quantity: tenantQuantity,
      note: `Sharecropper's share of ${lot.reference}`,
    },
  };
}

export function lotFromDraft(draft: LotDraft, id: string, reference: string): StockLot {
  return {
    id,
    reference,
    cycleId: draft.cycleId,
    batchId: null,
    grade: draft.grade,
    heldFor: draft.heldFor,
    quantity: draft.quantity,
    location: draft.location.trim(),
    storedOn: draft.storedOn,
    note: draft.note.trim(),
  };
}

/** `LOT-2025-007` — next in sequence for the year. */
export function nextLotReference(lots: StockLot[], year: number, offset = 0): string {
  const prefix = `LOT-${year}-`;
  const highest = lots
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1 + offset).padStart(3, '0')}`;
}
