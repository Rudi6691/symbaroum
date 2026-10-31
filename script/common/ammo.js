/**
 * Munitionsverbrauch v1 (Rudolfs Startsignal 31.10.2026: „Wir machen den
 * Kosmetik-X-Glyph mit dem Munitionsverbrauch" + Freigabe „loslegen mit v1").
 *
 * Rudolfs Entscheidungen (Auswahlrunden 1+2, 31.10.2026):
 *  - Waffenseitiges GM-Feld system.ammunition = { category, amount } auf
 *    weapon: leere Kategorie = kein Verbrauch (kein required-Bool),
 *    amount = Menge je Angriff (mindestens 1).
 *  - Munitions-Stapel: equipment (oder weapon - Wurfspeer-Pool) mit
 *    system.resourceCategory der Munitions-Kategorie (Kategorien in
 *    config.js RESOURCE_CATEGORY_SELECTION, Labels via i18n).
 *  - Verbrauch beim Wurf-Submit, UNABHAENIG vom Wurfergebnis (Medicus-
 *    Muster), Menge × Angriffsanzahl; Stapelreihenfolge wie Ressourcen
 *    (oberster Stapel zuerst, Abbuchen bis 0 erlaubt - Zeile bleibt).
 *  - BLOCKIEREN bei 0 bzw. zu geringem Bestand: Der Angriff wird
 *    verweigert (Notification, KEIN Wurf) - Pre-Flight in actor.js
 *    rollWeapon (fuer 1 Angriff) + Volle-Pruefung im Dialog-Submit
 *    (Menge × Angriffsanzahl, dialog.js).
 *  - Wurfwaffen (reference 'thrown' + stapelbar): Selbstverbrauch aus dem
 *    eigenen Stapel, 1 Stueck je Angriff; nicht-stapelbare Wurfwaffen
 *    ohne Auto-Verbrauch (dokumentiert).
 *  - Bergung: kampf-scoped Verbrauchszaehler je Stapel (Combat-Flag
 *    ammoUsage, nur gefuehrt, wenn die Bergungsoption an); beim Kampfende
 *    (preDeleteCombat - Flags sind dort noch lesbar) Bergungs-Chat-Karte
 *    je Aktor mit „Bergen"-Button (Eigentuemer/GM); 1W20 je verschossenem
 *    Stueck, GEBORGEN bei Wurf <= Schwelle (beschaedigt bei Wurf >
 *    Schwelle, GRW): Standard 10, Qualitaet 15, mystische Qualitaet 17.
 *  - Schwellen automatisch aus der Munition: Stapel mit system.ammoQuality
 *    (''/'quality'/'mystical' - NUR Makro-gesetzt, kein UI-Feld), Waffen
 *    aus system.qualities (mystical -> 17, sonst irgendeine Qualitaet ->
 *    15, sonst 10).
 *  - Settings „Munitionsverbrauch" + „Bergungsoption" (GM, scope world,
 *    Default AUS, config:true) - Registration direkt nach den
 *    Ressourcen-Settings, damit sie in der Foundry-Einstellungsliste
 *    DIRECT UNTER ihnen stehen (gleiche Liste wie lootEnabled*).
 *  - Spezialpfeil-KAMPFWirkungen NICHT in v1 (nur Bergungs-Schwelle);
 *    Mid-Ketten-Angriffe (Rueckwaertsschwung, Doppelschlag, Freier
 *    Angriff ausserhalb des Wurfeldialogs) buchen nichts (dokumentiert).
 *
 * Bewusst PARALLEL zu resources.js statt Refaktor: findResourceItems /
 * consumeResource bleiben Ausruestungs-only (Medicus-Regressionsschutz,
 * Ressourcen v1-Lernweis) - hier gibt es einen breiteren Finder
 * (equipment + weapon). Geteilt wird nur getItemCount (stapelweise Menge).
 */
import { getItemCount } from './resources.js';
import { isStackableItem } from './stacking.js';

/* i18n-Helfer nach resources.js-Muster */
const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);

/* Bergungs-Schwellen (GRW: beschaedigt bei 1W20 > Schwelle) */
export const AMMO_THRESHOLDS = { standard: 10, quality: 15, mystical: 17 };

/* ---------------------------------------------------------------- */
/* Settings (Registration in hooks.js direkt nach den Ressourcen)   */
/* ---------------------------------------------------------------- */

export function registerAmmoSettings() {
	// Munitionsverbrauch v1: Automatischer Munitionsverbrauch waffenseitig
	// kategorisierter Waffen (GM-Feld auf dem Waffenblatt) - gleiche Liste
	// wie lootEnabled* / resourceConsumption (config:true), Default AUS.
	game.settings.register('symbaroum', 'ammoConsumption', {
		name: 'AMMO.SETTING_ENABLED',
		hint: 'AMMO.SETTING_ENABLED_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
	});
	// Munitionsverbrauch v1: Bergungsoption (Verbrauchszaehler im aktiven
	// Kampf + Bergungs-Karte beim Kampfende) - Voraussetzung bleibt der
	// Hauptschalter; ohne ihn wird weder gezaehlt noch gebucht.
	game.settings.register('symbaroum', 'ammoRecovery', {
		name: 'AMMO.SETTING_RECOVERY',
		hint: 'AMMO.SETTING_RECOVERY_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
		restricted: true,
	});
}

/** Effektiver Schalter des automatischen Munitionsverbrauchs. */
export function isAmmoConsumptionEnabled() {
	return !!game.settings.get('symbaroum', 'ammoConsumption');
}

/** Effektiver Schalter der Bergungsoption (Zaehler + Bergungs-Karte). */
export function isAmmoRecoveryEnabled() {
	return isAmmoConsumptionEnabled() && !!game.settings.get('symbaroum', 'ammoRecovery');
}

/* ---------------------------------------------------------------- */
/* Waffen-Konfiguration                                              */
/* ---------------------------------------------------------------- */

/**
 * Liefert das Item hinter dem Wurf-Parameter: rollWeapon/prepareRoll-
 * Attribute uebergeben die EC-Struktur aus actor.system.weapons (mit
 * .id), Faehigkeits-Angriffe teils das Item selbst. Beide Faelle werden
 * hier auf das echte Item aufgeloest (Runde-2-Entscheidung: alle Pfade
 * laufen ueber EINE Konfigurationsquelle).
 */
export function resolveWeaponItem(actor, weapon) {
	if (!weapon) return null;
	if (weapon instanceof CONFIG.Item.documentClass) return weapon;
	if (actor?.items && weapon.id) return actor.items.get(weapon.id) ?? null;
	return null;
}

/**
 * Waffenseitige Munitions-Konfiguration (system.ammunition) inklusive
 * Wurfwaffen-Erkennung: reference 'thrown' UND stapelbar => Selbst-
 * verbrauch (1 je Angriff) unabhaengig von der Kategorie.
 */
export function getWeaponAmmoConfig(actor, weapon) {
	const item = resolveWeaponItem(actor, weapon);
	if (!item || item.type !== 'weapon') return null;
	const ammo = item.system?.ammunition ?? {};
	const category = typeof ammo.category === 'string' ? ammo.category : '';
	const amount = Math.max(1, Math.round(Number(ammo.amount) || 1));
	const thrownSelf = item.system?.reference === 'thrown' && isStackableItem(item);
	return { item, category, amount, thrownSelf };
}

/** Label einer Munitions-Kategorie (i18n, Fallback: rohe id). */
export function getAmmoCategoryLabel(category) {
	const sel = game.symbaroum.config.RESOURCE_CATEGORY_SELECTION[category];
	return sel ? L(sel.label) : String(category);
}

/* ---------------------------------------------------------------- */
/* Stapel-Finder (breiter als resources.js: equipment UND weapon)     */
/* ---------------------------------------------------------------- */

/**
 * Alle Munitions-Stapel eines Akteurs in einer Kategorie: equipment
 * (Pfeilbuendel & Co.) UND weapon (Wurfspeer-Stapel als Speerschleuder-
 * Munition). Behaelter-Kinder laufen wie bei resources.js ueber die
 * flache actor.items-Referenz automatisch mit. requireAvailable=false
 * liefert auch leere (Menge 0) Stapel.
 */
export function findAmmoStacks(actor, category, { requireAvailable = true } = {}) {
	if (!actor?.items || !category) return [];
	return actor.items.filter((item) => {
		if (item?.type !== 'equipment' && item?.type !== 'weapon') return false;
		if ((item.system?.resourceCategory ?? '') !== category) return false;
		return !requireAvailable || getItemCount(item) > 0;
	});
}

/** Gesamtbestand einer Munitions-Kategorie im Inventar. */
export function getAmmoTotal(actor, category) {
	return findAmmoStacks(actor, category).reduce((sum, item) => sum + getItemCount(item), 0);
}

/* ---------------------------------------------------------------- */
/* Bergungs-Schwelle (GRW: 1W20 > Schwelle = beschaedigt)            */
/* ---------------------------------------------------------------- */

/**
 * Schwelle eines Munitions-Stapels: system.ammoQuality ('' = Standard 10,
 * 'quality' = 15, 'mystical' = 17; nur Makro-gesetzt, kein UI) - Waffen
 * (Wurfspeer-Stapel, Selbstverbrauch) stattdessen aus system.qualities:
 * mystical -> 17, sonst irgendeine Qualitaet -> 15, sonst 10.
 */
export function getAmmoThreshold(item) {
	if (!item) return AMMO_THRESHOLDS.standard;
	const quality = item.system?.ammoQuality ?? '';
	if (quality === 'mystical') return AMMO_THRESHOLDS.mystical;
	if (quality === 'quality') return AMMO_THRESHOLDS.quality;
	if (item.type === 'weapon') {
		const qualities = item.system?.qualities ?? {};
		if (qualities.mystical === true) return AMMO_THRESHOLDS.mystical;
		if (Object.values(qualities).some((v) => v === true)) return AMMO_THRESHOLDS.quality;
	}
	return AMMO_THRESHOLDS.standard;
}

/* ---------------------------------------------------------------- */
/* Pre-Flight (actor.js rollWeapon): Angriff verweigern             */
/* ---------------------------------------------------------------- */

/**
 * Pre-Flight vor dem Wurfeldialog: blockiert, wenn fuer EINEN Angriff
 * keine Munition (bzw. kein Wurfwaffen-Stueck) mehr da ist. Die volle
 * Pruefung (Menge × Angriffsanzahl) passiert im Dialog-Submit
 * (consumeAmmoForAttack) - hier reicht der Ein-Angriffs-Blick, damit
 * das Blaatt/die Liste gar nicht erst in den Wurf laeuft.
 * Rueckgabe false = blockiert (Notification kam hier).
 */
export function checkWeaponAmmoReady(actor, weapon) {
	if (!isAmmoConsumptionEnabled()) return true;
	const cfg = getWeaponAmmoConfig(actor, weapon);
	if (!cfg) return true;
	if (cfg.thrownSelf) {
		if (getItemCount(cfg.item) < 1) {
			ui.notifications.warn(F('AMMO.ERR_NO_THROWN', { weapon: cfg.item.name }));
			return false;
		}
		return true;
	}
	if (!cfg.category) return true;
	if (getAmmoTotal(actor, cfg.category) < cfg.amount) {
		ui.notifications.warn(
			F('AMMO.ERR_NO_AMMO', { weapon: cfg.item.name, category: getAmmoCategoryLabel(cfg.category) })
		);
		return false;
	}
	return true;
}

/* ---------------------------------------------------------------- */
/* Abbuchung (dialog.js Wurf-Submit)                                */
/* ---------------------------------------------------------------- */

/**
 * Abbuchung beim Wurf-Submit: unabhaengig vom Wurfergebnis (Medicus-
 * Muster), Menge je Angriff × Angriffsanzahl, AP2-Stapelreihenfolge
 * (oberster Stapel zuerst, bis 0 erlaubt - Zeile bleibt stehen).
 *
 * Rueckgabe-Vertrag fuer dialog.js:
 *   - null   = nichts gebucht (Setting AUS, keine Kategorie, kein Item)
 *   - false  = BLOCKIERT (Notification kam hier; der Wurf laeuft nicht)
 *   - String = Label fuer autoParams/Chat (Format AMMO.CHAT_CONSUMED)
 */
export async function consumeAmmoForAttack(actor, weapon, numberofAttacks = 1) {
	if (!isAmmoConsumptionEnabled()) return null;
	const cfg = getWeaponAmmoConfig(actor, weapon);
	if (!cfg) return null;
	const attacks = Math.max(1, Math.round(Number(numberofAttacks) || 1));

	// Wurfwaffen-Selbstverbrauch: 1 Stueck je Angriff aus dem eigenen
	// Stapel (Runde-1-Entscheidung; nicht-stapelbare Wurfwaffen sind in
	// getWeaponAmmoConfig schon herausgefiltert - kein Auto-Verbrauch).
	if (cfg.thrownSelf) {
		const current = getItemCount(cfg.item);
		if (current < attacks) {
			ui.notifications.warn(F('AMMO.ERR_NOT_ENOUGH_THROWN', { weapon: cfg.item.name, attacks }));
			return false;
		}
		await cfg.item.update({ 'system.number': current - attacks });
		trackAmmoUsage(actor, cfg.item, attacks, "thrown");
		return F('AMMO.CHAT_CONSUMED', { name: cfg.item.name, amount: attacks });
	}

	if (!cfg.category) return null;
	const need = cfg.amount * attacks;
	const stacks = findAmmoStacks(actor, cfg.category);
	const total = stacks.reduce((sum, item) => sum + getItemCount(item), 0);
	if (total < need) {
		ui.notifications.warn(
			F('AMMO.ERR_NOT_ENOUGH', {
				weapon: cfg.item.name,
				category: getAmmoCategoryLabel(cfg.category),
				attacks,
			})
		);
		return false;
	}
	let remaining = need;
	let firstName = null;
	for (const item of stacks) {
		if (remaining <= 0) break;
		const current = getItemCount(item);
		const takeFromStack = Math.min(current, remaining);
		// Bewusst bis 0 erlaubt - Zeile bleibt stehen (wie Ressourcen).
		await item.update({ 'system.number': current - takeFromStack });
		remaining -= takeFromStack;
		if (firstName === null) firstName = item.name;
		trackAmmoUsage(actor, item, takeFromStack, cfg.category);
	}
	return F('AMMO.CHAT_CONSUMED', { name: firstName ?? '', amount: need });
}

/* ---------------------------------------------------------------- */
/* Kampf-Zaehler + Bergung                                          */
/* ---------------------------------------------------------------- */

/**
 * Kampf-scoped Verbrauchszaehler je Stapel (Combat-Flag ammoUsage,
 * Schluessel actorId.itemId). Nur gefuehrt, wenn die Bergungsoption
 * an ist (und der Haupt-Schalter) - der Zaehler existiert ausschliess-
 * lich fuer die Bergungs-Karte. Angriffe ausserhalb eines Kampfes
 * werden nicht gezaehlt (game.combat = aktiver Kampf).
 *
 * Rechte-Arbitrierung (Loot-/Transfer-Socket-Muster): Spieler duerfen
 * Combat-Dokumente i. d. R. nicht updaten - ihre Buchungen laufen als
 * 'ammoTrack'-Socket-Nachricht zur GM-Seite (erster aktiver GM wendet
 * an, siehe registerAmmoRuntimeHooks); GM-Buchungen direkt. Die
 * Abbuchung selbst ist davon UNBERUEHRT (laeuft immer lokal beim
 * Angreifer), nur der Zaehler ist GM-vermittelt.
 */
function trackAmmoUsage(actor, item, taken, category) {
	if (!taken || taken <= 0) return;
	if (!game.combat || !isAmmoRecoveryEnabled()) return;
	if (game.user.isGM) {
		applyAmmoUsage(actor, item, taken, category).catch((err) => console.error('Symbaroum | ammo usage tracking failed', err));
		return;
	}
	game.socket.emit('system.symbaroum', {
		type: 'ammoTrack',
		actorId: actor.id,
		itemId: item.id,
		category,
		taken,
	});
}

/** Zaehler-Stand auf dem aktiven Kampf fortschreiben (nur GM-Seite). */
async function applyAmmoUsage(actor, item, taken, category) {
	const combat = game.combat;
	if (!combat) return;
	const key = `${actor.id}.${item.id}`;
	const usage = foundry.utils.duplicate(combat.getFlag(game.system.id, 'ammoUsage') ?? {});
	const prev = usage[key] ?? {
		actorId: actor.id,
		itemId: item.id,
		name: item.name,
		category,
		threshold: getAmmoThreshold(item),
		fired: 0,
	};
	prev.name = item.name;
	prev.category = category;
	prev.fired += taken;
	usage[key] = prev;
	await combat.setFlag(game.system.id, 'ammoUsage', usage);
}

/** Runtime-Hooks (Registration in hooks.js 'ready', Muster loot.js). */
export function registerAmmoRuntimeHooks() {
	// Kampfende: Flags sind im preDeleteCombat-Hook noch lesbar
	// (deleteCombat waere zu spaet) - Karte VOR der Loeschung bauen.
	Hooks.on('preDeleteCombat', (combat) => {
		if (!game.user.isGM) return;
		buildAmmoRecoveryCards(combat);
	});
	// Spieler-Buchungen: 'ammoTrack'-Socket (disjunkter Nachrichtentyp,
	// symbcomms.js ignoriert unbekannte Typen - Uebergabe-/Loot-Muster).
	// Nur der ERSTE aktive GM wendet an, damit bei mehreren GMs nicht
	// doppelt gezaehlt wird.
	game.socket.on('system.symbaroum', async (msg) => {
		if (msg?.type !== 'ammoTrack' || !game.user.isGM) return;
		const firstGM = game.users.find((u) => u.isGM && u.active);
		if (firstGM?.id !== game.user.id) return;
		const actor = game.actors.get(msg.actorId);
		const item = actor?.items.get(msg.itemId);
		if (!actor || !item) return;
		await applyAmmoUsage(actor, item, msg.taken, msg.category);
	});
	// Bergungs-Button: separater renderChatMessageHTML-Listener neben dem
	// bestehenden applyEffects-Listener (Muster hooks.js), nur eigene Karte.
	Hooks.on('renderChatMessageHTML', (message, html) => {
		const btn = html.querySelector?.('.ammo-recovery-btn');
		if (!btn) return;
		const data = message.getFlag(game.system.id, 'ammoRecovery');
		if (!data) return;
		if (data.done) {
			btn.disabled = true;
			btn.textContent = L('AMMO.RECOVERY_BUTTON_DONE');
			return;
		}
		btn.addEventListener('click', async () => {
			await performAmmoRecovery(message);
		});
	});
}

/**
 * Bergungs-Karten beim Kampfende: eine Karte je Aktor mit verbrauchter
 * Munition (Zeilen je Stapel + „Bergen"-Button, Eigentuemer/GM). Namen
 * werden escaped (Item-Namen sind Freitext), die Karte traegt das Flag
 * ammoRecovery fuer den Button-Listener.
 */
function buildAmmoRecoveryCards(combat) {
	if (!isAmmoRecoveryEnabled()) return;
	const usage = combat?.getFlag?.(game.system.id, 'ammoUsage');
	if (!usage || !Object.keys(usage).length) return;
	const byActor = {};
	for (const entry of Object.values(usage)) {
		if (!entry?.actorId) continue;
		(byActor[entry.actorId] ??= []).push(entry);
	}
	for (const [actorId, entries] of Object.entries(byActor)) {
		const actor = game.actors.get(actorId);
		const lines = entries
			.map(
				(e) =>
					`<div class="ammo-recovery-line">${F('AMMO.RECOVERY_LINE', {
						name: foundry.utils.escape(e.name ?? ''),
						fired: e.fired ?? 0,
						threshold: e.threshold ?? AMMO_THRESHOLDS.standard,
					})}</div>`
			)
			.join('');
		const content = `<div class="symbaroum ammo-recovery-card">
  <div class="ammo-recovery-header">${L('AMMO.RECOVERY_CARD')}</div>
  ${lines}
  <button class="ammo-recovery-btn" type="button">${L('AMMO.RECOVERY_BUTTON')}</button>
</div>`;
		ChatMessage.create({
			speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: actorId },
			content,
			flags: { [game.system.id]: { ammoRecovery: { actorId, entries, done: false } } },
		});
	}
}

/**
 * Bergung ausfuehren (Button-Klick): 1W20 je verschossenem Stueck,
 * GEBORGEN bei Wurf <= Schwelle (beschaedigt bei Wurf > Schwelle, GRW),
 * Gutschrift auf den Stapel, Ergebniskarte, Wiederholungs-Schutz per
 * done-Flag. Nur Eigentuemer oder GM (Runde-2-Entscheidung).
 */
export async function performAmmoRecovery(message) {
	const data = message.getFlag(game.system.id, 'ammoRecovery');
	if (!data) return;
	if (data.done) {
		ui.notifications.warn(L('AMMO.RECOVERY_ALREADY'));
		return;
	}
	const actor = game.actors.get(data.actorId);
	if (!(game.user.isGM || actor?.isOwner)) {
		ui.notifications.warn(L('AMMO.RECOVERY_NO_RIGHT'));
		return;
	}
	const entries = data.entries ?? [];
	const totalFired = entries.reduce((sum, e) => sum + (Number(e.fired) || 0), 0);
	if (totalFired <= 0) {
		await message.setFlag(game.system.id, 'ammoRecovery', { ...data, done: true });
		return;
	}
	// Hintergrundwuerfe: ein Wurfpool, je Eintrag sein Anteil
	const roll = new Roll(`${totalFired}d20`);
	await roll.evaluate();
	let idx = 0;
	const resultLines = [];
	let recoveredTotal = 0;
	for (const entry of entries) {
		const n = Math.max(0, Math.round(Number(entry.fired) || 0));
		const threshold = Number(entry.threshold) || AMMO_THRESHOLDS.standard;
		const results = roll.dice[0]?.results?.slice(idx, idx + n).map((r) => r.result) ?? [];
		idx += n;
		const recovered = results.filter((r) => r <= threshold).length;
		const lost = n - recovered;
		recoveredTotal += recovered;
		const item = actor?.items.get(entry.itemId);
		if (!item) {
			resultLines.push(
				`<div class="ammo-recovery-line">${F('AMMO.RECOVERY_NO_STACK', {
					name: foundry.utils.escape(entry.name ?? ''),
				})}</div>`
			);
			continue;
		}
		if (recovered > 0) {
			await item.update({ 'system.number': getItemCount(item) + recovered });
		}
		resultLines.push(
			`<div class="ammo-recovery-line">${F('AMMO.RECOVERY_RESULT_LINE', {
				name: foundry.utils.escape(entry.name ?? ''),
				recovered,
				lost,
				fired: n,
			})}</div>`
		);
	}
	const resultContent = `<div class="symbaroum ammo-recovery-card ammo-recovery-result">
  <div class="ammo-recovery-header">${L('AMMO.RECOVERY_RESULT_TITLE')}</div>
  ${resultLines.join('')}
</div>`;
	await ChatMessage.create({
		speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: data.actorId },
		content: resultContent,
	});
	await message.setFlag(game.system.id, 'ammoRecovery', { ...data, done: true });
	ui.notifications.info(F('AMMO.RECOVERY_DONE_MSG', { recovered: recoveredTotal, fired: totalFired }));
}
