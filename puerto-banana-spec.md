# Puerto Banana — Implementation Specification

**Version:** 1.0
**Status:** Ready for implementation
**Audience:** An AI coding assistant implementing this game, working with a non-programmer.

---

## 0. How to use this document

This spec is written to be built in **phases**. Each phase produces something a
person with no programming experience can look at and judge for themselves.
**Do not skip ahead.** Do not build the server before the rules engine passes its
examples. The order is the point.

Two goals are in tension and one wins:

1. Ship a working multiplayer web game.
2. Demonstrate a build process a non-programmer can follow and verify.

**Goal 2 wins.** Where a choice makes the system faster to build but harder for a
non-programmer to check, take the slower, checkable path. Prefer boring,
inspectable code over clever code. Every phase below ends with an
**Acceptance check** written as something a human does and sees — not a test
suite name. Those checks are the contract.

---

## 1. The game

### 1.1 Premise

Players are rival banana shippers. Each auction round puts a **lot** of bananas
up for sealed bid. First player to reach 200 bananas wins.

The twist: you bid whatever number you like — including far more bananas than
you own — and the winner pays only the *difference* between their bid and the
next-highest bid. So a wild overbid is cheap if you guess the field correctly,
and ruinous if you don't.

### 1.2 Setup

| Thing | Value |
|---|---|
| Players | 2–10 |
| Starting stash | 10 bananas each |
| First lot | 10 bananas |
| Win threshold | 200 bananas |

### 1.3 A round, step by step

**Step 1 — Determine the lot.**
- Round 1: the lot is 10.
- Every later round: the lot equals the largest stash among all players,
  with a **minimum of 10**. (If every player is at 0, the lot is still 10.
  Without this floor the game can deadlock.)

**Step 2 — Snapshot.**
Record every player's stash before anything changes. This snapshot is used for
all tie-breaking during the round (§1.5). Nothing that happens mid-round changes
the snapshot.

**Step 3 — Collect bids.**
Every player secretly submits a bid. A bid is a **non-negative integer**. There
is **no upper limit** — a player may bid more bananas than they own, more than
exist, any whole number at all. 0 is a legal bid.

**Step 4 — Form tiers.**
Group players by bid amount. Each distinct bid value is a **tier**. Order tiers
by bid, highest first: T1 > T2 > … > Tk. A tier holds one or more players.

Thinking in tiers rather than in ranked players is what keeps ties from
multiplying into special cases. Follow it.

**Step 5 — Resolve.**

Let `current` be the top remaining tier, starting at T1.

```
loop:
    if current is the only tier remaining:
        current's members split the lot, free.       -> round ends
    if current has more than one member:
        current's members split the lot, free.       -> round ends
    // current has exactly one member: the sole bidder at that price
    gap = current.bid - (next tier).bid
    if bidder.stash + lot >= gap:
        bidder.stash = bidder.stash + lot - gap
        the next tier's members split `gap` between them
                                                     -> round ends
    else:
        bidder.stash = 0          // busted; those bananas are destroyed
        the lot passes on, intact, untouched
        current = next tier
        continue loop
```

Read out in plain language:

- **A tie at the top wins free.** If two or more players share the highest bid,
  they are treated as holding both the highest *and* the second-highest bid. The
  gap between them is zero. They split the lot and pay nobody. This is
  deliberate: it makes reading the field the core skill, and it means a tied
  tier can never bust.
- **A lone top bidder pays the gap.** They must cover the difference between
  their bid and the next tier's bid. They may use the lot itself to help pay —
  check affordability against `stash + lot`, not `stash` alone.
- **Failure to pay is catastrophic.** The bidder's entire stash is destroyed.
  They do not receive the lot. Those bananas leave the game permanently — they
  are not redistributed.
- **The cascade.** When a bidder busts, the lot passes down intact and the next
  tier faces the same test against the tier below *it*.
- **The floor.** If the cascade reaches the last tier, that tier takes the lot
  for free. Someone always ends up with the lot.

**Step 6 — Check for a winner.**
After the round fully resolves, if any player is at 200 or more, the game ends.
The player with the **highest stash** wins. If two or more are tied at the
highest stash, they are **co-winners** — declare them jointly and stop.

**Step 7 — Busted players remain in the game.**
A player at 0 bananas keeps playing and keeps bidding. They are never
eliminated. A player at 0 is actually well-placed to win a free lot by
undercutting. This is intended.

### 1.4 What stays visible

Everything except live bids. Stashes, the current lot, and the full bid history
of every *resolved* round are public to all players at all times. Only bids for
the round in progress are hidden, and only until reveal.

### 1.5 Splitting bananas between tied players

Whenever bananas are handed to more than one player at once — a tied tier
splitting a lot, or a multi-member tier splitting a gap payment — split as
evenly as possible in whole bananas.

Give each player `floor(amount / count)`. Distribute the remainder one banana at
a time to the players with the **fewest bananas in the round-start snapshot**
(§1.2, Step 2), poorest first. If players are tied in the snapshot and there
aren't enough spare bananas for all of them, choose between those tied players
using the game's seeded random generator (§3.3).

> **Example.** Three players split 26 bananas. Snapshot stashes: 5, 10, 50.
> Base share is 8 each, remainder 2. The two poorest each take one extra.
> Result: 9, 9, 8.

Note there is no rule for *paying* a remainder, because a player who owes
bananas is always a lone bidder. That case cannot arise.

### 1.6 Worked examples

These are the acceptance tests for the rules engine. Implement them literally.

**A — Lone winner pays the gap.**
Stashes A=30, B=5, C=50, D=12. Lot = 50 (highest stash).
Bids A=80, C=70, B=60, D=10.
T1={A}@80, T2={C}@70, gap=10. A can afford (30+50 ≥ 10).
A = 30+50−10 = **70**. C = 50+10 = **60**. B=5, D=12.
Next lot = 70.

**B — Tied top tier splits free.**
Stashes A=30, B=5, C=50, D=12. Lot = 50.
Bids A=80, C=80, B=60, D=60.
T1={A,C} — more than one member, so they split the lot and pay nothing.
25 each. A = **55**, C = **75**. B and D unchanged. T2 receives nothing.
Next lot = 75.

**C — Bust, then cascade.**
Stashes A=3, B=40, C=12. Lot = 40.
Bids A=100, B=50, C=20.
T1={A}@100 vs T2={B}@50, gap=50. A has 3+40 = 43, which is less than 50.
**A busts to 0.** Lot passes on intact.
Now T2={B}@50 vs T3={C}@20, gap=30. B has 40+40 = 80 ≥ 30.
B = 40+40−30 = **50**. C = 12+30 = **42**. A = **0**.
Next lot = 50. (37 bananas were destroyed.)

**D — Cascade to the last tier, and a win.**
Stashes A=1, B=2, C=100. Lot = 100.
Bids A=500, B=300, C=10.
T1={A}: gap=200. A has 1+100 = 101 < 200. **A busts to 0.**
T2={B}: gap=290. B has 2+100 = 102 < 290. **B busts to 0.**
T3={C} is the last tier: C takes the lot free. C = 100+100 = **200**.
**C wins.**

**E — Everyone bids the same.**
Three players, lot = 30, all bid 12. One tier, more than one member.
They split 30 → 10 each. Nobody pays.

**F — Two-player game.**
Stashes A=20, B=20. Lot = 20. Bids A=50, B=10.
T1={A}, T2={B}, gap=40. A has 20+20 = 40 ≥ 40. A = 20+20−40 = **0**.
B = 20+40 = **60**. A wins the lot and is left with nothing — legal, and a good
illustration of the trap.

---

## 2. Architecture

### 2.1 Decision: authoritative server, thin clients

One server holds all game state and is the only thing that runs the rules.
Clients render state and send bids. Clients are never trusted.

**Why not peer-to-peer.** Sealed bidding needs a party who can hold bids until
reveal. With no server, that requires commit–reveal cryptography: every player
broadcasts a hash of their bid, then reveals it, and everyone verifies. It works
in theory, but it doubles the round trips, fails messily when a player
disconnects between commit and reveal, and you still have to write exactly the
same rules engine. The trade isn't worth it here.

This rejection is worth showing the audience as an example of evaluating an
option and declining it for stated reasons rather than never considering it.

### 2.2 Stack

- **TypeScript** everywhere — server and browser, one language, one mental model.
- **Rules engine**: a plain TypeScript module with **zero dependencies** and zero
  I/O. No network, no database, no clock, no `Math.random`. It takes state and
  inputs, returns new state. It must be importable by the server, the tests, the
  simulator, and the browser alike.
- **Server**: Node, WebSockets for gameplay, a few HTTP endpoints for lobby
  creation and joining.
- **Client**: a single-page app. Keep the dependency list short.
- **State**: in memory. No database in v1. If the server restarts, games are
  lost — acceptable for this scope, and one less thing to explain.

### 2.3 Layering rule

```
rules engine  ← knows nothing about networks, players' names, or time
     ↑
game server   ← holds games, routes messages, enforces turn order
     ↑
web client    ← draws things, collects bids
```

Dependencies point upward only. If the rules engine ever needs to import
something from the server, the design has gone wrong — stop and fix it.

---

## 3. Debuggability requirements

These are not optional extras. They are the reason this project exists. A
non-programmer must be able to answer "is it working correctly?" without reading
code.

### 3.1 Every round emits a structured log

Resolving a round produces a record of what happened and why:

- the lot, and how it was computed
- the stash snapshot
- every bid
- the tiers as formed
- each cascade step: who was tested, the gap, what they could afford, whether
  they paid or busted
- every banana movement, with its reason
- resulting stashes
- bananas destroyed this round

### 3.2 Every round also emits plain-English narration

Alongside the structured log, generate human sentences:

```
Round 4. The lot is 50 bananas (Carla has the largest stash).
Ana bid 80. Carla bid 70. Ben bid 60. Dev bid 10.
Ana alone bid highest. She must pay the 10-banana gap to Carla.
Ana has 30 bananas plus the 50-banana lot — she can afford it.
Ana pays 10 to Carla and keeps 40 of the lot.
Ana: 30 -> 70.  Carla: 50 -> 60.
```

This is the single highest-value feature for the audience. Someone with no
programming background can read that and say "no, that's wrong" — which is
precisely the review loop this project is meant to demonstrate.

### 3.3 Determinism and seeded randomness

The **only** source of randomness in the entire system is one seeded generator
per game. The seed is chosen when the game is created and stored in the game
record. `Math.random()` must not appear anywhere in the rules engine.

Consequence: a game is fully reproducible from `(seed, ordered list of bids)`.
Replaying those inputs must produce byte-identical logs. If it doesn't, there is
hidden state somewhere and it's a bug.

### 3.4 The banana ledger

Bananas are not conserved — busting destroys them, and each lot creates new
ones. So track the accounting explicitly. After every round, assert:

```
sum(all stashes) == (starting total) + (bananas created as lots) - (bananas destroyed by busts)
```

If this ever fails, halt loudly with the round log attached. This one assertion
catches most arithmetic mistakes in the split and remainder logic.

### 3.5 Other invariants to assert every round

- no stash is negative
- all stashes are whole numbers
- the lot is at least 10
- exactly one tier received the lot
- the round terminated (the cascade cannot loop forever — it strictly descends)

### 3.6 Replay

Games are stored as `(seed, config, ordered event list)`. Current state is
always derived by replaying events from the start, never by mutating a blob in
place. This makes "show me what happened" and "show me the state after round 3"
the same operation.

---

## 4. Build phases

Each phase is a vertical slice that ends in something visible. **A phase is not
done until its acceptance check passes in front of the non-programmer.**

### Phase 0 — Rules engine and worked examples

Build the pure rules module: lot calculation, tier formation, cascade
resolution, splitting with remainders, win detection, the ledger, the
invariants, the structured log, the narration.

Encode examples A–F from §1.6 as tests.

**Acceptance check:** run one command. Every example from the spec passes, and
the narration for each is printed to the screen and reads correctly in English.

### Phase 1 — The Rules Playground

A single static web page. No server, no lobby, no network — the rules engine
running in the browser.

The page lets you set the number of players, type each player's stash and bid
directly, and click **Resolve**. It shows the tiers, the cascade step by step,
the narration, and the resulting stashes. A **Step** button advances one cascade
step at a time.

**Acceptance check:** the non-programmer sits down with the playground, types in
each example from §1.6 by hand, and confirms the output matches the spec. Then
they invent their own strange cases — everyone bids 0; one player bids a
million; all ties — and confirm nothing breaks or produces nonsense.

This phase is the highest-leverage step in the whole build. It makes the rules
inspectable before a single line of networking exists.

### Phase 2 — Headless simulator

A command-line runner that plays complete games with scripted bot bidders. Bots
can be trivial: random bids, always bid 0, always bid the lot, always bid one
more than the lot.

Run 10,000 games across 2–10 players.

**Acceptance check:** all 10,000 games finish. No crashes, no hangs, no failed
invariants, no negative or fractional stashes. Print a summary — average rounds
per game, how often each bot strategy wins, how many bananas get destroyed. The
non-programmer reads the summary and sanity-checks it against intuition.

### Phase 3 — Lobbies, no gameplay

Now the server. Create a lobby and get a short share code. Join by code. See the
player list update live as people join and leave. Set a display name. Host can
start the game (2–10 players) or kick someone.

No bidding yet. Identity is ephemeral — a name and a session, no accounts, no
passwords.

**Acceptance check:** open three browser windows. Create a lobby in one, join
from the other two, watch all three player lists update. Close a window, watch
that player disappear.

### Phase 4 — Live gameplay

Wire the rules engine into the server. Rounds run: the lot is announced, each
player submits a bid privately, bids reveal when everyone has submitted, the
round resolves, the narration appears to all players, the next round begins.
Game ends and a winner is announced.

Bid timer: configurable, default 60 seconds. A player who doesn't submit in time
bids 0. A disconnected player bids 0 and stays in the game.

**Acceptance check:** three people play a complete game to 200 in three browser
windows. Every round's narration is visible to all of them and matches what they
expect. Deliberately let one player's timer run out and confirm they bid 0.

### Phase 5 — Bots in real games

Let the host add bot players to a lobby, reusing the Phase 2 strategies.

**Acceptance check:** one person plays a full game alone against three bots.
This matters more than it sounds — it means anyone can try the game without
coordinating friends.

### Phase 6 — Replay viewer

A page that takes a finished game and steps through it round by round, showing
the narration and a running chart of stashes.

**Acceptance check:** play a game, then replay it, and confirm the replay is
identical to what happened.

---

## 5. Out of scope for v1

State these as deliberate exclusions, not oversights:

- user accounts, passwords, persistent identity
- a database; games live in server memory and die with it
- reconnecting to a game from a different device
- spectators
- chat
- mobile-specific layout beyond basic responsiveness
- matchmaking or public lobby browsing — share codes only
- anti-collusion measures (two players agreeing to tie at the top is a real
  strategy under these rules; that's a rules-design question, not a v1 code
  question)

---

## 6. Open questions to revisit after playtesting

- **Tied-top collusion.** Two players who agree to always bid the same number
  split every lot for free and lock everyone else out. §1.5's tie rule makes
  this legal. Watch whether it dominates in real games; if it does, the fix is a
  rules change, not a code change.
- **Runaway leader.** The lot equals the largest stash, so the leader's advantage
  compounds. Phase 2's simulator should reveal whether games converge or drag.
- **Bid ceiling.** Currently unbounded. If the UI shows absurd numbers or the
  simulator finds degenerate strategies, revisit — but ship without one.
