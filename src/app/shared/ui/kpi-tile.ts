import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Tone } from '../../core/models/common';

@Component({
  selector: 'ui-kpi-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kpi-tile.html',
  styleUrl: './kpi-tile.css',
})
export class KpiTile {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly hint = input('');
  readonly tone = input<Tone>('neutral');
}
