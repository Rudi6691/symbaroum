import { SymbaroumItemSheet } from './item.js';

/**
 * V13 default options (700 x 600) mapped to ApplicationV2.
 */
export class WeaponSheet extends SymbaroumItemSheet {
	static DEFAULT_OPTIONS = {
		position: {
			width: 800,
			height: 640,
		},
	};

	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/sheet/weapon.hbs',
		},
	};

	/**
	 * V13 getData() additions for the stats/qualities tabs. Note: the V13 code
	 * mutated game.symbaroum.config.ATTRIBUTE_SELECTION by adding the 'none'
	 * entry (alternative_selection.none = ...) - it now gets a local shallow
	 * copy so the global config object stays untouched.
	 */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.qualities = game.symbaroum.config.weaponQualities;
		context.compatibilities = game.symbaroum.config.weaponCompatibilities;
		context.bonuses = [...context.bonuses, ...game.symbaroum.config.BONUS_FIELDS_WEAPON];
		context.alternative_selection = { ...game.symbaroum.config.ATTRIBUTE_SELECTION };
		context.alternative_selection.none = {
			id: 'none',
			label: game.i18n.localize('WEAPON.NONE'),
		};
		context.attribute_selection = game.symbaroum.config.ATTRIBUTE_SELECTION;
		context.weapon_damage_selection = game.symbaroum.config.WEAPON_DAMAGE_SELECTION;
		context.weapon_type_selection = game.symbaroum.config.WEAPON_TYPE_SELECTION;
		return context;
	}
}
