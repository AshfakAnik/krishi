import { describe, expect, it } from 'vitest';
import { SharecroppingAgreement } from '../../core/models/agreement';
import { Crop, Land } from '../../core/models/agriculture';
import { CultivationCycle } from '../../core/models/cultivation';
import {
  MAX_AREA_DECIMALS,
  MIN_AREA_DECIMALS,
  LandContext,
  LandDraft,
  deletionBlocker,
  isHeld,
  lockedFields,
  suitableCrops,
  validateLand,
} from './land-rules';

function land(overrides: Partial<Land> = {}): Land {
  return {
    id: 'land-1',
    code: 'SHB-DAG-104',
    name: 'Boro Dhani Beel',
    landType: 'dhani',
    area: 132,
    location: 'Shibpur, Mouza Shibpur, Dag 104',
    ownerId: 'party-owner-1',
    heldByAgreementId: null,
    ...overrides,
  };
}

function draft(overrides: Partial<LandDraft> = {}): LandDraft {
  return {
    code: 'SHB-DAG-999',
    name: 'Notun Dhani',
    landType: 'dhani',
    area: 60,
    location: 'Shibpur, Mouza Shibpur, Dag 999',
    ownerId: 'party-owner-1',
    ...overrides,
  };
}

function context(overrides: Partial<LandContext> = {}): LandContext {
  return { lands: [land()], ...overrides };
}

const agreement = (overrides: Partial<SharecroppingAgreement> = {}) =>
  ({ id: 'agr-1', landId: 'land-1', status: 'active', ...overrides }) as SharecroppingAgreement;

describe('recording a plot', () => {
  it('accepts a complete draft', () => {
    expect(validateLand(draft(), context())).toEqual({});
  });

  it('needs a dag code', () => {
    expect(validateLand(draft({ code: '  ' }), context())).toHaveProperty('code');
  });

  it('refuses a duplicate dag code, whatever its case', () => {
    // Two rows sharing a code is how the wrong plot ends up in an agreement.
    expect(validateLand(draft({ code: 'shb-dag-104' }), context())).toHaveProperty('code');
  });

  it('does not clash with itself while being edited', () => {
    expect(
      validateLand(draft({ code: 'SHB-DAG-104' }), context({ ignoreLandId: 'land-1' })),
    ).toEqual({});
  });

  it('needs a name, an owner and a location', () => {
    expect(validateLand(draft({ name: 'x' }), context())).toHaveProperty('name');
    expect(validateLand(draft({ ownerId: '' }), context())).toHaveProperty('ownerId');
    expect(validateLand(draft({ location: '' }), context())).toHaveProperty('location');
  });

  it('needs a workable area', () => {
    expect(validateLand(draft({ area: 0 }), context())).toHaveProperty('area');
    expect(validateLand(draft({ area: -5 }), context())).toHaveProperty('area');
    expect(validateLand(draft({ area: MAX_AREA_DECIMALS + 1 }), context())['area']).toContain(
      String(MAX_AREA_DECIMALS),
    );
  });

  it('allows an area exactly at each bound', () => {
    expect(validateLand(draft({ area: MIN_AREA_DECIMALS }), context())).toEqual({});
    expect(validateLand(draft({ area: MAX_AREA_DECIMALS }), context())).toEqual({});
  });
});

describe('what a committed plot locks', () => {
  it('locks nothing while the plot is free', () => {
    expect(lockedFields(land(), [])).toEqual([]);
    expect(lockedFields(land(), [agreement({ status: 'revoked' })])).toEqual([]);
    expect(lockedFields(land(), [agreement({ status: 'rejected' })])).toEqual([]);
  });

  it('locks area and land type while an agreement holds it', () => {
    // Both were validated at signing: the crop had to suit the type, and the
    // advance had to fit a ceiling derived from the area.
    expect(lockedFields(land(), [agreement({ status: 'active' })])).toEqual(['landType', 'area']);
    expect(lockedFields(land(), [agreement({ status: 'pending' })])).toEqual(['landType', 'area']);
  });

  it('ignores agreements on another plot', () => {
    expect(lockedFields(land(), [agreement({ landId: 'land-9' })])).toEqual([]);
  });

  it('reads held from the plot itself', () => {
    expect(isHeld(land())).toBe(false);
    expect(isHeld(land({ heldByAgreementId: 'agr-1' }))).toBe(true);
  });
});

describe('which crops suit a plot', () => {
  const crops: Crop[] = [
    { id: 'crop-paddy', name: 'Paddy', suitableLandTypes: ['dhani'] },
    { id: 'crop-potato', name: 'Potato', suitableLandTypes: ['vita'] },
    { id: 'crop-mustard', name: 'Mustard', suitableLandTypes: ['vita', 'dhani'] },
  ];

  it('reads Lane 1s gate from the plot side', () => {
    expect(suitableCrops(land({ landType: 'dhani' }), crops).map((c) => c.id)).toEqual([
      'crop-paddy',
      'crop-mustard',
    ]);
    expect(suitableCrops(land({ landType: 'vita' }), crops).map((c) => c.id)).toEqual([
      'crop-potato',
      'crop-mustard',
    ]);
  });

  it('suits nothing without a plot', () => {
    expect(suitableCrops(undefined, crops)).toEqual([]);
  });
});

describe('removing a plot', () => {
  const cycle = { id: 'cyc-1', landId: 'land-1' } as CultivationCycle;

  it('is allowed when nothing points at it', () => {
    expect(deletionBlocker(land(), [], [])).toBe('');
  });

  it('is blocked while an agreement holds it', () => {
    expect(deletionBlocker(land({ heldByAgreementId: 'agr-1' }), [], [])).toContain('holds');
  });

  it('is blocked by history, even once released', () => {
    expect(deletionBlocker(land(), [agreement({ status: 'revoked' })], [])).toContain(
      '1 agreement',
    );
    expect(deletionBlocker(land(), [], [cycle])).toContain('1 cultivation cycle');
  });

  it('ignores records belonging to another plot', () => {
    expect(deletionBlocker(land(), [agreement({ landId: 'land-9' })], [])).toBe('');
  });
});
