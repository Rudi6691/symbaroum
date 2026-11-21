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
import { hymnTokenDeleted, hymnAutoRescanRound, thorncloakTokenDeleted, glypheTokenDeleted, postSealCategoryGmCard } from './item.js';

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
	/* AoE-Rest Paket 1 (Rudolfs Startsignal „Baue es“ 18.11.2026): Sinn-
	   Paket S1 - Welt-Setting aoeSenseWalls schaltet die WAND-BLOCKER
	   (Kanten-/Regions-Prüfung für Bewegung/Sicht/Schall) der Zonen und
	   Flusskräfte GESAMT ab (Muster travelEnabled/aoeZonesEnabled).
	   Default AN - neue Welten prüfen sofort; rein darstellende
	   Diagnosezeilen (Skip-Zeilen) bleiben vom Setting unberührt. */
	game.settings.register('symbaroum', 'aoeSenseWalls', {
		name: 'AOE.SETTING_SENSE',
		hint: 'AOE.SETTING_SENSE_HINT',
		scope: 'world',
		type: Boolean,
		default: true,
		config: true,
		restricted: true,
	});
	/* v2.7 (Testrunde 7, HAUPTBEFUND, Rudolfs v2.6-Befunde P2d/P8/P12):
	   Initialisierung der Marke HIER, nach der Registrierung. Vorher lief
	   sie TOP-LEVEL in registerAoeHooks (Modul-Evaluierung von hooks.js)
	   VOR dieser Registrierung - game.settings.get warf, die hooks.js-
	   Evaluierung brach ab, alle Hooks dahinter registrierten sich nie.
	   Ohne Tick (kein Sofort-Tick nach F5); 0 = noch nie initialisiert
	   (Welten unter 15 Min Weltzeit ticken erstmals bei Weltzeit 900). */
	const _initMark = Math.floor(Number(game.time?.worldTime ?? 0) / 900);
	if (!(Number(game.settings.get('symbaroum', 'aoeLastRoundMark')) || 0) && _initMark > 0) {
		game.settings.set('symbaroum', 'aoeLastRoundMark', _initMark);
	}
}

/** Setting-Gate für alle AoE-Interaktionen (Blatt-Button + Platzierung). */
export function aoeEnabled() {
	return !!game.settings.get('symbaroum', 'aoeZonesEnabled');
}

/* AoE-Rest Paket 1 (Sinn-Paket S1): Wand-Blocker aktiv? Default AN. */
export function senseWallsEnabled() {
	return !!game.settings.get('symbaroum', 'aoeSenseWalls');
}

/* ---------------------------------------------------------------------
 * Sinn-Paket S1 (Rudolfs Startsignal „Baue es“ 18.11.2026): WAND-BLOCKER
 * für Bewegung/Sicht/Schall. Helper senseBlocked(from, to, sense) prüft
 * den Strahl zwischen zwei Token-Zentren gegen
 *   (a) Kanten (V14: Wände = Edges) mit edge[sense] === NORMAL - LIMITED
 *       (Fenster) und NONE blocken NICHT (Foundry-Semantik, bewusste
 *       Rudolf-Entscheidung),
 *   (b) SL-Regionen mit AKTIVIERTER Restriktion passenden Typs
 *       (CONST.EDGE_RESTRICTION_TYPES: move / SIGHT / SOUND).
 * v1.2 F6 (Rudolfs Entscheidung "strikter Core-Clip", 20.11.2026): Die
 * v1.0-Zentren-Toleranz (Quelle und Ziel bis 1,5 Zellen gelten als
 * offen, Nachbarschafts-Konvention der Dornenmantel-Näheprüfung) ist
 * ABGESCHAFFT - der Dornenmantel entscheidet seit F7 über seine ge-
 * clippte Region, senseBlocked misst strikt; der Parameter bleibt für
 * kuenftige bewusste Ausnahmen. Messfehler (keine Szene/Geometrie)
 * blocken NIE - das SL-Urteil wirkt (Rückgabe error:true, Aufrufer
 * zeigt Diagnosezeile statt still zu überspringen). Raycast bewusst
 * im Helper selbst (canvas.visibility.testVisibility prüft nur die
 * BETRACHTER-Perspektive).
 * ------------------------------------------------------------------- */

/* Endpunkte einer Kante defensiv extrahieren (V14-EdgeDocument-Feld-
   varianten; scheitert alles => null => Kante blockt nicht). */
function _edgeSegmentPoints(edgeLike) {
	const doc = edgeLike?.document ?? edgeLike;
	if (!doc) return null;
	const raw = doc.c ?? doc.points ?? edgeLike?.c ?? null;
	if (Array.isArray(raw) && raw.length >= 4) {
		if (typeof raw[0] === 'object' && raw[0] !== null) {
			return [
				{ x: Number(raw[0].x) || 0, y: Number(raw[0].y) || 0 },
				{ x: Number(raw[1].x) || 0, y: Number(raw[1].y) || 0 },
			];
		}
		return [
			{ x: Number(raw[0]) || 0, y: Number(raw[1]) || 0 },
			{ x: Number(raw[2]) || 0, y: Number(raw[3]) || 0 },
		];
	}
	const a = doc.a ?? edgeLike?.a ?? null;
	const c = doc.c2 ?? edgeLike?.c2 ?? doc.b ?? edgeLike?.b ?? null;
	if (a && c) {
		const pa = Array.isArray(a) ? { x: Number(a[0]) || 0, y: Number(a[1]) || 0 } : { x: Number(a.x) || 0, y: Number(a.y) || 0 };
		const pc = Array.isArray(c) ? { x: Number(c[0]) || 0, y: Number(c[1]) || 0 } : { x: Number(c.x) || 0, y: Number(c.y) || 0 };
		return [pa, pc];
	}
	return null;
}

/** Sense-Wert einer Kante (NONE/LIMITED/NORMAL, tolerant gelesen). */
function _edgeSenseValue(edgeLike, sense) {
	const doc = edgeLike?.document ?? edgeLike;
	const raw = doc?.[sense] ?? edgeLike?.[sense] ?? null;
	if (raw === undefined || raw === null) return 'none';
	/* v1.2 (Rudolfs Testrunde 2, P7/P8): Die v1.1-Annahme der Typ-Codes
	   war FALSCH - V14 hat die Wall-Typ-Tabellen zu EINER gemeinsamen
	   Tabelle EDGE_SENSE_TYPES mit NEUEN Codes umgebaut:
	   NONE=0, LIMITED=10, NORMAL=20, PROXIMITY=30, DISTANCE=40
	   (nicht wie vor V14 NORMAL=10/LIMITED=20 - CONST.WALL_MOVEMENT_TYPES
	   existiert in V14 nicht mehr). Der v1.1-Fallback (raw===10 =>
	   'normal') mappte darum VOLL blockierende Walls auf 'limited' und
	   der Filter blockte NIE (Rudolfs Testrunde 2: auch W0-Clip wirkte
	   nicht). Jetzt: Mapping ueber CONST.EDGE_SENSE_TYPES mit korrekten
	   Fallback-Literalen (10='limited', 20='normal'); nur NORMAL blockt,
	   LIMITED (Fenster/Schneise) und die neuen PROXIMITY/DISTANCE blocken
	   nicht. Geoeffnete Tueren blocken nichts (placeable.isOpen,
	   Fallback dokument.ds === OPEN). */
	const openDoor =
		edgeLike?.isOpen === true ||
		doc?.ds === (CONST.EDGE_DOOR_STATES?.OPEN ?? CONST.WALL_DOOR_STATES?.OPEN ?? 1);
	if (openDoor) return 'none';
	if (typeof raw === 'number') {
		const types = CONST.EDGE_SENSE_TYPES ?? null;
		const entry = types ? Object.entries(types).find(([, value]) => value === raw) : null;
		if (entry?.[0]) return String(entry[0]).toLowerCase();
		if (raw === 20) return 'normal';
		if (raw === 10) return 'limited';
		return 'none';
	}
	const text = String(raw).trim().toLowerCase();
	return text || 'none';
}

/** Streckenschnitt-Test (Standard-Kreuzungs-Algorithmus, inkl. Endpunkte). */
function _segmentsIntersect(p1, p2, p3, p4) {
	const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
	if (d === 0) return false;
	const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
	const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
	return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Restriktions-Typ eines Sinns (move/SIGHT/SOUND, EDGE_RESTRICTION_TYPES). */
function _senseRestrictionType(sense) {
	if (sense === 'sight') return 'SIGHT';
	if (sense === 'sound') return 'SOUND';
	if (sense === 'move') return 'move';
	return null;
}

/** Alle sichtbaren Kanten-Placeables der Szene (V14: canvas.edges). */
function _sceneEdges() {
	// v1.2.2: canvas.edges ist in V14 das Geometrieobjekt des aktiven Levels, NICHT
	//  die Walls-Ebene (placeables immer leer) und canvas.scene?.edges existiert nicht
	//  (Sammlung heißt scene.walls) — der Filter bekam darum seit v1.0 nie Wände.
	//  Korrekte Quellen: WallsLayer-Placeables bzw. die WallDocuments der Szene.
	const layer = canvas.getLayerByEmbeddedName?.('Wall') ?? canvas.walls;
	const placeables = layer?.placeables ?? [];
	if (Array.isArray(placeables) && placeables.length > 0) return placeables;
	return [...(canvas.scene?.walls ?? [])];
}

/** Durchquert der Strahl eine AKTIVE Region mit passender Restriktion?
 *  Abtastung entlang des Strahls (10 Stützpunkte, Region per testPoint);
 *  die Quell-Region (Zone selbst) und inaktive Restriktionen blocken
 *  nicht. Liegt die QUELLE in der Restriktions-Region, blockt sie ebenfalls
 *  nicht (der Effekt entspringt dort). */
function _segmentCrossesRestrictingRegion(from, to, sense, ownRegionId = null) {
	const wantType = _senseRestrictionType(sense);
	if (!wantType) return false;
	const scene = canvas.scene;
	if (!scene) return false;
	const restricting = [];
	for (const region of scene.regions ?? []) {
		if (region.id === ownRegionId) continue;
		const restrictions = region.restrictions;
		if (!restrictions) continue;
		/* v1.1: V14-Regionen können Restrictions als Array ODER als
		   Objekt (Schlüssel = Typ) führen - beide Formen normalisieren. */
		const list = Array.isArray(restrictions)
			? restrictions
			: typeof restrictions?.[Symbol.iterator] === 'function'
				? [...restrictions]
				: restrictions && typeof restrictions === 'object'
					? Object.entries(restrictions).map(([type, cfg]) => ({ type, ...(cfg ?? {}) }))
					: [];
		for (const restriction of list) {
			if (restriction === null || restriction === undefined) continue;
			const type = String(restriction.type ?? '').trim();
			const enabled = restriction.enabled !== false && restriction.enabled !== undefined ? true : !!restriction.enabled;
			if (type.toUpperCase() === wantType && enabled) {
				restricting.push(region);
				break;
			}
		}
	}
	if (restricting.length === 0) return false;
	for (const region of restricting) {
		if (typeof region.testPoint !== 'function') continue;
		for (let i = 0; i <= 10; i++) {
			const t = i / 10;
			const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, elevation: canvas.scene?.flags?.elevation ?? 0 };
			try {
				const inside = region.testPoint(point);
				if (inside && i > 0) return true; // i === 0 = Quelle
				if (inside && i === 0) break;
			} catch (error) {
				// testPoint nicht verfügbar => Region blockt nicht
				break;
			}
		}
	}
	return false;
}

/**
 * Sinn-Blocker-Prüfung (S1): blockiert eine Kante/Region den Strahl
 * from -> to für den Sinn sense ('move' | 'sight' | 'sound')?
 * from/to: Token-Placeables ODER TokenDocuments ODER {x,y}-Punkte.
 * @returns {{blocked: boolean, error: boolean, reason: string|null}}
 *   error = Messung fehlgeschlagen (nicht blockiert, SL-Urteil wirkt).
 */
export function senseBlocked(from, to, sense, { ownRegionId = null, toleranceCells = 0 } = {}) {
	try {
		const scene = canvas.scene;
		if (!scene || !senseWallsEnabled()) return { blocked: false, error: false, reason: null };
		const pointOf = (t) => {
			if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) return { x: t.x, y: t.y };
			const center = t?.object?.center ?? t?.center ?? null;
			if (center && Number.isFinite(center.x)) return { x: center.x, y: center.y };
			const doc = t?.document ?? t;
			const w = doc?.width ?? 100;
			const h = doc?.height ?? 100;
			return { x: (doc?.x ?? 0) + w / 2, y: (doc?.y ?? 0) + h / 2 };
		};
		const a = pointOf(from);
		const b = pointOf(to);
		const cell = canvas.grid?.sizeX ?? canvas.grid?.w ?? canvas.scene?.grid?.size ?? 100;
		/* v1.2 F6 (Rudolfs Entscheidung "strikter Core-Clip", 20.11.2026):
		   Toleranz-Default 0 - Nachbarn hinter einer blockierenden Wand
		   zaehlen nicht mehr als offen; der Zweig greift nur, wenn ein
		   Aufrufer toleranceCells bewusst uebergibt. */
		if (toleranceCells > 0 && Math.hypot(b.x - a.x, b.y - a.y) <= cell * toleranceCells) {
			return { blocked: false, error: false, reason: null };
		}
		for (const edge of _sceneEdges()) {
			if (_edgeSenseValue(edge, sense) !== 'normal') continue;
			const pts = _edgeSegmentPoints(edge);
			if (!pts) continue;
			if (_segmentsIntersect(a, b, pts[0], pts[1])) {
				return { blocked: true, error: false, reason: 'edge' };
			}
		}
		if (_segmentCrossesRestrictingRegion(a, b, sense, ownRegionId)) {
			return { blocked: true, error: false, reason: 'region' };
		}
		return { blocked: false, error: false, reason: null };
	} catch (error) {
		console.warn('Symbaroum AoE: sense check failed', error);
		return { blocked: false, error: true, reason: null };
	}
}

/** Effektive Sinn-Filter einer Zonen-Konfiguration (Checkbox-Wert ODER
 *  Gruppen-Default je Referenz, siehe config.getZoneSenseDefaults). */
export function resolveZoneSenses(zoneData, reference) {
	const zone = zoneData ?? {};
	/* v1.2 (Rudolfs Testrunde 2, P3b): Der Zonen-Tab-Submit schreibt
	   Checkbox-Werte als STRING 'true' (value-Attribut), ungekastet
	   (additives Feld ohne Datenmodell-Schema) - der strikte === true-
	   Vergleich las darum JEDE Aktivierung beim naechsten Render wieder
	   verschwinden ("nicht dauerhaft aktivierbar"). Truthy-Toleranz:
	   true/'true'/1 gelten als aktiv. Explizit gesetzt = mindestens ein
	   Feld mit definiertem Wert (false/'false' zaehlt als bewusst aus,
	   solange KEIN anderes Feld aktiv ist); fehlen ALLE Felder (echte
	   Alt-Items), greifen die Gruppen-Defaults (getZoneSenseDefaults). */
	/* v1.4 (Rudolfs Freigabe 19.11. nach Testrunde 7): EIN Sinn je Zone -
	   die Core-Wall-Restriction kennt genau einen Typ pro Region, das
	   Dropdown des Zonen-Tabs schreibt system.areaZone.sense ('none'/
	   'move'/'sight'/'sound'; '' = nie gesetzt). Rueckgabe bleibt ein
	   ARRAY mit hchstens EINem Eintrag (Snapshot-Kompatibilitaet mit
	   schon platzierten Zonen, deren aoe.config.senses Arrays sind). */
	const sense = String(zone.sense ?? '').trim();
	if (sense === 'none') return [];
	if (['move', 'sight', 'sound'].includes(sense)) return [sense];
	const isExplicit =
		zone.senseMove !== undefined || zone.senseSight !== undefined || zone.senseSound !== undefined;
	const truthy = (v) => v === true || v === 'true' || v === 1;
	if (isExplicit) {
		const senses = [];
		if (truthy(zone.senseMove)) senses.push('move');
		if (truthy(zone.senseSight)) senses.push('sight');
		if (truthy(zone.senseSound)) senses.push('sound');
		return senses;
	}
	return game.symbaroum.config.getZoneSenseDefaults(String(reference ?? ''));
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
	/* Hymnen-Paket 1.1 (Rudolfs Testrunde 17.11., Befund „Tanzende Waffe“):
	   „Zone aktivieren: Nein“ deaktiviert die Zone dieser Kraft KOMPLETT -
	   getZoneConfig liefert null, alle Aufrufer behandeln die Kraft wie
	   unkonfiguriert (keine Warnung, kein Ausführungsdialog, keine
	   Platzierung, Zone-Tab-Platzieren-Knopf deaktiviert). Default 'yes'
	   hält den Altbestand unverändert. */
	if (String(zone.active ?? 'yes') === 'no') return null;
	const shape = String(zone.shape ?? '').trim();
	if (!shape) return null;
	/* AoE-Rest Paket 1: RING erlaubt HALBE Felder (Flammenwand-Ring:
	   radius 1,5 / innerWidth 0,5 / outerWidth 0,5 Felder, Rudolfs
	   Vorgabe „Dicke 1 Feld“ - Band 1-2 Felder, 3x3 innen frei). */
	const rawSizeNumber = Number(zone.size);
	const size =
		Number.isFinite(rawSizeNumber) && rawSizeNumber >= 1
			? shape === 'ring'
				? Math.round(rawSizeNumber * 2) / 2
				: Math.round(rawSizeNumber)
			: 1;
	const rawTargeting = String(zone.targeting ?? '').trim();
	/* v2.7 (Testrunde 7, P14): 'neutral' (nur Neutrale) und 'notallied'
	   (alles außer Verbündete) ergänzen die bestehenden Filter. */
	const targeting = ['enemies', 'allies', 'neutral', 'notallied'].includes(rawTargeting) ? rawTargeting : 'all';
	/* v2.8 (Rudolfs Grundsatz-Festlegung 13.11.): die fünf Sweep-Kräfte
	   (config.SWEEP_ZONE_POWERS) sind reine Zielwahl-Automatik - Modus
	   AUGENBLICKLICH erzwungen, Betreten-Trigger aus, Dauer bedeutungslos.
	   Die Konfiguration im Zone-Tab bleibt editierbar, wirkt für diese
	   Referenzen aber nicht (Hinweistext AOE.INFO_SWEEP im Tab). */
	const isSweepPower = game.symbaroum.config.SWEEP_ZONE_POWERS.includes(String(item?.system?.reference ?? ''));
	const rawMode = String(zone.mode ?? '').trim();
	const mode = isSweepPower || rawMode === 'instant' ? 'instant' : 'lasting';
	const rawTrigger = String(zone.trigger ?? '').trim();
	const trigger = !isSweepPower && rawTrigger === 'enter' ? 'enter' : '';
	const rawDuration = Math.round(Number(zone.duration));
	const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
	/* v2.1 (Rudolfs Testrunde-1-Entscheidung 2): Zielwahl-Ordnung der
	   automatischen Auslesung - 'marking' = Default, 'nearest' = Zonen-
	   nähe, 'scene' = Szenenreihenfolge. Eigene Markierungen des
	   Auslösens überschreiben die Ordnung (siehe _resolveZoneTargets). */
	const rawOrder = String(zone.targetOrder ?? '').trim();
	const targetOrder = ['nearest', 'scene'].includes(rawOrder) ? rawOrder : 'marking';
	/* Baustein E (Rudolfs Startsignal „Leg los“ 16.11.2026): Wirker-
	   Ausschluss bei Kraft-Zonen. STRING-Select auf dem Zonen-Tab (GM-
	   only, beide mystical-power-Blätter), additive template.json-
	   Änderung - 'never' (Default) entfernt den Wirker aus der Auto-
	   Auswahl (auch beim Filter „Alle“), 'always' erzwingt ihn trotz
	   Dispositionsfilter (Kraftstufen-Fälle wie Schwächende-Glyphe-
	   Meister/Schweben). Die manuelle Markierung gewinnt IMMER (v2.1-
	   Bypass unberührt), freie Zonen bleiben nie gefiltert (aoe.free).
	   Alte, vor dieser Version platzierte Zonen tragen das Feld nicht
	   im config-Snapshot -> undefined = unverändertes Verhalten. */
	const rawIncludeCaster = String(zone.includeCaster ?? '').trim();
	const includeCaster = rawIncludeCaster === 'always' ? 'always' : 'never';
	/* AoE-Rest Paket 1 (S1, Rudolfs 5 Detailantworten 18.11.): Sinn-
	   Filter der Zone - Checkbox-Werte (system.areaZone.senseMove/
	   senseSight/senseSound), Alt-Items ohne Felder fallen auf die
	   GRUPPEN-DEFAULTS je Referenz (config.getZoneSenseDefaults:
	   Hymnen Schall, Symbolik-Glyphen Sicht, Flammenwand Bewegung,
	   alles andere leer). Freie Zonen: Default leer, SL wählt im Dialog. */
	const senses = resolveZoneSenses(zone, String(item?.system?.reference ?? ''));
	/* v1.3 F9a/F9b (Rudolfs Freigabe 20.11.): Autoplatzierung (Default AUS)
	   und Versteckt (Default AUS) reisen als boolesche Kanonik mit -
	   Kraft-Zonen schreiben sie in den Config-Snapshot, Hymnen und
	   Dornenmantel lesen sie direkt am Anlegepfad. */
	const autoplace = zone.autoplace === true || String(zone.autoplace ?? '') === 'true';
	const hidden = zone.hidden === true || String(zone.hidden ?? '') === 'true';
	return { active: String(zone.active ?? 'yes'), shape, size, targeting, mode, trigger, duration, targetOrder, includeCaster, autoplace, hidden, senses };
}

/**
 * Region-Shape-Daten der Konfiguration (Felder × Szenen-Gridgröße in
 * Pixeln - N Felder auf JEDEM Grid, unabhängig von der Kalibrierung).
 * v1.4 (Rudolfs Freigabe 19.11.): Kegel-Winkel 60 Grad - der STANDARD-
 * Kegel des Core (Foundrys eigenes Kegel-Werkzeug), kein Hausregel-Winkel
 * mehr (v1.0-v1.3.1: 90 Grad); Regel-Folgeeffekt kleinere Kegelflaeche
 * von Rudolf mit der Umstellung abgenickt.
 */
function _buildShapeData(cfg, gridSize) {
	const base = { x: 0, y: 0, rotation: 0 };
	switch (cfg.shape) {
		case 'circle':
			return { ...base, type: 'circle', radius: cfg.size * gridSize };
		case 'cone':
			return { ...base, type: 'cone', radius: cfg.size * gridSize, angle: 60 };
		case 'line':
			/* v1.1 (Rudolfs Testrunde 1, P2a): Der Anker der Wand ist der
			   MITTELPUUNKT EINER LANGEN SEITE - als natives Rechteck mit
			   anchorX 0,5 / anchorY 0 (V14-RectangleShapeData hat die
			   Anchor-Felder, Release 14.349, Pivot = (x,y)): Die Wand
			   erstreckt sich ± halbe Länge um den Anker und 1 Feld dick
			   zur einen Seite, frei rotierbar um den Ankerpunkt. Die
			   v1.0-'line'-Typ-Ankerung legte den Klickpunkt an die
			   MITTLERE SCHMALE SEITE (Wand lief eingleisig vom Klick
			   weg). Breite = 1 Feld, Länge = size Felder. */
			return { ...base, type: 'rectangle', width: cfg.size * gridSize, height: gridSize, anchorX: 0.5, anchorY: 0 };
		case 'rectangle':
			return { ...base, type: 'rectangle', width: cfg.size * gridSize, height: cfg.size * gridSize };
		/* AoE-Rest Paket 1 (Flammenwand, Rudolfs Detailantwort 3):
		   nativer V14-RingShapeData - radius = Mittellinie in Feldern,
		   innerWidth/outerWidth = Bandbreiten je Seite (hier je 0,5
		   Felder => Band 1 Feld dick, Rudolfs Vorgabe „Dicke 1 Feld“).
		   Die Zonen-Maschinerie ist form-agnostisch (_regionCenter,
		   _collectRegionTokens/testPoint, _tokenDistance), der Ring
		   funktioniert dadurch in Region UND Measured-Template-Optik. */
		case 'ring':
			return { ...base, type: 'ring', radius: cfg.size * gridSize, innerWidth: 0.5 * gridSize, outerWidth: 0.5 * gridSize };
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
 * (RegionDocument.tokens), Fallback über TokenDocument#testInsideRegion
 * (F5; geometrischer Zentrumstest als letzte Rückfalle).
 * Versteckte Token bleiben außen vor.
 */
function _collectRegionTokens(region) {
	let tokens = [...(region.tokens ?? [])];
	if (tokens.length === 0) {
		/* F5 (Rudolfs Freigabe 20.11.): Core-Containment statt des toten
		   testPoint-Fallbacks (V14-Regionen kennen KEIN testPoint-Proto-
		   koll am RegionDocument) - TokenDocument#testInsideRegion ist
		   die kanonische Mitgliedschafts-Pruefung (bounds-basiert); der
		   geometrische Zentrumstest bleibt letzte Rueckfalle. */
		tokens = [];
		for (const placeable of canvas.tokens?.placeables ?? []) {
			const doc = placeable.document;
			if (!doc?.actor) continue;
			let inside = false;
			if (typeof doc.testInsideRegion === 'function') {
				try {
					inside = doc.testInsideRegion(region);
			} catch (regionTestError) {
					console.warn('Symbaroum AoE: testInsideRegion fallback failed', regionTestError);
				}
			}
			if (!inside && typeof region.testPoint === 'function') {
				const point = { x: placeable.center?.x ?? doc.x, y: placeable.center?.y ?? doc.y, elevation: doc.elevation ?? 0 };
				try {
					if (region.testPoint(point)) inside = true;
				} catch (pointError) {
					/* geometrische Rueckfalle gescheitert - Token bleibt draussen */
				}
			}
			if (inside) tokens.push(doc);
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
 * v2.7 (Testrunde 7, P14): 'neutral' = nur neutrale Token,
 * 'notallied' = alles außer Verbündete (Feinde UND Neutrale) - der
 * Bannsiegel-Fall für neutrale Untote/Abominationen in Davokar.
 */
function _filterTargets(tokens, targeting, casterToken, includeCaster = null) {
	let filtered;
	if (targeting === 'all') {
		filtered = tokens;
	} else if (targeting === 'enemies') {
		filtered = tokens.filter((td) => (td.disposition ?? 0) === CONST.TOKEN_DISPOSITIONS.HOSTILE);
	} else if (targeting === 'neutral') {
		filtered = tokens.filter((td) => (td.disposition ?? 0) === CONST.TOKEN_DISPOSITIONS.NEUTRAL);
	} else if (targeting === 'notallied') {
		filtered = tokens.filter((td) => (td.disposition ?? 0) !== CONST.TOKEN_DISPOSITIONS.FRIENDLY);
	} else {
		filtered = tokens.filter((td) => (td.disposition ?? 0) === CONST.TOKEN_DISPOSITIONS.FRIENDLY);
	}
	/* Baustein E (Rudolfs Startsignal „Leg los“ 16.11.2026): flexible
	   Wirker-Politik NUR bei explizit übergebener Einstellung (null =
	   unverändertes Verhalten, insbesondere freie Zonen und Alte
	   Zonen ohne includeCaster im Snapshot). 'never' entfernt den
	   Wirker aus der Auto-Auswahl (auch bei „Alle“), 'always' erzwingt
	   ihn über den Dispositionsfilter hinweg - VORBEDINGUNG bleibt,
	   dass er im Zonenbereich steht (er muss im URSPRÜNGLICHEN Token-
	   Satz liegen). Die manuelle Markierung läuft außerhalb dieses
	   Filters und gewinnt immer (v2.1-Bypass). */
	if (!casterToken || !includeCaster) return filtered;
	if (includeCaster === 'never') {
		return filtered.filter((td) => td?.id !== casterToken.id);
	}
	if (includeCaster === 'always') {
		if (!filtered.some((td) => td?.id === casterToken.id) && tokens.some((td) => td?.id === casterToken.id)) {
			return [casterToken, ...filtered];
		}
	}
	return filtered;
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
	/* v1.3 (Rudolfs Testrunde 4, P7): Der Betreten-Ausloeser laeuft
	   nicht mehr stur auf dem aktiven GM, sondern ROUTET auf den
	   Zonen-Besitzer (aoe.userId, gesetzt bei der Platzierung): Laeuft
	   der Besitzer-Spieler, oeffnet der Wuerfeldialog auf SEINEM Client
	   (reactive payloads, Korruption und Ergebnis-Karten laufen dort
	   bereits - die Ausloese-Taste der Zonen-Karte arbeitet seit v2.1
	   genauso). GM bleibt NUR Fallback: Besitzer nicht angemeldet oder
	   Besitzer ist selbst GM (dann = aktiver GM wie bisher). */
	'const r = (typeof region !== "undefined") ? region : null;',
	'const zmeta = r?.flags?.symbaroum?.aoe ?? r?.document?.flags?.symbaroum?.aoe ?? null;',
	'const zowner = zmeta?.userId ?? null;',
	'const zownerUser = zowner ? game.users.get(zowner) : null;',
	'const zexec = (zownerUser?.active && !zownerUser.isGM) ? zowner : (game.users.activeGM?.id ?? null);',
	'if (!zexec || game.user.id !== zexec) return;',
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
		color: zone.color ?? game.user.color,
		displayMeasurements: true,
		highlightMode: 'coverage',
		shapes: [shape],
		/* v1.3 F9b (Rudolfs Freigabe 20.11.): Zonen-Tab/Dialog-Schalter
		   'Versteckt' (hidden) stellt die Sichtbarkeit der Region auf GM -
		   Spieler sehen die Zone nicht, Clip und Ziel-Erfassung laufen
		   unangetastet weiter (Optik = Pruefung bleibt fuer die SL). */
		/* v1.4 F16 (Rudolfs Testrunde v1.3.1, T7): ENUM-Korrektur - v13/v14
		   kennen GAMEMASTER, nicht GM (undefined fiel auf den Default
		   LAYER zurueck, die Zone verschwang auch fuer die SL). */
		visibility: zone.config?.hidden === true ? (CONST.REGION_VISIBILITY?.GAMEMASTER ?? CONST.REGION_VISIBILITY.ALWAYS) : CONST.REGION_VISIBILITY.ALWAYS,
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
		/* v1.2 (Rudolfs Testrunde 2, P9): V14-Region-Ownership - Nicht-SLs
		   duerfen Regionen ERSTELLEN (REGION_CREATE, Default-Role Player),
		   aber NIE mit BEHAVIORS (Foundry-Regel: "non-GMs cannot add
		   behaviors to a region or create a region with behaviors" -
		   die Spieler-Platzierung der enter-Zone scheiterte darum mit dem
		   kryptischen GM-Fehler). Spieler-Platzierung: Behavior wird
		   ABGESTRIPPT und nach der Erstellung per System-Socket von einem
		   GM-Client nachinstalliert (aoeZoneBehaviorInstall-Handler in
		   registerAoeHooks); ohne GM online degradiert die Zone auf die
		   Ausloese-Taste (Warnung AOE.WARN_ZONE_BEHAVIOR_NO_GM). */
		if (game.user.isGM) {
			regionData.behaviors = [
				{
					type: 'executeScript',
					system: { source: ZONE_ENTER_BEHAVIOR_SOURCE, events: [CONST.REGION_EVENTS.TOKEN_ENTER] },
				},
			];
		}
	}
	/* v1.2 (P9): Der platzierende Nutzer bekommt OWNER auf der Region -
	    sonst koennte er die eigene Zone nicht neu flaggen (Ende-Taste,
	    Zonen-Karte) oder loeschen (Foundry-Ownership statt GM-Proxy). */
	if (!game.user.isGM) {
		regionData.ownership = { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? CONST.DOCUMENT_PERMISSION_LEVELS?.OWNER ?? 3 };
	}
	/* v1.4 (Rudolfs Freigabe 19.11. nach Testrunde 7: „Restricted Walls"
	   am Core"): JEDE Zone mit aktiviertem Sinn bekommt die CORE-Wall-
	   Restriction der Region (V14 RegionDocument.restriction {enabled,
	   type, priority}, foundryvtt #13365) - Foundry clippt die Flaeche
	   fuer ALLE Formen (inkl. Ring/Kuppel und Kegel) selbst, live und
	   identisch zum manuellen Region-Dialog. Der eigene radiale W0-Clip
	   ist entfernt (Rudolfs Grundsatz: IMMER Core-Funktionen nutzen).
	   Core kennt EINEN Typ je Region - der Zonen-Snapshot liefert
	   hoechstens EINEN Sinn (Dropdown, Ein-Sinn-Grenze). GM-Platzierung:
	   Restriction direkt im Anlege-Datensatz (Clip sofort sichtbar);
	   Spieler-Platzierung: V14 koennte das Anlegen beschraenken - die
	   Restriction wird erst nach dem Anlegen per System-Socket von
	   einem GM-Client gesetzt (_ensureCoreZoneRestriction, Muster
	   aoeZoneBehaviorInstall). */
	/* v1.4.1 (Freigabe 20.11.): auch SPIELER-Anlagen bringen die
	   Restriction gleich im Anlege-Datensatz mit (Vorschau-Clip beim
	   Positionieren), wenn die Client-Probe (probePlayerRestriction-
	   Create, einmalig gecacht) die Anlage erlaubt; andernfalls bleibt
	   es beim v1.4-Nachweg ueber den GM-Socket. */
	const zoneRestriction = _zoneRestrictionData(zone);
	if (zoneRestriction && (game.user.isGM || _playerRestrictionCreateCache === true)) {
		regionData.restriction = zoneRestriction;
		console.info('Symbaroum AoE [trace] W0: Core Wall Restriction gesetzt (Typ ' + zoneRestriction.type + ')', regionData.name);
	}
	if (canvas.level) regionData.levels = [canvas.level.id];
	return regionData;
}

/**
 * v1.4.1: Restrikions-Datensatz (Core-Ein-Typ-Grenze) der Zone - null,
 * wenn kein Sinn aktiviert oder das Wall-Setting aus ist.
 */
function _zoneRestrictionData(zone) {
	const senses = zone?.config?.senses ?? [];
	const senseType = ['move', 'sight', 'sound'].includes(senses[0]) ? senses[0] : null;
	if (!senseType || !senseWallsEnabled()) return null;
	return { enabled: true, type: senseType, priority: 0 };
}

/* v1.4.1 (Rudolfs Testrunde 8, Spielertest-Punkt 2 + Freigabe 20.11.):
   EINMALIGE Probe je Spieler-Client: Darf eine Spieler-Anlage die
   Restriction GLEICH im Anlege-Datensatz mitbringen (dann clippt die
   Vorschau schon beim Positionieren, wie beim GM) oder verwirft V14
   sie fuer Nicht-SLs (dann bleibt der nachgelagerte Socket-Weg)?
   Die Probe legt eine winzige, nur-SL-sichtbare Testregion MIT
   Restriction an und loescht sie sofort - Ergebnis wird gecacht, der
   Versuch laeuft je Client maximal einmal (GM wird direkt als erlaubt
   behandelt). Bei Ablehnung bleibt alles wie unter v1.4: Anlage ohne
   Restriction, Nachsetzung per GM-Socket (_ensureCoreZoneRestriction). */
let _playerRestrictionCreateCache = null;
async function probePlayerRestrictionCreate() {
	if (game.user.isGM) return true;
	if (_playerRestrictionCreateCache !== null) return _playerRestrictionCreateCache;
	if (!canvas?.scene || !senseWallsEnabled()) {
		_playerRestrictionCreateCache = false;
		return false;
	}
	let allowed = false;
	let created = null;
	try {
		created = await canvas.scene.createEmbeddedDocuments('Region', [
			{
				name: 'Symbaroum AoE Restriction Probe',
				shapes: [{ type: 'circle', x: 0, y: 0, radius: 1 }],
				visibility: CONST.REGION_VISIBILITY?.GAMEMASTER ?? CONST.REGION_VISIBILITY.ALWAYS,
				restriction: { enabled: true, type: 'move', priority: 0 },
			},
		]);
		allowed = Array.isArray(created) && created.length > 0;
	} catch (error) {
		allowed = false;
		console.info('Symbaroum AoE [trace] Spieler-Restriction-Anlage abgelehnt (Socket-Fallback aktiv):', error?.message ?? error);
	}
	if (Array.isArray(created) && created.length) {
		try {
			await canvas.scene.deleteEmbeddedDocuments('Region', created.map((d) => d.id));
		} catch (error) {
			console.warn('Symbaroum AoE: Restriction-Probe konnte nicht aufgeraeumt werden', error);
		}
	}
	_playerRestrictionCreateCache = allowed;
	console.info('Symbaroum AoE [trace] Spieler-Restriction-Anlage erlaubt:', allowed);
	return allowed;
}

/**
 * v1.4: Sicherstellen, dass die Core-Wall-Restriction auf der frisch
 * platzierten Region aktiv ist. GM: steht schon aus _zoneRegionData
 * (oder wird hier nachgesetzt); Spieler: per System-Socket von einem
 * GM-Client - ohne GM online bleibt die Zone OHNE Flaechen-Clip, der
 * Token-Sinn-Filter wirkt trotzdem je Ausloesung (Warnung).
 * @returns {Promise<string|null>} wirksamer Sinn-Typ oder null.
 */
async function _ensureCoreZoneRestriction(region, zone) {
	const wanted = _zoneRestrictionData(zone);
	if (!wanted) return null;
	if (region?.restriction?.enabled) return region.restriction.type;
	if (game.user.isGM) {
		try {
			await region.update({ restriction: { enabled: true, type: wanted.type, priority: 0 } });
			console.info('Symbaroum AoE [trace] W0: Core Wall Restriction nachgesetzt (Typ ' + wanted.type + ')', region?.name);
			return region.restriction?.enabled ? region.restriction.type : wanted.type;
		} catch (error) {
			console.error('Symbaroum AoE: Wall-Restriction-Setzung fehlgeschlagen', region?.name, error);
			return null;
		}
	}
	/* v1.4.2: Query-Anfrage (User#query) statt direktem Socket. */
	const installed = await requestAoeZoneInstall('restriction', {
		sceneId: canvas.scene?.id,
		regionIds: [region.id],
		restriction: { enabled: true, type: wanted.type, priority: 0 },
	});
	if (!installed) {
		ui.notifications.warn(game.i18n.localize('AOE.WARN_ZONE_RESTRICTION_NO_GM'));
		return null;
	}
	return wanted.type;
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
		ring: 'AOE.SHAPE_RING',
	}[cfg.shape];
	/* AoE-Rest Paket 1: Kuppel = Ring-Geometrie mit eigener Bezeichnung
	   (Rudolfs Detailantwort 5); Meter je Feld aus dem Zonen-Snapshot
	   (Flammenwand nutzt scene.grid.distance, alles andere 2 m). */
	const shapeLabel = aoe.dome ? game.i18n.localize('POWER_FLAMEWALL.FORM_DOME') : localize(shapeLabelKey ?? 'AOE.SHAPE_NONE');
	const metersPerField = Math.max(0.5, Number(aoe.metersPerField) || 2);
	const areaText = game.i18n.format('AOE.CHAT_AREA', {
		shape: shapeLabel,
		size: cfg.size,
		meters: Math.round(cfg.size * metersPerField * 10) / 10,
	});
	const tokens = _filterTargets(_collectRegionTokens(region), cfg.targeting, _casterTokenOfZone(aoe), aoe.free ? null : (cfg.includeCaster ?? null));
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
		/* AoE-Rest Paket 1: Doku-Zeilen der Platzierung (W0/W1-Vermerk,
		   Flammenwand-Pfeil-/Lagehinweise) - unter den Wirkungszeilen. */
		docLines: Array.isArray(aoe.docLines) ? aoe.docLines.filter((line) => !!line) : [],
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
			/* v1.3 (P8-Haertung): Die Neuerstellung ist fehlertolerant -
			   Rechte- oder Transportfehler brechen den Ausloesungslauf
			   nicht mehr ab (die alte Karte ist dann bereits weg). */
			try {
				await ChatMessage.create({
					speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize('DIALOG.SYSTEM_MESSAGE') }),
					content,
					flags: { symbaroum: { aoeZoneCard: { regionId: region.id, sceneId } } },
				});
			} catch (error) {
				console.warn('Symbaroum AoE: Zonen-Karte konnte nicht erneuert werden', region.name, error);
			}
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
			/* v1.3 (P8-Haertung): Auch das Stilllegen (Ende-Karte) ist
			   fehlertolerant - Spieler ohne Update-Recht an einer GM-Karte
			   ruempeln die Karte nicht ab, werfen aber keinen Fehler mehr
			   in den Zonen-Fluss (die Karte bleibt dann schlicht stehen). */
			try {
				await message.update({ content: `<div class="symbaroum aoe-card"><div class="aoe-card-line"><i class="fas fa-draw-polygon"></i><b>${_escapeHtml(region.name)}</b></div><div class="aoe-card-detail">${_escapeHtml(endText)}</div>${casterLine}</div>` });
			} catch (error) {
				console.warn('Symbaroum AoE: Ende-Karte konnte nicht stillgelegt werden', region.name, error);
			}
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
	const tokens = _filterTargets(regionTokens, aoe.config.targeting, _casterTokenOfZone(aoe), aoe.free ? null : (aoe.config.includeCaster ?? null));
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
	/* v1.2 F8 (Rudolfs Entscheidung "strikter Core-Clip", 20.11.2026):
	   Der eigene Sinn-Strahlen-Filter je Zone ist ENTFERNT - die
	   Core-Wall-Restriktion der Region clippt die sichtbare Flaeche
	   selbst, und die GUI-Optik ist die alleinige Quelle der Ziel-
	   Wahrheit (Optik = Pruefung). Ein zweiter Ray Quelle->Ziel
	   verdoppelt die Messung nur noch (Testrunde-v1.1-Diskussion:
	   Nachbar hinter einer duennen Wand, Sektormessung Saenger->Ziel
	   vs. Zonen-Clip). Nicht-zonenbasierte Pfade (Auren, Reaktionen,
	   Sichtweiten-Fallbacks) behalten senseBlocked; Altzonen ohne
	   Sinn-Snapshot laufen wie bisher ungefiltert. */
	/* v2.7 (Testrunde 7, Rudolfs Schritt 7 wörtlich + Musterablauf v1.1):
	   Bannsiegel-Zonen laufen auch mit LEEREM Anfangsbestand in die
	   AKTIVIERUNG - die Aktivierung kostet 1 temporäre Korruption und
	   beendet die Zone sofort, wenn kein gültiges Ziel übrig bleibt
	   (Kosten auch bei leerem Bestand). Nur der manuelle/automatische
	   AUSLÖSE-Pfad (kein Betreten): dort läuft die Aktivierung gegen
	   den Anfangsbestand. Alle anderen Kräfte behalten den generischen
	   Guard (keine Token in der Fläche, erneuter Versuch möglich). */
	const isSealZone =
		!aoe.free &&
		(aoe.sourceItemUuid ? fromUuidSync(aoe.sourceItemUuid)?.system?.reference : null) === 'banishingseal';
	/* v1.1 (Rudolfs Testrunde 1, P2a): Flammenwand ist manuell AUCH OHNE
	   Token in der Fläche auslösbar - die Aktivierung bucht die
	   Korruptionskosten und markiert die Zone als aktiviert (sie bleibt
	   Folge-Auslösungen laufen dann gegen den Snapshot). Betreten bleibt
	   ausgenommen (Eintreten ohne Ziel ist kein Fall). */
	const isFlamewallZone =
		!aoe.free && (aoe.sourceItemUuid ? fromUuidSync(aoe.sourceItemUuid)?.system?.reference : null) === 'flamewall';
	if (tokens.length === 0 && !(isSealZone && enteringTokenId === null) && !(isFlamewallZone && enteringTokenId === null)) {
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

/* v2.8 (Rudolfs Festlegung 13.11.): Aktivierungskosten einer Kraft-Zone
   traditionsgerecht bestimmen. Die A16-Engine (getItemModifierSymbolism)
   setzt für Mystiker der Tradition Symbolismus bei Kräften ihrer Tradi-
   tion den Kostenmodus corr1 (1 Punkt); jeder andere zahlt die Standard-
   Kraftkorruption 1W4. Der Leerbstands-Pfad bucht ohne Wurfdialog direkt
   über die GM-Karte, deshalb wird die Kostenbestimmung hier nachgebaut:
   corr1 -> 1, corrnone -> 0, alles andere (corrnormal/Default) -> 1W4-
   Wurf. (Die normale Aktivierung läuft dagegen über den Standard-Dialog
   und bucht über actor.getCorruption mit demselben Modus.) */
async function _powerZoneActivationCorruption(actor, item) {
	const mode = actor?.system?.combat?.combatMods?.abilities?.[item?.id]?.corruption ?? null;
	if (mode === game.symbaroum.config.TEMPCORRUPTION_NONE) return 0;
	if (mode === game.symbaroum.config.TEMPCORRUPTION_ONE) return 1;
	try {
		const roll = await new Roll('1d4').evaluate();
		return roll.total ?? 0;
	} catch (error) {
		console.warn('Symbaroum AoE: activation corruption roll failed', error);
		return 0;
	}
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
		/* v2.7 (Testrunde 7, Rudolfs korrigierter Ablauf-Spec Schritt 2/7
		   + Musterablauf v1.1): die Bannsiegel-Kategorie steht seit der
		   PLATZIERUNG im Zonen-Flag (aoe.sealCategoryId) - der Aktivierungs-
		   pfad filtert den Anfangsbestand gegen diese gespeicherte Kategorie
		   (Warnung je übersprungenem Token, das erste gültige Ziel wird
		   Primärziel des Würfeldialogs) und läuft bei leerem Rest mit
		   Kosten + sofortigem Zonen-Ende statt ins Leere (Schritt 7
		   wörtlich: 1 temporäre Korruption auch bei leerem Bestand).
		   Ohne gewählte Kategorie (null) bleibt der Filter aus. */
		let activationTokens = tokens;
		const isSealActivation = String(item.system?.reference ?? '') === 'banishingseal';
		if (isSealActivation && aoe.sealCategoryId) {
			activationTokens = [];
			/* v2.1 F24 (Rudolfs Testrunde v2, G6 - "Warnmeldungen wegen
			   falscher Kategorie in GM-Karte uebertragen"): Die Fehl-
			   kategorie-Hinweise laufen als EINE gefluesterte SL-Karte
			   (postSealCategoryGmCard, postAuraSkipDiagCard-Muster)
			   statt als Toast-Warnungen - die Meldung bleibt als Chat-
			   Beleg stehen. */
			const sealSkipLines = [];
			for (const tokenDoc of tokens) {
				if (tokenDoc?.actor && game.symbaroum.config.getCreatureCategory(tokenDoc.actor) !== aoe.sealCategoryId) {
					sealSkipLines.push(`<p>${game.i18n.format('POWER_BANISHINGSEAL.WARN_CATEGORY_MISMATCH', { targetname: tokenDoc.actor.name })}</p>`);
					continue;
				}
				activationTokens.push(tokenDoc);
			}
			if (sealSkipLines.length > 0) {
				await postSealCategoryGmCard(sealSkipLines);
			}
		}
		if (isSealActivation && activationTokens.length === 0) {
			/* Kosten + Ende: Korruptionsbuchung des Wirkers über die
			   GM-Karte (Muster Kampfautomatisierung), dann Zone beenden.
			   v2.8 (Rudolfs Festlegung 13.11.): die Kosten sind TRADITIONS-
			   GERECHT statt pauschal 1 - 1 temporäre Korruption gilt nur
			   für Mystiker der Tradition Symbolismus (A16-Engine), alle
			   anderen würfeln die Standard-Kraftkorruption 1W4. */
			const { createModifyTokenChatButton } = await import('./roll.js');
			const corruptionChange = await _powerZoneActivationCorruption(actor, item);
			await createModifyTokenChatButton([
				{
					tokenId: _casterTokenOfZone(aoe)?.id ?? null,
					actorId: actor.id,
					corruptionChange,
					label: game.i18n.format('POWER_BANISHINGSEAL.INFO_NO_VALID_TARGETS_COST', { count: corruptionChange }),
				},
			]);
			ui.notifications.info(game.i18n.localize('POWER_BANISHINGSEAL.INFO_NO_VALID_TARGETS'));
			await _endZone(region, 'trigger');
			return;
		}
		/* v1.1 (Rudolfs Testrunde 1, P2a): Flammenwand-Aktivierung mit
		   LEEREM Bestand (manuelle Ausloese-Taste ohne Token in der
		   Flaeche) - die Korruptionskosten werden trotzdem abgezogen
		   (GM-Karte), die Zone bleibt stehen und gilt ab jetzt als
		   aktiviert: der Aktivierungs-Snapshot wird direkt aus dem
		   Akteur gebaut (Resolute-Total, Modifikator/Gunst 0), damit
		   jede Folge-Ausloesung gegen diesen Snapshot laeuft, ohne
		   einen neuen Dialog zu oeffnen oder Kosten doppelt zu buchen. */
		const isFlamewallActivation = String(item.system?.reference ?? '') === 'flamewall';
		if (isFlamewallActivation && activationTokens.length === 0) {
			const { createModifyTokenChatButton } = await import('./roll.js');
			const corruptionChange = await _powerZoneActivationCorruption(actor, item);
			await createModifyTokenChatButton([
				{
					tokenId: _casterTokenOfZone(aoe)?.id ?? null,
					actorId: actor.id,
					corruptionChange,
					label: game.i18n.format('POWER_FLAMEWALL.INFO_EMPTY_TRIGGER_COST', { count: corruptionChange }),
				},
			]);
			aoe.activated = true;
			const attributeValue = Number(actor.system?.attributes?.resolute?.total);
			aoe.snapshot = {
				attributeName: 'resolute',
				attributeValue: Number.isFinite(attributeValue) ? attributeValue : 10,
				modifier: 0,
				favour: 0,
				sealCategoryId: null,
			};
			await region.setFlag('symbaroum', 'aoe', aoe);
			ui.notifications.info(game.i18n.localize('POWER_FLAMEWALL.INFO_EMPTY_TRIGGER'));
			return;
		}
		/* v2.5 (Testrunde 5, P16): In-Flight-Marke setzen - der Dialog
		   laeuft asynchron, bis zum Abschluss (aoeZoneActivationCompleted
		   aus captureZoneActivationSnapshot) keine weitere Ausloesung. */
		_zoneActivationInFlight.set(region.id, Date.now());
		await executeZonePower(actor, item, activationTokens, {
			suppressCorruption: false,
			zoneActivation: { regionId: region.id, sceneId: region.parent?.id, endAfter: aoe.mode === 'instant' },
			zoneExtras: aoe.sealCategoryId ? { sealCategoryId: aoe.sealCategoryId } : null,
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
	/* v2.7 (Testrunde 7, Rudolfs Schritt 2): die Kategorie gilt für die
	   GESAMTE Wirkdauer - Primärquelle ist die bei der PLATZIERUNG
	   gewählte Kategorie (aoe.sealCategoryId); der Aktivierungs-
	   Snapshot bleibt Fallback für v2.5/v2.6-Zonen ohne Platzierungs-
	   Kategorie. */
	const sealCategoryId = aoe.sealCategoryId ?? snapshot?.sealCategoryId ?? null;
	const zoneExtras = sealCategoryId ? { sealCategoryId } : null;
	/* v2.6 (Rudolfs Testrunde 6, P11a + Rudolfs Entscheidung „Caster als
	   Karten-Aktor"): Folge-Auslösungen zeigen den AUSLÖSER als Wirkenden
	   (Name + Porträt) statt der Zone - die Aktivierungskarte zeigte den
	   Wirker, die Maintain/Betreten-Karten liefen auf den Regionsnamen
	   („{Kraft} [GM]"), der Auslöser verschwand hinter dem GM-Namen.
	   Die Zone bleibt über den Regionsnamen (jetzt mit Auslöser-Namen)
	   auf der Karte benannt. */
	const zoneSourceName = actor?.name ?? region.name;
	const zoneSourceImg = actor?.img ?? null;
	/* v2.1 F24 (G6): Fehlkategorie-Meldungen der Runde sammeln und nach
	   der Schleife als EINE gefluesterte SL-Karte posten. */
	const sealSkipLines = [];
	for (const tokenDoc of tokens) {
		const tokenActor = tokenDoc.actor;
		if (!tokenActor) continue;
		/* v2.7 (Testrunde 7, stufenunabhängig): Fehlkategorie = Warnung +
		   Skip VOR der Snapshot-Probe (kein Test, keine Karte, keine
		   Wirkung) - für ALLE Stufen, der A36V-Kartenschaden-Pfad für
		   Adept/Master entfällt (sealPrimaryMismatch gibt es nicht mehr,
		   Rudolfs v2.7-Spec: „Warnung und Abbruch" ohne Stufen-
		   unterschied). Ohne gewählte Kategorie bleibt der Check aus
		   (SL-Buchhaltung). */
		if (
			item?.system?.reference === 'banishingseal' &&
			zoneExtras?.sealCategoryId &&
			game.symbaroum.config.getCreatureCategory(tokenActor) !== zoneExtras.sealCategoryId
		) {
			/* v2.1 F24 (G6): Diagnose auf der SL-Karte statt Toast (s.o.)
			   - Warnung + Skip bleiben stufenunabhaengig wie bisher. */
			sealSkipLines.push(`<p>${game.i18n.format('POWER_BANISHINGSEAL.WARN_CATEGORY_MISMATCH', { targetname: tokenActor.name })}</p>`);
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
	if (sealSkipLines.length > 0) {
		await postSealCategoryGmCard(sealSkipLines, actor ?? null);
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
	/* AoE-Rest Paket 1 (Flammenwand, Rudolfs Festlegung „Endprobe 1x/Runde
	   ab R2 automatisch, ähnlich wie Dornenmantel"): je Runden-Tick würfelt
	   das System die Willenskraft-Probe des Wirkers automatisch (1W20 <=
	   Resolute-Total, 20 misslingt immer) - Erfolg: die Wand hält (Karte),
	   Scheitern: Ende-Karte + Zone wird beendet. Der Tick läuft am Zug des
	   Auslösers (Combat) bzw. im Weltzeit-Takt - die PLATZIERUNGsrunde zählt
	   als R1, der erste Tick ist R2. Kein Wurfeldialog, kein A29-Reminder. */
	if (aoe.endprobe === 'resolute') {
		const casterActor = aoe.sourceActorUuid ? fromUuidSync(aoe.sourceActorUuid) : null;
		if (casterActor) {
			const resolute = Number(casterActor.system?.attributes?.resolute?.total);
			const target = Number.isFinite(resolute) ? resolute : 10;
			const probeRoll = await new Roll('1d20').evaluate();
			const succeeded = probeRoll.total !== 20 && probeRoll.total <= target;
			const lineKey = succeeded ? 'POWER_FLAMEWALL.CHAT_ENDPROBE_OK' : 'POWER_FLAMEWALL.CHAT_ENDPROBE_FAIL';
			const html = `<div class="symbaroum chat aoe-card"><div class="aoe-card-line"><i class="fas fa-draw-polygon"></i><b>${_escapeHtml(region.name)}</b></div><div class="aoe-card-detail">${_escapeHtml(game.i18n.format(lineKey, { name: casterActor.name ?? '', roll: probeRoll.total, target }))}</div></div>`;
			await ChatMessage.create({
				speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize('DIALOG.SYSTEM_MESSAGE') }),
				content: html,
			});
			if (!succeeded) {
				await _endZone(region, 'endprobe', game.i18n.localize('POWER_FLAMEWALL.END_MESSAGE'));
				return;
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
	if (!aoeEnabled()) return;
	const region = _getZoneRegion(regionId);
	if (!region) return;
	// nur Zonen mit Betreten-Trigger lösen automatisch aus
	const aoe = region.flags.symbaroum.aoe;
	/* v1.3 (Rudolfs Testrunde 4, P7): Der Enter-Ausloeser darf jetzt
	   auch auf dem Client des platzierenden Spielers laufen (Behavior-
	   Guard routet dorthin) - GM bleibt Ausfuehrer fuer GM-Zonen und
	   als Fallback. Voraussetzung wie bei der Ausloese-Taste:
	   _mayControlZone (Spieler-Setting + Eigentum an der eigenen Zone). */
	if (!game.user?.isGM && !_mayControlZone(aoe)) return;
	if (aoe.trigger !== 'enter' || aoe.mode === 'instant') return;
	// v2.4 (Entscheidung f): Markierungs-Zonen nie automatisch
	if (!aoe.free && aoe.config?.targetOrder === 'marking') return;
	const tokenDoc = region.parent?.tokens?.get(tokenId) ?? null;
	if (!tokenDoc?.actor || tokenDoc.hidden) return;
	// Zielgruppen-Check vor dem Auslösen (Dispositions-Filter gegen Wirker)
	const filtered = _filterTargets([tokenDoc], aoe.config.targeting, _casterTokenOfZone(aoe), aoe.free ? null : (aoe.config.includeCaster ?? null));
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

async function _endZone(region, source, customEndText = null) {
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
			/* v2.8 (Rudolfs Grundsatz-Festlegung 13.11. - Verallgemeine-
			   rung der v2.7-Bannsiegel-Ausnahme): beim Ende einer SWEEP-
			   KRAFT-ZONE (config.SWEEP_ZONE_POWERS) bleiben die gesetzten
			   Symbole auf den Token stehen - die Wirkungen hängen an den
			   Opfern, nicht am Gebiet: Ein-Runde-Symbole endet die A34-
			   Zugende-Engine, Maintain-Symbole die manuelle A23-Kette,
			   bis-Heilung bleibt SL-Verwaltung. Alle anderen Kraft-Zonen
			   räumen ihre Symbole weiter auf. */
			if (actor && abilityRef && !game.symbaroum.config.SWEEP_ZONE_POWERS.includes(abilityRef)) {
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
	/* AoE-Rest Paket 1: eigener Ende-Text (Flammenwand-Endprobe) vor
	   den Standard-Texten. */
	const textKey = source === 'manual' && aoe?.mode === 'instant' ? 'AOE.ABORT_MESSAGE' : 'AOE.END_MESSAGE';
	await _settleZoneCards(region, customEndText ?? game.i18n.localize(textKey));
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
/**
 * Kategorie-Dialog der Bannsiegel-Zone (v2.7, Rudolfs korrigierter
 * Ablauf-Spec Schritt 2 + Musterablauf v1.1): DIE Kategorie-Wahl der
 * Wirkdauer - läuft EINMAL bei der PLATZIERUNG (RAW: „Upon creation, the
 * mystic must choose what type of creature will be affected"), nicht je
 * Aktivierung (vorher: Dialog bei jeder Aktivierung mit Vorbelegung des
 * jeweiligen Primärziels, Rudolfs P2-Befund aus Testrunde 7). Keine
 * Vorbelegung - bei der Platzierung existiert noch kein Ziel. Die leere
 * Wahl „keine Kategorie" hält wie im manuellen Wirk-Dialog alle
 * Kategorie-Checks der Zone deaktiviert (SL-Buchhaltung). Abbruch des
 * Dialogs = keine Platzierung.
 */
function _sealZoneCategoryDialog(item) {
	return new Promise((resolve) => {
		const emptyLabel = game.i18n.localize('AOE.SEAL_ZONE_NO_CATEGORY');
		const categoryOptions =
			`<option value="">${emptyLabel}</option>` +
			Object.values(game.symbaroum.config.CREATURE_CATEGORY_SELECTION)
				.map((category) => `<option value="${category.id}">${game.i18n.localize(category.label)}</option>`)
				.join('');
		let settled = false;
		const settle = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const dialog = symbDialog({
			title: item.name,
			content: `<p>${game.i18n.localize('POWER_BANISHINGSEAL.DIALOG_TYPE')}</p>
				<p class="zone-hint">${game.i18n.localize('POWER_BANISHINGSEAL.ZONE_DIALOG_HINT')}</p>
				<select id="creatureCategory" style="width: 100%">${categoryOptions}</select>
				<input type="text" id="creatureSubtype" style="width: 100%">`,
			// P26 (Dialog-Audit): Modern-Chrome bei modernen Blättern
			classes: isModernDialogActive() ? modernDialogClasses('modern-seal-category-dialog') : [],
			buttons: {
				cast: {
					icon: '<i class="fas fa-check"></i>',
					label: game.i18n.localize('POWER_BANISHINGSEAL.BUTTON_APPLY'),
					callback: (html) => {
						settle({
							categoryId: html[0].querySelector('#creatureCategory').value,
							subtype: html[0].querySelector('#creatureSubtype').value.trim(),
						});
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: game.i18n.localize('BUTTON.CANCEL'),
					callback: () => settle(null),
				},
			},
			default: 'cast',
		});
		// ESC / Kopf-X ohne Tastenwahl = Abbruch (keine Platzierung)
		try {
			dialog.addEventListener('close', () => settle(null));
		} catch (error) {
			console.warn('Symbaroum AoE: seal category dialog close listener unavailable', error);
		}
	});
}

/* =====================================================================
 * AoE-Rest Paket 1 (Rudolfs Startsignal „Baue es“ 18.11.2026):
 * FLAMMENWAND - Weg (b), die einzige echte DAUERHAFT-Kraft-Zone des
 * Kraft-Zonen-Inventars (52/53-Ausnahmefall; SWEEP_ZONE_POWERS bleibt
 * unverändert). RAW: Material Schwefel+Quecksilber, bleibt bis Scheitern
 * der Willenskraft-Endprobe, Schaden 1W12 Feuer; Form WAHLBAR durch den
 * Wirker: Novize Linie (20 m fix), Adept Kreis, Meister alle inkl.
 * Ring/Kuppel (Kuppel = Ring-Geometrie mit eigener Bezeichnung,
 * abweichende Mechanik bleibt SL-Verwaltung).
 * =================================================================== */

/** Zonen-Konfiguration der Flammenwand: unaufgelöst (keine Form im
 *  Zone-Tab) gilt die RAW-Grundeinstellung - dauerhaft, Betreten-Trigger,
 *  unbegrenzte Dauer (Ende über die automatische Endprobe), Zielfilter
 *  Feinde. Die Form liefert der Platzierungs-Dialog (Stufen-modelliert). */
function _flamewallZoneConfig(item) {
	let cfg = getZoneConfig(item);
	if (!cfg) {
		cfg = {
			active: 'yes',
			shape: 'line',
			size: 0,
			targeting: 'enemies',
			mode: 'lasting',
			trigger: 'enter',
			duration: 0,
			targetOrder: 'nearest',
			includeCaster: 'never',
			senses: ['move'],
		};
	}
	if (!cfg.senses || cfg.senses.length === 0) cfg.senses = game.symbaroum.config.getZoneSenseDefaults('flamewall');
	return cfg;
}

/** Form-Auswahl der Flammenwand (stufen-modelliert, Rudolfs Festlegung):
 *  Novize Linie, Adept +Kreis, Meister +Ring +Kuppel (Meister kann auch
 *  die Novizen-/Adept-Fassung wirken - RAW). Abbruch = keine Platzierung.
 *  @returns {Promise<object|null>} {shape, dome} oder null (Abbruch). */
function _flamewallShapeDialog(item) {
	const level = item?.getLevel?.()?.level ?? 1;
	/* v1.2 (Rudolfs Testrunde 2, 3a): Rudolf braucht den Kreis nicht -
	   entfernt. Auswahl: Novize Linie, Adept +Ring, Meister +Kuppel.
	   Bereits platzierte Kreis-Zonen bleiben funktionfaehig (Shape-Case
	   bleibt unterstuetzt, Zonenkarte labelt AOE.SHAPE_CIRCLE). */
	const options = [{ id: 'line', label: game.i18n.localize('POWER_FLAMEWALL.FORM_LINE'), icon: 'fa-ruler-horizontal' }];
	/* v1.1 (Rudolfs Testrunde 1, P3): Ring ab ADEPT (vorher Meister-
	   only - Adept zeigte nur Kreis); Kuppel bleibt Meister. */
	if (level >= 2) {
		options.push({ id: 'ring', label: game.i18n.localize('POWER_FLAMEWALL.FORM_RING'), icon: 'fa-circle-notch' });
	}
	if (level >= 3) {
		options.push({ id: 'dome', label: game.i18n.localize('POWER_FLAMEWALL.FORM_DOME'), icon: 'fa-globe' });
	}
	return new Promise((resolve) => {
		let settled = false;
		const settle = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const radios = options
			.map(
				(opt, idx) =>
					`<label class="lblfavour"><input type="radio" name="flamewall-shape" value="${opt.id}"${idx === 0 ? ' checked' : ''}/> <i class="fas ${opt.icon}"></i> ${opt.label}</label>`
			)
			.join('');
		const modern = isModernDialogActive();
		const content = `<div class="symbaroum${modern ? ' modern-roll-dialog' : ' dialog'}">
			<p>${game.i18n.localize('POWER_FLAMEWALL.DIALOG_FORM_HINT')}</p>
			<div class="favour">${radios}</div>
			<p class="zone-hint">${game.i18n.localize('POWER_FLAMEWALL.INFO_ARROWS')}</p>
		</div>`;
		const dialog = symbDialog({
			title: item.name,
			content,
			classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(modern ? modernDialogClasses('modern-flamewall-shape-dialog') : [])],
			buttons: {
				cast: {
					icon: '<i class="fas fa-check"></i>',
					label: game.i18n.localize('POWER_BANISHINGSEAL.BUTTON_APPLY'),
					callback: (html) => {
						const chosen = html[0].querySelector('input[name="flamewall-shape"]:checked')?.value ?? 'line';
						settle({ shape: chosen === 'dome' ? 'ring' : chosen, dome: chosen === 'dome' });
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: game.i18n.localize('BUTTON.CANCEL'),
					callback: () => settle(null),
				},
			},
			default: 'cast',
			width: 460,
		});
		try {
			dialog.addEventListener('close', () => settle(null));
		} catch (error) {
			console.warn('Symbaroum AoE: flamewall shape dialog close listener unavailable', error);
		}
	});
}

/* ---------------------------------------------------------------------
 * v1.4 (Rudolfs Freigabe 19.11., Testrunde 7 / „Restricted Walls"-Beob-
 * achtung): Der eigengebute radiale W0-Form-Clip (v1.0 Raster-BFS,
 * v1.3/v1.3.1 radialer Kern-Clip) ist ENTFERNT. Foundry V14 clippt
 * Regionen selbst ueber die native Wall-Restriction (RegionDocument.
 * restriction {enabled, type, priority}, foundryvtt-Issue #13365 - genau
 * die Option, die Rudolf manuell in den Region-Eigenschaften bestaetigt
 * hat): fuer ALLE Formen (inkl. Ring/Kuppel und Kegel), live und direkt
 * beim Platzieren sichtbar. Die Restriction setzt JEDE Zonen-Platzierung
 * (Kraft-, Sweep-, freie Zonen und Hymnen-Gesangsflaechen) in
 * _zoneRegionData bzw. ueber _ensureCoreZoneRestriction; die Doku-Zeile
 * auf der Zonenkarte heisst AOE.CHAT_W0_CORE. Der Token-Sinn-Filter
 * (Sense-Skip-Karten je Ausloesung) bleibt davon unberuehrt.
 * ------------------------------------------------------------------- */
export async function placeZoneFromItem(item) {
	if (!item) return;
	if (!mayPlaceZone(item)) return;
	/* v1.4 F15 -> v2.2 F25 (Rudolfs Testrunde v2.1, A1/A2/G4/G6):
	   Kraefte mit EIGENER Zonen-Maschine nie generisch anlegen - der
	   Dornenmantel-Einzelcheck ist jetzt die zentrale Masterliste
	   OWN_ZONE_REFERENCES (Dornenmantel, Auren, Glyphe), geprueft an
	   JEDER generischen Eintrittsstelle. Deckt auch den Platzieren-
	   Knopf im Zonen-Tab ab (Alt-Regionen aus Testrunden bitte manuell
	   loeschen). */
	if ((game.symbaroum.config.OWN_ZONE_REFERENCES ?? []).includes(String(item.system?.reference ?? ''))) {
		console.info('Symbaroum Hymnen [trace] Eigene Zonen-Maschine: generische Zonen-Anlage unterdrueckt (F25)', String(item.system?.reference ?? ''));
		return;
	}
	if (!aoeEnabled()) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_DISABLED'));
		return;
	}
	if (!canvas?.scene) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_NO_SCENE'));
		return;
	}
	/* v1.1 (Rudolfs Testrunde 1, P14): Foundry verweigert Dokument-
	   Änderungen für Nicht-SLs bei PAUSIERTEN Spiel mit dem kryptischen
	   „may only be modified by a GM or Assistant GM user" - die Zone-
	   Platzierung (placeRegions) lief für Spieler genau in diesen
	   Fehler. Vor der interaktiven Platzierung klar avisieren. */
	if (!game.user.isGM && game.paused) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_PAUSED'));
		return;
	}
	/* AoE-Rest Paket 1: Flammenwand - einzige echte Dauerhaft-Kraft-
	   Zone; ohne Zone-Tab-Konfiguration gilt die RAW-Grundeinstellung
	   (_flamewallZoneConfig), die FORM wählt der Wirker im Stufen-
	   Dialog (Novize Linie, Adept +Kreis, Meister +Ring/Kuppel). */
	const isFlamewall = String(item.system?.reference ?? '') === 'flamewall';
	let cfg = getZoneConfig(item);
	if (isFlamewall && !cfg) cfg = _flamewallZoneConfig(item);
	if (!cfg) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_NO_CONFIG'));
		return;
	}
	/* Flammenwand-Formwahl (Rudolfs Festlegung: Form WAHLBAR durch den
	   Wirker, stufen-modelliert; Abbruch = keine Platzierung). Die
	   Novizen-Linie ist 20 m FIX (10 m je Seite, Mittelpunkt vom SL 1
	   Feld vor den Wirker gelegt, frei rotierbar) - Meter -> Felder über
	   scene.grid.distance (2-m-Grid = 10 Felder, Rudolfs Detail-
	   antwort 4). Ring: radius 1,5 / Band 0,5+0,5 (Detailantwort 3),
	   Kuppel = Ring-Geometrie mit eigener Bezeichnung (Antwort 5). */
	let dome = false;
	if (isFlamewall) {
		const shapeChoice = await _flamewallShapeDialog(item);
		if (!shapeChoice) return;
		cfg.shape = shapeChoice.shape;
		dome = !!shapeChoice.dome;
		/* RAW-Kanonik der Ausnahme-Dauerhaft-Zone: dauerhaft, Betreten-
		   Trigger, unbegrenzt (Ende über die Endprobe), Anfangsbestand
		   aktiv (Linie auf Feindgruppe = automatische Verwundung) -
		   Markierungs-Zonen lösen nie automatisch aus, deshalb Zielwahl-
		   Fallback 'nearest'. */
		cfg.mode = 'lasting';
		cfg.trigger = 'enter';
		cfg.duration = 0;
		if (cfg.targetOrder === 'marking') cfg.targetOrder = 'nearest';
		if (cfg.shape === 'line') {
			const metersPerField = Math.max(0.5, Number(canvas.scene.grid?.distance) || 2);
			cfg.size = Math.max(1, Math.round(20 / metersPerField));
		} else if (cfg.shape === 'ring') {
			/* v1.1 (Rudolfs Testrunde 1, P3): Radius 2,5 (vorher 1,5) -
			   der Innenring wächst um ein Feld, die Felder um den
			   Wirker liegen frei (Innenradius 2 Felder, Band 1 Feld
			   dick im Abstand 2-3 Felder, deckt Nahkampfangreifer). */
			cfg.size = 2.5;
		}
	}
	const casterToken = _resolveCasterToken(item);
	const actor = item.actor ?? null;
	/* v2.7 (Testrunde 7, Rudolfs korrigierter Ablauf-Spec Schritt 2):
	   Bannsiegel-Zonen fragen die Kreaturen-Kategorie EINMAL vor der
	   Platzierung ab und speichern sie für die GESAMTE Wirkdauer im
	   Zonen-Flag (aoe.sealCategoryId). Aktivierung und jede Folge-
	   Auslösung prüfen gegen diese gespeicherte Kategorie - der
	   Kategorie-Dialog läuft NICHT mehr bei der Aktivierung. */
	let sealCategoryId = null;
	let sealSubtype = '';
	if (String(item.system?.reference ?? '') === 'banishingseal') {
		const sealChoice = await _sealZoneCategoryDialog(item);
		if (!sealChoice) return;
		sealCategoryId = sealChoice.categoryId || null;
		sealSubtype = sealChoice.subtype ?? '';
	}
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
		/* v2.7 (Testrunde 7, P13): bei Platzierung gewählte Bannsiegel-
		   Kreaturen-Kategorie, gilt für die gesamte Wirkdauer. null =
		   „keine Kategorie" (alle Kategorie-Checks aus, SL-Buchhaltung). */
		sealCategoryId,
		sealSubtype,
		userId: game.user.id,
		/* Baustein E: includeCaster reist mit dem Zonen-Snapshot (Muster
		   sealCategoryId) - jede Folge-Auslösung (Betreten, Maintain-Runde,
		   Auto-Auswahl) liest die Platzierungs-Einstellung, auch nach
		   Blatt-Änderungen. Sinn-Filter (S1) reisen mit - Altzonen ohne
		   das Feld bleiben ungefiltert. */
		/* v1.3 F9a/F9b: autoplace/hidden reisen im Snapshot mit (Muster
		   includeCaster) - jede Anlege-Art liest die Platzierungs-Einstellung,
		auch nach spaeteren Blatt-Aenderungen. */
		config: { shape: cfg.shape, size: cfg.size, targeting: cfg.targeting, targetOrder: cfg.targetOrder, includeCaster: cfg.includeCaster, autoplace: cfg.autoplace, hidden: cfg.hidden, senses: cfg.senses ?? [] },
		metersPerField: isFlamewall ? Math.max(0.5, Number(canvas.scene.grid?.distance) || 2) : 2,
		/* AoE-Rest Paket 1 - Flammenwand: automatische Willenskraft-
		   Endprobe 1x je Runde ab R2 (Rudolfs Festlegung „ähnlich wie
		   Dornenmantel", Endkarte bei Scheitern) + Kuppel-Marker (Ring-
		   Geometrie, eigene Bezeichnung auf der Karte) + Doku-Zeilen
		   (Pfeile verbrennen = SL-Verwaltung, RAW-Lagehinweis Linie). */
		endprobe: isFlamewall ? 'resolute' : '',
		dome,
		/* v1.1 (Rudolfs Testrunde 1, P2a): Flammenwand-Zone in der
		   von Rudolf gewählten Farbe #c7561a statt der Nutzer-Farbe. */
		color: isFlamewall ? '#c7561a' : null,
		docLines: isFlamewall
			? [
					game.i18n.localize('POWER_FLAMEWALL.INFO_ARROWS'),
					cfg.shape === 'line' ? game.i18n.localize('POWER_FLAMEWALL.INFO_LINE_PLACEMENT') : '',
			  ].filter((line) => !!line)
			: [],
		/* v2.6 (Rudolfs Testrunde 6, P12): der Zonen-Name nennt den
		   AUSLÖSER (den Kraft besitzenden Akteur) statt des platzieren-
		   den USERS - bei GM-Platzierung stand sonst „[GM]" im Namen
		   und damit auf jeder Zonen-/Ende-/Ergebniskarte. Freie Zonen
		   (kein Akteur) behalten den platzierenden Nutzer. */
		regionName: game.i18n.format('AOE.REGION_NAME', { name: item.name, user: actor?.name ?? game.user.name }),
	};
	/* v1.4.1: Spieler-Restric-Probe (einmalig gecacht) VOR dem Datensatz-
	   Bau - erlaubt V14 die Anlage mit Restriction, bringt der Spieler-
	   Zone den Vorschau-Clip beim Positionieren mit. */
	await probePlayerRestrictionCreate();
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
	/* v1.2 (Rudolfs Testrunde 2, P9): enter-Zonen von Spielern wurden
	   ohne Behavior platzierbar (V14 verbietet Behaviors fuer Nicht-SLs)
	   - der Betreten-Trigger wird jetzt per System-Socket von einem
	   GM-Client nachinstalliert. Ohne GM online: Warnung, die Zone
	   bleibt mit ihrer Ausloese-Taste voll bedienbar. */
	if (!game.user.isGM && zone.mode === 'lasting' && zone.trigger === 'enter' && zone.config?.targetOrder !== 'marking') {
		/* v1.3 (P4): auch der Transportfehler/Werfen des Emits darf den
		   Platzierungslauf nicht mehr abstuerzen - ohne installiertes
		   Behaviour bleibt die Ausloese-Taste (Warnung wie gehabt). */
		/* v1.4.2: Query-Anfrage (User#query) statt direktem Socket -
		   die alte Array-Auswertung konnte die GM-Antwort prinzipiell
		   nie sehen (siehe aoeZoneInstallQueryHandler). */
		const installed = await requestAoeZoneInstall('behavior', {
			sceneId: canvas.scene?.id,
			regionIds: regions.map((r) => r.id),
		});
		if (!installed) {
			ui.notifications.warn(game.i18n.localize('AOE.WARN_ZONE_BEHAVIOR_NO_GM'));
		}
	}
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
		/* v1.4 (Rudolfs Freigabe 19.11. nach Testrunde 7): Die Core-Wall-
		   Restriction (fuer GM in _zoneRegionData gesetzt, fuer Spieler
		   per GM-Socket) clippt die Flaeche fuer ALLE Formen; die Doku-
		   Zeile nennt den wirksamen Sinn. Der eigene W0/W1-Einzelclip
		   ist ersatzlos entfernt (siehe Abschnittskommentar oben). */
		const restrictedSense = await _ensureCoreZoneRestriction(region, zone);
		if (restrictedSense) {
			zone.docLines = [
				...(zone.docLines ?? []),
				game.i18n.format('AOE.CHAT_W0_CORE', { sense: game.i18n.localize(`AOE.SENSE_${restrictedSense.toUpperCase()}`) }),
			];
			await region.setFlag('symbaroum', 'aoe', zone);
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
			const standing = _filterTargets(_collectRegionTokens(region), cfg.targeting, casterToken, zone.free ? null : (cfg.includeCaster ?? null));
			if (standing.length > 0) {
				await _executeZoneTrigger(region, { manual: false });
				await _updateZoneCards(region);
			}
		}
	}
}

/* =====================================================================
 * Hymnen-Paket 1.1 (Rudolfs Entscheidung „A: Eigene Zone über Zone-Tab“,
 * 17.11.): Gesangsbereich der Hymnen. Rein geografische Region OHNE
 * Zonen-Karten, Auslöse-Taste, Trigger oder Dauer-Tick - die Fläche
 * lebt genau so lange wie der Gesang (Ende über endActiveHymns) und
 * begrenzt die Betroffenen (Sänger immer, sonst Verbündete in der
 * Fläche; Re-Scan je Maintain-Runde in item.js). Ohne konfigurierte
 * Zone gilt die bisherige Sichtweiten-Abstraktion (keine Platzierung).
 * =================================================================== */

/**
 * Platziert den Gesangsbereich einer Hymne interaktiv (gleiche Drag-
 * Platzierung wie Kraft-Zonen: Kreis kann mittig um den Sänger gezogen
 * werden, Kegel kann an ihm beginnen, Rotation frei).
 * @returns {Promise<object>} {configured: false} = kein Gesangsbereich
 *   konfiguriert (Sichtweiten-Modus); {configured: true, cancelled: true}
 *   = Platzierung abgebrochen (Rechtsklick - Gesang wird NICHT gewirkt);
 *   {configured: true, region} = platzierte Region.
 */
/* Hymnen-Paket 1.2: Brücke zwischen Ausführungsdialog und usePower
   (Rudolfs Entscheidung 4: die Gesangsfläche wird VOR dem Gesangs-
   dialog platziert, das functionStuff entsteht aber erst in usePower).
   Genau EIN Eintrag je Wirker, Consume-once - ein vergessener Eintrag
   (usePower lief nach der Platzierung nie) wird beim nächsten
   Erstgesang-Platzieren mitgekehrt (siehe den Zone-Button unten). */
const pendingHymnZones = new Map();

/** Frisch platzierte Gesangsfläche für den nächsten usePower-Lauf
    dieses Wirkers hinterlegen. */
export function setPendingHymnZone(actorId, info) {
	if (!actorId || !info?.regionId) return;
	pendingHymnZones.set(String(actorId), info);
}

/** Ausstehende Gesangsfläche abholen und LÖSCHEN (Consume-once);
    null, wenn kein passender Lauf folgte. */
export function takePendingHymnZone(actorId) {
	const key = String(actorId ?? '');
	if (!key) return null;
	const info = pendingHymnZones.get(key) ?? null;
	pendingHymnZones.delete(key);
	return info;
}

/* Hymnen-Paket 1.2 (aus item.js hierher verlegt, jetzt Export): Liefert
   die Referenz des Gesangs, den dieser Wirker auf der Szene aktuell
   hält (A23-Marker flagData.caster + flagData.ability), sonst null -
   Grundlage für die Aufrechterhalten-Vorbelegung (item.js preDialog-
   HymnChoice) und dafür, dass der Ausführungsdialog des Erstgesangs
   bei einem LAUFENDEN Gesang (Maintain-Klick) schweigt. */
export function hymnActiveForCaster(actor) {
	if (!actor) return null;
	for (const token of canvas.tokens?.placeables ?? []) {
		if (!token.actor?.effects) continue;
		for (const effect of token.actor.effects) {
			const fd = effect.getFlag(game.system.id, "flagData");
			if (fd?.caster === actor.id && game.symbaroum.config.HYMN_REFERENCES.includes(fd?.ability)) return fd.ability;
		}
	}
	return null;
}

export async function placeHymnZone(item) {
	if (!item || !aoeEnabled() || !canvas?.scene) return { configured: false };
	if (!mayPlaceZone(item)) return { configured: false };
	const cfg = getZoneConfig(item);
	if (!cfg) return { configured: false };
	const casterToken = _resolveCasterToken(item);
	const actor = item.actor ?? null;
	const gridSize = Math.max(1, Math.round(canvas.scene.grid?.size ?? 0)) || 100;
	const shape = _buildShapeData(cfg, gridSize);
	if (!shape) return { configured: false };
	/* Kein flags.symbaroum.aoe - die Region ist für die Zonen-Maschinerie
	   unsichtbar (keine Karten, kein Betreten-Auslöser, kein Runden-Tick);
	   eigene Kennung hymnzone für Re-Scan und Ende-Aufräumen. */
	const regionData = {
		name: game.i18n.format('POWER_HYMN.REGION_NAME', { powername: item.name, user: actor?.name ?? game.user.name }),
		color: game.user.color,
		displayMeasurements: true,
		highlightMode: 'coverage',
		shapes: [shape],
		visibility: CONST.REGION_VISIBILITY.ALWAYS,
		'flags.core.MeasuredTemplate': true,
		flags: {
			symbaroum: {
				hymnzone: {
					ref: String(item.system?.reference ?? ''),
					casterId: actor?.id ?? null,
					casterName: actor?.name ?? game.user.name,
				},
			},
		},
	};
	/* v1.4.1 (Rudolfs Testrunde 8, Punkt 7): Gesangsflaechen-Restric-
	   tion DIREKT im Anlege-Datensatz (GM; Spieler, wenn die Client-
	   Probe es erlaubt) - die Vorschau clippt damit beim POSITIONIE-
	   REN wie bei allen anderen Zonen. Vorher lief die Restriction
	   erst nach dem Bestaetigungs-Klick ueber _ensureCoreZone-
	   Restriction nach (trace 'nachgesetzt'). Der _ensure-Aufruf
	   bleibt als Fallback (fruehe Rueckgabe, wenn schon gesetzt). */
	await probePlayerRestrictionCreate();
	const hymnRestriction = _zoneRestrictionData({ config: { senses: cfg.senses ?? [] } });
	if (hymnRestriction && (game.user.isGM || _playerRestrictionCreateCache === true)) {
		regionData.restriction = hymnRestriction;
		console.info('Symbaroum AoE [trace] W0: Core Wall Restriction gesetzt (Typ ' + hymnRestriction.type + ')', regionData.name);
	}
	/* v1.2 F1: Level-Passung des Anhangs - "Attached Token" verlangt die
	   Region in GENAU EINEM Level, das zum Sänger-Token passt; die Ebene
	   des TOKENS schlägt die gerade aktive Client-Ebene (die SL darf beim
	   Platzieren eine andere Ebene gewählt haben). */
	const casterLevelIdAtPlace = _tokenLevelId(casterToken?.document ?? casterToken ?? null);
	if (casterLevelIdAtPlace) regionData.levels = [casterLevelIdAtPlace];
	/* v1.3 F9a/F9b/F10 (Rudolfs Freigabe 20.11.): Autoplatzierung per
	   Zonen-Tab (system.areaZone.autoplace, Default AUS). AN: Die Zone
	   wird DIREKT mittig auf das Sänger-Token gelegt (Anlage ohne
	   Picker, Position = Token-Mitte in den Shape-Daten) und angehängt -
	   der Core zieht sie live mit, ein SL-Versatz entsteht nicht (das
	   v1.2-Zentrieren-danach ist mit dem Notfall-Follow entfallen, F11).
	   AUS: Interaktive Platzierung (Core-Picker), die Position wählt
	   die SL, der Anhang konserviert ihren Abstand. hidden (F9b) stellt
	   die Sichtbarkeit auf GM, die Farbe ist Rudolfs Wunschton #434c43
	   statt der Nutzerfarbe (Flammenwand-Präzedenz). Ohne Wirker-Token
	   läuft immer der Picker (KonServe-Faelle, kein Anhang). */
	const autoplaceOn = (item.system?.areaZone?.autoplace === true) || String(item.system?.areaZone?.autoplace ?? '') === 'true';
	const hymnHidden = (item.system?.areaZone?.hidden === true) || String(item.system?.areaZone?.hidden ?? '') === 'true';
	regionData.visibility = hymnHidden ? (CONST.REGION_VISIBILITY?.GAMEMASTER ?? CONST.REGION_VISIBILITY.ALWAYS) : CONST.REGION_VISIBILITY.ALWAYS;
	regionData.color = '#434c43';
	const hymnCastDoc = casterToken?.document ?? casterToken ?? null;
	if (autoplaceOn && hymnCastDoc) {
		shape.x = (Number(hymnCastDoc.x) || 0) + ((Number(hymnCastDoc.width) || 1) * gridSize) / 2;
		shape.y = (Number(hymnCastDoc.y) || 0) + ((Number(hymnCastDoc.height) || 1) * gridSize) / 2;
		regionData.shapes = [shape];
	}
	let regions = null;
	if (autoplaceOn && hymnCastDoc) {
		try {
			const created = await canvas.scene.createEmbeddedDocuments('Region', [regionData]);
			regions = Array.isArray(created) ? created : null;
		} catch (error) {
			console.error('Symbaroum Hymnen: Gesangsbereich-Anlage fehlgeschlagen', error);
			return { configured: true, cancelled: true };
		}
	} else {
		try {
			regions = await canvas.regions.placeRegions([regionData]);
		} catch (error) {
			console.error('Symbaroum Hymnen: Gesangsbereich-Platzierung fehlgeschlagen', error);
			return { configured: true, cancelled: true };
		}
	}
	if (!regions?.length) return { configured: true, cancelled: true };
	/* Hymnen-Anhang v1.3 (F1/F2/F11): Kanonischer Core-Anhang ueber
	   attachment: { token: ROHE Token-_id } (V14.370 Stable); der Core
	   zieht die Region live mit dem Sänger (animiert, Hidden-Sync,
	   Level-Passung ueber die Ebene des Sänger-Tokens). Der eigene
	   Notfall-Follow ist ENTFERNT (F11, Rudolfs Entscheidung): Scheitert
	   der Anhang, bleibt die Flaeche an ihrer Platzierungsposition
	   stehen (dokumentiert, mit Trace) - Alt-Zonen vor v1.2 bleiben ueber
	   den toleranten Doppel-Check korrekt erkannt. */
	let attached = null;
	if (casterToken) {
		const castDoc = casterToken.document ?? casterToken;
		try {
			const attachPatch = { attachment: { token: castDoc.id } };
			const attachLevelId = _tokenLevelId(castDoc);
			if (attachLevelId) attachPatch.levels = [attachLevelId];
			await regions[0].update(attachPatch);
			attached = regions[0].attachment?.token ?? null;
		} catch (attachError) {
			console.warn('Symbaroum Hymnen [trace] Core-Anhang fehlgeschlagen - Gesangsflaeche bleibt an der Platzierungsposition stehen', { regionId: regions[0].id, attachError });
		}
		console.info(
			attached
				? 'Symbaroum Hymnen [trace] Gesangszone angehaengt (attachment.token, Level-Passung nach Sänger-Ebene)'
				: 'Symbaroum Hymnen [trace] Core-Anhang NICHT gesetzt - Flaeche folgt NICHT (Notfall-Follow entfernt, F11)',
			{ regionId: regions[0].id, attachedToken: attached, autoplace: autoplaceOn, hidden: hymnHidden }
		);
	}
	/* v1.4 (Rudolfs Freigabe 19.11.): Auch die Gesangsflaeche bekommt die
	   Core-Wall-Restriction - Hymnen-Default Sinn KLANG (Rudolfs Fest-
	   legung), Foundry clippt an schallblockierenden Kanten; der Re-Scan
	   in item.js sieht die geclippte Flaeche. */
	await _ensureCoreZoneRestriction(regions[0], { config: { senses: cfg.senses ?? [] } });
	return { configured: true, region: regions[0] };
}

/**
 * Alle Szenen-Token in der Region (Muster _collectRegionTokens:
 * region.tokens mit testInsideRegion-Fallback, F5).
 * @returns {TokenDocument[]}
 */
export function hymnRegionTokens(region) {
	if (!region) return [];
	return _collectRegionTokens(region);
}

/* Hymnen-Token-Bindung v1: Shapes einer Region als iterierbare Liste -
 * Collection-Fall (contents) wie Array-Fall (_firstRegionShape-Muster,
 * Testrunde-2-P9) und Ein-Shape-Singleton abdecken. */
function _regionShapes(region) {
	const shapes = region?.shapes;
	if (!shapes) return [];
	if (Array.isArray(shapes)) return shapes.filter(Boolean);
	if (Array.isArray(shapes?.contents)) return shapes.contents.filter(Boolean);
	if (typeof shapes?.[Symbol.iterator] === 'function') {
		const list = [];
		for (const shape of shapes) if (shape) list.push(shape);
		if (list.length > 0) return list;
		return [shapes].filter(Boolean);
	}
	return [shapes].filter(Boolean);
}

/* Hymnen-Anhang v1.1: Alle Gesangsflaechen EINES Sängers loeschen
 * (Token von der Szene entfernt) - breiter als removeHymnZoneRegions
 * (keine ref-Einschraenkung). Rudolfs Testrunde-v1-P3-Doppelbug ist
 * behoben: Erstens vergleicht die Flaeche jetzt gegen Token-Id UND
 * Actor-Id, zweitends verarbeitet der Hook die V14-Signatur
 * deleteToken(scene, token, options, userId) - Argument 1 ist die
 * SZENE, nicht das Token (der v1-Code räumte nach casterId===scene.id,
 * Trefferquote null). */
async function _hymnZoneCleanupToken(tokenId, actorId = null) {
	if (!canvas?.scene || (!tokenId && !actorId)) return;
	const doomed = [];
	for (const region of canvas.scene.regions ?? []) {
		const hz = (region.flags?.symbaroum ?? {})?.hymnzone;
		if (!hz) continue;
		if (hz.casterId === tokenId || hz.casterId === actorId) doomed.push(region);
	}
	for (const region of doomed) {
		/* v1.4 F18: Core-angehaengte Flaechen raeumt der Core beim
		   Token-Loeschen selbst ab - ein zweites Delete lief ins
		   Server-Rennen ('Region ... does not exist'); nur freie
		   Reste (Anhang fehlt) loeschen wir, Rennen tolerieren. */
		if (region.attachment?.token) continue;
		try {
			if (!canvas?.scene?.regions?.get(region.id)) continue;
			await region.delete();
		} catch (deleteError) {
			console.warn('Symbaroum Hymnen: Gesangsflaeche konnte nicht mit aufgeraeumt werden', region?.name, deleteError);
		}
	}
	if (doomed.length > 0) console.info('Symbaroum Hymnen [trace] Gesangsflaechen mit entferntem Token aufgeraeumt', { tokenId, actorId, removed: doomed.length });
}

/** Regions-Dokument per Id auf der aktuellen Szene suchen. */
export function hymnRegionById(regionId) {
	const id = String(regionId ?? '');
	if (!id || !canvas?.scene) return null;
	return canvas.scene.regions?.get(id) ?? null;
}

/* ---------------------------------------------------------------------
 * Hymnen v1.2 (F7, Rudolfs Freigabe 20.11. - Dornenmantel als Zone):
 * Der Dornenmantel bekommt eine angehängte Core-Region am Träger -
 * Kreis Radius 1,0 Zelle (Rudolfs Festlegung, bewusst ENTKOPPELT von
 * der Flammenwand-Radiusangabe), Core-Wall-Restriktion BEWEGUNG („Was
 * keine Bewegung erlaubt, erlaubt auch keine Berührung" - es gibt
 * keinen eigenen Berührungs-Sinn, move ist der native Berührungs-
 * Proxy), Level-Passung wie F1. Die sichtbar geclippte Fläche ist die
 * Quelle der Verbuendeten-Erfassung (region.tokens / testInsideRegion,
 * Optik = Pruefung); thornCloakInMeleeRange bleibt als dokumentierte
 * Notfall-Naehe OHNE Region bestehen (bewusst behalten).
 * ------------------------------------------------------------------- */

/* Ebene eines Token-Dokuments bestimmen (F1/F7): explizites
 * TokenData.level vorrangig, sonst Elevations-Bereichs-Matching der
 * Scene-Level, sonst die einzige Level, sonst aktive Client-Ebene. */
function _tokenLevelId(tokenDoc) {
	try {
		if (tokenDoc?.level) return String(tokenDoc.level);
		const levels = canvas?.scene?.levels;
		if (!levels || levels.size === 0) return canvas?.level?.id ?? null;
		if (levels.size === 1) {
			const only = [...levels][0];
			return only?.id ?? canvas?.level?.id ?? null;
		}
		const elevation = Number(tokenDoc?.elevation ?? 0) || 0;
		for (const level of levels) {
			const bottom = Number(level?.elevation?.bottom);
			const top = Number(level?.elevation?.top);
			if (Number.isFinite(bottom) && Number.isFinite(top) && elevation >= bottom && elevation <= top) return level.id;
		}
		return canvas?.level?.id ?? null;
	} catch (levelError) {
		return canvas?.level?.id ?? null;
	}
}

/** Dornenmantel-Region eines Trägers (Actor-Id) auf der aktuellen Szene. */
export function thornCloakRegionFor(actorId) {
	const id = String(actorId ?? '');
	if (!id || !canvas?.scene) return null;
	for (const region of canvas.scene.regions ?? []) {
		const tz = (region.flags?.symbaroum ?? {})?.thorncloakzone;
		if (tz && String(tz.casterId) === id) return region;
	}
	return null;
}

/** Dornenmantel-Regionen eines Trägers räumen (Deaktivierung,
 *  Symbol-Ende, Token-Loeschung) - idempotent gegen GM-Rennen.
 *  v1.4 F18: skipAttached=true laesst Core-angehaengte Flaechen stehen
 *  (Token-Loeschung: der Core raeumt angehaengte Regionen selbst ab,
 *  unser zusaetzliches Delete lief sonst ins Server-Rennen und zeigte
 *  "Region ... does not exist"). */
export async function removeThornCloakZones(actorId, { skipAttached = false } = {}) {
	const id = String(actorId ?? '');
	if (!id || !canvas?.scene) return;
	const doomed = [];
	for (const region of canvas.scene.regions ?? []) {
		const tz = (region.flags?.symbaroum ?? {})?.thorncloakzone;
		if (tz && String(tz.casterId) === id) doomed.push(region);
	}
	let removedCount = 0;
	let skippedAttached = 0;
	for (const region of doomed) {
		if (skipAttached && region.attachment?.token) {
			skippedAttached += 1;
			continue;
		}
		if (!canvas?.scene?.regions?.get(region.id)) continue;
		try {
			await region.delete();
			removedCount += 1;
		} catch (deleteError) {
			console.warn('Symbaroum Hymnen: Dornenmantel-Flaeche konnte nicht entfernt werden', region?.name, deleteError);
		}
	}
	if (doomed.length > 0) console.info('Symbaroum Hymnen [trace] Dornenmantel-Flaeche entfernt', { casterId: id, removed: removedCount, skippedAttached });
}

/** Dornenmantel-Region anlegen (F7): angehängt an den Träger, auf die
 *  Token-Mitte zentriert, Level-passend, move-geschnitten (nur mit
 *  aktivem Welt-Setting aoeSenseWalls; Spieler brauchen die Client-
 *  Probe bzw. den GM-Socket-Nachzug - scheitert beides, bleibt die
 *  Flaeche UNGECLIPPT sichtbar, die Notfall-Naehe entscheidet weiter). */
export async function placeThornCloakZone(casterToken, casterActor, item = null, { forceAuto = false } = {}) {
	if (!casterToken || !canvas?.scene) return { region: null, declined: false };
	const castDoc = casterToken.document ?? casterToken;
	const casterId = casterActor?.id ?? castDoc.actor?.id ?? null;
	const existing = thornCloakRegionFor(casterId);
	if (existing) return { region: existing, declined: false };
	const gridSize = Math.max(1, Math.round(canvas.scene.grid?.size ?? 0)) || 100;
	/* v1.3 F12 (Rudolfs Testrunde v1.2, T5): Kreisradius aus dem Zonen-
	   Tab (system.areaZone.size), Default 2,0 Zellen (Rudolfs Vorgabe
	   „1 Feld groesser”); die Kraft bleibt ein Kreis - die Form-Wiege
	   des Tabs greift hier nicht. forceAuto (Self-Heal im A29-Rescan)
	   umgeht den Picker und legt still mittig an. */
	/* v1.3.1 Fix B (Rudolfs Testrunde v1.3 ROT, 20.11.): Der dritte
	   Parameter ist functionStuff.ability - das ist laut
	   getFunctionStuffDefault das SYSTEM-Datenobjekt (ability:
	   this.system), NICHT das Item. Der v1.3-Code las deshalb
	   item.system.areaZone - doppelt verschachtelt, immer undefined:
	   autoplace wirkte nie (immer Picker), Radius/Versteckt fielen
	   still auf ihre Defaults (Rudolfs Befund 3). Toleranter Doppel-
	   Pfad: Item ODER System-Datenobjekt (System-Muster). */
	const zoneData = item?.areaZone ?? item?.system?.areaZone ?? {};
	const rawRadius = Number(zoneData.size);
	const radiusCells = Number.isFinite(rawRadius) && rawRadius >= 1 ? Math.round(rawRadius) : 2;
	/* v1.3 F9a (Rudolfs Freigabe 20.11.): autoplace steuert Picker vs.
	   Direkt-Anlage (Default AUS = Picker, konsistent mit den Hymnen);
	   F9b: hidden (Default AUS) stellt die Sichtbarkeit auf GM, die
	   Wirkung (move-Clip, Verbuendeten-Erfassung) bleibt unangetastet. */
	const autoplaceRaw = zoneData.autoplace;
	const autoplace = autoplaceRaw === true || String(autoplaceRaw ?? '') === 'true' || forceAuto === true;
	const hiddenRaw = zoneData.hidden;
	const hidden = hiddenRaw === true || String(hiddenRaw ?? '') === 'true';
	const tCenterX = (Number(castDoc.x) || 0) + ((Number(castDoc.width) || 1) * gridSize) / 2;
	const tCenterY = (Number(castDoc.y) || 0) + ((Number(castDoc.height) || 1) * gridSize) / 2;
	const regionData = {
		name: game.i18n.format('POWER_THORN_CLOAK.REGION_NAME', { user: casterActor?.name ?? castDoc.actor?.name ?? game.user.name }),
		/* v1.3 F10: Rudolfs Wunschfarbe #1c3e1c statt Nutzerfarbe */
		color: '#1c3e1c',
		displayMeasurements: true,
		highlightMode: 'coverage',
		shapes: [{ type: 'circle', x: tCenterX, y: tCenterY, rotation: 0, radius: radiusCells * gridSize }],
		visibility: hidden ? (CONST.REGION_VISIBILITY?.GAMEMASTER ?? CONST.REGION_VISIBILITY.ALWAYS) : CONST.REGION_VISIBILITY.ALWAYS,
		'flags.core.MeasuredTemplate': true,
		flags: {
			symbaroum: {
				thorncloakzone: {
					casterId,
					casterTokenId: castDoc.id ?? null,
					casterName: casterActor?.name ?? castDoc.actor?.name ?? game.user.name,
				},
			},
		},
	};
	/* F1/F7: Level-Passung - Attached Token verlangt GENAU EIN Level
	   des Traeger-Tokens. */
	const cloakLevelId = _tokenLevelId(castDoc);
	if (cloakLevelId) regionData.levels = [cloakLevelId];
	await probePlayerRestrictionCreate();
	if (senseWallsEnabled() && (game.user.isGM || _playerRestrictionCreateCache === true)) {
		regionData.restriction = { type: 'move', priority: 0, enabled: true };
	}
	let regions = null;
	let declined = false;
	if (autoplace) {
		try {
			const created = await canvas.scene.createEmbeddedDocuments('Region', [regionData]);
			regions = Array.isArray(created) ? created : null;
		} catch (createError) {
			console.warn('Symbaroum Hymnen [trace] Dornenmantel-Flaeche konnte nicht angelegt werden (kein GM?)', createError);
			return { region: null, declined: false };
		}
	} else {
		/* Picker: SL positioniert den Kreis frei (Vorschau clippt mit
	   der move-Restriktion); Abbruch = gilt als ABGELEHNT -
	   declined=true im Rueckgabewert, die Kraft wirkt ohne Flaeche
	   weiter (Notfall-Naehe), und der A29-Rescan heilt nicht gegen
	   den bewussten Abbruch (thornCloakZoneDeclined am Akteur). */
		try {
			regions = await canvas.regions.placeRegions([regionData]);
		} catch (placeError) {
			console.warn('Symbaroum Hymnen [trace] Dornenmantel-Platzierung fehlgeschlagen', placeError);
			return { region: null, declined: false };
		}
		declined = !regions?.length;
	}
	const region = regions?.[0] ?? null;
	if (!region) return { region: null, declined };
	/* Spieler ohne Restriction-Recht: GM-Socket-Nachzug (Probe schlug
	   fehl oder Setting-Reihenfolge) - scheitert er, bleibt die Flaeche
	   ungeclippt (bewusst, mit Trace). */
	if (senseWallsEnabled() && !region.restriction?.enabled && !game.user.isGM) {
		try {
			const installed = await requestAoeZoneInstall('restriction', {
				sceneId: canvas.scene?.id,
				regionIds: [region.id],
				restriction: { enabled: true, type: 'move', priority: 0 },
			});
			if (installed !== true) {
				console.info('Symbaroum Hymnen [trace] Dornenmantel ohne move-Clip (kein GM erreichbar) - Flaeche ungeclippt sichtbar', { regionId: region.id });
			}
		} catch (socketError) {
			console.warn('Symbaroum Hymnen [trace] Dornenmantel-Restriction-Socket fehlgeschlagen - Flaeche ungeclippt sichtbar', socketError);
		}
	}
	/* Anhang (F2-Muster): Auto-Anlage ist bereits zentriert, beim Picker
	   konserviert der Anhang den gewaehlten Abstand live. */
	try {
		await region.update({ attachment: { token: castDoc.id } });
	} catch (attachError) {
		console.warn('Symbaroum Hymnen [trace] Dornenmantel-Anhang fehlgeschlagen - Notfall-Naehe aktiv', attachError);
	}
	console.info('Symbaroum Hymnen [trace] Dornenmantel-Flaeche angelegt (move-Clip, angehaengt)', { regionId: region.id, casterId: String(casterId ?? ''), radiusCells, autoplace: autoplace && !forceAuto, hidden, levelId: cloakLevelId });
	return { region, declined };
}

/**
 * Gesangsbereiche eines Sängers aufräumen (Hymnen-Ende, egal warum):
 * löscht alle Regionen mit hymnzone.casterId auf der aktuellen Szene,
 * deren Referenz in refs steht. Idempotent.
 */
/* v2.2 F26 (Rudolfs A4-Bewertung der Testrunde v2.1): Die drei
   Region-Raeumer der eigenen Zonen-Maschinen (Hymne/Aura/Glyphe)
   waren wortgleiche Kopien - EIN Kern mit Flag-Schluessel als einzigem
   Unterschied. Die oeffentlichen Namen bleiben als duenne Wrapper
   erhalten (alle Aufrufstellen unveraendert); der String-Vergleich ist
   der toleranteren Aura/Glyph-Variante folgt (Hymnen-Alt-Regionen
   sind davon nicht betroffen - IDs sind Zeichenketten). */
async function removeZoneRegionsByFlag(casterId, refs, flagKey, label) {
	if (!canvas?.scene || !Array.isArray(refs) || refs.length === 0) return;
	const wanted = new Set(refs.map((r) => String(r)));
	const doomed = [];
	for (const region of canvas.scene.regions ?? []) {
		const zf = region.flags?.symbaroum?.[flagKey];
		if (!zf) continue;
		if (String(zf.casterId) === String(casterId ?? '') && wanted.has(String(zf.ref))) doomed.push(region);
	}
	for (const region of doomed) {
		if (!canvas?.scene?.regions?.get(region.id)) continue;
		try {
			await region.delete();
		} catch (deleteError) {
			console.warn(`Symbaroum Hymnen: ${label} konnte nicht entfernt werden`, region?.name, deleteError);
		}
	}
}

export async function removeHymnZoneRegions(casterId, refs) {
	await removeZoneRegionsByFlag(casterId, refs, 'hymnzone', 'Gesangsflaeche');
}

/** v2 F9 (Rudolfs Freigabe 20.11.): Bestehende Auren-Region eines Wirkers
 *  fuer eine Referenz suchen (Neucast ersetzt die Flaeche). */
export function auraRegionFor(casterId, abilityRef) {
	for (const region of canvas.scene?.regions ?? []) {
		const az = (region.flags?.symbaroum ?? {})?.aurazone;
		if (az && String(az.casterId) === String(casterId ?? '') && String(az.ref) === String(abilityRef ?? '')) return region;
	}
	return null;
}

/** v2 F9 (Rudolfs Freigabe 20.11.): Auren-Regionen eines Wirkers raeumen
 *  (Auren-Ende egal warum - Abbruch, Maintain-Fehlschlag, Token-Delete).
 *  Idempotent, Existenz-Check + try/catch je Loeschung (F19a-Stil). */
export async function removeAuraZoneRegions(casterId, refs) {
	await removeZoneRegionsByFlag(casterId, refs, 'aurazone', 'Auren-Flaeche');
}

/** v2 F10 (Rudolfs Freigabe 20.11.): Glyphen-Kreise eines Wirkers raeumen
 *  (Neucast ersetzt die Flaeche, A29-Abbruch beendet sie). */
export async function removeGlyphZoneRegions(casterId, refs) {
	await removeZoneRegionsByFlag(casterId, refs, 'glyphzone', 'Glyphen-Flaeche');
}

/** v2 F9 (Rudolfs Freigabe 20.11.): Heilige/Unheilige Aura als ANGEHAENGTE
 *  SICHT-REGION auf dem WIRKER-Token - fixe Sichtweite (SIGHT_RANGE_UNITS
 *  Szenen-Einheiten, Sichtweiten-Abstraktion 100 m wie die Hymnen),
 *  live mitwandernd ueber den Core-Anhang (F1/F2-Mechanik: ERST
 *  platzieren, DANN attachment), Level-Passung _tokenLevelId. hidden aus
 *  dem Zonen-Tab stellt die Sichtbarkeit auf GM (GAMEMASTER, F16-Enum,
 *  Rudolf: "Auren sind auch Kandidat fuer VERSTECKTE Zonen"). Restriction
 *  'sight' nur mit aktivem Welt-Setting aoeSenseWalls (Sicht-Clip),
 *  sonst wirkt die Flaeche rein geometrisch. Rueckgabe { region, declined }
 *  - Picker-Abbruch (declined) laesst die SL-Kette als Fallback laufen. */
export async function placeAuraZone(casterToken, casterActor, abilityRef, item = null) {
	if (!casterToken || !canvas?.scene) return { region: null, declined: false };
	const castDoc = casterToken.document ?? casterToken;
	const casterId = casterActor?.id ?? castDoc.actor?.id ?? null;
	const zoneData = item?.areaZone ?? item?.system?.areaZone ?? {};
	const autoplace = zoneData.autoplace === true || String(zoneData.autoplace ?? '') === 'true';
	const hidden = zoneData.hidden === true || String(zoneData.hidden ?? '') === 'true';
	/* v2.1 F20 (Rudolfs Testrunde v2, A1 ROT - Crash "CircleShapeData
	   radius must be a number"): scene.grid.units liefert in Foundry V14
	   einen STRING, Number(...) ergibt NaN, Math.max(1, NaN) bleibt NaN -
	   der Kreis-Radius crashte die komplette Erstplatzierung (A2-A7
	   wurden deshalb nie erreicht). Bestands-Konvention statt dessen wie
	   die Flammenwand (metersPerField-Idiom): scene.grid.distance =
	   Meter je Feld (Numerik, Default 2), Radius in Feldern = Sichtweite
	   100 m / metersPerField - 100 m = 50 Szenen-Einheiten, beide
	   Konventionen treffen sich im Default 2 m je Einheit. */
	const gridSize = Math.max(1, Math.round(canvas.scene.grid?.size ?? 0)) || 100;
	const metersPerField = Math.max(0.5, Number(canvas.scene.grid?.distance) || 2);
	const radiusPx = Math.max(1, Math.round((100 / metersPerField) * gridSize));
	const existing = auraRegionFor(casterId, abilityRef);
	if (existing) return { region: existing, declined: false };
	const centerX = (Number(castDoc.x) || 0) + ((Number(castDoc.width) || 1) * gridSize) / 2;
	const centerY = (Number(castDoc.y) || 0) + ((Number(castDoc.height) || 1) * gridSize) / 2;
	const refKey = String(abilityRef ?? '') === 'unholyaura' ? 'POWER_UNHOLYAURA.REGION_NAME' : 'POWER_HOLYAURA.REGION_NAME';
	const regionData = {
		name: game.i18n.format(refKey, { user: casterActor?.name ?? castDoc.actor?.name ?? game.user.name }),
		color: '#434c43',
		displayMeasurements: true,
		highlightMode: 'coverage',
		shapes: [{ type: 'circle', x: centerX, y: centerY, rotation: 0, radius: radiusPx }],
		visibility: hidden ? (CONST.REGION_VISIBILITY?.GAMEMASTER ?? CONST.REGION_VISIBILITY.ALWAYS) : CONST.REGION_VISIBILITY.ALWAYS,
		'flags.core.MeasuredTemplate': true,
		flags: {
			symbaroum: {
				aurazone: {
					ref: String(abilityRef ?? ''),
					casterId,
					casterTokenId: castDoc.id ?? null,
					casterName: casterActor?.name ?? castDoc.actor?.name ?? game.user.name,
				},
			},
		},
	};
	const auraLevelId = _tokenLevelId(castDoc);
	if (auraLevelId) regionData.levels = [auraLevelId];
	await probePlayerRestrictionCreate();
	if (senseWallsEnabled() && (game.user.isGM || _playerRestrictionCreateCache === true)) {
		regionData.restriction = { type: 'sight', priority: 0, enabled: true };
	}
	let regions = null;
	let declined = false;
	if (autoplace) {
		try {
			const created = await canvas.scene.createEmbeddedDocuments('Region', [regionData]);
			regions = Array.isArray(created) ? created : null;
		} catch (createError) {
			console.warn('Symbaroum Hymnen [trace] Auren-Flaeche konnte nicht angelegt werden', createError);
			return { region: null, declined: false };
		}
	} else {
		try {
			regions = await canvas.regions.placeRegions([regionData]);
		} catch (placeError) {
			console.warn('Symbaroum Hymnen [trace] Auren-Platzierung fehlgeschlagen', placeError);
			return { region: null, declined: false };
		}
		declined = !regions?.length;
	}
	const region = regions?.[0] ?? null;
	if (!region) return { region: null, declined };
	if (!region.restriction?.enabled && senseWallsEnabled() && !game.user.isGM) {
		try {
			await requestAoeZoneInstall('restriction', {
				sceneId: canvas.scene?.id,
				regionIds: [region.id],
				restriction: { enabled: true, type: 'sight', priority: 0 },
			});
		} catch (socketError) {
			console.warn('Symbaroum Hymnen [trace] Auren-Sicht-Restriction-Socket fehlgeschlagen - Flaeche ungeclippt', socketError);
		}
	}
	try {
		await region.update({ attachment: { token: castDoc.id } });
	} catch (attachError) {
		console.warn('Symbaroum Hymnen [trace] Auren-Anhang fehlgeschlagen - Flaeche folgt NICHT', attachError);
	}
	console.info('Symbaroum Hymnen [trace] Auren-Flaeche angelegt (Sicht, angehaengt)', { regionId: region.id, casterId: String(casterId ?? ''), ref: String(abilityRef ?? ''), radiusPx, metersPerField, autoplace, hidden, declined });
	return { region, declined };
}

/** v2 F10 (Rudolfs Freigabe 20.11.): Entkraeftende Glyphe als DAUERHAFTE
 *  Zonen-Region - Kreis mit Radius aus dem Zonen-Tab (system.areaZone.size,
 *  Default 1 Zelle = Nah, modulweit einheitlich mit dem Dornenmantel).
 *  KEIN Anhang (das Symbol liegt am Boden), Picker per Default, autoplace
 *  zentriert still auf den Wirker. hidden aus dem Zonen-Tab auf GM.
 *  Alte Glyphen-Regionen des Wirkers werden VOR der Anlage ger aeumt
 *  (Neucast ersetzt die Flaeche). Rueckgabe { region, declined }. */
export async function placeGlyphZone(casterToken, casterActor, abilityRef, item = null) {
	if (!casterToken || !canvas?.scene) return { region: null, declined: false };
	const castDoc = casterToken.document ?? casterToken;
	const casterId = casterActor?.id ?? castDoc.actor?.id ?? null;
	/* v2.1 F22-Nebenbefund: refs-Filter war ein STRING statt Array - die
	   Raeumung alter Glyphen-Kreise war ein stiller No-Op (Rueckgabe-
	   Guard Array.isArray). Mit dem Hymnen-Abgleich korrigiert. */
	await removeGlyphZoneRegions(casterId, [String(abilityRef ?? '')]);
	const zoneData = item?.areaZone ?? item?.system?.areaZone ?? {};
	const rawRadius = Number(zoneData.size);
	const radiusCells = Number.isFinite(rawRadius) && rawRadius >= 1 ? Math.round(rawRadius) : 1;
	const autoplace = zoneData.autoplace === true || String(zoneData.autoplace ?? '') === 'true';
	const hidden = zoneData.hidden === true || String(zoneData.hidden ?? '') === 'true';
	const gridSize = Math.max(1, Math.round(canvas.scene.grid?.size ?? 0)) || 100;
	const centerX = (Number(castDoc.x) || 0) + ((Number(castDoc.width) || 1) * gridSize) / 2;
	const centerY = (Number(castDoc.y) || 0) + ((Number(castDoc.height) || 1) * gridSize) / 2;
	const regionData = {
		name: game.i18n.format('POWER_DRAININGGLYPH.REGION_NAME', { user: casterActor?.name ?? castDoc.actor?.name ?? game.user.name }),
		color: game.user.color,
		displayMeasurements: true,
		highlightMode: 'coverage',
		shapes: [{ type: 'circle', x: centerX, y: centerY, rotation: 0, radius: radiusCells * gridSize }],
		visibility: hidden ? (CONST.REGION_VISIBILITY?.GAMEMASTER ?? CONST.REGION_VISIBILITY.ALWAYS) : CONST.REGION_VISIBILITY.ALWAYS,
		'flags.core.MeasuredTemplate': true,
		flags: {
			symbaroum: {
				glyphzone: {
					ref: String(abilityRef ?? ''),
					casterId,
					casterTokenId: castDoc.id ?? null,
					casterName: casterActor?.name ?? castDoc.actor?.name ?? game.user.name,
				},
			},
		},
	};
	await probePlayerRestrictionCreate();
	if (senseWallsEnabled() && (game.user.isGM || _playerRestrictionCreateCache === true)) {
		regionData.restriction = { type: 'sight', priority: 0, enabled: true };
	}
	let regions = null;
	let declined = false;
	if (autoplace) {
		try {
			const created = await canvas.scene.createEmbeddedDocuments('Region', [regionData]);
			regions = Array.isArray(created) ? created : null;
		} catch (createError) {
			console.warn('Symbaroum Hymnen [trace] Glyphen-Kreis konnte nicht angelegt werden', createError);
			return { region: null, declined: false };
		}
	} else {
		try {
			regions = await canvas.regions.placeRegions([regionData]);
		} catch (placeError) {
			console.warn('Symbaroum Hymnen [trace] Glyphen-Platzierung fehlgeschlagen', placeError);
			return { region: null, declined: false };
		}
		declined = !regions?.length;
	}
	const region = regions?.[0] ?? null;
	if (!region) return { region: null, declined };
	if (!region.restriction?.enabled && senseWallsEnabled() && !game.user.isGM) {
		try {
			await requestAoeZoneInstall('restriction', {
				sceneId: canvas.scene?.id,
				regionIds: [region.id],
				restriction: { enabled: true, type: 'sight', priority: 0 },
			});
		} catch (socketError) {
			console.warn('Symbaroum Hymnen [trace] Glyphen-Sicht-Restriction-Socket fehlgeschlagen - Flaeche ungeclippt', socketError);
		}
	}
	console.info('Symbaroum Hymnen [trace] Glyphen-Kreis angelegt (Sicht)', { regionId: region.id, casterId: String(casterId ?? ''), radiusCells, autoplace, hidden, declined });
	return { region, declined };
}

/** Auto-Targeting EINER platzierten Region (Zielvorschlag wie Stufe 1). */
async function _autoTargetRegion(region, cfg, casterToken) {
	const tokens = _filterTargets(_collectRegionTokens(region), cfg.targeting, casterToken, cfg.includeCaster ?? null);
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
	/* Hymnen-Paket 1.3 (Rudolfs Testrunde v1.2, P11): Der "Nicht
	   erlernt"-Check (A13) sitzt in usePower - dieser Ausführungs-
	   dialog läuft aber VOR usePower (beide Sheet-Aufrufer). Eine
	   nicht erlernte Kraft (Stufe 0, z. B. die zurückgestellte
	   Schwächende Hymne) öffnete deshalb erst den Ausführungsdialog,
	   die Warnung kam erst beim Manuell-Wirken bzw. erst NACH dem
	   Zonen-Platzieren beim Auslösen. Rudolfs Wunsch: Warnung VOR dem
	   Dialog. Rückgabe 'cancel' = Aufrufer bricht ab (kein usePower,
	   keine doppelte Warnung). */
	if (item.system?.hasLevels && item.getLevel?.()?.level === 0) {
		ui.notifications.warn(game.i18n.format('ERROR.NOT_LEARNED', { name: item.name }));
		return 'cancel';
	}
	/* Hymnen-Paket 1.2 (Rudolfs Testrunde v1.1 + Entscheidung 4):
	   Hymnen laufen NICHT durch den Zonen-Dialog hier, sondern durch
	   ihren EIGENEN Ausführungsdialog - siehe den Hymnen-Block nach der
	   Teil-Konfigurations-Warnung. */
	const isHymn = game.symbaroum.config.HYMN_REFERENCES.includes(String(item.system?.reference ?? ''));
	/* v1.4 F15 (Rudolfs Testrunde v1.3.1, T4/T5): Der Dornenmantel
	   traegt EIGENE Zonen-Maschinerie (placeThornCloakZone - Radius,
	   Autoplatzierung und Versteckt aus dem Zonen-Tab). Der generische
	   Zonen-Ausfuehrungsdialog legte bei KONFIGURIERTEM Tab zusaetzlich
	   eine zweite, frei platzierte Nutzerfarben-Region an (eigene
	   "Zone beenden"-Karte, Rundenende wertete die falsche Zone aus).
	   Der Tab ist fuer ihn reiner Datenspeicher - Rueckgabe false =
	   normaler manueller Ablauf wie bei Hymnen. */
	/* v2.2 F25 (Rudolfs Testrunde v2.1, A-Serie): F15 verallgemeinert -
	   ALLE Kraefte mit eigener Zonen-Maschine (OWN_ZONE_REFERENCES:
	   Dornenmantel, Auren, Glyphe) schweigen im generischen Zonen-
	   Ausfuehrungsdialog; der Zonen-Tab ist reiner Datenspeicher. */
	if ((game.symbaroum.config.OWN_ZONE_REFERENCES ?? []).includes(String(item.system?.reference ?? ''))) return false;
	/* Hymnen-Paket 1.1: „Zone aktivieren: Nein“ = keine Warnung, kein
	   Ausführungsdialog (Vor dem Teil-Konfigurations-Check, damit auch
	   die Form-Warnung von deaktivierten Zonen schweigt). */
	if (String(item?.system?.areaZone?.active ?? 'yes') === 'no') return false;
	// v2.4 (Rudolfs Testrunde 4, Bannsiegel-Diagnose): areaZone ist vor-
	// konfiguriert, aber die FORM fehlt -> getZoneConfig null -> der
	// Ausführungsdialog wurde bislang STILL übersprungen (Rudolfs Beob-
	// achtung "Ausführungsdialog erschien nie"). Der Zustand ist jetzt
	// SICHTBAR: Warnung mit Handlungshinweis, danach normaler manueller
	// Ablauf (nur shape gilt als Pflichtfeld; mode/targetOrder haben
	// sinnvolle Defaults und lösen die Warnung nicht aus).
	const rawZone = item?.system?.areaZone ?? null;
	if (!getZoneConfig(item)) {
		/* AoE-Rest Paket 1: die Flammenwand ist die Ausnahme-Dauerhaft-
		   Kraft-Zone - auch OHNE Zone-Tab-Konfiguration führt der
		   Aktivieren-Button in den Ausführungsdialog (die RAW-Grund-
		   einstellung liefert _flamewallZoneConfig, die Form wählt der
		   Wirker bei der Platzierung). */
		if (String(item.system?.reference ?? '') === 'flamewall') {
			if (!game.user.isGM && (!playerPlacementEnabled() || !item.isOwner)) return false;
		} else {
			const partiallyConfigured =
				!!rawZone &&
				String(rawZone.shape ?? '').trim() === '' &&
				(Number(rawZone.size) > 0 || String(rawZone.targeting ?? '').trim() !== '' || String(rawZone.trigger ?? '').trim() !== '' || Number(rawZone.duration) > 0);
			if (partiallyConfigured) {
				ui.notifications.warn(game.i18n.localize('AOE.ERR_ZONE_NO_SHAPE'));
			}
			return false;
		}
	}
	/* Hymnen-Paket 1.2 (Rudolfs Entscheidung 4): Beim ERSTGESANG einer
	   Hymne mit konfigurierter, aktivierter Zone fragt dieser Dialog
	   VOR dem Gesangsdialog, wie gewirkt wird - „Sichtweite“ (v1-Modus,
	   100 m), „Zone platzieren“ (interaktive Platzierung JETZT, danach
	   erst der Gesangsdialog) oder „Abbrechen“ (kein Gesang, keine
	   Korruption - die Standard-Engine läuft noch nicht). Ein LAUFENDER
	   Gesang (Maintain-Klick) schweigt hier ebenso wie Hymnen ohne
	   Platzierungsrechte - beide laufen ohne Dialog direkt weiter;
	   unkonfigurierte Hymnen sind oben bereits gekehrt. Rückgabe:
	   'manual' = Sichtweite, 'hymnzone' = Fläche platziert (usePower
	   übernimmt sie über die Pending-Map), 'cancel' = Abbruch. */
	if (isHymn) {
		if (hymnActiveForCaster(item.actor)) return false;
		if (!game.user.isGM && (!playerPlacementEnabled() || !item.isOwner)) return false;
		const hymnModern = isModernDialogActive();
		const hymnContent = `<div class="symbaroum${hymnModern ? ' modern-roll-dialog' : ' dialog'}"><p>${game.i18n.localize('POWER_HYMN.EXEC_HINT')}</p></div>`;
		return new Promise((resolve) => {
			let settled = false;
			let placing = false;
			const settle = (value) => {
				if (settled) return;
				settled = true;
				resolve(value);
			};
			const dialog = symbDialog({
				title: game.i18n.format('AOE.EXEC_TITLE', { power: item.name }),
				content: hymnContent,
				classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(hymnModern ? modernDialogClasses('modern-roll-dialog') : [])],
				buttons: {
					sight: {
						icon: '<i class="fas fa-eye"></i>',
						label: game.i18n.localize('POWER_HYMN.EXEC_SIGHT'),
						callback: () => settle('manual'),
					},
					zone: {
						icon: '<i class="fas fa-draw-polygon"></i>',
						label: game.i18n.localize('AOE.EXEC_ZONE'),
						callback: () => {
							/* Der Dialog schließt mit dem Klick, die Platzierung
							   läuft danach interaktiv - placing hält den Close-
							   Fallback auf, bis das Ergebnis feststeht. */
							placing = true;
							(async () => {
								/* Verwaiste Flächen dieses Sängers dürfen nicht
								   stehen bleiben (Rudolfs P8: abgebrochene
								   Platzierung, Gesangsdialog-Abbruch der Runde
								   davor) - ein Gesang läuft nie doppelt. */
								await removeHymnZoneRegions(item.actor?.id ?? null, game.symbaroum.config.HYMN_REFERENCES);
								const outcome = await placeHymnZone(item);
								if (outcome?.region) {
									setPendingHymnZone(item.actor?.id, {
										ref: String(item.system?.reference ?? ''),
										regionId: outcome.region.id,
										sceneId: canvas.scene?.id,
									});
									settle('hymnzone');
								} else {
									/* unkonfiguriert (kann hier nicht) oder Platzierung
									   abgebrochen (Rechtsklick) = Gesang abgebrochen */
									settle('cancel');
								}
							})();
						},
					},
					cancel: {
						icon: '<i class="fas fa-times"></i>',
						label: game.i18n.localize('DIALOG.CANCEL'),
						callback: () => settle('cancel'),
					},
				},
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
				default: 'sight',
				width: 460,
			});
			try {
				dialog.addEventListener('close', () => {
					if (!placing) settle('cancel');
				});
			} catch (error) {
				console.warn('Symbaroum Hymnen: Gesangsbereich-Dialog ohne ESC-Fallback', error);
			}
		});
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
	/* v1.4: Sinn-Dropdown des freien Zonen-Dialogs - EIN Sinn (Core-
	   Ein-Typ-Grenze), Default 'none' (kein Sinn). */
	const senseOptions = [
		{ id: 'none', label: localize('AOE.SENSE_NONE') },
		{ id: 'move', label: localize('AOE.SENSE_MOVE') },
		{ id: 'sight', label: localize('AOE.SENSE_SIGHT') },
		{ id: 'sound', label: localize('AOE.SENSE_SOUND') },
	];
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
		senseOptions,
		
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
	/* v1.1 (P14): Pausen-Guard auch für die freie Zone (SL-only bei Pause). */
	if (!game.user.isGM && game.paused) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_PAUSED'));
		return;
	}
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
	/* v1.3 F9b: 'Versteckt'-Checkbox des freien Zonen-Dialogs (Default
	   AUS) - Sichtbarkeit GM statt ALWAYS, Wirkung unangetastet. */
	const hidden = html.querySelector('#aoe-free-hidden')?.checked === true;
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
		/* AoE-Rest Paket 1 (S1): Sinn-Filter der freien Zone - Default
		   leer (SL wählt im Dialog), Checkbox-Wert ODER Gruppe-Leer. */
		config: {
			shape,
			size,
			hidden,
			targeting: val('aoe-free-targeting') || 'all',
			targetOrder: 'marking',
			/* v1.4 (Rudolfs Freigabe 19.11.): EIN Sinn je Zone (Core-
			   Ein-Typ-Grenze) - Dropdown statt der drei Checkboxen;
			   'none' = kein Sinn (kein Clip, kein Filter). */
			senses: (() => {
				const freeSense = String(html.querySelector('#aoe-free-sense')?.value ?? 'none');
				return ['move', 'sight', 'sound'].includes(freeSense) ? [freeSense] : [];
			})(),
		},
		docLines: [],
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
	/* v1.4.1: Spieler-Restric-Probe (einmalig gecacht) VOR dem Datensatz-
	   Bau - erlaubt V14 die Anlage mit Restriction, bringt der Spieler-
	   Zone den Vorschau-Clip beim Positionieren mit. */
	await probePlayerRestrictionCreate();
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
		/* v1.4 (Rudolfs Freigabe 19.11.): Freie Zonen bekommen dieselbe
		   Core-Wall-Restriction und Doku-Zeile wie Kraft-Zonen (GM in
		   _zoneRegionData, Spieler per GM-Socket); der eigene v1.3.1-
		   W0-Clip ist ersatzlos entfernt. */
		const freeSense = await _ensureCoreZoneRestriction(region, zone);
		if (freeSense) {
			zone.docLines = [
				...(zone.docLines ?? []),
				game.i18n.format('AOE.CHAT_W0_CORE', { sense: game.i18n.localize(`AOE.SENSE_${freeSense.toUpperCase()}`) }),
			];
			await region.setFlag('symbaroum', 'aoe', zone);
		}
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

/* v1.2 (Rudolfs Testrunde 2, P9): GM-Seitige Installation des
 * Betreten-Behaviors auf Spieler-Zonen (V14 verbietet Behaviors in der
 * Region-Erstellung durch Nicht-SLs).
 * v1.4.2 (Rudolfs Testrunden 8+9, Fehl-Warnung "Kein SL online"):
 * Die v1.4.1-These (zwei parallele Handler verdrehten das Antwort-
 * Muster) war FALSCH - der direkte System-Socket (game.socket.emit)
 * liefert NIE Handler-Rueckgaben, sondern nur eine Server-Empfangs-
 * bestaetigung (Foundry-Wiki, Sockets); die Array-Auswertung konnte
 * also prinzipiell nie `true` sehen und die Warnung feuerte bei jeder
 * Spieler-Platzierung, egal wie viele Handler registriert waren.
 * Fix: Transport auf das Foundry-Query-System (V13+, User#query +
 * CONFIG.queries) - siehe requestAoeZoneInstall und den Query-Handler
 * in registerAoeHooks. Diese Funktion bleibt eine INTERNE Funktion
 * des Query-Handlers (sie wird nur GM-seitig ausgefuehrt). */
async function aoeZoneBehaviorInstall(data) {
	const { sceneId, regionIds } = data ?? {};
	const scene = game.scenes.get(sceneId);
	if (!scene || !Array.isArray(regionIds)) return false;
	/* v1.3 (Rudolfs Testrunde 4, P4): RegionBehavior als GLOBALE
	   Kennung existiert in V14 nicht garantiert - der v1.2-Handler
	   stuerzte vermutlich mit einem ReferenceError ab, der Spieler
	   sah die falsche Warnung "keine SL online" und der Socket-Dispatch
	   spuckte Folgefehler ("ChatMessage ... does not exist"). Jetzt:
	   (a) Installatrion ueber die EMBEDDED-COLLECTION der Region
	   (region.createEmbeddedDocuments('RegionBehavior', ...) - dieselbe
	   Pipeline, die auch das Datamodel validiert), (b) Klassik-Fallback
	   RegionBehavior.create NUR wenn der Bezeichner wirklich existiert,
	   (c) je Region ein eigener try/catch - ein Fehler bricht die
	   restlichen Regionen nicht mehr ab - und (d) eine sichtbare
	   Trace-Zeile, damit ein Misserfolg nie wieder lautlos untergeht. */
	const behaviorData = {
		type: 'executeScript',
		system: { source: ZONE_ENTER_BEHAVIOR_SOURCE, events: [CONST.REGION_EVENTS.TOKEN_ENTER] },
	};
	let installed = false;
	for (const regionId of regionIds) {
		const region = scene.regions?.get(regionId);
		if (!region || region.behaviors?.length) continue;
		try {
			if (typeof region.createEmbeddedDocuments === 'function') {
				await region.createEmbeddedDocuments('RegionBehavior', [behaviorData]);
				installed = true;
			} else if (typeof globalThis.RegionBehavior === 'function') {
				await globalThis.RegionBehavior.create(behaviorData, { parent: region });
				installed = true;
			} else {
				console.warn('Symbaroum AoE: keine RegionBehavior-Installations-API verf\u00fcgbar', region.name);
			}
		} catch (error) {
			console.error('Symbaroum AoE: Betreten-Behavior-Installation fehlgeschlagen', region?.name, error);
		}
	}
	console.info('Symbaroum AoE [trace] aoeZoneBehaviorInstall:', { sceneId, regionIds, installed });
	return installed;
}

/* v1.4 (Rudolfs Freigabe 19.11.): GM-seitige Setzung der Core-Wall-
   Restriction auf Spieler-Zonen (Parallele zum Betreten-Behavior:
   falls V14 die Restriction-Anlage durch Nicht-SLs beschraenkt, bleibt
   der Flaechen-Clip fuer Spieler dennoch verfuegbar durch den nachge-
   lagerten GM-Weg). Rueckgabe true = gesetzt.
 * v1.4.2: interne Funktion des Query-Handlers (siehe aoeZoneBehavior-
   Install-Kommentar): der Transport laeuft jetzt ueber das Foundry-
   Query-System statt des direkten Sockets. */
async function aoeZoneRestrictionInstall(data) {
	const { sceneId, regionIds, restriction } = data ?? {};
	const scene = game.scenes.get(sceneId);
	if (!scene || !Array.isArray(regionIds)) return false;
	const wantedType = ['move', 'sight', 'sound'].includes(restriction?.type) ? restriction.type : 'move';
	const wanted = { enabled: true, type: wantedType, priority: Number(restriction?.priority) || 0 };
	let installed = false;
	for (const regionId of regionIds) {
		const region = scene.regions?.get(regionId);
		if (!region) continue;
		try {
			await region.update({ restriction: wanted });
			installed = true;
		} catch (error) {
			console.error('Symbaroum AoE: Wall-Restriction-Setzung fehlgeschlagen', region?.name, error);
		}
	}
	console.info('Symbaroum AoE [trace] aoeZoneRestrictionInstall:', { sceneId, regionIds, installed, type: wantedType });
	return installed;
}

/* v1.4.2: EIN Query-Handler bedient Behavior- und Restriction-
   Installation (registriert als CONFIG.queries['symbaroum.aoeZoneInstall'],
   siehe registerAoeHooks); nur der adressierte GM-Client wertet aus.
   Die Rueckgabe ist JSON-serialisierbar (boolean) und kommt sauber
   awaited beim anfragenden Client zurueck - genau das, was der direkte
   Socket nie bot. */
async function aoeZoneInstallQueryHandler(queryData) {
	if (!game.user?.isGM) return false;
	const kind = queryData?.kind;
	const payload = queryData?.payload ?? {};
	if (kind === 'behavior') return aoeZoneBehaviorInstall(payload);
	if (kind === 'restriction') return aoeZoneRestrictionInstall(payload);
	return false;
}

/* v1.4.2: Client-seitige Anfrage an den Acting GM. Rueckgabe true =
   GM meldet die Installation erfolgreich; false = kein GM online,
   Query-Fehler oder Timeout (Warn-Verhalten unveraendert). */
async function requestAoeZoneInstall(kind, payload) {
	const gm = game.users?.activeGM ?? null;
	if (!gm) {
		console.info('Symbaroum AoE [trace] Install-Query ohne GM online:', kind);
		return false;
	}
	try {
		const result = await gm.query('symbaroum.aoeZoneInstall', { kind, payload }, { timeout: 10000 });
		const installed = result === true;
		console.info('Symbaroum AoE [trace] Install-Query Antwort:', { kind, installed });
		return installed;
	} catch (error) {
		console.error('Symbaroum AoE: Install-Query fehlgeschlagen', kind, error);
		return false;
	}
}

export function registerAoeHooks() {
	/* v1.2.1 (HOTFIX, Rudolfs Testrunde 3: v1.2-Toetungs-Regression):
	 * Die v1.2-Socket-Registrierung stand ALS ERSTE ANWEISUNG hier und
	 * lief damit auf TOP-LEVEL-Module-Import von hooks.js - game.socket
	 * existiert in dieser Phase NOCH NICHT (der eigene System-Code
	 * registriert Sockets konsequent erst im Hooks.once('ready'),
	 * hooks.js:694). Der TypeError brach registerAoeHooks AB: alle
	 * folgenden Hooks.on-Registrierungen (renderChatMessageHTML-
	 * Karten-Tasten-Wiring, Combat/Weltzeit-Takt, targetToken-Undo)
	 * waren TOT - deshalb keine bedienbaren Zonen-Karten-Tasten unter
	 * v1.2, waehrend Enter (Behavior-Script, unabhaengig) weiter
	 * funktionierte. Fix: Registrierung in Hooks.once('ready'). */
	Hooks.once('ready', () => {
		/* v1.4.2: Query-Registrierung ersetzt die v1.4/v1.4.1-Socket-
		   Registrierung - Details siehe aoeZoneInstallQueryHandler
		   (der Transport liefert die GM-Antwort jetzt zurueck). */
		globalThis.CONFIG.queries ??= {};
		globalThis.CONFIG.queries['symbaroum.aoeZoneInstall'] = aoeZoneInstallQueryHandler;
	});
	// v2.2 (Baustein 9, Rudolfs Anfrage 10.11.): Zielmarkierungen im
	// aktiven Zonen-Fenster auf Token INNERHALB der Zone beschränken.
	// Der targetToken-Hook ist per Hooks.callAll geschaltet (Signatur
	// void) - eine Markierung lässt sich NICHT verhindern, nur rückgängig
	// machen: Außen-Markierungen werden sofort wieder entfernt und mit
	// Rudolfs Warntext quittiert (kosmetischer Nebeneffekt: der Ziel-Pip
	// flackert kurz auf). Das eigene Undo feuert targetToken erneut mit
	// targeted=false und wird ignoriert (keine Rekursion). Pro Client
	// nur der eigene User; Fenster siehe _openTargetWindow.
	/* Hymnen-Anhang v1.1 (Rudolfs Freigabe 20.11., Testrunde v1 P3/P4):
	 * Token von der Szene entfernen raeumt die Gesangsflaechen des
	 * Saengers mit auf UND beendet den Gesang automatisch (Symbole am
	 * Akteur + Betroffenen-Symbole + Actor-Flags, endActiveHymns-Maschine
	 * in item.js hymnTokenDeleted). V14-Signatur: deleteToken(scene,
	 * token, options, userId) - Argument 1 ist die SZENE; der v1-Code
	 * las Arg 1 als TokenDoc (Aufräum-Trefferquote null). Defensive
	 * Argument-Suche haelt auch die Legacy-Signatur (tokenDoc zuerst). */
	Hooks.on('deleteToken', async (...args) => {
		if (!game.user?.isGM) return;
		const tokenDoc =
			args.find((a) => a && (a?.actor !== undefined || typeof a?.actorId === 'string') && a?.width !== undefined) ??
			args[0];
		const tokenId = String(tokenDoc?.id ?? tokenDoc?._id ?? '');
		const actorId = String(tokenDoc?.actor?.id ?? tokenDoc?.actorId ?? '');
		if (!tokenId && !actorId) return;
		/* v2 F19a (Rudolfs Kernsole-Beweis V5, Test C): Der deleteToken-Hook
		   laeuft INNERHALB der Core-Delete-Response-Verarbeitung - der
		   Server hat die angehaengte Region im selben Commit bereits
		   geloescht, das attachment-Feld im Client-Cache ist dort noch
		   unzuverlaessig (skipAttached griff nicht, V5-Runde). Die
		   Raeumungen laufen deshalb VERZOEGERT (~500 ms), NACH Abschluss
		   der Core-Kaskade: Existenz-Checks + try/catch je Loeschung,
		   das Rennen ist damit strukturell zu. Reihenfolge: Regionen
		   zuerst, Effekte danach (der deleteActiveEffect-Hook riefe
		   sonst removeThornCloakZones ohne skip ins offene Messer). */
		setTimeout(() => {
			void (async () => {
				try {
					await _hymnZoneCleanupToken(tokenId, actorId);
				} catch (e1) {
					console.warn('Symbaroum Hymnen [trace] Gesangsflaeche-Raeumung nach Token-Loeschung fehlgeschlagen', e1);
				}
				try {
					await removeThornCloakZones(actorId, { skipAttached: true });
				} catch (e2) {
					console.warn('Symbaroum Hymnen [trace] Dornenmantel-Flaeche-Raeumung nach Token-Loeschung fehlgeschlagen', e2);
				}
				try {
					await hymnTokenDeleted(tokenDoc);
				} catch (e3) {
					console.warn('Symbaroum Hymnen: Gesangs-Auto-Ende nach Token-Loeschung fehlgeschlagen', e3);
				}
				/* v2 F19b (V5b): Der geloeschte WIRKER behielt sonst seine
				   Dornenmantel-Effekte am AKTEUR - thorncloakTokenDeleted
				   raeumt Wirker- und Betroffenen-Symbole nach und postet
				   die kleine Ende-Karte. */
				try {
					await thorncloakTokenDeleted(tokenDoc);
				} catch (e4) {
					console.warn('Symbaroum Hymnen: Dornenmantel-Auto-Ende nach Token-Loeschung fehlgeschlagen', e4);
				}
				/* v2.1 F22 (Rudolfs G4/G5-Freigabe, Hymnen-Modell): Geloe-
				   schter WIRKER-Token - der Glyphen-Kreis liegt AM BODEN
				   (kein Anhang, anders als die Auren-Region stirbt er NICHT
				   mit dem Token), deshalb raeumt glypheTokenDeleted Kreis
				   (Region), Flag und Marker NACH der Core-Kaskade und postet
				   die kleine Ende-Karte. */
				try {
					await glypheTokenDeleted(tokenDoc);
				} catch (e5) {
					console.warn('Symbaroum Hymnen: Glyphen-Auto-Ende nach Token-Loeschung fehlgeschlagen', e5);
				}
			})();
		}, 500);
	});

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
		/* Hymnen-Anhang v1.1 (Rudolfs Testrunde v1, P12 - Freigabe
		   20.11.): Rundenwechsel-Scan - bei JEDEM Rundenwechsel des
		   Kampftrackers werden die aktiven Gesangsflaechen gescannt
		   und der Maintain-Zyklus gewurflos nachgezogen (hymnZoneRescan
		   ueber hymnAutoRescanRound in item.js: Hinaus-/Hineinbewegte
		   verlieren/erhalten das Symbol automatisch). Die POSITION
		   macht der Core-Anhang; hier laeuft nur der Bestands-Scan. */
		if (roundChange) {
			try {
				await hymnAutoRescanRound();
			} catch (error) {
				console.warn('Symbaroum Hymnen: Rundenwechsel-Scan fehlgeschlagen', error);
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
	   nach 15 Minuten"), große Sprünge tickten mehrfach ins Leere.
	   v2.7 (Testrunde 7, HAUPTBEFUND): Die Marken-Initialisierung lief hier
	   TOP-LEVEL bei der Modul-Evaluierung von hooks.js - VOR der Setting-
	   Registrierung im init-Hook (registerAoeSettings). game.settings.get
	   WIRFT für unregistrierte Settings: Die hooks.js-Evaluierung brach an
	   dieser Stelle ab und ALLE Top-Level-Registrierungen dahinter waren
	   tot (GM-Anwendungstasten = P2d, i18n-Config = P12, dieser Weltzeit-
	   Tick selbst = P8, A29-Reminder, deleteCombat). Die Initialisierung
	   steht jetzt am ENDE von registerAoeSettings, direkt nach der
	   Registrierung - unverändert ohne Tick (kein Sofort-Tick nach F5). */
	Hooks.on('updateWorldTime', async (worldTime) => {
		if (!game.user?.isGM || !aoeEnabled()) return;
		if (game.combat?.active) return;
		const mark = Math.floor((Number(worldTime) || 0) / 900);
		const last = Number(game.settings.get('symbaroum', 'aoeLastRoundMark')) || 0;
		/* v2.15 (Rudolfs Testrunde 14, Rückwärts-Klemme): läuft die Weltzeit
		   ZURÜCK, folgt die Marke still dem neuen Stand - sonst läge sie als
		   Hochwasserstand vor der Uhr und der Zonen-Rundentakt schwiege
		   dauerhaft (realer Fall aus Rudolfs Testrunde 14). */
		if (mark < last) {
			game.settings.set('symbaroum', 'aoeLastRoundMark', mark);
			return;
		}
		if (mark === last) return;
		game.settings.set('symbaroum', 'aoeLastRoundMark', mark);
		aoeRoundTick('worldtime');
		/* Hymnen-Anhang v1.1 (Rudolfs P12): Weltzeit-Parallel zum
		   Kampftracker-Rundenwechsel - je 15-Minuten-Marke ohne laufenden
		   Kampf denselben Gesangs-Bestands-Scan nachziehen (hymnZone-
		   Rescan-Maschine, probe-los wie die Maintain-Runde). */
		try {
			await hymnAutoRescanRound();
		} catch (error) {
			console.warn('Symbaroum Hymnen: Weltzeit-Scan fehlgeschlagen', error);
		}
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
	const tokens = _filterTargets(_collectRegionTokens(region), aoe.config.targeting, _casterTokenOfZone(aoe), aoe.config.includeCaster ?? null);
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
 * ABBRUCH der Zonen-AKTIVIERUNG (v2.11, Rudolfs Testrunde 10, P15): Called aus
 * dem cancel-Callback des Aktivierungs-Würfeldialogs (item.js modifierDialog),
 * wenn die Aktivierung ABGEBROCHEN statt ausgewürfelt wurde. Raeumt die
 * In-Flight-Marke SOFORT - vorher geschah das nur beim erfolgreichen Abschluss
 * (aoeZoneActivationCompleted) bzw. nach 5 Minuten Stale-Schutz, die Zone war
 * nach einem Dialog-Abbruch bis dahin nicht erneut ausloesbar (Rudolfs
 * P15-Befund: „sollte möglich sein"). Kein Karten-Update: Die Zonen-Karte
 * zeigt weiterhin „Auslösen" - die Aktivierung ist ja nie zustande gekommen.
 */
export function aoeZoneActivationAborted(regionId) {
	_zoneActivationInFlight.delete(regionId);
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
