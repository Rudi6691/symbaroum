import { isStackableItem } from '../common/stacking.js';
// Übergabe v1: Geben-Button der Titelzeile (Dialog/Consent/Socket in transfer.js)
import { openGiveDialog } from '../common/transfer.js';
// Item-Sheet-Modernisierung v1: die moderne Ansicht der Item-Blätter folgt
// dem GLOBALEN Umschalter pro Nutzer (Rudolfs Entscheidung 27.10.) - schaltet
// ein Nutzer sein Spieler-/Monsterblatt um, gelten ALLE seiner Blätter
// (inkl. Items) als modern; klassische Item-Templates bleiben erhalten.
import { getModernSheetUserStyle, getModernSheetEffectiveDesign, modernDialogClasses } from '../common/modernSheetConfig.js';
import { symbDialog } from '../common/symbDialog.js';
import { allocateFromBase, getDenominations } from '../common/currency.js';
// Elixier-Automatisierung v1: Munitionswirkung nur auf Munitions-Items anzeigen
import { isAmmoCategory } from '../common/ammo.js';
// Status-Tab v1: „Ist alchemistisch?“-Kanonik (abgeleitete Anzeige für
// Alt-Items ohne Flag) aus elixirs.js
import { isAlchemical } from '../common/elixirs.js';
import { boonNextLevel } from '../common/boon.js';
// Alchemie Modul 3 (Rudolfs Startsignal 04.11.2026): Alchemie-Menü
// (Brauen/Analysieren/Nachbrauen), Nachbrau-Dialog mit Rezeptur-Preset
// und die §6a-Täuschungs-Helfer (brewing.js).
import { openBrewDialog, findAlchemyAbility, restoreDeception, exposeScheinRecipe } from '../common/brewing.js';
// Traditionen v1 (Rudolfs Startsignal „Leg los“ 03.11.2026): zentrale
// Traditions-Kanonik (tradition.js — Single Source für Labels, Feld-
// Auflösung, Zugangsprüfung, Qualitäts-Geheimnisse und die Liste der
// bekannten Traditionen). Hier: Tab-Kontext, Traditions-Dialog-Action
// und die Geheimnis-Chips der Qualitäts-Tabs.
import { resolveItemTraditions, knownTraditionSelection, isForbiddenKnowledge, qualitySecretLabels, parseTraditions } from '../common/tradition.js';

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
			/* Alchemie Modul 3 v1.1 (Rudolfs Testrunde P2a + Freigabe
			   05.11.): Die Menü-Action 'alchemyMenu' (Kolben-Button am
			   Item-Blattkopf, klassisch + modern) ist ENTFALLEN — der
			   Zugang zum Alchemie-Menü läuft jetzt über das FÄHIGKEITS-
			   ICON der Alchemie-Kachel im SPIELERBOGEN (player.js,
			   Kräfte-Tab + Kampf-Tab-Favoriten). */
			/* Alchemie Modul 3 v1.3 (§13 + Rudolfs Testrunde v1.2,
			   Randnotiz b): BRAUEN-Knopf am GEHALTENEN Rezeptur-Item —
			   findet die Alchemie-Fähigkeit am Aktor und öffnet den
			   Brau-Dialog mit dieser Rezeptur als vorausgewähltem
			   Kandidaten (openBrewDialog-Preset; RAW-Modus ohne
			   Rezeptur-Bezug fällt auf den ersten Kandidaten zurück). */
			brewFromRecipe: async function (event) {
				event.preventDefault();
				const actor = this.item?.actor;
				if (!actor) return;
				const ability = findAlchemyAbility(actor);
				if (!ability) {
					ui.notifications.warn(game.i18n.localize('NACHBRAU.ERR_NO_ABILITY'));
					return;
				}
				await openBrewDialog(ability, { presetRecipeId: this.item.id });
			},
			/* Alchemie Modul 3 (§6a): Elixier als UNBEKANNT markieren
			   (GM) — Name/Beschreibung werden durch Platzhalter ersetzt,
			   die Originale wandern ins Flag (resetDeception stellt sie
			   wieder her); Spieler sehen nur den Platzhalter. */
			markUnknown: async function (event) {
				event.preventDefault();
				const item = this.item;
				if (!game.user.isGM || item?.type !== 'equipment' || !isAlchemical(item.system)) return;
				if (item.getFlag('symbaroum', 'fehlbestimmt') || item.getFlag('symbaroum', 'unknownElixir')) {
					ui.notifications.warn(game.i18n.localize('UNKNOWN.MARK_ERR'));
					return;
				}
				await item.setFlag('symbaroum', 'unknownElixir', {
					realName: item.name,
					realDescription: String(item.system?.description ?? ''),
				});
				await item.update({
					name: game.i18n.localize('UNKNOWN.PLACEHOLDER_NAME'),
					'system.description': game.i18n.localize('UNKNOWN.PLACEHOLDER_DESC'),
				});
			},
			/* Alchemie Modul 3 (§6a): Täuschungs-Markierung(en) aufheben
			   (GM) — BEIDE Flags (fehlbestimmt + unknownElixir), Originale
			   wiederherstellen (brewing.js restoreDeception). */
			resetDeception: async function (event) {
				event.preventDefault();
				if (!game.user.isGM) return;
				await restoreDeception(this.item);
			},
			/* Alchemie Modul 3 v1.2 (§6a, Rudolfs Freigabe 04.11., P10):
			   Schein-Rezeptur ENTLARVEN (GM-Knopf am Rezeptur-Banner) —
			   sichtbarer Fälschungs-Marker am Namen, schein-Flag entlarvt
			   (brewing.js exposeScheinRecipe; das Gebräu ergibt weiterhin
			   nur Rückstand, eine Zeitbombe bleibt scharf). */
			exposeSchein: async function (event) {
				event.preventDefault();
				if (!game.user.isGM) return;
				await exposeScheinRecipe(this.item);
			},
			/* Alchemie Modul 3: Nachbrau-Bonus (Actor-Flag 'nachbrauBonus',
			   +1 auf das nächste Gebräu) per GM-Reset entfernen — Banner
			   am Alchemie-Fähigkeits-Item (beide Designs). */
			resetSchein: async function (event) {
				event.preventDefault();
				if (!game.user.isGM) return;
				const actor = this.item?.actor;
				if (actor) await actor.unsetFlag('symbaroum', 'nachbrauBonus');
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
			/* Segen & Lasten S2.1 (P25): Caret-Stepper an der Segen-/
			   Lasten-Stufe (klassisch + modern); XP-Buchung laeuft über
			   die abgeleitete Erfahrungskette automatisch mit. */
			boonLevelPlus: function (event) {
				this._onBoonLevelAdjust(event, 1);
			},
			boonLevelMinus: function (event) {
				this._onBoonLevelAdjust(event, -1);
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
			/* Status-Tab v1.2 (Rudolfs Zustandsdialog, Muster Eigen-
			   schaftsdialog): Zahnrad neben dem Ja/Nein-Select „Bewirkt
			   Zustand“ öffnet den DIALOG mit den Pill-Chips — die Chip-
			   Liste ist aus dem Blatt ausgelagert. Bestätigen schreibt
			   den komma-join direkt per item.update (kein hidden-Input,
			   keine Form-Submit-Landmine); Ids außerhalb der Chip-Liste
			   (Altbestand) bleiben im String erhalten; Abbrechen ver-
			   wirft. Theme-Klassen folgen dem Blatt-Design (modern/
			   klassisch), Kanonik wie context.renderModern. */
			openConditionDialog: async function (event) {
				event.preventDefault();
				const item = this.item;
				if (!item) return;
				const eff = item.system.elixirEffect ?? {};
				const conditionRaw = String(eff.condition ?? '').trim();
				const currentIds = conditionRaw === '' ? [] : conditionRaw.split(',').map((c) => c.trim()).filter(Boolean);
				const chips = this._getElixirConditions(currentIds);
				const html = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/sheet/tab/elixir-condition-dialog.hbs', {
					elixir_conditions: chips,
				});
				const modernEnabled = !!game.settings.get('symbaroum', 'modernSheetEnabled');
				const renderModern = !!(modernEnabled && getModernSheetUserStyle() === 'modern');
				symbDialog({
					title: game.i18n.localize('ELIXIR.FIELD_CONDITION'),
					content: html,
					classes: renderModern ? modernDialogClasses('modern-condition-dialog') : [],
					width: 460,
					buttons: {
						confirm: {
							icon: '<i class="fas fa-check"></i>',
							label: game.i18n.localize('BUTTON.CONFIRM'),
							callback: async (html) => {
								const checkedIds = Array.from(html[0].querySelectorAll('input[data-condition-id]:checked')).map((el) => el.dataset.conditionId);
								/* Alt-Ids ohne Chip (z. B. künftig umbenannte
								   Status) bleiben erhalten statt verloren zu
								   gehen. */
								const chipIds = new Set(chips.map((c) => c.id));
								const preserved = currentIds.filter((id) => !chipIds.has(id));
								const value = [...preserved, ...checkedIds].join(',');
								await item.update({ 'system.elixirEffect.condition': value });
							},
						},
						cancel: {
							icon: '<i class="fas fa-times"></i>',
							label: game.i18n.localize('BUTTON.CANCEL'),
							callback: async () => {},
						},
					},
				});
			},
			/* Traditionen v1 (Rudolfs Startsignal „Leg los“ 03.11.2026):
			   Zahnrad im „Traditionen“-Tab öffnet den Traditions-Dialog
			   (Muster Zustandsdialog v1.2): Pill-Chips der BEKANNTEN
			   Traditionen als Mehrfachauswahl, komma-join direkt per
			   item.update (kein hidden-Input, keine Form-Submit-Landmine);
			   Alt-Ids außerhalb der bekannten Auswahl (z. B. später
			   „unbekannt“ gestellte Traditionen) bleiben im String
			   erhalten. Theme-Klassen folgen dem Blatt-Design. */
			openTraditionDialog: async function (event) {
				event.preventDefault();
				const item = this.item;
				if (!item) return;
				const currentIds = parseTraditions(item.system.traditions);
				const chips = knownTraditionSelection().map((t) => ({
					id: t.id,
					label: t.label,
					checked: currentIds.includes(t.id),
				}));
				const html = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/sheet/tab/tradition-dialog.hbs', {
					traditions: chips,
				});
				const modernEnabled = !!game.settings.get('symbaroum', 'modernSheetEnabled');
				const renderModern = !!(modernEnabled && getModernSheetUserStyle() === 'modern');
				symbDialog({
					title: game.i18n.localize('TRADITION.DIALOG_TITLE'),
					content: html,
					classes: renderModern ? modernDialogClasses('modern-tradition-dialog') : [],
					width: 460,
					buttons: {
						confirm: {
							icon: '<i class="fas fa-check"></i>',
							label: game.i18n.localize('BUTTON.CONFIRM'),
							callback: async (html) => {
								const checkedIds = Array.from(html[0].querySelectorAll('input[data-tradition-id]:checked')).map((el) => el.dataset.traditionId);
								const chipIds = new Set(chips.map((c) => c.id));
								const preserved = currentIds.filter((id) => !chipIds.has(id));
								const value = [...preserved, ...checkedIds].join(',');
								await item.update({ 'system.traditions': value });
							},
						},
						cancel: {
								icon: '<i class="fas fa-times"></i>',
								label: game.i18n.localize('BUTTON.CANCEL'),
								callback: async () => {},
						},
					},
				});
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
		/* Segen & Lasten S2 Baustein B (Rudolfs „Leg los“, 06.11.2026):
		   Kontakte-Gruppierung am Kontakte-Segen (system.contactGroup,
		   Single-Select der 7 offiziellen Fraktionen + 'custom' mit
		   freiem Textfeld system.contactGroupCustom) — nur auf Items mit
		   kanonischer Referenz 'contacts' (Migrations-Makro v2);
		   Spieler-editierbar (Muster VW-desc-Select). Vorlokalisierte
		   Liste (selectOptions ohne localize-Helper). */
		context.showContactGroup =
			this.item.type === 'boon' && String(this.item.system?.reference ?? '').trim() === 'contacts';
		context.contactGroup = this.item.system.contactGroup ?? '';
		context.contactGroupCustom = this.item.system.contactGroupCustom ?? '';
		context.contact_group_selection = Object.values(game.symbaroum.config.CONTACT_GROUP_SELECTION).map((c) => ({
			id: c.id,
			label: game.i18n.localize(c.label),
		}));
		/* Segen & Lasten S2 Baustein A: Augur-Hinweis-Chip am Ritual-Blatt
		   (Rituale haben KEINEN Wurfdialog, Augur bekommt also keine
		   Kontext-Zeile) — nur bei Besitz des Augur-Segens am besitzenden
		   Aktor; Bonus = system.bonusValue (Stapel-Segene = Anzahl der
		   Käufe, Fallback +1). Chip ist reine Information (RAW: +X auf
		   die Rituale Wahrsagen, Heiliger Rauch und Orakel) — das Würfeln
		   übernimmt weiterhin die SL mit dem freien Modifikator. */
		context.augurChip = '';
		if (this.item.type === 'ritual' && this.item.isOwned) {
			const augurItem = this.item.actor?.items?.find(
				(it) => it.type === 'boon' && String(it.system?.reference ?? '').trim() === 'augur'
			);
			if (augurItem) {
				const bonus = Number(augurItem.system?.bonusValue) || 1;
				context.augurChip = game.i18n.format('BOON.AUGUR_RITUAL_HINT', { bonus });
			}
		}
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
		/* Ressourcen v1 + Munitionsverbrauch v1: Ressourcen-Kategorie auf
		   Ausruestungs- UND Waffen-Blaettern (Wurfspeer-Waffen sind als
		   Speerschleuder-Munition selbst Ressourcen-Stapel) und nur fuer
		   den GM (Kategorie-Taxonomie ist Welt-/SL-Sache, Muster der
		   GM-Referenz; Spieler sehen die Wirkung - ausgegraute Checkbox,
		   Kontextmenue -, nicht die Zuweisung). Labels vorlokalisiert
		   (selectOptions ohne localize-Helper, Muster Bestienkunde oben);
		   undefined (Alt-Items) und '' sind beide „keine". */
		context.showResourceCategory = ["equipment", "weapon"].includes(this.item.type) && !!game.user.isGM;
		context.resourceCategory = this.item.system.resourceCategory ?? "";
		context.resource_category_selection = Object.values(game.symbaroum.config.RESOURCE_CATEGORY_SELECTION).map((c) => ({
			id: c.id,
			label: game.i18n.localize(c.label),
		}));
		/* Brauen v1 (Rudolfs Freigabe 02.11.): Labor-Qualität
		   (system.facilityCategory) auf Ausrüstungs-Blättern, GM-only
		   (Labor-Taxonomie ist Welt-/SL-Sache, Muster Ressourcen-Kategorie);
		   steuert den Bonus auf die Scharfsinn-Probe des Brau-Dialogs
		   (brewing.js), '' = kein Labor. Labels vorlokalisiert
		   (selectOptions ohne localize-Helper). */
		context.showFacilityCategory = this.item.type === 'equipment' && !!game.user.isGM;
		context.facilityCategory = this.item.system.facilityCategory ?? '';
		context.facility_category_selection = Object.values(game.symbaroum.config.FACILITY_CATEGORY_SELECTION).map((c) => ({
			id: c.id,
			label: game.i18n.localize(c.label),
		}));
		/* Alchemie Modul 3 v1.1 (Rudolfs Testrunde P2a + Freigabe
		   05.11.): showAlchemyMenu ist ENTFALLEN — der Menü-Button am
		   Item-Blattkopf (klassisch + modern) ist raus, der Zugang
		   läuft über das Fähigkeits-Icon der Alchemie-Kachel im
		   Spielerbogen (player.js). */
		/* Alchemie Modul 3 v1.3 (Rudolfs Testrunde v1.2, Randnotiz b): Der
		   Nachbrau-Knopf am gehaltenen Rezeptur-Item ist durch einen
		   BRAUEN-Knopf ersetzt (klassischer Avatar + moderne Kopfzeile,
		   data-action 'brewFromRecipe') — er öffnet den Brau-Dialog mit
		   dieser Rezeptur als vorausgewähltem Kandidat; der Nachbrau-
		   Dialog bleibt über die KritErf-Übergabe der Analyse erreichbar. */
		context.showBrewRecipe = this.item.type === 'rezeptur' && !!this.item.isOwned;
		/* Alchemie Modul 3 (§6a): GM-Anzeigen — Täuschungs-Banner am
		   Elixier-Item (Fehlbestimmung/Unbekannt, beide Status-Designs),
		   Markier-Knopf, Schein-Banner am Rezeptur-Item (beide Designs),
		   Bonus-Banner am Alchemie-Fähigkeits-Item (GM-Reset). Texte
		   vorlokalisiert (Lernweis: keine dynamischen Template-Keys). */
		if (game.user.isGM) {
			const fehlFlag = this.item.getFlag('symbaroum', 'fehlbestimmt');
			const unknownFlag = this.item.getFlag('symbaroum', 'unknownElixir');
			if (this.item.type === 'equipment' && (fehlFlag || unknownFlag)) {
				context.deceptionBanner = fehlFlag
					? {
							stackWide: !!fehlFlag.stackWide,
							text: game.i18n.format('UNKNOWN.BANNER_FEHL', { name: fehlFlag.realName }),
							stackText: game.i18n.localize('UNKNOWN.BANNER_STACK'),
						}
					: {
							stackWide: false,
							text: game.i18n.format('UNKNOWN.BANNER_UNKNOWN', { name: unknownFlag.realName }),
							stackText: game.i18n.localize('UNKNOWN.BANNER_STACK'),
						};
			}
			context.showMarkUnknown =
				this.item.type === 'equipment' && isAlchemical(this.item.system) && !fehlFlag && !unknownFlag;
			const scheinFlag = this.item.getFlag('symbaroum', 'schein');
			if (this.item.type === 'rezeptur' && scheinFlag) {
				context.scheinBanner = {
					recipeName: scheinFlag.recipeName,
					/* v1.2 (P10): exposed steuert den Entlarven-Knopf am
					 * Banner (Template {{#unless scheinBanner.exposed}}).
					 * Sammel-Fix v1.3 (Rudolfs Testrunde v1.2, Punkt 6):
					 * Entlarvte Rezepturen zeigen ihre eigene Banner-
					 * Variante, damit der Zustand sichtbar bleibt. */
					exposed: !!scheinFlag.entlarvt,
					text: scheinFlag.entlarvt
						? game.i18n.format('SCHEIN.BANNER_EXPOSED', { recipeName: scheinFlag.recipeName })
						: game.i18n.format('SCHEIN.RECIPE_BANNER', { recipeName: scheinFlag.recipeName }),
				};
			}
			if (
				this.item.type === 'ability' &&
				this.item.system?.reference === 'alchemy' &&
				this.item.actor?.getFlag('symbaroum', 'nachbrauBonus')
			) {
				context.scheinBonusBanner = game.i18n.localize('SCHEIN.BONUS_BANNER');
			}
		}
		/* Munitionsverbrauch v1: waffenseitige Munitions-Konfiguration
		   (system.ammunition = { category, amount }, GM-only auf dem
		   Waffenblatt - leere Kategorie = kein Verbrauch). */
		context.showAmmunition = this.item.type === "weapon" && !!game.user.isGM;
		context.ammunitionCategory = this.item.system.ammunition?.category ?? "";
		context.ammunitionAmount = this.item.system.ammunition?.amount ?? 1;
		context.ammo_category_selection = Object.values(game.symbaroum.config.AMMO_CATEGORY_SELECTION).map((c) => ({
			id: c.id,
			label: game.i18n.localize(c.label),
		}));
		/* Elixier-Automatisierung v1 (Rudolfs Freigabe 01.11.): Elixier-
		   Steuerung auf dem Ausrüstungsblatt, GM-only (Item-Taxonomie wie
		   die Ressourcen-Kategorie). Drei Selects (Alchemie-Stufe, Verwen-
		   dungsform, Munitionswirkung - letztere nur auf Munitions-Items)
		   plus die maschinenlesbaren Wirkungsfelder (system.elixirEffect)
		   als gemeinsames Partial. Vorlokalisierte Auswahllisten (Muster
		   Bestienkunde oben); undefined (Alt-Items) und '' sind beide
		   „keine/leer“. */
		context.showElixirFields = this.item.type === 'equipment' && !!game.user.isGM;
		context.alchemyLevel = this.item.system.alchemyLevel ?? '';
		context.alchemy_level_selection = Object.values(game.symbaroum.config.ALCHEMY_LEVEL_SELECTION).map((c) => ({
			id: c.id,
			label: game.i18n.localize(c.label),
		}));
		context.elixirUsage = this.item.system.elixirUsage ?? '';
		context.elixir_usage_selection = Object.values(game.symbaroum.config.ELIXIR_USAGE_SELECTION).map((c) => ({
			id: c.id,
			label: game.i18n.localize(c.label),
		}));
		/* Alchemie Modul 3 v1.3 (Rudolfs Testrunde v1.2, Randnotiz a):
		   GM-Dropdown „Analyse-Spuren“ (system.analysisTrace, beide
		   Status-Designs) — überschreibt die automatisch abgeleitete
		   Spur-Kategorie der Analyse (brewing.js elixirCategoryKey);
		   '' = automatisch (Wirkungsfelder). */
		context.analysisTrace = String(this.item.system.analysisTrace ?? '');
		context.analysis_trace_selection = [
			{ id: '', label: game.i18n.localize('ANALYSE.TRACE_AUTO') },
			{ id: 'heals', label: game.i18n.localize('ANALYSE.CAT_HEALS') },
			{ id: 'poisons', label: game.i18n.localize('ANALYSE.CAT_POISONS') },
			{ id: 'explodes', label: game.i18n.localize('ANALYSE.CAT_EXPLODES') },
			{ id: 'corruption', label: game.i18n.localize('ANALYSE.CAT_CORRUPTION') },
			{ id: 'alters', label: game.i18n.localize('ANALYSE.CAT_ALTERS') },
			{ id: 'unknown', label: game.i18n.localize('ANALYSE.CAT_UNKNOWN') },
			/* Sammel-Fix v1.4 (Rudolfs Testrunde v1.3, Punkt-7-Kommentar
			   „Weitere Spuren ergänzen: Blendet, Verwirrt, Verätzt,
			   Vernebelt, Betäubt, Verletzt, Enthüllt, Entgiftet"):
			   acht weitere Spuren-Kategorien im GM-Dropdown — reine
			   Anzeige, gleiche Override-Mechanik (brewing.js). */
			{ id: 'blinded', label: game.i18n.localize('ANALYSE.CAT_BLINDED') },
			{ id: 'confused', label: game.i18n.localize('ANALYSE.CAT_CONFUSED') },
			{ id: 'corroded', label: game.i18n.localize('ANALYSE.CAT_CORRODED') },
			{ id: 'dazed', label: game.i18n.localize('ANALYSE.CAT_DAZED') },
			{ id: 'stunned', label: game.i18n.localize('ANALYSE.CAT_STUNNED') },
			{ id: 'wounded', label: game.i18n.localize('ANALYSE.CAT_WOUNDED') },
			{ id: 'revealed', label: game.i18n.localize('ANALYSE.CAT_REVEALED') },
			{ id: 'detoxified', label: game.i18n.localize('ANALYSE.CAT_DETOXIFIED') },
			/* Segen & Lasten S2 Baustein D (Rudolfs Korrektur meiner
			   Ausschluss-Empfehlung, 06.11.): „beruhigt“ als weitere
			   Spuren-Kategorie — reine Anzeige/Override, gleiche
			   Mechanik (brewing.js TRACE_OVERRIDE). Ein reines
			   Beruhigt-Elixier (nur eff.condition) bleibt Auto-
			   Ableitung „unbekannte Wirkung“, die SL setzt die Spur. */
			{ id: 'calmed', label: game.i18n.localize('ANALYSE.CAT_CALMED') },
		];
		context.showAmmoEffect = context.showElixirFields && isAmmoCategory(this.item.system?.resourceCategory ?? '');
		context.ammoEffect = this.item.system.ammoEffect ?? '';
		context.ammo_effect_selection = Object.values(game.symbaroum.config.AMMO_EFFECT_SELECTION).map((c) => ({
			id: c.id,
			label: game.i18n.localize(c.label),
		}));
		/* Elixier-Automatisierung v1.2: Zustandsheilung am Anwender
		   (Augentropfen heilt Geblendet) - Select mit verifizierten Ids. */
		context.removeCondition = this.item.system.elixirEffect?.removeCondition ?? '';
		context.remove_condition_selection = Object.values(game.symbaroum.config.ELIXIR_REMOVE_CONDITION_SELECTION).map((c) => ({
			id: c.id,
			label: game.i18n.localize(c.label),
		}));
		/* Status-Tab v1.1 (Rudolfs Freigabe): Werfenprobe als
		   Attribut-Dropdown statt Frei-Text-Kürzel - '' = „Keine“
		   (ungehinderte Auslösung), sonst die 8 Attribute. */
		context.resist_attribute_selection = [
			{ id: '', label: game.i18n.localize('ELIXIR.RESIST_NONE') },
			...Object.values(game.symbaroum.config.ATTRIBUTE_SELECTION).map((c) => ({
				id: c.id,
				label: game.i18n.localize(c.label),
			})),
		];
		/* Status-Tab v1.2 (Rudolfs Zustandsdialog): „Bewirkt Zustand“ ist
		   ein Ja/Nein-Gate (system.elixirEffect.conditionActive,
		   additives Feld, Muster alchemical/weaponPoison) - die Zustände
		   selbst wählt der DIALOG über das Zahnrad (Action
		   openConditionDialog, Chip-Quelle _getElixirConditions inkl.
		   acid-Träger-Filter). Der komma-join bleibt im Feld
		   system.elixirEffect.condition gespeichert (auch bei „Nein“,
		   dann greift das GATE in elixirs.js und die Zustände wirken
		   NIRGENDS). */
		const conditionString = String(this.item.system.elixirEffect?.condition ?? '').trim();
		const conditionActiveIds = conditionString === '' ? [] : conditionString.split(',').map((c) => c.trim()).filter(Boolean);
		/* Status-Tab v1.3 (Rudolfs Nachtest v1.2, Punkte 9+10): DREI
		   Gate-Zustände - '' = Altbestand ohne Gate-Feld (Ableitung aus
		   condition ODER targetCondition: das Tagging-Makro v7 taggt
		   Blitzstaub/Nebelball nur per targetCondition, die v1.2-
		   Ableitung zeigte dafür fälschlich „Nein“ und blockte den
		   Wurf-Pfad - v1.2-Regression), 'true' = bewusst Ja, 'false' =
		   bewusst Nein (dreiwertig statt v1.2 '' = Nein: das Gate ließ
		   sich bei gespeicherten Zuständen nicht auf „Nein“ stellen,
		   weil der leere Wert sofort wieder als „aus condition ableiten“
		   galt). Der Select rendert/persistiert nur 'true'/'false' -
		   die Altbestand-Ableitung persistiert beim ersten Form-Submit
		   (Muster alchemical-Kanonik). Die Dialog-Chips zeigen die
		   Vereinigung aus condition UND targetCondition an, damit der
		   Altbestand-Fallback im Dialog sichtbar und steuerbar ist
		   (Bestätigen schreibt nach condition, targetCondition bleibt
		   als Fallback unangetastet). */
		const targetConditionString = String(this.item.system.elixirEffect?.targetCondition ?? '').trim();
		const targetConditionIds = targetConditionString === '' ? [] : targetConditionString.split(',').map((c) => c.trim()).filter(Boolean);
		const conditionGateRaw = String(this.item.system.elixirEffect?.conditionActive ?? '').trim();
		const hasLegacyCondition = conditionActiveIds.length > 0 || targetConditionIds.length > 0;
		context.conditionActive = conditionGateRaw === 'true' || conditionGateRaw === 'false' ? conditionGateRaw : hasLegacyCondition ? 'true' : 'false';
		context.elixir_conditions = this._getElixirConditions([...new Set([...conditionActiveIds, ...targetConditionIds])]);
		/* Status-Tab v1.1 (Rudolfs Ergänzung): ReadOnly-Alchemiestufe
		   auf dem Beschreibungs-Tab - nur bei alchemistisch=„Ja“,
		   Spieler-sichtbar, nicht editierbar; '' = „Keine“. */
		const alchemyEntry = context.alchemyLevel ? game.symbaroum.config.ALCHEMY_LEVEL_SELECTION[context.alchemyLevel] : null;
		context.alchemyLevelLabel = alchemyEntry ? game.i18n.localize(alchemyEntry.label) : game.i18n.localize('ALCHEMY_LEVEL.NONE');
		/* Status-Tab v1 (Rudolfs Freigabe 02.11.): „Ist alchemistisch?“
		   (system.alchemical, ''/'true') - Anzeige-Initial nach Rudolfs
		   Entscheidung: „Ja“ nur bei gefüllten Wirkungsfeldern, nur
		   Verwendungsform gesetzt = „Nein“ (das Tagging v7 hat die
		   Verwendungsform auf ALLE Gear-Items geschrieben). isAlchemical
		   (elixirs.js) löst das für Alt-Items ohne Flag ab; gespeicherte
		   Werte gewinnen. Der Select persistiert beim ersten Form-Submit.
		   showAlchemy gatet die Alchemieeigenschaften im Status-Tab. */
		context.alchemical = isAlchemical(this.item.system) ? 'true' : '';
		context.showAlchemy = context.showElixirFields && context.alchemical === 'true';
		context.elixirEffect = this.item.system.elixirEffect ?? {};
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
		/* Traditionen v1 (Rudolfs Startsignal „Leg los“ 03.11.2026):
		   Kontext für den GM-only „Traditionen“-Tab (alle Item-Blätter),
		   die read-only Beschreibungs-Tab-Anzeige und die Chips. Das
		   Gate ist dreiwertig (Muster „Bewirkt Zustand“ v1.3): '' =
		   Altbestand-Ableitung (Ritual mit gefülltem Freitext gilt als
		   „Ja“), 'true'/'false' = bewusst gesetzt, persistiert erst beim
		   Submit. „Verbotenes Wissen“-Segen (isForbiddenKnowledge) nutzt
		   dasselbe Feld als Single-Select (selected = erste Id).
		   displayLabels = anzeigebare Labels im Beschreibungs-Tab
		   (VW zeigt immer, Standard-Items nur bei Gate „Ja“). */
		const tk = resolveItemTraditions(this.item);
		const tkIsVW = isForbiddenKnowledge(this.item);
		context.tradition_knowledge = {
			active: tk.active,
			isForbiddenKnowledge: tkIsVW,
			selected: tk.ids.length > 0 ? tk.ids[0] : '',
			knownSelection: knownTraditionSelection(),
			labels: tk.labels,
			displayLabels: tkIsVW || tk.active === 'true' ? tk.labels : [],
		};
		/* Traditionen v1: vorlokalisierte „Geheimnis: <Tradition>“-Labels
		   der APG-Qualitäts-Map (QUALITY_TRADITION_MAP, Vault „Geheimnisse
		   der Traditionen“) für die Chips in den Qualitäts-Tabs — nur
		   Waffen-/Rüstungs-Blätter werten die Map aus. */
		context.quality_secret_labels = qualitySecretLabels();
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
		// Sammel-Fix v1.1 (Testrunde 1): VW-Single-Select im Beschreibungs-
		// Tab des Segen-Blatts (boon.hbs klassisch + modern, data-traditions-
		// desc) — SPIELER-editierbar. Bewusst NICHT form-assoziiert (kein
		// name-Attribut): das GM-Tab-Partial trägt bereits name="system.
		// traditions"; ein zweiter form-assoziierter Select desselben Namens
		// würde beim Submit gegen den anderen Select arbeiten (FormData:
		// letzter Eintrag gewinnt). Änderung wird wie die Preisbasis direkt
		// per item.update geschrieben (gleiche Landminen-Vermeidung wie der
		// Zustands-/Traditionen-Dialog).
		const descTradSelects = element.querySelectorAll('[data-traditions-desc]');
		for (const sel of descTradSelects) {
			sel.addEventListener('change', () => {
				if (!this.isEditable || !this.item.isOwner) return;
				this.item.update({ 'system.traditions': sel.value });
			});
		}
		// Segen & Lasten S2 Baustein B: Kontakte-Gruppierung am Kontakte-
		// Segen (boon.hbs klassisch + modern) — wie das VW-desc-Select
		// bewusst NICHT form-assoziiert (kein name-Attribut): die Werte
		// laufen als bubbling change direkt per item.update in die
		// Systemdaten (gleiche Landminen-Vermeidung wie Preisbasis und
		// Zustands-/Traditionen-Dialog). Select = Fraktion ('' oder
		// Fraktion oder 'custom'), Textfeld nur bei 'custom' aktiv.
		const contactGroupSelect = element.querySelector('[data-contact-group]');
		if (contactGroupSelect) {
			contactGroupSelect.addEventListener('change', () => {
				if (!this.isEditable || !this.item.isOwner) return;
				this.item.update({ 'system.contactGroup': contactGroupSelect.value });
			});
		}
		const contactGroupCustomInput = element.querySelector('[data-contact-group-custom]');
		if (contactGroupCustomInput) {
			contactGroupCustomInput.addEventListener('change', () => {
				if (!this.isEditable || !this.item.isOwner) return;
				this.item.update({ 'system.contactGroupCustom': String(contactGroupCustomInput.value ?? '').trim() });
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
		/* S2.1 (P25): Bonus/Malus-Feld (system.bonusValue, Fallback-
		   Kette bonusValue → Stufe → +1 in boon.js) — GM-only, im WERTE-
		   Abschnitt des modernen Kopfs; ohne das Feld bliebe bonusValue
		   nur per Makro setzbar. */
		modern.showBonusValue = modern.showLevel && !!game.user.isGM;
		modern.showComputed = type === 'weapon' || type === 'armor';
		modern.showActivate = ['ability', 'trait', 'mysticalPower'].includes(type);
		/* Alchemie Modul 3 v1.1 (Rudolfs Testrunde P2a + Freigabe
		   05.11.): modern.showAlchemyMenu ist ENTFALLEN (Menü-Button
		   im Kopf raus; Zugang: Fähigkeits-Icon der Alchemie-Kachel im
		   Spielerbogen); der Nachbrau-Button am gehaltenen Rezeptur-
		   Item bleibt (gleicher Icon-Stil wie bisher). */
		modern.showBrewRecipe = type === 'rezeptur' && !!item.isOwned;
		/* Übergabe v1: Geben-Button in der Titelzeile nur bei physischen,
		   gehaltenen Items. Kollisionsfrei zum Aktivieren-Button, weil
		   showActivate die disjunkten Typen Fähigkeit/Merkmal/Kraft betrifft
		   (verifiziert 31.10.) - die Titelzeile ist bei Waffe/Rüstung/
		   Ausrüstung/Artefakt sonst button-frei. Behälter nutzen das
		   klassische Container-Template ohne diesen Header. */
		/* Brauen v1.1 (B5): Rezeptur-Items sind gebbar - der Kopf-Button
		   erscheint, weil der RezepturSheet die giveItem-Aktion erbt
		   (gleiche Vererbung wie Waffe/Rüstung/Ausrüstung/Artefakt). */
		modern.showGive = ['weapon', 'armor', 'equipment', 'artifact', 'rezeptur'].includes(type) && !!item.isOwned;
		/* Layout v2 (Rudolfs Entscheidungen 27.10., Testrunde 1): Der Kopf ist
		   in Abschnitts-Bloecke mit m-sec-label gegliedert (Stammleisten-
		   Stil) - BESITZ (Preis/Gewicht/Anzahl, nur Gegenstaende) und WERTE
		   (GM-Referenz/Level/berechnete Kampfwerte). Beide Abschnitte nur
		   rendern, wenn sie Inhalt haben. */
		modern.showPossession = showPrice || showWeight || showNumber;
		/* ItemSheets v3 (Rudolfs Testrunde 3, Punkt 13): Die Segen/Last-Stufe
		   steht jetzt zentriert unter dem Namen im Kopf (nicht mehr im
		   WERTE-Abschnitt) - fuer die Abschnitts-Sichtbarkeit zaehlt sie
		   deshalb nicht mehr mit. S2.1 (P25): das GM-only Bonus/Malus-Feld
	   laesst den WERTE-Abschnitt fuer Segen/Lasten auch OHNE Referenz-
	   Sichtbarkeit erscheinen (GM sieht Bonus-Feld immer). */
		modern.showValues = modern.showReference || modern.showComputed || modern.showBonusValue;
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
	 * Segen & Lasten S2.1 (P25, Rudolfs Freigabe 06.11.2026): Caret-
	 * Stepper fuer die Segen-/Lasten-Stufe im Blattkopf (klassisch +
	 * modern, gleiche data-action). Mindeststufe 1, Maximalstufe „nach
	 * Beschreibung": Config-Map BOON_MAX_LEVEL je kanonischer Referenz,
	 * Standard 3. Ungespeicherte/nicht-numerische Alt-Werte starten bei
	 * 1. XP-Abzug/-Rueckzahlung bei Stufenwechsel geschieht automatisch
	 * ueber die abgeleitete Erfahrungskette (_computeExperienceCost:
	 * 5 XP je Stufe Segen, -5 je Stufe Last → experience.spent/
	 * available werden live neu berechnet, kein Extra-Code noetig).
	 */
	async _onBoonLevelAdjust(event, delta) {
		event.preventDefault();
		if (!this.isEditable || !this.item.isOwner) return;
		const type = this.item.type;
		if (type !== 'boon' && type !== 'burden') return;
		const stored = this.item.system.level;
		const base = typeof stored === 'number' && stored >= 1 ? Math.round(stored) : 1;
		const ref = String(this.item.system.reference ?? '').trim();
		// Klemmung als pure Funktion (boon.js) - gleiche Logik fuer Blatt-
		// Stepper UND Logik-Harness (tools/logic-harness.mjs)
		const next = boonNextLevel(base, delta, ref);
		if (next === base) return;
		await this.item.update({ 'system.level': next });
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
	/**
	 * Status-Tab v1.2 (Rudolfs Zustandsdialog): Chip-Quelle für den
	 * Zustandsdialog - Pill-Chips der System-Status (CONFIG.statusEffects,
	 * V14: id-indiziert, name lokalisiert), interne Träger-Conditions
	 * (acid = Säure-DoT-Engine, elixirheal/elixirregress/elixirattr =
	 * Elixier-Träger) bleiben ausgefiltert. 'checked' aus dem komma-join
	 * des Felds system.elixirEffect.condition; sortiert localeCompare.
	 * Geteilt zwischen dem render-Kontext und der Action openConditionDialog.
	 * @param {string[]} activeIds aktuell gewählte Condition-Ids
	 * @returns {{id: string, label: string, checked: boolean}[]}
	 */
	_getElixirConditions(activeIds) {
		const active = new Set(activeIds ?? []);
		return Object.values(CONFIG.statusEffects)
			.filter((status) => !['acid', 'elixirheal', 'elixirregress', 'elixirattr'].includes(status.id))
			.map((status) => {
				/* Status-Tab v1.3 (Rudolfs Nachtest v1.2, Punkt 6): name
				   liefert bei System-Status teils den rohen i18n-Key
				   („CONDITION.DAZED“) statt der lokalisierten Bezeichnung
				   - existiert der Key, wird lokalisiert, sonst bleibt der
				   Rohwert (bereits lokalisierte Namen haben keinen
				   Key-Treffer). */
				const raw = String(status.name ?? status.label ?? status.id);
				const label = game.i18n.has(raw) ? game.i18n.localize(raw) : raw;
				return { id: status.id, label, checked: active.has(status.id) };
			})
			.sort((a, b) => a.label.localeCompare(b.label));
	}

	/**
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
		/* Traditionen v1: Die Ritual-Zeile der Chat-Karte zeigt die
		   aufgelösten Traditions-Labels statt des Alt-Freitexts
		   (system.tradition bleibt als Datenfeld für die Migration
		   erhalten, ist aber ab v1 keine Anzeige-Quelle mehr). */
		if (this.item.type === 'ritual') {
			itemData.traditionsText = resolveItemTraditions(this.item).labels.join(', ');
		}
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
