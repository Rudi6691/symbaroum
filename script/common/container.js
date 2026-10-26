/**
 * Behältersystem (Projekt "Behälter", Version 1).
 *
 * Rudolfs Design-Entscheidungen (Analyse-Canvas, 26.10.2026, Freigabe erteilt):
 *  - Neuer Item-Typ "container" mit eigenen Feldern: weight (GE-Kategorie,
 *    wie A39), capacity (Fassungsvermögen in GE, 0 = unbegrenzt), carried
 *    (mitgeführt), countLoad (auf Belastung anrechnen), currency (echtes Geld
 *    im Behälter, Ganzzahl Orteg wie A38), icon (optionale FA-Klasse, leer =
 *    Item-Bild), weightlessContents (Magiebeutel: Inhalt wiegt nichts).
 *  - Kinder-Referenz flach wie D&D 5e: Nur beim Hineinlegen wird auf dem
 *    Kind (weapon/armor/equipment/artifact/container) das Feld
 *    system.container mit der Item-ID des Behälters geschrieben. KEIN
 *    template.json-Default auf den Bestandstypen (A38-Lernweis: Foundry
 *    mischt Laufzeit-Defaults in alle Altbestände). Fehlendes Feld bzw.
 *    null = nicht in einem Behälter. Die Hierarchie entsteht per
 *    Referenzkette, nicht als Dokument-Baum.
 *  - Verschachtelung maximal zwei Ebenen (MAX_CONTAINER_DEPTH = 2):
 *    ein Behälter darf in einem Behälter stecken, die dritte Ebene wird
 *    beim Drop abgewiesen. Items (auch Geld) in Behältern der Ebene 2 sind
 *    erlaubt - die Tiefe zählt nur die Behälter-Schachtelung (dnd5e-Muster).
 *  - Status-Zwang (Rudolf): Beim Einlegen wird der Item-Status auf "Andere"
 *    gezwungen; beim Entnehmen bleibt er auf "Andere".
 *  - Echtes Geld im Behälter: Einlagern/Entnehmen läuft atomar über EINEN
 *    actor.update-Aufruf (Aktor-Währung + Embedded-Item gemeinsam); Geld
 *    im Behälter ist weg, wenn der Behälter weg ist (Diebstahl-Szenario).
 *  - Last: Ein zählender, mitgeführter Behälter trägt Eigen-GE + Inhalt-GE
 *    (beide Ebenen) + Geld-GE in die Aktor-Last ein; Items mit Behälter-
 *    Referenz zählen nie einzeln (keine Doppelzählung). carried = false
 *    erzwingt countLoad = false (Implikation, kein dritter Zustand).
 *  - Verwaiste Referenzen (Behälter gelöscht oder per A15 weggezogen, ohne
 *    dass die Kinder mitgezogen wurden) werden überall toleriert: Ein Kind,
 *    dessen system.container sich nicht mehr auflöst, gilt als nicht
 *    verpackt und erscheint wieder im normalen Inventar.
 */
import { SYMBAROUM } from "./config.js";
import { getCurrencyRates } from "./currency.js";

/** Maximale Behälter-Verschachtelungstiefe (Behälter in Behälter: 2 Ebenen). */
export const MAX_CONTAINER_DEPTH = 2;

/* -------------------------------------------- */
/*  Weight helpers (lokal, um Modul-Zyklen     */
/*  mit encumbrance.js zu vermeiden)            */
/* -------------------------------------------- */

function weightCategoryOf(categoryId) {
	if (typeof categoryId !== "string") return SYMBAROUM.weight.none;
	return SYMBAROUM.weight[categoryId] ?? SYMBAROUM.weight.none;
}

/** Auf 2 Nachkommastellen runden (wie A39: kein Float-Drift bei Winzig-GE). */
function roundGE(value) {
	return Math.round(value * 100) / 100;
}

/** Anzeige eines GE-Werts: maximal 2 Nachkommastellen, Punkt wie formatGE in A39. */
export function formatContainerGE(value) {
	return String(roundGE(Number(value) || 0));
}

/* -------------------------------------------- */
/*  Struktur                                    */
/* -------------------------------------------- */

/**
 * Alle Behälter-Items eines Aktors.
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function getActorContainers(actor) {
	if (!actor?.items) return [];
	return actor.items.filter((item) => item.type === "container");
}

/**
 * Direkte Kinder eines Behälters (alle Items mit system.container === id).
 * Verwaiste Referenzen sind hier niemals enthalten (Kinder-Sicht).
 * @param {Actor} actor
 * @param {string} containerId
 * @returns {Item[]}
 */
export function getContainerChildren(actor, containerId) {
	if (!actor?.items || !containerId) return [];
	return actor.items.filter((item) => item?.system?.container === containerId);
}

/**
 * Ob ein Item aktuell (gültig) in einem Behälter dieses Aktors steckt.
 * Eine Referenz, die sich nicht mehr auflöst (Behälter gelöscht oder
 * weggezogen), gilt als nicht verpackt - verwaiste Kinder bleiben sichtbar.
 * @param {Actor} actor
 * @param {Item} item
 * @returns {boolean}
 */
export function isInsideContainer(actor, item) {
	const ref = item?.system?.container;
	if (!ref) return false;
	const parent = actor?.items?.get(ref);
	return !!parent && parent.type === "container" && parent.id !== item.id;
}

/**
 * Der (gültige) Eltern-Behälter eines Items oder null.
 * @param {Actor} actor
 * @param {Item} item
 * @returns {Item|null}
 */
export function getItemContainer(actor, item) {
	if (!isInsideContainer(actor, item)) return null;
	return actor.items.get(item.system.container);
}

/**
 * Tiefe eines Behälters: 1 = oberste Ebene, 2 = in einem Behälter.
 * Defekte Referenzketten brechen ab (Schutz vor Zyklen in Alt-Daten).
 * @param {Actor} actor
 * @param {Item} container
 * @returns {number}
 */
export function getContainerDepth(actor, container) {
	let depth = 1;
	let current = container;
	while (current?.system?.container) {
		const parent = actor?.items?.get(current.system.container);
		if (!parent || parent.type !== "container" || parent.id === current.id) break;
		depth++;
		if (depth > 16) break;
		current = parent;
	}
	return depth;
}

/**
 * Ob der Kandidat im Teilbaum von root steckt (Zykel-Schutz beim
 * Verschieben von Behältern).
 */
function isInsideSubtree(actor, root, candidate) {
	const children = getContainerChildren(actor, root.id);
	for (const child of children) {
		if (child.id === candidate.id) return true;
		if (child.type === "container" && isInsideSubtree(actor, child, candidate)) return true;
	}
	return false;
}

/* -------------------------------------------- */
/*  Summen (Last, Füllstand, Geld)              */
/* -------------------------------------------- */

/**
 * Inhaltsgewicht eines Behälters in GE (rekursiv, beide Ebenen):
 * Summe der Kinder-GE (Kategorie x Stückzahl; "Zu schwer" wird übersprungen)
 * plus Eigengewicht verschachtelter Behälter.
 * weightlessContents (Magiebeutel) nullt den gesamten Inhalt aus.
 * @returns {number} gerundet auf 2 Nachkommastellen
 */
function contentsGEOf(actor, container, visited = new Set()) {
	if (container?.system?.weightlessContents) return 0;
	if (!container?.id || visited.has(container.id)) return 0;
	visited.add(container.id);
	let sum = 0;
	for (const child of getContainerChildren(actor, container.id)) {
		const cs = child.system ?? {};
		if (cs.isContainer) {
			const cat = weightCategoryOf(cs.weight);
			if (cat.id !== "toolarge") sum += cat.value ?? 0;
			sum += contentsGEOf(actor, child, visited);
		} else {
			const cat = weightCategoryOf(cs.weight);
			if (cat.id === "toolarge") continue;
			const number = Math.max(1, Math.round(Number(cs.number ?? 1) || 1));
			sum += (cat.value ?? 0) * number;
		}
	}
	return roundGE(sum);
}

/**
 * Geldsumme eines Behälters in Orteg, einschließlich der Gelder in
 * verschachtelten Behältern (Geldbeutel im Rucksack, Rudolfs Wunsch).
 * @returns {number}
 */
function currencyTotalOf(actor, container, visited = new Set()) {
	if (!container?.id || visited.has(container.id)) return 0;
	visited.add(container.id);
	let sum = Math.max(0, Math.round(Number(container.system?.currency) || 0));
	for (const child of getContainerChildren(actor, container.id)) {
		if (child.system?.isContainer) sum += currencyTotalOf(actor, child, visited);
	}
	return sum;
}

/**
 * Vollständige Summen eines Behälters für Anzeige und Lastberechnung.
 *
 * @param {Actor} actor
 * @param {Item} container
 * @returns {{
 *   ownGE: number|null, contentsGE: number, currencyTotal: number,
 *   moneyGE: number, totalGE: number, childCount: number, weightless: boolean
 * }}
 *   ownGE ist null, wenn der Behälter selbst "Zu schwer" kategorisiert ist
 *   (nie tragbar); totalGE umfasst Eigen-GE + Inhalt-GE + Geld-GE.
 */
export function getContainerTotals(actor, container) {
	const s = container?.system ?? {};
	const own = weightCategoryOf(s.weight);
	const ownGE = own.id === "toolarge" ? null : roundGE(own.value ?? 0);
	const contentsGE = contentsGEOf(actor, container);
	const currencyTotal = currencyTotalOf(actor, container);
	let moneyGE = 0;
	if (currencyTotal > 0) {
		const rates = getCurrencyRates(); // rates.thaler = Orteg pro Thaler
		const ortegPerGE = 50 * rates.thaler;
		moneyGE = Math.floor(currencyTotal / ortegPerGE);
	}
	const weightless = !!s.weightlessContents;
	return {
		ownGE,
		contentsGE,
		currencyTotal,
		moneyGE,
		totalGE: roundGE((ownGE ?? 0) + (weightless ? 0 : contentsGE) + moneyGE),
		childCount: getContainerChildren(actor, container?.id).length,
		weightless,
	};
}

/* -------------------------------------------- */
/*  Einlagern / Entnehmen / Validierung         */
/* -------------------------------------------- */

/**
 * Prüft einen Drop auf einen Behälter. Zurückgegeben wird {ok, message};
 * message ist bei ok === false bereits lokalisiert für ui.notifications.warn.
 * @param {Actor} actor   Aktor, in dem der Ziel-Behälter liegt
 * @param {Item} container Ziel-Behälter
 * @param {Item} item      einzulagerndes Item (gleicher Aktor oder fremd)
 */
export function validateContainerDrop(actor, container, item) {
	if (!container || container.type !== "container") {
		return { ok: false, message: game.i18n.localize("CONTAINER.WARN_TARGET") };
	}
	const is = item?.system ?? {};
	if (!is.isContainer && !is.isGear) {
		return { ok: false, message: game.i18n.localize("CONTAINER.WARN_NOT_GEAR") };
	}
	if (item.id === container.id) {
		return { ok: false, message: game.i18n.localize("CONTAINER.WARN_SELF") };
	}
	if (is.isContainer && item.parent === actor) {
		// Zykel-Schutz: ein Behälter kann nicht in seinen eigenen Teilbaum.
		if (isInsideSubtree(actor, item, container)) {
			return { ok: false, message: game.i18n.localize("CONTAINER.WARN_SELF") };
		}
		// Tiefen-Limit: Behälter nur in Behälter der Ebene 1 (wird Ebene 2).
		if (getContainerDepth(actor, container) >= MAX_CONTAINER_DEPTH) {
			return { ok: false, message: game.i18n.format("CONTAINER.WARN_MAX_DEPTH", { depth: MAX_CONTAINER_DEPTH }) };
		}
	}
	return { ok: true };
}

/**
 * Legt ein Item in einen Behälter: schreibt die flache Referenz
 * (system.container) und zwingt den Status auf "Andere" (Rudolfs
 * Status-Zwang - verpackte Teile kämpfen nicht und zählen nicht einzeln).
 * @returns {Promise<Item|null>} aktualisiertes Item oder null bei Ablehnung
 */
export async function moveItemToContainer(item, container) {
	if (!item || !container) return null;
	const check = validateContainerDrop(item.parent, container, item);
	if (!check.ok) {
		ui.notifications.warn(check.message);
		return null;
	}
	const update = { "system.container": container.id };
	if (item.system?.isGear) update["system.state"] = "other";
	return item.update(update);
}

/**
 * Entnimmt ein Item aus seinem Behälter (Referenz löschen). Der Status
 * bleibt auf "Andere" (Rudolfs Entscheidung) - bewusst kein Restore.
 * @returns {Promise<Item|null>}
 */
export async function removeItemFromContainer(item) {
	if (!item?.system?.container) return null;
	return item.update({ "system.-=container": null });
}

/* -------------------------------------------- */
/*  Geld im Behälter (Anforderung G)             */
/* -------------------------------------------- */

/**
 * Geld zwischen Aktor und Behälter bewegen - atomar über EINEN
 * actor.update-Aufruf (Aktor-Währung + Embedded-Item gemeinsam, kein
 * Zwischenstand). delta > 0 = vom Aktor in den Behälter einlagern,
 * delta < 0 = aus dem Behälter entnehmen. Plausibilitätsprüfung mit
 * Warnung, wenn eine Seite nicht genügend Geld hält.
 * @param {Actor} actor
 * @param {Item} container
 * @param {number} delta Ganzzahl Orteg
 * @returns {Promise<boolean>} true, wenn die Transaktion durchgeführt wurde
 */
export async function changeContainerCurrency(actor, container, delta) {
	const d = Math.round(Number(delta) || 0);
	if (!actor || !container || container.type !== "container" || d === 0) return false;
	const actorCurrency = Math.max(0, Math.round(Number(actor.system?.currency) || 0));
	const containerCurrency = Math.max(0, Math.round(Number(container.system?.currency) || 0));
	if (d > 0 && actorCurrency < d) {
		ui.notifications.warn(game.i18n.localize("CONTAINER.WARN_NO_ACTOR_MONEY"));
		return false;
	}
	if (d < 0 && containerCurrency < -d) {
		ui.notifications.warn(game.i18n.localize("CONTAINER.WARN_NO_CONTAINER_MONEY"));
		return false;
	}
	await actor.update({
		"system.currency": actorCurrency - d,
		items: [{ _id: container.id, "system.currency": containerCurrency + d }],
	});
	return true;
}

/* -------------------------------------------- */
/*  Löschen                                      */
/* -------------------------------------------- */

/**
 * Behälter samt Inhalt löschen (rekursiv, beide Ebenen).
 * @returns {Promise<string[]>} IDs aller gelöschten Items
 */
export async function deleteContainerWithContents(actor, container) {
	if (!actor || !container || container.type !== "container") return [];
	const ids = [container.id];
	for (const child of getContainerChildren(actor, container.id)) {
		if (child.system?.isContainer) ids.push(...(await deleteContainerWithContents(actor, child)));
		else ids.push(child.id);
	}
	await actor.deleteEmbeddedDocuments("Item", ids);
	return ids;
}

/**
 * Behälter löschen, Inhalt zurück ins Inventar legen (Referenzen löschen).
 * @returns {Promise<string>} ID des gelöschten Behälters oder null
 */
export async function deleteContainerKeepContents(actor, container) {
	if (!actor || !container || container.type !== "container") return null;
	const updates = [];
	for (const child of getContainerChildren(actor, container.id)) {
		if (child.system?.isContainer) {
			// Verschachtelte Behälter werden zu Behältern der obersten Ebene.
			updates.push({ _id: child.id, "system.container": null });
		} else {
			updates.push({ _id: child.id, "system.-=container": null });
		}
	}
	if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
	await actor.deleteEmbeddedDocuments("Item", [container.id]);
	return container.id;
}
