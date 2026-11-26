/**
 * Vitest-Konfiguration der Testumgebung v1 (Symbaroum V14-Fork).
 *
 * Rahmen decisions (Konzept-Doc, 26.11.2026):
 *  - A4 "Erst-Suite minimal": drei Spec-Dateien (config, stacking, i18n),
 *    keine Testweltdaten (A3 -> Phase 2), kein Browser (Playwright -> Phase 3).
 *  - Umgebung: jsdom, damit window/document für UI-nahe Helfer existieren,
 *    Globals an (describe/it/expect ohne Imports - Foundry-Konvention).
 *  - tests/setup.mjs stellt den Foundry-Mock-Layer bereit: game, Hooks, ui,
 *    canvas, CONFIG, foundry.applications.api und die globalen Actor-/Item-
 *    Stub-Klassen. WICHTIG (Lernweis AP2/A6): globalThis.Actor/globalThis.Item
 *    muessen VOR dem Import der Produktmodule existieren, weil mergeStackDrop
 *    instanceof gegen den globalen Actor prueft und modernSheetConfig.js beim
 *    Import foundry.applications.api destrukturiert.
 *  - Default-Include: alle *.spec.mjs unter tests/unit/ - Rudolf ergaenzt
 *    spaetere Suites einfach als neue Dateien dort, ohne Config-Aenderung.
 *    (Bewusst nicht als Glob tests/unit/** in diesen Kommentar geschrieben:
 *     die Zeichenfolge schließt einen Block-Kommentar vorzeitig.)
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["tests/setup.mjs"],
		include: ["tests/unit/**/*.spec.mjs"],
		coverage: {
			provider: "v8",
			include: ["script/common/"],
			reporter: ["text", "html"],
		},
	},
});
