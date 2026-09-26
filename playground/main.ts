import { resolveRound, makeRng, type Player, type RoundResult } from "../src/rules.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const DEFAULT_NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Hank", "Iris", "Jack"];

let playerCount = 2;
let currentResult: RoundResult | null = null;
let revealedGroups = 0; // 0 = nothing revealed yet

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const roundInput    = document.getElementById("round-num")    as HTMLInputElement;
const countBtnsEl   = document.getElementById("count-btns")!;
const playerRowsEl  = document.getElementById("player-rows")!;
const btnResolve    = document.getElementById("btn-resolve")  as HTMLButtonElement;
const btnStep       = document.getElementById("btn-step")     as HTMLButtonElement;
const btnReset      = document.getElementById("btn-reset")    as HTMLButtonElement;
const stepCounter   = document.getElementById("step-counter")!;
const outputEl      = document.getElementById("output")!;
const tiersEl       = document.getElementById("tiers")!;
const narrationEl   = document.getElementById("narration")!;
const stepHintEl    = document.getElementById("step-hint")!;
const resultSection = document.getElementById("result-section")!;
const resultContent = document.getElementById("result-content")!;

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

buildCountButtons();
renderPlayerRows();

btnResolve.addEventListener("click", onResolve);
btnStep.addEventListener("click", onStep);
btnReset.addEventListener("click", onReset);
// Changing round number resets so the tiers / narration stay in sync.
roundInput.addEventListener("change", onReset);

// ---------------------------------------------------------------------------
// Count buttons
// ---------------------------------------------------------------------------

function buildCountButtons() {
  for (let n = 2; n <= 10; n++) {
    const btn = document.createElement("button");
    btn.className = "count-btn" + (n === playerCount ? " active" : "");
    btn.textContent = String(n);
    btn.dataset.n = String(n);
    btn.addEventListener("click", () => {
      playerCount = n;
      document.querySelectorAll<HTMLElement>(".count-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.n === String(n));
      });
      onReset();
      renderPlayerRows();
    });
    countBtnsEl.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------
// Player input rows
// ---------------------------------------------------------------------------

function renderPlayerRows() {
  playerRowsEl.innerHTML = "";
  for (let i = 0; i < playerCount; i++) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text"   class="p-name"  value="${DEFAULT_NAMES[i]}" placeholder="Name"></td>
      <td><input type="number" class="p-stash" value="10" min="0" class="wide"></td>
      <td><input type="number" class="p-bid"   value="0"  min="0" class="wide"></td>
    `;
    playerRowsEl.appendChild(tr);
  }
}

function getInputs(): { round: number; players: Player[]; bids: Record<string, number> } {
  const round = Math.max(1, parseInt(roundInput.value) || 2);
  const rows = Array.from(playerRowsEl.querySelectorAll("tr"));

  const players: Player[] = rows.map((row, i) => ({
    id: `p${i}`,
    name: (row.querySelector(".p-name") as HTMLInputElement).value.trim() || `Player ${i + 1}`,
    stash: Math.max(0, parseInt((row.querySelector(".p-stash") as HTMLInputElement).value) || 0),
  }));

  const bids: Record<string, number> = {};
  rows.forEach((row, i) => {
    bids[`p${i}`] = Math.max(0, parseInt((row.querySelector(".p-bid") as HTMLInputElement).value) || 0);
  });

  return { round, players, bids };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function onResolve() {
  const { round, players, bids } = getInputs();
  try {
    currentResult = resolveRound(round, players, bids, makeRng(1));
    revealedGroups = currentResult.log.narrationGroups.length;
    renderOutput();
  } catch (err) {
    showError(String(err));
  }
}

function onStep() {
  if (!currentResult) {
    // First step: resolve and show the opening group only.
    const { round, players, bids } = getInputs();
    try {
      currentResult = resolveRound(round, players, bids, makeRng(1));
      revealedGroups = 1;
    } catch (err) {
      showError(String(err));
      return;
    }
  } else if (revealedGroups < currentResult.log.narrationGroups.length) {
    revealedGroups++;
  }
  renderOutput();
}

function onReset() {
  currentResult = null;
  revealedGroups = 0;
  outputEl.hidden = true;
  btnStep.disabled = false;
  stepCounter.textContent = "";
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderOutput() {
  if (!currentResult) return;
  const { log, winners } = currentResult;
  outputEl.hidden = false;

  // ---- Tiers ----
  tiersEl.innerHTML = "";
  log.tiers.forEach((tier, i) => {
    const names = tier.playerIds.map(id => log.playerNames[id]).join(", ");
    const div = document.createElement("div");
    div.className = "tier-row" + (i === 0 ? " tier-t1" : "");
    div.textContent = `T${i + 1}:  ${names}  @  ${tier.bid}`;
    tiersEl.appendChild(div);
  });

  // ---- Narration groups ----
  narrationEl.innerHTML = "";
  const visible = log.narrationGroups.slice(0, revealedGroups);
  visible.forEach((group, gi) => {
    if (gi > 0) {
      const hr = document.createElement("hr");
      hr.className = "group-sep";
      narrationEl.appendChild(hr);
    }
    const div = document.createElement("div");
    div.className = "narration-group";
    group.forEach(line => {
      const p = document.createElement("p");
      p.textContent = line;
      div.appendChild(p);
    });
    narrationEl.appendChild(div);
  });

  // ---- Step counter / hint ----
  const total = log.narrationGroups.length;
  const allDone = revealedGroups >= total;

  if (allDone) {
    stepHintEl.textContent = "";
    btnStep.disabled = true;
    stepCounter.textContent = "";
  } else {
    const remaining = total - revealedGroups;
    stepHintEl.textContent = `${remaining} more step${remaining !== 1 ? "s" : ""}`;
    stepCounter.textContent = `(${revealedGroups} / ${total})`;
    btnStep.disabled = false;
  }

  // ---- Result ----
  const showResult = allDone;
  (resultSection as HTMLElement).hidden = !showResult;

  if (showResult) {
    resultContent.innerHTML = "";

    // Winner banner
    if (winners && winners.length > 0) {
      const banner = document.createElement("div");
      banner.className = "winner-banner";
      const names = winners.map(w => w.name).join(" and ");
      banner.textContent = winners.length === 1
        ? `${names} wins with ${winners[0].stash} bananas!`
        : `${names} are co-winners with ${winners[0].stash} bananas each!`;
      resultContent.appendChild(banner);
    }

    // Stash grid, sorted highest to lowest
    const winnerIds = new Set((winners ?? []).map(w => w.id));
    const sorted = [...currentResult.players].sort((a, b) => b.stash - a.stash);
    const grid = document.createElement("div");
    grid.className = "result-grid";

    sorted.forEach(p => {
      const before = log.snapshot[p.id];
      const delta = p.stash - before;
      const div = document.createElement("div");
      div.className = "result-player" + (winnerIds.has(p.id) ? " result-winner" : "");
      div.innerHTML = `
        <span class="result-name">${p.name}</span>
        <span class="result-stash">${p.stash}</span>
        <span class="result-delta">${before} ${delta >= 0 ? "+" : ""}${delta}</span>
      `;
      grid.appendChild(div);
    });

    resultContent.appendChild(grid);
  }
}

function showError(msg: string) {
  outputEl.hidden = false;
  tiersEl.innerHTML = "";
  narrationEl.innerHTML = `<p class="error">${msg}</p>`;
  stepHintEl.textContent = "";
  (resultSection as HTMLElement).hidden = true;
  stepCounter.textContent = "";
}
