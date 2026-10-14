import { Harvest, ProcessKind, ProcessingBatch, StockLot } from '../../core/models/harvest';

/**
 * Every rule of the Post-Harvest module, as plain functions over plain data. No
 * `inject`, no signals, no store, no Angular import.
 *
 * Every step between the field and a storable lot loses weight, and the loss is
 * the point: an unexplained gap between what was cut and what was sold is how a
 * settlement dispute starts. So a batch stores both its input and its output,
 * and the wastage is derived rather than typed.
 */

/** Sun drying takes roughly a tenth off paddy; retting takes far more off jute.
 *  Past this, the figures are wrong rather than the season being bad. */
export const MAX_WASTAGE_PERCENT = 60;

export interface BatchDraft {
  harvestId: string;
  process: ProcessKind;
  startedOn: string;
  note: string;
}

export interface BatchContext {
  harvests: Harvest[];
  batches: ProcessingBatch[];
}

/** Maund lost in a batch, and as a percentage of what went in. */
export function wastage(batch: ProcessingBatch): number {
  return batch.status === 'complete' ? Math.max(0, batch.inputQuantity - batch.outputQuantity) : 0;
}

export function wastagePercent(batch: ProcessingBatch): number {
  if (batch.status !== 'complete' || !batch.inputQuantity) {
    return 0;
  }
  return Math.round((wastage(batch) / batch.inputQuantity) * 100);
}

/** How much of a harvest has already been put through a process. A second batch
 *  may only take what the first left. */
export function processedFrom(harvestId: string, batches: ProcessingBatch[]): number {
  return batches
    .filter((row) => row.harvestId === harvestId)
    .reduce((total, row) => total + row.inputQuantity, 0);
}

export function unprocessed(harvest: Harvest, batches: ProcessingBatch[]): number {
  return Math.max(0, harvest.quantity - processedFrom(harvest.id, batches));
}

export function validateBatch(draft: BatchDraft, context: BatchContext): Record<string, string> {
  const errors: Record<string, string> = {};
  const harvest = context.harvests.find((row) => row.id === draft.harvestId);

  if (!draft.harvestId) {
    errors['harvestId'] = 'Select the harvest this batch processes.';
  } else if (!harvest) {
    errors['harvestId'] = 'That harvest no longer exists.';
  } else if (unprocessed(harvest, context.batches) <= 0) {
    errors['harvestId'] =
      `${harvest.reference} has already been processed in full — there is nothing left of it.`;
  }

  if (!draft.startedOn) {
    errors['startedOn'] = 'Give the date processing started.';
  } else if (harvest && draft.startedOn < harvest.harvestedOn) {
    errors['startedOn'] =
      `${harvest.reference} was cut on ${harvest.harvestedOn}; processing cannot predate it.`;
  }

  return errors;
}

/** What a completing batch may not be. Kept separate from `validateBatch`
 *  because the output is only known when the batch finishes, not when it opens. */
export function completionError(batch: ProcessingBatch, output: number, on: string): string {
  if (batch.status === 'complete') {
    return 'This batch is already complete.';
  }
  if (output < 0) {
    return 'Output cannot be negative.';
  }
  if (output > batch.inputQuantity) {
    // Weight is lost in processing, never gained. More out than in means the
    // wrong figure, or the wrong batch.
    return `Only ${batch.inputQuantity} maund went in; nothing gains weight in processing.`;
  }
  const lost = batch.inputQuantity - output;
  if (batch.inputQuantity && (lost / batch.inputQuantity) * 100 > MAX_WASTAGE_PERCENT) {
    return `That is more than ${MAX_WASTAGE_PERCENT}% wastage — check the figure.`;
  }
  if (on && on < batch.startedOn) {
    return `This batch started on ${batch.startedOn}; it cannot finish before it began.`;
  }
  return '';
}

export function batchFromDraft(
  draft: BatchDraft,
  harvest: Harvest,
  batches: ProcessingBatch[],
  ids: { id: string; reference: string },
): ProcessingBatch {
  return {
    id: ids.id,
    reference: ids.reference,
    harvestId: draft.harvestId,
    process: draft.process,
    startedOn: draft.startedOn,
    completedOn: '',
    inputQuantity: unprocessed(harvest, batches),
    outputQuantity: 0,
    status: 'running',
    note: draft.note.trim(),
  };
}

export function complete(batch: ProcessingBatch, output: number, on: string): ProcessingBatch {
  return { ...batch, status: 'complete', outputQuantity: output, completedOn: on };
}

/** The inverse, for a batch closed with the wrong figure. Reopening clears both
 *  the output and the date — a running batch carrying either would read as
 *  finished to everything downstream. */
export function reopen(batch: ProcessingBatch): ProcessingBatch {
  return { ...batch, status: 'running', outputQuantity: 0, completedOn: '' };
}

/** The stock lot a completed batch produces. Pooled: nothing is divided until
 *  the settlement runs. */
export function lotFromBatch(
  batch: ProcessingBatch,
  harvest: Harvest,
  ids: { id: string; reference: string },
  location: string,
): StockLot {
  return {
    id: ids.id,
    reference: ids.reference,
    cycleId: harvest.cycleId,
    batchId: batch.id,
    grade: harvest.grade,
    heldFor: 'pool',
    quantity: batch.outputQuantity,
    location: location.trim() || 'Unassigned store',
    storedOn: batch.completedOn,
    note: `From ${batch.reference} · ${harvest.reference}`,
  };
}

/** `PRC-2025-007` — next in sequence for the year. */
export function nextBatchReference(batches: ProcessingBatch[], year: number): string {
  const prefix = `PRC-${year}-`;
  const highest = batches
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
