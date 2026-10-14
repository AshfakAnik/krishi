import { ResponsibleParty, SharecroppingAgreement } from '../../core/models/agreement';
import {
  ActivityKind,
  CostLine,
  CultivationCycle,
  FarmingActivity,
} from '../../core/models/cultivation';

/**
 * Every rule of the Farming Activities module, as plain functions over plain
 * data. No `inject`, no signals, no store, no Angular import.
 *
 * The substance of this module is `costResponsibilityFor`: Lane 3's "Determine
 * Cost Responsibility" step, which reads the agreement's negotiated terms rather
 * than asking whoever is recording the expense.
 */

export interface ActivityDraft {
  cycleId: string;
  kind: ActivityKind;
  costLine: CostLine;
  performedOn: string;
  amount: number;
  note: string;
}

export interface ActivityContext {
  cycles: CultivationCycle[];
  agreements: SharecroppingAgreement[];
  ignoreActivityId?: string;
}

/**
 * Who carries this cost line, from the agreement that governs the cycle.
 *
 * Three cases, and the order matters:
 *
 * 1. **No agreement** — an owner-farming cycle. The owner bears everything;
 *    there is nobody else to bear it.
 * 2. **Tevaga** — the sharecropper bears the entire cultivation cost. That is
 *    what distinguishes the model, so it is read before the per-line terms,
 *    which under Tevaga are not meaningful.
 * 3. **Normal** — the negotiated per-line responsibility.
 */
export function costResponsibilityFor(
  costLine: CostLine,
  agreement: SharecroppingAgreement | null | undefined,
): ResponsibleParty {
  if (!agreement) {
    return 'owner';
  }
  if (agreement.terms.model === 'tevaga') {
    return 'sharecropper';
  }
  switch (costLine) {
    case 'labour':
      return agreement.terms.labourResponsibility;
    case 'machinery':
      return agreement.terms.machineryResponsibility;
    case 'input':
      return agreement.terms.inputResponsibility;
    default:
      return agreement.terms.costResponsibility;
  }
}

/**
 * Splits an amount between the parties.
 *
 * A shared cost is halved with the **owner** taking the rounding, so the two
 * shares always add back to the total — splitting 1,801 into two 900s loses a
 * taka that the settlement would later fail to reconcile.
 */
export function splitCost(
  amount: number,
  bearer: ResponsibleParty,
): { ownerShare: number; sharecropperShare: number } {
  if (bearer === 'owner') {
    return { ownerShare: amount, sharecropperShare: 0 };
  }
  if (bearer === 'sharecropper') {
    return { ownerShare: 0, sharecropperShare: amount };
  }
  const sharecropperShare = Math.floor(amount / 2);
  return { ownerShare: amount - sharecropperShare, sharecropperShare };
}

export function validateActivity(
  draft: ActivityDraft,
  context: ActivityContext,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const cycle = context.cycles.find((row) => row.id === draft.cycleId);

  if (!draft.cycleId) {
    errors['cycleId'] = 'Select the cycle this was done on.';
  } else if (!cycle) {
    errors['cycleId'] = 'That cycle no longer exists.';
  } else if (cycle.status === 'aborted') {
    errors['cycleId'] = `${cycle.reference} was aborted; nothing more can be spent on it.`;
  } else if (cycle.status === 'settled') {
    // The settlement has already divided the costs. A late expense would change
    // a figure both parties have agreed.
    errors['cycleId'] = `${cycle.reference} is settled; its costs are already divided.`;
  }

  if (!draft.amount || draft.amount <= 0) {
    errors['amount'] = 'Give what it cost.';
  } else if (!Number.isInteger(draft.amount)) {
    errors['amount'] = 'Costs are recorded in whole taka.';
  }

  if (!draft.performedOn) {
    errors['performedOn'] = 'Give the date the work was done.';
  } else if (cycle && draft.performedOn < cycle.startedOn) {
    errors['performedOn'] =
      `${cycle.reference} starts on ${cycle.startedOn}; work cannot predate it.`;
  }

  if (draft.note.trim().length < 5) {
    errors['note'] = 'Say briefly what was done.';
  }

  return errors;
}

/** The activity a valid draft becomes, with the split resolved **now** rather
 *  than read live: terms can be renegotiated, and an expense already incurred
 *  must not silently change who owes it. */
export function activityFromDraft(
  draft: ActivityDraft,
  agreement: SharecroppingAgreement | null,
  ids: { id: string; reference: string },
): FarmingActivity {
  const bearer = costResponsibilityFor(draft.costLine, agreement);
  const split = splitCost(draft.amount, bearer);
  return {
    id: ids.id,
    reference: ids.reference,
    cycleId: draft.cycleId,
    kind: draft.kind,
    costLine: draft.costLine,
    performedOn: draft.performedOn,
    amount: draft.amount,
    note: draft.note.trim(),
    bearer,
    ownerShare: split.ownerShare,
    sharecropperShare: split.sharecropperShare,
  };
}

/** What a cycle has cost, and who is carrying it. The figure Lane 5 settles. */
export function costTotals(activities: FarmingActivity[]): {
  total: number;
  owner: number;
  sharecropper: number;
} {
  return activities.reduce(
    (totals, row) => ({
      total: totals.total + row.amount,
      owner: totals.owner + row.ownerShare,
      sharecropper: totals.sharecropper + row.sharecropperShare,
    }),
    { total: 0, owner: 0, sharecropper: 0 },
  );
}

/** `ACT-2025-007` — next in sequence for the year, from what already exists. */
export function nextActivityReference(activities: FarmingActivity[], year: number): string {
  const prefix = `ACT-${year}-`;
  const highest = activities
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
