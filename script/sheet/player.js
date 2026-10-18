import { SymbaroumActorSheet } from './actor.js';
import { prepareRollAttribute, prepareRollDeathTest } from '../common/dialog.js';
import { symbDialog } from '../common/symbDialog.js';

/**
 * Context menu for mystical powers / traits / gear on the actor sheet.
 * Filters the menu entries per item document (isVisible receives the Item, not the HTML
 * element) and lets the V14 base ContextMenu handle positioning - this replaces the old
 * AppV1-era manual positioning (former TODO "needs fixing").
 */
class CMPowerMenu extends foundry.applications.ux.ContextMenu {
	constructor(container, selector, menuItems, { eventName = 'contextmenu', onOpen, onClose, jQuery = false, parent } = {}) {
		super(container, selector, menuItems, {
			eventName: eventName,
			onOpen: onOpen,
			onClose: onClose,
			jQuery: jQuery,
		});
		this.myParent = parent;
		this.originalMenuItems = [...menuItems];
	}

	render(target, options) {
		let item = null;
		if (target.dataset.itemId == game.symbaroum.config.noArmorID) {
			// special case
			item = game.symbaroum.config.noArmorID;
		} else {
			item = this.myParent?.actor.items.get(target.dataset.itemId);
		}
		if (item) {
			this.menuItems = this.originalMenuItems.filter((elem) => {
				return elem.isVisible(item);
			});
		} else {
			this.menuItems = this.originalMenuItems;
		}
		return super.render(target, options);
	}
}

export class PlayerSheet extends SymbaroumActorSheet {
	static DEFAULT_OPTIONS = {
		classes: ['symbaroum', 'sheet', 'actor', 'player'],
		position: {
			width: 800,
			height: 1020,
		},
		window: {
			resizable: true,
			controls: [
				{
					action: 'deathRoll',
					icon: 'fas fa-skull',
					label: 'BUTTON.DEATH',
					visible: function () {
						return this.actor?.isOwner ?? false;
					},
				},
				{
					action: 'recover',
					icon: 'fas fa-heart',
					label: 'BUTTON.RECOVER',
					visible: function () {
						return this.actor?.isOwner ?? false;
					},
				},
			],
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

		// Attribute drag support (drag only - the V13 sheet had no drop targets)
		new foundry.applications.ux.DragDrop({
			dragSelector: '.attrDragM[data-attribute]',
			dropSelector: null,
			callbacks: {
				dragstart: (ev) => this._onDragStart(ev),
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
				name: `TOOLTIP.USE_ABILITY`,
				icon: `<i class="fa-solid fa-bolt-lightning"></i>`,
				isVisible: (elem) => {
					if (elem.system?.hasScript && elem.system?.isPower) return true;
					return false;
				},
				callback: (elem) => this._prepareActivateAbility(elem),
			},
			{
				name: 'TOOLTIP.USE_WEAPON',
				icon: `<i class="fa-solid fa-hand-fist"></i>`,
				isVisible: (elem) => {
					return elem.system?.isWeapon && elem.system?.isActive;
				},
				callback: (elem, event) => {
					this._prepareRollWeapon(elem);
				},
			},
			{
				name: 'TOOLTIP.USE_ARMOR',
				icon: `<i class="fa-solid fa-shield"></i>`,
				isVisible: (elem) => {
					return elem == game.symbaroum.config.noArmorID || (elem.system.isArmor && elem.system.isActive);
				},
				callback: (elem, event) => {
					this._prepareRollArmor(elem);
				},
			},
			{
				name: 'TOOLTIP.INCREASE_COUNT',
				icon: `<i class="fa-regular fa-square-plus"></i>`,
				isVisible: (elem) => {
					return elem.system?.isEquipment;
				},
				callback: (elem, event) => {
					this._itemQuantityUpdate(elem, true, false);
				},
			},
			{
				name: game.i18n.format('TOOLTIP.INCREASE_COUNT_DEFAULT', {
					quantity: game.user.getFlag(game.system.id, game.symbaroum.config.CONTEXT_MENU.equipmentAddRemoveFlag),
					sign: '+',
				}),
				icon: `<i class="fa-regular fa-square-plus"></i>`,
				isVisible: (elem) => {
					let quantity = game.user.getFlag(game.system.id, game.symbaroum.config.CONTEXT_MENU.equipmentAddRemoveFlag);
					return elem.system?.isEquipment && quantity;
				},
				callback: (elem, event) => {
					this._itemQuantityUpdate(elem, true, true);
				},
			},
			{
				name: 'TOOLTIP.DECREASE_COUNT',
				icon: `<i class="fa-regular fa-square-minus"></i>`,
				isVisible: (elem) => {
					return elem.system?.isEquipment && elem.system?.number > 0;
				},
				callback: (elem, event) => {
					this._itemQuantityUpdate(elem, false, false);
				},
			},
			{
				name: game.i18n.format('TOOLTIP.DECREASE_COUNT_DEFAULT', {
					quantity: game.user.getFlag(game.system.id, game.symbaroum.config.CONTEXT_MENU.equipmentAddRemoveFlag),
					sign: '-',
				}),
				icon: `<i class="fa-regular fa-square-minus"></i>`,
				isVisible: (elem) => {
					let quantity = game.user.getFlag(game.system.id, game.symbaroum.config.CONTEXT_MENU.equipmentAddRemoveFlag);
					return elem.system?.isEquipment && quantity && quantity <= elem.system?.number;
				},
				callback: (elem, event) => {
					this._itemQuantityUpdate(elem, false, true);
				},
			},
			{
				name: 'TOOLTIP.VIEW_ITEM',
				icon: `<i class="fa-regular fa-eye"></i>`,
				isVisible: (elem) => {
					return elem != game.symbaroum.config.noArmorID;
				},
				callback: (elem, event) => {
					this._itemEdit(elem);
				},
			},
			{
				name: `TOOLTIP.DELETE_ITEM`,
				icon: `<i class='fas fa-trash'></i>`,
				isVisible: (elem) => {
					return elem != game.symbaroum.config.noArmorID;
				},
				callback: (elem) => this._itemDelete(elem),
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
