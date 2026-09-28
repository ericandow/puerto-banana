// Phase 2 — Headless simulator
// Plays 10,000 complete games with scripted bots and prints a summary.
// Run with: npm run simulate

import { resolveRound, makeRng, calculateLot, type Player } from "./rules.js";

// ---------------------------------------------------------------------------
// Bot strategies
// ---------------------------------------------------------------------------

const STRATEGIES = ["random", "zero", "lot+1", "median", "max", "min", "min+1", "scalemax", "scalemin", "scalemed", "doublemax"] as const;
type Strategy = (typeof STRATEGIES)[number];

function makeBid(
  strategy: Strategy,
  lot: number,
  rng: () => number,
  prevBids: number[] | null,
  prevLot: number | null,
): number {
  switch (strategy) {
    case "random": return Math.floor(rng() * (lot * 2 + 1));
    case "zero":   return 0;
    case "lot+1":  return lot + 1;
    case "median": {
      if (!prevBids) return 5;
      const sorted = [...prevBids].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1
        ? sorted[mid]
        : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
    }
    case "max": {
      if (!prevBids) return 10;
      return Math.max(...prevBids);
    }
    case "min": {
      if (!prevBids) return 0;
      return Math.min(...prevBids);
    }
    case "min+1": {
      if (!prevBids) return 1;
      return Math.min(...prevBids) + 1;
    }
    case "scalemax": {
      if (!prevBids || !prevLot) return 10;
      return Math.ceil(Math.max(...prevBids) * (lot / prevLot));
    }
    case "scalemin": {
      if (!prevBids || !prevLot) return 0;
      return Math.ceil(Math.min(...prevBids) * (lot / prevLot));
    }
    case "scalemed": {
      if (!prevBids || !prevLot) return 5;
      const sorted = [...prevBids].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const prevMedian = sorted.length % 2 === 1
        ? sorted[mid]
        : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
      return Math.ceil(prevMedian * (lot / prevLot));
    }
    case "doublemax": {
      if (!prevBids) return 20;
      return Math.max(...prevBids) * 2;
    }
  }
}

// ---------------------------------------------------------------------------
// Single game
// ---------------------------------------------------------------------------

const MAX_ROUNDS = 10_000;

type GameResult = {
  rounds: number;
  bananasDestroyed: number;
  winnerStrategies: Strategy[];
  hitMaxRounds: boolean;
  playerCount: number;
};

function simulateGame(strategies: Strategy[], seed: number): GameResult {
  const rng = makeRng(seed);

  let players: Player[] = strategies.map((_, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    stash: 10,
  }));

  let totalDestroyed = 0;
  let prevBids: number[] | null = null;
  let prevLot:  number | null   = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const { lot } = calculateLot(players, round);

    const bids: Record<string, number> = {};
    const bidValues: number[] = [];
    for (let i = 0; i < players.length; i++) {
      const bid = makeBid(strategies[i], lot, rng, prevBids, prevLot);
      bids[players[i].id] = bid;
      bidValues.push(bid);
    }
    prevBids = bidValues;
    prevLot  = lot;

    const result = resolveRound(round, players, bids, rng);
    totalDestroyed += result.log.bananasDestroyed;
    players = result.players;

    if (result.winners) {
      return {
        rounds: round,
        bananasDestroyed: totalDestroyed,
        winnerStrategies: result.winners.map(w => strategies[parseInt(w.id.slice(1))]),
        hitMaxRounds: false,
        playerCount: strategies.length,
      };
    }
  }

  return {
    rounds: MAX_ROUNDS,
    bananasDestroyed: totalDestroyed,
    winnerStrategies: [],
    hitMaxRounds: true,
    playerCount: strategies.length,
  };
}

// ---------------------------------------------------------------------------
// Run 10,000 games
// ---------------------------------------------------------------------------

const TOTAL_GAMES = 10_000;
const PROGRESS_DOTS = 40;

process.stdout.write(`Running ${TOTAL_GAMES.toLocaleString()} games `);

const meta = makeRng(0xca11ab1e);

// Wins (fractional for co-wins) and appearances per strategy
const wins        = new Map<Strategy, number>(STRATEGIES.map(s => [s, 0]));
const appearances = new Map<Strategy, number>(STRATEGIES.map(s => [s, 0]));

// crosstab[a][b] = { wins, appearances } for strategy A in games where B is present
type Cell = { wins: number; appearances: number };
const crosstab = new Map<Strategy, Map<Strategy, Cell>>();
for (const a of STRATEGIES) {
  const row = new Map<Strategy, Cell>();
  for (const b of STRATEGIES) row.set(b, { wins: 0, appearances: 0 });
  crosstab.set(a, row);
}

// Rounds per player-count bucket
const roundsByCount = new Map<number, number[]>();
for (let n = 2; n <= 10; n++) roundsByCount.set(n, []);

let totalRounds    = 0;
let totalDestroyed = 0;
let hitMaxRounds   = 0;

for (let i = 0; i < TOTAL_GAMES; i++) {
  if (i % Math.ceil(TOTAL_GAMES / PROGRESS_DOTS) === 0) process.stdout.write(".");

  // Random player count (2–10) and strategy assignment, seeded by meta-RNG
  const playerCount = 2 + Math.floor(meta() * 9);
  const strategies: Strategy[] = Array.from(
    { length: playerCount },
    () => STRATEGIES[Math.floor(meta() * STRATEGIES.length)],
  );

  const result = simulateGame(strategies, i);

  totalRounds    += result.rounds;
  totalDestroyed += result.bananasDestroyed;
  if (result.hitMaxRounds) hitMaxRounds++;

  roundsByCount.get(result.playerCount)!.push(result.rounds);

  for (const s of strategies) {
    appearances.set(s, appearances.get(s)! + 1);
  }
  // Distribute co-wins equally
  const share = result.winnerStrategies.length > 0 ? 1 / result.winnerStrategies.length : 0;
  for (const s of result.winnerStrategies) {
    wins.set(s, wins.get(s)! + share);
  }

  // Crosstab: for each strategy A, record appearances and wins in games where B is present
  const strategySet = new Set(strategies);
  const stratCount  = new Map<Strategy, number>();
  for (const s of strategies) stratCount.set(s, (stratCount.get(s) ?? 0) + 1);
  const winnerCount = new Map<Strategy, number>();
  for (const s of result.winnerStrategies) winnerCount.set(s, (winnerCount.get(s) ?? 0) + 1);

  for (const [a, countA] of stratCount) {
    for (const b of strategySet) {
      if (b === a) continue;
      const cell = crosstab.get(a)!.get(b)!;
      cell.appearances += countA;
      cell.wins += (winnerCount.get(a) ?? 0) * share;
    }
  }
}

console.log(" done.\n");

// ---------------------------------------------------------------------------
// Print summary
// ---------------------------------------------------------------------------

const line = "─".repeat(51);
const bar  = "═".repeat(51);

function pct(n: number, d: number) { return d === 0 ? "—" : (n / d * 100).toFixed(1) + "%"; }
function avg(nums: number[])       { return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length; }

console.log(bar);
console.log("  Puerto Banana — Simulation Summary");
console.log(bar);
console.log();
console.log(`  Games run:              ${TOTAL_GAMES.toLocaleString()}`);
console.log(`  Completed normally:     ${(TOTAL_GAMES - hitMaxRounds).toLocaleString()}  (${pct(TOTAL_GAMES - hitMaxRounds, TOTAL_GAMES)})`);
if (hitMaxRounds > 0) {
  console.log(`  Hit round limit (${MAX_ROUNDS.toLocaleString()}): ${hitMaxRounds}`);
}
console.log();
console.log(`  Avg rounds/game:        ${avg([...roundsByCount.values()].flat()).toFixed(1)}`);
console.log();
console.log("  Avg rounds by player count:");
console.log("  " + line);
for (let n = 2; n <= 10; n++) {
  const rounds = roundsByCount.get(n)!;
  console.log(
    `    ${n} players:  ${avg(rounds).toFixed(1).padStart(6)} avg` +
    `   (${rounds.length.toLocaleString().padStart(5)} games)`,
  );
}
console.log();
console.log("  Win rate per player by strategy  (wins ÷ appearances):");
console.log("  " + line);
for (const s of STRATEGIES) {
  const w = wins.get(s)!;
  const a = appearances.get(s)!;
  console.log(
    `    ${s.padEnd(8)}  ${pct(w, a).padStart(6)}` +
    `   ${Math.round(w).toLocaleString().padStart(5)} wins / ${a.toLocaleString().padStart(6)} appearances`,
  );
}
console.log();
console.log(`  Total bananas destroyed:  ${totalDestroyed.toLocaleString()}`);
console.log(`  Avg destroyed/game:       ${(totalDestroyed / TOTAL_GAMES).toFixed(1)}`);
console.log();
console.log(bar);

// ---------------------------------------------------------------------------
// Crosstab
// ---------------------------------------------------------------------------

const abbrev: Record<Strategy, string> = {
  "random": "rand",
  "zero":   "zero",
  "lot+1":  "lt+1",
  "median": "med",
  "max":      "max",
  "min":      "min",
  "min+1":    "mn+1",
  "scalemax": "smax",
  "scalemin": "smin",
  "scalemed":  "smed",
  "doublemax": "dmax",
};

const COL = 7;   // width of each data column
const ROW = 8;   // width of the row-label column

console.log();
console.log(bar);
console.log("  Crosstab: row's win rate when column opponent is present");
console.log("  (read across a row to see how it fares against each rival)");
console.log(bar);
console.log();

const headerCols = STRATEGIES.map(s => abbrev[s].padStart(COL)).join("");
console.log("  " + " ".repeat(ROW) + "  " + headerCols);
console.log("  " + " ".repeat(ROW) + "  " + "─".repeat(COL * STRATEGIES.length));

for (const a of STRATEGIES) {
  const row = crosstab.get(a)!;
  const cells = STRATEGIES.map(b => {
    if (b === a) return " ·".padStart(COL);
    const { wins: w, appearances: ap } = row.get(b)!;
    if (ap === 0) return "n/a".padStart(COL);
    return ((w / ap * 100).toFixed(1) + "%").padStart(COL);
  });
  console.log("  " + a.padEnd(ROW) + "  " + cells.join(""));
}
console.log();
