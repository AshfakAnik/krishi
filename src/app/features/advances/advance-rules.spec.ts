import { describe, expect, it } from 'vitest';
import { SharecroppingAgreement } from '../../core/models/agreement';
import { Land, Season } from '../../core/models/agriculture';
import { AdvanceDraft, AdvanceLedgerEntry } from '../../core/models/cultivation';
import {
  ADVANCE_PER_DECIMAL,
  advanceCeiling,
  committedAgainst,
  headroom,
  nextAdvanceReference,
  outstandingAgainst,
} from '../../core/rules/dadhon';
import {
  AdvanceContext,
  advanceForRequest,
  applyRepayment,
  canDecideAdvance,
  canRepay,
  disburse,
  refusalNoteError,
  refuse,
  repaymentError,
  reverseRepayment,
  validateAdvance,
} from './advance-rules';

/**
 * One test per rule, plus the negative case and the inverse. The negatives are
 * the valuable ones — a suite that only proves the happy path will not survive
 * a refactor.
 */

// A 100-decimal plot, so the ceiling is a round ৳ 20,000.
function land(overrides: Partial<Land> = {}): Land {
  return {
    id: 'land-1',
    code: 'SHB-DAG-104',
    name: 'Boro Dhani Beel',
    landType: 'dhani',
    area: 100,
    location: 'Shibpur',
    ownerId: 'party-owner-1',
    heldByAgreementId: 'agr-1',
    ...overrides,
  };
}

function season(overrides: Partial<Season> = {}): Season {
  return {
    id: 'season-aman-2025',
    name: 'Aman 2025',
    year: 2025,
    startsOn: '2025-06-15',
    endsOn: '2025-11-27',
    active: true,
    ...overrides,
  };
}

function agreement(overrides: Partial<SharecroppingAgreement> = {}): SharecroppingAgreement {
  return {
    id: 'agr-1',
    reference: 'BRG-2025-001',
    landId: 'land-1',
    seasonId: 'season-aman-2025',
    cropId: 'crop-paddy',
    varietyId: 'var-br11',
    sharecropperId: 'party-sc-1',
    ownerId: 'party-owner-1',
    terms: {
      model: 'normal',
      ownerHarvestShare: 50,
      costResponsibility: 'shared',
      labourResponsibility: 'sharecropper',
      machineryResponsibility: 'owner',
      inputResponsibility: 'shared',
      deductSaleExpenses: true,
      tevagaTotalShares: 3,
      settlementMode: 'crop',
    },
    advanceAmount: 0,
    startsOn: '2025-06-17',
    status: 'active',
    submittedBy: 'Ashfakul Alam',
    submittedOn: '2025-06-09',
    decidedBy: 'Rezaul Karim',
    decidedOn: '2025-06-12',
    decisionNote: '',
    cultivationCycleId: 'cyc-1',
    ...overrides,
  };
}

function advance(overrides: Partial<AdvanceLedgerEntry> = {}): AdvanceLedgerEntry {
  return {
    id: 'adv-1',
    reference: 'ADV-2025-001',
    agreementId: 'agr-1',
    sharecropperId: 'party-sc-1',
    kind: 'mid-season',
    amount: 5000,
    outstanding: 5000,
    issuedOn: '2025-07-26',
    note: 'Requested for urea top-dressing.',
    status: 'active',
    requestedBy: 'Ashfakul Alam',
    requestedOn: '2025-07-25',
    decidedBy: 'Rezaul Karim',
    decidedOn: '2025-07-26',
    decisionNote: '',
    ...overrides,
  };
}

function draft(overrides: Partial<AdvanceDraft> = {}): AdvanceDraft {
  return {
    agreementId: 'agr-1',
    amount: 4000,
    issuedOn: '2025-07-26',
    note: 'Urea top-dressing before the second irrigation.',
    ...overrides,
  };
}

function context(overrides: Partial<AdvanceContext> = {}): AdvanceContext {
  return {
    agreements: [agreement()],
    lands: [land()],
    seasons: [season()],
    ledger: [],
    ...overrides,
  };
}

describe('the dadhon ceiling', () => {
  it('is ৳ 200 per decimal of the plot', () => {
    expect(advanceCeiling(land({ area: 132 }))).toBe(132 * ADVANCE_PER_DECIMAL);
  });

  it('is nothing at all without a plot', () => {
    expect(advanceCeiling(undefined)).toBe(0);
  });
});

describe('what the ledger commits', () => {
  it('counts a pending row at its full amount — approving it would owe that', () => {
    const ledger = [advance({ status: 'pending', amount: 3000, outstanding: 0 })];
    expect(committedAgainst('agr-1', ledger)).toBe(3000);
  });

  it('counts an active row at what is still outstanding, not what was lent', () => {
    // A partly repaid advance has already given some of the ceiling back.
    const ledger = [advance({ status: 'active', amount: 5000, outstanding: 2000 })];
    expect(committedAgainst('agr-1', ledger)).toBe(2000);
  });

  it('counts nothing for a rejected or a repaid row', () => {
    const ledger = [
      advance({ id: 'adv-1', status: 'rejected', amount: 9000, outstanding: 0 }),
      advance({ id: 'adv-2', status: 'repaid', amount: 9000, outstanding: 0 }),
    ];
    expect(committedAgainst('agr-1', ledger)).toBe(0);
  });

  it('counts only the agreement asked about', () => {
    const ledger = [
      advance({ id: 'adv-1', agreementId: 'agr-1', outstanding: 4000 }),
      advance({ id: 'adv-2', agreementId: 'agr-2', outstanding: 9000 }),
    ];
    expect(committedAgainst('agr-1', ledger)).toBe(4000);
  });

  it('leaves a row out of its own headroom, so an edit does not block itself', () => {
    const ledger = [advance({ id: 'adv-1', outstanding: 20000 })];
    expect(headroom(land(), 'agr-1', ledger)).toBe(0);
    expect(headroom(land(), 'agr-1', ledger, 'adv-1')).toBe(20000);
  });

  it('reads as nothing left rather than as a negative, if the ledger overran', () => {
    const ledger = [advance({ outstanding: 25000 })];
    expect(headroom(land(), 'agr-1', ledger)).toBe(0);
  });

  it('reports what is still owed, ignoring anything not yet disbursed', () => {
    const ledger = [
      advance({ id: 'adv-1', status: 'active', outstanding: 5000 }),
      advance({ id: 'adv-2', status: 'pending', amount: 4000, outstanding: 0 }),
      advance({ id: 'adv-3', status: 'repaid', outstanding: 0 }),
    ];
    expect(outstandingAgainst('agr-1', ledger)).toBe(5000);
  });
});

describe('requesting an advance', () => {
  it('accepts a draft inside every limit', () => {
    expect(validateAdvance(draft(), context())).toEqual({});
  });

  it('needs an agreement', () => {
    expect(validateAdvance(draft({ agreementId: '' }), context())).toHaveProperty('agreementId');
  });

  it('refuses an agreement that is not active — there is nothing to settle against', () => {
    for (const status of ['draft', 'pending', 'rejected', 'revoked'] as const) {
      const errors = validateAdvance(draft(), context({ agreements: [agreement({ status })] }));
      expect(errors['agreementId']).toContain(status);
    }
  });

  it('needs a positive amount', () => {
    expect(validateAdvance(draft({ amount: 0 }), context())).toHaveProperty('amount');
    expect(validateAdvance(draft({ amount: -100 }), context())).toHaveProperty('amount');
  });

  it('records whole taka only', () => {
    expect(validateAdvance(draft({ amount: 1500.5 }), context())['amount']).toContain('whole taka');
  });

  it('refuses a draw past the remaining ceiling, and says how much is left', () => {
    const ledger = [advance({ outstanding: 18000 })];
    const errors = validateAdvance(draft({ amount: 4000 }), context({ ledger }));
    expect(errors['amount']).toContain('2,000');
  });

  it('allows a draw exactly at the remaining ceiling', () => {
    const ledger = [advance({ outstanding: 18000 })];
    expect(validateAdvance(draft({ amount: 2000 }), context({ ledger }))).toEqual({});
  });

  it('does not count the row being edited against its own headroom', () => {
    const ledger = [advance({ id: 'adv-1', outstanding: 18000 })];
    const errors = validateAdvance(
      draft({ amount: 15000 }),
      context({ ledger, ignoreAdvanceId: 'adv-1' }),
    );
    expect(errors).toEqual({});
  });

  it('cannot predate the agreement it is drawn against', () => {
    expect(validateAdvance(draft({ issuedOn: '2025-06-01' }), context())).toHaveProperty(
      'issuedOn',
    );
  });

  it('cannot fall after the season closes — no harvest is left to repay it', () => {
    const errors = validateAdvance(draft({ issuedOn: '2025-12-20' }), context());
    expect(errors['issuedOn']).toContain('harvest');
  });

  it('needs a reason saying what the money is for', () => {
    expect(validateAdvance(draft({ note: 'urea' }), context())).toHaveProperty('note');
  });

  it('creates a pending row with no balance — nothing is handed over yet', () => {
    const entry = advanceForRequest(
      draft(),
      agreement(),
      { id: 'adv-9', reference: 'ADV-2025-009' },
      'Ashfakul Alam',
      '2025-07-25',
    );
    expect(entry).toMatchObject({
      status: 'pending',
      outstanding: 0,
      amount: 4000,
      kind: 'mid-season',
      sharecropperId: 'party-sc-1',
    });
  });
});

describe('deciding on an advance', () => {
  it('is decidable only while pending', () => {
    expect(canDecideAdvance(advance({ status: 'pending' }))).toBe(true);
    for (const status of ['active', 'rejected', 'repaid'] as const) {
      expect(canDecideAdvance(advance({ status }))).toBe(false);
    }
  });

  it('opens the balance on approval', () => {
    const entry = advance({ status: 'pending', amount: 4000, outstanding: 0 });
    expect(disburse(entry, 'Rezaul Karim', '2025-07-26')).toMatchObject({
      status: 'active',
      outstanding: 4000,
      decidedBy: 'Rezaul Karim',
    });
  });

  it('moves no money on a refusal', () => {
    const entry = advance({ status: 'pending', amount: 4000, outstanding: 0 });
    const refused = refuse(entry, 'Rezaul Karim', '2025-07-26', 'Ceiling already reached.');
    expect(refused).toMatchObject({ status: 'rejected', outstanding: 0 });
    expect(refused.decisionNote).toBe('Ceiling already reached.');
  });

  it('will not accept a refusal without a reason', () => {
    expect(refusalNoteError('too much')).not.toBe('');
    expect(refusalNoteError('The dadhon ceiling is already reached.')).toBe('');
  });
});

describe('repaying an advance', () => {
  it('takes a repayment only on a disbursed row with a balance', () => {
    expect(canRepay(advance({ status: 'active', outstanding: 5000 }))).toBe(true);
    expect(canRepay(advance({ status: 'active', outstanding: 0 }))).toBe(false);
    expect(canRepay(advance({ status: 'pending', outstanding: 0 }))).toBe(false);
    expect(canRepay(advance({ status: 'repaid', outstanding: 0 }))).toBe(false);
  });

  it('refuses a repayment larger than the balance', () => {
    expect(repaymentError(6000, advance({ outstanding: 5000 }))).toContain('5,000');
  });

  it('allows a repayment exactly clearing the balance', () => {
    expect(repaymentError(5000, advance({ outstanding: 5000 }))).toBe('');
  });

  it('refuses nothing, and refuses poisha', () => {
    expect(repaymentError(0, advance())).not.toBe('');
    expect(repaymentError(100.25, advance())).toContain('whole taka');
  });

  it('leaves a partly repaid row open', () => {
    const entry = applyRepayment(advance({ outstanding: 5000 }), 2000);
    expect(entry).toMatchObject({ outstanding: 3000, status: 'active' });
  });

  it('closes the row when the balance clears — which gives the ceiling back', () => {
    const entry = applyRepayment(advance({ outstanding: 5000 }), 5000);
    expect(entry).toMatchObject({ outstanding: 0, status: 'repaid' });
    expect(committedAgainst('agr-1', [entry])).toBe(0);
  });

  it('reverses a partial repayment exactly', () => {
    const entry = advance({ outstanding: 5000, status: 'active' });
    expect(reverseRepayment(applyRepayment(entry, 2000), 2000)).toEqual(entry);
  });

  it('reverses a closing repayment exactly, reopening the row', () => {
    // The one that matters: a repayment that closed a row has to be undoable
    // back to `active`, not left as a `repaid` row with a balance.
    const entry = advance({ outstanding: 5000, status: 'active' });
    expect(reverseRepayment(applyRepayment(entry, 5000), 5000)).toEqual(entry);
  });
});

describe('advance reference numbering', () => {
  it('starts at 001 for a fresh year', () => {
    expect(nextAdvanceReference([], 2025)).toBe('ADV-2025-001');
  });

  it('continues from the highest existing number for that year', () => {
    const ledger = [
      advance({ reference: 'ADV-2025-001' }),
      advance({ reference: 'ADV-2025-007' }),
      advance({ reference: 'ADV-2026-004' }),
    ];
    expect(nextAdvanceReference(ledger, 2025)).toBe('ADV-2025-008');
  });
});
