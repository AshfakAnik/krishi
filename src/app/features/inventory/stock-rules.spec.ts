import { describe, expect, it } from 'vitest';
import { Sale, StockLot } from '../../core/models/harvest';
import {
  MAX_ADJUSTMENT_PERCENT,
  LotDraft,
  adjustmentError,
  applyAdjustment,
  remaining,
  revertAdjustment,
  splitLot,
  stockByHolder,
  validateLot,
} from './stock-rules';

const lot = (o: Partial<StockLot> = {}): StockLot =>
  ({
    id: 'lot-1',
    reference: 'LOT-2025-001',
    cycleId: 'cyc-2',
    batchId: 'bat-1',
    grade: 'a',
    heldFor: 'pool',
    quantity: 64,
    location: 'North bay',
    storedOn: '2025-10-25',
    note: '',
    ...o,
  }) as StockLot;

const sale = (o: Partial<Sale> = {}): Sale =>
  ({ id: 'sal-1', lotId: 'lot-1', quantity: 30, ...o }) as Sale;

const draft = (o: Partial<LotDraft> = {}): LotDraft => ({
  cycleId: 'cyc-2',
  grade: 'a',
  heldFor: 'pool',
  quantity: 40,
  location: 'North bay',
  storedOn: '2025-10-25',
  note: '',
  ...o,
});

describe('what is left in a lot', () => {
  it('takes off everything sold from it', () => {
    expect(remaining(lot(), [sale()])).toBe(34);
    expect(
      remaining(lot(), [sale({ id: 'a', quantity: 30 }), sale({ id: 'b', quantity: 34 })]),
    ).toBe(0);
  });

  it('ignores sales off other lots, and never goes negative', () => {
    expect(remaining(lot(), [sale({ lotId: 'lot-9', quantity: 60 })])).toBe(64);
    expect(remaining(lot({ quantity: 10 }), [sale({ quantity: 30 })])).toBe(0);
  });

  it('totals stock by whose it is', () => {
    const totals = stockByHolder([
      lot({ id: 'a', heldFor: 'pool', quantity: 34 }),
      lot({ id: 'b', heldFor: 'owner', quantity: 12 }),
      lot({ id: 'c', heldFor: 'sharecropper', quantity: 18 }),
      lot({ id: 'd', heldFor: 'owner', quantity: 6 }),
    ]);
    expect(totals).toEqual({ pool: 34, owner: 18, sharecropper: 18 });
  });
});

describe('recording a lot', () => {
  it('accepts a complete draft', () => {
    expect(validateLot(draft())).toEqual({});
  });

  it('needs a cycle, a quantity, a place and a date', () => {
    expect(validateLot(draft({ cycleId: '' }))).toHaveProperty('cycleId');
    expect(validateLot(draft({ quantity: 0 }))).toHaveProperty('quantity');
    expect(validateLot(draft({ location: '  ' }))).toHaveProperty('location');
    expect(validateLot(draft({ storedOn: '' }))).toHaveProperty('storedOn');
  });
});

describe('adjusting for wastage in store', () => {
  it('accepts a plausible loss', () => {
    expect(adjustmentError(lot(), 4, [])).toBe('');
  });

  it('refuses nothing, and refuses a negative', () => {
    expect(adjustmentError(lot(), 0, [])).toContain('quantity lost');
    expect(adjustmentError(lot(), -5, [])).toContain('positive');
  });

  it('refuses losing more than is left after sales', () => {
    // Otherwise a lot goes negative and the settlement stops reconciling.
    expect(adjustmentError(lot(), 40, [sale()])).toContain('34 maund is left');
  });

  it('refuses an implausible proportion of the lot', () => {
    expect(adjustmentError(lot(), 30, [])).toContain(String(MAX_ADJUSTMENT_PERCENT));
  });

  it('reverts exactly', () => {
    expect(revertAdjustment(applyAdjustment(lot(), 4), 4)).toEqual(lot());
  });
});

describe('splitting a pooled lot in kind', () => {
  const ids = {
    ownerId: 'lot-o',
    ownerReference: 'LOT-2025-002',
    tenantId: 'lot-s',
    tenantReference: 'LOT-2025-003',
  };

  it('divides a pool into two lots that add back to it', () => {
    const split = splitLot(lot({ quantity: 64 }), 0.5, ids);
    expect(split.owner.quantity + split.sharecropper.quantity).toBe(64);
    expect(split.owner).toMatchObject({ heldFor: 'owner', quantity: 32 });
    expect(split.sharecropper).toMatchObject({ heldFor: 'sharecropper', quantity: 32 });
  });

  it('gives the rounding maund to the sharecropper', () => {
    // The owner's share is the one expressed as a percentage; rounding it down
    // favours the party who did the work.
    const split = splitLot(lot({ quantity: 65 }), 0.5, ids);
    expect(split.owner.quantity).toBe(32);
    expect(split.sharecropper.quantity).toBe(33);
    expect(split.owner.quantity + split.sharecropper.quantity).toBe(65);
  });

  it('handles a Tevaga one-of-three share without losing a maund', () => {
    const split = splitLot(lot({ quantity: 64 }), 1 / 3, ids);
    expect(split.owner.quantity).toBe(21);
    expect(split.sharecropper.quantity).toBe(43);
    expect(split.owner.quantity + split.sharecropper.quantity).toBe(64);
  });

  it('carries the grade and the cycle onto both halves', () => {
    const split = splitLot(lot({ grade: 'b' }), 0.5, ids);
    expect(split.owner.grade).toBe('b');
    expect(split.sharecropper.cycleId).toBe('cyc-2');
  });
});
