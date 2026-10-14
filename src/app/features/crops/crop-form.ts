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
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import { LAND_TYPE_LABELS, Crop, LandType } from '../../core/models/agriculture';
import { SessionService } from '../../core/session';
import { cropsFeature, landsFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import { CropDraft, cropFromDraft, growableOn, validateCrop } from './crop-rules';

/**
 * Create or edit a crop.
 *
 * The land types are the substance here: they are the data behind Lane 1's
 * suitability gate, so the form shows how many plots each choice would make the
 * crop growable on rather than leaving it abstract.
 */
@Component({
  selector: 'app-crop-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, FormField, Modal],
  templateUrl: './crop-form.html',
  styleUrl: './crop-form.css',
})
export class CropForm {
  readonly editing = input<Crop | null>(null);
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly crops = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(cropsFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly landTypes: LandType[] = ['dhani', 'vita'];
  protected readonly landTypeLabels = LAND_TYPE_LABELS;

  // Signals rather than a reactive form: a checkbox group over a fixed list is
  // simpler as two signals than as a FormArray kept in step with the list.
  protected readonly name = signal('');
  protected readonly selectedTypes = signal<LandType[]>([]);

  constructor() {
    effect(() => {
      const crop = this.editing();
      if (crop) {
        this.name.set(crop.name);
        this.selectedTypes.set([...crop.suitableLandTypes]);
      }
    });
  }

  protected readonly draft = computed<CropDraft>(() => ({
    name: this.name(),
    suitableLandTypes: this.selectedTypes(),
  }));

  private readonly errors = computed(() =>
    validateCrop(this.draft(), { crops: this.crops(), ignoreCropId: this.editing()?.id }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  /** The consequence of the choice, shown live rather than left abstract. */
  protected readonly plotCount = computed(() => growableOn(this.draft(), this.lands()).length);

  protected readonly heading = computed(() => (this.editing() ? 'Edit crop' : 'New crop'));

  protected has(type: LandType): boolean {
    return this.selectedTypes().includes(type);
  }

  protected toggle(type: LandType): void {
    this.selectedTypes.update((types) =>
      types.includes(type) ? types.filter((item) => item !== type) : [...types, type],
    );
  }

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const existing = this.editing();
    const crop = cropFromDraft(this.draft(), existing?.id ?? `crop-${this.clock.now().getTime()}`);

    this.store.dispatch(
      existing
        ? cropsFeature.actions.upsert({ item: crop })
        : cropsFeature.actions.upsertMany({ items: [crop] }),
    );

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: existing ? 'Edited crop' : 'Recorded crop',
      moduleName: 'Crops & Varieties',
      details: `${crop.name} · ${crop.suitableLandTypes.map((t) => LAND_TYPE_LABELS[t]).join(', ')}`,
    });

    this.closed.emit();
  }
}
