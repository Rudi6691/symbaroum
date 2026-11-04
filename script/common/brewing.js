/**
 * Brauen v1 (Rudolfs Freigabe 02.11.2026: „Starte“ — Block 2 der Alchemie-
 * Automatisierung: Brau-Dialog + Rezepturverwaltung).
 * v1.1 (Freigabe 03.11.2026): Sammel-Fix Testrunde 1 — Labor-Dropdown
 * statt Bestwert-Anzeige (P9), Teratos-Schwellenkarte (P12), RAW-
 * Erinnerungszeile entfernt (P14).
 *
 * Wurf-Modell (BOTH Modi, Rudolfs Entscheidung): Scharfsinn-Probe mit
 * Labor-Bonus — d20 <= Scharfsinn + Bonus, keine Gunst-/Modifikator-Felder
 * im Dialog (bewusste Begrenzung v1). Labor-Leiter: kein Labor = Brauen
 * GESPERRT („nur Alchemiezutaten sammeln und Effekte analysieren“),
 * einfaches Feldlabor +0, gutes Feldlabor +1, einfaches stationäres
 * Labor +2, gutes stationäres Labor +3. Die Misserfolgsraten des
 * Ökonomie-Modus (30 %/25 %/20 %) bleiben reine Referenz für die SL.
 *
 * Zwei Modi (Welt-Setting „Brauen: Ökonomie-Modus“, GM, Default AUS):
 *  - Ökonomie: Kandidaten NUR aus eigenen Rezeptur-Items (Besitz owned
 *    ODER bound, beide braubar, dedupliziert über das Ziel-Elixier,
 *    Stufe <= eigene Alchemie-Stufe, Traditions-Gate). Zutaten werden je
 *    Dosis gebucht: units = ceil(LP_Orteg / 20) (halber LP in Schillingen;
 *    1 Alchemiezutat = 1 ß); Erfolg verbraucht units x Dosen und schreibt
 *    die Dosen ins Inventar; Fehlschlag verbraucht units x 1 (Grundmaterial
 *    des Versuchs) + „Runde verloren“-Zeile; reicht der Bestand nicht für
 *    alle Dosen, werden floor(Bestand/units) Dosen produziert (Hinweis).
 *    Nicht genug Zutaten für 1 Dosis => Brauen blockiert (hartes Gate).
 *  - RAW: Kandidaten aus den Welt-Items (plus eigenen Inventars-Elixieren,
 *    dedupliziert über den Namen), Stufe-Filter und Traditions-Gate über
 *    die fest hinterlegte Namen->Tradition-Zuordnung (Vault, 10 Elixiere).
 *    Keine Zutaten-Buchung; Fehlschlag verliert nichts. Dosen je RAW-Tabelle:
 *    eigene Stufe = Stufe => 1, Adept braut Novize => 1W4, Meister braut
 *    Adept => 1W4, Meister braut Novize => 1W8 (Wurf auf der Karte vor
 *    der Probe). Die 1x/Abenteuer-Grenze ist reine SL-Sache — v1.1 hat
 *    die Erinnerungszeile entfernt (Rudolfs Testrunde 1, Punkt 14).
 *
 * Teratos-Trank: 1W4 temporäre Korruption AM ENDE der Brauprobe, fällt
 * AUCH bei Fehlschlägen an (Namen-Match 'teratos', direkte Buchung auf
 * system.health.corruption.temporary).
 *
 * Karte: Raw-HTML-Muster der Elixier-Karten (postElixirCard) mit Radios
 * „Öffentlich“/„Geheim“ im Dialog (Geben-Dialog-Muster; Geheim flüstert
 * an GM + Selbst, transfer.js-Muster).
 *
 * Bewusst NICHT in v1: Rezeptbuch-UI, Spezialzutaten-Feld (Purpursaft
 * hat KEINE, Teratos ist SL-Sache), XP-Abbuchung Verbotenes Wissen
 * (manuelle GM-Spieler-Abwicklung, nur Hinweiszeile), Gunst/Modifikator.
 */
import { baseRoll, createRollData, getRollResultLevelKey } from './roll.js';
import { symbDialog } from './symbDialog.js';
import { modernDialogClasses, isModernDialogActive } from './modernSheetConfig.js';
import { getResourceTotal, consumeResource, getItemCount } from './resources.js';
import { isAlchemical, getAlchemyLevel, getElixirEffect, consumeElixirDose } from './elixirs.js';
import { getItemPriceBase } from './currency.js';
import { isStackableItem, findStackTarget } from './stacking.js';
import { checkCorruptionThreshold } from './item.js';
import { hasTraditionAccess, hasAnyTraditionAccess, parseTraditions, traditionLabel } from './tradition.js';

/* i18n-Helfer nach elixirs.js-Muster */
const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

/* Stufen-Rangfolge für den Stufen-Filter (Kandidaten-Stufe <= eigene). */
const LEVEL_ORDER = { novice: 1, adept: 2, master: 3 };

/* ---------------------------------------------------------------- */
/*  Test-Rig /rig (Alchemie Modul 3 v1.1, Rudolfs Testrunde P7/8/    */
/*  11/12 + Freigabe 05.11.)                                        */
/* ---------------------------------------------------------------- */

/* SL-Chat-Befehl „/rig <1-20>": erzwingt das W20-Ergebnis des NÄCHSTEN
 * Alchemie-Wurfs (Brauen/Analysieren/Nachbrauen) auf dem Client, der
 * den Befehl eingibt — kein 400-faches Würfeln mehr bis zum KritErf
 * oder Patzer. /rig 1 = (bestätigter) KritErf, /rig 20 = (bestätigter)
 * Patzer, beliebige Werte für Grenzfälle. Der Befehl ist GM-only und
 * wird als Chat-Nachricht UNTERDRÜCKT (return false). Das Rig ist rein
 * client-seitig: Der W20-Tooltip der Karte zeigt den ECHTEN Wurf, die
 * Auswertung (Erfolg/KritErf/Patzer-Zweige) folgt dem erzwungenen
 * Ergebnis — die Karte kennzeichnet das mit einer „Test-Rig“-Zeile.
 * Ohne aktives Rig würfelt alles normal weiter. */
let riggedDie = 0;

Hooks.on('chatMessage', (chatLog, message) => {
	if (!game.user.isGM) return true;
	const match = String(message ?? '').trim().match(/^\/rig\s+(\d{1,2})(?:\s|$)/i);
	if (!match) return true;
	const value = parseInt(match[1], 10);
	if (!(value >= 1 && value <= 20)) {
		ui.notifications.warn(L('RIG.ERR_BAD_VALUE'));
		return false;
	}
	riggedDie = value;
	ui.notifications.info(F('RIG.ARMED', { value }));
	return false;
});

/* Wurf-Auswertung konsistent auf den erzwungenen Wert umbiegen. Die
 * Alchemie-Proben sind einseitige Scharfsinn-Würfe ohne Gunst (favour
 * 0, resistRoll false) — deshalb reicht das Überschreiben von
 * diceResult/hasSucceed/critSuccess/critFail; alle Konsumenten in
 * brewing.js (Erfolgs-Zweige, KritErf-/Patzer-Erkennung über
 * getRollResultLevelKey, rohe-20-Patzer-Checks) lesen diese Felder. */
function applyRigToProbe(probe, forced) {
	const critsOn =
		game.settings.get('symbaroum', 'optionalCrit') || game.settings.get('symbaroum', 'optionalRareCrit');
	probe.diceResult = forced;
	probe.hasSucceed = critsOn
		? forced === 1 || (forced !== 20 && forced <= probe.diceTarget)
		: forced <= probe.diceTarget;
	if (critsOn) {
		probe.critSuccess = forced === 1;
		probe.critFail = forced === 20;
	} else {
		probe.critSuccess = false;
		probe.critFail = false;
	}
	probe.trueActorSucceeded = probe.hasSucceed;
	probe.resultLevelKey = getRollResultLevelKey(probe, false);
	probe.rollResult = game.symbaroum.api.formatRollResult({
		favour: probe.favour,
		diceResult: forced,
		dicesResult: probe.dicesResult,
		secondRollResult: critsOn && (forced === 1 || forced === 20) ? forced : undefined,
		resultLevelKey: probe.resultLevelKey,
	});
	probe.rigged = forced;
	return probe;
}

/* Einseitige Scharfsinn-Probe der Alchemie (Brauen/Analysieren/
 * Nachbrauen) — baseRoll wie bisher, mit Test-Rig-Abgriff: Ein
 * aktiviertes /rig verzehrt sich an genau dem nächsten Wurf. */
async function alchemyProbe(actor, modifier) {
	const probe = await baseRoll(actor, 'cunning', null, null, 0, modifier, false);
	if (riggedDie > 0) {
		const forced = riggedDie;
		riggedDie = 0;
		applyRigToProbe(probe, forced);
	}
	return probe;
}

/* Karten-Hinweiszeile bei erzwungenem Wurf (nur wenn Rig gegriffen
 * hat) — wandert direkt unter die Probe-Zeile aller drei Karten. */
function rigChatLine(probe) {
	return probe?.rigged ? F('RIG.CHAT_LINE', { value: probe.rigged }) : '';
}

/* ---------------------------------------------------------------- */
/*  Fest hinterlegte Namen->Tradition-Zuordnung (Vault Alchemie.md)  */
/* ---------------------------------------------------------------- */

/*
 * Rudolfs Vault-Zuordnung der traditionsgebundenen Elixiere - im RAW-Modus
 * (ohne Rezeptur-Items) die einzige Traditions-Quelle; der Rezeptur-
 * Generator (GM-Makro) nutzt dieselbe Liste. Zornbräu: nur das REINE
 * Zornbräu ist Hexenwissen (das UNreine bleibt bewusst ohne Zuordnung =
 * gelecktes Geheimnis). Kleinschreibung, Teilstring-Match (deutsche
 * Item-Namen von Rudolfs Welt-Tagging).
 */
const ELIXIR_TRADITION_RULES = [
	{ needle: 'zornbräu', not: 'unrein', tradition: 'witchcraft' },
	{ needle: 'verwandlungstrank', tradition: 'witchcraft' },
	{ needle: 'dornenbiest', tradition: 'witchcraft' },
	{ needle: 'geisterfreund', tradition: 'sorcery' },
	{ needle: 'homunculus', tradition: 'sorcery' },
	{ needle: 'schattentinte', tradition: 'sorcery' },
	{ needle: 'kriegsbemalung', tradition: 'symbolism' },
	{ needle: 'weihwasser', tradition: 'theurgy' },
];

/** Tradition eines Elixiers über den Namen ('' = Hörensagen, frei braubar). */
export function getElixirTradition(name) {
	const n = String(name ?? '').toLowerCase();
	for (const rule of ELIXIR_TRADITION_RULES) {
		if (!n.includes(rule.needle)) continue;
		if (rule.not && n.includes(rule.not)) continue;
		return rule.tradition;
	}
	return '';
}

/* ---------------------------------------------------------------- */
/*  Welt-Setting                                                      */
/* ---------------------------------------------------------------- */

export function registerBrewSettings() {
	// Brauen v1: Ökonomie-Modus (Rezeptur-Gate + Zutaten-Buchung) - bewusst
	// DIRECT UNTER den Munitions-Settings registriert (gleiche Foundry-
	// Einstellungsliste wie lootEnabled*/resourceConsumption/ammo*,
	// Reihenfolge = Registrierungsreihenfolge in hooks.js).
	game.settings.register('symbaroum', 'brewEconomy', {
		name: 'BREW.SETTING_ECONOMY',
		hint: 'BREW.SETTING_ECONOMY_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
	});
}

/** Effektiver Schalter des Ökonomie-Modus (sonst RAW-Modus). */
export function isBrewEconomyEnabled() {
	return !!game.settings.get('symbaroum', 'brewEconomy');
}

/* ---------------------------------------------------------------- */
/*  Helfer: Alchemie-Stufe, Labor, Traditions-Zugang, Zutaten         */
/* ---------------------------------------------------------------- */

/** Eigene aktive Alchemie-Stufe (''/novice/adept/master). */
export function getOwnAlchemyLevel(abilityItem) {
	const s = abilityItem?.system;
	if (!s) return '';
	if (s.master?.isActive) return 'master';
	if (s.adept?.isActive) return 'adept';
	if (s.novice?.isActive) return 'novice';
	return '';
}

/*
 * ALLE Labor-Einträge des Akteurs, absteigend nach Bonus sortiert (Bestes
 * zuerst - Vorauswahl im Dialog; Brauen v1.1, Rudolfs Testrunde 1 Punkt 9:
 * der Aktor kann mehrere Labore besitzen, auf Reisen aber nur ein
 * schlechteres mitführen - deshalb Dropdown statt Automatik). facility-
 * Category auf Ausrüstungs-Items (Status-Tab v1; Behälter-Kinder laufen
 * über die flache actor.items-Liste automatisch mit). Kein Labor => leere
 * Liste => Brauen gesperrt.
 */
export function resolveFacilities(actor) {
	const bonusMap = game.symbaroum.config.FACILITY_BONUS ?? {};
	const list = [];
	for (const item of actor?.items ?? []) {
		if (item?.type !== 'equipment') continue;
		const category = item.system?.facilityCategory ?? '';
		if (category === '') continue;
		const bonus = bonusMap[category];
		if (bonus === undefined) continue;
		list.push({ item, category, bonus, name: item.name });
	}
	list.sort((a, b) => b.bonus - a.bonus || a.name.localeCompare(b.name));
	return list;
}

/*
 * Bestes Labor des Akteurs (Bonus-Absteigend das erste; bei Gleichstand
 * alphabetisch stabil). Kein Labor => null => Brauen gesperrt.
 */
export function resolveBestFacility(actor) {
	const list = resolveFacilities(actor);
	return list.length > 0 ? list[0] : null;
}

/*
 * Traditions-Zugang: AB Traditionen v1 zentral in tradition.js
 * (Single Source; lokale Kopie entfernt). Reihenfolge: reference-Match,
 * „Verbotenes Wissen“ mit GESETZTEM Feld, „Verbotenes Wissen“-Namen-Match.
 * Leere Tradition = Hörensagen, immer frei. XP-Abbuchung bleibt
 * manuelle GM-Sache (keine Automatik).
 */

/**
 * Zutaten je Dosis: halber Listenpreis in Schillingen (1 Alchemiezutat
 * := 1 ß Materialwert, Ressourcen-v1-Kanonik) - LP in Orteg / 20, auf-
 * gerade mindestens 1 (Rudolfs Rechenbeispiel: Kräuterarznei 1 T LP
 * = 100 Orteg => 5 Einheiten je Dosis).
 */
export function unitsPerDose(elixir) {
	const price = getItemPriceBase(elixir) ?? 0;
	return Math.max(1, Math.ceil(price / 20));
}

/** Dosen-Formel der RAW-Tabelle (1 / 1d4 / 1d8) je Stufen-Differenz. */
function doseFormula(ownLevel, elixirLevel) {
	if (ownLevel === elixirLevel) return '1';
	if (ownLevel === 'adept' && elixirLevel === 'novice') return '1d4';
	if (ownLevel === 'master' && elixirLevel === 'adept') return '1d4';
	if (ownLevel === 'master' && elixirLevel === 'novice') return '1d8';
	return '1';
}

function doseLabel(formula) {
	if (formula === '1d4') return L('BREW.DOSE_1D4');
	if (formula === '1d8') return L('BREW.DOSE_1D8');
	return L('BREW.DOSE_1');
}

/* ---------------------------------------------------------------- */
/*  Kandidaten                                                        */
/* ---------------------------------------------------------------- */

/*
 * Traditionen eines Elixiers (Traditionen v1, Feld vor Namen):
 *  - Gate 'true'  => system.traditions (Komma-Join),
 *  - Gate 'false' => keine (bewusst abgewählt),
 *  - Gate ''      => Altbestand: Feld falls gefüllt, sonst Namen-Fallback
 *    über die Vault-Zuordnung (getElixirTradition). ANY-Semantik im Gate.
 */
function elixirTraditions(elixir) {
	const s = elixir?.system ?? {};
	const active = String(s.traditionsActive ?? '');
	if (active === 'true') return parseTraditions(s.traditions);
	if (active === 'false') return [];
	const fromField = parseTraditions(s.traditions);
	if (fromField.length > 0) return fromField;
	const byName = getElixirTradition(elixir?.name);
	return byName !== '' ? [byName] : [];
}

/*
 * Ökonomie-Modus: eigene Rezeptur-Items (Besitz owned ODER bound - beide
 * braubar), dedupliziert über das Ziel-Elixier (mehrere Ausfertigungen
 * derselben Rezeptur stoßen sich nicht), Stufe <= eigene Stufe,
 * Traditions-Gate über die Rezeptur-Angabe.
 */
function buildEconomyCandidates(actor, ownLevel) {
	const candidates = [];
	const seenTargets = new Set();
	for (const recipe of actor.items) {
		if (recipe?.type !== 'rezeptur') continue;
		const target = String(recipe.system?.target ?? '').trim();
		if (target === '' || seenTargets.has(target)) continue;
		const elixir = foundry.utils.fromUuidSync(target);
		if (!elixir) continue;
		const level = typeof recipe.system?.alchemyLevel === 'string' && recipe.system.alchemyLevel !== ''
			? recipe.system.alchemyLevel
			: getAlchemyLevel(elixir);
		if (level === '') continue;
		if ((LEVEL_ORDER[level] ?? 0) > (LEVEL_ORDER[ownLevel] ?? 0)) continue;
		const tradition = recipe.system?.alchemyTradition ?? '';
		if (!hasTraditionAccess(actor, tradition)) continue;
		seenTargets.add(target);
		candidates.push({
			key: target,
			recipe,
			elixir,
			level,
			tradition,
			units: unitsPerDose(elixir),
			doseFormula: doseFormula(ownLevel, level),
		});
	}
	return candidates;
}

/*
 * RAW-Modus: alle alchemistischen Welt-Items mit getaggter Alchemie-Stufe
 * (plus Inventars-Elixiere, dedupliziert über den Namen), Stufen-Filter
 * und Traditions-Gate über die Namen-Zuordnung. Keine Rezeptur-Items.
 */
function buildRawCandidates(actor, ownLevel) {
	const pool = [];
	for (const item of game.items ?? []) {
		if (item?.type === 'equipment' && isAlchemical(item.system) && getAlchemyLevel(item) !== '') pool.push(item);
	}
	const worldNames = new Set(pool.map((i) => i.name));
	for (const item of actor.items) {
		if (item?.type !== 'equipment') continue;
		if (worldNames.has(item.name)) continue;
		if (isAlchemical(item.system) && getAlchemyLevel(item) !== '') pool.push(item);
	}
	const candidates = [];
	for (const elixir of pool) {
		const level = getAlchemyLevel(elixir);
		if ((LEVEL_ORDER[level] ?? 0) > (LEVEL_ORDER[ownLevel] ?? 0)) continue;
		const traditions = elixirTraditions(elixir);
		if (!hasAnyTraditionAccess(actor, traditions)) continue;
		candidates.push({
			key: elixir.uuid,
			recipe: null,
			elixir,
			level,
			traditions,
			tradition: traditions[0] ?? '', // Kompatibilität (Single-Verwender)
			units: unitsPerDose(elixir),
			doseFormula: doseFormula(ownLevel, level),
		});
	}
	return candidates;
}

/* ---------------------------------------------------------------- */
/*  Brau-Dialog                                                       */
/* ---------------------------------------------------------------- */

export async function openBrewDialog(abilityItem) {
	const actor = abilityItem?.actor ?? abilityItem?.parent;
	if (!abilityItem || abilityItem.type !== 'ability' || abilityItem.system?.reference !== 'alchemy') return;
	if (!actor) return;
	const ownLevel = getOwnAlchemyLevel(abilityItem);
	if (ownLevel === '') {
		ui.notifications.warn(L('BREW.ERR_NO_LEVEL'));
		return;
	}
	const facilities = resolveFacilities(actor);
	if (facilities.length === 0) {
		ui.notifications.warn(L('BREW.ERR_NO_LAB'));
		return;
	}
	const economy = isBrewEconomyEnabled();
	const candidates = economy ? buildEconomyCandidates(actor, ownLevel) : buildRawCandidates(actor, ownLevel);
	if (candidates.length === 0) {
		ui.notifications.warn(L(economy ? 'BREW.ERR_NO_RECIPES' : 'BREW.ERR_NO_ELIXIRS'));
		return;
	}
	// Hartes Zutaten-Gate (Ökonomie): mindestens 1 Dosis des GÜNSTIGSTEN
	// Kandidaten muss bezahlbar sein, sonst blockiert der Dialog komplett
	// (Rudolfs Entscheidung); der konkrete Kandidat wird im Submit erneut
	// geprüft (Stock kann sich zwischen Öffnen und Brauen ändern).
	const stock = getResourceTotal(actor, 'alchemiezutat');
	if (economy && stock < Math.min(...candidates.map((c) => c.units))) {
		ui.notifications.warn(F('BREW.ERR_NO_MATERIALS', { stock }));
		return;
	}
	/* Alchemie Modul 3: Nachbrau-Bonus (+1 auf das nächste Gebräu). Der
	   Actor-Flag 'nachbrauBonus' entsteht beim bestätigten kritischen
	   Nachbrau-Erfolg; das Häkchen im Brau-Dialog verbraucht ihn. */
	const bonusNextAvailable = !!(await actor.getFlag('symbaroum', 'nachbrauBonus'));
	const modern = isModernDialogActive();
	const dialogHtml = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/brew-dialog.hbs', {
		renderModern: modern,
		bonusNext: bonusNextAvailable,
		candidates: candidates.map((c) => ({
			id: c.key,
			label: `${c.elixir.name} (${L(`ALCHEMY_LEVEL.${c.level.toUpperCase()}`)})`,
		})),
		preselect: candidates[0].key,
		/* Brauen v1.1 (Punkt 9): Labor-Dropdown statt Auto-Best-Labor -
		   alle Labore des Akteurs (Name + Bonus), Vorauswahl das beste. */
		facilities: facilities.map((f) => ({
			id: f.item.id,
			label: `${f.name} (+${f.bonus})`,
		})),
		labId: facilities[0].item.id,
		doseHint: doseLabel(candidates[0].doseFormula),
		unitsText: String(candidates[0].units),
		stockText: String(stock),
		economy,
	});
	symbDialog({
		title: `${L('BREW.DIALOG_TITLE')} — ${actor.name}`,
		content: dialogHtml,
		/* Brauen v1.2 (Testrunde 2): Nutzer-Marker wie die kanonischen
		   Würfeldialoge (dialog.js/item.js) - closeOpenRollDialogs
		   schließt den offenen Brau-Dialog jetzt beim Designwechsel
		   (Rudolfs v1.2-Entscheidung, Automatisierungspaket 1). */
		classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(modern ? modernDialogClasses('modern-roll-dialog') : [])],
		width: 440,
		// Dosen-/Zutaten-Zeilen beim Kandidatenwechsel aktualisieren (Live-DOM,
		// Loot-v1.3-Lernweis: onRender-Hook, Listener am vorgebauten Content).
		onRender: (element) => {
			const select = element?.querySelector?.('#brew-elixir');
			if (!select) return;
			const update = () => {
				const cand = candidates.find((c) => c.key === select.value);
				if (!cand) return;
				const doseEl = element.querySelector('#brew-dose-hint');
				if (doseEl) doseEl.value = doseLabel(cand.doseFormula);
				const unitsEl = element.querySelector('#brew-units');
				if (unitsEl) unitsEl.value = String(cand.units);
			};
			select.addEventListener('change', update);
			update();
		},
		buttons: {
			brew: {
				icon: '<i class="fas fa-flask"></i>',
				label: L('BREW.BUTTON'),
				callback: async (html) => {
					const key = html[0].querySelector('#brew-elixir')?.value;
					const cand = candidates.find((c) => c.key === key);
					if (!cand) return;
					/* Brauen v1.1 (Punkt 9): gewähltes Labor statt pauschal
					   dem besten (Fallback bestes, falls das Select fehlt). */
					const labId = html[0].querySelector('#brew-lab')?.value;
					const facility = facilities.find((f) => f.item.id === labId) ?? facilities[0];
					/* Sammel-Fix v1.1 (Testrunde 1, Punkt 10): freier
					   Modifikator aus #brew-modifier, addiert zum Labor-
					   Bonus in der Probe; leer/ungültig = 0. */
					const userMod = Number(html[0].querySelector('#brew-modifier')?.value);
					const modifier = (Number.isFinite(userMod) ? userMod : 0);
					/* Alchemie Modul 3: Bonus-Häkchen (nur zeigbar bei Flag;
					   Verbrauch bucht performBrew am Actor-Flag ab). */
					const bonusNext = bonusNextAvailable && !!html[0].querySelector('#brew-bonus-next')?.checked;
					let secret = false;
					for (const radio of html[0].querySelectorAll("input[name='brew-vis']")) {
						if (radio.checked) secret = radio.value === 'secret';
					}
					await performBrew(actor, facility, cand, { secret, economy, modifier, bonusNext });
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: () => {},
			},
		},
		default: 'brew',
	});
}

/* ---------------------------------------------------------------- */
/*  Brauvorgang + Karte                                               */
/* ---------------------------------------------------------------- */

/** Formel würfeln und den Wurf für die Chat-Karte mitsammeln (elixirs.js-Muster). */
async function rollFormula(formula, rolls) {
	const roll = await new Roll(String(formula)).evaluate();
	rolls.push(roll);
	return roll.total;
}

/** Dosen dem Inventar gutschreiben: Stapel-Merge, sonst Neuanlage (Übergabe-
 *  Muster). Nicht stapelbare Elixiere erhalten EINE Zeile je Dosis. */
async function addElixirDoses(actor, elixir, count) {
	const data = elixir.toObject();
	delete data._id;
	delete data.flags?.['symbaroum']?.favorite; // Favoriten nicht mitkopieren (Übergabe-Muster)
	if (isStackableItem(data)) {
		const amount = Math.max(1, Math.round(count));
		data.system.number = amount;
		const stack = findStackTarget(actor, data);
		if (stack) {
			await stack.update({ 'system.number': getItemCount(stack) + amount });
			return;
		}
		await actor.createEmbeddedDocuments('Item', [data]);
		return;
	}
	const rows = [];
	for (let i = 0; i < Math.max(1, Math.round(count)); i += 1) {
		rows.push(foundry.utils.duplicate(data));
	}
	await actor.createEmbeddedDocuments('Item', rows);
}

/** Probe-Zeile im Karten-Muster der Elixier-Karten (Scharfsinn + Labor-Bonus;
    Sammel-Fix v1.1: freier Modifikator wird bei != 0 zusätzlich ausgewiesen). */
function formatBrewProbeLine(rollData, labBonus, userMod = 0) {
	const modText = userMod !== 0 ? ` ${userMod > 0 ? '+' : '−'}${Math.abs(userMod)}` : '';
	return `${rollData.actingAttributeLabel} : (${rollData.actingAttributeValue})  ${L('BREW.LAB_BONUS')} +${labBonus}${modText}`;
}

async function performBrew(actor, facility, cand, { secret = false, economy = false, modifier = 0, bonusNext = false } = {}) {
	const rolls = [];
	const lines = [];
	/* Alchemie Modul 3: Schein-Rezeptur / Zeitbombe wirken NUR im
	   Ökonomie-Modus (Rezeptur-Bezug; RAW-Kandidaten haben recipe:null).
	   Beide Flags entstehen heimlich beim Nachbrau-Patzer (§13) und sind
	   GM-Sache — der Spieler sieht bis zur Entlarvung normale Karten. */
	const scheinFlag = economy && cand.recipe ? cand.recipe.getFlag('symbaroum', 'schein') : null;
	const zeitbombe = economy && cand.recipe ? cand.recipe.getFlag('symbaroum', 'zeitbombe') : null;
	// 1) Dosen-Wurf (RAW-Tabelle) VOR der Probe auf der Karte.
	let doses = 1;
	if (cand.doseFormula !== '1') {
		doses = Math.max(1, await rollFormula(cand.doseFormula, rolls));
		lines.push(F('BREW.CHAT_DOSES', { formula: cand.doseFormula.replace('d', 'W'), doses }));
	}
	// 1b) Alchemie Modul 3 — ZEITBOMBE-Detonation (bestätigter Nachbrau-
	//     Patzer): Der Versuch DETONIERT automatisch — Fehlschlag ohne
	//     Probe, 1W4 Zähigkeits-Schaden am Brauenden, Flag wird verbraucht
	//     (eine etwaige Schein-Rezeptur bleibt Schein).
	if (zeitbombe) {
		await cand.recipe.unsetFlag('symbaroum', 'zeitbombe');
		const damage = Math.max(1, await rollFormula('1d4', rolls));
		const toughness = Number(actor.system?.health?.toughness?.value ?? 0);
		await actor.update({ 'system.health.toughness.value': Math.max(0, toughness - damage) });
		lines.push(F('SCHEIN.CHAT_BOMB', { damage }));
		lines.push(L('BREW.CHAT_FAILURE'));
		if (economy) {
			const stock = getResourceTotal(actor, 'alchemiezutat');
			if (stock >= cand.units) {
				await consumeResource(actor, 'alchemiezutat', cand.units);
				lines.push(F('BREW.CHAT_MATERIALS_LOST', { amount: cand.units }));
			}
			lines.push(L('BREW.CHAT_ROUND_LOST'));
		}
		await postBrewCard(actor, F('BREW.CHAT_TITLE', { name: actor.name, elixir: cand.elixir.name }), lines, rolls, secret);
		return;
	}
	// 2) Scharfsinn-Probe mit Labor-Bonus + freiem Modifikator (Sammel-Fix
	//    v1.1, Testrunde 1 Punkt 10; kein Ziel, keine Gunst). Alchemie
	//    Modul 3: Nachbrau-Bonus +1 (sichtbar in der Probezeile) und
	//    SCHEIN-Heimlich −4 (unsichtbar — die Karte zeigt keinen Malus).
	const scheinMod = scheinFlag ? -4 : 0;
	const bonusMod = bonusNext ? 1 : 0;
	const probe = await alchemyProbe(actor, facility.bonus + modifier + scheinMod + bonusMod);
	rolls.push(...probe.rolls);
	const success = probe.trueActorSucceeded;
	lines.push(
		`<div class="tooltip"><p>${formatBrewProbeLine(probe, facility.bonus, modifier + bonusMod)} — ${success ? L('BREW.CHAT_SUCCESS') : L('BREW.CHAT_FAILURE')}</p><span class="tooltiptext">${probe.toolTip}</span></div>`
	);
	lines.push(rigChatLine(probe));
	// 2b) Alchemie Modul 3: verbrauchter Nachbrau-Bonus abmelden (der Flag
	//     wirkt EIN Mal — Häkchen im Brau-Dialog, Verbrauch hier).
	if (bonusNext) await actor.unsetFlag('symbaroum', 'nachbrauBonus');
	// 3) Buchung + Produktion.
	let produced = 0;
	if (success) {
		if (economy) {
			const stock = getResourceTotal(actor, 'alchemiezutat');
			const maxDoses = Math.floor(stock / cand.units);
			if (maxDoses < 1) {
				// Restbestand reicht nicht mehr (Race zwischen Öffnen und Submit):
				// nichts buchen, keine Karte - der Versuch ist blockiert.
				ui.notifications.warn(F('BREW.ERR_NO_MATERIALS', { stock }));
				return;
			}
			produced = Math.min(doses, maxDoses);
			await consumeResource(actor, 'alchemiezutat', cand.units * produced);
			lines.push(F('BREW.CHAT_MATERIALS', { amount: cand.units * produced, units: cand.units }));
			if (produced < doses) {
				lines.push(F('BREW.CHAT_PRODUCED_PARTIAL', { count: produced, planned: doses }));
			}
		} else {
			produced = doses;
		}
		if (produced >= 1) {
			/* Alchemie Modul 3 — SCHEIN-Rückstand: Der Brauer hält die
			   Rezeptur für echt; das Erzeugnis ist wertloser Rückstand —
			   1W6 Einheiten STATT der Elixiere, die Karte bleibt normal
			   (beanspruchter Name, normale Mengenzeile). Nur der
			   Inventar-Bestand verrät die Täuschung. */
			if (scheinFlag) {
				const residue = Math.max(1, await rollFormula('1d6', rolls));
				await addResidueDoses(actor, residue);
			} else {
				await addElixirDoses(actor, cand.elixir, produced);
			}
			lines.push(F('BREW.CHAT_PRODUCED', { count: produced, name: cand.elixir.name }));
		}
	} else if (economy) {
		// Fehlschlag: Grundmaterial des Versuchs (units x 1) weg + Runde
		// verloren (Rudolfs Entscheidung); Restbestand unter units => gar
		// nichts buchen (Edge, kein negativer Bestand).
		const stock = getResourceTotal(actor, 'alchemiezutat');
		if (stock >= cand.units) {
			await consumeResource(actor, 'alchemiezutat', cand.units);
			lines.push(F('BREW.CHAT_MATERIALS_LOST', { amount: cand.units }));
		}
		lines.push(L('BREW.CHAT_ROUND_LOST'));
	}
	// 4) Teratos-Trank: 1W4 temporäre Korruption AM ENDE der Brauprobe,
	// auch bei Fehlschlägen (direkte Buchung, sichtbare Kartenzeile).
	if (String(cand.elixir.name ?? '').toLowerCase().includes('teratos')) {
		const corruption = await rollFormula('1d4', rolls);
		const current = Number(actor.system?.health?.corruption?.temporary ?? 0);
		/* Brauen v1.1 (Rudolfs Testrunde 1, Punkt 12): Schwellen-Karte
		   feuert jetzt beim Teratos-Zuwachs - kanonischer Systempfad
		   (Elixiere v1.5): checkCorruptionThreshold liest den VOR-Stand
		   (system.health.corruption.value ist ABGELEITET als temporary
		   + longterm + permanent, actor.js prepareDerivedData) und
		   rechnet + Zuwachs gegen Schwelle/Max - deshalb der Aufruf VOR
		   der Buchung, exakt wie der A28-Tick/GM-Karten-Handler
		   (hooks.js-Muster). */
		await checkCorruptionThreshold(actor, corruption);
		await actor.update({ 'system.health.corruption.temporary': current + corruption });
		lines.push(F('BREW.CHAT_TERATOS', { corruption }));
	}
	// 5) Brauen v1.1 (Rudolfs Testrunde 1, Punkt 14): die RAW-Erinnerungs-
	// zeile „1 Gebräu je Elixier und Abenteuer" ist ENTFERNT - die 1x-
	// Grenze ist bewusst reine SL-Überwachung (kein Tracking, keine
	// Erinnerung auf der Karte).
	await postBrewCard(actor, F('BREW.CHAT_TITLE', { name: actor.name, elixir: cand.elixir.name }), lines, rolls, secret);
}

/** Brau-Karte im Raw-HTML-Muster der Elixier-Karten; Geheim flüstert an GM + Selbst. */
async function postBrewCard(actor, title, lines, rolls = [], secret = false) {
	const safeLines = lines.filter(Boolean);
	const html = `<div class="symbaroum chat ability"><div class="foreground"><h4>${title}</h4>${safeLines
		.map((line) => `<div class="finalTxt">${line}</div>`)
		.join('')}</div></div>`;
	const chatData = {
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: actor?.id }),
		content: html,
		rollMode: game.settings.get('core', 'messageMode'),
	};
	if (secret) {
		const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
		chatData.whisper = [...new Set([game.user.id, ...gmIds])];
	} else {
		ChatMessage.applyMode(chatData, 'public');
	}
	if (rolls.length > 0) chatData.rolls = [createRollData(rolls)];
	await ChatMessage.create(chatData);
}

/* ================================================================ */
/*  ALCHEMIE MODUL 3 (Rudolfs Startsignal 04.11.2026 „Leg los“):      */
/*  Analysieren (§14), Nachbrauen (§13), Unbekannte Elixiere (§6a)      */
/*  und Verbotenes-Wissen-Erwerb. Design-Entscheidungen im            */
/*  Auslieferungs-Dok Symbaroum-V14-Alchemie-v1.0 dokumentiert.        */
/* ================================================================ */

/* GM-Flüsterempfänger (die Wahrheit sieht nur der SL; ein anfragender
   GM bleibt über game.user.id selbst dabei — Spieler sehen nichts). */
function gmWhisperTargets() {
	const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
	return game.user.isGM ? [...new Set([game.user.id, ...gmIds])] : gmIds;
}

/** GM-Flüsterkarte (Raw-HTML-Muster der Brau-Karte, reines SL-Flüstern). */
async function whisperGM(title, lines = []) {
	const safeLines = lines.filter(Boolean);
	const html = `<div class="symbaroum chat ability"><div class="foreground"><h4>${title}</h4>${safeLines
		.map((line) => `<div class="finalTxt">${line}</div>`)
		.join('')}</div></div>`;
	await ChatMessage.create({
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ alias: game.user.name }),
		whisper: gmWhisperTargets(),
		content: html,
	});
}

/** Alchemie-Fähigkeit eines Akters (reference 'alchemy' mit aktiver Stufe). */
export function findAlchemyAbility(actor) {
	for (const item of actor?.items ?? []) {
		if (item?.type === 'ability' && item.system?.reference === 'alchemy' && getOwnAlchemyLevel(item) !== '') return item;
	}
	return null;
}

/** Wirkungs-Kategorie eines Elixiers aus den elixirEffect-Feldern
 *  (Analyse-Spuren §14): heilt / vergiftet / explodiert / senkt
 *  Korruption / verändert; Reihenfolge = Priorität, Fallback „unklar“
 *  (nur gefüllte Felder zählen).
 *  Alchemie Modul 3 v1.1 (Rudolfs Testrunde P6, Bummstein): Schaden
 *  OHNE Gift-Kontext ist NICHT „vergiftet", sondern „explodiert" —
 *  nur das Waffen-Gift-Feld (weaponPoison) bleibt bei „vergiftet";
 *  Sofort-Schaden und Schaden-pro-Runde (Bummstein 1W4/1W6/1W8,
 *  Säurekugel-DoT) laufen auf die neue Kategorie. */
export function elixirCategoryKey(elixir) {
	const eff = getElixirEffect(elixir);
	const filled = (v) => String(v ?? '').trim() !== '' && Number(v) !== 0;
	if (filled(eff.heal) || filled(eff.healPerRound) || filled(eff.removeCondition)) return 'ANALYSE.CAT_HEALS';
	if (filled(eff.weaponPoison)) return 'ANALYSE.CAT_POISONS';
	if (filled(eff.damage) || filled(eff.damagePerRound)) return 'ANALYSE.CAT_EXPLODES';
	if (filled(eff.corruptionRemove)) return 'ANALYSE.CAT_CORRUPTION';
	const attrMode = String(eff.attributeMode ?? '').trim();
	if ((attrMode !== '' && attrMode !== 'no' && attrMode !== 'false') || filled(eff.attrib)) return 'ANALYSE.CAT_ALTERS';
	return 'ANALYSE.CAT_UNKNOWN';
}

/** Hat der Akter eine Rezeptur zu diesem Elixier (Ziel-Auflösung über den
 *  Namen — Welt- wie Inventar-Ziele)? Analyse-Hinweiszeile. */
export function hasRelatedRecipe(actor, elixir) {
	for (const recipe of actor?.items ?? []) {
		if (recipe?.type !== 'rezeptur') continue;
		const target = String(recipe.system?.target ?? '').trim();
		const targetItem = target !== '' ? foundry.utils.fromUuidSync(target) : null;
		if (targetItem?.name === elixir?.name) return true;
	}
	return false;
}

/** Alchemie Modul 3 v1.1 (Rudolfs Testrunde P2d/4/10/13 + Freigabe
 *  05.11.): Basisname eines Elixier-Namens — das Stufen-Suffix am
 *  Namensende („, schwach/moderat/stark", auch Klammer-/Leerzeichen-
 *  Form und die englischen Labels) wird für VERGLEICHE abgestreift.
 *  Grund: Welten mit EINEM Item je Stufe („Purpursaft, schwach /
 *  moderat / stark" — Rudolfs Setup) verweisen die Rezepturen je Stufe
 *  auf VERSCHIEDENE Items mit verschiedenen Namen; der bisherige exakte
 *  Namensgleichheit-Vergleich (ownedBaseRecipes) fand dann nie eine
 *  Grund-Rezeptur und der Nachbrau-Dialog blieb komplett unerreicht.
 *  Struktur-Suffix nur am Ende mit Trenner (Komma/Klammer/Leerzeichen),
 *  sodass Namen, die zufällig mit dem Wortteil enden („Elixier der
 *  Stärke, stark" → „Elixier der Stärke"), korrekt normalisieren,
 *  integralen Wortteil („Bärenstark-Brause") aber unangetastet lassen. */
function elixirBaseName(name) {
	return String(name ?? '')
		.replace(/[,\s(]+(schwach|moderat|stark|weak|moderate|strong)\)?\s*$/i, '')
		.trim();
}

/** Stufe aus dem Namens-Suffix (Fallback für UNGETAGGTE Quell-Items,
 *  Alchemie Modul 3 v1.1): Kompendiums- oder Welt-Items ohne Status-Tab-
 *  Tagging (system.alchemyLevel leer) — das Suffix im Namen zählt wie
 *  das Feld („…, schwach" → novice, „…, moderat" → adept, „…, stark" →
 *  master; englische Labels entsprechend). '' = kein Stufen-Suffix. */
function levelFromNameSuffix(name) {
	const match = String(name ?? '').match(/[,\s(]+(schwach|moderat|stark|weak|moderate|strong)\)?\s*$/i);
	const suffix = match?.[1]?.toLowerCase() ?? '';
	if (['schwach', 'weak'].includes(suffix)) return 'novice';
	if (['moderat', 'moderate'].includes(suffix)) return 'adept';
	if (['stark', 'strong'].includes(suffix)) return 'master';
	return '';
}

/** Grund-Rezepturen des Akters zum selben Elixier mit ANDERER Stufe
 *  (Nachbrau-Voraussetzung §13): Besitz muss 'owned' sein — gebundene
 *  (bound) Ausfertigungen taugen als Grundlage NICHT.
 *  v1.1: Der Elixier-Bezug läuft über den NORMALISIERTEN Basisnamen
 *  (elixirBaseName), damit Ein-Item-je-Stufe-Welten matchen: Die
 *  Rezeptur „Purpursaft, moderat" (Ziel: Item „Purpursaft, moderat")
 *  ist eine gültige Grundlage für den Nachbrau-Kandidaten
 *  „Purpursaft, schwach" — gleiche Basis, andere Stufe. Der exakte
 *  Namensvergleich (Ein-Basis-Item-Welten) bleibt als Spezialfall
 *  abgedeckt, da Normalisierung dort identisch ist. */
export function ownedBaseRecipes(actor, elixir, otherThanLevel) {
	const list = [];
	const elixirBase = elixirBaseName(elixir?.name);
	for (const recipe of actor?.items ?? []) {
		if (recipe?.type !== 'rezeptur') continue;
		if (String(recipe.system?.ownership ?? 'owned') !== 'owned') continue;
		const target = String(recipe.system?.target ?? '').trim();
		const targetItem = target !== '' ? foundry.utils.fromUuidSync(target) : null;
		if (!targetItem || elixirBaseName(targetItem.name) !== elixirBase) continue;
		const level = String(recipe.system?.alchemyLevel ?? '');
		if (level === '' || level === otherThanLevel) continue;
		list.push({ recipe, level });
	}
	list.sort((a, b) => (LEVEL_ORDER[a.level] ?? 0) - (LEVEL_ORDER[b.level] ?? 0));
	return list;
}

/** Analyse (§14): Probe-Modifikator je Stufen-Differenz — Δ0 = 0, Ziel
 *  +1 Stufe = −2, Ziel +2 Stufen = −4; Kandidaten-Cap: wirksame Stufe +2. */
export function analyseDiffModifier(effectiveOrder, targetLevel) {
	const delta = (LEVEL_ORDER[targetLevel] ?? 0) - effectiveOrder;
	if (delta <= 0) return 0;
	return delta === 1 ? -2 : -4;
}

/** Nachbrau (§13): asymmetrischer Stufen-Modifikator — Ziel UNTER der
 *  eigenen Stufe +1 (Erleichterung), Ziel ÜBER der eigenen Stufe −3
 *  (Erschwernis), gleichstufig 0. */
export function nachbrauDiffModifier(ownLevel, targetLevel) {
	const delta = (LEVEL_ORDER[targetLevel] ?? 0) - (LEVEL_ORDER[ownLevel] ?? 0);
	if (delta < 0) return 1;
	if (delta > 0) return -3;
	return 0;
}

/** Probe-Zeile der Analyse-/Nachbrau-Karten (Scharfsinn + Labor-Bonus +
 *  freier Modifikator — Segmente bei 0 weggelassen, Brau-Karten-Muster). */
function formatAnalyseProbeLine(rollData, labBonus = 0, userMod = 0) {
	let line = `${rollData.actingAttributeLabel} : (${rollData.actingAttributeValue})`;
	if (labBonus !== 0) line += `  ${L('BREW.LAB_BONUS')} ${labBonus > 0 ? '+' : '−'}${Math.abs(labBonus)}`;
	if (userMod !== 0) line += `  ${L('DIALOG.MODIFIER')} ${userMod > 0 ? '+' : '−'}${Math.abs(userMod)}`;
	return line;
}

/** Zufällige gleichstufige Täuschungs-Quelle (Fehlbestimmungs-/Schein-
 *  §6a), Alchemie Modul 3 v1.1 (Rudolfs Testrunde + Freigabe 05.11.):
 *  Pool aus WELT-Items, ALLEN Item-Kompendien und dem Inventar des
 *  handelnden Akteurs — dedupliziert über den Namen, ausgeschlossen
 *  der Zielname; null = keine Quelle (dann bleibt es bei der offenen
 *  Fehlzeile + SL-Flüsterkarte). Die Stufe kommt aus dem alchemyLevel-
 *  Tagging ODER — v1.1-Fallback für ungetaggte Quell-Items (Kompendium/
 *  Welt ohne Status-Tab-Tagging) — aus dem Namens-Suffix („…, schwach"
 *  etc.). Traditionen werden bei der Quell-Auswahl bewusst NICHT
 *  gefiltert (Rudolfs Freigabe: „Die Tradition kann bei der Auswahl
 *  ignoriert werden") — die Schein-Identität übernimmt ohnehin nur
 *  Name + Beschreibung. ASYNC, weil Kompendium-Inhalte erst geladen
 *  werden müssen (Foundry cached getDocuments nach dem ersten Laden). */
async function randomDeceptionSource(level, excludeName = '', sourceActor = null) {
	const pool = new Map(); // Name → Item (Dedup: erstes Vorkommen gewinnt)
	const matches = (item) => {
		if (item?.type !== 'equipment') return false;
		if (excludeName !== '' && item.name === excludeName) return false;
		const itemLevel = getAlchemyLevel(item) || levelFromNameSuffix(item.name);
		return itemLevel === level;
	};
	for (const item of game.items ?? []) {
		if (matches(item)) pool.set(item.name, item);
	}
	for (const item of sourceActor?.items ?? []) {
		if (matches(item)) pool.set(item.name, item);
	}
	for (const pack of game.packs ?? []) {
		if (pack?.metadata?.type !== 'Item') continue;
		let documents = [];
		try {
			documents = await pack.getDocuments();
		} catch {
			continue; // Pack nicht lesbar (z.B. gerade gesperrt): Quelle überspringen
		}
		for (const item of documents) {
			if (matches(item)) pool.set(item.name, item);
		}
	}
	if (pool.size === 0) return null;
	const values = [...pool.values()];
	return values[Math.floor(Math.random() * values.length)];
}

/** Fehlbestimmung anwenden (§6a): Das Item erhält die SCHEIN-Identität
 *  (Name + Beschreibung), die Originale wandern ins Flag 'fehlbestimmt'.
 *  Bei bereits unbekannt-markierten Items zeigt realName auf die reale
 *  (noch verhüllte) Identität aus dem unknownElixir-Flag (Übergang). */
async function applyFehlbestimmung(item, falseElixir, { stackWide = false } = {}) {
	const unknownFlag = item.getFlag('symbaroum', 'unknownElixir');
	const flag = {
		realName: unknownFlag?.realName ?? item.name,
		realDescription: unknownFlag?.realDescription ?? String(item.system?.description ?? ''),
		falseName: falseElixir.name,
		falseDescription: String(falseElixir.system?.description ?? ''),
		falseId: falseElixir.uuid,
		stackWide,
	};
	await item.setFlag('symbaroum', 'fehlbestimmt', flag);
	await item.update({ name: flag.falseName, 'system.description': flag.falseDescription });
	return flag;
}

/** Täuschungs-Markierungen aufheben (BEIDE Flags: fehlbestimmt und
 *  unknownElixir) — Originale wiederherstellen; Reihenfolge erst
 *  fehlbestimmt, dann unbekannt, damit die älteste Identität gewinnt. */
export async function restoreDeception(item) {
	const fehl = item.getFlag('symbaroum', 'fehlbestimmt');
	if (fehl) {
		await item.update({ name: fehl.realName, 'system.description': fehl.realDescription });
		await item.unsetFlag('symbaroum', 'fehlbestimmt');
	}
	const unknown = item.getFlag('symbaroum', 'unknownElixir');
	if (unknown) {
		await item.update({ name: unknown.realName, 'system.description': unknown.realDescription });
		await item.unsetFlag('symbaroum', 'unknownElixir');
	}
}

/** Alchemischer Rückstand (Schein-Brau-Produkt §6a): inertes Ausrüstungs-
 *  Item, stapelt sich im Inventar über Namen + Anzahl (Merge-Muster). */
async function addResidueDoses(actor, count) {
	const name = L('SCHEIN.RESIDUE');
	const amount = Math.max(1, Math.round(count));
	const existing = actor.items.find((i) => i?.type === 'equipment' && i.name === name);
	if (existing) {
		await existing.update({ 'system.number': getItemCount(existing) + amount });
		return;
	}
	await actor.createEmbeddedDocuments('Item', [
		{
			type: 'equipment',
			name,
			img: 'icons/svg/item-bag.svg',
			system: { number: amount, alchemical: 'false' },
		},
	]);
}

/* ---------------------------------------------------------------- */
/*  Kandidaten: Analysieren + Nachbrauen                              */
/* ---------------------------------------------------------------- */

/** Analyse-Kandidaten (§14): Inventar-Dosen zuerst, dann Welt-Items,
 *  Deduplizierung über den Namen, Unbekannt-Badge bei Täuschungs-Flag;
 *  Stufen-Cap = wirksame Stufe + 2. */
export function buildAnalyseCandidates(actor, capLevel) {
	const cap = LEVEL_ORDER[capLevel] ?? 0;
	const candidates = [];
	const seen = new Set();
	const push = (item, inInventory) => {
		const level = getAlchemyLevel(item);
		if (level === '' || (LEVEL_ORDER[level] ?? 0) > cap + 2) return;
		if (seen.has(item.name)) return;
		seen.add(item.name);
		candidates.push({
			key: item.uuid,
			item,
			name: item.name,
			level,
			inInventory,
			units: unitsPerDose(item),
			unknown: !!item.getFlag('symbaroum', 'unknownElixir') || !!item.getFlag('symbaroum', 'fehlbestimmt'),
		});
	};
	for (const item of actor?.items ?? []) {
		if (item?.type === 'equipment' && isAlchemical(item.system)) push(item, true);
	}
	for (const item of game.items ?? []) {
		if (item?.type === 'equipment' && isAlchemical(item.system)) push(item, false);
	}
	return candidates;
}

/** Geholfte Analyse: mögliche geleitende Akteure — nur HÖHERE eigene
 *  Alchemie-Stufe; die wirksame Stufe des Analysierers steigt auf
 *  max(eigene, geleitete) (Kandidaten-Cap + Modifikator). */
export function buildGuideOptions(actor, ownLevel) {
	const own = LEVEL_ORDER[ownLevel] ?? 0;
	const guides = [];
	for (const other of game.actors ?? []) {
		if (!other || other.id === actor?.id) continue;
		const ability = findAlchemyAbility(other);
		if (!ability) continue;
		const level = getOwnAlchemyLevel(ability);
		if ((LEVEL_ORDER[level] ?? 0) <= own) continue;
		guides.push({ id: other.id, level, label: `${other.name} (${L(`ALCHEMY_LEVEL.${level.toUpperCase()}`)})` });
	}
	return guides;
}

/** Nachbrau-Kandidaten (§13): Dosen im Inventar mit Stufe ≤ eigener
 *  Alchemie-Stufe UND vorhandener Grund-Rezeptur (owned, gleiches
 *  Elixier, ANDERE Stufe); bereits existierende Rezepturen desselben
 *  Ziels UND Stufe sind keine Kandidaten (Dedup schon im Dialog).
 *  blocked = Traditions-Zugang fehlt (VW-Knopf im Dialog). */
export function buildNachbrauCandidates(actor, ownLevel) {
	const cap = LEVEL_ORDER[ownLevel] ?? 0;
	const candidates = [];
	for (const item of actor?.items ?? []) {
		if (item?.type !== 'equipment' || !isAlchemical(item.system)) continue;
		const level = getAlchemyLevel(item);
		if (level === '' || (LEVEL_ORDER[level] ?? 0) > cap) continue;
		if (getItemCount(item) < 1) continue;
		const grunds = ownedBaseRecipes(actor, item, level);
		if (grunds.length === 0) continue;
		// Rezeptur-Ziel: dauerhaftes Welt-Item gleichen Namens, sonst die
		// Inventarskopie selbst (RezepturSheet._onDrop-Muster).
		const world = (game.items ?? []).find((i) => i?.type === 'equipment' && i.name === item.name) ?? item;
		const hasSameRecipe = (actor.items ?? []).some(
			(r) =>
				r?.type === 'rezeptur' &&
				String(r.system?.target ?? '').trim() === world.uuid &&
				String(r.system?.alchemyLevel ?? '') === level
		);
		if (hasSameRecipe) continue;
		const traditions = elixirTraditions(item);
		candidates.push({
			key: item.id,
			item,
			name: item.name,
			level,
			worldUuid: world.uuid,
			grunds,
			blocked: traditions.length > 0 && !hasAnyTraditionAccess(actor, traditions),
		});
	}
	return candidates;
}

/* ---------------------------------------------------------------- */
/*  Alchemie-Menü (Modul 3) + Analyse-Dialog                          */
/* ---------------------------------------------------------------- */

/** Alchemie-Menü: Vier-Button-Einstieg — Brauen/Analysieren/Nachbrauen/
 *  Abbrechen. Zugang seit v1.1 (Rudolfs Testrunde P2 + Freigabe 05.11.)
 *  über das FÄHIGKEITS-ICON der Alchemie-Kachel im Spielerbogen (Kräfte-
 *  Tab + Kampf-Tab-Favoriten, player.js capture-Klick); die früheren
 *  Einstiege — Kolben-Button am Item-Blatt und Kontextmenü-Eintrag
 *  „Elixier brauen…" — sind entfallen. Menü-Layout v1.1 (P2c): Die
 *  Buttons stehen UNTEREINANDER in gleicher Breite (Footer-Umstyling im
 *  onRender, keine CSS-Datei nötig). */
export async function openAlchemyMenu(abilityItem) {
	const actor = abilityItem?.actor ?? abilityItem?.parent;
	if (!abilityItem || abilityItem.type !== 'ability' || abilityItem.system?.reference !== 'alchemy' || !actor) return;
	const modern = isModernDialogActive();
	const html = `<div class="symbaroum${modern ? ' modern-roll-dialog' : ' dialog'}"><div class="finalTxt">${L('ALCHEMY_MENU.HINT')}</div></div>`;
	symbDialog({
		title: `${L('ALCHEMY_MENU.DIALOG_TITLE')} — ${actor.name}`,
		content: html,
		classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(modern ? modernDialogClasses('modern-roll-dialog') : [])],
		width: 360,
		/* v1.1 (P2c): Footer-Buttons untereinander, gleiche Breite. Der
		 * Menü-Dialog hat KEINE Buttons im Content (nur die Hinweis-
		 * zeile) — im Fensterrahmen liegen genau die vier Dialog-
		 * Buttons; DialogV2 rendert sie im <footer>, deshalb das
		 * Spalten-Layout am Footer-Container (Breite folgt dem Dialog,
		 * width 100% je Button). */
		onRender: (element) => {
			const btns = element?.querySelectorAll?.('footer button');
			if (!btns || btns.length === 0) return;
			const footer = btns[0].closest('footer') ?? btns[0].parentElement;
			if (footer) {
				footer.style.display = 'flex';
				footer.style.flexDirection = 'column';
				footer.style.gap = '0.25rem';
			}
			for (const b of btns) b.style.width = '100%';
		},
		buttons: {
			brew: {
				icon: '<i class="fas fa-flask"></i>',
				label: L('ALCHEMY_MENU.BREW'),
				callback: () => openBrewDialog(abilityItem),
			},
			analyse: {
				icon: '<i class="fas fa-search"></i>',
				label: L('ALCHEMY_MENU.ANALYSE'),
				callback: () => openAnalyseDialog(abilityItem),
			},
			nachbrau: {
				icon: '<i class="fas fa-vial"></i>',
				label: L('ALCHEMY_MENU.NACHBRAU'),
				callback: () => openNachbrauDialog(abilityItem),
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: () => {},
			},
		},
		default: 'brew',
	});
}

/** Analyse-Dialog (§14): Elixier-Auswahl (Inventar zuerst), optionale
 *  geleitete Analyse (höherstufiger Akteure, hebt die wirksame Stufe),
 *  Labor-Dropdown (Analyse ist auch OHNE Labor erlaubt — „nur sammeln
 *  und analysieren“), freier Modifikator, Live-Info-Zeile. */
export async function openAnalyseDialog(abilityItem, { presetTargetUuid = null } = {}) {
	const actor = abilityItem?.actor ?? abilityItem?.parent;
	if (!abilityItem || abilityItem.type !== 'ability' || abilityItem.system?.reference !== 'alchemy' || !actor) return;
	const ownLevel = getOwnAlchemyLevel(abilityItem);
	if (ownLevel === '') {
		ui.notifications.warn(L('BREW.ERR_NO_LEVEL'));
		return;
	}
	const guides = buildGuideOptions(actor, ownLevel);
	const candidates = buildAnalyseCandidates(actor, ownLevel);
	if (candidates.length === 0) {
		ui.notifications.warn(L('ANALYSE.ERR_NO_TARGETS'));
		return;
	}
	const facilities = resolveFacilities(actor);
	const modern = isModernDialogActive();
	const labelFor = (c) =>
		`${c.unknown ? `${L('ANALYSE.UNKNOWN_BADGE')} · ` : ''}${c.item.name} (${L(`ALCHEMY_LEVEL.${c.level.toUpperCase()}`)})`;
	const dialogHtml = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/analyse-dialog.hbs', {
		renderModern: modern,
		candidates: candidates.map((c) => ({ id: c.key, label: labelFor(c) })),
		preselect: presetTargetUuid ?? candidates[0].key,
		guides: [{ id: '', label: L('ANALYSE.GUIDE_NONE') }, ...guides.map((g) => ({ id: g.id, label: g.label }))],
		guideId: '',
		facilities: [
			{ id: '', label: L('ANALYSE.LAB_NONE') },
			...facilities.map((f) => ({ id: f.item.id, label: `${f.name} (+${f.bonus})` })),
		],
		labId: facilities[0]?.item.id ?? '',
	});
	// Geholfene Analyse: Guide-Wechsel hebt die wirksame Stufe an und
	// erweitert die Kandidatenliste LIVE (Cap = max(eigene, geleitete)+2).
	const state = { candidates, capLevel: ownLevel };
	const infoFor = (cand) => {
		const guideId = state.guideId ?? '';
		const guide = guides.find((g) => g.id === guideId);
		const effOrder = Math.max(LEVEL_ORDER[ownLevel] ?? 0, guide ? LEVEL_ORDER[guide.level] ?? 0 : 0);
		const mod = analyseDiffModifier(effOrder, cand.level);
		return F('ANALYSE.INFO', {
			level: L(`ALCHEMY_LEVEL.${cand.level.toUpperCase()}`),
			mod: `${mod > 0 ? '+' : mod < 0 ? '−' : ''}${Math.abs(mod)}`,
		});
	};
	symbDialog({
		title: `${L('ANALYSE.DIALOG_TITLE')} — ${actor.name}`,
		content: dialogHtml,
		classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(modern ? modernDialogClasses('modern-roll-dialog') : [])],
		width: 440,
		onRender: (element) => {
			const select = element?.querySelector?.('#analyse-elixir');
			const guideSelect = element?.querySelector?.('#analyse-guide');
			const infoEl = element?.querySelector?.('#analyse-info');
			if (!select) return;
			const update = () => {
				const cand = state.candidates.find((c) => c.key === select.value);
				if (!cand || !infoEl) return;
				infoEl.value = infoFor(cand);
			};
			const rebuild = () => {
				state.guideId = guideSelect?.value ?? '';
				const guide = guides.find((g) => g.id === state.guideId);
				const effLevel =
					guide && (LEVEL_ORDER[guide.level] ?? 0) > (LEVEL_ORDER[ownLevel] ?? 0) ? guide.level : ownLevel;
				if (effLevel !== state.capLevel) {
					state.capLevel = effLevel;
					state.candidates = buildAnalyseCandidates(actor, effLevel);
					const prev = select.value;
					select.innerHTML = state.candidates.map((c) => `<option value="${c.key}">${labelFor(c)}</option>`).join('');
					select.value = state.candidates.some((c) => c.key === prev)
						? prev
						: (state.candidates[0]?.key ?? '');
				}
				update();
			};
			select.addEventListener('change', update);
			guideSelect?.addEventListener('change', rebuild);
			update();
		},
		buttons: {
			analyse: {
				icon: '<i class="fas fa-search"></i>',
				label: L('ANALYSE.BUTTON'),
				callback: async (html) => {
					const key = html[0].querySelector('#analyse-elixir')?.value;
					const cand = state.candidates.find((c) => c.key === key);
					if (!cand) return;
					const guideId = html[0].querySelector('#analyse-guide')?.value ?? '';
					const guideActor = guideId !== '' ? game.actors.get(guideId) : null;
					const labId = html[0].querySelector('#analyse-lab')?.value;
					const facility = facilities.find((f) => f.item.id === labId) ?? null;
					const userMod = Number(html[0].querySelector('#analyse-modifier')?.value);
					const modifier = Number.isFinite(userMod) ? userMod : 0;
					await performAnalyse(actor, abilityItem, cand, { guideActor, facility, modifier });
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: () => {},
			},
		},
		default: 'analyse',
	});
}

/* ---------------------------------------------------------------- */
/*  Analysieren (§14) — Probe, Spuren, Fehlbestimmung                 */
/* ---------------------------------------------------------------- */

async function performAnalyse(actor, abilityItem, cand, { guideActor = null, facility = null, modifier = 0 } = {}) {
	const rolls = [];
	const lines = [];
	const ownLevel = getOwnAlchemyLevel(abilityItem);
	const guideAbility = guideActor ? findAlchemyAbility(guideActor) : null;
	const guideLevel = guideAbility ? getOwnAlchemyLevel(guideAbility) : '';
	// Wirksame Stufe (Geholfen): max(eigene, geleitete) — steuert den
	// Modifikator (der Cap galt schon bei der Kandidatenwahl).
	const effOrder = Math.max(LEVEL_ORDER[ownLevel] ?? 0, LEVEL_ORDER[guideLevel] ?? 0);
	const labBonus = facility?.bonus ?? 0;
	const diffMod = analyseDiffModifier(effOrder, cand.level);
	const probe = await alchemyProbe(actor, labBonus + diffMod + modifier);
	rolls.push(...probe.rolls);
	const resultLevel = getRollResultLevelKey(probe);
	const success = probe.trueActorSucceeded;
	const elixir = cand.item;
	const unknownFlag = elixir.getFlag('symbaroum', 'unknownElixir');
	const fehlFlag = elixir.getFlag('symbaroum', 'fehlbestimmt');
	const traditions = elixirTraditions(elixir);
	const hasAccess = hasAnyTraditionAccess(actor, traditions);
	lines.push(
		`<div class="tooltip"><p>${formatAnalyseProbeLine(probe, labBonus, diffMod + modifier)} — ${success ? L('ANALYSE.CHAT_SUCCESS') : L('ANALYSE.CHAT_FAILURE')}</p><span class="tooltiptext">${probe.toolTip}</span></div>`
	);
	lines.push(rigChatLine(probe));
	if (success) {
		// Spuren (§14): Kategorie + Stufe; bei Traditions-Zugang VOLLE
		// Analyse (Zutat je Dosis + Tradition).
		lines.push(F('ANALYSE.CHAT_TRACES', { category: L(elixirCategoryKey(elixir)) }));
		lines.push(F('ANALYSE.CHAT_LEVEL', { level: L(`ALCHEMY_LEVEL.${cand.level.toUpperCase()}`) }));
		if (unknownFlag) lines.push(F('ANALYSE.CHAT_REVEAL', { name: unknownFlag.realName }));
		if (hasAccess || resultLevel === 'CHAT.CRITICAL_SUCCESS') {
			lines.push(F('ANALYSE.CHAT_INGREDIENT', { amount: cand.units }));
			lines.push(
				F('ANALYSE.CHAT_TRADITION', {
					tradition:
						traditions.length > 0 ? traditions.map((t) => traditionLabel(t)).join(', ') : L('TRADITION.NONE'),
				})
			);
		}
		if (hasRelatedRecipe(actor, elixir)) lines.push(L('ANALYSE.CHAT_HAS_RECIPE'));
	} else {
		lines.push(L('ANALYSE.CHAT_FAIL'));
	}
	// Bestätigter kritischer Erfolg (KritErf): Zutat erkannt + Täuschung
	// entlarvt + Nachbrau-Dialog öffnet automatisch (fehlende Kandidaten
	// meldet der Dialog von selbst — Unbekannt-Markierungen bleiben GM-
	// Sache und werden NICHT automatisch aufgelöst).
	if (resultLevel === 'CHAT.CRITICAL_SUCCESS') {
		if (fehlFlag) {
			lines.push(F('ANALYSE.CHAT_DECEPTION', { name: fehlFlag.realName }));
			await elixir.update({ name: fehlFlag.realName, 'system.description': fehlFlag.realDescription });
			await elixir.unsetFlag('symbaroum', 'fehlbestimmt');
		}
		lines.push(L('ANALYSE.CHAT_NACHBRAU_HINT'));
		await postBrewCard(actor, F('ANALYSE.CHAT_TITLE', { name: actor.name, target: cand.name }), lines, rolls);
		await openNachbrauDialog(abilityItem, { presetTargetUuid: elixir.uuid });
		return;
	}
	// Patzer (rohe 20) — heimliche FEHLBESTIMMUNG (§6a): Nur Inventar-
	// Dosen sind verfälschbar (Welt-Items gehören der Welt); der
	// Analysierer glaubt Erfolg, die Karte zeigt die FALSCHE Identität,
	// die Wahrheit flüstert nur der SL. Ohne gleichstufige Quelle bleibt
	// es bei der offenen Fehlzeile + SL-Flüsterkarte.
	if (!success && probe.diceResult === 20) {
		const falseElixir = await randomDeceptionSource(cand.level, unknownFlag?.realName ?? elixir.name, actor);
		const stackWide = resultLevel === 'CHAT.CRITICAL_FAILURE';
		if (!cand.inInventory || !falseElixir) {
			lines.push(L('ANALYSE.CHAT_FAIL'));
			await postBrewCard(actor, F('ANALYSE.CHAT_TITLE', { name: actor.name, target: cand.name }), lines, rolls);
			await whisperGM(L('ANALYSE.WHISPER_TITLE'), [F('ANALYSE.WHISPER_NO_DECEPTION', { name: cand.name })]);
			return;
		}
		const flag = await applyFehlbestimmung(elixir, falseElixir, { stackWide });
		// Bestätigter kritischer Patzer: ZUSÄTZLICH eine Dosis beschädigt
		// (still vom Stapel abgebucht — der Bestand rüstet ab, die Karte
		// behauptet Erfolg; nur die Flüsterkarte nennt den Verlust).
		let doseLost = false;
		if (stackWide) doseLost = await consumeElixirDose(elixir);
		const gmLines = [
			F('ANALYSE.WHISPER_DECEPTION', { name: actor.name, target: cand.name, false: flag.falseName, real: flag.realName }),
		];
		if (stackWide) {
			gmLines.push(doseLost ? F('ANALYSE.WHISPER_DOSE_LOST', { name: cand.name }) : L('ANALYSE.WHISPER_NO_DOSE'));
		}
		await whisperGM(L('ANALYSE.WHISPER_TITLE'), gmLines);
		// FALSCHE Erfolgs-Karte: vom Muster der echten Erfolgskarte nicht
		// unterscheidbar (Spuren + Stufe des SCHEIN-Elixiers).
		const falseLines = [
			`<div class="tooltip"><p>${formatAnalyseProbeLine(probe, labBonus, diffMod + modifier)} — ${L('ANALYSE.CHAT_SUCCESS')}</p><span class="tooltiptext">${probe.toolTip}</span></div>`,
			F('ANALYSE.CHAT_TRACES', { category: L(elixirCategoryKey(falseElixir)) }),
			F('ANALYSE.CHAT_LEVEL', { level: L(`ALCHEMY_LEVEL.${cand.level.toUpperCase()}`) }),
		];
		await postBrewCard(actor, F('ANALYSE.CHAT_TITLE', { name: actor.name, target: flag.falseName }), falseLines, rolls);
		return;
	}
	await postBrewCard(actor, F('ANALYSE.CHAT_TITLE', { name: actor.name, target: cand.name }), lines, rolls);
}

/* ---------------------------------------------------------------- */
/*  Nachbrauen (§13) — Dialog + Probe + Rezeptur-Anlage               */
/* ---------------------------------------------------------------- */

/** Nachbrau-Dialog (§13): Dosis-Auswahl (Stufe ≤ eigene, Grund-Rezeptur
 *  vorhanden), Grund-Rezeptur (Live-Rebuild je Ziel), Labor (Pflicht
 *  wie beim Brauen), Modifikator, Info-Zeile; VW-Knopf NUR bei blockiertem
 *  Traditions-Zugang des gewählten Ziels. */
export async function openNachbrauDialog(abilityItem, { presetRecipeId = null, presetTargetUuid = null } = {}) {
	const actor = abilityItem?.actor ?? abilityItem?.parent;
	if (!abilityItem || abilityItem.type !== 'ability' || abilityItem.system?.reference !== 'alchemy' || !actor) return;
	const ownLevel = getOwnAlchemyLevel(abilityItem);
	if (ownLevel === '') {
		ui.notifications.warn(L('BREW.ERR_NO_LEVEL'));
		return;
	}
	// Nachbrauen braucht ein Labor wie das Brauen (ohne Labor gilt
	// weiterhin „nur Alchemiezutaten sammeln und Effekte analysieren“).
	const facilities = resolveFacilities(actor);
	if (facilities.length === 0) {
		ui.notifications.warn(L('BREW.ERR_NO_LAB'));
		return;
	}
	const candidates = buildNachbrauCandidates(actor, ownLevel);
	if (candidates.length === 0) {
		ui.notifications.warn(L('NACHBRAU.ERR_NO_TARGETS'));
		return;
	}
	// Vorauswahl: vom Rezeptur-Blatt (presetRecipeId) oder aus der
	// Analyse-KritErf-Übergabe (presetTargetUuid).
	let preselect = candidates[0].key;
	let preselectBase = '';
	if (presetRecipeId) {
		const presetCand = candidates.find((c) => c.grunds.some((g) => g.recipe.id === presetRecipeId));
		if (presetCand) {
			preselect = presetCand.key;
			preselectBase = presetCand.grunds.find((g) => g.recipe.id === presetRecipeId)?.recipe.id ?? '';
		}
	} else if (presetTargetUuid) {
		const presetCand = candidates.find((c) => c.item.uuid === presetTargetUuid || c.item.id === presetTargetUuid);
		if (presetCand) preselect = presetCand.key;
	}
	const modern = isModernDialogActive();
	const dialogHtml = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/nachbrau-dialog.hbs', {
		renderModern: modern,
		candidates: candidates.map((c) => ({
			id: c.key,
			label: `${c.item.name} (${L(`ALCHEMY_LEVEL.${c.level.toUpperCase()}`)})`,
		})),
		preselect,
		labId: facilities[0].item.id,
		facilities: facilities.map((f) => ({ id: f.item.id, label: `${f.name} (+${f.bonus})` })),
	});
	const infoFor = (cand) => {
		const mod = nachbrauDiffModifier(ownLevel, cand.level);
		return F('NACHBRAU.INFO', {
			level: L(`ALCHEMY_LEVEL.${cand.level.toUpperCase()}`),
			mod: `${mod > 0 ? '+' : mod < 0 ? '−' : ''}${Math.abs(mod)}`,
		});
	};
	symbDialog({
		title: `${L('NACHBRAU.DIALOG_TITLE')} — ${actor.name}`,
		content: dialogHtml,
		classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(modern ? modernDialogClasses('modern-roll-dialog') : [])],
		width: 440,
		onRender: (element) => {
			const select = element?.querySelector?.('#nachbrau-target');
			const baseSelect = element?.querySelector?.('#nachbrau-base');
			const infoEl = element?.querySelector?.('#nachbrau-info');
			const vwRow = element?.querySelector?.('#nachbrau-vw-row');
			const vwBtn = element?.querySelector?.('#nachbrau-vw');
			if (!select) return;
			const update = () => {
				const cand = candidates.find((c) => c.key === select.value);
				if (!cand) return;
				// Grund-Rezeptur-Auswahl live neu aufbauen (Live-Rebuild);
				// eine noch gültige Auswahl bleibt erhalten.
				if (baseSelect) {
					const prev = baseSelect.value;
					baseSelect.innerHTML = cand.grunds
						.map((g) => `<option value="${g.recipe.id}">${g.recipe.name}</option>`)
						.join('');
					baseSelect.value = cand.grunds.some((g) => g.recipe.id === prev) ? prev : cand.grunds[0].recipe.id;
				}
				if (infoEl) infoEl.value = infoFor(cand);
				if (vwRow) vwRow.style.display = cand.blocked ? '' : 'none';
			};
			select.addEventListener('change', update);
			vwBtn?.addEventListener('click', async () => {
				const cand = candidates.find((c) => c.key === select.value);
				if (!cand) return;
				await postVWRequest(actor, cand);
			});
			update();
		},
		buttons: {
			nachbrau: {
				icon: '<i class="fas fa-vial"></i>',
				label: L('NACHBRAU.BUTTON'),
				callback: async (html) => {
					const key = html[0].querySelector('#nachbrau-target')?.value;
					const cand = candidates.find((c) => c.key === key);
					if (!cand) return;
					const baseId = html[0].querySelector('#nachbrau-base')?.value;
					const base = cand.grunds.find((g) => g.recipe.id === baseId) ?? cand.grunds[0];
					const labId = html[0].querySelector('#nachbrau-lab')?.value;
					const facility = facilities.find((f) => f.item.id === labId) ?? facilities[0];
					const userMod = Number(html[0].querySelector('#nachbrau-modifier')?.value);
					const modifier = Number.isFinite(userMod) ? userMod : 0;
					await performNachbrau(actor, abilityItem, cand, base, { facility, modifier });
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: () => {},
			},
		},
		default: 'nachbrau',
	});
}

async function performNachbrau(actor, abilityItem, cand, base, { facility = null, modifier = 0 } = {}) {
	const rolls = [];
	const lines = [];
	const ownLevel = getOwnAlchemyLevel(abilityItem);
	// Dosis verbrauchen VOR der Probe (Rudolfs Entscheidung: das Risiko
	// steht fest, bevor gewürfelt wird; consumeElixirDose warnt selbst,
	// wenn der Stapel bereits leer ist).
	if (!(await consumeElixirDose(cand.item))) return;
	lines.push(F('NACHBRAU.CHAT_DOSE', { name: cand.name }));
	const labBonus = facility?.bonus ?? 0;
	const diffMod = nachbrauDiffModifier(ownLevel, cand.level);
	const probe = await alchemyProbe(actor, labBonus + diffMod + modifier);
	rolls.push(...probe.rolls);
	const resultLevel = getRollResultLevelKey(probe);
	const success = probe.trueActorSucceeded;
	lines.push(
		`<div class="tooltip"><p>${formatAnalyseProbeLine(probe, labBonus, diffMod + modifier)} — ${success ? L('ANALYSE.CHAT_SUCCESS') : L('ANALYSE.CHAT_FAILURE')}</p><span class="tooltiptext">${probe.toolTip}</span></div>`
	);
	lines.push(rigChatLine(probe));
	const recipeName = `${cand.name} — ${L(`ALCHEMY_LEVEL.${cand.level.toUpperCase()}`)}`;
	const tradition = elixirTraditions(cand.item)[0] ?? '';
	if (success) {
		// Rezeptur anlegen: origin 'reverseEngineered' (REZEPTUR.ORIGIN_
		// REVERSE), Wert 5 x Listenpreis (RezepturSheet._onDrop-Kanonik),
		// Besitz 'owned', invented — Dedup über Ziel-UUID + Stufe.
		const existing = (actor.items ?? []).find(
			(r) =>
				r?.type === 'rezeptur' &&
				String(r.system?.target ?? '').trim() === cand.worldUuid &&
				String(r.system?.alchemyLevel ?? '') === cand.level
		);
		if (existing) {
			lines.push(F('NACHBRAU.CHAT_DUPLICATE', { recipe: existing.name }));
		} else {
			await actor.createEmbeddedDocuments('Item', [
				{
					type: 'rezeptur',
					name: recipeName,
					img: cand.item.img,
					system: {
						target: cand.worldUuid,
						alchemyLevel: cand.level,
						alchemyTradition: tradition,
						price: (getItemPriceBase(cand.item) ?? 0) * 5,
						ownership: 'owned',
						origin: 'reverseEngineered',
						invented: true,
					},
				},
			]);
			lines.push(F('NACHBRAU.CHAT_SUCCESS', { recipe: recipeName }));
		}
		// Bestätigter kritischer Erfolg: Nachbrau-Bonus — Actor-Flag,
		// Häkchen im Brau-Dialog, Verbrauch dort (performBrew).
		if (resultLevel === 'CHAT.CRITICAL_SUCCESS') {
			await actor.setFlag('symbaroum', 'nachbrauBonus', true);
			lines.push(L('SCHEIN.CHAT_BONUS'));
		}
	} else if (probe.diceResult === 20) {
		// Patzer — SCHEIN-ERKENNTNIS (§6a): Die Rezeptur entsteht scheinbar
		// erfolgreich, trägt heimlich das schein-Flag auf ein ANDERES
		// gleichstufges Welt-Elixier (Rückstand statt Produkt beim nächsten
		// Brauen — performBrew); der Spieler sieht die Erfolgs-Karte, nur
		// der SL erfährt die Wahrheit. Bestätigter kritischer Patzer:
		// ZUSÄTZLICH Zeitbombe (Detonation bei der nächsten Brauprobe).
		const falseElixir = await randomDeceptionSource(cand.level, cand.name, actor);
		if (!falseElixir) {
			lines.push(L('NACHBRAU.CHAT_FAIL'));
			await postBrewCard(actor, F('NACHBRAU.CHAT_TITLE', { name: actor.name, target: cand.name }), lines, rolls);
			await whisperGM(L('SCHEIN.WHISPER_TITLE'), [F('ANALYSE.WHISPER_NO_DECEPTION', { name: cand.name })]);
			return;
		}
		const created = await actor.createEmbeddedDocuments('Item', [
			{
				type: 'rezeptur',
				name: recipeName,
				img: cand.item.img,
				system: {
					target: cand.worldUuid,
					alchemyLevel: cand.level,
					alchemyTradition: tradition,
					price: (getItemPriceBase(cand.item) ?? 0) * 5,
					ownership: 'owned',
					origin: 'reverseEngineered',
					invented: true,
				},
			},
		]);
		const recipe = created?.[0];
		if (recipe) {
			await recipe.setFlag('symbaroum', 'schein', { falseUuid: falseElixir.uuid, recipeName: falseElixir.name });
			const bomb = resultLevel === 'CHAT.CRITICAL_FAILURE';
			if (bomb) await recipe.setFlag('symbaroum', 'zeitbombe', { name: falseElixir.name });
			await whisperGM(L('SCHEIN.WHISPER_TITLE'), [
				F('SCHEIN.WHISPER_RECIPE', { name: actor.name, recipe: recipeName, real: falseElixir.name }),
				bomb ? F('SCHEIN.WHISPER_BOMB', { recipe: recipeName }) : null,
			].filter(Boolean));
		}
		lines.push(F('NACHBRAU.CHAT_SUCCESS', { recipe: recipeName }));
	} else {
		lines.push(L('NACHBRAU.CHAT_FAIL'));
	}
	await postBrewCard(actor, F('NACHBRAU.CHAT_TITLE', { name: actor.name, target: cand.name }), lines, rolls);
}

/* ---------------------------------------------------------------- */
/*  Verbotenes Wissen (VW): Anfrage + Chat-Karten-Handler            */
/* ---------------------------------------------------------------- */

/** VW-Anfrage (§13-Block, Whisper NUR an den SL): Der Spieler bittet am
 *  blockierten Nachbrau-Ziel um den Segen „Verbotenes Wissen“; die Karte
 *  trägt den Marker <!--VW-ACTIONS--> mit Erteilen/Ablehnen-Knöpfen. */
async function postVWRequest(actor, cand) {
	const tradition = elixirTraditions(cand.item)[0] ?? '';
	const body = F('VW.REQUEST_BODY', {
		player: game.user.name,
		actor: actor.name,
		elixir: cand.name,
		tradition: tradition !== '' ? traditionLabel(tradition) : L('TRADITION.NONE'),
	});
	const html =
		`<div class="symbaroum chat ability"><div class="foreground"><h4>${L('VW.REQUEST_TITLE')}</h4>` +
		`<div class="finalTxt">${body}</div>` +
		`<div class="finalTxt"><!--VW-ACTIONS-->` +
		`<button type="button" data-action="vwApply" data-actor-id="${actor.id}" data-tradition="${tradition}"><i class="fas fa-check"></i> ${L('VW.APPLY')}</button> ` +
		`<button type="button" data-action="vwDecline" data-actor-id="${actor.id}"><i class="fas fa-times"></i> ${L('VW.DECLINE')}</button>` +
		`</div></div></div>`;
	await ChatMessage.create({
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: actor.id }),
		whisper: gmWhisperTargets(),
		content: html,
	});
}

/** VW-Karten-Aktion (delegiert am document.body, einmalig über das
 *  dataset-Guard registriert): Erteilen erstellt den Segen „Verbotenes
 *  Wissen“ (type boon, reference 'forbiddenknowledge', Tradition + Gate
 *  'true', Kostenbuchung system.bonus.experience.cost 5 — Bonus-Tab-
 *  Kanonik) und ersetzt die Karte; Ablehnen ersetzt sie ebenfalls. */
async function _onVWChatAction(event) {
	const btn = event.target?.closest?.('[data-action="vwApply"], [data-action="vwDecline"]');
	if (!btn) return;
	const messageId = btn.closest('.chat-message')?.dataset?.messageId;
	const message = messageId ? game.messages.get(messageId) : null;
	const actor = game.actors.get(btn.dataset.actorId ?? '') ?? null;
	const wrap = (title, body) =>
		`<div class="symbaroum chat ability"><div class="foreground"><h4>${title}</h4><div class="finalTxt">${body}</div></div></div>`;
	if (btn.dataset.action === 'vwApply') {
		if (actor) {
			const tradition = btn.dataset.tradition ?? '';
			await actor.createEmbeddedDocuments('Item', [
				{
					type: 'boon',
					name: L('BOON_LABEL.FORBIDDEN_KNOWLEDGE'),
					system: {
						reference: 'forbiddenknowledge',
						traditions: tradition,
						traditionsActive: 'true',
						bonus: { experience: { cost: 5 } },
					},
				},
			]);
			const body = F('VW.APPLIED_BODY', {
				actor: actor.name,
				tradition: tradition !== '' ? traditionLabel(tradition) : L('TRADITION.NONE'),
			});
			if (message) await message.update({ content: wrap(L('VW.APPLIED_TITLE'), body) });
		}
	} else if (btn.dataset.action === 'vwDecline') {
		const body = F('VW.DECLINED_BODY', { actor: actor?.name ?? '' });
		if (message) await message.update({ content: wrap(L('VW.DECLINED_TITLE'), body) });
	}
}

/* Einmalige Registrierung des delegierten VW-Listeners (module-level,
   hooks.js bleibt unangetastet); der dataset-Guard verhindert Doppel-
   Registrierungen über Hot-Reloads oder mehrere Module-Instanzen. */
if (typeof document !== 'undefined' && !document.body.dataset.symbVwListener) {
	document.body.dataset.symbVwListener = 'true';
	document.body.addEventListener('click', (event) => {
		_onVWChatAction(event).catch((err) => console.error('Symbaroum VW-Aktion:', err));
	});
}
