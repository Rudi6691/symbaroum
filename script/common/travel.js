/**
 * ==================================================================
 * S4-Paket „Tag/Reise/Ressourcen" — Reise-Engine, Reisetag-Dialog,
 * Tageskarte & Selbstversorgung (Rudolfs Freigabe „Baue es", 07.11.2026).
 *
 * Konzept: Symbaroum-V14-SegenLasten-S4-Reise-v1-Konzept.md (Drive-ID
 * 1jFKCm4cPtnSMnsFt-Xqeb9-OZvyuHMmv), Basis v14 @ 5489d37. Alle Regeln
 * aus GMG „02.07 Fortbewegung im Davokar": Reisestrecke und -zeit
 * (Tabelle 3.03a), Hunger, Durst. Belastung (A39) wird nur verzahnt.
 *
 * Architektur-Entscheidungen (Kap. 2–5 des Konzepts):
 *  - EIN Master-Setting „Reiseregeln" (Default AUS) + separates Setting
 *    „Rationsverfolgung" (Default AUS = „Endlose Ressourcen", Rudolfs
 *    Runde-1-Wunsch), zur Laufzeit über das GM-Utility-Makro umschaltbar.
 *  - Tageszähler als Actor-Flags flags.symbaroum.travel (kein
 *    template.json, A38-Lernweis), Mitgliedschaft über Aktor-Flag
 *    isMember per Kontextmenü der Akteure-Sidebar (Runde 3: KEIN Ordner).
 *  - Tag-Schlüssel-Vergleich statt Delta-Analyse im updateWorldTime-Hook
 *    (31.10.-Analyse): Rückwärtssprung still, Vorwärtssprung → SL-Dialog
 *    „N Reisetage abschließen?", NIEMALS automatische Abbuchung.
 *  - getTravelGroup() ist die EINZIGE Mitglieder-Quelle (S5-Extension-
 *    Point); die Buchung iteriert über eine abstrakte Verbraucherliste
 *    (Extension Point 2); Buchung bleibt Item-basiert über die
 *    Ressourcen-Registry essensration/wasserration (Extension Point 3).
 *  - Kalender: Core-Zeit-API (game.time.calendar) immer; Mini Calendar
 *    NUR als Feature-Check (api.setTime(1, "dawn") für den
 *    Tagesabschluss, sonst Core-Fallback mit kalenderkonformem
 *    sPerDay — NICHT blind 86400).
 *
 * Die Tag-Helfer (dayKeyOf, secondsPerDay, currentComponents) sind
 * bewusst sauber exportiert — das dokumentierte Folgeprojekt „Ticks
 * außerhalb des Kampftrackers" (Elixier-DoT/Symbol-Dauer) baut auf
 * derselben updateWorldTime/Tag-Schlüssel-Basis auf (Kap. 3).
 */

import { symbDialog } from './symbDialog.js';
import { isModernDialogActive, modernDialogClasses } from './modernSheetConfig.js';
import {
	consumeResource,
	consumeResourceFromItem,
	getItemCount,
	getResourceTotal,
	findResourceItems,
	// S4 v1.3 (Kapazitätsmodell): zentrale Rations-Konstante + Kapazitäts-
	// Helfer aus resources.js (keine zweite Kopie der Kategorien-Liste).
	RATION_CATEGORIES,
	isCapacityRationItem,
	getRationCount,
	getAvailableRations,
} from './resources.js';
import { getEncumbranceData, getWeightCategory, formatGE } from './encumbrance.js';
import { openGiveDialog } from './transfer.js';
import { hasEnduringMarch } from './boon.js';
import { prepareRollAttribute } from './dialog.js';
import { createRollData, getOwnerPlayer } from './roll.js';

const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);
const FLAG_SCOPE = 'symbaroum';

/* ----------------------------------------------------------------
 *  Settings (Registrierung im init-Hook, hooks.js — Reihenfolge dort
 *  direkt unter registerBrewSettings, gleiche Foundry-Einstellungs-
 *  liste wie Ressourcen/Munition/Brauen; Rudolfs Runde-1-Entscheidung
 *  „symbaroumConfig-GM-Seite" = config:true + restricted:true)
 * ---------------------------------------------------------------- */

export function registerTravelSettings() {
	// Master-Schalter der Reiseregeln: schaltet Tageswechsel-Engine,
	// Reisetag-Dialog, Etappenrechner und das Hunger/Durst-Framework
	// frei (die Rations-ABBUCHUNG läuft zusätzlich unter dem eigenen
	// Schalter rationTracking unten).
	game.settings.register('symbaroum', 'travelEnabled', {
		name: 'TRAVEL.SETTING_ENABLED',
		hint: 'TRAVEL.SETTING_ENABLED_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
	});
	// v1.1 (Rudolfs Testrunde P3): „Essensrationen" und „Wasserrationen"
	// GETRENNT verfolgbar — RAW-Nähe 02.07 (frisches Wasser ist meist
	// frei verfügbar, nur Essen muss mitgetragen werden; der separate
	// Wasser-Schalter deckt den SL-Fall „Wasser wird knapp" ab). Das
	// GM-Makro schaltet beide GEMEINSAM um, Feinsteuerung hier.
	game.settings.register('symbaroum', 'foodTrackingEnabled', {
		name: 'TRAVEL.SETTING_FOOD_TRACKING',
		hint: 'TRAVEL.SETTING_FOOD_TRACKING_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
	});
	game.settings.register('symbaroum', 'waterTrackingEnabled', {
		name: 'TRAVEL.SETTING_WATER_TRACKING',
		hint: 'TRAVEL.SETTING_WATER_TRACKING_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
	});
	// S4-v1-Sammelschalter: bleibt als interner Wert registriert
	// (config:false) und wird in setupTravelRuntime EINMALIG auf die
	// beiden neuen Schalter migriert — Bestehende Welten verlieren
	// ihren Zustand nicht.
	game.settings.register('symbaroum', 'rationTracking', {
		scope: 'world',
		type: Boolean,
		default: false,
		config: false,
	});
	game.settings.register('symbaroum', 'travelSplitMigrated', {
		scope: 'world',
		type: Boolean,
		default: false,
		config: false,
	});
	// Interne Zustandswerte (KEINE Foundry-Einstellungsliste, config:false)
	game.settings.register('symbaroum', 'travelLastDayKey', {
		scope: 'world',
		type: String,
		default: '',
		config: false,
	});
	game.settings.register('symbaroum', 'travelLastDayTime', {
		scope: 'world',
		type: Number,
		default: 0,
		config: false,
	});
	// Letzte Auswahl des Reisetag-Dialogs (JSON-Array von Aktor-Ids)
	game.settings.register('symbaroum', 'travelLastSelection', {
		scope: 'world',
		type: String,
		default: '',
		config: false,
	});
	// Letzte generelle Anwahl Volle/halbe Ration (Kap. 4.2, persistiert)
	game.settings.register('symbaroum', 'travelRationMode', {
		scope: 'world',
		type: String,
		default: 'full',
		choices: { full: 'TRAVEL.RATION_FULL', half: 'TRAVEL.RATION_HALF' },
		config: false,
	});
}

/** Effektiver Master-Schalter der Reiseregeln. */
export function isTravelEnabled() {
	try {
		return !!game.settings.get('symbaroum', 'travelEnabled');
	} catch (err) {
		return false;
	}
}

/** Effektiver Schalter: Essensrationen verfolgen. */
export function isFoodTrackingEnabled() {
	try {
		return isTravelEnabled() && !!game.settings.get('symbaroum', 'foodTrackingEnabled');
	} catch (err) {
		return false;
	}
}

/** Effektiver Schalter: Wasserrationen verfolgen. */
export function isWaterTrackingEnabled() {
	try {
		return isTravelEnabled() && !!game.settings.get('symbaroum', 'waterTrackingEnabled');
	} catch (err) {
		return false;
	}
}

/** Effektiver Schalter der Rationsverfolgung (v1.1: Essen ODER Wasser
 *  aktiv — Schwellen/Gates greifen je Kategorie einzeln). */
export function isRationTrackingEnabled() {
	return isFoodTrackingEnabled() || isWaterTrackingEnabled();
}

/** Kategoriespezifisches Gate (v1.1, P3): Essensration bucht nur bei
 *  aktivem Essen-Schalter, Wasserration nur bei aktivem Wasser-
 *  Schalter; andere Kategorien fallen auf „irgendeine Verfolgung“. */
export function isRationTrackingFor(category) {
	const c = String(category ?? '');
	if (c === 'essensration') return isFoodTrackingEnabled();
	if (c === 'wasserration') return isWaterTrackingEnabled();
	return isRationTrackingEnabled();
}

/* ----------------------------------------------------------------
 *  Tag-Helfer (Kalender, wiederverwendbar für das Folgeprojekt
 *  „Ticks außerhalb des Kampftrackers", Kap. 3 Synergie)
 * ---------------------------------------------------------------- */

/** Aktive Welt-Kalender-Instanz (Core-Zeit-API, kalenderagnostisch). */
export function getWorldCalendar() {
	return game.time?.calendar ?? null;
}

/**
 * Länge eines Tages in Sekunden laut aktivem Kalender — bewusst NICHT
 * blind 86400 (Mini Calendar erlaubt Custom-Kalender; Core-Gregorian
 * liefert hier ebenfalls 86400). Fallback nur bei kaputtem Kalender.
 */
export function secondsPerDay() {
	try {
		const n = getWorldCalendar()?.componentsToTime?.({ day: 1 });
		if (Number.isFinite(n) && n > 0) return n;
	} catch (err) {}
	return 86400;
}

/** Komponenten eines Weltzeit-Stempels (year/month 0-basiert, day =
 *  Tag des Jahres, dayOfMonth — Mini-Calendar-Konvention, identisch
 *  beim Core-Gregorian). null, wenn kein Kalender verfügbar. */
export function currentComponents(worldTime) {
	try {
		const c = getWorldCalendar();
		if (c?.timeToComponents) return c.timeToComponents(Number.isFinite(worldTime) ? worldTime : game.time.worldTime);
	} catch (err) {}
	return null;
}

/** Tag-Schlüssel (Muster Mini-Calendar-Makro: year-month-dayOfMonth). */
export function dayKeyOf(components) {
	if (!components) return null;
	return `${components.year ?? 0}-${components.month ?? 0}-${components.dayOfMonth ?? components.day ?? 0}`;
}

/** Tagesanfang (Mitternacht) in Weltsekunden — modulo sPerDay, robust
 *  für Kalender mit konstanter Tageslänge (Gregorian UND Custom). */
export function dayStartOf(worldTime) {
	const spd = secondsPerDay();
	const t = Number(worldTime) || 0;
	return t - (((t % spd) + spd) % spd);
}

/**
 * Zeitsprung um N Tage: mit Mini Calendar auf Morgengrauen des Zieltags
 * (Lager → Morgengrauen, Rudolfs 31.10.-Wunsch), OHNE Modul Core-
 * Fallback game.time.advance(N × sPerDay) mit kalenderkonformem sPerDay.
 */
export async function advanceTravelDays(days) {
	const n = Math.max(1, Math.round(Number(days) || 1));
	const mc = game.modules.get('wgtgm-mini-calendar');
	if (mc?.active && mc.api?.setTime) {
		try {
			await mc.api.setTime(n, 'dawn');
			return;
		} catch (err) {
			// bewusst weiterfallen: defekte Modul-API darf den
			// Tagesabschluss nicht blockieren
		}
	}
	await game.time.advance(n * secondsPerDay());
}

/* ----------------------------------------------------------------
 *  Actor-Flags: flags.symbaroum.travel (Kap. 2; kein template.json,
 *  A38-Lernweis — Foundry ergänzt fehlende Flags mit undefined, alle
 *  Lesezugriffe laufen über getIntFlag mit 0-Default)
 *
 *  isMember      — Mitgliedschafts-Flag der Reisegruppe (Runde 3)
 *  foodDays      — Reisetage in Folge ohne verzehrte Nahrung (Schwelle 5)
 *  rationDays    — Reisetage in Folge nur auf halber Ration (Schwelle 10)
 *  waterDays     — Reisetage in Folge ohne Wasser (Schwelle 3)
 *  fedToday      — verbleibende Nahrungs-Versorgungstage (Selbst-
 *                  versorgung/Buschwissen; 0 = nichts gebucht)
 *  wateredToday  — verbleibende Wasser-Versorgungstage (analog)
 *  foragedKey    — Tag-Schlüssel des letzten Versorgungswurfs (v1.1,
 *                  P13: 1× je Reisetag je Aktor; Tag-Schlüssel-Vergleich
 *                  statt Reset-Flag, Selbstheilung beim Tageswechsel)
 *  strengthLoss  — akkumulierte Stärke-Verluste scheiternder Hunger-
 *                  Proben (RAW: täglich Stärke-Probe, Fehlschlag −1;
 *                  Stärke 0 = Tod, SL entscheidet — kein Auto-Tod)
 * ---------------------------------------------------------------- */

function getIntFlag(actor, key) {
	const v = actor?.getFlag(FLAG_SCOPE, `travel.${key}`);
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Gesamtes Reise-Flag-Objekt eines Aktors (frisch, 0-Defaults). */
export function getTravelFlags(actor) {
	return {
		isMember: !!actor?.getFlag(FLAG_SCOPE, 'travel.isMember'),
		foodDays: getIntFlag(actor, 'foodDays'),
		rationDays: getIntFlag(actor, 'rationDays'),
		waterDays: getIntFlag(actor, 'waterDays'),
		fedToday: getIntFlag(actor, 'fedToday'),
		wateredToday: getIntFlag(actor, 'wateredToday'),
		strengthLoss: getIntFlag(actor, 'strengthLoss'),
		foragedKey: String(actor?.getFlag(FLAG_SCOPE, 'travel.foragedKey') ?? ''),
	};
}

/** Hat der Aktor IRGEND einen Reise-Zähler/Fähnchen stehen? */
export function hasTravelState(actor) {
	const f = getTravelFlags(actor);
	return !!(f.isMember || f.foodDays || f.rationDays || f.waterDays || f.fedToday || f.wateredToday || f.strengthLoss);
}

/** Reisegruppe-Mitgliedschaft umschalten (Kontextmenü Akteure-Sidebar). */
export async function toggleTravelMembership(actor) {
	if (!actor) return;
	const isMember = !!actor.getFlag(FLAG_SCOPE, 'travel.isMember');
	if (isMember) {
		await actor.unsetFlag(FLAG_SCOPE, 'travel.isMember');
		ui.notifications.info(F('TRAVEL.MEMBER_REMOVED', { name: actor.name }));
	} else {
		await actor.setFlag(FLAG_SCOPE, 'travel.isMember', true);
		ui.notifications.info(F('TRAVEL.MEMBER_ADDED', { name: actor.name }));
	}
}

/**
 * EINZIGE Mitglieder-Quelle der Reisegruppe (S5-Extension-Point 1,
 * Kap. 12): v1 = alle Aktoren mit dem isMember-Flag; ohne Flag-Träger
 * greift der Fallback „alle Aktoren mit Spielerbesitz" (31.10.-
 * Analyse, V14-Core hat keine Parties). S5 ergänzt hier nur weitere
 * Quellen (virtuelle Gruppe, optional Campaign-Codex-Gruppen-Journal).
 */
export function getTravelGroup() {
	const members = game.actors.filter((a) => !!a.getFlag(FLAG_SCOPE, 'travel.isMember'));
	if (members.length > 0) return members;
	return game.actors.filter((a) => a.hasPlayerOwner === true);
}

/** Gibt es ÜBERHAUPT Flag-Mitglieder? (für die Vorbelegung im Dialog) */
export function hasFlaggedMembers() {
	return game.actors.some((a) => !!a.getFlag(FLAG_SCOPE, 'travel.isMember'));
}

/**
 * v1.5 (Rudolfs Option A „Token-First“, Testrunde v1.4 Punkt 4): Findet
 * den Spielstein eines Welt-Aktors in der AKTIVEN Szene. Der synthetische
 * Aktor eines unverknüpften Spielsteins meldet dieselbe ID wie der Welt-
 * Aktor (deshalb lief die v1.4-Warnprüfung ins Leere) — verlässlicher
 * Diskriminator ist token.document.actorLink (Muster migration.js).
 */
function findSceneToken(actor) {
	if (!canvas?.tokens?.placeables) return null;
	return canvas.tokens.placeables.find((t) => t.actor?.id === actor.id) ?? null;
}

/**
 * v1.5 (Option A): Löst den Szenen-Vertreter eines Welt-Aktors auf —
 * Spielstein vorhanden: dessen Aktor (verknüpft = identische Daten mit
 * dem Welt-Aktor; unverknüpft = der token-lokale Aktor mit dem SICHT-
 * BAREN Inventar und dem token-lokalen Reise-Status der Einzelaktionen,
 * v1.2 Variante A). Ohne Spielstein: der Welt-Aktor selbst.
 */
function resolveSceneRepresentative(actor) {
	if (!actor) return null;
	return findSceneToken(actor)?.actor ?? actor;
}

/* ----------------------------------------------------------------
 *  Hunger-/Durst-Zustände (Kap. 5.1: nur wenn Master + Rations-
 *  verfolgung aktiv — mit „Endlosen Ressourcen" laufen die Zähler
 *  bewusst nicht)
 * ---------------------------------------------------------------- */

/** Zustands-Berechnung aus den Zählern. */
export function getTravelState(actor) {
	const f = getTravelFlags(actor);
	return {
		foodDays: f.foodDays,
		rationDays: f.rationDays,
		waterDays: f.waterDays,
		strengthLoss: f.strengthLoss,
		// v1.1 (P3): Hunger läuft nur über den Essen-Schalter, Durst nur
		// über den Wasser-Schalter — die Zähler der anderen Art bleiben
		// bewusst stumm („Wasser wird knapp“ ohne Essens-Verfolgung)
		hunger: isFoodTrackingEnabled() && (f.foodDays >= game.symbaroum.config.TRAVEL_HUNGER_DAYS || f.rationDays >= game.symbaroum.config.TRAVEL_RATION_DAYS),
		thirst: isWaterTrackingEnabled() && f.waterDays >= game.symbaroum.config.TRAVEL_THIRST_DAYS,
	};
}

/**
 * Missgunst-Vorbelegung bei Hunger/Durst (Kap. 5.2: „alle Proben mit
 * zwei Chancen zu scheitern" = automatische Missgunst-VORBELEGUNG in
 * JEDEM Würfeldialog, Muster getDeathTestFavour S3: Vorauswahl des
 * Gunst-Radios, manuell änderbar — Rudolf-Präzedenz „nicht verriegeln"
 * — PLUS Hinweiszeile über dem Radio in den Templates). Die Todesprobe
 * ist bewusst NICHT betroffen (eigener Wurfpfad, S3-Entscheid).
 */
export function getTravelTestFavour(actor) {
	if (!isTravelEnabled() || !actor) return { favour: 0, forced: false, labelKey: null };
	const st = getTravelState(actor);
	if (st.hunger && st.thirst) return { favour: -1, forced: true, labelKey: 'TRAVEL.FAVOUR_HINT_BOTH' };
	if (st.hunger) return { favour: -1, forced: true, labelKey: 'TRAVEL.FAVOUR_HINT_HUNGER' };
	if (st.thirst) return { favour: -1, forced: true, labelKey: 'TRAVEL.FAVOUR_HINT_THIRST' };
	return { favour: 0, forced: false, labelKey: null };
}

/**
 * Stärke-Malus des Hungers (Kap. 5.2 Bestätigungspunkt 2: Flag-Helfer
 * statt Attribut-Mutation, Muster getEpilepsyPenalty): −X auf Stärke-
 * Proben/Würfe, angezeigt als Kontextzeile (autoParams). X = akkumulierte
 * Fehlschläge der täglichen Hunger-Proben. Rücksetzung über den
 * Reisetag-Dialog (Zählerzeile) bzw. den Kontextmenü-Eintrag.
 */
export function getHungerPenalty(actor) {
	if (!isTravelEnabled() || !actor) return 0;
	return getIntFlag(actor, 'strengthLoss');
}

/**
 * Status-Chip-Kontext für die Stammleiste des modernen Aktorblatts
 * (Runde-4-Entscheidung: in v1). v1.2 (Rudolfs Testrunde 2, „Bestand
 * schlägt Zähler“): Die Chips zählen NEUTRAL ab Tag 1 (kein
 * Verschwinden mehr ohne aktiven Zustand) und sitzen zwischen
 * Eigenschaften und Geld. Zeigt der Aktor RATIONS-BESTAND im Inventar,
 * schlägt der Bestands-Chip die Tageszählung — als Button, dessen Klick
 * 1 Ration für den Reisetag abbucht (consumeRationFromCategory, nur
 * Besitzer/GM). Erst ab den Schwellwerten greift das Warn-Styling
 * (active => m-travel-hunger/-thirst). null nur, wenn die Reiseregeln
 * aus sind oder keine Kategorie verfolgt wird (klassische Ansicht
 * bleibt unverändert).
 */
export function getTravelStatusContext(actor) {
	if (!isTravelEnabled() || !actor) return null;
	const st = getTravelState(actor);
	// v1.3 (Rudolfs Meldung A): Versorgt-Zustand am Chip sichtbar —
	// Badge im Template, Marker-Anzahl im Tooltip; ein Klick im
	// Versorgt-Zustand warnt statt zu buchen (consumeRationFromCategory).
	const fl = getTravelFlags(actor);
	const bookable = !!actor.isOwner;
	const foodStock = isFoodTrackingEnabled() ? getResourceTotal(actor, 'essensration') : 0;
	const waterStock = isWaterTrackingEnabled() ? getResourceTotal(actor, 'wasserration') : 0;
	const foodTooltip = F('TRAVEL.CHIP_HUNGER_TOOLTIP', {
		food: st.foodDays,
		ration: st.rationDays,
		loss: st.strengthLoss,
	});
	const waterTooltip = F('TRAVEL.CHIP_THIRST_TOOLTIP', { days: st.waterDays });
	let food = null;
	if (isFoodTrackingEnabled()) {
		const supplied = fl.fedToday > 0;
		const label =
			foodStock > 0
				? F('TRAVEL.CHIP_FOOD_STOCK', { count: foodStock })
				: st.hunger && st.foodDays >= game.symbaroum.config.TRAVEL_HUNGER_DAYS
					? F('TRAVEL.CHIP_HUNGER_STARVING', { days: st.foodDays })
					: st.rationDays > 0
						? F('TRAVEL.CHIP_HUNGER_RATION', { days: st.rationDays })
						: F('TRAVEL.CHIP_FOOD_COUNTING', { days: st.foodDays });
		food = {
			active: st.hunger,
			bookable: bookable && foodStock > 0,
			supplied,
			label,
			tooltip:
				(supplied
					? `${foodTooltip} · ${F('TRAVEL.CHIP_SUPPLIED_TOOLTIP', { count: fl.fedToday })}`
					: foodStock > 0 && bookable
						? `${foodTooltip} · ${L('TRAVEL.CHIP_CONSUME_HINT')}`
						: foodTooltip),
		};
	}
	let water = null;
	if (isWaterTrackingEnabled()) {
		const supplied = fl.wateredToday > 0;
		water = {
			active: st.thirst,
			bookable: bookable && waterStock > 0,
			supplied,
			label:
				waterStock > 0
					? F('TRAVEL.CHIP_WATER_STOCK', { count: waterStock })
					: st.thirst
						? F('TRAVEL.CHIP_THIRST', { days: st.waterDays })
						: F('TRAVEL.CHIP_WATER_COUNTING', { days: st.waterDays }),
			tooltip:
				(supplied
					? `${waterTooltip} · ${F('TRAVEL.CHIP_SUPPLIED_TOOLTIP', { count: fl.wateredToday })}`
					: waterStock > 0 && bookable
						? `${waterTooltip} · ${L('TRAVEL.CHIP_CONSUME_HINT')}`
						: waterTooltip),
		};
	}
	if (!food && !water) return null;
	return { food, water };
}

/* ----------------------------------------------------------------
 *  Versorgungs-Gate (v1.1, P13): 1× je Reisetag je Aktor
 * ---------------------------------------------------------------- */

/** Aktueller Tag-Schlüssel des Versorgungs-Gates (gleiche Konvention
 *  wie die Tageswechsel-Engine; boon.js trägt den Schlüssel selbst —
 *  KEIN Import boon.js → travel.js, nur umgekehrt). */
export function currentTravelDayKey() {
	const comps = currentComponents();
	return comps ? dayKeyOf(comps) : null;
}

/** Hat der Aktor heute bereits einen Versorgungswurf abgelegt? */
export function isForagedToday(actor) {
	const key = currentTravelDayKey();
	return !!key && String(actor?.getFlag(FLAG_SCOPE, 'travel.foragedKey') ?? '') === key;
}

/* ----------------------------------------------------------------
 *  Selbstversorgung der SC (Kap. 5.3, Rudolfs Runde-2-Vorgabe)
 * ---------------------------------------------------------------- */

/* RATION_CATEGORIES kommt seit v1.3 aus resources.js (Import oben) —
 * eine zentrale Definition für Konsum-Pfade und Blatt-Gating. */

/** Kontextmenü-Gate: ist das Item eine Ration? */
export function isRationItem(item) {
	return item?.type === 'equipment' && RATION_CATEGORIES.includes(String(item.system?.resourceCategory ?? ''));
}

/**
 * Kontextmenü „Verzehren — für den Reisetag versorgt": bucht 1 vom
 * eigenen Stapel (consumeResourceFromItem, Behälter/Stapel wie immer),
 * setzt den Tagesvermerk (Versorgungstage ≥ 1) und resettet die
 * eigenen Zähler entsprechend. Wasserration setzt wateredToday/
 * waterDays, Essensration fedToday + foodDays UND rationDays (eine
 * verzehrte Ration zählt als volle Verpflegung).
 */
/** v1.2 (P4, Rudolfs Testrunde 2, Variante A): Reise-Aktionen an
 *  UNVERKNÜPFTEN Spielsteinen (actor.isToken) wirken nur lokal — der
 *  Reisetag bucht den Welt-Aktor. Warn-Toast, die Aktion läuft
 *  trotzdem (bewusst, damit SL/Ad-hoc-NSC nicht blockiert werden). */
function warnUnlinkedToken(actor) {
	if (actor?.isToken) ui.notifications.warn(L('TRAVEL.TOKEN_UNLINKED_WARN'));
}

/** v1.2: Tagesvermerk + Zähler-Reset nach einer verzehrten Ration
 *  (gemeinsame Basis von Kontextmenü „Verzehren“ und Bestands-Chip).
 *  v1.3 (Rudolfs Entscheidung, Meldung B): Der Hunger-Stärke-Malus
 *  (strengthLoss) wird bei einer verzehrten VOLLLEN Essensration
 *  zurückgesetzt — Chip und Kontextmenü buchen immer ganze Rationen.
 *  Wasserration resettet NICHT (Malus ist eine Hunger-Folge); halbe
 *  Ration (nur Tag-Buchung, rationMode half) resettet ebenfalls
 *  nicht (Rudolfs Entscheidung zu v1.3: „bei halber Ration wird der
 *  Stärke-Malus nicht zurückgesetzt“). */
async function applySelfSupply(actor, category, itemName) {
	const flags = getTravelFlags(actor);
	let restored = false;
	if (category === 'wasserration') {
		flags.wateredToday = Math.max(1, flags.wateredToday + 1);
		flags.waterDays = 0;
	} else {
		flags.fedToday = Math.max(1, flags.fedToday + 1);
		flags.foodDays = 0;
		flags.rationDays = 0;
		// v1.3: volle Mahlzeit behebt den Hunger-Malus (RAW schweigt
		// zur Erholung — Rudolfs Auslegung; nur Essen, nicht Wasser)
		if (flags.strengthLoss > 0) {
			flags.strengthLoss = 0;
			restored = true;
		}
	}
	// Flags schreiben (isMember steckt unverändert in flags — Foundry
	// merged Objekt-Keys unter flags.symbaroum.travel, kein Replace;
	// foragedKey bleibt bewusst unangetastet)
	await actor.update({ 'flags.symbaroum.travel': flags });
	ui.notifications.info(F('TRAVEL.SELF_CONSUMED', { name: itemName, actor: actor.name }));
	if (restored) {
		ui.notifications.info(F('TRAVEL.STRENGTH_RESTORED', { name: actor.name }));
	}
}

export async function consumeRationSelfSupply(actor, item) {
	if (!actor || !isRationItem(item)) return;
	// v1.2 (P4): Warnung an unverknüpften Spielsteinen — buchen trotzdem
	warnUnlinkedToken(actor);
	const category = String(item.system.resourceCategory);
	const taken = await consumeResourceFromItem(item, 1);
	if (taken <= 0) {
		ui.notifications.warn(L('TRAVEL.SELF_NO_STOCK'));
		return;
	}
	await applySelfSupply(actor, category, item.name);
}

/**
 * v1.2 („Bestand schlägt Zähler“): Bestands-Chip-Klick am modernen
 * Blatt — bucht 1 Ration der Kategorie vom ERSTEN Stapel mit Bestand
 * ab (Verzehren-Fluss wie das Kontextmenü: consumeResourceFromItem,
 * Tagesvermerk, Zähler-Reset, Toast). Der Chip-Button wird nur bei
 * Besitz + Bestand gerendert (getTravelStatusContext.bookable); das
 * Owner-Gate hier ist die zweite Verteidigungslinie.
 */
export async function consumeRationFromCategory(actor, category) {
	const cat = String(category ?? '');
	if (!actor || !actor.isOwner || !RATION_CATEGORIES.includes(cat)) return;
	// v1.2 (P4): Warnung an unverknüpften Spielsteinen — buchen trotzdem
	warnUnlinkedToken(actor);
	// v1.3 (Rudolfs Meldung A, „Versorgt-Transparenz“): Ist der Akteur
	// für den Reisetag bereits versorgt (Marker aus Chip-Klick oder
	// Kontextmenü „Verzehren“), bucht der Chip-Klick NICHT nochmal —
	// Warn-Toast statt weiterem Marker (kein Marker-Stau mehr, der
	// die Tagesbuchung unsichtbar blockiert).
	const flagsNow = getTravelFlags(actor);
	const alreadySupplied = cat === 'wasserration' ? flagsNow.wateredToday > 0 : flagsNow.fedToday > 0;
	if (alreadySupplied) {
		ui.notifications.warn(F('TRAVEL.SUPPLY_SUPPLIED_WARN', { name: actor.name }));
		return;
	}
	const stock = getResourceTotal(actor, cat);
	if (stock <= 0) {
		ui.notifications.warn(L('TRAVEL.SELF_NO_STOCK'));
		return;
	}
	// v1.3: „Stapel mit Bestand“ = verfügbare Rationen (Kapazitäts-
	// Item: rationCount, einfacher Stapel: Anzahl)
	const stacks = findResourceItems(actor, cat);
	const item = stacks.find((s) => getAvailableRations(s) > 0) ?? null;
	if (!item) {
		ui.notifications.warn(L('TRAVEL.SELF_NO_STOCK'));
		return;
	}
	const taken = await consumeResourceFromItem(item, 1);
	if (taken <= 0) {
		ui.notifications.warn(L('TRAVEL.SELF_NO_STOCK'));
		return;
	}
	await applySelfSupply(actor, cat, item.name);
}

/** Kontextmenü „Reise-Status zurücksetzen": eigene Zähler/Vermerke
 *  OHNE Buchung auf 0 (SL-Vertrauen: Rollenspiel-Mahlzeiten, Gruppen-
 *  vorräte außerhalb des Inventars). isMember bleibt stehen. */
export async function resetTravelStatus(actor) {
	if (!actor) return;
	// v1.2 (P4): Warnung an unverknüpften Spielsteinen — Reset läuft trotzdem
	warnUnlinkedToken(actor);
	await actor.update({
		'flags.symbaroum.travel': {
			isMember: !!actor.getFlag(FLAG_SCOPE, 'travel.isMember'),
			foodDays: 0,
			rationDays: 0,
			waterDays: 0,
			fedToday: 0,
			wateredToday: 0,
			strengthLoss: 0,
		},
	});
	ui.notifications.info(F('TRAVEL.SELF_RESET', { name: actor.name }));
}

/* ----------------------------------------------------------------
 *  Tageswechsel-Engine (updateWorldTime-Hook, Kap. 3)
 * ---------------------------------------------------------------- */

/**
 * Tag-Schlüssel-Vergleich statt Delta-Analyse (31.10.-Analyse):
 *  gleich → nichts; Rückwärtssprung → Key still nachführen, kein
 *  Dialog, keine Abbuchung; Vorwärtssprung (auch mehrägig) → SL-Dialog
 *  mit Tageszahl. NIEMALS automatische Abbuchung — der Dialog ist der
 *  einzige Buchungsweg (Rudolfs Design).
 */
export function handleWorldTimeUpdate(worldTime) {
	if (!game.user.isGM || !isTravelEnabled()) return;
	const comps = currentComponents(worldTime);
	if (!comps) return;
	const key = dayKeyOf(comps);
	const spd = secondsPerDay();
	const midnight = dayStartOf(worldTime);
	const lastKey = game.settings.get('symbaroum', 'travelLastDayKey') ?? '';
	if (!lastKey) {
		// Erstverarbeitung: heutigen Tag als verarbeitet markieren
		game.settings.set('symbaroum', 'travelLastDayKey', key);
		game.settings.set('symbaroum', 'travelLastDayTime', midnight);
		return;
	}
	if (key === lastKey) return;
	const lastTime = Number(game.settings.get('symbaroum', 'travelLastDayTime')) || 0;
	// Key wird in BEIDEN Fällen (Bestätigen UND Ablehnen) als verarbeitet
	// markiert (Konzept Kap. 3) — deshalb VOR dem Dialog schreiben.
	game.settings.set('symbaroum', 'travelLastDayKey', key);
	game.settings.set('symbaroum', 'travelLastDayTime', midnight);
	if (midnight < lastTime) {
		// Rückwärtssprung: still nachführen (keine Rationen zurück)
		return;
	}
	const days = Math.max(1, Math.round((midnight - lastTime) / spd));
	// Dialog unabhängig von der Rationsverfolgung anbieten (Master ist das
	// Gate oben): der Reisetag-Dialog bucht nur bei aktiver Verfolgung,
	// bietet aber immer Etappenrechner und Tempo-Konsequenzen.
	promptTravelDayBreak(days);
}

/** SL-Bestätigungsdialog „N Reisetage abschließen?" (kein Buchungszwang). */
function promptTravelDayBreak(days) {
	symbDialog({
		title: L('TRAVEL.DAY_BREAK_TITLE'),
		content: `<div class="symbaroum travel-dialog${isModernDialogActive() ? ' modern-travel-dialog' : ' dialog'}">
			<p>${F('TRAVEL.DAY_BREAK_TEXT', { days })}</p>
			<p class="m-travel-note">${L('TRAVEL.DAY_BREAK_HINT')}</p>
		</div>`,
		classes: [...(isModernDialogActive() ? modernDialogClasses('modern-travel-dialog') : [])],
		width: 440,
		buttons: {
			complete: {
				icon: '<i class="fas fa-sun"></i>',
				label: L('TRAVEL.DAY_BREAK_CONFIRM'),
				callback: () => {
					openTravelDayDialog({ days, advanceAfter: false });
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
			},
		},
		default: 'complete',
	});
}

/* ----------------------------------------------------------------
 *  Etappenrechner (Tabelle 3.03a, Kap. 4.3) — reine Berechnung
 * ---------------------------------------------------------------- */

/** Effektives Tempo je Aktor nach A39-Verzahnung (RAW Belastung.md):
 *  Belastete/Überlastete (A39 state loaded/over) verschlechtern die
 *  Kategorie um eine Stufe (Tages → Gewalt, Gewalt → Todes);
 *  Überlastete (über harter Grenze, state 'over') ist der ECHTE
 *  Todesmarsch unmöglich (blockiert). */
function effectivePaceFor(actor, pace) {
	const enc = getEncumbranceData(actor);
	if (!enc.enabled || (enc.state !== 'loaded' && enc.state !== 'over')) {
		return { pace, worsened: false, blocked: false, probeMalus: 0, encState: enc.state };
	}
	const order = game.symbaroum.config.TRAVEL_PACE_ORDER;
	const idx = order.indexOf(pace);
	const blocked = enc.state === 'over' && pace === 'death';
	if (idx < 0) return { pace, worsened: false, blocked, probeMalus: enc.defenseMalus, encState: enc.state };
	return {
		pace: idx >= order.length - 1 ? pace : order[idx + 1],
		worsened: true,
		blocked,
		probeMalus: enc.defenseMalus,
		encState: enc.state,
	};
}

/** km/Tag laut Tabelle 3.03a (Wilde Davokar = Werte des Hellen). */
function distanceFor(mode, pace, terrain, river) {
	const cfg = game.symbaroum.config;
	// v1.1 „Lager/Aufenthalt": 0 km, keine Etappenrechnung
	if (mode === 'camp') return 0;
	let t = cfg.TRAVEL_TERRAIN_DISTANCE_KEY[terrain] ?? 'ambria';
	if (river) t = cfg.TRAVEL_RIVER_EASIER[t] ?? t;
	return cfg.TRAVEL_DISTANCE[mode]?.[pace]?.[t] ?? 0;
}

/* ----------------------------------------------------------------
 *  Reisetag-Dialog (Kap. 4, Kernstück — SL-Verwaltung)
 * ---------------------------------------------------------------- */

let travelDialogData = null; // wird beim Öffnen gesetzt (für den Abschließen-Submit)

/**
 * Reisetag-Dialog öffnen: Auslöser Tageswechsel (advanceAfter=false,
 * die Zeit ist bereits gesprungen) ODER GM-Makro „Reisetag abschließen"
 * (advanceAfter=true — Abschluss stellt die Zeit auf Morgengrauen).
 */
export function openTravelDayDialog({ days = 1, advanceAfter = true } = {}) {
	if (!game.user.isGM) {
		ui.notifications.warn(L('TRAVEL.GM_ONLY'));
		return;
	}
	const cfg = game.symbaroum.config;
	const daysN = Math.max(1, Math.round(Number(days) || 1));
	const foodTracking = isFoodTrackingEnabled();
	const waterTracking = isWaterTrackingEnabled();
	const anyTracking = foodTracking || waterTracking;

	// Vorbelegung (Kap. 4.1): Flag-Mitglieder vorabgehakt; ohne Flag-
	// Träger Fallback alle Aktoren mit Spielerbesitz; darüber liegt die
	// persistierte letzte Auswahl (world setting).
	let preselect = [];
	try {
		const saved = JSON.parse(game.settings.get('symbaroum', 'travelLastSelection') || '""');
		if (Array.isArray(saved)) preselect = saved;
	} catch (err) {}
	// v1.1 (P6, Rudolfs Testrunde): nur noch die AUSGEWÄHLTEN Mitglieder
	// der Reisegruppe (isMember-Flag; Fallback Spielerbesitz über
	// getTravelGroup). NSC-Gefährten kommen per Kontextmenü-Flag in die
	// Gruppe; Träger/Lasttiere ohne Aktorblatt = S5-Paket.
	const candidates = getTravelGroup();
	if (preselect.length === 0) {
		preselect = candidates.map((a) => a.id);
	}
	const rationMode = game.settings.get('symbaroum', 'travelRationMode') === 'half' ? 'half' : 'full';

	const actorRows = candidates
		.map((actor) => {
			/* v1.5 (Rudolfs Option A „Token-First“): Anzeige und Buchung
			 * lesen denselben SZENEN-VERTRETER — bei unverknüpften
			 * Spielsteinen laufen Chip-/Kontextzustand token-lokal
			 * (v1.2 Variante A); Zähler/Vermerke/Last aus dem Welt-
			 * Aktor würden gegen die Buchung prellen. Das isMember-
			 * Flag bleibt am Welt-Aktor (Sidebar-Kontextmenü). */
			const rep = resolveSceneRepresentative(actor);
			const f = getTravelFlags(rep);
			const enc = getEncumbranceData(rep);
			const isMember = !!actor.getFlag(FLAG_SCOPE, 'travel.isMember');
			const checked = preselect.includes(actor.id) || isMember;
			return { actor, rep, f, enc, isMember, checked };
		})
		.filter((r) => r.actor);

	const memberRows = actorRows
		.map((r) => {
			// v1.3 (Rudolfs Meldung A): Die Versorgungs-Vermerke sind das
			// Buchungs-Gate des Tagesabschlusses (Chip-Klick/Kontextmenü
			// buchen vorab, der Abschluss konsumiert den Marker, statt
			// nochmal zu buchen) — ab v1.3 als read-only Spalte sichtbar,
			// damit das Gate nie wieder unsichtbar blockiert.
			const markerParts = [];
			if (r.f.fedToday > 0) markerParts.push(`<i class="fa-solid fa-utensils"></i> ${r.f.fedToday}`);
			if (r.f.wateredToday > 0) markerParts.push(`<i class="fa-solid fa-droplet"></i> ${r.f.wateredToday}`);
			const markersHtml = markerParts.length > 0
				? `<span class="m-travel-markers" title="${F('TRAVEL.MARKER_CELL', { food: r.f.fedToday, water: r.f.wateredToday })}">${markerParts.join(' · ')}</span>`
				: `<span class="m-travel-dim">–</span>`;
			// v1.1 (P3): Zähler-Spalten je Schalter — Essen (ohne Essen,
			// halbe Ration) nur bei Essens-Verfolgung, Wasser nur bei
			// Wasser-Verfolgung; Stärke-Verlust bei beidem.
			const counterCells = anyTracking
				? `${foodTracking ? `<td class="m-travel-count"><input type="number" min="0" step="1" data-travel-counter="${r.actor.id}-foodDays" value="${r.f.foodDays}"></td>
				<td class="m-travel-count"><input type="number" min="0" step="1" data-travel-counter="${r.actor.id}-rationDays" value="${r.f.rationDays}"></td>` : ''}${waterTracking ? `<td class="m-travel-count"><input type="number" min="0" step="1" data-travel-counter="${r.actor.id}-waterDays" value="${r.f.waterDays}"></td>` : ''}<td class="m-travel-count"><input type="number" min="0" step="1" data-travel-counter="${r.actor.id}-strengthLoss" value="${r.f.strengthLoss}"></td><td class="m-travel-count">${markersHtml}</td>`
				: '';
			return `<tr>
				<td class="m-travel-name"><label class="m-travel-member"><input type="checkbox" data-travel-member="${r.actor.id}"${r.checked ? ' checked' : ''}> ${foundry.utils.escapeHTML(r.actor.name)}</label>${r.isMember ? ` <i class="fas fa-person-hiking" title="${L('TRAVEL.MEMBER_BADGE')}"></i>` : ''}</td>
				${counterCells}
			</tr>`;
		})
		.join('');

	const counterHeads = anyTracking
		? `${foodTracking ? `<th class="m-travel-count">${L('TRAVEL.COUNTER_FOOD')}</th>
			<th class="m-travel-count">${L('TRAVEL.COUNTER_RATION')}</th>` : ''}${waterTracking ? `<th class="m-travel-count">${L('TRAVEL.COUNTER_WATER')}</th>` : ''}<th class="m-travel-count">${L('TRAVEL.COUNTER_STRENGTH')}</th><th class="m-travel-count">${L('TRAVEL.COUNTER_MARKERS')}</th>`
		: '';

	const modeRadios = Object.entries(cfg.TRAVEL_MODE)
		.map(([id, def]) => `<label class="m-travel-radio"><input type="radio" name="travelMode" value="${id}"${id === 'march' ? ' checked' : ''}> ${L(def.label)}</label>`)
		.join('');
	const paceOptions = cfg.TRAVEL_PACE_ORDER.map((id) => `<option value="${id}"${id === 'day' ? ' selected' : ''}>${L(cfg.TRAVEL_PACE[id].label)}</option>`).join('');
	const ridePaceOptions = cfg.TRAVEL_PACE_ORDER.map((id) => `<option value="${id}"${id === 'day' ? ' selected' : ''}>${L(cfg.TRAVEL_PACE[id].rideLabel)}</option>`).join('');
	const terrainOptions = Object.entries(cfg.TRAVEL_TERRAIN)
		.map(([id, def]) => `<option value="${id}"${id === 'davokar' ? ' selected' : ''}>${L(def.label)}</option>`)
		.join('');

	const modern = isModernDialogActive();
	const rootClass = `symbaroum travel-dialog${modern ? ' modern-travel-dialog' : ' dialog'}`;
	const html = `<div class="${rootClass}">
		<div class="m-travel-sec">${L('TRAVEL.SECTION_GROUP')}</div>
		<div class="m-travel-scroll">
			<table class="m-travel-table">
				<tr><th>${L('TRAVEL.SECTION_GROUP')}</th>${counterHeads}</tr>
				${memberRows}
			</table>
		</div>
		${foodTracking ? `<div class="m-travel-sec">${L('TRAVEL.SECTION_RATIONS')}</div>
		<div class="m-travel-radios">
			<label class="m-travel-radio"><input type="radio" name="travelRation" value="full"${rationMode === 'full' ? ' checked' : ''}> ${L('TRAVEL.RATION_FULL')}</label>
			<label class="m-travel-radio"><input type="radio" name="travelRation" value="half"${rationMode === 'half' ? ' checked' : ''}> ${L('TRAVEL.RATION_HALF')}</label>
		</div>
		<p class="m-travel-note">${L('TRAVEL.RATION_HINT')}</p>` : waterTracking ? `<p class="m-travel-note">${L('TRAVEL.WATER_ONLY_HINT')}</p>` : `<p class="m-travel-note">${L('TRAVEL.RATION_OFF_HINT')}</p>`}
		<div class="m-travel-sec">${L('TRAVEL.SECTION_ROUTE')}</div>
		<div class="m-travel-radios">${modeRadios}</div>
		<div class="m-travel-row">
			<label for="travelPace">${L('TRAVEL.PACE_LABEL')}</label>
			<select id="travelPace">${paceOptions}</select>
			<select id="travelPaceRide" style="display:none;">${ridePaceOptions}</select>
			<span id="travelPaceCamp" style="display:none;">${L('TRAVEL.PACE_CAMP')}</span>
		</div>
		<div class="m-travel-row">
			<label for="travelTerrain">${L('TRAVEL.TERRAIN_LABEL')}</label>
			<select id="travelTerrain">${terrainOptions}</select>
		</div>
		<label class="m-travel-radio m-travel-river"><input type="checkbox" id="travelRiver"> ${L('TRAVEL.RIVER_OPTION')}</label>
		<div class="m-travel-km"><i class="fas fa-route"></i> <b id="travelKm">0</b> ${L('TRAVEL.KM_PER_DAY')}</div>
		<p class="m-travel-note">${L('TRAVEL.PACE_HINT')}</p>
		<label class="m-travel-radio"><input type="checkbox" id="travelAdvance"${advanceAfter ? ' checked' : ''}> ${F('TRAVEL.ADVANCE_OPTION', { days: daysN })}</label>
		<p class="m-travel-note">${L('TRAVEL.ADVANCE_HINT')}</p>
	</div>`;

	travelDialogData = { days: daysN, candidates, actorRows };

	symbDialog({
		title: F('TRAVEL.DIALOG_TITLE', { days: daysN }),
		content: html,
		classes: [...(modern ? modernDialogClasses('modern-travel-dialog') : [])],
		width: 560,
		// Listener NACH Render am Live-DOM (DialogV2-Lernweis): km-Ausgabe
		// live nachführen + Ritt-Wechsel zwischen den Tempo-Selects.
		onRender: (element) => {
			const updateKm = () => {
				const mode = element?.querySelector?.("input[name='travelMode']:checked")?.value ?? 'march';
				const paceSel = mode === 'ride' ? element?.querySelector?.('#travelPaceRide') : element?.querySelector?.('#travelPace');
				const pace = paceSel?.value ?? 'day';
				const terrain = element?.querySelector?.('#travelTerrain')?.value ?? 'davokar';
				const river = !!element?.querySelector?.('#travelRiver')?.checked;
				const km = distanceFor(mode, pace, terrain, river);
				const out = element?.querySelector?.('#travelKm');
				if (out) out.textContent = String(km * daysN);
			};
			for (const id of ['travelPace', 'travelPaceRide', 'travelTerrain', 'travelRiver']) {
				element?.querySelector?.(`#${id}`)?.addEventListener('change', updateKm);
			}
			element?.querySelectorAll?.("input[name='travelMode']").forEach((r) => r.addEventListener('change', () => {
				const mode = element.querySelector("input[name='travelMode']:checked")?.value ?? 'march';
				const march = element.querySelector('#travelPace');
				const ride = element.querySelector('#travelPaceRide');
				const camp = element.querySelector('#travelPaceCamp');
				if (march && ride) {
					// v1.1 „Lager": Tempo-Anzeige statt Selects (Rudolfs
					// Testrunde: „beim Tempo 'Lager' anzeigen")
					march.style.display = mode === 'ride' || mode === 'camp' ? 'none' : '';
					ride.style.display = mode === 'ride' ? '' : 'none';
					if (camp) camp.style.display = mode === 'camp' ? '' : 'none';
				}
				updateKm();
			}));
			updateKm();
		},
		buttons: {
			complete: {
				icon: '<i class="fas fa-sun"></i>',
				label: F('TRAVEL.COMPLETE_BUTTON', { days: daysN }),
				callback: (html) => submitTravelDay(html),
			},
			bushcraft: {
				icon: '<i class="fas fa-leaf"></i>',
				label: L('TRAVEL.SUPPLY_BUTTON'),
				callback: (html) => {
					// v1.1 (Rudolfs Testrunde): Auswahldialog, WELCHES
					// Reisegruppe-Mitglied sucht — SC erhalten eine
					// öffentliche Aufforderungs-Karte (der Spieler würfelt
					// selbst), NSC würfelt die SL direkt. Der Ertrag wird
					// nach dem Wurf als Rations-Items auf den Sucher
					// gebucht (RAW: Gesamtmenge 1W6/1W10).
					openSupplyRollRequest(readCheckedMembers(html));
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
			},
		},
		default: 'complete',
	});
}

/** Angehakte Mitglieder aus dem Dialog-HTML lesen. */
function readCheckedMembers(html) {
	const root = html?.[0] ?? null;
	if (!root) return [];
	return Array.from(root.querySelectorAll("input[data-travel-member]:checked")).map((el) => el.dataset.travelMember);
}

/** Zähler-Korrekturen aus dem Dialog-HTML lesen (Basis vor Verarbeitung). */
function readCounterEdits(html) {
	const root = html?.[0] ?? null;
	const out = {};
	if (!root) return out;
	for (const el of root.querySelectorAll('input[data-travel-counter]')) {
		const [actorId, key] = String(el.dataset.travelCounter ?? '').split('-');
		if (!actorId || !key) continue;
		// v1.2 (Rudolfs Testrunde 2, Absicherung): unveränderte Eingaben
		// überspringen (HTML-Prefill = defaultValue) — verhindert den
		// Stale-Overwrite der Zähler, wenn der Dialog länger offen war
		// und der Flag-Stand inzwischen woanders weitergelaufen ist.
		if (el.value === el.defaultValue) continue;
		const n = Number(el.value);
		if (!Number.isFinite(n) || n < 0) continue;
		if (!out[actorId]) out[actorId] = {};
		out[actorId][key] = Math.round(n);
	}
	return out;
}

/** Abschließen-Submit: Buchung + Zähler + Konsequenzen + Karte + ggf. Zeitsprung. */
async function submitTravelDay(html) {
	const data = travelDialogData;
	travelDialogData = null;
	if (!data) return;
	const checkedIds = readCheckedMembers(html);
	if (checkedIds.length === 0) {
		ui.notifications.warn(L('TRAVEL.NO_MEMBERS'));
		return;
	}
	// Letzte Auswahl persistieren (Kap. 4.1)
	game.settings.set('symbaroum', 'travelLastSelection', JSON.stringify(checkedIds));
	const rationMode = html[0].querySelector("input[name='travelRation']:checked")?.value ?? 'full';
	game.settings.set('symbaroum', 'travelRationMode', rationMode === 'half' ? 'half' : 'full');
	const mode = html[0].querySelector("input[name='travelMode']:checked")?.value ?? 'march';
	const paceSel = mode === 'ride' ? html[0].querySelector('#travelPaceRide') : html[0].querySelector('#travelPace');
	const pace = mode === 'camp' ? 'camp' : (paceSel?.value ?? 'day');
	const terrain = html[0].querySelector('#travelTerrain')?.value ?? 'davokar';
	const river = !!html[0].querySelector('#travelRiver')?.checked;
	const advance = !!html[0].querySelector('#travelAdvance')?.checked;

	await completeTravelDays({
		days: data.days,
		actorIds: checkedIds,
		rationMode,
		mode,
		pace,
		terrain,
		river,
		advance,
		counterEdits: readCounterEdits(html),
	});
}

/* ----------------------------------------------------------------
 *  Buchung: Reisetage abschließen (Kap. 4.5, Kap. 5.1)
 * ---------------------------------------------------------------- */

async function completeTravelDays({ days, actorIds, rationMode, mode, pace, terrain, river, advance, counterEdits }) {
	const foodTracking = isFoodTrackingEnabled();
	const waterTracking = isWaterTrackingEnabled();
	const cfg = game.symbaroum.config;
	const cardActors = [];

	// Ausdauernder Marsch (Kap. 6): Träger legt KEINE Strapazen-Probe
	// ab (Zäh-Verlust bleibt RAW) und heilt im Gewaltmarsch; ALLE
	// Mitreisenden erhalten eine zweite Chance auf die Strapazen-Probe
	// + Erholungs-Probe im Gewaltmarsch.
	let enduringGroup = false;

	/* v1.5 (Rudolfs Punkt 2): Hunger-Anforderungskarten sammeln — je
	 * besitzendem Spieler entsteht nach der Tageskarte eine eigene
	 * Würfeln-Karte (Resist-Muster), siehe nach der Karten-Erstellung. */
	const hungerRequests = [];

	for (const actorId of actorIds) {
		const worldActor = game.actors.get(actorId);
		if (!worldActor) continue;
		/* v1.5 (Rudolfs Option A „Token-First“, Testrunde v1.4 Punkt 4):
		 * Der Tagesabschluss bucht den SZENEN-VERTRETER — Spielstein
		 * vorhanden: dessen Aktor (verknüpft = Welt-Aktor-Daten, un-
		 * verknüpft = der token-lokale Aktor mit der sichtbaren Ration,
		 * konsistent mit den Einzelaktionen der v1.2-Variante A); ohne
		 * Spielstein: den Welt-Aktor. Korrigiert zugleich die v1.4-
		 * Warnung (der isToken-Zweig war toter Code, weil der Dialog
		 * nur Welt-Aktor-Mitglieder listet; die id-basierte Spielstein-
		 * Suche traf auch unverknüpfte Spielsteine, da der synthetische
		 * Aktor dieselbe ID meldet) — verlässlicher Diskriminator ist
		 * actorLink: unverknüpft = Buchung wirkt nur lokal am Spiel-
		 * stein, kein Spielstein = Buchung wirkt am Welt-Aktor. */
		const sceneToken = findSceneToken(worldActor);
		const actor = sceneToken?.actor ?? worldActor;
		if (sceneToken && sceneToken.document?.actorLink === false) {
			ui.notifications.warn(F('TRAVEL.DAY_TOKEN_LOCAL_WARN', { name: actor.name }));
		} else if (!sceneToken) {
			ui.notifications.warn(F('TRAVEL.DAY_TOKEN_NONE_WARN', { name: worldActor.name }));
		}
		// 1) SL-Korrekturen aus den Zählerzeilen als Basis schreiben
		const flags = getTravelFlags(actor);
		const edits = counterEdits?.[actorId] ?? null;
		if (edits) {
			for (const key of ['foodDays', 'rationDays', 'waterDays', 'strengthLoss']) {
				if (edits[key] != null) flags[key] = edits[key];
			}
		}
		const summary = {
			food: 0, water: 0, foodWarn: 0, waterWarn: 0, suppliedFood: 0, suppliedWater: 0,
		};
		// 2) N Reisetage abarbeiten (Buchung nur bei aktiver Verfolgung;
		//    halbe Ration bucht bewusst jede 2. Tag eine Ration — RAW
		//    streckt der halbe Verpflegungsplan den Vorrat, dokumentierte
		//    Auslegung des Konzepts „1 Essensration pro Reisetag")
		for (let day = 0; day < days; day++) {
			// v1.1 (P3): Essen und Wasser buchen je nach eigenem Schalter —
			// Voll/halbe Ration betrifft nur die Essensseite
			if (foodTracking) {
				if (flags.fedToday > 0) {
					flags.fedToday -= 1;
					flags.foodDays = 0;
					flags.rationDays = 0;
					summary.suppliedFood += 1;
					// v1.3 (Meldung B): Marker = vorher verzehrte VOLLE
					// Ration (Chip/Kontextmenü) → Hunger-Malus behoben
					if (flags.strengthLoss > 0) flags.strengthLoss = 0;
				} else {
					const bookNow = rationMode === 'full' || flags.rationDays % 2 === 0;
					if (bookNow) {
						const result = await consumeResource(actor, 'essensration', 1);
						if (result) {
							summary.food += 1;
							flags.foodDays = 0;
							if (rationMode === 'half') flags.rationDays += 1;
							else flags.rationDays = 0;
							// v1.3 (Meldung B): volle Ration gebucht →
							// Hunger-Malus behoben; bei halber Ration
							// bewusst NICHT (Rudolfs Entscheidung: der
							// Körper hungelt weiter, rationDays läuft
							// Richtung Hungerzustand)
							if (rationMode !== 'half' && flags.strengthLoss > 0) flags.strengthLoss = 0;
						} else {
							flags.foodDays += 1;
							summary.foodWarn += 1;
						}
					} else if (rationMode === 'half') {
						// halbe Ration ohne Buchung (Vorrat streckt)
						flags.foodDays = 0;
						flags.rationDays += 1;
					}
				}
			}
			if (waterTracking) {
				if (flags.wateredToday > 0) {
					flags.wateredToday -= 1;
					flags.waterDays = 0;
					summary.suppliedWater += 1;
				} else {
					const result = await consumeResource(actor, 'wasserration', 1);
					if (result) {
						summary.water += 1;
						flags.waterDays = 0;
					} else {
						flags.waterDays += 1;
						summary.waterWarn += 1;
					}
				}
			}
		}
		// 3) Tempo-Konsequenzen (Kap. 4.4 + A39-Verzahnung); v1.1
		// „Lager": keine Etappe, keine Proben, keine Zäh-Buchung,
		// natürliche Heilung erlaubt (summary.noHealing = false)
		const eff = pace === 'camp'
			? { pace: 'camp', worsened: false, blocked: false, probeMalus: 0, encState: null }
			: effectivePaceFor(actor, pace);
		let toughLoss = 0;
		let deathProbe = false;
		if (eff.pace === 'death' && !eff.blocked) {
			toughLoss = days; // mind. 1 Punkt Zähigkeit je Reisetag (RAW)
			deathProbe = !hasEnduringMarch(actor);
		}
		if (hasEnduringMarch(actor)) enduringGroup = true;
		if (eff.pace === 'death' && eff.blocked) {
			// Überlastet + echter Todesmarsch = unmöglich (RAW): keine
			// Probe, keine Buchung — die Folgen entscheidet die SL.
			summary.deathBlocked = true;
		}
		summary.noHealing = eff.pace === 'forced' || eff.pace === 'death';
		summary.effectivePace = eff.pace;
		summary.worsened = eff.worsened;
		summary.probeMalus = eff.pace === 'death' ? eff.probeMalus : 0;
		if (toughLoss > 0) {
			const cur = Number(actor.system?.health?.toughness?.value);
			if (Number.isFinite(cur)) {
				await actor.update({ 'system.health.toughness.value': Math.max(0, cur - toughLoss) });
			}
		}
		// 4) Flags einmalig schreiben (isMember bleibt unangetastet);
		// v1.1 (P13): Versorgungs-Gate für den neuen Reisetag freigeben
		// (Tag-Schlüssel-Vergleich heilt ohnehin, hier explizit)
		await actor.update({ 'flags.symbaroum.travel': flags });
		await actor.unsetFlag(FLAG_SCOPE, 'travel.foragedKey');
		const st = {
			foodDays: flags.foodDays,
			rationDays: flags.rationDays,
			waterDays: flags.waterDays,
			strengthLoss: flags.strengthLoss,
			hunger: foodTracking && (flags.foodDays >= cfg.TRAVEL_HUNGER_DAYS || flags.rationDays >= cfg.TRAVEL_RATION_DAYS),
			thirst: waterTracking && flags.waterDays >= cfg.TRAVEL_THIRST_DAYS,
		};
		st.hungerLabel = st.hunger
			? flags.foodDays >= cfg.TRAVEL_HUNGER_DAYS
				? F('TRAVEL.CHIP_HUNGER_STARVING', { days: st.foodDays })
				: F('TRAVEL.CHIP_HUNGER_RATION', { days: st.rationDays })
			: '';
		st.thirstLabel = st.thirst ? F('TRAVEL.CHIP_THIRST', { days: st.waterDays }) : '';
		cardActors.push({
			id: actor.id,
			name: actor.name,
			img: actor.img,
			summary,
			state: st,
			deathProbe,
			toughLoss,
			enduring: hasEnduringMarch(actor),
		});
		/* v1.5 (Punkt 2): Hunger-Betroffene sammeln — Spieler-Besitzer
		 * erhalten eine eigene Anfrage-Karte, GM-besessene Aktoren
		 * (z. B. NSC-Bestie) laufen über die GM-Fallback-Taste der
		 * Tageskarte (getOwnerPlayer filtert GM heraus). */
		if (st.hunger) {
			hungerRequests.push({ actorId, actor });
		}
	}

	// 5) EINE Chat-Karte je Abschluss (Kap. 4.7: Gruppierung bei N Tagen)
	const km = distanceFor(mode, pace, terrain, river) * days;
	const rationLabel = foodTracking
		? (rationMode === 'half' ? L('TRAVEL.RATION_HALF') : L('TRAVEL.RATION_FULL'))
		: waterTracking ? L('TRAVEL.RATION_WATER_ONLY') : L('TRAVEL.RATION_OFF');
	const cardData = {
		days,
		km,
		modeLabel: L(game.symbaroum.config.TRAVEL_MODE[mode]?.label ?? 'TRAVEL.MODE_MARCH'),
		pace,
		paceLabel: L(game.symbaroum.config.TRAVEL_PACE[pace]?.[mode === 'ride' ? 'rideLabel' : 'label'] ?? 'TRAVEL.PACE_DAY'),
		rationTracking: foodTracking || waterTracking,
		foodTracking,
		waterTracking,
		rationLabel,
		enduringGroup,
		actors: cardActors,
	};
	const content = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/travel-day.hbs', cardData);
	await postChat(content, { 'symbaroum.travelCard': cardData });

	/* v1.5 (Punkt 2, je-Besitzer-Karte im Resist-Muster): Pro hunger-
	 * betroffenem Aktor mit aktivem Spieler-Besitzer bekommt der
	 * Spieler eine EIGENE Whisper-Karte mit Würfeln-Taste — die Karte
	 * gehört dem Spieler, damit die Taste nach dem Klick verschwinden
	 * kann (die Tageskarte gehört der SL, Fremde dürfen sie nicht
	 * bearbeiten; genau deshalb ist der je-Besitzer-Weg der richtige).
	 * GM-besessene Aktoren erhalten keine Karte: Die SL nutzt die
	 * Tageskarten-Taste (GM-Fallback). */
	for (const req of hungerRequests) {
		const owners = await getOwnerPlayer(req.actor);
		if (owners.length > 0) {
			game.symbaroum.emit({
				type: 'TravelHungerProbe',
				data: {
					targetUserId: owners[0].id,
					actorId: req.actorId,
					actorName: req.actor.name,
				},
			});
		}
	}

	// 6) Zeitsprung (nur auf Wunsch — der Tageswechsel-Hook hat die Zeit
	//    bereits bewegt, das Makro öffnet den Dialog VOR dem Sprung)
	if (advance) {
		await advanceTravelDays(days);
	}
}

/* ----------------------------------------------------------------
 *  Chat-Karten-Buttons (Tageskarte + Buschwissen-Versorgung)
 * ---------------------------------------------------------------- */

/** Strapazen-/Hunger-/Durst-Probe über die bestehende Wurf-Maschinerie. */
async function rollTravelProbe(actorRef, kind = null) {
	/* v1.5: Akzeptiert Welt-Aktor-ID (Tageskarte) oder Aktor-Instanz
	 * (Anfrage-Karte); Welt-Aktoren werden auf den SZENEN-VERTRETER
	 * aufgelöst, damit Probe UND Malus-Buchung (recordHungerFailure)
	 * bei unverknüpften Spielsteinen token-lokal laufen — konsistent
	 * mit der Token-First-Tagesbuchung (Option A). */
	const actor = typeof actorRef === 'string'
		? resolveSceneRepresentative(game.actors.get(actorRef))
		: actorRef;
	if (!actor) return;
	/* v1.4 (Rudolfs Punkt 5, rekonstruiert 08.11.): Die Hungerprobe
	 * öffnet den Stärke-Würfeldialog MIT Hunger-Kontext — Titel
	 * „Stärke - Hungerprobe“, Kontextzeile vor dem Modifikator und
	 * automatische Stärke-Malus-Buchung bei Misserfolg (dialog.js);
	 * die GM-Taste „Hunger-Probe scheitert“ ist entfallen. Durst-
	 * und Todesmarsch-Proben laufen unverändert ohne Kontext. */
	const ecData = { targetData: { hasTarget: false, leaderTarget: false, actor: {} } };
	if (kind === 'hunger') ecData.travelHungerProbe = true;
	await prepareRollAttribute(actor, 'strong', null, null, ecData);
}

/**
 * v1.4 (Rudolfs Punkt 5): Fehlschlag der täglichen Hunger-Probe — der
 * Stärke-Malus steigt sofort um 1 (automatisch aus der Wurfauswertung
 * in dialog.js, ersetzt die entfallene GM-Taste „Hunger-Probe scheitert“).
 * Hunger-Paket v1 (Rudolfs Option A, 09.11.2026): Der Malus ist ab jetzt
 * IM Stärke-Gesamtwert gebacken (actor.js _computeSecondaryAttributes
 * zieht das Flag direkt ab) — der Tod-Check prüft daher schlicht
 * strong.total <= 0 (nach dem actor.update steht der neue Malus im
 * frisch gerechneten Total; das frühere manuelle Abziehen des Zählers
 * hier hätte doppelt abgezogen). Stärke 0 → SL-Karte „Tod durch
 * Verhungern“ (kein Auto-Tod — die SL entscheidet, Muster
 * applyTravelCardAction).
 */
export async function recordHungerFailure(actor) {
	if (!actor) return;
	const flags = getTravelFlags(actor);
	flags.strengthLoss += 1;
	await actor.update({ 'flags.symbaroum.travel': flags });
	const strongTotal = Number(actor.system?.attributes?.strong?.total) || 0;
	if (strongTotal <= 0) {
		await postSystemCard(F('TRAVEL.CARD_DEATH_HUNGER', { name: actor.name }), actor);
	} else {
		ui.notifications.info(F('TRAVEL.APPLY_STRENGTH_LOSS', { name: actor.name }));
	}
}

/** GM-Anwendung einer Karten-Aktion (kein Auto-Tod — SL entscheidet). */
async function applyTravelCardAction(dataset) {
	const actor = game.actors.get(dataset.actorId);
	if (!actor || !game.user.isGM) return;
	switch (dataset.kind) {
		case 'hungerFail': {
			// v1.4 (Rudolfs Punkt 5): Die Taste ist aus der Tageskarte
			// ENTFALLEN (der Misserfolg bucht sich aus der Wurfaus-
			// wertung selbst, dialog.js → recordHungerFailure). Der
			// Case bleibt als Kompatibilität für Tageskarten, die
			// vor v1.4 im Chat stehen.
			await recordHungerFailure(actor);
			break;
		}
		case 'deathFail': {
			// Fehlschlag der Strapazen-Probe (Todesmarsch): +1W6 Schaden
			const dmgRoll = await new Roll('1d6').evaluate();
			const cur = Number(actor.system?.health?.toughness?.value);
			if (Number.isFinite(cur)) {
				await actor.update({ 'system.health.toughness.value': Math.max(0, cur - dmgRoll.total) });
			}
			await postSystemCard(F('TRAVEL.CARD_DEATH_FAIL', { name: actor.name, dmg: dmgRoll.total }), actor, dmgRoll);
			break;
		}
		case 'accident': {
			// Natürliche 20 auf der Strapazen-Probe (RAW): tödlicher
			// Unfall — Karte, SL entscheidet (kein Auto-Tod)
			await postSystemCard(F('TRAVEL.CARD_ACCIDENT', { name: actor.name }), actor);
			break;
		}
		case 'thirstFail': {
			// Fehlschlag der täglichen Durst-Probe: Tod — Karte, SL
			// entscheidet (kein Auto-Tod, S3-Philosophie)
			await postSystemCard(F('TRAVEL.CARD_DEATH_THIRST', { name: actor.name }), actor);
			break;
		}
		default:
			break;
	}
}

/** Kleine Systemkarte (Muster chatInfoMessage/epilepsy-fit). */
async function postSystemCard(text, actor, roll = null) {
	const content = `<div class="symbaroum chat roll">
		<div class="foreground">
			<h3>${L('TRAVEL.SYSTEM_ALIAS')}</h3>
			${actor ? `<img class="portrait" src="${actor.img}"/>` : ''}
			<p>${text}</p>
			${roll ? `<div class="dice-roll dice-total" data-action="expandRoll"><div class="dice-tooltip">${roll.dice[0]?.results?.map((r) => r.result).join(' + ') ?? roll.total}</div><h4>${roll.total}</h4></div>` : ''}
		</div>
	</div>`;
	await postChat(content, {}, roll ? [createRollData([roll])] : []);
}

/** ChatMessage im Haus-Stil (roll.js-Muster): System-Alias als Sprecher,
 *  aktiver Roll-Modus inkl. Flüster-Zweige, Foundry-applyMode. */
async function postChat(content, flags = {}, rolls = []) {
	const chatData = {
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ alias: L('TRAVEL.SYSTEM_ALIAS') }),
		rolls,
		rollMode: game.settings.get('core', 'messageMode'),
		content,
		flags,
	};
	if (['gm', 'blind'].includes(chatData.rollMode)) {
		chatData.whisper = ChatMessage.getWhisperRecipients('GM');
	} else if (chatData.rollMode === 'self') {
		chatData.whisper = [game.user];
	}
	ChatMessage.applyMode(chatData, 'public');
	await ChatMessage.create(chatData);
}

/* ----------------------------------------------------------------
 *  „Vorräte auffüllen (Buschwissen)" v1.1 (Rudolfs Testrunde): Auswahl-
 *  dialog WELCHES Mitglied würfelt, öffentliche Aufforderungs-Karte
 *  an SC (der Spieler würfelt selbst), NSC-Wurf direkt durch die SL.
 *  Der ERTRAG wird als Rations-Items auf den SUCHER gebucht (Rudolfs
 *  v1.1-Entscheidung; RAW: Gesamtmenge 1W6 unterwegs / 1W10 fokussiert,
 *  nicht je Mitglied) — Verteilung per Geben-Dialog. Ersetzt die v1-
 *  Flag-Gutschrift „Gruppe versorgen (N Tage)" komplett.
 * ---------------------------------------------------------------- */

const BUSHCRAFT_REFERENCE = 'bushcraft';

function findBushcraftBoon(actor) {
	return actor?.items.find((it) => it.type === 'boon' && String(it.system?.reference ?? '') === BUSHCRAFT_REFERENCE) ?? null;
}

/** Auswahldialog: WELCHES Reisegruppe-Mitglied sucht Vorräte. */
export function openSupplyRollRequest(actorIds) {
	if (!game.user.isGM) return;
	const pool = (Array.isArray(actorIds) && actorIds.length > 0 ? actorIds : getTravelGroup().map((a) => a.id))
		.map((id) => game.actors.get(id))
		.filter(Boolean);
	const casters = pool.filter((a) => findBushcraftBoon(a));
	if (casters.length === 0) {
		ui.notifications.info(L('TRAVEL.SUPPLY_NO_CASTER'));
		return;
	}
	if (casters.length === 1) {
		triggerSupplyRoll(casters[0]);
		return;
	}
	const modern = isModernDialogActive();
	const options = casters.map((a) => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`).join('');
	symbDialog({
		title: L('TRAVEL.SUPPLY_SELECT_TITLE'),
		content: `<div class="symbaroum travel-dialog${modern ? ' modern-travel-dialog' : ' dialog'}">
			<p>${L('TRAVEL.SUPPLY_SELECT_TEXT')}</p>
			<div class="m-travel-row"><label for="travelSupplyCaster">${L('TRAVEL.SUPPLY_CASTER_LABEL')}</label><select id="travelSupplyCaster">${options}</select></div>
			<p class="m-travel-note">${L('TRAVEL.SUPPLY_SELECT_HINT')}</p>
		</div>`,
		classes: [...(modern ? modernDialogClasses('modern-travel-dialog') : [])],
		width: 440,
		buttons: {
			roll: {
				icon: '<i class="fas fa-leaf"></i>',
				label: L('TRAVEL.SUPPLY_ROLL_BUTTON'),
				callback: (html) => {
					const id = html?.[0]?.querySelector?.('#travelSupplyCaster')?.value;
					const actor = game.actors.get(id);
					if (actor) triggerSupplyRoll(actor);
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
			},
		},
		default: 'roll',
	});
}

/** Wurf anstoßen: SC erhalten eine öffentliche Aufforderungs-Karte
 *  (klickbar nur für Besitzer/GM), NSC würfelt die SL direkt. */
function triggerSupplyRoll(actor) {
	const boonItem = findBushcraftBoon(actor);
	if (!boonItem) {
		ui.notifications.info(L('TRAVEL.SUPPLY_NO_CASTER'));
		return;
	}
	if (actor.hasPlayerOwner) {
		postSupplyRequestCard(actor, boonItem);
	} else {
		actor.usePower(boonItem);
	}
}

async function postSupplyRequestCard(actor, boonItem) {
	const content = `<div class="symbaroum chat roll travel-day-card">
		<div class="foreground">
			<h3>${L('TRAVEL.SUPPLY_REQUEST_TITLE')}</h3>
			<img class="portrait" src="${actor.img}" alt=""/>
			<p>${F('TRAVEL.SUPPLY_REQUEST_TEXT', { name: actor.name })}</p>
			<button type="button" class="travel-probe-button" data-travel-supply-request="${actor.id}"><i class="fas fa-leaf"></i> ${L('TRAVEL.SUPPLY_REQUEST_BUTTON')}</button>
			<p class="travel-day-footnote">${L('TRAVEL.SUPPLY_REQUEST_HINT')}</p>
		</div>
	</div>`;
	await postChat(content, { 'symbaroum.travelSupplyRequest': { actorId: actor.id, boonItemId: boonItem.id } });
}

/* ----------------------------------------------------------------
 *  Ertrags-Buchung (v1.1): Ziel-Item je Kategorie (Stapelerhöhung am
 *  vorhandenen Rations-Item), Anzahl editierbar, am Ziel persistierende
 *  Kapazität (0 = unbegrenzt; Rudolfs „Wasserschlauch"), Überlauf-
 *  und Belastungsvorschau live.
 * ---------------------------------------------------------------- */

/** Optionale Stapel-Kapazität am Item (system.maxNumber; S4 v1.3:
 *  gepflegt per Stepper im Status-Tab, NICHT mehr im Buchungsdialog). */
function itemCapacity(item) {
	const n = Number(item?.system?.maxNumber);
	return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Verbleibender Platz im Ziel (Infinity = unbegrenzt). S4 v1.3:
 *  Kapazitäts-Items zählen rationCount (nicht die Item-Anzahl). */
function capacityHeadroom(item) {
	const cap = itemCapacity(item);
	if (cap <= 0) return Infinity;
	return Math.max(0, cap - getAvailableRations(item));
}

function categoryLabel(category) {
	return category === 'wasserration'
		? L('RESOURCE_CATEGORY.WATER_RATION')
		: L('RESOURCE_CATEGORY.FOOD_RATION');
}

/** Buchungsdialog des Ertrags am Sucher. */
export function openTravelSupplyBooking(actorId, yieldTotal) {
	if (!game.user.isGM) return;
	const actor = game.actors.get(actorId);
	if (!actor) return;
	const n = Math.max(1, Math.round(Number(yieldTotal) || 1));
	const rows = [];
	for (const category of RATION_CATEGORIES) {
		// v1.3 (Rudolfs Punkt 15 + Kategorie-Regel): Kapazitäts-ESSens-
		// rationen (Wegbrot: 1 Brot = N Teile, backt sich nicht im
		// Wald) sind KEINE Buschwissen-Ziele; einfache Essens-Stapel
		// und ALLE Wasserrationen (auch der auffüllbare Wasserschlauch)
		// bleiben buchbar.
		const items = actor.items.filter(
			(it) =>
				isRationItem(it) &&
				String(it.system.resourceCategory) === category &&
				!(category === 'essensration' && isCapacityRationItem(it))
		);
		if (items.length === 0) {
			rows.push(`<div class="m-travel-sec">${categoryLabel(category)}</div>
			<p class="m-travel-note">${F('TRAVEL.SUPPLY_NO_TARGET', { category: categoryLabel(category), name: actor.name })}</p>`);
			continue;
		}
		const options = items
			.map((it) => {
				// v1.3: Bestand = verfügbare Rationen; Kapazitäts-Ziele
				// (Wasserschlauch) zeigen „x / Kap“ statt „Bestand x“
				const cap = itemCapacity(it);
				return `<option value="${it.id}">${foundry.utils.escapeHTML(it.name)} — ${
					cap > 0 ? F('TRAVEL.SUPPLY_STOCK_CAP', { count: getAvailableRations(it), cap }) : F('TRAVEL.SUPPLY_STOCK', { count: getAvailableRations(it) })
				}</option>`;
			})
			.join('');
		rows.push(`<div class="m-travel-sec">${categoryLabel(category)}</div>
			<div class="m-travel-row">
				<label>${L('TRAVEL.SUPPLY_TARGET_LABEL')}</label>
				<select data-travel-target="${category}">${options}</select>
			</div>
			<div class="m-travel-row">
				<label>${L('TRAVEL.SUPPLY_AMOUNT_LABEL')}</label>
				<input type="number" min="0" step="1" data-travel-amount="${category}" value="${n}">
				<span class="m-travel-note" data-travel-room="${category}"></span>
			</div>`);
	}
	const modern = isModernDialogActive();
	symbDialog({
		title: F('TRAVEL.BOOKING_TITLE', { name: actor.name }),
		content: `<div class="symbaroum travel-dialog${modern ? ' modern-travel-dialog' : ' dialog'}">
			<p>${F('TRAVEL.BOOKING_TEXT', { name: actor.name, count: n })}</p>
			${rows.join('')}
			<div class="m-travel-sec">${L('TRAVEL.BOOKING_LOAD_SEC')}</div>
			<p class="m-travel-note" data-travel-load></p>
			<p class="m-travel-note">${L('TRAVEL.BOOKING_LOAD_HINT')}</p>
		</div>`,
		classes: [...(modern ? modernDialogClasses('modern-travel-dialog') : [])],
		width: 560,
		onRender: (element) => {
			const refresh = () => updateBookingPreview(element, actor);
			for (const el of element?.querySelectorAll?.('[data-travel-target], [data-travel-amount]') ?? []) {
				el.addEventListener('change', refresh);
				el.addEventListener('input', refresh);
			}
			refresh();
		},
		buttons: {
			book: {
				icon: '<i class="fas fa-basket-shopping"></i>',
				label: L('TRAVEL.BOOKING_BUTTON'),
				callback: (html) => submitTravelSupplyBooking(html, actor, n),
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
			},
		},
		default: 'book',
	});
}

/** Eingaben des Buchungsdialog lesen. */
function readBookingInputs(element) {
	const out = {};
	for (const category of RATION_CATEGORIES) {
		const targetSel = element?.querySelector?.(`[data-travel-target="${category}"]`);
		const amountEl = element?.querySelector?.(`[data-travel-amount="${category}"]`);
		if (!targetSel || !amountEl) continue;
		out[category] = {
			itemId: targetSel.value,
			amount: Math.max(0, Math.round(Number(amountEl.value) || 0)),
		};
	}
	return out;
}

/** Live-Vorschau: Platz je Kategorie + Belastungs-Projektion. */
function updateBookingPreview(element, actor) {
	const inputs = readBookingInputs(element);
	let extraGE = 0;
	for (const [category, inp] of Object.entries(inputs)) {
		const item = actor.items.get(inp.itemId);
		if (!item) continue;
		const room = capacityHeadroom(item);
		const booked = Math.min(inp.amount, Number.isFinite(room) ? room : inp.amount);
		const overflow = inp.amount - booked;
		// v1.3: Buchungen auf Kapazitäts-Items füllen rationCount und
		// ändern Item-Anzahl/Gewicht bewusst NICHT (Gewicht/Preis =
		// manuelle Buchhaltung, Rudolfs Wegbrot-Vorgabe) — die Last-
		// Vorschau zählt nur Buchungen auf einfache Stapel.
		extraGE += isCapacityRationItem(item) ? 0 : (getWeightCategory(item.system?.weight).value ?? 0) * booked;
		const roomEl = element?.querySelector?.(`[data-travel-room="${category}"]`);
		if (roomEl) {
			roomEl.textContent = overflow > 0
				? F('TRAVEL.SUPPLY_ROOM_OVERFLOW', { count: room })
				: Number.isFinite(room) ? F('TRAVEL.SUPPLY_ROOM', { count: room }) : L('TRAVEL.SUPPLY_ROOM_INF');
			roomEl.classList.toggle('travel-warn', overflow > 0);
		}
	}
	const enc = getEncumbranceData(actor);
	const loadEl = element?.querySelector?.('[data-travel-load]');
	if (loadEl) {
		if (!enc.enabled) {
			loadEl.textContent = L('TRAVEL.BOOKING_LOAD_OFF');
		} else {
			const projLoad = Math.round((enc.loadGE + extraGE) * 100) / 100;
			const projState = projLoad > enc.hardLimit ? 'over' : projLoad > enc.baseLimit ? 'loaded' : 'ok';
			const stateLabel = projState === 'over' ? L('WEIGHT.STATE_OVER') : projState === 'loaded' ? L('WEIGHT.STATE_LOADED') : L('WEIGHT.STATE_OK');
			loadEl.textContent = F('TRAVEL.BOOKING_LOAD', { now: enc.loadDisplay, after: formatGE(projLoad), extra: formatGE(extraGE), state: stateLabel });
			// Warnfarbe bei Zustands-Verschlechterung durch die Buchung
			const order = ['ok', 'loaded', 'over'];
			loadEl.classList.toggle('travel-warn', order.indexOf(projState) > order.indexOf(enc.state));
		}
	}
}

/** Buchen: Kapazität am Ziel persistieren, Stapel auffüllen, Überlauf
 *  melden, Ergebnis-Karte mit Geben-Knöpfen. */
async function submitTravelSupplyBooking(html, actor, yieldTotal) {
	const element = html?.[0] ?? null;
	if (!element) return;
	const inputs = readBookingInputs(element);
	const booked = [];
	let overflowTotal = 0;
	for (const [category, inp] of Object.entries(inputs)) {
		const item = actor.items.get(inp.itemId);
		if (!item) continue;
		// v1.3: Die Kapazität wohnt seit v1.3 im Blatt (Status-Tab-
		// Stepper) — der Dialog pflegt sie nicht mehr, klemmt aber an
		// sie (capacityHeadroom ist rationCount-bewusst).
		const room = capacityHeadroom(item);
		const take = Math.min(inp.amount, Number.isFinite(room) ? room : inp.amount);
		const overflow = Math.max(0, inp.amount - take);
		overflowTotal += overflow;
		if (take > 0) {
			// v1.3 (Kapazitätsmodell): Kapazitäts-Ziele (z. B. Wasser-
			// schlauch) füllen system.rationCount — die Item-Anzahl
			// bleibt 1 (verkauft/wiegt als 1); einfache Stapel
			// erhöhen die Anzahl wie bisher.
			if (isCapacityRationItem(item)) {
				await item.update({ 'system.rationCount': getRationCount(item) + take });
			} else {
				await item.update({ 'system.number': getItemCount(item) + take });
			}
		}
		if (take > 0 || overflow > 0) {
			booked.push({ item, category, take, overflow });
		}
	}
	if (booked.length === 0) {
		ui.notifications.info(L('TRAVEL.BOOKING_NOTHING'));
		return;
	}
	await postSupplyBookingCard(actor, yieldTotal, booked);
	if (overflowTotal > 0) {
		ui.notifications.warn(F('TRAVEL.BOOKING_OVERFLOW_TOAST', { count: overflowTotal }));
	}
}

/** Ergebnis-Karte: gebuchte Stapel + Geben-Knöpfe (nur GM). */
async function postSupplyBookingCard(actor, yieldTotal, booked) {
	const lines = booked
		.map((b) => {
			const base = b.take > 0 ? F('TRAVEL.BOOKING_CARD_LINE', { count: b.take, item: b.item.name, stock: getAvailableRations(b.item) }) : '';
			const over = b.overflow > 0 ? ` <span class="travel-warn">${F('TRAVEL.BOOKING_CARD_OVERFLOW', { count: b.overflow })}</span>` : '';
			const give = b.take > 0
				? ` <button type="button" class="travel-probe-button" data-travel-give="${b.item.id}" data-travel-giver="${actor.id}"><i class="fas fa-hand-holding"></i> ${L('TRAVEL.BOOKING_GIVE_BUTTON')}</button>`
				: '';
			return `<p>${base}${over}${give}</p>`;
		})
		.join('');
	const content = `<div class="symbaroum chat roll travel-day-card">
		<div class="foreground">
			<h3>${L('TRAVEL.SUPPLY_CARD_TITLE')}</h3>
			<img class="portrait" src="${actor.img}" alt=""/>
			<p>${F('TRAVEL.BOOKING_CARD_TEXT', { name: actor.name, count: yieldTotal })}</p>
			${lines}
			<p class="travel-day-footnote">${L('TRAVEL.BOOKING_CARD_GIVE_HINT')}</p>
		</div>
	</div>`;
	await postChat(content, { 'symbaroum.travelSupplyBooking': { actorId: actor.id } });
}

/** Chat-Ankündigung des Makro-Flips (v1.1, P3): Zustand im Chat-Log
 *  statt nur Toast. */
export async function announceRationTracking({ on = true, masterOn = false, food, water } = {}) {
	if (!game.user.isGM) return;
	const foodOn = food ?? on;
	const waterOn = water ?? on;
	const content = `<div class="symbaroum chat roll">
		<div class="foreground">
			<h3>${L('TRAVEL.SYSTEM_ALIAS')}</h3>
			<p>${foodOn || waterOn ? L('TRAVEL.TRACKING_ON_CHAT') : L('TRAVEL.TRACKING_OFF_CHAT')}</p>
			<p class="m-travel-note">${F('TRAVEL.TRACKING_STATE', { food: foodOn ? '✓' : '✗', water: waterOn ? '✓' : '✗' })}</p>
			${masterOn ? `<p class="m-travel-note">${L('TRAVEL.MASTER_ON_NOTE')}</p>` : ''}
		</div>
	</div>`;
	await postChat(content, {});
}

/* ----------------------------------------------------------------
 *  Runtime-Registrierung (hooks.js ruft setupTravelRuntime im ready;
 *  das Reisegruppen-Kontextmenü separat in registerTravelContextMenu,
 *  das hooks.js bereits IM INIT aufruft — siehe Kommentar dort)
 * ---------------------------------------------------------------- */

/* ----------------------------------------------------------------
 *  S4-Reisegruppen-Fix v1.1 (Root Cause siehe Diagnose R1–R6):
 *  „Reisegruppe: Mitgliedschaft umschalten" erschien nie im Sidebar-
 *  Kontextmenü, weil Foundry V14 das Kontextmenü des Aktor-Verzeich-
 *  nisses EINMALIG beim ersten App-Render aufbaut (DocumentDirectory
 *  _onFirstRender → _createContextMenu → Hook-Dispatch) und die
 *  Einträge in der ContextMenu-Instanz EINGEFROREN werden. Der erste
 *  Sidebar-Render läuft aber VOR dem ready-Hook (initializeUI ruft
 *  ui.sidebar.render asynchron ohne await; ready feuert erst nach
 *  canvas.initializing) — die bisherige Registrierung auf ready kam
 *  damit IMMER zu spät. Fix: Registrierung auf INIT verlegen; L()/
 *  Settings/game.user werden ohnehin erst im Hook-Dispatch zur
 *  Laufzeit gebraucht, i18n ist da längst geladen.
 * ---------------------------------------------------------------- */
export function registerTravelContextMenu() {
	// Mitgliedschafts-Flag per Kontextmenü am Akteure-Verzeichnis
	// (Runde-3-Entscheidung statt Ordner; V13/14-Ersatz für das tote
	// getActorDirectoryEntryContext — Hook-Name verifiziert am
	// Foundry-V14-API-Doc: getDocumentContextOptions, substituiert
	// „Document" → getActorContextOptions; Callback/Condition erhalten
	// das Zeilen-Element, Aktor über dataset.documentId/entryId).
	Hooks.on('getActorContextOptions', (app, menuItems) => {
		menuItems.push({
			name: L('TRAVEL.CONTEXT_TOGGLE'),
			icon: '<i class="fa-solid fa-person-hiking"></i>',
			callback: (li) => {
				li = li instanceof HTMLElement ? li : li[0];
				const actor = game.actors.get(li?.dataset?.documentId ?? li?.dataset?.entryId);
				if (actor) toggleTravelMembership(actor);
			},
			condition: (li) => {
				if (!game.user.isGM || !isTravelEnabled()) return false;
				li = li instanceof HTMLElement ? li : li[0];
				const id = li?.dataset?.documentId ?? li?.dataset?.entryId;
				return !!game.actors.get(id);
			},
		});
	});
}

export async function setupTravelRuntime() {
	// v1.1-Migration: den S4-v1-Sammelschalter EINMALIG auf die zwei
	// getrennten Schalter überführen (rationTracking bleibt als interner
	// Wert erhalten, Bestehende Welten verlieren ihren Zustand nicht)
	try {
		if (!game.settings.get('symbaroum', 'travelSplitMigrated')) {
			if (game.settings.get('symbaroum', 'rationTracking')) {
				await game.settings.set('symbaroum', 'foodTrackingEnabled', true);
				await game.settings.set('symbaroum', 'waterTrackingEnabled', true);
			}
			await game.settings.set('symbaroum', 'travelSplitMigrated', true);
		}
	} catch (err) {}
	// Tageswechsel-Engine: läuft auf JEDEM Client, verarbeitet nur der GM
	Hooks.on('updateWorldTime', (worldTime) => handleWorldTimeUpdate(worldTime));

	// Chat-Karten-Buttons der Tageskarte + Versorgungskarte
	Hooks.on('renderChatMessageHTML', (message, html) => {
		// Probe-Buttons (Stärke-Proben über die bestehende Maschinerie):
		// GM und Blattbesitzer
		const cardData = message.getFlag(FLAG_SCOPE, 'travelCard');
		if (cardData) {
			html.querySelectorAll('[data-travel-probe]').forEach((btn) => {
				btn.addEventListener('click', async () => {
					const actor = game.actors.get(btn.dataset.travelProbe);
					if (!actor) return;
					if (!game.user.isGM && !actor.isOwner) return;
					// v1.4: data-kind (hunger/thirst/march) aus der Tageskarte —
					// nur die Hungerprobe öffnet den Dialog mit Hunger-Kontext.
					await rollTravelProbe(btn.dataset.travelProbe, btn.dataset.kind ?? null);
				});
			});
			// v1.5 (Rudolfs Entscheidung „Fallback nur für GM sichtbar“):
			// Die Hungerprobe-Taste der Tageskarte ist SL-Fallback —
			// Spieler würfeln über ihre EIGENE Anfrage-Karte (je-
			// Besitzer-Muster, siehe TravelHungerProbe in completeTravel-
			// Days). Nicht-GM sehen die Taste nicht (Muster data-
			// travel-apply); Durst/Todesmarsch bleiben besitzer-geget.
			if (!game.user.isGM) {
				html.querySelectorAll('[data-travel-probe][data-kind="hunger"]').forEach((btn) => btn.remove());
			}
			// GM-Anwendungsknöpfe: nur für die SL sichtbar verdrahtet
			if (game.user.isGM) {
				html.querySelectorAll('[data-travel-apply]').forEach((btn) => {
					btn.addEventListener('click', () => applyTravelCardAction(btn.dataset));
				});
			} else {
				html.querySelectorAll('[data-travel-apply]').forEach((btn) => btn.remove());
			}
		}
		// v1.5 (Punkt 2): Je-Besitzer-Anfrage-Karte „Hungerprobe" — der
		// Besitzer würfelt SELBST (Karte gehört ihm, erzeugt auf seinem
		// Client, siehe symbcomms.js TravelHungerProbe). Nach dem Klick
		// verschwindet die Karte KOMPLETT (message.delete, bewusste
		// Ausgestaltung) und der Stärke-Würfeldialog mit Hunger-Kontext
		// öffnet; der Misserfolg buchtet über den Szenen-Vertreter
		// konsistent zur Token-First-Tagesbuchung.
		const hungerRequest = message.getFlag(FLAG_SCOPE, 'travelHungerRequest');
		if (hungerRequest) {
			html.querySelectorAll('[data-travel-hunger-request]').forEach((btn) => {
				btn.addEventListener('click', async () => {
					const world = game.actors.get(hungerRequest.actorId);
					const actor = world ? resolveSceneRepresentative(world) : null;
					if (!actor) return;
					if (!game.user.isGM && !actor.isOwner) return;
					await message.delete();
					await rollTravelProbe(actor, 'hunger');
				});
			});
		}
		// v1.1: Aufforderungs-Karte „Vorräte auffüllen" — klickbar nur
		// für Blattbesitzer und GM (der Spieler würfelt SELBST)
		const request = message.getFlag(FLAG_SCOPE, 'travelSupplyRequest');
		if (request) {
			html.querySelectorAll('[data-travel-supply-request]').forEach((btn) => {
				btn.addEventListener('click', () => {
					const actor = game.actors.get(btn.dataset.travelSupplyRequest);
					const boonItem = actor?.items.get(request.boonItemId) ?? findBushcraftBoon(actor);
					if (!actor || !boonItem) return;
					if (!game.user.isGM && !actor.isOwner) return;
					actor.usePower(boonItem);
				});
				const actor = game.actors.get(btn.dataset.travelSupplyRequest);
				if (!game.user.isGM && !(actor && actor.isOwner)) btn.remove();
			});
		}
		// v1.1: Ertrags-Buchungskarte — Geben-Knöpfe nur für die SL
		if (message.getFlag(FLAG_SCOPE, 'travelSupplyBooking')) {
			const giveBtns = html.querySelectorAll('[data-travel-give]');
			if (game.user.isGM) {
				giveBtns.forEach((btn) => {
					btn.addEventListener('click', () => {
					const actor = game.actors.get(btn.dataset.travelGiver);
					const item = actor?.items.get(btn.dataset.travelGive);
					if (actor && item) openGiveDialog(actor, item);
					});
				});
			} else {
				giveBtns.forEach((btn) => btn.remove());
			}
		}
	});

	// Buschwissen-Ertrag → Buchungsdialog (v1.1: Ertrag als Rations-
	// Items auf den Sucher statt Flag-Gutschrift; boon.js feuert den Hook
	// bei aktivem Master-Setting, bewusst lose gekoppelt — kein Import-
	// Zykel zwischen boon.js und travel.js in DIESER Richtung)
	Hooks.on('symbaroum:bushcraftYield', (data) => {
		if (!isTravelEnabled() || !game.user.isGM) return;
		if (!Number.isFinite(Number(data?.days)) || Number(data?.days) <= 0) return;
		openTravelSupplyBooking(data.actorId, data.days);
	});
}
