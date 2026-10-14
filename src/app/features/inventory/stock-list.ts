import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { HttpApiService } from '../../core/http/http-api';
import { Tone, formatDate, formatMaund } from '../../core/models/common';
import { GRADE_SHORT, LOT_HOLDER_LABELS, StockLot } from '../../core/models/harvest';
import { SessionService } from '../../core/session';
import {
  agreementsFeature,
  cultivationCyclesFeature,
  salesFeature,
  stockLotsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { StatusBadge } from '../../shared/ui/status-badge';
import { LotForm } from './lot-form';
import { adjustmentError, remaining, stockByHolder } from './stock-rules';

/**
 * What is in store, and whose it is.
 *
 * Two actions live here: a wastage adjustment, and the in-kind split that turns
 * a pooled lot into an owner lot and a sharecropper lot. The split is the half
 * of Lane 5 that pays in crop rather than cash.
 */
@Component({
  selector: 'app-stock-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, Icon, KpiTile, PageHeader, StatusBadge, LotForm],
  templateUrl: './stock-list.html',
  styleUrl: './stock-list.css',
})
export class StockList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  private readonly all = this.store.selectSignal(stockLotsFeature.selectors.all);
  private readonly sales = this.store.selectSignal(salesFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(stockLotsFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(stockLotsFeature.selectors.error);
  protected readonly saving = this.store.selectSignal(stockLotsFeature.selectors.saving);

  protected readonly formOpen = signal(false);
  protected readonly actionError = signal('');
  protected readonly holderLabels = LOT_HOLDER_LABELS;

  private readonly adjustments = signal<Record<string, number>>({});

  constructor() {
    for (const feature of [
      stockLotsFeature,
      salesFeature,
      cultivationCyclesFeature,
      agreementsFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly rows = computed(() => this.all());

  protected readonly totals = computed(() => stockByHolder(this.rows()));

  protected readonly totalStock = computed(() =>
    this.rows().reduce((total, row) => total + row.quantity, 0),
  );

  protected adjustmentFor(lot: StockLot): number {
    return this.adjustments()[lot.id] ?? 0;
  }

  protected onAdjustment(lot: StockLot, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.adjustments.update((current) => ({ ...current, [lot.id]: value }));
  }

  protected left(lot: StockLot): number {
    return remaining(lot, this.sales());
  }

  protected cycleRef(lot: StockLot): string {
    return this.cycles().find((row) => row.id === lot.cycleId)?.reference ?? '—';
  }

  protected gradeLabel(lot: StockLot): string {
    return `Grade ${GRADE_SHORT[lot.grade]}`;
  }

  protected holderTone(lot: StockLot): Tone {
    switch (lot.heldFor) {
      case 'owner':
        return 'ok';
      case 'sharecropper':
        return 'brand';
      default:
        return 'warn';
    }
  }

  protected date(iso: string): string {
    return formatDate(iso);
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  /** A pooled lot is the only kind there is anything to divide. */
  protected splittable(lot: StockLot): boolean {
    return lot.heldFor === 'pool' && lot.quantity > 0 && this.session.canApproveAgreement();
  }

  protected recordLoss(lot: StockLot): void {
    const amount = this.adjustmentFor(lot);
    const problem = adjustmentError(lot, amount, this.sales());
    if (problem) {
      this.actionError.set(`${lot.reference}: ${problem}`);
      return;
    }
    this.actionError.set('');
    this.httpApi.action<StockLot>('stockLots', lot.id, 'adjust', { amount }).subscribe({
      next: (updated) => {
        this.store.dispatch(stockLotsFeature.actions.upsertSuccess({ item: updated }));
        this.audit.record({
          actorRole: this.session.role() ?? 'unknown',
          actorName: this.session.actorName(),
          action: 'Adjusted stock for wastage',
          moduleName: 'Storage & Inventory',
          details: `${lot.reference} · ${formatMaund(amount)} written off · ${formatMaund(updated.quantity)} left`,
        });
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /**
   * Splits a pooled lot into the two shares.
   *
   * The owner's fraction comes from the agreement governing the cycle — a
   * Tevaga agreement gives one share of N, a Normal one the negotiated
   * percentage — but `StockLotService.split()` resolves that itself from
   * `lot.cycle.agreement` server-side, so the request carries no body.
   */
  protected split(lot: StockLot): void {
    if (!this.splittable(lot)) {
      return;
    }
    const cycle = this.cycles().find((row) => row.id === lot.cycleId);
    const agreement = this.agreements().find((row) => row.id === cycle?.agreementId);
    if (!agreement) {
      this.actionError.set(
        `${lot.reference}: this produce came off an owner-farmed cycle — there is nothing to divide.`,
      );
      return;
    }
    this.actionError.set('');

    this.httpApi.splitStockLot(lot.id).subscribe({
      next: ({ owner, sharecropper }) => {
        // The pool is consumed by the split server-side and the two new
        // lots created — reload rather than patch the store by hand.
        this.store.dispatch(stockLotsFeature.actions.load());
        this.audit.record({
          actorRole: this.session.role() ?? 'unknown',
          actorName: this.session.actorName(),
          action: 'Split pooled stock in kind',
          moduleName: 'Storage & Inventory',
          details: `${lot.reference} · ${agreement.reference} · owner ${formatMaund(owner.quantity)}, sharecropper ${formatMaund(sharecropper.quantity)}`,
        });
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.store.dispatch(
      stockLotsFeature.actions.upsertFailure({
        error: err instanceof Error ? err.message : 'Request failed.',
      }),
    );
  }

  protected clearError(): void {
    this.store.dispatch(stockLotsFeature.actions.clearError());
  }
}
