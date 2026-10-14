import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { LAND_TYPE_LABELS, CropVariety } from '../../core/models/agriculture';
import { formatArea, formatMaund } from '../../core/models/common';
import { SessionService } from '../../core/session';
import { AuditLogService } from '../../core/audit-log';
import {
  agreementsFeature,
  cropVarietiesFeature,
  cropsFeature,
  cultivationCyclesFeature,
  landsFeature,
} from '../../core/store/features';
import { watchUndoExpiry } from '../../core/store/undo-expiry';
import { Alert } from '../../shared/ui/alert';
import { Field, FieldList } from '../../shared/ui/field-list';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { CropForm } from './crop-form';
import { cropDeletionBlocker, growableOn, varietyDeletionBlocker, yieldFor } from './crop-rules';
import { VarietyForm } from './variety-form';

/** One crop, the plots it may be grown on, and the varieties under it. */
@Component({
  selector: 'app-crop-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, FieldList, Icon, PageHeader, SectionCard, CropForm, VarietyForm],
  templateUrl: './crop-detail.html',
  styleUrl: './crop-detail.css',
})
export class CropDetail {
  readonly id = input.required<string>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  protected readonly session = inject(SessionService);

  private readonly crops = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly allVarieties = this.store.selectSignal(cropVarietiesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);

  protected readonly error = this.store.selectSignal(cropVarietiesFeature.selectors.error);
  protected readonly undoable = this.store.selectSignal(cropVarietiesFeature.selectors.undoable);

  protected readonly editingCrop = signal(false);
  protected readonly editingVariety = signal<CropVariety | 'new' | null>(null);
  protected readonly blocked = signal('');

  constructor() {
    watchUndoExpiry(cropVarietiesFeature);
    for (const feature of [
      cropsFeature,
      cropVarietiesFeature,
      landsFeature,
      agreementsFeature,
      cultivationCyclesFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly crop = computed(() => this.crops().find((row) => row.id === this.id()));

  protected readonly varieties = computed(() =>
    this.allVarieties().filter((row) => row.cropId === this.id()),
  );

  protected readonly plots = computed(() => {
    const crop = this.crop();
    return crop ? growableOn(crop, this.lands()) : [];
  });

  protected readonly blocker = computed(() => {
    const crop = this.crop();
    return crop
      ? cropDeletionBlocker(crop, this.allVarieties(), this.agreements(), this.cycles())
      : '';
  });

  protected readonly editingVarietyRow = computed(() => {
    const value = this.editingVariety();
    return value === 'new' || value === null ? null : value;
  });

  protected readonly summary = computed<Field[]>(() => {
    const crop = this.crop();
    if (!crop) {
      return [];
    }
    return [
      { label: 'Crop', value: crop.name },
      {
        label: 'Suitable land types',
        value: crop.suitableLandTypes.map((type) => LAND_TYPE_LABELS[type]).join(', '),
      },
      { label: 'Plots it may be grown on', value: String(this.plots().length), mono: true },
      { label: 'Varieties', value: String(this.varieties().length), mono: true },
    ];
  });

  /** The yield made concrete: what each variety would give on the largest plot
   *  this crop actually suits. */
  protected readonly referencePlot = computed(() =>
    this.plots().reduce((max, land) => (land.area > max.area ? land : max), this.plots()[0]),
  );

  protected yieldOn(variety: CropVariety): string {
    const plot = this.referencePlot();
    return plot ? formatMaund(yieldFor(variety, plot.area)) : '—';
  }

  protected readonly referenceNote = computed(() => {
    const plot = this.referencePlot();
    return plot ? `On ${plot.name}, ${formatArea(plot.area)}` : 'No suitable plot recorded';
  });

  protected varietyBlockerFor(variety: CropVariety): string {
    return varietyDeletionBlocker(variety, this.agreements(), this.cycles());
  }

  protected removeVariety(variety: CropVariety): void {
    const blocker = this.varietyBlockerFor(variety);
    if (blocker) {
      this.blocked.set(`${variety.name} cannot be removed — ${blocker}`);
      return;
    }
    this.blocked.set('');
    this.store.dispatch(cropVarietiesFeature.actions.remove({ id: variety.id }));
    this.log('Removed variety', variety.name);
  }

  protected undoRemove(): void {
    const row = this.undoable();
    if (!row) {
      return;
    }
    this.store.dispatch(cropVarietiesFeature.actions.undoRemove());
    this.log('Restored variety', row.name);
  }

  protected clearError(): void {
    this.store.dispatch(cropVarietiesFeature.actions.clearError());
  }

  private log(action: string, details: string): void {
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action,
      moduleName: 'Crops & Varieties',
      details,
    });
  }
}
