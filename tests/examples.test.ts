// Acceptance tests for the rules engine — Examples A–F from §1.6 of the spec.
// Run with: npm test
// Each test prints the plain-English narration, then asserts exact final stashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRound, makeRng, type Player } from "../src/rules.js";

function stashes(players: Player[]): Record<string, number> {
  return Object.fromEntries(players.map(p => [p.id, p.stash]));
}

function printNarration(lines: readonly string[]) {
  console.log();
  for (const line of lines) console.log("    " + line);
  console.log();
}

// ---------------------------------------------------------------------------
// Example A — Lone winner pays the gap
// Stashes A=30, B=5, C=50, D=12. Lot=50.
// Bids A=80, C=70, B=60, D=10.
// T1={A}@80, T2={C}@70, gap=10. A can afford (30+50≥10).
// A = 30+50−10 = 70. C = 50+10 = 60. B=5, D=12.
// ---------------------------------------------------------------------------
test("Example A — Lone winner pays the gap", () => {
  const players: Player[] = [
    { id: "A", name: "A", stash: 30 },
    { id: "B", name: "B", stash: 5 },
    { id: "C", name: "C", stash: 50 },
    { id: "D", name: "D", stash: 12 },
  ];
  const bids = { A: 80, C: 70, B: 60, D: 10 };

  const { players: result, log } = resolveRound(2, players, bids, makeRng(1));
  printNarration(log.narration);

  const s = stashes(result);
  assert.equal(s.A, 70);
  assert.equal(s.B, 5);
  assert.equal(s.C, 60);
  assert.equal(s.D, 12);
  assert.equal(log.lot, 50);
  assert.equal(log.bananasDestroyed, 0);
});

// ---------------------------------------------------------------------------
// Example B — Tied top tier pays the gap
// Stashes A=30, B=5, C=50, D=12. Lot=50.
// Bids A=80, C=80, B=60, D=60.
// T1={A,C}@80, T2={B,D}@60. Gap=20.
// Each of A,C receives lot/2=25 and pays gap/2=10.
// A = 30+25−10 = 45. C = 50+25−10 = 65.
// B and D split the gap: 10 each. B = 5+10 = 15. D = 12+10 = 22.
// ---------------------------------------------------------------------------
test("Example B — Tied top tier pays the gap", () => {
  const players: Player[] = [
    { id: "A", name: "A", stash: 30 },
    { id: "B", name: "B", stash: 5 },
    { id: "C", name: "C", stash: 50 },
    { id: "D", name: "D", stash: 12 },
  ];
  const bids = { A: 80, C: 80, B: 60, D: 60 };

  const { players: result, log } = resolveRound(2, players, bids, makeRng(1));
  printNarration(log.narration);

  const s = stashes(result);
  assert.equal(s.A, 45);
  assert.equal(s.B, 15);
  assert.equal(s.C, 65);
  assert.equal(s.D, 22);
  assert.equal(log.lot, 50);
  assert.equal(log.bananasDestroyed, 0);
  assert.equal(log.cascadeSteps.length, 1);
  assert.equal(log.cascadeSteps[0].kind, "tied-paid");
});

// ---------------------------------------------------------------------------
// Example C — Bust, then cascade
// Stashes A=3, B=40, C=12. Lot=40.
// Bids A=100, B=50, C=20.
// gap(A→B)=50. A has 43 < 50. A busts (3 destroyed).
// gap(B→C)=30. B has 80 ≥ 30. B=50, C=42. A=0.
// ---------------------------------------------------------------------------
test("Example C — Bust, then cascade", () => {
  const players: Player[] = [
    { id: "A", name: "A", stash: 3 },
    { id: "B", name: "B", stash: 40 },
    { id: "C", name: "C", stash: 12 },
  ];
  const bids = { A: 100, B: 50, C: 20 };

  const { players: result, log } = resolveRound(2, players, bids, makeRng(1));
  printNarration(log.narration);

  const s = stashes(result);
  assert.equal(s.A, 0);
  assert.equal(s.B, 50);
  assert.equal(s.C, 42);
  assert.equal(log.lot, 40);
  assert.equal(log.bananasDestroyed, 3);
});

// ---------------------------------------------------------------------------
// Example D — Cascade to the last tier, and a win
// Stashes A=1, B=2, C=100. Lot=100.
// Bids A=500, B=300, C=10.
// A busts (101<200). B busts (102<290). C takes free. C=200. C wins.
// ---------------------------------------------------------------------------
test("Example D — Cascade to the last tier, and a win", () => {
  const players: Player[] = [
    { id: "A", name: "A", stash: 1 },
    { id: "B", name: "B", stash: 2 },
    { id: "C", name: "C", stash: 100 },
  ];
  const bids = { A: 500, B: 300, C: 10 };

  const { players: result, log, winners } = resolveRound(2, players, bids, makeRng(1));
  printNarration(log.narration);

  const s = stashes(result);
  assert.equal(s.A, 0);
  assert.equal(s.B, 0);
  assert.equal(s.C, 200);
  assert.equal(log.lot, 100);
  assert.equal(log.bananasDestroyed, 3); // A lost 1, B lost 2
  assert.ok(winners !== null, "C should be declared winner");
  assert.equal(winners!.length, 1);
  assert.equal(winners![0].id, "C");
});

// ---------------------------------------------------------------------------
// Example E — Everyone bids the same
// Three players, lot=30, all bid 12. One tier, more than one member.
// Split 30 → 10 each. Nobody pays.
// ---------------------------------------------------------------------------
test("Example E — Everyone bids the same", () => {
  // Stashes chosen so max=30 → lot=30; split is 10/10/10 (no remainder).
  const players: Player[] = [
    { id: "P1", name: "P1", stash: 30 },
    { id: "P2", name: "P2", stash: 20 },
    { id: "P3", name: "P3", stash: 10 },
  ];
  const bids = { P1: 12, P2: 12, P3: 12 };

  const { players: result, log } = resolveRound(2, players, bids, makeRng(1));
  printNarration(log.narration);

  const s = stashes(result);
  assert.equal(s.P1, 40);
  assert.equal(s.P2, 30);
  assert.equal(s.P3, 20);
  assert.equal(log.lot, 30);
  assert.equal(log.bananasDestroyed, 0);
  // Confirm it was a free split with no cascade steps of kind "paid" or "busted"
  assert.equal(log.cascadeSteps.length, 1);
  assert.equal(log.cascadeSteps[0].kind, "free");
});

// ---------------------------------------------------------------------------
// Example G — Tied top tier busts, lot cascades to sole survivor
// Stashes A=2, B=2, C=20. Lot=20.
// Bids A=100, B=100, C=10.
// T1={A,B}@100, T2={C}@10. Gap=90. Each share=45; A has 2+10=12 < 45.
// A and B bust (4 bananas destroyed). Lot passes to T2={C}, last tier.
// C takes lot free. C = 20+20 = 40.
// ---------------------------------------------------------------------------
test("Example G — Tied top tier busts", () => {
  const players: Player[] = [
    { id: "A", name: "A", stash: 2 },
    { id: "B", name: "B", stash: 2 },
    { id: "C", name: "C", stash: 20 },
  ];
  const bids = { A: 100, B: 100, C: 10 };

  const { players: result, log } = resolveRound(2, players, bids, makeRng(1));
  printNarration(log.narration);

  const s = stashes(result);
  assert.equal(s.A, 0);
  assert.equal(s.B, 0);
  assert.equal(s.C, 40);
  assert.equal(log.lot, 20);
  assert.equal(log.bananasDestroyed, 4);
  assert.equal(log.cascadeSteps.length, 2);
  assert.equal(log.cascadeSteps[0].kind, "tied-busted");
  assert.equal(log.cascadeSteps[1].kind, "free");
});

// ---------------------------------------------------------------------------
// Example F — Two-player game, winner left with nothing
// Stashes A=20, B=20. Lot=20. Bids A=50, B=10.
// gap=40. A has 40 ≥ 40. A=0, B=60.
// ---------------------------------------------------------------------------
test("Example F — Two-player game, winner left with nothing", () => {
  const players: Player[] = [
    { id: "A", name: "A", stash: 20 },
    { id: "B", name: "B", stash: 20 },
  ];
  const bids = { A: 50, B: 10 };

  const { players: result, log } = resolveRound(2, players, bids, makeRng(1));
  printNarration(log.narration);

  const s = stashes(result);
  assert.equal(s.A, 0);
  assert.equal(s.B, 60);
  assert.equal(log.lot, 20);
  assert.equal(log.bananasDestroyed, 0);
});
