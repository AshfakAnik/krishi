import { DestroyRef, effect, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { CollectionFeature } from './collection-feature';

/** How long an undo stays on offer. Long enough to read the banner and change
 *  your mind, short enough that it is gone by the time you have moved on. */
export const UNDO_TIMEOUT_MS = 12_000;

/**
 * Withdraws a collection's undo offer once it has been on screen long enough.
 *
 * The timing lives here rather than in the reducer because a reducer cannot read
 * a clock and stay pure, and it lives here rather than in each list component
 * because two modules were about to write the same `setTimeout` twice.
 *
 * Call it from a component's field initialiser or constructor — it needs an
 * injection context for `Store` and `DestroyRef`.
 */
export function watchUndoExpiry<T extends { id: string }>(
  feature: CollectionFeature<T>,
  timeoutMs: number = UNDO_TIMEOUT_MS,
): void {
  const store = inject(Store);
  const undoable = store.selectSignal(feature.selectors.undoable);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  effect(() => {
    // Read first, so the effect re-runs when the offer appears *or* is taken.
    const offer = undoable();
    // Restart rather than extend: a second removal replaces the offer, and the
    // new one deserves the full window rather than the remainder of the old.
    cancel();
    if (!offer) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      store.dispatch(feature.actions.dismissUndo());
    }, timeoutMs);
  });

  // A pending timer would otherwise fire into a destroyed component's slice.
  inject(DestroyRef).onDestroy(cancel);
}
