import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Tone } from '../../core/models/common';

/**
 * Inline message for the things that must not be swallowed: a failed write, a
 * blocked action, the confirmation that a submission went through.
 *
 * Bind it to a feature's `error` selector so `upsertFailure` is visible rather
 * than silently landing in state:
 *
 * ```html
 * @if (error(); as message) {
 *   <ui-alert tone="bad" [message]="message" (dismissed)="clearError()" />
 * }
 * ```
 *
 * `role="alert"` on the bad/warn tones so assistive tech announces a failure;
 * `status` for the rest, which is announced politely instead of interrupting.
 */
@Component({
  selector: 'ui-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alert.html',
  styleUrl: './alert.css',
})
export class Alert {
  readonly message = input.required<string>();
  readonly tone = input<Tone>('neutral');
  readonly dismissible = input(true);
  readonly dismissed = output<void>();
}
