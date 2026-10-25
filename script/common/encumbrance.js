/**
 * A39 - Belastungssystem (optionale Regeln aus dem Advanced Player's Guide).
 *
 * Rudolfs Design-Entscheidungen (25.10.2026):
 *  - Grobe Gewichtskategorien statt kg: Items tragen eine Kategorie
 *    (system.weight), die intern auf Gewichtseinheiten (GE) abgebildet wird.
 *      Keine Angabe/none    = 0 GE    (Alt-Items, Kleidung, leichte Behälter)
 *      Winzig/tiny         = 0,02 GE (25 Winzige = Leicht, 50 Winzige = Normal;
 *                                    RAW: kleine Gegenstände zählen 1 pro 50)
 *      Leicht/light        = 0,5 GE  (Kurz-Waffen, Proviantration)
 *      Normal/normal       = 1 GE    (Standardwaffen und -ausrüstung)
 *      Schwer/heavy        = 2 GE    (Massiv-Waffen, Rüstung Behinderung 2)
 *      Sehr schwer/veryheavy = 3 GE  (Rüstung Behinderung 3/4, Truhen)
 *      Zu schwer/toolarge  = nie tragbar (Belagerungsgerät, Reittiere)
 *    Halbe Gewichtseinheiten sind erlaubt; die Stückzahl (system.number)
 *    multipliziert das Item-Gewicht.
 *  - Grenzen auf Strong/Stärke bezogen (APG-Default):
 *      unbelastet bis Stärke (bzw. Stärke x 1,5 mit dem Segen Packesel),
 *      jeder angefangene GE darüber = -1 Verteidigung (automatisch, analog
 *      zur Rüstungsbehinderung),
 *      harte Grenze = Stärke x Schwellwert (Welt-Setting, Default 2) - darüber
 *      kann sich der Charakter nur noch kurze Strecken bewegen (Anzeige).
 *  - Vermögen zählt mit: je volle 50 Thaler Gesamtwert = 1 GE (in Vielfachen,
 *    berechnet über die konfigurierten Wechselkurse aus system.currency).
 *  - Getragene (aktive) Rüstung zählt nicht - sie hat ihre Rüstungsbehinderung;
 *    nur mitgeführte Rüstung zählt. Waffen zählen immer („in der Hand" wird
 *    nicht getrackt, das bleibt SL-Ermessen).
 *  - Die Reisefolgen (Marschkategorien-Verschlechterung, Todesmarsch-Malus)
 *    sind bewusst NICHT automatisiert - nur Anzeige/Dokumentation.
 *
 * Welt-Settings (hooks.js): encumbranceEnabled (Checkbox, Default aus) und
 * encumbranceHardLimitMultiplier (Default 2). Das Feld system.weight wird
 * NIE per template.json-Default gesetzt (Foundry mischt Template-Defaults
 * zur Laufzeit in alle Bestände - A38-Lernweis), sondern per preCreate-Hook
 * bei Neuanlage; Alt-Items bleiben unangetastet und werden vom GM-Makro
 * encumbranceMigration() mit Vorschlägen versehen.
 */
import { SYMBAROUM } from "./config.js";
import { getCurrencyRates } from "./currency.js";

/* -------------------------------------------- */
/*  Einstellungen                               */
/* -------------------------------------------- */

/**
 * Ob die optionalen Belastungsregeln aktiviert sind (Welt-Setting).
 * @returns {boolean}
 */
export function isEncumbranceEnabled() {
	try {
		return !!game.settings.get("symbaroum", "encumbranceEnabled");
	} catch {
		return false;
	}
}

/**
 * Schwellwert der harten Grenze: harte Grenze = Stärke x diesem Wert.
 * @returns {number} >= 1, Default 2 (APG)
 */
export function getHardLimitMultiplier() {
	const value = Number(game.settings.get("symbaroum", "encumbranceHardLimitMultiplier"));
	return Number.isFinite(value) && value >= 1 ? value : 2;
}

/* -------------------------------------------- */
/*  Item-Gewicht                                 */
/* -------------------------------------------- */

/**
 * Die Definitionszeile einer Gewichtskategorie (Fallback: "none" = Nullwert,
 * auch für fehlende/unbekannte Felder - Alt-Items gelten damit als lastfrei,
 * bis das Migrationsmakro sie versieht).
 * @param {string|null} categoryId
 * @returns {{id: string, label: string, value: number|null}}
 */
export function getWeightCategory(categoryId) {
	if (typeof categoryId !== "string") return SYMBAROUM.weight.none;
	return SYMBAROUM.weight[categoryId] ?? SYMBAROUM.weight.none;
}

/**
 * Gewicht eines einzelnen Items in GE (x Stückzahl), oder null, wenn das
 * Item nicht in die Last eingeht ("Zu schwer" = nie tragbar; getragene
 * Rüstung - sie hat stattdessen ihre Rüstungsbehinderung).
 * @param {Item} item
 * @returns {number|null}
 */
export function getItemLoadGE(item) {
	if (!item?.system?.isGear) return null;
	const category = getWeightCategory(item.system.weight);
	if (category.id === "toolarge") return null;
	// Getragene Rüstung zählt nicht:isActive = state "active" (protectiv getragen).
	if (item.system.isArmor && item.system.isActive) return null;
	const number = Math.max(1, Math.round(Number(item.system.number ?? 1) || 1));
	return roundGE(category.value * number);
}

/** Auf 2 Nachkommastellen runden (Winzig = 0,02 - kein Float-Drift). */
function roundGE(value) {
	return Math.round(value * 100) / 100;
}

/** Anzeige eines GE-Werts: maximal 2 Nachkommastellen, überflüssige Nullen weg. */
export function formatGE(value) {
	return String(roundGE(Number(value) || 0)).replace(".", ",");
}

/* -------------------------------------------- */
/*  Segen Packesel                              */
/* -------------------------------------------- */

/**
 * Erkennt den Segen Packesel (APG): Belastungsgrenze Stärke x 1,5 abgerundet.
 * Namensbasiert (deutsch/englisch) - der Segen liegt als boon-Item vor.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasPackMule(actor) {
	return !!actor.items.find(
		(item) => item.type === "boon" && /packesel|beast\s*of\s*burden|pack\s*mule/i.test(item.name ?? "")
	);
}

/* -------------------------------------------- */
/*  Belastungsdaten des Aktors                   */
/* -------------------------------------------- */

/**
 * Vollständige Belastungsberechnung für einen Aktor.
 *
 * @param {Actor} actor
 * @returns {{
 *   enabled: boolean, show: boolean,
 *   loadGE: number, moneyGE: number, tooHeavyCount: number,
 *   strong: number, packMule: boolean, threshold: number,
 *   baseLimit: number, hardLimit: number,
 *   isLoaded: boolean, beyondHard: boolean, defenseMalus: number,
 *   pct: number, basePct: number,
 *   loadDisplay: string, baseLimitDisplay: string, hardLimitDisplay: string,
 *   state: "ok"|"loaded"|"over", stateLabel: string,
 *   malusLine: string|null, tooltip: string
 * }}
 */
export function getEncumbranceData(actor) {
	const enabled = isEncumbranceEnabled();
	const data = {
		enabled,
		show: enabled,
		loadGE: 0,
		moneyGE: 0,
		tooHeavyCount: 0,
		strong: 0,
		packMule: false,
		threshold: getHardLimitMultiplier(),
		baseLimit: 0,
		hardLimit: 0,
		isLoaded: false,
		beyondHard: false,
		defenseMalus: 0,
		pct: 0,
		basePct: 0,
		loadDisplay: "0",
		baseLimitDisplay: "0",
		hardLimitDisplay: "0",
		state: "ok",
		stateLabel: game.i18n.localize("WEIGHT.STATE_OK"),
		malusLine: null,
		tooltip: "",
	};
	if (!actor) return data;

	/* --- Last: Items --- */
	let load = 0;
	for (const item of actor.items) {
		if (!item?.system?.isGear) continue;
		const category = getWeightCategory(item.system.weight);
		if (category.id === "toolarge") {
			data.tooHeavyCount++;
			continue;
		}
		if (item.system.isArmor && item.system.isActive) continue; // getragene Rüstung
		const number = Math.max(1, Math.round(Number(item.system.number ?? 1) || 1));
		load += category.value * number;
	}

	/* --- Last: Vermögen (je volle 50 Thaler Gesamtwert = 1 GE) --- */
	const currency = Number(actor.system?.currency);
	if (Number.isFinite(currency) && currency > 0) {
		const rates = getCurrencyRates(); // rates.thaler = Orteg pro Thaler
		const ortegPerGE = 50 * rates.thaler;
		data.moneyGE = Math.floor(currency / ortegPerGE);
		load += data.moneyGE;
	}

	data.loadGE = roundGE(load);
	data.loadDisplay = formatGE(data.loadGE);

	/* --- Grenzen --- */
	data.strong = Math.max(0, Math.round(Number(actor.system?.attributes?.strong?.total) || 0));
	data.packMule = hasPackMule(actor);
	const packFactor = data.packMule ? 1.5 : 1;
	data.baseLimit = Math.floor(data.strong * packFactor);
	data.hardLimit = Math.floor(data.strong * packFactor * data.threshold);
	data.baseLimitDisplay = formatGE(data.baseLimit);
	data.hardLimitDisplay = formatGE(data.hardLimit);

	/* --- Zustand und Malus --- */
	data.isLoaded = data.loadGE > data.baseLimit;
	data.beyondHard = data.hardLimit > 0 && data.loadGE > data.hardLimit;
	// Jeder angefangene GE über der Belastungsgrenze zählt voll (halbe GE erlaubt)
	data.defenseMalus = data.isLoaded ? Math.ceil(roundGE(data.loadGE - data.baseLimit)) : 0;

	if (data.beyondHard) {
		data.state = "over";
		data.stateLabel = game.i18n.localize("WEIGHT.STATE_OVER");
	} else if (data.isLoaded) {
		data.state = "loaded";
		data.stateLabel = game.i18n.localize("WEIGHT.STATE_LOADED");
	}

	if (data.hardLimit > 0) {
		data.pct = Math.min(100, Math.round((data.loadGE / data.hardLimit) * 1000) / 10);
		data.basePct = Math.min(100, Math.round((data.baseLimit / data.hardLimit) * 1000) / 10);
	} else if (data.loadGE > 0) {
		data.pct = 100;
		data.basePct = 0;
	}

	if (data.defenseMalus > 0) {
		data.malusLine = game.i18n.format("WEIGHT.MALUS_LINE", { malus: data.defenseMalus });
	}

	/* --- Tooltip (Mehrzeiler) --- */
	const lines = [
		game.i18n.format("WEIGHT.TOOLTIP_LOAD", { load: data.loadDisplay, money: formatGE(data.moneyGE) }),
		game.i18n.format("WEIGHT.TOOLTIP_BASE", {
			limit: data.baseLimitDisplay,
			pack: data.packMule ? ` (${game.i18n.localize("WEIGHT.PACKMULE_HINT")})` : "",
		}),
		game.i18n.format("WEIGHT.TOOLTIP_HARD", { limit: data.hardLimitDisplay, threshold: formatGE(data.threshold) }),
	];
	if (data.defenseMalus > 0) {
		lines.push(game.i18n.format("WEIGHT.TOOLTIP_MALUS", { malus: data.defenseMalus }));
	}
	if (data.beyondHard) {
		lines.push(game.i18n.localize("WEIGHT.TOOLTIP_HINT_OVER"));
	}
	if (data.isLoaded) {
		lines.push(game.i18n.localize("WEIGHT.TOOLTIP_HINT_TRAVEL"));
	}
	data.tooltip = lines.join("<br />");

	return data;
}
