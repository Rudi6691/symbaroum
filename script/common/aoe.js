/* =====================================================================
 * AoE Stufe 1 + 2 (Freigabe 2a+2b, 09.11.2026; Stufe 1 Startsignal
 * "Leg los" 09.11.2026)
 * ---------------------------------------------------------------------
 * Flächeneffekte nach dem Stufenplan der AOE-Analyserunden v5/v6 (alle
 * Konzept-Entscheidungen getroffen, Auswertung im v6-Doc):
 *
 * Stufe 1: Template-Platzierung aus dem Kraft-Item + Auto-Targeting.
 * Stufe 2a: Wirkungsmodus (augenblicklich | dauerhaft), Betreten-Trigger
 *   (Region-Script-Behavior, TOKEN_ENTER), Auslöse-Taste, Ketten-
 *   Recycling über die bestehende Kraft-Automatik, freie Zonen mit
 *   Elixiere-Pflegeform (Widerstands-Attribut/Schaden/Korruption/
 *   Condition), Zonen-Karte als Bedienzentrum, Dauer in Runden
 *   (Combat-Runde im Kampf, sonst 15 Minuten Weltzeit, Rudolfs
 *   Festlegung v5) mit Enden-Taste.
 * Stufe 2b: Spieler-Platzierung (Setting-Gate + Item-Besitz), Runden-
 *   start-Wirkungen freier Zonen (Schaden/Korruption pro Runde).
 *
 * v2.1 (Rudolfs Testrunde 1 + Freigabe 10.11.2026): Behavior-Typ-Fix
 *   ('executeScript'), Klick-Verdrahtung der Zonen-Karten-Tasten (GM +
 *   platzierender Spieler), lokalisiertes Condition-Dropdown, Augen-
 *   blickliche Zonen als One-Shot-Zonen mit Zonen-Karte (keine Sofort-
 *   wirkung mehr; Korruption mit der Auslösung), Zielwahl einstellbar
 *   (Markierungsreihenfolge/Zonennähe/Szenenreihenfolge), Dispositions-
 *   Filter rein (feindlich nur/freundlich nur, Neutrale nur bei 'Alle'),
 *   manuelle Markierungen überschreiben Filter und Ordnung, Auswahl-
 *   dialog bei Spieler-Kraft-Aktivierung (Zone-Tab wieder GM-only).
 *
 * v2.2 (Rudolfs Testrunde 2 + 4 Detail-Entscheidungen + Freigabe
 *   10.11.2026, Sammel-Fix): der Betreten-Trigger liest das Execute-
 *   Script-Ereignis korrekt aus (Event GROSS, Token via Event.data.token)
 *   und löst zusätzlich EINMAL den Anfangsbestand bei der Platzierung
 *   aus (Entscheidung 1), Aufrechterhalten ist multi-zielfähig
 *   (actor.js usePower, Entscheidung 2), die Zonen-Karte zeigt einen
 *   Auslöse-Vermerk (Runde/Weltzeit, Entscheidung 3), der Auswahl-
 *   dialog gilt jetzt auch für den GM (Entscheidung 4), beide AoE-
 *   Dialoge laufen über symbDialog im modernen Design (P4/P11),
 *   'nearest' sortiert robust (offizielles shape.center bevorzugt,
 *   Array/Collection-sicher, P9), der Combat-Runden-Takt toleriert eine
 *   fehlende scene-Referenz (P13), und die Zielmarkierung bleibt in den
 *   aktiven Zonen-Fenstern auf Token INNERHALB der Zone beschränkt -
 *   reaktives Undo + Warnmeldung (Baustein 9).
 *
 * v2.3 (Rudolfs Testrunde 3 + 4 Entscheidungen + Freigabe 11.11.2026,
 *   Sammel-Fix): P2-Endgültig - die V14-RUNTIME liefert dem Execute-
 *   Script-Behavior das Ereignis als 'event' KLEIN (new AsyncFunction
 *   ("scene","region","behavior","event"), Token in event.data.token);
 *   der offizielle Scene-Regions-Artikel behauptet 'Event' GROSS und ist
 *   damit FALSCH (Runtime-Spiegel verifiziert, execute-script.mjs). Der
 *   Betreten-Trigger gilt jetzt auch für FREIE Zonen (neues Dialogfeld
 *   'Auslösen', Entscheidung 4). P9: Automatische Auslösungen (Betreten,
 *   Anfangsbestand, Rundentakt) nutzen NUR die Zielwahl-Einstellung -
 *   der Markierungs-Override bleibt der manuellen Auslöse-Taste
 *   vorbehalten (Entscheidung 3; executeZonePower markiert die Ziele
 *   und die stehen gebliebenen Markierungen überschoben sonst still
 *   die Ordnung). Kosten analog ohne Zone (Entscheidung 5: Jede Zonen-
 *   Auslösung bucht die Korruption der Kraftkonfiguration; Würfe
 *   bleiben auto wie bisher - Rudolfs Freigabe 'Korruption ohne
 *   Würfeldialog'). Dauer-Timing (Entscheidung 6): Im Kampf baut die
 *   Restdauer am INNITIATIVE-ZUG des Auslösers ab (Sprünge über
 *   Runden verbrauchen nichts mehr); Auslöser nicht im Kampf (auch
 *   freie Zonen ohne Wirker) -> Rundenwechsel wie gehabt. Kettendialog
 *   endet automatisch, wenn alle vorgemerkten Zonen-Ziele durchlaufen
 *   sind (zoneChainTargets in item.js). Effekt-Karten tragen den
 *   Zonen-Namen (Region wird durchgereicht statt des generischen
 *   'Freie Zone platzieren'-Titels). Widerstands-Proben zeigen ihr
 *   Ergebnis auch bei Erfolg (geflüsterte Karte - Weltzeit-Diagnose).
 *   Freie Zone: Modifikator + Gunst-Block (Untersuchen-Dialog-Muster)
 *   zwischen Widerstands-Attribut und Schaden. Auswahldialog-Tasten
 *   vertikal (Brew-Menü-Rezept). Zonen-Karte rutscht bei jedem Update
 *   ans Chat-Ende (timestamp bump). Bei 'Zone beenden' werden die von
 *   der Zone gesetzten Zustände gelöscht (Kraft-Zonen über die
 *   Maintain-Symbol-Verfolgung flagData.caster/ability, freie Zonen
 *   über die mitgeführte Token-Liste).
 *
 * v2.4 (Rudolfs Testrunde 4 + 4 Antworten + Klärungsrunde + Freigabe
 *   11.11.2026, Sammel-Fix): ZONENMODELL - die Aktivierung (Anfangs-
 *   bestand, erstes Betreten oder erste Auslöse-Taste) ist ein VOLLER
 *   Kraftwurf mit STANDARD-WÜRFELDIALOG (Modifikator/Gunst einstellbar,
 *   Bannsiegel-Kategorie-Dialog läuft jetzt auch im Zonen-Pfad VOR dem
 *   Würfeldialog) und bucht die Korruption der Kraftkonfiguration GENAU
 *   EINMAL (je-Ziel-Kosten der Aktivierung inklusive). Der Wirkattributs-
 *   wert + Dialog-Modifikator + Dialog-Gunst wandern als SNAPSHOT in die
 *   Region-Flags - jede Folge-Auslösung (Betreten: NUR der Eintretende;
 *   erneute Auslöse-Taste: die aufgelösten Ziele; Maintain-Runde bei Ja:
 *   ALLE Zonen-Token statt des A23-Symbol-Scans, kostenlos) würfelt die
 *   Ziel-Token automatisch gegen den Snapshot (baseRoll-Resist-Modus,
 *   Anathema-Muster: die Gunst der Zone spiegelt sich als Missgunst des
 *   Tokens). Der Würfeldialog entfällt damit für Folge-Auslösungen
 *   komplett. FREIE Zonen: das Zonenattribut ist 10 - Modifikator (exakt
 *   die Umkehrung der Symbaroum-Widerstandskonvertierung), die Gunst
 *   gehört zur ZONE (gespiegelt auf den Token-Wurf), der Dialog zeigt
 *   den abgeleiteten Zonenattribut-Wert live, und die Ergebnis-Karten
 *   sind jetzt Standard-Ergebniskarten je Ziel ('{Zone} wirkt auf {Ziel +
 *   Icon}' + Probenwerte + Würfelergebnis + Wirkung, öffentlich statt
 *   geflüstert). Kraft-Zonen-Folge-Auslösungen tragen die ZONE als
 *   Karten-Quelle statt des Wirkers. Die Hook-Reihenfolge wurde ge-
 *   dreht: der AoE-Zonen-Tick läuft jetzt VOR dem A29-Maintain-Reminder
 *   (kein Maintain-Dialog mehr nach dem Zonen-Ende). Markierungs-Zonen
 *   (targetOrder=marking + dauerhaft) lösen NICHT automatisch aus
 *   (kein Anfangsbestand, kein Betreten) und markieren nichts vor. Die
 *   Zonen-Karte rutscht via LÖSCHEN+NEU ERSTELLEN ans Chat-Ende (der
 *   v2.3-timestamp-Bump wirkte live nicht - Foundry hält die Ein-
 *   fügereihenfolge der Messages-Collection).
 *
 * Architektur (Foundry V14, code-verifiziert):
 * - Regionen mit flags.core.MeasuredTemplate (Optik der klassischen
 *   Vorlage), Platzierung über canvas.regions.placeRegions().
 * - Script-Behaviors laufen auf ALLEN Clients (offizielle Doku) - die
 *   Zone trägt den Single-GM-Guard direkt im Behavior-Quelltext und
 *   ruft die System-API nur auf dem aktiven GM auf.
 * - Kraft-Zonen lösen die BESTEHENDE Ketten-Automatik aus
 *   (executeZonePower in item.js: Regionstoken als Nutzerziele,
 *   buildRolls; die Ketten iterieren game.user.targets). Daraus folgt:
 *   Auslösungen würfeln wie Ketten-Follow-ups (auto). v2.3 (Rudolfs
 *   Testrunde 3): Die Korruption wird NICHT mehr unterdrückt - jede
 *   Zonen-Auslösung bucht die Korruption der Kraftkonfiguration,
 *   analog zum Wirken ohne Zone ('Wir haben hier nur visuell
 *   dargestellte Wirkungsbereiche der Kräfte').
 * - Freie Zonen (kein Quell-Item): NSC würfeln automatisch, SC erhalten
 *   eine geflüsterte Anfragekarte (Muster S4.2 travel-probe-request)
 *   mit Würfel-Taste; der Wurf + die Wirkung laufen auf dem Client des
 *   besitzenden Spielers (Eigentum am eigenen Aktor, kein GM-Roundtrip).
 * - Runden-Dispatcher: EIN Takt - laufender Combat = Combat-Runde,
 *   sonst 900-Sekunden-Weltzeit (Muster Korruptions-Abbau S4), keine
 *   zweite Uhr. Nur die aktive Szene tickt.
 * =================================================================== */

import { symbDialog } from './symbDialog.js';
import { modernDialogClasses, isModernDialogActive } from './modernSheetConfig.js';
import { baseRoll } from './roll.js';

/* Welt-Settings (Registrierung im init-Hook, hooks.js - direkt unter den
 * Reise-Settings). aoeZonesEnabled: Gate für alles (Default AN,
 * abschaltbar statt opt-in). aoePlayerPlacement: Spieler-Platzierung
 * (2b, Default AUS - GM-only bleibt der Ausgangszustand). Der Weltzeit-
 * Merker aoeLastRoundTime ist technisch (config:false). */
export function registerAoeSettings() {
	game.settings.register('symbaroum', 'aoeZonesEnabled', {
		name: 'AOE.SETTING_ENABLED',
		hint: 'AOE.SETTING_ENABLED_HINT',
		scope: 'world',
		type: Boolean,
		default: true,
		config: true,
		restricted: true,
	});
	game.settings.register('symbaroum', 'aoePlayerPlacement', {
		name: 'AOE.SETTING_PLAYERS',
		hint: 'AOE.SETTING_PLAYERS_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
	});
	game.settings.register('symbaroum', 'aoeLastRoundTime', {
		name: 'AoE last zone round tick',
		hint: 'Technical marker for the 15-minute world-time zone round.',
		scope: 'world',
		type: Number,
		default: 0,
		config: false,
	});
	/* v2.6 (Rudolfs Testrunde 6, P13a): MARKEN-Zähler statt der relativen
	   Restlaufzeit - semantisch floor(Weltzeit/900), initialisiert bei der
	   Hook-Registrierung auf die aktuelle Marke OHNE Tick (kein Sofort-Tick
	   nach F5). 0 = noch nie initialisiert (Welten unter 15 Min Weltzeit
	   ticken erstmals bei Weltzeit 900). */
	game.settings.register('symbaroum', 'aoeLastRoundMark', {
		name: 'AoE last world-time round mark',
		hint: 'Technical marker (15-minute world-time mark) for the zone round tick.',
		scope: 'world',
		type: Number,
		default: 0,
		config: false,
	});
}

/** Setting-Gate für alle AoE-Interaktionen (Blatt-Button + Platzierung). */
export function aoeEnabled() {
	return !!game.settings.get('symbaroum', 'aoeZonesEnabled');
}

/** Spieler-Platzierung aktiv (2b): GM bleibt immer berechtigt. */
export function playerPlacementEnabled() {
	return !!game.settings.get('symbaroum', 'aoePlayerPlacement');
}

/** Darf der aktuelle Nutzer aus diesem Item eine Zone platzieren? */
export function mayPlaceZone(item) {
	if (game.user.isGM) return true;
	return playerPlacementEnabled() && !!item?.isOwner;
}

/**
 * Darf der aktuelle Nutzer diese Laufzeit-Zone bedienen (Zonen-Karten-
 * Tasten)? GM immer; sonst nur der platzierende Spieler bei aktivem
 * Setting (v2.1: Spieler lösen ihre eigenen One-Shot-Zonen über die
 * Auslöse-Taste selbst aus - ihre Markierung ist dann die Zielwahl).
 */
function _mayControlZone(aoe) {
	if (!aoe) return false;
	if (game.user.isGM) return true;
	return playerPlacementEnabled() && !!aoe.userId && aoe.userId === game.user.id;
}

/* ---------------------------------------------------------------------
 * Zonen-Konfiguration (system.areaZone, additives template.json-Feld,
 * bonus-Muster: Template-Schlüssel = System-Unterobjekt)
 *
 * shape ('' = keine Fläche; circle/cone/line/rectangle), size (Felder),
 * targeting (all/enemies/allies), mode (instant/lasting, Default
 * lasting), trigger ('' = nur Auslöse-Taste; 'enter' = zusätzlich
 * automatische Auslösung beim Betreten), duration (Runden; 0 =
 * unbegrenzt - läuft bis zur Enden-Taste). Keine Voreinstellungs-
 * Automatik (Traditionen-Präzedenz) - der Zone-Tab dokumentiert die
 * RAW-Empfehlung als Hinweis.
 * ------------------------------------------------------------------- */
export function getZoneConfig(item) {
	const zone = item?.system?.areaZone ?? {};
	const shape = String(zone.shape ?? '').trim();
	if (!shape) return null;
	const rawSize = Math.round(Number(zone.size));
	const size = Number.isFinite(rawSize) && rawSize >= 1 ? rawSize : 1;
	const rawTargeting = String(zone.targeting ?? '').trim();
	const targeting = ['enemies', 'allies'].includes(rawTargeting) ? rawTargeting : 'all';
	const rawMode = String(zone.mode ?? '').trim();
	const mode = rawMode === 'instant' ? 'instant' : 'lasting';
	const rawTrigger = String(zone.trigger ?? '').trim();
	const trigger = rawTrigger === 'enter' ? 'enter' : '';
	const rawDuration = Math.round(Number(zone.duration));
	const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
	/* v2.1 (Rudolfs Testrunde-1-Entscheidung 2): Zielwahl-Ordnung der
	   automatischen Auslesung - 'marking' = Default, 'nearest' = Zonen-
	   nähe, 'scene' = Szenenreihenfolge. Eigene Markierungen des
	   Auslösens überschreiben die Ordnung (siehe _resolveZoneTargets). */
	const rawOrder = String(zone.targetOrder ?? '').trim();
	const targetOrder = ['nearest', 'scene'].includes(rawOrder) ? rawOrder : 'marking';
	return { shape, size, targeting, mode, trigger, duration, targetOrder };
}

/**
 * Region-Shape-Daten der Konfiguration (Felder × Szenen-Gridgröße in
 * Pixeln - N Felder auf JEDEM Grid, unabhängig von der Kalibrierung).
 * Kegel-Winkel 90 Grad als Hausregel-Default (RAW definiert keinen).
 */
function _buildShapeData(cfg, gridSize) {
	const base = { x: 0, y: 0, rotation: 0 };
	switch (cfg.shape) {
		case 'circle':
			return { ...base, type: 'circle', radius: cfg.size * gridSize };
		case 'cone':
			return { ...base, type: 'cone', radius: cfg.size * gridSize, angle: 90 };
		case 'line':
			// Linien/Wände (Flammenwand & Co.): Länge in Feldern, Breite 1 Feld
			return { ...base, type: 'line', length: cfg.size * gridSize, width: gridSize };
		case 'rectangle':
			return { ...base, type: 'rectangle', width: cfg.size * gridSize, height: cfg.size * gridSize };
		default:
			return null;
	}
}

/** Wirker-Token des Items auflösen (Dispositions-Vergleich des Filters). */
function _resolveCasterToken(item) {
	const actor = item?.actor ?? null;
	if (!actor) return null;
	const active = actor.getActiveTokens?.() ?? [];
	if (!Array.isArray(active) || active.length === 0) return null;
	return active.find((t) => t?.controlled) ?? active[0] ?? null;
}

/**
 * Token der Region sammeln - primär über die Core-Geometrie
 * (RegionDocument.tokens), Fallback über region.testPoint am
 * Token-Mittelpunkt. Versteckte Token bleiben außen vor.
 */
function _collectRegionTokens(region) {
	let tokens = [...(region.tokens ?? [])];
	if (tokens.length === 0 && typeof region.testPoint === 'function') {
		tokens = [];
		for (const placeable of canvas.tokens?.placeables ?? []) {
			const doc = placeable.document;
			if (!doc?.actor) continue;
			const point = { x: placeable.center?.x ?? doc.x, y: placeable.center?.y ?? doc.y, elevation: doc.elevation ?? 0 };
			try {
				if (region.testPoint(point)) tokens.push(doc);
			} catch (error) {
				console.warn('Symbaroum AoE: region.testPoint fallback failed', error);
			}
		}
	}
	return tokens.filter((td) => !!td?.actor && !td?.hidden);
}

/**
 * Zielfilter (targeting) - v2.1 (Rudolfs Testrunde-1-Entscheidung 3):
 * rein dispositional. 'enemies' = nur feindliche Token, 'allies' = nur
 * freundliche; NEUTRALE Token greifen nur beim Filter 'Alle'. Der
 * frühere Wirker-Vergleich (kleiner/größer als) zog neutrale Token auf
 * die falsche Seite. 'all' lässt den Filter weg.
 */
function _filterTargets(tokens, targeting, casterToken) {
	if (targeting === 'all') return tokens;
	if (targeting === 'enemies') {
		return tokens.filter((td) => (td.disposition ?? 0) === CONST.TOKEN_DISPOSITIONS.HOSTILE);
	}
	return tokens.filter((td) => (td.disposition ?? 0) === CONST.TOKEN_DISPOSITIONS.FRIENDLY);
}

/** Minimal-HTML-Escaping für Namen in Karten. */
function _escapeHtml(text) {
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Region nach ID (aktive Szene zuerst, dann alle Szenen - defensiv). */
function _getZoneRegion(regionId, sceneId) {
	const scene = (sceneId ? game.scenes.get(sceneId) : null) ?? game.scenes.viewed ?? null;
	let region = scene?.regions?.get(regionId) ?? null;
	if (!region) {
		for (const sc of game.scenes ?? []) {
			region = sc.regions?.get(regionId) ?? null;
			if (region) break;
		}
	}
	return region?.flags?.symbaroum?.aoe ? region : null;
}

/** Aktive Spielerin/aktiven Spieler mit Besitz am Aktor ermitteln. */
function _ownerUser(actor) {
	if (!actor?.hasPlayerOwner) return null;
	return (
		game.users?.find((u) => u.active && (u.character?.id === actor.id || actor.ownership?.[u.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) ??
		null
	);
}

/* =====================================================================
 * Region-Daten + Script-Behavior (Betreten-Trigger)
 * =================================================================== */

/* Single-GM-Muster (offizielle Foundry-Empfehlung für Execute-Script-
 * Behaviors, die auf allen Clients laufen): nur der aktive GM löst die
 * System-API aus.
 * v2.3-ENDGÜLTIGER Fix (Rudolfs Testrunde 3, P2): die V14-RUNTIME baut
 * den Execute-Script-Scope als
 *   new AsyncFunction("scene", "region", "behavior", "event", source)
 * auf - das Ereignis heißt 'event' KLEIN und das Token steckt in
 * event.data.token (RegionTokenEnterExitEventData). Der offizielle
 * Scene-Regions-Artikel behauptet 'Event' GROSS mit Event.data.token
 * und ist damit FALSCH (Runtime-Spiegel verifiziert: execute-script.mjs).
 * Der v2.2-Versuch (Event GROSS + Makro-Fallbacks) las den Browser-
 * DOM-Global 'Event' (Konstruktor ohne data.token) und brach still ab.
 * Defensive Kette: event klein zuerst (event?.data?.token), dann
 * event?.token als Festival-Alternative, zuletzt der Makro-Fallback
 * 'token' (füllt NUR das Execute-MACRO-Behavior, schadet hier nicht). */
const ZONE_ENTER_BEHAVIOR_SOURCE = [
	'if (!game.users.activeGM?.isSelf) return;',
	'const r = (typeof region !== "undefined") ? region : null;',
	'const ev = (typeof event !== "undefined") ? event : null;',
	/* v2.5 (Rudolfs Testrunde 5, P16-Root-Cause): Foundry feuert TOKEN_ENTER
	   auch, wenn das Behavior AKTIV wird (Region-Platzierung) - dann steht
	   moved === false im Event (nur echte BEWEGUNG hat moved === true,
	   Foundry-Issue #10518 / CONST.REGION_EVENTS-Doku). Ohne diesen Check
	   feuert die Zone beim Platzieren fuer jede bereits STEHENDE Token
	   ein zweites Mal (v2.4-Befund: 3 Wuerfeldialoge + 3x Korruption
	   bei 2 stehenden Zielen, v2.3-Befund: die 4x/2x/2x-Mehrfachproben). */
	'if (ev?.data?.moved === false) return;',
	'const mk = (typeof token !== "undefined") ? token : null;',
	'const t = ev?.data?.token ?? ev?.token ?? mk ?? null;',
	'const rid = r?.id ?? r?.document?.id ?? null;',
	'const tid = t?.document?.id ?? t?.id ?? null;',
	'if (!rid || !tid) return;',
	'game.symbaroum.api?.aoeZoneEnter?.(rid, tid);',
].join('\n');

/**
 * Gemeinsamer Region-Datenbau für Kraft- und freie Zonen.
 * @param {object} zone  Laufzeit-Flag-Inhalt (flags.symbaroum.aoe)
 */
function _zoneRegionData(zone) {
	const gridSize = Math.max(1, Math.round(canvas.scene.grid?.size ?? 0)) || 100;
	const shape = _buildShapeData(zone.config, gridSize);
	if (!shape) return null;
	const regionData = {
		name: zone.regionName,
		color: game.user.color,
		displayMeasurements: true,
		highlightMode: 'coverage',
		shapes: [shape],
		visibility: CONST.REGION_VISIBILITY.ALWAYS,
		'flags.core.MeasuredTemplate': true,
		flags: { symbaroum: { aoe: zone } },
	};
	// Betreten-Trigger (dauerhafte Zonen): Script-Behavior mit TOKEN_ENTER.
	// v2.1-Fix (Rudolfs Testrunde 1): der V14-RegionBehavior-Typ heißt
	// 'executeScript' - 'script' ist keine gültige Typ-Kennung und ließ
	// die Datamodel-Validierung die GESAMTE Region scheitern.
	// v2.3 (Rudolfs Entscheidung 4): FREIE Zonen mit dem neuen Dialogfeld
	// 'Auslösen: Beim Betreten' bekommen dasselbe Behavior (vorher schloss
	// die Bedingung zone.free aus - der Betreten-Auslöser war für freie
	// Zonen nie vorgesehen, Rudolfs Testrunde 3 meldete das als fehlend).
	// v2.4 (Rudolfs Testrunde 4, Entscheidung f): MARKIERUNGS-Zonen
	// (targetOrder=marking + dauerhaft) bekommen KEIN Behavior - sie
	// lösen grundsätzlich nicht automatisch aus (kein Anfangsbestand,
	// kein Betreten), damit die Markierungsreihenfolge erst festgelegt
	// werden kann; wirksam ist nur die Auslöse-Taste.
	if (zone.mode === 'lasting' && zone.trigger === 'enter' && zone.config?.targetOrder !== 'marking') {
		regionData.behaviors = [
			{
				type: 'executeScript',
				system: { source: ZONE_ENTER_BEHAVIOR_SOURCE, events: [CONST.REGION_EVENTS.TOKEN_ENTER] },
			},
		];
	}
	if (canvas.level) regionData.levels = [canvas.level.id];
	return regionData;
}

/* =====================================================================
 * Zonen-Karte (persistentes Bedienzentrum, nur dauerhafte Zonen)
 * =================================================================== */

/** Karten-Kontext einer Zone (RenderTemplate-Daten). */
/** Lokalisiertes Label einer Condition-Id (StatusEffects tragen i18n-Keys). */
function _conditionLabel(conditionId) {
	const fx = CONFIG.statusEffects.find((e) => e.id === conditionId);
	if (!fx) return conditionId;
	return game.i18n.localize(fx.label ?? fx.name ?? conditionId);
}

async function _zoneCardContext(region) {
	const aoe = region.flags.symbaroum.aoe;
	const cfg = aoe.config;
	const localize = (key) => game.i18n.localize(key);
	const shapeLabelKey = {
		circle: 'AOE.SHAPE_CIRCLE',
		cone: 'AOE.SHAPE_CONE',
		line: 'AOE.SHAPE_LINE',
		rectangle: 'AOE.SHAPE_RECT',
	}[cfg.shape];
	const areaText = game.i18n.format('AOE.CHAT_AREA', {
		shape: localize(shapeLabelKey ?? 'AOE.SHAPE_NONE'),
		size: cfg.size,
		meters: cfg.size * 2,
	});
	const tokens = _filterTargets(_collectRegionTokens(region), cfg.targeting, _casterTokenOfZone(aoe));
	const tokensText =
		tokens.length > 0
			? game.i18n.format('AOE.CHAT_TARGETS', { targets: tokens.map((td) => _escapeHtml(td.actor?.name ?? td.name ?? '')).join(', ') })
			: localize('AOE.CHAT_NO_TARGETS');
	const isInstant = aoe.mode === 'instant';
	// One-Shot-Zonen (v2.1, Rudolfs Entscheidung 1) haben keine Restdauer
	const durationText = isInstant
		? ''
		: aoe.remaining === null || aoe.remaining === 0
			? localize('AOE.DURATION_UNLIMITED')
			: game.i18n.format('AOE.DURATION_REMAINING', { rounds: aoe.remaining });
	let effectText = '';
	if (aoe.free && aoe.effect) {
		const parts = [];
		const eff = aoe.effect;
		if (eff.resistAttribute) parts.push(game.i18n.format('AOE.EFFECT_PROBE', { attr: localize(`ATTRIBUTE.${eff.resistAttribute.toUpperCase()}`) }));
		if (eff.damage) parts.push(game.i18n.format('AOE.EFFECT_DAMAGE', { formula: eff.damage }));
		if (eff.damagePerRound) parts.push(game.i18n.format('AOE.EFFECT_DAMAGE_ROUND', { formula: eff.damagePerRound }));
		if (eff.corruption) parts.push(game.i18n.format('AOE.EFFECT_CORRUPTION', { formula: eff.corruption }));
		if (eff.condition) parts.push(game.i18n.format('AOE.EFFECT_CONDITION', { condition: _conditionLabel(eff.condition) }));
		effectText = parts.join(' · ');
	}
	// v2.2 (Rudolfs Entscheidung 3): Vermerk der letzten Auslösung
	const triggeredText = aoe.lastTriggered ? _lastTriggeredText(aoe.lastTriggered) : '';
	/* v2.5 (Rudolfs Testrunde 5, Punkte 12a + 15): Auslöser-Zeile (Name
	   des Wirkers aus den Flags - auch wenn der GM ausführt) und
	   Aktiviert-Zustand (nach der Aktivierung verschwindet die
	   „Auslösen"-Taste, nur „Zone beenden" bleibt). */
	const casterActor = aoe.sourceActorUuid ? fromUuidSync(aoe.sourceActorUuid) : null;
	const casterText = casterActor?.name
		? game.i18n.format('AOE.CASTER_LINE', { name: _escapeHtml(casterActor.name) })
		: '';
	return {
		regionId: region.id,
		sceneId: region.parent?.id,
		name: _escapeHtml(aoe.regionName),
		modeText: localize(isInstant ? 'AOE.MODE_INSTANT' : 'AOE.MODE_LASTING'),
		areaText,
		durationText,
		tokensText,
		effectText,
		triggeredText,
		casterText,
		isActivated: !!aoe.activated,
		isInstant,
		showRound: !!(aoe.free && !isInstant && aoe.effect && (aoe.effect.damagePerRound || aoe.effect.corruptionPerRound)),
	};
}

/** Wirker-Token-Dokument einer Zone aus den Flags auflösen. */
function _casterTokenOfZone(aoe) {
	const uuid = aoe?.casterTokenUuid;
	if (!uuid) return null;
	return fromUuidSync(uuid) ?? null;
}

/**
 * Auslöse-Vermerk (v2.2, Rudolfs Entscheidung 3): im Kampf „Runde X",
 * sonst die Spielwelt-Uhrzeit (HH:MM) zum Auslösezeitpunkt.
 */
function _lastTriggeredText(trig) {
	if (!trig) return '';
	if (Number(trig.round) > 0) {
		return game.i18n.format('AOE.TRIGGERED_ROUND', { round: trig.round });
	}
	const seconds = Math.max(0, Math.round(Number(trig.worldTime) || 0));
	const day = 86400;
	const clock = ((seconds % day) + day) % day;
	const hh = String(Math.floor(clock / 3600)).padStart(2, '0');
	const mm = String(Math.floor((clock % 3600) / 60)).padStart(2, '0');
	return game.i18n.format('AOE.TRIGGERED_WORLD', { time: `${hh}:${mm}` });
}

/** Zonen-Karte anlegen (One-Shot- und dauerhafte Zonen; Muster: ChatMessage mit Flag). */
async function _postZoneCard(region) {
	const context = await _zoneCardContext(region);
	const content = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/aoe-zone-card.hbs', context);
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize('DIALOG.SYSTEM_MESSAGE') }),
		content,
		flags: { symbaroum: { aoeZoneCard: { regionId: region.id, sceneId: region.parent?.id } } },
	});
}

/** Alle offenen Zonen-Karten der Region aktualisieren (Inhalt neu rendern).
 *  v2.3 (Rudolfs Testrunde 3): message.update mit neuem timestamp - ein
 *  reines Content-Update ließ Foundry die Karte an ihrer ALTEN Chat-
 *  Position stehen (Update fand statt, war aber nur schwer auffindbar);
 *  der timestamp-Bump sortiert die aktualisierte Karte ans Chat-Ende.
 *  v2.4 (Rudolfs Testrunde 4, Punkt 12 - ROT): Der timestamp-Bump wirkt
 *  LIVE NICHT - Foundry hält die Einfügereihenfolge der Messages-Collec-
 *  tion, message.update mit neuem timestamp ändert nur den Dokumentwert
 *  (sprang erst nach Reload). Die Karte wird deshalb GE LÖSCHT und NEU
 *  ERSTELLT: die neue ChatMessage landet am Chat-Ende, die Flags bleiben
 *  identisch. Lösch-Reihenfolge zuerst: Schlägt das Löschen fehl (z. B.
 *  Spieler-Client darf eine GM-Karte nicht löschen), bleibt die alte
 *  Karte stehen und es entsteht keine Doppel-Karte. */
async function _updateZoneCards(region) {
	/* v2.5 (Testrunde 5, zu 16): je Region serialisiert - konkurrierende
	   Delete+Recreate-Läufe (Mehrfach-Aktivierung) erzeugten den
	   „ChatMessage does not exist"-Socket-Fehler. */
	const previous = _zoneCardQueue.get(region.id) ?? Promise.resolve();
	const run = previous.catch(() => {}).then(() => _updateZoneCardsNow(region));
	_zoneCardQueue.set(region.id, run.catch(() => {}));
	await run;
}

async function _updateZoneCardsNow(region) {
	const context = await _zoneCardContext(region);
	const content = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/aoe-zone-card.hbs', context);
	const sceneId = region.parent?.id;
	for (const message of [...(game.messages ?? [])]) {
		const card = message.flags?.symbaroum?.aoeZoneCard;
		if (card?.regionId === region.id && (card.sceneId === sceneId || !card.sceneId)) {
			try {
				await message.delete();
			} catch (error) {
				// keine Lösch-Rechte an dieser Karte: alten Stand belassen
				continue;
			}
			await ChatMessage.create({
				speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize('DIALOG.SYSTEM_MESSAGE') }),
				content,
				flags: { symbaroum: { aoeZoneCard: { regionId: region.id, sceneId } } },
			});
		}
	}
}

/** Zonen-Karten nach dem Ende der Zone still deaktivieren. */
async function _settleZoneCards(region, endText) {
	const sceneId = region.parent?.id;
	/* v2.5 (Rudolfs Testrunde 5, Punkt 15): die Ende-Karte nennt den
	   AUSLÖSER der Zone mit Namen (auch wenn der GM beendet) - die Zone
	   führt ihn in ihren Flags mit. */
	const casterActor = region.flags?.symbaroum?.aoe?.sourceActorUuid ? fromUuidSync(region.flags.symbaroum.aoe.sourceActorUuid) : null;
	const casterLine =
		casterActor?.name
			? `<div class="aoe-card-detail">${_escapeHtml(game.i18n.format('AOE.CASTER_LINE', { name: casterActor.name }))}</div>`
			: '';
	for (const message of game.messages ?? []) {
		const card = message.flags?.symbaroum?.aoeZoneCard;
		if (card?.regionId === region.id && (card.sceneId === sceneId || !card.sceneId)) {
			await message.update({ content: `<div class="symbaroum aoe-card"><div class="aoe-card-line"><i class="fas fa-draw-polygon"></i><b>${_escapeHtml(region.name)}</b></div><div class="aoe-card-detail">${_escapeHtml(endText)}</div>${casterLine}</div>` });
		}
	}
}

/* =====================================================================
 * Auslösung: Kraft-Zone (Ketten-Recycling) und freie Zone (Proben)
 * =================================================================== */

/**
 * Erste Fläche einer Region, Array/Collection-sicher. v2.2-Fix (Rudolfs
 * Testrunde 2, P9): RegionDocument#shapes kann je nach Core-Stand als
 * Array ODER als Collection vorliegen - der frühere Direktzugriff
 * shapes[0] war im Collection-Fall undefined und die 'nearest'-Sortierung
 * fiel still weg (Szenenreihenfolge statt Zonennähe).
 */
function _firstRegionShape(region) {
	const shapes = region?.shapes;
	if (!shapes) return null;
	if (Array.isArray(shapes)) return shapes[0] ?? null;
	// Collection (contents-Array wie foundry.utils.Collection)
	if (Array.isArray(shapes.contents)) return shapes.contents[0] ?? null;
	// generische Iterablen (Map/Set/Collection): erstes Element
	if (typeof shapes?.[Symbol.iterator] === 'function') {
		for (const shape of shapes) return shape ?? null;
	}
	return null;
}

/**
 * Mittelpunkt der ersten Fläche (Ordnungs-Hilfe für 'nearest').
 * v2.2 (P9): bevorzugt die offizielle Geometrie-Eigenschaft center der
 * Shape-Datenmodelle (BaseShapeData#center, V14) und fällt auf die
 * manuelle Berechnung zurück (x/y = Ursprung; Rechteck-Origin ist die
 * Ecke, Kreis/Kegel tragen das Zentrum in x/y).
 */
function _regionCenter(region) {
	const shape = _firstRegionShape(region);
	if (!shape) return null;
	const center = shape.center;
	if (center && Number.isFinite(center.x) && Number.isFinite(center.y)) {
		return { x: center.x, y: center.y };
	}
	let x = shape.x ?? shape.c?.x ?? 0;
	let y = shape.y ?? shape.c?.y ?? 0;
	if (shape.type === 'rectangle') {
		x += (shape.width ?? shape.c?.width ?? 0) / 2;
		y += (shape.height ?? shape.c?.height ?? 0) / 2;
	}
	return { x, y };
}

/** Distanz Token-Mitte zu einem Punkt ('nearest'-Ordnung). */
function _tokenDistance(tokenDoc, center) {
	const c = tokenDoc.object?.center ?? { x: tokenDoc.x ?? 0, y: tokenDoc.y ?? 0 };
	return Math.hypot((c.x ?? 0) - (center.x ?? 0), (c.y ?? 0) - (center.y ?? 0));
}

/**
 * Zielauswahl einer Auslösung (v2.1, Rudolfs Testrunde-1-Entscheidungen
 * 2 + 4): Eigene Markierungen des Auslösers GEWINNEN - sie überstehen
 * den Zielgruppen-Filter und geben die Reihenfolge vor (zuerst markiertes
 * Ziel = Primärziel, die Ketten iterieren game.user.targets genau so).
 * Ohne eigene Markierung: Auto-Auswahl über den Filter, geordnet nach
 * der Zielwahl-Einstellung der Zone ('nearest' = Zonennähe; 'marking'
 * und 'scene' = Szenenreihenfolge wie gesammelt).
 * v2.3 (Rudolfs Testrunde 3, P9 + Entscheidung 3): Bei AUTOMATISCHEN
 * Auslösungen (Betreten-Trigger, Anfangsbestand) wird der Markierungs-
 * Override ÜBERSPRUNG ({ auto: true }) - executeZonePower markiert die
 * Zonen-Ziele per setTarget und räumt sie nicht ab; stehen gebliebene
 * Markierungen hätten sonst die konfigurierte Zielwahl still über-
 * schrieben. Der Override gilt weiterhin für die MANUELLE Auslöse-Taste.
 */
function _resolveZoneTargets(region, aoe, { auto = false } = {}) {
	const regionTokens = _collectRegionTokens(region);
	const regionIds = new Set(regionTokens.map((td) => td.id));
	if (!auto) {
		const userTargets = Array.from(game.user.targets)
			.map((t) => t.document)
			.filter((td) => regionIds.has(td.id));
		if (userTargets.length > 0) return userTargets;
	}
	const tokens = _filterTargets(regionTokens, aoe.config.targeting, _casterTokenOfZone(aoe));
	return _sortZoneTokens(region, tokens);
}

/**
 * Zielwahl-Sortierung einer Zone (v2.5, Rudolfs Testrunde 5, P5-Kommentar
 * + Entscheidung 1): 'nearest' sortiert nach Distanz zum Zonenmittelpunkt
 * (aufsteigend) - jetzt als gemeinsamer Helper fuer ALLE Ausfuehrungs-
 * pfade (Anfangsbestand/Ausloesung via _resolveZoneTargets, Maintain-
 * Runde, Folge-Proben), vorher sortierte nur der Trigger-Pfad und die
 * Maintain-Runde lief in Szenenreihenfolge los ("hat zwei Mal mit dem
 * entferntesten Token begonnen").
 */
function _sortZoneTokens(region, tokens) {
	const aoe = region?.flags?.symbaroum?.aoe;
	if (aoe?.config?.targetOrder === 'nearest') {
		const center = _regionCenter(region);
		if (center) {
			return [...tokens].sort((a, b) => _tokenDistance(a, center) - _tokenDistance(b, center));
		}
	}
	return tokens;
}

/**
 * Zonen-Auslösung ausführen (GM oder platzierender Spieler; automatisch
 * via Script-Behavior oder manuell über die Auslöse-Taste der Zonen-
 * Karte). One-Shot-Zonen (augenblicklich, v2.1-Entscheidung 1) wirken
 * einmal und verschwinden danach.
 * @param {RegionDocument} region
 * @param {object} [options] { manual: boolean }
 */
async function _executeZoneTrigger(region, { manual = false, enteringTokenId = null } = {}) {
	const aoe = region.flags?.symbaroum?.aoe;
	if (!aoe) return;
	/* v2.5 (Rudolfs Testrunde 5, P16): In-Flight-Guard - waehrend der
	   AKTIVIERUNGSDIALOG offen ist, keine zweite Ausloesung derselben
	   Region stapeln (jede wuerde einen eigenen Dialog + 1x Korruption
	   buchen). Nach 5 Minuten ohne Aktivierungs-Abschluss gilt der
	   Eintrag als verwaist (Dialog abgebrochen) und raeumt sich selbst. */
	const inFlightSince = _zoneActivationInFlight.get(region.id);
	if (inFlightSince !== undefined) {
		if (Date.now() - inFlightSince > 5 * 60 * 1000) _zoneActivationInFlight.delete(region.id);
		else return;
	}
	/* v2.4 (Rudolfs Testrunde 4, Zonenmodell): BETRETEN trifft NUR den
	   Eintretenden - die frühere Voll-Auslösung über ALLE Zonen-Token
	   je Betreten (inkl. Korruption je Auslösung + Kettendialog, Wurzel
	   der 4x/2x-Mehrfachproben aus der Testrunde 4) entfällt. */
	const tokens =
		enteringTokenId !== null
			? [region.parent?.tokens?.get(enteringTokenId)].filter((td) => !!td?.actor && !td.hidden)
			: _resolveZoneTargets(region, aoe, { auto: !manual });
	if (tokens.length === 0) {
		if (manual) {
			ui.notifications.info(game.i18n.localize('AOE.ERR_NO_TOKENS'));
		}
		return;
	}
	/* v2.2 (Baustein 9, Rudolfs Freigabe 10.11.): während der Ausführung
	   einer DAUERHAFTEN Zone gilt die Ziel-Beschränkung für den Auslöser
	   - nur Token innerhalb der Zone sind anwählbar (reaktives Undo +
	   Warnung, siehe targetToken-Hook). Einmal-Zonen sind über ihre
	   GESAMTE Standzeit beschränkt (Fenster offen ab der Platzierung,
	   siehe placeZoneFromItem, und wird erst mit dem Zonen-Ende
	   geschlossen). */
	const enforceWindow = aoe.mode !== 'instant';
	if (enforceWindow) _openTargetWindow(region);
	try {
		if (aoe.free) {
			await _runFreeZone(region, tokens);
		} else {
			await _runPowerZone(region, tokens);
		}
	} finally {
		if (enforceWindow) _closeTargetWindow(region.id);
	}
	/* v2.2 (Rudolfs Entscheidung 3): Auslöse-Vermerk - im Kampf die
	   Combat-Runde, sonst die Weltzeit (Karte zeigt beides als
	   „zuletzt ausgelöst: ..." über _lastTriggeredText). */
	aoe.lastTriggered = {
		round: game.combat?.active && game.combat.round > 0 ? game.combat.round : 0,
		worldTime: Math.round(game.time?.worldTime ?? 0),
	};
	await region.setFlag('symbaroum', 'aoe', aoe);
	/* v2.4: One-Shot-Zonen enden NICHT mehr sofort hier - die Aktivierung
	   läuft über den Standard-Würfeldialog (async), das Ende übernimmt
	   buildRolls/captureZoneActivationSnapshot (endAfter), sobald der
	   Wurf wirklich gemacht wurde; ein Dialog-Abbruch lässt die Zone
	   für einen neuen Auslöse-Versuch stehen. */
}

/** Kraft-Zone: Aktivierung (voller Wurf mit Würfeldialog, Korruption 1x)
 *  oder Folge-Auslösung (Snapshot-Proben je Ziel, kostenlos). */
async function _runPowerZone(region, tokens) {
	const aoe = region.flags.symbaroum.aoe;
	const { executeZonePower } = await import('./item.js');
	const item = aoe.sourceItemUuid ? (await fromUuid(aoe.sourceItemUuid)) : null;
	const actor = aoe.sourceActorUuid ? (await fromUuid(aoe.sourceActorUuid)) : null;
	if (!item || !actor) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_SOURCE_GONE'));
		return;
	}
	if (!aoe.activated) {
		/* v2.4 (Rudolfs Testrunde 4, Entscheidung a): AKTIVIERUNG = voller
		   Kraftwurf MIT Standard-Würfeldialog (Modifikator/Gunst), Korruption
		   1x nach Kraftregeln (je-Ziel-Kosten dieser Auslösung inklusive);
		   der Bannsiegel-Kategorie-Dialog läuft im Zonen-Pfad jetzt VOR
		   dem Würfeldialog (Entscheidung i). Danach ist die Instanz
		   aktiviert: jede Folge-Auslösung würfelt gegen den Snapshot,
		   kostenlos (Entscheidung b). */
		/* v2.5 (Testrunde 5, P16): In-Flight-Marke setzen - der Dialog
		   laeuft asynchron, bis zum Abschluss (aoeZoneActivationCompleted
		   aus captureZoneActivationSnapshot) keine weitere Ausloesung. */
		_zoneActivationInFlight.set(region.id, Date.now());
		await executeZonePower(actor, item, tokens, {
			suppressCorruption: false,
			zoneActivation: { regionId: region.id, sceneId: region.parent?.id, endAfter: aoe.mode === 'instant' },
		});
		return;
	}
	await _runPowerZoneProbes(region, actor, item, tokens, { maintainRound: false });
}

/**
 * Folge-Auslösungen einer aktivierten Kraft-Zone (v2.4, Rudolfs Testrunde
 * 4, Entscheidung b): jeder Ziel-Token würfelt automatisch gegen den
 * Aktivierungs-Snapshot (Wirkattributswert + Modifikator + Gunst), keine
 * Korruption, kein Kettendialog (die Kette endet über zoneChainTargets
 * nach dem Ziel). Bei der Maintain-Runde (Entscheidung c) widerstehen
 * ALLE Zonen-Token (Zonen-Scan statt A23-Symbol-Scan) - ein erfolgreicher
 * Widerstand entfernt die Maintain-Symbole des Kraft-Autors vom Token.
 */
async function _runPowerZoneProbes(region, actor, item, tokens, { maintainRound = false } = {}) {
	const { executeZonePower } = await import('./item.js');
	const aoe = region.flags.symbaroum.aoe;
	const specificStuff = actor.system?.combat?.combatMods?.abilities?.[item.id] ?? {};
	const resistAttribute = specificStuff.targetResistAttribute ?? null;
	const snapshot = aoe.snapshot ?? null;
	/* v2.5 (Rudolfs Testrunde 5, 12a): die bei der AKTIVIERUNG gewaehlte
	   Bannsiegel-Kategorie (Monsterkategorie) gehoert zum Aktivierungs-
	   Snapshot - ohne das Restore an jede Folge-Ausloesung waere der
	   Kategorie-Filter der Kraft wirkungslos ("alle Token muessen
	   widerstehen"). */
	const zoneExtras = snapshot?.sealCategoryId ? { sealCategoryId: snapshot.sealCategoryId } : null;
	/* v2.6 (Rudolfs Testrunde 6, P11a + Rudolfs Entscheidung „Caster als
	   Karten-Aktor"): Folge-Auslösungen zeigen den AUSLÖSER als Wirkenden
	   (Name + Porträt) statt der Zone - die Aktivierungskarte zeigte den
	   Wirker, die Maintain/Betreten-Karten liefen auf den Regionsnamen
	   („{Kraft} [GM]"), der Auslöser verschwand hinter dem GM-Namen.
	   Die Zone bleibt über den Regionsnamen (jetzt mit Auslöser-Namen)
	   auf der Karte benannt. */
	const zoneSourceName = actor?.name ?? region.name;
	const zoneSourceImg = actor?.img ?? null;
	for (const tokenDoc of tokens) {
		const tokenActor = tokenDoc.actor;
		if (!tokenActor) continue;
		/* v2.6 (Testrunde 6, P7, Rudolfs Entscheidung „A36V-Manuell-
		   Verhalten konsistent"): Novize + Fehlkategorie = Warnung +
		   Skip schon VOR der Snapshot-Probe (kein Test, keine Karte,
		   keine Wirkung) - Adept/Master würfeln weiter (Kartenschaden,
		   kein Bann; sealPrimaryMismatch setzt der Primär-Check in
		   executeZonePower). Ohne gewählte Kategorie bleibt der Check
		   aus (SL-Buchhaltung, A36V). */
		if (
			item?.system?.reference === 'banishingseal' &&
			zoneExtras?.sealCategoryId &&
			Number(item?.getLevel?.()?.level ?? 1) <= 1 &&
			game.symbaroum.config.getCreatureCategory(tokenActor) !== zoneExtras.sealCategoryId
		) {
			ui.notifications.warn(game.i18n.format('POWER_BANISHINGSEAL.WARN_CATEGORY_NOVICE', { targetname: tokenActor.name }));
			continue;
		}
		/* Kein Snapshot bzw. keine Probe konfiguriert (z. B. unwider-
		   stehliche Kräfte): Wirkung direkt, weiterhin ohne Kosten. */
		if (!snapshot || !snapshot.attributeName || !resistAttribute || specificStuff.notResisted) {
			await executeZonePower(actor, item, [tokenDoc], { suppressCorruption: true, zoneSourceName, zoneSourceImg, zoneApplyDirect: true, zoneExtras });
			continue;
		}
		/* Snapshot-Probe im Resist-Modus (Anathema-Muster A24-F2): der
		   Ziel-Token würfelt sein Widerstands-Attribut gegen den
		   SNAPSHOTTETEN Wirkattributswert der Zone; baseRoll spiegelt
		   Modifikator und Gunst automatisch (Resist-Modus negiert beide
		   - die Gunst der Zone wird zur Missgunst des Tokens, konsistent
		   mit Rudolfs Freie-Zonen-Entscheidung zur Gunst-Spiegelung). */
		const rollData = [
			await baseRoll(_zoneSnapshotActor(region, snapshot), snapshot.attributeName, tokenActor, resistAttribute, snapshot.favour, snapshot.modifier, true),
		];
		if (rollData[0].trueActorSucceeded) {
			/* Die Zone setzt sich durch: Wirkung über die Kraft-Automatik,
			   AUSLÖSER als Karten-Quelle (v2.6, Rudolfs Entscheidung). */
			await executeZonePower(actor, item, [tokenDoc], { suppressCorruption: true, zoneSourceName, zoneSourceImg, presetRollData: rollData, zoneExtras });
		} else {
			await _postZoneProbeResistCard(region, tokenDoc, snapshot, resistAttribute, rollData[0], actor);
			if (maintainRound) await _removeZoneSymbols(region, actor, item, tokenDoc);
		}
	}
}

/**
 * Pseudo-Aktor des Aktivierungs-Snapshots (Anathema-Muster A24-F2): ein
 * Aktor-Hüllobjekt, dessen einziges Attribut den snapshotteten Wirk-
 * attributswert trägt - baseRoll liest total/label daraus, die Karte
 * zeigt „{Attribut} ({Zonenname})".
 */
function _zoneSnapshotActor(region, snapshot) {
	const label = game.i18n.localize(`ATTRIBUTE.${String(snapshot.attributeName).toUpperCase()}`);
	return {
		system: {
			attributes: {
				[snapshot.attributeName]: {
					total: Number(snapshot.attributeValue) || 10,
					label: `${label} (${_escapeHtml(region.name)})`,
				},
			},
		},
	};
}

/** Maintain-Symbole DIESES Kraft-Autors von einem Token entfernen (erfolg-
 *  reicher Widerstand in der Maintain-Runde; Muster _endZone). */
async function _removeZoneSymbols(region, actor, item, tokenDoc) {
	const abilityRef = item?.reference ?? null;
	if (!actor || !abilityRef) return;
	const cfg = actor.system?.combat?.combatMods?.abilities?.[item.id] ?? {};
	const effects = [...(cfg.addTargetEffect ?? []), ...(cfg.activelyMaintainedTargetEffect ?? [])];
	const target = tokenDoc.actor;
	if (!target?.hasCondition) return;
	for (const effect of effects) {
		const existing = target.hasCondition(effect.id);
		const flagData = existing?.getFlag?.(game.system.id, 'flagData');
		if (existing && flagData?.caster === actor.id && flagData?.ability === abilityRef) {
			try {
				await target.removeCondition(effect.id);
			} catch (error) {
				console.warn('Symbaroum AoE: removeCondition on resist failed', error);
			}
		}
	}
}

/**
 * Freie Zone: Wirkung je Token - ohne Probe direkt, mit Widerstands-
 * Attribut: NSC automatisch (Zonenattribut-Probe, 20 widersteht immer,
 * 1 Patzer), SC mit Besitzer über geflüsterte Anfragekarte (Muster
 * S4.2; der Spieler würfelt selbst und die Wirkung läuft auf seinem
 * Client am eigenen Aktor - Rudolfs v5-Entscheidung 1). Ergebnis-Karten
 * sind seit v2.4 Standard-Ergebniskarten je Ziel (öffentlich).
 */
async function _runFreeZone(region, tokens) {
	const aoe = region.flags.symbaroum.aoe;
	const eff = aoe.effect ?? {};
	const resistOn = !!eff.resistAttribute;
	for (const tokenDoc of tokens) {
		const actor = tokenDoc.actor;
		if (!actor) continue;
		if (!resistOn) {
			await _applyFreeZoneEffect(region, tokenDoc, eff, null);
			continue;
		}
		const owner = _ownerUser(actor);
		if (owner && game.settings.get('symbaroum', 'playerResistButton')) {
			await _freeZoneRequestCard(region, tokenDoc, owner, eff);
		} else {
			await _freeZoneResistProbe(region, tokenDoc, eff);
		}
	}
}

/**
 * Gemeinsame Widerstands-Probe einer freien Zone gegen EINEN Token
 * (Auto-Takt, Betreten, Spieler-Würfel-Taste) + Ergebnis-Zweig.
 * v2.4 (Rudolfs Klärungsrunde): Das ZONENATTRIBUT ist 10 - Modifikator
 * (exakt die Umkehrung der Symbaroum-Widerstandskonvertierung „Wider-
 * standsmodifikator = 10 - Widerstandsattribut"); der Token würfelt
 * d20 <= Widerstands-Total + (10 - Zonenattribut). Die GUNST gehört
 * zur ZONE und spiegelt sich auf den Token-Wurf (Gunst 1 der Zone =
 * Token würfelt 2d20kh, Missgunst -1 = 2d20kl). Karte: „Zonenattribut
 * (Wert) <- Widerstands-Attribut (Wert)".
 */
async function _freeZoneResistProbe(region, tokenDoc, eff, applyEff = null) {
	const probe = await _probeZoneOnToken(tokenDoc.actor, eff.resistAttribute, {
		zoneAttribute: 10 - (Number(eff.modifier) || 0),
		zoneFavour: Number(eff.favour) || 0,
	});
	const probeText = _zoneProbeText(probe.zoneAttribute, eff.resistAttribute, probe.resistValue);
	const rollText = _zoneRollText(probe.result, probe.target, probe.success);
	if (probe.success) {
		await _postZoneResultCard(region, tokenDoc, { probeText, rollText, outcomeLines: [] });
	} else {
		/* applyEff: Rundentakt wendet nur die Runden-Wirkungen an
		   (Schaden/Korruption pro Runde), Erstauslösung/Betreten die
		   volle Wirkung (auch einmaligen Schaden + Condition). */
		await _applyFreeZoneEffect(region, tokenDoc, applyEff ?? eff, { probeText, rollText });
	}
}

/** Probenzeile „Zonenattribut ({Wert}) <- {Attribut} ({Wert})". */
function _zoneProbeText(zoneAttribute, resistAttribute, resistValue) {
	return game.i18n.format('AOE.CHAT_PROBE_LINE', {
		zone: zoneAttribute,
		attr: game.i18n.localize(`ATTRIBUTE.${String(resistAttribute).toUpperCase()}`),
		value: resistValue,
	});
}

/** Wurfzeile mit W20-Span (System-Optik) und Ergebnis-Label. */
function _zoneRollText(result, target, success) {
	const css = success ? 'normal' : 'failure';
	const roll = `<span class="symba-rolls roll d20 ${css}">${result}</span>`;
	return (
		game.i18n.format('AOE.CHAT_ROLL_LINE', { roll, target }) +
		' – ' +
		game.i18n.localize(success ? 'AOE.CHAT_RESIST_OK' : 'AOE.CHAT_RESIST_LOST')
	);
}

/**
 * Automatische Widerstands-Probe eines Tokens gegen eine Zone (freie
 * Zonen; d20, 1/Patzer misslingt, 20 gelingt immer). v2.4: Zonenattribut-
 * Semantik statt direktem Modifikator auf das Attribut-Total (mathe-
 * matisch identisch) - die Gunst der Zone SPIEGELT sich (2d20kh/kl
 * vertauscht gegenüber v2.3).
 */
async function _probeZoneOnToken(actor, attributeName, { zoneAttribute = 10, zoneFavour = 0 } = {}) {
	const base = Number(actor.system?.attributes?.[attributeName]?.total);
	const resistValue = Number.isFinite(base) ? base : 10;
	const zoneAttr = Number(zoneAttribute) || 10;
	const target = resistValue + (10 - zoneAttr);
	const dice = zoneFavour === 1 ? '2d20kh' : zoneFavour === -1 ? '2d20kl' : '1d20';
	const roll = await new Roll(dice).evaluate();
	const result = roll.total;
	let success;
	if (result === 20) success = true;
	else if (result === 1) success = false;
	else success = result <= target;
	return { success, result, target, zoneAttribute: zoneAttr, resistValue };
}

/**
 * Wirkung einer freien Zone anwenden (Schaden/Korruption/Condition) -
 * Applikationsmuster aus standardPowerResult: Toughness-Update, temporale
 * Korruption + Schwellenprüfung (checkCorruptionThreshold), Condition via
 * actor.addCondition, Schmerz ("prone") bei Schaden über der Schmerz-
 * schwelle. Bekannte Grenze (dokumentiert): Schadensreduktionen (Untote/
 * Schwarm) greifen hier nicht - die SL passt notfalls manuell an.
 * Läuft bewusst auf dem Client des Ausführenden (GM oder besitzender
 * Spieler) - beide dürfen den Ziel-Aktor aktualisieren.
 */
async function _applyFreeZoneEffect(region, tokenDoc, eff, cardLines = null) {
	const actor = tokenDoc.actor;
	const applied = [];
	let damageTotal = 0;
	if (eff.damage) {
		try {
			const damageRoll = await new Roll(eff.damage).evaluate();
			damageTotal = damageRoll.total ?? 0;
			const toughness = actor.system?.health?.toughness;
			if (damageTotal > 0 && toughness) {
				await actor.update({ 'system.health.toughness.value': Math.max(0, Number(toughness.value ?? 0) - damageTotal) });
				applied.push(game.i18n.format('AOE.EFFECT_DAMAGE', { formula: `${eff.damage} (${damageTotal})` }));
				if (damageTotal > Number(toughness.threshold ?? 0)) {
					await actor.addCondition('prone');
					applied.push(game.i18n.localize('AOE.EFFECT_PAIN'));
				}
			}
		} catch (error) {
			console.warn('Symbaroum AoE: damage formula failed', error);
		}
	}
	if (eff.corruption) {
		try {
			const corruptionRoll = await new Roll(eff.corruption).evaluate();
			const value = corruptionRoll.total ?? 0;
			if (value > 0) {
				const { checkCorruptionThreshold } = await import('./item.js');
				const current = Number(actor.system?.health?.corruption?.temporary ?? 0);
				await actor.update({ 'system.health.corruption.temporary': current + value });
				await checkCorruptionThreshold(actor, value);
				applied.push(game.i18n.format('AOE.EFFECT_CORRUPTION', { formula: `${eff.corruption} (${value})` }));
			}
		} catch (error) {
			console.warn('Symbaroum AoE: corruption formula failed', error);
		}
	}
	if (eff.condition) {
		try {
			await actor.addCondition(eff.condition);
			/* v2.3 (Rudolfs Testrunde 3): die von der Zone gesetzte
			   Condition mit Token-Id in den Region-Flags MITFÜHREN -
			   'Zone beenden' löscht sie automatisch wieder (freie
			   Zonen; Kraft-Zonen laufen über die Maintain-Symbol-
			   Verfolgung in _endZone). */
			if (region?.flags?.symbaroum?.aoe) {
				const aoe = region.flags.symbaroum.aoe;
				aoe.appliedConditionTokens = { ...(aoe.appliedConditionTokens ?? {}), [tokenDoc.id]: eff.condition };
				await region.setFlag('symbaroum', 'aoe', aoe);
			}
			applied.push(game.i18n.format('AOE.EFFECT_CONDITION', { condition: _conditionLabel(eff.condition) }));
		} catch (error) {
			console.warn('Symbaroum AoE: condition failed', error);
		}
	}
	if (applied.length === 0) applied.push(game.i18n.localize('AOE.EFFECT_NONE'));
	/* v2.4 (Rudolfs Testrunde 4, Punkt 9): Standard-Ergebniskarte je Ziel
	   statt der geflüsterten Mini-Karte - Titel „{Zone} wirkt auf {Ziel +
	   Icon}", dann Probenwerte, Würfelergebnis, Wirkung (öffentlich). */
	await _postZoneResultCard(region, tokenDoc, {
		probeText: cardLines?.probeText ?? '',
		rollText: cardLines?.rollText ?? '',
		outcomeLines: applied,
	});
}

/**
 * Standard-Ergebniskarte je Ziel (v2.4, Rudolfs Testrunde 4, Punkt 9 +
 * neuer Punkt; Template aoe-zone-result-card.hbs): Titel „{Zone} wirkt
 * auf {Ziel + Icon}", darunter Probenwerte, Würfelergebnis und Wirkung.
 * Öffentliche Karte (Standard-Verhalten der Ergebnis-Karten, keine
 * Flüster-Karte mehr).
 * v2.5 (Rudolfs Testrunde 5, P9-Kommentar + Rudolfs Entscheidung 3): die
 * Karte läuft in der GROSSEN Optik der Kraft-Ergebniskarten (Struktur
 * template/chat/ability.hbs: introImg-Header mit Auslöser-Aktor + Icon,
 * targetText, subText, finalTxt-Blöcke) - die ZONE ist der Auslöser-
 * Aktor, als Header-Icon führt sie ein Polygon-Glyph in der Zonenfarbe
 * mit (freie Zonen haben kein Item-Bild). Gilt für freie Zonen UND die
 * Widerstands-Karten der Kraft-Zonen-Folge-Auslösungen (einheitliches
 * Kartenbild: Wirkung = Standard-Kraftkarte, Widerstand = diese Karte).
 */
async function _postZoneResultCard(region, tokenDoc, { probeText = '', rollText = '', outcomeLines = [], actorName = null, actorImg = null } = {}) {
	const targetName = tokenDoc?.actor?.name ?? tokenDoc?.name ?? '';
	/* v2.6 (Rudolfs Testrunde 6, P11a, Entscheidung „Caster als Karten-
	   Akteur"): Kraft-Zonen-Folge-Karten (Betreten/Maintain) zeigen den
	   AUSLÖSER als Titel-Aktor (Name + Porträt statt Zonen-Glyph); ohne
	   Override (freie Zonen, P13 grün) bleibt die Zone der Akteur. Die
	   Zone bleibt in beiden Fällen als subText benannt. */
	const titleText = game.i18n.format('AOE.CHAT_ZONE_TITLE', {
		zone: _escapeHtml(actorName ?? region?.name ?? ''),
		target: _escapeHtml(targetName),
	});
	const context = {
		titleText,
		targetImg: tokenDoc?.texture?.src ?? tokenDoc?.actor?.img ?? '',
		probeText,
		rollText,
		outcomeLines,
		zoneName: _escapeHtml(region?.name ?? ''),
		zoneImg: actorImg ?? _zoneGlyphDataUri(region),
	};
	const content = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/aoe-zone-result-card.hbs', context);
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize('DIALOG.SYSTEM_MESSAGE') }),
		content,
	});
}

/**
 * Header-Glyph der Zone (v2.5): Polygon-SVG in der Zonenfarbe als Daten-
 * URI - die große Ergebnis-Karte zeigt die Zone als Auslöser-Aktor mit
 * eigenem Icon (freie Zonen haben kein Item-Bild).
 */
function _zoneGlyphDataUri(region) {
	const color = region?.color ?? '#7aa2c4';
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><polygon points='32,4 60,22 50,60 14,60 4,22' fill='${color}' fill-opacity='0.9'/><circle cx='32' cy='30' r='10' fill='#ffffff' fill-opacity='0.35'/></svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Widerstands-Karte einer Kraft-Zonen-Folge-Auslösung (Snapshot-Probe
 * des Ziel-Tokens misslingt der Zone - der Token widersteht). Dieselbe
 * Standard-Ergebniskarte; das Würfelergebnis kommt aus dem baseRoll-
 * Resist-Modus (rollData), die Probenzeile zeigt das effektive Zonen-
 * attribut (Snapshot-Wirkattributswert + Dialog-Modifikator).
 */
async function _postZoneProbeResistCard(region, tokenDoc, snapshot, resistAttribute, rollData, actor = null) {
	/* baseRoll-Resist-Modus: doBaseRoll läuft aus der Perspektive des
	   VERTEIDIGERS - actingAttributeValue = Widerstands-Total des
	   Tokens, diceTarget = dessen Zielschwelle, trueActorSucceeded =
	   false bedeutet: der Token hat widerstanden. */
	const zoneAttribute = (Number(snapshot.attributeValue) || 10) + (Number(snapshot.modifier) || 0);
	const resistValue = Number.isFinite(Number(rollData?.actingAttributeValue)) ? Number(rollData.actingAttributeValue) : 10;
	const probeText = _zoneProbeText(zoneAttribute, resistAttribute, resistValue);
	const rollText = _zoneRollText(Number(rollData?.diceResult ?? 0), Number(rollData?.diceTarget ?? 10), rollData?.trueActorSucceeded === false);
	/* v2.6 (P11a): AUSLÖSER als Karten-Aktor (Name + Porträt) statt
	   Zonen-Glyph - die Zone bleibt als subText benannt. */
	await _postZoneResultCard(region, tokenDoc, { probeText, rollText, outcomeLines: [], actorName: actor?.name ?? null, actorImg: actor?.img ?? null });
}

/**
 * Anfragekarte an den besitzenden Spieler (Muster S4.2 travel-probe-
 * request): geflüsterte Karte mit Würfel-Taste; der Klick würfelt auf
 * dem Client des Spielers und wendet die Wirkung am eigenen Aktor an.
 */
async function _freeZoneRequestCard(region, tokenDoc, owner, eff) {
	const attrKey = `ATTRIBUTE.${eff.resistAttribute.toUpperCase()}`;
	const content = `<div class="symbaroum chat travel-day-card aoe-resist-request">
\t<div class="foreground">
\t\t<h4>${game.i18n.format('AOE.CHAT_RESIST_REQUEST', {
		zone: _escapeHtml(region.name),
		attr: game.i18n.localize(attrKey),
		name: _escapeHtml(tokenDoc.actor?.name ?? tokenDoc.name ?? ''),
	})}</h4>
\t\t<p><button type="button" class="travel-probe-button" data-aoe-resist-scene="${region.parent?.id}" data-aoe-resist-region="${region.id}" data-aoe-resist-token="${tokenDoc.id}"><i class="fas fa-dice"></i> ${game.i18n.localize('AOE.BUTTON_RESIST')}</button></p>
\t</div>
</div>`;
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize('DIALOG.SYSTEM_MESSAGE') }),
		whisper: [owner.id, game.user.id],
		content,
	});
}

/* =====================================================================
 * Dauer-Dispatcher (Combat-Runde im Kampf, sonst 900 s Weltzeit)
 * =================================================================== */

const _lastCombatRound = new Map();

/* v2.5 (Rudolfs Testrunde 5, P16): In-Flight-Guard der Zonen-AKTIVIERUNG.
   Der Standard-Wuerfeldialog ist asynchron - waehrend er offen ist, ist
   aoe.activated noch nicht gesetzt, und eine zweite Ausloesung (z. B.
   ein hineinlaufendes Token) wuerde eine ZWEITE Aktivierung mit eigenem
   Dialog + erneuter Korruption stapeln. Ausloesungen derselben Region
   werden deshalb bis zum Abschluss der Aktivierung uebersprungen
   (Freigabe durch aoeZoneActivationCompleted, siehe unten). Nach 5 Min
   ohne Abschluss gilt der Eintrag als verwaist (Dialog abgebrochen) und
   wird stillgerecht ignoriert. Nur Client-lokal: die Aktivierung laeuft
   auf dem Client des Ausloesers, Betreten-Events auf dem GM - bei
   Spieler platzierten Zonen bleibt der GM-Seite der Guard verborgen
   (dokumentierte Grenze, seltener Doppel-Aktivierungs-Fall). */
const _zoneActivationInFlight = new Map();

/* v2.5 (Rudolfs Testrunde 5, zu 16): Serialisierung der Zonen-Karten-
   Updates. Konkurrierende Delete+Recreate-Läufe derselben Region
   (Mehrfach-Aktivierung aus Testrunde 5) liessen einen Client eine
   bereits geloeschte ChatMessage fetchen ("ChatMessage ... does not
   exist"). Jede Region aktualisiert ihre Karte jetzt strikt nacheinander. */
const _zoneCardQueue = new Map();

/**
 * Runden-Tick aller Zonen der aktiven Szene (GM-seitig): Rundenwirkungen
 * freier Zonen anwenden, Restdauer dekrementieren, abgelaufene Zonen
 * beenden. Wird vom Combat-Hook (Rundenwechsel) und vom Weltzeit-Hook
 * (900-Sekunden-Schritte ohne laufenden Combat) getrieben - ein Takt,
 * keine zweite Uhr (Rudolfs v5-Entscheidung 4).
 */
export async function aoeRoundTick(source) {
	if (!game.user?.isGM || !aoeEnabled()) return;
	const scene = game.scenes.viewed;
	if (!scene) return;
	const zones = [...(scene.regions ?? [])].filter((r) => !!r.flags?.symbaroum?.aoe && r.flags.symbaroum.aoe.mode !== 'instant');
	for (const region of zones) {
		try {
			await _tickZone(region, source);
		} catch (error) {
			console.warn('Symbaroum AoE: zone tick failed', error);
		}
	}
}

async function _tickZone(region, source) {
	const aoe = region.flags.symbaroum.aoe;
	// Rundenwirkung (freie Zonen, 2b): Schaden/Korruption pro Runde auf
	// alle erfassten Token - mit Widerstands-Attribut als Probe (auto),
	// ohne als Direktwirkung. Anfragekarten im Rundentakt wären Spam -
	// bewusste Abweichung, dokumentiert.
	if (aoe.free && aoe.effect) {
		const eff = aoe.effect;
		if (eff.damagePerRound || eff.corruptionPerRound) {
			const casterToken = _casterTokenOfZone(aoe);
			const tokens = _filterTargets(_collectRegionTokens(region), aoe.config.targeting, casterToken);
			for (const tokenDoc of tokens) {
				const actor = tokenDoc.actor;
				if (!actor) continue;
				if (eff.resistAttribute) {
					/* v2.4: Zonenattribut-Probe + Standard-Ergebniskarte je
					   Ziel (auch bei Erfolg); misslungene Proben wenden im
					   Rundentakt NUR die Runden-Wirkungen an (kein einmaliger
					   Schaden, keine Condition - wie v2.3). */
					const roundEff = { damage: eff.damagePerRound ?? '', corruption: eff.corruptionPerRound ?? '', condition: '' };
					await _freeZoneResistProbe(region, tokenDoc, eff, roundEff);
					continue;
				}
				await _applyFreeZoneEffect(region, tokenDoc, { damage: eff.damagePerRound ?? '', corruption: eff.corruptionPerRound ?? '', condition: '' }, null);
			}
		}
	}
	// Restdauer: null/0 = unbegrenzt (läuft bis zur Enden-Taste)
	/* v2.6 (Rudolfs Testrunde 6, P10): die Zonen-Karte wird jetzt bei
	   JEDEM Runden-Tick aktualisiert (Delete+Recreate ans Chat-Ende) -
	   auch für UNBEGRENZTE Zonen (Restdauer 0/null): vorher lief das
	   frühe Return VOR dem Karten-Update, die Karte stand still (Runde-
	   Taste, Kampf-Tick und Weltzeit-Tick). Der Auslöse-Vermerk zählt
	   den Tick als Runden-Aktualisierung (Kampf = Runde, sonst Weltzeit). */
	aoe.lastTriggered = {
		round: game.combat?.active && game.combat.round > 0 ? game.combat.round : 0,
		worldTime: Math.round(game.time?.worldTime ?? 0),
	};
	if (aoe.remaining === null || aoe.remaining === 0) {
		await region.setFlag('symbaroum', 'aoe', aoe);
		await _updateZoneCards(region);
		return;
	}
	aoe.remaining = Math.max(0, aoe.remaining - 1);
	if (aoe.remaining === 0) {
		await _endZone(region, source);
		return;
	}
	await region.setFlag('symbaroum', 'aoe', aoe);
	await _updateZoneCards(region);
}

/* =====================================================================
 * Öffentliche Zonen-API (Behavior, Zonen-Karte, Makro)
 * ===================================================================== */

/** Script-Behavior-Einstieg (TOKEN_ENTER, Single-GM): automatische Auslösung.
 *  v2.3: gilt für Kraft-Zonen UND freie Zonen mit 'Auslösen: Beim Betreten'.
 *  v2.4 (Rudolfs Testrunde 4, Entscheidungen b+f): Betreten trifft NUR den
 *  Eintretenden - Kraft-Zonen aktivieren beim ERSTEN Betreten mit vollem
 *  Würfeldialog + Korruption (falls noch nicht aktiviert) und würfeln danach
 *  gegen den Snapshot; freie Zonen würfeln die Zonenattribut-Probe. KEINE
 *  Voll-Auslösung über alle Zonen-Token mehr. Markierungs-Zonen (Kraft)
 *  lösen grundsätzlich nicht automatisch aus. */
export async function aoeZoneEnter(regionId, tokenId) {
	if (!game.user?.isGM || !aoeEnabled()) return;
	const region = _getZoneRegion(regionId);
	if (!region) return;
	// nur Zonen mit Betreten-Trigger lösen automatisch aus
	const aoe = region.flags.symbaroum.aoe;
	if (aoe.trigger !== 'enter' || aoe.mode === 'instant') return;
	// v2.4 (Entscheidung f): Markierungs-Zonen nie automatisch
	if (!aoe.free && aoe.config?.targetOrder === 'marking') return;
	const tokenDoc = region.parent?.tokens?.get(tokenId) ?? null;
	if (!tokenDoc?.actor || tokenDoc.hidden) return;
	// Zielgruppen-Check vor dem Auslösen (Dispositions-Filter gegen Wirker)
	const filtered = _filterTargets([tokenDoc], aoe.config.targeting, _casterTokenOfZone(aoe));
	if (filtered.length === 0) return;
	await _executeZoneTrigger(region, { manual: false, enteringTokenId: tokenId });
	// v2.2: Karte nach der Auto-Auslösung aktualisieren (Auslöse-Vermerk)
	await _updateZoneCards(region);
}

/** Auslöse-Taste der Zonen-Karte (manuelle Auslösung; GM oder Zone-Besitzer). */
export async function aoeTriggerZone(regionId, sceneId) {
	if (!aoeEnabled()) return;
	const region = _getZoneRegion(regionId, sceneId);
	if (!region || !_mayControlZone(region.flags?.symbaroum?.aoe)) return;
	await _executeZoneTrigger(region, { manual: true });
	await _updateZoneCards(region);
}

/** „Runde abschließen"-Taste (manueller Runden-Tick dieser Zone). */
export async function aoeZoneRound(regionId, sceneId) {
	if (!aoeEnabled()) return;
	const region = _getZoneRegion(regionId, sceneId);
	if (!region || !_mayControlZone(region.flags?.symbaroum?.aoe)) return;
	await _tickZone(region, 'manual');
}

/** Zone beenden (Enden-/Abbrechen-Taste): Region löschen, Karten stilllegen. */
export async function aoeEndZone(regionId, sceneId) {
	if (!aoeEnabled()) return;
	const region = _getZoneRegion(regionId, sceneId);
	if (!region || !_mayControlZone(region.flags?.symbaroum?.aoe)) return;
	await _endZone(region, 'manual');
}

async function _endZone(region, source) {
	// v2.2 (Baustein 9): Ziel-Fenster der Zone schließen
	_closeTargetWindow(region.id);
	// v2.5: In-Flight-Marke der Aktivierung mitraeumen (verwaister Dialog)
	_zoneActivationInFlight.delete(region.id);
	// Abbruch einer One-Shot-Zone ohne Auslösung = Abbruch ohne Wirkung
	const aoe = region.flags?.symbaroum?.aoe;
	/* v2.3 (Rudolfs Testrunde 3): Beim Beenden der Zone werden auch die
	   von IHR gesetzten Zustände wieder entfernt - bislang blieben die
	   Symbole auf den Token kleben, obwohl die Zone weg war. Freie
	   Zonen führen ihre Conditions selbst mit (Token-Id → Condition-Id
	   in aoe.appliedConditionTokens, siehe _applyFreeZoneEffect).
	   Kraft-Zonen scannen die Szenen-Token nach dem flagData-Autoren-
	   marker (caster + ability, Muster maintainChainResult): nur
	   Symbole DIESES Akteurs aus DIESEM Kraft-Item werden gelöscht -
	   Symbole anderer Wirker oder Dritter bleiben unberührt. */
	const scene = region.parent ?? null;
	if (aoe) {
		if (aoe.free) {
			for (const [tokenId, conditionId] of Object.entries(aoe.appliedConditionTokens ?? {})) {
				const target = scene?.tokens?.get(tokenId)?.actor ?? null;
				if (target?.hasCondition?.(conditionId)) {
					try {
						await target.removeCondition(conditionId);
					} catch (error) {
						console.warn('Symbaroum AoE: removeCondition on zone end failed', error);
					}
				}
			}
		} else {
			const actor = aoe.sourceActorUuid ? fromUuidSync(aoe.sourceActorUuid) : null;
			const item = aoe.sourceItemUuid ? fromUuidSync(aoe.sourceItemUuid) : null;
			const abilityRef = item?.reference ?? null;
			if (actor && abilityRef) {
				const cfg = actor.system?.combat?.combatMods?.abilities?.[item.id] ?? {};
				const effects = [...(cfg.addTargetEffect ?? []), ...(cfg.activelyMaintainedTargetEffect ?? [])];
				for (const tokenDoc of scene ? scene.tokens.contents : []) {
					const target = tokenDoc.actor;
					if (!target?.hasCondition) continue;
					for (const effect of effects) {
						const existing = target.hasCondition(effect.id);
						const flagData = existing?.getFlag?.(game.system.id, 'flagData');
						if (existing && flagData?.caster === actor.id && flagData?.ability === abilityRef) {
							try {
								await target.removeCondition(effect.id);
							} catch (error) {
								console.warn('Symbaroum AoE: removeCondition on zone end failed', error);
							}
						}
					}
				}
			}
		}
	}
	const textKey = source === 'manual' && aoe?.mode === 'instant' ? 'AOE.ABORT_MESSAGE' : 'AOE.END_MESSAGE';
	await _settleZoneCards(region, game.i18n.localize(textKey));
	try {
		await region.delete();
	} catch (error) {
		console.warn('Symbaroum AoE: region delete failed', error);
	}
}

/* =====================================================================
 * Platzierung: Kraft-Zone (Zone-Tab) und freie Zone (Makro)
 * =================================================================== */

/**
 * Zone aus dem Kraft-Item platzieren (Action placeZone des Zone-Tabs,
 * klassisch + modern). GM immer; Spieler bei aktivem Setting und
 * Item-Besitz (2b). Augenblickliche Zonen wirken sofort nach der
 * Platzierung (Ketten-Automatik) und verschwinden danach; dauerhafte
 * Zonen bekommen Auto-Targeting + Zonen-Karte.
 */
export async function placeZoneFromItem(item) {
	if (!item) return;
	if (!mayPlaceZone(item)) return;
	if (!aoeEnabled()) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_DISABLED'));
		return;
	}
	if (!canvas?.scene) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_NO_SCENE'));
		return;
	}
	const cfg = getZoneConfig(item);
	if (!cfg) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_NO_CONFIG'));
		return;
	}
	const casterToken = _resolveCasterToken(item);
	const actor = item.actor ?? null;
	const zone = {
		level: 2,
		free: false,
		mode: cfg.mode,
		trigger: cfg.trigger,
		// One-Shot (augenblicklich): keine Restdauer, endet mit der Auslösung
		remaining: cfg.mode === 'instant' ? null : cfg.duration > 0 ? cfg.duration : 0,
		sourceItemUuid: item.uuid,
		sourceActorUuid: actor?.uuid ?? null,
		casterTokenUuid: casterToken?.document?.uuid ?? null,
		userId: game.user.id,
		config: { shape: cfg.shape, size: cfg.size, targeting: cfg.targeting, targetOrder: cfg.targetOrder },
		metersPerField: 2,
		/* v2.6 (Rudolfs Testrunde 6, P12): der Zonen-Name nennt den
		   AUSLÖSER (den Kraft besitzenden Akteur) statt des platzieren-
		   den USERS - bei GM-Platzierung stand sonst „[GM]" im Namen
		   und damit auf jeder Zonen-/Ende-/Ergebniskarte. Freie Zonen
		   (kein Akteur) behalten den platzierenden Nutzer. */
		regionName: game.i18n.format('AOE.REGION_NAME', { name: item.name, user: actor?.name ?? game.user.name }),
	};
	const regionData = _zoneRegionData(zone);
	if (!regionData) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_NO_CONFIG'));
		return;
	}
	let regions = null;
	try {
		regions = await canvas.regions.placeRegions([regionData]);
	} catch (error) {
		console.error('Symbaroum AoE: placeRegions failed', error);
		ui.notifications.error(game.i18n.format('AOE.ERR_PLACEMENT', { message: error?.message ?? String(error) }));
		return;
	}
	if (!regions?.length) return; // Abbruch (Rechtsklick): kein Lärm, keine Karte
	for (const region of regions) {
		/* v2.1 (Rudolfs Testrunde-1-Entscheidung 1): Augenblickliche
		   Zonen wirken NICHT mehr sofort bei der Platzierung - sie sind
		   One-Shot-Zonen mit Zonen-Karte: Ziele lassen sich markieren
		   (Reihenfolge = Primärziel zuerst), die Auslöse-Taste wirkt
		   einmal (voller Zauberwurf inkl. Korruption) und entfernt die
		   Region danach. Dauerhafte Zonen unverändert (Karte + optional
		   Betreten-Trigger). */
		/* v2.4 (Rudolfs Testrunde 4, Entscheidung f): MARKIERUNGS-Zonen
		   (dauerhaft + Zielwahl 'Markierungsreihenfolge') markieren
		   NICHTS automatisch vor - die eigene Markierung ist die Ziel-
		   auswahl (kein Vormarkieren). */
		const isMarkingZone = zone.mode === 'lasting' && cfg.targetOrder === 'marking';
		/* v2.5 (Rudolfs Testrunde 5, P13): KEIN Auto-Vormarkieren mehr
		   bei DAUERHAFTEN Zonen - die Zone wirkt automatisch über den
		   Aktivierungs-Snapshot, stehende Ziel-Markierungen stören
		   (Rudolfs Frage „Können die Token in der Zone unmarkiert
		   bleiben?" - sie können). One-Shot-Zonen behalten die Vor-
		   markierung als Zielwahl-UI (Auslöse-Taste wirkt auf die
		   Markierungen), Markierungszonen markieren nie (unverändert). */
		if (zone.mode === 'instant') {
			await _autoTargetRegion(region, cfg, casterToken);
		}
		await _postZoneCard(region);
		/* v2.2 (Baustein 9, Rudolfs Freigabe 10.11.): Einmal-Zonen
		   beschränken die Zielmarkierung ihres Besitzers über die
		   GESAMTE Standzeit - Platzierung bis Auslösen/Abbrechen (kurze,
		   intensive Phase; andere User bleiben uneingeschränkt). */
		if (zone.mode === 'instant') _openTargetWindow(region);
		/* v2.2 (Rudolfs Entscheidung 1): Betreten-Trigger MIT Anfangs-
		   bestand - steht bei der Platzierung bereits mindestens ein
		   filterpassendes Token in der Fläche, löst die Zone EINMAL
		   automatisch aus (v2.4: das ist die AKTIVIERUNG - voller Wurf
		   mit Standard-Würfeldialog, Korruption 1x; nur dauerhafte
		   Betreten-Zonen, Einmal-Zonen bleiben One-Shot). v2.4
		   (Entscheidung f): Markierungs-Zonen lösen NICHT automatisch
		   aus - die Aktivierung läuft dort über die Auslöse-Taste, wenn
		   die Markierungsreihenfolge steht. */
		if (zone.mode === 'lasting' && zone.trigger === 'enter' && !isMarkingZone) {
			const standing = _filterTargets(_collectRegionTokens(region), cfg.targeting, casterToken);
			if (standing.length > 0) {
				await _executeZoneTrigger(region, { manual: false });
				await _updateZoneCards(region);
			}
		}
	}
}

/** Auto-Targeting EINER platzierten Region (Zielvorschlag wie Stufe 1). */
async function _autoTargetRegion(region, cfg, casterToken) {
	const tokens = _filterTargets(_collectRegionTokens(region), cfg.targeting, casterToken);
	if (tokens.length > 0) {
		let first = true;
		for (const tokenDoc of tokens) {
			tokenDoc.object?.setTarget(true, { releaseOthers: first });
			first = false;
		}
	}
}

/**
 * Auswahldialog bei Kraft-Aktivierung (v2.1, Rudolfs Freigabe 10.11.).
 * v2.2 (Rudolfs Entscheidung 4): der Dialog gilt jetzt AUCH für den GM -
 * derselbe Dreitasten-Dialog inklusive Abbrechen wie für Spieler (der
 * Zone-Tab bleibt GM-only). v2.2 (P11, Rudolfs Design-Wunsch): beide
 * AoE-Dialoge laufen über symbDialog im modernen Design
 * (modernDialogClasses, Alchemie-/Brau-Dialog-Optik) statt des
 * klassischen V1-Dialogs.
 * Bei konfigurierter Zone fragt der Aktivieren-Button einer Mystischen
 * Kraft, WIE die Kraft ausgeführt wird - „Manuell" (normaler Kraft-
 * dialog), „Zone platzieren" (Zonen-Platzierung inkl. Zonen-Karte) oder
 * „Abbrechen". Unkonfigurierte Kräfte und deaktivierte AoE laufen ohne
 * Dialog direkt durch (keine Reibung).
 * @returns {Promise<boolean|string>} false = kein Dialog nötig (normal
 *   weiter); 'manual' | 'zone' | 'cancel' = Dialog-Wahl des Nutzers.
 */
export async function maybeZoneExecutionChoice(item) {
	if (!item || item.type !== 'mysticalPower') return false;
	if (!aoeEnabled()) return false;
	// v2.4 (Rudolfs Testrunde 4, Bannsiegel-Diagnose): areaZone ist vor-
	// konfiguriert, aber die FORM fehlt -> getZoneConfig null -> der
	// Ausführungsdialog wurde bislang STILL übersprungen (Rudolfs Beob-
	// achtung "Ausführungsdialog erschien nie"). Der Zustand ist jetzt
	// SICHTBAR: Warnung mit Handlungshinweis, danach normaler manueller
	// Ablauf (nur shape gilt als Pflichtfeld; mode/targetOrder haben
	// sinnvolle Defaults und lösen die Warnung nicht aus).
	const rawZone = item?.system?.areaZone ?? null;
	if (!getZoneConfig(item)) {
		const partiallyConfigured =
			!!rawZone &&
			String(rawZone.shape ?? '').trim() === '' &&
			(Number(rawZone.size) > 0 || String(rawZone.targeting ?? '').trim() !== '' || String(rawZone.trigger ?? '').trim() !== '' || Number(rawZone.duration) > 0);
		if (partiallyConfigured) {
			ui.notifications.warn(game.i18n.localize('AOE.ERR_ZONE_NO_SHAPE'));
		}
		return false;
	}
	// GM immer berechtigt; Spieler nur bei aktivem Setting + Besitz (2b)
	if (!game.user.isGM && (!playerPlacementEnabled() || !item.isOwner)) return false;
	const modern = isModernDialogActive();
	const content = `<div class="symbaroum${modern ? ' modern-roll-dialog' : ' dialog'}"><p>${game.i18n.localize('AOE.EXEC_HINT')}</p></div>`;
	return new Promise((resolve) => {
		let settled = false;
		const settle = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const dialog = symbDialog({
			title: game.i18n.format('AOE.EXEC_TITLE', { power: item.name }),
			content,
			classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(modern ? modernDialogClasses('modern-roll-dialog') : [])],
			buttons: {
				manual: {
					icon: '<i class="fas fa-user"></i>',
					label: game.i18n.localize('AOE.EXEC_MANUAL'),
					callback: () => settle('manual'),
				},
				zone: {
					icon: '<i class="fas fa-draw-polygon"></i>',
					label: game.i18n.localize('AOE.EXEC_ZONE'),
					callback: () => {
						placeZoneFromItem(item);
						settle('zone');
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: game.i18n.localize('DIALOG.CANCEL'),
					callback: () => settle('cancel'),
				},
			},
			// v2.3 (P9-Rückmeldung, Rudolfs Wunsch): Tasten vertikal unter-
		// statt nebeneinander - Brew-Menü-Rezept (footer flex column,
		// Breite als wichtiges Inline-Style gegen die System-CSS-
		// Regel width:auto !important, siehe brewing.js-Kommentar)
		onRender: (element) => {
			const btns = element?.querySelectorAll?.('footer button');
			if (!btns || btns.length === 0) return;
			const footer = btns[0].closest('footer') ?? btns[0].parentElement;
			if (footer) {
				footer.style.display = 'flex';
				footer.style.flexDirection = 'column';
				footer.style.gap = '0.25rem';
			}
			for (const b of btns) {
				b.style.boxSizing = 'border-box';
				b.style.setProperty('width', '100%', 'important');
				b.style.setProperty('align-self', 'stretch', 'important');
			}
		},
		default: 'manual',
			width: 460,
		});
		// ESC / Kopf-X ohne Tastenwahl = Abbruch. Das close-Event feuert
		// auch nach einer Tastenwahl - der settled-Guard lässt die
		// Promise bei der ersten Entscheidung (Taste) stehen.
		try {
			dialog.addEventListener('close', () => settle('cancel'));
		} catch (error) {
			// close-Listener nicht verfügbar: Dialog ohne ESC-Fallback
			console.warn('Symbaroum AoE: execution dialog close listener unavailable', error);
		}
	});
}

/**
 * Freie Zone platzieren (GM-Makro, 2a): Konfigurationsdialog in
 * Elixiere-Pflegeform (Widerstands-Attribut-Dropdown, Schaden-Formel,
 * Korruption-Formel, Condition-Dropdown - leer = keine Wirkung), dann
 * interaktive Platzierung. Ursprungsanwendungsfall: Rudolfs
 * Korruptionszone mit Willenskraftprobe.
 * v2.2 (Rudolfs Testrunde 2, P4): der Dialog läuft über symbDialog im
 * modernen Design (modernDialogClasses, Alchemie-/Brau-Dialog-Muster:
 * eigenes Template aoe-free-zone-dialog.hbs mit renderModern-Zweigen)
 * statt des klassischen V1-Dialogs.
 */
export async function placeFreeZone() {
	if (!game.user?.isGM) return;
	if (!aoeEnabled()) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_DISABLED'));
		return;
	}
	if (!canvas?.scene) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_NO_SCENE'));
		return;
	}
	const localize = (key) => game.i18n.localize(key);
	// v2.1-Fix (Rudolfs Testrunde 1, Punkt 7): StatusEffects tragen in
	// 'name' den i18n-KEY (Nebelball-Präzedenz Elixiere v1.2) - lokalisiert
	// wird über 'label'. v2.2: Option-Daten in JS vorbereitet (CSS-
	// Checkliste), das Template rendert sie über den selectOptions-Helper
	// (Brau-Dialog-Muster).
	const shapeOptions = Object.values(game.symbaroum.config.AOE_SHAPE_SELECTION).map((c) => ({ id: c.id, label: localize(c.label) }));
	const targetingOptions = Object.values(game.symbaroum.config.AOE_TARGETING_SELECTION).map((c) => ({ id: c.id, label: localize(c.label) }));
	const attrOptions = [
		{ id: '', label: localize('AOE.RESIST_NONE') },
		...game.symbaroum.config.attributes.map((a) => ({ id: a, label: localize(`ATTRIBUTE.${a.toUpperCase()}`) })),
	];
	const conditionOptions = [
		{ id: '', label: localize('AOE.CONDITION_NONE') },
		...CONFIG.statusEffects
			.filter((e) => e.id)
			.map((e) => ({ id: e.id, label: game.i18n.localize(e.label ?? e.name ?? e.id) })),
	];
	const modern = isModernDialogActive();
	const content = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/aoe-free-zone-dialog.hbs', {
		renderModern: modern,
		freeName: localize('AOE.FREE_DEFAULT_NAME'),
		shapeOptions,
		targetingOptions,
		attrOptions,
		conditionOptions,
	});
	symbDialog({
		title: localize('AOE.FREE_TITLE'),
		content,
		classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(modern ? modernDialogClasses('modern-roll-dialog') : [])],
		width: 440,
		/* v2.4 (Rudolfs Klärungsrunde): Live-Hinweis des abgeleiteten
		   Zonenattributs (10 - Modifikator) unter dem Modifikator-Feld -
		   die SL sieht beim Eingeben sofort den effektiven Zielwert, den
		   die Karte später als 'Zonenattribut ({Wert})' anzeigt. */
		onRender: (element) => {
			const input = element?.querySelector?.('#aoe-free-modifier');
			const hint = element?.querySelector?.('#aoe-free-zoneattr-value');
			if (!input || !hint) return;
			const update = () => {
				const m = Number(input.value) || 0;
				hint.textContent = String(10 - m);
			};
			input.addEventListener('input', update);
			update();
		},
		buttons: {
			place: {
				icon: '<i class="fas fa-draw-polygon"></i>',
				label: localize('AOE.PLACE_BUTTON'),
				callback: (html) => _placeFreeZoneFromDialog(html[0]),
			},
		},
		default: 'place',
	});
}

async function _placeFreeZoneFromDialog(html) {
	const val = (id) => html.querySelector(`#${id}`)?.value?.trim() ?? '';
	const shape = val('aoe-free-shape');
	if (!shape) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_NO_CONFIG'));
		return;
	}
	const size = Math.max(1, Math.round(Number(val('aoe-free-size')) || 1));
	const duration = Math.max(0, Math.round(Number(val('aoe-free-duration')) || 0));
	/* v2.3 (Rudolfs Entscheidung 3+4, Testrunde 3): Neues Dialogfeld
	   „Auslösen" - 'enter' hängt die freie Zone ans Betreten-Verhalten
	   (aoeZoneEnter führt die VOLLE Auslösung aus, konsistent mit
	   Kraft-Zonen und Anfangsbestand), Leerstring = nur Auslöse-Taste.
	   v2.3 (Punkt 11): Modifikator + Gunst aus dem Dialog in eff -
	   _probeAuto (Auto-Takt) und die Spieler-Anfragekarte würfeln damit. */
	const trigger = val('aoe-free-trigger') === 'enter' ? 'enter' : '';
	const modifier = Number(val('aoe-free-modifier')) || 0;
	const favourInput = html.querySelector('input[name="aoe-free-favour"]:checked');
	const favour = Number(favourInput?.value ?? 0) || 0;
	const zone = {
		level: 2,
		free: true,
		mode: 'lasting',
		trigger,
		remaining: duration,
		sourceItemUuid: null,
		sourceActorUuid: null,
		casterTokenUuid: null,
		userId: game.user.id,
		config: { shape, size, targeting: val('aoe-free-targeting') || 'all', targetOrder: 'marking' },
		effect: {
			resistAttribute: val('aoe-free-resist'),
			damage: val('aoe-free-damage'),
			damagePerRound: val('aoe-free-dpr'),
			corruption: val('aoe-free-corruption'),
			condition: val('aoe-free-condition'),
			modifier,
			favour,
		},
		metersPerField: 2,
		regionName: val('aoe-free-name') || game.i18n.localize('AOE.FREE_DEFAULT_NAME'),
	};
	const regionData = _zoneRegionData(zone);
	if (!regionData) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_NO_CONFIG'));
		return;
	}
	let regions = null;
	try {
		regions = await canvas.regions.placeRegions([regionData]);
	} catch (error) {
		console.error('Symbaroum AoE: placeRegions failed', error);
		ui.notifications.error(game.i18n.format('AOE.ERR_PLACEMENT', { message: error?.message ?? String(error) }));
		return;
	}
	if (!regions?.length) return;
	for (const region of regions) {
		await _postZoneCard(region);
	}
}

/* =====================================================================
 * v2.2 Baustein 9 (Rudolfs Anfrage + Freigabe 10.11.): Zielmarkierung
 * auf die Zone beschränken - reaktives Undo + Warnung
 * =================================================================== */

/* Offene Ziel-Fenster: regionId -> { userId, sceneId }. Ein Fenster
 * beschränkt die Zielmarkierungen seines Besitzers (pro Client wird nur
 * der eigene User geprüft) auf Token INNERHALB der Zone - Fenster für
 * eine Einmal-Zone steht deren gesamte Standzeit (placeZoneFromItem
 * bis Auslösen/Abbrechen), das Fenster einer dauerhaften Zone nur
 * während der Kettenausführung (_executeZoneTrigger). Andere User und
 * Fenster-lose Zeiten sind nie eingeschränkt. */
const _zoneTargetWindows = new Map();

/** Ziel-Fenster einer Zone öffnen (Baustein 9). */
function _openTargetWindow(region) {
	if (!region?.id) return;
	_zoneTargetWindows.set(region.id, { userId: game.user.id, sceneId: region.parent?.id ?? null });
}

/** Ziel-Fenster schließen (Zonen-Ende / Ende der Kettenausführung). */
function _closeTargetWindow(regionId) {
	if (regionId) _zoneTargetWindows.delete(regionId);
}

/**
 * Liegt der Token in IRGENDEINEM offenen Fenster des eigenen Users?
 * Die Innenraum-Prüfung läuft LIVE gegen die Region (Token können die
 * Zone betreten/verlassen); tote Fenster (Region gelöscht) räumen sich
 * bei der Prüfung selbst ab.
 */
function _tokenInsideAnyOpenZone(tokenId) {
	for (const [regionId, win] of _zoneTargetWindows) {
		if (win.userId !== game.user.id) continue;
		const region = _getZoneRegion(regionId, win.sceneId);
		if (!region) {
			_zoneTargetWindows.delete(regionId);
			continue;
		}
		if (_collectRegionTokens(region).some((td) => td.id === tokenId)) return true;
	}
	return false;
}

/* =====================================================================
 * Hooks: Chat-Karten-Tasten + Runden-Dispatcher (Registrierung über
 * registerAoeHooks in hooks.js - alle AoE-Listener an einem Ort)
 * =================================================================== */

export function registerAoeHooks() {
	// v2.2 (Baustein 9, Rudolfs Anfrage 10.11.): Zielmarkierungen im
	// aktiven Zonen-Fenster auf Token INNERHALB der Zone beschränken.
	// Der targetToken-Hook ist per Hooks.callAll geschaltet (Signatur
	// void) - eine Markierung lässt sich NICHT verhindern, nur rückgängig
	// machen: Außen-Markierungen werden sofort wieder entfernt und mit
	// Rudolfs Warntext quittiert (kosmetischer Nebeneffekt: der Ziel-Pip
	// flackert kurz auf). Das eigene Undo feuert targetToken erneut mit
	// targeted=false und wird ignoriert (keine Rekursion). Pro Client
	// nur der eigene User; Fenster siehe _openTargetWindow.
	Hooks.on('targetToken', (user, token, targeted) => {
		if (!targeted) return;
		if (user?.id !== game.user?.id) return;
		if (_zoneTargetWindows.size === 0) return;
		const tokenId = token?.document?.id ?? token?.id;
		if (!tokenId) return;
		if (_tokenInsideAnyOpenZone(tokenId)) return;
		try {
			token.setTarget(false);
		} catch (error) {
			console.warn('Symbaroum AoE: target undo failed', error);
		}
		ui.notifications.warn(game.i18n.localize('AOE.WARN_OUTSIDE_ZONE'));
	});

	// Zonen-Karte: Tasten für GM und Zone-Besitzer (Inhalt ist in der
	// Nachricht gespeichert - Sichtbarkeit und Verdrahtung passieren
	// pro Client im Render). v2.1-Fix (Rudolfs Testrunde 1, Punkt 6):
	// die Tasten hatten KEINEN Klick-Dispatch - sie wurden für Nicht-GMs
	// nur entfernt, der GM-Click-Handler fehlte komplett (stumm tot).
	Hooks.on('renderChatMessageHTML', (message, html) => {
		const card = message.flags?.symbaroum?.aoeZoneCard;
		if (card) {
			const region = _getZoneRegion(card.regionId, card.sceneId);
			const controllable = !!region && _mayControlZone(region.flags?.symbaroum?.aoe);
			if (!controllable) {
				html.querySelectorAll('[data-aoe-zone-action]').forEach((btn) => btn.remove());
				return;
			}
			html.querySelectorAll('[data-aoe-zone-action]').forEach((btn) => {
				if (btn.dataset.aoeHandled) return;
				btn.dataset.aoeHandled = '1';
				btn.addEventListener('click', async (event) => {
					event.preventDefault();
					event.stopPropagation();
					const action = btn.dataset.aoeZoneAction;
					btn.disabled = true;
					try {
						if (action === 'trigger') await aoeTriggerZone(card.regionId, card.sceneId);
						else if (action === 'round') await aoeZoneRound(card.regionId, card.sceneId);
						else if (action === 'end') await aoeEndZone(card.regionId, card.sceneId);
					} finally {
						btn.disabled = false;
					}
				});
			});
			return;
		}
		// Anfragekarte freier Zonen: Würfel-Taste auf dem Client des
		// besitzenden Spielers (Karte ist geflüstert, Fremde sehen sie nicht)
		const resistButton = html.querySelector('[data-aoe-resist-region]');
		if (resistButton) {
			if (resistButton.dataset.aoeHandled) return;
			resistButton.dataset.aoeHandled = '1';
			resistButton.addEventListener('click', async (event) => {
				event.preventDefault();
				const sceneId = resistButton.dataset.aoeResistScene;
				const regionId = resistButton.dataset.aoeResistRegion;
				const tokenId = resistButton.dataset.aoeResistToken;
				await _handleFreeZoneResist(sceneId, regionId, tokenId, resistButton);
			});
		}
	});

	/* Combat-Takt. v2.3 (Rudolfs Entscheidung 6, Testrunde 3):
	   Der Dauer-Abbau läuft am INITIATIVE-ZUG des AUSLÖSERS - die Zone
	   wird genau dann eine Runde älter, wenn der Kampfzug ihres Auslösers
	   beginnt. Sprünge über Runden (Auslöser zieht nicht) verbrauchen
	   NICHTS. Der alte Rundenwechsel-Takt bleibt als FÜR jene Zonen,
	   deren Auslöser nicht im Kampf ist (freie Zonen, casterTokenUuid
	   null, aus dem Kampf genommene Auslöser). */
	Hooks.on('updateCombat', async (combat, changed) => {
		if (!game.user?.isGM || !aoeEnabled()) return;
		const combatSceneId = combat.scene?.id ?? combat.parent?.id ?? null;
		if (combatSceneId && combatSceneId !== game.scenes.viewed?.id) return;
		const newRound = Number(changed?.round ?? NaN);
		const roundChange = Number.isFinite(newRound) && newRound > 0 && newRound > (_lastCombatRound.get(combat.id) ?? 0);
		if (Number.isFinite(newRound) && newRound > 0) _lastCombatRound.set(combat.id, newRound);
		const active = combat.turns?.[combat.turn] ?? null;
		const scene = game.scenes.viewed;
		if (!scene) return;
		const zones = [...(scene.regions ?? [])].filter((r) => !!r.flags?.symbaroum?.aoe && r.flags.symbaroum.aoe.mode !== 'instant');
		// Sicherheitsnetz: jede Zone pro updateCombat-Event max. 1 Tick
		const ticked = new Set();
		for (const region of zones) {
			if (ticked.has(region.id)) continue;
			const aoe = region.flags.symbaroum.aoe;
			const casterDoc = aoe.casterTokenUuid ? fromUuidSync(aoe.casterTokenUuid) : null;
			const combatant = casterDoc ? combat.combatants.find((c) => c.tokenId === casterDoc.id) : null;
			let tick = false;
			if (combatant) {
				// Auslöser im Kampf: genau sein eigener Zug-Wechsel tickt
				tick = combatant.id === active?.id;
			} else {
				// Fallback: Rundenwechsel (wie vor v2.3)
				tick = roundChange;
			}
			if (!tick) continue;
			ticked.add(region.id);
			try {
				await _tickZone(region, 'combat');
			} catch (error) {
				console.warn('Symbaroum AoE: zone tick failed', error);
			}
		}
	});
	Hooks.on('deleteCombat', (combat) => _lastCombatRound.delete(combat.id));

	// Weltzeit-Takt (ohne laufenden Combat): 900 Sekunden = 1 Zonen-Runde
	/* v2.6 (Rudolfs Testrunde 6, P13a): MARKEN-MODELL wie der A29-Weltzeit-
	   Reminder (hooks.js): floor(Weltzeit/900). Vorher nutzte der Tick
	   RELATIVE 900-s-Intervalle (Differenz zur Weltzeit des letzten Ticks)
	   - kleine Zeitsprünge über eine 15-Min-Marke feuerten den Reminder
	   OHNE Zonen-Runde (Rudolfs Befund: „Weltzeit triggert keine Runde
	   nach 15 Minuten"), große Sprünge tickten mehrfach ins Leere. Bei
	   der Registrierung wird die Marke initialisiert, ohne zu ticken. */
	const _initMark = Math.floor(Number(game.time?.worldTime ?? 0) / 900);
	if (!(Number(game.settings.get('symbaroum', 'aoeLastRoundMark')) || 0) && _initMark > 0) {
		game.settings.set('symbaroum', 'aoeLastRoundMark', _initMark);
	}
	Hooks.on('updateWorldTime', (worldTime) => {
		if (!game.user?.isGM || !aoeEnabled()) return;
		if (game.combat?.active) return;
		const mark = Math.floor((Number(worldTime) || 0) / 900);
		const last = Number(game.settings.get('symbaroum', 'aoeLastRoundMark')) || 0;
		if (mark <= last) return;
		game.settings.set('symbaroum', 'aoeLastRoundMark', mark);
		aoeRoundTick('worldtime');
	});
}

/** Klick auf die Widerstands-Taste der Anfragekarte (Spieler-Client). */
async function _handleFreeZoneResist(sceneId, regionId, tokenId, button) {
	const scene = game.scenes.get(sceneId);
	const region = scene?.regions?.get(regionId);
	const aoe = region?.flags?.symbaroum?.aoe;
	if (!aoe?.free) return;
	const tokenDoc = scene?.tokens?.get(tokenId);
	const actor = tokenDoc?.actor;
	if (!actor) return;
	const eff = aoe.effect ?? {};
	if (!eff.resistAttribute) {
		await _applyFreeZoneEffect(region, tokenDoc, eff, null);
	} else {
		/* v2.4: Zonenattribut-Semantik + gespiegelte Gunst + Standard-
		   Ergebnis-Karte (läuft auf dem Client des besitzenden Spielers,
		   Muster S4.2 unverändert). */
		await _freeZoneResistProbe(region, tokenDoc, eff);
	}
	button.disabled = true;
	button.parentElement.parentElement.classList.add('aoe-resist-done');
}

/* =====================================================================
 * v2.4 (Rudolfs Testrunde 4, Entscheidungen c+e): Zonen-Maintain-Runde
 * =================================================================== */

/**
 * Aktive Kraft-Zone zu einem Akteur + Kraft-Bezug finden (aktive Szene;
 * dauerhafte, aktivierte Kraft-Zonen mit passendem Quell-Item). Nutzt
 * sourceActorUuid/sourceItemUuid statt des A23-Symbol-Scans - die Zone
 * ist die Quelle der Wahrheit, nicht die Symbole.
 */
export function aoeFindZoneRegionFor(actorId, abilityRef) {
	const scene = game.scenes.viewed ?? null;
	if (!scene || !abilityRef) return null;
	for (const region of scene.regions ?? []) {
		const aoe = region?.flags?.symbaroum?.aoe;
		if (!aoe || aoe.free || aoe.mode === 'instant') continue;
		const actor = aoe.sourceActorUuid ? fromUuidSync(aoe.sourceActorUuid) : null;
		if (actor?.id !== actorId) continue;
		const item = aoe.sourceItemUuid ? fromUuidSync(aoe.sourceItemUuid) : null;
		if (item?.system?.reference === abilityRef) return region;
	}
	return null;
}

/**
 * Maintain-Runde einer ZONE (v2.4, Rudolfs Testrunde 4, Entscheidung c):
 * Klickt der Wirker im A29-Reminder auf Ja, widerstehen ALLE Zonen-Token
 * (Zonen-Scan statt A23-Symbol-Scan - auch Token, die bei der Aktivie-
 * rung widerstanden haben und noch kein Symbol tragen, werden je Runde
 * neu geprüft), ohne Korruptionskosten. Erfolgreicher Widerstand entfernt
 * die Maintain-Symbole des Kraft-Autors vom Token; ein misslungener
 * Widerstand wirkt über die Kraft-Automatik (Zone als Karten-Quelle).
 * @returns {Promise<boolean>} true = eine Zone wurde gefunden und die
 *   Runde ausgeführt (der normale presetMaintain-Flow entfällt).
 */
export async function aoeMaintainZoneRound(actor, abilityRef) {
	if (!actor || !aoeEnabled()) return false;
	const region = aoeFindZoneRegionFor(actor.id, abilityRef);
	if (!region) return false;
	const aoe = region.flags.symbaroum.aoe;
	const item = aoe.sourceItemUuid ? (await fromUuid(aoe.sourceItemUuid)) : null;
	if (!item || !aoe.activated) return false;
	const tokens = _filterTargets(_collectRegionTokens(region), aoe.config.targeting, _casterTokenOfZone(aoe));
	/* v2.5 (Rudolfs Testrunde 5, P5-Kommentar): Zielwahl-Sortierung jetzt
	   auch in der Maintain-Runde (vorher Szenenreihenfolge - "hat zwei Mal
	   mit dem entferntesten Token begonnen"). */
	const ordered = _sortZoneTokens(region, tokens);
	/* Kostenpflichtig ist nur die Aktivierung (Entscheidung a): die
	   Maintain-Runde ist KOSTENLOS (Entscheidung c). */
	await _runPowerZoneProbes(region, actor, item, ordered, { maintainRound: true });
	/* v2.6 (Rudolfs Testrunde 6, P10): die Maintain-Runde aktualisiert
	   die Zonen-Karte (Delete+Recreate ans Chat-Ende) + Auslöse-Vermerk
	   (Kampf = Runde, sonst Weltzeit) - vorher geschah an der Karte
	   GAR NICHTS, sie wanderte nie ans Chat-Ende. */
	aoe.lastTriggered = {
		round: game.combat?.active && game.combat.round > 0 ? game.combat.round : 0,
		worldTime: Math.round(game.time?.worldTime ?? 0),
	};
	await region.setFlag('symbaroum', 'aoe', aoe);
	await _updateZoneCards(region);
	return true;
}

/** Einmal-Zone nach der AKTIVIERUNG beenden (buildRolls/captureZone-
 *  ActivationSnapshot mit endAfter; Text wie beim v2.3-Auslöse-Ende). */
export async function aoeConcludeInstantZone(regionId, sceneId) {
	if (!aoeEnabled()) return;
	const region = _getZoneRegion(regionId, sceneId);
	if (!region) return;
	await _endZone(region, 'trigger');
}

/**
 * Abschluss der Zonen-AKTIVIERUNG (v2.5, Rudolfs Testrunde 5): Called aus
 * captureZoneActivationSnapshot (item.js), sobald der Standard-Würfeldialog
 * wirklich abgeschlossen wurde. Raeumt die In-Flight-Marke (frei fuer
 * kuenftige Ausloesungen - bis dahin wurden sie gestapelt, P16) und
 * aktualisiert die Zonen-Karte (die „Auslösen"-Taste verschwindet nach
 * der Aktivierung, der Auslöser-Name erscheint - 12a + 15).
 */
export async function aoeZoneActivationCompleted(regionId, sceneId) {
	_zoneActivationInFlight.delete(regionId);
	const region = _getZoneRegion(regionId, sceneId);
	if (!region) return;
	await _updateZoneCards(region);
}
