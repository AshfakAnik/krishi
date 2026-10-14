import { describe, expect, it } from 'vitest';
import { CultivationCycle } from '../../core/models/cultivation';
import { Harvest } from '../../core/models/harvest';
import {
  HarvestContext,
  HarvestDraft,
  YIELD_TOLERANCE,
  harvestedSoFar,
  nextBatchNo,
  nextHarvestReference,
  validateHarvest,
  yieldAchieved,
} from './harvest-rules';

const cycle = (o: Partial<CultivationCycle> = {}): CultivationCycle =>
  ({
    id: 'cyc-2',
    reference: 'CYC-2025-002',
    startedOn: '2025-06-19',
    status: 'harvesting',
    expectedYield: 122,
    ...o,
  }) as CultivationCycle;

const harvest = (o: Partial<Harvest> = {}): Harvest =>
  ({
    id: 'hrv-1',
    reference: 'HRV-2025-001',
    cycleId: 'cyc-2',
    harvestedOn: '2025-10-21',
    quantity: 70,
    grade: 'a',
    labourCost: 9800,
    batchNo: 1,
    note: '',
    ...o,
  }) as Harvest;

const draft = (o: Partial<HarvestDraft> = {}): HarvestDraft => ({
  cycleId: 'cyc-2',
  harvestedOn: '2025-10-26',
  quantity: 46,
  grade: 'b',
  labourCost: 6200,
  note: 'Second cut.',
  ...o,
});

const context = (o: Partial<HarvestContext> = {}): HarvestContext => ({
  cycles: [cycle()],
  harvests: [harvest()],
  ...o,
});

describe('recording a harvest', () => {
  it('accepts a second batch off a cycle already partly cut', () => {
    expect(validateHarvest(draft(), context())).toEqual({});
  });

  it('needs a cycle that has actually grown something', () => {
    expect(validateHarvest(draft({ cycleId: '' }), context())).toHaveProperty('cycleId');
    // Picking the wrong cycle is easy when a plot carries one every season.
    expect(
      validateHarvest(draft(), context({ cycles: [cycle({ status: 'planned' })] }))['cycleId'],
    ).toContain('not started');
    expect(
      validateHarvest(draft(), context({ cycles: [cycle({ status: 'aborted' })] }))['cycleId'],
    ).toContain('aborted');
    expect(
      validateHarvest(draft(), context({ cycles: [cycle({ status: 'settled' })] }))['cycleId'],
    ).toContain('settled');
  });

  it('catches a unit slip against the expected yield', () => {
    // 70 already cut, plus 800 more, against an expected 122.
    const errors = validateHarvest(draft({ quantity: 800 }), context());
    expect(errors['quantity']).toContain('122');
  });

  it('allows a better season than forecast, inside tolerance', () => {
    // 70 + 100 = 170, against 122 × 1.5 = 183.
    expect(validateHarvest(draft({ quantity: 100 }), context())).toEqual({});
    expect(YIELD_TOLERANCE).toBeGreaterThan(1);
  });

  it('does not count the harvest being edited against itself', () => {
    const errors = validateHarvest(draft({ quantity: 170 }), context({ ignoreHarvestId: 'hrv-1' }));
    expect(errors).toEqual({});
  });

  it('needs a quantity, a date inside the cycle, and whole-taka labour', () => {
    expect(validateHarvest(draft({ quantity: 0 }), context())).toHaveProperty('quantity');
    expect(validateHarvest(draft({ harvestedOn: '2025-06-01' }), context())).toHaveProperty(
      'harvestedOn',
    );
    expect(validateHarvest(draft({ labourCost: -1 }), context())).toHaveProperty('labourCost');
    expect(validateHarvest(draft({ labourCost: 12.5 }), context())).toHaveProperty('labourCost');
  });
});

describe('multi-batch harvesting', () => {
  it('numbers batches within the cycle, not globally', () => {
    // "Batch 2" means the second cut off this plot, which is what anybody
    // standing in the field means.
    const harvests = [
      harvest({ id: 'a', cycleId: 'cyc-1', batchNo: 1 }),
      harvest({ id: 'b', cycleId: 'cyc-1', batchNo: 2 }),
      harvest({ id: 'c', cycleId: 'cyc-2', batchNo: 1 }),
    ];
    expect(nextBatchNo('cyc-1', harvests)).toBe(3);
    expect(nextBatchNo('cyc-2', harvests)).toBe(2);
    expect(nextBatchNo('cyc-9', harvests)).toBe(1);
  });

  it('totals every batch off a cycle', () => {
    const harvests = [
      harvest({ id: 'a', quantity: 70 }),
      harvest({ id: 'b', quantity: 46 }),
      harvest({ id: 'c', cycleId: 'cyc-9', quantity: 100 }),
    ];
    expect(harvestedSoFar('cyc-2', harvests)).toBe(116);
    expect(harvestedSoFar('cyc-2', harvests, 'b')).toBe(70);
  });

  it('reports achievement against the expectation', () => {
    expect(yieldAchieved(cycle(), [harvest({ quantity: 122 })])).toBe(100);
    expect(yieldAchieved(cycle(), [harvest({ quantity: 61 })])).toBe(50);
    expect(yieldAchieved(cycle({ expectedYield: 0 }), [])).toBe(0);
  });
});

describe('harvest reference numbering', () => {
  it('starts at 001 and continues from the highest for that year', () => {
    expect(nextHarvestReference([], 2025)).toBe('HRV-2025-001');
    expect(
      nextHarvestReference(
        [harvest({ reference: 'HRV-2025-004' }), harvest({ reference: 'HRV-2026-009' })],
        2025,
      ),
    ).toBe('HRV-2025-005');
  });
});
