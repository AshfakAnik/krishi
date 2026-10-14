import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { LAND_TYPE_LABELS, Land } from '../../core/models/agriculture';
import { formatArea } from '../../core/models/common';
import { SessionService } from '../../core/session';
import {
  agreementsFeature,
  cultivationCyclesFeature,
  landsFeature,
  partiesFeature,
} from '../../core/store/features';
import { watchUndoExpiry } from '../../core/store/undo-expiry';
import { Alert } from '../../shared/ui/alert';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { StatusBadge } from '../../shared/ui/status-badge';
import { LandForm } from './land-form';
import { deletionBlocker, isHeld } from './land-rules';

/**
 * Every plot, with what currently holds it.
 *
 * An owner sees only their own land. Reference data, so removal is guarded by
 * what points at the row rather than by an approval step.
 */
@Component({
  selector: 'app-land-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, KpiTile, PageHeader, StatusBadge, Icon, RouterLink, LandForm],
  templateUrl: './land-list.html',
  styleUrl: './land-list.css',
})
export class LandList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  protected readonly session = inject(SessionService);

  private readonly all = this.store.selectSignal(landsFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(landsFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(landsFeature.selectors.error);
  protected readonly undoable = this.store.selectSignal(landsFeature.selectors.undoable);

  protected readonly editing = signal<Land | 'new' | null>(null);
  protected readonly blocked = signal('');

  constructor() {
    watchUndoExpiry(landsFeature);
    for (const feature of [
      landsFeature,
      agreementsFeature,
      cultivationCyclesFeature,
      partiesFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  /** An owner sees their own plots; the administrator sees every one. */
  protected readonly rows = computed(() => {
    const actor = this.session.actor();
    const all = this.all();
    return !actor || actor.role === 'admin' ? all : all.filter((row) => row.ownerId === actor.id);
  });

  protected readonly totalArea = computed(() =>
    this.rows().reduce((total, row) => total + row.area, 0),
  );

  protected readonly heldCount = computed(() => this.rows().filter(isHeld).length);

  protected readonly freeArea = computed(() =>
    this.rows()
      .filter((row) => !isHeld(row))
      .reduce((total, row) => total + row.area, 0),
  );

  protected readonly editingLand = computed(() => {
    const value = this.editing();
    return value === 'new' || value === null ? null : value;
  });

  protected held(row: Land): boolean {
    return isHeld(row);
  }

  protected holderOf(row: Land): string {
    const agreement = this.agreements().find((item) => item.id === row.heldByAgreementId);
    if (!agreement) {
      return 'Free';
    }
    const tenant = this.parties().find((party) => party.id === agreement.sharecropperId);
    return `${agreement.reference} · ${tenant?.name ?? '—'}`;
  }

  protected ownerName(row: Land): string {
    return this.parties().find((party) => party.id === row.ownerId)?.name ?? '—';
  }

  protected typeLabel(row: Land): string {
    return LAND_TYPE_LABELS[row.landType];
  }

  protected area(decimals: number): string {
    return formatArea(decimals);
  }

  protected blockerFor(row: Land): string {
    return deletionBlocker(row, this.agreements(), this.cycles());
  }

  protected edit(row: Land): void {
    this.editing.set(row);
  }

  protected remove(row: Land): void {
    const blocker = this.blockerFor(row);
    if (blocker) {
      this.blocked.set(`${row.name} cannot be removed — ${blocker}`);
      return;
    }
    this.blocked.set('');
    this.store.dispatch(landsFeature.actions.remove({ id: row.id }));
    this.log('Removed plot', `${row.code} · ${row.name}`);
  }

  protected undoRemove(): void {
    const row = this.undoable();
    if (!row) {
      return;
    }
    this.store.dispatch(landsFeature.actions.undoRemove());
    this.log('Restored plot', `${row.code} · ${row.name}`);
  }

  protected clearError(): void {
    this.store.dispatch(landsFeature.actions.clearError());
  }

  private log(action: string, details: string): void {
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action,
      moduleName: 'Lands',
      details,
    });
  }
}
