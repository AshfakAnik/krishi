import { describe, expect, it } from 'vitest';
import { Dispute, Settlement } from '../../core/models/settlement';
import {
  DisputeContext,
  DisputeDraft,
  MIN_REASON_LENGTH,
  REROUTE_TARGETS,
  disputeFromDraft,
  isOpen,
  openFor,
  resolutionError,
  resolve,
  validateDispute,
  withdraw,
} from './dispute-rules';

const settlement = (o: Partial<Settlement> = {}): Settlement =>
  ({ id: 'stl-1', reference: 'STL-2025-001', status: 'agreed', ...o }) as Settlement;

const dispute = (o: Partial<Dispute> = {}): Dispute =>
  ({
    id: 'dis-1',
    reference: 'DIS-2025-001',
    settlementId: 'stl-1',
    status: 'open',
    reroute: 'costs',
    ...o,
  }) as Dispute;

const draft = (o: Partial<DisputeDraft> = {}): DisputeDraft => ({
  settlementId: 'stl-1',
  reroute: 'costs',
  reason: 'The pesticide cost was recorded twice against my side.',
  raisedOn: '2025-11-12',
  ...o,
});

const context = (o: Partial<DisputeContext> = {}): DisputeContext => ({
  settlements: [settlement()],
  disputes: [],
  ...o,
});

describe('raising a dispute', () => {
  it('accepts a reasoned objection to a live settlement', () => {
    expect(validateDispute(draft(), context())).toEqual({});
  });

  it('refuses a closed settlement', () => {
    // The money has moved; a disagreement after that is a new matter.
    const errors = validateDispute(
      draft(),
      context({ settlements: [settlement({ status: 'closed' })] }),
    );
    expect(errors['settlementId']).toContain('closed');
  });

  it('refuses a second open dispute on the same settlement', () => {
    const errors = validateDispute(draft(), context({ disputes: [dispute()] }));
    expect(errors['settlementId']).toContain('already has an open dispute');
  });

  it('allows a new one once the first is resolved', () => {
    expect(
      validateDispute(draft(), context({ disputes: [dispute({ status: 'resolved' })] })),
    ).toEqual({});
  });

  it('insists on a reason and a date', () => {
    expect(validateDispute(draft({ reason: 'wrong' }), context())).toHaveProperty('reason');
    expect(validateDispute(draft({ raisedOn: '' }), context())).toHaveProperty('raisedOn');
    expect(MIN_REASON_LENGTH).toBeGreaterThan(0);
  });

  it('names where the work goes back to', () => {
    // A dispute is an instruction, not a shrug.
    expect(REROUTE_TARGETS.costs.path).toBe('/activities');
    expect(REROUTE_TARGETS.harvest.path).toBe('/harvests');
    expect(REROUTE_TARGETS.sales.path).toBe('/sales');
    expect(REROUTE_TARGETS.shares.path).toBe('/agreements');
  });

  it('opens as open, carrying the reroute', () => {
    const raised = disputeFromDraft(
      draft(),
      { id: 'dis-9', reference: 'DIS-2025-009' },
      'Jashim Uddin',
    );
    expect(raised).toMatchObject({ status: 'open', reroute: 'costs', raisedBy: 'Jashim Uddin' });
    expect(isOpen(raised)).toBe(true);
  });
});

describe('closing a dispute', () => {
  it('insists a resolution says what was done', () => {
    expect(resolutionError('fixed')).not.toBe('');
    expect(resolutionError('Removed the duplicated pesticide line and recomputed.')).toBe('');
  });

  it('records who resolved it', () => {
    const done = resolve(dispute(), 'Rezaul Karim', '2025-11-14', 'Removed the duplicate line.');
    expect(done).toMatchObject({ status: 'resolved', resolvedBy: 'Rezaul Karim' });
    expect(isOpen(done)).toBe(false);
  });

  it('keeps withdrawn distinguishable from resolved', () => {
    // Nothing was found wrong, so the figures stand rather than being recomputed.
    const gone = withdraw(dispute(), 'Jashim Uddin', '2025-11-13');
    expect(gone.status).toBe('withdrawn');
    expect(gone.resolution).toContain('Withdrawn');
  });

  it('lists only what is still open against a settlement', () => {
    const disputes = [
      dispute({ id: 'a' }),
      dispute({ id: 'b', status: 'resolved' }),
      dispute({ id: 'c', settlementId: 'stl-9' }),
    ];
    expect(openFor('stl-1', disputes).map((row) => row.id)).toEqual(['a']);
  });
});
