import { A11yModule } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  OnDestroy,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * Accessible modal used by every write form in the app.
 *
 * Focus is trapped with the CDK (`cdkTrapFocus` + autocapture), Escape and a
 * backdrop click both dismiss, the dialog is labelled by its own heading, the
 * page behind it cannot scroll, and everything outside the dialog is marked
 * `inert` so it is unreachable by pointer, by Tab and by a screen reader's
 * virtual cursor. Content and footer actions are projected, so a feature only
 * writes its form.
 *
 * Drop-in: requires only `@angular/cdk` and the theme tokens. Swap the inline
 * close glyph for your own icon component if you have one.
 */
@Component({
  selector: 'ui-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule],
  // Escape closes only the top-most modal — without the guard, every mounted
  // instance would dismiss at once.
  host: { '(document:keydown.escape)': 'onEscape()' },
  templateUrl: './modal.html',
  styleUrl: './modal.css',
})
export class Modal implements OnDestroy {
  readonly heading = input.required<string>();
  readonly description = input('');
  readonly dismiss = output<void>();

  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Exactly the elements this instance made inert, so releasing them cannot
   *  un-inert something that was already inert for another reason. */
  private readonly inerted: HTMLElement[] = [];

  /** Unique per instance so `aria-labelledby` still resolves if two modals
   *  ever mount at once. */
  protected readonly headingId = `ui-modal-${nextModalId++}`;

  constructor() {
    // Capture whatever the app had set before the first modal locked scrolling,
    // so closing restores it rather than blanking it.
    if (!openModals.length) {
      previousBodyOverflow = this.document.body.style.overflow;
    }
    openModals.push(this);
    this.document.body.style.overflow = 'hidden';

    // After render, not in the constructor: the host element is not attached to
    // its parent yet at construction, so there are no siblings to walk.
    afterNextRender(() => this.inertBackground());
  }

  ngOnDestroy(): void {
    for (const element of this.inerted) {
      element.inert = false;
    }
    this.inerted.length = 0;

    const index = openModals.indexOf(this);
    if (index > -1) {
      openModals.splice(index, 1);
    }
    // Only release the scroll lock once the last modal has gone.
    if (!openModals.length) {
      this.document.body.style.overflow = previousBodyOverflow;
    }
  }

  protected onEscape(): void {
    if (openModals[openModals.length - 1] === this) {
      this.dismiss.emit();
    }
  }

  /**
   * `inert` on every sibling along the path from this modal up to `<body>`.
   *
   * The dialog is rendered inline, inside whichever feature opened it, rather
   * than in an overlay at the document root — so there is no single container to
   * mark. Inerting the siblings of each ancestor covers the whole document
   * except this modal's own subtree, whatever depth it was opened at.
   *
   * A nested modal walks the same path and skips what is already inert, so the
   * outer modal keeps ownership of the elements it marked and releasing the
   * inner one does not re-expose the page.
   */
  private inertBackground(): void {
    const body = this.document.body;
    let node: HTMLElement | null = this.host.nativeElement;

    while (node && node !== body && node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        const element = sibling as HTMLElement;
        // `inert` is undefined on SVG and other non-HTML elements; skipping them
        // is correct, since they cannot hold focus on their own either.
        if (element === node || !('inert' in element) || element.inert) {
          continue;
        }
        element.inert = true;
        this.inerted.push(element);
      }
      node = node.parentElement;
    }
  }
}

let nextModalId = 0;
let previousBodyOverflow = '';
const openModals: Modal[] = [];
