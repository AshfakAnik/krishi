import { Land } from '../models/agriculture';
import { AdvanceLedgerEntry } from '../models/cultivation';

/**
 * The dadhon ceiling and the arithmetic over the ledger that enforces it.
 *
 * This lives in `core/rules/` rather than in either feature because **both**
 * modules need it and neither owns it: Sharecropping Agreements caps the advance
 * offered at signing, Advances & Loans caps every mid-season draw on top of it.
 * Two copies of the same ceiling is how the two modules end up disagreeing about
 * the same limit, and the disagreement would only surface at settlement.
 *
 * Pure functions over plain data, like every rules file here — no Angular
 * import, no store, no `inject`.
 */

/** Dadhon ceiling: ৳ 200 per decimal of the plot. A larger advance than the
 *  land can repay is how a tenant ends up bonded, and the settlement path can
 *  never clear it. */
export const ADVANCE_PER_DECIMAL = 200;

/** The total dadhon this plot can carry. */
export function advanceCeiling(land: Land | undefined): number {
  return land ? land.area * ADVANCE_PER_DECIMAL : 0;
}

/** Ledger rows that consume the ceiling. A rejected row was refused and a
 *  repaid one has been cleared, so neither holds any of it — the same exemption
 *  `HOLDING_STATUSES` makes for a plot. */
export const COMMITTING_STATUSES = ['pending', 'active'] as const;

/**
 * What an agreement's tenant owes, or has asked to owe, right now.
 *
 * A pending row counts its full `amount` — it has not been disbursed, so there
 * is no outstanding balance yet, but approving it would create one. An active
 * row counts `outstanding`, not `amount`: a partly repaid advance has already
 * given some of the ceiling back.
 */
export function committedAgainst(
  agreementId: string,
  ledger: AdvanceLedgerEntry[],
  ignoreAdvanceId?: string,
): number {
  return ledger
    .filter((row) => row.agreementId === agreementId && row.id !== ignoreAdvanceId)
    .reduce((total, row) => {
      if (row.status === 'pending') {
        return total + row.amount;
      }
      return row.status === 'active' ? total + row.outstanding : total;
    }, 0);
}

/** What is still drawable against this plot. Never negative: a ledger that has
 *  somehow overrun the ceiling should read as "nothing left", not as a debt the
 *  form could subtract from. */
export function headroom(
  land: Land | undefined,
  agreementId: string,
  ledger: AdvanceLedgerEntry[],
  ignoreAdvanceId?: string,
): number {
  return Math.max(0, advanceCeiling(land) - committedAgainst(agreementId, ledger, ignoreAdvanceId));
}

/** What is still owed on an agreement, ignoring anything not yet disbursed. */
export function outstandingAgainst(agreementId: string, ledger: AdvanceLedgerEntry[]): number {
  return ledger
    .filter((row) => row.agreementId === agreementId && row.status === 'active')
    .reduce((total, row) => total + row.outstanding, 0);
}

/** `ADV-2025-007` — next in sequence for the year, from what already exists. */
export function nextAdvanceReference(ledger: AdvanceLedgerEntry[], year: number): string {
  const prefix = `ADV-${year}-`;
  const highest = ledger
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
