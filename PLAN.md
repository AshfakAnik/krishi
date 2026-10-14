# Krishi — plan

## What this is

A mock (no backend) Angular application for the **Smart Farming / Agriculture**
module drawn in
`../AshfakulAlam-Smart-Farming-ActivityDiagram.drawio` (activity diagram D6).

It is **not** a finished application. It is a foundation plus one module —
Sharecropping Agreements — built completely enough that copying it is obvious,
plus `MODULE_RECIPE.md` so the next session does not have to reverse-engineer
these choices.

## Where the domain came from

The diagram's five lanes map straight onto the navigation groups:

| Lane | Nav group |
|---|---|
| 1. Authentication & Cultivation Setup | Setup (seasons, lands, crops, people) + sign-in |
| 2. Farming Type & Sharecropping Agreement | **Agreements** ← the reference module |
| 3. Crop Lifecycle & Farming Activities | Cultivation |
| 4. Harvest, Post-Harvest, Storage & Sales | Harvest & Sales |
| 5. Settlement, Financial Accounting & Reporting | Settlement & Finance |

Vocabulary is taken from the diagram rather than invented: Dhani and Vita land
types, Normal and Tevaga sharecropping, dadhon advances, Pala stacking, market
haque, maund, decimal.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Reference module | Sharecropping Agreements | The richest complete loop in the diagram: submitted → reviewed → approved or rejected → the decision commits a plot, opens a cultivation cycle and an advance ledger. A read-only or CRUD-only module never exercises validation or cross-entity writes. |
| Second module | Advances & Loans | The closest twin to the reference, so building it tests whether `MODULE_RECIPE.md` is actually followable rather than merely descriptive. It also puts a second enforcer on the dadhon ceiling, which is what moved that rule into `core/rules/`. |
| Angular major | 21 (CLI pinned to `@angular/cli@21`) | NgRx stable is 21.1.1 and peers on Angular 21; the CLI's own latest is 22. Adopting 22 would have meant an NgRx release candidate. |
| Component file layout | Three files always (`.ts` + `.html` + `.css`) | Explicit project requirement. Enforced by `angular.json` schematics defaults; every file was created with `ng generate`. |
| Roles | admin / owner / sharecropper, with mock sign-in | Lane 1 begins at Login → Authenticated?, and Lane 2's approval step needs an actor distinct from the submitter. |
| Locale | BDT ৳, dd/MM/yyyy, local terms kept with English glosses | The domain is Bangladeshi sharecropping; translating Tevaga or haque away loses the meaning the diagram carries. |
| State | `@ngrx/store` + `entity` + `effects`, one generic collection factory | A dozen near-identical modules would otherwise be a dozen copies of the same actions/reducer/selectors/effects. |
| Data | In-memory seed, 250 ms simulated latency, resets on reload | No backend exists. The chosen signed-in person persists in `sessionStorage` — a deliberate asymmetry, so a reload does not sign you out mid-walkthrough. |
| Writes | Optimistic, with a FIFO rollback queue in the collection reducer | 250 ms of nothing happening after a submit reads as a broken button. The queue is FIFO because the write effects are `concatMap`, so outcomes return in dispatch order. |
| Deletes | Only a draft may be deleted, and the removal is undoable | Every other status is a decision that has to stay readable. A draft was never submitted, so nothing downstream refers to it. |
| Time | One `SessionClock`, opening the day after the last seeded event | The seed is anchored so its numbers are stable; stamping runtime writes with the real clock put them a year after everything else and made the audit page unreadable as a timeline. |
| Audit | One `AuditLogService.record()` per write | Turns the audit page from a fixture into a record. |

## Scope

**Built:** app shell with role-filtered grouped nav, mock database and API,
collection factory, eleven shared UI components, sign-in with guards, the
Sharecropping Agreements module (list + detail + form + rules + 33 tests), the
Advances & Loans module (list + detail + form + rules + 35 tests), the audit
trail page, and a stub page for every module not yet built.

**Not built:** the other sixteen modules in `core/module-registry.ts`. Each
routes to the stub page, which names what is planned — navigation is never
broken, and the roadmap is visible in the app itself.

Deliberately out of scope: persistence beyond the session, and any real
authentication.

Optimistic writes and undo were out of scope in the first pass and are now in —
see the decision table above. The rest of that first-pass list stands.
