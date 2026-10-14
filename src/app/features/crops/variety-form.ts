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
import { CropVariety } from '../../core/models/agriculture';
import { formatArea, formatMaund } from '../../core/models/common';
import { SessionService } from '../../core/session';
import { cropVarietiesFeature, cropsFeature, landsFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import { VarietyDraft, validateVariety, varietyFromDraft, yieldFor } from './crop-rules';

/**
 * Create or edit a variety.
 *
 * `expectedYieldPerDecimal` is the number every harvest and settlement figure
 * downstream is derived from, so the form previews what it would mean on a real
 * plot — a misplaced decimal point is otherwise invisible until settlement.
 */
@Component({
  selector: 'app-variety-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './variety-form.html',
  styleUrl: './variety-form.css',
})
export class VarietyForm {
  readonly editing = input<CropVariety | null>(null);
  /** Pre-selects the crop when opened from a crop's detail page. */
  readonly cropId = input('');
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  protected readonly crops = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly varieties = this.store.selectSignal(cropVarietiesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(cropVarietiesFeature.selectors.saving);

  protected readonly attempted = signal(false);

  protected readonly form = this.builder.nonNullable.group({
    cropId: '',
    name: '',
    durationDays: 120,
    expectedYieldPerDecimal: 0.6,
  });

  constructor() {
    effect(() => {
      const variety = this.editing();
      if (variety) {
        this.form.setValue({
          cropId: variety.cropId,
          name: variety.name,
          durationDays: variety.durationDays,
          expectedYieldPerDecimal: variety.expectedYieldPerDecimal,
        });
        return;
      }
      const preset = this.cropId();
      if (preset) {
        this.form.controls.cropId.setValue(preset);
      }
    });
  }

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<VarietyDraft>(() => {
    const raw = this.value();
    return {
      cropId: raw.cropId ?? '',
      name: raw.name ?? '',
      durationDays: Number(raw.durationDays ?? 0),
      expectedYieldPerDecimal: Number(raw.expectedYieldPerDecimal ?? 0),
    };
  });

  private readonly errors = computed(() =>
    validateVariety(this.draft(), {
      varieties: this.varieties(),
      crops: this.crops(),
      ignoreVarietyId: this.editing()?.id,
    }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  /**
   * The yield figure made concrete against the largest recorded plot, because
   * "0.62 maund per decimal" means nothing until it is multiplied out.
   */
  protected readonly yieldPreview = computed(() => {
    const biggest = this.lands().reduce((max, land) => (land.area > max ? land.area : max), 0);
    if (!biggest || !this.draft().expectedYieldPerDecimal) {
      return '';
    }
    return `On ${formatArea(biggest)}, the largest recorded plot, that is ${formatMaund(
      yieldFor(this.draft(), biggest),
    )}.`;
  });

  protected readonly heading = computed(() => (this.editing() ? 'Edit variety' : 'New variety'));

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const existing = this.editing();
    const variety = varietyFromDraft(
      this.draft(),
      existing?.id ?? `var-${this.clock.now().getTime()}`,
    );

    this.store.dispatch(
      existing
        ? cropVarietiesFeature.actions.upsert({ item: variety })
        : cropVarietiesFeature.actions.upsertMany({ items: [variety] }),
    );

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: existing ? 'Edited variety' : 'Recorded variety',
      moduleName: 'Crops & Varieties',
      details: `${variety.name} · ${this.cropName(variety.cropId)} · ${variety.expectedYieldPerDecimal} maund/decimal`,
    });

    this.closed.emit();
  }

  private cropName(id: string): string {
    return this.crops().find((row) => row.id === id)?.name ?? '—';
  }
}
