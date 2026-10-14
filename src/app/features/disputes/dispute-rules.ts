import { Dispute, DisputePoint, Settlement } from '../../core/models/settlement';

/**
 * Every rule of the Disputes module, as plain functions over plain data. No
 * `inject`, no signals, no store, no Angular import.
 *
 * The diagram does not draw a dispute as a dead end — it routes each kind of
 * disagreement back to a different recomputation point. That reroute is the
 * substance of this module: a dispute names *where* the work goes back to, so
 * resolving it is an instruction rather than a shrug.
 */

export const MIN_REASON_LENGTH = 15;

export interface DisputeDraft {
  settlementId: string;
  reroute: DisputePoint;
  reason: string;
  raisedOn: string;
}

export interface DisputeContext {
  settlements: Settlement[];
  disputes: Dispute[];
}

/** Where the reroute sends somebody. Named as a route so the page can link. */
export const REROUTE_TARGETS: Record<DisputePoint, { path: string; label: string }> = {
  harvest: { path: '/harvests', label: 'Harvests' },
  costs: { path: '/activities', label: 'Farming Activities' },
  sales: { path: '/sales', label: 'Sales' },
  shares: { path: '/agreements', label: 'Sharecropping Agreements' },
};

export function isOpen(dispute: Dispute): boolean {
  return dispute.status === 'open';
}

export function openFor(settlementId: string, disputes: Dispute[]): Dispute[] {
  return disputes.filter((row) => row.settlementId === settlementId && isOpen(row));
}

export function validateDispute(
  draft: DisputeDraft,
  context: DisputeContext,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const settlement = context.settlements.find((row) => row.id === draft.settlementId);

  if (!draft.settlementId) {
    errors['settlementId'] = 'Select the settlement being disputed.';
  } else if (!settlement) {
    errors['settlementId'] = 'That settlement no longer exists.';
  } else if (settlement.status === 'closed') {
    // Once closed, the money has moved. A disagreement after that is a new
    // matter, not a recomputation of this one.
    errors['settlementId'] = `${settlement.reference} is closed; its figures are final.`;
  } else if (openFor(settlement.id, context.disputes).length) {
    errors['settlementId'] = `${settlement.reference} already has an open dispute.`;
  }

  if (draft.reason.trim().length < MIN_REASON_LENGTH) {
    errors['reason'] = `Say what is wrong, in at least ${MIN_REASON_LENGTH} characters.`;
  }

  if (!draft.raisedOn) {
    errors['raisedOn'] = 'Give the date it was raised.';
  }

  return errors;
}

export function resolutionError(text: string): string {
  return text.trim().length < MIN_REASON_LENGTH
    ? `Say what was done about it, in at least ${MIN_REASON_LENGTH} characters.`
    : '';
}

export function disputeFromDraft(
  draft: DisputeDraft,
  ids: { id: string; reference: string },
  raisedBy: string,
): Dispute {
  return {
    id: ids.id,
    reference: ids.reference,
    settlementId: draft.settlementId,
    raisedBy,
    raisedOn: draft.raisedOn,
    reason: draft.reason.trim(),
    reroute: draft.reroute,
    status: 'open',
    resolvedBy: '',
    resolvedOn: '',
    resolution: '',
  };
}

export function resolve(dispute: Dispute, by: string, on: string, resolution: string): Dispute {
  return {
    ...dispute,
    status: 'resolved',
    resolvedBy: by,
    resolvedOn: on,
    resolution: resolution.trim(),
  };
}

/** Withdrawing is not resolving: nothing was found to be wrong, so the
 *  settlement's figures stand as they were rather than being recomputed. */
export function withdraw(dispute: Dispute, by: string, on: string): Dispute {
  return {
    ...dispute,
    status: 'withdrawn',
    resolvedBy: by,
    resolvedOn: on,
    resolution: 'Withdrawn by the party who raised it.',
  };
}

/** `DIS-2025-007` — next in sequence for the year. */
export function nextDisputeReference(disputes: Dispute[], year: number): string {
  const prefix = `DIS-${year}-`;
  const highest = disputes
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
