import { Injectable, inject } from '@angular/core';
import { Observable, from } from 'rxjs';
import { ApiService } from '../api-service';
import { SessionClock } from '../clock';
import { nextAdvanceReference } from '../rules/dadhon';
import { CollectionKey } from '../mock-db/mock-db';
import { CropVariety, Land, Party } from '../models/agriculture';
import { SharecroppingAgreement } from '../models/agreement';
import { AdvanceLedgerEntry, CalendarTask, CultivationCycle, MonitoringLog } from '../models/cultivation';
import { Harvest, ProcessingBatch, Sale, StockLot } from '../models/harvest';
import { Dispute, FinanceEntry, Settlement } from '../models/settlement';
import { SessionService } from '../session';
import * as agreements from '../../features/agreements/agreement-rules';
import * as advances from '../../features/advances/advance-rules';
import * as calendar from '../../features/calendar/calendar-rules';
import * as cycles from '../../features/cycles/cycle-rules';
import * as disputes from '../../features/disputes/dispute-rules';
import * as finance from '../../features/finance/finance-rules';
import * as monitoring from '../../features/monitoring/monitoring-rules';
import * as batches from '../../features/post-harvest/process-rules';
import * as stock from '../../features/inventory/stock-rules';
import * as settlements from '../../features/settlements/settlement-rules';
import { LocalDb } from './local-db';

interface HasId {
  id: string;
}

type Body = Record<string, unknown>;

/**
 * The offline stand-in for the Spring backend. Reads and writes go to SQLite
 * through `LocalDb`; the decision endpoints (`POST /{collection}/{id}/{verb}`)
 * are re-created here from the same pure rules files the screens use.
 *
 * Every row is stored in the frontend's own format, so none of the
 * enum conversion `HttpApiService` does for the wire is needed here.
 */
@Injectable({ providedIn: 'root' })
export class OfflineApiService implements ApiService {
  private readonly db = inject(LocalDb);
  private readonly clock = inject(SessionClock);
  private readonly session = inject(SessionService);

  list<T extends HasId>(collection: CollectionKey): Observable<T[]> {
    return from(this.db.all<T>(collection));
  }

  get<T extends HasId>(collection: CollectionKey, id: string): Observable<T> {
    return from(this.require<T>(collection, id));
  }

  create<T extends HasId>(collection: CollectionKey, row: T): Observable<T> {
    return from(this.createRow(collection, row));
  }

  update<T extends HasId>(collection: CollectionKey, row: T): Observable<T> {
    return from(
      (async () => {
        await this.require(collection, row.id);
        await this.db.put(collection, row);
        return row;
      })(),
    );
  }

  putMany<T extends HasId>(collection: CollectionKey, rows: T[]): Observable<T[]> {
    return from(
      (async () => {
        const saved: T[] = [];
        for (const row of rows) {
          const exists = await this.db.one(collection, row.id);
          saved.push(exists ? await this.save(collection, row) : await this.createRow(collection, row));
        }
        return saved;
      })(),
    );
  }

  remove(collection: CollectionKey, id: string): Observable<string> {
    return from(this.db.remove(collection, id).then(() => id));
  }

  action<T>(collection: CollectionKey, id: string, verb: string, body: unknown = {}): Observable<T> {
    return from(this.runAction(collection, id, verb, (body ?? {}) as Body) as Promise<T>);
  }

  splitStockLot(id: string): Observable<{ owner: StockLot; sharecropper: StockLot }> {
    return from(this.runSplit(id));
  }

  // ---------------------------------------------------------------- writes

  private async save<T extends HasId>(collection: CollectionKey, row: T): Promise<T> {
    await this.db.put(collection, row);
    return row;
  }

  /** Server-side effects of a create. Only the observation log has one: a
   *  logged loss lowers the cycle's expected yield. */
  private async createRow<T extends HasId>(collection: CollectionKey, row: T): Promise<T> {
    await this.db.put(collection, row);
    if (collection === 'monitoringLogs') {
      const log = row as unknown as MonitoringLog;
      const cycle = await this.db.one<CultivationCycle>('cultivationCycles', log.cycleId);
      if (cycle && log.yieldAfter !== log.yieldBefore) {
        await this.db.put('cultivationCycles', monitoring.applyObservation(cycle, log));
      }
    }
    return row;
  }

  private async require<T extends HasId>(collection: CollectionKey, id: string): Promise<T> {
    const found = await this.db.one<T>(collection, id);
    if (!found) {
      throw new Error(`${collection}/${id} not found`);
    }
    return found;
  }

  // --------------------------------------------------------------- actions

  private actorId(): string {
    return this.session.actor()?.id ?? 'unknown';
  }

  private async runAction(collection: CollectionKey, id: string, verb: string, body: Body): Promise<HasId> {
    const key = `${collection}.${verb}`;
    const today = this.clock.today();
    const by = this.actorId();
    const note = String(body['note'] ?? '').trim();

    switch (key) {
      case 'parties.approve':
      case 'parties.reject': {
        const party = await this.require<Party>('parties', id);
        return this.save('parties', { ...party, status: verb === 'approve' ? 'active' : 'rejected' });
      }

      case 'agreements.approve':
        return this.approveAgreement(id, by, today);
      case 'agreements.reject': {
        const agreement = await this.require<SharecroppingAgreement>('agreements', id);
        this.assertPending(agreement);
        return this.save('agreements', {
          ...agreement,
          status: 'rejected',
          decidedBy: by,
          decidedOn: today,
          decisionNote: note,
        });
      }
      case 'agreements.revoke':
        return this.revokeAgreement(id, by, today, note);

      case 'advances.approve': {
        const entry = await this.require<AdvanceLedgerEntry>('advances', id);
        if (!advances.canDecideAdvance(entry)) {
          throw new Error('Only a pending advance can be decided.');
        }
        return this.save('advances', {
          ...entry,
          status: 'active',
          outstanding: entry.amount,
          issuedOn: today,
          decidedBy: by,
          decidedOn: today,
        });
      }
      case 'advances.reject': {
        const entry = await this.require<AdvanceLedgerEntry>('advances', id);
        if (!advances.canDecideAdvance(entry)) {
          throw new Error('Only a pending advance can be decided.');
        }
        return this.save('advances', {
          ...entry,
          status: 'rejected',
          outstanding: 0,
          decidedBy: by,
          decidedOn: today,
          decisionNote: note,
        });
      }
      case 'advances.repay': {
        const entry = await this.require<AdvanceLedgerEntry>('advances', id);
        const amount = Number(body['amount'] ?? 0);
        const problem = advances.repaymentError(amount, entry);
        if (problem) {
          throw new Error(problem);
        }
        return this.save('advances', advances.applyRepayment(entry, amount));
      }

      case 'cultivationCycles.advance': {
        const cycle = await this.require<CultivationCycle>('cultivationCycles', id);
        if (!cycles.canAdvance(cycle)) {
          throw new Error('This cycle cannot move to the next stage.');
        }
        return this.save('cultivationCycles', cycles.advance(cycle));
      }
      case 'cultivationCycles.abort': {
        const cycle = await this.require<CultivationCycle>('cultivationCycles', id);
        if (!cycles.canAbort(cycle)) {
          throw new Error('This cycle can no longer be aborted.');
        }
        await this.releaseLand(cycle.landId, cycle.id);
        return this.save('cultivationCycles', cycles.abort(cycle));
      }

      case 'calendarTasks.complete':
      case 'calendarTasks.skip': {
        const task = await this.require<CalendarTask>('calendarTasks', id);
        const on = String(body['on'] ?? today);
        const text = String(body['note'] ?? '');
        return this.save('calendarTasks', verb === 'complete' ? calendar.complete(task, on, text) : calendar.skip(task, on, text));
      }
      case 'calendarTasks.reopen':
        return this.save('calendarTasks', calendar.reopen(await this.require<CalendarTask>('calendarTasks', id)));

      case 'monitoringLogs.revert': {
        const log = await this.require<MonitoringLog>('monitoringLogs', id);
        const cycle = await this.require<CultivationCycle>('cultivationCycles', log.cycleId);
        if (!monitoring.isLatestAdjustment(log, cycle)) {
          throw new Error('Only the latest adjustment on a cycle can be reverted.');
        }
        await this.save('cultivationCycles', monitoring.revertObservation(cycle, log));
        return log;
      }

      case 'processingBatches.complete':
        return this.completeBatch(id, Number(body['output'] ?? 0), String(body['completedOn'] ?? today), String(body['location'] ?? ''));
      case 'processingBatches.reopen':
        return this.reopenBatch(id);

      case 'stockLots.adjust': {
        const lot = await this.require<StockLot>('stockLots', id);
        const amount = Number(body['amount'] ?? 0);
        const problem = stock.adjustmentError(lot, amount, await this.db.all<Sale>('sales'));
        if (problem) {
          throw new Error(problem);
        }
        return this.save('stockLots', stock.applyAdjustment(lot, amount));
      }

      case 'settlements.agree': {
        const settlement = await this.require<Settlement>('settlements', id);
        if (!settlements.canAgree(settlement)) {
          throw new Error('This settlement is not waiting for agreement.');
        }
        return this.save('settlements', settlements.agree(settlement, by, today));
      }
      case 'settlements.close': {
        const settlement = await this.require<Settlement>('settlements', id);
        if (!settlements.canClose(settlement)) {
          throw new Error('This settlement cannot be closed yet.');
        }
        return this.save('settlements', settlements.close(settlement));
      }

      case 'disputes.resolve': {
        const dispute = await this.require<Dispute>('disputes', id);
        const text = String(body['resolution'] ?? '');
        const problem = disputes.resolutionError(text);
        if (problem) {
          throw new Error(problem);
        }
        return this.save('disputes', disputes.resolve(dispute, by, today, text.trim()));
      }
      case 'disputes.withdraw':
        return this.save('disputes', disputes.withdraw(await this.require<Dispute>('disputes', id), by, today));

      case 'financeEntries.settle':
        return this.save('financeEntries', finance.settle(await this.require<FinanceEntry>('financeEntries', id), today));
      case 'financeEntries.reopen':
        return this.save('financeEntries', finance.reopen(await this.require<FinanceEntry>('financeEntries', id)));

      default:
        throw new Error(`"${verb}" is not available offline for ${collection}.`);
    }
  }

  private assertPending(agreement: SharecroppingAgreement): void {
    if (!agreements.canDecide(agreement)) {
      throw new Error('Only a pending agreement can be decided.');
    }
  }

  /** Claims the plot, opens the cultivation cycle and disburses the signing
   *  advance — the three things `AgreementService.approve()` does at once. */
  private async approveAgreement(id: string, by: string, today: string): Promise<SharecroppingAgreement> {
    const agreement = await this.require<SharecroppingAgreement>('agreements', id);
    this.assertPending(agreement);

    const land = await this.require<Land>('lands', agreement.landId);
    if (land.heldByAgreementId && land.heldByAgreementId !== agreement.id) {
      throw new Error('This plot is already held by another agreement or cycle.');
    }
    const variety = await this.require<CropVariety>('cropVarieties', agreement.varietyId);

    const allCycles = await this.db.all<CultivationCycle>('cultivationCycles');
    const cycle = agreements.cycleForAgreement(agreement, land, variety, {
      id: `cyc-${Date.now().toString(36)}`,
      reference: cycles.nextCycleReference(allCycles, this.clock.year()),
    });

    const approved: SharecroppingAgreement = {
      ...agreement,
      status: 'active',
      decidedBy: by,
      decidedOn: today,
      decisionNote: '',
      cultivationCycleId: cycle.id,
    };

    const ledger = await this.db.all<AdvanceLedgerEntry>('advances');
    const advance = agreements.advanceForAgreement(approved, {
      id: `adv-${Date.now().toString(36)}`,
      reference: nextAdvanceReference(ledger, this.clock.year()),
    });

    await this.db.put('lands', agreements.claimLand(land, agreement.id));
    await this.db.put('cultivationCycles', cycle);
    if (advance) {
      await this.db.put('advances', advance);
    }
    return this.save('agreements', approved);
  }

  private async revokeAgreement(id: string, by: string, today: string, note: string): Promise<SharecroppingAgreement> {
    const agreement = await this.require<SharecroppingAgreement>('agreements', id);
    if (agreement.status !== 'active') {
      throw new Error('Only an active agreement can be revoked.');
    }
    await this.releaseLand(agreement.landId, agreement.id);
    if (agreement.cultivationCycleId) {
      const cycle = await this.db.one<CultivationCycle>('cultivationCycles', agreement.cultivationCycleId);
      if (cycle && cycles.canAbort(cycle)) {
        await this.db.put('cultivationCycles', cycles.abort(cycle));
      }
    }
    return this.save('agreements', {
      ...agreement,
      status: 'revoked',
      decidedBy: by,
      decidedOn: today,
      decisionNote: note,
      cultivationCycleId: null,
    });
  }

  /** Releases the plot only if this id is what holds it. */
  private async releaseLand(landId: string, heldBy: string): Promise<void> {
    const land = await this.db.one<Land>('lands', landId);
    if (land) {
      await this.db.put('lands', agreements.releaseLand(land, heldBy));
    }
  }

  /** Closing a batch files its output as a pooled stock lot. */
  private async completeBatch(id: string, output: number, on: string, location: string): Promise<ProcessingBatch> {
    const batch = await this.require<ProcessingBatch>('processingBatches', id);
    const problem = batches.completionError(batch, output, on);
    if (problem) {
      throw new Error(problem);
    }
    const closed = batches.complete(batch, output, on);
    const harvest = await this.require<Harvest>('harvests', batch.harvestId);
    const lots = await this.db.all<StockLot>('stockLots');
    const lot = batches.lotFromBatch(
      closed,
      harvest,
      { id: `lot-${Date.now().toString(36)}`, reference: stock.nextLotReference(lots, this.clock.year()) },
      location,
    );
    await this.db.put('stockLots', lot);
    return this.save('processingBatches', closed);
  }

  private async reopenBatch(id: string): Promise<ProcessingBatch> {
    const batch = await this.require<ProcessingBatch>('processingBatches', id);
    const lots = (await this.db.all<StockLot>('stockLots')).filter((lot) => lot.batchId === id);
    if (lots.length) {
      const sold = (await this.db.all<Sale>('sales')).some((sale) => lots.some((lot) => lot.id === sale.lotId));
      if (sold) {
        throw new Error('Sales already exist against this batch’s stock, so it cannot be reopened.');
      }
      for (const lot of lots) {
        await this.db.remove('stockLots', lot.id);
      }
    }
    return this.save('processingBatches', batches.reopen(batch));
  }

  /** Divides a pooled lot into the owner's and the sharecropper's share. */
  private async runSplit(id: string): Promise<{ owner: StockLot; sharecropper: StockLot }> {
    const lot = await this.require<StockLot>('stockLots', id);
    const cycle = await this.require<CultivationCycle>('cultivationCycles', lot.cycleId);
    const agreement = cycle.agreementId
      ? await this.db.one<SharecroppingAgreement>('agreements', cycle.agreementId)
      : undefined;
    if (!agreement) {
      throw new Error(`${lot.reference}: this produce came off an owner-farmed cycle — there is nothing to divide.`);
    }
    if (lot.heldFor !== 'pool') {
      throw new Error(`${lot.reference} has already been divided.`);
    }
    const all = await this.db.all<StockLot>('stockLots');
    const year = this.clock.year();
    const split = stock.splitLot(lot, settlements.ownerShareFraction(agreement), {
      ownerId: `lot-${Date.now().toString(36)}-o`,
      ownerReference: stock.nextLotReference(all, year, 0),
      tenantId: `lot-${Date.now().toString(36)}-s`,
      tenantReference: stock.nextLotReference(all, year, 1),
    });
    await this.db.remove('stockLots', lot.id);
    await this.db.put('stockLots', split.owner);
    await this.db.put('stockLots', split.sharecropper);
    return split;
  }
}
