import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { LAND_TYPE_LABELS, Crop } from '../../core/models/agriculture';
import { SessionService } from '../../core/session';
import {
  agreementsFeature,
  cropVarietiesFeature,
  cropsFeature,
  cultivationCyclesFeature,
  landsFeature,
} from '../../core/store/features';
import { watchUndoExpiry } from '../../core/store/undo-expiry';
import { Alert } from '../../shared/ui/alert';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { CropForm } from './crop-form';
import { cropDeletionBlocker, growableOn } from './crop-rules';
import { VarietyForm } from './variety-form';

/** Crops, the land types each suits, and how many varieties it carries. */
@Component({
  selector: 'app-crop-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, KpiTile, PageHeader, Icon, RouterLink, CropForm, VarietyForm],
  templateUrl: './crop-list.html',
  styleUrl: './crop-list.css',
})
export class CropList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  protected readonly session = inject(SessionService);

  protected readonly rows = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly varieties = this.store.selectSignal(cropVarietiesFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(cropsFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(cropsFeature.selectors.error);
  protected readonly undoable = this.store.selectSignal(cropsFeature.selectors.undoable);

  protected readonly editing = signal<Crop | 'new' | null>(null);
  protected readonly addingVariety = signal(false);
  protected readonly blocked = signal('');

  constructor() {
    watchUndoExpiry(cropsFeature);
    for (const feature of [
      cropsFeature,
      cropVarietiesFeature,
      agreementsFeature,
      cultivationCyclesFeature,
      landsFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly varietyCount = computed(() => this.varieties().length);

  protected readonly unusable = computed(
    () => this.rows().filter((row) => !this.varietiesOf(row).length).length,
  );

  protected readonly editingCrop = computed(() => {
    const value = this.editing();
    return value === 'new' || value === null ? null : value;
  });

  protected varietiesOf(row: Crop) {
    return this.varieties().filter((variety) => variety.cropId === row.id);
  }

  protected typesOf(row: Crop): string {
    return row.suitableLandTypes.map((type) => LAND_TYPE_LABELS[type]).join(', ');
  }

  protected plotsFor(row: Crop): number {
    return growableOn(row, this.lands()).length;
  }

  protected blockerFor(row: Crop): string {
    return cropDeletionBlocker(row, this.varieties(), this.agreements(), this.cycles());
  }

  protected edit(row: Crop): void {
    this.editing.set(row);
  }

  protected remove(row: Crop): void {
    const blocker = this.blockerFor(row);
    if (blocker) {
      this.blocked.set(`${row.name} cannot be removed — ${blocker}`);
      return;
    }
    this.blocked.set('');
    this.store.dispatch(cropsFeature.actions.remove({ id: row.id }));
    this.log('Removed crop', row.name);
  }

  protected undoRemove(): void {
    const row = this.undoable();
    if (!row) {
      return;
    }
    this.store.dispatch(cropsFeature.actions.undoRemove());
    this.log('Restored crop', row.name);
  }

  protected clearError(): void {
    this.store.dispatch(cropsFeature.actions.clearError());
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
