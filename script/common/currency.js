/**
 * A38 - Währungssystem (Crucible-Architektur).
 *
 * Rudolfs Design-Entscheidungen (25.10.2026):
 *  - Crucible-Modell: der Aktor speichert EINE Ganzzahl in der Basis-Einheit
 *    Orteg (system.currency); Thaler/Schilling sind reine Umrechnungs-Ansichten.
 *  - Wechselkurse als Systemeinstellungen (Default: 1 Thaler = 10 Schilling =
 *    100 Orteg), Währungsnamen fest aus den Sprachdateien.
 *  - UI-Element <symbaroum-currency>: editierbar drei Denominationen mit
 *    Delta-Syntax (z. B. "+3" im Schilling-Feld für gefundene Schilling),
 *    ReadOnly kompakt mit Null-Ausblendung plus Gesamtzeile.
 *  - Wechselgeld entsteht automatisch (Abzug von der Ganzzahl, Anzeige
 *    zerlegt neu) - keine SL-Rückfrage.
 *  - Bezahlen/Kauf-UI ist bewusst NICHT Teil von A38; externe Module docken
 *    an die API an (game.symbaroum.api.deductActorCurrency usw.).
 *
 * Die alten Felder (system.money.thaler/shilling/orteg auf Akteuren,
 * system.cost als Freitext auf Items) bleiben unangetastet und werden nur
 * ausgeblendet; das GM-Migrations-Makro (macro.js, currencyMigration)
 * überträgt sie in das neue Modell (Löschung in einem späteren Release).
 */
import { SYMBAROUM } from "./config.js";

/* -------------------------------------------- */
/*  Kurs-Konfiguration                          */
/* -------------------------------------------- */

/**
 * Die aktuellen Wechselkurse aus den Systemeinstellungen, immer >= 1.
 * shilling = X Orteg (Einstellung currencyShillingOrteg, Default 10)
 * thaler   = X Schilling (Einstellung currencyThalerShilling, Default 10)
 * @returns {{orteg: number, shilling: number, thaler: number}} Multiplikatoren relativ zur Basis-Einheit Orteg
 */
export function getCurrencyRates() {
	const oPerS = Math.max(1, Math.round(game.settings.get("symbaroum", "currencyShillingOrteg") ?? 10));
	const sPerT = Math.max(1, Math.round(game.settings.get("symbaroum", "currencyThalerShilling") ?? 10));
	return { orteg: 1, shilling: oPerS, thaler: sPerT * oPerS };
}

/**
 * Die Denominations-Definitionen in Anzeige-Reihenfolge (große zuerst),
 * mit den aktuellen Kursen. Die Namen/Labels kommen fest aus den
 * Sprachdateien (Rudolfs Entscheidung 3), nur die Kurse sind einstellbar.
 * @returns {Array<{id: string, multiplier: number, label: string, abbreviation: string}>}
 */
export function getDenominations() {
	const rates = getCurrencyRates();
	return ["thaler", "shilling", "orteg"].map((id) => ({
		id,
		multiplier: rates[id],
		label: game.i18n.localize(SYMBAROUM.currency[id].label),
		abbreviation: game.i18n.localize(SYMBAROUM.currency[id].abbreviation),
	}));
}

/**
 * Konvertiert eine Mengen-Angabe pro Denomination in den Basiswert in Orteg.
 * Crucible-Entsprechung: CrucibleActor.convertCurrency.
 * @param {Record<string, number>} amounts z. B. { thaler: 1, shilling: 3, orteg: 5 }
 * @returns {number} Ganzzahliger Basiswert in Orteg (gerundet)
 */
export function convertToBase(amounts = {}) {
	if (typeof amounts !== "object" || amounts === null) {
		throw new Error("convertToBase: amounts must be an object of {denomination: number}");
	}
	const rates = getCurrencyRates();
	let total = 0;
	for (const [id, value] of Object.entries(amounts)) {
		const multiplier = rates[id];
		if (multiplier === undefined || !Number.isFinite(Number(value))) continue;
		total += Math.round(Number(value) * multiplier);
	}
	return total;
}

/**
 * Zerlegt einen Basiswert gierig in große Denominationen zuerst
 * (Crucible-Entsprechung: CrucibleActor.allocateCurrency). Je nach Kursen
 * kann ein Rest bleiben, wenn eine kleine Denomination fehlt - hier nicht
 * möglich, da orteg immer Multiplikator 1 hat.
 * @param {number} amount Basiswert in Orteg
 * @param {string} [preferred] optionale Bevorzugung ab einer Denomination (abwärts)
 * @returns {Record<string, number>}
 */
export function allocateFromBase(amount = 0, preferred) {
	const denominations = getDenominations();
	const allocated = {};
	let rest = Math.max(0, Math.round(Number(amount) || 0));
	let reached = preferred === undefined;
	for (const d of denominations) {
		allocated[d.id] = 0;
		if (!reached) {
			if (d.id === preferred) reached = true;
			else continue;
		}
		allocated[d.id] = Math.floor(rest / d.multiplier);
		rest = rest % d.multiplier;
	}
	return allocated;
}

/**
 * Wendet eine Benutzereingabe aus einem Denominations-Feld auf den
 * Gesamtbestand an (Crucible-Delta-Syntax):
 *   "+3" / "-2"  -> Zu-/Abschlag in dieser Denomination
 *   "=10" / "10" -> dieser Anteil wird gesetzt, die anderen Anteile
 *                   bleiben wie aufgeteilt
 * @param {number} currentTotal aktueller Basiswert
 * @param {string} denominationId
 * @param {string} rawInput
 * @returns {{total: number, error: string|null}} neuer Basiswert oder Fehlermeldung
 */
export function applyDenominationInput(currentTotal, denominationId, rawInput) {
	const rates = getCurrencyRates();
	const multiplier = rates[denominationId];
	if (multiplier === undefined) return { total: currentTotal, error: "MONEY.WARN_INVALID" };
	const raw = String(rawInput ?? "").trim();
	if (raw === "") return { total: currentTotal, error: null };

	let total = null;
	if (raw.startsWith("+") || (raw.startsWith("-") && raw !== "-")) {
		const delta = Number(raw);
		if (!Number.isFinite(delta)) return { total: currentTotal, error: "MONEY.WARN_INVALID" };
		const newTotal = Math.round(currentTotal) + Math.round(delta * multiplier);
		if (newTotal < 0) return { total: currentTotal, error: "MONEY.WARN_INSUFFICIENT" };
		total = newTotal;
	} else {
		let value = raw;
		if (value.startsWith("=")) value = value.slice(1);
		const parsed = Number(String(value).replace(",", "."));
		if (!Number.isFinite(parsed) || parsed < 0) return { total: currentTotal, error: "MONEY.WARN_INVALID" };
		const amounts = allocateFromBase(currentTotal);
		amounts[denominationId] = parsed;
		total = convertToBase(amounts);
	}
	if (total === null || total < 0) return { total: currentTotal, error: "MONEY.WARN_INVALID" };
	return { total, error: null };
}

/**
 * Formatiert einen Basiswert als lesbare Aufzählung (für Enricher/Chat),
 * Null-Denominationen werden übersprungen. Leerstring bei 0.
 * @param {number} amount
 * @returns {string}
 */
export function formatCurrency(amount = 0) {
	const total = Math.max(0, Math.round(Number(amount) || 0));
	if (total === 0) return "";
	const amounts = allocateFromBase(total);
	const parts = [];
	for (const d of getDenominations()) {
		if (amounts[d.id] > 0) parts.push(`${amounts[d.id]} ${d.label}`);
	}
	return parts.join(", ");
}

/* -------------------------------------------- */
/*  Aktor-Zugriff & Bezahlfunktionen            */
/* -------------------------------------------- */

/**
 * Der Basiswert eines Akteurs in Orteg; null, solange der Akteur noch nicht
 * migriert wurde (system.currency fehlt) - die Migrations-Übersicht
 * (macro.js) prüft genau darauf.
 * @param {Actor} actor
 * @returns {number|null}
 */
export function getActorCurrencyTotal(actor) {
	if (typeof actor?.system?.currency === "number") return Math.max(0, Math.round(actor.system.currency));
	return null;
}

/**
 * Ändert den Bestand eines Akteurs. `amounts` ist entweder eine
 * Mengen-Angabe pro Denomination ({shilling: 3}), ein negativer Betrag zum
 * Abziehen, oder direkt ein Basiswert in Orteg (Zahl).
 * Gibt die tatsächliche Änderung (nach Clamp auf >= 0) zurück.
 * @param {Actor} actor
 * @param {Record<string, number>|number} amounts
 * @returns {Promise<number>} tatsächliche Änderung in Orteg
 */
export async function modifyActorCurrency(actor, amounts) {
	const current = getActorCurrencyTotal(actor) ?? 0;
	const delta = typeof amounts === "number" ? Math.round(amounts) : convertToBase(amounts);
	const newTotal = Math.max(0, current + delta);
	await actor.update({ "system.currency": newTotal });
	return newTotal - current;
}

/**
 * Zieht einen Preis vom Bestand ab. Das "Wechselgeld" entsteht automatisch:
 * der Basiswert wird subtrahiert und die Anzeige zerlegt den Rest neu -
 * keine SL-Rückfrage (Rudolfs Entscheidung 3).
 * @param {Actor} actor
 * @param {number} amount Betrag
 * @param {string} [denomination="orteg"] Denomination des Betrags
 * @param {object} [options]
 * @param {boolean} [options.quiet=false] keine Warnung bei zu wenig Geld
 * @returns {Promise<boolean>} true bei erfolgreicher Abbuchung
 */
export async function deductActorCurrency(actor, amount, denomination = "orteg", { quiet = false } = {}) {
	const rates = getCurrencyRates();
	if (rates[denomination] === undefined) throw new Error(`deductActorCurrency: unknown denomination "${denomination}"`);
	const cost = Math.round(Number(amount) * rates[denomination]);
	if (!Number.isFinite(cost) || cost < 0) throw new Error("deductActorCurrency: invalid amount");
	const current = getActorCurrencyTotal(actor) ?? 0;
	if (current < cost) {
		if (!quiet) ui.notifications.warn(game.i18n.localize("MONEY.WARN_INSUFFICIENT"));
		return false;
	}
	await actor.update({ "system.currency": current - cost });
	return true;
}

/* -------------------------------------------- */
/*  Item-Preise (Zahl + Einheit statt Freitext) */
/* -------------------------------------------- */

/**
 * Parst einen alten Freitext-Kosten-Eintrag in das neue Preis-Modell
 * { value, denomination }. Bevorzugte Formate:
 *   "2 ß", "2 S", "35 Orteg", "3 Thaler", "24-29 T", "0,8 Taler", "10gp-free" …
 * Der erste Zahlenwert gewinnt (untere Bandgrenze), mehrere Zahlen oder
 * fehlende Einheiten werden als unsicher markiert und in der
 * Migrations-Übersicht zur manuellen Prüfung angezeigt.
 * @param {string} raw
 * @returns {{value: number|null, denomination: string, certain: boolean, hasNumber: boolean}}
 */
export function parseCostString(raw) {
	const result = { value: null, denomination: "orteg", certain: false, hasNumber: false };
	if (raw === null || raw === undefined) return result;
	const s = String(raw).trim();
	if (s === "") {
		result.value = 0;
		result.certain = true;
		return result;
	}
	const lower = s.toLowerCase();
	const numbers = [...lower.matchAll(/(\d+(?:[.,]\d+)?)/g)];
	if (numbers.length === 0) return result;
	result.hasNumber = true;
	result.value = Number(numbers[0][1].replace(",", "."));

	let denomination = null;
	if (/thaler|taler/.test(lower)) denomination = "thaler";
	else if (/schilling|shilling/.test(lower)) denomination = "shilling";
	else if (/orteg/.test(lower)) denomination = "orteg";
	else if (/ß/.test(lower)) denomination = "shilling";
	else if (/(^|[\s\d])s([\s.,;)]|$)/.test(lower)) denomination = "shilling";
	else if (/(^|[\s\d])t(h)?([\s.,;)]|$)/.test(lower)) denomination = "thaler";
	else if (/(^|[\s\d])o([\s.,;)]|$)/.test(lower)) denomination = "orteg";

	result.denomination = denomination ?? "orteg";
	result.certain = denomination !== null && numbers.length === 1;
	return result;
}

/**
 * Der effektive Basispreis eines Items in Orteg als Ganzzahl; null, wenn das
 * Item noch kein migriertes Preisfeld hat.
 *
 * Teil 3 (Preisbasis): das Speicherformat ist EINE Ganzzahl in Orteg unter
 * system.price (Crucible-Modell, kompatibel mit Campaign-Codex-Overrides).
 * Items, die noch das Altformat {value, denomination} aus A38 tragen
 * (noch nicht per GM-Makro "Preisbasis-Migration" konvertiert), werden
 * weiterhin korrekt umgerechnet, damit Gear-Tab/API nie falsche Werte
 * zeigen - die Blätter zeigen für sie den Migrationshinweis.
 * @param {Item} item
 * @returns {number|null}
 */
export function getItemPriceBase(item) {
	const price = item?.system?.price;
	if (price === undefined || price === null) return null;
	// Teil 3: Basis-Integer direkt.
	if (typeof price === 'number' || typeof price === 'string') {
		const value = Number(price);
		return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
	}
	// Altformat {value, denomination} (A38, vor Teil 3 migriert).
	const value = Number(price.value);
	if (!Number.isFinite(value)) return 0;
	const rates = getCurrencyRates();
	const multiplier = rates[price.denomination] ?? 1;
	return Math.max(0, Math.round(value * multiplier));
}

/* -------------------------------------------- */
/*  Custom UI-Element <symbaroum-currency>      */
/* -------------------------------------------- */

/**
 * Crucible-artiges Währungs-Element für Akteursblätter.
 *
 * Editierbar (Blattbesitzer): drei Eingabefelder (Thaler/Schilling/Orteg)
 * mit der berechneten Aufteilung, jeweils mit Delta-Syntax
 * ("+3", "-2", "=10" oder direkt "10" setzt den Anteil).
 * Readonly (ohne Besitzrechte): kompakte Aufzählung mit Null-Ausblendung.
 * Darunter eine Gesamtzeile mit dem Basiswert in Orteg.
 *
 * Das Element ist bewusst NICHT form-assoziiert (kein name-Attribut, keine
 * Form-Serialisierung): Akteure, deren Blatt nur geöffnet/abgespeichert
 * wird, dürfen nicht stillschweigend system.currency = 0 erhalten,
 * sonst würde die Migrations-Übersicht sie nicht mehr erfassen. Änderungen
 * werden stattdessen als bubbling change-Event mit detail.value
 * ausgelöst; das Akteursblatt (sheet/actor.js) hört darauf und schreibt
 * system.currency am Aktor.
 */
export class SymbaroumCurrencyElement extends HTMLElement {
	static get observedAttributes() {
		return ["value", "readonly"];
	}

	#built = false;

	connectedCallback() {
		if (!this.#built) {
			this.#build();
			this.#built = true;
		}
		this._value = Math.max(0, Math.round(Number(this.getAttribute("value")) || 0));
		this.#refresh();
	}

	attributeChangedCallback(name, oldValue, newValue) {
		if (oldValue === newValue || !this.#built) return;
		if (name === "value") this._value = Math.max(0, Math.round(Number(newValue) || 0));
		this.#refresh();
	}

	/** Liest den aktuellen Basiswert des Elements. */
	_getValue() {
		return this._value ?? 0;
	}

	#build() {
		const editable = !this.hasAttribute("readonly");
		const grid = document.createElement("div");
		grid.classList.add("sym-currency-grid");
		if (editable) {
			for (const d of getDenominations()) {
				const row = document.createElement("div");
				row.classList.add(d.id);
				const label = document.createElement("label");
				label.innerText = d.label;
				const input = document.createElement("input");
				input.type = "text";
				input.placeholder = d.abbreviation;
				input.dataset.denomination = d.id;
				input.addEventListener("change", (event) => this.#onChangeInput(event));
				input.addEventListener("focus", (event) => event.target.select());
				row.append(label, input);
				grid.append(row);
			}
		} else {
			const span = document.createElement("span");
			span.classList.add("sym-currency-readonly");
			grid.append(span);
		}
		const total = document.createElement("div");
		total.classList.add("sym-currency-total");
		this.append(grid, total);
	}

	#refresh() {
		if (!this.#built) return;
		const total = this._getValue();
		const amounts = allocateFromBase(total);
		const editable = !this.hasAttribute("readonly");
		const grid = this.querySelector(".sym-currency-grid");
		if (editable) {
			for (const input of grid.querySelectorAll("input[data-denomination]")) {
				input.value = String(amounts[input.dataset.denomination]);
				input.classList.remove("hidden");
			}
		} else {
			const span = grid.querySelector(".sym-currency-readonly");
			span.innerText = formatCurrency(total);
		}
		const totalLine = this.querySelector(".sym-currency-total");
		totalLine.innerText = game.i18n.format("MONEY.TOTAL_VALUE", { value: total });
	}

	#onChangeInput(event) {
		const input = event.target;
		const denomination = input.dataset.denomination;
		const result = applyDenominationInput(this._getValue(), denomination, input.value);
		if (result.error !== null) {
			ui.notifications.warn(game.i18n.localize(result.error));
			const amounts = allocateFromBase(this._getValue());
			input.value = String(amounts[denomination]);
			return;
		}
		this.setAttribute("value", String(result.total));
		this.dispatchEvent(new CustomEvent("change", { detail: { value: result.total }, bubbles: true, composed: true }));
	}
}

/**
 * Einmalige Registrierung des Elements plus Injektion der wenigen
 * zusätzlichen Styles (Grid/Total/Readonly-Zeile). Die drei
 * Denominations-Zeilen nutzen die vorhandenen .money .thaler/.shilling/
 * .orteg-Styles des Systems mit, damit die Optik des Gear-Tabs erhalten
 * bleibt (Blatt-Überarbeitung ist ein eigenes Thema, Rudolf 25.10.).
 */
export function initCurrency() {
	if (!customElements.get("symbaroum-currency")) {
		customElements.define("symbaroum-currency", SymbaroumCurrencyElement);
	}
	if (document.getElementById("symbaroum-currency-styles")) return;
	const style = document.createElement("style");
	style.id = "symbaroum-currency-styles";
	style.textContent = `
.sym-currency-grid { display: flex; flex-direction: column; gap: 2px; }
.sym-currency-grid label { margin: 0; }
.sym-currency-readonly { display: block; padding: 4px 2px; }
.sym-currency-total { margin-top: 4px; padding: 2px 0; font-size: 11px; opacity: 0.85; border-top: 1px solid rgba(0, 0, 0, 0.35); }
.sym-currency-total::before { content: "— "; opacity: 0.7; }
`;
	document.head.append(style);
}
