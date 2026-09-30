# Puerto Banana — Arena Plan

External bot submissions: load third-party `.ts`/`.js` files, run them safely alongside the built-in strategies, validate their output, and prevent them from cheating or communicating.

---

## 1. Bot interface

Each bot is a **single file** that exports one function as its default export:

```typescript
// bots/my-bot.ts

import type { BotState } from "../src/arena/bot-types.js";

export default function myBot(state: BotState): number {
  return state.lot + 1;
}
```

The `BotState` type (read-only, no player attribution beyond what a real player would know):

```typescript
export type BotState = {
  readonly lot:      number;         // banana count on the block this round
  readonly round:    number;         // 1-indexed
  readonly myStash:  number;         // your own banana count before bids are resolved
  readonly prevBids: readonly number[] | null;  // last round's bids, sorted ascending, NO player IDs
  readonly prevLot:  number | null;  // lot size last round
};
```

Design choices:
- `prevBids` is sorted ascending with **no player attribution**. A bot cannot identify which bid came from which opponent and therefore cannot track a specific rival across rounds.
- `myStash` is included because a real player sees their own stash at the table.
- No `playerCount`, no opponent stashes — a bot can infer the field size from `prevBids.length` if it wants to, but gets no richer picture than that. *(Decided: keep it out — superfluous, makes aggressive strategies too easy.)*
- The state object is frozen before being passed in, so mutations are silently ignored (strict mode makes them throw).

---

## 2. Constraints every bot must obey

These are the rules of submission. The loader enforces what it can mechanically; the rest is on the submitter.

### Enforced by the loader
| Constraint | How enforced |
|---|---|
| Return value is a finite integer ≥ 0 | Checked after every call; bot is disqualified if violated |
| Return value ≤ `Number.MAX_SAFE_INTEGER` | Same check |
| Execution time ≤ 100 ms per call | Hard timeout via `vm` + `vm.Script` with `timeout` option |
| No access to `require`, `import`, `fs`, `net`, `process`, `fetch`, `XMLHttpRequest` | Not present in the sandbox context |
| No access to other bots' state or source | Each bot runs in its own isolated `vm.Context` |
| No persistent state between games | Context is destroyed and recreated each game |

### Enforced by convention (cannot be fully mechanically prevented)
| Constraint | Rationale |
|---|---|
| Do not intentionally throw an error to disqualify yourself strategically | A throw counts as a forfeited bid of 0; abusing this to avoid a bad round is unsportsmanlike |
| Do not read from `Date`, `Math.random`, or other non-deterministic globals | They are present but using them breaks reproducibility; the arena seeds a PRNG and passes it via state instead |
| Do not spin-wait to exhaust the timer | The timeout will catch this, but it slows the arena |
| Single-file submissions only | Multi-file bots with hidden side-channels are not accepted |

---

## 3. Sandbox design

Use Node's built-in `vm` module (no extra dependencies).

```
per game:
  for each bot:
    1. Create a fresh vm.Context with a minimal global (Math, console, a seeded rng)
    2. Compile the bot's source once into a vm.Script
    3. Run the script in context to register the default export
    4. Each round: call bot(state) inside vm.runInContext with { timeout: 100 }
    5. After the game: discard the context
```

The sandbox context contains **only**:
- `Math` (read-only copy — `Math.random` is present but using it makes the bot non-reproducible)
- `console` (live — output goes to stdout so you can review it manually) *(Decided: show console output.)*
- `exports` and `module` objects so CommonJS-style default exports work

**Why `vm` and not Worker threads?**  
Workers are heavier, require a separate file, and complicate the loader. `vm` is synchronous, composable, and sufficient because bots must be synchronous. *(Decided: no async bots.)*

**Source exposure:**  
Bot source files are loaded by path. The arena never passes a bot's file path or source text to the state object, so one bot cannot `require()` or read another bot's file even if it somehow had access to `fs`.

---

## 4. Output validation

After every bot call, before the value reaches the rules engine:

```
1. Is it a number?           → if not, forfeit (bid = 0, log warning)
2. Is it finite?             → if not, forfeit
3. Is it an integer?         → if not, Math.round() it (generous) and log a warning
4. Is it >= 0?               → if not, clamp to 0 and log a warning
5. Is it <= MAX_SAFE_INTEGER?→ if not, clamp and log a warning
```

A bot that consistently violates constraints gets flagged in the summary output. Repeated violations across games are tracked and reported.

---

## 5. File layout

```
bots/
  README.md           ← submission guide (interface, constraints, example)
  example.ts          ← reference bot (mirrors the existing "lot+1" strategy)

src/
  arena/
    bot-types.ts      ← BotState type + BotFn type (shared between loader and bots)
    bot-loader.ts     ← reads a file, compiles it, wraps it in a sandboxed caller
    arena-runner.ts   ← replaces simulator.ts's main loop; accepts mixed built-in + external bots

package.json          ← add "arena" script: node --import tsx/esm src/arena/arena-runner.ts [glob]
```

The `arena` script accepts an optional glob of bot files:
```
npm run arena                      # built-in strategies only (regression baseline)
npm run arena -- bots/*.ts         # built-in + all submitted bots
npm run arena -- bots/my-bot.ts    # one specific bot vs. the field
```

---

## 6. Changes to the existing simulator

- `simulator.ts` is **not modified**. It stays as the clean built-in benchmark.
- `arena-runner.ts` is a parallel entry point. It imports the same `makeBid` logic for the built-in strategies (refactored into `src/arena/builtin-bots.ts`) and adds external bots alongside them.
- The output format is identical to the simulator (same summary table, same crosstab) so results are directly comparable.

---

## 7. Acceptance check

A non-programmer can verify this phase by:

1. Running `npm run arena -- bots/example.ts` and seeing the example bot appear in the results table.
2. Placing a bot that returns `"banana"` instead of a number in `bots/` and confirming the arena logs a warning and bids 0 for that bot rather than crashing.
3. Placing a bot with an infinite loop in `bots/` and confirming the arena reports a timeout and continues rather than hanging.
4. Checking that two bots that both try to read `process.env` or call `require("fs")` receive `undefined` / an error, not actual data.

---

## 8. Open questions (decide before implementing)

| # | Question | Options |
|---|---|---|
| 1 | Should bots receive `playerCount`? | ✓ *No.* They can count `prevBids.length`. Superfluous info makes aggressive strategies too easy. |
| 2 | Should `__rng` be in the sandbox? | ✓ *No.* Bots may use `Math.random()`. Non-reproducibility per-game is fine; win rates average out over 10,000 games. No extra plumbing. |
| 3 | Should the arena allow async bots? | ✓ *No.* Synchronous only; the `vm` timeout is the safety net. |
| 4 | Should console output from bots be shown or suppressed? | ✓ *Show it.* Goes straight to stdout for manual review. |
| 5 | TypeScript bots: compile at load time or require pre-built JS? | ✓ *Compile at load time with `tsx`.* Ease of submission wins; the submitter pool is trusted. |
