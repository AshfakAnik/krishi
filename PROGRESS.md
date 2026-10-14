# Krishi — progress

Status: **every module in the registry is built, walked and scanned.** No stubs
left. Build clean, 319 tests green, 79 browser assertions green, AXE clean
across 41 states.

## How to run it

```bash
cd krishi-app
npm install
ng serve            # http://localhost:4200
ng test --watch=false
ng build
```

Sign in as anyone — there is no password. The role decides what the app allows:

| Sign in as | Sees |
|---|---|
| Rezaul Karim (Administrator) | Everything, the approval queue, the audit trail |
| Ashfakul Alam / Nurul Haque Mridha (Land Owner) | Their own land's agreements; can draft and submit |
| Abdul Malek / Jashim Uddin / Monir Hossain / Shahjahan Sheikh (Sharecropper) | Only the agreements they are party to; cannot draft or decide |

`BRG-2025-003` starts out pending, so the approve path can be demonstrated
straight from a cold reload.

## Done

- **Foundation** — Angular 21 (zoneless, standalone, signals), NgRx 21
  (store + entity + effects + devtools), Tailwind v4 with a green agriculture
  token set, Vitest.
- **Every file created with `ng generate`**; `angular.json` pins
  `inlineTemplate: false`, `inlineStyle: false`, `changeDetection: OnPush`, so
  every component is a `.ts` + `.html` + `.css` set.
- **Mock database** — 9 collections, seeded from the activity diagram's
  vocabulary, all dates derived from a fixed anchor so numbers are stable across
  reloads. Seeded *states*, not just rows: two active agreements (one Normal, one
  Tevaga), one pending, one rejected, one draft.
- **Shared UI** — 11 components in `shared/ui/`, none of which imports a store,
  an entity, or anything from `features/`.
- **Sign-in and access** — `authGuard`, `guestGuard`, and a `roleGuard` that
  enforces the same `roles` list the sidebar filters on.
- **Sharecropping Agreements** — all seven parts. See `MODULE_RECIPE.md`.
- **Advances & Loans** — all seven parts, built from the recipe. The dadhon
  ledger: request a mid-season draw against an active agreement, approve or
  refuse it, record repayments against the balance, withdraw an undecided
  request. Every draw is capped by the ৳ 200/decimal ceiling, which now lives in
  `core/rules/dadhon.ts` because both modules enforce it.
- **Audit trail** — read-only page over every write the app makes.
- **Stub page** for the 16 unbuilt modules, naming what each will do.

## Verified

`ng build` clean, no warnings. `ng test --watch=false` → **318 passed** across
20 files — one rules spec per module, plus the collection-feature reducer, the
clock and the root component.

Walked in a real browser, zero console errors, at **1440 px and 390 px**:

1. Signed in as Ashfakul Alam (owner) → sees only his 2 agreements, no approval
   queue, no audit link.
2. Drafted a new agreement on Bari Vita. Deliberately wrong first: paddy on
   homestead land, no variety, ৳ 12,000 advance on a 44-decimal plot. All three
   rules fired against the right fields and the form did not submit.
3. Corrected to vegetables / mixed winter vegetables / ৳ 8,000 — the live preview
   showed *48 maund — owner 24, sharecropper 24*. Submitted as **BRG-2025-005**,
   numbered on from the existing 004.
4. Signed in as Rezaul Karim (admin) → 6 agreements, approval queue showing 2.
5. Approved BRG-2025-005 → status Active, the advance ledger row appeared
   (৳ 8,000 outstanding), the decision panel became **Revoke**.
6. Audit trail carried both writes, with actor, role, module and detail.
7. Reopened the new-agreement form: Bari Vita was gone from the plot list for
   Aman 2025 — the plot is committed.
8. Revoked BRG-2025-002 with a reason. Tried it first with no reason and was
   blocked. After revoking, Char Boalia Dhani reappeared in the free plot list —
   the inverse released exactly the plot that agreement held.
9. Mobile: drawer nav opens and closes, KPIs stack, detail page and decision
   panel stack, no horizontal scroll anywhere.

Verification screenshots were deleted afterwards.

The four defect fixes were walked again the same way, 16 assertions, all green:

10. Discarded draft BRG-2026-001 as its owner. The row left the table 53 ms after
    the click — well inside the 250 ms round trip, which is the whole point.
11. The undo banner appeared only after the removal was confirmed, restored the
    row, then withdrew itself.
12. With the new-agreement modal open: the page header and the data table both
    had an inert ancestor, the dialog did not, and **nothing focusable outside
    the dialog remained reachable**. Escape released all of it.
13. Every audit stamp read 2025 and the whole table sorted descending — the
    discard and the restore landed at `2025-07-27 09:00`, directly after the
    last seeded row at `2025-06-09 09:20` rather than a year later.
14. No horizontal overflow at 390 px, zero console errors throughout.

**Advances & Loans** was walked the same way, 41 assertions, all green:

15. As administrator: the ledger listed all six seeded rows, the queue held
    ADV-2025-003, and the ceiling panel read ৳ 26,400 with ৳ 24,000 committed
    (৳ 15,000 + ৳ 5,000 active, ৳ 4,000 pending) and ৳ 2,400 left.
16. Approved ADV-2025-003 → status Outstanding, balance opened at ৳ 4,000, the
    decision panel gone.
17. Tried to repay ৳ 9,000 against a ৳ 4,000 balance — refused, naming the
    balance. Repaid ৳ 1,500: the row stayed open at ৳ 2,500 and the ceiling gave
    ৳ 1,500 back (৳ 3,900 free). Repaid the rest: the row closed as **Repaid**
    and stopped accepting repayments.
18. New request against BRG-2025-001. Deliberately wrong first: ৳ 9,000 with a
    one-word reason. Both rules fired — the amount named the ৳ 6,400 actually
    left, the note demanded a purpose — and the form did not submit. Corrected to
    ৳ 2,000 with a reason; the live preview showed *left after this request
    ৳ 4,400*. Submitted as **ADV-2025-007**, numbered on from the existing 006.
19. Withdrew it, the undo banner offered it back, undo restored it.
20. Signed in as Abdul Malek (sharecropper) → his six rows only, none of Jashim
    Uddin's, no approval queue, no request button.
21. All six new audit actions written, every stamp still on the seeded season.
22. Mobile: the drawer navigated to Advances and closed behind itself, KPIs
    stacked, no horizontal scroll, zero console errors.

## The full walk

**79 assertions, all green**, at 1440 px and 390 px, zero console errors.

Every one of the eighteen modules loads with its seeded data and none renders
the stub page. The chain that had never been proven as a whole — sell, prepare,
agree, and watch the dadhon come off — runs end to end: preparing STL-2025-002
previewed ৳ 6,000 coming off the sharecropper's ৳ 27,620, agreeing it moved the
ledger from ৳ 26,000 to ৳ 20,000 and raised the finance lines against it.

Each module's characteristic rule was exercised through the UI, not just its
spec: an overlapping season refused by name, an implausible harvest caught
against the expected yield, more out than in refused on a processing batch,
a sale larger than the lot refused, a pooled lot split in kind, a dispute
routed back to Farming Activities and its settlement returned to **draft**
rather than agreed. Role gating held for all three roles.

**Two defects were found and fixed by walking it**, neither of which any unit
test could have caught:

- **The seeded Lane 4 chain was unfinishable.** The session clock opened at
  `SEASON_ANCHOR + 42` — the day after the last seeded *audit* row — but the
  harvest, processing and sale seeds sit at +128 to +138. Closing the seeded
  running batch stamps today's date, and a batch cannot finish before it began,
  so the rule correctly refused and the chain dead-ended. The clock now opens
  after the last seeded event *of any kind* (+139), and `clock.spec.ts` asserts
  that against the sales seed so the next module to add seed data cannot
  reintroduce it.
- **Nine pages scrolled sideways on mobile.** `sr-only` is `position: absolute`,
  and the `<span class="sr-only">Actions</span>` in a table's last header cell
  had no positioned ancestor — so its containing block was the document root, it
  escaped the wrapper's `overflow-x-auto` clipping, and dragged the whole page
  330–445 px sideways. `relative` on each scroll wrapper contains it. Reports was
  immune only because its tables have no actions column.

## Accessibility

`@axe-core/playwright`, tags `wcag2a wcag2aa wcag21a wcag21aa best-practice`,
across **41 states**: sign-in, all eighteen module pages plus the audit trail,
**every one of the eighteen write modals with the dialog open**, a module seen
as a sharecropper, and the mobile drawer.

**0 violations.**

## Known gaps

- **`module-stub` is now dead code.** Every registry entry is `built`, so
  `stubRoutes` is an empty array and the component never loads. Left in place
  because the next module added starts as a stub again.

## Known gaps

- **Mock data resets on reload** by design. The signed-in person does not — it
  lives in `sessionStorage`. That asymmetry is deliberate but looks like a bug if
  you are not expecting it.
- **Reports are recomputed on every read.** Fine at seed scale; a real dataset
  would want them memoised or precomputed.

## Closed in the tidy-up pass

Every remaining item on the gap list that was a fix rather than a module:

- **`reverseRepayment` has a caller.** Recording a repayment on an advance now
  offers it back. The offer remembers the balance it left behind and withdraws
  itself if the row has moved on since, so a second repayment cannot be undone
  twice and a reload cannot reverse a repayment against the wrong balance. The
  case that matters is a repayment which *closed* a row: undoing it reopens the
  row as Outstanding rather than leaving a Repaid row carrying a balance.
- **The undo offer expires.** `watchUndoExpiry` withdraws it after 12 seconds.
  The timing lives beside the store rather than inside the reducer, because a
  reducer cannot read a clock and stay pure, and beside both list components
  rather than inside each, because they were about to write the same
  `setTimeout` twice.
- **A failed removal drops the buffer.** The row is back in the collection, so a
  buffered copy of it was stale state every reader of the slice could still see.
  The rollback that a `remove` queues is now marked, and reverting it clears the
  buffer along with the flag.
- **AXE is clean.** See below.

## Accessibility

`@axe-core/playwright`, tags `wcag2a wcag2aa wcag21a wcag21aa best-practice`,
across **12 states**: sign-in, both list pages as administrator, the advances
list as a sharecropper, both detail pages, the advance detail with its decision
panel and again with the repayment undo banner, both write forms with the modal
open, the audit trail, the list at 390 px, and the mobile drawer open.

**0 violations.** Two real defects were found and fixed getting there:

- **Contrast.** The sidebar's group headings were `text-ink-400` on white —
  3.12:1 at 12 px, against a 4.5:1 requirement. Moved to `text-ink-500` (5.35:1),
  along with the two `(required to …)` hints that used the same token. The
  remaining `text-ink-400` uses are decorative icons, which carry no contrast
  requirement.
- **Landmarks.** Sign-in renders outside the app shell, so it had no `main` and
  every control on it sat outside any region. It has its own `main` now; the
  shell supplies one for every other page.

## Closed since the first pass

Four defects from the original gap list, each with tests and a browser walk:

- **The modal now marks everything outside itself `inert`** — it walks from its
  own host up to `<body>` marking the siblings of each ancestor, so the whole
  document except the dialog is unreachable by pointer, Tab and screen reader.
  It skips what is already inert, so a nested modal cannot un-inert the page the
  outer one hid.
- **One `SessionClock` supplies every runtime date.** The session opens the day
  after the last seeded event (`SEASON_ANCHOR + 42`) and advances in real time,
  so a runtime audit row continues the seeded timeline instead of landing a year
  after it. Nothing outside `core/clock.ts` calls `new Date()` or `Date.now()`.
- **Writes are optimistic**, with a FIFO queue of inverses in the collection
  reducer: the entity map changes at dispatch, the round trip confirms it, and a
  failure applies exactly that write's inverse. `saving` is now "the queue is not
  empty" rather than a single flag.
- **`remove` is undoable.** The slice holds the removed row and offers it through
  `selectors.undoable` once the removal is confirmed — not before, which would
  race the rollback. A draft agreement can be discarded from its detail page and
  restored from the banner on the list.

Fixing the optimistic path exposed a latent bug: both pages dismissed an error by
dispatching `upsertFailure({ error: '' })`, which would now roll a good write
back. There is a separate `clearError` action for that.
