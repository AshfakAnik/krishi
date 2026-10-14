import { EnvironmentProviders, inject } from '@angular/core';
import { EntityState, createEntityAdapter } from '@ngrx/entity';
import { Actions, createEffect, ofType, provideEffects } from '@ngrx/effects';
import { concatLatestFrom } from '@ngrx/operators';
import {
  Store,
  createAction,
  createFeatureSelector,
  createReducer,
  createSelector,
  on,
  props,
  provideState,
} from '@ngrx/store';
import { catchError, concatMap, filter, map, of, switchMap } from 'rxjs';
import { API } from '../api-service';
import { CollectionKey } from '../mock-db/mock-db';

/**
 * The inverse of one optimistic write, kept until its round trip settles.
 *
 * `restore` are the rows exactly as they were before the write, `discard` the
 * ids that did not exist before it and must be dropped again if it fails.
 */
export interface Rollback<T> {
  restore: T[];
  discard: string[];
  /** Set by `remove`. If that write fails, the row is back in the collection and
   *  there is nothing to undo, so the buffer has to go with it — otherwise the
   *  slice holds a stale row that no code path can reach but every reader can
   *  see. */
  clearsUndo?: boolean;
}

export interface CollectionState<T> extends EntityState<T> {
  /** A read is in flight. */
  loading: boolean;
  /** A write is in flight — bind this to disable a submit button. */
  saving: boolean;
  loaded: boolean;
  error: string | null;
  /**
   * FIFO queue of inverses for the writes currently in flight. Writes are
   * applied to the entity map the moment they are dispatched and confirmed or
   * undone when the round trip returns, so a row appears immediately instead of
   * after the simulated latency.
   *
   * FIFO is sound because the write effects use `concatMap`: one request is in
   * flight at a time and outcomes come back in dispatch order, so the head of
   * the queue always belongs to the outcome being handled.
   */
  pending: Rollback<T>[];
  /** The most recently removed row, held so `undoRemove` can put it back. */
  undoBuffer: T | null;
  /** True only between a confirmed removal and the undo of it. Read
   *  `selectors.undoable`, which folds this together with the buffer. */
  canUndo: boolean;
}

interface HasId {
  id: string;
}

/**
 * A dozen modules times (actions + reducer + selectors + effects) is a dozen
 * copies of the same code. This factory produces a typed, @ngrx/entity-backed
 * bundle so each module's store file stays about fifteen lines. Modules needing
 * extra state compose on top of this rather than forking it.
 */
export function createCollectionFeature<T extends HasId>(config: {
  /** Feature state key, e.g. 'orders'. */
  name: string;
  /** Key into the central mock database. */
  collection: CollectionKey;
  sortComparer?: (a: T, b: T) => number;
}) {
  const adapter = createEntityAdapter<T>({
    sortComparer: config.sortComparer ?? false,
  });

  const initialState: CollectionState<T> = adapter.getInitialState({
    loading: false,
    saving: false,
    loaded: false,
    error: null,
    pending: [] as Rollback<T>[],
    undoBuffer: null as T | null,
    canUndo: false,
  });

  // Built with createAction rather than createActionGroup: the latter requires a
  // string-literal `source`, which a generic factory cannot supply.
  const actions = {
    /** Always refetches. */
    load: createAction(`[${config.name}] load`),
    /** Fetches only if not already loaded or loading — use this from components. */
    ensureLoaded: createAction(`[${config.name}] ensure loaded`),
    loadSuccess: createAction(`[${config.name}] load success`, props<{ items: T[] }>()),
    loadFailure: createAction(`[${config.name}] load failure`, props<{ error: string }>()),

    upsert: createAction(`[${config.name}] upsert`, props<{ item: T }>()),
    upsertSuccess: createAction(`[${config.name}] upsert success`, props<{ item: T }>()),
    upsertMany: createAction(`[${config.name}] upsert many`, props<{ items: T[] }>()),
    upsertManySuccess: createAction(
      `[${config.name}] upsert many success`,
      props<{ items: T[] }>(),
    ),
    remove: createAction(`[${config.name}] remove`, props<{ id: string }>()),
    removeSuccess: createAction(`[${config.name}] remove success`, props<{ id: string }>()),
    /** Puts the last removed row back. Prop-less on purpose: the row it restores
     *  is the one the slice is holding, never one a caller can substitute. */
    undoRemove: createAction(`[${config.name}] undo remove`),
    /** Withdraws the undo offer without acting on it. A reducer cannot read a
     *  clock, so the expiry is timed by `watchUndoExpiry` and lands here. */
    dismissUndo: createAction(`[${config.name}] dismiss undo`),

    // Writes get their own failure action. Folding them into loadFailure would
    // corrupt the slice's read semantics — a failed save would leave a list page
    // claiming it failed to load.
    upsertFailure: createAction(`[${config.name}] upsert failure`, props<{ error: string }>()),

    /** Dismisses a failure message. Separate from `upsertFailure({error: ''})`,
     *  which would look like a write failing and roll a good write back. */
    clearError: createAction(`[${config.name}] clear error`),
  };

  /** The inverse of writing `ids`: whatever is there now goes back, whatever is
   *  new gets dropped. */
  function inverseOf(state: CollectionState<T>, ids: string[]): Rollback<T> {
    const restore: T[] = [];
    const discard: string[] = [];
    for (const id of ids) {
      const existing = state.entities[id];
      if (existing) {
        restore.push(existing);
      } else {
        discard.push(id);
      }
    }
    return { restore, discard };
  }

  function enqueue(state: CollectionState<T>, rollback: Rollback<T>): CollectionState<T> {
    return { ...state, saving: true, error: null, pending: [...state.pending, rollback] };
  }

  /** Drop the head of the queue: its write landed, so its inverse is dead. */
  function settle(state: CollectionState<T>): CollectionState<T> {
    const pending = state.pending.slice(1);
    return { ...state, pending, saving: pending.length > 0 };
  }

  /** Drop the head of the queue and apply it: its write failed. */
  function revert(state: CollectionState<T>, error: string): CollectionState<T> {
    const [head, ...pending] = state.pending;
    const next = { ...state, pending, saving: pending.length > 0, error };
    if (!head) {
      return next;
    }
    const restored = head.clearsUndo ? { ...next, undoBuffer: null, canUndo: false } : next;
    return adapter.upsertMany(head.restore, adapter.removeMany(head.discard, restored));
  }

  const reducer = createReducer(
    initialState,
    on(actions.load, (state) => ({ ...state, loading: true, error: null })),
    on(actions.loadSuccess, (state, { items }) =>
      adapter.setAll(items, { ...state, loading: false, loaded: true }),
    ),
    on(actions.loadFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error,
    })),

    // Optimistic: the entity map changes now, the round trip only confirms it.
    on(actions.upsert, (state, { item }) =>
      adapter.upsertOne(item, enqueue(state, inverseOf(state, [item.id]))),
    ),
    on(actions.upsertMany, (state, { items }) =>
      adapter.upsertMany(
        items,
        enqueue(
          state,
          inverseOf(
            state,
            items.map((item) => item.id),
          ),
        ),
      ),
    ),
    on(actions.remove, (state, { id }) => {
      const existing = state.entities[id] ?? null;
      return adapter.removeOne(id, {
        ...enqueue(state, {
          restore: existing ? [existing] : [],
          discard: [],
          clearsUndo: true,
        }),
        undoBuffer: existing,
        // Not undoable until the removal is confirmed; offering undo for a write
        // that may still fail would race the rollback.
        canUndo: false,
      });
    }),
    // Gated on `undoBuffer` alone, never on `canUndo`. The effect has to make the
    // same call and only ever sees post-reducer state, so the two would disagree
    // about whether an undo happened the moment this reducer cleared `canUndo` —
    // and a write with no queued inverse pops someone else's off the queue.
    // `undoBuffer` is the one field both can read the same answer from.
    on(actions.undoRemove, (state) => {
      const item = state.undoBuffer;
      if (!item) {
        return state;
      }
      return adapter.upsertOne(item, {
        ...enqueue(state, { restore: [], discard: [item.id] }),
        canUndo: false,
      });
    }),

    // The server's version replaces the optimistic one — it may have normalised
    // fields the caller did not set.
    on(actions.upsertSuccess, (state, { item }) => adapter.upsertOne(item, settle(state))),
    on(actions.upsertManySuccess, (state, { items }) => adapter.upsertMany(items, settle(state))),
    on(actions.removeSuccess, (state, { id }) =>
      adapter.removeOne(id, { ...settle(state), canUndo: state.undoBuffer !== null }),
    ),
    on(actions.upsertFailure, (state, { error }) => revert(state, error)),
    on(actions.clearError, (state) => ({ ...state, error: null })),
    // Drops the buffer as well as the flag: an offer nobody can accept any more
    // has no reason to keep holding the row.
    on(actions.dismissUndo, (state) => ({ ...state, undoBuffer: null, canUndo: false })),
  );

  const selectState = createFeatureSelector<CollectionState<T>>(config.name);
  const entitySelectors = adapter.getSelectors(selectState);

  // No `byId(id)` / `where(fn)` factories here on purpose: calling a selector
  // factory inside a `computed` allocates a new selector on every read and
  // throws away memoisation. Read `all` once and narrow it with a `computed`.
  const selectors = {
    state: selectState,
    all: entitySelectors.selectAll,
    entities: entitySelectors.selectEntities,
    total: entitySelectors.selectTotal,
    loading: createSelector(selectState, (state) => state.loading),
    saving: createSelector(selectState, (state) => state.saving),
    loaded: createSelector(selectState, (state) => state.loaded),
    error: createSelector(selectState, (state) => state.error),
    /** The row an undo would put back, or null when there is nothing to undo.
     *  Bind an undo banner to this rather than to `undoBuffer`. */
    undoable: createSelector(selectState, (state) => (state.canUndo ? state.undoBuffer : null)),
  };

  const effects = {
    load: createEffect(
      (actions$ = inject(Actions), api = inject(API)) =>
        actions$.pipe(
          ofType(actions.load),
          switchMap(() =>
            api.list<T>(config.collection).pipe(
              map((items) => actions.loadSuccess({ items })),
              catchError((error: unknown) => of(actions.loadFailure({ error: describe(error) }))),
            ),
          ),
        ),
      { functional: true },
    ),

    // Collapses the refetch-on-every-navigation problem: several components can
    // dispatch this on init and only the first one causes a request.
    ensureLoaded: createEffect(
      (actions$ = inject(Actions), store = inject(Store)) =>
        actions$.pipe(
          ofType(actions.ensureLoaded),
          concatLatestFrom(() => store.select(selectState)),
          // Optional chaining is load-bearing: if a component dispatches this
          // for a collection whose `provideCollection` lives on a sibling route,
          // the slice is not registered and `state` is undefined. Without `?.`
          // the effect throws and the load is silently lost.
          filter(([, state]) => !state?.loaded && !state?.loading),
          map(() => actions.load()),
        ),
      { functional: true },
    ),

    // concatMap, not switchMap: two writes dispatched in quick succession must
    // both reach the database. switchMap would cancel the first — and it is also
    // what makes the FIFO rollback queue correct.
    upsert: createEffect(
      (actions$ = inject(Actions), api = inject(API)) =>
        actions$.pipe(
          ofType(actions.upsert),
          concatMap(({ item }) =>
            api.update<T>(config.collection, item).pipe(
              map((saved) => actions.upsertSuccess({ item: saved })),
              catchError((error: unknown) => of(actions.upsertFailure({ error: describe(error) }))),
            ),
          ),
        ),
      { functional: true },
    ),

    upsertMany: createEffect(
      (actions$ = inject(Actions), api = inject(API)) =>
        actions$.pipe(
          ofType(actions.upsertMany),
          concatMap(({ items }) =>
            api.putMany<T>(config.collection, items).pipe(
              map((saved) => actions.upsertManySuccess({ items: saved })),
              catchError((error: unknown) => of(actions.upsertFailure({ error: describe(error) }))),
            ),
          ),
        ),
      { functional: true },
    ),

    remove: createEffect(
      (actions$ = inject(Actions), api = inject(API)) =>
        actions$.pipe(
          ofType(actions.remove),
          concatMap(({ id }) =>
            api.remove(config.collection, id).pipe(
              map((removed) => actions.removeSuccess({ id: removed })),
              catchError((error: unknown) => of(actions.upsertFailure({ error: describe(error) }))),
            ),
          ),
        ),
      { functional: true },
    ),

    // Reads `undoBuffer`, not `undoable`: the reducer has already cleared
    // `canUndo` by the time an effect sees the action, and the buffer is what
    // survives it.
    undoRemove: createEffect(
      (actions$ = inject(Actions), api = inject(API), store = inject(Store)) =>
        actions$.pipe(
          ofType(actions.undoRemove),
          concatLatestFrom(() => store.select(selectState)),
          map(([, state]) => state?.undoBuffer ?? null),
          filter((item): item is T => item !== null),
          concatMap((item) =>
            api.putMany<T>(config.collection, [item]).pipe(
              map((saved) => actions.upsertManySuccess({ items: saved })),
              catchError((error: unknown) => of(actions.upsertFailure({ error: describe(error) }))),
            ),
          ),
        ),
      { functional: true },
    ),
  };

  return { name: config.name, adapter, actions, reducer, selectors, effects, initialState };
}

export type CollectionFeature<T extends HasId> = ReturnType<typeof createCollectionFeature<T>>;

/** Route-level providers, so each module's slice loads with its routes. */
export function provideCollection<T extends HasId>(
  feature: CollectionFeature<T>,
): EnvironmentProviders[] {
  return [provideState(feature.name, feature.reducer), provideEffects(feature.effects)];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
