import { isStackableItem } from '../common/stacking.js';
// Übergabe v1: Geben-Button der Titelzeile (Dialog/Consent/Socket in transfer.js)
import { openGiveDialog } from '../common/transfer.js';
// Item-Sheet-Modernisierung v1: die moderne Ansicht der Item-Blätter folgt
// dem GLOBALEN Umschalter pro Nutzer (Rudolfs Entscheidung 27.10.) - schaltet
// ein Nutzer sein Spieler-/Monsterblatt um, gelten ALLE seiner Blätter
// (inkl. Items) als modern; klassische Item-Templates bleiben erhalten.
import { getModernSheetUserStyle, getModernSheetEffectiveDesign } from '../common/modernSheetConfig.js';
import { symbDialog } from '../common/symbDialog.js';
import { allocateFromBase, getDenominations } from '../common/currency.js';

const { api, sheets } = foundry.applications;

/**
 * Foundry V14: the typed sheet base classes (ActorSheetV2, ItemSheetV2,
 * DocumentSheetV2) are NOT renderable on their own - they must be composed
 * with HandlebarsApplicationMixin, which provides _renderHTML/_replaceHTML
 * for static PARTS template rendering (official V14 API docs; 7.2.1 lesson:
 * the error only surfaces on the first render() call, not on load).
 */
const SymbaroumItemSheetBase = api.HandlebarsApplicationMixin(sheets.ItemSheetV2);

/**
 * Base class for all Symbaroum item sheets, built on ApplicationV2
 * (V14 migration, phase 2 step 3).
 *
 * The context keeps the V13 getData() shape (id, item, bonuses, isOwned,
 * system, cssClass, editable, symbaroumOptions, action_types) so the
 * handlebars templates stay as close to V13 as possible. Additionally the
 * RAW (unenriched) system clone is provided as context.rawSystem - the
 * prose-mirror editors keep the raw value in their value attribute while
 * the enriched HTML is their display content (7.2.2 rawBio pattern).
 */
export class SymbaroumItemSheet extends SymbaroumItemSheetBase {
	static DEFAULT_OPTIONS = {
		classes: ['symbaroum', 'sheet', 'item'],
		sheetConfig: false,
		window: {
			icon: false,
			// 7.2.10 A5-light: resizable again like the V13 core default;
			// the 7.2.7 window-content overflow fix scrolls the content
			// when the item window is shrunk instead of clipping it.
			resizable: true,
			// V13 _getHeaderButtons "Posten" - under V14 sheet-defined controls
			// render as header controls (in the toggle-controls dropdown, like
			// the actor sheet's death roll/recover buttons).
			controls: [
				{
					action: 'postItem',
					icon: 'fas fa-comment',
					label: 'BUTTON.POST_ITEM',
				},
			],
		},
		form: {
			submitOnChange: true,
		},
		actions: {
			postItem: function (event) {
				event.preventDefault();
				this.sendToChat();
			},
			activateAbility: async function (event) {
				event.preventDefault();
				if (!this.item.isOwned) {
					return;
				}
				this.item.actor.usePower(this.item);
			},
			powerDelete: function (event) {
				this._onPowerDelete(event);
			},
			powerCreate: function (event) {
				this._onPowerCreate(event);
			},
			// Item-Sheet-Modernisierung v1: Kopf-Interaktionen der modernen Ansicht
			openPriceDialog: function (event) {
				this._onOpenPriceDialog(event);
			},
			quantityPlus: function (event) {
				this._onQuantityAdjust(event, 1);
			},
			quantityMinus: function (event) {
				this._onQuantityAdjust(event, -1);
			},
			// Übergabe v1: Item an Anwesenden/Charakter/NPC übergeben (transfer.js)
			giveItem: function (event) {
				this._onGiveItem(event);
			},
			/* ItemSheets v2.1 (Bonus-Tab-Überarbeitung): Caret-Stepper am
			   Modifikator-Feld - Klemmung -10/+10 (Rudolfs Vorgabe). */
			bonusMinus: function (event) {
				this._onBonusAdjust(event, -1);
			},
			bonusPlus: function (event) {
				this._onBonusAdjust(event, 1);
			},
		},
	};

	/**
	 * Single content part - the tabs stay part of the template (V13 look,
	 * minimal template risk), same strategy as the actor sheets (7.2.0).
	 * Each subclass declares its own PARTS entry with its template.
	 */

	/**
	 * Prepare the render context (V13 getData shape, see class comment).
	 */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.id = this.item.id;
		context.item = this.item;
		context.bonuses = game.symbaroum.config.BONUS_FIELDS;
		context.isOwned = this.item.isOwned;
		context.system = foundry.utils.deepClone(this.item.system);
		// RAW clone BEFORE enrichAllFields replaces the description fields
		// in place - the prose-mirror value attributes need the raw text.
		context.rawSystem = foundry.utils.deepClone(this.item.system);
		await this.enrichAllFields(context);
		context.symbaroumOptions = {
			isGM: game.user.isGM,
			allowShowReference: game.settings.get('symbaroum', 'allowShowReference'),
		};
		context.action_types = game.symbaroum.config.ACTION_TYPES;
		// Bestienkunde v1 (Rudolfs Freigabe 28.10.): Kategorie-Dropdown nur
		// auf Bestienkunde-Items (Adept-Tab, klassisch + modern); die Labels
		// werden vorlokalisiert, damit selectOptions ohne localize-Helper
		// arbeitet (gleiche Liste wie der A36-Monsterkategorien-Dialog,
		// inklusive Flora/Phaenomen und der leeren "keine Kategorie"-Option)
		context.isBeastlore = this.item.system.reference === "beastlore";
		context.beastlore_category_selection = Object.values(game.symbaroum.config.CREATURE_CATEGORY_SELECTION).map((c) => ({
			id: c.id,
			label: game.i18n.localize(c.label),
		}));
		/* Ressourcen v1: Ressourcen-Kategorie nur auf Ausrüstungs-Blättern und
		   nur für den GM (Kategorie-Taxonomie ist Welt-/SL-Sache, Muster der
		   GM-Referenz; Spieler sehen die Wirkung - ausgegraute Checkbox,
		   Kontextmenü -, nicht die Zuweisung). Labels vorlokalisiert
		   (selectOptions ohne localize-Helper, Muster Bestienkunde oben);
		   undefined (Alt-Items) und '' sind beide „keine". */
		context.showResourceCategory = this.item.type === "equipment" && !!game.user.isGM;
		context.resourceCategory = this.item.system.resourceCategory ?? "";
		context.resource_category_selection = Object.values(game.symbaroum.config.RESOURCE_CATEGORY_SELECTION).map((c) => ({
			id: c.id,
			label: game.i18n.localize(c.label),
		}));
		context.cssClass = this.isEditable ? 'editable' : 'locked';
		context.editable = this.isEditable;
		/* AP2 v2 (Uniform-Regel): Effektiver Stapelbar-Zustand für die
		   Checkboxen der Gear-Blätter (Waffe/Rüstung/Ausrüstung/Artefakt).
		   Bewusst VORBERECHNET statt im Template entschieden: Ausrüstung
		   ohne Artefakt-Flag ist bei undefined default STAPELBAR - die
		   Checkbox muss "checked" zeigen, sonst würde der erste Form-Submit
		   false schreiben und das Default-Merging abschalten. Umgekehrt
		   zeigen Waffen/Rüstungen/Artefakte bei undefined "unchecked". */
		context.stackableChecked = isStackableItem(this.item);
		/* Item-Sheet-Modernisierung v1: renderModern schaltet jedes der 11
		   Item-Blätter in den modernisierten Zweig seines Wurzel-Templates -
		   EXAKT wie am Aktorblatt (A6): Welt-Setting aktiviert, individuelle
		   Präferenz des Nutzers (User-Flag, Fallback: Design-Default) wählt
		   die Ansicht. Die modernen Kontextdaten werden nur im modernen Zweig
		   aufgebaut (Kosten nur zahlen, wenn die Ansicht aktiv ist). */
		const modernEnabled = !!game.settings.get('symbaroum', 'modernSheetEnabled');
		context.renderModern = !!(modernEnabled && getModernSheetUserStyle() === 'modern');
		if (context.renderModern) {
			context.modern = this._prepareModernItemContext(getModernSheetEffectiveDesign());
			/* ItemSheets v2.1 (Bonus-Tab-Überarbeitung, Rudolfs Testrunde 2):
			   Modifikatoren-Zweispalter - links die 8 Eigenschaften, rechts
			   die Wertefelder. Bewusst HIER vorbereitet (Booleans fertig in
			   JS statt Template-Logik, Muster des modernen Kopfes): die
			   Labels der umbenannten Felder werden auf moderne Keys
			   umgebogen ("Zäh. Max"->"Zähigkeit", "Zäh. Schmerzgrenze"->
			   "Schmerzgrenze", "Absolut"->"Korruptionsgrenze"); die Config-
			   Arrays (script/common/config.js) bleiben unberührt, die
			   klassische Ansicht zeigt weiter die Original-Labels.
			   Rüstungen hängen ihr Behinderungs-Feld in armor.js an (nach
			   super-Aufruf). */
			const MODERN_BONUS_LABELS = {
				'system.bonus.toughness.max': 'MODERN_ITEM.BONUS_TOUGHNESS',
				'system.bonus.toughness.threshold': 'MODERN_ITEM.BONUS_PAIN_THRESHOLD',
				'system.bonus.corruption.threshold': 'MODERN_ITEM.BONUS_CORRUPTION_THRESHOLD',
				'system.bonus.corruption.max': 'MODERN_ITEM.BONUS_CORRUPTION_LIMIT',
			};
			const withModernLabel = (b) => ({ ...b, label: MODERN_BONUS_LABELS[b.name] ?? b.label });
			const isAttributeBonus = (b) => ['accurate', 'cunning', 'discreet', 'persuasive', 'quick', 'resolute', 'strong', 'vigilant']
				.includes(b.name.split('.')[2]);
			context.modern.bonusAttributes = context.bonuses.filter(isAttributeBonus).map(withModernLabel);
			context.modern.bonusStats = context.bonuses.filter((b) => !isAttributeBonus(b)).map(withModernLabel);
		}
		return context;
	}

	/**
	 * Bind the sheet interactions to the freshly rendered content.
	 * The power delete/create anchors and the activate-ability buttons are
	 * handled via the actions map (data-action attributes in the templates);
	 * this only re-binds the tab navigation on the V13 markup.
	 */
	async _onRender(context, options) {
		await super._onRender(context, options);
		const element = this.element;
		if (element.querySelector('.sheet-tabs')) {
			this.tabs ??= new foundry.applications.ux.Tabs({
				navSelector: '.sheet-tabs',
				contentSelector: '.sheet-body',
				initial: 'description',
			});
			this.tabs.bind(element);
		}
		// Teil 3 (Preisbasis): das Geld-Element im Preisfeld ist bewusst nicht
		// form-assoziiert (kein stilles Beschreiben von system.price beim
		// normalen Form-Submit). Änderungen kommen als bubbling change-Event
		// mit detail.value und werden hier als Basis-Integer (Orteg)
		// geschrieben. Der Guard verhindert Updates über das Altformat
		// {value, denomination} hinweg - das zeigt der Migrationshinweis an.
		const currencyElements = element.querySelectorAll('symbaroum-currency');
		for (const el of currencyElements) {
			el.addEventListener('change', (ev) => {
				if (!this.isEditable || !this.item.isOwner) return;
				if (typeof this.item.system.price !== 'number' && typeof this.item.system.price !== 'string') return;
				const total = Math.max(0, Math.round(Number(ev.detail?.value ?? el.getAttribute('value')) || 0));
				this.item.update({ 'system.price': total });
			});
		}
		// Test round 2, finding 1: Enter/Tab in an input commits via
		// submitOnChange and the re-rendered .window-content starts scrolled
		// back to the top - with the restored window scrolling (7.2.8) the
		// artifact power list jumped up on every commit while entering
		// further powers. The window scroll position is remembered and
		// restored across these re-renders.
		const content = element.querySelector('.window-content');
		if (content) {
			content.scrollTop = this._windowScrollTop ?? 0;
			content.addEventListener(
				'scroll',
				() => {
					this._windowScrollTop = content.scrollTop;
				},
				{ passive: true }
			);
		}
		// ItemSheets v3.2 (Rudolf's test round 5, findings 3+7): in the
		// modern layout .window-content no longer scrolls - the scroll
		// container is .m-item-body. The full re-render after stepper
		// clicks (bonus tab) and checkbox commits (weapon/armor status
		// tab) used to reset it to the top of the window. Same
		// remember/restore logic as the .window-content block above;
		// the selector stays null in the classic view (no .m-item-body).
		const itemBody = element.querySelector('.m-item-body');
		if (itemBody) {
			itemBody.scrollTop = this._itemBodyScrollTop ?? 0;
			itemBody.addEventListener(
				'scroll',
				() => {
					this._itemBodyScrollTop = itemBody.scrollTop;
				},
				{ passive: true }
			);
		}
		// Test round 2 addendum, V13 parity: the cursor stays in the input
		// field across a submitOnChange re-render (Rudolf's report: editing
		// a property of a new power kept the cursor in V13). ApplicationV1
		// preserved the focus, ApplicationV2 does not - the focused form
		// control is captured in _renderHTML (the old content is still in
		// the DOM there) and restored here. preventScroll leaves the scroll
		// handling to the restore above.
		if (this._activeElement) {
			const { name, selectionStart, selectionEnd } = this._activeElement;
			this._activeElement = null;
			const restore = element.querySelector(`[name="${name}"]`);
			if (restore && !restore.disabled) {
				restore.focus({ preventScroll: true });
				if (typeof selectionStart === 'number' && typeof restore.setSelectionRange === 'function') {
					try {
						restore.setSelectionRange(selectionStart, selectionEnd);
					} catch (error) {
						// setSelectionRange is not supported for every input
						// type - the restored focus alone matches V13.
					}
				}
			}
		}
	}

	/**
	 * Remember the focused form control before the rendered content is
	 * replaced - at this point of the render pipeline the old element is
	 * still in the DOM, so :focus resolves against the pre-render state.
	 * _onRender restores the focus on the freshly rendered content.
	 */
	async _renderHTML(context, options) {
		const element = this.element;
		const active = element?.querySelector(':focus');
		this._activeElement = null;
		if (
			active &&
			['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName) &&
			active.name
		) {
			this._activeElement = {
				name: active.name,
				selectionStart: active.selectionStart,
				selectionEnd: active.selectionEnd,
			};
		}
		return super._renderHTML(context, options);
	}

	async enrichAllFields(data) {
		let enrichedFields = [
			'system.description',
			'system.novice.description',
			'system.adept.description',
			'system.master.description',
		];

		if (foundry.utils.hasProperty(data, 'system.power')) {
			for (let key in data.system.power) {
				enrichedFields.push(`system.power.${key}.description`);
			}
		}

		await this._enrichTextFields(data, enrichedFields);
	}

	/**
	 * Delete one power entry of the dynamic artifact power list.
	 *
	 * Test round 2, finding 2: the legacy "-=N" deletion key no longer
	 * works through this.submit(). DocumentSheetV2._prepareSubmitData
	 * merges updateData twice - once with deletion handling, once without;
	 * since V14 the legacy key is migrated to a ForcedDeletion operator in
	 * the first pass and DROPPED in the second, so the deletion never
	 * reached the document (Foundry logged a deprecation warning and the
	 * power simply stayed). The form is committed first (silently via
	 * render:false - this harvests open prose-mirror editors, the V2
	 * replacement of the V13 updateOutstandingMCEValues call), then the
	 * deletion is applied directly on the item with the V14 operator
	 * syntax (foundry.data.operators.ForcedDeletion).
	 */
	async _onPowerDelete(event) {
		event.preventDefault();
		if (!this.isEditable) {
			return;
		}
		const div = event.target.closest('.power-n');
		if (!div) {
			return;
		}
		const powerId = parseInt(div.dataset.powerId);
		if (isNaN(powerId)) {
			return;
		}
		// 1) Commit the current form state silently - unsaved editor content
		//    of the REMAINING powers is preserved.
		await this.submit({ render: false });
		// 2) Delete the entry and re-index the list on the committed data.
		const arr = foundry.utils.deepClone(this.item.system.power) ?? {};
		if (!(powerId in arr)) {
			return;
		}
		delete arr[powerId];
		const vals = Object.values(arr);
		const powers = {};
		for (let i = 0; i < vals.length; i++) {
			powers[i] = vals[i];
		}
		// The re-indexed list is shorter than the stored one - the now
		// dangling last key needs an explicit forced deletion.
		powers[vals.length] = new foundry.data.operators.ForcedDeletion();
		await this.item.update({ 'system.power': powers });
	}

	/**
	 * Append a new empty power entry to the dynamic artifact power list.
	 *
	 * Test round 2, finding 4: updateData must only ADD the new power key.
	 * The first version replaced the whole system.power object with a clone
	 * of the committed data - the submit merge then overwrote the freshly
	 * harvested form values, so an open, unsaved prose-mirror editor lost
	 * its content whenever a new power was added. Only the new key is
	 * passed now; the harvested values of the existing powers survive the
	 * merge.
	 */
	async _onPowerCreate(event) {
		event.preventDefault();
		if (!this.isEditable) {
			return;
		}
		const arr = this.item.system.power ?? {};
		const newKey = Object.keys(arr).length;
		await this.submit({
			updateData: {
				[`system.power.${newKey}`]: { name: '', description: '', action: '', corruption: '' },
			},
		});
	}

	/* ================================================================
	 * Item-Sheet-Modernisierung v1: moderne Ansicht der Item-Blätter
	 * ================================================================ */

	/**
	 * Kontextdaten des modernisierten fixen Kopfes (Rudolfs Entscheidungen
	 * 27.10.): Bild + Name immer; Preis kompakt mit Klick -> Währungsdialog
	 * nur bei Preis-Items (weapon/armor/equipment/container, Teil-3-Integer);
	 * Gewicht nur bei Gegenständen (die klassische Gewichtsauswahl bleibt als
	 * select erhalten); Anzahl nur bei Typen mit Anzahl-Verwaltung, die
	 * ±-Pfeile NUR bei stapelbaren Items (isStackableItem - AP2 v2
	 * Uniform-Regel), sonst schlichtes Anzeige-Feld. Die Aufteilung des
	 * Basispreises in Thaler/Schilling/Orteg für den Kopf-Chip folgt dem
	 * Muster der Aktor-Stammleiste (allocateFromBase).
	 */
	_prepareModernItemContext(design) {
		const item = this.item;
		const type = item.type;
		const priceTypes = ['weapon', 'armor', 'equipment', 'container'];
		const weightTypes = ['weapon', 'armor', 'equipment', 'container', 'artifact'];
		const numberTypes = ['weapon', 'armor', 'equipment', 'artifact'];
		const showPrice = priceTypes.includes(type);
		const showWeight = weightTypes.includes(type);
		const showNumber = numberTypes.includes(type);
		const stackable = isStackableItem(item);
		const price = item.system.price;
		const priceExists = typeof price === 'number' || typeof price === 'string';
		const modern = {
			theme: design?.theme === 'classic' ? 'classic' : 'dark',
			showPrice,
			showWeight,
			showNumber,
			stackable,
			showQuantityArrows: showNumber && stackable,
			priceExists,
			/* Ressourcen v1.2 (Rudolfs Testrunde 2, Punkt 4): 0 ist ein
			 * gueltiger Anzeige-Zustand (verbrauchte Ressource) - der
			 * fruehere Fallback "> 0 : 1" hat gespeicherte 0er als "1"
			 * angezeigt und damit den funktionierenden Stepper-Fix
			 * (bis 0 herunterzaehlen) unkenntlich gemacht. Nur
			 * undefined/NaN/Negativ fallen auf den Anzeige-Fallback 1
			 * zurueck (Alt-Items). */
			numberDisplay: Number(item.system.number) >= 0 ? item.system.number : 1,
			weightTooltipKey: type === 'armor' ? 'WEIGHT.TOOLTIP_ARMOR' : 'WEIGHT.TOOLTIP',
		};
		/* Kopf-Zeile 2 (Booleans fertig berechnet - A6-Lernweis: Handlebars
		   hat keinen generischen and-Helper). GM-Referenz mit dem klassischen
		   UND-Gating (isGM + allowShowReference, wie {{#ifat}} am klassischen
		   Blatt); Level nur bei Segen/Last; berechnete Kampfwerte nur bei
		   Waffe/Rüstung; Aktivieren-Button nur bei Fähigkeit/Merkmal/Kraft. */
		const referenceTypes = ['ability', 'trait', 'mysticalPower', 'boon', 'burden'];
		modern.showReference =
			referenceTypes.includes(type) && !!game.user.isGM && !!game.settings.get('symbaroum', 'allowShowReference');
		modern.showLevel = type === 'boon' || type === 'burden';
		modern.showComputed = type === 'weapon' || type === 'armor';
		modern.showActivate = ['ability', 'trait', 'mysticalPower'].includes(type);
		/* Übergabe v1: Geben-Button in der Titelzeile nur bei physischen,
		   gehaltenen Items. Kollisionsfrei zum Aktivieren-Button, weil
		   showActivate die disjunkten Typen Fähigkeit/Merkmal/Kraft betrifft
		   (verifiziert 31.10.) - die Titelzeile ist bei Waffe/Rüstung/
		   Ausrüstung/Artefakt sonst button-frei. Behälter nutzen das
		   klassische Container-Template ohne diesen Header. */
		modern.showGive = ['weapon', 'armor', 'equipment', 'artifact'].includes(type) && !!item.isOwned;
		/* Layout v2 (Rudolfs Entscheidungen 27.10., Testrunde 1): Der Kopf ist
		   in Abschnitts-Bloecke mit m-sec-label gegliedert (Stammleisten-
		   Stil) - BESITZ (Preis/Gewicht/Anzahl, nur Gegenstaende) und WERTE
		   (GM-Referenz/Level/berechnete Kampfwerte). Beide Abschnitte nur
		   rendern, wenn sie Inhalt haben. */
		modern.showPossession = showPrice || showWeight || showNumber;
		/* ItemSheets v3 (Rudolfs Testrunde 3, Punkt 13): Die Segen/Last-Stufe
		   steht jetzt zentriert unter dem Namen im Kopf (nicht mehr im
		   WERTE-Abschnitt) - fuer die Abschnitts-Sichtbarkeit zaehlt sie
		   deshalb nicht mehr mit. */
		modern.showValues = modern.showReference || modern.showComputed;
		/* ItemSheets v3.1 (Rudolfs Testrunde 4, Punkt 7): Rail-Stufen-
		   markierung. V3 hatte die verschachtelten Handlebars-ifs DIREKT im
		   class-Attribut notiert - durch einen Ersetzungsfehler standen dort
		   single Braces ({#if ...}), Handlebars gab sie als Literal in den
		   Klassentext, der erste Token war "modern-rail-btn{#if" und die
		   CSS-Geometrie (.modern-rail-btn) matchte nicht mehr (Rail-Icons
		   klein, ohne Akzent). Lernweis: Keine verschachtelten ifs im
		   Attribut-Body - die Flags werden hier vorbereitet, das Template
		   prueft nur noch einen flachen Boolean. Nur gehaltene Items
		   markieren erlernte Stufen. */
		modern.levelLearned = {
			novice: !!item.isOwned && !!item.system?.novice?.isActive,
			adept: !!item.isOwned && !!item.system?.adept?.isActive,
			master: !!item.isOwned && !!item.system?.master?.isActive,
		};
		if (showPrice && priceExists) {
			const base = Math.max(0, Math.round(Number(price) || 0));
			const denoms = getDenominations();
			const amounts = allocateFromBase(base);
			modern.price = {
				thaler: amounts.thaler ?? 0,
				shilling: amounts.shilling ?? 0,
				orteg: amounts.orteg ?? 0,
				abbrThaler: denoms[0]?.abbreviation ?? '',
				abbrShilling: denoms[1]?.abbreviation ?? '',
				abbrOrteg: denoms[2]?.abbreviation ?? '',
			};
		}
		return modern;
	}

	/**
	 * Theme-Klassen für eigene Dialoge der modernen Item-Ansicht (Muster:
	 * player.js _modernDialogClasses - das Design wird beim Öffnen gelesen,
	 * ein laufender Dialog wechselt nicht live mit).
	 */
	_modernDialogClasses(...extra) {
		const theme = getModernSheetEffectiveDesign()?.theme === 'classic' ? 'classic' : 'dark';
		return ['modern-dialog', `modern-theme-${theme}`, ...extra];
	}

	/**
	 * Währungs-Dialog für den kompakten Preis-Chip des fixen Kopfes (Rudolfs
	 * Anforderung: "Preis wie auf Aktorblättern - kompakte Anzeige, Klick
	 * öffnet Währungsdialog"). Muster: player.js _openMoneyDialog (A6) -
	 * Delta-Syntax des <symbaroum-currency>-Elements, Confirm schreibt den
	 * Basis-Integer. Nur für migrierte Items (priceExists); das Altformat
	 * {value, denomination} wird bewusst nicht still umgestellt.
	 */
	_onOpenPriceDialog(event) {
		event.preventDefault();
		if (!this.isEditable || !this.item.isOwner) return;
		const localize = (key) => game.i18n.localize(key);
		const price = this.item.system.price;
		if (typeof price !== 'number' && typeof price !== 'string') return;
		const currency = Math.max(0, Math.round(Number(price) || 0));
		const content = `<div class="symbaroum modern-item-money-dialog"><symbaroum-currency value="${currency}"></symbaroum-currency></div>`;
		symbDialog({
			title: localize('TITLE.MONEY'),
			content: content,
			classes: this._modernDialogClasses('modern-item-money-dialog'),
			width: 440,
			buttons: {
				confirm: {
					icon: '<i class="fas fa-check"></i>',
					label: localize('BUTTON.CONFIRM'),
					callback: async (html) => {
						const el = html[0].querySelector('symbaroum-currency');
						if (!el) return;
						const total = Math.max(0, Math.round(Number(el.getAttribute('value')) || 0));
						await this.item.update({ 'system.price': total });
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
	 * ±-Pfeile der Anzahl im fixen Kopf - NUR bei stapelbaren Items (das
	 * Template blendet die Pfeile für nicht-stapelbare Items aus). Klemmung
	 * bei 1 wie der Ausrüstungs-Dialog des Aktorblatts (A6v8/v9: "Übernehmen"
	 * klemmt getippte Werte auf >= 1; Löschen ist der eigene Weg). Alt-Items
	 * ohne Anzahl zählen als 1 (AP2-Fallback).
	 */
	async _onQuantityAdjust(event, delta) {
		event.preventDefault();
		if (!this.isEditable || !this.item.isOwner) return;
		if (!isStackableItem(this.item)) return;
		const stored = this.item.system.number;
		/* Ressourcen v1, Testrunde 1 (Rudolfs Punkt-4-Kommentar): Der
		 * Stepper darf bei physischen Items BIS 0 herunterzaehlen - Menge 0
		 * ist ein gueltiger Zustand (verbrauchte Ressource, Zeile bleibt
		 * stehen). Klemmung daher >= 0 statt >= 1; 0 selbst bleibt bei Minus
		 * stehen (kein Durchfallen ins Negative), Plus zaehlt von 0 wieder
		 * hoch. Ungespeicherte/nicht-numerische Alt-Werte starten wie bisher
		 * bei 1 (Anzeige-Fallback). */
		const base = typeof stored === 'number' && stored >= 0 ? Math.round(stored) : 1;
		const next = Math.max(0, base + delta);
		if (next === base) return;
		await this.item.update({ 'system.number': next });
	}

	/**
	 * Übergabe v1: Geben-Button der Titelzeile öffnet den Übergabe-Dialog
	 * für das gehaltene Item (Quelle = besitzender Aktor). Nur über
	 * gehaltene Items (Kompendiums-Items haben keinen Aktor); Rechte und
	 * Consent-Flow prüft transfer.js.
	 */
	_onGiveItem(event) {
		event.preventDefault();
		const actor = this.item?.actor;
		if (!actor || !this.item.isOwned) return;
		openGiveDialog(actor, this.item);
	}

	/**
	 * ItemSheets v2.1 (Bonus-Tab-Überarbeitung): Caret-Stepper für die
	 * Modifikator-Felder - gleiche Optik wie die Anzahl-Pfeile im Kopf.
	 * Ober-/Untergrenze: Feld war unbegrenzt, Rudolfs Vorgabe -10/+10
	 * (Klemmung hier UND min/max-Attribute am Input im Template).
	 * Alt-Werte undefined/'' zählen als 0 (Foundry rendert sie als 0).
	 */
	async _onBonusAdjust(event, delta) {
		event.preventDefault();
		if (!this.isEditable || !this.item.isOwner) return;
		/* ItemSheets v3.1 (Rudolfs Testrunde 4, Punkt 5): ApplicationV2
		   reicht den Klick-Buttons nicht als event.currentTarget durch -
		   currentTarget ist das Sheet-Root, dataset.name dort leer, der
		   Handler stieg kommentarlos aus (die Stepper wirketen "tot",
		   seit v2.1 ungetestet). Der Weg ist das zweite Handler-Argument
		   bzw. hier der Zielbutton via closest('[data-action]'). Die
		   Kopf-Anzahl-Stepper funktionierten, weil ihr Handler (bewusst)
		   kein data-name am Button liest. */
		const button = event.target?.closest?.('[data-action]') ?? null;
		const name = button?.dataset?.name;
		if (!name || !name.startsWith('system.')) return;
		const stored = foundry.utils.getProperty(this.item, name);
		const base = Number.isFinite(Number(stored)) ? Math.round(Number(stored)) : 0;
		const next = Math.min(10, Math.max(-10, base + delta));
		if (next === base) return;
		await this.item.update({ [name]: next });
	}

	async sendToChat() {
		const itemData = {};
		itemData.system = foundry.utils.duplicate(this.item.system);
		game.symbaroum.log('sendToChat data:', itemData);
		itemData.img = this.item.img;
		itemData.name = this.item.name;
		itemData.enrichedName = `@UUID[${this.item.uuid}]{${this.item.name}}`;
		if (itemData.img.includes('/unknown')) {
			itemData.img = null;
		}
		await this.enrichAllFields(itemData);
		await this._enrichTextFields(itemData, ['enrichedName']);

		const html = await foundry.applications.handlebars.renderTemplate(
			'systems/symbaroum/template/chat/item.hbs',
			itemData
		);
		const chatData = {
			user: game.user.id,
			speaker: ChatMessage.getSpeaker({
				alias: this.item.actor?.name ?? game.user.name,
				actor: this.item.actor?.id,
			}),
			rollMode: game.settings.get('core', 'messageMode'),
			content: html,
		};
		if (['gm', 'blind'].includes(chatData.rollMode)) {
			chatData.whisper = ChatMessage.getWhisperRecipients('GM');
		} else if (chatData.rollMode === 'self') {
			chatData.whisper = [game.user];
		}
		ChatMessage.create(chatData);
	}

	async _enrichTextFields(data, fieldNameArr) {
		for (let t = 0; t < fieldNameArr.length; t++) {
			if (foundry.utils.hasProperty(data, fieldNameArr[t])) {
				foundry.utils.setProperty(
					data,
					fieldNameArr[t],
					await foundry.applications.ux.TextEditor.enrichHTML(foundry.utils.getProperty(data, fieldNameArr[t]), {
						async: true,
					})
				);
			}
		}
	}
}
