import type { BotState } from "../src/arena/bot-types.js";

// maximum bot; bids the largest safe value in javascript numbers
export default function example(state: BotState): number {
  return Number.MAX_SAFE_INTEGER;
}
