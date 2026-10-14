import { describe, expect, it } from 'vitest';
import { AgreementDraft, AgreementTerms } from '../../core/models/agreement';
import { Crop, CropVariety, Land, Season } from '../../core/models/agriculture';
import { SharecroppingAgreement } from '../../core/models/agreement';
import {
  ADVANCE_PER_DECIMAL,
  AgreementContext,
  advanceForAgreement,
  canDecide,
  claimLand,
  cycleForAgreement,
  decisionNoteError,
  expectedYield,
  isCropSuitable,
  nextReference,
  releaseLand,
  shareSplit,
  validateAgreement,
  validateTerms,
} from './agreement-rules';

/**
 * One test per rule, plus the negative case and the inverse. The negatives are
 * the valuable ones — a suite that only proves the happy path will not survive
 * a refactor.
 */

const DHANI: Land = {
  id: 'land-1',
  code: 'SHB-DAG-104',
  name: 'Boro Dhani Beel',
  landType: 'dhani',
  area: 100,
  location: 'Shibpur',
  ownerId: 'owner-1',
  heldByAgreementId: null,
};

const VITA: Land = { ...DHANI, id: 'land-3', name: 'Bari Vita', landType: 'vita', area: 40 };

const PADDY: Crop = { id: 'crop-paddy', name: 'Paddy (Dhan)', suitableLandTypes: ['dhani'] };
const POTATO: Crop = { id: 'crop-potato', name: 'Potato (Alu)', suitableLandTypes: ['vita'] };

const BR11: CropVariety = {
  id: 'var-br11',
  cropId: 'crop-paddy',
  name: 'BR-11',
  durationDays: 145,
  expectedYieldPerDecimal: 0.6,
};
const DIAMANT: CropVariety = {
  id: 'var-diamant',
  cropId: 'crop-potato',
  name: 'Diamant',
  durationDays: 90,
  expectedYieldPerDecimal: 1.8,
};

const AMAN: Season = {
  id: 'season-aman-2025',
  name: 'Aman 2025',
  year: 2025,
  startsOn: '2025-06-15',
  endsOn: '2025-11-27',
  active: true,
};

const NORMAL_TERMS: AgreementTerms = {
  model: 'normal',
  ownerHarvestShare: 50,
  costResponsibility: 'shared',
  labourResponsibility: 'sharecropper',
  machineryResponsibility: 'owner',
  inputResponsibility: 'shared',
  deductSaleExpenses: true,
  tevagaTotalShares: 3,
  settlementMode: 'crop',
};

const TEVAGA_TERMS: AgreementTerms = {
  ...NORMAL_TERMS,
  model: 'tevaga',
  costResponsibility: 'sharecropper',
  labourResponsibility: 'sharecropper',
  machineryResponsibility: 'sharecropper',
  inputResponsibility: 'sharecropper',
};

function draft(overrides: Partial<AgreementDraft> = {}): AgreementDraft {
  return {
    landId: 'land-1',
    seasonId: 'season-aman-2025',
    cropId: 'crop-paddy',
    varietyId: 'var-br11',
    sharecropperId: 'party-sc-1',
    terms: NORMAL_TERMS,
    advanceAmount: 10000,
    startsOn: '2025-06-20',
    ...overrides,
  };
}

function context(overrides: Partial<AgreementContext> = {}): AgreementContext {
  return {
    lands: [DHANI, VITA],
    crops: [PADDY, POTATO],
    varieties: [BR11, DIAMANT],
    seasons: [AMAN],
    agreements: [],
    ...overrides,
  };
}

function agreement(overrides: Partial<SharecroppingAgreement> = {}): SharecroppingAgreement {
  return {
    id: 'agr-9',
    reference: 'BRG-2025-009',
    landId: 'land-1',
    seasonId: 'season-aman-2025',
    cropId: 'crop-paddy',
    varietyId: 'var-br11',
    sharecropperId: 'party-sc-1',
    ownerId: 'owner-1',
    terms: NORMAL_TERMS,
    advanceAmount: 10000,
    startsOn: '2025-06-20',
    status: 'pending',
    submittedBy: 'Ashfakul Alam',
    submittedOn: '2025-06-16',
    decidedBy: '',
    decidedOn: '',
    decisionNote: '',
    cultivationCycleId: null,
    ...overrides,
  };
}

describe('land-type suitability', () => {
  it('allows paddy on paddy land', () => {
    expect(isCropSuitable(PADDY, DHANI)).toBe(true);
  });

  it('rejects paddy on homestead land', () => {
    expect(isCropSuitable(PADDY, VITA)).toBe(false);
  });

  it('reports the mismatch against the crop field', () => {
    const errors = validateAgreement(
      draft({ landId: 'land-3', advanceAmount: 0 }),
      context(),
    );
    expect(errors['cropId']).toContain('cannot be grown');
  });
});

describe('validateAgreement', () => {
  it('accepts a well-formed draft', () => {
    expect(validateAgreement(draft(), context())).toEqual({});
  });

  it('rejects a variety that belongs to another crop', () => {
    const errors = validateAgreement(draft({ varietyId: 'var-diamant' }), context());
    expect(errors['varietyId']).toBeTruthy();
  });

  it('rejects a start date outside the season window', () => {
    const errors = validateAgreement(draft({ startsOn: '2025-12-20' }), context());
    expect(errors['startsOn']).toBeTruthy();
  });

  it('rejects a plot already committed for the same season', () => {
    const errors = validateAgreement(
      draft(),
      context({ agreements: [agreement({ id: 'agr-1', status: 'active' })] }),
    );
    expect(errors['landId']).toContain('already committed');
  });

  it('allows a plot whose only other agreement was rejected', () => {
    const errors = validateAgreement(
      draft(),
      context({ agreements: [agreement({ id: 'agr-1', status: 'rejected' })] }),
    );
    expect(errors['landId']).toBeUndefined();
  });

  it('does not let an agreement clash with itself while being edited', () => {
    const errors = validateAgreement(
      draft(),
      context({
        agreements: [agreement({ id: 'agr-1', status: 'pending' })],
        ignoreAgreementId: 'agr-1',
      }),
    );
    expect(errors['landId']).toBeUndefined();
  });

  it('allows the same plot in a different season', () => {
    const errors = validateAgreement(
      draft(),
      context({
        agreements: [agreement({ id: 'agr-1', status: 'active', seasonId: 'season-boro-2026' })],
      }),
    );
    expect(errors['landId']).toBeUndefined();
  });

  it('caps the advance at the per-decimal ceiling for the plot', () => {
    const errors = validateAgreement(
      draft({ advanceAmount: DHANI.area * ADVANCE_PER_DECIMAL + 1 }),
      context(),
    );
    expect(errors['advanceAmount']).toBeTruthy();
  });

  it('allows an advance exactly at the ceiling', () => {
    const errors = validateAgreement(
      draft({ advanceAmount: DHANI.area * ADVANCE_PER_DECIMAL }),
      context(),
    );
    expect(errors['advanceAmount']).toBeUndefined();
  });

  it('rejects a negative advance', () => {
    expect(validateAgreement(draft({ advanceAmount: -1 }), context())['advanceAmount']).toBeTruthy();
  });
});

describe('validateTerms', () => {
  it("rejects an owner's share outside the band", () => {
    expect(validateTerms({ ...NORMAL_TERMS, ownerHarvestShare: 90 })['ownerHarvestShare'])
      .toBeTruthy();
  });

  it("accepts an owner's share inside the band", () => {
    expect(validateTerms({ ...NORMAL_TERMS, ownerHarvestShare: 40 })).toEqual({});
  });

  it('rejects a half-share Tevaga', () => {
    expect(validateTerms({ ...TEVAGA_TERMS, tevagaTotalShares: 2 })['tevagaTotalShares'])
      .toBeTruthy();
  });

  it('rejects Tevaga where the owner carries a cost line', () => {
    expect(validateTerms({ ...TEVAGA_TERMS, machineryResponsibility: 'owner' })).not.toEqual({});
  });

  it('ignores the Tevaga share count under the normal model', () => {
    expect(validateTerms({ ...NORMAL_TERMS, tevagaTotalShares: 99 })).toEqual({});
  });
});

describe('yield and share preview', () => {
  it('derives expected yield from area and variety', () => {
    expect(expectedYield(DHANI, BR11)).toBe(60);
  });

  it('splits a normal agreement by the negotiated percentage', () => {
    expect(shareSplit(NORMAL_TERMS, 60)).toEqual({ owner: 30, sharecropper: 30 });
  });

  it('gives the Tevaga owner exactly one share of three', () => {
    expect(shareSplit(TEVAGA_TERMS, 60)).toEqual({ owner: 20, sharecropper: 40 });
  });

  it('splits nothing when there is no yield', () => {
    expect(shareSplit(NORMAL_TERMS, 0)).toEqual({ owner: 0, sharecropper: 0 });
  });
});

describe('the decision', () => {
  it('allows deciding a pending agreement', () => {
    expect(canDecide(agreement())).toBe(true);
  });

  it('refuses to decide one that is already active', () => {
    expect(canDecide(agreement({ status: 'active' }))).toBe(false);
  });

  it('requires a reason of some substance', () => {
    expect(decisionNoteError('no')).toBeTruthy();
    expect(decisionNoteError('Half-share Tevaga is not local practice.')).toBe('');
  });
});

describe('activation and its inverse', () => {
  it('claims the plot for the agreement', () => {
    expect(claimLand(DHANI, 'agr-9').heldByAgreementId).toBe('agr-9');
  });

  it('is reversible, so revoking restores the plot exactly', () => {
    expect(releaseLand(claimLand(DHANI, 'agr-9'), 'agr-9')).toEqual(DHANI);
  });

  it('refuses to release a plot claimed by a different agreement', () => {
    const held = claimLand(DHANI, 'agr-other');
    expect(releaseLand(held, 'agr-9')).toEqual(held);
  });

  it('creates a cultivation cycle carrying the expected yield', () => {
    const cycle = cycleForAgreement(agreement(), DHANI, BR11, {
      id: 'cyc-9',
      reference: 'CYC-2025-009',
    });
    expect(cycle).toMatchObject({
      agreementId: 'agr-9',
      farmingType: 'sharecropping',
      status: 'planned',
      expectedYield: 60,
    });
  });

  it('opens an advance ledger row for the agreed dadhon', () => {
    const entry = advanceForAgreement(agreement(), { id: 'adv-9', reference: 'ADV-2025-009' });
    expect(entry).toMatchObject({ amount: 10000, outstanding: 10000, kind: 'signing' });
  });

  it('opens no ledger row when no advance was agreed', () => {
    expect(advanceForAgreement(agreement({ advanceAmount: 0 }), {
      id: 'adv-9',
      reference: 'ADV-2025-009',
    })).toBeNull();
  });
});

describe('reference numbering', () => {
  it('starts at 001 for a fresh year', () => {
    expect(nextReference([], 2025)).toBe('BRG-2025-001');
  });

  it('continues from the highest existing number for that year', () => {
    const rows = [
      agreement({ reference: 'BRG-2025-001' }),
      agreement({ reference: 'BRG-2025-007' }),
      agreement({ reference: 'BRG-2026-004' }),
    ];
    expect(nextReference(rows, 2025)).toBe('BRG-2025-008');
  });
});
