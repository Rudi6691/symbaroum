/* =====================================================================
 * AoE Stufe 1 (Rudolfs Startsignal „Leg los“ 09.11.2026)
 * ---------------------------------------------------------------------
 * Flächeneffekte, Stufe 1 des beschlossenen Stufenplans (AOE-Analyserunde
 * v5, alle Konzept-Entscheidungen getroffen): Template-Platzierung aus
 * dem Kraft-Item + Auto-Targeting der Token in der Fläche.
 *
 * Architektur (Foundry V14, code-verifiziert gegen die offiziellen
 * foundry-vtt-types und das dnd5e-V14-Platzierungsmuster):
 * - Die klassische TemplateLayer ist seit V14 DEPRECATED; Template-
 *   Platzierung läuft nativ über canvas.regions.placeRegions() (inter-
 *   aktive Vorschau, Mausrad-Rotation, Grid-Snap - kompletter Core-
 *   Workflow, kein eigener Preview-Selbstbau).
 * - Das Core-Flag flags.core.MeasuredTemplate = true lässt die Region
 *   wie eine klassische gemessene Vorlage rendern (Umriss + Grid-
 *   Highlight); dnd5e V14 nutzt exakt dieses Muster.
 * - Stufe 1 rechnet REIN IN FELDERN (Rudolfs Festlegung): 1 Feld = 2
 *   Meter Kampfskala, UNABHÄNGIG von der Szenenkalibrierung - die
 *   Region-Geometrie wird direkt in Feldern × Szenen-Gridgröße in
 *   Pixeln aufgebaut, KEINE Metrik-Umrechnung, kein Szenen-Flag.
 * - Auto-Targeting: RegionDocument.tokens (Core-Geometrie, Gettermenge
 *   der V14-Typings) liefert die Token in der Fläche; Fallback über
 *   region.testPoint (Token-Mittelpunkt), falls die Menge nach der
 *   Erstellung noch leer sein sollte. Zielfilter: Dispositions-Vergleich
 *   gegen den Wirker-Token (system.areaZone.targeting).
 * - Laufzeit-Instanz: die Region trägt flags.symbaroum.aoe (Quell-Item-
 *   UUID, Quell-Aktor-UUID, Konfig-Snapshot, Stufen-Marker) - das ist
 *   der bewusst beschlossene Key-Speicher für Stufe 2 (Betreten-Trigger
 *   auf derselben Region) und Stufe 3 (mobile Auren).
 * - Setting-Gate: Welt-Setting „Flächeneffekte (AoE)“ (Muster
 *   travelEnabled) schaltet Settings-Eintrag, Zone-Tab-Interaktionen und
 *   die Platzierung frei.
 *
 * NICHT in Stufe 1 (bewusst, Stufenplan): Betreten-Trigger mit Probe-
 * Automatik und geflüsterten Aufforderungskarten (Stufe 2), mobile
 * Auren/Regions-Sync (Stufe 3), Waffenqualitäts-Flächen, metrischer
 * Modus für 1,5-m-Battlemaps, Runden-Takt.
 * =================================================================== */

/* Welt-Setting (Registrierung im init-Hook, hooks.js - direkt unter den
 * Reise-Settings, gleiche Foundry-Einstellungsliste wie travelEnabled
 * & Co, Rudolfs symbaroumConfig-GM-Seite = config:true + restricted:true).
 * Default AN (Rudolfs Allgemein-Anforderung war „abschaltbar“, nicht
 * „opt-in“); ein Ausschalten blendet den Zone-Tab-Inhalt still und
 * blockiert die Platzierung. */
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
}

/** Setting-Gate für alle AoE-Interaktionen (Blatt-Button + Platzierung). */
export function aoeEnabled() {
	return !!game.settings.get('symbaroum', 'aoeZonesEnabled');
}

/* ---------------------------------------------------------------------
 * Zonen-Konfiguration (system.areaZone, additives template.json-Feld)
 *
 * Stufe-1-Felder: shape ('' = keine Fläche; circle/cone/line/rectangle),
 * size (Felder: Radius bei Kreis/Kegel, Länge bei Linie, Seitenlänge bei
 * Rechteck), targeting (all/enemies/allies). Die Stufe-2/3-Felder
 * trigger/action/duration sind im Datenmodell bereits angelegt, werden
 * hier aber noch nicht ausgewertet. Keine Voreinstellungs-Automatik
 * (Traditionen-Präzedenz: Erstbefüllung per Handarbeit) - der Zone-Tab
 * dokumentiert die RAW-Empfehlung der fünf Start-Kräfte als Hinweis.
 * ------------------------------------------------------------------- */
export function getZoneConfig(item) {
	const zone = item?.system?.areaZone ?? {};
	const shape = String(zone.shape ?? '').trim();
	if (!shape) return null;
	const rawSize = Math.round(Number(zone.size));
	const size = Number.isFinite(rawSize) && rawSize >= 1 ? rawSize : 1;
	const rawTargeting = String(zone.targeting ?? '').trim();
	const targeting = ['enemies', 'allies'].includes(rawTargeting) ? rawTargeting : 'all';
	return { shape, size, targeting };
}

/**
 * Region-Shape-Daten der Konfiguration (Felder × Szenen-Gridgröße in
 * Pixeln - dadurch N Felder auf JEDEM Grid, unabhängig von der
 * Kalibrierung der Szene; Rudolfs Festlegung „rein in Feldern“).
 * Basisdaten x/y/rotation übernimmt der Core-Platzierungsworkflow.
 * Kegel-Winkel 90 Grad als Hausregel-Default (RAW definiert keinen).
 * @param {object} cfg      Zonen-Konfiguration {shape, size}
 * @param {number} gridSize Szenen-Gridgröße in Pixeln (canvas.scene.grid.size)
 * @returns {object|null} Shape-Daten der Region oder null bei unbekannter Form
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

/**
 * Wirker-Token des Items auflösen (für den Dispositions-Vergleich des
 * Zielfilters): bevorzugt der aktuell kontrollierte Token des Aktors,
 * sonst sein erster aktiver Token; kompendiums-/weltseitige Items ohne
 * Aktor haben keinen Wirker (dann gilt die freundliche SL-Perspektive).
 * @param {Item} item
 * @returns {Token|null}
 */
function _resolveCasterToken(item) {
	const actor = item?.actor ?? null;
	if (!actor) return null;
	const active = actor.getActiveTokens?.() ?? [];
	if (!Array.isArray(active) || active.length === 0) return null;
	return active.find((t) => t?.controlled) ?? active[0] ?? null;
}

/**
 * Token der Region sammeln - primär über die Core-Geometrie
 * (RegionDocument.tokens, per V14-Typings „The tokens inside this
 * region“, wird bei Dokument-Updates gepflegt), Fallback über
 * region.testPoint am Token-Mittelpunkt, falls die Menge direkt nach
 * der Erstellung noch leer sein sollte (Defensiv-Pfad, kein Raten über
 * Rendering-Timing). Versteckte Token bleiben außen vor (Zielvorschlag
 * darf Verstecktes nicht verraten).
 * @param {RegionDocument} region
 * @returns {TokenDocument[]}
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
				// Defensiv: testPoint-Signatur-Schwankungen brechen das Targeting nicht
				console.warn('Symbaroum AoE: region.testPoint fallback failed', error);
			}
		}
	}
	return tokens.filter((td) => !!td?.actor && !td?.hidden);
}

/**
 * Zielfilter (system.areaZone.targeting): Dispositions-Vergleich gegen
 * den Wirker-Token - kleiner dessen Disposition = Feindseite, größer-
 * gleich = Verbündetenseite; ohne Wirker-Token gilt FRIENDLY als
 * SL-Standardperspektive. 'all' lässt den Filter weg.
 * @param {TokenDocument[]} tokens
 * @param {object} cfg        Zonen-Konfiguration {targeting}
 * @param {Token|null} casterToken
 * @returns {TokenDocument[]}
 */
function _filterTargets(tokens, cfg, casterToken) {
	if (cfg.targeting === 'all') return tokens;
	const casterDisposition = casterToken?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY;
	if (cfg.targeting === 'enemies') {
		return tokens.filter((td) => (td.disposition ?? 0) < casterDisposition);
	}
	return tokens.filter((td) => (td.disposition ?? 0) >= casterDisposition);
}

/** Minimal-HTML-Escaping für Namen in der Flüsterkarte. */
function _escapeHtml(text) {
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Flüsterkarte des Auto-Targeting an die platzierende Nutzerin/den
 * platzierenden Nutzer (Muster S4.2-Anfragekarten: Rückmeldung ohne
 * Raum-Chat-Veranstaltung): Kraftname, Fläche in Feldern + informativ
 * in Metern (1 Feld = 2 m Kampfskala), erfasste Token bzw. Leer-Hinweis.
 * @param {Item} item   Quell-Item
 * @param {object} cfg  effektive Zonen-Konfiguration
 * @param {string[]} targetNames Namen der erfassten Token
 */
async function _postZoneCard(item, cfg, targetNames) {
	const localize = (key) => game.i18n.localize(key);
	const shapeLabelKey = {
		circle: 'AOE.SHAPE_CIRCLE',
		cone: 'AOE.SHAPE_CONE',
		line: 'AOE.SHAPE_LINE',
		rectangle: 'AOE.SHAPE_RECT',
	}[cfg.shape];
	const areaText = game.i18n.format('AOE.CHAT_AREA', {
		shape: localize(shapeLabelKey),
		size: cfg.size,
		meters: cfg.size * 2,
	});
	const targetsText =
		targetNames.length > 0
			? game.i18n.format('AOE.CHAT_TARGETS', { targets: targetNames.map(_escapeHtml).join(', ') })
			: localize('AOE.CHAT_NO_TARGETS');
	const content = `
<div class="symbaroum aoe-card">
	<div class="aoe-card-line"><i class="fas fa-draw-polygon"></i><b>${_escapeHtml(item.name)}</b></div>
	<div class="aoe-card-detail">${areaText}</div>
	<div class="aoe-card-detail">${targetsText}</div>
	${targetNames.length > 0 ? `<div class="aoe-card-detail">${localize('AOE.CHAT_TARGETED')}</div>` : ''}
</div>`;
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ alias: localize('DIALOG.SYSTEM_MESSAGE') }),
		whisper: [game.user.id],
		content,
	});
}

/**
 * Auto-Targeting EINER platzierten Region: Token der Fläche sammeln,
 * Zielfilter anwenden und als Ziele des platzierenden Nutzers markieren
 * (Token#setTarget der Core-Placeable, verifizierte V14-API; die erste
 * Markierung löst bestehende Ziele, weitere ergänzen - die Fläche ist
 * der neue Zielvorschlag). Danach die Flüsterkarte.
 * @param {RegionDocument} region
 * @param {object} cfg        effektive Zonen-Konfiguration
 * @param {Token|null} casterToken
 * @param {Item} item         Quell-Item (Karten-Text)
 */
async function _autoTargetRegion(region, cfg, casterToken, item) {
	const tokens = _filterTargets(_collectRegionTokens(region), cfg, casterToken);
	if (tokens.length > 0) {
		let first = true;
		for (const tokenDoc of tokens) {
			tokenDoc.object?.setTarget(true, { releaseOthers: first });
			first = false;
		}
	}
	await _postZoneCard(item, cfg, tokens.map((td) => td.actor?.name ?? td.name ?? ''));
}

/**
 * Zone aus dem Kraft-Item platzieren (Action placeZone des GM-only
 * Zone-Tabs, klassisch + modern). Interaktiver Core-Workflow
 * (Vorschau folgt der Maus, Klick platziert, Mausrad rotiert Linie/
 * Kegel, ESC/Rechtsklick bricht ab - placeRegions liefert dann null bzw.
 * eine leere Liste). Die erzeugte Region trägt das Core-Template-Flag
 * (Optik der klassischen gemessenen Vorlage) und flags.symbaroum.aoe
 * mit Konfig-Snapshot als Stufe-2/3-Anschlussstelle.
 * @param {Item} item
 */
export async function placeZoneFromItem(item) {
	if (!item) return;
	if (!game.user.isGM) return;
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
	const gridSize = Math.max(1, Math.round(canvas.scene.grid?.size ?? 0)) || 100;
	const shape = _buildShapeData(cfg, gridSize);
	if (!shape) {
		ui.notifications.warn(game.i18n.localize('AOE.ERR_NO_CONFIG'));
		return;
	}
	const casterToken = _resolveCasterToken(item);
	const actor = item.actor ?? null;
	// Region-Daten (Muster dnd5e-V14-TemplatePlacement): Template-Flag,
	// Messungsanzeige + Grid-Coverage-Highlight, Farbe der Nutzerin/des
	// Nutzers, aktueller Level (nur wenn die Szene einen hat - sonst
	// greift der Schema-Default, KEIN Ratespiel mit null).
	const regionData = {
		name: game.i18n.format('AOE.REGION_NAME', { name: item.name, user: game.user.name }),
		color: game.user.color,
		displayMeasurements: true,
		highlightMode: 'coverage',
		shapes: [shape],
		visibility: CONST.REGION_VISIBILITY.ALWAYS,
		'flags.core.MeasuredTemplate': true,
		flags: {
			symbaroum: {
				aoe: {
					level: 1,
					sourceItemUuid: item.uuid,
					sourceActorUuid: actor?.uuid ?? null,
					casterTokenUuid: casterToken?.document?.uuid ?? null,
					config: { shape: cfg.shape, size: cfg.size, targeting: cfg.targeting },
					metersPerField: 2,
				},
			},
		},
	};
	if (canvas.level) regionData.levels = [canvas.level.id];
	let regions = null;
	try {
		regions = await canvas.regions.placeRegions([regionData]);
	} catch (error) {
		console.error('Symbaroum AoE: placeRegions failed', error);
		ui.notifications.error(game.i18n.format('AOE.ERR_PLACEMENT', { message: error?.message ?? String(error) }));
		return;
	}
	if (!regions?.length) return; // Abbruch (ESC/Rechtsklick): kein Lärm, keine Karte
	for (const region of regions) {
		await _autoTargetRegion(region, cfg, casterToken, item);
	}
}
