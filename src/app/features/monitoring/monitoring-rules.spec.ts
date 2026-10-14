import { describe, expect, it } from 'vitest';
import { CultivationCycle, MonitoringLog } from '../../core/models/cultivation';
import {
  MAX_DAMAGE_PERCENT,
  ObservationDraft,
  adjusts,
  applyObservation,
  cumulativeLoss,
  isLatestAdjustment,
  nextObservationReference,
  observationFromDraft,
  revertObservation,
  validateObservation,
  yieldAfterDamage,
} from './monitoring-rules';

const cycle = (o: Partial<CultivationCycle> = {}): CultivationCycle =>
  ({
    id: 'cyc-1',
    reference: 'CYC-2025-001',
    startedOn: '2025-06-17',
    status: 'ongoing',
    expectedYield: 82,
    ...o,
  }) as CultivationCycle;

const draft = (o: Partial<ObservationDraft> = {}): ObservationDraft => ({
  cycleId: 'cyc-1',
  kind: 'damage-report',
  stage: 'vegetative',
  cause: 'pest',
  damagePercent: 10,
  observedOn: '2025-07-31',
  note: 'Stem borer through the north corner.',
  ...o,
});

const log = (o: Partial<MonitoringLog> = {}): MonitoringLog =>
  ({
    id: 'mon-1',
    reference: 'OBS-2025-001',
    cycleId: 'cyc-1',
    yieldBefore: 82,
    yieldAfter: 74,
    ...o,
  }) as MonitoringLog;

describe('what damage does to a yield', () => {
  it('takes the percentage off and rounds to whole maund', () => {
    expect(yieldAfterDamage(82, 10)).toBe(74);
    expect(yieldAfterDamage(82, 0)).toBe(82);
    expect(yieldAfterDamage(82, 100)).toBe(0);
  });

  it('never goes below nothing', () => {
    expect(yieldAfterDamage(10, 150)).toBe(0);
  });

  it('only adjusts when there is a cause and a loss', () => {
    // A routine scan is not a reason to move a number the settlement depends on.
    expect(adjusts({ cause: 'none', damagePercent: 0 })).toBe(false);
    expect(adjusts({ cause: 'pest', damagePercent: 0 })).toBe(false);
    expect(adjusts({ cause: 'none', damagePercent: 10 })).toBe(false);
    expect(adjusts({ cause: 'pest', damagePercent: 10 })).toBe(true);
  });
});

describe('recording an observation', () => {
  const context = { cycles: [cycle()] };

  it('accepts a complete draft', () => {
    expect(validateObservation(draft(), context)).toEqual({});
  });

  it('needs a cycle that can still be observed', () => {
    expect(validateObservation(draft({ cycleId: '' }), context)).toHaveProperty('cycleId');
    expect(
      validateObservation(draft(), { cycles: [cycle({ status: 'settled' })] })['cycleId'],
    ).toContain('final');
    expect(
      validateObservation(draft(), { cycles: [cycle({ status: 'aborted' })] })['cycleId'],
    ).toContain('aborted');
  });

  it('cannot predate the cycle', () => {
    expect(validateObservation(draft({ observedOn: '2025-06-01' }), context)).toHaveProperty(
      'observedOn',
    );
  });

  it('keeps damage inside its bounds', () => {
    expect(validateObservation(draft({ damagePercent: -1 }), context)).toHaveProperty(
      'damagePercent',
    );
    expect(
      validateObservation(draft({ damagePercent: MAX_DAMAGE_PERCENT + 1 }), context),
    ).toHaveProperty('damagePercent');
    expect(validateObservation(draft({ damagePercent: MAX_DAMAGE_PERCENT }), context)).toEqual({});
  });

  it('will not drop a yield with no cause on the record', () => {
    expect(
      validateObservation(draft({ cause: 'none', damagePercent: 10 }), context),
    ).toHaveProperty('cause');
  });

  it('will not accept a damage report with no damage', () => {
    expect(validateObservation(draft({ damagePercent: 0 }), context)['damagePercent']).toContain(
      'field visit',
    );
    // The same figures are fine on a field visit — that is what it is for.
    expect(validateObservation(draft({ kind: 'field-visit', damagePercent: 0 }), context)).toEqual(
      {},
    );
  });

  it('needs a note saying what was seen', () => {
    expect(validateObservation(draft({ note: 'ok' }), context)).toHaveProperty('note');
  });

  it('carries both yields, so the adjustment can be read back', () => {
    const recorded = observationFromDraft(
      draft(),
      cycle(),
      { id: 'mon-9', reference: 'OBS-2025-009' },
      'Rezaul Karim',
    );
    expect(recorded).toMatchObject({ yieldBefore: 82, yieldAfter: 74 });
  });

  it('leaves the yield alone for an observation with no loss', () => {
    const recorded = observationFromDraft(
      draft({ kind: 'ai-scan', cause: 'none', damagePercent: 0 }),
      cycle(),
      { id: 'mon-9', reference: 'OBS-2025-009' },
      'Rezaul Karim',
    );
    expect(recorded.yieldAfter).toBe(recorded.yieldBefore);
  });
});

describe('applying and reverting', () => {
  it('moves the cycle to the observed yield', () => {
    expect(applyObservation(cycle(), log()).expectedYield).toBe(74);
  });

  it('reverts to exactly what was there before, not to a recomputation', () => {
    // A later observation may have moved the number again; recomputing would
    // compound two adjustments into one.
    expect(revertObservation(applyObservation(cycle(), log()), log())).toEqual(cycle());
  });

  it('only offers to revert the observation currently accounting for the yield', () => {
    const adjusted = cycle({ expectedYield: 74 });
    expect(isLatestAdjustment(log(), adjusted)).toBe(true);
    // An older one, already superseded.
    expect(isLatestAdjustment(log({ yieldBefore: 90, yieldAfter: 82 }), adjusted)).toBe(false);
    // One that never adjusted anything.
    expect(isLatestAdjustment(log({ yieldBefore: 82, yieldAfter: 82 }), adjusted)).toBe(false);
  });

  it('reports the total loss against where the cycle started', () => {
    const adjusted = cycle({ expectedYield: 74 });
    expect(cumulativeLoss(adjusted, [log()])).toBe(10);
    expect(cumulativeLoss(cycle(), [log({ yieldBefore: 82, yieldAfter: 82 })])).toBe(0);
    expect(cumulativeLoss(cycle(), [])).toBe(0);
  });
});

describe('observation reference numbering', () => {
  it('starts at 001 and continues from the highest for that year', () => {
    expect(nextObservationReference([], 2025)).toBe('OBS-2025-001');
    expect(
      nextObservationReference(
        [log({ reference: 'OBS-2025-003' }), log({ reference: 'OBS-2026-009' })],
        2025,
      ),
    ).toBe('OBS-2025-004');
  });
});
