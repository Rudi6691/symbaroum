import { SymbaroumActorSheet } from './actor.js';
import { prepareRollAttribute, prepareRollDeathTest } from '../common/dialog.js';
import { symbDialog } from '../common/symbDialog.js';

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
		return buttons;
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
		context.cssClass = this.isEditable ? 'editable' : 'locked';
		context.editable = this.isEditable;

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
		return context;
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
		let system = foundry.utils.deepClone(this.actor.system);
		system.id = this.actor.id;

		const html = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/sheet/attributes.hbs', {
			id: this.actor.id,
			system: system,
		});
		let title = game.i18n.localize('TITLE.ATTRIBUTES');
		let dialog = symbDialog({
			//              label: "toto",
			title: title,
			content: html,
			buttons: {
				confirm: {
					icon: '<i class="fas fa-check"></i>',
					label: game.i18n.localize('BUTTON.CONFIRM'),
					callback: async (html) => {
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
					},
				},
				cancel: {
					icon: '<i class="fas fa-check"></i>',
					label: game.i18n.localize('BUTTON.CANCEL'),
					callback: async (html) => {},
				},
			},
		});
	}
}
