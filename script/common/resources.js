/**
 * Ressourcen v1 (Rudolfs Startsignal 31.10.: „Dann baue.“).
 *
 * Rudolfs Entscheidungen (Auswahlrunden 1+2, 31.10.2026):
 *  - Item-Kategorisierung über das FELD system.resourceCategory (String, leer
 *    = keine Ressource) statt Boolean-Flags; v1-Kategorien: Kraeuterarznei +
 *    Alchemiezutat. Alchemiezutat ist bewusst genauso abstrakt wie die
 *    Kraeuterarznei (gesammelte UND gekaufte Braumaterialien); 1 Einheit :=
 *    1 ß Materialwert (Alchimie-Oekonomie, beschlossen 16.10.: Braukosten =
 *    50 % LP in Einheiten, misslungene Brauprobe verbraucht Material trotzdem).
 *  - Kategoriebasiertes statt namensbasiertes Matching (Rudolfs Runde-2-
 *    Entscheidung: erlaubt auch kulturell gefaerbte Arzneien - Trollsalben,
 *    Hexenwickel - alle als Kraeuterarznei getaggt, der Medicus akzeptiert
 *    jedes davon).
 *  - Medicus: Abbuchung BEIM WURF, unabhaengig vom Ergebnis (DSA5-Stil), plus
 *    Rudolfs Regel: die Kraeuterarznei gibt IMMER ihre Basis-Heilung von
 *    1 Punkt Zaehigkeit, auch bei Fehlschlag, AUSSER bei kritischem Patzer.
 *    Fehlende Arznei -> Checkbox im Wuerfeldialog ausgegraut + Tooltip;
 *    Menge 0 -> Item-Zeile bleibt stehen (kein Loeschen).
 *  - Generisches Item-Kontextmenue „Ressource verbrauchen (N)" fuer
 *    kategorisierte Items ohne System-Trigger (Alchemiezutat, bis der
 *    Brau-Dialog des Oekonomie-Projekts existiert) - fuer GM und Spieler am
 *    eigenen Inventar (Rudolfs Runde-2-Entscheidung).
 *  - Setting „Ressourcenverbrauch" (GM, scope world, Default AUS) auf der
 *    symbaroumConfig-GM-Seite (Rudolfs Runde-2-Entscheidung, gilt gemeinsam
 *    mit dem spaeteren „Munitionsverbrauch").
 *
 * Modularisierbarkeits-Restriktion (31.10.): Verbraucher-Definitionen stehen
 * ZENTRAL in RESOURCE_CONSUMERS - der Medicus-Pfad (script/common/item.js)
 * liest seinen Eintrag von dort, keine neuen System-Hartkopplungen. Spaetere
 * Verbraucher (Brau-Dialog des Oekonomie-Projekts) registrieren sich neben
 * medicus/brew.
 *
 * A38-Lernweis: system.resourceCategory wird NIE per template.json-Default
 * gesetzt (Foundry mischt Defaults in ALLE Bestaende) - Neuanlage passiert
 * im preCreate-Item-Hook (hooks.js), Alt-Bestand ueber das GM-Makro
 * „Ressourcen-Tagging v1".
 */
import { symbDialog } from './symbDialog.js';
import { modernDialogClasses } from './modernSheetConfig.js';

/** Flag-Scope des Systems (wie loot.js). */
const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

/* ----------------------------------------------------------------
 *  Zentrale Verbraucher-Registry (Modularisierbarkeits-Restriktion)
 * ---------------------------------------------------------------- */

/**
 * Verbraucher-Definitionen: Wer bucht automatisch von welcher Kategorie ab?
 *  - medicus: Wuerfeldialog-Kategorie Kraeuterarznei, Menge 1 beim Submit
 *    (script/common/item.js, modifierDialog + standardPowerResult).
 *  - brew: Alchemiezutat beim Brauen - variable Menge, Wirksamkeit erst mit
 *    dem Brau-Dialog des Oekonomie-Projekts (spaeteres Projekt; bis dahin
 *    laeuft der Verbrauch ueber das Item-Kontextmenue).
 */
export const RESOURCE_CONSUMERS = {
	medicus: {
		id: 'medicus',
		category: 'kraeuterarznei',
		amount: 1,
	},
	brew: {
		id: 'brew',
		category: 'alchemiezutat',
		amount: null, // pro Gebräu = 50 % LP in Einheiten (Brau-Dialog, später)
	},
};

/* ----------------------------------------------------------------
 *  Welt-Setting (Registrierung im init-Hook, hooks.js)
 * ---------------------------------------------------------------- */

export function registerResourceSettings() {
	// Ressourcen v1: Automatischer Verbrauch kategorisierter Ressourcen
	// (Medicus bucht Kraeuterarznei beim Wurf ab, Checkbox ausgegraut, wenn
	// keine im Inventar). Rudolfs Testrunde-1-Wunsch (31.10.): Der Schalter
	// liegt NICHT mehr im Design-Dialog, sondern EINE EBENE HOEHER in der
	// Foundry-Einstellungsliste - DIREKT UNTER den Loot-Settings (gleiche
	// Liste wie lootEnabledOnDeath/lootDeleteEmptyPiles; Registration-
	// reihenfolge in hooks.js: registerLootSettings() → registerResource-
	// Settings()). Damit entfällt auch der Defekt aus Testrunde 1: Der
	// Design-Dialog-Submit castet Checkboxen mit data-dtype Boolean zu
	// Boolean (FormDataExtended), der alte Handler verglich gegen den
	// String 'on' und speicherte dadurch IMMER false. Das Kontextmenue
	// „Ressource verbrauchen" bleibt vom Setting UNABHAENGIG immer
	// verfuegbar (manueller Weg, kein Regel-Eingriff).
	game.settings.register('symbaroum', 'resourceConsumption', {
		name: 'RESOURCE.SETTING_ENABLED',
		hint: 'RESOURCE.SETTING_ENABLED_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
	});
}

/** Effektiver Schalter des automatischen Ressourcenverbrauchs. */
export function isResourceConsumptionEnabled() {
	try {
		return !!game.settings.get('symbaroum', 'resourceConsumption');
	} catch (err) {
		return false;
	}
}

/* ----------------------------------------------------------------
 *  Inventar-Abfragen & Abbuchung
 * ---------------------------------------------------------------- */

/** Effektive Menge eines Items (undefined/ungueltig = 1, wie transfer.js). */
export function getItemCount(item) {
	const n = Number(item?.system?.number);
	return Number.isFinite(n) && n >= 1 ? Math.round(n) : 1;
}

/**
 * Alle Ausruestungs-Items eines Akteurs in einer Ressourcen-Kategorie
 * (kategoriebasiert statt namensbasiert - Runde-2-Entscheidung; Behaelter-
 * Kinder laufen ueber die flache system.container-Referenz automatisch mit,
 * sie bleiben Teil von actor.items). requireAvailable=false liefert auch
 * leere (Menge 0) Stapel, z.B. fuers Tagging/Debugging.
 */
export function findResourceItems(actor, category, { requireAvailable = true } = {}) {
	if (!actor?.items || !category) return [];
	return actor.items.filter((item) => {
		if (item?.type !== 'equipment') return false;
		if ((item.system?.resourceCategory ?? '') !== category) return false;
		return !requireAvailable || getItemCount(item) > 0;
	});
}

/** Verfuegbare Gesamtmenge einer Kategorie im Inventar. */
export function getResourceTotal(actor, category) {
	return findResourceItems(actor, category).reduce((sum, item) => sum + getItemCount(item), 0);
}

/**
 * Kategorie-Verbrauch von Anzahl-Stacks: laeuft durch den Conversations-
 * Bestand in Inventar-Reihenfolge und bucht von vorn ab. Bei unzureichender
 * Gesamtmenge wird NICHT teilweise abgebucht (Vorab-Pruefung) - die
 * Wurf-Automatik darf nie halb zuendet.
 *
 * Rudolfs Entscheidung 3: Ein Stapel bei Menge 0 bleibt als Zeile STEHEN
 * (kein Loeschen, anders als DSA5/dnd5e) - nur system.number sinkt auf 0.
 *
 * @returns {{name: string, amount: number}|null}  Name des erstbebuchten
 *   Stapels + Gesamtmenge, oder null, wenn nicht genug da war.
 */
export async function consumeResource(actor, category, amount) {
	const take = Math.max(1, Math.round(Number(amount) || 1));
	const stacks = findResourceItems(actor, category);
	const total = stacks.reduce((sum, item) => sum + getItemCount(item), 0);
	if (total < take) return null;
	let remaining = take;
	let firstName = null;
	for (const item of stacks) {
		if (remaining <= 0) break;
		const current = getItemCount(item);
		const takeFromStack = Math.min(current, remaining);
		// Bewusst bis 0 erlaubt - Zeile bleibt stehen (Rudolfs Entscheidung 3)
		await item.update({ 'system.number': current - takeFromStack });
		remaining -= takeFromStack;
		if (firstName === null) firstName = item.name;
	}
	return { name: firstName ?? '', amount: take };
}

/**
 * Verbrauch aus EINEM konkreten Stapel (Kontextmenue am Item): bucht
 * maximal die Menge dieses Items, nie fremder Stapel.
 * @returns {number}  tatsaechlich verbrauchte Menge
 */
export async function consumeResourceFromItem(item, amount) {
	if (!item || (item.system?.resourceCategory ?? '') === '') return 0;
	const current = getItemCount(item);
	const take = Math.min(current, Math.max(1, Math.round(Number(amount) || 1)));
	if (take <= 0) return 0;
	await item.update({ 'system.number': current - take });
	return take;
}

/* ----------------------------------------------------------------
 *  Medicus-Unterstuetzung (Wuerfeldialog + Basis-Heilung)
 * ---------------------------------------------------------------- */

/** Verfuegbarkeit der Kraeuterarznei des Medicus-Verbrauchers im Inventar. */
export function getHerbalCureAvailability(actor) {
	const consumer = RESOURCE_CONSUMERS.medicus;
	return {
		available: getResourceTotal(actor, consumer.category) >= consumer.amount,
		count: getResourceTotal(actor, consumer.category),
	};
}

/**
 * Abbuchung fuer den Medicus-Wurf (modifierDialog-Submit,
 * script/common/item.js): bucht unabhaengig vom Wurfergebnis (Rudolfs
 * Entscheidung 1, DSA5-Stil). Rueckgabe fuer die Chat-Karte/autoParams.
 */
export async function consumeHerbalCure(actor) {
	const consumer = RESOURCE_CONSUMERS.medicus;
	const result = await consumeResource(actor, consumer.category, consumer.amount);
	if (!result) return null;
	return {
		category: consumer.category,
		name: result.name,
		amount: result.amount,
		label: F('RESOURCE.CHAT_CONSUMED', { name: result.name, amount: result.amount }),
	};
}

/* ----------------------------------------------------------------
 *  Dialog: „Ressource verbrauchen (N)" am Inventar-Item
 * ---------------------------------------------------------------- */

/**
 * Mengen-Dialog am kategorisierten Item (Kontextmenueintrag in
 * script/sheet/player.js). GM und Blattbesitzer; der manuelle Weg bleibt
 * vom Welt-Setting UNABHAENGIG verfuegbar (kein Regel-Eingriff, reine
 * Inventar-Pflege - Rudolfs Design).
 */
export function openConsumeResourceDialog(item) {
	const category = item?.system?.resourceCategory ?? '';
	if (!category || item.type !== 'equipment') return;
	const current = getItemCount(item);
	const categoryLabel = L(game.symbaroum.config.RESOURCE_CATEGORY_SELECTION[category]?.label ?? 'RESOURCE_CATEGORY.LABEL');
	const html = `<div class="symbaroum modern-give-dialog modern-resource-dialog">
		<div class="m-give-from">${L('RESOURCE.CONSUME_FROM')}: <b>${item.name}</b></div>
		<label class="m-sec-label" for="resource-consume-amount">${L('RESOURCE.CONSUME_AMOUNT')}</label>
		<input class="m-give-quantity" id="resource-consume-amount" type="number" min="1" max="${current}" value="1" step="1"/>
		<div class="m-give-note">
			<i class="fas fa-circle-info"></i>
			<span>${F('RESOURCE.CONSUME_HINT', { count: current, category: categoryLabel })}</span>
		</div>
	</div>`;
	symbDialog({
		title: `${L('RESOURCE.CONSUME_TITLE')} — ${item.name}`,
		content: html,
		classes: modernDialogClasses('modern-give-dialog', 'modern-resource-dialog'),
		width: 440,
		buttons: {
			consume: {
				icon: '<i class="fas fa-droplet"></i>',
				label: L('RESOURCE.CONSUME_BUTTON'),
				callback: async (html) => {
					const raw = Number(html[0].querySelector('#resource-consume-amount')?.value);
					const amount = Math.max(1, Math.min(current, Math.round(raw) || 1));
					const taken = await consumeResourceFromItem(item, amount);
					if (taken > 0) {
						ui.notifications.info(F('RESOURCE.CONSUME_RESULT', { name: item.name, amount: taken, remaining: current - taken }));
					} else {
						ui.notifications.warn(L('RESOURCE.ERR_NONE_LEFT'));
					}
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: async () => {},
			},
		},
		default: 'consume',
	});
}
