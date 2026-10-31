/**
 * Übergabe v1 (Spielimmersive Aktionen): Item- und Geldtransfer zwischen
 * Charakteren und NSC - Rudolfs Entscheidungen aus Analyse-Canvas und
 * Auswahlrunde (30./31.10.2026, Freigabe "Du kannst v1 erstellen."):
 *
 *  - Einstiegspunkte: Gear-Tab-Kontextmenü (modern UND klassisch, nie
 *    Kampf-/Kräfte-Tab), Item-Kopf-Button im modernen Item-Blatt (nur
 *    physische Typen - der Titelbereich ist dort button-frei, der
 *    Aktivieren-Button betrifft die disjunkten Typen
 *    Fähigkeit/Merkmal/Kraft), Behälterzeilen mit eigenem Mini-Menü und
 *    der Währungs-Dialog der Stammleiste ("Geben an ..."-Button).
 *  - Quelle ist immer das offene Blatt ("Von: <Name>" im Dialog), kein
 *    Quell-Auswahlschritt.
 *  - Empfänger: anwesende Tokens der aktiven Szene zuerst (optgroup im
 *    Auswahlmenü), Fallback-Liste "nicht anwesend" mit den Charakteren
 *    der Spieler (Spieler sieht nur Aktoren mit mindestens LIMITED;
 *    der GM sieht alle Welt-Aktoren). Ein gegliedertes select ersetzt
 *    den besprochenen Zwei-Stufen-Wizard: Rudolfs Kernziel waren weniger
 *    Klicks, die Spieler-Gruppierung bleibt erhalten.
 *  - Berechtigung: GM oder Selbstbesitz (Geber besitzt den Ziel-Aktor,
 *    z. B. eigenen Zweit-SC) => sofort. Fremder Besitzer => Consent:
 *    1-Klick-Prompt beim Empfänger-Besitzer über den System-Socket
 *    (system.json "socket": true, Kanal wie a29/symbcomms; beide
 *    ignorieren fremde Nachrichtentypen). Ziel offline => sauberer
 *    Abbruch, kein GM-Fallback in v1.
 *  - Rechtebasierte Ausführung (beidseitig): der Geber-Client löscht an
 *    der Quelle, der Ziel-Besitzer-Client erstellt am Ziel - beide
 *    Schritte erst nach 'accepted'. Der Socket-Payload trägt die
 *    Item-Daten (toObject), nie Live-Dokumente (TOCTOU-Schutz).
 *  - Behälter wandern KOMPLETT inkl. Inhalt (Teilbaum, Kinder via
 *    system.container, Tiefe 2 mit Zykel-Schutz). Am Ziel werden frische
 *    _ids erzeugt und die container-Referenzen gemappt - robust gegen
 *    _id-Kollisionen. Behälter-Geld (system.currency am Item) reist mit.
 *  - Menge: stapelbare Items Default 1 (max = Anzahl); Behälter ohne
 *    Stepper; merge am Ziel über die AP2-Identitätsregel
 *    (stacking.findStackTarget).
 *  - Sichtbarkeit: Radios Öffentlich (Default) / Flüstern; der GM wird
 *    immer informiert (öffentliche Karte sowieso, Flüster-Karte an
 *    Ziel-Besitzer + GMs + Geber).
 *  - Unlinked NSC-Tokens sind gültige Ziele (token.actor);
 *    aktive Waffen bleiben übertragbar (landen inaktiv am Ziel).
 */
import { symbDialog } from './symbDialog.js';
import { isStackableItem, findStackTarget } from './stacking.js';
import { getContainerChildren } from './container.js';
import { formatCurrency } from './currency.js';
import { getModernSheetEffectiveDesign } from './modernSheetConfig.js';

const { randomID } = foundry.utils;

/** Physische, handelbare Item-Typen (Behälter inklusive). */
export const GIVE_TYPES = ['weapon', 'armor', 'equipment', 'artifact', 'container'];

const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

/* ----------------------------------------------------------------
 *  Empfänger-Sammlung
 * ---------------------------------------------------------------- */

/**
 * Anwesende Tokens der aktiven Szene (dedupliziert nach Actor; Spieler
 * sehen nur Tokens mit mindestens LIMITED-Recht - Beobachter-Stufe).
 */
function sceneTokenRecipients(sourceActor) {
	const user = game.user;
	const out = [];
	const seen = new Set([sourceActor?.uuid]);
	for (const token of canvas.tokens?.placeables ?? []) {
		const actor = token.actor;
		if (!actor || seen.has(actor.uuid)) continue;
		if (!user.isGM && !actor.testUserPermission(user, 'LIMITED')) continue;
		seen.add(actor.uuid);
		out.push({
			value: `t:${token.id}`,
			name: token.name === actor.name ? token.name : `${token.name} (${actor.name})`,
		});
	}
	return out;
}

/**
 * Fallback-Liste für token-loses Erzählen: Welt-Aktoren, gruppiert nach
 * Besitzer-Spieler (OWNER-Recht oder user.character). Der GM sieht alle
 * Welt-Aktoren in einer Gruppe, Spieler nur die ihnen sichtbaren.
 */
function actorListRecipients(sourceActor, seenUuids) {
	const user = game.user;
	const groups = [];
	const claimed = new Set();
	if (user.isGM) {
		const actors = game.actors
			.filter((a) => !seenUuids.has(a.uuid) && a.uuid !== sourceActor?.uuid)
			.map((a) => ({ value: `a:${a.id}`, name: a.name }))
			.sort((a, b) => a.name.localeCompare(b.name));
		if (actors.length) groups.push({ label: L('GIVE.GROUP_OFFSCENE'), actors });
		return groups;
	}
	for (const u of game.users.contents ?? game.users) {
		if (u.isGM) continue;
		const owned = game.actors.filter(
			(a) =>
				!seenUuids.has(a.uuid) &&
				!claimed.has(a.uuid) &&
				a.uuid !== sourceActor?.uuid &&
				a.testUserPermission(user, 'LIMITED') &&
				(a.testUserPermission(u, 'OWNER') || u.character?.id === a.id)
		);
		for (const a of owned) claimed.add(a.uuid);
		if (owned.length) {
			groups.push({
				label: u.name,
				actors: owned
					.map((a) => ({ value: `a:${a.id}`, name: a.name }))
					.sort((a, b) => a.name.localeCompare(b.name)),
			});
		}
	}
	return groups;
}

function collectRecipients(sourceActor) {
	const tokens = sceneTokenRecipients(sourceActor);
	// Token-Actor-UUIDs sammeln, damit verknüpfte Aktoren in der Fallback-Liste
	// nicht doppelt auftauchen (unlinked Token-Actors liegen nicht in game.actors)
	const seenActorUuids = new Set([sourceActor?.uuid]);
	for (const token of canvas.tokens?.placeables ?? []) {
		if (token.actor) seenActorUuids.add(token.actor.uuid);
	}
	return { tokens, groups: actorListRecipients(sourceActor, seenActorUuids), seenActorUuids };
}

/** Löst die select-Option "t:<tokenId>" / "a:<actorId>" zum Aktor auf. */
function resolveRecipient(value) {
	if (!value) return null;
	const [kind, id] = value.split(':');
	if (kind === 't') {
		const token = canvas.scene?.tokens?.get(id) ?? game.scenes.viewed?.tokens?.get(id);
		return token?.actor ?? null;
	}
	if (kind === 'a') return game.actors.get(id) ?? null;
	return null;
}

/**
 * Primärer Besitzer-User des Ziel-Aktors (für Consent und Execute-
 * Routing): expliziter OWNER-User, sonst user.character-Verknüpfung,
 * sonst der aktive GM (NSC ohne Besitzer).
 */
function resolveTargetUser(actor) {
	const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
	const owners = game.users.filter((u) => actor.ownership?.[u.id] === OWNER);
	if (owners.length) return owners.find((u) => u.active) ?? owners[0];
	const charUser = game.users.find((u) => u.character?.id === actor.id);
	if (charUser) return charUser;
	return game.users.find((u) => u.active && u.isGM) ?? null;
}

/* ----------------------------------------------------------------
 *  Behälter-Teilbaum
 * ---------------------------------------------------------------- */

/** Sammelt einen Behälter samt Inhalt (rekursiv, Zykel-sicher). */
export function collectContainerSubtree(actor, container, visited = new Set()) {
	if (!container || visited.has(container.id)) return [];
	visited.add(container.id);
	const nodes = [container];
	for (const child of getContainerChildren(actor, container.id)) {
		if (child.type === 'container') nodes.push(...collectContainerSubtree(actor, child, visited));
		else if (!visited.has(child.id)) {
			visited.add(child.id);
			nodes.push(child);
		}
	}
	return nodes;
}

function containerStats(actor, container) {
	const nodes = collectContainerSubtree(actor, container);
	let money = Number(container.system?.currency) || 0;
	return { childCount: Math.max(0, nodes.length - 1), money };
}

/* ----------------------------------------------------------------
 *  Payload / Beschreibung
 * ---------------------------------------------------------------- */

/**
 * Bau des Socket-Payloads (reine Daten, kein Live-Dokument). Reihenfolge:
 * Wurzel zuerst, Kinder danach (Eltern vor Kindern - die Ziel-Seite
 * mappt die container-Referenzen beim Erstellen).
 */
function buildPayload(sourceActor, item, quantity) {
	if (item.type === 'container') {
		const nodes = collectContainerSubtree(sourceActor, item);
		return {
			kind: 'container',
			items: nodes.map((n, i) => ({ data: n.toObject(), isRoot: i === 0 })),
		};
	}
	const data = item.toObject();
	if (isStackableItem(data)) data.system.number = Math.max(1, Math.round(quantity || 1));
	return { kind: 'item', items: [{ data, isRoot: true }], quantity: Math.max(1, Math.round(quantity || 1)) };
}

/** Einzeilige Beschreibung des Transferguts für Consent und Chat. */
function describeTransfer(sourceActor, item, quantity, money) {
	if (money != null) return formatCurrency(money);
	if (item.type === 'container') {
		const { childCount, money: containerMoney } = containerStats(sourceActor, item);
		return `${item.name} — ${F('GIVE.CONTENTS', { count: childCount, money: formatCurrency(containerMoney) })}`;
	}
	return quantity > 1 ? `${item.name} × ${quantity}` : item.name;
}

/* ----------------------------------------------------------------
 *  Ziel-Seite: erstellen / mergen
 * ---------------------------------------------------------------- */

/**
 * Wendet den Payload am Ziel-Aktor an (lokal im Direct-Fall, beim
 * Ziel-Besitzer-Client nach 'accepted'). Frische _ids, gemappte
 * container-Referenzen; lose Items mergen nach AP2-Identitätsregel.
 */
async function applyAtTarget(targetActor, payload) {
	if (!targetActor || !payload) return;
	if (payload.kind === 'money') {
		const cur = Math.max(0, Math.round(Number(targetActor.system?.currency) || 0));
		await targetActor.update({ 'system.currency': cur + Math.max(0, Math.round(payload.money || 0)) });
		return;
	}
	const idMap = new Map();
	let index = 0;
	for (const entry of payload.items) {
		const data = foundry.utils.duplicate(entry.data);
		const oldId = data._id;
		delete data._id;
		delete data.flags?.['symbaroum']?.favorite; // Favoriten nicht mitkopieren (splitStackItem-Muster)
		// container-Referenz auf die neue Behälter-ID mappen; nicht übertragbare
		// Referenzen (sollte der Teilbaum-Abholung wegen nicht vorkommen) machen
		// das Item lose.
		if (data.system?.container) {
			if (idMap.has(data.system.container)) data.system.container = idMap.get(data.system.container);
			else delete data.system.container;
		}
		if (index === 0 && payload.kind === 'item') {
			// Einzelnes (lose) Item: Merge mit vorhandenem Stapel am Ziel
			const stack = findStackTarget(targetActor, data);
			if (stack) {
				const incoming = Math.max(1, Math.round(Number(data.system?.number ?? 1) || 1));
				const current = Math.max(1, Math.round(Number(stack.system?.number ?? 1) || 1));
				await stack.update({ 'system.number': current + incoming });
				index++;
				continue;
			}
		}
		const [created] = await targetActor.createEmbeddedDocuments('Item', [data]);
		if (oldId && created) idMap.set(oldId, created.id);
		index++;
	}
}

/* ----------------------------------------------------------------
 *  Quell-Seite: entfernen
 * ---------------------------------------------------------------- */

async function removeFromSource(sourceActor, item, quantity, money) {
	if (money != null) {
		const cur = Math.max(0, Math.round(Number(sourceActor.system?.currency) || 0));
		await sourceActor.update({ 'system.currency': Math.max(0, cur - Math.round(money)) });
		return;
	}
	if (item.type === 'container') {
		const ids = collectContainerSubtree(sourceActor, item).map((n) => n.id);
		if (ids.length) await sourceActor.deleteEmbeddedDocuments('Item', ids);
		return;
	}
	const number = Math.max(1, Math.round(Number(item.system?.number ?? 1) || 1));
	const take = Math.max(1, Math.round(quantity || 1));
	if (isStackableItem(item) && take < number) {
		await item.update({ 'system.number': number - take });
	} else {
		await sourceActor.deleteEmbeddedDocuments('Item', [item.id]);
	}
}

/* ----------------------------------------------------------------
 *  Chat-Karte
 * ---------------------------------------------------------------- */

async function sendTransferCard({ sourceActor, targetName, description, img, mode, targetUserId }) {
	const html = await foundry.applications.handlebars.renderTemplate(
		'systems/symbaroum/template/chat/give-card.hbs',
		{ source: sourceActor.name, target: targetName, description, img }
	);
	const chatData = { content: html, speaker: ChatMessage.getSpeaker({ actor: sourceActor }) };
	if (mode === 'whisper') {
		const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
		chatData.whisper = [...new Set([game.user.id, targetUserId, ...gmIds])];
	}
	await ChatMessage.create(chatData);
}

/* ----------------------------------------------------------------
 *  Ablaufsteuerung (direkt / Consent)
 * ---------------------------------------------------------------- */

/** Laufende Übergaben des eigenen Clients (tx -> Kontext). */
const pending = new Map();

function dialogClasses(...extra) {
	const theme = getModernSheetEffectiveDesign()?.theme === 'classic' ? 'classic' : 'dark';
	return ['modern-dialog', `modern-theme-${theme}`, ...extra];
}

/**
 * Führt die Übergabe nach erteilter Freigabe aus. Direct (GM /
 * Selbstbesitz) macht beide Seiten lokal; sonst läuft die Erstellung
 * beim Ziel-Besitzer-Client via Socket, das Löschen beim Geber.
 */
async function performTransfer(ctx) {
	const { sourceActor, targetActor, targetUser, item, quantity, money, mode } = ctx;
	const description = describeTransfer(sourceActor, item, quantity, money);
	const payload = money != null ? { kind: 'money', money: Math.round(money) } : buildPayload(sourceActor, item, quantity);
	const direct = game.user.isGM || !!targetActor.isOwner;
	if (direct) {
		await applyAtTarget(targetActor, payload);
		await removeFromSource(sourceActor, item, quantity, money);
	} else {
		game.socket.emit('system.symbaroum', {
			type: 'transferExecute',
			targetUserId: targetUser.id,
			targetIsGM: !!targetUser.isGM,
			targetKind: ctx.targetKind,
			targetTokenId: ctx.targetTokenId,
			targetActorId: targetActor.id,
			payload,
		});
		// Löschen parallel zum Execute: beide Clients besitzen jeweils
		// ihre Seite - der Geber-Client hat die Ownership an der Quelle.
		await removeFromSource(sourceActor, item, quantity, money);
	}
	await sendTransferCard({
		sourceActor,
		targetName: targetActor.name,
		description,
		img: item?.img ?? null,
		mode,
		targetUserId: targetUser.id,
	});
}

/**
 * Startet die Übergabe aus dem Give-Dialog heraus (nach der
 * Empfänger-/Mengen-/Sichtbarkeits-Auswahl).
 */
async function initiateTransfer({ sourceActor, targetActor, item, quantity, money, mode }) {
	const targetUser = resolveTargetUser(targetActor);
	if (!targetUser) {
		ui.notifications.warn(L('GIVE.NO_RECIPIENTS'));
		return;
	}
	const ctx = {
		sourceActor,
		targetActor,
		targetUser,
		item,
		quantity,
		money,
		mode,
		targetKind: targetActor.isToken ? 'token' : 'actor',
		targetTokenId: targetActor.isToken ? targetActor.token?.id : null,
	};
	if (game.user.isGM || targetActor.isOwner) {
		await performTransfer(ctx);
		return;
	}
	if (!targetUser.active) {
		ui.notifications.warn(L('GIVE.TARGET_OFFLINE'));
		return;
	}
	const tx = randomID();
	const description = describeTransfer(sourceActor, item, quantity, money);
	pending.set(tx, ctx);
	game.socket.emit('system.symbaroum', {
		type: 'transferRequest',
		tx,
		targetUserId: targetUser.id,
		targetIsGM: !!targetUser.isGM,
		sourceUserId: game.user.id,
		sourceName: sourceActor.name,
		itemName: item?.name ?? null,
		itemImg: item?.img ?? null,
		description,
		mode,
	});
}

/* ----------------------------------------------------------------
 *  Socket-Handler (System-Kanal, symbcomms/a29-Muster)
 * ---------------------------------------------------------------- */

/** Ob dieser Client die Ziel-Seite der Nachricht ist. */
function isTargetClient(msg) {
	if (msg.targetUserId === game.user.id) return true;
	if (msg.targetIsGM && game.user.isActiveGM) return true;
	return false;
}

/** Consent-Prompt beim Ziel-Besitzer (Schließen = Abbruch, kein Timeout). */
async function showConsentPrompt(msg) {
	const F = game.i18n.format;
	const img = msg.itemImg ? `<img class="give-prompt-img" src="${msg.itemImg}" alt=""/>` : '';
	const content = `<div class="symbaroum modern-give-request">
		<div class="give-prompt-line">${img}<span>${F('GIVE.REQUEST_TEXT', { source: msg.sourceName })}</span></div>
		<div class="give-prompt-detail">${msg.description}</div>
	</div>`;
	symbDialog({
		title: L('GIVE.REQUEST_TITLE'),
		content,
		classes: dialogClasses('modern-give-dialog'),
		width: 400,
		buttons: {
			accept: {
				icon: '<i class="fas fa-check"></i>',
				label: L('GIVE.REQUEST_ACCEPT'),
				callback: async () => {
					game.socket.emit('system.symbaroum', {
						type: 'transferResponse',
						tx: msg.tx,
						accepted: true,
						sourceUserId: msg.sourceUserId,
					});
				},
			},
			decline: {
				icon: '<i class="fas fa-times"></i>',
				label: L('GIVE.REQUEST_DECLINE'),
				callback: async () => {
					game.socket.emit('system.symbaroum', {
						type: 'transferResponse',
						tx: msg.tx,
						accepted: false,
						sourceUserId: msg.sourceUserId,
					});
				},
			},
		},
	});
}

/** Execute beim Ziel-Besitzer-Client: erstellt am Ziel-Aktor. */
async function executeOnTarget(msg) {
	const targetActor =
		(msg.targetKind === 'token' && game.scenes.viewed?.tokens?.get(msg.targetTokenId)?.actor) ||
		game.actors.get(msg.targetActorId);
	if (!targetActor) return;
	if (!(game.user.isGM || targetActor.isOwner)) return;
	try {
		await applyAtTarget(targetActor, msg.payload);
		ui.notifications.info(L('GIVE.ACCEPTED'));
	} catch (err) {
		console.error('Symbaroum | Übergabe fehlgeschlagen (Ziel):', err);
		ui.notifications.error(L('GIVE.ERR_EXECUTE'));
	}
}

/**
 * Socket-Handler der Übergabe (in hooks.js am ready-Hook registriert;
 * symbcomms.js und der a29-Handler ignorieren diese Nachrichtentypen).
 */
export function transferSocketHandler(msg) {
	if (!msg?.type) return;
	if (msg.type === 'transferRequest' && isTargetClient(msg)) {
		showConsentPrompt(msg);
	} else if (msg.type === 'transferResponse' && msg.sourceUserId === game.user.id) {
		const ctx = pending.get(msg.tx);
		if (!ctx) return;
		pending.delete(msg.tx);
		if (!msg.accepted) {
			ui.notifications.info(L('GIVE.DECLINED'));
			return;
		}
		performTransfer(ctx).catch((err) => {
			console.error('Symbaroum | Übergabe fehlgeschlagen (Quelle):', err);
			ui.notifications.error(L('GIVE.ERR_EXECUTE'));
		});
	} else if (msg.type === 'transferExecute' && isTargetClient(msg)) {
		executeOnTarget(msg);
	}
}

/* ----------------------------------------------------------------
 *  Dialoge (Geber-Seite)
 * ---------------------------------------------------------------- */

async function renderGiveDialog(data) {
	return foundry.applications.handlebars.renderTemplate(
		'systems/symbaroum/template/sheet/modern/give-dialog.hbs',
		data
	);
}

function readDialogSelection(html) {
	const root = html[0];
	const targetValue = root.querySelector('#give-target')?.value;
	const vis = root.querySelector('input[name="give-vis"]:checked')?.value ?? 'public';
	return { targetValue, vis, root };
}

/** Item-Übergabe: Kontextmenü, Behälter-Menü und Item-Kopf-Button. */
export async function openGiveDialog(sourceActor, item) {
	if (!sourceActor || !item) return;
	if (!sourceActor.isOwner) {
		ui.notifications.warn(L('GIVE.NO_RIGHTS'));
		return;
	}
	const recipients = collectRecipients(sourceActor);
	if (!recipients.tokens.length && !recipients.groups.length) {
		ui.notifications.warn(L('GIVE.NO_RECIPIENTS'));
		return;
	}
	const isContainer = item.type === 'container';
	const stackable = !isContainer && isStackableItem(item);
	const max = Math.max(1, Math.round(Number(item.system?.number ?? 1) || 1));
	const html = await renderGiveDialog({
		sourceName: sourceActor.name,
		item: {
			name: item.name,
			img: item.img,
			stackable,
			max,
			isContainer,
			summary: isContainer ? describeTransfer(sourceActor, item, 1, null) : null,
		},
		recipients,
	});
	symbDialog({
		title: L('GIVE.DIALOG_TITLE'),
		content: html,
		classes: dialogClasses('modern-give-dialog'),
		width: 440,
		buttons: {
			give: {
				icon: '<i class="fas fa-gift"></i>',
				label: L('GIVE.BUTTON'),
				callback: async (html) => {
					const { targetValue, vis } = readDialogSelection(html);
					const targetActor = resolveRecipient(targetValue);
					if (!targetActor) return;
					let quantity = 1;
					if (stackable) {
						quantity = parseInt(html[0].querySelector('#give-quantity')?.value, 10);
						if (isNaN(quantity) || quantity < 1 || quantity > max) {
							ui.notifications.warn(L('GIVE.ERR_QUANTITY'));
							return;
						}
					}
					await initiateTransfer({ sourceActor, targetActor, item, quantity, mode: vis });
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

/** Geld-Übergabe: Einstieg im Währungs-Dialog der Stammleiste. */
export async function openGiveMoneyDialog(sourceActor) {
	if (!sourceActor) return;
	if (!sourceActor.isOwner) {
		ui.notifications.warn(L('GIVE.NO_RIGHTS'));
		return;
	}
	const available = Math.max(0, Math.round(Number(sourceActor.system?.currency) || 0));
	if (available < 1) {
		ui.notifications.warn(L('GIVE.ERR_MONEY'));
		return;
	}
	const recipients = collectRecipients(sourceActor);
	if (!recipients.tokens.length && !recipients.groups.length) {
		ui.notifications.warn(L('GIVE.NO_RECIPIENTS'));
		return;
	}
	const html = await renderGiveDialog({
		sourceName: sourceActor.name,
		money: { hint: F('GIVE.MONEY_HINT', { money: formatCurrency(available) }) },
		recipients,
	});
	symbDialog({
		title: L('GIVE.DIALOG_TITLE_MONEY'),
		content: html,
		classes: dialogClasses('modern-give-dialog'),
		width: 440,
		buttons: {
			give: {
				icon: '<i class="fas fa-gift"></i>',
				label: L('GIVE.BUTTON'),
				callback: async (html) => {
					const { targetValue, vis } = readDialogSelection(html);
					const targetActor = resolveRecipient(targetValue);
					if (!targetActor) return;
					const amount = Math.round(Number(html[0].querySelector('symbaroum-currency')?.getAttribute('value')) || 0);
					if (amount < 1 || amount > available) {
						ui.notifications.warn(L('GIVE.ERR_MONEY'));
						return;
					}
					await initiateTransfer({ sourceActor, targetActor, item: null, quantity: null, money: amount, mode: vis });
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
