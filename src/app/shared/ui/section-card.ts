import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Titled container for a detail-page block. */
@Component({
  selector: 'ui-section-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './section-card.html',
  styleUrl: './section-card.css',
})
export class SectionCard {
  readonly heading = input.required<string>();
  readonly note = input('');
  readonly padded = input(true);
}
