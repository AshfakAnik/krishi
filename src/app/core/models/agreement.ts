import { Id } from './common';
import { SettlementMode, SharecroppingModel } from './agriculture';

/**
 * Who carries a given cost line. Lane 2 configures one of these per
 * responsibility (cost, labour, machinery, inputs), Lane 3 reads them back when
 * an activity records an expense.
 */
export type ResponsibleParty = 'owner' | 'sharecropper' | 'shared';

export const RESPONSIBLE_LABELS: Record<ResponsibleParty, string> = {
  owner: 'Owner bears',
  sharecropper: 'Sharecropper bears',
  shared: 'Shared',
};

/**
 * `draft` → `pending` → `active` is the happy path. `rejected` returns to the
 * rule-configuration step; `revoked` is the inverse of activation and is what
 * frees the land again.
 */
export type AgreementStatus = 'draft' | 'pending' | 'active' | 'rejected' | 'revoked';

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  draft: 'Draft',
  pending: 'Awaiting approval',
  active: 'Active',
  rejected: 'Rejected',
  revoked: 'Revoked',
};

/** The negotiated terms. Split out from the record so the rules file can
 *  validate a form's draft before any agreement exists. */
export interface AgreementTerms {
  model: SharecroppingModel;

  /** Normal model: percentage of the harvest the owner receives, 0–100. The
   *  sharecropper receives the remainder — storing both invites them to drift
   *  apart. */
  ownerHarvestShare: number;

  /** Normal model: who carries each cost line. */
  costResponsibility: ResponsibleParty;
  labourResponsibility: ResponsibleParty;
  machineryResponsibility: ResponsibleParty;
  inputResponsibility: ResponsibleParty;

  /** Normal model: selling expenses (market haque, transport) deducted from
   *  gross sales before the share is computed. */
  deductSaleExpenses: boolean;

  /** Tevaga model: owner takes 1 share of this many. Traditionally 3. */
  tevagaTotalShares: number;

  /** Tevaga model: crop or its cash equivalent. */
  settlementMode: SettlementMode;
}

export interface SharecroppingAgreement {
  id: Id;
  reference: string;
  landId: Id;
  seasonId: Id;
  cropId: Id;
  varietyId: Id;
  sharecropperId: Id;
  ownerId: Id;

  terms: AgreementTerms;

  /** Advance (dadhon) handed to the tenant at signing. 0 means none. Recorded
   *  as a ledger row on activation, and deducted at settlement. */
  advanceAmount: number;

  startsOn: string;
  status: AgreementStatus;

  submittedBy: string;
  submittedOn: string;

  decidedBy: string;
  decidedOn: string;
  /** Required when rejecting or revoking; empty otherwise. */
  decisionNote: string;

  /** Set on activation, cleared on revoke. The link to Lane 3. */
  cultivationCycleId: Id | null;
}

/** What the write form produces — everything the rules need, nothing the store
 *  owns (id, status, audit fields). */
export interface AgreementDraft {
  landId: Id;
  seasonId: Id;
  cropId: Id;
  varietyId: Id;
  sharecropperId: Id;
  terms: AgreementTerms;
  advanceAmount: number;
  startsOn: string;
}
