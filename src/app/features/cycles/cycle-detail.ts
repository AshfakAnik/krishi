import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuditLogService } from '../../core/audit-log';
import { SessionClock } from '../../core/clock';
import { HttpApiService } from '../../core/http/http-api';
import { FARMING_TYPE_LABELS, LAND_TYPE_LABELS } from '../../core/models/agriculture';
import { formatArea, formatDate, formatMaund } from '../../core/models/common';
import { CultivationCycle, CYCLE_STATUS_LABELS, CycleStatus } from '../../core/models/cultivation';
import { SessionService } from '../../core/session';
import {
  agreementsFeature,
  cropVarietiesFeature,
  cropsFeature,
  cultivationCyclesFeature,
  landsFeature,
  partiesFeature,
  seasonsFeature,
} from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { Field, FieldList } from '../../shared/ui/field-list';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { SectionCard } from '../../shared/ui/section-card';
import { StatusBadge } from '../../shared/ui/status-badge';
import { CYCLE_PROGRESSION, canAbort, canAdvance, nextStatus, occupies } from './cycle-rules';
import { cycleTone } from './cycle-view';

/**
 * One cycle, and the decision that moves it along.
 *
 * The lifecycle is the decision here: planned → ongoing → harvesting → settled,
 * or aborted. Reaching the end of the line releases the plot, exactly as
 * revoking an agreement does — a finished cycle must not keep holding land the
 * next season needs.
 */
@Component({
  selector: 'app-cycle-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alert, FieldList, Icon, PageHeader, SectionCard, StatusBadge],
  templateUrl: './cycle-detail.html',
  styleUrl: './cycle-detail.css',
})
export class CycleDetail {
  readonly id = input.required<string>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly clock = inject(SessionClock);
  private readonly httpApi = inject(HttpApiService);
  protected readonly session = inject(SessionService);

  private readonly cycles = this.store.selectSignal(cultivationCyclesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly crops = this.store.selectSignal(cropsFeature.selectors.all);
  private readonly varieties = this.store.selectSignal(cropVarietiesFeature.selectors.all);
  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);

  protected readonly saving = this.store.selectSignal(cultivationCyclesFeature.selectors.saving);
  protected readonly error = this.store.selectSignal(cultivationCyclesFeature.selectors.error);

  protected readonly progression = CYCLE_PROGRESSION;
  protected readonly statusLabels = CYCLE_STATUS_LABELS;
  protected readonly note = signal('');

  constructor() {
    for (const feature of [
      cultivationCyclesFeature,
      landsFeature,
      cropsFeature,
      cropVarietiesFeature,
      partiesFeature,
      seasonsFeature,
      agreementsFeature,
    ]) {
      this.store.dispatch(feature.actions.ensureLoaded());
    }
  }

  protected readonly cycle = computed(() => this.cycles().find((row) => row.id === this.id()));

  protected readonly land = computed(() =>
    this.lands().find((row) => row.id === this.cycle()?.landId),
  );

  protected readonly agreement = computed(() =>
    this.agreements().find((row) => row.id === this.cycle()?.agreementId),
  );

  protected readonly statusLabel = computed(() => {
    const cycle = this.cycle();
    return cycle ? CYCLE_STATUS_LABELS[cycle.status] : '';
  });

  protected readonly statusTone = computed(() => {
    const cycle = this.cycle();
    return cycle ? cycleTone(cycle.status) : 'neutral';
  });

  /** Only somebody who can decide on an agreement can move a cycle along: the
   *  step to `settled` is what lets the settlement run. */
  private readonly mayDecide = computed(() => this.session.canApproveAgreement());

  protected readonly advanceable = computed(() => {
    const cycle = this.cycle();
    return !!cycle && canAdvance(cycle) && this.mayDecide();
  });

  protected readonly abortable = computed(() => {
    const cycle = this.cycle();
    return !!cycle && canAbort(cycle) && this.mayDecide();
  });

  protected readonly nextLabel = computed(() => {
    const cycle = this.cycle();
    const next = cycle ? nextStatus(cycle) : null;
    return next ? CYCLE_STATUS_LABELS[next] : '';
  });

  /** True once the cycle no longer holds its plot. */
  protected readonly released = computed(() => {
    const cycle = this.cycle();
    return !!cycle && !occupies(cycle);
  });

  protected readonly summary = computed<Field[]>(() => {
    const cycle = this.cycle();
    const land = this.land();
    if (!cycle) {
      return [];
    }
    return [
      { label: 'Reference', value: cycle.reference, mono: true },
      { label: 'Plot', value: land ? `${land.name} (${land.code})` : '—' },
      { label: 'Land type', value: land ? LAND_TYPE_LABELS[land.landType] : '—' },
      { label: 'Area', value: land ? formatArea(land.area) : '—', mono: true },
      { label: 'Season', value: this.seasonName(cycle.seasonId) },
      { label: 'Crop', value: this.cropName(cycle.cropId) },
      { label: 'Variety', value: this.varietyName(cycle.varietyId) },
      { label: 'Farming type', value: FARMING_TYPE_LABELS[cycle.farmingType] },
      {
        label: 'Agreement',
        value: this.agreement()?.reference ?? 'None — the owner farms this plot',
      },
      { label: 'Sharecropper', value: this.partyName(cycle.sharecropperId) },
      { label: 'Started on', value: formatDate(cycle.startedOn), mono: true },
      { label: 'Expected harvest', value: formatMaund(cycle.expectedYield), mono: true },
    ];
  });

  protected stepState(status: CycleStatus): 'done' | 'current' | 'todo' {
    const cycle = this.cycle();
    if (!cycle) {
      return 'todo';
    }
    if (cycle.status === 'aborted') {
      // An aborted cycle is off the progression entirely; nothing after the
      // point it stopped should read as still to come.
      return 'todo';
    }
    const here = CYCLE_PROGRESSION.indexOf(cycle.status);
    const step = CYCLE_PROGRESSION.indexOf(status);
    if (step < here) {
      return 'done';
    }
    return step === here ? 'current' : 'todo';
  }

  /** Moves the cycle one step along (`CultivationCycleService.advance()`).
   *  **Known backend gap, not fixed here**: unlike `abort()`, `advance()`
   *  never releases the plot on reaching a terminal status — only a
   *  reload of `lands` below, not an assumption, decides whether the
   *  badge shows it released. */
  protected advanceCycle(): void {
    const cycle = this.cycle();
    // Re-asserted rather than trusted from the disabled button, for the same
    // reason the agreement page re-asserts `canDecide`.
    if (!cycle || !canAdvance(cycle) || !this.mayDecide()) {
      return;
    }

    this.httpApi.action<CultivationCycle>('cultivationCycles', cycle.id, 'advance').subscribe({
      next: (moved) => {
        this.store.dispatch(cultivationCyclesFeature.actions.upsertSuccess({ item: moved }));
        if (!occupies(moved)) {
          this.store.dispatch(landsFeature.actions.load());
        }
        this.log(
          moved.reference,
          `Advanced cycle to ${CYCLE_STATUS_LABELS[moved.status].toLowerCase()}`,
          occupies(moved) ? 'plot still held' : 'plot released',
        );
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /** Aborts a cycle lost to flood, pest or a revoked agreement
   *  (`CultivationCycleService.abort()`). */
  protected abortCycle(): void {
    const cycle = this.cycle();
    if (!cycle || !canAbort(cycle) || !this.mayDecide()) {
      return;
    }

    const note = this.note().trim();
    this.httpApi.action<CultivationCycle>('cultivationCycles', cycle.id, 'abort').subscribe({
      next: (stopped) => {
        this.store.dispatch(cultivationCyclesFeature.actions.upsertSuccess({ item: stopped }));
        this.store.dispatch(landsFeature.actions.load());
        this.log(stopped.reference, 'Aborted cycle', note || 'no reason given');
        this.note.set('');
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.store.dispatch(
      cultivationCyclesFeature.actions.upsertFailure({
        error: err instanceof Error ? err.message : 'Request failed.',
      }),
    );
  }

  protected onNote(event: Event): void {
    this.note.set((event.target as HTMLTextAreaElement).value);
  }

  protected clearError(): void {
    this.store.dispatch(cultivationCyclesFeature.actions.clearError());
  }

  protected cropName(id: string): string {
    return this.crops().find((row) => row.id === id)?.name ?? '—';
  }

  protected varietyName(id: string): string {
    return this.varieties().find((row) => row.id === id)?.name ?? '—';
  }

  protected seasonName(id: string): string {
    return this.seasons().find((row) => row.id === id)?.name ?? '—';
  }

  protected partyName(id: string | null): string {
    return id ? (this.parties().find((row) => row.id === id)?.name ?? '—') : '—';
  }

  protected maund(quantity: number): string {
    return formatMaund(quantity);
  }

  private log(reference: string, action: string, detail: string): void {
    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action,
      moduleName: 'Cultivation Cycles',
      details: `${reference} · ${this.land()?.name ?? '—'} · ${detail} · ${this.clock.today()}`,
    });
  }
}
