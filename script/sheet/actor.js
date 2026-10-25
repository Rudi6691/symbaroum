import { symbDialog } from '../common/symbDialog.js';

/**
 * Header controls that ActorSheetV2 adds by default (token configuration and artwork).
 * They are hidden to keep the V13 sheet header: the two symbaroum buttons plus close.
 */
const HIDDEN_TOKEN_CONTROLS = new Set(['configureToken', 'configurePrototypeToken', 'showPortraitArtwork', 'showTokenArtwork']);

const { api, sheets } = foundry.applications;

/**
 * Foundry V14: the typed sheet base classes (ActorSheetV2, ItemSheetV2, DocumentSheetV2)
 * are NOT renderable on their own - they must be composed with HandlebarsApplicationMixin,
 * which provides the _renderHTML and _replaceHTML methods for static PARTS template
 * rendering (official V14 API docs, module foundry.applications.sheets).
 */
const SymbaroumActorSheetBase = api.HandlebarsApplicationMixin(sheets.ActorSheetV2);

/**
 * Base class for all Symbaroum actor sheets, built on ApplicationV2 (V14 migration, phase 2).
 * The sheets keep their V13 context shape (id, actor, system, items, cssClass, editable,
 * symbaroumOptions, attribute_selection) so the handlebars templates stay unchanged.
 */
export class SymbaroumActorSheet extends SymbaroumActorSheetBase {
	static DEFAULT_OPTIONS = {
		classes: ['symbaroum', 'sheet', 'actor'],
		sheetConfig: false,
		ownershipConfig: false,
		window: {
			icon: false,
			resizable: true,
		},
		form: {
			submitOnChange: true,
		},
	};

	/**
	 * Keep the V13 header: no token/artwork controls of the ActorSheetV2 base class.
	 */
	_getHeaderControls() {
		return super._getHeaderControls().filter((control) => !HIDDEN_TOKEN_CONTROLS.has(control.action));
	}

	/**
	 * Bind the sheet interactions to the freshly rendered content.
	 * In contrast to the old activateListeners(html) this runs after every render,
	 * and the queried elements are recreated on each render, so re-binding is safe.
	 */
	async _onRender(context, options) {
		await super._onRender(context, options);
		const element = this.element;

		const addItem = element.querySelectorAll('.item-create');
		for (const s of addItem) {
			s.addEventListener('click', (ev) => {
				this._onItemCreate(ev);
			});
		}
		const editItem = element.querySelectorAll('.item-edit');
		for (const s of editItem) {
			s.addEventListener('click', (ev) => {
				this._onItemEdit(ev);
			});
		}
		const itemState = element.querySelectorAll('.item-state');
		for (const s of itemState) {
			s.addEventListener('click', (ev) => {
				this._onItemStateUpdate(ev);
			});
		}
		const activateAbility = element.querySelectorAll('.activate-ability');
		for (const s of activateAbility) {
			s.addEventListener('click', (ev) => {
				this._onPrepareActivateAbility(ev);
			});
		}
		// A38 Währungssystem: <symbaroum-currency> ist bewusst nicht
		// form-assoziiert (kein stilles Beschreiben von system.currency beim
		// normalen Form-Submit). Änderungen kommen als bubbling change-Event
		// mit detail.value und werden hier in den Aktor geschrieben.
		const currencyElements = element.querySelectorAll('symbaroum-currency');
		for (const el of currencyElements) {
			el.addEventListener('change', (ev) => {
				if (!this.isEditable || !this.actor.isOwner) return;
				const total = Math.max(0, Math.round(Number(ev.detail?.value ?? el.getAttribute('value')) || 0));
				this.actor.update({ 'system.currency': total });
			});
		}
	}

	/**
	 * A15: Drag & Drop von Items zwischen zwei Akteuren verschiebt das Item
	 * (Move: im Ziel anlegen + im Quell-Akteur löschen) statt es zu kopieren.
	 * Drags innerhalb desselben Akteurs (Sortierung), von der Seitenleiste und
	 * aus Kompendien behalten das Foundry-Standardverhalten (Kopie bzw.
	 * Core-Handling) - alles andere wird an die Basisklasse durchgereicht.
	 */
	async _onDrop(event) {
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
			const sourceActor = sourceItem?.parent;
			if (sourceItem && sourceActor instanceof Actor && sourceActor !== this.actor) {
				return this._moveItemBetweenActors(sourceItem, sourceActor);
			}
		}
		return super._onDrop(event);
	}

	/**
	 * A15: Item von einem anderen Akteur übernehmen und im Quell-Akteur
	 * entfernen. Erlaubt für GM sowie für Nutzer, die BEIDE Akteure besitzen.
	 * Die Item-Flags (u. a. der A6-Favoriten-Stern) wandern mit.
	 */
	async _moveItemBetweenActors(sourceItem, sourceActor) {
		const allowed = game.user.isGM || (this.actor?.isOwner && sourceActor.isOwner);
		if (!allowed) {
			ui.notifications.warn(game.i18n.localize('MODERN.MOVE_DENIED'));
			return;
		}
		const itemData = sourceItem.toObject();
		delete itemData._id; // neue ID im Ziel - das Original wird gelöscht
		await this.actor.createEmbeddedDocuments('Item', [itemData]);
		await sourceActor.deleteEmbeddedDocuments('Item', [sourceItem.id]);
	}

	_onItemCreate(event) {
		event.preventDefault();
		let header = event.currentTarget;
		let data = foundry.utils.duplicate(header.dataset);
		data['name'] = `New ${data.type.capitalize()}`;
		if (data.type in game.symbaroum.config.itemImages)
			data.img = game.i18n.format(game.symbaroum.config.imageRef, { filename: game.symbaroum.config.itemImages[data.type] });
		else data.img = game.i18n.format(game.symbaroum.config.imageRef, { filename: 'unknown-item.png' });

		let itemData = {
			name: data['name'],
			type: data.type,
			img: data.img,
			system: foundry.utils.deepClone(data),
		};

		this.actor.createEmbeddedDocuments('Item', [itemData], { render: true }).then((item) => {
			// Automatically render the item sheet we just created
			item[0].sheet.render(true);
		});
	}

	_onItemEdit(event) {
		event.preventDefault();
		const div = event.target.closest('.item');
		this._itemEdit(div);
	}

	_itemEdit(div) {
		const item = this.actor.items.get(div.dataset.itemId);
		if (item) item.sheet.render(true);
	}

	_onItemDelete(event) {
		event.preventDefault();
		const div = event.target.closest('.item');
		this._itemDelete(div);
	}

	_itemDelete(div) {
		const item = this.actor.items.get(div.dataset.itemId);
		if (item === null) {
			return;
		}
		symbDialog({
			content: `${game.i18n.localize('TOOLTIP.DELETE_ITEM')} ${item.name}`,
			default: 'no',
			width: 100,
			buttons: {
				yes: {
					label: game.i18n.localize(`DIALOG.OK`),
					callback: (html) => {
						this.actor.deleteEmbeddedDocuments('Item', [item.id], { render: true });
					},
				},
				no: {
					label: game.i18n.localize(`DIALOG.CANCEL`),
					callback: (html) => {},
				},
			},
		});
	}

	async _onItemStateUpdate(event) {
		event.preventDefault();
		const div = event.target.closest('.item');
		this._itemStateUpdate(div);
	}

	async _itemStateUpdate(div, newState) {
		const item = this.actor.items.get(div.dataset.itemId);

		if (item === null || item === undefined || !item.system.isGear) {
			return;
		}
		let data;
		let currentState = newState ?? item.system.state;
		switch (currentState) {
			case 'active':
				data = { _id: item.id, id: item.id, 'system.state': 'equipped' };
				break;
			case 'equipped':
				data = { _id: item.id, id: item.id, 'system.state': 'other' };
				break;
			default:
				data = { _id: item.id, id: item.id, 'system.state': 'active' };
				break;
		}

		this.actor.updateEmbeddedDocuments('Item', [data]); // Used to have render:false
	}

	async _itemQuantityUpdate(div, increase, useDefault) {
		const item = this.actor.items.get(div.dataset.itemId);

		if (item === null || item === undefined || !item.system.isEquipment) {
			return;
		}
		if (useDefault) {
			let quantity = game.user.getFlag(game.system.id, game.symbaroum.config.CONTEXT_MENU.equipmentAddRemoveFlag);
			if (isNaN(quantity)) {
				ui.notifications.error(game.i18n.localize('MACRO.ADDEXP_NUMBER'));
			}
			item.update({ 'system.number': Math.max(0, item.system.number + quantity * (increase ? 1 : -1)) });
		} else {
			let dialog_content = `  
      <div class="form-group">
      <div style="flex-basis: auto;flex-direction: row;display: flex;">
        <div style="width:10em;min-width:10em;"><label for="${item.id}-changeQuantity" style="width:10em;min-width:10em">${game.i18n.localize(
				increase ? 'TOOLTIP.INCREASE_COUNT_TITLE' : 'TOOLTIP.DECREASE_COUNT_TITLE'
			)}</label></div><div><input id="${item.id}-changeQuantity" type="text" name="changeQuantity" value="1" style="width:5em"></div>
      </div>
      <div style="flex-basis: auto;flex-direction: row;display: flex;">
        <div style="width:10em;min-width:10em;"><label for="${item.id}-setDefault" style="width:10em;min-width:10em">${game.i18n.localize(
				'TOOLTIP.QUANTITY_SETDEFAULT'
			)}</label></div><div><input id="${item.id}-setDefault" class='checkbox' type='checkbox' name='setDefault'></div>
      </div>      
      <br/>
      </div>`;
			symbDialog({
				width: 300,
				title: game.i18n.localize(increase ? 'TOOLTIP.INCREASE_COUNT_TITLE' : 'TOOLTIP.DECREASE_COUNT_TITLE'),
				content: dialog_content,
				buttons: {
					Ok: {
						label: game.i18n.localize('DIALOG.OK'),
						callback: async (html) => {
							let quantity = parseInt(html[0].querySelector("input[name='changeQuantity'").value);
							if (isNaN(quantity)) {
								ui.notifications.error(game.i18n.localize('MACRO.ADDEXP_NUMBER'));
								return;
							}
							if (html[0].querySelector("input[name='setDefault']").checked && quantity > 0) {
								await game.user.setFlag(game.system.id, game.symbaroum.config.CONTEXT_MENU.equipmentAddRemoveFlag, quantity);
							}
							item.update({ 'system.number': Math.max(0, item.system.number + quantity * (increase ? 1 : -1)) });
						},
					},
					Cancel: { label: game.i18n.localize('DIALOG.CANCEL') },
				},
			});
		}
	}

	async _onPrepareActivateAbility(event) {
		event.preventDefault();
		const div = event.target.closest('.item');
		this._prepareActivateAbility(div);
	}

	async _prepareActivateAbility(div) {
		const ability = this.actor.items.get(div.dataset.itemId);
		await this.actor.usePower(ability);
	}

	async _onPrepareRollWeapon(event) {
		event.preventDefault();
		const div = event.target.closest('.item');
		this._prepareRollWeapon(div);
	}

	async _prepareRollWeapon(div) {
		const weapon = this.actor.items.get(div.dataset.itemId);
		await this.actor.rollWeapon(weapon);
	}

	async _enrichTextFields(data, fieldNameArr) {
		for (let t = 0; t < fieldNameArr.length; t++) {
			if (foundry.utils.hasProperty(data, fieldNameArr[t])) {
				foundry.utils.setProperty(
					data,
					fieldNameArr[t],
					await foundry.applications.ux.TextEditor.enrichHTML(foundry.utils.getProperty(data, fieldNameArr[t]), { async: true })
				);
			}
		}
	}
}
