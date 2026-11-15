# Read-only game strategy comparison

The Game Monitor now includes an expandable **Compare game strategies** panel on each game card and in retained NFL dossiers. It explains moneyline, spread/side and game-total alternatives without enabling wagers, paper staging, model promotion or stake recommendations.

## Evidence boundaries

- Uses only the already-loaded selected-market snapshot. Other markets are explicitly unavailable until independently selected and read from their existing cache. Opening or refreshing a panel makes no request.
- Displays both available quoted sides, exact line/book/price/time and conditional scenarios. It does not generate a preferred pick or a model confidence score.
- Synthetic event or source flags cannot be overridden by the UI's Live selection. Archived dossiers never acquire invented prices from their derived model probabilities.
- Unknown source, missing/future times, stale source/receipt, kickoff within five minutes and mismatched/duplicate contracts remain PASS. Standard integer and half-point full-game lines are supported; quarter-point and explicitly non-full-game contracts are excluded.
- Moneyline tie/overtime settlement is not assumed. Spread/total explanations describe standard rules; book-specific settlement rules remain unverified.
- Break-even win rate is American-price arithmetic conditional on non-push/non-void results, not an estimate of the game's outcome. A 100-unit worked example is explicitly hypothetical, not a recommended stake, and excludes fees/taxes.
- Every strategy is PASS, suggested stake is zero, and no execution/paper controls are added. Higher win rate, model agreement or a positive displayed price difference never changes that authority.
- Alternative contracts can be correlated or mutually exclusive. No parlay probability, guaranteed hedge, arbitrage return or portfolio diversification is inferred.

## Implementation

`public/game-strategies.js` exposes a small frozen browser API: `build`, `render` and `refresh`. It has no network, storage, credentials or order dependencies. It escapes all dynamic strings and uses native disclosure elements. The existing 15-second UI clock updates only noninteractive panel content, preserving the disclosure and summary node. Contexts are pruned only after panels unmount, so large visible slates continue aging.

The main UI adds three narrow hooks: game cards, retained dossiers, and the existing clock. A static asset allowlist entry and deferred script tag load the feature. App CSP is unchanged. Existing source data, model artifacts, provider budgets and execution authority are untouched.

## Verification

- `npm test`: 477 offline Node tests pass, including 13 new strategy tests.
- `npm run check`: syntax checks pass, including the new asset.
- `git diff --check`: passes.
- `python tests/game-strategies-browser.py [artifact-directory]`: prepared offline desktop/mobile QA for all three markets, keyboard/repeated disclosure flows, focus preservation, aging and absence of network actions. **Not executed successfully in this environment:** Chromium fails at launch with `process_singleton_posix.cc ... socket() failed: Operation not permitted`, including the approved escalated attempt. No screenshot or visual/mobile verification is claimed.
- The existing optional browser-audit fixture was updated to serve the new script but likewise has not been rerun successfully here.

No provider calls, purchases, wagers, deployment or publication were performed. The feature is local and must be integrated and verified before production use.
