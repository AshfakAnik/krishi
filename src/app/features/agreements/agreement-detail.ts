import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import { HttpApiService } from '../../core/http/http-api';
import {
  AGREEMENT_STATUS_LABELS,
  RESPONSIBLE_LABELS,
  SharecroppingAgreement,
} from '../../core/models/agreement';
import {
  LAND_TYPE_LABELS,
  MODEL_LABELS,
  SETTLEMENT_MODE_LABELS,
} from '../../core/models/agriculture';
import { formatArea, formatDate, formatMaund, formatTaka } from '../../core/models/common';
import { SessionService } from '../../core/session';
import {
  advancesFeature,
  agreementsFeature,
  cropVarietiesFeature,
  cropsFeature,
  cultivationCyclesFeature,
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
import { canDecide, decisionNoteError, expectedYield, shareSplit } from './agreement-rules';
import { agreementTone } from './agreement-view';

/**
 * The record, the data the decision will change, and the decision itself.
 *
 * Approving does three things, in order: the agreement, then the related data
 * (the plot, the cultivation cycle, the advance ledger), then the audit entry.
 * Revoking is the inverse and must undo exactly what activation did.
 */
@Component({
  selector: 'app-agreement-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, FieldList, Icon, PageHeader, SectionCard, StatusBadge],
  templateUrl: './agreement-detail.html',
  styleUrl: './agreement-detail.css',
})
export class AgreementDetail {
  /** Route param, delivered as an input by `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly clock = inject(SessionClock);
  private readonly router = inject(Router);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  private readonly all = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly crops = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly varieties = this.store.selectSignal(cropVarietiesFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly advances = this.store.selectSignal(advancesFeature.selectors.all);

  protected readonly saving = this.store.selectSignal(agreementsFeature.selectors.saving);
  protected readonly error = this.store.selectSignal(agreementsFeature.selectors.error);

  protected readonly note = signal('');
  protected readonly noteAttempted = signal(false);

  constructor() {
    for (const feature of [
      agreementsFeature,
      landsFeature,
      cropsFeature,
      cropVarietiesFeature,
      partiesFeature,
      seasonsFeature,
      cultivationCyclesFeature,
      advancesFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly agreement = computed(() => this.all().find((row) => row.id === this.id()));

  protected readonly land = computed(() =>
    this.lands().find((row) => row.id === this.agreement()?.landId),
  );
  protected readonly variety = computed(() =>
    this.varieties().find((row) => row.id === this.agreement()?.varietyId),
  );
  protected readonly cycle = computed(() =>
    this.cycles().find((row) => row.agreementId === this.agreement()?.id),
  );
  protected readonly ledger = computed(() =>
    this.advances().filter((row) => row.agreementId === this.agreement()?.id),
  );

  protected readonly statusLabel = computed(() => {
    const agreement = this.agreement();
    return agreement ? AGREEMENT_STATUS_LABELS[agreement.status] : '';
  });

  protected readonly statusTone = computed(() => {
    const agreement = this.agreement();
    return agreement ? agreementTone(agreement.status) : 'neutral';
  });

  protected readonly decidable = computed(() => {
    const agreement = this.agreement();
    return !!agreement && canDecide(agreement) && this.session.canApproveAgreement();
  });

  /** An active agreement can be pulled back — the inverse of activation. */
  protected readonly revocable = computed(
    () => this.agreement()?.status === 'active' && this.session.canApproveAgreement(),
  );

  /**
   * A draft is the only status that may be deleted outright. It was never
   * submitted, so nothing downstream refers to it: no plot is held, no cycle was
   * opened, no advance ledger exists. Every other status is decided by changing
   * its status, never by removing the record — an agreement that was approved and
   * revoked has to stay readable.
   */
  protected readonly discardable = computed(() => {
    const agreement = this.agreement();
    const actor = this.session.actor();
    if (!agreement || agreement.status !== 'draft' || !actor) {
      return false;
    }
    return actor.role === 'admin' || agreement.ownerId === actor.id;
  });

  protected readonly yieldMaund = computed(() => expectedYield(this.land(), this.variety()));

  /** The consequence, previewed before it is committed. */
  protected readonly split = computed(() => {
    const agreement = this.agreement();
    return agreement
      ? shareSplit(agreement.terms, this.yieldMaund())
      : { owner: 0, sharecropper: 0 };
  });

  protected readonly outstanding = computed(() =>
    this.ledger().reduce((total, entry) => total + entry.outstanding, 0),
  );

  protected readonly noteError = computed(() =>
    this.noteAttempted() ? decisionNoteError(this.note()) : '',
  );

  protected readonly summary = computed<Field[]>(() => {
    const agreement = this.agreement();
    const land = this.land();
    if (!agreement || !land) {
      return [];
    }
    return [
      { label: 'Reference', value: agreement.reference, mono: true },
      { label: 'Land', value: `${land.name} (${land.code})`, mono: false },
      { label: 'Land type', value: LAND_TYPE_LABELS[land.landType] },
      { label: 'Area', value: formatArea(land.area), mono: true },
      { label: 'Season', value: this.name(this.seasons(), agreement.seasonId) },
      { label: 'Crop', value: this.name(this.crops(), agreement.cropId) },
      { label: 'Variety', value: this.name(this.varieties(), agreement.varietyId) },
      { label: 'Owner', value: this.name(this.parties(), agreement.ownerId) },
      { label: 'Sharecropper', value: this.name(this.parties(), agreement.sharecropperId) },
      { label: 'Starts on', value: formatDate(agreement.startsOn), mono: true },
      {
        label: 'Submitted by',
        value: `${agreement.submittedBy} · ${formatDate(agreement.submittedOn)}`,
      },
      {
        label: 'Decided by',
        value: agreement.decidedBy
          ? `${agreement.decidedBy} · ${formatDate(agreement.decidedOn)}`
          : '—',
      },
    ];
  });

  protected readonly terms = computed<Field[]>(() => {
    const agreement = this.agreement();
    if (!agreement) {
      return [];
    }
    const terms = agreement.terms;
    const common: Field[] = [
      { label: 'Model', value: MODEL_LABELS[terms.model] },
      { label: 'Settlement mode', value: SETTLEMENT_MODE_LABELS[terms.settlementMode] },
      { label: 'Advance (dadhon)', value: formatTaka(agreement.advanceAmount), mono: true },
    ];
    if (terms.model === 'tevaga') {
      return [
        ...common,
        { label: "Owner's share", value: `1 of ${terms.tevagaTotalShares}`, mono: true },
        { label: 'Cultivation cost', value: 'Sharecropper bears all' },
      ];
    }
    return [
      ...common,
      { label: "Owner's harvest share", value: `${terms.ownerHarvestShare}%`, mono: true },
      { label: 'Cost', value: RESPONSIBLE_LABELS[terms.costResponsibility] },
      { label: 'Labour', value: RESPONSIBLE_LABELS[terms.labourResponsibility] },
      { label: 'Machinery', value: RESPONSIBLE_LABELS[terms.machineryResponsibility] },
      { label: 'Inputs', value: RESPONSIBLE_LABELS[terms.inputResponsibility] },
      {
        label: 'Sale expenses',
        value: terms.deductSaleExpenses ? 'Deducted before sharing' : 'Not deducted',
      },
    ];
  });

  /** Approving hands the whole decision to the server: it claims the plot,
   *  opens the cultivation cycle, and disburses the signing advance in one
   *  transaction (`AgreementService.approve()`). The three collections
   *  that changes are reloaded rather than optimistically patched — the
   *  endpoint only returns the agreement itself, not the cascade. */
  protected approve(): void {
    const agreement = this.agreement();
    // Re-asserted rather than trusted from the disabled button: a tab left open
    // while someone else decided would otherwise decide twice.
    if (!agreement || !canDecide(agreement)) {
      return;
    }

    this.httpApi.action<SharecroppingAgreement>('agreements', agreement.id, 'approve').subscribe({
      next: (updated) => {
        this.store.dispatch(agreementsFeature.actions.upsertSuccess({ item: updated }));
        this.store.dispatch(landsFeature.actions.load());
        this.store.dispatch(cultivationCyclesFeature.actions.load());
        this.store.dispatch(advancesFeature.actions.load());
        this.log(updated, 'Approved and activated agreement', 'cycle created');
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected reject(): void {
    const agreement = this.agreement();
    this.noteAttempted.set(true);
    if (!agreement || !canDecide(agreement) || decisionNoteError(this.note())) {
      return;
    }

    const note = this.note().trim();
    // Nothing else moves: a rejected agreement never claimed the plot, so there
    // is nothing to release.
    this.httpApi.action<SharecroppingAgreement>('agreements', agreement.id, 'reject', { note }).subscribe({
      next: (updated) => {
        this.store.dispatch(agreementsFeature.actions.upsertSuccess({ item: updated }));
        this.log(updated, 'Rejected agreement', note);
        this.note.set('');
        this.noteAttempted.set(false);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /** The inverse of `approve`. Releases exactly the plot this agreement claimed
   *  and aborts the cycle it created (`AgreementService.revoke()`). */
  protected revoke(): void {
    const agreement = this.agreement();
    this.noteAttempted.set(true);
    if (!agreement || agreement.status !== 'active' || decisionNoteError(this.note())) {
      return;
    }

    const note = this.note().trim();
    this.httpApi.action<SharecroppingAgreement>('agreements', agreement.id, 'revoke', { note }).subscribe({
      next: (updated) => {
        this.store.dispatch(agreementsFeature.actions.upsertSuccess({ item: updated }));
        this.store.dispatch(landsFeature.actions.load());
        this.store.dispatch(cultivationCyclesFeature.actions.load());
        this.log(updated, 'Revoked agreement', note);
        this.note.set('');
        this.noteAttempted.set(false);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.store.dispatch(
      agreementsFeature.actions.upsertFailure({ error: err instanceof Error ? err.message : 'Request failed.' }),
    );
  }

  /** Deletes a draft outright, then leaves for the list — where the undo banner
   *  is. Re-asserted rather than trusted from the hidden button, for the same
   *  reason `approve` re-asserts `canDecide`. */
  protected discard(): void {
    const agreement = this.agreement();
    if (!agreement || !this.discardable()) {
      return;
    }
    this.store.dispatch(agreementsFeature.actions.remove({ id: agreement.id }));
    this.log(agreement, 'Discarded draft agreement', 'never submitted');
    this.router.navigate(['/agreements']);
  }

  protected onNote(event: Event): void {
    this.note.set((event.target as HTMLTextAreaElement).value);
  }

  protected clearError(): void {
    // clearError, not upsertFailure({error: ''}): the failure action now rolls an
    // optimistic write back, so dismissing a message with it would undo a write
    // that had actually succeeded.
    this.store.dispatch(agreementsFeature.actions.clearError());
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  protected date(iso: string): string {
    return formatDate(iso);
  }

  protected partyName(id: string | null): string {
    return id ? this.name(this.parties(), id) : '—';
  }

  private name(rows: { id: string; name: string }[], id: string): string {
    return rows.find((row) => row.id === id)?.name ?? '—';
  }

  private log(agreement: SharecroppingAgreement, action: string, detail: string): void {
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action,
      moduleName: 'Sharecropping Agreements',
      details: `${agreement.reference} · ${this.partyName(agreement.sharecropperId)} · ${detail}`,
    });
  }
}
