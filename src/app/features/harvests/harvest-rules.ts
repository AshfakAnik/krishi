import { CultivationCycle } from '../../core/models/cultivation';
import { Harvest, QualityGrade } from '../../core/models/harvest';

/**
 * Every rule of the Harvests module, as plain functions over plain data. No
 * `inject`, no signals, no store, no Angular import.
 *
 * Lane 4's front door. The part that is easy to get wrong is the multi-batch
 * question the diagram asks — "More Batch Harvests?" — so batch numbering and
 * the running total against the expected yield both live here.
 */

/** A harvest may beat its estimate, but not by an implausible margin. Anything
 *  past this is a unit slip (maund entered as kilograms, most likely). */
export const YIELD_TOLERANCE = 1.5;

export interface HarvestDraft {
  cycleId: string;
  harvestedOn: string;
  quantity: number;
  grade: QualityGrade;
  labourCost: number;
  note: string;
}

export interface HarvestContext {
  cycles: CultivationCycle[];
  harvests: Harvest[];
  ignoreHarvestId?: string;
}

/** What has already come off this cycle, across every batch. */
export function harvestedSoFar(
  cycleId: string,
  harvests: Harvest[],
  ignoreHarvestId?: string,
): number {
  return harvests
    .filter((row) => row.cycleId === cycleId && row.id !== ignoreHarvestId)
    .reduce((total, row) => total + row.quantity, 0);
}

/** Batches are numbered within their cycle, not globally — "batch 2" means the
 *  second cut off this plot, which is what anybody standing in the field means. */
export function nextBatchNo(cycleId: string, harvests: Harvest[]): number {
  return (
    harvests
      .filter((row) => row.cycleId === cycleId)
      .reduce((max, row) => Math.max(max, row.batchNo), 0) + 1
  );
}

/** How the total compares to what was expected, as a percentage. Over 100 is a
 *  better season than forecast, which happens. */
export function yieldAchieved(cycle: CultivationCycle, harvests: Harvest[]): number {
  if (!cycle.expectedYield) {
    return 0;
  }
  return Math.round((harvestedSoFar(cycle.id, harvests) / cycle.expectedYield) * 100);
}

export function validateHarvest(
  draft: HarvestDraft,
  context: HarvestContext,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const cycle = context.cycles.find((row) => row.id === draft.cycleId);

  if (!draft.cycleId) {
    errors['cycleId'] = 'Select the cycle this came off.';
  } else if (!cycle) {
    errors['cycleId'] = 'That cycle no longer exists.';
  } else if (cycle.status === 'aborted') {
    errors['cycleId'] = `${cycle.reference} was aborted; there is nothing to harvest.`;
  } else if (cycle.status === 'planned') {
    // Nothing has been grown yet. Recording a harvest here means the wrong cycle
    // was picked, which is easy to do when a plot carries one every season.
    errors['cycleId'] = `${cycle.reference} has not started growing yet.`;
  } else if (cycle.status === 'settled') {
    errors['cycleId'] = `${cycle.reference} is settled; its harvest is already divided.`;
  }

  if (!draft.quantity || draft.quantity <= 0) {
    errors['quantity'] = 'Give what came off the field, in maund.';
  } else if (cycle) {
    const total =
      harvestedSoFar(cycle.id, context.harvests, context.ignoreHarvestId) + draft.quantity;
    if (total > cycle.expectedYield * YIELD_TOLERANCE) {
      errors['quantity'] =
        `That would take the cycle to ${Math.round(total)} maund against an expected ${cycle.expectedYield} — check the figure.`;
    }
  }

  if (draft.labourCost < 0) {
    errors['labourCost'] = 'Labour cost cannot be negative.';
  } else if (!Number.isInteger(draft.labourCost)) {
    errors['labourCost'] = 'Costs are recorded in whole taka.';
  }

  if (!draft.harvestedOn) {
    errors['harvestedOn'] = 'Give the date it was cut.';
  } else if (cycle && draft.harvestedOn < cycle.startedOn) {
    errors['harvestedOn'] =
      `${cycle.reference} starts on ${cycle.startedOn}; a harvest cannot predate it.`;
  }

  return errors;
}

export function harvestFromDraft(
  draft: HarvestDraft,
  ids: { id: string; reference: string },
  batchNo: number,
): Harvest {
  return {
    id: ids.id,
    reference: ids.reference,
    cycleId: draft.cycleId,
    harvestedOn: draft.harvestedOn,
    quantity: draft.quantity,
    grade: draft.grade,
    labourCost: draft.labourCost,
    batchNo,
    note: draft.note.trim(),
  };
}

/** `HRV-2025-007` — next in sequence for the year, from what already exists. */
export function nextHarvestReference(harvests: Harvest[], year: number): string {
  const prefix = `HRV-${year}-`;
  const highest = harvests
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
