import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface Field {
  label: string;
  value: string | number;
  mono?: boolean;
}

/** Label/value grid for record headers. One column on phones, two from `sm`. */
@Component({
  selector: 'ui-field-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './field-list.html',
  styleUrl: './field-list.css',
})
export class FieldList {
  readonly fields = input.required<Field[]>();
}
