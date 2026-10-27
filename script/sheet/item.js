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
