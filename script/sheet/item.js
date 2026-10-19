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
			resizable: false,
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
		context.cssClass = this.isEditable ? 'editable' : 'locked';
		context.editable = this.isEditable;
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
	 * V14 note: the V13 updateOutstandingMCEValues() hack (this.editors /
	 * MCE content harvesting) is obsolete - the prose-mirror elements take
	 * part in the sheet form, and this.submit() collects ALL current form
	 * values (including editor content that has not been change-submitted
	 * yet) and merges updateData on top (DocumentSheetV2._prepareSubmitData
	 * processes the "-=" deletion keys with performDeletions).
	 */
	async _onPowerDelete(event) {
		event.preventDefault();
		const div = event.target.closest('.power-n');
		if (!div) {
			return;
		}
		let powerId = parseInt(div.dataset.powerId);
		if (isNaN(powerId)) {
			return;
		}
		const arr = foundry.utils.deepClone(this.item.system.power) ?? {};
		delete arr[powerId];
		let vals = Object.values(arr);
		let newArr = {};
		for (let i = 0; i < vals.length; i++) {
			newArr[i] = vals[i];
		}
		await this.submit({
			updateData: {
				'system.power': newArr,
				[`system.power.-=${vals.length}`]: null,
			},
		});
	}

	/**
	 * Append a new empty power entry to the dynamic artifact power list
	 * (see _onPowerDelete for the submit() replacement of the MCE hack).
	 */
	async _onPowerCreate(event) {
		event.preventDefault();
		const arr = foundry.utils.deepClone(this.item.system.power) ?? {};
		const keys = Object.keys(arr);
		arr[keys.length] = { name: '', description: '', action: '', corruption: '' };
		await this.submit({
			updateData: {
				'system.power': arr,
			},
		});
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
