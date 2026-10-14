import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import { formatArea, formatTaka } from '../../core/models/common';
import { AdvanceDraft } from '../../core/models/cultivation';
import { advanceCeiling, headroom, nextAdvanceReference } from '../../core/rules/dadhon';
import { SessionService } from '../../core/session';
import {
  advancesFeature,
  agreementsFeature,
  landsFeature,
  partiesFeature,
  seasonsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import { advanceForRequest, validateAdvance } from './advance-rules';

/**
 * The submission half of the module. Without it the ledger could only ever be
 * opened by activating an agreement, and a mid-season draw would be impossible.
 *
 * The component renders errors; it does not compute them. Everything decidable
 * lives in `advance-rules.ts`, and errors stay hidden until a submit has been
 * attempted — a form that scolds you mid-typing teaches you to ignore it.
 */
@Component({
  selector: 'app-advance-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './advance-form.html',
  styleUrl: './advance-form.css',
})
export class AdvanceForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly ledger = this.store.selectSignal(advancesFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(advancesFeature.selectors.saving);

  protected readonly attempted = signal(false);

  protected readonly form = this.builder.nonNullable.group({
    agreementId: '',
    amount: 0,
    issuedOn: this.clock.today(),
    note: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** `valueChanges` is typed `Partial<T>`, so every field is re-defaulted here.
   *  Spreading `this.value()` straight into the draft does not typecheck under
   *  strict mode. */
  protected readonly draft = computed<AdvanceDraft>(() => {
    const raw = this.value();
    return {
      agreementId: raw.agreementId ?? '',
      amount: Number(raw.amount ?? 0),
      issuedOn: raw.issuedOn ?? '',
      note: raw.note ?? '',
    };
  });

  /**
   * Only agreements a draw can actually be made against: active, and the
   * actor's own unless they are the administrator.
   *
   * Like the agreement form dropping committed plots, this *avoids* the
   * "agreement is not active" rule rather than scolding about it. The rule still
   * exists for the case where an agreement is revoked while the form is open.
   */
  protected readonly availableAgreements = computed(() => {
    const actor = this.session.actor();
    return this.agreements().filter(
      (row) =>
        row.status === 'active' && (!actor || actor.role === 'admin' || row.ownerId === actor.id),
    );
  });

  protected readonly selectedAgreement = computed(() =>
    this.agreements().find((row) => row.id === this.draft().agreementId),
  );

  protected readonly selectedLand = computed(() =>
    this.lands().find((row) => row.id === this.selectedAgreement()?.landId),
  );

  /** The consequence, previewed live: what this plot may carry, what it already
   *  carries, and what is left. */
  protected readonly ceiling = computed(() => advanceCeiling(this.selectedLand()));

  protected readonly available = computed(() => {
    const agreement = this.selectedAgreement();
    return agreement ? headroom(this.selectedLand(), agreement.id, this.ledger()) : 0;
  });

  protected readonly remainingAfter = computed(() =>
    Math.max(0, this.available() - this.draft().amount),
  );

  private readonly errors = computed(() =>
    validateAdvance(this.draft(), {
      agreements: this.agreements(),
      lands: this.lands(),
      seasons: this.seasons(),
      ledger: this.ledger(),
    }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected readonly amountHint = computed(() => {
    const land = this.selectedLand();
    if (!land) {
      return 'Pick an agreement to see what its plot can still carry.';
    }
    return `${formatArea(land.area)} carries up to ${formatTaka(this.ceiling())}; ${formatTaka(this.available())} is left.`;
  });

  protected agreementLabel(id: string): string {
    const agreement = this.agreements().find((row) => row.id === id);
    if (!agreement) {
      return '—';
    }
    const land = this.lands().find((row) => row.id === agreement.landId);
    return `${agreement.reference} · ${land?.name ?? '—'} · ${this.partyName(agreement.sharecropperId)}`;
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const agreement = this.selectedAgreement();
    if (!agreement) {
      return;
    }

    const entry = advanceForRequest(
      this.draft(),
      agreement,
      {
        id: `adv-${this.clock.now().getTime()}`,
        reference: nextAdvanceReference(this.ledger(), this.clock.year()),
      },
      this.session.actorName(),
      this.clock.today(),
    );

    // upsertMany, not upsert: `upsert` calls update(), which cannot find an id
    // the mock database has never seen, and fails silently into `error`.
    this.store.dispatch(advancesFeature.actions.upsertMany({ items: [entry] }));

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Requested mid-season advance',
      moduleName: 'Advances & Loans',
      details: `${entry.reference} · ${agreement.reference} · ${this.partyName(entry.sharecropperId)} · ${formatTaka(entry.amount)}`,
    });

    this.closed.emit();
  }

  protected taka(amount: number): string {
    return formatTaka(amount);
  }

  private partyName(id: string): string {
    return this.parties().find((party) => party.id === id)?.name ?? '—';
  }
}
