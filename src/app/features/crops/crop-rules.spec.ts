import { describe, expect, it } from 'vitest';
import { SharecroppingAgreement } from '../../core/models/agreement';
import { Crop, CropVariety, Land } from '../../core/models/agriculture';
import { CultivationCycle } from '../../core/models/cultivation';
import {
  CropContext,
  CropDraft,
  MAX_DURATION_DAYS,
  MAX_YIELD_PER_DECIMAL,
  MIN_DURATION_DAYS,
  VarietyContext,
  VarietyDraft,
  cropDeletionBlocker,
  growableOn,
  validateCrop,
  validateVariety,
  varietyDeletionBlocker,
  yieldFor,
} from './crop-rules';

const crop = (o: Partial<Crop> = {}): Crop => ({
  id: 'crop-paddy',
  name: 'Paddy (Dhan)',
  suitableLandTypes: ['dhani'],
  ...o,
});

const variety = (o: Partial<CropVariety> = {}): CropVariety => ({
  id: 'var-br11',
  cropId: 'crop-paddy',
  name: 'BR-11 (Mukta)',
  durationDays: 145,
  expectedYieldPerDecimal: 0.62,
  ...o,
});

const cropDraft = (o: Partial<CropDraft> = {}): CropDraft => ({
  name: 'Jute (Pat)',
  suitableLandTypes: ['dhani'],
  ...o,
});

const varietyDraft = (o: Partial<VarietyDraft> = {}): VarietyDraft => ({
  cropId: 'crop-paddy',
  name: 'Binadhan-7',
  durationDays: 120,
  expectedYieldPerDecimal: 0.55,
  ...o,
});

const cropContext = (o: Partial<CropContext> = {}): CropContext => ({ crops: [crop()], ...o });

const varietyContext = (o: Partial<VarietyContext> = {}): VarietyContext => ({
  varieties: [variety()],
  crops: [crop()],
  ...o,
});

describe('recording a crop', () => {
  it('accepts a complete draft', () => {
    expect(validateCrop(cropDraft(), cropContext())).toEqual({});
  });

  it('needs a name, and refuses a duplicate whatever its case', () => {
    expect(validateCrop(cropDraft({ name: '' }), cropContext())).toHaveProperty('name');
    expect(validateCrop(cropDraft({ name: 'paddy (dhan)' }), cropContext())).toHaveProperty('name');
  });

  it('does not clash with itself while being edited', () => {
    expect(
      validateCrop(
        cropDraft({ name: 'Paddy (Dhan)' }),
        cropContext({ ignoreCropId: 'crop-paddy' }),
      ),
    ).toEqual({});
  });

  it('refuses a crop that suits no land type', () => {
    // It would be offered by the agreement form and rejected by the suitability
    // rule on every possible plot.
    expect(validateCrop(cropDraft({ suitableLandTypes: [] }), cropContext())).toHaveProperty(
      'suitableLandTypes',
    );
  });
});

describe('recording a variety', () => {
  it('accepts a complete draft', () => {
    expect(validateVariety(varietyDraft(), varietyContext())).toEqual({});
  });

  it('needs a crop that exists', () => {
    expect(validateVariety(varietyDraft({ cropId: '' }), varietyContext())).toHaveProperty(
      'cropId',
    );
    expect(validateVariety(varietyDraft({ cropId: 'crop-gone' }), varietyContext())).toHaveProperty(
      'cropId',
    );
  });

  it('refuses a duplicate name within the same crop', () => {
    expect(
      validateVariety(varietyDraft({ name: 'BR-11 (Mukta)' }), varietyContext()),
    ).toHaveProperty('name');
  });

  it('allows the same variety name under a different crop', () => {
    const context = varietyContext({ crops: [crop(), crop({ id: 'crop-jute', name: 'Jute' })] });
    expect(
      validateVariety(varietyDraft({ cropId: 'crop-jute', name: 'BR-11 (Mukta)' }), context),
    ).toEqual({});
  });

  it('keeps the growing period plausible', () => {
    expect(
      validateVariety(varietyDraft({ durationDays: MIN_DURATION_DAYS - 1 }), varietyContext()),
    ).toHaveProperty('durationDays');
    expect(
      validateVariety(varietyDraft({ durationDays: MAX_DURATION_DAYS + 1 }), varietyContext()),
    ).toHaveProperty('durationDays');
    expect(
      validateVariety(varietyDraft({ durationDays: MIN_DURATION_DAYS }), varietyContext()),
    ).toEqual({});
  });

  it('catches a misplaced decimal point in the yield', () => {
    // The yield drives every harvest and settlement figure downstream.
    expect(
      validateVariety(
        varietyDraft({ expectedYieldPerDecimal: MAX_YIELD_PER_DECIMAL + 0.1 }),
        varietyContext(),
      )['expectedYieldPerDecimal'],
    ).toContain(String(MAX_YIELD_PER_DECIMAL));
    expect(
      validateVariety(varietyDraft({ expectedYieldPerDecimal: 0 }), varietyContext()),
    ).toHaveProperty('expectedYieldPerDecimal');
  });
});

describe('what a variety would give', () => {
  it('is area times yield per decimal, rounded', () => {
    expect(yieldFor(variety(), 132)).toBe(82);
    expect(yieldFor(variety({ expectedYieldPerDecimal: 1.8 }), 44)).toBe(79);
  });
});

describe('which plots a crop suits', () => {
  const lands: Land[] = [
    { id: 'l1', landType: 'dhani' } as Land,
    { id: 'l2', landType: 'vita' } as Land,
  ];

  it('reads the gate from the crop side', () => {
    expect(growableOn(crop({ suitableLandTypes: ['dhani'] }), lands).map((l) => l.id)).toEqual([
      'l1',
    ]);
    expect(
      growableOn(crop({ suitableLandTypes: ['dhani', 'vita'] }), lands).map((l) => l.id),
    ).toEqual(['l1', 'l2']);
  });
});

describe('removing a crop or a variety', () => {
  const agreement = (o: Partial<SharecroppingAgreement> = {}) =>
    ({ id: 'agr-1', cropId: 'crop-paddy', varietyId: 'var-br11', ...o }) as SharecroppingAgreement;
  const cycle = (o: Partial<CultivationCycle> = {}) =>
    ({ id: 'cyc-1', cropId: 'crop-paddy', varietyId: 'var-br11', ...o }) as CultivationCycle;

  it('blocks a crop that still has varieties, before anything else', () => {
    // Deleting the crop first would orphan them, so this check comes first.
    expect(cropDeletionBlocker(crop(), [variety()], [], [])).toContain('1 variety belongs');
  });

  it('blocks a crop named by an agreement or grown in a cycle', () => {
    expect(cropDeletionBlocker(crop(), [], [agreement()], [])).toContain('1 agreement');
    expect(cropDeletionBlocker(crop(), [], [], [cycle()])).toContain('1 cultivation cycle');
  });

  it('allows a crop nothing points at', () => {
    expect(cropDeletionBlocker(crop(), [], [], [])).toBe('');
  });

  it('blocks a variety named by an agreement or grown in a cycle', () => {
    expect(varietyDeletionBlocker(variety(), [agreement()], [])).toContain('1 agreement');
    expect(varietyDeletionBlocker(variety(), [], [cycle()])).toContain('1 cultivation cycle');
    expect(varietyDeletionBlocker(variety(), [], [])).toBe('');
  });

  it('ignores records naming a different crop or variety', () => {
    expect(cropDeletionBlocker(crop(), [], [agreement({ cropId: 'crop-jute' })], [])).toBe('');
    expect(varietyDeletionBlocker(variety(), [agreement({ varietyId: 'var-other' })], [])).toBe('');
  });
});
