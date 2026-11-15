# Frozen 2025 historical evaluation bundle

These are losslessly compressed copies of existing, locally retained experiment artifacts. Compression creates no new research records or forecast values. The originals were not edited. Both files must decompress to the original SHA-256 fingerprints checked by `src/historical-bundle.mjs`.

| File | Original bytes | Bundled gzip bytes | Original SHA-256 |
| --- | ---: | ---: | --- |
| spread-screen.json.gz | 4,694,517 | 756,757 | 2081da66b9dac6be4e08e6e630b629931c3382a0248e20e0461c6c74add36933 |
| lagged-efficiency-2023-2024-2025.json.gz | 2,310,327 | 244,515 | 4b9bab600ce82dc95bcb28792d0a76abf01e49701fd6b334e487db0de3a4e8c4 |

Combined compressed data: **1,001,272 bytes**, approximately 0.955 MiB. The server does not expose these raw archives. The browser receives a projected index (about 34 KB including provenance) and one game (about 15 KB, including all 50 analogs) at a time. Verified projections are cached in memory. Loading or navigating the ordinary app does not load the historical bundle or request historical data.

## Retained source licensing and attribution

Attribution: **nflverse / nflfastR contributors / Lee Sharpe**. The source manifest identifies the general data license as **CC BY 4.0**. The exact retained license text is included as `SOURCE-LICENSE.txt` and served through `/historical-source-license.txt` for readers. No FTN participation data was used in this experiment.

Original source releases retained in the manifest:

- https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv
- https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2023.csv.gz
- https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2024.csv.gz
- https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.csv.gz

Source license reference retained in the manifest: https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md

Changes already made by the original experiment: filtering plays, computing strict-lag aggregated EPA/success/rest features, and fitting the documented research models. This app integration only losslessly packages those files and displays their existing outputs, with derived arithmetic errors and provenance. No refitting, forecast generation, new source retrieval, simulated evidence or journal entry occurs.

CC BY 4.0 requires retention of attribution, license and warranty notices, source references when practicable, and an indication of changes. Those notices are carried in the viewer and this bundle. This is a review of retained notices, not fresh legal verification or a warranty that upstream parties have licensed every relevant right. The source is provided without warranties; official league certification and independent upstream rights clearance are not established. Publication/deployment remains separately unauthorized.

## Meaning

285 previously inspected 2025 games, not a pristine holdout or prospective scorecard. The correction did not beat the recorded closing-line benchmark. Quote timing, bookmaker identity, fillability, pregame QB availability, injuries and weather remain unverified. Analog frequencies are descriptive and market-conditioned, not validated probabilities, betting advice, verified ROI or CLV.
