// Pure rules engine — no I/O, no network, no Math.random.
// Takes state + bids, returns new state + a structured log.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Player = {
  id: string;
  name: string;
  stash: number;
};

export type Tier = {
  bid: number;
  playerIds: string[];
};

export type CascadeStep =
  | { kind: "free";   tierIndex: number; bid: number; winnerIds: string[] }
  | { kind: "paid";   tierIndex: number; bid: number; gap: number; winnerId: string; recipientIds: string[] }
  | { kind: "busted"; tierIndex: number; bid: number; gap: number; busterId: string; destroyed: number };

export type Movement = {
  playerId: string;
  delta: number;
  reason: string;
};

export type RoundLog = {
  round: number;
  lot: number;
  lotReason: string;
  snapshot: Readonly<Record<string, number>>;
  bids: Readonly<Record<string, number>>;
  tiers: readonly Tier[];
  cascadeSteps: readonly CascadeStep[];
  movements: readonly Movement[];
  resultStashes: Readonly<Record<string, number>>;
  bananasCreated: number;
  bananasDestroyed: number;
  narration: readonly string[];
};

export type RoundResult = {
  players: Player[];
  log: RoundLog;
  winners: Player[] | null;
};

// ---------------------------------------------------------------------------
// Seeded PRNG (Mulberry32) — the only randomness in the system
// ---------------------------------------------------------------------------

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Lot calculation
// ---------------------------------------------------------------------------

export function calculateLot(
  players: Player[],
  round: number,
): { lot: number; reason: string } {
  if (round === 1) {
    return { lot: 10, reason: "opening round" };
  }
  const max = players.reduce((m, p) => Math.max(m, p.stash), 0);
  if (max < 10) {
    return { lot: 10, reason: "minimum of 10 (all stashes below 10)" };
  }
  const leaders = players.filter(p => p.stash === max);
  const names = listNames(leaders.map(p => p.name));
  return {
    lot: max,
    reason: `${names} ${leaders.length === 1 ? "has" : "have"} the largest stash`,
  };
}

// ---------------------------------------------------------------------------
// Tier formation
// ---------------------------------------------------------------------------

export function formTiers(
  players: Player[],
  bids: Record<string, number>,
): Tier[] {
  const groups = new Map<number, string[]>();
  for (const p of players) {
    const bid = bids[p.id] ?? 0;
    if (!groups.has(bid)) groups.set(bid, []);
    groups.get(bid)!.push(p.id);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .map(([bid, playerIds]) => ({ bid, playerIds }));
}

// ---------------------------------------------------------------------------
// Banana splitting
// ---------------------------------------------------------------------------

// Distributes `amount` whole bananas among `playerIds`.
// Each receives floor(amount / count); remainder goes one banana at a time
// to the poorest players by snapshot stash. Ties in snapshot broken by rng.
export function splitBananas(
  amount: number,
  playerIds: string[],
  snapshot: Record<string, number>,
  rng: () => number,
): Record<string, number> {
  const n = playerIds.length;
  const base = Math.floor(amount / n);
  const remainder = amount % n;

  const shares: Record<string, number> = {};
  for (const id of playerIds) shares[id] = base;

  if (remainder === 0) return shares;

  // Group by snapshot stash (ascending = poorest first)
  const byStash = new Map<number, string[]>();
  for (const id of playerIds) {
    const stash = snapshot[id] ?? 0;
    if (!byStash.has(stash)) byStash.set(stash, []);
    byStash.get(stash)!.push(id);
  }

  // Build priority order, shuffling within ties using rng
  const ordered: string[] = [];
  for (const [, group] of [...byStash.entries()].sort(([a], [b]) => a - b)) {
    if (group.length > 1) {
      const shuffled = [...group];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      ordered.push(...shuffled);
    } else {
      ordered.push(group[0]);
    }
  }

  for (let i = 0; i < remainder; i++) {
    shares[ordered[i]] += 1;
  }

  return shares;
}

// ---------------------------------------------------------------------------
// Round resolution
// ---------------------------------------------------------------------------

export function resolveRound(
  round: number,
  players: Player[],
  bids: Record<string, number>,
  rng: () => number,
): RoundResult {
  const playerById = new Map(players.map(p => [p.id, p]));
  const nameOf = (id: string) => playerById.get(id)!.name;

  // Step 1: Lot
  const { lot, reason: lotReason } = calculateLot(players, round);

  // Step 2: Snapshot — frozen before anything changes
  const snapshot: Record<string, number> = {};
  for (const p of players) snapshot[p.id] = p.stash;

  // Step 4: Tiers
  const tiers = formTiers(players, bids);

  // Working stashes — only these mutate during the round
  const stashes: Record<string, number> = { ...snapshot };

  const cascadeSteps: CascadeStep[] = [];
  const movements: Movement[] = [];
  const narration: string[] = [];
  let bananasDestroyed = 0;

  // Narration: opening line
  narration.push(`Round ${round}. The lot is ${lot} bananas (${lotReason}).`);

  // Narration: starting stashes
  narration.push(
    "Stashes: " +
    players.map(p => `${p.name}=${p.stash}`).join(", ") + ".",
  );

  // Narration: all bids, highest first
  const sortedPlayers = [...players].sort(
    (a, b) => (bids[b.id] ?? 0) - (bids[a.id] ?? 0),
  );
  narration.push(
    sortedPlayers.map(p => `${p.name} bid ${bids[p.id] ?? 0}`).join(". ") + ".",
  );

  // Step 5: Cascade
  let tierIdx = 0;

  while (tierIdx < tiers.length) {
    const current = tiers[tierIdx];
    const isLast = tierIdx === tiers.length - 1;

    if (current.playerIds.length > 1 || isLast) {
      // Free split — tied top tier, or last tier standing
      const winnerNames = current.playerIds.map(nameOf);

      if (current.playerIds.length > 1) {
        narration.push(
          `${listNames(winnerNames)} tied at the top. ` +
          `They split the ${lot}-banana lot for free.`,
        );
      } else {
        narration.push(
          `${winnerNames[0]} is the last bidder remaining. ` +
          `They take the ${lot}-banana lot for free.`,
        );
      }

      const shares = splitBananas(lot, current.playerIds, snapshot, rng);
      for (const id of current.playerIds) {
        stashes[id] += shares[id];
        movements.push({ playerId: id, delta: shares[id], reason: "lot share (free)" });
      }

      narration.push(
        current.playerIds
          .map(id => `${nameOf(id)}: ${snapshot[id]} -> ${stashes[id]}`)
          .join("  ") + ".",
      );

      cascadeSteps.push({
        kind: "free",
        tierIndex: tierIdx,
        bid: current.bid,
        winnerIds: current.playerIds,
      });
      break;
    }

    // Lone bidder at this tier
    const bidderId = current.playerIds[0];
    const next = tiers[tierIdx + 1];
    const gap = current.bid - next.bid;
    const canAfford = stashes[bidderId] + lot >= gap;

    narration.push(
      `${nameOf(bidderId)} alone bid highest at ${current.bid}. ` +
      `The next bid is ${next.bid}, a gap of ${gap}.`,
    );

    if (canAfford) {
      narration.push(
        `${nameOf(bidderId)} has ${stashes[bidderId]} bananas ` +
        `plus the ${lot}-banana lot — they can afford it.`,
      );

      const before = stashes[bidderId];
      stashes[bidderId] = before + lot - gap;
      movements.push({
        playerId: bidderId,
        delta: stashes[bidderId] - before,
        reason: `won lot, paid gap of ${gap}`,
      });

      const gapShares = splitBananas(gap, next.playerIds, snapshot, rng);
      for (const id of next.playerIds) {
        stashes[id] += gapShares[id];
        movements.push({ playerId: id, delta: gapShares[id], reason: "received gap payment" });
      }

      const kept = lot - gap;
      if (kept >= 0) {
        narration.push(
          `${nameOf(bidderId)} pays ${gap} to ${listNames(next.playerIds.map(nameOf))} ` +
          `and keeps ${kept} bananas from the lot.`,
        );
      } else {
        narration.push(
          `${nameOf(bidderId)} uses the full lot and ${-kept} from their own stash ` +
          `to pay the ${gap}-banana gap to ${listNames(next.playerIds.map(nameOf))}.`,
        );
      }
      narration.push(
        [bidderId, ...next.playerIds]
          .map(id => `${nameOf(id)}: ${snapshot[id]} -> ${stashes[id]}`)
          .join("  ") + ".",
      );

      cascadeSteps.push({
        kind: "paid",
        tierIndex: tierIdx,
        bid: current.bid,
        gap,
        winnerId: bidderId,
        recipientIds: next.playerIds,
      });
      break;
    } else {
      // Bust
      const destroyed = stashes[bidderId];
      narration.push(
        `${nameOf(bidderId)} has ${destroyed} banana${destroyed !== 1 ? "s" : ""} ` +
        `plus the ${lot}-banana lot = ${destroyed + lot} total, ` +
        `but needs ${gap}. They cannot afford it.`,
      );
      narration.push(
        `${nameOf(bidderId)} busts. ` +
        `Their ${destroyed} banana${destroyed !== 1 ? "s are" : " is"} destroyed. ` +
        `The lot passes on intact.`,
      );

      bananasDestroyed += destroyed;
      movements.push({ playerId: bidderId, delta: -destroyed, reason: "busted" });
      cascadeSteps.push({
        kind: "busted",
        tierIndex: tierIdx,
        bid: current.bid,
        gap,
        busterId: bidderId,
        destroyed,
      });
      stashes[bidderId] = 0;
      tierIdx++;
    }
  }

  // Build result
  const resultPlayers = players.map(p => ({ ...p, stash: stashes[p.id] }));
  const resultStashes: Record<string, number> = {};
  for (const p of resultPlayers) resultStashes[p.id] = p.stash;

  // Assert all invariants — throws loudly with context on any violation
  assertInvariants(resultPlayers, lot, snapshot, lot, bananasDestroyed, cascadeSteps, narration);

  // Winner check (§1.6, Step 6)
  const maxStash = resultPlayers.reduce((m, p) => Math.max(m, p.stash), 0);
  let winners: Player[] | null = null;
  if (maxStash >= 200) {
    winners = resultPlayers.filter(p => p.stash === maxStash);
    const winnerNames = listNames(winners.map(p => p.name));
    if (winners.length === 1) {
      narration.push(`${winnerNames} reaches ${maxStash} bananas — they win!`);
    } else {
      narration.push(`${winnerNames} are co-winners with ${maxStash} bananas each!`);
    }
  }

  const log: RoundLog = {
    round,
    lot,
    lotReason,
    snapshot,
    bids,
    tiers,
    cascadeSteps,
    movements,
    resultStashes,
    bananasCreated: lot,
    bananasDestroyed,
    narration,
  };

  return { players: resultPlayers, log, winners };
}

// ---------------------------------------------------------------------------
// Invariants (§3.4, §3.5)
// ---------------------------------------------------------------------------

function assertInvariants(
  resultPlayers: Player[],
  lot: number,
  snapshot: Record<string, number>,
  bananasCreated: number,
  bananasDestroyed: number,
  cascadeSteps: CascadeStep[],
  narration: string[],
): void {
  for (const p of resultPlayers) {
    if (p.stash < 0) {
      fail(`${p.name} has negative stash: ${p.stash}`, narration);
    }
    if (!Number.isInteger(p.stash)) {
      fail(`${p.name} has non-integer stash: ${p.stash}`, narration);
    }
  }

  if (lot < 10) {
    fail(`lot is ${lot}, minimum is 10`, narration);
  }

  const startTotal = Object.values(snapshot).reduce((a, b) => a + b, 0);
  const endTotal = resultPlayers.reduce((a, p) => a + p.stash, 0);
  const expected = startTotal + bananasCreated - bananasDestroyed;
  if (endTotal !== expected) {
    fail(
      `Ledger mismatch: start=${startTotal} + created=${bananasCreated} ` +
      `- destroyed=${bananasDestroyed} = ${expected}, but end=${endTotal}`,
      narration,
    );
  }

  const lotReceivers = cascadeSteps.filter(s => s.kind === "free" || s.kind === "paid");
  if (lotReceivers.length !== 1) {
    fail(`Expected exactly 1 lot-receiving tier, got ${lotReceivers.length}`, narration);
  }
}

function fail(message: string, narration: string[]): never {
  throw new Error(
    `[INVARIANT] ${message}\n\nRound log:\n${narration.map(l => "  " + l).join("\n")}`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
