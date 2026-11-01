/**
 * Munitionsverbrauch v1 (Rudolfs Startsignal 31.10.2026: „Wir machen den
 * Kosmetik-X-Glyph mit dem Munitionsverbrauch" + Freigabe „loslegen mit v1").
 *
 * Rudolfs Entscheidungen (Auswahlrunden 1+2, 31.10.2026):
 *  - Waffenseitiges GM-Feld system.ammunition = { category, amount } auf
 *    weapon: leere Kategorie = kein Verbrauch (kein required-Bool),
 *    amount = Menge je Angriff (mindestens 1).
 *  - Munitions-Stapel: equipment (oder weapon - Wurfspeer-Pool) mit
 *    system.resourceCategory der Munitions-Kategorie (Kategorien in
 *    config.js RESOURCE_CATEGORY_SELECTION, Labels via i18n).
 *  - Verbrauch beim Wurf-Submit, UNABHAENIG vom Wurfergebnis (Medicus-
 *    Muster), Menge × Angriffsanzahl; Stapelreihenfolge wie Ressourcen
 *    (oberster Stapel zuerst, Abbuchen bis 0 erlaubt - Zeile bleibt).
 *  - BLOCKIEREN bei 0 bzw. zu geringem Bestand: Der Angriff wird
 *    verweigert (Notification, KEIN Wurf) - Pre-Flight in actor.js
 *    rollWeapon (fuer 1 Angriff) + Volle-Pruefung im Dialog-Submit
 *    (Menge × Angriffsanzahl, dialog.js).
 *  - Wurfwaffen (reference 'thrown' + stapelbar): Selbstverbrauch aus dem
 *    eigenen Stapel, 1 Stueck je Angriff; nicht-stapelbare Wurfwaffen
 *    ohne Auto-Verbrauch (dokumentiert).
 *  - Bergen v1.2 (Architektur-Entscheidung Punkt 11): NUR NOCH MAKRO -
 *    der kampf-scoped Zaehler samt Kampfende/GM-Karten ist entfernt; das
 *    Bergen-Makro (Spieler + GM) traegt die verschossene Anzahl manuell
 *    ein, wuerfelt 1W20 je Stueck (GEBORGEN bei Wurf <= Schwelle,
 *    beschaedigt bei Wurf > Schwelle, GRW): Standard 10, Qualitaet 15,
 *    mystische Qualitaet 17.
 *  - Schwellen automatisch aus der Munition: Stapel mit system.ammoQuality
 *    (''/'quality'/'mystical' - NUR Makro-gesetzt, kein UI-Feld), Waffen
 *    aus system.qualities (mystical -> 17, sonst irgendeine Qualitaet ->
 *    15, sonst 10).
 *  - Settings „Munitionsverbrauch" + „Bergungsoption" (GM, scope world,
 *    Default AUS, config:true) - Registration direkt nach den
 *    Ressourcen-Settings, damit sie in der Foundry-Einstellungsliste
 *    DIRECT UNTER ihnen stehen (gleiche Liste wie lootEnabled*).
 *  - Spezialpfeil-KAMPFWirkungen NICHT in v1 (nur Bergungs-Schwelle);
 *    Mid-Ketten-Angriffe (Rueckwaertsschwung, Doppelschlag, Freier
 *    Angriff ausserhalb des Wurfeldialogs) buchen nichts (dokumentiert).
 *
 * Bewusst PARALLEL zu resources.js statt Refaktor: findResourceItems /
 * consumeResource bleiben Ausruestungs-only (Medicus-Regressionsschutz,
 * Ressourcen v1-Lernweis) - hier gibt es einen breiteren Finder
 * (equipment + weapon). Geteilt wird nur getItemCount (stapelweise Menge).
 */
import { getItemCount } from './resources.js';
import { isStackableItem } from './stacking.js';

/* i18n-Helfer nach resources.js-Muster */
const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

/* Bergungs-Schwellen (GRW: beschaedigt bei 1W20 > Schwelle) */
export const AMMO_THRESHOLDS = { standard: 10, quality: 15, mystical: 17 };

/* ---------------------------------------------------------------- */
/* Settings (Registration in hooks.js direkt nach den Ressourcen)   */
/* ---------------------------------------------------------------- */

export function registerAmmoSettings() {
	// Munitionsverbrauch v1: Automatischer Munitionsverbrauch waffenseitig
	// kategorisierter Waffen (GM-Feld auf dem Waffenblatt) - gleiche Liste
	// wie lootEnabled* / resourceConsumption (config:true), Default AUS.
	game.settings.register('symbaroum', 'ammoConsumption', {
		name: 'AMMO.SETTING_ENABLED',
		hint: 'AMMO.SETTING_ENABLED_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
	});
	// Munitionsverbrauch v1: Bergungsoption (Verbrauchszaehler im aktiven
	// Kampf + Bergungs-Karte beim Kampfende) - Voraussetzung bleibt der
	// Hauptschalter; ohne ihn wird weder gezaehlt noch gebucht.
	game.settings.register('symbaroum', 'ammoRecovery', {
		name: 'AMMO.SETTING_RECOVERY',
		hint: 'AMMO.SETTING_RECOVERY_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
	});
}

/** Effektiver Schalter des automatischen Munitionsverbrauchs. */
export function isAmmoConsumptionEnabled() {
	return !!game.settings.get('symbaroum', 'ammoConsumption');
}

/* ---------------------------------------------------------------- */
/* Waffen-Konfiguration                                              */
/* ---------------------------------------------------------------- */

/**
 * Liefert das Item hinter dem Wurf-Parameter: rollWeapon/prepareRoll-
 * Attribute uebergeben die EC-Struktur aus actor.system.weapons (mit
 * .id), Faehigkeits-Angriffe teils das Item selbst. Beide Faelle werden
 * hier auf das echte Item aufgeloest (Runde-2-Entscheidung: alle Pfade
 * laufen ueber EINE Konfigurationsquelle).
 */
export function resolveWeaponItem(actor, weapon) {
	if (!weapon) return null;
	if (weapon instanceof CONFIG.Item.documentClass) return weapon;
	if (actor?.items && weapon.id) return actor.items.get(weapon.id) ?? null;
	return null;
}

/**
 * Waffenseitige Munitions-Konfiguration (system.ammunition) inklusive
 * Wurfwaffen-Erkennung: reference 'thrown' UND stapelbar => Selbst-
 * verbrauch (1 je Angriff) unabhaengig von der Kategorie.
 */
export function getWeaponAmmoConfig(actor, weapon) {
	const item = resolveWeaponItem(actor, weapon);
	if (!item || item.type !== 'weapon') return null;
	const ammo = item.system?.ammunition ?? {};
	const category = typeof ammo.category === 'string' ? ammo.category : '';
	const amount = Math.max(1, Math.round(Number(ammo.amount) || 1));
	const thrownSelf = item.system?.reference === 'thrown' && isStackableItem(item);
	return { item, category, amount, thrownSelf };
}

/** Label einer Munitions-Kategorie (i18n, Fallback: rohe id). */
export function getAmmoCategoryLabel(category) {
	const sel = game.symbaroum.config.RESOURCE_CATEGORY_SELECTION[category];
	return sel ? L(sel.label) : String(category);
}

/** Munition v1.1: Ist diese Ressourcen-Kategorie eine Munitions-Kategorie? */
export function isAmmoCategory(category) {
	return !!game.symbaroum.config.AMMO_CATEGORY_SELECTION[category ?? ''] && category !== '';
}

/* ---------------------------------------------------------------- */
/* Stapel-Finder (breiter als resources.js: equipment UND weapon)     */
/* ---------------------------------------------------------------- */

/**
 * Alle Munitions-Stapel eines Akteurs in einer Kategorie: equipment
 * (Pfeilbuendel & Co.) UND weapon (Wurfspeer-Stapel als Speerschleuder-
 * Munition). Behaelter-Kinder laufen wie bei resources.js ueber die
 * flache actor.items-Referenz automatisch mit. requireAvailable=false
 * liefert auch leere (Menge 0) Stapel.
 */
export function findAmmoStacks(actor, category, { requireAvailable = true } = {}) {
	if (!actor?.items || !category) return [];
	return actor.items.filter((item) => {
		if (item?.type !== 'equipment' && item?.type !== 'weapon') return false;
		if ((item.system?.resourceCategory ?? '') !== category) return false;
		return !requireAvailable || getItemCount(item) > 0;
	});
}

/** Gesamtbestand einer Munitions-Kategorie im Inventar. */
export function getAmmoTotal(actor, category) {
	return findAmmoStacks(actor, category).reduce((sum, item) => sum + getItemCount(item), 0);
}

/* ---------------------------------------------------------------- */
/* Bergungs-Schwelle (GRW: 1W20 > Schwelle = beschaedigt)            */
/* ---------------------------------------------------------------- */

/**
 * Schwelle eines Munitions-Stapels: system.ammoQuality ('' = Standard 10,
 * 'quality' = 15, 'mystical' = 17; nur Makro-gesetzt, kein UI) - Waffen
 * (Wurfspeer-Stapel, Selbstverbrauch) stattdessen aus system.qualities:
 * mystical -> 17, sonst irgendeine Qualitaet -> 15, sonst 10.
 */
export function getAmmoThreshold(item) {
	if (!item) return AMMO_THRESHOLDS.standard;
	const quality = item.system?.ammoQuality ?? '';
	if (quality === 'mystical') return AMMO_THRESHOLDS.mystical;
	if (quality === 'quality') return AMMO_THRESHOLDS.quality;
	if (item.type === 'weapon') {
		const qualities = item.system?.qualities ?? {};
		if (qualities.mystical === true) return AMMO_THRESHOLDS.mystical;
		if (Object.values(qualities).some((v) => v === true)) return AMMO_THRESHOLDS.quality;
	}
	return AMMO_THRESHOLDS.standard;
}

/* ---------------------------------------------------------------- */
/* Pre-Flight (actor.js rollWeapon): Angriff verweigern             */
/* ---------------------------------------------------------------- */

/**
 * Pre-Flight vor dem Wurfeldialog: blockiert, wenn fuer EINEN Angriff
 * keine Munition (bzw. kein Wurfwaffen-Stueck) mehr da ist. Die volle
 * Pruefung (Menge × Angriffsanzahl) passiert im Dialog-Submit
 * (consumeAmmoForAttack) - hier reicht der Ein-Angriffs-Blick, damit
 * das Blaatt/die Liste gar nicht erst in den Wurf laeuft.
 * Rueckgabe false = blockiert (Notification kam hier).
 */
export function checkWeaponAmmoReady(actor, weapon) {
	if (!isAmmoConsumptionEnabled()) return true;
	const cfg = getWeaponAmmoConfig(actor, weapon);
	if (!cfg) return true;
	if (cfg.thrownSelf) {
		if (getItemCount(cfg.item) < 1) {
			ui.notifications.warn(F('AMMO.ERR_NO_THROWN', { weapon: cfg.item.name }));
			return false;
		}
		return true;
	}
	if (!cfg.category) return true;
	if (getAmmoTotal(actor, cfg.category) < cfg.amount) {
		ui.notifications.warn(
			F('AMMO.ERR_NO_AMMO', { weapon: cfg.item.name, category: getAmmoCategoryLabel(cfg.category) })
		);
		return false;
	}
	return true;
}

/* ---------------------------------------------------------------- */
/* Abbuchung (dialog.js Wurf-Submit)                                */
/* ---------------------------------------------------------------- */

/**
 * Abbuchung beim Wurf-Submit: unabhaengig vom Wurfergebnis (Medicus-
 * Muster), Menge je Angriff × Angriffsanzahl, AP2-Stapelreihenfolge
 * (oberster Stapel zuerst, bis 0 erlaubt - Zeile bleibt stehen).
 *
 * Rueckgabe-Vertrag fuer dialog.js:
 *   - null   = nichts gebucht (Setting AUS, keine Kategorie, kein Item)
 *   - false  = BLOCKIERT (Notification kam hier; der Wurf laeuft nicht)
 *   - String = Label fuer autoParams/Chat (Format AMMO.CHAT_CONSUMED)
 */
export async function consumeAmmoForAttack(actor, weapon, numberofAttacks = 1) {
	if (!isAmmoConsumptionEnabled()) return null;
	const cfg = getWeaponAmmoConfig(actor, weapon);
	if (!cfg) return null;
	const attacks = Math.max(1, Math.round(Number(numberofAttacks) || 1));

	// Wurfwaffen-Selbstverbrauch: 1 Stueck je Angriff aus dem eigenen
	// Stapel (Runde-1-Entscheidung; nicht-stapelbare Wurfwaffen sind in
	// getWeaponAmmoConfig schon herausgefiltert - kein Auto-Verbrauch).
	if (cfg.thrownSelf) {
		const current = getItemCount(cfg.item);
		if (current < attacks) {
			ui.notifications.warn(F('AMMO.ERR_NOT_ENOUGH_THROWN', { weapon: cfg.item.name, attacks }));
			return false;
		}
		await cfg.item.update({ 'system.number': current - attacks });
		return F('AMMO.CHAT_CONSUMED', { name: cfg.item.name, amount: attacks });
	}

	if (!cfg.category) return null;
	const need = cfg.amount * attacks;
	const stacks = findAmmoStacks(actor, cfg.category);
	const total = stacks.reduce((sum, item) => sum + getItemCount(item), 0);
	if (total < need) {
		ui.notifications.warn(
			F('AMMO.ERR_NOT_ENOUGH', {
				weapon: cfg.item.name,
				category: getAmmoCategoryLabel(cfg.category),
				attacks,
			})
		);
		return false;
	}
	let remaining = need;
	let firstName = null;
	for (const item of stacks) {
		if (remaining <= 0) break;
		const current = getItemCount(item);
		const takeFromStack = Math.min(current, remaining);
		// Bewusst bis 0 erlaubt - Zeile bleibt stehen (wie Ressourcen).
		await item.update({ 'system.number': current - takeFromStack });
		remaining -= takeFromStack;
		if (firstName === null) firstName = item.name;
	}
	return F('AMMO.CHAT_CONSUMED', { name: firstName ?? '', amount: need });
}

/* ---------------------------------------------------------------- */
/* Bergen (v1.2: Nur noch Makro-gesteuert)                          */
/* ---------------------------------------------------------------- */
/*
 * Munitionsverbrauch v1.2 (Rudolfs Punkt-11-Architektur-Entscheidung):
 * Der komplette Bergungs-LAUZEIT-Ablauf ist entfernt - Kampf-Zaehler
 * (Combat-Flag ammoUsage), preDeleteCombat-Kampfende-Karte, GM-Anwendungs-
 * karte, 'ammoTrack'-Socket, manueller Kontextmenue-Eintrag und alle zuge-
 * hoerigen Helfer (trackAmmoUsage, applyAmmoUsage, registerAmmoRuntimeHooks,
 * openAmmoRecoveryDialog, performManualAmmoRecovery, buildAmmoRecoveryCards,
 * performAmmoRecovery, applyAmmoRecoveryResult, isAmmoRecoveryEnabled).
 * Bergen laeuft jetzt AUSSCHLIESSLICH ueber das Bergen-Makro (Spieler am
 * eigenen Charakter, GM mit Aktor-Wahl): Anzahl verschossener Stuecke
 * manuell eintragen, 1W20 je Stueck, geborgen bei Wurf <= Schwelle
 * (getAmmoThreshold unten - GRW), Gutschrift direkt auf den Stapel.
 * Die Schwelle + AMMO_THRESHOLDS bleiben hier als kanonische Regel-
 * Referenz fuer das Makro erhalten; das Welt-Setting 'ammoRecovery'
 * (Bergungsoption) bleibt als Makro-Gate registriert.
 */
