/**
 * Loot-Prozess v1 (spielimmersive Aktionen): Besiegte NSC und Canvas-Fund-
 * Stellen per Mausklick lootbar machen. Rudolfs Entscheidungen aus der
 * Analyse und den Auswahlrunden 1-2 (31.10.2026, Startsignal "Du kannst
 * bauen."):
 *
 *  - SL-Einstieg am Token: HUD-Toggle (Loot freigeben/entziehen, aktiv-
 *    Markierung) UND HUD-Einstellungs-Button (Loot-Konfiguration). Das
 *    in der Konzeptrunde ebenfalls genannte Canvas-Kontextmenü existiert
 *    in Foundry V14 nicht mehr (verifiziert am Core-Quellcode: Rechts-
 *    klick deselektiert nur, _onClickRight hat kein Menü) - der zweite
 *    Einstiegspunkt ist deshalb der Einstellungs-Button neben dem Toggle.
 *  - Bleib-am-Token-Modell (CC-Stil): Die Items bleiben am Token-Aktor,
 *    jeder Claim läuft als transfer.js delete+create (AP2-Merge am Ziel),
 *    Abbruch = keinerlei Mutation.
 *  - Spieler-Selbstlootung per EINZELKLICK aufs freigegebene Token
 *    (CC-Guards: Modifikator-Klicks gehen durch, Bewegung > 8 px oder
 *    > 1200 ms zählt als Drag, 600-ms-Debounce). Spieler brauchen KEINE
 *    Ownership am NSC - der Popup-Kontext wird GM-seitig gebaut und über
 *    den System-Socket zugestellt, Claims laufen GM-arbitriert (system.json
 *    "socket": true ist gesetzt).
 *  - enabledOnDeath-Automatik in v1 (Symbaroum-HP-Pfad system.health.
 *    value <= 0, nur aktiver GM, nur NSC-Aktoren).
 *  - Behälter lootbar inkl. Inhalt (Teilbaum-Logik der Übergabe v1 wird
 *    wiederverwendet), Behälter-Geld reist mit.
 *  - Canvas-Drag: ALLE physischen Items (Waffe/Rüstung/Ausrüstung/
 *    Artefakt/Behälter) dürfen auf die Szene gezogen werden und erzeugen
 *    dort einen unlinked Loot-Pile (Item-Piles-Modell). Bestätigungs-/
 *    Mengendialog beim Drop als Stolper-Schutz.
 *  - Pile-Aktor = HYBRID: Vorlagen-Aktor "Loot-Pile" wird beim ersten
 *    Drop automatisch angelegt, jeder Drop erzeugt einen unlinked Token
 *    vom Vorlagen-Aktor (Daten im Token-Delta = pro Drop eine Kopie).
 *    Vorlagen-Änderungen wirken nicht rückwirkend (dokumentierte IP-
 *    Schwäche); löschbare Vorlage wird beim nächsten Drop neu angelegt.
 *  - Auto-Löschung leerer Piles (Rudolfs Ergänzungsentscheidung, in v1):
 *    Welt-Setting + Drei-Zustands-Flag pro Pile (Standard/Ja/Nein), Leer-
 *    prüfung nach jedem Claim - NUR für Canvas-Drag-Piles, NSC-Leichen
 *    bleiben immer stehen.
 *  - Datenmodell: flags.symbaroum.tokenInventory mit mode (loot/shop,
 *    Shop folgt später additiv) + Quellen-Abstraktion (v1: Token-Aktor).
 *    Wartbarkeit: Aktor-Standard-Flags am Basis-Aktor (Prototype-Aktor-
 *    Konfiguration) + Welt-Defaults.
 */
import { symbDialog } from './symbDialog.js';
import { GIVE_TYPES, collectContainerSubtree, buildPayload, describeTransfer, applyAtTarget, removeFromSource, collectRecipients, resolveRecipient } from './transfer.js';
import { isStackableItem } from './stacking.js';
import { isInsideContainer } from './container.js';
import { formatCurrency, getActorCurrencyTotal } from './currency.js';
import { getModernSheetEffectiveDesign } from './modernSheetConfig.js';

const { randomID } = foundry.utils;

const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

const FLAG_SCOPE = 'symbaroum';
const TOKEN_FLAG = 'tokenInventory';
const PILE_FLAG = 'lootPile';
const TEMPLATE_FLAG = 'lootPileTemplate';

/**
 * Symbaroum-HP-Pfad für die enabledOnDeath-Automatik.
 * Loot v1.2 (Testrunde 1, Punkt 9): Der v1-Pfad system.toughness.value war
 * FALSCH - Zähigkeit liegt unter system.health (Belege am System-Code:
 * hooks.js updateData['system.health.toughness.value'], player.js,
 * template.json). Lernweis: Datenpfade am System-Code verifizieren,
 * nie aus Notizen übernehmen.
 */
const DEATH_HP_PATH = 'system.health.toughness.value';

/* ----------------------------------------------------------------
 *  Welt-Settings (Registrierung im init-Hook, hooks.js)
 * ---------------------------------------------------------------- */

export function registerLootSettings() {
	// Bei Tod automatisch lootbar: Welt-Default für enabledOnDeath.
	// Per-Token/Per-Aktor über die Loot-Einstellungen überschreibbar.
	game.settings.register('symbaroum', 'lootEnabledOnDeath', {
		name: 'LOOT.SETTING_ENABLED_ON_DEATH',
		hint: 'LOOT.SETTING_ENABLED_ON_DEATH_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});
	// Leere Loot-Piles automatisch löschen (Welt-Default, nur Drag-Piles).
	game.settings.register('symbaroum', 'lootDeleteEmptyPiles', {
		name: 'LOOT.SETTING_DELETE_EMPTY',
		hint: 'LOOT.SETTING_DELETE_EMPTY_HINT',
		scope: 'world',
		type: Boolean,
		default: true,
		config: true,
	});
}

/* ----------------------------------------------------------------
 *  Konfiguration (Token-Flag > Aktor-Standard > Welt-Default)
 * ---------------------------------------------------------------- */

/** Basis-Aktor eines Tokens (linked und unlinked: actorId zeigt immer auf den Welt-Aktor). */
function getBaseActor(tokenDoc) {
	return game.actors.get(tokenDoc?.actorId) ?? null;
}

function triState(value) {
	if (value === true || value === 'true') return true;
	if (value === false || value === 'false') return false;
	return null; // 'default' / undefined / null
}

/**
 * Effektive Loot-Konfiguration eines Tokens:
 *  - enabled: nur explizit (Token-Flag) oder per Tod-Automatik gesetzt
 *  - enabledOnDeath: Token-Flag > Aktor-Flag > Welt-Setting
 *  - deleteWhenEmpty: Token-Flag > Aktor-Flag > Welt-Setting (nur Piles)
 */
export function getLootConfig(tokenDoc) {
	const tokenCfg = tokenDoc?.getFlag(FLAG_SCOPE, TOKEN_FLAG) ?? {};
	const actorCfg = getBaseActor(tokenDoc)?.getFlag(FLAG_SCOPE, TOKEN_FLAG) ?? {};
	const worldDeath = game.settings.get('symbaroum', 'lootEnabledOnDeath');
	const worldDelete = game.settings.get('symbaroum', 'lootDeleteEmptyPiles');
	const death = tokenCfg.enabledOnDeath ?? actorCfg.enabledOnDeath ?? worldDeath;
	const del = triState(tokenCfg.deleteWhenEmpty) ?? triState(actorCfg.deleteWhenEmpty) ?? worldDelete;
	return {
		enabled: !!tokenCfg.enabled,
		enabledOnDeath: !!death,
		deleteWhenEmpty: !!del,
		mode: tokenCfg.mode ?? actorCfg.mode ?? 'loot',
		sourceType: tokenCfg.sourceType ?? 'actor',
	};
}

async function setTokenLootFlag(tokenDoc, patch) {
	const current = tokenDoc.getFlag(FLAG_SCOPE, TOKEN_FLAG) ?? {};
	await tokenDoc.setFlag(FLAG_SCOPE, TOKEN_FLAG, { ...current, ...patch });
}

/* ----------------------------------------------------------------
 *  Lootbares Inventar (Bleib-am-Token-Modell)
 * ---------------------------------------------------------------- */

/**
 * Lootbare Einträge eines Token-Aktors: alle physischen Items
 * (GIVE_TYPES), die NICHT in einem Behälter stecken - Behälter werden
 * als eine Eintrag inkl. Inhalt geführt, verpackte Items reisen mit
 * dem Behälter. Aktive Waffen/Rüstungen sind lootbar (Status-Regeln
 * greifen am Ziel wie bei der Übergabe).
 */
export function getLootEntries(tokenActor) {
	if (!tokenActor?.items) return [];
	const entries = [];
	for (const item of tokenActor.items) {
		if (!GIVE_TYPES.includes(item.type)) continue;
		if (isInsideContainer(tokenActor, item)) continue;
		const isContainer = item.type === 'container';
		const stackable = !isContainer && isStackableItem(item);
		// Loot v1.2 (Ausbaustelle 5): Containerinhalt eingerückt unter der
		// Behälterzeile anzeigen. Reine ANZEIGE - der Claim nimmt den
		// Behälter als Ganzes (Teilbaum reist über die transfer-Pipeline).
		// collectContainerSubtree liefert die Wurzel zuerst, Kinder danach;
		// die Wurzel ist der Behälter selbst und wird übersprungen.
		let children = [];
		if (isContainer) {
			children = collectContainerSubtree(tokenActor, item)
				.slice(1)
				.map((child) => {
					const quantity = Math.max(1, Math.round(Number(child.system?.number ?? 1) || 1));
					// Label vorgefertigt im JS (kein Template-Helpers-Risiko).
					return {
						id: child.id,
						name: child.name,
						img: child.img,
						quantity,
						quantityLabel: quantity > 1 ? `× ${quantity}` : null,
					};
				});
		}
		entries.push({
			id: item.id,
			name: item.name,
			img: item.img,
			type: item.type,
			isContainer,
			stackable,
			quantity: Math.max(1, Math.round(Number(item.system?.number ?? 1) || 1)),
			summary: isContainer ? describeTransfer(tokenActor, item, 1, null) : null,
			children,
		});
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return entries;
}

/** Ob ein Loot-Pile komplett leer ist: keine lootbaren Items UND keine Währung. */
export function isLootEmpty(tokenActor) {
	if (!tokenActor) return true;
	if (getLootEntries(tokenActor).length) return false;
	return (getActorCurrencyTotal(tokenActor) ?? 0) <= 0;
}

/* ----------------------------------------------------------------
 *  Chat-Karte
 * ---------------------------------------------------------------- */

async function sendLootCard({ claimerActor, sourceName, description, mode, claimerUserId }) {
	const html = await foundry.applications.handlebars.renderTemplate(
		'systems/symbaroum/template/chat/loot-card.hbs',
		{ claimer: claimerActor.name, claimerImg: claimerActor.img, source: sourceName, description }
	);
	const chatData = { content: html, speaker: ChatMessage.getSpeaker({ actor: claimerActor }) };
	if (mode === 'whisper') {
		const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
		chatData.whisper = [...new Set([game.user.id, claimerUserId, ...gmIds])];
	}
	await ChatMessage.create(chatData);
}

/* ----------------------------------------------------------------
 *  Claim-Ausführung (GM-seitig; der GM-Client führt beide Seiten aus)
 * ---------------------------------------------------------------- */

/**
 * Führt einen Claim-Batch aus: jedes Item wandert per transfer.js-
 * Pipeline (delete+create, AP2-Merge, Behälter-Teilbaum) zum Ziel.
 * Validation läuft ZUR AUSFÜHRUNGSZEIT GM-seitig (Bilanz-Recheck):
 * verschwundene Items werden übersprungen, Mengen auf den Bestand
 * geklemmt (Teilausführung statt Abbruch).
 */
export async function executeLootClaims({ tokenDoc, targetActor, claims, money, mode, claimerUserId }) {
	const tokenActor = tokenDoc?.actor;
	if (!tokenActor) return { ok: false, taken: [], missing: [] };
	const taken = [];
	const missing = [];
	for (const claim of claims ?? []) {
		const item = tokenActor.items.get(claim.id);
		if (!item || !GIVE_TYPES.includes(item.type) || isInsideContainer(tokenActor, item)) {
			missing.push(claim.name ?? claim.id);
			continue;
		}
		let quantity = Math.max(1, Math.round(Number(claim.quantity ?? 1) || 1));
		if (isStackableItem(item)) {
			quantity = Math.min(quantity, Math.max(1, Math.round(Number(item.system?.number ?? 1) || 1)));
		} else {
			quantity = 1;
		}
		try {
			const payload = buildPayload(tokenActor, item, quantity);
			await applyAtTarget(targetActor, payload);
			await removeFromSource(tokenActor, item, quantity, null);
			taken.push(describeTransfer(tokenActor, item, quantity, null));
		} catch (err) {
			console.error('Symbaroum | Loot-Claim fehlgeschlagen:', err);
			missing.push(item.name);
		}
	}
	if (money != null && money > 0) {
		const available = getActorCurrencyTotal(tokenActor) ?? 0;
		const amount = Math.min(Math.round(money), available);
		if (amount > 0) {
			await applyAtTarget(targetActor, { kind: 'money', money: amount });
			await removeFromSource(tokenActor, null, null, amount);
			taken.push(formatCurrency(amount));
		}
	}
	if (taken.length) {
		await sendLootCard({
			claimerActor: targetActor,
			sourceName: tokenDoc.name,
			description: taken.join(', '),
			mode,
			claimerUserId,
		});
	}
	await maybeDeleteEmptyPile(tokenDoc);
	// Kein Feedback-Loch: Wenn der Spieler etwas angefragt hat, aber nichts
	// mitkam (z. B. nur Geld auf leerem Pile), meldet das Ergebnis leer.
	const message = !taken.length && !missing.length ? L('LOOT.ERR_EMPTY') : null;
	return { ok: true, taken, missing, message };
}

/**
 * Auto-Löschung leerer Piles (Rudolfs Ergänzung, in v1): NUR für
 * Canvas-Drag-Piles (flags.symbaroum.lootPile) - besiegte NSC-Tokens
 * bleiben immer stehen. Drei-Zustands-Auflösung wie bei Item Piles
 * (deleteWhenEmpty): Token-Flag > Aktor-Standard > Welt-Setting.
 */
async function maybeDeleteEmptyPile(tokenDoc) {
	if (!tokenDoc) return;
	if (!tokenDoc.getFlag(FLAG_SCOPE, PILE_FLAG)) return; // nie NSC-Leichen
	const config = getLootConfig(tokenDoc);
	if (!config.deleteWhenEmpty) return;
	if (!isLootEmpty(tokenDoc.actor)) return;
	const name = tokenDoc.name;
	await tokenDoc.delete();
	// Benachrichtigung auf dem ausführenden Client (GM); alle Clients
	// sehen das verschwundene Token ohnehin.
	ui.notifications.info(F('LOOT.NOTIF_EMPTY_DELETED', { name }));
}

/* ----------------------------------------------------------------
 *  Pile-Aktor (Hybrid-Modell: Vorlagen-Aktor, pro Drop ein unlinked Token)
 * ---------------------------------------------------------------- */

async function getOrCreatePileTemplate() {
	const existing = game.actors.find((a) => a.getFlag(FLAG_SCOPE, TEMPLATE_FLAG));
	if (existing) return existing;
	const actor = await Actor.implementation.create({
		name: L('LOOT.PILE_TEMPLATE_NAME'),
		type: 'monster',
	});
	await actor.setFlag(FLAG_SCOPE, TEMPLATE_FLAG, true);
	ui.notifications.info(L('LOOT.NOTIF_TEMPLATE_CREATED'));
	return actor;
}

/**
 * Erstellt einen unlinked Loot-Pile-Token an der Drop-Position und
 * bettet das Payload dort ein (applyAtTarget übernimmt frische _ids,
 * container-Mapping und AP2-Merge). Der Vorlagen-Aktor liefert nur
 * Name/Token-Einstellungen - die Item-Daten leben im Token-Delta
 * (pro Drop eine Kopie, Vorlagen-Änderungen wirken nicht rückwirkend).
 */
export async function createLootPile({ item, payload, scene, x, y, snap = true }) {
	if (!game.user.can('TOKEN_CREATE')) {
		ui.notifications.warn(L('LOOT.ERR_NO_RIGHTS'));
		return null;
	}
	const template = await getOrCreatePileTemplate();
	const tokenDoc = await template.getTokenDocument({ actorLink: false }, { parent: scene });
	const position = CONFIG.Token.objectClass._getDropActorPosition(tokenDoc, { x, y }, { snap });
	tokenDoc.updateSource(position);
	tokenDoc.updateSource({
		name: item?.name ?? tokenDoc.name,
		'flags.symbaroum.tokenInventory': { enabled: true, mode: 'loot', sourceType: 'actor' },
		[`flags.symbaroum.${PILE_FLAG}`]: true,
	});
	if (typeof item?.img === 'string' && item.img) {
		tokenDoc.updateSource({ 'texture.src': item.img });
	}
	// Loot v1.1 (Testrunde 1, Fix): Document.create() liefert in V14 EIN
	// Dokument (nicht iterierbar - "is not iterable" beim Destrukturieren);
	// das Core-Muster (TokenLayer#_onDropActorData) ist createDocuments()
	// mit Array-Eingabe, das die erwartete Liste zurückgibt.
	const [created] = await tokenDoc.constructor.createDocuments([tokenDoc], { parent: scene });
	if (!created) return null;
	if (payload) await applyAtTarget(created.actor, payload);
	return created;
}

/* ----------------------------------------------------------------
 *  Dialoge
 * ---------------------------------------------------------------- */

function dialogClasses(...extra) {
	const theme = getModernSheetEffectiveDesign()?.theme === 'classic' ? 'classic' : 'dark';
	// Bewusst MIT der Klasse modern-give-dialog: Der Loot-Dialog nutzt das
	// Geben-Dialog-Vokabular (Rudolfs Entscheidung) und erbt damit dessen
	// komplette Optik (Inputs, Radios, Rahmen, Empfänger-select) aus einer
	// Quelle - die Radio-Glyphen-Regeln der Übergabe v1.7 wirken mit.
	return ['modern-dialog', `modern-theme-${theme}`, 'modern-give-dialog', ...extra];
}

async function renderLootTemplate(path, data) {
	return foundry.applications.handlebars.renderTemplate(`systems/symbaroum/template/sheet/modern/${path}`, data);
}

/** Baut den Dialog-Content als Element (für Dialog-interaktive Listener). */
async function buildDialogElement(innerHtml) {
	const wrapper = document.createElement('div');
	wrapper.innerHTML = innerHtml;
	return wrapper;
}

/**
 * Loot-Dialog (Mehrfachauswahl, IP-Vorbild, Geben-Dialog-Vokabular).
 * Spieler-Version: Empfänger fix = eigener Charakter. GM-Version:
 * Empfänger-select (kollektierte Empfänger wie im Geben-Dialog) - der
 * GM treibt den Loot damit auch SL-getrieben an jeden Charakter.
 */
export async function openLootDialog(tokenDoc, contextData) {
	const { entries, money, tokenName, tokenImg } = contextData;
	if (!entries.length && (money ?? 0) <= 0) {
		ui.notifications.info(L('LOOT.ERR_EMPTY'));
		return;
	}
	const isGM = game.user.isGM;
	let recipients = null;
	if (isGM) {
		recipients = collectRecipients(tokenDoc.actor);
		if (!recipients.tokens.length && !recipients.groups.length) {
			ui.notifications.warn(L('GIVE.NO_RECIPIENTS'));
			return;
		}
	}
	const html = await renderLootTemplate('loot-dialog.hbs', {
		tokenName,
		tokenImg,
		entries,
		// Loot v1.2 (Ausbaustelle 6a): Geld-Default = MAXIMALBETRAG. Das
		// <symbaroum-currency>-Element ist absolut: value = Total befüllt
		// die Felder mit der Aufteilung des Gesamtbetrags, jede Änderung
		// rechnet total neu, der Claim liest getAttribute('value').
		money: money > 0 ? { hint: F('GIVE.MONEY_HINT', { money: formatCurrency(money) }) } : null,
		moneyTotal: money > 0 ? money : 0,
		recipients,
		isGM,
	});
	const element = await buildDialogElement(html);
	// Alles-auswählen-Master-Toggle + Qty-Aktivierung
	const master = element.querySelector('#loot-select-all');
	master?.addEventListener('change', () => {
		for (const box of element.querySelectorAll('input[data-loot-item]')) {
			box.checked = master.checked;
		}
	});
	// Loot v1.2 (Ausbaustelle 4b): Pfeil-Stepper um die Mengen-Felder,
	// Optik-Muster des Ausrüstungs-Kontextmenüs (.m-qty-btn). Klemmung
	// auf 1..max (max = Bestand am Token, steht im input.max-Attribut).
	element.addEventListener('click', (event) => {
		const btn = event.target.closest('[data-loot-qty-minus], [data-loot-qty-plus]');
		if (!btn) return;
		const id = btn.dataset.lootQtyMinus ?? btn.dataset.lootQtyPlus;
		const input = element.querySelector(`[data-loot-qty="${id}"]`);
		if (!input) return;
		const max = Math.max(1, parseInt(input.max ?? '1', 10) || 1);
		const next = Math.max(1, Math.min(max, (parseInt(input.value ?? '1', 10) || 1) + (btn.dataset.lootQtyPlus != null ? 1 : -1)));
		input.value = String(next);
	});
	for (const box of element.querySelectorAll('input[data-loot-item]')) {
		box.addEventListener('change', () => {
			const qty = element.querySelector(`[data-loot-qty="${box.dataset.lootItem}"]`);
			if (qty) qty.disabled = !box.checked;
		});
	}
	symbDialog({
		title: L('LOOT.DIALOG_TITLE'),
		content: element,
		classes: dialogClasses('modern-loot-dialog'),
		width: 520,
		buttons: {
			claim: {
				icon: '<i class="fas fa-hand-holding-heart"></i>',
				label: L('LOOT.CLAIM_BUTTON'),
				callback: async (html) => {
					const root = html[0];
					const claims = [];
					for (const box of root.querySelectorAll('input[data-loot-item]:checked')) {
						const id = box.dataset.lootItem;
						const qtyInput = root.querySelector(`[data-loot-qty="${id}"]`);
						claims.push({ id, name: box.dataset.lootName, quantity: Math.max(1, parseInt(qtyInput?.value ?? '1', 10) || 1) });
					}
					const money = Math.round(Number(root.querySelector('symbaroum-currency')?.getAttribute('value')) || 0);
					const vis = root.querySelector('input[name="loot-vis"]:checked')?.value ?? 'public';
					// Loot v1.2 (Testrunde 1, Punkt 13): KEINE stummen Returns
					// mehr im GM-Pfad - jede Früh-Beendigung meldet den Grund,
					// der ausgeführte Claim meldet das Ergebnis (wie beim
					// Spieler-Pfad über die notify-Pipeline).
					if (!claims.length && money <= 0) {
						ui.notifications.warn(L('LOOT.ERR_NOTHING'));
						return;
					}
					if (isGM) {
						const targetActor = resolveRecipient(root.querySelector('#loot-target')?.value);
						if (!targetActor) {
							ui.notifications.warn(L('LOOT.ERR_RECIPIENT'));
							return;
						}
						try {
							const result = await executeLootClaims({ tokenDoc, targetActor, claims, money, mode: vis, claimerUserId: game.user.id });
							notifyLootResult(result);
						} catch (err) {
							console.error('Symbaroum | Loot-Claim fehlgeschlagen:', err);
							ui.notifications.error(L('LOOT.ERR_CLAIM'));
						}
					} else {
						emitLootClaim({ sceneId: tokenDoc.parent?.id, tokenId: tokenDoc.id, claims, money, mode: vis });
					}
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: async () => {},
			},
		},
	});
}

/**
 * Loot-Einstellungen am Token (HUD-Einstellungs-Button):
 * Freigabe, enabledOnDeath, deleteWhenEmpty (Drei-Zustand) + optional
 * "als Standard für den Aktor" (Prototype-Aktor-Konfiguration).
 */
export function openLootConfigDialog(tokenDoc) {
	const config = getLootConfig(tokenDoc);
	const baseActor = getBaseActor(tokenDoc);
	const current = tokenDoc.getFlag(FLAG_SCOPE, TOKEN_FLAG) ?? {};
	const delSelection = current.deleteWhenEmpty ?? 'default';
	const worldDelete = game.settings.get('symbaroum', 'lootDeleteEmptyPiles');
	symbDialog({
		title: L('LOOT.CONFIG_TITLE'),
		content: `<div class="symbaroum modern-give-dialog modern-loot-dialog modern-loot-config">
			<div class="m-give-from">${L('LOOT.CONFIG_TOKEN')}: <b>${tokenDoc.name}</b></div>
			<label class="lblfavour m-loot-config-row">
				<input type="checkbox" id="loot-cfg-enabled" ${config.enabled ? 'checked' : ''}/>
				<span>${L('LOOT.CONFIG_ENABLED')}</span>
			</label>
			<label class="lblfavour m-loot-config-row">
				<input type="checkbox" id="loot-cfg-death" ${config.enabledOnDeath ? 'checked' : ''}/>
				<span>${L('LOOT.CONFIG_ON_DEATH')}</span>
			</label>
			<label class="m-sec-label" for="loot-cfg-delete">${L('LOOT.CONFIG_DELETE_EMPTY')}</label>
			<select id="loot-cfg-delete" class="m-give-target">
				<option value="default" ${delSelection === 'default' ? 'selected' : ''}>${L('LOOT.CONFIG_DELETE_DEFAULT')} (${worldDelete ? L('LOOT.CONFIG_DELETE_ALWAYS') : L('LOOT.CONFIG_DELETE_NEVER')})</option>
				<option value="true" ${delSelection === true || delSelection === 'true' ? 'selected' : ''}>${L('LOOT.CONFIG_DELETE_ALWAYS')}</option>
				<option value="false" ${delSelection === false || delSelection === 'false' ? 'selected' : ''}>${L('LOOT.CONFIG_DELETE_NEVER')}</option>
			</select>
			<div class="m-give-note">
				<i class="fas fa-circle-info"></i>
				<span>${F('LOOT.CONFIG_DELETE_HINT', { name: tokenDoc.name })}</span>
			</div>
			${baseActor ? `<label class="lblfavour m-loot-config-row">
				<input type="checkbox" id="loot-cfg-actor-default"/>
				<span>${F('LOOT.CONFIG_ACTOR_DEFAULT', { actor: baseActor.name })}</span>
			</label>` : ''}
		</div>`,
		classes: dialogClasses('modern-loot-dialog'),
		width: 440,
		buttons: {
			// SL-getriebener Loot (Rudolfs Entscheidung 12): Der GM öffnet
			// den Loot-Dialog für ein Token und wählt den Empfänger im
			// Dialog - der einzige GM-Einstieg, da der GM-Einzelklick auf
			// das Token bewusst nicht loost (Entscheidung 5).
			open: {
				icon: '<i class="fas fa-hand-holding-heart"></i>',
				label: L('LOOT.CONFIG_OPEN'),
				callback: () => {
					const context = buildLootContext(tokenDoc);
					if (!context || (!context.entries.length && context.money <= 0)) {
						ui.notifications.info(L('LOOT.ERR_EMPTY'));
						return;
					}
					openLootDialog(tokenDoc, context);
				},
			},
			save: {
				icon: '<i class="fas fa-check"></i>',
				label: L('BUTTON.CONFIRM'),
				callback: async (html) => {
					const root = html[0];
					const enabled = root.querySelector('#loot-cfg-enabled')?.checked ?? false;
					const death = root.querySelector('#loot-cfg-death')?.checked ?? false;
					const delRaw = root.querySelector('#loot-cfg-delete')?.value ?? 'default';
					const del = delRaw === 'default' ? 'default' : delRaw === 'true';
					await setTokenLootFlag(tokenDoc, { enabled, enabledOnDeath: death, deleteWhenEmpty: del });
					if (baseActor && root.querySelector('#loot-cfg-actor-default')?.checked) {
						const actorCfg = baseActor.getFlag(FLAG_SCOPE, TOKEN_FLAG) ?? {};
						await baseActor.setFlag(FLAG_SCOPE, TOKEN_FLAG, { ...actorCfg, enabledOnDeath: death, deleteWhenEmpty: del });
						ui.notifications.info(F('LOOT.NOTIF_ACTOR_DEFAULT', { actor: baseActor.name }));
					}
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: async () => {},
			},
		},
	});
}

/**
 * Loot v1.2 (Testrunde 1, Punkt 2 - "Loot-Standards AM AKTOR sichtbar"):
 * Dialog am BASIS-AKTOR (Header-Button am Aktorblatt, GM-only): zeigt und
 * ändert die Aktor-Standard-Flags (enabledOnDeath, deleteWhenEmpty im
 * Drei-Zustand). Diese greifen für jeden Token, dessen eigenes Flag
 * nichts festlegt (Auflösungskette Token > Aktor > Welt, getLootConfig).
 */
export function openActorLootDefaultsDialog(actor) {
	if (!actor) return;
	const actorCfg = actor.getFlag(FLAG_SCOPE, TOKEN_FLAG) ?? {};
	const delSelection = actorCfg.deleteWhenEmpty ?? 'default';
	const worldDelete = game.settings.get('symbaroum', 'lootDeleteEmptyPiles');
	symbDialog({
		title: F('LOOT.ACTOR_TITLE', { actor: actor.name }),
		content: `<div class="symbaroum modern-give-dialog modern-loot-dialog modern-loot-config">
			<div class="m-give-from">${F('LOOT.CONFIG_ACTOR_DEFAULT', { actor: actor.name })}</div>
			<label class="lblfavour m-loot-config-row">
				<input type="checkbox" id="loot-actor-death" ${actorCfg.enabledOnDeath ? 'checked' : ''}/>
				<span>${L('LOOT.CONFIG_ON_DEATH')}</span>
			</label>
			<div class="m-give-note">
				<i class="fas fa-circle-info"></i>
				<span>${L('LOOT.ACTOR_HINT')}</span>
			</div>
			<label class="m-sec-label" for="loot-actor-delete">${L('LOOT.CONFIG_DELETE_EMPTY')}</label>
			<select id="loot-actor-delete" class="m-give-target">
				<option value="default" ${delSelection === 'default' ? 'selected' : ''}>${L('LOOT.CONFIG_DELETE_DEFAULT')} (${worldDelete ? L('LOOT.CONFIG_DELETE_ALWAYS') : L('LOOT.CONFIG_DELETE_NEVER')})</option>
				<option value="true" ${delSelection === true || delSelection === 'true' ? 'selected' : ''}>${L('LOOT.CONFIG_DELETE_ALWAYS')}</option>
				<option value="false" ${delSelection === false || delSelection === 'false' ? 'selected' : ''}>${L('LOOT.CONFIG_DELETE_NEVER')}</option>
			</select>
			<div class="m-give-note">
				<i class="fas fa-circle-info"></i>
				<span>${L('LOOT.ACTOR_APPLY')}</span>
			</div>
		</div>`,
		classes: dialogClasses('modern-loot-dialog'),
		width: 440,
		buttons: {
			save: {
				icon: '<i class="fas fa-check"></i>',
				label: L('BUTTON.CONFIRM'),
				callback: async (html) => {
					const root = html[0];
					const death = root.querySelector('#loot-actor-death')?.checked ?? false;
					const delRaw = root.querySelector('#loot-actor-delete')?.value ?? 'default';
					const del = delRaw === 'default' ? 'default' : delRaw === 'true';
					await actor.setFlag(FLAG_SCOPE, TOKEN_FLAG, { ...actorCfg, enabledOnDeath: death, deleteWhenEmpty: del });
					ui.notifications.info(F('LOOT.NOTIF_ACTOR_DEFAULT', { actor: actor.name }));
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: async () => {},
			},
		},
	});
}

/**
 * Bestätigungs-/Mengendialog beim Canvas-Drop (Stolper-Schutz,
 * IP-Muster): zeigt Item und Menge, bei Behältern die Inhalts-
 * zusammenfassung. GM führt direkt aus, Spieler laufen über den
 * Socket (GM-arbitriert, Ownership-Prüfung GM-seitig).
 */
export async function openPileDropDialog({ item, x, y, sceneId }) {
	const owned = item.parent instanceof Actor;
	const isContainer = item.type === 'container';
	const stackable = !isContainer && isStackableItem(item);
	const max = Math.max(1, Math.round(Number(item.system?.number ?? 1) || 1));
	const summary = isContainer && owned ? describeTransfer(item.parent, item, 1, null) : null;
	const html = await renderLootTemplate('pile-drop-dialog.hbs', {
		item: { name: item.name, img: item.img },
		stackable,
		max,
		summary,
	});
	// Loot v1.2 (Ausbaustelle 4b): Pfeil-Stepper auch hier (Konsistenz zum
	// Loot-Dialog) - deshalb Element statt String, damit die Listener vor
	// dem Rendern greifen (Muster openLootDialog).
	const element = await buildDialogElement(html);
	element.addEventListener('click', (event) => {
		const btn = event.target.closest('[data-pile-qty-minus], [data-pile-qty-plus]');
		if (!btn) return;
		const input = element.querySelector('#pile-quantity');
		if (!input) return;
		const cap = Math.max(1, parseInt(input.max ?? '1', 10) || 1);
		const next = Math.max(1, Math.min(cap, (parseInt(input.value ?? '1', 10) || 1) + (btn.dataset.pileQtyPlus != null ? 1 : -1)));
		input.value = String(next);
	});
	symbDialog({
		title: L('LOOT.DROP_TITLE'),
		content: element,
		classes: dialogClasses('modern-loot-dialog'),
		width: 440,
		buttons: {
			create: {
				icon: '<i class="fas fa-box-open"></i>',
				label: L('LOOT.DROP_CREATE'),
				callback: async (html) => {
					let quantity = 1;
					if (stackable) {
						quantity = parseInt(html[0].querySelector('#pile-quantity')?.value, 10);
						if (isNaN(quantity) || quantity < 1 || quantity > max) {
							ui.notifications.warn(L('GIVE.ERR_QUANTITY'));
							return;
						}
					}
					if (game.user.isGM) {
						await createPileFromItem({ item, quantity, x, y, sceneId });
					} else {
						emitLootDrop({ itemUuid: item.uuid, quantity, x, y, sceneId });
					}
				},
			},
			cancel: {
				icon: '<i class="fas fa-times"></i>',
				label: L('BUTTON.CANCEL'),
				callback: async () => {},
			},
		},
	});
}

/**
 * Pile aus einem Item bauen und (bei eingebettetem Item) aus der
 * Quelle entfernen - die transfer.js-Pipeline erledigt beide Seiten.
 */
async function createPileFromItem({ item, quantity, x, y, sceneId, remove = true }) {
	const scene = game.scenes.get(sceneId) ?? canvas.scene;
	if (!scene) return null;
	let payload;
	if (item.parent instanceof Actor) {
		payload = buildPayload(item.parent, item, quantity);
	} else {
		const data = item.toObject();
		if (isStackableItem(data)) data.system.number = Math.max(1, Math.round(quantity || 1));
		payload = { kind: 'item', items: [{ data, isRoot: true }], quantity: Math.max(1, Math.round(quantity || 1)) };
	}
	const tokenDoc = await createLootPile({ item, payload, scene, x, y });
	if (tokenDoc && remove && item.parent instanceof Actor) {
		await removeFromSource(item.parent, item, quantity, null);
	}
	return tokenDoc;
}

/* ----------------------------------------------------------------
 *  Socket (GM-arbitriert; Typen 'loot*' sind disjunkt zu 'transfer*')
 * ---------------------------------------------------------------- */

const pendingContext = new Map(); // requestId -> {resolve, timeout}

function emitLootClaim(msg) {
	if (!game.users.activeGM) {
		ui.notifications.warn(L('LOOT.ERR_NO_GM'));
		return;
	}
	game.socket.emit('system.symbaroum', { type: 'lootClaim', userId: game.user.id, ...msg });
}

function emitLootDrop(msg) {
	if (!game.users.activeGM) {
		ui.notifications.warn(L('LOOT.ERR_NO_GM'));
		return;
	}
	game.socket.emit('system.symbaroum', { type: 'lootDropPile', userId: game.user.id, ...msg });
}

/** Spieler: Kontext für den Loot-Dialog vom GM anfordern (5s-Timeout). */
function requestLootContext(tokenDoc) {
	return new Promise((resolve) => {
		if (!game.users.activeGM) {
			resolve(null);
			return;
		}
		const requestId = randomID();
		const timeout = setTimeout(() => {
			pendingContext.delete(requestId);
			resolve(null);
		}, 5000);
		pendingContext.set(requestId, { resolve, timeout });
		game.socket.emit('system.symbaroum', {
			type: 'lootRequestContext',
			userId: game.user.id,
			requestId,
			sceneId: tokenDoc.parent?.id,
			tokenId: tokenDoc.id,
		});
	});
}

/** GM-seitig: Popup-Kontext bauen ( Items, Währung, Name, Bild). */
function buildLootContext(tokenDoc) {
	const tokenActor = tokenDoc?.actor;
	if (!tokenActor) return null;
	return {
		entries: getLootEntries(tokenActor),
		money: getActorCurrencyTotal(tokenActor) ?? 0,
		tokenName: tokenDoc.name,
		tokenImg: tokenDoc.texture?.src ?? null,
	};
}

function notifyLootResult(result) {
	if (!result) {
		ui.notifications.error(L('LOOT.ERR_CLAIM'));
		return;
	}
	if (result.taken?.length) {
		ui.notifications.info(F('LOOT.RESULT_TAKEN', { items: result.taken.join(', ') }));
	}
	if (result.missing?.length) {
		ui.notifications.warn(F('LOOT.RESULT_MISSING', { items: result.missing.join(', ') }));
	}
	if (!result.taken?.length && !result.missing?.length && result.message) {
		ui.notifications.info(result.message);
	}
}

/**
 * Socket-Handler des Loot-Prozesses (in hooks.js am ready-Hook
 * registriert; symbcomms/a29/transfer ignorieren die 'loot*'-Typen).
 */
export function lootSocketHandler(msg) {
	if (!msg?.type) return;
	const isGMClient = game.user.isActiveGM;

	if (msg.type === 'lootRequestContext' && isGMClient) {
		const tokenDoc = game.scenes.get(msg.sceneId)?.tokens.get(msg.tokenId);
		const user = game.users.get(msg.userId);
		const context = tokenDoc && !tokenDoc.hidden && getLootConfig(tokenDoc).enabled ? buildLootContext(tokenDoc) : null;
		game.socket.emit('system.symbaroum', {
			type: 'lootContext',
			userId: msg.userId,
			requestId: msg.requestId,
			ok: !!(context && user?.character),
			message: !user?.character ? L('LOOT.ERR_NO_CHARACTER') : !context ? L('LOOT.ERR_EMPTY') : null,
			context,
		});
	} else if (msg.type === 'lootContext' && msg.userId === game.user.id) {
		const pending = pendingContext.get(msg.requestId);
		if (!pending) return;
		clearTimeout(pending.timeout);
		pendingContext.delete(msg.requestId);
		pending.resolve({ ok: msg.ok, message: msg.message, context: msg.context });
	} else if (msg.type === 'lootClaim' && isGMClient) {
		const tokenDoc = game.scenes.get(msg.sceneId)?.tokens.get(msg.tokenId);
		const user = game.users.get(msg.userId);
		const targetActor = user?.character;
		if (!tokenDoc || !getLootConfig(tokenDoc).enabled || !targetActor) {
			game.socket.emit('system.symbaroum', {
				type: 'lootResult',
				userId: msg.userId,
				result: { ok: false, taken: [], missing: [], message: L('LOOT.ERR_CLAIM') },
			});
			return;
		}
		executeLootClaims({
			tokenDoc,
			targetActor,
			claims: msg.claims,
			money: msg.money,
			mode: msg.mode,
			claimerUserId: msg.userId,
		})
			.then((result) => {
				game.socket.emit('system.symbaroum', { type: 'lootResult', userId: msg.userId, result });
			})
			.catch((err) => {
				console.error('Symbaroum | Loot-Claim fehlgeschlagen (GM):', err);
				game.socket.emit('system.symbaroum', {
					type: 'lootResult',
					userId: msg.userId,
					result: { ok: false, taken: [], missing: [], message: L('LOOT.ERR_CLAIM') },
				});
			});
	} else if (msg.type === 'lootDropPile' && isGMClient) {
		// Spieler-Drop: GM prüft Ownership an der Quelle und führt aus.
		const user = game.users.get(msg.userId);
		fromUuid(msg.itemUuid)
			.then(async (item) => {
				if (!item || !GIVE_TYPES.includes(item.type)) throw new Error('invalid item');
				if (item.parent instanceof Actor && !item.parent.testUserPermission(user, 'OWNER')) {
					throw new Error('no ownership');
				}
				const tokenDoc = await createPileFromItem({ item, quantity: msg.quantity, x: msg.x, y: msg.y, sceneId: msg.sceneId });
				game.socket.emit('system.symbaroum', {
					type: 'lootResult',
					userId: msg.userId,
					result: { ok: !!tokenDoc, taken: [], missing: [], message: tokenDoc ? L('LOOT.NOTIF_PILE_CREATED') : L('LOOT.ERR_CLAIM') },
				});
			})
			.catch((err) => {
				console.error('Symbaroum | Loot-Pile-Anfrage fehlgeschlagen:', err);
				game.socket.emit('system.symbaroum', {
					type: 'lootResult',
					userId: msg.userId,
					result: { ok: false, taken: [], missing: [], message: L('LOOT.ERR_CLAIM') },
				});
			});
	} else if (msg.type === 'lootResult' && msg.userId === game.user.id) {
		notifyLootResult(msg.result);
	}
}

/* ----------------------------------------------------------------
 *  Token-HUD (GM): Loot-Toggle + Einstellungs-Button
 * ---------------------------------------------------------------- */

function getHudElement(element) {
	if (element instanceof HTMLElement) return element;
	if (element?.[0] instanceof HTMLElement) return element[0];
	if (element?.element instanceof HTMLElement) return element.element;
	return null;
}

function injectLootHudButtons(hud, html) {
	if (!game.user?.isGM) return;
	const tokenDoc = hud?.object?.document;
	if (!tokenDoc || tokenDoc.documentName !== 'Token') return;
	const root = getHudElement(html);
	if (!root) return;
	root.querySelectorAll('[data-loot-hud]').forEach((existing) => existing.remove());
	const leftColumn = root.querySelector('.col.left');
	if (!leftColumn) return;

	const enabled = getLootConfig(tokenDoc).enabled;
	const doc = root.ownerDocument;

	const toggleButton = doc.createElement('button');
	toggleButton.type = 'button';
	toggleButton.className = `control-icon loot-hud-toggle${enabled ? ' active' : ''}`;
	toggleButton.dataset.lootHud = 'toggle';
	toggleButton.dataset.tooltip = enabled ? L('LOOT.HUD_DISABLE') : L('LOOT.HUD_ENABLE');
	toggleButton.setAttribute('aria-label', toggleButton.dataset.tooltip);
	const toggleIcon = doc.createElement('i');
	toggleIcon.className = 'fas fa-box-open';
	toggleIcon.inert = true;
	toggleButton.append(toggleIcon);
	toggleButton.addEventListener('click', async (event) => {
		event.preventDefault();
		event.stopPropagation();
		const next = !getLootConfig(tokenDoc).enabled;
		await setTokenLootFlag(tokenDoc, { enabled: next });
		// Button-Zustand direkt am Element aktualisieren (kein HUD-Re-
		// render nötig - die Flags-Änderung triggert das ohnehin).
		toggleButton.classList.toggle('active', next);
		toggleButton.dataset.tooltip = next ? L('LOOT.HUD_DISABLE') : L('LOOT.HUD_ENABLE');
		toggleButton.setAttribute('aria-label', toggleButton.dataset.tooltip);
		ui.notifications.info(F(next ? 'LOOT.NOTIF_ENABLED' : 'LOOT.NOTIF_DISABLED', { name: tokenDoc.name }));
	});

	const settingsButton = doc.createElement('button');
	settingsButton.type = 'button';
	settingsButton.className = 'control-icon loot-hud-settings';
	settingsButton.dataset.lootHud = 'settings';
	settingsButton.dataset.tooltip = L('LOOT.HUD_SETTINGS');
	settingsButton.setAttribute('aria-label', L('LOOT.HUD_SETTINGS'));
	const settingsIcon = doc.createElement('i');
	settingsIcon.className = 'fas fa-gear';
	settingsIcon.inert = true;
	settingsButton.append(settingsIcon);
	settingsButton.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		openLootConfigDialog(tokenDoc);
	});

	leftColumn.append(toggleButton, settingsButton);
}

/* ----------------------------------------------------------------
 *  enabledOnDeath-Automatik (updateActor-Hook, nur aktiver GM)
 * ---------------------------------------------------------------- */

async function handleLootDeathUpdate(actor, changed, options) {
	if (!game.user?.isActiveGM) return;
	// Nur NSC-Aktoren (Rudolfs Entscheidungen: besiegte Gegner; SC-
	// Charaktere werden von der Automatik bewusst nicht erfasst).
	if (actor?.type !== 'monster') return;
	// HP-Pfad: Symbaroum-Zähigkeit. Nur reagieren, wenn das Update den
	// Wert auch berührt (jede andere Actor-Änderung geht vorbei).
	if (!foundry.utils.hasProperty(changed, DEATH_HP_PATH)) return;
	const hp = Number(foundry.utils.getProperty(changed, DEATH_HP_PATH));
	if (!Number.isFinite(hp) || hp > 0) return;
	// Token(s) des Aktors: unlinked Tokens hängen am Dokument selbst,
	// linked Aktoren über ihre aktiven Tokens (alle Szenen).
	let tokenDocs = [];
	if (options?.parent?.documentName === 'Token') tokenDocs = [options.parent];
	else if (actor.parent?.documentName === 'Token') tokenDocs = [actor.parent];
	else tokenDocs = [...new Set((actor.getActiveTokens() ?? []).map((t) => t.document))];
	for (const tokenDoc of tokenDocs) {
		const config = getLootConfig(tokenDoc);
		if (config.enabled || !config.enabledOnDeath) continue;
		await setTokenLootFlag(tokenDoc, { enabled: true });
		ui.notifications.info(F('LOOT.NOTIF_DEATH_ENABLED', { name: tokenDoc.name }));
	}
}

/* ----------------------------------------------------------------
 *  Spieler-Einzelklick (CC-Muster: _onClickLeft-Patch + Pointer-
 *  Fallback + Modifier-Durchlass + Bewegungs-Guards + Debounce)
 * ---------------------------------------------------------------- */

const LOOT_CLICK_PATCH_FLAG = '_symbaroumLootClickPatched';
const CANVAS_LISTENER_FLAG = '_symbaroumLootCanvasListeners';
let hoveredLootToken = null;
let pointerDownState = null;
let lastOpen = { tokenId: null, time: 0 };

function isModifiedClick(event) {
	return !!(event?.shiftKey || event?.ctrlKey || event?.metaKey || event?.altKey);
}

function isLootableForClick(token) {
	if (game.user?.isGM) return false; // GM lootet über HUD/Dialog
	const tokenDoc = token?.document;
	if (!tokenDoc || tokenDoc.hidden) return false;
	return getLootConfig(tokenDoc).enabled && !!tokenDoc.actor;
}

async function openLootFromClick(token) {
	const tokenDoc = token.document;
	const tokenId = tokenDoc.id;
	const now = Date.now();
	if (lastOpen.tokenId === tokenId && now - lastOpen.time < 600) return true; // Debounce
	lastOpen = { tokenId, time: now };
	const response = await requestLootContext(tokenDoc);
	if (!response?.ok || !response.context) {
		if (response?.message) ui.notifications.warn(response.message);
		else ui.notifications.warn(L('LOOT.ERR_NO_GM'));
		return false;
	}
	openLootDialog(tokenDoc, response.context);
	return true;
}

function registerLootClickPatch() {
	const tokenClass = CONFIG?.Token?.objectClass ?? globalThis.Token;
	const tokenPrototype = tokenClass?.prototype;
	if (!tokenPrototype || tokenPrototype[LOOT_CLICK_PATCH_FLAG]) return;
	const originalOnClickLeft = typeof tokenPrototype._onClickLeft === 'function' ? tokenPrototype._onClickLeft : null;
	if (!originalOnClickLeft) return;
	tokenPrototype._onClickLeft = function (event) {
		const originalEvent = event?.data?.originalEvent || event?.originalEvent || event;
		if (!isModifiedClick(originalEvent) && isLootableForClick(this)) {
			openLootFromClick(this); // bewusst nicht blockierend
		}
		return originalOnClickLeft.call(this, event);
	};
	tokenPrototype[LOOT_CLICK_PATCH_FLAG] = true;
}

function handleLootPointerDown(event) {
	if (event.button !== 0 || isModifiedClick(event)) {
		pointerDownState = null;
		return;
	}
	const token = hoveredLootToken;
	pointerDownState =
		token && isLootableForClick(token)
			? { token, x: Number(event.clientX || 0), y: Number(event.clientY || 0), time: Date.now() }
			: null;
}

function handleLootPointerUp(event) {
	if (event.button !== 0 || isModifiedClick(event)) {
		pointerDownState = null;
		return;
	}
	// Nur ein vollständiger Klick (down + up auf demselben Token) löst
	// Loot aus - reines Hoverieren oder Down an anderer Stelle nicht.
	const state = pointerDownState;
	pointerDownState = null;
	const token = state?.token;
	if (!token || !isLootableForClick(token)) return;
	const dx = Number(event.clientX || 0) - Number(state.x ?? 0);
	const dy = Number(event.clientY || 0) - Number(state.y ?? 0);
	if (Math.hypot(dx, dy) > 8) return; // Drag, kein Klick
	if (Date.now() - Number(state.time ?? 0) > 1200) return; // zu lang gehalten
	openLootFromClick(token);
}

function handleLootHover(token, hovered) {
	if (hovered && isLootableForClick(token)) hoveredLootToken = token;
	else if (hoveredLootToken === token) hoveredLootToken = null;
}

function registerLootCanvasListeners() {
	const view = canvas?.app?.view;
	if (view instanceof HTMLCanvasElement && !view[CANVAS_LISTENER_FLAG]) {
		view.addEventListener('pointerdown', handleLootPointerDown, true);
		view.addEventListener('pointerup', handleLootPointerUp, true);
		view[CANVAS_LISTENER_FLAG] = true;
	}
	registerLootClickPatch();
}

/* ----------------------------------------------------------------
 *  Canvas-Drop: Item auf die Szene ziehen => Loot-Pile
 * ---------------------------------------------------------------- */

async function handleLootCanvasDrop(canvas, data, event) {
	if (data?.type !== 'Item') return; // alles andere: Core-Verhalten
	let item = null;
	try {
		item = await fromUuid(data.uuid);
	} catch (err) {
		item = null;
	}
	if (!item || !GIVE_TYPES.includes(item.type)) return;
	// Spieler können nur eigene Items platzieren (GM-seitig geprüft);
	// der Bestätigungsdialog läuft lokal, die Ausführung über den Socket.
	await openPileDropDialog({ item, x: data.x, y: data.y, sceneId: canvas.scene?.id });
}

/* ----------------------------------------------------------------
 *  Hook-Registrierung (hooks.js ruft registerLootSettings im init,
 *  registerLootRuntimeHooks im ready auf)
 * ---------------------------------------------------------------- */

export function registerLootRuntimeHooks() {
	Hooks.on('renderTokenHUD', injectLootHudButtons);
	Hooks.on('updateActor', handleLootDeathUpdate);
	Hooks.on('hoverToken', handleLootHover);
	Hooks.on('canvasReady', registerLootCanvasListeners);
	registerLootCanvasListeners(); // ready kann nach canvasReady feuern
	Hooks.on('dropCanvasData', handleLootCanvasDrop);
	game.socket.on('system.symbaroum', lootSocketHandler);
}
