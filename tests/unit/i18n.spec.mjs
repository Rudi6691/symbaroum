/**
 * Suite 3: i18n - Parität und Schlüssel-Existenz (de/en).
 *
 * Ziel (A4): Die Sprach-Dateien sind die größte manuell gepflegte Fläche
 * des Systems (2963+ Keys je Sprache). Die Suite pinnt zwei Invarianten:
 *  - Parität: de.json und en.json führen exakt denselben Key-Satz
 *    (keine einseitigen Keys) - eine neue Zeile nur in einer Sprache
 *    schlägt sofort an.
 *  - Schlüssel-Existenz: die Keys, die stacking.js (AP2) tatsächlich
 *    referenziert, existieren in BEIDEN Sprachen und führen dieselben
 *    Platzhalter ({name}/{count}) - driftende Platzhalter zwischen den
 *    Sprachen sind ein klassischer stiller UI-Bruch.
 *
 * Nur de/en sind Pflege-Sprachen des Forks (Konzept-Doc §4.1); die
 * Community-Sprachen (es/fr/it/pt-BR/sv) werden nicht auf Parität geprüft.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { repoPath } from "../helpers/repo-paths.mjs";

const load = (file) => JSON.parse(readFileSync(repoPath("lang", file), "utf8"));

const de = load("de.json");
const en = load("en.json");

/** Platzhalter-Menge eines Format-Strings, z. B. "{name} ({count})" => {name, count}. */
const placeholders = (template) =>
	new Set([...String(template).matchAll(/\{(\w+)\}/g)].map((match) => match[1]));

describe("i18n: Parität de/en", () => {
	it("führt denselben Key-Satz (keine einseitigen Keys, in keine Richtung)", () => {
		const deKeys = new Set(Object.keys(de));
		const enKeys = new Set(Object.keys(en));
		const onlyDe = [...deKeys].filter((key) => !enKeys.has(key));
		const onlyEn = [...enKeys].filter((key) => !deKeys.has(key));
		expect(onlyDe, "Keys nur in de.json").toEqual([]);
		expect(onlyEn, "Keys nur in en.json").toEqual([]);
	});

	it("behält beide Sprachen eine wesentliche Key-Menge (Sanity gegen versehentliches Leer-Merge)", () => {
		expect(Object.keys(de).length).toBeGreaterThan(2000);
		expect(Object.keys(en).length).toBe(Object.keys(de).length);
	});
});

describe("i18n: STACK-Schlüssel der Stapel-Logik (AP2)", () => {
	const STACK_KEYS = [
		"STACK.LABEL",
		"STACK.NUMBER_TOOLTIP",
		"STACK.SPLIT_LABEL",
		"STACK.SPLIT_HINT",
		"STACK.SPLIT_INFO",
		"STACK.MERGE_INFO",
	];

	it("existiert in de.json UND en.json", () => {
		for (const key of STACK_KEYS) {
			expect(de[key], `de.json fehlt: ${key}`).toBeDefined();
			expect(en[key], `en.json fehlt: ${key}`).toBeDefined();
		}
	});

	it("führt in beiden Sprachen dieselben Platzhalter {name}/{count}", () => {
		for (const key of ["STACK.SPLIT_INFO", "STACK.MERGE_INFO"]) {
			expect([...placeholders(de[key])].sort(), `${key}: Platzhalter weichen ab`).toEqual(
				[...placeholders(en[key])].sort()
			);
		}
	});
});
