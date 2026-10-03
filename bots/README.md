# Submitting a bot

Create a `.ts` or `.js` file in this directory. Your file must export one function as its **default export**. That function receives a `BotState` and returns your bid as a number.

```typescript
import type { BotState } from "../src/arena/bot-types.js";

export default function myBot(state: BotState): number {
  return state.lot + 1;
}
```

Run the arena with your bot:

```
npm run arena -- bots/my-bot.ts
```

## BotState

| Field | Type | Description |
|---|---|---|
| `lot` | `number` | How many bananas are up for auction this round |
| `round` | `number` | Round number (1-indexed) |
| `myIndex` | `number` | Your player index (0-based). Stable for the whole game. |
| `myStash` | `number` | Your banana count before bids are resolved |
| `stashes` | `number[]` | Every player's stash before bids are resolved, ordered by player index. `stashes[myIndex] === myStash`. |
| `prevBids` | `number[] \| null` | All bids from last round, ordered by player index. `null` in round 1. |
| `prevLot` | `number \| null` | Lot size last round. `null` in round 1. |

## Rules

| Rule | What happens if you break it |
|---|---|
| Return a non-negative integer | Non-integers are rounded; negatives are clamped to 0. Both count as violations. |
| Return ≤ `Number.MAX_SAFE_INTEGER` | Bids above this are clamped to `Number.MAX_SAFE_INTEGER`. Counts as a violation. |
| Return a finite number | Non-finite values (Infinity, NaN) forfeit the round — your bid becomes 0. |
| Return within 100 ms | Your call is killed and your bid becomes 0. |
| Single-file submissions only | Multi-file bots aren't accepted. |
| No `require()` or `import()` | The sandbox has no module system. Only `Math` and `console` are available. |

A bot that violates constraints repeatedly will be flagged in the summary output, but it will not crash the arena.

## Notes

- Your function may use `Math.random()`. Results will vary slightly between runs but average out over 10,000 games.
- You may use module-level variables for state across rounds. That state resets between games.
- `console.log()` works and goes to stdout — useful for debugging, noisy at scale.
- You cannot `require()` or `import()` other modules. The sandbox has no file system access.
- You cannot read other bots' source code or share state with them.
- The `state` object is frozen — mutations are silently ignored (or throw in strict mode). Copy values out if you need to track them.

See `example.ts` for a minimal working bot.
