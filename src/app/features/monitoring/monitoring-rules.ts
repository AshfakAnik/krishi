import {
  CropStage,
  CultivationCycle,
  DamageCause,
  MonitoringLog,
  ObservationKind,
} from '../../core/models/cultivation';

/**
 * Every rule of the Crop Monitoring module, as plain functions over plain data.
 * No `inject`, no signals, no store, no Angular import.
 *
 * The module's job is Lane 3's force-majeure branch: an observation that records
 * damage adjusts the cycle's expected yield, which is the number every harvest
 * and settlement figure downstream is derived from. Because it moves that
 * number, the adjustment has to be reversible — hence `yieldBefore` and
 * `yieldAfter` are both stored rather than recomputed.
 */

/** Total loss is a real outcome — a flooded plot yields nothing. */
export const MAX_DAMAGE_PERCENT = 100;

export interface ObservationDraft {
  cycleId: string;
  kind: ObservationKind;
  stage: CropStage;
  cause: DamageCause;
  damagePercent: number;
  observedOn: string;
  note: string;
}

export interface ObservationContext {
  cycles: CultivationCycle[];
}

/** The yield left after taking a percentage off. Rounded to whole maund, which
 *  is how the crop is measured and settled. */
export function yieldAfterDamage(current: number, damagePercent: number): number {
  const kept = current * (1 - damagePercent / 100);
  return Math.max(0, Math.round(kept));
}

/** An observation that records no loss must not touch the yield — a routine
 *  scan is not a reason to move a number the settlement depends on. */
export function adjusts(draft: { cause: DamageCause; damagePercent: number }): boolean {
  return draft.cause !== 'none' && draft.damagePercent > 0;
}

export function validateObservation(
  draft: ObservationDraft,
  context: ObservationContext,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const cycle = context.cycles.find((row) => row.id === draft.cycleId);

  if (!draft.cycleId) {
    errors['cycleId'] = 'Select the cycle observed.';
  } else if (!cycle) {
    errors['cycleId'] = 'That cycle no longer exists.';
  } else if (cycle.status === 'settled') {
    // The settlement has already used the expected yield; moving it now would
    // contradict a figure both parties have agreed.
    errors['cycleId'] = `${cycle.reference} is settled; its yield is already final.`;
  } else if (cycle.status === 'aborted') {
    errors['cycleId'] = `${cycle.reference} was aborted; there is nothing left to observe.`;
  }

  if (!draft.observedOn) {
    errors['observedOn'] = 'Give the date of the observation.';
  } else if (cycle && draft.observedOn < cycle.startedOn) {
    errors['observedOn'] =
      `${cycle.reference} starts on ${cycle.startedOn}; an observation cannot predate it.`;
  }

  if (draft.damagePercent < 0 || draft.damagePercent > MAX_DAMAGE_PERCENT) {
    errors['damagePercent'] = `Damage runs from 0 to ${MAX_DAMAGE_PERCENT} percent.`;
  } else if (draft.cause === 'none' && draft.damagePercent > 0) {
    // Otherwise a yield would drop with nothing on the record explaining it.
    errors['cause'] = 'Give the cause of the damage.';
  } else if (
    draft.cause !== 'none' &&
    draft.damagePercent === 0 &&
    draft.kind === 'damage-report'
  ) {
    errors['damagePercent'] = 'A damage report with no loss is a field visit — say how much.';
  }

  if (draft.note.trim().length < 5) {
    errors['note'] = 'Say briefly what was seen.';
  }

  return errors;
}

/** The log a valid draft becomes, carrying both yields so the adjustment can be
 *  read back and reversed. */
export function observationFromDraft(
  draft: ObservationDraft,
  cycle: CultivationCycle,
  ids: { id: string; reference: string },
  observedBy: string,
): MonitoringLog {
  const yieldBefore = cycle.expectedYield;
  const yieldAfter = adjusts(draft)
    ? yieldAfterDamage(yieldBefore, draft.damagePercent)
    : yieldBefore;
  return {
    id: ids.id,
    reference: ids.reference,
    cycleId: cycle.id,
    observedOn: draft.observedOn,
    kind: draft.kind,
    stage: draft.stage,
    cause: draft.cause,
    damagePercent: draft.damagePercent,
    note: draft.note.trim(),
    yieldBefore,
    yieldAfter,
    observedBy,
  };
}

/** The cycle as this observation leaves it. */
export function applyObservation(cycle: CultivationCycle, log: MonitoringLog): CultivationCycle {
  return { ...cycle, expectedYield: log.yieldAfter };
}

/**
 * The inverse. Reverting puts back exactly the yield the observation found,
 * rather than recomputing it — a later observation may have moved the number
 * again, and recomputing would compound two adjustments into one.
 */
export function revertObservation(cycle: CultivationCycle, log: MonitoringLog): CultivationCycle {
  return { ...cycle, expectedYield: log.yieldBefore };
}

/** True only for the observation currently accounting for the cycle's yield.
 *  Reverting an older one would silently undo everything after it. */
export function isLatestAdjustment(log: MonitoringLog, cycle: CultivationCycle): boolean {
  return log.yieldAfter !== log.yieldBefore && cycle.expectedYield === log.yieldAfter;
}

/** Total loss recorded against a cycle, as a percentage of where it started. */
export function cumulativeLoss(cycle: CultivationCycle, logs: MonitoringLog[]): number {
  const mine = logs.filter((row) => row.cycleId === cycle.id && row.yieldAfter !== row.yieldBefore);
  if (!mine.length) {
    return 0;
  }
  const original = mine.reduce((max, row) => Math.max(max, row.yieldBefore), cycle.expectedYield);
  return original ? Math.round(((original - cycle.expectedYield) / original) * 100) : 0;
}

/** `OBS-2025-007` — next in sequence for the year, from what already exists. */
export function nextObservationReference(logs: MonitoringLog[], year: number): string {
  const prefix = `OBS-${year}-`;
  const highest = logs
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
