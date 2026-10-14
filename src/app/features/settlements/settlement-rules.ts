import { SharecroppingAgreement } from '../../core/models/agreement';
import { CultivationCycle, FarmingActivity } from '../../core/models/cultivation';
import { AdvanceLedgerEntry } from '../../core/models/cultivation';
import { Sale } from '../../core/models/harvest';
import { Settlement, SettlementMode, SettlementStatus } from '../../core/models/settlement';

/**
 * Every rule of the Settlements module, as plain functions over plain data. No
 * `inject`, no signals, no store, no Angular import.
 *
 * This is where the whole system meets, and it is the module that finally spends
 * the dadhon ledger: `outstandingAgainst` has existed since Advances was built,
 * but nothing deducted it until here.
 *
 * Every computed figure is stored on the record rather than recomputed on read.
 * The parties agreed to *those* numbers on that day; an edit upstream afterwards
 * must not silently restate a settlement both sides have signed.
 */

export interface SettlementDraft {
  cycleId: string;
  mode: SettlementMode;
  settledOn: string;
  note: string;
}

export interface SettlementContext {
  cycles: CultivationCycle[];
  agreements: SharecroppingAgreement[];
  settlements: Settlement[];
  sales: Sale[];
  activities: FarmingActivity[];
  ledger: AdvanceLedgerEntry[];
}

/** The owner's share of the produce, as a fraction, from the agreement's terms.
 *  An owner-farmed cycle is all theirs. */
export function ownerShareFraction(agreement: SharecroppingAgreement | null): number {
  if (!agreement) {
    return 1;
  }
  return agreement.terms.model === 'tevaga'
    ? 1 / Math.max(agreement.terms.tevagaTotalShares, 1)
    : agreement.terms.ownerHarvestShare / 100;
}

/** Net sale proceeds for a cycle — after haque and transport, which the Sales
 *  module has already taken off. */
export function proceedsFor(cycleId: string, sales: Sale[]): number {
  return sales
    .filter((row) => row.cycleId === cycleId)
    .reduce((total, row) => total + row.netAmount, 0);
}

/** Cultivation costs as they actually fell, read from what was recorded rather
 *  than recomputed from the terms — an activity stores its own split. */
export function costsFor(
  cycleId: string,
  activities: FarmingActivity[],
): { owner: number; sharecropper: number } {
  return activities
    .filter((row) => row.cycleId === cycleId)
    .reduce(
      (totals, row) => ({
        owner: totals.owner + row.ownerShare,
        sharecropper: totals.sharecropper + row.sharecropperShare,
      }),
      { owner: 0, sharecropper: 0 },
    );
}

/** Dadhon still owed on an agreement — the figure this module finally spends. */
export function outstandingAdvance(
  agreementId: string | null,
  ledger: AdvanceLedgerEntry[],
): number {
  if (!agreementId) {
    return 0;
  }
  return ledger
    .filter((row) => row.agreementId === agreementId && row.status === 'active')
    .reduce((total, row) => total + row.outstanding, 0);
}

/**
 * The whole division, in one place.
 *
 * In-kind means the owner has already taken their share as crop, so only the
 * sharecropper's side is paid in cash — the owner's cash proceeds are nil even
 * though their share of the produce is not.
 *
 * The advance is recovered **only** out of the sharecropper's side, and only as
 * far as that side goes: a tenant cannot be pushed into a deeper debt by a
 * settlement that was supposed to clear one. Whatever is left unrecovered stays
 * on the ledger.
 */
export function divide(input: {
  mode: SettlementMode;
  proceeds: number;
  ownerFraction: number;
  outstanding: number;
}): {
  ownerProceeds: number;
  sharecropperProceeds: number;
  advanceDeducted: number;
  netToSharecropper: number;
  advanceRemaining: number;
} {
  const ownerCash = input.mode === 'in-kind' ? 0 : Math.round(input.proceeds * input.ownerFraction);
  const sharecropperProceeds = input.proceeds - ownerCash;

  const advanceDeducted = Math.min(input.outstanding, Math.max(0, sharecropperProceeds));
  return {
    ownerProceeds: ownerCash,
    sharecropperProceeds,
    advanceDeducted,
    netToSharecropper: sharecropperProceeds - advanceDeducted,
    advanceRemaining: input.outstanding - advanceDeducted,
  };
}

export function validateSettlement(
  draft: SettlementDraft,
  context: SettlementContext,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const cycle = context.cycles.find((row) => row.id === draft.cycleId);

  if (!draft.cycleId) {
    errors['cycleId'] = 'Select the cycle to settle.';
  } else if (!cycle) {
    errors['cycleId'] = 'That cycle no longer exists.';
  } else if (
    context.settlements.some((row) => row.cycleId === cycle.id && row.status !== 'draft')
  ) {
    // One settlement per cycle. A second would divide the same money twice.
    errors['cycleId'] = `${cycle.reference} has already been settled.`;
  } else if (cycle.status === 'planned') {
    errors['cycleId'] = `${cycle.reference} has not grown anything yet.`;
  } else if (cycle.status === 'aborted' && draft.mode !== 'partial') {
    // An aborted cycle produced part of a season at best; dividing it as though
    // it ran to term overstates both sides.
    errors['mode'] = `${cycle.reference} was aborted — settle it as a partial season.`;
  }

  if (!draft.settledOn) {
    errors['settledOn'] = 'Give the date of the settlement.';
  } else if (cycle && draft.settledOn < cycle.startedOn) {
    errors['settledOn'] = `${cycle.reference} starts on ${cycle.startedOn}.`;
  }

  if (cycle && draft.mode !== 'partial' && !proceedsFor(cycle.id, context.sales)) {
    // Nothing has been sold, so there is nothing to divide. Partial is the mode
    // that expects an empty season.
    errors['mode'] = 'Nothing has been sold on this cycle — settle it as a partial season.';
  }

  return errors;
}

/** The settlement a valid draft becomes, with every figure resolved and stored. */
export function settlementFromDraft(
  draft: SettlementDraft,
  cycle: CultivationCycle,
  agreement: SharecroppingAgreement | null,
  context: Pick<SettlementContext, 'sales' | 'activities' | 'ledger'>,
  ids: { id: string; reference: string },
  preparedBy: string,
): Settlement {
  const proceeds = proceedsFor(cycle.id, context.sales);
  const costs = costsFor(cycle.id, context.activities);
  const fraction = ownerShareFraction(agreement);
  const outstanding = outstandingAdvance(cycle.agreementId, context.ledger);
  const split = divide({ mode: draft.mode, proceeds, ownerFraction: fraction, outstanding });

  return {
    id: ids.id,
    reference: ids.reference,
    cycleId: cycle.id,
    agreementId: cycle.agreementId,
    mode: draft.mode,
    settledOn: draft.settledOn,
    grossProceeds: proceeds,
    ownerCosts: costs.owner,
    sharecropperCosts: costs.sharecropper,
    ownerSharePercent: Math.round(fraction * 100),
    ownerProceeds: split.ownerProceeds,
    sharecropperProceeds: split.sharecropperProceeds,
    advanceDeducted: split.advanceDeducted,
    netToSharecropper: split.netToSharecropper,
    status: 'draft',
    preparedBy,
    decidedBy: '',
    decidedOn: '',
    note: draft.note.trim(),
  };
}

/** Only a draft may be agreed; only an agreed one may be closed. */
export function canAgree(settlement: Settlement): boolean {
  return settlement.status === 'draft';
}

export function canClose(settlement: Settlement): boolean {
  return settlement.status === 'agreed';
}

export function canDispute(settlement: Settlement): boolean {
  return settlement.status === 'draft' || settlement.status === 'agreed';
}

export function agree(settlement: Settlement, by: string, on: string): Settlement {
  return { ...settlement, status: 'agreed', decidedBy: by, decidedOn: on };
}

export function close(settlement: Settlement): Settlement {
  return { ...settlement, status: 'closed' };
}

export function markDisputed(settlement: Settlement): Settlement {
  return { ...settlement, status: 'disputed' };
}

/** The inverse of a dispute being resolved: the settlement goes back to draft
 *  so the corrected figures can be recomputed, rather than to `agreed` — the
 *  numbers both sides saw are no longer the numbers on the record. */
export function reopenForRecompute(settlement: Settlement): Settlement {
  return { ...settlement, status: 'draft', decidedBy: '', decidedOn: '' };
}

/** How a settlement leaves the dadhon ledger. Deducts from the oldest advance
 *  first, so the longest-standing debt clears first. */
export function applyToLedger(
  ledger: AdvanceLedgerEntry[],
  agreementId: string | null,
  deducted: number,
): AdvanceLedgerEntry[] {
  if (!agreementId || deducted <= 0) {
    return [];
  }
  let left = deducted;
  const touched: AdvanceLedgerEntry[] = [];
  const mine = ledger
    .filter((row) => row.agreementId === agreementId && row.status === 'active')
    .sort((a, b) => a.issuedOn.localeCompare(b.issuedOn));

  for (const row of mine) {
    if (left <= 0) {
      break;
    }
    const take = Math.min(row.outstanding, left);
    const outstanding = row.outstanding - take;
    touched.push({ ...row, outstanding, status: outstanding <= 0 ? 'repaid' : row.status });
    left -= take;
  }
  return touched;
}

export function statusOrder(status: SettlementStatus): number {
  return ['draft', 'disputed', 'agreed', 'closed'].indexOf(status);
}

/** `STL-2025-007` — next in sequence for the year. */
export function nextSettlementReference(settlements: Settlement[], year: number): string {
  const prefix = `STL-${year}-`;
  const highest = settlements
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
