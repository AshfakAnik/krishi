import { Id } from './common';

/**
 * Lane 4: harvest, post-harvest, storage and sales.
 *
 * The chain is deliberately explicit — a harvest becomes a processing batch,
 * a batch becomes a stock lot, a lot is sold. Each step names the one before it,
 * so the settlement can trace a taka back to the plot it came off.
 */

/** Price grade, set at the harvest and carried through storage to the sale. */
export type QualityGrade = 'a' | 'b' | 'c';

export const GRADE_LABELS: Record<QualityGrade, string> = {
  a: 'Grade A — clean, well filled',
  b: 'Grade B — mixed',
  c: 'Grade C — damp or broken',
};

export const GRADE_SHORT: Record<QualityGrade, string> = { a: 'A', b: 'B', c: 'C' };

export interface Harvest {
  id: Id;
  reference: string;
  cycleId: Id;
  harvestedOn: string;
  /** Maund brought off the field in this batch. */
  quantity: number;
  grade: QualityGrade;
  /** Labour hired for the cutting and carrying. */
  labourCost: number;
  /** Lane 4 asks "More Batch Harvests?" — several batches per cycle is normal,
   *  so this numbers them within the cycle rather than globally. */
  batchNo: number;
  note: string;
}

/**
 * Drying, Pala stacking, threshing, machine processing, jute retting — every
 * step between the field and a storable lot, each of which loses some weight.
 */
export type ProcessKind = 'drying' | 'pala' | 'threshing' | 'machine' | 'retting';

export const PROCESS_LABELS: Record<ProcessKind, string> = {
  drying: 'Sun drying',
  pala: 'Pala stacking',
  threshing: 'Threshing',
  machine: 'Machine processing',
  retting: 'Jute retting',
};

export type BatchStatus = 'running' | 'complete';

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  running: 'In progress',
  complete: 'Complete',
};

export interface ProcessingBatch {
  id: Id;
  reference: string;
  harvestId: Id;
  process: ProcessKind;
  startedOn: string;
  completedOn: string;
  inputQuantity: number;
  /** Set when the batch completes. Input minus output is the wastage. */
  outputQuantity: number;
  status: BatchStatus;
  note: string;
}

/**
 * Stored produce, ready to be sold or split.
 *
 * `heldFor` is what makes an in-kind settlement possible: a pooled lot has not
 * been divided yet, an owner or sharecropper lot has.
 */
export type LotHolder = 'pool' | 'owner' | 'sharecropper';

export const LOT_HOLDER_LABELS: Record<LotHolder, string> = {
  pool: 'Undivided pool',
  owner: "Owner's share",
  sharecropper: "Sharecropper's share",
};

export interface StockLot {
  id: Id;
  reference: string;
  cycleId: Id;
  /** Null for a lot entered directly, without a processing step. */
  batchId: Id | null;
  grade: QualityGrade;
  heldFor: LotHolder;
  /** Maund currently in store. Reduced by sales and by wastage adjustments. */
  quantity: number;
  location: string;
  storedOn: string;
  note: string;
}

/**
 * A sale off a stock lot.
 *
 * Gross is quantity times price. Market haque (the buyer's cut at the haat) and
 * transport come off it to give the net — the figure Lane 5 actually divides.
 */
export interface Sale {
  id: Id;
  reference: string;
  lotId: Id;
  cycleId: Id;
  soldOn: string;
  quantity: number;
  unitPrice: number;
  grossAmount: number;
  marketHaque: number;
  transportCost: number;
  netAmount: number;
  buyer: string;
  note: string;
}
