import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { HttpApiService } from '../../core/http/http-api';
import { Tone, formatDate, formatMaund, formatTaka } from '../../core/models/common';
import {
  FinanceEntry,
  LEDGER_KIND_LABELS,
  LEDGER_STATUS_LABELS,
} from '../../core/models/settlement';
import { SessionService } from '../../core/session';
import {
  financeEntriesFeature,
  partiesFeature,
  settlementsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { StatusBadge } from '../../shared/ui/status-badge';
import { FinanceForm } from './finance-form';
import { isInKind, outstanding } from './finance-rules';

/** Receivables, payables, payments and produce transfers — what a settlement
 *  produced, and what has since been paid. */
@Component({
  selector: 'app-finance-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, Icon, KpiTile, PageHeader, StatusBadge, FinanceForm],
  templateUrl: './finance-list.html',
  styleUrl: './finance-list.css',
})
export class FinanceList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  protected readonly rows = this.store.selectSignal(financeEntriesFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly settlements = this.store.selectSignal(settlementsFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(financeEntriesFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(financeEntriesFeature.selectors.error);
  protected readonly saving = this.store.selectSignal(financeEntriesFeature.selectors.saving);

  protected readonly formOpen = signal(false);
  protected readonly kindLabels = LEDGER_KIND_LABELS;
  protected readonly statusLabels = LEDGER_STATUS_LABELS;

  constructor() {
    for (const feature of [financeEntriesFeature, partiesFeature, settlementsFeature]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly balances = computed(() => outstanding(this.rows()));

  protected readonly openCount = computed(
    () => this.rows().filter((row) => row.status === 'open').length,
  );

  protected partyName(id: string): string {
    return this.parties().find((row) => row.id === id)?.name ?? '—';
  }

  protected settlementRef(row: FinanceEntry): string {
    return row.settlementId
      ? (this.settlements().find((item) => item.id === row.settlementId)?.reference ?? '—')
      : '—';
  }

  /** A transfer moves maund; everything else moves taka. */
  protected valueOf(row: FinanceEntry): string {
    return isInKind(row.kind) ? formatMaund(row.quantity) : formatTaka(row.amount);
  }

  protected kindTone(row: FinanceEntry): Tone {
    switch (row.kind) {
      case 'receivable':
        return 'ok';
      case 'payable':
        return 'warn';
      case 'transfer':
        return 'brand';
      default:
        return 'neutral';
    }
  }

  protected date(iso: string): string {
    return formatDate(iso);
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected mayDecide(): boolean {
    return this.session.canApproveAgreement();
  }

  protected markSettled(row: FinanceEntry): void {
    if (!this.mayDecide() || row.status === 'settled') {
      return;
    }
    this.httpApi.action<FinanceEntry>('financeEntries', row.id, 'settle').subscribe({
      next: (updated) => {
        this.store.dispatch(financeEntriesFeature.actions.upsertSuccess({ item: updated }));
        this.log('Settled ledger entry', updated);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /** The inverse, for a line marked paid in error. */
  protected reopenEntry(row: FinanceEntry): void {
    if (!this.mayDecide() || row.status === 'open') {
      return;
    }
    this.httpApi.action<FinanceEntry>('financeEntries', row.id, 'reopen').subscribe({
      next: (updated) => {
        this.store.dispatch(financeEntriesFeature.actions.upsertSuccess({ item: updated }));
        this.log('Reopened ledger entry', updated);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.store.dispatch(
      financeEntriesFeature.actions.upsertFailure({
        error: err instanceof Error ? err.message : 'Request failed.',
      }),
    );
  }

  protected clearError(): void {
    this.store.dispatch(financeEntriesFeature.actions.clearError());
  }

  private log(action: string, row: FinanceEntry): void {
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action,
      moduleName: 'Finance',
      details: `${row.reference} · ${LEDGER_KIND_LABELS[row.kind]} · ${this.partyName(row.partyId)} · ${this.valueOf(row)}`,
    });
  }
}
