/**
 * Repo-Pfad-Auflösung für Tests (Lernweis aus der v1.2-Testrunde:
 * "TypeError: The URL must be of scheme file").
 *
 * Hintergrund: `new URL("../lang/de.json", import.meta.url)` funktioniert in
 * echtem Node-ESM (Import.meta.url hat dort ein file:-Schema), ABER der
 * vitest-Modul-Runner führt Dateien über seine eigene Pipeline aus, in der
 * import.meta.url KEIN file:-Schema trägt - fileURLToPath/new URL schlagen
 * dann fehl und reißen die gesamte Suite (alle 3 Specs scheiterten am
 * setup.mjs-Import, 0 Tests liefen).
 *
 * Lösung mit zwei Stufen:
 *  1. file:-Schema verfügbar (echtes Node, z. B. der Sandbox-Harness):
 *     Pfad relativ zu dieser Datei auflösen - immer korrekt, egal aus
 *     welchem Verzeichnis Node gestartet wurde.
 *  2. Andernfalls (vitest-Modul-Runner): über das Projekt-Stammverzeichnis
 *     auflösen. process.cwd() ist die vitest-Projekt-Wurzel, wenn die Suite
 *     wie üblich aus dem Repo-Stamm gestartet wird (npm test / CI).
 *
 * Nutzt diese Datei für JEDE Datei-Referenz aus dem Test-Kontext statt
 * new URL(..., import.meta.url) - sonst tritt derselbe Fehler an der
 * nächsten Stelle wieder auf.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Löst einen Repo-relativen Pfad auf.
 * @param {...string} segments  Repo-relative Pfadteile, z. B. ("lang", "de.json")
 * @returns {string} absoluter Dateisystem-Pfad
 */
export function repoPath(...segments) {
	const relative = path.join(...segments);
	try {
		/* tests/helpers/ liegt zwei Ebenen unter dem Repo-Stamm. */
		const here = path.dirname(fileURLToPath(import.meta.url));
		return path.resolve(here, "..", "..", relative);
	} catch {
		/* vitest-Modul-Runner: kein file:-Schema in import.meta.url. */
		return path.resolve(process.cwd(), relative);
	}
}
