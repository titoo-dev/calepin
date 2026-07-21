// Point d'entrée buildé en dist/ui.js, importé dynamiquement par calepin.mjs
// (voir docs/adr/0004). N'exporte que les 2 points d'entrée routés.
export { runUi } from './app.js';
export { runOnboardTui } from './onboard.js';
