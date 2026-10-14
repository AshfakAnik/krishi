import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { Tone, formatDate, formatTaka } from '../../core/models/common';
import {
  ADVANCE_KIND_LABELS,
  ADVANCE_STATUS_LABELS,
  AdvanceLedgerEntry,
} from '../../core/models/cultivation';
import { SessionService } from '../../core/session';
import {
  advancesFeature,
  agreementsFeature,
  landsFeature,
  partiesFeature,
  seasonsFeature,
} from '../../core/store/features';
import { watchUndoExpiry } from '../../core/store/undo-expiry';
import { Alert } from '../../shared/ui/alert';
import { Column, DataTable } from '../../shared/ui/data-table';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import { AdvanceForm } from './advance-form';
import { advanceTone } from './advance-view';

/** The module's front door: what needs deciding, what is still owed, and the
 *  whole dadhon ledger in one table. */
@Component({
  selector: 'app-advance-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Alert,
    DataTable,
    KpiTile,
    PageHeader,
    SectionCard,
    StatusBadge,
    EmptyState,
    Icon,
    RouterLink,
    AdvanceForm,
  ],
  templateUrl: './advance-list.html',
  styleUrl: './advance-list.css',
})
export class AdvanceList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  protected readonly session = inject(SessionService);

  private readonly all = this.store.selectSignal(advancesFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(advancesFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(advancesFeature.selectors.error);
  protected readonly undoable = this.store.selectSignal(advancesFeature.selectors.undoable);

  protected readonly formOpen = signal(false);

  constructor() {
    // The offer withdraws itself after a while; without this it would sit there
    // until another removal replaced it.
    watchUndoExpiry(advancesFeature);

    // ensureLoaded, not load: the detail page dispatches the same thing and only
    // the first one causes a request.
    for (const feature of [
      advancesFeature,
      agreementsFeature,
      landsFeature,
      partiesFeature,
      seasonsFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  /**
   * A sharecropper sees only their own dadhon; an owner only what is drawn
   * against their land. The administrator sees the whole ledger.
   *
   * The owner filter goes through the agreement rather than the ledger row,
   * because a ledger row names the tenant, not the landlord.
   */
  protected readonly rows = computed(() => {
    const actor = this.session.actor();
    const all = this.all();
    if (!actor || actor.role === 'admin') {
      return all;
    }
    if (actor.role === 'sharecropper') {
      return all.filter((row) => row.sharecropperId === actor.id);
    }
    const mine = new Set(
      this.agreements()
        .filter((row) => row.ownerId === actor.id)
        .map((row) => row.id),
    );
    return all.filter((row) => mine.has(row.agreementId));
  });

  protected readonly pending = computed(() =>
    this.rows().filter((row) => row.status === 'pending'),
  );

  /** Money actually handed over and not yet recovered. */
  protected readonly outstanding = computed(() =>
    this.rows()
      .filter((row) => row.status === 'active')
      .reduce((total, row) => total + row.outstanding, 0),
  );

  /** What approving everything in the queue would add to that. */
  protected readonly requested = computed(() =>
    this.pending().reduce((total, row) => total + row.amount, 0),
  );

  protected readonly repaidCount = computed(
    () => this.rows().filter((row) => row.status === 'repaid').length,
  );

  protected readonly columns: Column<AdvanceLedgerEntry>[] = [
    { key: 'reference', label: 'Reference', mono: true, value: (row) => row.reference },
    { key: 'agreement', label: 'Agreement', value: (row) => this.agreementRef(row.agreementId) },
    { key: 'land', label: 'Land', value: (row) => this.landName(row.agreementId) },
    {
      key: 'sharecropper',
      label: 'Sharecropper',
      value: (row) => this.partyName(row.sharecropperId),
    },
    { key: 'kind', label: 'Kind', value: (row) => ADVANCE_KIND_LABELS[row.kind] },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.amount),
      sortValue: (row) => row.amount,
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.outstanding),
      sortValue: (row) => row.outstanding,
    },
    {
      key: 'status',
      label: 'Status',
      value: (row) => ADVANCE_STATUS_LABELS[row.status],
      badge: (row) => ({
        label: ADVANCE_STATUS_LABELS[row.status],
        tone: advanceTone(row.status),
      }),
    },
  ];

  protected readonly rowLink = (row: AdvanceLedgerEntry): (string | number)[] => [
    '/advances',
    row.id,
  ];

  protected agreementRef(agreementId: string): string {
    return this.agreements().find((row) => row.id === agreementId)?.reference ?? '—';
  }

  protected landName(agreementId: string): string {
    const agreement = this.agreements().find((row) => row.id === agreementId);
    return this.lands().find((row) => row.id === agreement?.landId)?.name ?? '—';
  }

  protected partyName(id: string): string {
    return this.parties().find((party) => party.id === id)?.name ?? '—';
  }

  protected issuedOn(row: AdvanceLedgerEntry): string {
    return formatDate(row.issuedOn);
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected queueTone(): Tone {
    return this.pending().length ? 'warn' : 'ok';
  }

  protected clearError(): void {
    this.store.dispatch(advancesFeature.actions.clearError());
  }

  /** Puts a withdrawn request back — record and database both. An undo is a
   *  write like any other, so it gets an audit row like any other. */
  protected undoWithdraw(): void {
    const row = this.undoable();
    if (!row) {
      return;
    }
    this.store.dispatch(advancesFeature.actions.undoRemove());
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Restored withdrawn advance request',
      moduleName: 'Advances & Loans',
      details: `${row.reference} · ${this.partyName(row.sharecropperId)} · ${this.taka(row.amount)}`,
    });
  }
}
