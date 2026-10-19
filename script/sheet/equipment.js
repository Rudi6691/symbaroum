import { SymbaroumItemSheet } from './item.js';

/**
 * V13 default options (700 x 600, not resizable, tabs in the template) mapped
 * to ApplicationV2: the base class carries window/form/actions, this only
 * declares the position and the single content part.
 */
export class EquipmentSheet extends SymbaroumItemSheet {
	static DEFAULT_OPTIONS = {
		position: {
			width: 700,
			height: 600,
		},
	};

	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/sheet/equipment.hbs',
		},
	};
}
