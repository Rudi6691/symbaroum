/**
 * Zutaten sammeln v1 (Rudolfs Freigabe 20.11.2026 „Ja, bauen“ — Alchemie-
 * Ökonomie, Baustein Sammeln): Kontextmenü „Alchemiezutaten sammeln …“ am
 * Alchemiezutat-Stapel (player.js, consume-Menü-Vorbild) + Wurf-Dialog +
 * Auswertung + Buchung auf den geklickten Stapel.
 *
 * Wurf-Modell (Rudolfs Konzept-Entscheidungen):
 *  - Aufmerksamkeit (vigilant), unopposed, keine Gunst im Standard.
 *  - Bonus-Vorbefüllung: Stufen JE anrechenbarer Fähigkeit SUMMIERT,
 *    Cap +3 (GATHER_BONUS_CAP). Registry in config.js
 *    (GATHER_BONUS_ABILITIES) erweiterbar — v1: Alchemie (Ability,
 *    Stufe 1-3 via getActorAbilityLevel) und Buschwissen (BOON, seit
 *    APG DREI Stufen via system.level; travel.js-Muster findBushcraftBoon).
 *    Grüner Daumen bewusst IGNORIERT (Zutaten sind nicht nur pflanzlich).
 *  - Ausbeute: Erfolg = 1W6 Einheiten; Übererfolg (diceTarget −
 *    diceResult >= 5) = +1 extra (nur auf schlichtem Erfolg — Krits
 *    folgen ihren eigenen Stufen).
 *  - Krits nach Engine-Stufen (resultLevelKey aus baseRoll) und Welt-
 *    Settings: unter optionalRareCrit gilt 'outstanding' (unbestätigte 1)
 *    → 1W6 + Actor-Flag 'nachbrauBonus' (bestehendes Flag des Brau-
 *    Dialogs, WIEDERVERWENDET als „+1 beim nächsten Brauen“-Merker) und
 *    'critical' (bestätigte 1+1) → 1W6 + NEUES Actor-Flag
 *    'gatherBrewLevelUp' (Verbraucher folgt mit dem Elixiere-Konsum).
 *    Unter optionalCrit (ohne Bestätigung) liefert 'critical' nur den
 *    nachbrauBonus. Crit-Settings aus: schlicht Erfolg/Fehlschlag.
 *  - Patzer (Schein-Material, Rudolfs bestätigte Empfehlung): Es werden
 *    1W6 Einheiten NORMAL auf den Stapel gebucht (getarnt) und VERDECKT
 *    als Item-Flag 'gatherTaint' {spoil: n, transform: m} vermerkt —
 *    'fumble' (unbestätigte 20, nur optionalRareCrit) = spoil,
 *    'critical'/kritischer Patzer bestätigt = transform (unter
 *    optionalCrit ohne Bestätigung nur spoil). Nur die SL erfährt die
 *    Wahrheit (GM-Flüsterkarte, whisperGM-Muster brewing.js). Der
 *    Verbraucher (verdirbt/verwandelt die nächste Braung, Analysieren-
 *    Erkennung) kommt mit dem Elixiere-Konsum — NICHT in v1.
 *  - Erschöpfung/8-Stunden-Regel: KEIN Tracking, nur Erinnerungszeilen
 *    auf der Karte (Suchtempo 2 Stunden je ß als SL-Buchhaltungs-Hinweis).
 *
 * Bewusst NICHT in v1: Sheet-Knopf (nur Kontextmenü), Verbraucher für
 * gatherTaint/gatherBrewLevelUp, Config-Registry-Erweiterungen über die
 * beiden v1-Einträge hinaus.
 */
import { baseRoll, createRollData } from './roll.js';
import { symbDialog } from './symbDialog.js';
import { modernDialogClasses, isModernDialogActive } from './modernSheetConfig.js';
import { getItemCount } from './resources.js';
import { getActorAbilityLevel } from './item.js';
// Zutaten sammeln v1.1: Scharfsinn-Proben-Kern des Analysierens (brewing).
import { alchemyProbe, purgeTaintedIngredients } from './brewing.js';

/* i18n-Helfer nach brewing.js-Muster */
const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

/* ---------------------------------------------------------------- */
/*  Bonus-Modell (Registry aus config.js, Cap-Konstante)              */
/* ---------------------------------------------------------------- */

/** Stufe einer Registry-Fähigkeit: Ability (getActorAbilityLevel über
 *  system.reference/getLevel) ODER Boon (system.level, boon.js-Muster —
 *  Buschwissen trägt seit APG drei Stufen). Nicht erlernt = 0. */
function getGatherAbilityLevel(actor, entry) {
	if (entry?.itemType === 'boon') {
		const boon = actor?.items?.find(
			(it) => it.type === 'boon' && String(it.system?.reference ?? '') === String(entry.reference)
		);
		return Math.max(0, Number(boon?.system?.level) || 0);
	}
	return getActorAbilityLevel(actor, entry?.reference);
}

/** Sammel-Bonus: Summe der anrechenbaren Stufen (je perLevel), Cap
 *  GATHER_BONUS_CAP (Default 3, Rudolfs Konzeptrunde). */
export function getGatherBonus(actor) {
	const registry = game.symbaroum.config?.GATHER_BONUS_ABILITIES ?? [];
	const cap = Number(game.symbaroum.config?.GATHER_BONUS_CAP ?? 3);
	let bonus = 0;
	for (const entry of registry) {
		bonus += getGatherAbilityLevel(actor, entry) * (Number(entry?.perLevel) || 1);
	}
	return Math.min(cap, bonus);
}

/* ---------------------------------------------------------------- */
/*  Dialog                                                            */
/* ---------------------------------------------------------------- */

/** Kontextmenü-Einstieg (player.js): sichtbar nur am Alchemiezutat-
 *  Blatt-Item (resourceCategory), GM/ Besitzer; Bestand egal — gesammelt
 *  wird AUF den Stapel gebucht, ein leerer Stapel ist erlaubt. */
export function openGatherDialog(actor, stackItem) {
	if (!actor || !stackItem) return;
	if (stackItem.type !== 'equipment' || stackItem.system?.resourceCategory !== 'alchemiezutat') return;
	const bonus = getGatherBonus(actor);
	const modern = isModernDialogActive();
	const rowClass = modern ? 'm-roll-row' : 'attribute';
	const favourBlock = modern
		? `<fieldset class="m-ability-frame"><legend class="m-ability-label">${L('DIALOG.FAVOUR_LEGEND')}</legend>
			<div class="m-give-vis">
				<label class="lblfavour"><input type="radio" name="gather-favour" value="0" checked/> ${L('DIALOG.FAVOUR_NORMAL')}</label>
				<label class="lblfavour"><input type="radio" name="gather-favour" value="1"/> ${L('DIALOG.FAVOUR_FAVOUR')}</label>
				<label class="lblfavour"><input type="radio" name="gather-favour" value="-1"/> ${L('DIALOG.FAVOUR_DISFAVOUR')}</label>
			</div></fieldset>`
		: `<div class="favour">
			<label class="lblfavour"><input type="radio" name="gather-favour" value="0" checked/> ${L('DIALOG.FAVOUR_NORMAL')}</label>
			<label class="lblfavour"><input type="radio" name="gather-favour" value="1"/> ${L('DIALOG.FAVOUR_FAVOUR')}</label>
			<label class="lblfavour"><input type="radio" name="gather-favour" value="-1"/> ${L('DIALOG.FAVOUR_DISFAVOUR')}</label>
		</div>`;
	const visBlock = modern
		? `<fieldset class="m-ability-frame"><legend class="m-ability-label">${L('BREW.VISIBILITY')}</legend>
			<div class="m-give-vis">
				<label class="lblfavour"><input type="radio" name="gather-vis" value="public" checked/> ${L('GIVE.VISIBILITY_PUBLIC')}</label>
				<label class="lblfavour"><input type="radio" name="gather-vis" value="secret"/> ${L('GIVE.VISIBILITY_WHISPER')}</label>
			</div></fieldset>`
		: `<div class="favour">
			<label class="lblfavour"><input type="radio" name="gather-vis" value="public" checked/> ${L('GIVE.VISIBILITY_PUBLIC')}</label>
			<label class="lblfavour"><input type="radio" name="gather-vis" value="secret"/> ${L('GIVE.VISIBILITY_WHISPER')}</label>
		</div>`;
	const content = `<div class="symbaroum dialog${modern ? ' modern-roll-dialog' : ''}">
		<p>${F('GATHER.DIALOG_HINT', { bonus })}</p>
		<div class="${rowClass}">
			<label for="gather-modifier" data-tooltip="${L('GATHER.MODIFIER_TOOLTIP')}">${L('DIALOG.MODIFIER')}</label>
			<input id="gather-modifier" type="number" value="${bonus}"/>
		</div>
		${favourBlock}
		${visBlock}
	</div>`;
	symbDialog({
		title: `${L('GATHER.DIALOG_TITLE')} — ${actor.name}`,
		content,
		classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(modern ? modernDialogClasses('modern-roll-dialog') : [])],
		width: 440,
		buttons: {
			gather: {
				icon: '<i class="fas fa-leaf"></i>',
				label: L('GATHER.BUTTON'),
				callback: async (html) => {
					const userMod = Number(html[0].querySelector('#gather-modifier')?.value);
					const modifier = Number.isFinite(userMod) ? userMod : 0;
					let favour = 0;
					for (const radio of html[0].querySelectorAll("input[name='gather-favour']")) {
						if (radio.checked) favour = Number(radio.value) || 0;
					}
					let secret = false;
					for (const radio of html[0].querySelectorAll("input[name='gather-vis']")) {
						if (radio.checked) secret = radio.value === 'secret';
					}
					await performGather(actor, stackItem, { secret, modifier, favour });
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: () => {},
			},
		},
		default: 'gather',
	});
}

/* ---------------------------------------------------------------- */
/*  Wurf, Auswertung, Buchung, Karten                                 */
/* ---------------------------------------------------------------- */

/** Formel würfeln und den Wurf für die Chat-Karte mitsammeln (brewing.js-Muster). */
async function rollFormula(formula, rolls) {
	const roll = await new Roll(String(formula)).evaluate();
	rolls.push(roll);
	return roll.total;
}

/** GM-Flüsterkarte im Raw-HTML-Muster (whisperGM-Muster brewing.js). */
async function whisperGatherGM(title, lines = []) {
	const html = `<div class="symbaroum chat ability"><div class="foreground"><h4>${title}</h4>${lines
		.filter(Boolean)
		.map((line) => `<div class="finalTxt">${line}</div>`)
		.join('')}</div></div>`;
	const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
	await ChatMessage.create({
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ alias: game.user.name }),
		whisper: game.user.isGM ? [...new Set([game.user.id, ...gmIds])] : gmIds,
		content: html,
	});
}

/** Sammel-Karte im Raw-HTML-Muster der Brau-Karte; Geheim flüstert an GM + Selbst. */
async function postGatherCard(actor, title, lines, rolls = [], secret = false) {
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
	/* Würfel nur bei Fund (echt oder getarnt) anhängen — die reine
	   Fehlschlag-Karte bleibt ohne Würfel-Anhang (performGather leert
	   die Roll-Liste dort bewusst). */
	if (rolls.length > 0) chatData.rolls = [createRollData(rolls)];
	await ChatMessage.create(chatData);
}

/** Kern: Aufmerksamkeits-Probe, Auswertung nach Engine-Stufen und Settings, 
 *  Buchung auf den Stapel, getarnte Patzer-Buchung + GM-Flüsterkarte. */
async function performGather(actor, stackItem, { secret = false, modifier = 0, favour = 0 } = {}) {
	const rolls = [];
	const lines = [];
	/* 1) Aufmerksamkeits-Probe (unopposed) mit Bonus-Vorbefüllung als freiem
	   Modifikator — Test-Rig und Epilepsie laufen generisch in baseRoll mit
	   (roll.js), Gunst wie der Brau-Dialog v1.3 durchgereicht. */
	const probe = await baseRoll(actor, 'vigilant', null, null, favour, modifier, false);
	rolls.push(...probe.rolls);
	const success = probe.trueActorSucceeded;
	lines.push(
		`<div class="tooltip"><p>${probe.rollResult} — ${success ? L('GATHER.CHAT_SUCCESS') : L('GATHER.CHAT_FAILURE')}</p><span class="tooltiptext">${probe.toolTip}</span></div>`
	);
	if (probe?.rigged) lines.push(F('RIG.CHAT_LINE', { value: probe.rigged }));
	/* 2) Auswertung nach Welt-Settings (Setting-aware, wie das Brauen). */
	const rareCrit = !!game.settings.get('symbaroum', 'optionalRareCrit');
	const critsOn = rareCrit || !!game.settings.get('symbaroum', 'optionalCrit');
	const level = probe.resultLevelKey;
	let units = 0;
	let taint = null; // { mode: 'spoil'|'transform', amount }
	if (success) {
		units = Math.max(1, await rollFormula('1d6', rolls));
		let extra = '';
		/* Übererfolg nur auf schlichtem Erfolg (diceTarget − diceResult >= 5):
		   +1 extra, als eigene Karte-Zeile ausgewiesen. */
		if (level === 'CHAT.SUCCEED' && probe.diceTarget - probe.diceResult >= 5) {
			units += 1;
			extra = L('GATHER.CHAT_OVERRUN');
		}
		/* Krits nach Engine-Stufen: outstanding (nur optionalRareCrit) und
		   critical teilen den Fund-W6, setzen aber unterscheidbare Merker-
		   Flags: nachbrauBonus (bestehender „+1 beim nächsten Brauen“, Häkchen
		   im Brau-Dialog unter optionalCrit) bzw. gatherBrewLevelUp (neu,
		   Verbraucher mit dem Elixiere-Konsum). */
		if (rareCrit && level === 'CHAT.CRITICAL_SUCCESS') {
			await actor.setFlag('symbaroum', 'gatherBrewLevelUp', true);
			lines.push(L('GATHER.CHAT_BREW_LEVELUP'));
		} else if ((rareCrit && level === 'CHAT.OUTSTANDING_SUCCESS') || (!rareCrit && critsOn && level === 'CHAT.CRITICAL_SUCCESS')) {
			await actor.setFlag('symbaroum', 'nachbrauBonus', true);
			lines.push(L('SCHEIN.CHAT_BONUS'));
		}
		/* Buchung: units auf den GEKLICKTEN Stapel (kein Merge-Sweep — der
		   Stapel existiert per Menü-Kontext, getItemCount/stapeln-Update-Muster
		   addElixirDoses/performBrew). */
		await stackItem.update({ 'system.number': getItemCount(stackItem) + units });
		lines.push(F('GATHER.CHAT_FOUND', { amount: units, stack: stackItem.name }));
		if (extra) lines.push(extra);
	} else if (critsOn && (level === 'CHAT.CRITICAL_FAILURE' || level === 'CHAT.FUMBLE')) {
		/* Patzer = Schein-Material (Rudolfs bestätigte Empfehlung): 1W6
		   Einheiten NORMAL auf den Stapel (getarnte Erfolgs-Buchung),
		   VERDECKT vermerkt im Item-Flag gatherTaint {spoil, transform}
		   (kumulativ je Stapel). 'fumble' (unbestätigte 20, nur unter
		   optionalRareCrit) = spoil; bestätigter kritischer Patzer
		   ('critical'-Stufenwort CHAT.CRITICAL_FAILURE) = transform;
		   unter optionalCrit ohne Bestätigung nur spoil. */
		units = Math.max(1, await rollFormula('1d6', rolls));
		const mode = level === 'CHAT.CRITICAL_FAILURE' && rareCrit ? 'transform' : 'spoil';
		await stackItem.update({ 'system.number': getItemCount(stackItem) + units });
		const taintFlag = (await stackItem.getFlag('symbaroum', 'gatherTaint')) ?? { spoil: 0, transform: 0 };
		taintFlag[mode] = (Number(taintFlag[mode]) || 0) + units;
		await stackItem.setFlag('symbaroum', 'gatherTaint', taintFlag);
		taint = { mode, amount: units };
		/* Getarnte Karte: sieht aus wie ein normaler Fund (Concept „Schein-
		   Material“) — die Wahrheit geht NUR als GM-Flüsterkarte raus. */
		lines.push(F('GATHER.CHAT_FOUND', { amount: units, stack: stackItem.name }));
		await whisperGatherGM(L('GATHER.WHISPER_TITLE'), [
			F('GATHER.WHISPER_TAINT', { actor: actor.name, stack: stackItem.name, amount: units, mode: L(`GATHER.WHISPER_MODE_${mode.toUpperCase()}`) }),
			L('GATHER.WHISPER_CONSUMER'),
		]);
	} else {
		/* Schlichter Fehlschlag (Crit-Settings aus oder normale 20): nichts
		   gefunden, keine Buchung, keine Karte-Reste. */
		rolls.length = 0;
	}
	/* 3) Erinnerungszeilen (bewusstes KEIN Tracking, Rudolfs Konzept):
	   Suchtempo 2 Std./ß als SL-Buchhaltungs-Hinweis + 8-Std.-Grenze. */
	lines.push(L('GATHER.CHAT_REMINDER'));
	await postGatherCard(actor, F('GATHER.CHAT_TITLE', { name: actor.name }), lines, rolls, secret);
}

/* ---------------------------------------------------------------- */
/*  Zutaten sammeln v1.1 — Stapel-Analyse (Rudolfs „Beides“-Freigabe) */
/* ---------------------------------------------------------------- */

/** Analysieren-Kontextmenü-Einstieg (player.js): Scharfsinn-Probe am
 *  Zutat-Stapel deckt die VERDECKTEN gatherTaint-Einheiten (spoil/
 *  transform) proaktiv auf — Erfolgs-Karte an den Analysierer (Öffent-
 *  lich/Geheim-Option), Fehlschlag ohne Aussage, bestätigter kritischer
 *  Patzer behauptet FALSCH „alles sauber“ (Analysieren-§6a-Muster:
 *  Karte ununterscheidbar echt, Wahrheit nur als GM-Flüsterkarte). */
export function openGatherAnalyseDialog(actor, stackItem) {
	if (!actor || !stackItem) return;
	if (stackItem.type !== 'equipment' || stackItem.system?.resourceCategory !== 'alchemiezutat') return;
	const modern = isModernDialogActive();
	const rowClass = modern ? 'm-roll-row' : 'attribute';
	const favourBlock = modern
		? `<fieldset class="m-ability-frame"><legend class="m-ability-label">${L('DIALOG.FAVOUR_LEGEND')}</legend>
			<div class="m-give-vis">
				<label class="lblfavour"><input type="radio" name="gather-analyse-favour" value="0" checked/> ${L('DIALOG.FAVOUR_NORMAL')}</label>
				<label class="lblfavour"><input type="radio" name="gather-analyse-favour" value="1"/> ${L('DIALOG.FAVOUR_FAVOUR')}</label>
				<label class="lblfavour"><input type="radio" name="gather-analyse-favour" value="-1"/> ${L('DIALOG.FAVOUR_DISFAVOUR')}</label>
			</div></fieldset>`
		: `<div class="favour">
			<label class="lblfavour"><input type="radio" name="gather-analyse-favour" value="0" checked/> ${L('DIALOG.FAVOUR_NORMAL')}</label>
			<label class="lblfavour"><input type="radio" name="gather-analyse-favour" value="1"/> ${L('DIALOG.FAVOUR_FAVOUR')}</label>
			<label class="lblfavour"><input type="radio" name="gather-analyse-favour" value="-1"/> ${L('DIALOG.FAVOUR_DISFAVOUR')}</label>
		</div>`;
	const visBlock = modern
		? `<fieldset class="m-ability-frame"><legend class="m-ability-label">${L('BREW.VISIBILITY')}</legend>
			<div class="m-give-vis">
				<label class="lblfavour"><input type="radio" name="gather-analyse-vis" value="public" checked/> ${L('GIVE.VISIBILITY_PUBLIC')}</label>
				<label class="lblfavour"><input type="radio" name="gather-analyse-vis" value="secret"/> ${L('GIVE.VISIBILITY_WHISPER')}</label>
			</div></fieldset>`
		: `<div class="favour">
			<label class="lblfavour"><input type="radio" name="gather-analyse-vis" value="public" checked/> ${L('GIVE.VISIBILITY_PUBLIC')}</label>
			<label class="lblfavour"><input type="radio" name="gather-analyse-vis" value="secret"/> ${L('GIVE.VISIBILITY_WHISPER')}</label>
		</div>`;
	const content = `<div class="symbaroum dialog${modern ? ' modern-roll-dialog' : ''}">
		<p>${L('GATHER.ANALYSE_DIALOG_HINT')}</p>
		<div class="${rowClass}">
			<label for="gather-analyse-modifier">${L('DIALOG.MODIFIER')}</label>
			<input id="gather-analyse-modifier" type="number" value="0"/>
		</div>
		${favourBlock}
		${visBlock}
	</div>`;
	symbDialog({
		title: `${L('GATHER.ANALYSE_DIALOG_TITLE')} — ${actor.name}`,
		content,
		classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(modern ? modernDialogClasses('modern-roll-dialog') : [])],
		width: 440,
		buttons: {
			analyse: {
				icon: '<i class="fas fa-search"></i>',
				label: L('GATHER.ANALYSE_BUTTON'),
				callback: async (html) => {
					const userMod = Number(html[0].querySelector('#gather-analyse-modifier')?.value);
					const modifier = Number.isFinite(userMod) ? userMod : 0;
					let favour = 0;
					for (const radio of html[0].querySelectorAll("input[name='gather-analyse-favour']")) {
						if (radio.checked) favour = Number(radio.value) || 0;
					}
					let secret = false;
					for (const radio of html[0].querySelectorAll("input[name='gather-analyse-vis']")) {
						if (radio.checked) secret = radio.value === 'secret';
					}
					await performGatherAnalyse(actor, stackItem, { secret, modifier, favour });
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

/** Analysier-Kern (Rudolfs „Beides“-Entscheid: proaktive Aufdeckung am
 *  Stapel; die passive Brau-Flüsterkarte läuft im Ökonomie-Braupfad in
 *  brewing.js mit, siehe WHISPER_TAINT-Zeilen). */
async function performGatherAnalyse(actor, stackItem, { secret = false, modifier = 0, favour = 0 } = {}) {
	const rolls = [];
	const lines = [];
	const probe = await alchemyProbe(actor, modifier, favour);
	rolls.push(...probe.rolls);
	const success = probe.trueActorSucceeded;
	lines.push(
		`<div class="tooltip"><p>${probe.rollResult} — ${L('GATHER.CHAT_ANALYSE_PROBE')}</p><span class="tooltiptext">${probe.toolTip}</span></div>`
	);
	if (probe?.rigged) lines.push(F('RIG.CHAT_LINE', { value: probe.rigged }));
	const taint = await stackItem.getFlag('symbaroum', 'gatherTaint');
	const spoil = Math.max(0, Number(taint?.spoil) || 0);
	const transform = Math.max(0, Number(taint?.transform) || 0);
	const level = probe.resultLevelKey;
	if (success || level === 'CHAT.OUTSTANDING_SUCCESS' || level === 'CHAT.CRITICAL_SUCCESS') {
		if (spoil + transform <= 0) {
			lines.push(L('GATHER.ANALYSE_CLEAN'));
		} else {
			lines.push(F('GATHER.ANALYSE_REVEAL', { spoil, transform }));
			if (level === 'CHAT.CRITICAL_SUCCESS' || level === 'CHAT.OUTSTANDING_SUCCESS') {
				lines.push(L('GATHER.ANALYSE_REVEAL_FINE'));
			}
			/* v1.1 (Rudolfs Testrunde v1, P9 + Freigabe 20.11.): Die
			   aufgedeckten Schein-Einheiten werden VOLLAUTOMATISCH aus-
			   gebucht (Rudolfs Entscheidung: die Stapelschrumpfung ist ein
			   Feature, auch bei geheimer Analyse - der Bestand ver-
			   raeht sich ueber die Zahl). Klemmung/Transaktion im
			   purgeTaintedIngredients (brewing.js). */
			const purged = await purgeTaintedIngredients(stackItem);
			if (purged.removed > 0) lines.push(F('GATHER.ANALYSE_PURGED', { count: purged.removed }));
		}
	} else if (level === 'CHAT.CRITICAL_FAILURE') {
		/* Bestätigter kritischer Patzer: Karte behauptet FALSCH „alles
		   sauber“ (ununterscheidbar von einer echten Entlastung), Wahrheit
		   nur als GM-Flüsterkarte — Analysieren-§6a-Muster. */
		lines.push(L('GATHER.ANALYSE_CLEAN'));
		await whisperGatherGM(L('GATHER.WHISPER_TITLE'), [
			F('GATHER.ANALYSE_WHISPER_MISSED', { actor: actor.name, stack: stackItem.name, spoil, transform }),
		]);
	} else {
		/* Schlichter Fehlschlag (inkl. unbestätigter Fumble): keine
		   Aussage — weder Entlastung noch Anklage. */
		lines.push(L('GATHER.ANALYSE_FAIL'));
		rolls.length = 0;
	}
	await postGatherCard(actor, F('GATHER.CHAT_ANALYSE_TITLE', { name: actor.name }), lines, rolls, secret);
}
