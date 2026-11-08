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
import { consumeResource, consumeResourceFromItem } from './resources.js';
import { getEncumbranceData } from './encumbrance.js';
import { hasEnduringMarch } from './boon.js';
import { prepareRollAttribute } from './dialog.js';
import { createRollData } from './roll.js';

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
	// „Rationsverfolgung" (Rudolfs Runde-1-Wortlaut: „für Durst soll
	// ‚Endlose Resourcen' der Standard sein außer ich schalte über ein
	// Makro die Ressourcenverfolgung ein"): Default AUS = endlose
	// Ressourcen (RAW-Wasser-Annahme aus 02.07), Essen UND Wasser
	// gemeinsam (Runde-2-Wortlaut „Essen UND Wasser: ganze
	// Rationsverfolgung an/aus"). Umschaltbar per GM-Makro (macro.js).
	game.settings.register('symbaroum', 'rationTracking', {
		name: 'TRAVEL.SETTING_RATION_TRACKING',
		hint: 'TRAVEL.SETTING_RATION_TRACKING_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
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

/** Effektiver Schalter der Rationsverfolgung (Essen UND Wasser). */
export function isRationTrackingEnabled() {
	try {
		return isTravelEnabled() && !!game.settings.get('symbaroum', 'rationTracking');
	} catch (err) {
		return false;
	}
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

/* ----------------------------------------------------------------
 *  Hunger-/Durst-Zustände (Kap. 5.1: nur wenn Master + Rations-
 *  verfolgung aktiv — mit „Endlosen Ressourcen" laufen die Zähler
 *  bewusst nicht)
 * ---------------------------------------------------------------- */

/** Zustands-Berechnung aus den Zählern. */
export function getTravelState(actor) {
	const f = getTravelFlags(actor);
	const tracking = isRationTrackingEnabled();
	return {
		foodDays: f.foodDays,
		rationDays: f.rationDays,
		waterDays: f.waterDays,
		strengthLoss: f.strengthLoss,
		hunger: tracking && (f.foodDays >= game.symbaroum.config.TRAVEL_HUNGER_DAYS || f.rationDays >= game.symbaroum.config.TRAVEL_RATION_DAYS),
		thirst: tracking && f.waterDays >= game.symbaroum.config.TRAVEL_THIRST_DAYS,
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
 * (Runde-4-Entscheidung: in v1). null, wenn die Reiseregeln aus sind
 * oder kein Zustand aktiv ist — der Chip verschwindet dann komplett
 * (klassische Ansicht bleibt unverändert).
 */
export function getTravelStatusContext(actor) {
	if (!isTravelEnabled() || !actor) return null;
	const st = getTravelState(actor);
	if (!st.hunger && !st.thirst) return null;
	const hungerLabel =
		st.foodDays >= game.symbaroum.config.TRAVEL_HUNGER_DAYS
			? F('TRAVEL.CHIP_HUNGER_STARVING', { days: st.foodDays })
			: F('TRAVEL.CHIP_HUNGER_RATION', { days: st.rationDays });
	return {
		hunger: st.hunger,
		thirst: st.thirst,
		hungerLabel,
		thirstLabel: F('TRAVEL.CHIP_THIRST', { days: st.waterDays }),
		hungerTooltip: F('TRAVEL.CHIP_HUNGER_TOOLTIP', {
			food: st.foodDays,
			ration: st.rationDays,
			loss: st.strengthLoss,
		}),
		thirstTooltip: F('TRAVEL.CHIP_THIRST_TOOLTIP', { days: st.waterDays }),
	};
}

/* ----------------------------------------------------------------
 *  Selbstversorgung der SC (Kap. 5.3, Rudolfs Runde-2-Vorgabe)
 * ---------------------------------------------------------------- */

const RATION_CATEGORIES = ['essensration', 'wasserration'];

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
export async function consumeRationSelfSupply(actor, item) {
	if (!actor || !isRationItem(item)) return;
	const category = String(item.system.resourceCategory);
	const taken = await consumeResourceFromItem(item, 1);
	if (taken <= 0) {
		ui.notifications.warn(L('TRAVEL.SELF_NO_STOCK'));
		return;
	}
	const flags = getTravelFlags(actor);
	if (category === 'wasserration') {
		flags.wateredToday = Math.max(1, flags.wateredToday + 1);
		flags.waterDays = 0;
	} else {
		flags.fedToday = Math.max(1, flags.fedToday + 1);
		flags.foodDays = 0;
		flags.rationDays = 0;
	}
	// Flags schreiben (isMember steckt unverändert in flags — Foundry
	// merged Objekt-Keys unter flags.symbaroum.travel, kein Replace)
	await actor.update({ 'flags.symbaroum.travel': flags });
	ui.notifications.info(F('TRAVEL.SELF_CONSUMED', { name: item.name, actor: actor.name }));
}

/** Kontextmenü „Reise-Status zurücksetzen": eigene Zähler/Vermerke
 *  OHNE Buchung auf 0 (SL-Vertrauen: Rollenspiel-Mahlzeiten, Gruppen-
 *  vorräte außerhalb des Inventars). isMember bleibt stehen. */
export async function resetTravelStatus(actor) {
	if (!actor) return;
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
	const rationTracking = isRationTrackingEnabled();
	const flagged = hasFlaggedMembers();

	// Vorbelegung (Kap. 4.1): Flag-Mitglieder vorabgehakt; ohne Flag-
	// Träger Fallback alle Aktoren mit Spielerbesitz; darüber liegt die
	// persistierte letzte Auswahl (world setting).
	let preselect = [];
	try {
		const saved = JSON.parse(game.settings.get('symbaroum', 'travelLastSelection') || '""');
		if (Array.isArray(saved)) preselect = saved;
	} catch (err) {}
	// ALLE echten Welt-Aktoren sind wählbar — auch NSC-Gefährten als
	// echte Aktoren (Träger/Lasttiere ohne Aktorblatt = S5-Paket);
	// Vorbelegung oben greift nur ohne persistierte Auswahl.
	const candidates = game.actors.contents;
	if (preselect.length === 0) {
		preselect = (flagged ? getTravelGroup() : candidates.filter((a) => a.hasPlayerOwner === true)).map((a) => a.id);
	}
	const rationMode = game.settings.get('symbaroum', 'travelRationMode') === 'half' ? 'half' : 'full';

	const actorRows = candidates
		.map((actor) => {
			const f = getTravelFlags(actor);
			const enc = getEncumbranceData(actor);
			const checked = preselect.includes(actor.id) || f.isMember;
			return { actor, f, enc, checked };
		})
		.filter((r) => r.actor);

	const memberRows = actorRows
		.map((r) => {
			const counterCells = rationTracking
				? `<td class="m-travel-count"><input type="number" min="0" step="1" data-travel-counter="${r.actor.id}-foodDays" value="${r.f.foodDays}"></td>
				<td class="m-travel-count"><input type="number" min="0" step="1" data-travel-counter="${r.actor.id}-rationDays" value="${r.f.rationDays}"></td>
				<td class="m-travel-count"><input type="number" min="0" step="1" data-travel-counter="${r.actor.id}-waterDays" value="${r.f.waterDays}"></td>
				<td class="m-travel-count"><input type="number" min="0" step="1" data-travel-counter="${r.actor.id}-strengthLoss" value="${r.f.strengthLoss}"></td>`
				: '';
			return `<tr>
				<td class="m-travel-name"><label class="m-travel-member"><input type="checkbox" data-travel-member="${r.actor.id}"${r.checked ? ' checked' : ''}> ${foundry.utils.escapeHTML(r.actor.name)}</label>${r.f.isMember ? ` <i class="fas fa-person-hiking" title="${L('TRAVEL.MEMBER_BADGE')}"></i>` : ''}</td>
				${counterCells}
			</tr>`;
		})
		.join('');

	const counterHeads = rationTracking
		? `<th class="m-travel-count">${L('TRAVEL.COUNTER_FOOD')}</th>
			<th class="m-travel-count">${L('TRAVEL.COUNTER_RATION')}</th>
			<th class="m-travel-count">${L('TRAVEL.COUNTER_WATER')}</th>
			<th class="m-travel-count">${L('TRAVEL.COUNTER_STRENGTH')}</th>`
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
		${rationTracking ? `<div class="m-travel-sec">${L('TRAVEL.SECTION_RATIONS')}</div>
		<div class="m-travel-radios">
			<label class="m-travel-radio"><input type="radio" name="travelRation" value="full"${rationMode === 'full' ? ' checked' : ''}> ${L('TRAVEL.RATION_FULL')}</label>
			<label class="m-travel-radio"><input type="radio" name="travelRation" value="half"${rationMode === 'half' ? ' checked' : ''}> ${L('TRAVEL.RATION_HALF')}</label>
		</div>
		<p class="m-travel-note">${L('TRAVEL.RATION_HINT')}</p>` : `<p class="m-travel-note">${L('TRAVEL.RATION_OFF_HINT')}</p>`}
		<div class="m-travel-sec">${L('TRAVEL.SECTION_ROUTE')}</div>
		<div class="m-travel-radios">${modeRadios}</div>
		<div class="m-travel-row">
			<label for="travelPace">${L('TRAVEL.PACE_LABEL')}</label>
			<select id="travelPace">${paceOptions}</select>
			<select id="travelPaceRide" style="display:none;">${ridePaceOptions}</select>
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
				if (march && ride) {
					march.style.display = mode === 'ride' ? 'none' : '';
					ride.style.display = mode === 'ride' ? '' : 'none';
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
					// Vorräte auffüllen (Kap. 4.6): öffnet den BESTEHENDEN
					// Buschwissen-Wurf (S1: Unterwegs 1W6 / Fokussiert
					// 1W10; Orientierungstaste bleibt verfügbar) des
					// ersten angehakten Mitglieds mit dem Segen; der
					// Ertrag löst nach dem Wurf die GM-Karte „Gruppe
					// versorgen (N Tage)" aus (Bestätigungspunkt 1).
					const checkedIds = readCheckedMembers(html);
					const pool = (checkedIds.length > 0 ? checkedIds : getTravelGroup().map((a) => a.id))
						.map((id) => game.actors.get(id))
						.filter(Boolean);
					const caster = pool.find((a) => a.items.some((it) => it.type === 'boon' && String(it.system?.reference ?? '') === 'bushcraft'));
					if (!caster) {
						ui.notifications.info(L('TRAVEL.SUPPLY_NO_CASTER'));
						return;
					}
					const boonItem = caster.items.find((it) => it.type === 'boon' && String(it.system?.reference ?? '') === 'bushcraft');
					caster.usePower(boonItem);
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
	const pace = paceSel?.value ?? 'day';
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
	const rationTracking = isRationTrackingEnabled();
	const cfg = game.symbaroum.config;
	const cardActors = [];

	// Ausdauernder Marsch (Kap. 6): Träger legt KEINE Strapazen-Probe
	// ab (Zäh-Verlust bleibt RAW) und heilt im Gewaltmarsch; ALLE
	// Mitreisenden erhalten eine zweite Chance auf die Strapazen-Probe
	// + Erholungs-Probe im Gewaltmarsch.
	let enduringGroup = false;

	for (const actorId of actorIds) {
		const actor = game.actors.get(actorId);
		if (!actor) continue;
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
			if (rationTracking) {
				if (flags.fedToday > 0) {
					flags.fedToday -= 1;
					flags.foodDays = 0;
					flags.rationDays = 0;
					summary.suppliedFood += 1;
				} else {
					const bookNow = rationMode === 'full' || flags.rationDays % 2 === 0;
					if (bookNow) {
						const result = await consumeResource(actor, 'essensration', 1);
						if (result) {
							summary.food += 1;
							flags.foodDays = 0;
							if (rationMode === 'half') flags.rationDays += 1;
							else flags.rationDays = 0;
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
		// 3) Tempo-Konsequenzen (Kap. 4.4 + A39-Verzahnung)
		const eff = effectivePaceFor(actor, pace);
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
		// 4) Flags einmalig schreiben (isMember bleibt unangetastet)
		await actor.update({ 'flags.symbaroum.travel': flags });
		const st = {
			foodDays: flags.foodDays,
			rationDays: flags.rationDays,
			waterDays: flags.waterDays,
			strengthLoss: flags.strengthLoss,
			hunger: rationTracking && (flags.foodDays >= cfg.TRAVEL_HUNGER_DAYS || flags.rationDays >= cfg.TRAVEL_RATION_DAYS),
			thirst: rationTracking && flags.waterDays >= cfg.TRAVEL_THIRST_DAYS,
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
	}

	// 5) EINE Chat-Karte je Abschluss (Kap. 4.7: Gruppierung bei N Tagen)
	const km = distanceFor(mode, pace, terrain, river) * days;
	const rationLabel = rationTracking ? (rationMode === 'half' ? L('TRAVEL.RATION_HALF') : L('TRAVEL.RATION_FULL')) : L('TRAVEL.RATION_OFF');
	const cardData = {
		days,
		km,
		modeLabel: L(game.symbaroum.config.TRAVEL_MODE[mode]?.label ?? 'TRAVEL.MODE_MARCH'),
		pace,
		paceLabel: L(game.symbaroum.config.TRAVEL_PACE[pace]?.[mode === 'ride' ? 'rideLabel' : 'label'] ?? 'TRAVEL.PACE_DAY'),
		rationTracking,
		rationLabel,
		enduringGroup,
		actors: cardActors,
	};
	const content = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/travel-day.hbs', cardData);
	await postChat(content, { 'symbaroum.travelCard': cardData });

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
async function rollTravelProbe(actorId) {
	const actor = game.actors.get(actorId);
	if (!actor) return;
	await prepareRollAttribute(actor, 'strong', null, null);
}

/** GM-Anwendung einer Karten-Aktion (kein Auto-Tod — SL entscheidet). */
async function applyTravelCardAction(dataset) {
	const actor = game.actors.get(dataset.actorId);
	if (!actor || !game.user.isGM) return;
	switch (dataset.kind) {
		case 'hungerFail': {
			// Fehlschlag der täglichen Hunger-Probe: Stärke −1 (Flag-Helfer);
			// Stärke 0 (Wert inkl. Abzüge) → SL-Karte „Tod durch Verhungern"
			const flags = getTravelFlags(actor);
			flags.strengthLoss += 1;
			await actor.update({ 'flags.symbaroum.travel': flags });
			const strongTotal = Number(actor.system?.attributes?.strong?.total) || 0;
			if (strongTotal - flags.strengthLoss <= 0) {
				await postSystemCard(F('TRAVEL.CARD_DEATH_HUNGER', { name: actor.name }), actor);
			} else {
				ui.notifications.info(F('TRAVEL.APPLY_STRENGTH_LOSS', { name: actor.name }));
			}
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

/** Buschwissen-Ertrag (Bestätigungspunkt 1, Versorgen-Button): GM-Karte
 *  „Gruppe versorgen (N Tage)" — versorgt die Reisegruppe (Mitglieder-
 *  Quelle getTravelGroup) für N Tage, OHNE Item-Materialisierung. */
export async function createTravelSupplyCard(actorId, days) {
	if (!game.user.isGM) return;
	const n = Math.max(1, Math.round(Number(days) || 1));
	const content = `<div class="symbaroum chat roll">
		<div class="foreground">
			<h3>${L('TRAVEL.SUPPLY_CARD_TITLE')}</h3>
			<p>${F('TRAVEL.SUPPLY_CARD_TEXT', { days: n })}</p>
			<button type="button" class="travel-apply-button" data-travel-supply="${n}"><i class="fas fa-basket-shopping"></i> ${F('TRAVEL.SUPPLY_APPLY', { days: n })}</button>
		</div>
	</div>`;
	await postChat(content, { 'symbaroum.travelSupply': { actorId, days: n } });
}

/** GM-Klick auf „Gruppe versorgen (N Tage)": Versorgungs-Vermerke für
 *  die Reisegruppe setzen (fedToday/wateredToday = N Tage, Zähler auf 0). */
async function applyTravelSupply(days) {
	if (!game.user.isGM) return;
	const members = getTravelGroup();
	for (const actor of members) {
		const flags = getTravelFlags(actor);
		flags.fedToday = Math.max(flags.fedToday, days);
		flags.wateredToday = Math.max(flags.wateredToday, days);
		flags.foodDays = 0;
		flags.rationDays = 0;
		flags.waterDays = 0;
		await actor.update({ 'flags.symbaroum.travel': flags });
	}
	ui.notifications.info(F('TRAVEL.SUPPLY_DONE', { days, count: members.length }));
}

/* ----------------------------------------------------------------
 *  Runtime-Registrierung (hooks.js ruft setupTravelRuntime im ready)
 * ---------------------------------------------------------------- */

export function setupTravelRuntime() {
	// Tageswechsel-Engine: läuft auf JEDEM Client, verarbeitet nur der GM
	Hooks.on('updateWorldTime', (worldTime) => handleWorldTimeUpdate(worldTime));

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
					await rollTravelProbe(btn.dataset.travelProbe);
				});
			});
			// GM-Anwendungsknöpfe: nur für die SL sichtbar verdrahtet
			if (game.user.isGM) {
				html.querySelectorAll('[data-travel-apply]').forEach((btn) => {
					btn.addEventListener('click', () => applyTravelCardAction(btn.dataset));
				});
			} else {
				html.querySelectorAll('[data-travel-apply]').forEach((btn) => btn.remove());
			}
		}
		// Buschwissen-Versorgungskarte (GM-Button)
		if (message.getFlag(FLAG_SCOPE, 'travelSupply')) {
			const btn = html.querySelector('[data-travel-supply]');
			if (game.user.isGM) {
				btn?.addEventListener('click', () => applyTravelSupply(Number(btn.dataset.travelSupply) || 1));
			} else if (btn) {
				btn.remove();
			}
		}
	});

	// Buschwissen-Ertrag → Versorgungskarte (boon.js feuert den Hook bei
	// aktivem Master-Setting; bewusst lose gekoppelt — kein Import-Zykel
	// zwischen boon.js und travel.js in DIESER Richtung)
	Hooks.on('symbaroum:bushcraftYield', (data) => {
		if (!isTravelEnabled() || !game.user.isGM) return;
		if (!Number.isFinite(Number(data?.days)) || Number(data?.days) <= 0) return;
		createTravelSupplyCard(data.actorId, data.days);
	});
}
