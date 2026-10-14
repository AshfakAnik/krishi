import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Tone } from '../../core/models/common';

/** One status vocabulary for the whole app. Decide the tones once, here, and
 *  every module inherits them rather than inventing its own colours. */
@Component({
  selector: 'ui-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-badge.html',
  styleUrl: './status-badge.css',
})
export class StatusBadge {
  readonly label = input.required<string>();
  readonly tone = input<Tone>('neutral');
  readonly dot = input(true);
}
