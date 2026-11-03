# BETQ — Pre-registered prospective market-relative sequential evidence v1
**Protocol frozen before evaluating the existing 2026 forward journal.**

## Research question
Do independently frozen BETQ Elo forecasts (and a separately frozen EPA challenger if present at that *same first qualifying* pregame snapshot) consistently assign higher likelihood to **subsequently settled** NFL outcomes than contemporaneous derived no-vig multi-book market consensus?

A higher likelihood is **not** equivalent to profitable bets, a market inefficiency, or a verified sportsbook execution edge. The public forward journal contains only derived probabilities, not entry quotes or fills.

## Source / freeze
- Only `data/evidence/nfl-2026.json`, captured prospectively; never historical 2022–2025 reconstructed odds.
- One observation per distinct NFL game: select the **earliest recorded** strictly pre-kickoff snapshot where independent Elo P(home), derived market P(home), model-built timestamp, provider-received timestamp, and at least 3 sportsbook contributors are present. Do not select based on game outcome or best subsequent price.
- Only source-observed records with market basis `NO_VIG_MULTI_BOOK_MEDIAN`, captured before kickoff; model, source and quote timestamps must be valid, at or before capture (up to 60s clock tolerance) and before kickoff. Reject late, malformed and invalid probabilities. If the selected record has no independently frozen EPA challenger, challenger likelihood is exactly market probability for that game (neutral LR=1); never look ahead to a later snapshot to add it.
- Settle only when a matched independent source has finalized non-tie score; apply the **highest recorded settlement revision** per game, never duplicate revisions as separate outcomes.
- Sort observations by kickoff UTC then game ID; no game can contribute more than once.

## Fixed statistical hypothesis and sequential diagnostics
Let `p_i` be the derived market probability for the actual home outcome, `q_E,i` Elo, `q_C,i` EPA challenger (or `p_i` when missing).
For each settled game `y_i in {0,1}`, define
`LR_model,i = [q_i/p_i]^y_i * [(1-q_i)/(1-p_i)]^(1-y_i)`.
The two cumulative likelihood-ratio products start at 1, and their **precommitted 50/50 mixture** is `E_n = 0.5*product_i LR_E,i + 0.5*product_i LR_C,i`. Keep calculations in log space to avoid overflow.
Under the **idealized and very strong sequential null** that `p_i = Pr(Y_i=1 | all prior results and available information)`, the likelihood ratios and fixed-weight mixture are e-processes and obey Ville's bound. The observed sportsbook consensus is NOT proven to satisfy this null (and games in a week may be dependent): actual e-values must not be marketed as exact 5% frequentist evidence of real price miscalibration.
- Fixed illustrative evidence threshold: `E_n >= 20`; record `crossedThreshold` as **research signal only**. Never authorize a wager or model promotion based on it.
- Also report cumulative paired game-level Brier and log-loss differences against the contemporaneous market (negative model improvement means market forecasts better).
- Withhold all aggregate performance rates, likelihood ratios and any threshold status from public display until at least **30 distinct finalized and qualified games**. Store count and gate status immediately.
- Existing derived market-movement results remain separate from outcome-based comparison and from verified CLV/ROI.
- For a synthetic null integrity check, run 1,000 deterministic worlds of 150 synthetic, independent Bernoulli draws with known p market and previsible candidate q; compute the share ever crossing 20. This tests one idealized condition, not sport markets broadly. Separately test an injected genuine signal without cherry-picking worlds.

## Data, security and release gates
- No odds API calls added, no new paid services, no bookstore/raw bookmaker prices stored in public GitHub, no user-entered forecast overrides.
- Existing `src/decision-policy.mjs` financial-execution lock stays authoritative.
- The live read-only `/api/shadow/derived` may include **only derived, source-safe aggregate research**, with all performance/likelihood measures withheld under n=30.
- Do not overstate results from repeatedly inspected past historical seasons; prospective 2026 evidence is distinct from historical v0.8 research.
- Every source file change triggers tests and documented source fingerprint in GitHub Actions, but private odds or bookmaker data must not enter publicly accessible artifacts.
- This v1 threshold and sample gate are fixed. If changed later, create version v2 and retain v1 results and rationale.
