import { Sale, StockLot } from '../../core/models/harvest';
import { remaining } from '../inventory/stock-rules';

/**
 * Every rule of the Sales module, as plain functions over plain data. No
 * `inject`, no signals, no store, no Angular import.
 *
 * The arithmetic is the module: gross, less the market haque and transport,
 * gives the net — and the net is the figure Lane 5 divides. Getting it wrong
 * here is a settlement that quietly pays the wrong person.
 */

/** The haat's cut, as a percentage of gross. Two percent is local practice;
 *  anything past the cap is a figure somebody mistyped. */
export const DEFAULT_HAQUE_PERCENT = 2;
export const MAX_HAQUE_PERCENT = 10;

export interface SaleDraft {
  lotId: string;
  soldOn: string;
  quantity: number;
  unitPrice: number;
  marketHaque: number;
  transportCost: number;
  buyer: string;
  note: string;
}

export interface SaleContext {
  lots: StockLot[];
  sales: Sale[];
  ignoreSaleId?: string;
}

/** Gross, deductions and net in one place, so no caller recomputes any of it. */
export function saleTotals(draft: {
  quantity: number;
  unitPrice: number;
  marketHaque: number;
  transportCost: number;
}): { gross: number; deductions: number; net: number } {
  const gross = Math.round(draft.quantity * draft.unitPrice);
  const deductions = draft.marketHaque + draft.transportCost;
  return { gross, deductions, net: gross - deductions };
}

/** The haque a gross of this size would normally attract — offered as a default
 *  rather than imposed, because a haat can charge what it likes. */
export function suggestedHaque(gross: number): number {
  return Math.round((gross * DEFAULT_HAQUE_PERCENT) / 100);
}

export function validateSale(draft: SaleDraft, context: SaleContext): Record<string, string> {
  const errors: Record<string, string> = {};
  const lot = context.lots.find((row) => row.id === draft.lotId);

  if (!draft.lotId) {
    errors['lotId'] = 'Select the stock lot being sold from.';
  } else if (!lot) {
    errors['lotId'] = 'That lot no longer exists.';
  }

  if (!draft.quantity || draft.quantity <= 0) {
    errors['quantity'] = 'Give the quantity sold, in maund.';
  } else if (lot) {
    const others = context.sales.filter((row) => row.id !== context.ignoreSaleId);
    const left = remaining(lot, others);
    if (draft.quantity > left) {
      // Selling more than is in store is how a lot goes negative and the
      // settlement stops reconciling against the harvest.
      errors['quantity'] = `Only ${left} maund is left in ${lot.reference}.`;
    }
  }

  if (!draft.unitPrice || draft.unitPrice <= 0) {
    errors['unitPrice'] = 'Give the price per maund.';
  }

  const { gross } = saleTotals(draft);

  if (draft.marketHaque < 0) {
    errors['marketHaque'] = 'Market haque cannot be negative.';
  } else if (gross && (draft.marketHaque / gross) * 100 > MAX_HAQUE_PERCENT) {
    errors['marketHaque'] =
      `${MAX_HAQUE_PERCENT}% of gross is the most this records as haque — check the figure.`;
  }

  if (draft.transportCost < 0) {
    errors['transportCost'] = 'Transport cannot be negative.';
  }

  if (gross && draft.marketHaque + draft.transportCost >= gross) {
    // A sale that costs more to make than it earns is not a sale; it is two
    // figures in the wrong fields.
    errors['transportCost'] = 'Deductions cannot swallow the whole sale.';
  }

  if (!draft.buyer.trim()) {
    errors['buyer'] = 'Say who bought it.';
  }

  if (!draft.soldOn) {
    errors['soldOn'] = 'Give the date of the sale.';
  } else if (lot && draft.soldOn < lot.storedOn) {
    errors['soldOn'] = `${lot.reference} went into store on ${lot.storedOn}.`;
  }

  return errors;
}

export function saleFromDraft(
  draft: SaleDraft,
  lot: StockLot,
  ids: { id: string; reference: string },
): Sale {
  const totals = saleTotals(draft);
  return {
    id: ids.id,
    reference: ids.reference,
    lotId: draft.lotId,
    cycleId: lot.cycleId,
    soldOn: draft.soldOn,
    quantity: draft.quantity,
    unitPrice: draft.unitPrice,
    grossAmount: totals.gross,
    marketHaque: draft.marketHaque,
    transportCost: draft.transportCost,
    netAmount: totals.net,
    buyer: draft.buyer.trim(),
    note: draft.note.trim(),
  };
}

/** What a cycle's produce has actually earned, after every deduction. The
 *  figure Lane 5 divides. */
export function netForCycle(cycleId: string, sales: Sale[]): number {
  return sales
    .filter((row) => row.cycleId === cycleId)
    .reduce((total, row) => total + row.netAmount, 0);
}

export function grossForCycle(cycleId: string, sales: Sale[]): number {
  return sales
    .filter((row) => row.cycleId === cycleId)
    .reduce((total, row) => total + row.grossAmount, 0);
}

/** Average realised price per maund — the number an owner compares between
 *  seasons, and the one a bad sale shows up in. */
export function averagePrice(cycleId: string, sales: Sale[]): number {
  const mine = sales.filter((row) => row.cycleId === cycleId);
  const quantity = mine.reduce((total, row) => total + row.quantity, 0);
  return quantity ? Math.round(grossForCycle(cycleId, sales) / quantity) : 0;
}

/** `SAL-2025-007` — next in sequence for the year. */
export function nextSaleReference(sales: Sale[], year: number): string {
  const prefix = `SAL-${year}-`;
  const highest = sales
    .filter((row) => row.reference.startsWith(prefix))
    .map((row) => Number(row.reference.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
