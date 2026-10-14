import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import { HttpApiService } from '../../core/http/http-api';
import { formatArea, formatDate, formatTaka } from '../../core/models/common';
import {
  ADVANCE_KIND_LABELS,
  ADVANCE_STATUS_LABELS,
  AdvanceLedgerEntry,
} from '../../core/models/cultivation';
import { advanceCeiling, committedAgainst, headroom } from '../../core/rules/dadhon';
import { SessionService } from '../../core/session';
import {
  advancesFeature,
  agreementsFeature,
  landsFeature,
  partiesFeature,
  seasonsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Field, FieldList } from '../../shared/ui/field-list';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import { canDecideAdvance, canRepay, refusalNoteError, repaymentError } from './advance-rules';
import { advanceTone } from './advance-view';

/**
 * The record, the ledger the decision will change, and the decision itself.
 *
 * Approving hands money over: the row goes active and its balance opens, which
 * is what every settlement path in Lane 5 will later deduct against. Refusing
 * moves nothing, for the same reason rejecting an agreement releases no plot —
 * a pending row never disbursed anything.
 *
 * Every decision goes through the backend's own action endpoint
 * (`AdvanceController.approve/reject/repay`) rather than computing the
 * result client-side — the same reasoning as `agreement-detail.ts`. There
 * is no reverse-repayment endpoint, so the repayment-undo affordance the
 * mock version had is dropped, not rewired (see `repay()`'s comment).
 */
@Component({
  selector: 'app-advance-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, FieldList, Icon, PageHeader, SectionCard, StatusBadge],
  templateUrl: './advance-detail.html',
  styleUrl: './advance-detail.css',
})
export class AdvanceDetail {
  /** Route param, delivered as an input by `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly clock = inject(SessionClock);
  private readonly router = inject(Router);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  private readonly all = this.store.selectSignal(advancesFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);

  protected readonly saving = this.store.selectSignal(advancesFeature.selectors.saving);
  protected readonly error = this.store.selectSignal(advancesFeature.selectors.error);

  protected readonly note = signal('');
  protected readonly noteAttempted = signal(false);
  protected readonly repayment = signal(0);
  protected readonly repayAttempted = signal(false);

  constructor() {
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

  protected readonly entry = computed(() => this.all().find((row) => row.id === this.id()));

  protected readonly agreement = computed(() =>
    this.agreements().find((row) => row.id === this.entry()?.agreementId),
  );

  protected readonly land = computed(() =>
    this.lands().find((row) => row.id === this.agreement()?.landId),
  );

  /** Every other row drawn against the same agreement — the ledger this one
   *  sits inside, which is what makes the headroom figure legible. */
  protected readonly siblings = computed(() =>
    this.all().filter((row) => row.agreementId === this.entry()?.agreementId),
  );

  protected readonly statusLabel = computed(() => {
    const entry = this.entry();
    return entry ? ADVANCE_STATUS_LABELS[entry.status] : '';
  });

  protected readonly statusTone = computed(() => {
    const entry = this.entry();
    return entry ? advanceTone(entry.status) : 'neutral';
  });

  protected readonly decidable = computed(() => {
    const entry = this.entry();
    return !!entry && canDecideAdvance(entry) && this.session.canApproveAdvance();
  });

  protected readonly repayable = computed(() => {
    const entry = this.entry();
    return !!entry && canRepay(entry) && this.session.canApproveAdvance();
  });

  /**
   * A request may be withdrawn while it is still pending — nothing was
   * disbursed, so nothing has to be unwound. A decided row is never deleted:
   * the ledger has to stay readable at settlement.
   */
  protected readonly withdrawable = computed(() => {
    const entry = this.entry();
    const actor = this.session.actor();
    if (!entry || entry.status !== 'pending' || !actor) {
      return false;
    }
    return actor.role === 'admin' || this.agreement()?.ownerId === actor.id;
  });

  protected readonly ceiling = computed(() => advanceCeiling(this.land()));

  protected readonly committed = computed(() => {
    const entry = this.entry();
    return entry ? committedAgainst(entry.agreementId, this.all()) : 0;
  });

  protected readonly available = computed(() => {
    const entry = this.entry();
    return entry ? headroom(this.land(), entry.agreementId, this.all()) : 0;
  });

  protected readonly noteError = computed(() =>
    this.noteAttempted() ? refusalNoteError(this.note()) : '',
  );

  protected readonly repayError = computed(() => {
    const entry = this.entry();
    if (!entry || !this.repayAttempted()) {
      return '';
    }
    return repaymentError(this.repayment(), entry);
  });

  protected readonly summary = computed<Field[]>(() => {
    const entry = this.entry();
    const agreement = this.agreement();
    const land = this.land();
    if (!entry) {
      return [];
    }
    return [
      { label: 'Reference', value: entry.reference, mono: true },
      { label: 'Agreement', value: agreement?.reference ?? '—', mono: true },
      { label: 'Land', value: land ? `${land.name} (${land.code})` : '—' },
      { label: 'Area', value: land ? formatArea(land.area) : '—', mono: true },
      { label: 'Season', value: this.seasonName(agreement?.seasonId) },
      { label: 'Sharecropper', value: this.partyName(entry.sharecropperId) },
      { label: 'Kind', value: ADVANCE_KIND_LABELS[entry.kind] },
      { label: 'Amount', value: formatTaka(entry.amount), mono: true },
      { label: 'Outstanding', value: formatTaka(entry.outstanding), mono: true },
      { label: 'Handed over on', value: formatDate(entry.issuedOn), mono: true },
      {
        label: 'Requested by',
        value: `${entry.requestedBy} · ${formatDate(entry.requestedOn)}`,
      },
      {
        label: 'Decided by',
        value: entry.decidedBy ? `${entry.decidedBy} · ${formatDate(entry.decidedOn)}` : '—',
      },
    ];
  });

  protected readonly purpose = computed(() => this.entry()?.note ?? '');

  /** Approving releases the money: the row goes active and its balance opens
   *  (`AdvanceService.approve()`). */
  protected approve(): void {
    const entry = this.entry();
    // Re-asserted rather than trusted from the disabled button: a tab left open
    // while someone else decided would otherwise decide twice.
    if (!entry || !canDecideAdvance(entry) || !this.session.canApproveAdvance()) {
      return;
    }

    this.httpApi.action<AdvanceLedgerEntry>('advances', entry.id, 'approve').subscribe({
      next: (updated) => {
        this.store.dispatch(advancesFeature.actions.upsertSuccess({ item: updated }));
        this.log(updated, 'Approved and released advance', `${formatTaka(updated.outstanding)} outstanding`);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /** Refusing moves nothing else — the row never disbursed anything. */
  protected reject(): void {
    const entry = this.entry();
    this.noteAttempted.set(true);
    if (
      !entry ||
      !canDecideAdvance(entry) ||
      !this.session.canApproveAdvance() ||
      refusalNoteError(this.note())
    ) {
      return;
    }

    const note = this.note().trim();
    this.httpApi.action<AdvanceLedgerEntry>('advances', entry.id, 'reject', { note }).subscribe({
      next: (updated) => {
        this.store.dispatch(advancesFeature.actions.upsertSuccess({ item: updated }));
        this.log(updated, 'Refused advance request', note);
        this.note.set('');
        this.noteAttempted.set(false);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /** Deducts a repayment. Clearing the balance closes the row, which gives its
   *  share of the dadhon ceiling back to the plot. No reverse-repayment
   *  endpoint exists (`AdvanceController` only has approve/reject/repay), so
   *  unlike the mock version this can no longer be offered back for undo —
   *  a real, small feature regression, dropped rather than left to 400 once
   *  `advances` went real. */
  protected repay(): void {
    const entry = this.entry();
    this.repayAttempted.set(true);
    const amount = this.repayment();
    if (!entry || !canRepay(entry) || !this.session.canApproveAdvance()) {
      return;
    }
    if (repaymentError(amount, entry)) {
      return;
    }

    this.httpApi.action<AdvanceLedgerEntry>('advances', entry.id, 'repay', { amount }).subscribe({
      next: (updated) => {
        this.store.dispatch(advancesFeature.actions.upsertSuccess({ item: updated }));
        this.log(
          updated,
          updated.status === 'repaid' ? 'Recorded final repayment' : 'Recorded partial repayment',
          `${formatTaka(amount)} repaid · ${formatTaka(updated.outstanding)} still outstanding`,
        );
        this.repayment.set(0);
        this.repayAttempted.set(false);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.store.dispatch(
      advancesFeature.actions.upsertFailure({ error: err instanceof Error ? err.message : 'Request failed.' }),
    );
  }

  /** Withdraws a request that has not been decided, then leaves for the list —
   *  where the undo banner is. */
  protected withdraw(): void {
    const entry = this.entry();
    if (!entry || !this.withdrawable()) {
      return;
    }
    this.store.dispatch(advancesFeature.actions.remove({ id: entry.id }));
    this.log(entry, 'Withdrew advance request', 'never decided');
    this.router.navigate(['/advances']);
  }

  protected onNote(event: Event): void {
    this.note.set((event.target as HTMLTextAreaElement).value);
  }

  protected onRepayment(event: Event): void {
    this.repayment.set(Number((event.target as HTMLInputElement).value));
  }

  protected clearError(): void {
    this.store.dispatch(advancesFeature.actions.clearError());
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected date(iso: string): string {
    return formatDate(iso);
  }

  protected kindLabel(entry: AdvanceLedgerEntry): string {
    return ADVANCE_KIND_LABELS[entry.kind];
  }

  protected statusLabelOf(entry: AdvanceLedgerEntry): string {
    return ADVANCE_STATUS_LABELS[entry.status];
  }

  protected partyName(id: string | undefined): string {
    return this.parties().find((party) => party.id === id)?.name ?? '—';
  }

  private seasonName(id: string | undefined): string {
    return this.seasons().find((season) => season.id === id)?.name ?? '—';
  }

  private log(entry: AdvanceLedgerEntry, action: string, detail: string): void {
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action,
      moduleName: 'Advances & Loans',
      details: `${entry.reference} · ${this.partyName(entry.sharecropperId)} · ${detail}`,
    });
  }
}
