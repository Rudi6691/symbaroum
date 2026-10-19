import { SymbaroumItemSheet } from './item.js';

/**
 * V13 default options (700 x 600) mapped to ApplicationV2.
 */
export class ArmorSheet extends SymbaroumItemSheet {
	static DEFAULT_OPTIONS = {
		position: {
			width: 700,
			height: 600,
		},
	};

	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/sheet/armor.hbs',
		},
	};

	/**
	 * V13 getData() additions for the stats/qualities tabs.
	 * 7.2.7: fixed the dormant V13 typo - the class wrote data.compatibility
	 * (singular) while the template reads compatibilities (plural), so the
	 * list never reached the template (practically invisible because
	 * SYMBAROUM.armorCompatibilities is an empty list).
	 */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.qualities = game.symbaroum.config.armorQualities;
		context.compatibilities = game.symbaroum.config.armorCompatibilities;
		context.bonuses = [...context.bonuses, ...game.symbaroum.config.BONUS_FIELDS_ARMOR];
		context.protection_selection = game.symbaroum.config.ARMOR_PROTECTION_SELECTION;
		return context;
	}
}
