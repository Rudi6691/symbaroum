import { SymbaroumActorSheet } from './actor.js';
import { prepareRollAttribute, prepareRollDeathTest } from '../common/dialog.js';
import { symbDialog } from '../common/symbDialog.js';
// A39 Belastungssystem: Live-Berechnung im Blattkontext (Sicherheitsnetz gegen
// veraltete prepareDerivedData-Daten, z. B. direkt nach Setting-Änderung).
import { getEncumbranceData, formatGE } from '../common/encumbrance.js';
// A6 Blatt-Überarbeitung: alternative (modernisierte) Ansicht - Design-Settings
// (GM-Dialog) und die individuelle Nutzer-Präferenz (User-Flag, welt-weit).
import { closeOpenRollDialogs, getModernSheetEffectiveDesign, getModernSheetUserStyle, renderAllActorSheets } from '../common/modernSheetConfig.js';
// A38 Währungssystem: Anzeige-Aufteilung des Orteg-Basiswerts für die Stammleiste
import { allocateFromBase, getDenominations, getItemPriceBase, formatCurrency } from '../common/currency.js';
// Behältersystem (Projekt "Behälter" v1): Struktur, Summen, Ein-/Auslagern, Geld
import {
	getContainerChildren,
	getContainerTotals,
	moveItemToContainer,
	removeItemFromContainer,
	changeContainerCurrency,
	deleteContainerWithContents,
	deleteContainerKeepContents,
} from '../common/container.js';
// AP2 Stapeln (Merge-on-Drop): Drops auf Behälterzeilen mergen mit einem
// identischen Stapel INNERHALB des Behälters, statt ein zweites Item anzulegen.
import { isStackableItem, mergeStackDrop, splitStackItem } from '../common/stacking.js';

/**
 * Context menu for mystical powers / traits / gear on the actor sheet.
 * Filters the menu entries per item document (visible receives the Item, not the HTML
 * element) and lets the V14 base ContextMenu handle positioning - this replaces the old
 * AppV1-era manual positioning (former TODO "needs fixing"). V14 note: the entry fields
 * are label/visible/onClick (the AppV1 fields name/isVisible/callback are deprecated
 * since v14 until v16 and stopped working in 7.2.1 - the menu never opened).
 */
class CMPowerMenu extends foundry.applications.ux.ContextMenu {
	constructor(container, selector, menuItems, { eventName = 'contextmenu', onOpen, onClose, jQuery = false, parent } = {}) {
		// 7.2.4: fixed: true opens the menu as a popover at the mouse cursor
		// (document.body, popover API) instead of injecting it into the row.
		// The menu then survives sheet re-renders (e.g. a status change while it
		// is open) and cannot be clipped by the row geometry.
		super(container, selector, menuItems, {
			eventName: eventName,
			onOpen: onOpen,
			onClose: onClose,
			jQuery: jQuery,
			fixed: true,
		});
		this.myParent = parent;
		this.originalMenuItems = [...menuItems];
		// 7.2.4: stale-state cleanup. The core toggle swallows a right-click on a
		// row that still carries the .context class while no live menu exists
		// (close-only: no menu, no error). Orphaned .context classes and
		// #context-menu nodes are left behind whenever a menu is destroyed
		// without close() (direct render() calls never set ui.context, so such
		// menus never auto-close). This capture-phase listener runs before the
		// core listener and resets that state; while a real menu is open the
		// normal toggle behaviour (second right-click closes it) is preserved.
		container.addEventListener(
			eventName,
			(ev) => {
				if (!ev.target.closest?.(selector)) return;
				if (ui.context?.element?.isConnected) return;
				document.querySelectorAll('#context-menu').forEach((m) => m.remove());
				document.querySelectorAll('.context').forEach((el) => el.classList.remove('context'));
			},
			true
		);
	}

	render(target, options) {
		let item = null;
		if (target.dataset.itemId == game.symbaroum.config.noArmorID) {
			// special case
			item = game.symbaroum.config.noArmorID;
		} else {
			item = this.myParent?.actor.items.get(target.dataset.itemId);
		}
		// Filter the entries per Item document (visible receives the Item, not
		// the HTML element). The remaining entries are handed to the V14 base
		// render() WITHOUT their visible functions: the base calls visible
		// itself - with the target HTMLElement - and would filter everything
		// out a second time.
		this.menuItems = (item ? this.originalMenuItems.filter((elem) => elem.visible(item)) : this.originalMenuItems).map(
			({ visible, ...entry }) => entry
		);
		return super.render(target, options);
	}
}

export class PlayerSheet extends SymbaroumActorSheet {
	static DEFAULT_OPTIONS = {
		classes: ['symbaroum', 'sheet', 'actor', 'player'],
		position: {
			// 7.2.10 A5-light: default opening width matches the new CSS
			// min-width (844px, Rudolf's measured lower usable bound), so
			// the sheet never renders narrower than its layout.
			width: 844,
			// 7.2.10 test round 4: at 1020 the main tab content is a few
			// pixels taller than the window, so the window scrollbar
			// showed right away. 1036 is Rudolf's measured height where
			// the default window fits without a scrollbar (monster
			// sheets inherit this position).
			height: 1036,
		},
		window: {
			resizable: true,
		},
		actions: {
			deathRoll: async function (event) {
				event.preventDefault();
				await prepareRollDeathTest(this.actor, event.shiftKey);
			},
			recover: async function (event) {
				event.preventDefault();
				await this.actor.update({ 'system.nbrOfFailedDeathRoll': 0 });
			},
			// A6: Umschalten zwischen klassischer und modernisierter Ansicht
			// (Icon-Button im Blattkopf, nur sichtbar, wenn die Alternative in
			// den Welt-Settings aktiviert ist). Schreibt das User-Flag
			// 'modernSheetStyle' - welt-weit gespeichert, browser-unabhängig.
			toggleModern: async function (event) {
				event.preventDefault();
				await this._toggleModernView();
			},
			// A6v5 (Testrunde 4): Umschalten der Farbwelt (dunkel/hell) der
			// modernen Ansicht - individuelles User-Flag 'modernSheetTheme',
			// gewinnt über dem Welt-Default aus den Designeinstellungen.
			toggleModernTheme: async function (event) {
				event.preventDefault();
				await this._toggleModernTheme();
			},
		},
	};

	/** Single content part - the tabs stay part of the template (V13 look, minimal risk). */
	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/sheet/player.hbs',
		},
	};

	/**
	 * A1 (V14): death roll and recover used to be window.controls entries, which
	 * V14 collects in the "⋮" toggle-controls dropdown instead of showing them
	 * inline in the header as V13 did. Frame buttons are rendered inline in the
	 * window header, which restores the V13 look. The click routing keeps using
	 * the existing DEFAULT_OPTIONS.actions handlers (deathRoll/recover). The old
	 * window.controls "visible" functions (owner only) become a conditional push,
	 * following the draw-steel reference implementation.
	 */
	_getFrameButtons(options) {
		const buttons = super._getFrameButtons(options);
		if ( this.actor?.isOwner ) {
			buttons.push(
				{ action: 'deathRoll', icon: 'fas fa-skull', label: 'BUTTON.DEATH' },
				{ action: 'recover', icon: 'fas fa-heart', label: 'BUTTON.RECOVER' }
			);
		}
		// A6: Ansichts-Umschalter für alle Betrachter (Spieler und GM), sobald
		// die modernisierte Ansicht in den Welt-Settings aktiviert ist.
		if ( game.settings.get('symbaroum', 'modernSheetEnabled') ) {
			buttons.push({ action: 'toggleModern', icon: 'fas fa-table-columns', label: 'BUTTON.TOGGLE_MODERN' });
			// A6v5: Farbwelt-Umschalter - nur in der modernen Ansicht sinnvoll
			// (im klassischen Zweig gibt es kein Theming), deshalb nur dann
			// anbieten, wenn der Nutzer die moderne Ansicht tatsächlich sieht.
			if ( getModernSheetUserStyle() === 'modern' ) {
				buttons.push({ action: 'toggleModernTheme', icon: 'fas fa-circle-half-stroke', label: 'BUTTON.TOGGLE_MODERN_THEME' });
			}
		}
		return buttons;
	}

	/**
	 * A6: Individuelle Ansicht (klassisch/modern) des aktuellen Nutzers
	 * umschalten. Gespeichert als User-Flag (welt-weit persistent, pro Nutzer
	 * schreibbar). Testrunde-2-Fund: der Umschalter wirkt auf ALLE offenen
	 * Blätter des Nutzers (Rudolfs Wunsch "alle Blätter in der gewählten
	 * Ansicht"), nicht nur auf dasjenige mit dem geklickten Button.
	 */
	async _toggleModernView() {
		const next = getModernSheetUserStyle() === 'modern' ? 'classic' : 'modern';
		await game.user.setFlag('symbaroum', 'modernSheetStyle', next);
		closeOpenRollDialogs();
		renderAllActorSheets();
	}

	/**
	 * A6v5 (Testrunde 4, Rudolfs Frage "Wo kann ein Spieler zwischen dunklem
	 * und hellem Design umschalten?"): Farbwelt-Umschalter im Blattkopf.
	 * Gespeichert als User-Flag 'modernSheetTheme' - unset bedeutet
	 * Welt-Default; ein Klick wechselt zwischen dunkel und hell und wirkt
	 * (wie der Ansichts-Umschalter) auf alle offenen Blätter des Nutzers.
	 */
	async _toggleModernTheme() {
		const current = getModernSheetEffectiveDesign().theme;
		const next = current === 'dark' ? 'classic' : 'dark';
		await game.user.setFlag('symbaroum', 'modernSheetTheme', next);
		closeOpenRollDialogs();
		renderAllActorSheets();
	}

	/**
	 * A6v3: Scroll-Position über Re-Renders hinweg erhalten. Fund aus
	 * Testrunde 2: Status-/Favoriten-Änderungen am Ende einer langen Liste
	 * ließen den Tab- bzw. Stammleisten-Scroll an den Listenanfang springen.
	 * Gesichert wird vor dem Re-Render und nach `await super.render(...)`
	 * wiederhergestellt (das App-Wurzelelement bleibt über Re-Renders
	 * bestehen, nur die Kinder werden ersetzt).
	 * A6v4 (Testrunde 3): funktionierte in v3 nicht, weil .modern-body
	 * mangels definite Höhe nie selbst scrollte (scrollTop blieb 0, das
	 * Fenster scrollte als Ganzes). Die reparierte Höhenkette
	 * (.modern-sheet-root, css) macht .modern-body/.m-sidebar zu den
	 * eigentlichen Scroll-Containern - dieser Override greift damit.
	 */
	async render(force = false, options = {}) {
		const root = this.element;
		const saved = root
			? {
					body: root.querySelector('.modern-body')?.scrollTop,
					sidebar: root.querySelector('.m-sidebar')?.scrollTop,
				}
			: null;
		await super.render(force, options);
		if (saved && this.element) {
			const body = this.element.querySelector('.modern-body');
			if (body && Number.isFinite(saved.body)) body.scrollTop = saved.body;
			const sidebar = this.element.querySelector('.m-sidebar');
			if (sidebar && Number.isFinite(saved.sidebar)) sidebar.scrollTop = saved.sidebar;
		}
	}

	/**
	 * Prepare the render context. The V13 getData() shape is kept deliberately
	 * (id, actor, system, items, cssClass, editable, symbaroumOptions, attribute_selection)
	 * so that the templates remain unchanged.
	 */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.id = this.actor.id;
		context.actor = foundry.utils.deepClone(this.actor);
		context.system = foundry.utils.deepClone(this.actor.system);
		// A39 FIX Runde 1: Belastungsdaten live berechnen statt auf die beim
		// Weltlauf/Aktor-Update vorbereiteten Daten zu vertrauen. prepareDerivedData
		// läuft nicht bei jedem Render - der Balken fehlte nach dem Aktivieren der
		// optionalen Regel. MonsterSheet erbt diesen Kontext.
		context.system.encumbrance = getEncumbranceData(this.actor);

		let enrichedFields = [
			'system.bio.appearance',
			'system.bio.background',
			'system.bio.personalGoal',
			'system.bio.stigmas',
			'system.bio.tactics',
			'system.notes',
		];
		// 7.2.2: the prose-mirror editors (BIO/Notes) keep the RAW value in
		// their value attribute; the enriched HTML stays in system.bio.* /
		// system.notes as display content. Stash the raw values before
		// _enrichTextFields replaces them in place.
		context.rawBio = {
			appearance: context.system.bio.appearance ?? '',
			background: context.system.bio.background ?? '',
			personalGoal: context.system.bio.personalGoal ?? '',
			stigmas: context.system.bio.stigmas ?? '',
			tactics: context.system.bio.tactics ?? '',
			notes: context.system.notes ?? '',
		};
		await this._enrichTextFields(context, enrichedFields);

		let items = Array.from(this.actor.items.values()).sort((a, b) => {
			if (a.type == b.type) {
				return a.name == b.name ? 0 : a.name < b.name ? -1 : 1;
			} else {
				return game.symbaroum.config.itemSortOrder.indexOf(a.type) - game.symbaroum.config.itemSortOrder.indexOf(b.type);
			}
		});

		context.items = items;
		// Bestienkunde v1.1 (Rudolfs Testrunde 1, Freigabe): Titel-Erweiterung
		// "Bestienkunde [Spezialisierung]" - REIN anzeigeseitig auf dem
		// Aktor-Blatt (klassische Liste, moderne Kacheln, Kampf-Favoriten).
		// Der gespeicherte Item-Name bleibt unveraendert (die Bestienkunde-
		// Logik sucht nach system.reference, nicht nach dem Namen); keine
		// oder leere Kategorie = kein Suffix.
		const beastloreTitleSuffix = {};
		for (const item of items) {
			const cat = item.system?.beastloreCategory;
			if (!cat || item.system?.reference !== 'beastlore') continue;
			const sel = game.symbaroum.config.CREATURE_CATEGORY_SELECTION[cat];
			if (sel) beastloreTitleSuffix[item.id] = ' [' + game.i18n.localize(sel.label) + ']';
		}
		context.beastloreTitleSuffix = beastloreTitleSuffix;
		context.cssClass = this.isEditable ? 'editable' : 'locked';
		context.editable = this.isEditable;
		// A38 Währungssystem: Basiswert (Orteg) für das <symbaroum-currency>-Element.
		// Unmigrierte Akteure (system.currency undefined) bekommen 0 angezeigt;
		// das Element ist bewusst nicht form-assoziiert, damit alleiniges
		// Öffnen/Speichern den Aktor nicht stillschweigend migriert.
		context.currency =
			typeof this.actor.system.currency === 'number' ? Math.max(0, Math.round(this.actor.system.currency)) : 0;

		context.symbaroumOptions = {
			isGM: game.user.isGM,
			isNPC: this.actor.type === 'monster',
			showNpcModifiers: game.settings.get('symbaroum', 'showNpcModifiers'),
		};
		context.attribute_selection = game.symbaroum.config.ATTRIBUTE_SELECTION;
		/* A36Fix: selectOptions does not localize labelAttr values, so the raw
		   config labels ("CREATURE_CATEGORY.NONE"...) leaked into the bio tab
		   dropdown (Rudolf's test round, Befund 2). Build a localized shallow
		   copy instead - the global config object stays untouched (same
		   pattern as alternative_selection.none in weapon.js). Fixes both
		   sheets: MonsterSheet extends PlayerSheet and shares this context. */
		context.creature_category_selection = Object.fromEntries(
			Object.entries(game.symbaroum.config.CREATURE_CATEGORY_SELECTION).map(([id, entry]) => [
				id,
				{ id, label: game.i18n.localize(entry.label) },
			]),
		);

		/* A6 Blatt-Überarbeitung: renderModern schaltet im Wurzel-Template
		   (player.hbs) zwischen klassischem und modernisiertem Zweig um.
		   - Aktivierungs-Checkbox (Welt-Setting, nur GM, Default aus),
		   - individuelle Präferenz des Nutzers (User-Flag, Fallback: Design-Default).
		   A6v4 (Testrunde 3, Rudolfs Wunsch): Auch Spieler schalten um, und
		   die eingestellte Ansicht gilt für ALLE Blätter, auf die sie
		   zugreifen können - der isLimitedView-Ausschluss ist entfallen
		   (Limited-Betrachter sehen ebenfalls die gewählte Ansicht; das
		   moderne Template zeigt Eingabefelder nur bei Rechten).
		   Die modernen Kontextdaten werden nur im modernen Zweig aufgebaut
		   (Kosten nur zahlen, wenn die Ansicht aktiv ist). MonsterSheet erbt. */
		const modernEnabled = !!game.settings.get('symbaroum', 'modernSheetEnabled');
		context.renderModern = !!(modernEnabled && getModernSheetUserStyle() === 'modern');
		if (context.renderModern) {
			/* A6v5 (Testrunde 4): wirksames Design = Welt-Design mit der
			   individuellen Farbwelt des Nutzers (User-Flag 'modernSheetTheme'
			   gewinnt über dem Welt-Default; Umschalten über den Kopf-Button). */
			context.modern = this._prepareModernContext(context, getModernSheetEffectiveDesign());
		}
		/* A6v4 (Testrunde 3): Scroll-Sicherung, zweite Stufe. Der render()-
		   Override sichert bereits vor super.render(); hier wird zusätzlich
           direkt vor dem Ersetzen des DOM gemessen (der alte Inhalt steht
           zu diesem Zeitpunkt noch). Gemeinsam mit der reparierten
           Höhenkette (.modern-sheet-root) bleibt der Tab-Scroll damit auch
           bei Status-/Favoriten-Klicks am Ende langer Listen stehen. */
		if (this.element) {
			this._modernScroll = {
				body: this.element.querySelector('.modern-body')?.scrollTop ?? 0,
				sidebar: this.element.querySelector('.m-sidebar')?.scrollTop ?? 0,
			};
		}
		return context;
	}

	/**
	 * A6: Kontextdaten der modernisierten Ansicht. Alles wird hier in JS
	 * vorberechnet (A39-Lernweis: der Blattkontext ist ein deepClone - Methoden
	 * wie item.getLevel() sind nur an den LIVE-Items aufrufbar; Handlebars
	 * hat keinen generischen and-Helper, deshalb Booleans direkt fertig
	 * berechnen). LIVE-Daten kommen von this.actor.system, gesendete
	 * Anzeigen aus dem bereits angereicherten Kontext-Klon.
	 */
	_prepareModernContext(context, design) {
		const live = this.actor.system;
		const opts = context.symbaroumOptions;
		const isNPC = !!opts.isNPC;
		const showMods = !!opts.showNpcModifiers;
		const localize = (key) => game.i18n.localize(key);

		/* --- Identität: Volk/Beruf bzw. Monster-Kategorie --- */
		const idParts = [];
		if (live.bio?.race) idParts.push(live.bio.race);
		if (live.bio?.occupation) idParts.push(live.bio.occupation);
		const categoryLabel = context.creature_category_selection[live.creatureCategory]?.label ?? '';
		const categoryParts = [categoryLabel, live.creatureSubtype].filter((p) => !!p);

		/* --- Vitalwerte --- */
		const tough = live.health.toughness;
		const toughness = {
			pct: tough.max > 0 ? Math.min(100, Math.round((tough.value / tough.max) * 100)) : 0,
			thresholdPct: tough.max > 0 ? Math.min(100, Math.round(((tough.threshold ?? 0) / tough.max) * 1000) / 10) : 0,
			tooltip: `${localize('HEALTH.TOUGHNESS')}: ${tough.value} / ${tough.max}<br>${localize('HEALTH.TOUGHNESS_THRESHOLD')}: ${tough.threshold}${tough.max_msg ?? ''}`,
		};

		const cor = live.health.corruption;
		const thoroughlyCorrupt = !!live.isThoroughlyCorrupt;
		const corMax = Math.max(0, cor.max ?? 0);
		const tempSum = (cor.temporary ?? 0) + (cor.longterm ?? 0);
		const perm = cor.permanent ?? 0;
		const tempPct = corMax > 0 ? Math.min(100, Math.round((tempSum / corMax) * 1000) / 10) : 0;
		const permPct = corMax > 0 ? Math.min(100 - tempPct, Math.round((perm / corMax) * 1000) / 10) : 0;
		const thresholdPct = corMax > 0 ? Math.min(100, Math.round(((cor.threshold ?? 0) / corMax) * 1000) / 10) : 0;
		const corruption = {
			value: cor.value ?? 0,
			max: corMax,
			threshold: cor.threshold ?? 0,
			thoroughlyCorrupt,
			tempPct,
			permPct,
			thresholdPct,
			tooltip:
				`${localize('HEALTH.CORRUPTION')}: ${thoroughlyCorrupt ? localize('HEALTH.CORRUPTION_NA') : `${cor.value} / ${corMax}`}<br>` +
				`${localize('HEALTH.CORRUPTION_TEMPORARY')}: ${cor.temporary ?? 0} · ${localize('HEALTH.CORRUPTION_LONGTERM')}: ${cor.longterm ?? 0} · ${localize('HEALTH.CORRUPTION_PERMANENT')}: ${perm}<br>` +
				`${localize('HEALTH.CORRUPTION_THRESHOLD')}: ${cor.threshold ?? 0} · ${localize('HEALTH.CORRUPTION_MAX')}: ${corMax}` +
				/* A6v8 (Testrunde 7): Hinweis auf den Korruptions-Dialog,
				   der per Klick auf die Reihe geöffnet wird. */
				(this.isEditable && this.actor.isOwner ? `<br>${localize('MODERN.CORRUPTION_DIALOG_HINT')}` : ''),
		};

		/* --- Erfahrung (wie das klassische Blatt: 4 Felder, Dialog bei Klick) --- */
		const exp = { ...live.experience };
		exp.spent = live.experience.spent ?? 0;
		exp.available = live.experience.available ?? 0;
		exp.tooltip =
			`${localize('MODERN.EXP_TOTAL')}: ${exp.total}<br>` +
			`${localize('MODERN.EXP_ARTIFACTRR')}: ${exp.artifactrr}<br>` +
			`${localize('MODERN.EXP_SPENT')}: ${exp.spent}<br>` +
			`${localize('MODERN.EXP_AVAILABLE')}: ${exp.available}`;

		/* --- Geld (kompakte Anzeige, Klick = Währungsdialog) --- */
		const amounts = allocateFromBase(context.currency ?? 0);
		const denoms = getDenominations();
		const money = {
			thaler: amounts.thaler ?? 0,
			shilling: amounts.shilling ?? 0,
			orteg: amounts.orteg ?? 0,
			abbrThaler: denoms[0].abbreviation,
			abbrShilling: denoms[1].abbreviation,
			abbrOrteg: denoms[2].abbreviation,
		};

		/* --- Eigenschaften-Chips (2x4; Klick = Eigenschaften-Dialog) --- */
		const attributes = [];
		for (const [key, a] of Object.entries(live.attributes)) {
			if (!a?.label) continue;
			attributes.push({
				key,
				abbr: localize(`${a.label}ABBR`),
				label: localize(a.label),
				total: a.total,
				modifier: a.modifier,
				display: isNPC && showMods ? `${a.modifier > 0 ? '+' : ''}${a.modifier}` : String(a.total),
				tooltip: a.msg ?? `${localize(a.label)}: ${a.total}`,
			});
		}

		/* --- Belastungs-Gauge (Halbrund/Segmentring, nur bei aktiver Regel) --- */
		const enc = context.system.encumbrance ?? {};
		const basePct = Number(enc.basePct) || 0;
		const gaugePct = Number(enc.pct) || 0;
		// Halbrund: Bogen M12 62 A48 48 ... 108 62, Bogenlänge 150.8 - Marker auf
		// der Belastungsgrenze (basePct) als weiße Linie radial durch den Band.
		const theta = (180 - Math.min(100, basePct) * 1.8) * (Math.PI / 180);
		const mark = (r) => ({
			x: +(60 + r * Math.cos(theta)).toFixed(1),
			y: +(62 - r * Math.sin(theta)).toFixed(1),
		});
		const mo = mark(55);
		const mi = mark(41);
		const thetaRing = (Math.min(100, basePct) * 3.6 - 90) * (Math.PI / 180);
		const ringMark = (r) => ({
			x: +(50 + r * Math.cos(thetaRing)).toFixed(1),
			y: +(50 + r * Math.sin(thetaRing)).toFixed(1),
		});
		const ro = ringMark(46);
		const ri = ringMark(34);
		const gauge = {
			show: !!enc.show,
			variant: design.gauge === 'ring' ? 'ring' : 'half',
			state: enc.state ?? 'ok',
			stateLabel: enc.stateLabel ?? '',
			pct: gaugePct,
			arc: +((gaugePct / 100) * 150.8).toFixed(1),
			loadDisplay: enc.loadDisplay ?? '0',
			baseLimitDisplay: enc.baseLimitDisplay ?? '0',
			hardLimitDisplay: enc.hardLimitDisplay ?? '0',
			malusLine: enc.malusLine ?? null,
			tooltip: enc.tooltip ?? '',
			markerX1: mo.x, markerY1: mo.y, markerX2: mi.x, markerY2: mi.y,
			ringMarkerX1: ro.x, ringMarkerY1: ro.y, ringMarkerX2: ri.x, ringMarkerY2: ri.y,
		};

		/* --- Fähigkeiten & Kräfte: 6 sauber getrennte Gruppen --- */
		const TYPE_GROUP = { ability: 'abilities', mysticalPower: 'powers', ritual: 'rituals', trait: 'traits', boon: 'boons', burden: 'burdens' };
		const groupLabels = {
			abilities: localize('MODERN.GROUP_ABILITIES'),
			powers: localize('MODERN.GROUP_POWERS'),
			rituals: localize('MODERN.GROUP_RITUALS'),
			traits: localize('MODERN.GROUP_TRAITS'),
			boons: localize('MODERN.GROUP_BOONS'),
			burdens: localize('MODERN.GROUP_BURDENS'),
		};
		const powerGroups = Object.keys(groupLabels).map((id) => ({ id, label: groupLabels[id], hasItems: false, items: [], count: 0 }));
		const groupById = Object.fromEntries(powerGroups.map((g) => [g.id, g]));
		const powerEntryById = {};
		for (const item of context.items) {
			const s = item.system;
			if (!s?.isPower) continue;
			const entry = {
				id: item.id,
				name: item.name + (context.beastloreTitleSuffix?.[item.id] ?? ''),
				img: item.img,
				hasScript: !!s.hasScript,
				isIntegrated: !!s.isIntegrated,
				favorite: !!item.flags?.symbaroum?.favorite,
				level: 0,
				pipsOff: 0,
				sub: '',
			};
			if (s.hasLevels) {
				const lvl = item.getLevel();
				entry.level = lvl.level;
				entry.pipsOff = Math.max(0, 3 - lvl.level);
				entry.sub = lvl.lvlName ?? '';
			} else if (s.isRitual) entry.sub = localize('ITEM.TypeRitual');
			else if (s.isBoon) entry.sub = localize('ITEM.TypeBoon');
			else if (s.isBurden) entry.sub = localize('ITEM.TypeBurden');
			const groupId = TYPE_GROUP[item.type];
			const group = groupById[groupId] ?? groupById.abilities;
			group.items.push(entry);
			group.hasItems = true;
			group.count = group.items.length;
			powerEntryById[item.id] = entry;
		}

		/* --- Ausrüstung: Zeilen mit Gewicht/Preis, Status, Favorit --- */
		const stateInfo = (state) => {
			if (state === 'active') return { state, icon: 'fas fa-tshirt', tooltip: localize('GEAR.ACTIVE') };
			if (state === 'equipped') return { state, icon: 'fas fa-suitcase', tooltip: localize('GEAR.EQUIPPED') };
			return { state: 'other', icon: 'fas fa-warehouse', tooltip: localize('GEAR.OTHER') };
		};
		const itemsById = new Map(context.items.map((it) => [it.id, it]));
		const weightInfo = (rawItem) => {
			const cat = game.symbaroum.config.weight[rawItem?.system?.weight] ?? game.symbaroum.config.weight.none;
			if (cat.id === 'none') return { display: '—', tooltip: localize('WEIGHT.LABEL') + ': ' + localize(cat.label) };
			if (cat.value === null) return { display: '∞', tooltip: localize('WEIGHT.LABEL') + ': ' + localize(cat.label) };
			const number = Math.max(1, Math.round(Number(rawItem.system.number ?? 1) || 1));
			return {
				display: `${formatGE(cat.value * number)} ${localize('WEIGHT.GE_ABBR')}`,
				tooltip: `${localize(cat.label)} × ${number}`,
			};
		};
		const priceInfo = (rawItem) => {
			const base = getItemPriceBase(rawItem);
			return base === null ? '' : formatCurrency(base);
		};
		const gearRow = (id, name, img, sub, rawItem, extra = {}) => {
			const info = stateInfo(rawItem?.system?.state ?? 'other');
			const w = weightInfo(rawItem);
			const price = priceInfo(rawItem);
			return {
				id, name, img, sub,
				favorite: !!rawItem?.flags?.symbaroum?.favorite,
				weightDisplay: price ? `${w.display} · ${price}` : w.display,
				weightTooltip: w.tooltip,
				state: info.state, stateIcon: info.icon, stateTooltip: info.tooltip,
				...extra,
			};
		};
		const gear = { armors: [], weapons: [], equipments: [], artifacts: [], containers: [] };
		/* Behältersystem v1: Items in einem (gültigen) Behälter erscheinen nur
		   als Kinderzeile des Behälters, nie zusätzlich in den Einzelgruppen.
		   Verwaiste Referenzen (Behälter gelöscht) gelten als nicht verpackt. */
		const packed = (rawItem) =>
			!!(rawItem?.system?.container && this.actor.items.get(rawItem.system.container)?.type === 'container');
		/* AP2 v2 (Uniform-Regel): Waffen/Rüstungen können jetzt stapelbar
		   sein - ihre Zeile zeigt die Anzahl dann wie Ausrüstung/Artefakte
		   als "× N" im Untertitel (nur ab 2, sonst bleibt der kompakte
		   Schaden-/Behinderungs-Text unverändert). */
		const withCount = (base, rawItem) => {
			const n = Math.max(1, Math.round(Number(rawItem?.system?.number ?? 1) || 1));
			return n > 1 ? `${base} · × ${n}` : base;
		};
		for (const a of live.armors ?? []) {
			if (packed(itemsById.get(a.id))) continue;
			if (a.isNoArmor) {
				gear.armors.push(gearRow(a.id, a.name, a.img, withCount(`${a.displayTextShort} · ${localize('ARMOR.IMPEDING')} ${a.impeding}`, itemsById.get(a.id)), itemsById.get(a.id), { isNoArmor: true }));
				continue;
			}
			gear.armors.push(gearRow(a.id, a.name, a.img, withCount(`${a.displayTextShort} · ${localize('ARMOR.IMPEDING')} ${a.impeding}`, itemsById.get(a.id)), itemsById.get(a.id)));
		}
		for (const w of live.weapons ?? []) {
			if (packed(itemsById.get(w.id))) continue;
			gear.weapons.push(gearRow(w.id, w.name, w.img, withCount(`${w.damage?.displayTextShort ?? ''} · ${localize(`${w.attributeLabel}ABBR`)}`, itemsById.get(w.id)), itemsById.get(w.id)));
		}
		for (const item of context.items) {
			const s = item.system;
			if (packed(item)) continue;
			/* Behältersystem v1.1: Behälter haben ihre eigene Gruppe und
			   bleiben der Artefakt-/Ausrüstungs-Sortierung entzogen - auch
			   wenn über die neue Artefakt-Checkbox system.isArtifact gesetzt
			   ist (keine Doppel-Listung). */
			if (item.type === 'container') continue;
			/* A6v7 (Rudolfs Änderungswünsche): Items mit aktivierter Artefakt-
			   Checkbox (z. B. Ausrüstung mit system.isArtifact) einsortieren
			   unter ARTEFAKTE, nicht unter Ausrüstung - deshalb prüft die
			   Artefakt-Bedingung zuerst.
			   A6v8 (Rudolfs Änderungswunsch): Als Untertitel stehen nicht mehr
			   die Artefakt-Merkmale (Aktionen/Korruption), sondern rechts die
			   Anzahl - die Zeilen sind damit wie Waffen/Rüstung/Ausrüstung
			   aufgebaut. Reine Artefakt-Items haben kein system.number und
			   zeigen deshalb "× 1"; Ausrüstung mit Artefakt-Checkbox behält
			   ihre Anzahl. */
			if (s.isArtifact) {
				gear.artifacts.push(gearRow(item.id, item.name, item.img, `× ${s.number ?? 1}`, item));
			} else if (s.isEquipment) {
				gear.equipments.push(gearRow(item.id, item.name, item.img, `× ${s.number ?? 1}`, item));
			}
		}

		/* --- Behälter (Behältersystem v1): eigene Gruppe, einklappbare
		   Zeilen mit Kapazitäts-/Geldanzeige und den beiden Status-Chips
		   "mitgeführt" / "zählt zur Last". Kinderzeilen sind eingerückt,
           verschachtelte Behälter als eigene Zeile mit ihren Kindern (max.
           2 Ebenen). Kollaps-Zustand pro Behälter als User-Flag (SL und
           Spieler klappen unabhängig). --- */
		const collapsedFlags = game.user.getFlag('symbaroum', 'containerCollapsed') ?? {};
		const buildChildRows = (containerItem, depth, rows) => {
			for (const child of getContainerChildren(this.actor, containerItem.id)) {
				if (child.type === 'container') {
					const sub = getContainerTotals(this.actor, child);
					const subCapacity = Math.max(0, Number(child.system.capacity) || 0);
					rows.push({
						id: child.id,
						name: child.name,
						img: child.img,
						depth,
						isContainer: true,
						// Testrunde-1-Wunsch: auch der verschachtelte Behälter
						// hat seinen eigenen Kollaps-Pfeil (gleiches User-Flag).
						collapsed: !!collapsedFlags[child.id],
						capacityDisplay:
							subCapacity > 0
								? `${formatGE(sub.contentsGE)} / ${formatGE(subCapacity)} ${localize('WEIGHT.GE_ABBR')}`
								: `${formatGE(sub.contentsGE)} ${localize('WEIGHT.GE_ABBR')}`,
						currencyDisplay: sub.currencyTotal > 0 ? formatCurrency(sub.currencyTotal) : '',
						moneyTooltip: sub.currencyTotal > 0 ? `${localize('CONTAINER.MONEY_TOOLTIP')}: ${formatCurrency(sub.currencyTotal)}` : '',
					});
					// Kinder des verschachtelten Behälters nur, wenn er selbst offen ist
					if (!collapsedFlags[child.id]) buildChildRows(child, depth + 1, rows);
				} else {
					const w = weightInfo(child);
					rows.push({
						id: child.id,
						name: child.name,
						img: child.img,
						depth,
						isContainer: false,
						weightDisplay: w.display,
						weightTooltip: w.tooltip,
						sub: `× ${Math.max(1, Math.round(Number(child.system.number ?? 1) || 1))}`,
					});
				}
			}
		};
		for (const item of context.items) {
			if (item.type !== 'container') continue;
			if (packed(item)) continue; // verschachtelte Behälter rendern als Kinderzeile
			const s = item.system;
			const totals = getContainerTotals(this.actor, item);
			const capacity = Math.max(0, Number(s.capacity) || 0);
			const children = [];
			buildChildRows(item, 1, children);
			const loadTooltipLines = [
				`${localize('WEIGHT.LABEL')}: ${formatGE(totals.ownGE ?? 0)} ${localize('WEIGHT.GE_ABBR')}`,
				`${localize('CONTAINER.CONTENTS_GE')}: ${formatGE(totals.contentsGE)} ${localize('WEIGHT.GE_ABBR')}`,
				`${localize('CONTAINER.MONEY_GE')}: ${formatGE(totals.moneyGE)} ${localize('WEIGHT.GE_ABBR')}`,
			];
			if (totals.weightless) loadTooltipLines.push(localize('CONTAINER.WEIGHTLESS_HINT'));
			gear.containers.push({
				id: item.id,
				name: item.name,
				img: item.img,
				carried: !!s.carried,
				countLoad: !!(s.carried && s.countLoad),
				collapsed: !!collapsedFlags[item.id],
				capacity,
				capacityDisplay:
					capacity > 0
						? `${formatGE(totals.contentsGE)} / ${formatGE(capacity)} ${localize('WEIGHT.GE_ABBR')}`
						: `${formatGE(totals.contentsGE)} ${localize('WEIGHT.GE_ABBR')}`,
				fillPct: capacity > 0 ? Math.min(100, Math.round((totals.contentsGE / capacity) * 1000) / 10) : null,
				fillFull: capacity > 0 && totals.contentsGE > capacity,
				currencyDisplay: totals.currencyTotal > 0 ? formatCurrency(totals.currencyTotal) : '',
				moneyTooltip: totals.currencyTotal > 0 ? `${localize('CONTAINER.MONEY_TOOLTIP')}: ${formatCurrency(totals.currencyTotal)}` : '',
				loadTooltip: loadTooltipLines.join('<br>'),
				children,
				hasChildren: children.length > 0,
			});
		}

		/* --- Favoriten für den Kampf-Tab (Hybrid-Regel) --- */
		const favorites = [];
		for (const item of context.items) {
			if (!item.flags?.symbaroum?.favorite) continue;
			const s = item.system;
			if (packed(item)) continue; // verpackte Teile kämpfen nicht (Status-Zwang)
			if (s.isPower) {
				const entry = powerEntryById[item.id];
				// Bestienkunde v1.1: Favorit uebernimmt den erweiterten Titel
				// aus dem powers-Eintrag (Suffix bereits in entry.name)
				if (entry) favorites.push({ id: item.id, name: entry.name, img: item.img, kind: 'power', hasScript: entry.hasScript, sub: entry.sub });
			} else if (s.isGear) {
				// Aktive Waffen/Rüstungen erscheinen ohnehin immer im Kampf-Tab
				if ((s.isWeapon || s.isArmor) && s.isActive) continue;
				let sub = '';
				if (s.isWeapon) {
					const w = (live.weapons ?? []).find((x) => x.id === item.id);
					sub = w?.damage?.displayTextShort ?? '';
				} else if (s.isArmor) {
					const a = (live.armors ?? []).find((x) => x.id === item.id);
					sub = a?.displayTextShort ?? '';
				} else if (s.isEquipment) {
					sub = `× ${s.number ?? 1}`;
				} else if (s.isArtifact) {
					sub = item.getArtifactActions?.() ?? '';
				}
				favorites.push({
					id: item.id, name: item.name, img: item.img,
					kind: s.isWeapon ? 'weapon' : s.isArmor ? 'armor' : 'gear',
					hasScript: false, sub,
				});
			}
		}

		/* --- Kampf-Chips --- */
		const combatData = live.combat ?? {};
		const impeding = Number(combatData.impeding) || 0;
		// Testrunde-2-Fund: klassischer Hovertext "verteidigt sich mit [Attribut]"
		// (ARMOR.DEFENCE_ATTRIBUTE) vor dem Wert-Breakdown (combatData.msg).
		const defenseAttrLine = `${localize('ARMOR.DEFENCE_ATTRIBUTE')} ${localize(combatData.defenseAttribute?.label ?? '')}`;
		const combat = {
			defenseDisplay: isNPC && showMods ? `${combatData.defmod > 0 ? '+' : ''}${combatData.defmod}` : String(combatData.defense ?? 0),
			defenseTooltip: combatData.msg ? `${defenseAttrLine}<br>${combatData.msg}` : defenseAttrLine,
			impedingDisplay: impeding > 0 ? `−${impeding}` : '0',
		};
		// Testrunde-2-Fund: Status-Chips auch im Kampf-Tab (Rüstungs-/Waffen-Zeilen)
		// klickbar wie im Ausrüstungs-Tab - Zyklus-Logik und Binding
		// (.item-state in actor.js _onItemStateUpdate) sind bereits vorhanden.
		const itemStateChips = {};
		for (const item of this.actor.items) {
			const s = item.system;
			if (!s?.isGear) continue;
			const info = stateInfo(s.state ?? 'other');
			itemStateChips[item.id] = { state: info.state, icon: info.icon, tooltip: info.tooltip };
		}
		/* A6v4 (Testrunde 3): {{#with (lookup ...)}} renderte in Foundry V14
		   nichts - die Status-Chips blieben unsichtbar. Die Kampf-Zeilen
		   werden deshalb komplett in JS vorberechnet: fertige Objekte pro
		   Rüstung/Waffe inklusive Chip (state/icon/tooltip), das Template
		   rendert nur noch die fertigen Werte. */
		const armorItem = itemsById.get(combatData.id);
		combat.armor = {
			id: combatData.id,
			name: combatData.name,
			img: combatData.img,
			sub: combatData.displayTextShort ?? '',
			// keine echte Rüstung aktiv ("keine Rüstung") -> statisches Chip
			chip: armorItem ? (itemStateChips[combatData.id] ?? null) : null,
		};
		combat.weapons = [];
		for (const w of live.weapons ?? []) {
			if (!w.isActive) continue;
			combat.weapons.push({
				id: w.id,
				name: w.name,
				img: w.img,
				damageShort: w.damage?.displayTextShort ?? '',
				attrAbbr: localize(`${w.attributeLabel}ABBR`),
				attrTooltip: `${localize('WEAPON.ATTACK_ATTRIBUTE')} ${localize(w.attributeLabel)}`,
				chip: itemStateChips[w.id] ?? null,
			});
		}
		// Testrunde-3-Fund (Initiative): der klassische i18n-Key INITIATIVE.
		// EXPLANATION enthielt den kaputten Literal-Platzhalter
		// "[initiative attribute.vigilant]" - im Tooltip steht jetzt das
		// tatsächlich verwendete Attribut (system.initiative.label ist ein
		// i18n-Key, z. B. ATTRIBUTE.VIGILANT; Default Aufmerksamkeit).
		combat.initiativeTooltip = `${localize('INITIATIVE.EXPLANATION')} ${localize(live.initiative?.label ?? '')}`.trim();

		return {
			theme: design.theme === 'classic' ? 'classic' : 'dark',
			tabIcons: { ...design.icons },
			showShadow: !!(game.user.isGM || this.actor.isOwner),
			/* Kosmetik v1 (Rudolfs Wunsch): eingeschränkte Ansicht für Nutzer
			   mit limitierten oder Beobachter-Rechten (LIMITED/OBSERVER).
			   isOwner deckt GM und Charakterbesitzer ab - für alle anderen
			   Betrachter zeigt die Stammleiste nur Avatar + Volk/Beruf (bzw.
			   Kategorie/Untertyp bei Monstern), und von den Tabs bleibt nur
			   Biographie bis einschließlich Aussehen. MonsterSheet erbt. */
			limitedView: !this.actor.isOwner,
			idLine: idParts.join(' · '),
			categoryLabel,
			categoryLine: categoryParts.join(' · '),
			toughness,
			corruption,
			exp,
			money,
			attributes,
			gauge,
			powerGroups,
			gear,
			favorites,
			hasFavorites: favorites.length > 0,
			combat,
		};
	}

	/* ----------------------------------------------------------------
	 * Behältersystem (Projekt "Behälter" v1): Drag & Drop
	 *
	 * Drop auf eine Behälterzeile legt das Item in den Behälter (gleicher
	 * Akteur, A15-Zug von fremden Akteuren oder Kopie aus Seitenleiste/
	 * Kompendium); Drop außerhalb jeder Behälterzeile entnimmt ein
	 * verpacktes Item zurück ins Inventar. Validierung (Status-Zwang,
	 * Maximaltiefe 2, Zykel-Schutz) läuft in container.js; alle anderen
	 * Drop-Fälle gehen an die Basisklasse (dort greift seit AP2 ggf.
	 * Merge-on-Drop für identische Stapel, siehe script/common/stacking.js).
	 */
	async _onDrop(event) {
		const containerRow = event.target?.closest?.('.m-container-row[data-container-id]');
		if (containerRow) {
			await this._onDropIntoContainer(event, containerRow.dataset.containerId);
			return;
		}
		let dragData = null;
		try {
			dragData = JSON.parse(event.dataTransfer?.getData('text/plain') ?? 'null');
		} catch {
			dragData = null;
		}
		if (dragData?.type === 'Item' && dragData.uuid) {
			let sourceItem = null;
			try {
				sourceItem = await Item.fromDropData(dragData);
			} catch {
				sourceItem = null;
			}
			if (
				sourceItem?.parent === this.actor &&
				sourceItem.system?.container &&
				this.actor.items.get(sourceItem.system.container)?.type === 'container'
			) {
				if (!this.isEditable || !this.actor.isOwner) return;
				await removeItemFromContainer(sourceItem);
				return;
			}
		}
		return super._onDrop(event);
	}

	/** Drop-Behandlung für eine Behälterzeile (siehe _onDrop). */
	async _onDropIntoContainer(event, containerId) {
		if (!this.isEditable || !this.actor.isOwner) return;
		const container = this.actor.items.get(containerId);
		if (!container || container.type !== 'container') return;
		let dragData = null;
		try {
			dragData = JSON.parse(event.dataTransfer?.getData('text/plain') ?? 'null');
		} catch {
			dragData = null;
		}
		if (dragData?.type !== 'Item' || !dragData.uuid) return;
		let sourceItem = null;
		try {
			sourceItem = await Item.fromDropData(dragData);
		} catch {
			sourceItem = null;
		}
		if (!sourceItem) return;
		// AP2 Stapeln: Vor dem Einlagern prüfen, ob im Behälter bereits ein
		// identischer Stapel liegt (Typ + Name + Preis + Gewicht) - dann nur
		// dessen Anzahl erhöhen (und eine eingebettete Quelle löschen),
		// statt ein zweites Item im Behälter abzulegen.
		const merged = await mergeStackDrop(this.actor, sourceItem, container.id);
		if (merged) return;
		if (sourceItem.parent === this.actor) {
			await moveItemToContainer(sourceItem, container);
			return;
		}
		if (sourceItem.parent instanceof Actor) {
			// A15-Zug: erst übernehmen (Ziel-Kopie ohne alte Behälter-Referenz),
			// dann in den Behälter einlagern.
			const created = await this._moveItemBetweenActors(sourceItem, sourceItem.parent);
			if (created) await moveItemToContainer(created, container);
			return;
		}
		// Welt-Item oder Kompendium: Kopie im Aktor anlegen und einlagern
		const itemData = sourceItem.toObject();
		delete itemData._id;
		const created = await this.actor.createEmbeddedDocuments('Item', [itemData]);
		if (created?.[0]) await moveItemToContainer(created[0], container);
	}

	/**
	 * Drag start for attributes (macro support) and for items.
	 */
	async _onDragStart(event) {
		const attrElement = event.target.closest?.('.attrDragM[data-attribute]');
		if (attrElement) {
			const dragData = {
				actorId: this.actor.id,
				sceneId: this.actor.isToken ? canvas.scene?.id : null,
				tokenId: this.actor.isToken ? this.actor.token.id : null,
			};
			dragData.type = 'attribute';
			dragData.attribute = attrElement.dataset.attribute;
			return event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
		}
		return super._onDragStart(event);
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		const element = this.element;

		const rollAttrib = element.querySelectorAll('.roll-attribute');
		for (const s of rollAttrib) {
			s.addEventListener('click', (ev) => {
				this._prepareRollAttribute(ev);
			});
		}
		const rollArmor = element.querySelectorAll('.roll-armor');
		for (const s of rollArmor) {
			s.addEventListener('click', (ev) => {
				this._onPrepareRollArmor(ev);
			});
		}
		const rollWeapon = element.querySelectorAll('.roll-weapon');
		for (const s of rollWeapon) {
			s.addEventListener('click', (ev) => {
				this._onPrepareRollWeapon(ev);
			});
		}
		const modAttrib = element.querySelectorAll('.modify-attributes');
		for (const s of modAttrib) {
			s.addEventListener('click', (ev) => {
				this._modifyAttributes(ev);
			});
		}

		// Tab navigation on the existing V13 markup (.sheet-tabs / .sheet-body)
		// (not present in limited view)
		if (element.querySelector('.sheet-tabs')) {
			this.tabs ??= new foundry.applications.ux.Tabs({
				navSelector: '.sheet-tabs',
				contentSelector: '.sheet-body',
				initial: 'main',
			});
			this.tabs.bind(element);
		}

		// A6: Reiterleiste der modernisierten Ansicht (vertikale Icon-Buttons am
		// rechten Rand, Tabs-Gruppe 'modern'). Separate Tabs-Instanz - die
		// klassische Navigation bleibt unberührt.
		if (element.querySelector('.modern-rail')) {
			this.modernTabs ??= new foundry.applications.ux.Tabs({
				navSelector: '.modern-rail',
				contentSelector: '.modern-body',
				/* Kosmetik v1: in der eingeschränkten Ansicht (limitierte/
				   Beobachter-Rechte) existiert der Kampf-Tab nicht mehr -
				   Start-Tab ist dann Biographie. */
				initial: this.actor.isOwner ? 'combat' : 'bio',
			});
			this.modernTabs.bind(element);
		}

		// A6: Eigenschaften-Chip (Stammleiste) -> Basis/Modifikator/Bonus-Dialog
		// (Testrunde-2-Fix: Der Selektor muss zur Chip-Klasse .m-attr-chip aus
		// sidebar.hbs passen - .modern-attr-chip traf nichts, der Dialog
		// öffnete deshalb nicht.)
		const attrChips = element.querySelectorAll('.m-attr-chip');
		for (const s of attrChips) {
			s.addEventListener('click', (ev) => {
				ev.preventDefault();
				this._openAttributesDialog(true);
			});
		}
		// A6: Erfahrungs-Chip/-Kachel -> Erfahrungs-Dialog (nur Gesamt und
		// Würfelwiederholungen sind editierbar)
		const expChips = element.querySelectorAll('.modern-exp');
		for (const s of expChips) {
			s.addEventListener('click', (ev) => {
				ev.preventDefault();
				this._openExperienceDialog();
			});
		}
		// A6: Geld (Stammleiste) -> Währungsdialog (Delta-Syntax wie im Gear-Tab)
		const moneyBtns = element.querySelectorAll('.m-money-btn');
		for (const s of moneyBtns) {
			s.addEventListener('click', (ev) => {
				ev.preventDefault();
				this._openMoneyDialog();
			});
		}
		// A6: Favoriten-Stern (pro Charakter, Item-Flag flags.symbaroum.favorite)
		const favToggles = element.querySelectorAll('.favorite-toggle');
		for (const s of favToggles) {
			s.addEventListener('click', (ev) => {
				this._onFavoriteToggle(ev);
			});
		}
		// A6v4 (Testrunde 3): Zähigkeit und temporäre Korruption über zwei
		// kleine Tasten (Pfeil links -1 / Pfeil rechts +1) statt Eingabefeld.
		const vitalBtns = element.querySelectorAll('.m-vital-btn');
		for (const s of vitalBtns) {
			s.addEventListener('click', (ev) => {
				this._onModernVitalAdjust(ev);
			});
		}
		// A6v8 (Testrunde 7, Rudolfs Änderungswunsch): Klick auf die
		// Korruptions-Reihe der Stammleiste öffnet den Korruptions-Dialog.
		// Die ±-Tasten liegen in derselben Reihe - ihr Klick blubbert hier
		// mit hoch, wird über closest('.m-vital-btn') aber ignoriert, sodass
		// kein stopPropagation in _onModernVitalAdjust nötig ist.
		const corruptRow = element.querySelector('.m-vital-row.m-corrupt-row');
		if (corruptRow) {
			corruptRow.addEventListener('click', (ev) => {
				if (ev.target.closest('.m-vital-btn')) return;
				if (!this.isEditable || !this.actor.isOwner) return;
				this._openCorruptionDialog();
			});
		}
		// Behältersystem v1: Kollaps-Pfeil, Status-Chips, Entnahme-Taste und
		// Rechtsklick-Kontextdialog auf den Behälterzeilen.
		const containerCollapses = element.querySelectorAll('.m-container-collapse');
		for (const s of containerCollapses) {
			s.addEventListener('click', (ev) => {
				this._onContainerCollapseToggle(ev);
			});
		}
		const containerChips = element.querySelectorAll('.container-flag');
		for (const s of containerChips) {
			s.addEventListener('click', (ev) => {
				this._onContainerFlagToggle(ev);
			});
		}
		const containerTakeouts = element.querySelectorAll('.m-container-takeout');
		for (const s of containerTakeouts) {
			s.addEventListener('click', (ev) => {
				this._onContainerTakeOut(ev);
			});
		}
		const containerRows = element.querySelectorAll('.m-container-row[data-container-id]');
		for (const row of containerRows) {
			row.addEventListener('contextmenu', (ev) => {
				if (!this.isEditable || !this.actor.isOwner) return;
				const container = this.actor.items.get(row.dataset.containerId);
				if (!container || container.type !== 'container') return;
				ev.preventDefault();
				ev.stopPropagation(); // CMPowerMenu hängt am Blatt-Root
				this._openContainerDialog(container);
			});
		}
		// A6v8 (Testrunde 7, Rudolfs Änderungswunsch): Rechtsklick auf eine
		// Ausrüstungs-Zeile im modernen Ausrüstungs-Tab öffnet den Anzahl-
		// Dialog statt des Standard-Kontextmenüs. Das betrifft auch
		// Ausrüstung mit aktiver Artefakt-Checkbox (die Zeilen stehen unter
		// ARTEFAKTE, bleiben aber Ausrüstung). Ohne Editierrechte läuft der
		// Rechtsklick ins Standard-Kontextmenü durch (kein preventDefault).
		// stopPropagation verhindert die Delegation des CMPowerMenu, dessen
		// Listener am Blatt-Root hängt.
		// AP2 v2 (Uniform-Regel + Stapel trennen): Der Dialog gilt jetzt
		// für ALLE stapelbaren Items - Waffen/Rüstungen/Artefakte mit
		// Stapelbar-Flag bekommen denselben Dialog (Anzahl ändern, Löschen,
		// ab Anzahl 2 zusätzlich "Trennen"). Ohne Flag bleiben Waffen/
		// Rüstungen beim Standard-Kontextmenü (kein Binding, keine
		// Regression), normale Ausrüstung behält das A6v8-Verhalten.
		const equipRows = element.querySelectorAll('.m-gear .m-inv-row');
		for (const row of equipRows) {
			const item = this.actor.items.get(row.dataset.itemId);
			if (!item) continue;
			if (!item.system?.isEquipment && !isStackableItem(item)) continue;
			row.addEventListener('contextmenu', (ev) => {
				if (!this.isEditable || !this.actor.isOwner) return;
				ev.preventDefault();
				ev.stopPropagation();
				this._openEquipmentDialog(item);
			});
		}
		// A6v4 (Testrunde 3): Scroll-Position wiederherstellen (zweite Stufe
		// der Sicherung - gemessen in _prepareContext, unmittelbar bevor der
		// DOM ersetzt wird; die Höhenkette stellt sicher, dass .modern-body
		// und .m-sidebar die eigentlichen Scroll-Container sind).
		if (context.renderModern && this._modernScroll) {
			const body = element.querySelector('.modern-body');
			if (body) body.scrollTop = this._modernScroll.body ?? 0;
			const sidebar = element.querySelector('.m-sidebar');
			if (sidebar) sidebar.scrollTop = this._modernScroll.sidebar ?? 0;
		}

		// Attribute drag support; this binding also carries the sheet's drop handling.
		// Foundry 14's DragDrop.bind() assigns ondragover/ondrop as single-slot element
		// properties, so the last DragDrop bound to the sheet root owns the drop handler.
		// Keep this as the final DragDrop binding in _onRender.
		new foundry.applications.ux.DragDrop({
			dragSelector: '.attrDragM[data-attribute]',
			dropSelector: null,
			permissions: {
				drop: (selector) => this._canDragDrop?.(selector) ?? this.isEditable,
			},
			callbacks: {
				dragstart: (ev) => this._onDragStart(ev),
				drop: (ev) => this._onDrop(ev),
			},
		}).bind(element);

		// Power/gear context menu - the app root element persists across re-renders,
		// so the menu is only created once per sheet instance.
		this.powerMenu ??= new CMPowerMenu(element, '.symbaroum-contextmenu', this._getPowerMenuItems(), {
			parent: this,
		});
	}

	_getPowerMenuItems() {
		return [
			{
				label: `TOOLTIP.USE_ABILITY`,
				icon: `<i class="fa-solid fa-bolt-lightning"></i>`,
				visible: (elem) => {
					if (elem.system?.hasScript && elem.system?.isPower) return true;
					return false;
				},
				onClick: (event, elem) => this._prepareActivateAbility(elem),
			},
			{
				label: 'TOOLTIP.USE_WEAPON',
				icon: `<i class="fa-solid fa-hand-fist"></i>`,
				visible: (elem) => {
					return elem.system?.isWeapon && elem.system?.isActive;
				},
				onClick: (event, elem) => {
					this._prepareRollWeapon(elem);
				},
			},
			{
				label: 'TOOLTIP.USE_ARMOR',
				icon: `<i class="fa-solid fa-shield"></i>`,
				visible: (elem) => {
					return elem == game.symbaroum.config.noArmorID || (elem.system.isArmor && elem.system.isActive);
				},
				onClick: (event, elem) => {
					this._prepareRollArmor(elem);
				},
			},
			{
				label: 'TOOLTIP.INCREASE_COUNT',
				icon: `<i class="fa-regular fa-square-plus"></i>`,
				visible: (elem) => {
					return elem.system?.isEquipment;
				},
				onClick: (event, elem) => {
					this._itemQuantityUpdate(elem, true, false);
				},
			},
			{
				label: game.i18n.format('TOOLTIP.INCREASE_COUNT_DEFAULT', {
					quantity: game.user.getFlag(game.system.id, game.symbaroum.config.CONTEXT_MENU.equipmentAddRemoveFlag),
					sign: '+',
				}),
				icon: `<i class="fa-regular fa-square-plus"></i>`,
				visible: (elem) => {
					let quantity = game.user.getFlag(game.system.id, game.symbaroum.config.CONTEXT_MENU.equipmentAddRemoveFlag);
					return elem.system?.isEquipment && quantity;
				},
				onClick: (event, elem) => {
					this._itemQuantityUpdate(elem, true, true);
				},
			},
			{
				label: 'TOOLTIP.DECREASE_COUNT',
				icon: `<i class="fa-regular fa-square-minus"></i>`,
				visible: (elem) => {
					return elem.system?.isEquipment && elem.system?.number > 0;
				},
				onClick: (event, elem) => {
					this._itemQuantityUpdate(elem, false, false);
				},
			},
			{
				label: game.i18n.format('TOOLTIP.DECREASE_COUNT_DEFAULT', {
					quantity: game.user.getFlag(game.system.id, game.symbaroum.config.CONTEXT_MENU.equipmentAddRemoveFlag),
					sign: '-',
				}),
				icon: `<i class="fa-regular fa-square-minus"></i>`,
				visible: (elem) => {
					let quantity = game.user.getFlag(game.system.id, game.symbaroum.config.CONTEXT_MENU.equipmentAddRemoveFlag);
					return elem.system?.isEquipment && quantity && quantity <= elem.system?.number;
				},
				onClick: (event, elem) => {
					this._itemQuantityUpdate(elem, false, true);
				},
			},
			{
				label: 'TOOLTIP.VIEW_ITEM',
				icon: `<i class="fa-regular fa-eye"></i>`,
				visible: (elem) => {
					return elem != game.symbaroum.config.noArmorID;
				},
				onClick: (event, elem) => {
					this._itemEdit(elem);
				},
			},
			{
				label: `TOOLTIP.DELETE_ITEM`,
				icon: `<i class='fas fa-trash'></i>`,
				visible: (elem) => {
					return elem != game.symbaroum.config.noArmorID;
				},
				onClick: (event, elem) => this._itemDelete(elem),
			},
		];
	}

	async _prepareRollAttribute(event) {
		event.preventDefault();
		const attributeName = event.target.dataset.attribute;
		await prepareRollAttribute(this.actor, attributeName, null, null);
	}

	async _onPrepareRollArmor(event) {
		event.preventDefault();
		await this.actor.rollArmor();
	}
	async _prepareRollArmor(elem) {
		await this.actor.rollArmor();
	}

	async _onPrepareRollWeapon(event) {
		event.preventDefault();
		const div = event.target.closest('.item');
		this._prepareRollWeapon(div);
	}
	async _prepareRollWeapon(div) {
		const weapon = this.actor.system.weapons.filter((item) => item.id == div.dataset.itemId)[0];
		await this.actor.rollWeapon(weapon);
	}

	async _modifyAttributes(event) {
		event.preventDefault();
		await this._openAttributesDialog(false);
	}

	/**
	 * A6v9 (Testrunde 8, Rudolfs Fund): Die modernen Dialoge folgen jetzt dem
	 * Design des Blatts (dunkel/hell) - bisher erschienen sie auch beim
	 * hellen Design immer dunkel. Die Theme-Klasse am DialogV2-Fenster-Root
	 * (dialog.symb-dialog.modern-theme-...) liefert die Farbvariablen für
	 * das Dialog-Chrome (siehe CSS-Block .modern-dialog); das Design wird
	 * beim Öffnen gelesen - ein laufender Dialog wechselt nicht live mit.
	 */
	_modernDialogClasses(...extra) {
		const theme = getModernSheetEffectiveDesign()?.theme === 'classic' ? 'classic' : 'dark';
		return ['modern-dialog', `modern-theme-${theme}`, ...extra];
	}

	/**
	 * A6: Öffnet den Eigenschaften-Dialog - klassisches Layout (attributes.hbs)
	 * oder das neue Design (modern/attributes-dialog.hbs). Beide Templates
	 * nutzen dieselben Feld-IDs, die Übernahme-Logik ist identisch.
	 * @param {boolean} modernDesign neues (modernes) Layout verwenden
	 */
	async _openAttributesDialog(modernDesign) {
		let system = foundry.utils.deepClone(this.actor.system);
		system.id = this.actor.id;

		const template = modernDesign
			? 'systems/symbaroum/template/sheet/modern/attributes-dialog.hbs'
			: 'systems/symbaroum/template/sheet/attributes.hbs';
		const html = await foundry.applications.handlebars.renderTemplate(template, {
			id: this.actor.id,
			system: system,
		});
		let title = game.i18n.localize('TITLE.ATTRIBUTES');
		let dialog = symbDialog({
			title: title,
			content: html,
			// A6v3 (Testrunde 2): Dialogfenster im modernen dunklen Design -
			// die Klassen landen auf dem DialogV2-Fenster-Root und themen
			// Fensterkopf/-inhalt/-Buttons (CSS-Block .symb-dialog.modern-dialog).
			// A6v4 (Testrunde 3): feste Breite pro Dialog, passend zum Inhalt
			// (5-Spalten-Attributstabelle braucht die meiste Breite).
			// A6v9: Theme-Klasse folgt dem Blatt-Design (dunkel/hell).
			classes: modernDesign ? this._modernDialogClasses('modern-attr-dialog') : [],
			width: 560,
			buttons: {
				confirm: {
					icon: '<i class="fas fa-check"></i>',
					label: game.i18n.localize('BUTTON.CONFIRM'),
					callback: async (html) => {
						await this._applyAttributeUpdates(html, system);
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: game.i18n.localize('BUTTON.CANCEL'),
					callback: async (html) => {},
				},
			},
		});
	}

	/** Übernahme-Logik des Eigenschaften-Dialogs (beide Designs, unverändert). */
	async _applyAttributeUpdates(html, system) {
		for (var aKey in system.attributes) {
			var base = '#attr-' + system.id + '-' + [aKey] + '-value';
			const stringValue = html[0].querySelector(base).value;

			let newValue = parseInt(stringValue, 10);
			if (!isNaN(newValue)) {
				let link = 'system.attributes.' + [aKey] + '.value';
				var mod = '#attr-' + [aKey] + '-mod';
				const stringMod = html[0].querySelector(mod).value;
				let newModValue = parseInt(stringMod, 10);
				if (!isNaN(newModValue)) {
					let linkMod = 'system.attributes.' + [aKey] + '.temporaryMod';
					await this.actor.update({
						[link]: newValue,
						[linkMod]: newModValue,
					});
				}
			}
		}
	}

	/**
	 * A6: Erfahrungs-Dialog - die vier Felder des klassischen Blatts; nur
	 * Gesamt-XP und die für Würfelwurf-Wiederholungen ausgegebenen Punkte
	 * sind editierbar (für Fähigkeiten etc. ausgegeben und verfügbar sind
	 * berechnet aus den Items bzw. available = total - artifactrr - spent).
	 */
	async _openExperienceDialog() {
		const localize = (key) => game.i18n.localize(key);
		const exp = this.actor.system.experience ?? {};
		const fields = [
			{ id: 'total', label: localize('MODERN.EXP_TOTAL'), tooltip: localize('TOOLTIP.EXPERIENCE_TOTAL'), value: exp.total ?? 0, editable: this.isEditable && this.actor.isOwner },
			{ id: 'artifactrr', label: localize('MODERN.EXP_ARTIFACTRR'), tooltip: localize('TOOLTIP.EXPERIENCE_ARTIFACTRR'), value: exp.artifactrr ?? 0, editable: this.isEditable && this.actor.isOwner },
			{ id: 'spent', label: localize('MODERN.EXP_SPENT'), tooltip: localize('TOOLTIP.EXPERIENCE_SPENT'), value: exp.spent ?? 0, editable: false },
			{ id: 'available', label: localize('MODERN.EXP_AVAILABLE'), tooltip: localize('TOOLTIP.EXPERIENCE_AVAILABLE'), value: exp.available ?? 0, editable: false },
		];
		const html = await foundry.applications.handlebars.renderTemplate(
			'systems/symbaroum/template/sheet/modern/experience-dialog.hbs',
			{ fields }
		);
		symbDialog({
			title: localize('BIO.EXPERIENCE'),
			content: html,
			classes: this._modernDialogClasses('modern-exp-dialog'),
			width: 460,
			buttons: {
				confirm: {
					icon: '<i class="fas fa-check"></i>',
					label: localize('BUTTON.CONFIRM'),
					callback: async (html) => {
						if (!this.isEditable || !this.actor.isOwner) return;
						const update = {};
						const total = parseInt(html[0].querySelector('#mexp-total')?.value, 10);
						const artifactrr = parseInt(html[0].querySelector('#mexp-artifactrr')?.value, 10);
						if (!isNaN(total)) update['system.experience.total'] = total;
						if (!isNaN(artifactrr)) update['system.experience.artifactrr'] = artifactrr;
						if (Object.keys(update).length) await this.actor.update(update);
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: localize('BUTTON.CANCEL'),
					callback: async (html) => {},
				},
			},
		});
	}

	/**
	 * A6v8 (Testrunde 7, Rudolfs Änderungswunsch): Korruptions-Dialog für die
	 * moderne Ansicht - Design wie der Eigenschaften-/Erfahrungs-Dialog,
	 * Aufbau wie der Korruptions-Container des klassischen Blatts. Temporär,
	 * Täglich und Permanent sind eingebbar; Aktuell, Korruptionsschwelle und
	 * Absolut sind abgeleitet und nur anzeigend (disabled). Bei "völlig
	 * korrumpiert" - wie im klassischen Blatt - und ohne Editierrechte sind
	 * auch die drei Eingabefelder gesperrt. Negative Eingaben werden auf 0
	 * geklemmt; die Klemmung der ±-Tasten in der Stammleiste (maximal bis
	 * "Absolut" bei der temporären Korruption) greift hier nicht, weil der
	 * Dialog die drei Felder direkt setzt.
	 */
	async _openCorruptionDialog() {
		const localize = (key) => game.i18n.localize(key);
		const cor = this.actor.system.health.corruption ?? {};
		const editable = this.isEditable && this.actor.isOwner && !this.actor.system.isThoroughlyCorrupt;
		const fields = [
			{ id: 'current', label: localize('HEALTH.CORRUPTION_CURRENT'), tooltip: localize('TOOLTIP.HEALTH.CORRUPTION_CURRENT'), value: cor.value ?? 0, editable: false },
			{ id: 'temporary', label: localize('HEALTH.CORRUPTION_TEMPORARY'), tooltip: localize('TOOLTIP.HEALTH.CORRUPTION_TEMPORARY'), value: cor.temporary ?? 0, editable },
			{ id: 'longterm', label: localize('HEALTH.CORRUPTION_LONGTERM'), tooltip: localize('TOOLTIP.HEALTH.CORRUPTION_LONGTERM'), value: cor.longterm ?? 0, editable },
			{ id: 'permanent', label: localize('HEALTH.CORRUPTION_PERMANENT'), tooltip: localize('TOOLTIP.HEALTH.CORRUPTION_PERMANENT'), value: cor.permanent ?? 0, editable },
			{ id: 'threshold', label: localize('HEALTH.CORRUPTION_THRESHOLD'), tooltip: localize('TOOLTIP.HEALTH.CORRUPTION_THRESHOLD'), value: cor.threshold ?? 0, editable: false },
			{ id: 'max', label: localize('HEALTH.CORRUPTION_MAX'), tooltip: localize('TOOLTIP.HEALTH.CORRUPTION_MAX'), value: cor.max ?? 0, editable: false },
		];
		const html = await foundry.applications.handlebars.renderTemplate(
			'systems/symbaroum/template/sheet/modern/corruption-dialog.hbs',
			{ fields }
		);
		symbDialog({
			title: localize('HEALTH.CORRUPTION'),
			content: html,
			classes: this._modernDialogClasses('modern-corruption-dialog'),
			width: 460,
			buttons: {
				confirm: {
					icon: '<i class="fas fa-check"></i>',
					label: localize('MODERN.APPLY'),
					callback: async (html) => {
						if (!editable) return;
						const update = {};
						const temporary = parseInt(html[0].querySelector('#mcor-temporary')?.value, 10);
						const longterm = parseInt(html[0].querySelector('#mcor-longterm')?.value, 10);
						const permanent = parseInt(html[0].querySelector('#mcor-permanent')?.value, 10);
						if (!isNaN(temporary)) update['system.health.corruption.temporary'] = Math.max(0, temporary);
						if (!isNaN(longterm)) update['system.health.corruption.longterm'] = Math.max(0, longterm);
						if (!isNaN(permanent)) update['system.health.corruption.permanent'] = Math.max(0, permanent);
						if (Object.keys(update).length) await this.actor.update(update);
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: localize('BUTTON.CANCEL'),
					callback: async (html) => {},
				},
			},
		});
	}

	/**
	 * A6v8 (Testrunde 7, Rudolfs Änderungswunsch): Anzahl-Dialog für
	 * Ausrüstung (Rechtsklick auf eine Ausrüstungs-Zeile im modernen
	 * Ausrüstungs-Tab). Eingabefeld mit der aktuellen Anzahl, −/+1-Pfeil-
	 * tasten wie bei Zähigkeit/Korruption in der Stammleiste (Klemmung bei
	 * 1 - ein Item bewusst auf 0 zu reduzieren ist nicht vorgesehen,
	 * dafür gibt es die Löschen-Taste mit Sicherheitsfrage), Übernehmen und
	 * Abbruch; das Schließen über X ruft keinen Button-Callback auf und
	 * gilt damit wie Abbruch. Auch direkt getippte Werte werden beim
	 * Übernehmen auf mindestens 1 geklemmt. Der Dialog erfasst nur
	 * Ausrüstung - Waffen/Rüstungen behalten ihr Standard-Kontextmenü.
	 *
	 * A6v9 (Testrunde 8, Fund 3): Die Tasten im Dialog-Inhalt (−/+1,
	 * Löschen) reagierten in v8 nicht. DialogV2 rendert asynchron (symbDialog
	 * feuert den Render ohne await) und serialisiert den Inhalt über den
	 * Content-Part - Listener, die VOR dem Öffnen am Element hängen,
	 * überleben das nicht. Die Verdrahtung läuft deshalb erst NACH dem
	 * Render am live gerenderten Fenster (dlg.element).
	 */
	async _openEquipmentDialog(item) {
		const localize = (key) => game.i18n.localize(key);
		const current = Math.max(1, parseInt(item.system.number ?? 1, 10) || 1);
		/* AP2 v2: "Trennen" nur anbieten, wenn das Item stapelbar UND der
		   Stapel größer als 1 ist (der Rest-Stapel muss mindestens 1
		   behalten, sonst ist Trennen dasselbe wie Löschen). */
		const splittable = isStackableItem(item) && current > 1;
		const html = await foundry.applications.handlebars.renderTemplate(
			'systems/symbaroum/template/sheet/modern/equipment-dialog.hbs',
			{ number: current, splittable }
		);
		/* Handle auf den Anzahl-Dialog vorab deklarieren, damit die
		   Sicherheitsfrage ihn nach dem Bestätigen schließen kann. */
		let dlg = null;
		dlg = symbDialog({
			title: item.name,
			content: html,
			classes: this._modernDialogClasses('modern-equip-dialog'),
			width: 440,
			buttons: {
				confirm: {
					icon: '<i class="fas fa-check"></i>',
					label: localize('MODERN.APPLY'),
					callback: async (html) => {
						const v = parseInt(html[0].querySelector('#meq-number')?.value, 10);
						if (!isNaN(v) && v !== current) await item.update({ 'system.number': Math.max(1, v) });
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: localize('BUTTON.CANCEL'),
					callback: async (html) => {},
				},
			},
		});
		/* Auf den abgeschlossenen Render warten (kein force - löst keinen
		   zweiten Renderlauf aus, wartet aber, bis das Fenster samt Inhalt
		   steht), dann die Dialog-Tasten am LIVE-Element verdrahten. */
		await dlg.render();
		const root = dlg.element;
		if (!root) return;
		const input = root.querySelector('#meq-number');
		for (const btn of root.querySelectorAll('.m-eq-btn')) {
			btn.addEventListener('click', () => {
				const next = Math.max(1, (parseInt(input.value, 10) || 1) + Number(btn.dataset.dir));
				input.value = next;
			});
		}
		/* AP2 v2 (Stapel trennen): Die Trennen-Taste öffnet den Split-
		   Dialog; die Validierung/Klemmung übernimmt splitStackItem. */
		root.querySelector('.m-eq-split')?.addEventListener('click', () => {
			this._openSplitDialog(item, current);
		});
		root.querySelector('.m-eq-delete')?.addEventListener('click', () => {
			/* Sicherheitsfrage (Ja/Nein) - der Item-Name wird über
			   textContent gesetzt und kann deshalb kein HTML einschleppen. */
			const question = document.createElement('p');
			question.className = 'm-eq-confirm';
			question.textContent = game.i18n.format('MODERN.EQUIP_DELETE_CONFIRM', { name: item.name });
			const confirmWrap = document.createElement('div');
			confirmWrap.appendChild(question);
			symbDialog({
				title: localize('MODERN.DELETE'),
				content: confirmWrap,
				classes: this._modernDialogClasses(),
				buttons: {
					confirm: {
						icon: '<i class="fas fa-check"></i>',
						label: localize('BUTTON.YES'),
						callback: async () => {
							dlg?.close?.();
							await item.delete();
						},
					},
					cancel: {
						icon: '<i class="fas fa-times"></i>',
						label: localize('BUTTON.NO'),
						callback: async () => {},
					},
				},
			});
		});
	}

	/* AP2 v2 (Stapel trennen): Zweiter Dialog hinter der Trennen-Taste des
	   Anzahl-Dialogs. Fragt die abzutrennende Anzahl (Default 1, Klemmung
	   1..number-1 in splitStackItem), legt dann eine Kopie mit dieser
	   Anzahl an und senkt die Anzahl des Quell-Stapels. Die Eingabe wird
	   im symbDialog-Confirm-Callback aus dem serialisierten Content gelesen
	   (gleiche Technik wie der Anzahl-Dialog selbst). */
	async _openSplitDialog(item, current) {
		const localize = (key) => game.i18n.localize(key);
		const html = await foundry.applications.handlebars.renderTemplate(
			'systems/symbaroum/template/sheet/modern/split-dialog.hbs',
			{ max: Math.max(1, current - 1) }
		);
		symbDialog({
			title: localize('STACK.SPLIT_TITLE'),
			content: html,
			classes: this._modernDialogClasses('modern-split-dialog'),
			width: 380,
			buttons: {
				confirm: {
					icon: '<i class="fas fa-cut"></i>',
					label: localize('STACK.SPLIT_LABEL'),
					callback: async (html) => {
						const v = parseInt(html[0].querySelector('#meq-split-number')?.value, 10);
						if (isNaN(v)) return;
						await splitStackItem(this.actor, item, v);
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: localize('BUTTON.CANCEL'),
					callback: async () => {},
				},
			},
		});
	}

	/**
	 * A6: Währungs-Dialog für die kompakte Geldanzeige der Stammleiste.
	 * Nutzt das <symbaroum-currency>-Element (Delta-Syntax, A38); das Element
	 * hält den aktuellen Basiswert im value-Attribut.
	 */
	async _openMoneyDialog() {
		if (!this.isEditable || !this.actor.isOwner) return;
		const localize = (key) => game.i18n.localize(key);
		const currency =
			typeof this.actor.system.currency === 'number' ? Math.max(0, Math.round(this.actor.system.currency)) : 0;
		const content = `<div class="symbaroum modern-money-dialog"><symbaroum-currency value="${currency}"></symbaroum-currency></div>`;
		symbDialog({
			title: localize('TITLE.MONEY'),
			content: content,
			classes: this._modernDialogClasses('modern-money-dialog'),
			width: 440,
			buttons: {
				confirm: {
					icon: '<i class="fas fa-check"></i>',
					label: localize('BUTTON.CONFIRM'),
					callback: async (html) => {
						const el = html[0].querySelector('symbaroum-currency');
						if (!el) return;
						const total = Math.max(0, Math.round(Number(el.getAttribute('value')) || 0));
						await this.actor.update({ 'system.currency': total });
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: localize('BUTTON.CANCEL'),
					callback: async (html) => {},
				},
			},
		});
	}

	/* ----------------------------------------------------------------
	 * Behältersystem (Projekt "Behälter" v1): Zeilen-Interaktion
	 * --------------------------------------------------------------- */

	/**
	 * Kollaps-Zustand eines Behälters umschalten. Gespeichert als User-Flag
	 * flags.symbaroum.containerCollapsed.<itemId> - pro Nutzer, damit SL und
	 * Spieler unabhängig voneinander klappen können (Muster wie die A6-
	 * Design-Flags). unsetFlag löscht den Eintrag (offen = kein Flag).
	 */
	async _onContainerCollapseToggle(event) {
		event.preventDefault();
		const row = event.currentTarget.closest('.m-container-row[data-container-id]');
		const id = row?.dataset.containerId;
		if (!id) return;
		const flags = game.user.getFlag('symbaroum', 'containerCollapsed') ?? {};
		if (flags[id]) await game.user.unsetFlag('symbaroum', `containerCollapsed.${id}`);
		else await game.user.setFlag('symbaroum', 'containerCollapsed.' + id, true);
		this.render();
	}

	/**
	 * Status-Chips des Behälters: "mitgeführt" (carried) und "zählt zur
	 * Last" (countLoad). carried = false erzwingt countLoad = false
	 * (Rudolfs Implikation - kein dritter Zustand); der countLoad-Chip
	 * wird ohne carried im Template ausgeblendet bzw. gesperrt.
	 */
	async _onContainerFlagToggle(event) {
		event.preventDefault();
		if (!this.actor.isOwner) return;
		const btn = event.currentTarget;
		const row = btn.closest('[data-container-id]');
		const container = this.actor.items.get(row?.dataset.containerId);
		const flag = btn.dataset.flag;
		if (!container || container.type !== 'container' || !flag) return;
		if (flag === 'carried') {
			const carried = !container.system.carried;
			const update = { 'system.carried': carried };
			if (!carried) update['system.countLoad'] = false;
			await container.update(update);
		} else if (flag === 'countLoad') {
			if (!container.system.carried) return;
			await container.update({ 'system.countLoad': !container.system.countLoad });
		}
	}

	/** Entnahme-Taste einer Kinderzeile: Item zurück ins Inventar. */
	async _onContainerTakeOut(event) {
		event.preventDefault();
		if (!this.actor.isOwner) return;
		const div = event.currentTarget.closest('.item');
		if (!div?.dataset.itemId) return;
		const item = this.actor.items.get(div.dataset.itemId);
		if (item) await removeItemFromContainer(item);
	}

	/**
	 * Kontextdialog eines Behälters (Rechtsklick auf die Behälterzeile):
	 * Fassungsvermögen, Icon, die beiden Zustände, Geld einlagern/
	 * entnehmen (atomar mit dem Aktor-Geld, Anforderung G) sowie die
	 * beiden Löschen-Pfade (Inhalt zurück vs. mitlöschen). Die Tasten im
	 * Inhalt werden - A6v9-Lernweis - ERST NACH dem Render am live
	 * gerenderten Fenster verdrahtet.
	 */
	async _openContainerDialog(container) {
		const localize = (key) => game.i18n.localize(key);
		const s = container.system;
		const currency = Math.max(0, Math.round(Number(s.currency) || 0));
		const capacity = Math.max(0, Number(s.capacity) || 0);
		const content = `
		<div class="symbaroum modern-container-dialog">
			<div class="m-cont-dlg-grid">
				<label for="mcont-capacity">${localize('CONTAINER.CAPACITY')}</label>
				<input id="mcont-capacity" type="number" min="0" step="0.5" value="${capacity}" data-tooltip="${localize('CONTAINER.CAPACITY_TOOLTIP')}"/>
				<label for="mcont-carried">${localize('CONTAINER.CARRIED')}</label>
				<input id="mcont-carried" type="checkbox" ${s.carried ? 'checked' : ''}/>
				<label for="mcont-countload">${localize('CONTAINER.COUNT_LOAD')}</label>
				<input id="mcont-countload" type="checkbox" ${s.countLoad ? 'checked' : ''}/>
				<label>${localize('CONTAINER.MONEY_IN_CONTAINER')}</label>
				<span class="m-cont-dlg-money">${formatCurrency(currency)}</span>
				<label for="mcont-money">${localize('CONTAINER.MONEY_TRANSFER')}</label>
				<input id="mcont-money" type="number" step="1" value="0" data-tooltip="${localize('CONTAINER.MONEY_TRANSFER_HINT')}"/>
			</div>
			<p class="m-cont-dlg-hint">${localize('CONTAINER.DELETE_HINT')}</p>
			<div class="m-cont-dlg-actions">
				<button type="button" class="m-cont-btn" data-act="return"><i class="fas fa-arrow-rotate-left"></i> ${localize('CONTAINER.DELETE_RETURN')}</button>
				<button type="button" class="m-cont-btn m-cont-btn-danger" data-act="purge"><i class="fas fa-trash"></i> ${localize('CONTAINER.DELETE_PURGE')}</button>
			</div>
		</div>`;
		/* Handle vorab deklarieren, damit die Sicherheitsfrage den Dialog
		   nach dem Bestätigen schließen kann. */
		let dlg = null;
		dlg = symbDialog({
			title: container.name,
			content,
			classes: this._modernDialogClasses('modern-container-dialog'),
			width: 480,
			buttons: {
				confirm: {
					icon: '<i class="fas fa-check"></i>',
					label: localize('MODERN.APPLY'),
					callback: async (html) => {
						const root = html[0];
						const carried = !!root.querySelector('#mcont-carried')?.checked;
						let countLoad = !!root.querySelector('#mcont-countload')?.checked;
						if (!carried) countLoad = false; // Implikation erzwingen
						const updates = {
							'system.capacity': Math.max(0, Number(root.querySelector('#mcont-capacity')?.value) || 0),
							'system.carried': carried,
							'system.countLoad': countLoad,
						};
						const money = Math.round(Number(root.querySelector('#mcont-money')?.value) || 0);
						await container.update(updates);
						if (money !== 0) await changeContainerCurrency(this.actor, container, money);
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: localize('BUTTON.CANCEL'),
					callback: async (html) => {},
				},
			},
		});
		/* Erst nach dem abgeschlossenen Render am live gerenderten Fenster
		   verdrahten (DialogV2 serialisiert den Inhalt, A6v9-Lernweis). */
		await dlg.render();
		const root = dlg.element;
		if (!root) return;
		for (const btn of root.querySelectorAll('.m-cont-btn')) {
			btn.addEventListener('click', () => {
				this._confirmContainerDelete(container, btn.dataset.act, dlg);
			});
		}
	}

	/**
	 * Sicherheitsfrage vor dem Behälter-Löschen: zwei Pfade (dnd5e-Muster)
	 * - "return": Inhalt zurück ins Inventar (Referenzen löschen)
	 * - "purge":  Behälter und kompletten Inhalt löschen (rekursiv)
	 */
	_confirmContainerDelete(container, mode, dlg) {
		const localize = (key) => game.i18n.localize(key);
		const children = getContainerChildren(this.actor, container.id);
		/* Testrunde-1-Fix (6.2): DialogV2 verlangt ein attributefreies
		   Content-Element ("config.content element must have no attributes")
		   - die Klasse darf nur auf dem KINDELEMENT liegen (symbDialog-
		   Muster, siehe Kommentar in symbDialog.js). */
		const wrapper = document.createElement('div');
		const p = document.createElement('p');
		p.className = 'm-cont-confirm';
		p.textContent =
			mode === 'purge'
				? game.i18n.format('CONTAINER.DELETE_PURGE_CONFIRM', { count: children.length, name: container.name })
				: game.i18n.format('CONTAINER.DELETE_RETURN_CONFIRM', { count: children.length, name: container.name });
		wrapper.appendChild(p);
		symbDialog({
			title: localize('MODERN.DELETE'),
			content: wrapper,
			classes: this._modernDialogClasses(),
			buttons: {
				confirm: {
					icon: '<i class="fas fa-check"></i>',
					label: localize('BUTTON.YES'),
					callback: async () => {
						dlg?.close?.();
						if (mode === 'purge') await deleteContainerWithContents(this.actor, container);
						else await deleteContainerKeepContents(this.actor, container);
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: localize('BUTTON.NO'),
					callback: async () => {},
				},
			},
		});
	}

	/**
	 * A6: Favoriten-Stern umschalten (Item-Flag flags.symbaroum.favorite -
	 * pro Charakter, da Items eingebettet sind). Re-render des Blatts
	 * erfolgt über die Item-Aktualisierung automatisch.
	 */
	async _onFavoriteToggle(event) {
		event.preventDefault();
		if (!this.actor.isOwner) return;
		const div = event.target.closest('.item');
		if (!div?.dataset.itemId) return;
		const item = this.actor.items.get(div.dataset.itemId);
		if (!item) return;
		if (item.flags?.symbaroum?.favorite) {
			await item.unsetFlag('symbaroum', 'favorite');
		} else {
			await item.setFlag('symbaroum', 'favorite', true);
		}
	}

	/**
	 * A6v4 (Testrunde 3): Zähigkeit und temporäre Korruption in der Stammleiste
	 * über die beiden ±1-Tasten (.m-vital-btn, data-field toughness|corruption,
	 * data-dir -1|1). Zähigkeit wird auf 0..max geklemmt, die temporäre
	 * Korruption auf >= 0. Nur der Aktor-Besitzer darf ändern; das Re-Render
	 * des Blatts erfolgt über die Aktor-Aktualisierung automatisch.
	 * A6v7 (Rudolfs Änderungswünsche): + erhöht die temporäre Korruption nur
	 * noch bis „Absolut“ (Abso.) - die Gesamt-Korruption (temporary +
	 * longterm + permanent, abgeleitet in system.health.corruption.value)
	 * kann über die Taste das Maximum nicht mehr überschreiten; − senkt
	 * unverändert bis 0.
	 */
	async _onModernVitalAdjust(event) {
		event.preventDefault();
		if (!this.actor.isOwner) return;
		const btn = event.currentTarget.closest('.m-vital-btn');
		if (!btn) return;
		const dir = Number(btn.dataset.dir) > 0 ? 1 : -1;
		const live = this.actor.system;
		if (btn.dataset.field === 'toughness') {
			const t = live.health.toughness;
			const max = Number(t.max) || 0;
			let value = Math.max(0, (Number(t.value) || 0) + dir);
			if (max > 0) value = Math.min(value, max);
			if (value !== t.value) await this.actor.update({ 'system.health.toughness.value': value });
		} else if (btn.dataset.field === 'corruption') {
			const cor = live.health.corruption;
			let value = Math.max(0, (Number(cor.temporary) || 0) + dir);
			if (dir > 0 && Number(cor.max) > 0) {
				const others = (Number(cor.value) || 0) - (Number(cor.temporary) || 0);
				const cap = Number(cor.max) - others;
				if (cap >= 0) value = Math.min(value, cap);
			}
			if (value !== cor.temporary) await this.actor.update({ 'system.health.corruption.temporary': value });
		}
	}
}
