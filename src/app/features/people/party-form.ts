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
import { Party } from '../../core/models/agriculture';
import { ROLE_LABELS, RoleName } from '../../core/models/common';
import { SessionService } from '../../core/session';
import { agreementsFeature, landsFeature, partiesFeature } from '../../core/store/features';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Modal } from '../../shared/ui/modal';
import { PartyDraft, partyFromDraft, roleChangeBlocker, validateParty } from './party-rules';

/**
 * Create or edit a person.
 *
 * The role is the part that needs guarding: it decides what somebody may do and
 * every role-filtered page reads it, so it is locked once records point at them
 * in the role they currently hold.
 */
@Component({
  selector: 'app-party-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Alert, FormField, Modal],
  templateUrl: './party-form.html',
  styleUrl: './party-form.css',
})
export class PartyForm {
  readonly editing = input<Party | null>(null);
  readonly closed = output<void>();

  private readonly store = inject(Store);
  private readonly audit = inject(AuditLogService);
  private readonly builder = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly clock = inject(SessionClock);

  private readonly parties = this.store.selectSignal(partiesFeature.selectors.all);
  private readonly lands = this.store.selectSignal(landsFeature.selectors.all);
  private readonly agreements = this.store.selectSignal(agreementsFeature.selectors.all);
  protected readonly saving = this.store.selectSignal(partiesFeature.selectors.saving);

  protected readonly attempted = signal(false);
  protected readonly roles: RoleName[] = ['owner', 'sharecropper', 'admin'];
  protected readonly roleLabels = ROLE_LABELS;

  protected readonly form = this.builder.nonNullable.group({
    name: '',
    role: 'sharecropper' as RoleName,
    phone: '',
    village: '',
    seasonsWorked: 0,
  });

  constructor() {
    effect(() => {
      const party = this.editing();
      if (party) {
        this.form.setValue({
          name: party.name,
          role: party.role,
          phone: party.phone,
          village: party.village,
          seasonsWorked: party.seasonsWorked ?? 0,
        });
      }
    });
  }

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly draft = computed<PartyDraft>(() => {
    const raw = this.value();
    return {
      name: raw.name ?? '',
      role: (raw.role ?? 'sharecropper') as RoleName,
      phone: raw.phone ?? '',
      village: raw.village ?? '',
      seasonsWorked: Number(raw.seasonsWorked ?? 0),
    };
  });

  protected readonly isSharecropper = computed(() => this.draft().role === 'sharecropper');

  /** Empty unless the role is being changed out from under existing records. */
  protected readonly roleBlocker = computed(() => {
    const party = this.editing();
    return party
      ? roleChangeBlocker(party, this.draft().role, this.lands(), this.agreements())
      : '';
  });

  private readonly errors = computed(() => {
    const errors = validateParty(this.draft(), {
      parties: this.parties(),
      ignorePartyId: this.editing()?.id,
    });
    const blocker = this.roleBlocker();
    return blocker ? { ...errors, role: `The role cannot change — ${blocker}` } : errors;
  });

  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  protected errorFor(field: string): string {
    return this.attempted() ? (this.errors()[field] ?? '') : '';
  }

  protected readonly heading = computed(() => (this.editing() ? 'Edit person' : 'New person'));

  protected submit(): void {
    this.attempted.set(true);
    if (this.hasErrors()) {
      return;
    }

    const existing = this.editing();
    const party = partyFromDraft(
      this.draft(),
      existing?.id ?? `party-${this.clock.now().getTime()}`,
    );

    this.store.dispatch(
      existing
        ? partiesFeature.actions.upsert({ item: party })
        : partiesFeature.actions.upsertMany({ items: [party] }),
    );

    this.audit.record({
      actorRole: this.session.role() ?? 'unknown',
      actorName: this.session.actorName(),
      action: existing ? 'Edited person' : 'Recorded person',
      moduleName: 'Owners & Sharecroppers',
      details: `${party.name} · ${ROLE_LABELS[party.role]} · ${party.village}`,
    });

    this.closed.emit();
  }
}
