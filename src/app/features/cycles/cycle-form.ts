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
import { formatArea, formatMaund } from '../../core/models/common';
import { SessionService } from '../../core/session';
import {
  agreementsFeature,
  cropVarietiesFeature,
  cropsFeature,
  cultivationCyclesFeature,
  landsFeature,
  seasonsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import {
  CycleDraft,
  claimForCycle,
  expectedYield,
  nextCycleReference,
  occupies,
  ownerCycleFromDraft,
  validateCycle,
} from './cycle-rules';

/**
 * Opens an **owner-farming** cycle — the branch of Lane 2 that does not go
 * through an agreement.
 *
 * A sharecropping cycle is never created here: approving an agreement creates
 * that one, having already checked everything this form checks.
 */
@Component({
  selector: 'app-cycle-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './cycle-form.html',
  styleUrl: './cycle-form.css',
})
export class CycleForm {
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  protected readonly crops = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly varieties = this.store.selectSignal(cropVarietiesFeature.selectors.all);
  protected readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(cultivationCyclesFeature.selectors.saving);

  protected readonly attempted = signal(false);

  protected readonly form = this.builder.nonNullable.group({
    landId: '',
    seasonId: '',
    cropId: '',
    varietyId: '',
    startedOn: '',
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<CycleDraft>(() => {
    const raw = this.value();
    return {
      landId: raw.landId ?? '',
      seasonId: raw.seasonId ?? '',
      cropId: raw.cropId ?? '',
      varietyId: raw.varietyId ?? '',
      startedOn: raw.startedOn ?? '',
    };
  });

  /**
   * Plots the actor may farm and that nothing else holds this season.
   *
   * Like the agreement form dropping committed plots, this avoids the clash rule
   * rather than scolding about it — the rule still exists for the case where two
   * people submit at once.
   */
  protected readonly availableLands = computed(() => {
    const actor = this.session.actor();
    const seasonId = this.draft().seasonId;
    const takenByCycle = new Set(
      this.cycles()
        .filter((row) => row.seasonId === seasonId && occupies(row))
        .map((row) => row.landId),
    );
    const takenByAgreement = new Set(
      this.agreements()
        .filter(
          (row) =>
            row.seasonId === seasonId && (row.status === 'pending' || row.status === 'active'),
        )
        .map((row) => row.landId),
    );
    return this.lands().filter(
      (land) =>
        !takenByCycle.has(land.id) &&
        !takenByAgreement.has(land.id) &&
        (!actor || actor.role === 'admin' || land.ownerId === actor.id),
    );
  });

  /** Only crops the chosen plot's land type tolerates. */
  protected readonly availableCrops = computed(() => {
    const land = this.selectedLand();
    return land
      ? this.crops().filter((crop) => crop.suitableLandTypes.includes(land.landType))
      : this.crops();
  });

  protected readonly availableVarieties = computed(() =>
    this.varieties().filter((variety) => variety.cropId === this.draft().cropId),
  );

  protected readonly selectedLand = computed(() =>
    this.lands().find((row) => row.id === this.draft().landId),
  );

  private readonly selectedVariety = computed(() =>
    this.varieties().find((row) => row.id === this.draft().varietyId),
  );

  /** The consequence, previewed before it is committed. */
  protected readonly yieldMaund = computed(() =>
    expectedYield(this.selectedLand(), this.selectedVariety()),
  );

  protected readonly yieldHint = computed(() => {
    const land = this.selectedLand();
    if (!land || !this.yieldMaund()) {
      return 'Pick a plot and a variety to see the expected harvest.';
    }
    return `${formatArea(land.area)} of this variety is expected to give ${formatMaund(this.yieldMaund())}.`;
  });

  private readonly errors = computed(() =>
    validateCycle(this.draft(), {
      lands: this.lands(),
      crops: this.crops(),
      varieties: this.varieties(),
      seasons: this.seasons(),
      cycles: this.cycles(),
      agreements: this.agreements(),
    }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const land = this.selectedLand();
    const variety = this.selectedVariety();
    if (!land || !variety) {
      return;
    }

    const id = `cyc-${this.clock.now().getTime()}`;
    const cycle = ownerCycleFromDraft(this.draft(), land, variety, {
      id,
      reference: nextCycleReference(this.cycles(), this.clock.year()),
    });

    this.store.dispatch(cultivationCyclesFeature.actions.upsertMany({ items: [cycle] }));
    // The plot is claimed by the cycle itself, since there is no agreement to
    // hold it. `Land.heldByAgreementId` is documented as covering both.
    this.store.dispatch(landsFeature.actions.upsert({ item: claimForCycle(land, id) }));

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: 'Opened owner-farming cycle',
      moduleName: 'Cultivation Cycles',
      details: `${cycle.reference} · ${land.name} · expected ${formatMaund(cycle.expectedYield)}`,
    });

    this.closed.emit();
  }
}
