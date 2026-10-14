import { describe, expect, it } from 'vitest';
import { CollectionState, createCollectionFeature } from './collection-feature';

/**
 * Reducer-level tests for the optimistic write queue and undo.
 *
 * Pure, like `agreement-rules.spec.ts`: no TestBed, no store, no effects. The
 * whole point of keeping the rollback logic in the reducer is that it can be
 * driven by feeding it actions, which is what makes the tail cases — a failure
 * behind a success, an undo, a dismissed error — cheap to assert.
 */

interface Row {
  id: string;
  name: string;
}

// `seasons` is only the collection key the effects would use; the reducer under
// test never touches it.
const feature = createCollectionFeature<Row>({ name: 'rows', collection: 'seasons' });
const { actions, reducer, selectors, initialState } = feature;

const ALPHA: Row = { id: 'r1', name: 'Alpha' };
const BETA: Row = { id: 'r2', name: 'Beta' };

function loaded(...rows: Row[]): CollectionState<Row> {
  return reducer(initialState, actions.loadSuccess({ items: rows }));
}

function rowsOf(state: CollectionState<Row>): Row[] {
  return selectors.all.projector(state);
}

describe('collection feature — optimistic writes', () => {
  it('applies an edit to the entity map before the round trip returns', () => {
    const state = reducer(loaded(ALPHA), actions.upsert({ item: { ...ALPHA, name: 'Edited' } }));

    expect(rowsOf(state)).toEqual([{ id: 'r1', name: 'Edited' }]);
    expect(state.saving).toBe(true);
    expect(state.pending).toHaveLength(1);
  });

  it('puts the previous version back when the write fails', () => {
    let state = loaded(ALPHA);
    state = reducer(state, actions.upsert({ item: { ...ALPHA, name: 'Edited' } }));
    state = reducer(state, actions.upsertFailure({ error: 'network down' }));

    expect(rowsOf(state)).toEqual([ALPHA]);
    expect(state.error).toBe('network down');
    expect(state.saving).toBe(false);
    expect(state.pending).toHaveLength(0);
  });

  it('drops a newly created row when its write fails, rather than restoring nothing', () => {
    let state = loaded(ALPHA);
    state = reducer(state, actions.upsertMany({ items: [BETA] }));
    expect(rowsOf(state)).toEqual([ALPHA, BETA]);

    state = reducer(state, actions.upsertFailure({ error: 'rejected' }));
    expect(rowsOf(state)).toEqual([ALPHA]);
  });

  it('keeps the server version on success, not the optimistic one', () => {
    let state = loaded(ALPHA);
    state = reducer(state, actions.upsert({ item: { ...ALPHA, name: 'Edited' } }));
    state = reducer(state, actions.upsertSuccess({ item: { id: 'r1', name: 'Normalised' } }));

    expect(rowsOf(state)).toEqual([{ id: 'r1', name: 'Normalised' }]);
    expect(state.pending).toHaveLength(0);
    expect(state.saving).toBe(false);
  });

  it('rolls back only the failed write when two are in flight', () => {
    let state = loaded(ALPHA, BETA);
    state = reducer(state, actions.upsert({ item: { ...ALPHA, name: 'A2' } }));
    state = reducer(state, actions.upsert({ item: { ...BETA, name: 'B2' } }));
    expect(state.pending).toHaveLength(2);

    // The effects use concatMap, so outcomes arrive in dispatch order: the first
    // write fails, the second still succeeds.
    state = reducer(state, actions.upsertFailure({ error: 'first failed' }));
    state = reducer(state, actions.upsertSuccess({ item: { id: 'r2', name: 'B2' } }));

    expect(rowsOf(state)).toEqual([ALPHA, { id: 'r2', name: 'B2' }]);
    expect(state.pending).toHaveLength(0);
    expect(state.saving).toBe(false);
  });

  it('stays saving until every queued write has settled', () => {
    let state = loaded(ALPHA, BETA);
    state = reducer(state, actions.upsert({ item: { ...ALPHA, name: 'A2' } }));
    state = reducer(state, actions.upsert({ item: { ...BETA, name: 'B2' } }));

    state = reducer(state, actions.upsertSuccess({ item: { id: 'r1', name: 'A2' } }));
    expect(selectors.saving.projector(state)).toBe(true);

    state = reducer(state, actions.upsertSuccess({ item: { id: 'r2', name: 'B2' } }));
    expect(selectors.saving.projector(state)).toBe(false);
  });

  it('clears an error message without disturbing a write in flight', () => {
    let state = loaded(ALPHA);
    state = reducer(state, actions.upsert({ item: { ...ALPHA, name: 'Edited' } }));
    state = reducer(state, actions.upsertFailure({ error: 'network down' }));
    state = reducer(state, actions.upsert({ item: { ...ALPHA, name: 'Retry' } }));

    state = reducer(state, actions.clearError());

    // The bug this guards: dismissing with `upsertFailure({error: ''})` would pop
    // the retry's inverse off the queue and undo a write that had not failed.
    expect(state.error).toBeNull();
    expect(state.pending).toHaveLength(1);
    expect(rowsOf(state)).toEqual([{ id: 'r1', name: 'Retry' }]);
  });
});

describe('collection feature — remove and undo', () => {
  it('removes from the entity map immediately', () => {
    const state = reducer(loaded(ALPHA, BETA), actions.remove({ id: 'r1' }));

    expect(rowsOf(state)).toEqual([BETA]);
    expect(state.saving).toBe(true);
  });

  it('offers no undo until the removal is confirmed', () => {
    let state = reducer(loaded(ALPHA), actions.remove({ id: 'r1' }));
    expect(selectors.undoable.projector(state)).toBeNull();

    state = reducer(state, actions.removeSuccess({ id: 'r1' }));
    expect(selectors.undoable.projector(state)).toEqual(ALPHA);
  });

  it('restores the row on undo and withdraws the offer', () => {
    let state = loaded(ALPHA, BETA);
    state = reducer(state, actions.remove({ id: 'r1' }));
    state = reducer(state, actions.removeSuccess({ id: 'r1' }));

    state = reducer(state, actions.undoRemove());
    expect(
      rowsOf(state)
        .map((row) => row.id)
        .sort(),
    ).toEqual(['r1', 'r2']);
    expect(selectors.undoable.projector(state)).toBeNull();

    state = reducer(state, actions.upsertManySuccess({ items: [ALPHA] }));
    expect(
      rowsOf(state)
        .map((row) => row.id)
        .sort(),
    ).toEqual(['r1', 'r2']);
    expect(state.saving).toBe(false);
  });

  it('takes the row away again if the undo itself fails', () => {
    let state = loaded(ALPHA);
    state = reducer(state, actions.remove({ id: 'r1' }));
    state = reducer(state, actions.removeSuccess({ id: 'r1' }));
    state = reducer(state, actions.undoRemove());

    state = reducer(state, actions.upsertFailure({ error: 'undo failed' }));
    expect(rowsOf(state)).toEqual([]);
    expect(state.error).toBe('undo failed');
  });

  it('puts the row back when the removal fails, and offers no undo for it', () => {
    let state = loaded(ALPHA);
    state = reducer(state, actions.remove({ id: 'r1' }));
    state = reducer(state, actions.upsertFailure({ error: 'could not delete' }));

    expect(rowsOf(state)).toEqual([ALPHA]);
    expect(selectors.undoable.projector(state)).toBeNull();
    // Not merely unreachable — actually dropped. A failed removal leaves the row
    // in the collection, so a buffered copy of it is stale state that every
    // reader of the slice can still see.
    expect(state.undoBuffer).toBeNull();
  });

  it('keeps the buffer when some other write fails behind a removal', () => {
    let state = loaded(ALPHA, BETA);
    state = reducer(state, actions.remove({ id: 'r1' }));
    state = reducer(state, actions.removeSuccess({ id: 'r1' }));
    // A later, unrelated write fails. Its rollback is not the removal's, so the
    // undo offer must survive it.
    state = reducer(state, actions.upsert({ item: { ...BETA, name: 'B2' } }));
    state = reducer(state, actions.upsertFailure({ error: 'unrelated' }));

    expect(selectors.undoable.projector(state)).toEqual(ALPHA);
    expect(rowsOf(state)).toEqual([BETA]);
  });

  it('withdraws the offer on dismissUndo, buffer and all', () => {
    let state = loaded(ALPHA);
    state = reducer(state, actions.remove({ id: 'r1' }));
    state = reducer(state, actions.removeSuccess({ id: 'r1' }));
    expect(selectors.undoable.projector(state)).toEqual(ALPHA);

    state = reducer(state, actions.dismissUndo());
    expect(selectors.undoable.projector(state)).toBeNull();
    expect(state.undoBuffer).toBeNull();
    // The row stays removed — dismissing an offer is not the same as taking it.
    expect(rowsOf(state)).toEqual([]);
  });

  it('makes a dismissed undo unusable, not merely invisible', () => {
    let state = loaded(ALPHA);
    state = reducer(state, actions.remove({ id: 'r1' }));
    state = reducer(state, actions.removeSuccess({ id: 'r1' }));
    state = reducer(state, actions.dismissUndo());

    const before = state;
    state = reducer(state, actions.undoRemove());
    expect(state).toBe(before);
    expect(rowsOf(state)).toEqual([]);
  });

  it('is a no-op when there is nothing buffered, so the queue is not disturbed', () => {
    let state = loaded(ALPHA);
    state = reducer(state, actions.upsert({ item: { ...ALPHA, name: 'Edited' } }));

    const before = state;
    state = reducer(state, actions.undoRemove());

    // The effect gates on the same field, so reducer and effect agree that
    // nothing happened — an enqueue here would pop the edit's inverse instead.
    expect(state).toBe(before);
    expect(state.pending).toHaveLength(1);
  });

  it('offers only the most recent removal', () => {
    let state = loaded(ALPHA, BETA);
    state = reducer(state, actions.remove({ id: 'r1' }));
    state = reducer(state, actions.removeSuccess({ id: 'r1' }));
    state = reducer(state, actions.remove({ id: 'r2' }));
    state = reducer(state, actions.removeSuccess({ id: 'r2' }));

    expect(selectors.undoable.projector(state)).toEqual(BETA);
  });
});
