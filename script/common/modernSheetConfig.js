/**
 * A6 Blatt-Überarbeitung: Alternative (modernisierte) Spieler- und Monsterblätter.
 *
 * Rudolfs Design-Entscheidungen (25.10.2026, Konzept-Mockup "a6-blatt-konzept"):
 *  - Welt-Settings-Block "Alternative Spieler- und Monsterblätter" (nur GM):
 *    Aktivierungs-Checkbox (Default AUS) + Taste "Designeinstellungen…".
 *  - Der Designeinstellungs-Dialog (GM, registerMenu): Farbwelt (dunkel/klassisch),
 *    Belastungsvariante (Halbrund-Gauge / Segmentring), Tab-Icons
 *    (Foundry Font Awesome free/solid) und die Standard-Ansicht für alle Nutzer.
 *  - Individuelle Präferenz pro Nutzer (klassisch/modern), welt-weit gespeichert:
 *    User-Flags (game.user.setFlag) - Foundry erlaubt Nicht-GM-Nutzern keine
 *    Schreibzugriffe auf Welt-Settings, User-Flags sind genauso welt-persistiert
 *    und pro Nutzer schreibbar (browser-unabhängig).
 *  - Umschalten über einen Icon-Button im Blattkopf (auch für Spieler), wenn die
 *    Alternative in den Welt-Settings aktiviert ist.
 *
 * Design-Werte liegen im Welt-Setting 'modernSheetDesign' (Object). Fehlende
 * Schlüssel werden mit MODERN_SHEET_DEFAULT_DESIGN aufgefüllt - alte Stände
 * bleiben damit kompatibel, wenn später Felder dazukommen.
 */
const { HandlebarsApplicationMixin, Application } = foundry.applications.api;

/** Standard-Design der alternativen Blätter (Rudolfs Mockup-Defaults). */
export const MODERN_SHEET_DEFAULT_DESIGN = {
	theme: 'dark',
	gauge: 'half',
	defaultStyle: 'classic',
	icons: {
		combat: 'fas fa-hand-fist',
		powers: 'fas fa-wand-magic-sparkles',
		gear: 'fas fa-bag-shopping',
		bio: 'fas fa-book-open',
		notes: 'fas fa-feather-pointed',
	},
};

/**
 * Wirksamkeits-Gesamtstand des Designs (gespeichert + Defaults gemischt).
 * @returns {{theme: string, gauge: string, defaultStyle: string, icons: object}}
 */
export function getModernSheetDesign() {
	let stored = {};
	try {
		stored = game.settings.get('symbaroum', 'modernSheetDesign') ?? {};
	} catch {
		stored = {};
	}
	const design = foundry.utils.mergeObject(foundry.utils.deepClone(MODERN_SHEET_DEFAULT_DESIGN), stored);
	// Robustheit gegen leere/icon-only Einträge aus dem Dialog
	for (const key of Object.keys(MODERN_SHEET_DEFAULT_DESIGN.icons)) {
		if (typeof design.icons?.[key] !== 'string' || !design.icons[key].trim()) {
			design.icons[key] = MODERN_SHEET_DEFAULT_DESIGN.icons[key];
		}
	}
	if (design.theme !== 'classic') design.theme = 'dark';
	if (design.gauge !== 'ring') design.gauge = 'half';
	if (design.defaultStyle !== 'modern') design.defaultStyle = 'classic';
	return design;
}

/**
 * Ansicht des aktuellen Nutzers (klassisch/modern). Reihenfolge:
 * User-Flag (individuell) > Design-Default (GM) > klassisch.
 * @returns {'modern'|'classic'}
 */
export function getModernSheetUserStyle() {
	const flagged = game.user.getFlag('symbaroum', 'modernSheetStyle');
	if (flagged === 'modern' || flagged === 'classic') return flagged;
	return getModernSheetDesign().defaultStyle;
}

/**
 * A6v5 (Testrunde 4, Rudolfs Frage): individuelle FARBWELT (dunkel/klassisch)
 * des aktuellen Nutzers für die moderne Ansicht. Gespeichert als User-Flag
 * 'modernSheetTheme' ('dark'|'classic'); UNSET = Welt-Default aus den
 * Designeinstellungen (nur der Nutzer selbst schaltet um - sein Flag gewinnt
 * gegen das Welt-Design, ohne es für andere zu ändern).
 * @returns {'dark'|'classic'|null}
 */
export function getModernSheetUserTheme() {
	const flagged = game.user.getFlag('symbaroum', 'modernSheetTheme');
	if (flagged === 'dark' || flagged === 'classic') return flagged;
	return null;
}

/**
 * Wirksames Design = Welt-Design mit der individuellen Farbwelt des Nutzers
 * (User-Flag > Welt-Default). Nur das theme-Feld wird überschrieben;
 * Gauge/Icons/DefaultStyle bleiben Welt-Sache.
 * @returns {{theme: string, gauge: string, defaultStyle: string, icons: object}}
 */
export function getModernSheetEffectiveDesign() {
	const design = getModernSheetDesign();
	const userTheme = getModernSheetUserTheme();
	if (userTheme) design.theme = userTheme;
	return design;
}

/**
 * Rendert alle offenen Akteursblätter neu (nach Setting-/Design-Änderungen).
 * Testrunde-2-Fund: `Object.values(ui.windows)` lieferte in V14 KEINE
 * Applications mehr (die Registry ist dort iterierbar, kein plain Object) -
 * Designänderungen wirkten deshalb erst nach dem nächsten manuellen Render.
 * Robust gegen alle Registry-Formen: Welt-Akteure über ihr ApplicationV2-
 * Singleton-Sheet (game.actors) plus tolerante Iteration über die offenen
 * Fenster-Registries (deckt Token-Akteure ab).
 */
export function renderAllActorSheets() {
	const seen = new Set();
	// Nur Akteursblätter neu rendern - keine anderen offenen Applications
	// (z. B. Würfel-/Einstellungsdialoge, deren Eingaben ein Re-Render verwerfen würde).
	const isActorSheet = (app) => {
		try {
			return app?.document?.documentName === 'Actor' || app?.actor?.documentName === 'Actor';
		} catch {
			return false;
		}
	};
	const renderIfOpen = (app) => {
		if (!app || seen.has(app) || typeof app.render !== 'function') return;
		if (!isActorSheet(app)) return;
		seen.add(app);
		if (app.rendered === true || app.element) app.render(false);
	};
	for (const actor of game.actors ?? []) renderIfOpen(actor.sheet);
	const registries = [];
	if (typeof ui !== 'undefined' && ui?.windows) registries.push(ui.windows);
	if (game?.windows) registries.push(game.windows);
	for (const registry of registries) {
		if (registry && typeof registry[Symbol.iterator] === 'function') {
			for (const app of registry) renderIfOpen(app);
		} else if (registry) {
			for (const app of Object.values(registry)) renderIfOpen(app);
		}
	}
}

/**
 * GM-Dialog für die Designeinstellungen der alternativen Blätter
 * (analog SymbaroumConfig: HandlebarsApplicationMixin(Application), tag 'form',
 * eigener Submit-Handler, der direkt in das Welt-Setting schreibt).
 */
export class ModernSheetConfig extends HandlebarsApplicationMixin(Application) {
	static DEFAULT_OPTIONS = {
		classes: ['form'],
		tag: 'form',
		form: {
			handler: ModernSheetConfig.#submitHandler,
			closeOnSubmit: true,
			submitOnChange: false,
		},
		position: {
			width: 560,
		},
		window: {
			contentClasses: ['standard-form'],
			title: 'SYMBAROUM.SETTING_MODERNSHEET_DESIGN_TITLE',
			controls: [{ icon: 'fas fa-desktop' }],
		},
		actions: {
			resetDefaults: this._onResetDefaults,
		},
	};

	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/modern-sheet-settings.hbs',
		},
	};

	async _prepareContext(options) {
		const design = getModernSheetDesign();
		return {
			theme: design.theme,
			gauge: design.gauge,
			defaultStyle: design.defaultStyle,
			icons: design.icons,
		};
	}

	static async #submitHandler(event, form, formData) {
		event.preventDefault();
		const formFields = foundry.utils.expandObject(formData.object);
		const clean = (value, fallback) => {
			const text = String(value ?? '').trim();
			return text || fallback;
		};
		await game.settings.set('symbaroum', 'modernSheetDesign', {
			theme: formFields.theme === 'classic' ? 'classic' : 'dark',
			gauge: formFields.gauge === 'ring' ? 'ring' : 'half',
			defaultStyle: formFields.defaultStyle === 'modern' ? 'modern' : 'classic',
			icons: {
				combat: clean(formFields.icons?.combat, MODERN_SHEET_DEFAULT_DESIGN.icons.combat),
				powers: clean(formFields.icons?.powers, MODERN_SHEET_DEFAULT_DESIGN.icons.powers),
				gear: clean(formFields.icons?.gear, MODERN_SHEET_DEFAULT_DESIGN.icons.gear),
				bio: clean(formFields.icons?.bio, MODERN_SHEET_DEFAULT_DESIGN.icons.bio),
				notes: clean(formFields.icons?.notes, MODERN_SHEET_DEFAULT_DESIGN.icons.notes),
			},
		});
		renderAllActorSheets();
	}

	static async _onResetDefaults(event, target) {
		await game.settings.set('symbaroum', 'modernSheetDesign', foundry.utils.deepClone(MODERN_SHEET_DEFAULT_DESIGN));
		renderAllActorSheets();
		this.render(true);
	}
}
