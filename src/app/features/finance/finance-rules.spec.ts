import { describe, expect, it } from 'vitest';
import { Party } from '../../core/models/agriculture';
import { FinanceEntry, Settlement } from '../../core/models/settlement';
import {
  FinanceDraft,
  entriesForSettlement,
  entryFromDraft,
  isInKind,
  isOpen,
  outstanding,
  reopen,
  settle,
  validateEntry,
} from './finance-rules';

const party = (o: Partial<Party> = {}): Party =>
  ({ id: 'party-sc-2', name: 'Jashim Uddin', role: 'sharecropper', ...o }) as Party;

const settlement = (o: Partial<Settlement> = {}): Settlement =>
  ({
    id: 'stl-1',
    reference: 'STL-2025-001',
    cycleId: 'cyc-2',
    settledOn: '2025-11-10',
    ownerProceeds: 13810,
    netToSharecropper: 21620,
    ...o,
  }) as Settlement;

const entry = (o: Partial<FinanceEntry> = {}): FinanceEntry =>
  ({
    id: 'fin-1',
    reference: 'FIN-2025-001',
    kind: 'payable',
    partyId: 'party-sc-2',
    amount: 21620,
    quantity: 0,
    status: 'open',
    settledOn: '',
    ...o,
  }) as FinanceEntry;

const draft = (o: Partial<FinanceDraft> = {}): FinanceDraft => ({
  kind: 'payable',
  partyId: 'party-sc-2',
  settlementId: '',
  amount: 5000,
  quantity: 0,
  raisedOn: '2025-11-12',
  note: '',
  ...o,
});

const context = { parties: [party()], settlements: [settlement()] };

describe('recording a ledger line', () => {
  it('accepts a cash line', () => {
    expect(validateEntry(draft(), context)).toEqual({});
  });

  it('needs a person who exists', () => {
    expect(validateEntry(draft({ partyId: '' }), context)).toHaveProperty('partyId');
    expect(validateEntry(draft({ partyId: 'party-gone' }), context)).toHaveProperty('partyId');
  });

  it('asks for taka on a cash line and maund on a transfer', () => {
    // A produce transfer moves maund, not taka.
    expect(isInKind('transfer')).toBe(true);
    expect(isInKind('payable')).toBe(false);
    expect(validateEntry(draft({ amount: 0 }), context)).toHaveProperty('amount');
    expect(validateEntry(draft({ amount: 12.5 }), context)['amount']).toContain('whole taka');
    expect(
      validateEntry(draft({ kind: 'transfer', amount: 0, quantity: 0 }), context),
    ).toHaveProperty('quantity');
    expect(validateEntry(draft({ kind: 'transfer', amount: 0, quantity: 12 }), context)).toEqual(
      {},
    );
  });

  it('writes the quantity onto a transfer and the amount onto a cash line', () => {
    const transfer = entryFromDraft(draft({ kind: 'transfer', amount: 999, quantity: 12 }), {
      id: 'f9',
      reference: 'FIN-9',
    });
    expect(transfer).toMatchObject({ amount: 0, quantity: 12 });
    const cash = entryFromDraft(draft({ amount: 5000, quantity: 99 }), {
      id: 'f9',
      reference: 'FIN-9',
    });
    expect(cash).toMatchObject({ amount: 5000, quantity: 0 });
  });
});

describe('what is outstanding', () => {
  it('nets receivables against payables', () => {
    const entries = [
      entry({ id: 'a', kind: 'receivable', amount: 13810 }),
      entry({ id: 'b', kind: 'payable', amount: 21620 }),
    ];
    expect(outstanding(entries)).toEqual({ receivable: 13810, payable: 21620, net: -7810 });
  });

  it('ignores settled lines, and movements that are not obligations', () => {
    const entries = [
      entry({ id: 'a', kind: 'receivable', amount: 10000, status: 'settled' }),
      entry({ id: 'b', kind: 'payment', amount: 5000 }),
      entry({ id: 'c', kind: 'transfer', amount: 0, quantity: 12 }),
      entry({ id: 'd', kind: 'payable', amount: 2000 }),
    ];
    expect(outstanding(entries)).toEqual({ receivable: 0, payable: 2000, net: -2000 });
  });

  it('reopens exactly, clearing the settled date', () => {
    // An open entry carrying one would read as settled to every total.
    const original = entry();
    expect(reopen(settle(original, '2025-11-15'))).toEqual(original);
    expect(isOpen(settle(original, '2025-11-15'))).toBe(false);
  });
});

describe('the lines a settlement produces', () => {
  const ids = { prefix: 'fin-x', reference: (i: number) => `FIN-2025-00${i + 1}` };

  it('raises a payable to the tenant and a receivable to the owner', () => {
    const entries = entriesForSettlement(
      settlement(),
      { ownerId: 'party-owner-2', sharecropperId: 'party-sc-2' },
      ids,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'payable', partyId: 'party-sc-2', amount: 21620 });
    expect(entries[1]).toMatchObject({
      kind: 'receivable',
      partyId: 'party-owner-2',
      amount: 13810,
    });
  });

  it('raises nothing for a nil amount', () => {
    // An empty payable is a line nobody can act on.
    const entries = entriesForSettlement(
      settlement({ netToSharecropper: 0, ownerProceeds: 0 }),
      { ownerId: 'party-owner-2', sharecropperId: 'party-sc-2' },
      ids,
    );
    expect(entries).toEqual([]);
  });

  it('ties every line back to the settlement and the cycle', () => {
    const entries = entriesForSettlement(
      settlement(),
      { ownerId: 'party-owner-2', sharecropperId: 'party-sc-2' },
      ids,
    );
    expect(entries.every((row) => row.settlementId === 'stl-1' && row.cycleId === 'cyc-2')).toBe(
      true,
    );
  });
});
