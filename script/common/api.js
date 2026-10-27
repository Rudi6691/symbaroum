import { baseRoll, rollAttribute } from './roll.js';
// A38 Währungssystem: öffentliche Currency-API für externe Module (Händler-/Shop-Module)
import { convertToBase, allocateFromBase, getActorCurrencyTotal, modifyActorCurrency, deductActorCurrency, getItemPriceBase, parseCostString } from './currency.js';
// A39 Belastungssystem: öffentliche Encumbrance-API für externe Module
import { getEncumbranceData, getItemLoadGE, isEncumbranceEnabled } from './encumbrance.js';
// Behältersystem (Projekt "Behälter" v1): öffentliche Container-API
import {
	getActorContainers,
	getContainerChildren,
	getContainerTotals,
	moveItemToContainer,
	removeItemFromContainer,
	changeContainerCurrency,
} from './container.js';
// AP2 Stapeln (Merge-on-Drop): öffentliche Stapel-API
import { isStackableItem, getStackKey, findStackTarget, mergeStackDrop, splitStackItem } from './stacking.js';

export class SymbaroumAPI
{
    /**
     * The constructor - only used internally of the symbaroum system. Note that this is a singleton.
     */    
    constructor() {
        // Set-up anything else
        this.baseRoll = baseRoll;
        this.rollAttribute = rollAttribute;
        // A38: Currency-API — Beträge immer als Ganzzahl in der Basis-Einheit Orteg.
        this.convertCurrency = convertToBase;
        this.allocateCurrency = allocateFromBase;
        this.getActorCurrency = getActorCurrencyTotal;
        this.modifyActorCurrency = modifyActorCurrency;
        this.deductActorCurrency = deductActorCurrency;
        this.getItemPriceBase = getItemPriceBase;
        this.parseCostString = parseCostString;
        // A39: Encumbrance-API — Last in Gewichtseinheiten (GE), siehe encumbrance.js.
        this.getActorEncumbrance = getEncumbranceData;
        this.getItemLoadWeight = getItemLoadGE;
        this.isEncumbranceEnabled = isEncumbranceEnabled;
        // Behältersystem v1: Container-API — Geldbeträge immer als Ganzzahl
        // Orteg (A38-Konvention). moveItemToContainer erzwingt den Status-
        // Zwang ("Andere") und die Maximaltiefe 2 (Validierung in container.js).
        this.getActorContainers = getActorContainers;
        this.getContainerChildren = getContainerChildren;
        this.getContainerTotals = getContainerTotals;
        this.moveItemToContainer = moveItemToContainer;
        this.removeItemFromContainer = removeItemFromContainer;
        this.changeContainerCurrency = changeContainerCurrency;
        // AP2 Stapeln: Stapel-API — isItemStackable prüft die Regel-Matrix
        // (v2 Uniform-Regel: Waffe/Rüstung/Ausrüstung/Artefakt über
        // system.stackable steuerbar, Behälter und Nicht-Gear-Typen nie;
        // undefined = Typ-Default, Ausrüstung ohne Artefakt-Flag = an),
        // getStackKey liefert den Identitäts-Schlüssel (Typ + Name +
        // Preis-Basis + Gewicht), findStackTarget sucht den Merge-Ziel-
        // Stapel, mergeStackDrop führt einen Merge aus (mit Rechte-
        // Prüfung; Aufruf durch die Drop-Handler der Blätter).
        // splitStackItem trennt count Einheiten eines Stapels ab
        // (Anzahl des Quell-Items sinkt, Kopie mit count entsteht).
        this.isItemStackable = isStackableItem;
        this.getStackKey = getStackKey;
        this.findStackTarget = findStackTarget;
        this.mergeStackDrop = mergeStackDrop;
        this.splitStackItem = splitStackItem;
    }


    /**
     * Registers an API reference to call. It will not overwrite an existing one. Any form/shape of cascading has to be done by the registrant if there is a conflict.
     * 
     * @throws If the name API is already registered
     * @param {string} name - The name of the API reference
     * @param {function} func - The function for the API reference
     */
    registerFunction(name, func) {
        if( this[name] == undefined) {
            this[name] = func;
        } else {
            game.symbaroum.error(`Symbaroum API Function ${name} is already registered`);
        }
    }

    /**
     * Unregisters an API reference. Note that the API is used internally and you might brick the system by un-registering API required.
     * 
     * @param {string} name - The name of the API reference
     */
    unregisterFunction(name) {
        if( this[name] == undefined) {
            game.symbaroum.error(`Function ${name} is already deregistered`);
        } else {
            delete this[name];
        }
    }

    /**
     * 
     * @param {The name of the modifier function} name 
     * @returns 
     */
    _getItemModifierFunctionName(name) {
        return `getItemModifier${name.charAt(0).toUpperCase() + name.slice(1)}`;
    }

    /**
     * 
     * @param {The name of the modifier function} name 
     * @returns 
     */
    _getAbilityFunctionName(name) {
        return `abilitySetup${name.charAt(0).toUpperCase() + name.slice(1)}`;
    }

    /**
     * Register a function as an item modifier
     * 
     * @param {The name of the function} name 
     * @param {The function} func 
     */
    registerItemModifier(name, func) {
        const funcName = this._getItemModifierFunctionName(name)

        if( CONFIG.Item.documentClass.prototype[funcName] != undefined) {
            game.symbaroum.error(`ItemModifier ${name} is already registered`);
        } else {
            CONFIG.Item.documentClass.prototype[funcName] = func;
        }        
    }

    /**
     * Unregisters an item modifier function
     * 
     * @param {The name of the function} name 
     */
    unregisterItemModifier(name) {
        const funcName = this._getItemModifierFunctionName(name)

        if( CONFIG.Item.documentClass.prototype[funcName] == undefined) {
            game.symbaroum.error(`ItemModifier ${name} is already unregistered`);
        } else {
            delete CONFIG.Item.documentClass.prototype[funcName];
        }        
    }

    /**
     * Register a function as an item modifier
     * 
     * @param {The name of the function} name 
     * @param {The function} func 
     */
    registerAbility(name, func) {
        const funcName = this._getAbilityFunctionName(name)

        if( CONFIG.Item.documentClass.prototype[funcName] != undefined) {
            game.symbaroum.error(`Ability ${name} is already registered`);
        } else {
            CONFIG.Item.documentClass.prototype[funcName] = func;
        }        
    }

    /**
     * Unregisters an item modifier function
     * 
     * @param {The name of the function} name 
     */
    unregisterAbility(name) {
        const funcName = this._getAbilityFunctionName(name)

        if( CONFIG.Item.documentClass.prototype[funcName] == undefined) {
            game.symbaroum.error(`Ability ${name} is already unregistered`);
        } else {
            delete CONFIG.Item.documentClass.prototype[funcName];
        }        
    }


    /**
     * format the string to print the roll result, including the 2 dice if favour was involved, and the second roll when the option rare crits is enabled
     * 
     * @param {Roll} rollDataElement - The roll data information containing dice result
     * @returns {string} the formated and localized string
     */
    formatRollResult(rollDataElement){
        let rollResult = game.i18n.localize('ABILITY.ROLL_RESULT') + rollDataElement.diceResult.toString();
        if(rollDataElement.favour != 0){
            rollResult += "  (" + rollDataElement.dicesResult[0].toString() + " , " + rollDataElement.dicesResult[1].toString() + ")";
        }
        if(rollDataElement.secondRollResult){
            rollResult += " - " + game.i18n.localize('ABILITY.SECOND_ROLL_RESULT') + rollDataElement.secondRollResult.toString();
        }
        return rollResult;
    }

    /**
     * 
     * @param {The actor with attributes} actor 
     * @param {The name of the attribute, or "custom" or "defense"} attributeName 
     * @returns The I18N version of the attribute
     */
    getAttributeLabel(actor, attributeName) {
        if (attributeName === 'custom') {
            return game.i18n.localize("ATTRIBUTE.CUSTOM");
        } else if (attributeName === 'defense') {
            return game.i18n.localize("ARMOR.DEFENSE");
        } else {
            return game.i18n.localize(actor.system.attributes[attributeName].label);
        }
    }

    /**
     * Gets the best "Token" for an actor - as follows:
     * - If the actor is a token actor, grab the token for that actor
     * - If the actor is a non-token actor, select as follows:
     *   - grab the selected token with matching actorId
     *   - grab the first token from active tokens of the actor
     * 
     * @param {The actor in question} actor 
     */
    getActorToken(actor) {
        if(actor.isToken) {
            return actor.token;
        }
        let token = canvas.tokens.controlled.find( elem => elem.actor.id == actor.id);
        if(!token) {
            token = actor.getActiveTokens()[0];
        }
        return token;
    }
    /**
     * Generates names from specific category
     * 
     * @param {The syllabels in the name} nameParts 
     * @param {The number of names to be generated} numNames 
     * @returns 
     */
	generateCategoryName(nameParts, numNames)
	{		
		let arr = [];
		for(let i = 0; i < numNames; i++)
		{
			let fullName = '';
			for ( let syllabel of nameParts ) {
				let syllabelIndex = Math.floor(Math.random() * syllabel.length);
				let actualSyllabel = syllabel[syllabelIndex];
				if( actualSyllabel != "_") {
					fullName = fullName.concat(actualSyllabel);
				} else if(fullName.length > 3) {
					break;
				}
			}
			arr.push(fullName);
		}
		return arr;
	}

    /**
     * Generates name of the defined categories
     * 
     * @param {The category to generate names for} category 
     * @param {The number of names to be retrieved} numNames 
     * @returns 
     */
	async generateNames(category, numNames) {
		// allNames needs to load json
		const response = await fetch('systems/symbaroum/supplemental-data/names.json');
		if(!response.ok) {
			game.symbaroum.error("Could not fetch supplemental name data",response);
			return;
		}
		const allNames = await response.json();
		return this.generateCategoryName(allNames[category], numNames);
	}


    /**
     * Hooks
     */

    /**
     * This is the syntax for the hook of Symbaroum combat modifiers - these are passed by reference just prior to making changes
     * to the character.
     * 
     * @param {The actor for the hook} actor 
     * @param {All combatMods, by reference} combatMods 
     * @param {All allArmors, by refernce} allArmors 
     * @param {All weapons, by reference} allWeapons 
     * @param {All allAbilities, by refrence} allAbilities 
     */
    symbaroumItemModifiersSetup(actor, combatMods, allArmors, allWeapons, allAbilities) {
        Hooks.callAll(game.symbaroum.config.HOOKS.symbaroumItemModifiersSetup,actor, combatMods, allArmors, allWeapons, allAbilities);
    }



}
