import { describe, expect, it } from 'vitest';
import { Harvest, ProcessingBatch } from '../../core/models/harvest';
import {
  BatchContext,
  BatchDraft,
  MAX_WASTAGE_PERCENT,
  batchFromDraft,
  complete,
  completionError,
  lotFromBatch,
  processedFrom,
  reopen,
  unprocessed,
  validateBatch,
  wastage,
  wastagePercent,
} from './process-rules';

const harvest = (o: Partial<Harvest> = {}): Harvest =>
  ({
    id: 'hrv-1',
    reference: 'HRV-2025-001',
    cycleId: 'cyc-2',
    harvestedOn: '2025-10-21',
    quantity: 70,
    grade: 'a',
    ...o,
  }) as Harvest;

const batch = (o: Partial<ProcessingBatch> = {}): ProcessingBatch =>
  ({
    id: 'bat-1',
    reference: 'PRC-2025-001',
    harvestId: 'hrv-1',
    process: 'drying',
    startedOn: '2025-10-22',
    completedOn: '',
    inputQuantity: 70,
    outputQuantity: 0,
    status: 'running',
    note: '',
    ...o,
  }) as ProcessingBatch;

const draft = (o: Partial<BatchDraft> = {}): BatchDraft => ({
  harvestId: 'hrv-1',
  process: 'drying',
  startedOn: '2025-10-22',
  note: '',
  ...o,
});

const context = (o: Partial<BatchContext> = {}): BatchContext => ({
  harvests: [harvest()],
  batches: [],
  ...o,
});

describe('what a batch loses', () => {
  it('derives the wastage rather than storing it', () => {
    const done = batch({ status: 'complete', outputQuantity: 64 });
    expect(wastage(done)).toBe(6);
    expect(wastagePercent(done)).toBe(9);
  });

  it('reports nothing for a batch still running', () => {
    expect(wastage(batch())).toBe(0);
    expect(wastagePercent(batch())).toBe(0);
  });
});

describe('opening a batch', () => {
  it('accepts a draft against an unprocessed harvest', () => {
    expect(validateBatch(draft(), context())).toEqual({});
  });

  it('refuses a harvest already processed in full', () => {
    const errors = validateBatch(draft(), context({ batches: [batch({ inputQuantity: 70 })] }));
    expect(errors['harvestId']).toContain('nothing left');
  });

  it('takes only what earlier batches left', () => {
    const batches = [batch({ id: 'a', inputQuantity: 40 })];
    expect(processedFrom('hrv-1', batches)).toBe(40);
    expect(unprocessed(harvest(), batches)).toBe(30);
    expect(
      batchFromDraft(draft(), harvest(), batches, { id: 'b', reference: 'PRC-2' }),
    ).toMatchObject({ inputQuantity: 30, status: 'running', outputQuantity: 0 });
  });

  it('cannot start before the harvest was cut', () => {
    expect(validateBatch(draft({ startedOn: '2025-10-01' }), context())).toHaveProperty(
      'startedOn',
    );
  });
});

describe('completing a batch', () => {
  it('accepts a plausible output', () => {
    expect(completionError(batch(), 64, '2025-10-25')).toBe('');
  });

  it('refuses more out than in', () => {
    // Weight is lost in processing, never gained.
    expect(completionError(batch(), 80, '2025-10-25')).toContain('gains weight');
  });

  it('refuses implausible wastage', () => {
    expect(completionError(batch(), 10, '2025-10-25')).toContain(String(MAX_WASTAGE_PERCENT));
  });

  it('refuses finishing before it began, and refuses doing it twice', () => {
    expect(completionError(batch(), 64, '2025-10-01')).toContain('before it began');
    expect(completionError(batch({ status: 'complete' }), 64, '2025-10-25')).toContain(
      'already complete',
    );
  });

  it('reopens exactly, clearing the output and the date', () => {
    // A running batch carrying either would read as finished downstream.
    const original = batch();
    expect(reopen(complete(original, 64, '2025-10-25'))).toEqual(original);
  });

  it('produces a pooled lot carrying the harvest grade', () => {
    const done = complete(batch(), 64, '2025-10-25');
    const lot = lotFromBatch(done, harvest(), { id: 'lot-9', reference: 'LOT-9' }, 'North bay');
    expect(lot).toMatchObject({
      cycleId: 'cyc-2',
      grade: 'a',
      heldFor: 'pool',
      quantity: 64,
      storedOn: '2025-10-25',
    });
  });

  it('never files a lot into nowhere', () => {
    const done = complete(batch(), 64, '2025-10-25');
    expect(lotFromBatch(done, harvest(), { id: 'l', reference: 'L' }, '   ').location).toBe(
      'Unassigned store',
    );
  });
});
