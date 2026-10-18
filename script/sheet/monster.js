import { PlayerSheet } from './player.js';

export class MonsterSheet extends PlayerSheet {
	static DEFAULT_OPTIONS = {
		classes: ['symbaroum', 'sheet', 'actor', 'monster'],
	};

	/**
	 * ApplicationV2 concatenates array options along the inheritance chain.
	 * Since MonsterSheet extends PlayerSheet, the 'player' class would be inherited as
	 * well and both .symbaroum.sheet.actor.player and .symbaroum.sheet.actor.monster CSS
	 * rules would match (V13 behaviour: the array was replaced instead). Remove the
	 * inherited 'player' class so only the monster rules apply.
	 */
	_initializeApplicationOptions(options) {
		const config = super._initializeApplicationOptions(options);
		config.classes = config.classes.filter((c) => c !== 'player');
		return config;
	}
}
