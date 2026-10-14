import { describe, expect, it } from 'vitest';
import { AgreementTerms, SharecroppingAgreement } from '../../core/models/agreement';
import {
  AdvanceLedgerEntry,
  CultivationCycle,
  FarmingActivity,
} from '../../core/models/cultivation';
import { Sale } from '../../core/models/harvest';
import { Settlement } from '../../core/models/settlement';
import {
  SettlementContext,
  SettlementDraft,
  agree,
  applyToLedger,
  canAgree,
  canClose,
  canDispute,
  close,
  costsFor,
  divide,
  nextSettlementReference,
  outstandingAdvance,
  ownerShareFraction,
  proceedsFor,
  reopenForRecompute,
  settlementFromDraft,
  validateSettlement,
} from './settlement-rules';

const terms = (o: Partial<AgreementTerms> = {}): AgreementTerms =>
  ({
    model: 'normal',
    ownerHarvestShare: 50,
    tevagaTotalShares: 3,
    ...o,
  }) as AgreementTerms;

const agreement = (o: Partial<SharecroppingAgreement> = {}): SharecroppingAgreement =>
  ({ id: 'agr-1', reference: 'BRG-2025-001', terms: terms(), ...o }) as SharecroppingAgreement;

const cycle = (o: Partial<CultivationCycle> = {}): CultivationCycle =>
  ({
    id: 'cyc-2',
    reference: 'CYC-2025-002',
    agreementId: 'agr-1',
    startedOn: '2025-06-19',
    status: 'harvesting',
    ...o,
  }) as CultivationCycle;

const sale = (o: Partial<Sale> = {}): Sale =>
  ({ id: 's1', cycleId: 'cyc-2', netAmount: 41430, ...o }) as Sale;

const activity = (o: Partial<FarmingActivity> = {}): FarmingActivity =>
  ({ id: 'a1', cycleId: 'cyc-2', ownerShare: 0, sharecropperShare: 0, ...o }) as FarmingActivity;

const advance = (o: Partial<AdvanceLedgerEntry> = {}): AdvanceLedgerEntry =>
  ({
    id: 'adv-1',
    agreementId: 'agr-1',
    status: 'active',
    outstanding: 6000,
    issuedOn: '2025-07-20',
    ...o,
  }) as AdvanceLedgerEntry;

const settlement = (o: Partial<Settlement> = {}): Settlement =>
  ({ id: 'stl-1', reference: 'STL-2025-001', status: 'draft', ...o }) as Settlement;

const draft = (o: Partial<SettlementDraft> = {}): SettlementDraft => ({
  cycleId: 'cyc-2',
  mode: 'pooled',
  settledOn: '2025-11-10',
  note: '',
  ...o,
});

const context = (o: Partial<SettlementContext> = {}): SettlementContext => ({
  cycles: [cycle()],
  agreements: [agreement()],
  settlements: [],
  sales: [sale()],
  activities: [],
  ledger: [],
  ...o,
});

describe('what the owner is due', () => {
  it('reads the negotiated percentage under a Normal agreement', () => {
    expect(ownerShareFraction(agreement())).toBe(0.5);
    expect(ownerShareFraction(agreement({ terms: terms({ ownerHarvestShare: 40 }) }))).toBe(0.4);
  });

  it('reads one share of N under Tevaga', () => {
    expect(
      ownerShareFraction(agreement({ terms: terms({ model: 'tevaga', tevagaTotalShares: 3 }) })),
    ).toBeCloseTo(1 / 3);
  });

  it('gives an owner-farmed cycle the whole of it', () => {
    expect(ownerShareFraction(null)).toBe(1);
  });
});

describe('what goes into the division', () => {
  it('totals net sale proceeds for the cycle only', () => {
    const sales = [
      sale({ id: 'a' }),
      sale({ id: 'b', netAmount: 19000 }),
      sale({ id: 'c', cycleId: 'cyc-9', netAmount: 99999 }),
    ];
    expect(proceedsFor('cyc-2', sales)).toBe(60430);
  });

  it('reads costs as they actually fell, not as the terms say they should', () => {
    // An activity stores its own split, resolved when it was recorded.
    const activities = [
      activity({ id: 'a', ownerShare: 4200 }),
      activity({ id: 'b', sharecropperShare: 3600 }),
      activity({ id: 'c', ownerShare: 2500, sharecropperShare: 2500 }),
    ];
    expect(costsFor('cyc-2', activities)).toEqual({ owner: 6700, sharecropper: 6100 });
  });

  it('finds the dadhon still owed, and nothing for an owner-farmed cycle', () => {
    const ledger = [
      advance({ id: 'a', outstanding: 15000 }),
      advance({ id: 'b', outstanding: 5000 }),
      advance({ id: 'c', status: 'repaid', outstanding: 0 }),
      advance({ id: 'd', agreementId: 'agr-9', outstanding: 9000 }),
    ];
    expect(outstandingAdvance('agr-1', ledger)).toBe(20000);
    expect(outstandingAdvance(null, ledger)).toBe(0);
  });
});

describe('dividing the proceeds', () => {
  it('splits pooled cash by the owner fraction', () => {
    const split = divide({ mode: 'pooled', proceeds: 40000, ownerFraction: 0.5, outstanding: 0 });
    expect(split.ownerProceeds).toBe(20000);
    expect(split.sharecropperProceeds).toBe(20000);
    expect(split.ownerProceeds + split.sharecropperProceeds).toBe(40000);
  });

  it('pays the owner no cash in kind — they already took crop', () => {
    const split = divide({ mode: 'in-kind', proceeds: 40000, ownerFraction: 0.5, outstanding: 0 });
    expect(split.ownerProceeds).toBe(0);
    expect(split.sharecropperProceeds).toBe(40000);
  });

  it('recovers the advance out of the sharecropper side only', () => {
    const split = divide({
      mode: 'pooled',
      proceeds: 40000,
      ownerFraction: 0.5,
      outstanding: 6000,
    });
    expect(split.ownerProceeds).toBe(20000);
    expect(split.advanceDeducted).toBe(6000);
    expect(split.netToSharecropper).toBe(14000);
    expect(split.advanceRemaining).toBe(0);
  });

  it('never pushes a tenant into a deeper debt than they started with', () => {
    // A settlement that was supposed to clear a debt must not create one.
    const split = divide({
      mode: 'pooled',
      proceeds: 10000,
      ownerFraction: 0.5,
      outstanding: 20000,
    });
    expect(split.advanceDeducted).toBe(5000);
    expect(split.netToSharecropper).toBe(0);
    expect(split.advanceRemaining).toBe(15000);
  });

  it('deducts nothing when there is nothing to divide', () => {
    const split = divide({ mode: 'partial', proceeds: 0, ownerFraction: 0.5, outstanding: 6000 });
    expect(split.advanceDeducted).toBe(0);
    expect(split.advanceRemaining).toBe(6000);
  });
});

describe('preparing a settlement', () => {
  it('accepts a cycle with sales and no prior settlement', () => {
    expect(validateSettlement(draft(), context())).toEqual({});
  });

  it('refuses settling the same cycle twice', () => {
    // A second settlement would divide the same money again.
    const errors = validateSettlement(
      draft(),
      context({ settlements: [settlement({ cycleId: 'cyc-2', status: 'agreed' })] }),
    );
    expect(errors['cycleId']).toContain('already been settled');
  });

  it('insists an aborted cycle settles as a partial season', () => {
    const aborted = context({ cycles: [cycle({ status: 'aborted' })] });
    expect(validateSettlement(draft(), aborted)['mode']).toContain('partial');
    expect(validateSettlement(draft({ mode: 'partial' }), aborted)).toEqual({});
  });

  it('refuses a pooled settlement with nothing sold', () => {
    const errors = validateSettlement(draft(), context({ sales: [] }));
    expect(errors['mode']).toContain('partial season');
  });

  it('refuses a cycle that never grew anything, and a date before it started', () => {
    expect(
      validateSettlement(draft(), context({ cycles: [cycle({ status: 'planned' })] })),
    ).toHaveProperty('cycleId');
    expect(validateSettlement(draft({ settledOn: '2025-01-01' }), context())).toHaveProperty(
      'settledOn',
    );
  });

  it('stores every figure rather than leaving it to be recomputed', () => {
    const prepared = settlementFromDraft(
      draft(),
      cycle(),
      agreement(),
      {
        sales: [sale({ netAmount: 40000 })],
        activities: [activity({ ownerShare: 4200, sharecropperShare: 3600 })],
        ledger: [advance({ outstanding: 6000 })],
      },
      { id: 'stl-9', reference: 'STL-2025-009' },
      'Rezaul Karim',
    );
    expect(prepared).toMatchObject({
      grossProceeds: 40000,
      ownerCosts: 4200,
      sharecropperCosts: 3600,
      ownerSharePercent: 50,
      ownerProceeds: 20000,
      sharecropperProceeds: 20000,
      advanceDeducted: 6000,
      netToSharecropper: 14000,
      status: 'draft',
    });
  });
});

describe('moving a settlement along', () => {
  it('agrees only a draft, closes only an agreed one', () => {
    expect(canAgree(settlement({ status: 'draft' }))).toBe(true);
    expect(canAgree(settlement({ status: 'agreed' }))).toBe(false);
    expect(canClose(settlement({ status: 'agreed' }))).toBe(true);
    expect(canClose(settlement({ status: 'draft' }))).toBe(false);
    expect(canClose(settlement({ status: 'closed' }))).toBe(false);
  });

  it('allows a dispute up to the point it closes', () => {
    expect(canDispute(settlement({ status: 'draft' }))).toBe(true);
    expect(canDispute(settlement({ status: 'agreed' }))).toBe(true);
    expect(canDispute(settlement({ status: 'closed' }))).toBe(false);
  });

  it('records who agreed it, and closes without changing that', () => {
    const agreed = agree(settlement(), 'Rezaul Karim', '2025-11-10');
    expect(agreed).toMatchObject({ status: 'agreed', decidedBy: 'Rezaul Karim' });
    expect(close(agreed)).toMatchObject({ status: 'closed', decidedBy: 'Rezaul Karim' });
  });

  it('reopens to draft after a dispute, not to agreed', () => {
    // The numbers both sides saw are no longer the numbers on the record.
    const reopened = reopenForRecompute(agree(settlement(), 'Rezaul Karim', '2025-11-10'));
    expect(reopened).toMatchObject({ status: 'draft', decidedBy: '', decidedOn: '' });
  });
});

describe('spending the dadhon ledger', () => {
  it('clears the oldest advance first', () => {
    const ledger = [
      advance({ id: 'new', outstanding: 5000, issuedOn: '2025-07-26' }),
      advance({ id: 'old', outstanding: 15000, issuedOn: '2025-06-17' }),
    ];
    const touched = applyToLedger(ledger, 'agr-1', 15000);
    expect(touched).toHaveLength(1);
    expect(touched[0]).toMatchObject({ id: 'old', outstanding: 0, status: 'repaid' });
  });

  it('spills into the next advance once the first clears', () => {
    const ledger = [
      advance({ id: 'old', outstanding: 15000, issuedOn: '2025-06-17' }),
      advance({ id: 'new', outstanding: 5000, issuedOn: '2025-07-26' }),
    ];
    const touched = applyToLedger(ledger, 'agr-1', 18000);
    expect(touched.map((row) => row.id)).toEqual(['old', 'new']);
    expect(touched[0]).toMatchObject({ outstanding: 0, status: 'repaid' });
    expect(touched[1]).toMatchObject({ outstanding: 2000, status: 'active' });
  });

  it('touches nothing when there is nothing to deduct', () => {
    expect(applyToLedger([advance()], 'agr-1', 0)).toEqual([]);
    expect(applyToLedger([advance()], null, 5000)).toEqual([]);
  });
});

describe('settlement reference numbering', () => {
  it('starts at 001 and continues from the highest for that year', () => {
    expect(nextSettlementReference([], 2025)).toBe('STL-2025-001');
    expect(
      nextSettlementReference(
        [settlement({ reference: 'STL-2025-002' }), settlement({ reference: 'STL-2026-009' })],
        2025,
      ),
    ).toBe('STL-2025-003');
  });
});
