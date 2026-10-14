import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import {
  AgreementDraft,
  AgreementTerms,
  RESPONSIBLE_LABELS,
  ResponsibleParty,
  SharecroppingAgreement,
} from '../../core/models/agreement';
import {
  MODEL_LABELS,
  SETTLEMENT_MODE_LABELS,
  SettlementMode,
  SharecroppingModel,
} from '../../core/models/agriculture';
import { formatArea, formatMaund, formatTaka } from '../../core/models/common';
import { SessionService } from '../../core/session';
import {
  agreementsFeature,
  cropVarietiesFeature,
  cropsFeature,
  landsFeature,
  partiesFeature,
  seasonsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import {
  ADVANCE_PER_DECIMAL,
  HOLDING_STATUSES,
  advanceCeiling,
  expectedYield,
  nextReference,
  shareSplit,
  validateAgreement,
} from './agreement-rules';

/**
 * The submission half of the module. Without it an approver could only ever
 * decide on seed data, and nobody could create an agreement at all.
 *
 * The component renders errors; it does not compute them. Everything decidable
 * lives in `agreement-rules.ts`, and errors stay hidden until a submit has been
 * attempted — a form that scolds you mid-typing teaches you to ignore it.
 */
@Component({
  selector: 'app-agreement-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './agreement-form.html',
  styleUrl: './agreement-form.css',
})
export class AgreementForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  protected readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  protected readonly crops = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly varieties = this.store.selectSignal(cropVarietiesFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  protected readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(agreementsFeature.selectors.saving);

  protected readonly attempted = signal(false);

  protected readonly modelOptions: SharecroppingModel[] = ['normal', 'tevaga'];
  protected readonly modeOptions: SettlementMode[] = ['crop', 'cash'];
  protected readonly responsibilityOptions: ResponsibleParty[] = [
    'owner',
    'sharecropper',
    'shared',
  ];
  protected readonly modelLabels = MODEL_LABELS;
  protected readonly modeLabels = SETTLEMENT_MODE_LABELS;
  protected readonly responsibilityLabels = RESPONSIBLE_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    landId: '',
    seasonId: '',
    cropId: '',
    varietyId: '',
    sharecropperId: '',
    model: 'normal' as SharecroppingModel,
    ownerHarvestShare: 50,
    tevagaTotalShares: 3,
    costResponsibility: 'shared' as ResponsibleParty,
    labourResponsibility: 'sharecropper' as ResponsibleParty,
    machineryResponsibility: 'owner' as ResponsibleParty,
    inputResponsibility: 'shared' as ResponsibleParty,
    deductSaleExpenses: true,
    settlementMode: 'crop' as SettlementMode,
    advanceAmount: 0,
    startsOn: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /**
   * `valueChanges` is typed `Partial<T>`, so every field is re-defaulted here.
   * Spreading `this.value()` straight into the draft does not typecheck under
   * strict mode.
   */
  protected readonly draft = computed<AgreementDraft>(() => {
    const raw = this.value();
    const terms: AgreementTerms = {
      model: raw.model ?? 'normal',
      ownerHarvestShare: Number(raw.ownerHarvestShare ?? 0),
      costResponsibility: raw.costResponsibility ?? 'shared',
      labourResponsibility: raw.labourResponsibility ?? 'sharecropper',
      machineryResponsibility: raw.machineryResponsibility ?? 'owner',
      inputResponsibility: raw.inputResponsibility ?? 'shared',
      deductSaleExpenses: raw.deductSaleExpenses ?? true,
      tevagaTotalShares: Number(raw.tevagaTotalShares ?? 3),
      settlementMode: raw.settlementMode ?? 'crop',
    };
    return {
      landId: raw.landId ?? '',
      seasonId: raw.seasonId ?? '',
      cropId: raw.cropId ?? '',
      varietyId: raw.varietyId ?? '',
      sharecropperId: raw.sharecropperId ?? '',
      terms,
      advanceAmount: Number(raw.advanceAmount ?? 0),
      startsOn: raw.startsOn ?? '',
    };
  });

  protected readonly isTevaga = computed(() => this.draft().terms.model === 'tevaga');

  /** An owner may only commit their own land; the administrator commits anyone's.
   *  A plot already held for the chosen season is dropped from the list, so the
   *  clash rule is something the form avoids rather than something it scolds. */
  protected readonly availableLands = computed(() => {
    const actor = this.session.actor();
    const seasonId = this.draft().seasonId;
    const held = new Set(
      this.agreements()
        .filter(
          (row) =>
            row.seasonId === seasonId &&
            (HOLDING_STATUSES as readonly string[]).includes(row.status),
        )
        .map((row) => row.landId),
    );
    return this.lands().filter(
      (land) =>
        !held.has(land.id) && (!actor || actor.role === 'admin' || land.ownerId === actor.id),
    );
  });

  protected readonly sharecroppers = computed(() =>
    this.parties().filter((party) => party.role === 'sharecropper'),
  );

  /** Only the varieties of the chosen crop — the "variety belongs to another
   *  crop" rule then only fires if the crop is changed after the variety. */
  protected readonly availableVarieties = computed(() =>
    this.varieties().filter((variety) => variety.cropId === this.draft().cropId),
  );

  protected readonly selectedLand = computed(() =>
    this.lands().find((land) => land.id === this.draft().landId),
  );

  protected readonly selectedVariety = computed(() =>
    this.varieties().find((variety) => variety.id === this.draft().varietyId),
  );

  protected readonly yieldMaund = computed(() =>
    expectedYield(this.selectedLand(), this.selectedVariety()),
  );

  protected readonly split = computed(() => shareSplit(this.draft().terms, this.yieldMaund()));

  protected readonly ceiling = computed(() => advanceCeiling(this.selectedLand()));

  private readonly errors = computed(() =>
    validateAgreement(this.draft(), {
      lands: this.lands(),
      crops: this.crops(),
      varieties: this.varieties(),
      seasons: this.seasons(),
      agreements: this.agreements(),
    }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected readonly advanceHint = computed(() => {
    const land = this.selectedLand();
    if (!land) {
      return `Ceiling is ৳ ${ADVANCE_PER_DECIMAL} per decimal of the plot.`;
    }
    return `Up to ${formatTaka(this.ceiling())} for ${formatArea(land.area)}.`;
  });

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const draft = this.draft();
    const land = this.selectedLand();
    if (!land) {
      return;
    }

    const year = Number(draft.startsOn.slice(0, 4)) || this.clock.year();
    const agreement: SharecroppingAgreement = {
      id: `agr-${this.clock.now().getTime()}`,
      reference: nextReference(this.agreements(), year),
      landId: draft.landId,
      seasonId: draft.seasonId,
      cropId: draft.cropId,
      varietyId: draft.varietyId,
      sharecropperId: draft.sharecropperId,
      // The owner is the plot's owner, never whoever happens to be filling the
      // form — an administrator drafts on the owner's behalf.
      ownerId: land.ownerId,
      terms: draft.terms,
      advanceAmount: draft.advanceAmount,
      startsOn: draft.startsOn,
      status: 'pending',
      submittedBy: this.session.actorName(),
      submittedOn: this.clock.today(),
      decidedBy: '',
      decidedOn: '',
      decisionNote: '',
      cultivationCycleId: null,
    };

    // upsertMany, not upsert: `upsert` calls update(), which cannot find an id
    // the mock database has never seen, and fails silently into `error`.
    this.store.dispatch(agreementsFeature.actions.upsertMany({ items: [agreement] }));

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Submitted agreement for approval',
      moduleName: 'Sharecropping Agreements',
      details: `${agreement.reference} · ${this.sharecropperName(agreement.sharecropperId)} · ${land.name}`,
    });

    this.closed.emit();
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  private sharecropperName(id: string): string {
    return this.parties().find((party) => party.id === id)?.name ?? '—';
  }
}
