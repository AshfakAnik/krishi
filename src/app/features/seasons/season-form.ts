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
import { Season } from '../../core/models/agriculture';
import { SessionService } from '../../core/session';
import { seasonsFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import { SeasonDraft, seasonFromDraft, validateSeason } from './season-rules';

/**
 * Create or edit a season.
 *
 * Reference data has no approval step, so unlike the agreement form this one
 * both creates and edits: `editing` decides which, and is the only difference
 * between the two paths. The component renders errors; `season-rules.ts`
 * computes them.
 */
@Component({
  selector: 'app-season-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './season-form.html',
  styleUrl: './season-form.css',
})
export class SeasonForm {
  /** The season being edited, or null to create a new one. */
  readonly editing = input<Season | null>(null);
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly seasons = this.store.selectSignal(seasonsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(seasonsFeature.selectors.saving);

  protected readonly attempted = signal(false);

  protected readonly form = this.builder.nonNullable.group({
    name: '',
    year: this.clock.year(),
    startsOn: '',
    endsOn: '',
    active: true,
  });

  constructor() {
    // Fills the form when opened on an existing record. An effect rather than a
    // constructor read: `editing` is an input, and inputs are not set yet when
    // the constructor runs.
    effect(() => {
      const season = this.editing();
      if (season) {
        this.form.setValue({
          name: season.name,
          year: season.year,
          startsOn: season.startsOn,
          endsOn: season.endsOn,
          active: season.active,
        });
      }
    });
  }

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** `valueChanges` is typed `Partial<T>`, so every field is re-defaulted here. */
  protected readonly draft = computed<SeasonDraft>(() => {
    const raw = this.value();
    return {
      name: raw.name ?? '',
      year: Number(raw.year ?? this.clock.year()),
      startsOn: raw.startsOn ?? '',
      endsOn: raw.endsOn ?? '',
      active: raw.active ?? true,
    };
  });

  private readonly errors = computed(() =>
    validateSeason(this.draft(), {
      seasons: this.seasons(),
      ignoreSeasonId: this.editing()?.id,
    }),
  );

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected readonly heading = computed(() => (this.editing() ? 'Edit season' : 'New season'));

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const existing = this.editing();
    const season = seasonFromDraft(
      this.draft(),
      existing?.id ?? `season-${this.clock.now().getTime()}`,
    );

    // upsertMany for a new record: `upsert` calls update(), which cannot find an
    // id the mock database has never seen, and fails silently into `error`.
    this.store.dispatch(
      existing
        ? seasonsFeature.actions.upsert({ item: season })
        : seasonsFeature.actions.upsertMany({ items: [season] }),
    );

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: existing ? 'Edited season' : 'Created season',
      moduleName: 'Seasons',
      details: `${season.name} · ${season.startsOn} to ${season.endsOn}`,
    });

    this.closed.emit();
  }
}
