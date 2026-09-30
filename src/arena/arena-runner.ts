// Phase 2+ — Arena runner
// Runs 10,000 games mixing built-in strategies with externally submitted bots.
// Usage:
//   npm run arena                      (built-ins only)
//   npm run arena -- bots/my-bot.ts    (add one external bot)
//   npm run arena -- bots/*.ts         (add all bots in bots/)

import { resolveRound, makeRng, calculateLot, type Player } from "../rules.js";
import { BUILTIN_STRATEGIES, builtinBid, type BuiltinStrategy } from "./builtin-bots.js";
import { loadBot, type LoadedBot, type GameBot } from "./bot-loader.js";

// ---------------------------------------------------------------------------
// Slot: one player position — either a built-in strategy or an external bot
// ---------------------------------------------------------------------------

type Slot =
  | { kind: "builtin"; strategy: BuiltinStrategy }
  | { kind: "external"; bot: LoadedBot };

function slotName(slot: Slot): string {
  return slot.kind === "builtin" ? slot.strategy : slot.bot.name;
}

// A resolved slot for one game: built-ins call builtinBid directly;
// external bots use a GameBot with a persistent vm context for that game.
type ResolvedSlot =
  | { kind: "builtin"; strategy: BuiltinStrategy; name: string }
  | { kind: "external"; gameBot: GameBot; name: string };

function resolveSlots(slots: Slot[]): ResolvedSlot[] {
  return slots.map(slot =>
    slot.kind === "builtin"
      ? { kind: "builtin", strategy: slot.strategy, name: slot.strategy }
      : { kind: "external", gameBot: slot.bot.createGame(), name: slot.bot.name },
  );
}

function resolvedBid(
  slot: ResolvedSlot,
  lot: number,
  round: number,
  myStash: number,
  rng: () => number,
  prevBids: number[] | null,
  prevLot: number | null,
): number {
  if (slot.kind === "builtin") {
    return builtinBid(slot.strategy, lot, rng, prevBids, prevLot);
  }
  return slot.gameBot.call({ lot, round, myStash, prevBids, prevLot });
}

// ---------------------------------------------------------------------------
// Load external bots from CLI args
// ---------------------------------------------------------------------------

const externalBots: LoadedBot[] = [];
for (const arg of process.argv.slice(2)) {
  try {
    externalBots.push(loadBot(arg));
    console.log(`Loaded bot: ${arg}`);
  } catch (err) {
    console.error(`Failed to load bot ${arg}: ${err}`);
    process.exit(1);
  }
}

// All participant names (for summary tables)
const builtinNames = [...BUILTIN_STRATEGIES] as string[];
const externalNames = externalBots.map(b => b.name);
const ALL_NAMES: string[] = [...builtinNames, ...externalNames];

// ---------------------------------------------------------------------------
// Single game
// ---------------------------------------------------------------------------

const MAX_ROUNDS = 10_000;

type GameResult = {
  rounds: number;
  bananasDestroyed: number;
  winnerNames: string[];
  hitMaxRounds: boolean;
  playerCount: number;
};

function simulateGame(slots: Slot[], gameSeed: number): GameResult {
  const rng = makeRng(gameSeed);
  const resolved = resolveSlots(slots);

  let players: Player[] = slots.map((_, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    stash: 10,
  }));

  let totalDestroyed = 0;
  let prevBids: number[] | null = null;
  let prevLot: number | null = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const { lot } = calculateLot(players, round);

    const bids: Record<string, number> = {};
    const bidValues: number[] = [];
    for (let i = 0; i < players.length; i++) {
      const bid = resolvedBid(resolved[i], lot, round, players[i].stash, rng, prevBids, prevLot);
      bids[players[i].id] = bid;
      bidValues.push(bid);
    }
    prevBids = bidValues;
    prevLot = lot;

    const result = resolveRound(round, players, bids, rng);
    totalDestroyed += result.log.bananasDestroyed;
    players = result.players;

    if (result.winners) {
      return {
        rounds: round,
        bananasDestroyed: totalDestroyed,
        winnerNames: result.winners.map(w => resolved[parseInt(w.id.slice(1))].name),
        hitMaxRounds: false,
        playerCount: slots.length,
      };
    }
  }

  return {
    rounds: MAX_ROUNDS,
    bananasDestroyed: totalDestroyed,
    winnerNames: [],
    hitMaxRounds: true,
    playerCount: slots.length,
  };
}

// ---------------------------------------------------------------------------
// Run 10,000 games
// ---------------------------------------------------------------------------

const TOTAL_GAMES = 10_000;
const PROGRESS_DOTS = 40;

if (externalBots.length > 0) {
  console.log(`External bots: ${externalBots.map(b => b.name).join(", ")}`);
}
process.stdout.write(`Running ${TOTAL_GAMES.toLocaleString()} games `);

const meta = makeRng(0xca11ab1e);

const wins        = new Map<string, number>(ALL_NAMES.map(n => [n, 0]));
const appearances = new Map<string, number>(ALL_NAMES.map(n => [n, 0]));

type Cell = { wins: number; appearances: number };
const crosstab = new Map<string, Map<string, Cell>>();
for (const a of ALL_NAMES) {
  const row = new Map<string, Cell>();
  for (const b of ALL_NAMES) row.set(b, { wins: 0, appearances: 0 });
  crosstab.set(a, row);
}

const roundsByCount = new Map<number, number[]>();
for (let n = 2; n <= 10; n++) roundsByCount.set(n, []);

let totalRounds    = 0;
let totalDestroyed = 0;
let hitMaxRounds   = 0;

for (let i = 0; i < TOTAL_GAMES; i++) {
  if (i % Math.ceil(TOTAL_GAMES / PROGRESS_DOTS) === 0) process.stdout.write(".");

  const playerCount = 2 + Math.floor(meta() * 9);

  // Build slots: pick from ALL participants (built-in + external)
  const allSlots: Slot[] = [
    ...BUILTIN_STRATEGIES.map(s => ({ kind: "builtin" as const, strategy: s })),
    ...externalBots.map(b => ({ kind: "external" as const, bot: b })),
  ];

  const slots: Slot[] = Array.from(
    { length: playerCount },
    () => allSlots[Math.floor(meta() * allSlots.length)],
  );

  const result = simulateGame(slots, i);

  totalRounds    += result.rounds;
  totalDestroyed += result.bananasDestroyed;
  if (result.hitMaxRounds) hitMaxRounds++;

  if (roundsByCount.has(result.playerCount)) {
    roundsByCount.get(result.playerCount)!.push(result.rounds);
  }

  for (const slot of slots) {
    const n = slotName(slot);
    appearances.set(n, (appearances.get(n) ?? 0) + 1);
  }

  const share = result.winnerNames.length > 0 ? 1 / result.winnerNames.length : 0;
  for (const n of result.winnerNames) {
    wins.set(n, (wins.get(n) ?? 0) + share);
  }

  // Crosstab
  const nameSet = new Set(slots.map(slotName));
  const nameCount = new Map<string, number>();
  for (const slot of slots) {
    const n = slotName(slot);
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }
  const winnerCount = new Map<string, number>();
  for (const n of result.winnerNames) {
    winnerCount.set(n, (winnerCount.get(n) ?? 0) + 1);
  }

  for (const [a, countA] of nameCount) {
    for (const b of nameSet) {
      if (b === a) continue;
      const cell = crosstab.get(a)?.get(b);
      if (!cell) continue;
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
console.log("  Puerto Banana — Arena Summary");
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

// Sort by win rate descending for the summary table
const sortedNames = [...ALL_NAMES].sort((a, b) => {
  const rA = (wins.get(a) ?? 0) / (appearances.get(a) ?? 1);
  const rB = (wins.get(b) ?? 0) / (appearances.get(b) ?? 1);
  return rB - rA;
});

console.log();
console.log("  Win rate per player by strategy  (wins ÷ appearances):");
console.log("  " + line);
for (const n of sortedNames) {
  const w = wins.get(n) ?? 0;
  const a = appearances.get(n) ?? 0;
  const tag = externalNames.includes(n) ? " *" : "  ";
  console.log(
    `  ${tag}${n.padEnd(10)}  ${pct(w, a).padStart(6)}` +
    `   ${Math.round(w).toLocaleString().padStart(5)} wins / ${a.toLocaleString().padStart(6)} appearances`,
  );
}
if (externalNames.length > 0) {
  console.log();
  console.log("  * external bot");
}
console.log();
console.log(`  Total bananas destroyed:  ${totalDestroyed.toLocaleString()}`);
console.log(`  Avg destroyed/game:       ${(totalDestroyed / TOTAL_GAMES).toFixed(1)}`);
console.log();

if (externalBots.some(b => b.violations > 0)) {
  console.log(bar);
  console.log("  Violations");
  console.log(bar);
  for (const bot of externalBots) {
    if (bot.violations > 0) {
      console.log(`    ${bot.name}: ${bot.violations} violation${bot.violations !== 1 ? "s" : ""}`);
    }
  }
  console.log();
}

console.log(bar);

// ---------------------------------------------------------------------------
// Crosstab
// ---------------------------------------------------------------------------

const COL = 7;
const ROW = 12;

const abbrev = (n: string) => n.length <= 6 ? n : n.slice(0, 5) + ".";

console.log();
console.log(bar);
console.log("  Crosstab: row's win rate when column opponent is present");
console.log("  (read across a row to see how it fares against each rival)");
console.log(bar);
console.log();

const headerCols = sortedNames.map(n => abbrev(n).padStart(COL)).join("");
console.log("  " + " ".repeat(ROW) + "  " + headerCols);
console.log("  " + " ".repeat(ROW) + "  " + "─".repeat(COL * sortedNames.length));

for (const a of sortedNames) {
  const row = crosstab.get(a)!;
  const cells = sortedNames.map(b => {
    if (b === a) return " ·".padStart(COL);
    const cell = row.get(b);
    if (!cell || cell.appearances === 0) return "n/a".padStart(COL);
    return ((cell.wins / cell.appearances * 100).toFixed(1) + "%").padStart(COL);
  });
  console.log("  " + a.padEnd(ROW) + "  " + cells.join(""));
}
console.log();
