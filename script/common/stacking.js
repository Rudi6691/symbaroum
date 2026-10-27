/**
 * AP2 "Stapeln" (Merge-on-Drop, Arbeitspaket 2 des Behälterprojekts).
 *
 * Rudolfs Design-Entscheidungen (Analyse-Canvas 5.7, bestätigt 26.10.2026,
 * Startsignal 27.10.2026):
 *  - v2 (Uniform-Regel, Rudolfs Wunsch "Stapelbar für alle Items
 *    einstellbar"): Waffe, Rüstung, Ausrüstung und Artefakte sind über
 *    system.stackable steuerbar -
 *      truthy  => stapelbar (Checkbox schreibt "true" bzw. false),
 *      false   => expliziter Opt-out,
 *      undefined => Typ-Default: Ausrüstung ohne Artefakt-Flag ist
 *                   stapelbar (Merge-Default bleibt erhalten!), alle
 *                   anderen Gear-Typen (Waffe/Rüstung/Artefakt-Typ/
 *                   Ausrüstung mit Artefakt-Flag) sind es nicht.
 *    Behälter bleiben NIE stapelbar (Inhalt/Geld/Kapazität-Modell bräche,
 *    jeder Behälter bleibt ein eigenes Item), Nicht-Gear-Typen (Eigen-
 *    schaften, Kräfte, Segen/Lasten, ...) ebenfalls nie.
 *  - Identitätsregel: Typ + Name + system.price + system.weight gleich
 *    => Anzahl des Stapels erhöhen statt eines neuen Eintrags. Preis wird
 *    über getItemPriceBase normalisiert (nach Teil 3 ein Basis-Integer in
 *    Orteg; Altformat {value, denomination} wird über die Kurse umgerechnet,
 *    fehlender Preis bleibt "unbekannt" und gleicht nur einem ebensolchen).
 *    Gewicht wird als Kategorie verglichen; undefined und "none" bedeuten
 *    beide "Keine Angabe" und gelten als gleich (beide 0 GE, gleiche
 *    Anzeige im Blatt). Name im Vergleich getrimmt, case-sensitiv.
 *  - Geltungsbereich: Drops aus Item-Verzeichnis/Kompendium, A15-Zug von
 *    fremden Akteuren (Move mit Merge) und Drops auf Behälterzeilen
 *    (Merge mit dem passenden Stapel INNERHALB des Behälters).
 *  - NICHT im Geltungsbereich: reines Umsortieren im selben Blatt und das
 *    Entnehmen aus einem Behälter - diese Drops behalten ihr Verhalten.
 *  - Die Anzahl des eingehenden Items wandert komplett in den Stapel
 *    (Fackel x3 auf identischen Stapel => +3; Einzeldrop => +1).
 *
 * Das Modul ist bewusst UI-frei bis auf die Bestätigungs-Notification
 * (STACK.MERGE_INFO) - die eigentliche Logik ist pure Datenverarbeitung
 * und über game.symbaroum.api auch für Makros/Module nutzbar.
 */
import { getItemPriceBase } from "./currency.js";
import { isInsideContainer } from "./container.js";

/* -------------------------------------------- */
/*  Regel-Matrix                                 */
/* -------------------------------------------- */

/**
 * Ob ein Item grundsätzlich stapelbar ist (Merge-on-Drop-Kandidat).
 * Nur der Typ entscheidet über die Kategorie - abgeleitete Felder
 * (isContainer/isArtifact aus item.js) werden bewusst NICHT benutzt,
 * damit die Funktion auch für reine Item-Daten (toObject) funktioniert.
 *
 *  - container: nie (jeder Behälter bleibt ein eigenes Item).
 *  - weapon/armor/equipment/artifact (v2 Uniform-Regel): gesteuert über
 *    system.stackable - truthy => stapelbar, false => Opt-out,
 *    undefined => Typ-Default. Form-Checkboxes schreiben beim Setzen
 *    "true", beim Abwählen false - deshalb Wahrheitswert-Prüfung.
 *    Typ-Default bei undefined: Ausrüstung ohne Artefakt-Flag ist
 *    stapelbar (der Merge-Default aus v1 bleibt erhalten - Rationen
 *    etc. stapeln weiter automatisch), alle anderen Gear-Typen nicht.
 *  - alles andere (Eigenschaften, Kräfte, Segen/Lasten, ...): nie.
 *
 * @param {Item|object} item  Item-Dokument oder reine Item-Daten
 * @returns {boolean}
 */
export function isStackableItem(item) {
	if (!item) return false;
	const type = item.type;
	if (type === "container") return false;
	if (type !== "weapon" && type !== "armor" && type !== "equipment" && type !== "artifact") return false;
	const s = item.system ?? {};
	if (s.stackable !== undefined) return !!s.stackable;
	const isArtifact = type === "artifact" || !!s.isArtifact;
	return type === "equipment" && !isArtifact;
}

/* -------------------------------------------- */
/*  Identität                                    */
/* -------------------------------------------- */

/**
 * Identitäts-Schlüssel eines Items (Rudolfs Regel: Typ + Name + Preis +
 * Gewicht). Preis normalisiert über getItemPriceBase (Basis-Orteg); ein
 * fehlender Preis bleibt "unbekannt" ('') und gleicht nur einem ebensolchen
 * - ein migrierter Preis 0 (Orteg) ist bewusst NICHT identisch dazu.
 * Gewicht: undefined und "none" gelten beide als "Keine Angabe".
 * @param {Item|object} item
 * @returns {string}
 */
export function getStackKey(item) {
	const s = item?.system ?? {};
	const priceBase = getItemPriceBase({ system: s });
	const priceKey = priceBase === null ? "" : String(priceBase);
	const weightKey = s.weight ?? "none";
	return [item.type ?? "", (item.name ?? "").trim(), priceKey, weightKey].join("\u0001");
}

/**
 * Sucht im Aktor einen vorhandenen Stapel, in den ein hereinkommendes Item
 * gemerged werden kann. Bei containerId werden nur direkte Kinder dieses
 * Behälters betrachtet (Merge mit dem Stapel im Behälter), ansonsten nur
 * unverpackte Items (verpackte Stapel werden durch Blatt-Drops nie
 * angerührt - wer sie konsolidieren will, droppt auf die Behälterzeile).
 * Das Quell-Item selbst ist vom Match ausgeschlossen.
 *
 * @param {Actor} actor
 * @param {Item|object} source  hereinkommendes Item (Dokument oder Daten)
 * @param {object} [options]
 * @param {string|null} [options.containerId]  Behälter-ID oder null (= Inventar)
 * @param {string|null} [options.excludeId]  explizit auszuschließende Item-ID
 * @returns {Item|null} der gefundene Stapel oder null
 */
export function findStackTarget(actor, source, { containerId = null, excludeId = null } = {}) {
	if (!actor?.items || !source) return null;
	if (!isStackableItem(source)) return null;
	const key = getStackKey(source);
	const sourceId = excludeId ?? (source.parent === actor ? source.id : null);
	return (
		actor.items.find((item) => {
			if (!item || item.id === sourceId) return false;
			if (item.type !== source.type) return false;
			if (!isStackableItem(item)) return false;
			if (containerId) {
				if (item.system?.container !== containerId) return false;
			} else if (isInsideContainer(actor, item)) return false;
			return getStackKey(item) === key;
		}) ?? null
	);
}

/* -------------------------------------------- */
/*  Merge-on-Drop                                */
/* -------------------------------------------- */

/**
 * Führt ein hereinkommendes Item in einen vorhandenen identischen Stapel
 * des Aktors zusammen: Die Anzahl des Stapels wird um die Anzahl des
 * hereinkommenden Items erhöht, das Quell-Item wird gelöscht, wenn es
 * eingebettet ist (A15-Zug). Bei unverpackten Quell-Items (Verzeichnis/
 * Kompendium) wird nur der Stapel erhöht.
 *
 * Rechte: Der Nutzer muss den Ziel-Aktor besitzen; bei einem Zug von einem
 * fremden Akteur gelten die A15-Regeln (GM oder BEIDE Akteure) - sonst
 * greift die normale A15-Ablehnung im Aufrufer.
 *
 * @param {Actor} actor          Ziel-Aktor
 * @param {Item} sourceItem      hereinkommendes Item (Dokument mit system)
 * @param {string|null} [containerId] Merge nur mit Kindern dieses Behälters
 * @returns {Promise<Item|null>} der erweiterte Stapel oder null (kein Match,
 *                               nicht stapelbar oder Rechte fehlen)
 */
export async function mergeStackDrop(actor, sourceItem, containerId = null) {
	if (!actor?.items || !sourceItem) return null;
	if (!actor.isOwner) return null;
	const sourceParent = sourceItem.parent;
	if (sourceParent instanceof Actor && sourceParent !== actor) {
		if (!(game.user.isGM || sourceParent.isOwner)) return null;
	}
	const target = findStackTarget(actor, sourceItem, { containerId });
	if (!target) return null;
	// Anzahl-Semantik wie Behältersystem/Last: fehlende Anzahl = 1,
	// Einzelheiten gerundet, nie unter 1.
	const incoming = Math.max(1, Math.round(Number(sourceItem.system?.number ?? 1) || 1));
	const current = Math.max(1, Math.round(Number(target.system?.number ?? 1) || 1));
	await target.update({ "system.number": current + incoming });
	if (sourceParent instanceof Actor) {
		await sourceParent.deleteEmbeddedDocuments("Item", [sourceItem.id]);
	}
	ui.notifications.info(game.i18n.format("STACK.MERGE_INFO", { name: sourceItem.name ?? "", count: incoming }));
	return target;
}

/* -------------------------------------------- */
/*  Stapel trennen (v2)                          */
/* -------------------------------------------- */

/**
 * Trennt `count` Einheiten von einem Stapel ab: Die Anzahl des Quell-Items
 * sinkt um count, und eine Kopie des Items mit Anzahl = count wird im
 * selben Aktor neu angelegt (gleiche Behälter-Referenz - ein verpackter
 * Stapel wird im Behälter getrennt; das Favoriten-Flag wird bewusst NICHT
 * mitkopiert, damit die Favoritenliste keine Duplikate zeigt).
 *
 * Nur für stapelbare Items mit Anzahl > 1; count wird auf 1..number-1
 * geklemmt (der Rest-Stapel muss mindestens 1 behalten). Bei Anzahl 1
 * (nichts zu trennen), nicht stapelbaren Items oder fehlenden Rechten
 * passiert nichts (Rückgabe null).
 *
 * Rechte: Der Nutzer muss den Aktor besitzen (wie Merge-on-Drop).
 *
 * @param {Actor} actor   Aktor, dem das Item gehört
 * @param {Item} item     Stapel-Item (eingebettet in actor)
 * @param {number} count  abzutrennende Anzahl (wird geklemmt)
 * @returns {Promise<Item|null>} das neue Item oder null (ungültige
 *                               Konstellation, nicht stapelbar oder
 *                               Rechte fehlen)
 */
export async function splitStackItem(actor, item, count = 1) {
	if (!actor?.items || !item || item.parent !== actor) return null;
	if (!actor.isOwner) return null;
	if (!isStackableItem(item)) return null;
	const current = Math.max(1, Math.round(Number(item.system?.number ?? 1) || 1));
	if (current < 2) return null;
	const take = Math.min(current - 1, Math.max(1, Math.round(Number(count) || 1)));
	const data = item.toObject();
	delete data._id;
	if (data.flags?.symbaroum && "favorite" in data.flags.symbaroum) {
		delete data.flags.symbaroum.favorite;
	}
	data.system = data.system ?? {};
	data.system.number = take;
	await item.update({ "system.number": current - take });
	const created = await actor.createEmbeddedDocuments("Item", [data]);
	const newItem = created?.[0] ?? null;
	ui.notifications.info(game.i18n.format("STACK.SPLIT_INFO", { name: item.name ?? "", count: take }));
	return newItem;
}
