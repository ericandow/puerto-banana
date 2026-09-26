# Puerto Banana

A multiplayer sealed-bid auction game. Players are rival banana shippers. Each round, a lot of bananas goes up for auction. You may bid any non-negative integer — including far more than you own. The winner pays only the *difference* between their bid and the next-highest bid. First to 200 bananas wins.

Full rules and design rationale are in [`puerto-banana-spec.md`](./puerto-banana-spec.md).

## Stack

TypeScript throughout — server and browser share one language and one rules engine. The rules engine has zero dependencies and zero I/O; it takes state and bids, returns new state and a structured log. The server uses Node + WebSockets. No database; game state lives in memory.

## Build phases

| Phase | What it produces |
|---|---|
| 0 | Pure rules engine + worked examples as tests |
| 1 | Browser playground — type in stashes and bids, click Resolve |
| 2 | Headless simulator — 10,000 games with scripted bots |
| 3 | Lobbies — create, join, see player list update live |
| 4 | Live gameplay — full rounds, bid timer, narration |
| 5 | Bot players in real games |
| 6 | Replay viewer — step through a finished game round by round |

Each phase ends with an acceptance check a non-programmer can run themselves.

## Running

*Nothing is runnable yet — Phase 0 is up next.*

## Design decisions

**Authoritative server, thin clients.** Sealed bidding requires a trusted party to hold bids until reveal. Peer-to-peer commit–reveal cryptography works in theory but doubles round trips, fails badly on disconnect, and still requires the same rules engine. Not worth it.

**Determinism.** The only randomness in the system is one seeded PRNG per game, chosen at game creation. `Math.random()` never appears in the rules engine. A game is fully reproducible from `(seed, ordered list of bids)`.

**Banana ledger.** Bananas are not conserved — busting destroys them, lots create new ones. The engine asserts after every round:

```
sum(stashes) == starting_total + lots_created - bananas_destroyed
```
