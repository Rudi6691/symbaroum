/**
 * Brauen v1 (Rudolfs Freigabe 02.11.2026: „Starte“ — Block 2 der Alchemie-
 * Automatisierung: Brau-Dialog + Rezepturverwaltung).
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
 *    der Probe). Erinnerungszeile: maximal 1 Gebräu je Elixier und
 *    Abenteuer (kein Tracking in v1).
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
import { baseRoll, createRollData } from './roll.js';
import { symbDialog } from './symbDialog.js';
import { modernDialogClasses, isModernDialogActive } from './modernSheetConfig.js';
import { getResourceTotal, consumeResource, getItemCount } from './resources.js';
import { isAlchemical, getAlchemyLevel } from './elixirs.js';
import { getItemPriceBase } from './currency.js';
import { isStackableItem, findStackTarget } from './stacking.js';

/* i18n-Helfer nach elixirs.js-Muster */
const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

/* Stufen-Rangfolge für den Stufen-Filter (Kandidaten-Stufe <= eigene). */
const LEVEL_ORDER = { novice: 1, adept: 2, master: 3 };

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
 * Bestes Labor des Akteurs (facilityCategory auf Ausrüstungs-Items,
 * Status-Tab v1; Behälter-Kinder laufen über die flache actor.items-
 * Liste automatisch mit). Kein Labor => null => Brauen gesperrt.
 */
export function resolveBestFacility(actor) {
	const bonusMap = game.symbaroum.config.FACILITY_BONUS ?? {};
	let best = null;
	for (const item of actor?.items ?? []) {
		if (item?.type !== 'equipment') continue;
		const category = item.system?.facilityCategory ?? '';
		if (category === '') continue;
		const bonus = bonusMap[category];
		if (bonus === undefined) continue;
		if (!best || bonus > best.bonus) {
			best = { item, category, bonus, name: item.name };
		}
	}
	return best;
}

/*
 * Traditions-Zugang: Fähigkeit/Merkmal/Mystische Kraft mit passender
 * system.reference (TRAD_*-Keys: witchcraft/sorcery/symbolism/theurgy,
 * config.js) ODER Segen „Verbotenes Wissen <Tradition>“ (Namen-Match
 * inkl. lokalisiertem Traditions-Label). Leere Tradition = Hörensagen,
 * immer frei. XP-Abbuchung bleibt manuelle GM-Sache (keine Automatik).
 */
export function hasTraditionAccess(actor, tradition) {
	if (!tradition) return true;
	const items = actor?.items ?? [];
	if (items.some((i) => (i?.system?.reference ?? '') === tradition)) return true;
	const labelKey = `REZEPTUR.TRADITION_${String(tradition).toUpperCase()}`;
	const label = String(L(labelKey) ?? '').toLowerCase();
	return items.some((i) => {
		const n = String(i?.name ?? '').toLowerCase();
		if (!n.includes('verbotenes wissen') && !n.includes('forbidden knowledge')) return false;
		return n.includes(label) || n.includes(String(tradition).toLowerCase());
	});
}

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
		const tradition = getElixirTradition(elixir.name);
		if (!hasTraditionAccess(actor, tradition)) continue;
		candidates.push({
			key: elixir.uuid,
			recipe: null,
			elixir,
			level,
			tradition,
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
	const facility = resolveBestFacility(actor);
	if (!facility) {
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
	const modern = isModernDialogActive();
	const dialogHtml = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/brew-dialog.hbs', {
		renderModern: modern,
		candidates: candidates.map((c) => ({
			id: c.key,
			label: `${c.elixir.name} (${L(`ALCHEMY_LEVEL.${c.level.toUpperCase()}`)})`,
		})),
		preselect: candidates[0].key,
		labName: facility.name,
		labBonusText: `+${facility.bonus}`,
		doseHint: doseLabel(candidates[0].doseFormula),
		unitsText: String(candidates[0].units),
		stockText: String(stock),
		economy,
	});
	symbDialog({
		title: `${L('BREW.DIALOG_TITLE')} — ${actor.name}`,
		content: dialogHtml,
		classes: ['symb-roll-dialog', ...(modern ? modernDialogClasses('modern-roll-dialog') : [])],
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
					let secret = false;
					for (const radio of html[0].querySelectorAll("input[name='brew-vis']")) {
						if (radio.checked) secret = radio.value === 'secret';
					}
					await performBrew(actor, facility, cand, { secret, economy });
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

/** Probe-Zeile im Karten-Muster der Elixier-Karten (Scharfsinn + Labor-Bonus). */
function formatBrewProbeLine(rollData, labBonus) {
	return `${rollData.actingAttributeLabel} : (${rollData.actingAttributeValue})  ${L('BREW.LAB_BONUS')} +${labBonus}`;
}

async function performBrew(actor, facility, cand, { secret = false, economy = false } = {}) {
	const rolls = [];
	const lines = [];
	// 1) Dosen-Wurf (RAW-Tabelle) VOR der Probe auf der Karte.
	let doses = 1;
	if (cand.doseFormula !== '1') {
		doses = Math.max(1, await rollFormula(cand.doseFormula, rolls));
		lines.push(F('BREW.CHAT_DOSES', { formula: cand.doseFormula.replace('d', 'W'), doses }));
	}
	// 2) Scharfsinn-Probe mit Labor-Bonus (kein Ziel, keine Gunst).
	const probe = await baseRoll(actor, 'cunning', null, null, 0, facility.bonus, false);
	rolls.push(...probe.rolls);
	const success = probe.trueActorSucceeded;
	lines.push(
		`<div class="tooltip"><p>${formatBrewProbeLine(probe, facility.bonus)} — ${success ? L('BREW.CHAT_SUCCESS') : L('BREW.CHAT_FAILURE')}</p><span class="tooltiptext">${probe.toolTip}</span></div>`
	);
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
			await addElixirDoses(actor, cand.elixir, produced);
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
		await actor.update({ 'system.health.corruption.temporary': current + corruption });
		lines.push(F('BREW.CHAT_TERATOS', { corruption }));
	}
	// 5) RAW-Erinnerungszeile (kein Tracking in v1).
	if (!economy) {
		lines.push(L('BREW.CHAT_ONCE_PER_ADVENTURE'));
	}
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
