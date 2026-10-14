import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Inline SVG icon set. Hand-rolled rather than pulled from an icon package, so
 * the bundle carries only the glyphs you keep and every glyph inherits
 * `currentColor`. Delete the ones your app does not use and add your own.
 */
@Component({
  selector: 'ui-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  templateUrl: './icon.html',
  styleUrl: './icon.css',
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(18);
}
