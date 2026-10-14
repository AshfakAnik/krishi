import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import { LAND_TYPE_LABELS, Land, LandType } from '../../core/models/agriculture';
import { formatArea, formatTaka } from '../../core/models/common';
import { ADVANCE_PER_DECIMAL, advanceCeiling } from '../../core/rules/dadhon';
import { SessionService } from '../../core/session';
import { agreementsFeature, landsFeature, partiesFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import { LandDraft, landFromDraft, lockedFields, validateLand } from './land-rules';

/**
 * Create or edit a plot.
 *
 * The interesting part is what it refuses to let you change: while an agreement
 * holds the plot, area and land type are locked, because both were validated at
 * signing and editing them now would silently invalidate a decision somebody
 * already made.
 */
@Component({
  selector: 'app-land-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './land-form.html',
  styleUrl: './land-form.css',
})
export class LandForm {
  readonly editing = input<Land | null>(null);
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(landsFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly landTypes: LandType[] = ['dhani', 'vita'];
  protected readonly landTypeLabels = LAND_TYPE_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    code: '',
    name: '',
    landType: 'dhani' as LandType,
    area: 0,
    location: '',
    ownerId: '',
  });

  constructor() {
    effect(() => {
      const land = this.editing();
      if (!land) {
        return;
      }
      this.form.setValue({
        code: land.code,
        name: land.name,
        landType: land.landType,
        area: land.area,
        location: land.location,
        ownerId: land.ownerId,
      });
      // Disabling rather than hiding: a locked field the user can still read is
      // an explanation, a missing one is a mystery.
      for (const field of lockedFields(land, this.agreements())) {
        this.form.controls[field].disable();
      }
    });
  }

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<LandDraft>(() => {
    // getRawValue, not the emitted value: a disabled control is omitted from
    // valueChanges, and a locked area would validate as 0.
    const raw = { ...this.form.getRawValue(), ...this.value() };
    return {
      code: raw.code ?? '',
      name: raw.name ?? '',
      landType: (raw.landType ?? 'dhani') as LandType,
      area: Number(raw.area ?? 0),
      location: raw.location ?? '',
      ownerId: raw.ownerId ?? '',
    };
  });

  protected readonly owners = computed(() =>
    this.parties().filter((party) => party.role === 'owner'),
  );

  protected readonly locked = computed(() => {
    const land = this.editing();
    return land ? lockedFields(land, this.agreements()) : [];
  });

  protected readonly lockNote = computed(() =>
    this.locked().length
      ? 'An agreement holds this plot, so its area and land type are fixed until it is released.'
      : '',
  );

  /** The consequence of the area, previewed: it sets the dadhon ceiling. */
  protected readonly ceilingHint = computed(() => {
    const area = this.draft().area;
    if (!area) {
      return `Area sets the dadhon ceiling, at ৳ ${ADVANCE_PER_DECIMAL} per decimal.`;
    }
    return `${formatArea(area)} carries a dadhon ceiling of ${formatTaka(advanceCeiling({ area } as Land))}.`;
  });

  private readonly errors = computed(() =>
    validateLand(this.draft(), {
      lands: this.lands(),
      ignoreLandId: this.editing()?.id,
    }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected readonly heading = computed(() => (this.editing() ? 'Edit plot' : 'New plot'));

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const existing = this.editing();
    const land = landFromDraft(
      this.draft(),
      existing?.id ?? `land-${this.clock.now().getTime()}`,
      // Never written by this form: which agreement holds a plot is decided by
      // approving or revoking one, not by editing the plot.
      existing?.heldByAgreementId ?? null,
    );

    this.store.dispatch(
      existing
        ? landsFeature.actions.upsert({ item: land })
        : landsFeature.actions.upsertMany({ items: [land] }),
    );

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: existing ? 'Edited plot' : 'Recorded plot',
      moduleName: 'Lands',
      details: `${land.code} · ${land.name} · ${formatArea(land.area)}`,
    });

    this.closed.emit();
  }
}
