import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { HttpApiService } from '../../core/http/http-api';
import { Tone, formatDate, formatTaka } from '../../core/models/common';
import {
  SETTLEMENT_MODE_LABELS,
  SETTLEMENT_STATUS_LABELS,
  Settlement,
} from '../../core/models/settlement';
import { SessionService } from '../../core/session';
import {
  advancesFeature,
  agreementsFeature,
  cultivationCyclesFeature,
  disputesFeature,
  financeEntriesFeature,
  partiesFeature,
  settlementsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { StatusBadge } from '../../shared/ui/status-badge';
import { SettlementForm } from './settlement-form';
import { canAgree, canClose } from './settlement-rules';

/**
 * Every settlement, and the two decisions that move one along.
 *
 * Agreeing is the moment the money actually moves: it spends the dadhon ledger —
 * the first thing in the app to do so — and raises the finance lines that say
 * who is owed what.
 */
@Component({
  selector: 'app-settlement-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, Icon, KpiTile, PageHeader, StatusBadge, SettlementForm],
  templateUrl: './settlement-list.html',
  styleUrl: './settlement-list.css',
})
export class SettlementList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  protected readonly rows = this.store.selectSignal(settlementsFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly disputes = this.store.selectSignal(disputesFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(settlementsFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(settlementsFeature.selectors.error);
  protected readonly saving = this.store.selectSignal(settlementsFeature.selectors.saving);

  protected readonly formOpen = signal(false);
  protected readonly modeLabels = SETTLEMENT_MODE_LABELS;
  protected readonly statusLabels = SETTLEMENT_STATUS_LABELS;

  constructor() {
    for (const feature of [
      settlementsFeature,
      cultivationCyclesFeature,
      agreementsFeature,
      advancesFeature,
      financeEntriesFeature,
      disputesFeature,
      partiesFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly openCount = computed(
    () => this.rows().filter((row) => row.status === 'draft').length,
  );

  protected readonly disputedCount = computed(
    () => this.rows().filter((row) => row.status === 'disputed').length,
  );

  protected readonly dadhonRecovered = computed(() =>
    this.rows()
      .filter((row) => row.status !== 'draft')
      .reduce((total, row) => total + row.advanceDeducted, 0),
  );

  protected readonly paidOut = computed(() =>
    this.rows()
      .filter((row) => row.status !== 'draft')
      .reduce((total, row) => total + row.netToSharecropper, 0),
  );

  protected cycleRef(row: Settlement): string {
    return this.cycles().find((item) => item.id === row.cycleId)?.reference ?? '—';
  }

  protected statusTone(row: Settlement): Tone {
    switch (row.status) {
      case 'closed':
        return 'ok';
      case 'agreed':
        return 'brand';
      case 'disputed':
        return 'bad';
      default:
        return 'warn';
    }
  }

  protected agreeable(row: Settlement): boolean {
    return canAgree(row) && this.session.canApproveAgreement();
  }

  protected closeable(row: Settlement): boolean {
    return canClose(row) && this.session.canApproveAgreement();
  }

  protected date(iso: string): string {
    return formatDate(iso);
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  /**
   * `SettlementService.agree()` now does all three steps server-side, in one
   * transaction: the record, the dadhon ledger deduction, and the finance
   * lines. None of that comes back in the response, so `advances` and
   * `financeEntries` are reloaded to pick up what changed.
   */
  protected agreeSettlement(row: Settlement): void {
    if (!this.agreeable(row)) {
      return;
    }

    this.httpApi.action<Settlement>('settlements', row.id, 'agree').subscribe({
      next: (agreed) => {
        this.store.dispatch(settlementsFeature.actions.upsertSuccess({ item: agreed }));
        this.store.dispatch(advancesFeature.actions.load());
        this.store.dispatch(financeEntriesFeature.actions.load());
        this.audit.record({
          actorRole: this.session.role() ?? 'unknown',
          actorName: this.session.actorName(),
          action: 'Agreed settlement',
          moduleName: 'Settlements',
          details: `${agreed.reference} · ${this.cycleRef(agreed)} · ${formatTaka(agreed.advanceDeducted)} dadhon recovered · ${formatTaka(agreed.netToSharecropper)} due to the sharecropper`,
        });
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected closeSettlement(row: Settlement): void {
    if (!this.closeable(row)) {
      return;
    }
    this.httpApi.action<Settlement>('settlements', row.id, 'close').subscribe({
      next: (closed) => {
        this.store.dispatch(settlementsFeature.actions.upsertSuccess({ item: closed }));
        this.audit.record({
          actorRole: this.session.role() ?? 'unknown',
          actorName: this.session.actorName(),
          action: 'Closed settlement',
          moduleName: 'Settlements',
          details: `${closed.reference} · ${this.cycleRef(closed)}`,
        });
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.store.dispatch(
      settlementsFeature.actions.upsertFailure({
        error: err instanceof Error ? err.message : 'Request failed.',
      }),
    );
  }

  protected openDisputes(row: Settlement): number {
    return this.disputes().filter((item) => item.settlementId === row.id && item.status === 'open')
      .length;
  }

  protected partyName(id: string | null): string {
    return this.parties().find((row) => row.id === id)?.name ?? '—';
  }

  protected clearError(): void {
    this.store.dispatch(settlementsFeature.actions.clearError());
  }
}
