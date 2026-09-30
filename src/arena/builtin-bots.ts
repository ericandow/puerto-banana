// Built-in strategies extracted from simulator.ts so arena-runner can share them.

export const BUILTIN_STRATEGIES = [
  "random", "lot+1", "median", "max", "min",
  "scalemax", "scalemed", "doublemax",
] as const;

export type BuiltinStrategy = (typeof BUILTIN_STRATEGIES)[number];

export function builtinBid(
  strategy: BuiltinStrategy,
  lot: number,
  rng: () => number,
  prevBids: number[] | null,
  prevLot: number | null,
): number {
  switch (strategy) {
    case "random":    return Math.floor(rng() * (lot * 2 + 1));
    case "lot+1":     return lot + 1;
    case "median": {
      if (!prevBids) return 5;
      const sorted = [...prevBids].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1
        ? sorted[mid]
        : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
    }
    case "max":    return prevBids ? Math.max(...prevBids) : 10;
    case "min":    return prevBids ? Math.min(...prevBids) : 0;
    case "scalemax": {
      if (!prevBids || !prevLot) return 10;
      return Math.ceil(Math.max(...prevBids) * (lot / prevLot));
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
    case "doublemax": return prevBids ? Math.max(...prevBids) * 2 : 20;
  }
}
