import { SymbaroumItemSheet } from './item.js';

/**
 * V13 default options (500 x 472) mapped to ApplicationV2. The V13 passthrough
 * overrides (getData/_getHeaderButtons/activateListeners only called super)
 * are dropped - they are obsolete under ApplicationV2.
 */
export class ArtifactSheet extends SymbaroumItemSheet {
	static DEFAULT_OPTIONS = {
		position: {
			width: 800,
			height: 640,
		},
	};

	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/sheet/artifact.hbs',
		},
	};
}
