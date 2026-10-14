# Module recipe — copy Sharecropping Agreements

**Sharecropping Agreements is the reference module.** It is implemented end to
end; every other module in `core/module-registry.ts` should be brought up to the
same shape by copying it. Read this with
`src/app/features/agreements/` open beside you.

**Advances & Loans is the worked example.** It was built from this recipe and
follows it part for part, so `src/app/features/advances/` is what "copied
correctly" looks like — including the two places it had to depart from the
reference, both noted below.

---

## What "complete" means

A module is complete when it has all seven of these. Not six.

| # | Piece | The reference's version |
|---|---|---|
| 1 | Pure rules file, no Angular imports | `agreement-rules.ts` |
| 2 | Unit tests for those rules | `agreement-rules.spec.ts` (33 tests) |
| 3 | List page: KPI row, table, role-gated queue | `agreement-list.ts` + `.html` + `.css` |
| 4 | Detail page: full record + the decision | `agreement-detail.ts` + `.html` + `.css` |
| 5 | Write form in a modal | `agreement-form.ts` + `.html` + `.css` |
| 6 | Audit entry on every write | `AuditLogService.record(...)` |
| 7 | Both routes registered with scoped state | `app.routes.ts`, `path: 'agreements'` |

Generate each page with
`ng generate component features/<module>/<name> --flat` and fill in the three
files it creates. **No component in this app uses an inline `template:` or
`styles:`** — markup lives in `.html`, component-scoped styles in `.css`, logic
in `.ts`. The schematics defaults in `angular.json` enforce it for anything
generated:

```json
"@schematics/angular:component": {
  "changeDetection": "OnPush",
  "inlineStyle": false,
  "inlineTemplate": false,
  "style": "css"
}
```

Note that `.claude/CLAUDE.md` — written by `ng new` — says "prefer inline
templates for small components". This project overrides that; see the note at the
bottom of that file.

## 1. Rules go in a pure file, never in a component

`agreement-rules.ts` exports plain functions over plain data — no `inject`, no
signals, no store, no Angular import at all. Everything a rule needs arrives
through `AgreementContext`. That is why 33 tests run in 31 ms with no TestBed,
and why the three components are close to pure markup.

The rules it actually holds:

- **Crop must suit the land type.** Paddy on Dhani, potato and vegetables on
  Vita. Lane 1 of the activity diagram draws this as a gate; here it is data —
  `Crop.suitableLandTypes`.
- **A variety must belong to its crop.** The form only lists the right ones, so
  this only fires if the crop is changed after the variety.
- **The start date must fall inside the season window.**
- **A plot cannot be committed twice in one season.** Only `pending` and
  `active` agreements hold a plot (`HOLDING_STATUSES`) — a rejected or revoked
  one does not, which is the exemption every domain has.
- **The owner's share must be 20–80%** under the Normal model.
- **Tevaga gives the owner one share of 3 to 5**, and the sharecropper bears
  every cost line. A half share is not Tevaga — the seeded `BRG-2025-004` was
  rejected for exactly that.
- **The advance (dadhon) is capped at ৳ 200 per decimal of the plot.** A larger
  advance than the land can repay is how a tenant ends up bonded and the
  settlement path can never clear it.

## 2. Test the rules, not the template

One test per rule, plus the negative case and the inverse. The valuable ones
here are: a rejected agreement does *not* block the plot; an agreement does not
clash with itself while being edited; the same plot is fine in a different
season; an advance exactly at the ceiling is allowed; and

```ts
expect(releaseLand(claimLand(DHANI, 'agr-9'), 'agr-9')).toEqual(DHANI);
```

which is what proves a revoke restores the plot exactly.

## 3. The write form

`agreement-form.ts` is a `ui-modal` wrapping a reactive form. It renders errors,
it does not compute them — `validateAgreement` does. Errors appear only after a
submit attempt (`attempted()`), and the consequence is shown live: *"Expected
harvest 48 maund — owner 24 maund, sharecropper 24 maund."*

Two things worth copying exactly:

- `valueChanges` is typed `Partial<T>`, so `draft()` re-defaults every field.
  Spreading `this.value()` straight into the draft does not typecheck.
- **New records are dispatched with `upsertMany`, not `upsert`.** `upsert` calls
  `update()`, which cannot find an id the mock database has never seen, and it
  fails *silently* into the slice's `error`.
- **Dismiss an error with `clearError()`, never `upsertFailure({ error: '' })`.**
  Writes are optimistic now, so `upsertFailure` pops the head of the rollback
  queue and applies it — dismissing a stale message that way silently undoes a
  write that had actually succeeded.
- **Dates come from `SessionClock`, not `new Date()`.** `today()`, `year()` and
  `stamp()` cover every case the reference module needed. A raw `new Date()` puts
  the record a year away from the seed it belongs beside.

The form also *avoids* the land-clash rule rather than scolding about it:
`availableLands()` drops plots already committed for the chosen season. The rule
still exists for the case where two people submit at once.

## 4. Decisions live on the detail page

The list's queue links through; it does not decide inline. A one-click approve in
a table row cannot capture a reason and hides the consequence.

Approving does three things, in this order:

1. **The record** — `status: 'active'`, `decidedBy`, `decidedOn`.
2. **The related data** — `claimLand()` marks the plot held, `cycleForAgreement()`
   opens the cultivation cycle that Lane 3 hangs every activity off, and
   `advanceForAgreement()` opens the dadhon ledger row that Lane 5 deducts
   against.
3. **The audit entry.**

`revoke()` is the inverse: releases the plot (only if this agreement holds it),
aborts the cycle, and requires a reason. `reject()` moves nothing else, because a
pending agreement never claimed anything.

`canDecide()` is re-asserted inside `approve()` rather than trusted from the
disabled button — a tab left open while someone else decided would otherwise
decide twice.

## 4b. Deleting, and undoing it

Most modules should not delete anything. The reference module deletes exactly one
thing — a **draft**, which was never submitted, so no plot is held, no cycle was
opened and no ledger row exists. Everything else is retired by changing its
status, because a decided record has to stay readable.

Where a module does need `remove`, the factory already carries the undo:

```ts
// detail page — delete, then leave for the list, where the banner lives
this.store.dispatch(feature.actions.remove({ id: row.id }));
this.router.navigate(['/module']);

// list page
protected readonly undoable = this.store.selectSignal(feature.selectors.undoable);
protected undo(): void { this.store.dispatch(feature.actions.undoRemove()); }
```

`undoable` is null until the removal is **confirmed** — offering undo while the
write might still fail would race the rollback. An undo is a write, so it gets
its own audit row like any other.

Call `watchUndoExpiry(feature)` in the list component's constructor, or the offer
sits there until another removal replaces it.

**An undo that is not a removal stays on the component.** Advances offers back a
*repayment*, which is an ordinary `upsert` of the inverse — there is no slice
state for it, because it is undone on the page where it was made rather than
after a navigation. Two things that pattern needs:

- Remember the value the write produced (`outstandingAfter`), and withdraw the
  offer if the record no longer matches. Otherwise a second write, or a reload,
  lets the same undo fire against a different balance and invent money.
- Reuse `UNDO_TIMEOUT_MS` so both kinds of offer live the same length of time.

## 5. Role gating

Three roles, read straight off the activity diagram's Lane 1 (Login →
Authenticated?) and the parties an agreement names:

| Role | Comes from | May |
|---|---|---|
| `admin` | the approving actor in Lane 2 (`Agreement Approved?`) | decide, see every module and the audit trail |
| `owner` | the land owner party | draft and submit for their own land |
| `sharecropper` | the tenant party | read only their own agreements |

Gate actions with capability signals on `SessionService` (`canApproveAgreement`,
`canDraftAgreement`), never by comparing role names in a template. **Never render
a link a role cannot follow** — `roleGuard` enforces the same `roles` list the
sidebar filters on, so a hidden module is unreachable by URL too.

## 6. Routes

```ts
{
  path: 'agreements',
  providers: [
    ...provideCollection(agreementsFeature),
    ...provideCollection(landsFeature),
    // …every collection both pages read
  ],
  children: [
    { path: '',    title: 'Sharecropping Agreements · Krishi', loadComponent: … },
    { path: ':id', title: 'Agreement · Krishi',                loadComponent: … },
  ],
}
```

Providers on the parent, so the list and the detail page share one registration
and navigating between them does not refetch. Route params arrive as inputs
because `app.config.ts` includes `withComponentInputBinding()`.

---

## A rule two modules share goes in `core/rules/`

The dadhon ceiling is enforced twice: Sharecropping Agreements caps the advance
offered at signing, Advances & Loans caps every mid-season draw on top of it. It
lives in `core/rules/dadhon.ts` and both import it, because two copies of the
same ceiling is how two modules end up disagreeing about one limit — and the
disagreement would only surface at settlement.

`agreement-rules.ts` re-exports `ADVANCE_PER_DECIMAL` and `advanceCeiling`, so
that module's callers still have one place to import its rules from. Do the same
rather than making callers know which rule came from where.

**Where the worked example departs from the reference**, and why:

- Its list filters an owner's rows **through the agreement**, not off the record.
  A ledger row names the tenant, not the landlord, so `row.ownerId` does not
  exist to filter on.
- Its detail page carries a **second** write — recording a repayment — beside the
  approve/refuse decision. A module whose record has a balance needs the action
  that reduces it, and `applyRepayment` / `reverseRepayment` are the inverse pair
  that proves it, exactly as `claimLand` / `releaseLand` do for a plot.

## Remaining modules

**None.** Every entry in `core/module-registry.ts` is built.

## Where the recipe was departed from, and why

The seven-part shape assumes a module with a **decision**. Twelve of the
eighteen do not have one, and forcing the shape on them would have invented
domain. Each departure is deliberate:

| Shape | Modules | Why |
|---|---|---|
| No decision panel; integrity instead | Seasons, Lands, Crops & Varieties, Owners & Sharecroppers | Reference data has no approval step. What it needs is that a row other records point at cannot be deleted or edited out from under them — so each has a `deletionBlocker` that names the records, rather than a disabled button. |
| No detail route | Calendar, Activities, Monitoring, Harvests, Post-Harvest, Inventory, Sales, Disputes, Finance | A task, an expense, an observation, a batch, a lot, a sale and a ledger line are each one row with nothing more to show on a page of their own. Their actions belong inline. |
| No form, no rules file | Reports | Nothing to submit and nothing to decide. Every figure is derived from the collections rather than stored, so a report cannot drift out of step with the records it summarises. |

What did **not** get departed from, anywhere: a pure rules file with a spec, an
audit entry per write, and an inverse for every action that moves a number.

## Traps that already cost time here

- Move a component's `.ts`, `.html` and `.css` together — `templateUrl` resolves
  relative to the `.ts`, and the build error names the *template*, not the move.
- A `<select>` under reactive forms takes `formControlName` on the select and
  plain `[value]` on the options. Do not touch `selected`;
  `SelectControlValueAccessor` owns the value and will fight you on the next
  write.
- `ui-modal` projects footer actions through `[modalActions]`, which is outside
  the `<form>`. The submit button therefore carries `form="agreement-form"` —
  drop that attribute and the button silently stops submitting.
- Verify write flows with **in-app navigation only**. `page.goto` is a full
  reload, which resets the in-memory database to seed and makes a working feature
  look broken.

## Before you call a module done

- [ ] `ng build` clean, no warnings
- [ ] `ng test --watch=false` green, including the new rules tests
- [ ] Walked the whole loop in a browser: submit → appears in the approver's
      queue → decide → related data moved → audit row written
- [ ] Checked at 1440 px and 390 px
- [ ] **AXE clean** on every state the module can be in — list, detail, the modal
      open, and the list under each role that can reach it. `.claude/CLAUDE.md`
      requires this and it is easy to skip, because nothing fails without it.
      `@axe-core/playwright` with tags
      `wcag2a wcag2aa wcag21a wcag21aa best-practice`. Scan the modal **open**:
      the two real defects the first scan found were both outside the module
      under test, and one of them only appears when the sidebar is on screen.
- [ ] Deleted the verification screenshots
