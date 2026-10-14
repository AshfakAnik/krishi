import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import { Season } from '../../core/models/agriculture';
import { Tone, formatDate } from '../../core/models/common';
import { SessionService } from '../../core/session';
import {
  agreementsFeature,
  cultivationCyclesFeature,
  seasonsFeature,
} from '../../core/store/features';
import { watchUndoExpiry } from '../../core/store/undo-expiry';
import { Alert } from '../../shared/ui/alert';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { StatusBadge } from '../../shared/ui/status-badge';
import { SeasonForm } from './season-form';
import { deletionBlocker, seasonStanding } from './season-rules';
import { SEASON_STANDING_LABELS, seasonTone } from './season-view';

/**
 * Seasons, with the standing of each read from its dates.
 *
 * Reference data, so there is no detail page and no approval step: the edit form
 * *is* the detail. What replaces the decision is integrity — a season an
 * agreement or a cycle points at cannot be removed, and the row says why.
 */
@Component({
  selector: 'app-season-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, KpiTile, PageHeader, StatusBadge, Icon, SeasonForm],
  templateUrl: './season-list.html',
  styleUrl: './season-list.css',
})
export class SeasonList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly clock = inject(SessionClock);
  protected readonly session = inject(SessionService);

  protected readonly rows = this.store.selectSignal(seasonsFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(seasonsFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(seasonsFeature.selectors.error);
  protected readonly undoable = this.store.selectSignal(seasonsFeature.selectors.undoable);

  /** Null when closed, the season when editing, `'new'` when creating. */
  protected readonly editing = signal<Season | 'new' | null>(null);
  protected readonly blocked = signal('');

  constructor() {
    watchUndoExpiry(seasonsFeature);
    for (const feature of [seasonsFeature, agreementsFeature, cultivationCyclesFeature]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly today = computed(() => this.clock.today());

  protected readonly openCount = computed(
    () => this.rows().filter((row) => this.standing(row) === 'open').length,
  );

  protected readonly upcomingCount = computed(
    () => this.rows().filter((row) => this.standing(row) === 'upcoming').length,
  );

  protected readonly acceptingCount = computed(
    () => this.rows().filter((row) => row.active).length,
  );

  protected readonly editingSeason = computed(() => {
    const value = this.editing();
    return value === 'new' || value === null ? null : value;
  });

  protected standing(row: Season): 'upcoming' | 'open' | 'closed' {
    return seasonStanding(row, this.today());
  }

  protected standingTone(row: Season): Tone {
    return seasonTone(this.standing(row));
  }

  protected standingLabel(row: Season): string {
    return SEASON_STANDING_LABELS[this.standing(row)];
  }

  protected lengthOf(row: Season): number {
    return Math.max(
      0,
      Math.round(
        (Date.parse(`${row.endsOn}T00:00:00Z`) - Date.parse(`${row.startsOn}T00:00:00Z`)) /
          86_400_000,
      ),
    );
  }

  protected blockerFor(row: Season): string {
    return deletionBlocker(row, this.agreements(), this.cycles());
  }

  protected edit(row: Season): void {
    this.editing.set(row);
  }

  /** Removal is guarded rather than hidden: the message says what points at the
   *  season, which is more use than a disabled button. */
  protected remove(row: Season): void {
    const blocker = this.blockerFor(row);
    if (blocker) {
      this.blocked.set(`${row.name} cannot be removed — ${blocker}`);
      return;
    }
    this.blocked.set('');
    this.store.dispatch(seasonsFeature.actions.remove({ id: row.id }));
    this.log('Removed season', `${row.name} · ${row.startsOn} to ${row.endsOn}`);
  }

  protected undoRemove(): void {
    const row = this.undoable();
    if (!row) {
      return;
    }
    this.store.dispatch(seasonsFeature.actions.undoRemove());
    this.log('Restored season', row.name);
  }

  protected clearError(): void {
    this.store.dispatch(seasonsFeature.actions.clearError());
  }

  protected date(iso: string): string {
    return formatDate(iso);
  }

  private log(action: string, details: string): void {
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action,
      moduleName: 'Seasons',
      details,
    });
  }
}
