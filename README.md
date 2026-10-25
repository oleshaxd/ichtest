# Idle Champions Helper

A small Russian-language browser app for keeping an Idle Champions roster and drafting a generic 10-slot formation.

## Use locally
Open `index.html` in a modern browser. Your roster and formation are stored in that browser's localStorage.

## Publish with GitHub Pages
1. Open repository **Settings → Pages**.
2. Under Build and deployment choose **Deploy from a branch**.
3. Choose branch `main` and folder `/(root)`, then Save.
4. Wait for the published URL to appear on the Pages screen.

## Import formats
Use the **Импорт (JSON/CSV)** button in the roster panel. Names are matched case-insensitively to the champion database.
- JSON: an array of champion names, or an object with `champions`, `roster`, or `characters`; optional `formation` array.
- CSV: champion names in the first column.

## Simulator
`simulator.html` (linked from the header) reads your roster/formation from localStorage. It shows **«Не рассчитан»** until `data/simulator-champions.json` contains verified effect records; numbers are never guessed. Filling that file automatically from `data/game-definitions.json` (produced by the weekly workflow) is the next step.

## Current limitations
- This is an early MVP. The formation grid is generic and does not yet model adventure-specific positions, champion abilities, buffs, or synergies.
- Automatic Steam/API roster sync is **not implemented yet**. Do not enter or publish your User ID or Hash in this version.
- No data is uploaded to a server; the browser stores the roster locally.
