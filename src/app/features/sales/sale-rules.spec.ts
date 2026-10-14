import { describe, expect, it } from 'vitest';
import { Sale, StockLot } from '../../core/models/harvest';
import {
  MAX_HAQUE_PERCENT,
  SaleContext,
  SaleDraft,
  averagePrice,
  grossForCycle,
  netForCycle,
  nextSaleReference,
  saleFromDraft,
  saleTotals,
  suggestedHaque,
  validateSale,
} from './sale-rules';

const lot = (o: Partial<StockLot> = {}): StockLot =>
  ({
    id: 'lot-1',
    reference: 'LOT-2025-001',
    cycleId: 'cyc-2',
    quantity: 64,
    storedOn: '2025-10-25',
    ...o,
  }) as StockLot;

const sale = (o: Partial<Sale> = {}): Sale =>
  ({
    id: 'sal-1',
    reference: 'SAL-2025-001',
    lotId: 'lot-1',
    cycleId: 'cyc-2',
    quantity: 30,
    unitPrice: 1450,
    grossAmount: 43500,
    marketHaque: 870,
    transportCost: 1200,
    netAmount: 41430,
    ...o,
  }) as Sale;

const draft = (o: Partial<SaleDraft> = {}): SaleDraft => ({
  lotId: 'lot-1',
  soldOn: '2025-10-31',
  quantity: 20,
  unitPrice: 1450,
  marketHaque: 580,
  transportCost: 800,
  buyer: 'Boalia Haat — Kashem Beparee',
  note: '',
  ...o,
});

const context = (o: Partial<SaleContext> = {}): SaleContext => ({
  lots: [lot()],
  sales: [],
  ...o,
});

describe('the sale arithmetic', () => {
  it('takes the haque and transport off the gross', () => {
    expect(
      saleTotals({ quantity: 30, unitPrice: 1450, marketHaque: 870, transportCost: 1200 }),
    ).toEqual({ gross: 43500, deductions: 2070, net: 41430 });
  });

  it('suggests the local two percent without imposing it', () => {
    expect(suggestedHaque(43500)).toBe(870);
    expect(suggestedHaque(0)).toBe(0);
  });
});

describe('recording a sale', () => {
  it('accepts a complete draft', () => {
    expect(validateSale(draft(), context())).toEqual({});
  });

  it('refuses selling more than is left in the lot', () => {
    // Otherwise the lot goes negative and the settlement stops reconciling
    // against the harvest.
    const errors = validateSale(draft({ quantity: 40 }), context({ sales: [sale()] }));
    expect(errors['quantity']).toContain('34 maund is left');
  });

  it('does not count the sale being edited against itself', () => {
    expect(
      validateSale(draft({ quantity: 60 }), context({ sales: [sale()], ignoreSaleId: 'sal-1' })),
    ).toEqual({});
  });

  it('needs a lot, a quantity, a price and a buyer', () => {
    expect(validateSale(draft({ lotId: '' }), context())).toHaveProperty('lotId');
    expect(validateSale(draft({ quantity: 0 }), context())).toHaveProperty('quantity');
    expect(validateSale(draft({ unitPrice: 0 }), context())).toHaveProperty('unitPrice');
    expect(validateSale(draft({ buyer: '  ' }), context())).toHaveProperty('buyer');
  });

  it('caps the market haque', () => {
    const errors = validateSale(draft({ marketHaque: 20000 }), context());
    expect(errors['marketHaque']).toContain(String(MAX_HAQUE_PERCENT));
  });

  it('refuses deductions that swallow the sale', () => {
    // Two figures in the wrong fields, not a sale.
    const errors = validateSale(draft({ marketHaque: 0, transportCost: 40000 }), context());
    expect(errors['transportCost']).toContain('swallow');
  });

  it('refuses negatives and a sale before the lot existed', () => {
    expect(validateSale(draft({ marketHaque: -1 }), context())).toHaveProperty('marketHaque');
    expect(validateSale(draft({ transportCost: -1 }), context())).toHaveProperty('transportCost');
    expect(validateSale(draft({ soldOn: '2025-10-01' }), context())).toHaveProperty('soldOn');
  });

  it('carries the cycle from the lot, so a sale traces back to the plot', () => {
    const recorded = saleFromDraft(draft(), lot(), { id: 'sal-9', reference: 'SAL-2025-009' });
    expect(recorded).toMatchObject({
      cycleId: 'cyc-2',
      grossAmount: 29000,
      netAmount: 27620,
    });
  });
});

describe('what a cycle earned', () => {
  it('totals gross and net separately', () => {
    const sales = [
      sale({ id: 'a', grossAmount: 43500, netAmount: 41430 }),
      sale({ id: 'b', grossAmount: 20000, netAmount: 19000 }),
      sale({ id: 'c', cycleId: 'cyc-9', grossAmount: 99999, netAmount: 99999 }),
    ];
    expect(grossForCycle('cyc-2', sales)).toBe(63500);
    expect(netForCycle('cyc-2', sales)).toBe(60430);
  });

  it('reports the average realised price per maund', () => {
    const sales = [
      sale({ id: 'a', quantity: 30, grossAmount: 43500 }),
      sale({ id: 'b', quantity: 10, grossAmount: 13000 }),
    ];
    expect(averagePrice('cyc-2', sales)).toBe(1413);
    expect(averagePrice('cyc-9', sales)).toBe(0);
  });
});

describe('sale reference numbering', () => {
  it('starts at 001 and continues from the highest for that year', () => {
    expect(nextSaleReference([], 2025)).toBe('SAL-2025-001');
    expect(
      nextSaleReference(
        [sale({ reference: 'SAL-2025-004' }), sale({ reference: 'SAL-2026-009' })],
        2025,
      ),
    ).toBe('SAL-2025-005');
  });
});
