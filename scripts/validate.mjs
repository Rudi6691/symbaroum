#!/usr/bin/env node
/**
 * Symbaroum V14 - statische Validierungspipeline (Testumgebung v1, A1/A2).
 *
 * Zweck: Billige, schnelle Statik-Checks VOR der Unit-Suite - sie fangen
 * ganze Klassen von Fehlern ab, die sonst erst im Foundry-Client auffallen
 * (Block-Mismatch im Template = weißes Blatt, fehlender i18n-Key = roher
 * Schlüssel-Text in der UI, JSON-Tippfehler = System lädt gar nicht).
 *
 * Nutzung (KEINE Abhängigkeiten nötig, nur Node-Builtins - läuft auch vor
 * dem ersten npm install):
 *   node scripts/validate.mjs        bzw.    npm run validate
 * Exit-Code 0 = alles grün, 1 = mindestens ein Check rot (CI bricht ab).
 *
 * Checks (Konzept-Doc §5.2):
 *  1. Syntax: node --check über alle Produkt- und Test-Skripte
 *  2. HBS-Blockbilanz: je Template-Datei ist jeder geöffnete Block-Helper
 *     ({{#if}}, {{#each}}, ... auch Custom-Helper) wieder geschlossen
 *  3. CSS-Klammerbilanz je Datei (ohne *.map)
 *  4. JSON-Parse: system.json, template.json, package.json, lang/*.json
 *  5. i18n-Parität: de.json und en.json führen denselben Key-Satz
 *  6. i18n-Key-Existenz: statisch referenzierte Keys ({{localize "..."}}
 *     in Templates, i18n.localize("...")/format in Skripten) existieren
 *     in de.json UND en.json
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (file) => path.relative(ROOT, file);

/** Rekursiver Datei-Walk (sortiert für stabile Ausgaben). */
function* walk(dir, predicate) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(full, predicate);
		} else if (!predicate || predicate(full)) {
			yield full;
		}
	}
}

const is = (ext) => (file) => file.endsWith(ext);
const read = (file) => readFileSync(file, "utf8");
const readJson = (file) => JSON.parse(read(file));

const failures = [];

function record(name, problems, detail) {
	if (problems.length === 0) {
		console.log(`[OK]   ${name}${detail ? ` - ${detail}` : ""}`);
	} else {
		failures.push(name);
		console.log(`[FAIL] ${name} - ${problems.length} Problem(e):`);
		for (const problem of problems.slice(0, 20)) console.log(`       - ${problem}`);
		if (problems.length > 20) console.log(`       ... und ${problems.length - 20} weitere`);
	}
}

/* -------------------------------------------- */
/*  1. Syntax: node --check                      */
/* -------------------------------------------- */

{
	const files = [
		...walk(path.join(ROOT, "script"), is(".js")),
		...walk(path.join(ROOT, "scripts"), is(".mjs")),
		...walk(path.join(ROOT, "tests"), is(".mjs")),
		path.join(ROOT, "vitest.config.mjs"),
	].filter((file) => statSync(file).isFile());
	const problems = [];
	for (const file of files) {
		const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
		if (result.status !== 0) {
			problems.push(`${rel(file)}: ${(result.stderr || "").split("\n")[0]}`);
		}
	}
	record("Syntax (node --check)", problems, `${files.length} Dateien`);
}

/* -------------------------------------------- */
/*  2. HBS-Blockbilanz                           */
/* -------------------------------------------- */

{
	const files = [...walk(path.join(ROOT, "template"), is(".hbs"))];
	const problems = [];
	for (const file of files) {
		const content = read(file);
		const opened = {};
		const closed = {};
		for (const match of content.matchAll(/\{\{#([a-zA-Z][\w-]*)/g)) opened[match[1]] = (opened[match[1]] ?? 0) + 1;
		for (const match of content.matchAll(/\{\{\/([a-zA-Z][\w-]*)\}\}/g)) closed[match[1]] = (closed[match[1]] ?? 0) + 1;
		for (const [name, count] of Object.entries(opened)) {
			if ((closed[name] ?? 0) !== count) {
				problems.push(`${rel(file)}: {{#${name}}} ${count}x geöffnet, ${closed[name] ?? 0}x geschlossen`);
			}
		}
		/* Schließer ohne Öffner in derselben Datei sind ebenso ein Bruch. */
		for (const [name, count] of Object.entries(closed)) {
			if ((opened[name] ?? 0) !== count) {
				problems.push(`${rel(file)}: {{/${name}}} ${count}x geschlossen, ${opened[name] ?? 0}x geöffnet`);
			}
		}
	}
	record("HBS-Blockbilanz (template/)", problems, `${files.length} Templates`);
}

/* -------------------------------------------- */
/*  3. CSS-Klammerbilanz                         */
/* -------------------------------------------- */

{
	const files = [...walk(path.join(ROOT, "css"), (file) => file.endsWith(".css") && !file.endsWith(".css.map"))];
	const problems = [];
	for (const file of files) {
		const content = read(file);
		const open = (content.match(/\{/g) ?? []).length;
		const close = (content.match(/\}/g) ?? []).length;
		if (open !== close) problems.push(`${rel(file)}: ${open}x "{", ${close}x "}"`);
	}
	record("CSS-Klammerbilanz (css/)", problems, `${files.length} Dateien`);
}

/* -------------------------------------------- */
/*  4. JSON-Parse                                */
/* -------------------------------------------- */

{
	const files = [
		path.join(ROOT, "system.json"),
		path.join(ROOT, "template.json"),
		path.join(ROOT, "package.json"),
		...walk(path.join(ROOT, "lang"), is(".json")),
	];
	const problems = [];
	for (const file of files) {
		try {
			readJson(file);
		} catch (error) {
			problems.push(`${rel(file)}: ${error.message.split("\n")[0]}`);
		}
	}
	record("JSON-Parse (system/template/package/lang)", problems, `${files.length} Dateien`);
}

/* -------------------------------------------- */
/*  5. + 6. i18n-Checks                           */
/* -------------------------------------------- */

{
	const de = readJson(path.join(ROOT, "lang", "de.json"));
	const en = readJson(path.join(ROOT, "lang", "en.json"));

	/* Parität */
	{
		const deKeys = new Set(Object.keys(de));
		const enKeys = new Set(Object.keys(en));
		const problems = [
			...[...deKeys].filter((key) => !enKeys.has(key)).map((key) => `nur de.json: ${key}`),
			...[...enKeys].filter((key) => !deKeys.has(key)).map((key) => `nur en.json: ${key}`),
		];
		record("i18n-Parität de/en", problems, `${deKeys.size} = ${enKeys.size} Keys`);
	}

	/* Key-Existenz statisch referenzierter Schlüssel */
	{
		const referenced = new Map(); // key -> [Quellen]
		const add = (key, source) => {
			if (!referenced.has(key)) referenced.set(key, []);
			referenced.get(key).push(source);
		};
		/* Templates: {{localize "KEY"}} / {{localize 'KEY'}} */
		for (const file of walk(path.join(ROOT, "template"), is(".hbs"))) {
			const content = read(file);
			for (const match of content.matchAll(/\{\{localize\s+["']([^"']+)["']/g)) {
				add(match[1], rel(file));
			}
		}
		/* Skripte: i18n.localize("KEY") / i18n.format("KEY", ...) - schließt
		   game.i18n.localize(...) ein. Nur VOLLSTÄNDIG literarische Keys
		   (direkt gefolgt von ) oder ,) - zusammengesetzte Keys wie
		   "ITEM.Type" + item.type.capitalize() sind dynamisch und werden
		   bewusst nicht geprüft. */
		for (const file of walk(path.join(ROOT, "script"), is(".js"))) {
			const content = read(file);
			for (const match of content.matchAll(/i18n\s*\.\s*(?:localize|format)\(\s*["']([^"']+)["']\s*[,)]/g)) {
				add(match[1], rel(file));
			}
		}
		/* Bekannte Lücken: Keys, die absichtlich NICHT in den System-
		   Sprachdateien liegen. Jeder Eintrag braucht einen Grund; nach
		   Rudolfs Abnahme entweder beheben und hier streichen oder
		   dauerhaft dokumentiert lassen. */
		const KNOWN_GAPS = new Set([
			/* Aktuell leer. Testumgebung v1.1 (27.11.2026): der einzige
			   Eintrag (ARMOR.PC_PROTCETION, Tippfehler in template/chat/
			   item.hbs L. 73) ist nach Rudolfs Entscheidung B1 im Template
			   gefixt (jetzt ARMOR.PC_PROTECTION) und hier gestrichen. */
		]);
		const problems = [];
		for (const [key, sources] of [...referenced].sort(([a], [b]) => a.localeCompare(b))) {
			if (KNOWN_GAPS.has(key)) continue;
			if (de[key] === undefined) problems.push(`de.json fehlt: ${key} (z. B. ${sources[0]})`);
			if (en[key] === undefined) problems.push(`en.json fehlt: ${key} (z. B. ${sources[0]})`);
		}
		record("i18n-Key-Existenz (statische Referenzen)", problems, `${referenced.size} Keys geprüft`);
	}
}

/* -------------------------------------------- */
/*  Ergebnis                                     */
/* -------------------------------------------- */

console.log("");
if (failures.length > 0) {
	console.log(`ERGEBNIS: ROT - ${failures.length} Check(s) fehlgeschlagen: ${failures.join(", ")}`);
	process.exitCode = 1;
} else {
	console.log("ERGEBNIS: GRÜN - alle Checks bestanden.");
}
