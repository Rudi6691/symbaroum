import { SymbaroumItemSheet } from './item.js';

/**
 * V13 default options (orig. 700 x 600, 500 x 472 beim Artefakt; ItemSheets v2: 800x640, v3 (27.10.): 440x640) mapped
 * to ApplicationV2: the base class carries window/form/actions, this only
 * declares the position and the single content part.
 */
export class TraitSheet extends SymbaroumItemSheet {
	static DEFAULT_OPTIONS = {
		position: {
			width: 440,
			height: 640,
		},
	};

	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/sheet/trait.hbs',
		},
	};
}
