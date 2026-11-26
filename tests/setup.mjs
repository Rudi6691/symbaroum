/**
 * Vitest-Setup: Foundry-Mock-Layer für die Symbaroum-Testumgebung v1.
 *
 * Rahmen (Konzept-Doc §5, A4 "Erst-Suite minimal"):
 *  - Kein echtes Foundry, keine Lizenz, kein Netz - die Unit-Suite läuft
 *    gegen die echten Produktmodule aus script/common/ und ersetzt nur die
 *    Foundry-Laufzeitumgebung durch deterministische Stubs.
 *  - i18n: echtes lang/de.json (keine Fake-Texte) - localize/format
 *    verhalten sich wie Foundry (fehlender Key => Key selbst).
 *  - Einstellungen: game.settings.get liefert undefined, solange nichts
 *    gesetzt ist; die Produktmodule pumpen ihre Defaults selbst über ?? 10
 *    (getCurrencyRates). set() speichert im Map-Store.
 *
 * Lernweis-kritische Punkte (Reihenfolge ist Absicht, nicht Stil):
 *  1. globalThis.Actor / globalThis.Item Müssen VOR jedem Import der
 *     Produktmodule existieren: mergeStackDrop prüft sourceParent
 *     instanceof Actor gegen den GLOBAL, und Modul-Scope-Code (z. B.
 *     resources.js L/F-Helfer) referenziert game beim Aufruf.
 *  2. modernSheetConfig.js destrukturiert foundry.applications.api beim
 *     IMPORT (Modul-Scope!) - der Stub muss also stehen, bevor Vitest die
 *     Spec-Dateien lädt, die (transitiv über stacking.js -> container.js ->
 *     resources.js) modernSheetConfig importieren.
 *  3. HandlebarsApplicationMixin wird als Mixin aufgerufen
 *     (ModernSheetConfig extends HandlebarsApplicationMixin(Application)),
 *     der Stub ist deshalb eine callable Funktion, die die Basis-Klasse
 *     zurückgibt.
 *
 * Test-Fixtures (makeItem/makeActor) liegen in tests/helpers/fixtures.mjs
 * und werden von den Specs direkt importiert - setup.mjs installiert nur
 * die globale Laufzeit.
 */
import { readFileSync } from "node:fs";
import { makeItem } from "./helpers/fixtures.mjs";
import { repoPath } from "./helpers/repo-paths.mjs";

/* -------------------------------------------- */
/*  i18n: echtes lang/de.json                    */
/* -------------------------------------------- */

const deLang = JSON.parse(readFileSync(repoPath("lang", "de.json"), "utf8"));

function formatString(template, data = {}) {
	return String(template).replace(/\{(\w+)\}/g, (match, name) =>
		Object.prototype.hasOwnProperty.call(data, name) ? String(data[name]) : ""
	);
}

const i18n = {
	localize: (key) => deLang[key] ?? key,
	format: (key, data) => formatString(deLang[key] ?? key, data),
};

/* -------------------------------------------- */
/*  game: Settings-Store, User, Symbaroum-API    */
/* -------------------------------------------- */

const settingsStore = new Map();

const game = {
	i18n,
	settings: {
		get: (scope, key) => settingsStore.get(`${scope}.${key}`),
		set: (scope, key, value) => settingsStore.set(`${scope}.${key}`, value),
	},
	user: {
		id: "test-user",
		isGM: true,
	},
	symbaroum: {
		api: {},
	},
	/* Tests können den Store prüfen/leeren (z. B. für Kurs-Tests). */
	__testSettings: settingsStore,
};

/* -------------------------------------------- */
/*  Hooks / ui / canvas / CONFIG / foundry       */
/* -------------------------------------------- */

const hookCalls = [];

const Hooks = {
	on: (name, fn) => hookCalls.push({ type: "on", name }),
	once: (name, fn) => hookCalls.push({ type: "once", name }),
	off: () => {},
	call: (name, ...args) => hookCalls.push({ type: "call", name }),
};

const notifications = [];

const ui = {
	notifications: {
		info: (msg) => notifications.push({ level: "info", msg }),
		warn: (msg) => notifications.push({ level: "warn", msg }),
		error: (msg) => notifications.push({ level: "error", msg }),
	},
};

/* -------------------------------------------- */
/*  Globale Klassen: VOR Produkt-Import-Phase!    */
/*  (siehe Lernweis-Kommentar oben, Punkt 1/2)   */
/* -------------------------------------------- */

globalThis.Actor = class MockActor {
	constructor({ id = "actor-1", items = [], isOwner = true } = {}) {
		this.id = id;
		this.isOwner = isOwner;
		this.items = items;
		this.items.get = (itemId) => items.find((entry) => entry && entry.id === itemId) ?? null;
		for (const item of items) item.parent ??= this;
		this.created = [];
		this.deleted = [];
		this.updates = [];
	}
	async createEmbeddedDocuments(_type, dataArray) {
		const created = dataArray.map((data) => makeItem(data));
		for (const item of created) item.parent = this;
		this.created.push(...created);
		return created;
	}
	async deleteEmbeddedDocuments(_type, ids) {
		this.deleted.push(...ids);
		return [];
	}
	async update(changes) {
		this.updates.push(changes);
		return this;
	}
};

globalThis.Item = class MockItem {};

globalThis.game = game;
globalThis.Hooks = Hooks;
globalThis.ui = ui;
globalThis.canvas = {};
globalThis.CONFIG = {};
globalThis.foundry = {
	applications: {
		api: {
			Application: class MockApplication {},
			HandlebarsApplicationMixin: (Base) => Base,
		},
	},
	utils: {},
};
