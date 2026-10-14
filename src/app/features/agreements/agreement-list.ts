import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SharecroppingAgreement } from '../../core/models/agreement';
import { AGREEMENT_STATUS_LABELS } from '../../core/models/agreement';
import { MODEL_LABELS } from '../../core/models/agriculture';
import { Tone, formatDate, formatTaka } from '../../core/models/common';
import { SessionService } from '../../core/session';
import {
  advancesFeature,
  agreementsFeature,
  cropVarietiesFeature,
  cropsFeature,
  landsFeature,
  partiesFeature,
  seasonsFeature,
} from '../../core/store/features';
import { watchUndoExpiry } from '../../core/store/undo-expiry';
import { Alert } from '../../shared/ui/alert';
import { Column, DataTable } from '../../shared/ui/data-table';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { AgreementForm } from './agreement-form';
import { agreementTone } from './agreement-view';

/** The module's front door: what needs deciding, what is live, and everything
 *  else in one table. */
@Component({
  selector: 'app-agreement-list',
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
    AgreementForm,
  ],
  templateUrl: './agreement-list.html',
  styleUrl: './agreement-list.css',
})
export class AgreementList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  protected readonly session = inject(SessionService);

  private readonly all = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);
  private readonly advances = this.store.selectSignal(advancesFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(agreementsFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(agreementsFeature.selectors.error);

  /** The draft the detail page just discarded, until it is put back or another
   *  removal replaces it. Null the rest of the time. */
  protected readonly undoable = this.store.selectSignal(agreementsFeature.selectors.undoable);

  protected readonly formOpen = signal(false);

  constructor() {
    // The offer withdraws itself after a while; without this it would sit there
    // until another removal replaced it.
    watchUndoExpiry(agreementsFeature);

    // ensureLoaded, not load: the detail page dispatches the same thing and only
    // the first one causes a request.
    for (const feature of [
      agreementsFeature,
      landsFeature,
      cropsFeature,
      cropVarietiesFeature,
      partiesFeature,
      seasonsFeature,
      advancesFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  /** A sharecropper sees only their own agreements; an owner only their land's.
   *  The administrator sees everything. */
  protected readonly rows = computed(() => {
    const actor = this.session.actor();
    const all = this.all();
    if (!actor || actor.role === 'admin') {
      return all;
    }
    return actor.role === 'sharecropper'
      ? all.filter((row) => row.sharecropperId === actor.id)
      : all.filter((row) => row.ownerId === actor.id);
  });

  protected readonly pending = computed(() =>
    this.rows().filter((row) => row.status === 'pending'),
  );

  protected readonly activeCount = computed(
    () => this.rows().filter((row) => row.status === 'active').length,
  );

  protected readonly committedArea = computed(() => {
    const activeIds = new Set(
      this.rows()
        .filter((row) => row.status === 'active')
        .map((row) => row.landId),
    );
    return this.lands()
      .filter((land) => activeIds.has(land.id))
      .reduce((total, land) => total + land.area, 0);
  });

  protected readonly outstandingAdvance = computed(() => {
    const mine = new Set(this.rows().map((row) => row.id));
    return this.advances()
      .filter((entry) => mine.has(entry.agreementId))
      .reduce((total, entry) => total + entry.outstanding, 0);
  });

  protected readonly columns: Column<SharecroppingAgreement>[] = [
    { key: 'reference', label: 'Reference', mono: true, value: (row) => row.reference },
    { key: 'land', label: 'Land', value: (row) => this.landName(row.landId) },
    {
      key: 'sharecropper',
      label: 'Sharecropper',
      value: (row) => this.partyName(row.sharecropperId),
    },
    { key: 'model', label: 'Model', value: (row) => MODEL_LABELS[row.terms.model] },
    { key: 'season', label: 'Season', value: (row) => this.seasonName(row.seasonId) },
    {
      key: 'advance',
      label: 'Advance',
      align: 'right',
      mono: true,
      value: (row) => formatTaka(row.advanceAmount),
      sortValue: (row) => row.advanceAmount,
    },
    {
      key: 'status',
      label: 'Status',
      value: (row) => AGREEMENT_STATUS_LABELS[row.status],
      badge: (row) => ({
        label: AGREEMENT_STATUS_LABELS[row.status],
        tone: agreementTone(row.status),
      }),
    },
  ];

  protected readonly rowLink = (row: SharecroppingAgreement): (string | number)[] => [
    '/agreements',
    row.id,
  ];

  protected landName(id: string): string {
    return this.lands().find((land) => land.id === id)?.name ?? '—';
  }

  protected partyName(id: string): string {
    return this.parties().find((party) => party.id === id)?.name ?? '—';
  }

  protected seasonName(id: string): string {
    return this.seasons().find((season) => season.id === id)?.name ?? '—';
  }

  protected submittedOn(row: SharecroppingAgreement): string {
    return formatDate(row.submittedOn);
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected queueTone(): Tone {
    return this.pending().length ? 'warn' : 'ok';
  }

  protected clearError(): void {
    // The slice keeps the last write failure until something clears it; the
    // dismiss button is that something. `clearError`, not `upsertFailure` with an
    // empty message: that action now rolls an optimistic write back.
    this.store.dispatch(agreementsFeature.actions.clearError());
  }

  /** Puts the discarded draft back — record and database both. An undo is a
   *  write like any other, so it gets an audit row like any other. */
  protected undoDiscard(): void {
    const row = this.undoable();
    if (!row) {
      return;
    }
    this.store.dispatch(agreementsFeature.actions.undoRemove());
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Restored discarded draft agreement',
      moduleName: 'Sharecropping Agreements',
      details: `${row.reference} · ${this.partyName(row.sharecropperId)} · ${this.landName(row.landId)}`,
    });
  }
}
