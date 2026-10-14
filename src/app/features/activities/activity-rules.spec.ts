import { describe, expect, it } from 'vitest';
import { AgreementTerms, SharecroppingAgreement } from '../../core/models/agreement';
import { CultivationCycle, FarmingActivity } from '../../core/models/cultivation';
import {
  ActivityContext,
  ActivityDraft,
  activityFromDraft,
  costResponsibilityFor,
  costTotals,
  nextActivityReference,
  splitCost,
  validateActivity,
} from './activity-rules';

const terms = (o: Partial<AgreementTerms> = {}): AgreementTerms => ({
  model: 'normal',
  ownerHarvestShare: 50,
  costResponsibility: 'shared',
  labourResponsibility: 'sharecropper',
  machineryResponsibility: 'owner',
  inputResponsibility: 'shared',
  deductSaleExpenses: true,
  tevagaTotalShares: 3,
  settlementMode: 'crop',
  ...o,
});

const agreement = (o: Partial<SharecroppingAgreement> = {}): SharecroppingAgreement =>
  ({
    id: 'agr-1',
    reference: 'BRG-2025-001',
    status: 'active',
    terms: terms(),
    ...o,
  }) as SharecroppingAgreement;

const cycle = (o: Partial<CultivationCycle> = {}): CultivationCycle =>
  ({
    id: 'cyc-1',
    reference: 'CYC-2025-001',
    agreementId: 'agr-1',
    startedOn: '2025-06-17',
    status: 'ongoing',
    ...o,
  }) as CultivationCycle;

const draft = (o: Partial<ActivityDraft> = {}): ActivityDraft => ({
  cycleId: 'cyc-1',
  kind: 'fertiliser',
  costLine: 'input',
  performedOn: '2025-07-18',
  amount: 5000,
  note: 'Urea, first top-dressing.',
  ...o,
});

const context = (o: Partial<ActivityContext> = {}): ActivityContext => ({
  cycles: [cycle()],
  agreements: [agreement()],
  ...o,
});

describe('who carries a cost', () => {
  it('puts everything on the owner when there is no agreement', () => {
    // An owner-farming cycle: there is nobody else to bear it.
    for (const line of ['labour', 'machinery', 'input', 'other'] as const) {
      expect(costResponsibilityFor(line, null)).toBe('owner');
    }
  });

  it('puts everything on the sharecropper under Tevaga', () => {
    // That is what distinguishes the model, so it is read before the per-line
    // terms, which under Tevaga are not meaningful.
    const tevaga = agreement({
      terms: terms({ model: 'tevaga', machineryResponsibility: 'owner' }),
    });
    for (const line of ['labour', 'machinery', 'input', 'other'] as const) {
      expect(costResponsibilityFor(line, tevaga)).toBe('sharecropper');
    }
  });

  it('reads the negotiated line under a Normal agreement', () => {
    const normal = agreement();
    expect(costResponsibilityFor('labour', normal)).toBe('sharecropper');
    expect(costResponsibilityFor('machinery', normal)).toBe('owner');
    expect(costResponsibilityFor('input', normal)).toBe('shared');
    expect(costResponsibilityFor('other', normal)).toBe('shared');
  });
});

describe('splitting a cost', () => {
  it('gives the whole amount to whoever bears it', () => {
    expect(splitCost(4200, 'owner')).toEqual({ ownerShare: 4200, sharecropperShare: 0 });
    expect(splitCost(3600, 'sharecropper')).toEqual({ ownerShare: 0, sharecropperShare: 3600 });
  });

  it('halves a shared cost', () => {
    expect(splitCost(5000, 'shared')).toEqual({ ownerShare: 2500, sharecropperShare: 2500 });
  });

  it('never loses a taka to rounding', () => {
    // Two 900s out of 1,801 is a taka the settlement would fail to reconcile.
    const split = splitCost(1801, 'shared');
    expect(split.ownerShare + split.sharecropperShare).toBe(1801);
    expect(split).toEqual({ ownerShare: 901, sharecropperShare: 900 });
  });
});

describe('recording an activity', () => {
  it('accepts a complete draft', () => {
    expect(validateActivity(draft(), context())).toEqual({});
  });

  it('needs a cycle that exists and is still running', () => {
    expect(validateActivity(draft({ cycleId: '' }), context())).toHaveProperty('cycleId');
    expect(validateActivity(draft({ cycleId: 'cyc-9' }), context())).toHaveProperty('cycleId');
    expect(
      validateActivity(draft(), context({ cycles: [cycle({ status: 'aborted' })] }))['cycleId'],
    ).toContain('aborted');
    // The settlement has already divided the costs.
    expect(
      validateActivity(draft(), context({ cycles: [cycle({ status: 'settled' })] }))['cycleId'],
    ).toContain('settled');
  });

  it('needs a positive whole-taka amount', () => {
    expect(validateActivity(draft({ amount: 0 }), context())).toHaveProperty('amount');
    expect(validateActivity(draft({ amount: 12.5 }), context())['amount']).toContain('whole taka');
  });

  it('cannot predate the cycle', () => {
    expect(validateActivity(draft({ performedOn: '2025-06-01' }), context())).toHaveProperty(
      'performedOn',
    );
  });

  it('needs a note saying what was done', () => {
    expect(validateActivity(draft({ note: 'x' }), context())).toHaveProperty('note');
  });

  it('resolves the split at record time, not live', () => {
    // Terms can be renegotiated; an expense already incurred must not silently
    // change who owes it.
    const recorded = activityFromDraft(draft(), agreement(), {
      id: 'act-9',
      reference: 'ACT-2025-009',
    });
    expect(recorded).toMatchObject({
      bearer: 'shared',
      ownerShare: 2500,
      sharecropperShare: 2500,
    });
  });

  it('puts an owner-farming expense entirely on the owner', () => {
    const recorded = activityFromDraft(draft({ costLine: 'labour' }), null, {
      id: 'act-9',
      reference: 'ACT-2025-009',
    });
    expect(recorded).toMatchObject({ bearer: 'owner', ownerShare: 5000, sharecropperShare: 0 });
  });
});

describe('what a cycle has cost', () => {
  const activity = (o: Partial<FarmingActivity>): FarmingActivity =>
    ({ amount: 0, ownerShare: 0, sharecropperShare: 0, ...o }) as FarmingActivity;

  it('adds up the total and each side, and they reconcile', () => {
    const totals = costTotals([
      activity({ amount: 4200, ownerShare: 4200 }),
      activity({ amount: 3600, sharecropperShare: 3600 }),
      activity({ amount: 5000, ownerShare: 2500, sharecropperShare: 2500 }),
    ]);
    expect(totals).toEqual({ total: 12800, owner: 6700, sharecropper: 6100 });
    expect(totals.owner + totals.sharecropper).toBe(totals.total);
  });

  it('is zero for a cycle nothing has been spent on', () => {
    expect(costTotals([])).toEqual({ total: 0, owner: 0, sharecropper: 0 });
  });
});

describe('activity reference numbering', () => {
  it('starts at 001 and continues from the highest for that year', () => {
    expect(nextActivityReference([], 2025)).toBe('ACT-2025-001');
    expect(
      nextActivityReference(
        [
          { reference: 'ACT-2025-004' } as FarmingActivity,
          { reference: 'ACT-2026-009' } as FarmingActivity,
        ],
        2025,
      ),
    ).toBe('ACT-2025-005');
  });
});
