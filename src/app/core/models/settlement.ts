import { Id } from './common';

/**
 * Lane 5: settlement, financial accounting and reporting.
 *
 * A settlement is the only place the whole system meets: the harvest from Lane
 * 4, the cultivation costs from Lane 3, the negotiated shares from Lane 2 and
 * the dadhon ledger from the Advances module all land in one record. Every
 * figure on it is stored rather than recomputed on read, because the parties
 * agreed to *those* numbers on that day — a later edit upstream must not
 * silently restate a settlement both sides have signed off.
 */

/**
 * The three paths the diagram draws.
 *
 * - `pooled` — everything was sold, and the cash is divided.
 * - `in-kind` — the owner takes their share as crop; only the remainder is cash.
 * - `partial` — the season ended early (a revoked agreement, an aborted cycle),
 *   so only what was actually produced is divided.
 */
export type SettlementMode = 'pooled' | 'in-kind' | 'partial';

export const SETTLEMENT_MODE_LABELS: Record<SettlementMode, string> = {
  pooled: 'Pooled — divide the cash',
  'in-kind': 'In kind — owner takes crop',
  partial: 'Partial season',
};

/** `draft` → `agreed` → `closed` is the happy path. `disputed` is the reroute
 *  Lane 5 draws back into the recomputation. */
export type SettlementStatus = 'draft' | 'agreed' | 'disputed' | 'closed';

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  draft: 'Draft',
  agreed: 'Agreed',
  disputed: 'Disputed',
  closed: 'Closed',
};

export interface Settlement {
  id: Id;
  reference: string;
  cycleId: Id;
  /** Null for an owner-farmed cycle, which settles against nobody. */
  agreementId: Id | null;
  mode: SettlementMode;
  settledOn: string;

  /** Net sale proceeds for the cycle, after haque and transport. */
  grossProceeds: number;
  /** Cultivation costs, as they fell under the agreement's terms. */
  ownerCosts: number;
  sharecropperCosts: number;

  /** The owner's share of the produce, as a percentage, at the time it ran. */
  ownerSharePercent: number;
  ownerProceeds: number;
  sharecropperProceeds: number;

  /** Dadhon recovered out of the sharecropper's side. */
  advanceDeducted: number;
  /** What the sharecropper actually receives once the advance is taken. */
  netToSharecropper: number;

  status: SettlementStatus;
  preparedBy: string;
  decidedBy: string;
  decidedOn: string;
  note: string;
}

/** Where a dispute sends the work back to — the diagram routes each kind of
 *  disagreement to a different recomputation point. */
export type DisputePoint = 'harvest' | 'costs' | 'sales' | 'shares';

export const DISPUTE_POINT_LABELS: Record<DisputePoint, string> = {
  harvest: 'Recount the harvest',
  costs: 'Recheck the cultivation costs',
  sales: 'Recheck the sale figures',
  shares: 'Re-read the agreed shares',
};

export type DisputeStatus = 'open' | 'resolved' | 'withdrawn';

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
};

export interface Dispute {
  id: Id;
  reference: string;
  settlementId: Id;
  raisedBy: string;
  raisedOn: string;
  reason: string;
  reroute: DisputePoint;
  status: DisputeStatus;
  resolvedBy: string;
  resolvedOn: string;
  resolution: string;
}

/**
 * The financial ledger a settlement produces: who owes whom, and what has been
 * paid. Kept separate from the settlement itself so a payment can be recorded
 * without reopening an agreed division.
 */
export type LedgerKind = 'receivable' | 'payable' | 'payment' | 'transfer';

export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  receivable: 'Receivable',
  payable: 'Payable',
  payment: 'Payment',
  transfer: 'Produce transfer',
};

export type LedgerStatus = 'open' | 'settled';

export const LEDGER_STATUS_LABELS: Record<LedgerStatus, string> = {
  open: 'Outstanding',
  settled: 'Settled',
};

export interface FinanceEntry {
  id: Id;
  reference: string;
  kind: LedgerKind;
  partyId: Id;
  /** Null for an entry not tied to one settlement. */
  settlementId: Id | null;
  cycleId: Id | null;
  amount: number;
  /** Maund, for a produce transfer; 0 for a cash line. */
  quantity: number;
  raisedOn: string;
  status: LedgerStatus;
  settledOn: string;
  note: string;
}
