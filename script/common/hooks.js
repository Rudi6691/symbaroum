import { initializeHandlebars } from './handlebars.js';
import { SYMBAROUM } from './config.js';
import { sendDevMessage } from './devmsg.js';
import { SymbaroumAPI } from './api.js';
import { SymbaroumCommsListener } from './symbcomms.js';
import { SymbaroumMacros } from './macro.js';
import { SymbaroumConfig } from './symbaroumConfig.js';
import { enrichTextEditors } from './enricher.js';

import { SymbaroumActor } from './actor.js';
import { SymbaroumItem, buildRolls } from './item.js';
// A28 Stufe 1: the round/DoT engine attaches its damage rolls to the tick card
import { createRollData, getAttributeValue } from './roll.js';
// A29: the maintain reminder is a small dialog, rendered via the system's
// DialogV2 compatibility helper
import { symbDialog } from './symbDialog.js';

import { PlayerSheet } from '../sheet/player.js';
import { MonsterSheet } from '../sheet/monster.js';
import { TraitSheet } from '../sheet/trait.js';
import { AbilitySheet } from '../sheet/ability.js';
import { MysticalPowerSheet } from '../sheet/mystical-power.js';
import { RitualSheet } from '../sheet/ritual.js';
import { BurdenSheet } from '../sheet/burden.js';
import { BoonSheet } from '../sheet/boon.js';
import { WeaponSheet } from '../sheet/weapon.js';
import { ArmorSheet } from '../sheet/armor.js';
import { EquipmentSheet } from '../sheet/equipment.js';
import { ArtifactSheet } from '../sheet/artifact.js';
import { SymbaroumWide } from '../sheet/journal.js';

import { migrateWorld } from './migration.js';

import { tourSetup } from '../../tours/toursetup.js';

Hooks.once('init', () => {
	const debouncedReload = foundry.utils.debounce(() => window.location.reload(), 250);

	CONFIG.Actor.documentClass = SymbaroumActor;
	CONFIG.Item.documentClass = SymbaroumItem;
	foundry.documents.collections.Actors.unregisterSheet('core', foundry.appv1.sheets.ActorSheet);
	foundry.documents.collections.Actors.registerSheet('symbaroum', PlayerSheet, { types: ['player'], makeDefault: true });
	foundry.documents.collections.Actors.registerSheet('symbaroum', MonsterSheet, { types: ['monster'], makeDefault: true });
	foundry.documents.collections.Actors.registerSheet('symbaroum', PlayerSheet, { types: ['monster'], makeDefault: false });
	foundry.documents.collections.Items.unregisterSheet('core', foundry.appv1.sheets.ItemSheet);
	foundry.documents.collections.Items.registerSheet('symbaroum', TraitSheet, { types: ['trait'], makeDefault: true });
	foundry.documents.collections.Items.registerSheet('symbaroum', AbilitySheet, { types: ['ability'], makeDefault: true });
	foundry.documents.collections.Items.registerSheet('symbaroum', MysticalPowerSheet, { types: ['mysticalPower'], makeDefault: true });
	foundry.documents.collections.Items.registerSheet('symbaroum', RitualSheet, { types: ['ritual'], makeDefault: true });
	foundry.documents.collections.Items.registerSheet('symbaroum', BurdenSheet, { types: ['burden'], makeDefault: true });
	foundry.documents.collections.Items.registerSheet('symbaroum', BoonSheet, { types: ['boon'], makeDefault: true });
	foundry.documents.collections.Items.registerSheet('symbaroum', WeaponSheet, { types: ['weapon'], makeDefault: true });
	foundry.documents.collections.Items.registerSheet('symbaroum', ArmorSheet, { types: ['armor'], makeDefault: true });
	foundry.documents.collections.Items.registerSheet('symbaroum', EquipmentSheet, { types: ['equipment'], makeDefault: true });
	foundry.documents.collections.Items.registerSheet('symbaroum', ArtifactSheet, { types: ['artifact'], makeDefault: true });
	foundry.documents.collections.Journal.registerSheet('symbaroum', SymbaroumWide, {
		label: game.i18n.localize('SYMBAROUM.OPTIONAL_CUSTOMSHEETJOURNAL'),
		makeDefault: false,
	});

	initializeHandlebars();

	game.symbaroum = {
		config: SYMBAROUM,
		SymbaroumConfig,
		debug: (...args) => {
			console.debug('%cSymbaroum |', game.symbaroum.config.CONSOLESTYLE, ...args);
		},
		error: (...args) => {
			console.error('%cSymbaroum |', game.symbaroum.config.CONSOLESTYLE, ...args);
		},
		info: (...args) => {
			console.info('%cSymbaroum |', game.symbaroum.config.CONSOLESTYLE, ...args);
		},
		log: (...args) => {
			console.log('%cSymbaroum |', game.symbaroum.config.CONSOLESTYLE, ...args);
		},
		api: new SymbaroumAPI(),
	};

	CONFIG.symbaroum = game.symbaroum.config;

	game.settings.register('symbaroum', 'worldTemplateVersion', {
		// worldTemplateVersion is deprecated - not to use anymore
		name: 'World Template Version',
		hint: 'Used to automatically upgrade worlds data when the template is upgraded.',
		scope: 'world',
		config: false,
		default: 0,
		type: Number,
	});

	game.settings.register('symbaroum', 'systemMigrationVersion', {
		name: 'World System Version',
		hint: 'Used to automatically upgrade worlds data when needed.',
		scope: 'world',
		config: false,
		default: '0',
		type: String,
	});

	game.settings.register('symbaroum', 'symbaroumDevMessageVersionNumber', {
		name: 'Message from the devs',
		hint: 'Used to track last message id from the Symbaroum devs',
		scope: 'world',
		config: false,
		default: 0,
		type: Number,
	});

	game.settings.register('symbaroum', 'combatAutomation', {
		name: 'SYMBAROUM.OPTIONAL_AUTOCOMBAT',
		hint: 'SYMBAROUM.OPTIONAL_AUTOCOMBAT_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'playerResistButton', {
		name: 'SYMBAROUM.OPTIONAL_PLAYER_RESIST',
		hint: 'SYMBAROUM.OPTIONAL_PLAYER_RESIST_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'alwaysSucceedOnOne', {
		name: 'SYMBAROUM.OPTIONAL_ALWAYSSUCCEDONONE',
		hint: 'SYMBAROUM.OPTIONAL_ALWAYSSUCCEDONONE_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'optionalCrit', {
		name: 'SYMBAROUM.OPTIONAL_CRIT',
		hint: 'SYMBAROUM.OPTIONAL_CRIT_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'optionalRareCrit', {
		name: 'SYMBAROUM.OPTIONAL_RARECRIT',
		hint: 'SYMBAROUM.OPTIONAL_RARECRIT_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'critsApplyToAllTests', {
		name: 'SYMBAROUM.OPTIONAL_ALWAYSUSECRIT',
		hint: 'SYMBAROUM.OPTIONAL_ALWAYSUSECRIT_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'optionalMoreRituals', {
		name: 'SYMBAROUM.OPTIONAL_MORERITUALS',
		hint: 'SYMBAROUM.OPTIONAL_MORERITUALS_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'saveCombatRoll', {
		name: 'SYMBAROUM.OPTIONAL_SAVECOMBATROLL',
		hint: 'SYMBAROUM.OPTIONAL_SAVECOMBATROLL_HINT',
		scope: 'user',
		type: Boolean,
		default: false,
		config: true,
	});
	game.settings.register('symbaroum', 'saveAttributeRoll', {
		name: 'SYMBAROUM.OPTIONAL_SAVEATTRIBUTEROLL',
		hint: 'SYMBAROUM.OPTIONAL_SAVEATTRIBUTEROLL_HINT',
		scope: 'user',
		type: Boolean,
		default: false,
		config: true,
	});
	game.settings.register('symbaroum', 'showModifiersInDialogue', {
		name: 'SYMBAROUM.OPTIONAL_SHOWMODIFIERSINDIALOGUE',
		hint: 'SYMBAROUM.OPTIONAL_SHOWMODIFIERSINDIALOGUE_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});
	game.settings.register('symbaroum', 'showNpcModifiers', {
		name: 'SYMBAROUM.OPTIONAL_NPC_MODIFIERS',
		hint: 'SYMBAROUM.OPTIONAL_NPC_MODIFIERS_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});
	game.settings.register('symbaroum', 'showNpcAttacks', {
		name: 'SYMBAROUM.OPTIONAL_NPC_ATTACKS',
		hint: 'SYMBAROUM.OPTIONAL_NPC_ATTACKS_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		requiresReload: true,
		config: true,
	});
	game.settings.register('symbaroum', 'allowShowReference', {
		name: 'SYMBAROUM.OPTIONAL_SHOWREFERENCE',
		hint: 'SYMBAROUM.OPTIONAL_SHOWREFERENCE_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'hideIniativeRolls', {
		name: 'SYMBAROUM.OPTIONAL_INIATITIVEROLLS',
		hint: 'SYMBAROUM.OPTIONAL_INIATITIVEROLLS_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});
	game.settings.register('symbaroum', 'autoRollInitiative', {
		name: 'SYMBAROUM.OPTIONAL_AUTOROLLINITIATIVE',
		hint: 'SYMBAROUM.OPTIONAL_AUTOROLLINITIATIVE_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'enhancedDeathSaveBonus', {
		name: 'SYMBAROUM.OPTIONAL_ENHANCEDDEATHSAVEBONUS',
		hint: 'SYMBAROUM.OPTIONAL_ENHANCEDDEATHSAVEBONUS_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'manualInitValue', {
		name: 'SYMBAROUM.OPTIONAL_INIT_MANUAL',
		hint: 'SYMBAROUM.OPTIONAL_INIT_MANUAL_HINT',
		scope: 'world',
		type: Boolean,
		default: false,
		config: true,
	});

	game.settings.register('symbaroum', 'charBGChoice', {
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/green_flower_light.webp) repeat',
	});
	game.settings.register('symbaroum', 'npcBGChoice', {
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/purple_flower_light.webp) repeat',
	});
	game.settings.register('symbaroum', 'titleBGChoice', {
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/title.webp)',
	});
	game.settings.register('symbaroum', 'editableChoice', {
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/editable.webp)',
	});
	game.settings.register('symbaroum', 'nonEditableChoice', {
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/not-editable.webp)',
	});

	game.settings.register('symbaroum', 'switchCharBGColour', {
		name: 'SYMBAROUM.OPTIONAL_PC_COLOUR_SELECTOR',
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/green_flower_light.webp) repeat',
	});
	game.settings.register('symbaroum', 'switchNpcBGColour', {
		name: 'SYMBAROUM.OPTIONAL_NPC_COLOUR_SELECTOR',
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/purple_flower_light.webp) repeat',
	});
	game.settings.register('symbaroum', 'switchTitleColour', {
		name: 'SYMBAROUM.OPTIONAL_TITLE_COLOUR_SELECTOR',
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/title.webp)',
	});
	game.settings.register('symbaroum', 'switchEditableColour', {
		name: 'SYMBAROUM.OPTIONAL_EDITABLE_COLOUR_SELECTOR',
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/editable.webp)',
	});
	game.settings.register('symbaroum', 'switchNoNEditableColour', {
		name: 'SYMBAROUM.OPTIONAL_EDITABLE_COLOUR_SELECTOR',
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/not-editable.webp)',
	});
	game.settings.register('symbaroum', 'chatBGChoice', {
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/editable.webp)',
	});
	game.settings.register('symbaroum', 'switchChatBGColour', {
		restricted: false,
		type: String,
		config: false,
		scope: 'client',
		default: 'url(../asset/image/background/green_flower_light.webp) repeat',
	});

	game.settings.registerMenu('symbaroum', 'symbaroumSettings', {
		name: 'SYMBAROUM.OPTIONAL_CONFIG_MENULABEL',
		label: 'SYMBAROUM.OPTIONAL_CONFIG_MENULABEL',
		hint: 'SYMBAROUM.OPTIONAL_CONFIG_MENUHINT',
		icon: 'fas fa-palette',
		type: SymbaroumConfig,
		restricted: false,
	});

	// register setting for add/remove menu button
	game.settings.register('symbaroum', 'addMenuButton', {
		name: 'SYMBAROUM.OPTIONAL_ADD_MENUNAME',
		hint: 'SYMBAROUM.OPTIONAL_ADD_MENUHINT',
		scope: 'world',
		config: true,
		default: SymbaroumConfig.getDefaults.addMenuButton,
		type: Boolean,
		onChange: (enabled) => {
			SymbaroumConfig.toggleConfigButton(enabled);
		},
	});

	game.settings.register('symbaroum', 'symSemaphore', {
		name: 'Semaphore Flag',
		hint: 'Flag for running sequential actions/scripts',
		scope: 'world',
		type: String,
		config: false,
		default: '',
	});

	game.symbaroum.macros = new SymbaroumMacros();

	game.symbaroum.htmlEscape = function (str) {
		let escapeMap = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;',
			'/': '&#x2F;',
			'`': '&#x60;',
			'=': '&#x3D;',
		};
		return str.replace(/[&<>"'`=\/]/g, function (s) {
			return escapeMap[s];
		});
	};

	enrichTextEditors();
	// MOVE TO READY?!
	setupStatusEffects();
});

Hooks.once('ready', () => {
	game.symbaroum.macros.macroReady();
	const originalVersion = game.settings.get('symbaroum', 'systemMigrationVersion');
	migrateWorld();
	sendDevMessage();
	showReleaseNotes(originalVersion);
	setupConfigOptions();
	setupEmit();
	// A29: maintain-reminder dialogs/answers ride the same system socket channel
	// as the established comms (symbcomms.js ignores unknown message types)
	game.socket.on('system.symbaroum', a29SocketHandler);
	setup3PartySettings();
	// A35 (Befund 10): German core status names - at ready all system
	// translations are loaded (the A34-Fix1 init-time patch never ran)
	setupStatusEffectNames();
	// enrichTextEditors();
	tourSetup();

	if (!CONFIG.Combat.settings.turnMarker.src) {
		CONFIG.Combat.settings.turnMarker.src = 'systems/symbaroum/asset/image/head.webp';
	}
});

Hooks.on('preDocumentSheetRegistrarInit', (settings) => {
	settings['JournalEntry'] = true;
});

Hooks.on('documentSheetRegistrarInit', (documentTypes) => {
	DocumentSheetConfig.updateDefaultSheets(game.settings.get('core', 'sheetClasses'));
});

// create/remove the quick access config button
Hooks.once('renderSettings', () => {
	SymbaroumConfig.toggleConfigButton(JSON.parse(game.settings.get('symbaroum', 'addMenuButton')));
});

Hooks.on('preCreateActor', (doc, createData, options, userid) => {
	let createChanges = {};
	foundry.utils.mergeObject(createChanges, {
		'prototypeToken.displayName': CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
		'prototypeToken.displayBars': CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
		'prototypeToken.disposition': CONST.TOKEN_DISPOSITIONS.NEUTRAL,
		'prototypeToken.name': createData.name,
	});

	if (doc.img === 'icons/svg/mystery-man.svg') {
		createChanges.img = 'systems/symbaroum/asset/image/unknown-actor.png';
	}

	if (doc.type === 'player') {
		createChanges.prototypeToken.vision = true;
		createChanges.prototypeToken.actorLink = true;
	}
	doc.updateSource(createChanges);
});

// Hooks.on('createOwnedItem', (actor, item) => {});
Hooks.on('changeSidebarTabA', (app) => {
	game.symbaroum.log('In changeSidebarTab - sorting out available compendiums', app, app.rendered);
});

Hooks.on('preDeleteActiveEffect', (ae) => {
	game.symbaroum.log('preDeleteActiveEffect', ae);
	let holyShield = false;
	if (foundry.utils.isNewerVersion('11', game.version)) {
		holyShield = ae.getFlag('core', 'statusId') == 'holyShield';
	} else {
		holyShield = ae.statuses.find((e) => e == 'holyShield');
	}
	let actor = ae.parent;
	if (actor) {
		if (holyShield) {
			const ids = actor.items.filter((i) => i.getFlag(game.system.id, 'blessedshield')).map((i) => i.id);
			if (ids.length > 0) {
				actor.deleteEmbeddedDocuments('Item', ids);
			}
		}
	}
});

Hooks.once('diceSoNiceReady', (dice3d) => {
	dice3d.addSystem({ id: 'symbaroum', name: 'Symbaroum' }, 'preferred');
	dice3d.addColorset(
		{
			name: 'Symbaroum',
			description: 'Symbaroum',
			category: 'Symbaroum',
			foreground: '#e9e7c5',
			background: '#d6b076',
			outline: '#3b3832',
			texture: 'stars',
			edge: '#211f19',
		},
		'preferred'
	);
});

Hooks.on('combatStart', async (combat, ...args) => {
	// let isFirstRound = combat.active && combat.current.round == 1 && combat.current.turn == 0 && combat.previous.turn == null;
	if (game.user.isActiveGM && game.settings.get('symbaroum', 'autoRollInitiative')) {
		await combat.rollAll();
	}
});

/* A28 Stufe 1 - round/DoT engine. At the START of a combatant's turn the GM
   client collects every engine-managed condition on that combatant's actor
   (an ActiveEffect whose flags.symbaroum.flagData carries durationRounds or a
   dot block): each damage-over-time source rolls its per-round damage, all
   changes are applied in ONE batched actor update and ONE aggregated chat card
   is posted (per-source lines + total, maintain-chain card optics).
   Afterwards the round counters are decremented and finished conditions are
   deleted - tick first, then expiry, so a duration of N rounds produces
   exactly N damage ticks (G1/G4).
   The tick at the start of the victim's own turn also implements the Vault
   timing "damage starting the round after the hit" without special cases: a
   hit can never deal its round damage in the same instant, the first tick is
   always the victim's next turn.
   G6/K6 precedent: legacy conditions without durationRounds/dot data are
   strictly ignored - they neither tick nor expire; applying them once anew
   brings them into the engine. Outside of a combat nothing ticks (rounds only
   exist in the combat tracker), and no render or movement path is touched
   (A28-2 performance rules). */
Hooks.on('updateCombat', async (combat, changed) => {
	if (!game.user.isActiveGM) return;
	if (!('turn' in changed) && !('round' in changed)) return;
	const combatant = combat.combatant;
	const actor = combatant?.actor;
	if (!actor) return;
	const dotEffects = actor.effects.filter((e) => {
		const fd = e.getFlag(game.system.id, 'flagData');
		return fd && (fd.durationRounds != null || fd.dot);
	});
	if (dotEffects.length === 0) return;

	// A33Fix2 (Rudolf's test round, Befund 7): heal ticks (Regeneration) are
	// suppressed when the victim's toughness is already at max and no
	// toughness-damage source runs in the same tick - no roll, no line, and
	// with nothing else on the card the whole card is skipped below; parallel
	// damage brings the actor below max, so those heal ticks flow into the
	// net rule as before
	// A33Fix3 (Rudolf's rule, A33Fix2 test round): a DYING victim (toughness
	// 0) gets NO healing tick at all, even with parallel damage - otherwise
	// Regeneration would keep a downed character alive forever and death
	// rolls would never apply; Regeneration only ticks again once toughness
	// is at least 1
	const toughValue = actor.system.health.toughness.value;
	const toughMax = actor.system.health.toughness.max;
	const hasToughnessDamageSource = dotEffects.some((e) => {
		const dot = e.getFlag(game.system.id, 'flagData')?.dot;
		return dot && dot.resource !== 'heal' && dot.resource !== 'corruption';
	});
	const suppressHeal = toughValue <= 0 || (toughValue >= toughMax && !hasToughnessDamageSource);

	const rolls = [];
	const lines = [];
	let toughnessDamage = 0;
	let corruptionDamage = 0;
	// A35: per-turn healing total of the heal-resource dots
	let healAmount = 0;
	for (const e of dotEffects) {
		const fd = e.getFlag(game.system.id, 'flagData');
		if (!fd.dot) continue; // duration-only conditions just expire below
		const dot = fd.dot;
		// A33Fix2 (Befund 7) + A33Fix3: regeneration at full toughness or
		// while dying (toughness 0) ticks nothing
		if (dot.resource === 'heal' && suppressHeal) continue;
		// A36V test round (Rudolf, 25.10. - Heilige Aura): a dot with a
		// resist block is opposed EVERY round - the victim rolls 1d20
		// against its attribute value + 10 - the caster's snapshotted value
		// (the system's one-roll opposed model, exactly like the immediate
		// damage resistance on the aura summary card). A successful
		// resistance cancels THIS round's tick: resistance line on the
		// card, no amount, no actor update - the symbol stays, the next
		// round gets its own attempt. Damage-dots only (heal and corruption
		// resources never resist).
		if (dot.resist && dot.resource !== 'heal' && dot.resource !== 'corruption') {
			const resistTarget = getAttributeValue(actor, dot.resist.attribute) + 10 - Number(dot.resist.value ?? 10);
			const resistRoll = await new Roll('1d20').evaluate();
			rolls.push(resistRoll);
			const resistLabel = dot.label ? game.i18n.localize(dot.label) : e.name;
			if (resistRoll.total <= resistTarget) {
				lines.push(game.i18n.format('COMBAT.DOT_RESIST_SUCCESS', { label: resistLabel, roll: resistRoll.total, target: resistTarget }));
				continue;
			}
			lines.push(game.i18n.format('COMBAT.DOT_RESIST_FAILED', { label: resistLabel, roll: resistRoll.total, target: resistTarget }));
		}
		const roll = await new Roll(dot.formula).evaluate();
		rolls.push(roll);
		const amount = roll.total * (dot.stacks ?? 1);
		if (dot.resource === 'corruption') corruptionDamage += amount;
		// A35: the heal resource turns a dot into a healing tick (Regeneration
		// trait) - the amount is ADDED to toughness in the batched update below
		else if (dot.resource === 'heal') healAmount += amount;
		else toughnessDamage += amount;
		const label = dot.label ? game.i18n.localize(dot.label) : e.name;
		// A35: heal ticks get their own line wording (healing, not damage)
		let line = dot.resource === 'heal'
			? game.i18n.format('COMBAT.HEAL_SOURCE_LINE', { label, damage: amount })
			: game.i18n.format('COMBAT.DOT_SOURCE_LINE', { label, damage: amount });
		if (dot.separateRoll) line += game.i18n.localize('COMBAT.DOT_SEPARATE');
		if (fd.durationRounds != null) {
			// this very tick is running: one round of the duration is consumed
			const remaining = Number(fd.durationRounds) - 1;
			line += remaining > 0 ? game.i18n.format('COMBAT.DOT_ROUNDS_LEFT', { count: remaining }) : game.i18n.localize('COMBAT.DOT_EXPIRED');
		}
		lines.push(line);
	}
	// A35-Fix (Rudolf's test round, Befund 8): bleeding and healing in the
	// SAME turn net into ONE total line - the separate "total healed" used
	// to print the full regeneration roll even when the net result was
	// damage; the per-source lines above stay unchanged
	if (toughnessDamage > 0 && healAmount > 0) {
		const net = toughnessDamage - healAmount;
		lines.push(game.i18n.format(net > 0 ? 'COMBAT.DOT_TOTAL_NET_DAMAGE' : net === 0 ? 'COMBAT.DOT_TOTAL_NET_ZERO' : 'COMBAT.DOT_TOTAL_NET_HEAL', { damage: Math.abs(net) }));
	} else {
		if (toughnessDamage > 0) lines.push(game.i18n.format('COMBAT.DOT_TOTAL', { damage: toughnessDamage }));
		if (healAmount > 0) lines.push(game.i18n.format('COMBAT.DOT_TOTAL_HEAL', { damage: healAmount }));
	}
	if (corruptionDamage > 0) lines.push(game.i18n.format('COMBAT.DOT_TOTAL_CORRUPTION', { damage: corruptionDamage }));

	// ONE batched actor update for all sources (A28-2 performance rule)
	const updateData = {};
	let oldToughness;
	// A35: heal ticks net against the same turn's damage - ONE batched update,
	// clamped to [0, max]; a regeneration that outweighs a bleeding keeps the
	// actor at max, and the dying check below sees the NET result
	if (toughnessDamage > 0 || healAmount > 0) {
		oldToughness = actor.system.health.toughness.value;
		updateData['system.health.toughness.value'] = Math.max(0, Math.min(actor.system.health.toughness.max, oldToughness - toughnessDamage + healAmount));
	}
	if (corruptionDamage > 0) {
		updateData['system.health.corruption.temporary'] = actor.system.health.corruption.temporary + corruptionDamage;
	}
	if (!foundry.utils.isEmpty(updateData)) {
		await actor.update(updateData);
	}

	// A25 F9/F11: the round damage brought the actor down to 0 toughness - the
	// same transition gate and consistent big skull overlay as on the GM apply
	// path; an actor already at 0 does not re-trigger (no spam)
	if (updateData['system.health.toughness.value'] === 0 && oldToughness > 0) {
		const dyingName = combatant.token?.name ?? actor.token?.name ?? actor.name ?? '';
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: actor.id }),
			content: `<div class="symbaroum chat ability"><div class="foreground"><div class="finalTxt"><p>${dyingName}${game.i18n.localize('COMBAT.CHAT_DAMAGE_DYING')}</p></div></div></div>`,
		});
		await applyDeadOverlay(actor);
	}

	// A33Fix2 (Befund 7) + A33Fix3: everything on this card was suppressed
	// (regeneration at full toughness or dying, no damage, nothing expiring)
	// - no card at all
	const anyExpiry = dotEffects.some((e) => e.getFlag(game.system.id, 'flagData')?.durationRounds != null);
	if (lines.length === 0 && foundry.utils.isEmpty(updateData) && !anyExpiry) return;

	// EINE aggregated tick card per victim per turn, dice attached as rolls
	// A35: a card with ONLY healing (the regeneration case) gets its own title
	const dotTitleKey = healAmount > 0 && toughnessDamage === 0 && corruptionDamage === 0 ? 'COMBAT.REGEN_TITLE' : 'COMBAT.DOT_TITLE';
	const title = `<h4>${combatant.token?.name ?? actor.token?.name ?? actor.name}${game.i18n.localize(dotTitleKey)}</h4>`;
	const html = `<div class="symbaroum chat ability"><div class="foreground">${title}${lines.map((line) => `<div class="finalTxt">${line}</div>`).join('')}</div></div>`;
	const chatData = {
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: actor.id }),
		rollMode: game.settings.get('core', 'messageMode'),
		content: html,
	};
	if (rolls.length > 0) chatData.rolls = [createRollData(rolls)];
	ChatMessage.applyMode(chatData, 'public');
	await ChatMessage.create(chatData);

	// tick-then-expiry: decrement the round counters (batched) and remove
	// finished conditions; the effect's duration display follows the counter
	const effectUpdates = [];
	const expireIds = [];
	for (const e of dotEffects) {
		const fd = e.getFlag(game.system.id, 'flagData');
		if (fd.durationRounds == null) continue;
		const remaining = Math.max(0, Number(fd.durationRounds) - 1);
		if (remaining <= 0) expireIds.push(e.id);
		else effectUpdates.push({ _id: e.id, [`flags.${game.system.id}.flagData.durationRounds`]: remaining, 'duration.value': remaining });
	}
	if (effectUpdates.length > 0) await actor.updateEmbeddedDocuments('ActiveEffect', effectUpdates);
	if (expireIds.length > 0) await actor.deleteEmbeddedDocuments('ActiveEffect', expireIds);
});

/* A35 - Regeneration Auto-Tick (GO erteilt 23.10.). The regeneration trait
   becomes engine-managed: when a combatant with the trait enters a combat,
   the GM client equips them with the regeneration condition whose dot block
   carries the new 'heal' resource - 1d4/1d6/1d8 per trait level (GRW) - and
   NO durationRounds, so the A28 round/DoT engine ticks the healing at the
   START of the carrier's own turn forever (outside a combat nothing ticks,
   K6 precedent; the symbol itself is permanent like the trait). Double
   application is guarded (hasCondition), re-entering a combat re-equips.
   The trait's manual click stays available for ad-hoc healing OUTSIDE the
   automation - in combat the symbol ticks, no manual rolls needed.
   Aborting mid-fight (e.g. a troll set on fire): the GM removes the symbol
   (drag off) or runs the A35 abort macro from the delivery doc. */
Hooks.on('createCombatant', async (combatant) => {
	if (!game.user.isActiveGM) return;
	const actor = combatant.actor;
	if (!actor || actor.hasCondition('regeneration')) return;
	const traitItem = actor.items.find((item) => item.system?.reference === 'regeneration');
	if (!traitItem) return;
	// A35-Fix (Rudolf's test round, Befund 6): traits have NO system.level -
	// the tier checkboxes (novice/adept/master isActive) ARE the level, read
	// the same way as the sheet's getLevel(); an unlearned trait falls back
	// to tier 1 so the symbol still ticks
	const ts = traitItem.system;
	const level = ts?.master?.isActive ? 3 : ts?.adept?.isActive ? 2 : 1;
	const formula = level >= 3 ? '1d8' : level === 2 ? '1d6' : '1d4';
	await actor.addCondition('regeneration', {
		dot: { label: 'TRAIT_LABEL.REGENERATION', formula, resource: 'heal', separateRoll: false },
	});
	const regenName = combatant.token?.name ?? actor.token?.name ?? actor.name;
	await ChatMessage.create({
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: actor.id }),
		content: `<div class="symbaroum chat ability"><div class="foreground"><div class="finalTxt"><p>${game.i18n.format('COMBAT.REGEN_APPLIED', { name: regenName })}</p></div></div></div>`,
	});
});

/* A34 - turn-end expiry engine ("verlorene Runde" conditions). Conditions
   that opt in via the turnEnd marker (Dominance-Adept fear, Battlesymbol-
   Novice berserker, Prios' Burning-Glass-Master stun) do not run the round
   clock of the A28 engine: their "one round" is the victim's own turn - the
   effect stays active for the whole turn and is removed at its END. At
   every turn change the GM client looks at the combatant whose turn has
   just ended (combat.previous - the round wrap is included) and decrements
   that combatant's turnEndRounds counters; finished conditions are deleted
   in ONE batched update and ONE small chat card names them (DOT card
   optics). Marker safety exactly as with A28: conditions without
   turnEndRounds data are strictly ignored - hand-set stun/fear/berserker
   symbols and every legacy condition keep their exact current (permanent)
   behaviour. Outside of a combat nothing expires (rounds only exist in the
   combat tracker), and no render or movement path is touched. */
Hooks.on('updateCombat', async (combat, changed) => {
	if (!game.user.isActiveGM) return;
	if (!('turn' in changed) && !('round' in changed)) return;
	const prevIndex = combat.previous?.turn;
	if (prevIndex == null) return;
	const prevCombatant = combat.turns[prevIndex];
	const actor = prevCombatant?.actor;
	if (!actor) return;
	const turnEndEffects = actor.effects.filter((e) => {
		const fd = e.getFlag(game.system.id, 'flagData');
		return fd && fd.turnEndRounds != null;
	});
	if (turnEndEffects.length === 0) return;
	const effectUpdates = [];
	const expireIds = [];
	for (const e of turnEndEffects) {
		const fd = e.getFlag(game.system.id, 'flagData');
		const remaining = Math.max(0, Number(fd.turnEndRounds) - 1);
		if (remaining <= 0) expireIds.push(e.id);
		else effectUpdates.push({ _id: e.id, [`flags.${game.system.id}.flagData.turnEndRounds`]: remaining, 'duration.value': remaining });
	}
	if (effectUpdates.length > 0) await actor.updateEmbeddedDocuments('ActiveEffect', effectUpdates);
	if (expireIds.length > 0) {
		const names = turnEndEffects.filter((e) => expireIds.includes(e.id)).map((e) => e.name).join(', ');
		await actor.deleteEmbeddedDocuments('ActiveEffect', expireIds);
		const title = `<h4>${prevCombatant.token?.name ?? actor.token?.name ?? actor.name}${game.i18n.localize('COMBAT.TURNEND_TITLE')}</h4>`;
		const html = `<div class="symbaroum chat ability"><div class="foreground">${title}<div class="finalTxt"><p>${game.i18n.format('COMBAT.TURNEND_LINE', { names })}</p></div></div></div>`;
		await ChatMessage.create({
			user: game.user.id,
			speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: actor.id }),
			content: html,
		});
	}
});

/* ==================================================================
   A29 - Zug-Start-Maintain-Erinnerung (Rudolfs Idee; GO G1-G4, 23.10.)
   At the start of a combatant's turn the GM client scans the scene tokens
   for maintain symbols carrying this actor's author marker (A23
   flagData.caster + flagData.ability) and asks PER POWER via a small
   dialog (NOT a chat card):
     - "Ja" (G2b): opens the actor's regular power roll dialog preset to
       "Aufrechterhalten" (the F12 maintain radio) - the acting player
       keeps full control over target/favour/modifiers exactly as before.
     - "Nein" (K5): the power is aborted - every marker-tagged effect of
       this caster+ability on the scene tokens is deleted (A24-Anathema
       mechanic, erprobt) and the power's configured caster-side maintain
       symbol (activelyMaintaninedCasterEffect) is removed.
   G1: the dialog goes to the owning player via socket; the GM gets the
   fallback dialog if no active player owns the actor.
   G3 (Rudolf's stricter choice): a dialog closed or dismissed without an
   answer counts as "Nein" and aborts the power - except when it is
   disarmed at combat end.
   G4: every maintain power (all actively maintained marker symbols).
   Guards (K6): max ONE reminder per power and turn (combat:round:turn
   key), reminders expire silently at combat end, conditions without an
   author marker are never touched, the scan runs once per turn change
   (O(tokens), same scale as the A23 symbol scan). */

const a29ReminderGuard = new Set();
const a29OpenReminders = new Set();

function a29FindAbilityItem(actor, abilityRef) {
	return actor.items.find((it) => it.system?.reference === abilityRef) ?? null;
}

/* every marker-tagged effect of this caster on the scene, grouped per
   power - the A23 author markers make the scan exact: symbols of other
   casters, of the same caster via a different power and legacy untagged
   conditions are never touched (K6 precedent) */
function a29ScanMaintainedPowers(actor) {
	const groups = new Map();
	if (!actor) return groups;
	for (const token of canvas.tokens.placeables) {
		const tokenActor = token.actor;
		if (!tokenActor) continue;
		for (const effect of tokenActor.effects) {
			const flagData = effect.getFlag(game.system.id, 'flagData');
			// A34-Fix (Rudolf's test round, Befunde 2+3): only genuine maintain
			// symbols raise the reminder - the maintained marker is set at the
			// standardPowerResult push sites for maintain-capable powers only
			// (Dominance/Battlesymbol-Novice/Prios stun/Anfuehrer/Bannsiegel are out)
			if (flagData?.maintained !== true || flagData.caster !== actor.id || !flagData.ability) continue;
			let group = groups.get(flagData.ability);
			if (!group) {
				group = { abilityRef: flagData.ability, targets: 0 };
				groups.set(flagData.ability, group);
			}
			group.targets++;
		}
	}
	return groups;
}

/* K5 "Nein": abort the power - delete every marker-tagged effect on the
   scene tokens (A24-Anathema mechanic) plus the power's configured
   caster-side maintain symbol (activelyMaintaninedCasterEffect) */
async function a29AbortMaintainPower(actor, abilityRef) {
	const doomed = [];
	for (const token of canvas.tokens.placeables) {
		const tokenActor = token.actor;
		if (!tokenActor) continue;
		for (const effect of tokenActor.effects) {
			const flagData = effect.getFlag(game.system.id, 'flagData');
			if (flagData?.caster === actor.id && flagData?.ability === abilityRef) doomed.push([tokenActor, effect]);
		}
	}
	for (const [tokenActor, effect] of doomed) {
		await tokenActor.deleteEmbeddedDocuments('ActiveEffect', [effect._id]);
	}
	const abilityItem = a29FindAbilityItem(actor, abilityRef);
	const casterEffects = actor.system.combat.combatMods.abilities?.[abilityItem?.id]?.activelyMaintaninedCasterEffect ?? [];
	for (const effect of casterEffects) {
		await actor.removeCondition(effect);
	}
}

/* K3: one small dialog per power (NO chat card) */
function a29ShowReminderDialog(actor, abilityRef, targetCount) {
	const abilityItem = a29FindAbilityItem(actor, abilityRef);
	const abilityName = game.symbaroum.htmlEscape(abilityItem?.name ?? abilityRef);
	const reminder = { answered: false, disarmed: false, dialog: null };
	const answerNo = async () => {
		if (game.user.isActiveGM) {
			await a29AbortMaintainPower(actor, abilityRef);
		} else {
			// player client: the GM executes the abort (effects on foreign tokens)
			game.socket.emit('system.symbaroum', { type: 'a29MaintainReminderAnswer', data: { actorId: actor.id, abilityRef: abilityRef, answer: 'no' } });
		}
	};
	const answerYes = () => {
		if (!abilityItem) {
			ui.notifications.warn(game.i18n.localize('A29.REMINDER_NO_ITEM'));
			return;
		}
		// G2 (b): the regular roll dialog, preset to maintaining (F12 radio)
		actor.usePower(abilityItem, { presetMaintain: true });
	};
	const dialog = symbDialog({
		title: game.i18n.localize('A29.REMINDER_TITLE'),
		content: `<div class="symbaroum dialog"><p>${game.i18n.format('A29.REMINDER_TEXT', { name: abilityName, count: targetCount })}</p></div>`,
		buttons: {
			yes: {
				icon: '<i class="fas fa-check"></i>',
				label: game.i18n.localize('A29.REMINDER_YES'),
				callback: () => {
					reminder.answered = true;
					answerYes();
				},
			},
			no: {
				icon: '<i class="fas fa-times"></i>',
				label: game.i18n.localize('A29.REMINDER_NO'),
				callback: () => {
					reminder.answered = true;
					answerNo();
				},
			},
		},
		default: 'yes',
		width: 360,
	});
	reminder.dialog = dialog;
	a29OpenReminders.add(reminder);
	// G3 (Rudolf's choice): window closed / dismissed without an answer counts
	// as "Nein" (abort); a dialog disarmed at combat end stays silent. If the
	// ApplicationV2 close event is unavailable on this platform version, the
	// dialog simply stays silent when Xed (conservative fallback)
	try {
		dialog.addEventListener('close', () => {
			a29OpenReminders.delete(reminder);
			if (!reminder.answered && !reminder.disarmed) answerNo();
		});
	} catch (err) {
		game.symbaroum.log('A29: close event not available on this platform');
	}
}

/* A29 socket: GM -> player reminder (G1) and player -> GM abort answer */
function a29SocketHandler(message) {
	if (!message?.type) return;
	if (message.type === 'a29MaintainReminder' && message.data?.userId === game.user.id) {
		const actor = game.actors.get(message.data.actorId);
		if (actor) a29ShowReminderDialog(actor, message.data.abilityRef, message.data.targetCount);
	} else if (message.type === 'a29MaintainReminderAnswer' && game.user.isActiveGM && message.data?.answer === 'no') {
		const actor = game.actors.get(message.data.actorId);
		if (actor) a29AbortMaintainPower(actor, message.data.abilityRef);
	}
}

Hooks.on('updateCombat', async (combat, changed) => {
	if (!game.user.isActiveGM) return;
	if (!('turn' in changed)) return;
	const actor = combat.combatant?.actor;
	if (!actor) return;
	const groups = a29ScanMaintainedPowers(actor);
	if (groups.size === 0) return;
	for (const group of groups.values()) {
		const guardKey = `${combat.id}:${combat.round}:${combat.turn}:${actor.id}:${group.abilityRef}`;
		if (a29ReminderGuard.has(guardKey)) continue;
		a29ReminderGuard.add(guardKey);
		// G1: the owning player decides; the GM is the fallback
		const owner = game.users?.find((user) => user.active && !user.isGM && actor.testUserPermission(user, 'OWNER'));
		if (owner) {
			game.socket.emit('system.symbaroum', { type: 'a29MaintainReminder', data: { userId: owner.id, actorId: actor.id, abilityRef: group.abilityRef, targetCount: group.targets } });
		} else {
			a29ShowReminderDialog(actor, group.abilityRef, group.targets);
		}
	}
});

Hooks.on('deleteCombat', () => {
	// K6: no zombie dialogs - open reminders expire SILENTLY at combat end
	for (const reminder of a29OpenReminders) {
		reminder.disarmed = true;
		try {
			reminder.dialog?.close();
		} catch (err) {}
	}
	a29OpenReminders.clear();
	a29ReminderGuard.clear();
});

Hooks.on('preCreateChatMessage', (doc, message, options, userid) => {
	if (message.flags !== undefined) {
		if (foundry.utils.getProperty(message.flags, 'core.initiativeRoll') && game.settings.get('symbaroum', 'hideIniativeRolls')) {
			return false;
		}
	}
});

/* A25 F11: consistent death marking - every path that kills a target now
   applies the big skull overlay (Foundry V14: an ActiveEffect with
   flags.core.overlay, created via Actor#toggleStatusEffect). A leftover
   non-overlay dead condition from an earlier application (the A25 F9
   small skull, e.g. from a pre-F11 session) is removed first so the
   overlay is really what is shown on the token. */
async function applyDeadOverlay(actor) {
	const existingDead = actor.effects.find((e) => e.statuses.has('dead') && e.getFlag('core', 'overlay') !== true);
	if (existingDead) await existingDead.delete();
	await actor.toggleStatusEffect('dead', { active: true, overlay: true });
}

/*Hook for the chatMessage that contain a button for the GM to apply status icons or damage to a token.*/
Hooks.on('renderChatMessageHTML', async (chatItem, html, data) => {
	const flagDataArray = await chatItem.getFlag(game.system.id, 'applyEffects');

	if (flagDataArray && game.user.isGM) {
		const listenArea = html.querySelectorAll('#applyEffect');
		for (const s of listenArea) {
			s.addEventListener('click', async () => {
				console.log('Applying effects');
				for (let flagData of flagDataArray) {
					if (!flagData.tokenId && !flagData.actorId) {
						continue;
					}
					let token = flagData.tokenId ? canvas.tokens.objects.children.find((token) => token.id === flagData.tokenId) : null;
					let actor = token?.actor ?? game.actors.get(flagData.actorId);
					if (!actor) {
						continue;
					}
					if (flagData.addEffect) {
						// A25 F11: the standard paths' death entries carry the dead status
						// with overlay:true - the big skull overlay is applied consistently
						// instead of a small dead condition
						if (flagData.addEffect.id === 'dead' && flagData.overlay) {
							await applyDeadOverlay(actor);
						} else {
							// A23: pass the author marker so the maintain chain only maintains own symbols
							// A24: also pass the originator's snapshotted resolute and name (Anathema probes)
							// A28 Stufe 1: a dot block opts the application into the round/DoT engine -
							// duration (the effectDuration field that used to be discarded) and dot ride
							// along on the condition. The dot gate is deliberate: effectDuration is also
							// used as a plain marker on non-DoT paths (A23/A24 maintain symbols with
							// casterId, holyShield, dead/prone), which must keep their exact current
							// permanent behaviour - only the weapon-quality DoTs (and the inherit-wound
							// condition transfers, which carry a dot now too) become engine-managed
							let conditionData;
							if (flagData.casterId) {
								conditionData = { caster: flagData.casterId, ability: flagData.abilityRef, resolute: flagData.casterResolute, casterName: flagData.casterName };
							}
							if (flagData.dot) {
								const engineData = { dot: flagData.dot };
								if (flagData.effectDuration != null) engineData.durationRounds = flagData.effectDuration;
								conditionData = foundry.utils.mergeObject(conditionData ?? {}, engineData);
							}
							// A34: turn-end conditions - a second, separate opt-in marker with
							// the same marker protection as the dot gate above: effectDuration
							// alone still never opts into an engine (A23/A24 maintain symbols,
							// holyShield, dead/prone keep their exact current behaviour);
							// turnEndRounds drives the A34 turn-end hook's countdown
							if (flagData.turnEnd) {
								conditionData = foundry.utils.mergeObject(conditionData ?? {}, { turnEndRounds: flagData.effectDuration ?? 1 });
							}
							// A34-Fix (Rudolf's test round, Befunde 2+3): ONLY true maintain
							// symbols may raise the A29 "maintain?" reminder - the author markers
							// (caster/ability) alone are not enough, because Dominance fear,
							// Battlesymbol-Novice berserker and the Prios stun carry them for
							// the maintain CHAIN without being maintain powers. The flag rides
							// along from the push sites in standardPowerResult like turnEnd
							if (flagData.maintained === true) {
								conditionData = foundry.utils.mergeObject(conditionData ?? {}, { maintained: true });
							}
							// A33 (Zeichen der Pein, Adept+): the standing attacker-favour
							// flag rides along like turnEnd/maintained - the dialog's target
							// scan grants every attacker of the victim automatic favour
							// while the marked stun lasts
							if (flagData.attackerFavour === true) {
								conditionData = foundry.utils.mergeObject(conditionData ?? {}, { attackerFavour: true });
							}
							await actor.addCondition(flagData.addEffect, conditionData);
						}
					} else if (flagData.removeEffect) {
						await actor.removeCondition(flagData.removeEffect);
					}
					if (flagData.defeated && ui.combat.viewed && token) {
						// A25 F11: consistent big skull overlay via the shared helper
						await applyDeadOverlay(actor);
					}

					if (flagData.toughnessChange) {
						// A25 F9: capture the value BEFORE the update - every
						// automated action that brings an actor DOWN to 0
						// toughness now marks it heavily wounded like the
						// standard combat damage path: chat line + skull
						// overlay (defeated in the combat tracker, dead
						// condition otherwise). Chain powers like the
						// Master-level Entangling Vines / Earthbinding round
						// damage previously just clamped the value without
						// any feedback; an actor that already sits at 0 does
						// not re-trigger the message on further damage
						let oldToughness = actor.system.health.toughness.value;
						let newToughness = Math.max(0, Math.min(actor.system.health.toughness.max, oldToughness + flagData.toughnessChange));
						await actor.update({ 'system.health.toughness.value': newToughness });
						if (newToughness === 0 && oldToughness > 0) {
							let dyingName = token?.name ?? actor.name ?? '';
							await ChatMessage.create({
								speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: actor.id }),
								content: `<div class="symbaroum chat ability"><div class="foreground"><div class="finalTxt"><p>${dyingName}${game.i18n.localize('COMBAT.CHAT_DAMAGE_DYING')}</p></div></div></div>`,
							});
							// A25 F11 (Rudolf's test round): the skull form is now consistent -
							// ALWAYS the big overlay skull via the shared helper, no more small
							// dead condition outside the combat tracker; this also drops the
							// deprecated V14 Combat#getCombatantByToken call
							await applyDeadOverlay(actor);
						}
					}
					if (flagData.attributeChange) {
						let newMod = actor.system.attributes[flagData.attributeName].temporaryMod + flagData.attributeChange;
						let linkMod = 'system.attributes.' + flagData.attributeName + '.temporaryMod';
						await actor.update({ [linkMod]: newMod });
					}
					if (flagData.corruptionChange) {
						let newCorruption = actor.system.health.corruption.temporary + flagData.corruptionChange;
						await actor.update({ 'system.health.corruption.temporary': newCorruption });
					}
					if (flagData.addObject == 'blessedshield') {
						await createBlessedShield(actor, flagData.protection);
					}
				}
				await chatItem.unsetFlag(game.system.id, 'applyEffects');
				await chatItem.delete();
				return;
			});
		}
	}
	const functionStuff = await chatItem.getFlag(game.system.id, 'resistRoll');
	if (functionStuff) {
		const listenArea = html.querySelectorAll('#applyEffect');
		for (const s of listenArea) {
			s.addEventListener('click', async () => {
				let tok = canvas.tokens.objects.children.find((token) => token.id === functionStuff.tokenId);
				let targetToken = canvas.tokens.objects.children.find((token) => token.id === functionStuff.targetData.tokenId);
				if (tok === undefined || targetToken === undefined) {
					ui.notifications.error("Can't find token.");
					return;
				}
				functionStuff.token = tok;
				functionStuff.actor = tok.actor;
				functionStuff.targetData.token = targetToken;
				functionStuff.targetData.actor = targetToken.actor;
				// game.symbaroum.log("from hook: ", functionStuff);
				buildRolls(functionStuff);
				await chatItem.unsetFlag(game.system.id, 'resistRoll');
				return;
			});
		}
	}
});

// V12 code
Hooks.on('renderPause', (_app, html, options) => {
	html.find('img[src="icons/svg/clockwork.svg"]').attr('src', 'systems/symbaroum/asset/image/head.webp');
});
//V13 Code
Hooks.on('renderGamePause', (_app, html, options) => {
	document.getElementById('pause').innerHTML = `<img src=\"systems/symbaroum/asset/image/head.webp\" class=\"fa-spin\"><figcaption>Davokar Sleeps</figcaption>`;
});

function setup3PartySettings() {
	game.symbaroum.info('In setup3PartySettings');
	if (!game.user.isGM) {
		// Only make changes to system and 3rd party if it is a GM
		return;
	}
	if (game.settings.settings.has('dice-so-nice.enabledSimultaneousRollForMessage')) {
		game.settings.set('dice-so-nice', 'enabledSimultaneousRollForMessage', false);
	}
}
// This sets the css DOM objects we will change with the registered settings
async function setupConfigOptions() {
	// 7.1.9: rewritten for Foundry V14 robustness:
	// - the setting values store image paths relative to the system css
	//   ("url(../asset/...)"), but applied as an INLINE style on :root they
	//   resolve against the page URL, not against the stylesheet, and break.
	//   They are rewritten to root-relative "/systems/symbaroum/asset/..."
	//   which resolves correctly from any base URL.
	// - each setting is applied in its own try/catch, so one broken value
	//   cannot abort the whole loop (which previously left :root with the
	//   flat static fallbacks: black label bars, white inputs).
	const cssVarMap = [
		['--color-charBG', 'switchCharBGColour'],
		['--color-npcBG', 'switchNpcBGColour'],
		['--title-image', 'titleBGChoice'],
		['--title-color', 'switchTitleColour'],
		['--box-editable', 'switchEditableColour'],
		['--box-non-editable', 'switchNoNEditableColour'],
		['--chat-background', 'chatBGChoice'],
	];
	const r = document.querySelector(':root');
	for (const [cssVar, settingKey] of cssVarMap) {
		try {
			let value = game.settings.get('symbaroum', settingKey);
			if (typeof value === 'string') {
				value = value.replace(/url\(\s*['"]?\.\.\/asset\//gi, 'url(/systems/symbaroum/asset/');
				// 7.1.12: the 7.1.10 remap (title.webp -> /ui/denim075.png) is removed.
				// Rudolf verified that the repo's title.webp IS the wanted V13 banner
				// texture - stored settings with title.webp now pass through unchanged.
			}
			r.style.setProperty(cssVar, value);
		} catch (error) {
			game.symbaroum.error(`Could not apply setting "${settingKey}" to css variable "${cssVar}"`, error);
		}
	}
}

// this add new status effect to the foundry list
async function setupStatusEffects() {
	// V14: CONFIG.statusEffects is id-indexed (the old .push() is deprecated) and icon/label are
	// deprecated aliases for img/name - register the custom conditions with their canonical fields
	// so the token HUD status palette picks up their graphics (the V14 palette reads src from img)
	for (const status of game.symbaroum.config.systemConditionEffects) {
		CONFIG.statusEffects[status.id] = {
			...status,
			name: status.name ?? status.label,
			img: status.img ?? status.icon,
		};
	}
	// A35 (Rudolf's test round 2, Befund 10): the core-name Germanization now
	// lives in setupStatusEffectNames() at READY - see the comment there for
	// why this init-time patch of A34-Fix1 could never take effect
}

/* A35 (Rudolf's test round 2, Befund 10): German display names for the CORE
   statuses. The A34-Fix1 attempt ran inside the init hook, where the system's
   de.json translations are NOT loaded yet - localize() returned the raw key,
   the comparison failed and NOTHING was renamed (silently, no error). Now:
   - runs at ready, when all system translations are guaranteed loaded
   - replaces the whole entry object instead of mutating it (some CONFIG
     entries may be immutable), with a per-entry guard - a failed rename
     must never break the status palette
   - the addCondition name belt (actor.js) additionally guarantees German
     names on newly applied conditions even if this patch cannot run at all
   Only the display name changes - ids, icons, hasCondition and both engines
   are untouched; unmapped ids keep the core default, English clients resolve
   the en.json entries to the same English words, and the system's own
   conditions carry their i18n label keys and are skipped. */
async function setupStatusEffectNames() {
	const systemIds = new Set(game.symbaroum.config.systemConditionEffects.map((s) => s.id));
	// A35-Fix (Rudolf's test round, Befund 1): collect every core status that
	// still has no German name key - one console line at ready turns any
	// remaining English palette entry into a pure de/en data addition
	const unmapped = [];
	for (const [id, status] of Object.entries(CONFIG.statusEffects)) {
		if (systemIds.has(id)) continue;
		const key = `SYMBAROUM.STATUS_${id.toUpperCase()}`;
		try {
			const localized = game.i18n.localize(key);
			if (localized && localized !== key) {
				try {
					status.name = localized;
				} catch (err) {
					CONFIG.statusEffects[id] = { ...status, name: localized };
				}
			} else {
				unmapped.push(id);
			}
		} catch (err) {
			game.symbaroum.log(`A35: status name patch failed for '${id}'`, err);
		}
	}
	if (unmapped.length > 0) {
		game.symbaroum.log(`A35-Fix: core statuses without SYMBAROUM.STATUS_* name key (add de/en entries to translate them): ${unmapped.join(', ')}`);
	}
}

async function createBlessedShield(actor, protection = '1d4') {
	let blessedShield = {};
	blessedShield.system = foundry.utils.deepClone(game.model.Item.armor);

	blessedShield.name = game.i18n.localize('POWER_LABEL.BLESSED_SHIELD');
	blessedShield.type = 'armor';
	(blessedShield.img = 'icons/svg/holy-shield.svg'),
		(blessedShield.system.baseProtection = '0'),
		(blessedShield.system.bonusProtection = protection),
		(blessedShield.system.state = 'active');
	blessedShield.flags = {};
	blessedShield.flags[game.system.id] = { blessedshield: true };
	await Item.create(blessedShield, { parent: actor }, { renderSheet: false });
}

async function showReleaseNotes(originalVersion) {
	if (!game.user.isGM) {
		return;
	}
	try {
		const newVer = game.system.version;
		const releaseNoteName = 'Symbaroum System guide EN';
		const releasePackLabel = 'Symbaroum for FVTT system user guides';

		let currentVer = '0';
		let oldReleaseNotes = game.journal.getName(releaseNoteName);
		if (oldReleaseNotes !== undefined && oldReleaseNotes !== null && oldReleaseNotes.getFlag('symbaroum', 'ver') !== undefined) {
			currentVer = oldReleaseNotes.getFlag('symbaroum', 'ver');
		}
		if (newVer === currentVer) {
			// Up to date
			return;
		}

		let newReleasePack = game.packs.find((p) => p.metadata.label === releasePackLabel);
		if (newReleasePack === null || newReleasePack === undefined) {
			let err = 'No pack found for the system guide in this release';
			game.symbaroum.error(err);
			ui.notifications.error(err);
			// This is bad - the symbaroum pack does not exist in the system packages
			return;
		}
		await newReleasePack.getIndex();

		// Foundry VTT V14: the compendium index is not guaranteed to expose entry names,
		// so load the pack documents directly and search there (index stays as fallback).
		let newReleaseNotes;
		try {
			const documents = await newReleasePack.getDocuments();
			newReleaseNotes = documents.find((j) => j.name === releaseNoteName) ?? null;
		} catch (e) {
			game.symbaroum.error('Could not load the system guide pack contents', e);
			newReleaseNotes = null;
		}
		if (newReleaseNotes === null && Array.isArray(newReleasePack.index)) {
			newReleaseNotes = newReleasePack.index.find((j) => j.name === releaseNoteName) ?? null;
		}
		// game.symbaroum.log("Found new release notes in the compendium pack");
		if (newReleaseNotes === undefined || newReleaseNotes === null) {
			// The guide import is optional: log it, but do not spam the user with an error toast
			game.symbaroum.error('No system guide found in this release');
			return;
		}
		const newReleaseNotesId = newReleaseNotes.id ?? newReleaseNotes._id;

		// Don't delete until we have new release Pack
		if (oldReleaseNotes !== null && oldReleaseNotes !== undefined) {
			await oldReleaseNotes.delete();
		}

		await game.journal.importFromCompendium(newReleasePack, newReleaseNotesId, {}, { keepId: true });
		let newReleaseJournal = game.journal.getName(newReleaseNotes.name);

		await newReleaseJournal.setFlag('symbaroum', 'ver', newVer);

		// Show journal
		return newReleaseJournal.sheet.render(true, { sheetMode: 'text' });
		if (originalVersion === '0') {
			// TODO - move to hbs templat or other means for translating
			const message = `<h1>Welcome to your new Symbaroum world</h1>
      If you are new to the system, recommend that you check out the @UUID[JournalEntry.sSZzEbMgSLEclyBL]{system guide} in the journals.
      <br/>We also have a set of tours to help you get started, for @Tour[settings-tour]{settings} and @Tour[acompendium-tour]{compendiums}. `;
			ChatMessage.create({
				speaker: ChatMessage.getSpeaker({ alias: 'Symbaroum' }),
				content: message,
			});
		}
	} catch (error) {
		game.symbaroum.error(error);
	} // end of try
} // end of function

async function setupEmit() {
	game.symbaroum.info('Setting up Symbaroum emit system');
	SymbaroumCommsListener.ready();
}

Hooks.once('i18nInit', function () {
	// Prlocalization of system objects
	preLocalizeConfig();
});

function preLocalizeConfig() {
	const localizeConfigObject = (obj, keys) => {
		for (let o of Object.values(obj)) {
			for (let k of keys) {
				o[k] = game.i18n.localize(o[k]);
				console.log(o[k]);
			}
		}
	};
	localizeConfigObject(game.symbaroum.config.ACTION_TYPES, ['label']);
	localizeConfigObject(game.symbaroum.config.ARMOR_PROTECTION_SELECTION, ['label']);
	localizeConfigObject(game.symbaroum.config.ATTRIBUTE_SELECTION, ['label']);
	localizeConfigObject(game.symbaroum.config.WEAPON_TYPE_SELECTION, ['label']);
}
