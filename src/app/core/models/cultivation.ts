import { Id } from './common';
import { FarmingType } from './agriculture';

export type CycleStatus = 'planned' | 'ongoing' | 'harvesting' | 'settled' | 'aborted';

export const CYCLE_STATUS_LABELS: Record<CycleStatus, string> = {
  planned: 'Planned',
  ongoing: 'Ongoing',
  harvesting: 'Harvesting',
  settled: 'Settled',
  aborted: 'Aborted / damaged',
};

/**
 * Created when an agreement is activated (sharecropping) or directly by the
 * owner (owner farming). This is the record Lane 3 hangs every activity off, so
 * activating an agreement without one leaves the season with nowhere to happen.
 */
export interface CultivationCycle {
  id: Id;
  reference: string;
  landId: Id;
  seasonId: Id;
  cropId: Id;
  varietyId: Id;
  farmingType: FarmingType;
  /** Null for owner farming. */
  agreementId: Id | null;
  /** Null for owner farming. */
  sharecropperId: Id | null;
  startedOn: string;
  status: CycleStatus;
  /** Maund, from variety yield × land area. Adjusted down by damage in Lane 3. */
  expectedYield: number;
}

export type AdvanceKind = 'signing' | 'mid-season';

export const ADVANCE_KIND_LABELS: Record<AdvanceKind, string> = {
  signing: 'At signing',
  'mid-season': 'Mid-season',
};

/**
 * `pending` → `active` → `repaid` is the happy path. `rejected` is the refusal,
 * and like a rejected agreement it moves nothing else.
 *
 * A signing advance is born `active`: the agreement's own approval already
 * decided it, and asking for a second decision on the same money would let an
 * approver activate an agreement and then refuse the advance it promised.
 */
export type AdvanceStatus = 'pending' | 'active' | 'rejected' | 'repaid';

export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = {
  pending: 'Awaiting approval',
  active: 'Outstanding',
  rejected: 'Rejected',
  repaid: 'Repaid',
};

/**
 * The tenant advance (dadhon) ledger. Every settlement path in Lane 5 deducts
 * the outstanding balance before paying out, so this has to exist from the
 * moment an agreement is activated — not from the moment someone remembers.
 */
export interface AdvanceLedgerEntry {
  id: Id;
  reference: string;
  agreementId: Id;
  sharecropperId: Id;
  kind: AdvanceKind;
  amount: number;
  /** Reduced as repayments and settlements deduct against it. Zero for a row
   *  that was never disbursed — a pending or rejected one. */
  outstanding: number;
  issuedOn: string;
  note: string;

  status: AdvanceStatus;

  requestedBy: string;
  requestedOn: string;

  decidedBy: string;
  decidedOn: string;
  /** Required when refusing; empty otherwise. */
  decisionNote: string;
}

/** What the request form produces — everything the rules need, nothing the
 *  store owns (id, reference, status, decision fields). */
export interface AdvanceDraft {
  agreementId: Id;
  amount: number;
  issuedOn: string;
  note: string;
}

/**
 * Lane 3's crop lifecycle, as stages. The Farming Calendar expands a template of
 * these into dated tasks for a cycle; Crop Monitoring records what was seen at
 * each; Farming Activities records what was done and what it cost.
 */
export type CropStage =
  'land-prep' | 'sowing' | 'vegetative' | 'flowering' | 'ripening' | 'harvest';

export const CROP_STAGE_LABELS: Record<CropStage, string> = {
  'land-prep': 'Land preparation',
  sowing: 'Sowing / transplanting',
  vegetative: 'Vegetative growth',
  flowering: 'Flowering',
  ripening: 'Ripening',
  harvest: 'Harvest',
};

export type TaskStatus = 'due' | 'done' | 'skipped';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  due: 'Due',
  done: 'Done',
  skipped: 'Skipped',
};

/**
 * One scheduled step of a cycle. Generated from a per-crop template so a cycle
 * arrives with its whole season already laid out — a calendar somebody has to
 * fill in by hand is a calendar nobody fills in.
 */
export interface CalendarTask {
  id: Id;
  cycleId: Id;
  stage: CropStage;
  name: string;
  /** Derived from the cycle's start date and the template's day offset. */
  dueOn: string;
  status: TaskStatus;
  /** Set when the task is completed or skipped; empty otherwise. */
  closedOn: string;
  note: string;
}

/**
 * What was actually done in the field, and what it cost.
 *
 * `bearer` is resolved when the activity is recorded, from the agreement's
 * terms — not read live. Terms can be renegotiated, and an expense already
 * incurred must not silently change who owes it.
 */
export type ActivityKind =
  'ploughing' | 'sowing' | 'fertiliser' | 'irrigation' | 'weeding' | 'pesticide' | 'harvest-labour';

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  ploughing: 'Ploughing / land prep',
  sowing: 'Sowing / transplanting',
  fertiliser: 'Fertiliser',
  irrigation: 'Irrigation',
  weeding: 'Weeding',
  pesticide: 'Pesticide',
  'harvest-labour': 'Harvest labour',
};

/** Which responsibility line on the agreement an activity's cost falls under. */
export type CostLine = 'labour' | 'machinery' | 'input' | 'other';

export const COST_LINE_LABELS: Record<CostLine, string> = {
  labour: 'Labour',
  machinery: 'Machinery',
  input: 'Inputs',
  other: 'Other cost',
};

export interface FarmingActivity {
  id: Id;
  reference: string;
  cycleId: Id;
  kind: ActivityKind;
  costLine: CostLine;
  performedOn: string;
  amount: number;
  note: string;
  /** Resolved at record time from the agreement's terms. */
  bearer: 'owner' | 'sharecropper' | 'shared';
  ownerShare: number;
  sharecropperShare: number;
}

/**
 * Lane 3's monitoring branch: what was observed, and what it did to the expected
 * yield. `yieldBefore` and `yieldAfter` are both stored so an adjustment can be
 * read back and reversed without recomputing it from a cycle that has since
 * moved on.
 */
export type ObservationKind = 'ai-scan' | 'field-visit' | 'damage-report';

export const OBSERVATION_KIND_LABELS: Record<ObservationKind, string> = {
  'ai-scan': 'AI scan',
  'field-visit': 'Field visit',
  'damage-report': 'Damage report',
};

export type DamageCause = 'none' | 'flood' | 'drought' | 'pest' | 'disease' | 'storm';

export const DAMAGE_CAUSE_LABELS: Record<DamageCause, string> = {
  none: 'No damage',
  flood: 'Flood',
  drought: 'Drought',
  pest: 'Pest attack',
  disease: 'Disease',
  storm: 'Storm / hail',
};

export interface MonitoringLog {
  id: Id;
  reference: string;
  cycleId: Id;
  observedOn: string;
  kind: ObservationKind;
  stage: CropStage;
  cause: DamageCause;
  /** 0–100. A force-majeure loss is what adjusts the cycle's expected yield. */
  damagePercent: number;
  note: string;
  yieldBefore: number;
  yieldAfter: number;
  observedBy: string;
}
