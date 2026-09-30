import * as vm from "node:vm";
import * as fs from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import type { BotState } from "./bot-types.js";

// A GameBot is a per-game handle with a persistent vm context.
// Module-level variables in the bot's source survive across rounds within one game
// but are reset at the start of the next game (new context each game).
export type GameBot = {
  call: (state: BotState) => number;
};

export type LoadedBot = {
  name: string;
  createGame: () => GameBot;
  violations: number;
};

export function loadBot(filePath: string): LoadedBot {
  const source = fs.readFileSync(filePath, "utf8");
  const name = filePath.replace(/.*[\\/]/, "").replace(/\.[^.]+$/, "");

  const { outputText } = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 },
  });

  // Compiled once; run per game to populate a fresh context.
  const initScript = new vm.Script(outputText, { filename: filePath });
  // Per-round: call __fn(__state) and store the result in __result.
  const callScript = new vm.Script("__result = __fn(__state);");

  let violations = 0;

  function createGame(): GameBot {
    const exports: Record<string, unknown> = {};
    const module = { exports };
    const context = vm.createContext({ exports, module, Math, console });

    try {
      initScript.runInContext(context, { timeout: 100 });
    } catch (err) {
      console.warn(`[arena] ${name}: failed to initialise — ${err}`);
      violations++;
      return { call: () => 0 };
    }

    const fn = (module.exports as Record<string, unknown>)["default"];
    if (typeof fn !== "function") {
      console.warn(`[arena] ${name}: no default export function found`);
      violations++;
      return { call: () => 0 };
    }

    // Store the extracted function back into the context so callScript can reach it.
    (context as Record<string, unknown>)["__fn"] = fn;

    return {
      call(state: BotState): number {
        (context as Record<string, unknown>)["__state"] = Object.freeze({ ...state });
        (context as Record<string, unknown>)["__result"] = undefined;
        try {
          callScript.runInContext(context, { timeout: 100 });
        } catch (err) {
          console.warn(`[arena] ${name}: threw during call — ${err}`);
          violations++;
          return 0;
        }
        return validateBid(
          (context as Record<string, unknown>)["__result"],
          name,
          () => violations++,
        );
      },
    };
  }

  return { name, createGame, get violations() { return violations; } };
}

function validateBid(raw: unknown, name: string, onViolation: () => void): number {
  if (typeof raw !== "number" || !isFinite(raw)) {
    console.warn(`[arena] ${name}: returned non-finite value ${JSON.stringify(raw)}, forfeiting (bid=0)`);
    onViolation();
    return 0;
  }
  let bid = Math.round(raw);
  if (raw !== bid) {
    console.warn(`[arena] ${name}: returned non-integer ${raw}, rounding to ${bid}`);
    onViolation();
  }
  if (bid < 0) {
    console.warn(`[arena] ${name}: returned negative bid ${bid}, clamping to 0`);
    onViolation();
    bid = 0;
  }
  if (bid > Number.MAX_SAFE_INTEGER) {
    console.warn(`[arena] ${name}: bid exceeds MAX_SAFE_INTEGER, clamping`);
    onViolation();
    bid = Number.MAX_SAFE_INTEGER;
  }
  return bid;
}
