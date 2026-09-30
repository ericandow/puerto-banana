import type { BotState } from "../src/arena/bot-types.js";

// Example bot: bid lot+1 every round.
// This is the simplest lot-aware strategy — a useful baseline.
export default function example(state: BotState): number {
  return state.lot + 1;
}
