/**
 * Elixier-Automatisierung v1 (Rudolfs Freigabe 01.11.2026: „Dann baue v1“ —
 * v1a + v1b als EIN Paket).
 *
 * v1a — Datenmodell + Selbst-Verwendung + alchemistische Munition:
 *  - Item-Felder (alle GM-only taggbar, Defaults im preCreate-Item-Hook):
 *      system.alchemyLevel (''/novice/adept/master)
 *      system.elixirUsage   (''/self/thrown/combatAbility/candle/coating/ammo/special)
 *      system.elixirEffect  ({}) — maschinenlesbare Wirkungsangaben
 *      system.ammoEffect    (''/stunBolt/seekingArrow, nur Munitions-Items)
 *  - Selbst-Elixiere (Verwendungsform 'self'): Kontextmenü „Elixier
 *    verwenden“ verbraucht 1 Dosis und wendet die elixirEffect-Felder
 *    automatisch an (Heilung, Korruption abbauen/aufbauen, pro Runde
 *    laufende Wirkungen über die A28-DoT-Engine, Attributsverschiebungen
 *    inkl. Wahl-Syntax, Bedingungen mit Rundenlauf). Anwendung über die
 *    GM-Karte (createModifyTokenChatButton — Muster Kampfautomatisierung).
 *  - Alchemistische Munition: der Wurf-Submit in dialog.js bucht Munition
 *    (ammo.js v1) und stasht system.ammoEffect des ERSTEN abgebuchten
 *    Stapels ins ecData; die Kampf-Auswertung (item.js attackResult)
 *    feuert Betäubungsbolzen (Stärke–[Schaden]-Probe, Robust +2/Stufe,
 *    Misslingen = zu Boden) und den Treffpfeil-Hinweis.
 *
 * v1b — Wurf-Elixiere Voll-Tiefe + Beschichtungen + Kerzen/Spezial:
 *  - Wurf-Elixiere (Verwendungsform 'thrown'): Dialog mit Zieltoken-
 *    Auswahl, Gunst/Modifikator, Verbrauch VOR dem Wurf; Wurfprobe
 *    [Präzision←Verteidigung]; bei Treffer automatische Ziel-Proben
 *    (Blitzstaub → Gewandtheit → geblendet, Nebelball → Stärke →
 *    benommen mit Malus −1/−3/−5 je Stufe, Säurekugel/Bummstein →
 *    Schaden/DoT). Effekte laufen über die GM-Anwendungskarte.
 *  - Beschichtungen/Kerzen/Spezial/Kampffähigkeits-Elixiere (Verwendungs-
 *    formen coating/candle/special/combatAbility): Verbrauch + strukturierte
 *    Chat-Karte mit Wirkungsnotiz — die Regelwirkung bleibt SL-Sache
 *    (bewusste Begrenzung, Konzept Modul 2 Option C).
 *
 * Bewusst NICHT in v1 (Konzept-Abschnitt 5): Brau-Dialog, Rezeptur-Typ,
 * Generator (alles v2), Traditionen-Paket (v3), Geisterstaub-Geistform-
 * Automatik (Note-only), Antidot-Gift-Grad-Zustand (Note-only),
 * 1×/Abenteuer-Tracking (nur Erinnerungszeile in der Karte).
 */
import { getItemCount } from './resources.js';
import { baseRoll, createRollData, createModifyTokenChatButton, getRollResultLevelKey } from './roll.js';
import { symbDialog } from './symbDialog.js';
import { modernDialogClasses, isModernDialogActive } from './modernSheetConfig.js';

/* i18n-Helfer nach resources.js-Muster */
const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

/* ---------------------------------------------------------------- */
/* Feld-Leser (robust gegen Alt-Items ohne Tagging)                  */
/* ---------------------------------------------------------------- */

export function getElixirUsage(item) {
	return typeof item?.system?.elixirUsage === 'string' ? item.system.elixirUsage : '';
}

export function getAlchemyLevel(item) {
	return typeof item?.system?.alchemyLevel === 'string' ? item.system.alchemyLevel : '';
}

export function getElixirEffect(item) {
	return item?.system?.elixirEffect && typeof item.system.elixirEffect === 'object' ? item.system.elixirEffect : {};
}

/** Nebelball-Malus je Alchemie-Stufe: Schwach −1, Moderat −3, Stark −5. */
export function getDazedPenaltyForLevel(level) {
	if (level === 'master') return 5;
	if (level === 'adept') return 3;
	if (level === 'novice') return 1;
	return 0;
}

/**
 * Effektiver Benommen-Malus eines Akteurs (Nebelball): 0, wenn keine
 * dazed-Condition läuft, sonst der beim Anwenden mitgegebene Malus aus
 * flags.symbaroum.flagData.dazedPenalty (Fallback 0 — handgesetzte
 * Benommen-Symbole ohne Malus werfen nichts um, Muster A28-Marker).
 */
export function getDazedPenalty(actor) {
	const condition = actor?.hasCondition?.('dazed');
	if (!condition) return 0;
	const penalty = Number(condition.getFlag(game.system.id, 'flagData')?.dazedPenalty);
	return Number.isFinite(penalty) && penalty > 0 ? penalty : 0;
}

/** Core-/System-Condition nach id auflösen (Muster Axtkünstler prone). */
function findStatusEffect(id) {
	return CONFIG.statusEffects[id] ?? CONFIG.statusEffects.find((e) => e.id === id) ?? null;
}

/** Formel würfeln und den Wurf für die Chat-Karte mitsammeln. */
async function rollFormula(formula, rolls) {
	const roll = await new Roll(String(formula)).evaluate();
	rolls.push(roll);
	return roll.total;
}

/** Runden-Formel ('' / Zahl / Würfelformel) → gerundete Runden (min 1). */
async function rollRounds(formula, rolls) {
	const raw = String(formula ?? '').trim();
	if (raw === '') return 1;
	if (/^\d+$/.test(raw)) return Math.max(1, parseInt(raw, 10));
	return Math.max(1, await rollFormula(raw, rolls));
}

/* ---------------------------------------------------------------- */
/* Dosen-Verbrauch (eigenständiger Helfer: Elixiere haben KEINE      */
/* resourceCategory — bewusst parallel zu resources.js, kein Refaktor) */
/* ---------------------------------------------------------------- */

export async function consumeElixirDose(item) {
	const current = getItemCount(item);
	if (current < 1) {
		ui.notifications.warn(F('ELIXIR.ERR_NO_DOSE', { name: item.name }));
		return false;
	}
	// Bewusst bis 0 erlaubt - Zeile bleibt stehen (Rudolfs Entscheidung 3,
	// Ressourcen-Präzedenz); ein Brau-Dialog (v2) darf den Bestand wieder füllen.
	await item.update({ 'system.number': current - 1 });
	return true;
}

/* ---------------------------------------------------------------- */
/* Chat-Karte (Raw-HTML-Muster der A28-DoT-Engine — kein Template)   */
/* ---------------------------------------------------------------- */

async function postElixirCard(actor, title, lines, rolls = []) {
	const safeLines = lines.filter(Boolean);
	// Elixiere v1.4 (v1.3-Nachtest, Rudolfs Screenshot-Befund): Zeilen OHNE
	// innere <p>-Huelle wickeln (Kampf-Engine-Muster, hooks.js A28-Tick-Karte).
	// Die Treffer-/Probe-Zeilen sind div.tooltip-Blöcke - ein div INNERHALB
	// eines p ist invalides HTML, der Browser-Parser schliesst das p beim div
	// automatisch und liess einen LEEREN Absatz (sichtbare Leerzeile) vor
	// jeder Tooltip-Zeile entstehen. CSS selektiert ohnehin nur .finalTxt
	// selbst, die innere Huelle war stilistisch redundant.
	const html = `<div class="symbaroum chat ability"><div class="foreground"><h4>${title}</h4>${safeLines
		.map((line) => `<div class="finalTxt">${line}</div>`)
		.join('')}</div></div>`;
	const chatData = {
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: actor?.id }),
		content: html,
		rollMode: game.settings.get('core', 'messageMode'),
	};
	if (rolls.length > 0) chatData.rolls = [createRollData(rolls)];
	ChatMessage.applyMode(chatData, 'public');
	await ChatMessage.create(chatData);
}

/** Wurfzeile im Karten-Muster der Kampfautomatisierung (Präzision ⬅ VTD). */
function formatElixirRollString(rollData, hasTarget, modifier) {
	let rollString = `${rollData.actingAttributeLabel} : (${rollData.actingAttributeValue})`;
	if (hasTarget && rollData.targetAttributeLabel) {
		rollString += `  ⬅  ${rollData.targetAttributeLabel} : (${10 - rollData.resistAttributeValue})`;
	}
	if (modifier) {
		rollString += `  ${L('COMBAT.CHAT_MODIFIER')}${modifier}`;
	}
	return rollString;
}

/* ---------------------------------------------------------------- */
/* Attributsverschiebungen (Kriegsbemalung/Wildpfriem)               */
/* ---------------------------------------------------------------- */

/**
 * Syntax system.elixirEffect.attributeMods: Komma-getrennte Einträge
 * 'attr±N' (z. B. 'quick+2,strong+2,discreet-2'); '|' innerhalb eines
 * Eintrags markiert eine WAHL (z. B. 'quick+1|strong+1' — Kriegsbemalung:
 * der Anwender entscheidet beim Auftragen). Rückgabe: Array von
 * { attr, value } oder null bei Abbruch/ungültiger Syntax.
 */
function parseAttributeMods(rawMods) {
	const groups = String(rawMods ?? '')
		.split(',')
		.map((g) => g.trim())
		.filter(Boolean);
	const parsed = [];
	for (const group of groups) {
		const alternatives = group.split('|').map((a) => a.trim()).filter(Boolean);
		const options = [];
		for (const alt of alternatives) {
			const match = alt.match(/^([a-zA-Z]+)\s*([+-]\s*\d+)$/);
			if (!match) {
				ui.notifications.warn(F('ELIXIR.ERR_BAD_ATTRMODS', { value: alt }));
				return null;
			}
			const attr = match[1].toLowerCase();
			if (!game.symbaroum.config.ATTRIBUTE_SELECTION[attr]) {
				ui.notifications.warn(F('ELIXIR.ERR_BAD_ATTRMODS', { value: alt }));
				return null;
			}
			options.push({ attr, value: parseInt(match[2].replace(/\s+/g, ''), 10) });
		}
		parsed.push(options);
	}
	return parsed;
}

/** Aus einer Wahlgruppe 'quick+1|strong+1' Radios bauen und auflösen. */
async function resolveAttributeChoice(parsedGroups) {
	const choiceGroups = parsedGroups.filter((options) => options.length > 1);
	if (choiceGroups.length === 0) {
		return parsedGroups.map((options) => options[0]);
	}
	const radioHtml = choiceGroups
		.map(
			(group, gi) =>
				`<div class="m-sec-label">${L('ELIXIR.CHOOSE_ATTRIBUTE')} (${gi + 1}/${choiceGroups.length})</div>` +
				group
					.map(
						(option, oi) =>
							`<label class="m-give-note"><input type="radio" name="elixir-attr-choice-${gi}" value="${oi}"${oi === 0 ? ' checked' : ''}/> ${option.value > 0 ? '+' : ''}${option.value} ${L(
								`ATTRIBUTE.${option.attr.toUpperCase()}`
							)}</label>`
					)
					.join('')
		)
		.join('');
	return new Promise((resolve) => {
		symbDialog({
			title: L('ELIXIR.CHOOSE_TITLE'),
			content: `<div class="symbaroum modern-give-dialog">${radioHtml}</div>`,
			classes: modernDialogClasses('modern-give-dialog'),
			width: 400,
			buttons: {
				choose: {
					icon: '<i class="fas fa-check"></i>',
					label: L('BUTTON.CONFIRM'),
					callback: (html) => {
						const result = [];
						for (const options of parsedGroups) {
							if (options.length === 1) {
								result.push(options[0]);
								continue;
							}
							const gi = choiceGroups.indexOf(options);
							const radios = html[0].querySelectorAll(`input[name='elixir-attr-choice-${gi}']`);
							let pick = 0;
							for (const radio of radios) {
								if (radio.checked) pick = parseInt(radio.value, 10);
							}
							result.push(options[pick]);
						}
						resolve(result);
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: L('BUTTON.CANCEL'),
					callback: () => resolve(null),
				},
			},
			default: 'choose',
		});
	});
}

/* ---------------------------------------------------------------- */
/* Selbst-Elixiere (elixirUsage 'self')                              */
/* ---------------------------------------------------------------- */

export async function useSelfElixir(item) {
	const actor = item?.parent;
	if (!actor) {
		ui.notifications.warn(L('ELIXIR.ERR_NO_ACTOR'));
		return;
	}
	const eff = getElixirEffect(item);

	// Wahl-Syntax (Kriegsbemalung) VOR dem Verbrauch auflösen — Abbruch
	// (Dialog-Cancel) verbraucht bewusst noch keine Dosis.
	let attributeChanges = [];
	const rawMods = String(eff.attributeMods ?? '').trim();
	if (rawMods !== '') {
		const parsed = parseAttributeMods(rawMods);
		if (parsed === null) return;
		const resolved = await resolveAttributeChoice(parsed);
		if (resolved === null) return;
		attributeChanges = resolved;
	}

	if (!(await consumeElixirDose(item))) return;

	const rolls = [];
	const lines = [];
	const flagDataArray = [];

	// Sofort-Heilung (Kräuterarznei ohne Medikus +1, Weihwasser +2) —
	// positive toughnessChange = Heilung; die GM-Karte stabilisiert
	// sterbende Charaktere generisch mit (Ressourcen v1.4-Regel).
	const heal = Number(eff.heal);
	if (Number.isFinite(heal) && heal > 0) {
		flagDataArray.push({ actorId: actor.id, toughnessChange: heal });
		lines.push(F('ELIXIR.CHAT_HEAL', { amount: heal }));
	}

	// Temporäre Korruption abbauen (Purpursaft: Würfelformel) bzw. aufbauen.
	const corruptionRemove = String(eff.corruptionRemove ?? '').trim();
	if (corruptionRemove !== '') {
		const removed = await rollFormula(corruptionRemove, rolls);
		flagDataArray.push({ actorId: actor.id, corruptionChange: -1 * removed });
		lines.push(F('ELIXIR.CHAT_CORRUPTION_REMOVE', { amount: removed }));
	}
	const corruptionGain = Number(eff.corruptionGain);
	if (Number.isFinite(corruptionGain) && corruptionGain !== 0) {
		flagDataArray.push({ actorId: actor.id, corruptionChange: corruptionGain });
		lines.push(F('ELIXIR.CHAT_CORRUPTION_GAIN', { amount: corruptionGain }));
	}

	// v1.2 (Rudolfs Testrunde, Augentropfen): Zustandsheilung am Anwender -
	// removeCondition entfernt die Condition über den bestehenden
	// removeEffect-Pfad der GM-Karte (removeCondition akzeptiert die ID).
	const removeConditionId = String(eff.removeCondition ?? '').trim();
	if (removeConditionId !== '') {
		flagDataArray.push({ actorId: actor.id, removeEffect: removeConditionId });
		lines.push(F('ELIXIR.CHAT_REMOVE_CONDITION', { condition: conditionName(findStatusEffect(removeConditionId)) }));
	}

	// Pro-Runde-Wirkungen (Lebenselixier): Heilung je Runde UND/ODER
	// temporäre Korruption je Runde über die A28-Runden/DoT-Engine —
	// jedes Ressourcen-Band braucht eine EIGENE Bedingung (die Engine
	// liest genau einen dot-Block pro Effect), beide teilen die gewürfelte
	// Wirkungsdauer; außerhalb eines Kampfes tickt nichts (K6-Präzedenz).
	const healPerRound = String(eff.healPerRound ?? '').trim();
	const corruptionPerRound = String(eff.corruptionPerRound ?? '').trim();
	if (healPerRound !== '' || corruptionPerRound !== '') {
		const rounds = await rollRounds(eff.rounds, rolls);
		lines.push(F('ELIXIR.CHAT_PER_ROUND', { rounds }));
		if (healPerRound !== '') {
			const healCarrier = findStatusEffect('elixirheal');
			if (healCarrier) {
				// v1.2 (Rudolfs Entscheidung „Weiterschalten weg vom Träger"):
				// Löschung am ZUGENDE (turnEnd-Marker + effectDuration →
				// turnEndRounds der A34-Engine); die N Ticks am Zugbeginn
				// (A28) bleiben unverändert.
				flagDataArray.push({
					actorId: actor.id,
					addEffect: healCarrier,
					turnEnd: true,
					effectDuration: rounds,
					conditionData: {
						dot: { label: 'ELIXIR.DOT_HEAL', formula: healPerRound, resource: 'heal', damageType: 'healing', separateRoll: false },
					},
				});
			}
			lines.push(F('ELIXIR.CHAT_HEAL_PER_ROUND', { formula: healPerRound }));
		}
		if (corruptionPerRound !== '') {
			const corruptionCarrier = findStatusEffect('elixirregress');
			if (corruptionCarrier) {
				// v1.2: wie der Heil-Träger - Zugende-Löschung (A34).
				flagDataArray.push({
					actorId: actor.id,
					addEffect: corruptionCarrier,
					turnEnd: true,
					effectDuration: rounds,
					conditionData: {
						dot: { label: 'ELIXIR.DOT_CORRUPTION', formula: corruptionPerRound, resource: 'corruption', separateRoll: false },
					},
				});
			}
			lines.push(F('ELIXIR.CHAT_CORRUPTION_PER_ROUND', { formula: corruptionPerRound }));
		}
	}

	// Bedingung mit Rundenlauf (z. B. benommen/geblendet auf sich selbst).
	const condition = String(eff.condition ?? '').trim();
	if (condition !== '') {
		const effect = findStatusEffect(condition);
		if (effect) {
			const rounds = await rollRounds(eff.rounds, rolls);
			// v1.2: Zugende-Löschung (turnEnd-Marker, Rudolfs Entscheidung) -
			// die Bedingung wirkt, solange der Träger dran ist, und
			// verschwindet beim Weiterschalten (A34-Engine + Beendet-Karte).
			flagDataArray.push({
				actorId: actor.id,
				addEffect: effect,
				turnEnd: true,
				effectDuration: rounds,
				conditionData: {},
			});
			lines.push(F('ELIXIR.CHAT_CONDITION', { condition: conditionName(effect), rounds }));
		}
	}

	// Attributsverschiebungen (Kriegsbemalung +1, Wildpfriem 2-Punkte-
	// Verschiebung) — v1.2 (Rudolfs Beschluss): die Boni laufen über ein
	// LÖSCHBARES STATUS-SYMBOL (Condition 'elixirattr'); Löschen des Symbols
	// setzt die temporaryMod-Werte automatisch zurück (deleteActiveEffect-
	// Haken in hooks.js liest flagData.attributeChanges). Solange das Symbol
	// liegt, wirken die Verschiebungen - Szenen-Ende ist damit SL-Handarbeit
	// EINEM Griff (Symbol abziehen) statt Feldebuchhaltung.
	if (attributeChanges.length > 0) {
		const attrCarrier = findStatusEffect('elixirattr');
		if (attrCarrier) {
			flagDataArray.push({
				actorId: actor.id,
				addEffect: attrCarrier,
				conditionData: {
					attrSymbol: true,
					attributeChanges: attributeChanges.map((c) => ({ name: c.attr, value: c.value })),
				},
			});
			lines.push(L('ELIXIR.CHAT_ATTR_SYMBOL'));
		}
		for (const change of attributeChanges) {
			flagDataArray.push({ actorId: actor.id, attributeName: change.attr, attributeChange: change.value });
			lines.push(F('ELIXIR.CHAT_ATTRMOD', { attribute: L(`ATTRIBUTE.${change.attr.toUpperCase()}`), value: change.value }));
		}
	}

	if (String(eff.note ?? '').trim() !== '') {
		lines.push(F('ELIXIR.CHAT_NOTE', { note: String(eff.note).trim() }));
	}
	if (flagDataArray.length === 0 && lines.length === 0) {
		lines.push(L('ELIXIR.CHAT_NO_EFFECT_FIELDS'));
	}

	await postElixirCard(actor, F('ELIXIR.CHAT_SELF_INTRO', { name: actor.name, elixir: item.name }), lines, rolls);
	if (flagDataArray.length > 0) {
		await createModifyTokenChatButton(flagDataArray);
	}
}

/* ---------------------------------------------------------------- */
/* Wurf-Elixiere (elixirUsage 'thrown') — Voll-Tiefe                 */
/* ---------------------------------------------------------------- */

export async function openThrownElixirDialog(item) {
	const actor = item?.parent;
	if (!actor) {
		ui.notifications.warn(L('ELIXIR.ERR_NO_ACTOR'));
		return;
	}
	if (getItemCount(item) < 1) {
		ui.notifications.warn(F('ELIXIR.ERR_NO_DOSE', { name: item.name }));
		return;
	}
	// Zieltoken der aktuellen Szene (GM sieht alle, Spieler würfeln sowieso
	// nur auf sichtbare Ziele — das Dropdown nimmt alle platzierten Token).
	const tokens = canvas.tokens?.placeables?.filter((t) => t.actor) ?? [];
	if (tokens.length === 0) {
		ui.notifications.warn(L('ELIXIR.ERR_NO_TARGETS'));
		return;
	}
	// Vorauswahl: das (einzige) angewählte Ziel des Nutzers, sonst das
	// erste kontrollierte Token, sonst das erste Token der Szene.
	let preselect = tokens[0].id;
	const userTargets = Array.from(game.user.targets ?? []);
	if (userTargets.length === 1) preselect = userTargets[0].id;
	else {
		const controlled = tokens.find((t) => t.controlled);
		if (controlled) preselect = controlled.id;
	}
	// Benommen-Malus (Nebelball-Opfer wirft zurück): Vorbelegung des
	// Modifikator-Felds — sichtbar und überschreibbar, Muster Würfeldialog.
	const dazedPenalty = getDazedPenalty(actor);
	const modernRoll = isModernDialogActive();
	const dialogHtml = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/elixir-throw.hbs', {
		renderModern: modernRoll,
		tokens: tokens.map((t) => ({ id: t.id, name: t.name ?? t.actor.name })),
		preselect,
		dazedModifier: dazedPenalty > 0 ? -dazedPenalty : 0,
		favourChoices: { 0: L('DIALOG.FAVOUR_NORMAL'), '-1': L('DIALOG.FAVOUR_DISFAVOUR'), 1: L('DIALOG.FAVOUR_FAVOUR') },
		dazedLine: dazedPenalty > 0 ? F('ELIXIR.DAZED_AUTOPARAM', { penalty: dazedPenalty }) : '',
	});
	symbDialog({
		title: `${L('ELIXIR.THROW_TITLE')} — ${item.name}`,
		content: dialogHtml,
		classes: [`symb-roll-dialog`, ...(modernRoll ? modernDialogClasses('modern-roll-dialog') : [])],
		width: 440,
		buttons: {
			throw: {
				icon: '<i class="fas fa-dice-d20"></i>',
				label: L('ELIXIR.THROW_BUTTON'),
				callback: async (html) => {
					const tokenId = html[0].querySelector('#elixir-throw-target')?.value;
					const token = tokens.find((t) => t.id === tokenId);
					if (!token) {
						ui.notifications.warn(L('ELIXIR.ERR_NO_TARGETS'));
						return;
					}
					let modifier = Number(html[0].querySelector('#elixir-throw-modifier')?.value);
					if (!Number.isFinite(modifier)) modifier = 0;
					let favour = 0;
					for (const radio of html[0].querySelectorAll("input[name='elixir-throw-favour']")) {
						if (radio.checked) favour = parseInt(radio.value, 10);
					}
					// Verbrauch VOR dem Wurf, unabhängig vom Wurfergebnis
					// (Medicus-Muster).
					if (!(await consumeElixirDose(item))) return;
					await resolveThrownElixir(actor, item, token, favour, modifier);
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: () => {},
			},
		},
		default: 'throw',
	});
}

async function resolveThrownElixir(actor, item, token, favour, modifier) {
	const targetActor = token.actor;
	const eff = getElixirEffect(item);
	const rolls = [];
	const lines = [];
	const flagDataArray = [];
	const targetName = token.name ?? targetActor.name ?? '';

	// Wurfprobe [Präzision←Verteidigung], einseitig gewürfelt (kein
	// resistRoll — das Ziel würfelt nicht aktiv, die Ziel-Proben sind
	// separate einseitige Würfe unten).
	const attackRoll = await baseRoll(actor, 'accurate', targetActor, 'defense', favour, modifier, false);
	rolls.push(...attackRoll.rolls);
	const hit = attackRoll.trueActorSucceeded;

	await postElixirCard(actor, F('ELIXIR.CHAT_THROW_INTRO', { name: actor.name, elixir: item.name, target: targetName }), [
		formatElixirRollString(attackRoll, true, modifier),
		`<div class="tooltip"><p>${hit ? targetName + L('ELIXIR.CHAT_HIT') + faLevelLabel(attackRoll) : targetName + L('ELIXIR.CHAT_MISS')}</p><span class="tooltiptext">${attackRoll.toolTip}</span></div>`,
		// v1.3 (Rudolfs Nachtest, Restbefund B): die v1.2 eingefügte Leerzeile
		// ('&nbsp;' als eigenes Kartenelement) erwies sich im Chat als 2-3
		// sichtbare Leerzeilen (jede Kartenzeile ist ein div.finalTxt mit
		// 15px Rand) - ersatzlos gestrichen; der reguläre Zeilenabstand
		// bleibt als optische Trennung.
		...(hit ? await applyThrownEffectsOnHit(item, token, eff, rolls, flagDataArray, targetName) : []),
		...(String(eff.note ?? '').trim() !== '' ? [F('ELIXIR.CHAT_NOTE', { note: String(eff.note).trim() })] : []),
	], rolls);
	if (flagDataArray.length > 0) {
		await createModifyTokenChatButton(flagDataArray);
	}
}

/** Wirkungsdurchsatz bei Treffer — liefert die Kartenzeilen zurück. */
async function applyThrownEffectsOnHit(item, token, eff, rolls, flagDataArray, targetName) {
	const lines = [];
	const targetActor = token.actor;

	// Sofortschaden (Bummstein: 1W4/1W6/1W8 explosiver Schaden).
	const damage = String(eff.damage ?? '').trim();
	if (damage !== '') {
		const damageTotal = await rollFormula(damage, rolls);
		flagDataArray.push({ tokenId: token.id, toughnessChange: -1 * damageTotal });
		lines.push(F('ELIXIR.CHAT_DAMAGE', { target: targetName, damage: damageTotal, formula: damage }));
	}

	// Schaden pro Runde (Säurekugel: 1W4/1W6/1W8 für 1W4/1W6/1W8 Runden) —
	// DoT über die acid-Condition (A28-Präzedenz), erste Zeiteinheit beim
	// nächsten Zug des Opfers.
	const damagePerRound = String(eff.damagePerRound ?? '').trim();
	if (damagePerRound !== '') {
		const rounds = await rollRounds(eff.rounds, rolls);
		const acidEffect = findStatusEffect('acid');
		if (acidEffect) {
			// v1.2: Zugende-Löschung (A34) - N Ticks am Zugbeginn bleiben.
			flagDataArray.push({
				tokenId: token.id,
				addEffect: acidEffect,
				turnEnd: true,
				effectDuration: rounds,
				conditionData: {
					dot: { label: 'CONDITION.ACID', formula: damagePerRound, resource: 'toughness', damageType: 'acid', separateRoll: false },
				},
			});
		}
		lines.push(F('ELIXIR.CHAT_DAMAGE_PER_ROUND', { target: targetName, formula: damagePerRound, rounds }));
	}

	// Ziel-Probe (Blitzstaub → Gewandtheit, Nebelball → Stärke): einseitige
	// Probe gegen den Attributswert; bei Misslingen Bedingung + Rundenlauf
	// (Nebelball: dazed mit Malus je Alchemie-Stufe über flagData).
	const resistAttribute = String(eff.resistAttribute ?? '').trim();
	if (resistAttribute !== '' && game.symbaroum.config.ATTRIBUTE_SELECTION[resistAttribute]) {
		const probe = await baseRoll(targetActor, resistAttribute, null, null, 0, 0, false);
		rolls.push(...probe.rolls);
		const resisted = probe.trueActorSucceeded;
		lines.push(
			`<div class="tooltip"><p>${F('ELIXIR.CHAT_RESIST_LINE', { target: targetName, attribute: probe.actingAttributeLabel, result: L(resisted ? 'ELIXIR.RESIST_SUCCESS' : 'ELIXIR.RESIST_FAILURE') })}</p><span class="tooltiptext">${probe.toolTip}</span></div>`
		);
		const targetCondition = String(eff.targetCondition ?? '').trim();
		if (!resisted && targetCondition !== '') {
			const effect = findStatusEffect(targetCondition);
			if (effect) {
				const rounds = await rollRounds(eff.targetConditionRounds, rolls);
				// v1.2 (Rudolfs Entscheidung): Benommen wirkt, solange der
				// Träger dran ist, und verschwindet beim Weiterschalten -
				// Zugende-Löschung über die A34-Engine (turnEnd-Marker).
				const conditionData = {};
				if (targetCondition === 'dazed') {
					conditionData.dazedPenalty = getDazedPenaltyForLevel(getAlchemyLevel(item));
				}
				flagDataArray.push({ tokenId: token.id, addEffect: effect, turnEnd: true, effectDuration: rounds, conditionData });
				lines.push(F('ELIXIR.CHAT_TARGET_CONDITION', { target: targetName, condition: conditionName(effect), rounds }));
			}
		}
	}
	return lines;
}

/** Krit-Etikett im 6-stufigen Benennungsmodell (nur bei 1/20-Effekten). */
function faLevelLabel(rollData) {
	const key = getRollResultLevelKey(rollData, false);
	if (key === 'CHAT.SUCCEED' || key === 'CHAT.FAILED') return '';
	return ' - ' + L(key);
}

/* ---------------------------------------------------------------- */
/* Erzähl-Elixiere: Beschichtung/Kerze/Spezial/Kampffähigkeit        */
/* ---------------------------------------------------------------- */

const NARRATIVE_INTRO = {
	coating: 'ELIXIR.CHAT_COATING_INTRO',
	candle: 'ELIXIR.CHAT_CANDLE_INTRO',
	combatAbility: 'ELIXIR.CHAT_COMBAT_ABILITY_INTRO',
	special: 'ELIXIR.CHAT_SPECIAL_INTRO',
};

export async function useNarrativeElixir(item) {
	const actor = item?.parent;
	if (!actor) {
		ui.notifications.warn(L('ELIXIR.ERR_NO_ACTOR'));
		return;
	}
	const eff = getElixirEffect(item);
	if (!(await consumeElixirDose(item))) return;
	const lines = [];
	if (String(eff.note ?? '').trim() !== '') {
		lines.push(F('ELIXIR.CHAT_NOTE', { note: String(eff.note).trim() }));
	} else {
		lines.push(F('ELIXIR.CHAT_SL_NOTE', { name: item.name }));
	}
	const introKey = NARRATIVE_INTRO[getElixirUsage(item)] ?? 'ELIXIR.CHAT_SPECIAL_INTRO';
	await postElixirCard(actor, F(introKey, { name: actor.name, elixir: item.name }), lines);
}

/* ---------------------------------------------------------------- */
/* Router (Kontextmenü „Elixier verwenden“)                         */
/* ---------------------------------------------------------------- */

export function useElixir(item) {
	const usage = getElixirUsage(item);
	if (usage === '') {
		ui.notifications.warn(F('ELIXIR.ERR_NO_USAGE', { name: item?.name ?? '' }));
		return;
	}
	if (usage === 'self') return useSelfElixir(item);
	if (usage === 'thrown') return openThrownElixirDialog(item);
	if (usage === 'ammo') {
		ui.notifications.info(F('ELIXIR.AMMO_HINT', { name: item.name }));
		return;
	}
	return useNarrativeElixir(item);
}

/* ---------------------------------------------------------------- */
/* Kleinhelfer                                                       */
/* ---------------------------------------------------------------- */

function conditionName(effect) {
	// v1.2 (Rudolfs Testfund: Nebelball-Karte zeigte den Roh-Key
	// „CONDITION.DAZED"): CONFIG-Einträge tragen in name/label die i18n-KEYS -
	// lokalisiertes label bevorzugen (localize gibt Nicht-Keys unverändert
	// zurück, Core-Conditions mit fertigem Text bleiben also auch korrekt).
	return effect?.label ? L(effect.label) : effect?.name ? String(effect.name) : '';
}
