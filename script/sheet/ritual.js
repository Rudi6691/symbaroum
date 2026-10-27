import { SymbaroumItemSheet } from './item.js';

/**
 * V13 default options (orig. 700 x 600, 500 x 472 beim Artefakt; ItemSheets v2 am 27.10. auf 800 x 640, tabs in the template) mapped
 * to ApplicationV2: the base class carries window/form/actions, this only
 * declares the position and the single content part.
 */
export class RitualSheet extends SymbaroumItemSheet {
	static DEFAULT_OPTIONS = {
		position: {
			width: 800,
			height: 640,
		},
	};

	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/sheet/ritual.hbs',
		},
	};
}
