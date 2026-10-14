import { describe, expect, it } from 'vitest';
import { SharecroppingAgreement } from '../../core/models/agreement';
import { Crop, CropVariety, Land, Season } from '../../core/models/agriculture';
import { CultivationCycle } from '../../core/models/cultivation';
import {
  CycleContext,
  CycleDraft,
  abort,
  advance,
  canAbort,
  canAdvance,
  claimForCycle,
  expectedYield,
  nextCycleReference,
  nextStatus,
  occupies,
  ownerCycleFromDraft,
  releaseFromCycle,
  validateCycle,
} from './cycle-rules';

const land = (o: Partial<Land> = {}): Land => ({
  id: 'land-2',
  code: 'SHB-DAG-118',
  name: 'Uttar Para Dhani',
  landType: 'dhani',
  area: 96,
  location: 'Shibpur',
  ownerId: 'party-owner-1',
  heldByAgreementId: null,
  ...o,
});

const crop = (o: Partial<Crop> = {}): Crop => ({
  id: 'crop-paddy',
  name: 'Paddy (Dhan)',
  suitableLandTypes: ['dhani'],
  ...o,
});

const variety = (o: Partial<CropVariety> = {}): CropVariety => ({
  id: 'var-br11',
  cropId: 'crop-paddy',
  name: 'BR-11',
  durationDays: 145,
  expectedYieldPerDecimal: 0.62,
  ...o,
});

const season = (o: Partial<Season> = {}): Season => ({
  id: 'season-aman-2025',
  name: 'Aman 2025',
  year: 2025,
  startsOn: '2025-06-15',
  endsOn: '2025-11-27',
  active: true,
  ...o,
});

const cycle = (o: Partial<CultivationCycle> = {}): CultivationCycle => ({
  id: 'cyc-1',
  reference: 'CYC-2025-001',
  landId: 'land-2',
  seasonId: 'season-aman-2025',
  cropId: 'crop-paddy',
  varietyId: 'var-br11',
  farmingType: 'owner',
  agreementId: null,
  sharecropperId: null,
  startedOn: '2025-06-20',
  status: 'planned',
  expectedYield: 60,
  ...o,
});

const draft = (o: Partial<CycleDraft> = {}): CycleDraft => ({
  landId: 'land-2',
  seasonId: 'season-aman-2025',
  cropId: 'crop-paddy',
  varietyId: 'var-br11',
  startedOn: '2025-06-20',
  ...o,
});

const context = (o: Partial<CycleContext> = {}): CycleContext => ({
  lands: [land()],
  crops: [crop(), crop({ id: 'crop-potato', name: 'Potato', suitableLandTypes: ['vita'] })],
  varieties: [variety()],
  seasons: [season()],
  cycles: [],
  agreements: [],
  ...o,
});

describe('opening an owner-farming cycle', () => {
  it('accepts a draft on a free plot', () => {
    expect(validateCycle(draft(), context())).toEqual({});
  });

  it('needs a plot and a season', () => {
    expect(validateCycle(draft({ landId: '' }), context())).toHaveProperty('landId');
    expect(validateCycle(draft({ seasonId: '' }), context())).toHaveProperty('seasonId');
  });

  it('applies the crop suitability gate to an owner too', () => {
    // An owner farming their own land can plant potato on paddy land just as
    // easily as anybody else.
    expect(validateCycle(draft({ cropId: 'crop-potato' }), context())).toHaveProperty('cropId');
  });

  it('refuses a variety belonging to another crop', () => {
    const context_ = context({
      varieties: [variety(), variety({ id: 'var-diamant', cropId: 'crop-potato' })],
    });
    expect(validateCycle(draft({ varietyId: 'var-diamant' }), context_)).toHaveProperty(
      'varietyId',
    );
  });

  it('refuses a plot that already carries a cycle this season', () => {
    const errors = validateCycle(draft(), context({ cycles: [cycle({ status: 'ongoing' })] }));
    expect(errors['landId']).toContain('CYC-2025-001');
  });

  it('allows the plot once that cycle is settled or aborted', () => {
    expect(validateCycle(draft(), context({ cycles: [cycle({ status: 'settled' })] }))).toEqual({});
    expect(validateCycle(draft(), context({ cycles: [cycle({ status: 'aborted' })] }))).toEqual({});
  });

  it('refuses a plot an agreement holds for the same season', () => {
    const agreement = {
      id: 'agr-1',
      reference: 'BRG-2025-001',
      landId: 'land-2',
      seasonId: 'season-aman-2025',
      status: 'active',
    } as SharecroppingAgreement;
    const errors = validateCycle(draft(), context({ agreements: [agreement] }));
    expect(errors['landId']).toContain('BRG-2025-001');
  });

  it('ignores a rejected or revoked agreement on that plot', () => {
    const agreement = (status: SharecroppingAgreement['status']) =>
      ({
        id: 'agr-1',
        reference: 'BRG-2025-001',
        landId: 'land-2',
        seasonId: 'season-aman-2025',
        status,
      }) as SharecroppingAgreement;
    expect(validateCycle(draft(), context({ agreements: [agreement('revoked')] }))).toEqual({});
    expect(validateCycle(draft(), context({ agreements: [agreement('rejected')] }))).toEqual({});
  });

  it('keeps the start date inside the season', () => {
    expect(validateCycle(draft({ startedOn: '2025-06-01' }), context())).toHaveProperty(
      'startedOn',
    );
    expect(validateCycle(draft({ startedOn: '2025-12-01' }), context())).toHaveProperty(
      'startedOn',
    );
  });

  it('opens with no agreement and no tenant — that is the branch', () => {
    const opened = ownerCycleFromDraft(draft(), land(), variety(), {
      id: 'cyc-9',
      reference: 'CYC-2025-009',
    });
    expect(opened).toMatchObject({
      farmingType: 'owner',
      agreementId: null,
      sharecropperId: null,
      status: 'planned',
      expectedYield: 60,
    });
  });
});

describe('the expected yield', () => {
  it('is area times the variety yield, rounded', () => {
    expect(expectedYield(land({ area: 96 }), variety())).toBe(60);
  });

  it('is nothing without both', () => {
    expect(expectedYield(undefined, variety())).toBe(0);
    expect(expectedYield(land(), undefined)).toBe(0);
  });
});

describe('moving a cycle along', () => {
  it('runs planned to ongoing to harvesting to settled', () => {
    expect(nextStatus(cycle({ status: 'planned' }))).toBe('ongoing');
    expect(nextStatus(cycle({ status: 'ongoing' }))).toBe('harvesting');
    expect(nextStatus(cycle({ status: 'harvesting' }))).toBe('settled');
  });

  it('stops at settled', () => {
    expect(nextStatus(cycle({ status: 'settled' }))).toBeNull();
    expect(canAdvance(cycle({ status: 'settled' }))).toBe(false);
    expect(advance(cycle({ status: 'settled' })).status).toBe('settled');
  });

  it('never resumes an aborted cycle', () => {
    // `aborted` is off the progression, so there is no "next" from it.
    expect(nextStatus(cycle({ status: 'aborted' }))).toBeNull();
    expect(canAdvance(cycle({ status: 'aborted' }))).toBe(false);
  });

  it('aborts anything unfinished, and nothing finished', () => {
    expect(canAbort(cycle({ status: 'planned' }))).toBe(true);
    expect(canAbort(cycle({ status: 'harvesting' }))).toBe(true);
    expect(canAbort(cycle({ status: 'settled' }))).toBe(false);
    expect(canAbort(cycle({ status: 'aborted' }))).toBe(false);
    expect(abort(cycle({ status: 'settled' })).status).toBe('settled');
  });

  it('occupies its plot until it is settled or aborted', () => {
    expect(occupies(cycle({ status: 'planned' }))).toBe(true);
    expect(occupies(cycle({ status: 'harvesting' }))).toBe(true);
    expect(occupies(cycle({ status: 'settled' }))).toBe(false);
    expect(occupies(cycle({ status: 'aborted' }))).toBe(false);
  });
});

describe('holding the plot', () => {
  it('releases exactly the plot this cycle claimed', () => {
    expect(releaseFromCycle(claimForCycle(land(), 'cyc-1'), 'cyc-1')).toEqual(land());
  });

  it('leaves a plot some other record has since claimed', () => {
    const held = claimForCycle(land(), 'agr-9');
    expect(releaseFromCycle(held, 'cyc-1')).toEqual(held);
  });
});

describe('cycle reference numbering', () => {
  it('starts at 001 and continues from the highest for that year', () => {
    expect(nextCycleReference([], 2025)).toBe('CYC-2025-001');
    expect(
      nextCycleReference(
        [cycle({ reference: 'CYC-2025-003' }), cycle({ reference: 'CYC-2026-009' })],
        2025,
      ),
    ).toBe('CYC-2025-004');
  });
});
