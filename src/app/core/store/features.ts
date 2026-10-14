import { SharecroppingAgreement } from '../models/agreement';
import { Crop, CropVariety, Land, Party, Season } from '../models/agriculture';
import {
  AdvanceLedgerEntry,
  CalendarTask,
  CultivationCycle,
  FarmingActivity,
  MonitoringLog,
} from '../models/cultivation';
import { Harvest, ProcessingBatch, Sale, StockLot } from '../models/harvest';
import { Dispute, FinanceEntry, Settlement } from '../models/settlement';
import { AuditLogRow } from '../audit-log';
import { createCollectionFeature } from './collection-feature';

/**
 * One feature per collection, declared centrally so no module invents its own.
 * Registration is per route (`provideCollection`), so the state tree only grows
 * as far as the user navigates.
 */

export const seasonsFeature = createCollectionFeature<Season>({
  name: 'seasons',
  collection: 'seasons',
  sortComparer: (a, b) => a.startsOn.localeCompare(b.startsOn),
});

export const landsFeature = createCollectionFeature<Land>({
  name: 'lands',
  collection: 'lands',
  sortComparer: (a, b) => a.code.localeCompare(b.code),
});

export const cropsFeature = createCollectionFeature<Crop>({
  name: 'crops',
  collection: 'crops',
  sortComparer: (a, b) => a.name.localeCompare(b.name),
});

export const cropVarietiesFeature = createCollectionFeature<CropVariety>({
  name: 'cropVarieties',
  collection: 'cropVarieties',
  sortComparer: (a, b) => a.name.localeCompare(b.name),
});

export const partiesFeature = createCollectionFeature<Party>({
  name: 'parties',
  collection: 'parties',
  sortComparer: (a, b) => a.name.localeCompare(b.name),
});

export const agreementsFeature = createCollectionFeature<SharecroppingAgreement>({
  name: 'agreements',
  collection: 'agreements',
  // Newest submission first — the approval queue is the page's reason to exist.
  sortComparer: (a, b) => b.submittedOn.localeCompare(a.submittedOn),
});

export const cultivationCyclesFeature = createCollectionFeature<CultivationCycle>({
  name: 'cultivationCycles',
  collection: 'cultivationCycles',
  sortComparer: (a, b) => b.startedOn.localeCompare(a.startedOn),
});

export const advancesFeature = createCollectionFeature<AdvanceLedgerEntry>({
  name: 'advances',
  collection: 'advances',
  sortComparer: (a, b) => b.issuedOn.localeCompare(a.issuedOn),
});

export const auditLogsFeature = createCollectionFeature<AuditLogRow>({
  name: 'auditLogs',
  collection: 'auditLogs',
  sortComparer: (a, b) => b.timestamp.localeCompare(a.timestamp),
});

export const calendarTasksFeature = createCollectionFeature<CalendarTask>({
  name: 'calendarTasks',
  collection: 'calendarTasks',
  // Soonest first: a calendar is read forwards, unlike a ledger.
  sortComparer: (a, b) => a.dueOn.localeCompare(b.dueOn),
});

export const farmingActivitiesFeature = createCollectionFeature<FarmingActivity>({
  name: 'farmingActivities',
  collection: 'farmingActivities',
  sortComparer: (a, b) => b.performedOn.localeCompare(a.performedOn),
});

export const monitoringLogsFeature = createCollectionFeature<MonitoringLog>({
  name: 'monitoringLogs',
  collection: 'monitoringLogs',
  sortComparer: (a, b) => b.observedOn.localeCompare(a.observedOn),
});

export const harvestsFeature = createCollectionFeature<Harvest>({
  name: 'harvests',
  collection: 'harvests',
  sortComparer: (a, b) => b.harvestedOn.localeCompare(a.harvestedOn),
});

export const processingBatchesFeature = createCollectionFeature<ProcessingBatch>({
  name: 'processingBatches',
  collection: 'processingBatches',
  sortComparer: (a, b) => b.startedOn.localeCompare(a.startedOn),
});

export const stockLotsFeature = createCollectionFeature<StockLot>({
  name: 'stockLots',
  collection: 'stockLots',
  sortComparer: (a, b) => b.storedOn.localeCompare(a.storedOn),
});

export const salesFeature = createCollectionFeature<Sale>({
  name: 'sales',
  collection: 'sales',
  sortComparer: (a, b) => b.soldOn.localeCompare(a.soldOn),
});

export const settlementsFeature = createCollectionFeature<Settlement>({
  name: 'settlements',
  collection: 'settlements',
  sortComparer: (a, b) => b.settledOn.localeCompare(a.settledOn),
});

export const disputesFeature = createCollectionFeature<Dispute>({
  name: 'disputes',
  collection: 'disputes',
  sortComparer: (a, b) => b.raisedOn.localeCompare(a.raisedOn),
});

export const financeEntriesFeature = createCollectionFeature<FinanceEntry>({
  name: 'financeEntries',
  collection: 'financeEntries',
  sortComparer: (a, b) => b.raisedOn.localeCompare(a.raisedOn),
});
