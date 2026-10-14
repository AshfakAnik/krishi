import { SharecroppingAgreement } from '../../core/models/agreement';
import { Land, Season } from '../../core/models/agriculture';
import { AdvanceDraft, AdvanceLedgerEntry } from '../../core/models/cultivation';
import { committedAgainst, headroom } from '../../core/rules/dadhon';

/**
 * Every rule of the Advances & Loans module, as plain functions over plain
 * data. No `inject`, no signals, no store, no Angular import anywhere in this
 * file — same contract as `agreement-rules.ts`, and for the same reason.
 *
 * The ceiling arithmetic itself lives in `core/rules/dadhon.ts`, because
 * Sharecropping Agreements enforces the same limit at signing. What is here is
 * the part only this module has an opinion about: when a draw may be made, what
 * a decision does to the ledger row, and what a repayment does to the balance.
 */

/** A mid-season note that says nothing is not a reason to hand over money. */
export const MIN_NOTE_LENGTH = 10;

export interface AdvanceContext {
  agreements: SharecroppingAgreement[];
  lands: Land[];
  seasons: Season[];
  /** The whole ledger, so the headroom rule can see every other row. */
  ledger: AdvanceLedgerEntry[];
  /** Set when editing, so a row does not count against its own headroom. */
  ignoreAdvanceId?: string;
}

/** Only a pending row is decidable. Guards the detail page's buttons and is
 *  asserted again before dispatching, so a stale tab cannot decide twice. */
export function canDecideAdvance(entry: AdvanceLedgerEntry): boolean {
  return entry.status === 'pending';
}

/** Only a disbursed row with a balance can take a repayment. */
export function canRepay(entry: AdvanceLedgerEntry): boolean {
  return entry.status === 'active' && entry.outstanding > 0;
}

/** A refusal without a reason is not a decision. */
export function refusalNoteError(note: string): string {
  return note.trim().length < MIN_NOTE_LENGTH
    ? `Give a reason of at least ${MIN_NOTE_LENGTH} characters.`
    : '';
}

/**
 * Returns errors keyed by field name. An empty object means valid.
 *
 * Keyed by field rather than as a list so the form can put each message under
 * the control it belongs to instead of piling them at the top.
 */
export function validateAdvance(
  draft: AdvanceDraft,
  context: AdvanceContext,
): Record<string, string> {
  const errors: Record<string, string> = {};

  const agreement = context.agreements.find((row) => row.id === draft.agreementId);
  const land = agreement ? context.lands.find((row) => row.id === agreement.landId) : undefined;
  const season = agreement
    ? context.seasons.find((row) => row.id === agreement.seasonId)
    : undefined;

  if (!draft.agreementId) {
    errors['agreementId'] = 'Select the agreement this advance is drawn against.';
  } else if (!agreement) {
    errors['agreementId'] = 'That agreement no longer exists.';
  } else if (agreement.status !== 'active') {
    // Lane 5 deducts an advance from a settlement. An agreement that was never
    // activated has no cycle to settle, so the money could never be recovered.
    errors['agreementId'] =
      `${agreement.reference} is ${agreement.status}; a mid-season advance can only be drawn against an active agreement.`;
  }

  if (!draft.amount || draft.amount <= 0) {
    errors['amount'] = 'Give the advance amount.';
  } else if (!Number.isInteger(draft.amount)) {
    // Agricultural settlements here are not quoted in poisha.
    errors['amount'] = 'Advances are recorded in whole taka.';
  } else if (agreement && land) {
    const available = headroom(land, agreement.id, context.ledger, context.ignoreAdvanceId);
    if (draft.amount > available) {
      const committed = committedAgainst(agreement.id, context.ledger, context.ignoreAdvanceId);
      errors['amount'] =
        `${land.name} carries ৳ ${committed.toLocaleString('en-IN')} already; only ৳ ${available.toLocaleString('en-IN')} of the dadhon ceiling is left.`;
    }
  }

  if (!draft.issuedOn) {
    errors['issuedOn'] = 'Give the date the advance is handed over.';
  } else if (agreement && draft.issuedOn < agreement.startsOn) {
    errors['issuedOn'] =
      `${agreement.reference} starts on ${agreement.startsOn}; a mid-season advance cannot predate it.`;
  } else if (season && draft.issuedOn > season.endsOn) {
    // After the season closes it is not a mid-season advance, it is a debt with
    // no harvest left to recover it from.
    errors['issuedOn'] =
      `${season.name} ends ${season.endsOn}; an advance after that has no harvest left to repay it.`;
  }

  if (draft.note.trim().length < MIN_NOTE_LENGTH) {
    errors['note'] = `Say what the advance is for, in at least ${MIN_NOTE_LENGTH} characters.`;
  }

  return errors;
}

/** The ledger row a request creates. Pending, and with no outstanding balance:
 *  nothing has been handed over until somebody approves it. */
export function advanceForRequest(
  draft: AdvanceDraft,
  agreement: SharecroppingAgreement,
  ids: { id: string; reference: string },
  requestedBy: string,
  requestedOn: string,
): AdvanceLedgerEntry {
  return {
    id: ids.id,
    reference: ids.reference,
    agreementId: agreement.id,
    sharecropperId: agreement.sharecropperId,
    kind: 'mid-season',
    amount: draft.amount,
    outstanding: 0,
    issuedOn: draft.issuedOn,
    note: draft.note.trim(),
    status: 'pending',
    requestedBy,
    requestedOn,
    decidedBy: '',
    decidedOn: '',
    decisionNote: '',
  };
}

/**
 * The approval: the money is handed over, so the balance opens.
 *
 * Returned as a new object rather than mutated — the store holds these, and a
 * mutation would bypass it.
 */
export function disburse(
  entry: AdvanceLedgerEntry,
  decidedBy: string,
  decidedOn: string,
): AdvanceLedgerEntry {
  return {
    ...entry,
    status: 'active',
    outstanding: entry.amount,
    decidedBy,
    decidedOn,
    decisionNote: '',
  };
}

/** The refusal. Nothing else moves, because a pending row never disbursed
 *  anything — the same reason rejecting an agreement releases no plot. */
export function refuse(
  entry: AdvanceLedgerEntry,
  decidedBy: string,
  decidedOn: string,
  note: string,
): AdvanceLedgerEntry {
  return {
    ...entry,
    status: 'rejected',
    outstanding: 0,
    decidedBy,
    decidedOn,
    decisionNote: note.trim(),
  };
}

/** What a repayment of `amount` may not be. */
export function repaymentError(amount: number, entry: AdvanceLedgerEntry): string {
  if (!amount || amount <= 0) {
    return 'Give the amount repaid.';
  }
  if (!Number.isInteger(amount)) {
    return 'Repayments are recorded in whole taka.';
  }
  if (amount > entry.outstanding) {
    return `Only ৳ ${entry.outstanding.toLocaleString('en-IN')} is outstanding on this advance.`;
  }
  return '';
}

/** Deducts a repayment. Clearing the balance closes the row, which is what
 *  gives its share of the dadhon ceiling back to the plot. */
export function applyRepayment(entry: AdvanceLedgerEntry, amount: number): AdvanceLedgerEntry {
  const outstanding = entry.outstanding - amount;
  return {
    ...entry,
    outstanding,
    status: outstanding <= 0 ? 'repaid' : entry.status,
  };
}

/**
 * The inverse. A repayment entered against the wrong row has to be undoable, and
 * reversing it must restore the row exactly — including reopening one that the
 * repayment had closed.
 */
export function reverseRepayment(entry: AdvanceLedgerEntry, amount: number): AdvanceLedgerEntry {
  const outstanding = entry.outstanding + amount;
  return {
    ...entry,
    outstanding,
    status: outstanding > 0 && entry.status === 'repaid' ? 'active' : entry.status,
  };
}
