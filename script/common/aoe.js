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
 * Architektur (Foundry V14, code-verifiziert):
 * - Regionen mit flags.core.MeasuredTemplate (Optik der klassischen
 *   Vorlage), Platzierung über canvas.regions.placeRegions().
 * - Script-Behaviors laufen auf ALLEN Clients (offizielle Doku) - die
 *   Zone trägt den Single-GM-Guard direkt im Behavior-Quelltext und
 *   ruft die System-API nur auf dem aktiven GM auf.
 * - Kraft-Zonen lösen die BESTEHENDE Ketten-Automatik aus
 *   (executeZonePower in item.js: Regionstoken als Nutzerziele,
 *   buildRolls; die Ketten iterieren game.user.targets). Daraus folgt:
 *   Auslösungen würfeln wie Ketten-Follow-ups (auto), Korruption wird
 *   bei dauerhaften Zonen unterdrückt (Rudolfs Zu-3-Antwort: Auslösung
 *   würfelt nur die Zielproben - das Wirken samt Korruption gehört zur
 *   Platzierung/dem normalen Kraftwirken).
 * - Freie Zonen (kein Quell-Item): NSC würfeln automatisch, SC erhalten
 *   eine geflüsterte Anfragekarte (Muster S4.2 travel-probe-request)
 *   mit Würfel-Taste; der Wurf + die Wirkung laufen auf dem Client des
 *   besitzenden Spielers (Eigentum am eigenen Aktor, kein GM-Roundtrip).
 * - Runden-Dispatcher: EIN Takt - laufender Combat = Combat-Runde,
 *   sonst 900-Sekunden-Weltzeit (Muster Korruptions-Abbau S4), keine
 *   zweite Uhr. Nur die aktive Szene tickt.
 * =================================================================== */

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
	return { shape, size, targeting, mode, trigger, duration };
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
 * Zielfilter (targeting): Dispositions-Vergleich gegen den Wirker-Token
 * (bei freien Zonen gegen den zuerst gefundenen Token der Szene, im
 * Zweifel FRIENDLY als SL-Standardperspektive). 'all' lässt den Filter weg.
 */
function _filterTargets(tokens, targeting, casterToken) {
	if (targeting === 'all') return tokens;
	const casterDisposition = casterToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY;
	if (targeting === 'enemies') {
		return tokens.filter((td) => (td.disposition ?? 0) < casterDisposition);
	}
	return tokens.filter((td) => (td.disposition ?? 0) >= casterDisposition);
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
 * System-API aus. token/event werden defensiv gelesen (Script- und
 * Makro-Behavior liefern dieselben Daten, Stand Doku V12-V14). */
const ZONE_ENTER_BEHAVIOR_SOURCE = [
	'if (!game.users.activeGM?.isSelf) return;',
	'const r = (typeof region !== "undefined") ? region : null;',
	'const ev = (typeof event !== "undefined") ? event : null;',
	'const t = (typeof token !== "undefined" && token) || ev?.token || null;',
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
	// Betreten-Trigger (dauerhafte Zonen): Script-Behavior mit TOKEN_ENTER
	if (!zone.free && zone.mode === 'lasting' && zone.trigger === 'enter') {
		regionData.behaviors = [
			{
				type: 'script',
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
	const durationText =
		aoe.remaining === null || aoe.remaining === 0
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
		if (eff.condition) parts.push(game.i18n.format('AOE.EFFECT_CONDITION', { condition: eff.condition }));
		effectText = parts.join(' · ');
	}
	return {
		regionId: region.id,
		sceneId: region.parent?.id,
		name: _escapeHtml(aoe.regionName),
		modeText: localize(aoe.mode === 'instant' ? 'AOE.MODE_INSTANT' : 'AOE.MODE_LASTING'),
		areaText,
		durationText,
		tokensText,
		effectText,
		showRound: !!(aoe.free && aoe.effect && (aoe.effect.damagePerRound || aoe.effect.corruptionPerRound)),
	};
}

/** Wirker-Token-Dokument einer Zone aus den Flags auflösen. */
function _casterTokenOfZone(aoe) {
	const uuid = aoe?.casterTokenUuid;
	if (!uuid) return null;
	return fromUuidSync(uuid) ?? null;
}

/** Zonen-Karte anlegen (dauerhafte Zonen; Muster: ChatMessage mit Flag). */
async function _postZoneCard(region) {
	const context = await _zoneCardContext(region);
	const content = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/aoe-zone-card.hbs', context);
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize('DIALOG.SYSTEM_MESSAGE') }),
		content,
		flags: { symbaroum: { aoeZoneCard: { regionId: region.id, sceneId: region.parent?.id } } },
	});
}

/** Alle offenen Zonen-Karten der Region aktualisieren (Inhalt neu rendern). */
async function _updateZoneCards(region) {
	const context = await _zoneCardContext(region);
	const content = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/aoe-zone-card.hbs', context);
	const sceneId = region.parent?.id;
	for (const message of game.messages ?? []) {
		const card = message.flags?.symbaroum?.aoeZoneCard;
		if (card?.regionId === region.id && (card.sceneId === sceneId || !card.sceneId)) {
			await message.update({ content });
		}
	}
}

/** Zonen-Karten nach dem Ende der Zone still deaktivieren. */
async function _settleZoneCards(region, endText) {
	const sceneId = region.parent?.id;
	for (const message of game.messages ?? []) {
		const card = message.flags?.symbaroum?.aoeZoneCard;
		if (card?.regionId === region.id && (card.sceneId === sceneId || !card.sceneId)) {
			await message.update({ content: `<div class="symbaroum aoe-card"><div class="aoe-card-line"><i class="fas fa-draw-polygon"></i><b>${_escapeHtml(region.name)}</b></div><div class="aoe-card-detail">${_escapeHtml(endText)}</div></div>` });
		}
	}
}

/* =====================================================================
 * Auslösung: Kraft-Zone (Ketten-Recycling) und freie Zone (Proben)
 * =================================================================== */

/**
 * Zonen-Auslösung ausführen (GM-seitig; automatisch via Script-Behavior
 * oder manuell über die Auslöse-Taste der Zonen-Karte).
 * @param {RegionDocument} region
 * @param {object} [options] { manual: boolean }
 */
async function _executeZoneTrigger(region, { manual = false } = {}) {
	const aoe = region.flags?.symbaroum?.aoe;
	if (!aoe) return;
	const casterToken = _casterTokenOfZone(aoe);
	const tokens = _filterTargets(_collectRegionTokens(region), aoe.config.targeting, casterToken);
	if (tokens.length === 0) {
		if (manual) {
			ui.notifications.info(game.i18n.localize('AOE.ERR_NO_TOKENS'));
		}
		return;
	}
	if (aoe.free) {
		await _runFreeZone(region, tokens);
	} else {
		await _runPowerZone(region, tokens);
	}
}

/** Kraft-Zone: bestehende Ketten-Automatik über executeZonePower (item.js). */
async function _runPowerZone(region, tokens) {
	const aoe = region.flags.symbaroum.aoe;
	const { executeZonePower } = await import('./item.js');
	const item = aoe.sourceItemUuid ? (await fromUuid(aoe.sourceItemUuid)) : null;
	const actor = aoe.sourceActorUuid ? (await fromUuid(aoe.sourceActorUuid)) : null;
	if (!item || !actor) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_SOURCE_GONE'));
		return;
	}
	// Dauerhafte Zonen: Auslösung ohne erneute Korruptionsbuchung (Wirken
	// samt Korruption gehört zur Platzierung/dem normalen Kraftwirken);
	// augenblickliche Zonen wirken als vollständiger Zauberwurf.
	await executeZonePower(actor, item, tokens, { suppressCorruption: aoe.mode !== 'instant' });
}

/**
 * Freie Zone: Wirkung je Token - ohne Probe direkt, mit Widerstands-
 * Attribut: NSC automatisch (d20 gegen Attribut, 1/Patzer misslingt,
 * 20 gelingt immer), SC mit Besitzer über geflüsterte Anfragekarte
 * (Muster S4.2; der Spieler würfelt selbst und die Wirkung läuft auf
 * seinem Client am eigenen Aktor - Rudolfs v5-Entscheidung 1).
 */
async function _runFreeZone(region, tokens) {
	const aoe = region.flags.symbaroum.aoe;
	const eff = aoe.effect ?? {};
	const resistOn = !!eff.resistAttribute;
	for (const tokenDoc of tokens) {
		const actor = tokenDoc.actor;
		if (!actor) continue;
		if (!resistOn) {
			await _applyFreeZoneEffect(tokenDoc, eff, null);
			continue;
		}
		const owner = _ownerUser(actor);
		if (owner && game.settings.get('symbaroum', 'playerResistButton')) {
			await _freeZoneRequestCard(region, tokenDoc, owner, eff);
		} else {
			const probe = await _probeAuto(actor, eff.resistAttribute);
			if (probe.success) {
				await _postFreeZoneResult(region, tokenDoc, eff, { resisted: true });
			} else {
				await _applyFreeZoneEffect(tokenDoc, eff, probe);
			}
		}
	}
}

/** Automatische Attribut-Probe (Symbaroum: d20 <= Attribut, 1 misslingt, 20 gelingt). */
async function _probeAuto(actor, attributeName) {
	const total = Number(actor.system?.attributes?.[attributeName]?.total ?? 10);
	const roll = await new Roll('1d20').evaluate();
	const result = roll.total;
	let success;
	if (result === 20) success = true;
	else if (result === 1) success = false;
	else success = result <= total;
	return { success, result, total };
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
async function _applyFreeZoneEffect(tokenDoc, eff, probe) {
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
			applied.push(game.i18n.format('AOE.EFFECT_CONDITION', { condition: eff.condition }));
		} catch (error) {
			console.warn('Symbaroum AoE: condition failed', error);
		}
	}
	if (applied.length === 0) applied.push(game.i18n.localize('AOE.EFFECT_NONE'));
	await _postFreeZoneResult(null, tokenDoc, eff, { resisted: false, applied: applied.join(' · '), probe });
}

/** Ergebnis-Karte einer freien Zonen-Wirkung (Flüster an die Ausführenden). */
async function _postFreeZoneResult(region, tokenDoc, eff, { resisted, applied, probe }) {
	const name = tokenDoc.actor?.name ?? tokenDoc.name ?? '';
	const attrKey = eff?.resistAttribute ? `ATTRIBUTE.${eff.resistAttribute.toUpperCase()}` : '';
	const attrLabel = attrKey ? game.i18n.localize(attrKey) : '';
	const lines = [];
	if (resisted) {
		lines.push(game.i18n.format('AOE.CHAT_RESISTED', { name: _escapeHtml(name), attr: attrLabel }));
	} else {
		if (probe) lines.push(game.i18n.format('AOE.CHAT_PROBE_FAILED', { name: _escapeHtml(name), attr: attrLabel, roll: probe.result, target: probe.total }));
		lines.push(game.i18n.format('AOE.CHAT_APPLIED', { name: _escapeHtml(name), effects: applied }));
	}
	const content = `<div class="symbaroum aoe-card"><div class="aoe-card-line"><i class="fas fa-draw-polygon"></i><b>${_escapeHtml(
		region?.name ?? game.i18n.localize('AOE.FREE_TITLE'),
	)}</b></div>${lines.map((l) => `<div class="aoe-card-detail">${l}</div>`).join('')}</div>`;
	const recipients = [game.user.id];
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize('DIALOG.SYSTEM_MESSAGE') }),
		whisper: recipients,
		content,
	});
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
					const probe = await _probeAuto(actor, eff.resistAttribute);
					if (probe.success) continue;
				}
				await _applyFreeZoneEffect(tokenDoc, { damage: eff.damagePerRound ?? '', corruption: eff.corruptionPerRound ?? '', condition: '' }, null);
			}
		}
	}
	// Restdauer: null/0 = unbegrenzt (läuft bis zur Enden-Taste)
	if (aoe.remaining === null || aoe.remaining === 0) return;
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

/** Script-Behavior-Einstieg (TOKEN_ENTER, Single-GM): automatische Auslösung. */
export async function aoeZoneEnter(regionId, tokenId) {
	if (!game.user?.isGM || !aoeEnabled()) return;
	const region = _getZoneRegion(regionId);
	if (!region) return;
	// nur Zonen mit Betreten-Trigger lösen automatisch aus
	if (region.flags.symbaroum.aoe.trigger !== 'enter' || region.flags.symbaroum.aoe.mode === 'instant') return;
	const tokenDoc = region.parent?.tokens?.get(tokenId) ?? null;
	if (!tokenDoc?.actor || tokenDoc.hidden) return;
	// Zielgruppen-Check vor dem Auslösen (Dispositions-Filter gegen Wirker)
	const aoe = region.flags.symbaroum.aoe;
	const filtered = _filterTargets([tokenDoc], aoe.config.targeting, _casterTokenOfZone(aoe));
	if (filtered.length === 0) return;
	await _executeZoneTrigger(region, { manual: false });
}

/** Auslöse-Taste der Zonen-Karte (manuelle Auslösung). */
export async function aoeTriggerZone(regionId, sceneId) {
	if (!game.user?.isGM || !aoeEnabled()) return;
	const region = _getZoneRegion(regionId, sceneId);
	if (!region) return;
	await _executeZoneTrigger(region, { manual: true });
	await _updateZoneCards(region);
}

/** „Runde abschließen"-Taste (manueller Runden-Tick dieser Zone). */
export async function aoeZoneRound(regionId, sceneId) {
	if (!game.user?.isGM || !aoeEnabled()) return;
	const region = _getZoneRegion(regionId, sceneId);
	if (!region) return;
	await _tickZone(region, 'manual');
}

/** Zone beenden (Enden-Taste): Region löschen, Karten stilllegen. */
export async function aoeEndZone(regionId, sceneId) {
	if (!game.user?.isGM || !aoeEnabled()) return;
	const region = _getZoneRegion(regionId, sceneId);
	if (!region) return;
	await _endZone(region, 'manual');
}

async function _endZone(region, source) {
	await _settleZoneCards(region, game.i18n.localize('AOE.END_MESSAGE'));
	await region.delete();
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
		remaining: cfg.mode === 'instant' ? 0 : cfg.duration > 0 ? cfg.duration : 0,
		sourceItemUuid: item.uuid,
		sourceActorUuid: actor?.uuid ?? null,
		casterTokenUuid: casterToken?.document?.uuid ?? null,
		config: { shape: cfg.shape, size: cfg.size, targeting: cfg.targeting },
		metersPerField: 2,
		regionName: game.i18n.format('AOE.REGION_NAME', { name: item.name, user: game.user.name }),
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
		if (cfg.mode === 'instant') {
			// Schlingranken-Muster: Wirkung sofort, Region danach weg
			await _executeZoneTrigger(region, { manual: false });
			await region.delete();
		} else {
			await _autoTargetRegion(region, cfg, casterToken);
			await _postZoneCard(region);
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
 * Freie Zone platzieren (GM-Makro, 2a): Konfigurationsdialog in
 * Elixiere-Pflegeform (Widerstands-Attribut-Dropdown, Schaden-Formel,
 * Korruption-Formel, Condition-Dropdown - leer = keine Wirkung), dann
 * interaktive Platzierung. Ursprungsanwendungsfall: Rudolfs
 * Korruptionszone mit Willenskraftprobe.
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
	const shapeOptions = Object.values(game.symbaroum.config.AOE_SHAPE_SELECTION)
		.map((c) => `<option value="${c.id}">${localize(c.label)}</option>`)
		.join('');
	const targetingOptions = Object.values(game.symbaroum.config.AOE_TARGETING_SELECTION)
		.map((c) => `<option value="${c.id}">${localize(c.label)}</option>`)
		.join('');
	const attrOptions =
		`<option value="">${localize('AOE.RESIST_NONE')}</option>` +
		game.symbaroum.config.attributes.map((a) => `<option value="${a}">${localize(`ATTRIBUTE.${a.toUpperCase()}`)}</option>`).join('');
	const conditionOptions =
		`<option value="">${localize('AOE.CONDITION_NONE')}</option>` +
		CONFIG.statusEffects.filter((e) => e.id).map((e) => `<option value="${e.id}">${e.name ?? e.id}</option>`).join('');
	const content = `<p>${localize('AOE.FREE_HINT')}</p>
<div class="form-group"><label>${localize('AOE.FREE_NAME')}</label><input type="text" id="aoe-free-name" value="${localize('AOE.FREE_DEFAULT_NAME')}"></div>
<div class="form-group"><label>${localize('AOE.FIELD_SHAPE')}</label><select id="aoe-free-shape">${shapeOptions}</select></div>
<div class="form-group"><label>${localize('AOE.FIELD_SIZE')}</label><input type="number" id="aoe-free-size" min="1" value="3"></div>
<div class="form-group"><label>${localize('AOE.FIELD_TARGETING')}</label><select id="aoe-free-targeting">${targetingOptions}</select></div>
<div class="form-group"><label>${localize('AOE.FIELD_RESIST')}</label><select id="aoe-free-resist">${attrOptions}</select></div>
<div class="form-group"><label>${localize('AOE.FIELD_DAMAGE')}</label><input type="text" id="aoe-free-damage" placeholder="1d6"></div>
<div class="form-group"><label>${localize('AOE.FIELD_DAMAGE_ROUND')}</label><input type="text" id="aoe-free-dpr" placeholder="1d4"></div>
<div class="form-group"><label>${localize('AOE.FIELD_CORRUPTION')}</label><input type="text" id="aoe-free-corruption" placeholder="1d4"></div>
<div class="form-group"><label>${localize('AOE.FIELD_CONDITION')}</label><select id="aoe-free-condition">${conditionOptions}</select></div>
<div class="form-group"><label>${localize('AOE.FIELD_DURATION')}</label><input type="number" id="aoe-free-duration" min="0" value="0"></div>`;
	new Dialog({
		title: localize('AOE.FREE_TITLE'),
		content,
		buttons: {
			place: {
				icon: '<i class="fas fa-draw-polygon"></i>',
				label: localize('AOE.PLACE_BUTTON'),
				callback: (html) => _placeFreeZoneFromDialog(html[0]),
			},
		},
		default: 'place',
	}).render(true);
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
	const zone = {
		level: 2,
		free: true,
		mode: 'lasting',
		trigger: '',
		remaining: duration,
		sourceItemUuid: null,
		sourceActorUuid: null,
		casterTokenUuid: null,
		config: { shape, size, targeting: val('aoe-free-targeting') || 'all' },
		effect: {
			resistAttribute: val('aoe-free-resist'),
			damage: val('aoe-free-damage'),
			damagePerRound: val('aoe-free-dpr'),
			corruption: val('aoe-free-corruption'),
			condition: val('aoe-free-condition'),
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
 * Hooks: Chat-Karten-Tasten + Runden-Dispatcher (Registrierung über
 * registerAoeHooks in hooks.js - alle AoE-Listener an einem Ort)
 * =================================================================== */

export function registerAoeHooks() {
	// Zonen-Karte: Tasten nur für GM sichtbar/schaltbar (Inhalt ist in der
	// Nachricht gespeichert - das Verstecken passiert pro Client im Render).
	Hooks.on('renderChatMessageHTML', (message, html) => {
		const card = message.flags?.symbaroum?.aoeZoneCard;
		if (card) {
			if (!game.user.isGM) {
				html.querySelectorAll('[data-aoe-zone-action]').forEach((btn) => btn.remove());
			}
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

	// Combat-Takt: Rundenwechsel der aktiven Kampfleitung = Zonen-Runde
	Hooks.on('updateCombat', (combat, changed) => {
		if (!game.user?.isGM || !aoeEnabled()) return;
		const newRound = Number(changed?.round ?? NaN);
		if (!Number.isFinite(newRound) || newRound <= 0) return;
		const last = _lastCombatRound.get(combat.id) ?? 0;
		_lastCombatRound.set(combat.id, newRound);
		if (combat.scene?.id !== game.scenes.viewed?.id) return;
		if (newRound > last) aoeRoundTick('combat');
	});
	Hooks.on('deleteCombat', (combat) => _lastCombatRound.delete(combat.id));

	// Weltzeit-Takt (ohne laufenden Combat): 900 Sekunden = 1 Zonen-Runde
	Hooks.on('updateWorldTime', (worldTime) => {
		if (!game.user?.isGM || !aoeEnabled()) return;
		if (game.combat?.active) return;
		const last = Number(game.settings.get('symbaroum', 'aoeLastRoundTime')) || 0;
		const now = Number(worldTime) || 0;
		if (now - last < 900) return;
		game.settings.set('symbaroum', 'aoeLastRoundTime', now);
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
		await _applyFreeZoneEffect(tokenDoc, eff, null);
	} else {
		const probe = await _probeAuto(actor, eff.resistAttribute);
		if (probe.success) {
			await _postFreeZoneResult(region, tokenDoc, eff, { resisted: true });
		} else {
			await _applyFreeZoneEffect(tokenDoc, eff, probe);
		}
	}
	button.disabled = true;
	button.parentElement.parentElement.classList.add('aoe-resist-done');
}
