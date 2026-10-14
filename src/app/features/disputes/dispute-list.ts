import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { HttpApiService } from '../../core/http/http-api';
import { Tone, formatDate } from '../../core/models/common';
import { DISPUTE_POINT_LABELS, DISPUTE_STATUS_LABELS, Dispute } from '../../core/models/settlement';
import { SessionService } from '../../core/session';
import { disputesFeature, settlementsFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import { DisputeForm } from './dispute-form';
import { REROUTE_TARGETS, resolutionError } from './dispute-rules';

/**
 * Disputes, each carrying the reroute that says where the work goes back to.
 *
 * Resolving one sends its settlement back to **draft** rather than to agreed:
 * the numbers both parties saw are no longer the numbers on the record, so they
 * have to be recomputed and re-agreed.
 */
@Component({
  selector: 'app-dispute-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Alert,
    EmptyState,
    Icon,
    KpiTile,
    PageHeader,
    SectionCard,
    StatusBadge,
    RouterLink,
    DisputeForm,
  ],
  templateUrl: './dispute-list.html',
  styleUrl: './dispute-list.css',
})
export class DisputeList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  protected readonly rows = this.store.selectSignal(disputesFeature.selectors.all);
  private readonly settlements = this.store.selectSignal(settlementsFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(disputesFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(disputesFeature.selectors.error);
  protected readonly saving = this.store.selectSignal(disputesFeature.selectors.saving);

  protected readonly formOpen = signal(false);
  protected readonly actionError = signal('');
  protected readonly pointLabels = DISPUTE_POINT_LABELS;
  protected readonly statusLabels = DISPUTE_STATUS_LABELS;

  private readonly resolutions = signal<Record<string, string>>({});

  constructor() {
    for (const feature of [disputesFeature, settlementsFeature]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly open = computed(() => this.rows().filter((row) => row.status === 'open'));

  protected readonly settled = computed(() => this.rows().filter((row) => row.status !== 'open'));

  protected resolutionFor(row: Dispute): string {
    return this.resolutions()[row.id] ?? '';
  }

  protected onResolution(row: Dispute, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.resolutions.update((current) => ({ ...current, [row.id]: value }));
  }

  protected settlementRef(row: Dispute): string {
    return this.settlements().find((item) => item.id === row.settlementId)?.reference ?? '—';
  }

  protected target(row: Dispute): { path: string; label: string } {
    return REROUTE_TARGETS[row.reroute];
  }

  protected statusTone(row: Dispute): Tone {
    switch (row.status) {
      case 'resolved':
        return 'ok';
      case 'withdrawn':
        return 'neutral';
      default:
        return 'bad';
    }
  }

  protected date(iso: string): string {
    return formatDate(iso);
  }

  protected mayDecide(): boolean {
    return this.session.canApproveAgreement();
  }

  /**
   * Resolving sends the settlement back to draft for recomputation —
   * `DisputeService.resolve()` does that server-side, in the same
   * transaction, so `settlements` is reloaded to pick it up rather than
   * recomputed here (there's no PUT on `settlements` to apply it with
   * anyway).
   */
  protected resolveDispute(row: Dispute): void {
    const text = this.resolutionFor(row);
    const problem = resolutionError(text);
    if (problem) {
      this.actionError.set(`${row.reference}: ${problem}`);
      return;
    }
    this.actionError.set('');

    this.httpApi.action<Dispute>('disputes', row.id, 'resolve', { resolution: text }).subscribe({
      next: (resolved) => {
        this.store.dispatch(disputesFeature.actions.upsertSuccess({ item: resolved }));
        this.store.dispatch(settlementsFeature.actions.load());
        this.audit.record({
          actorRole: this.session.role() ?? 'unknown',
          actorName: this.session.actorName(),
          action: 'Resolved dispute',
          moduleName: 'Disputes',
          details: `${row.reference} · ${this.settlementRef(row)} · sent back to ${this.target(row).label} for recomputation`,
        });
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /** Withdrawing leaves the settlement exactly as it was — nothing was found
   *  to be wrong with it. `DisputeService.withdraw()` still reverts a
   *  disputed settlement to `agreed` unconditionally, server-side (a faithful
   *  port of this same quirk); reload rather than recompute it here. */
  protected withdrawDispute(row: Dispute): void {
    this.httpApi.action<Dispute>('disputes', row.id, 'withdraw').subscribe({
      next: (withdrawn) => {
        this.store.dispatch(disputesFeature.actions.upsertSuccess({ item: withdrawn }));
        this.store.dispatch(settlementsFeature.actions.load());
        this.audit.record({
          actorRole: this.session.role() ?? 'unknown',
          actorName: this.session.actorName(),
          action: 'Withdrew dispute',
          moduleName: 'Disputes',
          details: `${row.reference} · ${this.settlementRef(row)} · figures stand`,
        });
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /** The settlement is already marked disputed server-side by the time
   *  `DisputeForm` emits this (see its `submit()`) — just refresh it. */
  protected onRaised(settlementId: string): void {
    if (this.settlements().some((item) => item.id === settlementId)) {
      this.store.dispatch(settlementsFeature.actions.load());
    }
  }

  private fail(err: unknown): void {
    this.store.dispatch(
      disputesFeature.actions.upsertFailure({
        error: err instanceof Error ? err.message : 'Request failed.',
      }),
    );
  }

  protected clearError(): void {
    this.store.dispatch(disputesFeature.actions.clearError());
  }
}
