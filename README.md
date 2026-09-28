# Puerto Banana

A multiplayer sealed-bid auction game. Players are rival banana shippers. Each round, a lot of bananas goes up for auction. You may bid any non-negative integer — including far more than you own. The winner pays only the *difference* between their bid and the next-highest bid. First to 200 bananas wins.

Full rules and design rationale are in [`puerto-banana-spec.md`](./puerto-banana-spec.md).

## Stack

TypeScript throughout — server and browser share one language and one rules engine. The rules engine has zero dependencies and zero I/O; it takes state and bids, returns new state and a structured log. The server uses Node + WebSockets. No database; game state lives in memory.

## Build phases

| Phase | What it produces | Status |
|---|---|---|
| 0 | Pure rules engine + worked examples as tests | ✓ done |
| 1 | Browser playground — type in stashes and bids, click Resolve | ✓ done |
| 2 | Headless simulator — 10,000 games with scripted bots | ✓ done |
| 3 | Lobbies — create, join, see player list update live | |
| 4 | Live gameplay — full rounds, bid timer, narration | |
| 5 | Bot players in real games | |
| 6 | Replay viewer — step through a finished game round by round | |

Each phase ends with an acceptance check a non-programmer can run themselves.

## Running

```
npm test                  # run the worked-example tests
npm run playground:dev    # serve the rules playground at localhost:3000
npm run simulate          # run 10,000 games and print a strategy summary
```

## Simulator bots

The simulator (`src/simulator.ts`) pits scripted bots against each other across 10,000 games with random player counts (2–10) and random strategy assignments. All 10,000 games complete without crashes, hangs, or invariant failures.

Current strategies, in rough order of effectiveness:

| Strategy | Bid each round |
|---|---|
| `scalemax` | Previous round's max bid × (current lot ÷ previous lot), rounded up |
| `doublemax` | Previous round's max bid × 2 |
| `lot+1` | Current lot + 1 |
| `scalemed` | Previous round's median bid × (current lot ÷ previous lot), rounded up |
| `max` | Previous round's max bid |
| `random` | Random integer from 0 to 2 × current lot |
| `min+1` | Previous round's min bid + 1 |
| `median` | Previous round's median bid |
| `zero` | Always 0 |
| `scalemin` | Previous round's min bid × (current lot ÷ previous lot), rounded up |
| `min` | Previous round's min bid |

Key finding: strategies that account for the current lot size (`scalemax`, `lot+1`, `random`) consistently outperform lot-blind strategies (`max`, `median`, `min`). Scaling the previous *maximum* bid is especially powerful because the max is the market-clearing price — the bid that actually won last round.

## Design decisions

**Authoritative server, thin clients.** Sealed bidding requires a trusted party to hold bids until reveal. Peer-to-peer commit–reveal cryptography works in theory but doubles round trips, fails badly on disconnect, and still requires the same rules engine. Not worth it.

**Determinism.** The only randomness in the system is one seeded PRNG per game, chosen at game creation. `Math.random()` never appears in the rules engine. A game is fully reproducible from `(seed, ordered list of bids)`.

**Banana ledger.** Bananas are not conserved — busting destroys them, lots create new ones. The engine asserts after every round:

```
sum(stashes) == starting_total + lots_created - bananas_destroyed
```
