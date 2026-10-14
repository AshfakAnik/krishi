import { Harvest, ProcessingBatch, Sale, StockLot } from '../../models/harvest';
import { SEASON_ANCHOR, addDays } from '../../models/common';

/**
 * Lane 4's seeded chain, hung off `cyc-2` — the Tevaga cycle at Char Boalia,
 * which is far enough along to have produced something.
 *
 * The chain is complete for one batch and deliberately part-finished for the
 * second, so both the "still running" and the "sold" states are visible without
 * creating data first: HRV-2025-001 dried down from 70 to 64 maund, went into
 * store as a pooled lot, and half of it has been sold; HRV-2025-002 is still on
 * the Pala.
 */

export const HARVESTS: Harvest[] = [
  {
    id: 'hrv-1',
    reference: 'HRV-2025-001',
    cycleId: 'cyc-2',
    harvestedOn: addDays(SEASON_ANCHOR, 128),
    quantity: 70,
    grade: 'a',
    labourCost: 9800,
    batchNo: 1,
    note: 'First cut, the higher half of the plot.',
  },
  {
    id: 'hrv-2',
    reference: 'HRV-2025-002',
    cycleId: 'cyc-2',
    harvestedOn: addDays(SEASON_ANCHOR, 133),
    quantity: 46,
    grade: 'b',
    labourCost: 6200,
    batchNo: 2,
    note: 'Second cut, the low corner — took rain the night before.',
  },
];

export const PROCESSING_BATCHES: ProcessingBatch[] = [
  {
    id: 'bat-1',
    reference: 'PRC-2025-001',
    harvestId: 'hrv-1',
    process: 'drying',
    startedOn: addDays(SEASON_ANCHOR, 129),
    completedOn: addDays(SEASON_ANCHOR, 132),
    inputQuantity: 70,
    outputQuantity: 64,
    status: 'complete',
    note: 'Three days on the yard. Normal moisture loss.',
  },
  {
    id: 'bat-2',
    reference: 'PRC-2025-002',
    harvestId: 'hrv-2',
    process: 'pala',
    startedOn: addDays(SEASON_ANCHOR, 134),
    completedOn: '',
    inputQuantity: 46,
    outputQuantity: 0,
    status: 'running',
    note: 'Stacked wet; threshing once it dries down.',
  },
];

export const STOCK_LOTS: StockLot[] = [
  {
    id: 'lot-1',
    reference: 'LOT-2025-001',
    cycleId: 'cyc-2',
    batchId: 'bat-1',
    grade: 'a',
    heldFor: 'pool',
    quantity: 34,
    location: 'Char Boalia store, north bay',
    storedOn: addDays(SEASON_ANCHOR, 132),
    note: 'Undivided until the settlement runs.',
  },
];

export const SALES: Sale[] = [
  {
    id: 'sal-1',
    reference: 'SAL-2025-001',
    lotId: 'lot-1',
    cycleId: 'cyc-2',
    soldOn: addDays(SEASON_ANCHOR, 138),
    quantity: 30,
    unitPrice: 1450,
    grossAmount: 43500,
    marketHaque: 870,
    transportCost: 1200,
    netAmount: 41430,
    buyer: 'Boalia Haat — Kashem Beparee',
    note: 'Sold off the pooled lot; the split happens at settlement.',
  },
];
