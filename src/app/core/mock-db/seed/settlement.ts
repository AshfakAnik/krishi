import { SEASON_ANCHOR, addDays } from '../../models/common';
import { Dispute, FinanceEntry, Settlement } from '../../models/settlement';

/**
 * Lane 5's seed. Deliberately thin: cyc-2 has sold produce but is *not* settled,
 * so the walkthrough can run the settlement itself and watch the dadhon come off
 * — which is the one thing this module exists to do.
 *
 * What is seeded is the finished shape for an older cycle, so the closed state
 * and its ledger lines are visible without creating them first.
 */

export const SETTLEMENTS: Settlement[] = [
  {
    id: 'stl-1',
    reference: 'STL-2025-001',
    cycleId: 'cyc-3',
    agreementId: null,
    mode: 'pooled',
    settledOn: addDays(SEASON_ANCHOR, 30),
    grossProceeds: 26400,
    ownerCosts: 8200,
    sharecropperCosts: 0,
    ownerSharePercent: 100,
    ownerProceeds: 26400,
    sharecropperProceeds: 0,
    advanceDeducted: 0,
    netToSharecropper: 0,
    status: 'closed',
    preparedBy: 'Rezaul Karim',
    decidedBy: 'Rezaul Karim',
    decidedOn: addDays(SEASON_ANCHOR, 31),
    note: 'Owner-farmed Aus plot, closed before the Aman season opened.',
  },
];

export const DISPUTES: Dispute[] = [
  {
    id: 'dis-1',
    reference: 'DIS-2025-001',
    settlementId: 'stl-1',
    raisedBy: 'Ashfakul Alam',
    raisedOn: addDays(SEASON_ANCHOR, 30),
    reason: 'The seedbed labour looked as though it had been counted twice.',
    reroute: 'costs',
    status: 'resolved',
    resolvedBy: 'Rezaul Karim',
    resolvedOn: addDays(SEASON_ANCHOR, 31),
    resolution: 'Checked against the activity log — one line, not two. Figures stand.',
  },
];

export const FINANCE_ENTRIES: FinanceEntry[] = [
  {
    id: 'fin-1',
    reference: 'FIN-2025-001',
    kind: 'receivable',
    partyId: 'party-owner-1',
    settlementId: 'stl-1',
    cycleId: 'cyc-3',
    amount: 26400,
    quantity: 0,
    raisedOn: addDays(SEASON_ANCHOR, 31),
    status: 'settled',
    settledOn: addDays(SEASON_ANCHOR, 33),
    note: 'STL-2025-001 · owner-farmed proceeds.',
  },
  {
    id: 'fin-2',
    reference: 'FIN-2025-002',
    kind: 'payable',
    partyId: 'party-sc-1',
    settlementId: null,
    cycleId: 'cyc-1',
    amount: 3200,
    quantity: 0,
    raisedOn: addDays(SEASON_ANCHOR, 44),
    status: 'open',
    settledOn: '',
    note: 'Reimbursement for pesticide bought out of pocket.',
  },
];
