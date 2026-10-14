import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * Label + control + hint/error wrapper. Keeps every form in the app consistent
 * and makes the error state a single decision rather than per-field markup.
 *
 * Pass the control's `id` so the label binds to it, and `error` only once the
 * field should actually show it (touched or submitted) — the wrapper does not
 * decide when to nag.
 *
 * `optional` uses `booleanAttribute`, so both `optional` and `[optional]="true"`
 * work. Without that transform the bare attribute passes the string `''` and
 * fails with `TS2322: Type 'string' is not assignable to type 'boolean'`.
 */
@Component({
  selector: 'ui-form-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './form-field.html',
  styleUrl: './form-field.css',
})
export class FormField {
  readonly label = input.required<string>();
  readonly for = input('');
  readonly hint = input('');
  readonly error = input('');
  readonly optional = input(false, { transform: booleanAttribute });
}
