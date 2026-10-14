import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { HttpApiService } from '../../core/http/http-api';
import { Tone, formatDate, formatMaund } from '../../core/models/common';
import {
  CROP_STAGE_LABELS,
  DAMAGE_CAUSE_LABELS,
  MonitoringLog,
  OBSERVATION_KIND_LABELS,
} from '../../core/models/cultivation';
import { SessionService } from '../../core/session';
import {
  cultivationCyclesFeature,
  landsFeature,
  monitoringLogsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Column, DataTable } from '../../shared/ui/data-table';
import { Icon } from '../../shared/ui/icon';
import { KpiTile } from '../../shared/ui/kpi-tile';
import { PageHeader } from '../../shared/ui/page-header';
import { ObservationForm } from './observation-form';
import { isLatestAdjustment } from './monitoring-rules';

/**
 * Every observation, and what each did to its cycle's expected yield.
 *
 * The row action is a revert, offered only on the observation currently
 * accounting for the yield — reverting an older one would silently undo
 * everything recorded after it.
 */
@Component({
  selector: 'app-monitoring-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, DataTable, KpiTile, PageHeader, Icon, ObservationForm],
  templateUrl: './monitoring-list.html',
  styleUrl: './monitoring-list.css',
})
export class MonitoringList {
  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  private readonly all = this.store.selectSignal(monitoringLogsFeature.selectors.all);
  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);

  protected readonly loading = this.store.selectSignal(monitoringLogsFeature.selectors.loading);
  protected readonly error = this.store.selectSignal(monitoringLogsFeature.selectors.error);
  protected readonly saving = this.store.selectSignal(monitoringLogsFeature.selectors.saving);

  protected readonly formOpen = signal(false);

  constructor() {
    for (const feature of [monitoringLogsFeature, cultivationCyclesFeature, landsFeature]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  /** An owner sees their land's observations; the administrator sees all. */
  protected readonly rows = computed(() => {
    const actor = this.session.actor();
    const all = this.all();
    if (!actor || actor.role === 'admin') {
      return all;
    }
    const visible = new Set(
      this.cycles()
        .filter((cycle) => {
          if (actor.role === 'sharecropper') {
            return cycle.sharecropperId === actor.id;
          }
          const land = this.lands().find((row) => row.id === cycle.landId);
          return land?.ownerId === actor.id;
        })
        .map((cycle) => cycle.id),
    );
    return all.filter((row) => visible.has(row.cycleId));
  });

  protected readonly damageCount = computed(
    () => this.rows().filter((row) => row.yieldAfter !== row.yieldBefore).length,
  );

  /** Maund lost across every adjustment on view. */
  protected readonly maundLost = computed(() =>
    this.rows().reduce((total, row) => total + (row.yieldBefore - row.yieldAfter), 0),
  );

  protected readonly scanCount = computed(
    () => this.rows().filter((row) => row.kind === 'ai-scan').length,
  );

  protected readonly columns: Column<MonitoringLog>[] = [
    { key: 'reference', label: 'Reference', mono: true, value: (row) => row.reference },
    { key: 'cycle', label: 'Cycle', value: (row) => this.cycleRef(row.cycleId) },
    { key: 'land', label: 'Plot', value: (row) => this.landName(row.cycleId) },
    {
      key: 'observedOn',
      label: 'Observed',
      mono: true,
      value: (row) => formatDate(row.observedOn),
      sortValue: (row) => row.observedOn,
    },
    { key: 'kind', label: 'Kind', value: (row) => OBSERVATION_KIND_LABELS[row.kind] },
    { key: 'stage', label: 'Stage', value: (row) => CROP_STAGE_LABELS[row.stage] },
    {
      key: 'cause',
      label: 'Cause',
      value: (row) => DAMAGE_CAUSE_LABELS[row.cause],
      badge: (row) => ({
        label: DAMAGE_CAUSE_LABELS[row.cause],
        tone: this.causeTone(row),
      }),
    },
    {
      key: 'damagePercent',
      label: 'Damage',
      align: 'right',
      mono: true,
      value: (row) => (row.damagePercent ? `${row.damagePercent}%` : '—'),
      sortValue: (row) => row.damagePercent,
    },
    {
      key: 'yield',
      label: 'Yield',
      align: 'right',
      mono: true,
      value: (row) =>
        row.yieldAfter === row.yieldBefore
          ? formatMaund(row.yieldAfter)
          : `${row.yieldBefore} → ${row.yieldAfter}`,
      sortValue: (row) => row.yieldAfter,
    },
    { key: 'observedBy', label: 'By', value: (row) => row.observedBy },
  ];

  protected causeTone(row: MonitoringLog): Tone {
    if (row.cause === 'none') {
      return 'ok';
    }
    return row.yieldAfter === row.yieldBefore ? 'warn' : 'bad';
  }

  protected cycleRef(cycleId: string): string {
    return this.cycles().find((row) => row.id === cycleId)?.reference ?? '—';
  }

  protected landName(cycleId: string): string {
    const cycle = this.cycles().find((row) => row.id === cycleId);
    return this.lands().find((row) => row.id === cycle?.landId)?.name ?? '—';
  }

  /** True only for the observation currently accounting for its cycle's yield. */
  protected revertable(row: MonitoringLog): boolean {
    const cycle = this.cycles().find((item) => item.id === row.cycleId);
    return (
      !!cycle &&
      cycle.status !== 'settled' &&
      isLatestAdjustment(row, cycle) &&
      this.session.canApproveAgreement()
    );
  }

  /**
   * `MonitoringLogService.revert()` only restores the cycle's expected
   * yield (server-side, same transaction) — the log row itself is left as
   * recorded history, not zeroed out the way the mock version rewrote it.
   * The revert response is the (unchanged) log, so the cycle's new
   * `expectedYield` isn't in it; reload `cultivationCycles` to pick it up.
   */
  protected revert(row: MonitoringLog): void {
    const cycle = this.cycles().find((item) => item.id === row.cycleId);
    if (!cycle || !this.revertable(row)) {
      return;
    }
    this.httpApi.action<MonitoringLog>('monitoringLogs', row.id, 'revert').subscribe({
      next: (updated) => {
        this.store.dispatch(monitoringLogsFeature.actions.upsertSuccess({ item: updated }));
        this.store.dispatch(cultivationCyclesFeature.actions.load());
        this.audit.record({
          actorRole: this.session.role() ?? 'unknown',
          actorName: this.session.actorName(),
          action: 'Reverted crop damage adjustment',
          moduleName: 'Crop Monitoring',
          details: `${row.reference} · ${cycle.reference} · yield restored to ${row.yieldBefore} maund`,
        });
      },
      error: (err: unknown) =>
        this.store.dispatch(
          monitoringLogsFeature.actions.upsertFailure({
            error: err instanceof Error ? err.message : 'Request failed.',
          }),
        ),
    });
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  protected clearError(): void {
    this.store.dispatch(monitoringLogsFeature.actions.clearError());
  }
}
