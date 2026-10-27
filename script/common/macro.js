import { prepareRollAttribute } from "../common/dialog.js";
import { symbDialog } from "../common/symbDialog.js";
import { getCurrencyRates, getDenominations, parseCostString, getItemPriceBase } from "../common/currency.js";

export class SymbaroumMacros {
	constructor() {}

	macroReady() {
		this.setupMacroFolders();
		this.setupGMUtilityMacros();
		Hooks.on("hotbarDrop", (bar, data, slot) => {
			if (data.type === "attribute") {
				this.createSymbaroumAttributeMacro(data, slot);
				return false;
			} else if (data.type === "Item" && typeof data.uuid === "string") {
				// Check more
				let item = fromUuidSync(data.uuid);								
				if(item && item.system && (item.system.isWeapon || item.system.isArmor || item.system.isPower)) {
					this.createSymbaroumItemMacro(item, slot);
					return false;
				}	
			}
		});
	}

	setupMacroFolders() {
		game.symbaroum.info("In setupMacroFolders");
		if (!game.user.isGM) {
			// Only make changes to system
			return;
		}
		const folderName = game.symbaroum.config.SYSTEM_MACRO_FOLDER;
		let folder = game.folders
			.filter((f) => f.type === "Macro")
			.find((f) => f.name === folderName);
		if (!folder) {
			Folder.create({
				name: folderName,
				type: "Macro",
				parent: null,
			});
		}
	}

	/* -------------------------------------------- */
	/*  Hotbar Macros                               */
	/* -------------------------------------------- */

	async createSymbaroumAttributeMacro(data, slot)
	{
		game.symbaroum.log(data);
		const folder = game.folders
			.filter((f) => f.type === "Macro")
			.find((f) => f.name === game.symbaroum.config.SYSTEM_MACRO_FOLDER);
		// Create the macro command
		const command = `game.symbaroum.macros.rollAttribute('${data.attribute}');`;
		const actor = game.actors.get(data.actorId);
		if (!actor) return;

		const commmandName = game.i18n.format("MACRO.MAKETEST", {
			testtype: game.i18n.localize(
				actor.system.attributes[data.attribute].label
			),
		});

		let macro = game.macros.find(
			(m) =>
				m.name === commmandName &&
				m.command === command &&
				(m.author === game.user.id ||
					m.ownership.default >=
						CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER ||
					m.ownership[game.user.id] >=
						CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER)
		);
		if (!macro) {
			macro = await Macro.create({
				name: commmandName,
				type: "script",
				img: game.i18n.format(game.symbaroum.config.imageRef, {
					filename:
						game.symbaroum.config.attributeImages[
							data.attribute
						],
				}),
				command: command,
				flags: { "symbaroum.attributeMacro": true },
				folder: folder?.id,
				"ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
			});
		}
		game.user.assignHotbarMacro(macro, slot);
	}

	/**
	 * Create a Macro from an Item drop.
	 * Get an existing item macro if one exists, otherwise create a new one.
	 * @param {Object} data     The dropped data
	 * @param {number} slot     The hotbar slot to use
	 * @returns {Promise}
	 */
	async createSymbaroumItemMacro(item, slot) {
		game.symbaroum.log(item);
		const folder = game.folders
			.filter((f) => f.type === "Macro")
			.find((f) => f.name === game.symbaroum.config.SYSTEM_MACRO_FOLDER);
		// Create the macro command
		const command = `game.symbaroum.macros.rollItem("${item.name}");`;
		let macro = game.macros.find(
			(m) =>
				m.name === item.name &&
				m.command === command &&
				(m.author === game.user.id ||
					m.ownership.default >=
						CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER ||
					m.ownership[game.user.id] >=
						CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER)
		);
		if (!macro) {
			macro = await Macro.create({
				name: item.name,
				type: "script",
				img: item.img,
				command: command,
				flags: { "symbaroum.itemMacro": true },
				folder: folder?.id,
				"ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
			});
		}
		game.user.assignHotbarMacro(macro, slot);
	}
	/**
	 * Create a Macro from an attribute drop.
	 * Get an existing item macro if one exists, otherwise create a new one.
	 * @param {string} attribute
	 */
	async rollAttribute(attribute) {
		const speaker = ChatMessage.getSpeaker();
		let actor;
		if (speaker.token) actor = game.actors.tokens[speaker.token];
		if (!actor) actor = game.actors.get(speaker.actor);
		if (!actor) {
			return ui.notifications.warn(
				game.i18n.localize("ERROR.MACRO_NO_OBJECT") + speaker
			);
		}
		prepareRollAttribute(actor, attribute, null, null);
	}

	/**
	 * Create a Macro from an Item drop.
	 * Get an existing item macro if one exists, otherwise create a new one.
	 * @param {string} itemName
	 * @return {Promise}
	 */
	async rollItem(itemName) {
		const speaker = ChatMessage.getSpeaker();
		let actor;
		if (speaker.token) actor = game.actors.tokens[speaker.token];
		if (!actor) actor = game.actors.get(speaker.actor);
		const item = actor
			? actor.items.find(
					(i) => i.name === itemName && (i.system.isGear && i.system.isActive || i.system.isPower)
			)
			: null;
		if (!item)
			return ui.notifications.warn(
				game.i18n.localize("ERROR.MACRO_NO_OBJECT") + itemName
			);

		if (item.system.isWeapon) {
			const weapon = actor.system.weapons.filter(
				(it) => it.id == item.id
			)[0];
			return actor.rollWeapon(weapon);
		}
		if (item.system.isArmor) {
			return actor.rollArmor();
		} else if (item.system.isPower) {
			if (
				actor.system.combat.combatMods.abilities[item.id]
					?.isScripted
			) {
				return actor.usePower(item);
			} else
				return ui.notifications.warn(
					itemName + game.i18n.localize("ERROR.MACRO_NO_SCRIPT")
				);
		} else return;
	}

	getPlayerList() {
		let actorslist = [];

		if (canvas.tokens.controlled.length > 0) {
			// If no actor selected
			// Time to get busy
			canvas.tokens.controlled.map((e) => {
				if (e.actor.type === "player") {
					if (game.user.isGM || e.actor.owner)
						actorslist.push(e.actor);
				}
			});
		} else {
			let gameacts = game.actors.filter((e) => {
				if (
					(game.user.isGM || e.owner) &&
					e.type === "player" &&
					e.hasPlayerOwner
				) {
					return e;
				}
			});
			Array.prototype.push.apply(actorslist, gameacts);
		}
		return actorslist;
	}

    /**********************************************
     * Macro: addExp
     */

    // Built-in macros
	async addExp() {
		let defaultCheck = "checked"; // set to unchecked

		let allKeys = "";
		const actorslist = this.getPlayerList();

		if(actorslist.length === 0) {
			ui.notifications.info(`No actor available for you to add exp to`);
			return;
		} else if(actorslist.length === 1) {
			defaultCheck = "checked";
		}
		actorslist.forEach((t) => {
			allKeys =
				allKeys.concat(`<div style="flex-basis: auto;flex-direction: row;display: flex;">
                    <div style="width:10em;min-width:10em;"><label for="${t.id}">${t.name}</label> </div>
                    <div><input id="${t.id}" type="checkbox" name="selection" value="${t.id}" ${defaultCheck}="${defaultCheck}"></div>
                </div>`);
		});

		let dialog_content = `  
        <div class="form-group">
        <h2>${game.i18n.localize("MACRO.SELECTPLAYERS")}</h2>
        ${allKeys}
        <br />
        <div style="flex-basis: auto;flex-direction: row;display: flex;">
                    <div style="width:10em;min-width:10em;"><label for="experience" style="width:10em;min-width:10em">${game.i18n.localize("MACRO.EXPERIENCE")}</label></div><div><input type="text" name="experience" value="1" style="width:5em"></div>
        </div>
        <br/>
        </div>`;
		symbDialog({
			width: 300,
			title: game.i18n.localize("MACRO.ADDEXP_TITLE"),
			content: dialog_content,
			buttons: {
				Ok: {
					label: game.i18n.localize("DIALOG.OK"),
					callback: async (html) => {
						let tmp = html[0].querySelectorAll("input[name='selection']")
						let nodeList = Array.from(tmp)
						let Atmp = nodeList.filter((v) => {if (v.checked) return true;}).map((e) => {return e.value;});
						let exp = parseInt(html[0].querySelector("input[name='experience'").value);
						if (isNaN(exp) || Atmp.length == 0) {
							ui.notifications.error(
								game.i18n.localize("MACRO.ADDEXP_NUMBER")
							);
							return;
						}
						this.addExperience(Atmp, exp);
					},
				},
				Cancel: { label: game.i18n.localize("DIALOG.CANCEL") },
			},
		});

	}

	addExperience(actorids, exp) {
		let actorNames = "";
		let updates = actorids.map((a) => {
			let aexp = game.actors.get(a);

			actorNames = actorNames + "<li>" + aexp.name;

			return {
				_id: a,
				"system.experience.total": aexp.system.experience.total + exp,
			};
		});

		Actor.updateDocuments(updates);
		let chatOptions = {
			rollMode: game.settings.get("core", "messageMode"),
			content: `<h2>${game.i18n.localize("MACRO.ADDEXP_CHANGE")}</h2> 
						${game.i18n.format("MACRO.ADDEXP_CHANGE_LONG", {actorNames:actorNames, exp:exp })}`
			/// The following actors:<ul> ${actorNames}</ul> were awarded ${exp} experience`,
		};
		ChatMessage.create(chatOptions);
	}

    /**********************************************
     * Macro: addAlternativeDamage
     */

	addAlternativeDamage() {
		if (canvas.tokens.controlled.length === 0)
			return ui.notifications.error("Please select a token first");

		symbDialog({
			title: `Alternate Damage`,
			content: `<form>
            <div style="display:flex">
            <label style="min-width:15em" for="damagetype">Damage type:</label>
            <select id="vision-type" style="min-width:10em" name="damagetype">
            <option value="accurate">${game.i18n.localize("ATTRIBUTE.ACCURATE")}</option>
            <option value="cunning">${game.i18n.localize("ATTRIBUTE.CUNNING")}</option>
            <option value="discreet">${game.i18n.localize("ATTRIBUTE.DISCREET")}</option>
            <option value="persuasive">${game.i18n.localize("ATTRIBUTE.PERSUASIVE")}</option>
            <option value="quick">${game.i18n.localize("ATTRIBUTE.QUICK")}</option>
            <option value="resolute">${game.i18n.localize("ATTRIBUTE.RESOLUTE")}</option>
            <option value="strong">${game.i18n.localize("ATTRIBUTE.STRONG")}</option>
            <option value="vigilant">${game.i18n.localize("ATTRIBUTE.VIGILANT")}</option>    
            </select>
            </div>
            <div style="display:flex; margin-top:5px; margin-bottom:5px">
            <label style="min-width:15em" for="altdam">Damage:</label>
            <input style="max-width:10em" id="altdam" name="altdam" type="text">
            </div>
            </form>
            `,
			buttons: {
				yes: {
					icon: "<i class='fas fa-check'></i>",
					label: `Apply Damage`,
					callback: async (html) => {
						await dealDamage(
							html[0].querySelector("#vision-type").value,
							html[0].querySelector("#altdam").value
						);
					},
				},
				no: {
					icon: "<i class='fas fa-times'></i>",
					label: `Cancel Damage`,
				},
			},
			default: "yes",
		});

		async function dealDamage(type, damage) {
			for (let token of canvas.tokens.controlled) {
				let calcDam = parseInt(damage) * -1;
				if (isNaN(calcDam)) {
					game.symbaroum.error(
						"Can't understand damage[" +
							damage +
							"] - is this a number?"
					);
					break;
				}
				let actor = token.actor;
				if (
					actor.system.attributes[type] === undefined ||
					actor.system.attributes[type] === null
				) {
					game.symbaroum.error(`This[${type}] is not an attribute in Symbaroum`);
					break;
				}
				let tot =
					actor.system.attributes[type].temporaryMod + calcDam;
				let modification = {};
				foundry.utils.setProperty(
					modification,
					`system.attributes.${type}.temporaryMod`,
					tot
				);
				await actor.update(modification);
			}
		}
	}

    /**********************************************
     * Macro: rollAttribute
     */
    async rollAnyAttribute() {
        let defaultCheck = "unchecked"; // set to unchecked
        let actorslist = this.getPlayerList();
    
        if(actorslist.length === 0) {
            ui.notifications.info(`No actor available for you to do an attribute test`);
            return;
        } else if(actorslist.length === 1) {
            defaultCheck = "checked";
        }
    
        let allActors = "";
        actorslist.forEach(t => {
            allActors = allActors.concat(`<div style="flex-basis: auto;flex-direction: row;display: flex;">
                    <div style="width:10em;min-width:10em;"><label for="${t.id}">${t.name}</label> </div>
                    <div><input id="${t.id}" type="radio" name="selection" value="${t.id}" ${defaultCheck}="${defaultCheck}"></div>
                </div>`);
        });
        
        let keys = Object.keys(actorslist[0].system.attributes);
        let allKeys = "";
        keys.forEach(t => {
            allKeys = allKeys.concat(`<option value="${t}">${game.i18n.localize(actorslist[0].system.attributes[t].label)}`);
        });
    
        let dialog_content = `  
        <div class="form-group">
        <h2>Select player(s)</h2>
        ${allActors}
        <br />
        <div style="flex-basis: auto;flex-direction: row;display: flex;">
        <div style="width:10em;min-width:10em;"><label for="attribute" style="min-width:10em">${game.i18n.localize("DIALOG.ATTRIBUTE")}</label> </div>
        <div style="width:10em;min-width:10em;"><select id="attribute" name="category">${allKeys}</select></div>
        </div><br/>
        </div>`;
    
        symbDialog({
          width: 300,
            content : dialog_content,
            alternatives: keys,
            buttons : 
            {
            Ok : { 
                label : game.i18n.localize("DIALOG.OK"), callback : async (html)=> {
                    let actorTemp= Array.from(html[0].querySelectorAll("input[name='selection']"));
										let actorids = actorTemp.filter(v => { if(v.checked) return true; }).map(e => { return e.value});
                    let attribute = html[0].querySelector('#attribute').value;
                    actorids.map(a => {
                        let aexp = game.actors.get(a);
                        aexp.rollAttribute(attribute, null, null);
                    });
                }
            },
            Cancel : {label : game.i18n.localize("DIALOG.CANCEL")}
            }
        });
        
        
    }

    /**********************************************
     * Macro: Generate Name
     */
	async generateNames()
	{
		// allNames needs to load json
		const response = await fetch('systems/symbaroum/supplemental-data/names.json');
		if(!response.ok) {
			game.symbaroum.error("Could not fetch supplemental name data",response);
			return;
		}
		const allNames = await response.json();
		let keys = Object.keys(allNames);
		let allKeys = "";
		keys.forEach(t => {
			allKeys = allKeys.concat(`<option value="${t}">${t}`);
		});
	
		let dialog_content = `  
		<div class="form-group">
			<label for="category">Select name generator</label>
			<select id="category" name="category">${allKeys}
			</select>
		</div>`;
	
		// let template = Handlebars.compile(dialog_content);
		
		symbDialog({
			width: 300,
			content : dialog_content,
			alternatives: keys,
			buttons : 
			{
				Ok : { label : `Ok`, callback : async (html)=> await this.generateNameChat(html[0].querySelector('#category').value, allNames)},
				Cancel : {label : `Cancel`}
			}
		});
	}

	async generateNameChat(category, allNames)
	{
		let message = `Category ${category} - Names<br />`;
	
		const myNames = game.symbaroum.api.generateCategoryName(allNames[category], 10);
		message += myNames.join('<br />');

		ChatMessage.create({
			speaker: ChatMessage.getSpeaker({alias: "Name generator"}),
			whisper: [game.user], // ChatMessage.getWhisperRecipients('GM'),
			content: message        
		});
	}

    /**********************************************
     * Macro: Make a monster a PC, make a PC a monster
     */
	async togglePlayerNPC()
	{
    let dialog_content = `  
    <div class="form-group">
        Type the exact name of the player/npc - ensure the Player/NPC has a unique name among all your actors.  <br/> A NPC will be made into a player. A player will be made into an NPC.<br/>
      <label for="npctext">NPC name</label>
      <input name="npctext" type="text">
    </div>`;
  
    symbDialog({
      width: 200,
      content : dialog_content,
      buttons : 
      {
        Ok : { label : `Ok`, callback : async (html)=> await this.change2PC(html[0].querySelector('[name=npctext]').value.replace(/[\r|\n]/g, ""))},
        Cancel : {label : `Cancel`}
      }
    });
  
  
	}

	async change2PC(npcname)
	{
    let myActor = game.actors.getName(npcname);
    
    if( myActor === null) {
        ui.notifications.error(`Could not find actor with name ${npcname}. Try again`);
        return;
    }
    let update = { 
        "type" : myActor.type === "player" ? "monster":"player",
				"==system" : myActor.toObject().system
    };
    await myActor.update(update);
    ui.notifications.info(`Actor with name ${npcname} is now a ${update.type}.`);
	}
    /**********************************************
     * Macro: dealAlternativeDamage
     */
		async dealAlternativeDamage() {
			if (canvas.tokens.controlled.length === 0)
				return ui.notifications.error("Please select a token first");

			symbDialog({
				title: `Alternate Damage`,
				content: `
					<form>
					<div style="display:flex">
					<label style="min-width:15em" for="damagetype">Damage type:</label>
					<select id="vision-type" style="min-width:10em" name="damagetype">
					<option value="accurate">${game.i18n.localize("ATTRIBUTE.ACCURATE")}</option>
					<option value="cunning">${game.i18n.localize("ATTRIBUTE.CUNNING")}</option>
					<option value="discreet">${game.i18n.localize("ATTRIBUTE.DISCREET")}</option>
					<option value="persuasive">${game.i18n.localize("ATTRIBUTE.PERSUASIVE")}</option>
					<option value="quick">${game.i18n.localize("ATTRIBUTE.QUICK")}</option>
					<option value="resolute">${game.i18n.localize("ATTRIBUTE.RESOLUTE")}</option>
					<option value="strong">${game.i18n.localize("ATTRIBUTE.STRONG")}</option>
					<option value="vigilant">${game.i18n.localize("ATTRIBUTE.VIGILANT")}</option>    
					</select>
					</div>
					<div style="display:flex; margin-top:5px; margin-bottom:5px">
					<label style="min-width:15em" for="altdam">Damage:</label>
					<input style="max-width:10em" id="altdam" name="altdam" type="text">
					</div>
					</form>
					`,
				buttons: {
					yes: {
						icon: "<i class='fas fa-check'></i>",
						label: `Apply Damage`,
						callback: async (html)=> {
								await this.dealDamage(html[0].querySelector("#vision-type").value, html[0].querySelector('#altdam').value);
							}
					},
					no: {
						icon: "<i class='fas fa-times'></i>",
						label: `Cancel Damage`
					},
				},
				default: "yes",
			});
		}

		async dealDamage(type, damage)
		{
				for ( let token of canvas.tokens.controlled ) {
						let calcDam = parseInt(damage) * -1;
						if( isNaN(calcDam)) {
								game.symbaroum.log("Can't understand damage["+damage+"] - is this a number?");
								break;
						}
						let actor = token.actor;
						if( actor.system.attributes[type] === undefined || actor.system.attributes[type] === null) {
								game.symbaroum.log("This is not an attribute in Symbaroum");
								break;
						}
						let tot = actor.system.attributes[type].temporaryMod + calcDam;
						let modification = {        };
						foundry.utils.setProperty(modification, `system.attributes.${type}.temporaryMod`, tot);        
						await actor.update(modification);
						ui.notifications.info(`${actor.name} takes ${damage} damage to ${game.i18n.localize(actor.system.attributes[type].label)}.`);

				}
		}
    /**********************************************
     * Macro: Pay for Re-Roll
		 * 
     */
		async payForReRoll()
		{
				let defaultCheck = "unchecked"; // set to unchecked
				const actorslist = this.getPlayerList();
				if(actorslist.length === 0) {
						ui.notifications.info(`No actor available for you to apply re-roll cost`);
						return;
				} else if(actorslist.length === 1) {
						defaultCheck = "checked";
				}    

				let allKeys = "";
				actorslist.forEach(t => {
						allKeys = allKeys.concat(`<div style="flex-basis: auto;flex-direction: row;display: flex;">
										<div style="width:10em;min-width:10em;"><label for="${t.id}">${t.name}</label> </div>
										<div><input id="${t.id}" type="radio" name="selection" value="${t.id}" ${defaultCheck}="${defaultCheck}"></div>
								</div>`);
				});

				let dialog_content = `  
				<div class="form-group">
				<h2>Select player(s)</h2>
				${allKeys}
				<br />
				<div>Select what was used for the re-roll</div>
				<div style="flex-basis: auto;flex-direction: row;display: flex;">
						<div style="width:10em;min-width:10em;"><label for="artifactrr">Experience</label> </div>
						<div><input type="radio" id="artifactrr" value="artifactrr" name="costType"></div>
				</div>
				<div style="flex-basis: auto;flex-direction: row;display: flex;">
						<div style="width:10em;min-width:10em;"><label for="permanent">Corruption (perm)</label></div>
						<div><input type="radio" id="permanent" value="permanent" name="costType"></div>
				</div>`;
				dialog_content += `<br /></div>`;
				symbDialog({
				width: 300,
						title: "Pay the cost for re-roll",
						content : dialog_content,
						buttons : 
						{
								Ok :{ label : `Ok`, callback : async (html) => {  
																								let  selTmp= Array.from(html[0].querySelectorAll("input[name='selection']"));
																								let tmp = selTmp.filter(v => { if(v.checked) return true; }).map(e => { return e.value});
																								let costTmp  = Array.from(html[0].querySelectorAll("input[name='costType']"));
																							  let	costType = costTmp.filter(v => { if(v.checked) return true; }).map(e => { return e.value});

																								await this.payCost(tmp,costType);
																						}
										},
								Cancel : {label : `Cancel`}
						}
				});
				
				
		}

		async payCost(actorids, costType)
		{
				let aexp = null;
				let actorName = "";
				
				let message_content = "";

				let updates = actorids.map(a => {
						aexp = game.actors.get(a);
						actorName = aexp.name;        
						return {
								_id: a,
								"system.experience.artifactrr": aexp.system.experience.artifactrr + ( costType.includes("artifactrr")? 1:0),
								"system.health.corruption.permanent": aexp.system.health.corruption.permanent + ( costType.includes("permanent")? 1:0),
								"system.health.corruption.longterm": aexp.system.health.corruption.longterm + ( costType.includes("longterm")? dice.total:0)
						};
				});
				// game.symbaroum.log(updates);
				let chatOptions = {
						speaker: 
						{
					actor: aexp._id
						},
						rollMode: game.settings.get("core", "messageMode")
				};

				// 
				chatOptions["content"] = `<h2>Re-roll for ${ costType.includes("artifactrr") ? "experience":"permanent corruption" }</h2>
						${actorName} paid 1 ${ costType.includes("artifactrr") ? "experience":"permanent corruption" } for a re-roll`
				ChatMessage.create(chatOptions);     
				await Actor.updateDocuments(updates);				
				// Post results
		}

    /**********************************************
     * Macro: crbCharacterImporter
		 * To use this macro, paste monster system.from a pdf, for the core book:
		 * including the name of the monster, to the end of the "Tactics" section
		 * 
		 * For the monster codex, manually type in the name, then copy from Manners to end of tactics and paste.
		 * Warning: the tilted character sheet can cause issues, depending on your pdf viewer, you might need to do those manually.
		 * 
		 * WARNING 2: If you have multiple items that matches the name of abilities, traits and mystical powers, they might be found instead.
		 *  
		 * Make sure you have all abilities, traits and powers in the "Items" in Foundry.
     */

		async crbCharacterImporter() {
				let dialog_content = `  
				<div class="symbaroum dialog">
						<div style="width:100%; text-align:center">
								<h3><a href="https://freeleaguepublishing.com/shop/symbaroum/core-rulebook/" target="_blank">Symbaroum Core Book</a> Character Importer</h3>
						</div>
						<div class="advantage">
								<label for="isplayer">Player</label>
								<span class="lblfavour"><input type="checkbox" id="isplayer" name="isplayer"></span>
						</div>
						<div class="advantage">
								<label for="npctext">Paste PDF data</label>
								<input name="npctext" type="text">
						</div>
				</div>`;

				symbDialog({
				width: 400,
						content : dialog_content,
						buttons : 
						{
								Ok : { label : `Ok`, callback : async (html)=> await this.extractAllData(html[0].querySelector('[name=npctext]').value.replace(/[\r|\n]/g, ""), html[0].querySelector("#isplayer").checked)},
								Cancel : {label : `Cancel`}
						}
				});

		}

		async extractSpecialItems(actorItems, type, abilitilist, abilityPattern)
		{
				let message = "";
				if( abilitilist !== null) {
						await abilitilist.forEach(async element => { 
								let tmpdata = element.trim().match(abilityPattern);
								// game.symbaroum.log("tmpdata = "+tmpdata);
								if( tmpdata != null && tmpdata.length == 3)
								{
										let higherLevel = false;
										let ability = game.items.filter(element => element.name.trim().toLowerCase() === tmpdata[1].trim().toLowerCase() && element.type === type);                
										if(ability.length > 0 )
										{
												// game.symbaroum.log("ability="+JSON.stringify(ability));

												ability = foundry.utils.duplicate(ability[0]);
												let abilityAction = "";

												// Master ability
												if(tmpdata[2] === "master" || tmpdata[2] === "III") {                    
														higherLevel = true;
														foundry.utils.setProperty(ability, "system.master.isActive",true);                                            
												}                
												abilityAction = foundry.utils.getProperty(ability, "system.master.action");
												if( abilityAction === "") {
														foundry.utils.setProperty(ability, "system.master.action", "A");
												}
												// Adept ability
												if(tmpdata[2] === "adept" || tmpdata[2] === "II" || higherLevel) {                
														higherLevel = true;
														foundry.utils.setProperty(ability, "system.adept.isActive",true);                        

												}    
												abilityAction = foundry.utils.getProperty(ability, "system.adept.action");
												if( abilityAction === "") {
														foundry.utils.setProperty(ability, "system.adept.action", "A");
												}
												// Novice ability
												if(tmpdata[2] === "novice" || tmpdata[2] === "I" || higherLevel) {                              
														foundry.utils.setProperty(ability, "system.novice.isActive",true);                        
												}
												abilityAction = foundry.utils.getProperty(ability, "system.novice.action");
												if( abilityAction === "") {
														foundry.utils.setProperty(ability, "system.novice.action", "A");
												}
												// game.symbaroum.log("Final ability "+JSON.stringify(ability));
												game.symbaroum.log("Added ability "+ability.name)
												actorItems.push(ability);
										}
										else if( type !== "mysticalPower" && type !== "ability" )
										{
												message += `${element} not added as ${type} - add manually if needed <br/>`;
										}
								}
								else if( element.trim() !== "")
								{
										// message += `${element} not added - not found under Items - add manually <br/>`;
										game.symbaroum.log("element["+element+"] not found - add manually");           
								}
						});

				}    
				return message;    
		}

		async extractAllData(npcData, player)
		{
				let additionalInfo = "";

				const extractData = function(inputData, inputPattern) {
						let tmp = inputData.match(inputPattern);
						if( tmp != null && tmp.length >= 2) {
								// successful match
								return tmp[1];
						}
						return "nomatch";
				};
				let expectedData = npcData.replace(/- /g,"");

				let namePattern = /^(.+?) (Race|Manner)/;
				let newValues = {
						name: extractData(expectedData,namePattern),
						type: player ? "player": "monster",
						folder: null,
						sort: 12000,
						data: {},
						token: {},
						items: [],
						flags: {}        
				}

				let mannerPattern = /Manner (.*) Race /;
				foundry.utils.setProperty(newValues, "system.bio.manner",extractData(expectedData,mannerPattern));

				let racePattern = /Race (.*) Resistance/;
				foundry.utils.setProperty(newValues, "system.bio.race",extractData(expectedData,racePattern));

				let attributePattern = /Accurate ([0-9]+)/;
				// game.symbaroum.log("Accurate["+extractData(expectedData,attributePattern)+"]");
				foundry.utils.setProperty(newValues, "system.attributes.accurate.value", parseInt(extractData(expectedData,attributePattern)));
				attributePattern = /Cunning ([0-9]+)/;
				// game.symbaroum.log("Cunning["+extractData(expectedData,attributePattern)+"]");
				foundry.utils.setProperty(newValues, "system.attributes.cunning.value", parseInt(extractData(expectedData,attributePattern)));    
				attributePattern = /Discreet ([0-9]+)/;
				// game.symbaroum.log("Discreet["+extractData(expectedData,attributePattern)+"]");
				foundry.utils.setProperty(newValues, "system.attributes.discreet.value", parseInt(extractData(expectedData,attributePattern)));
				attributePattern = /Persuasive ([0-9]+)/;
				// game.symbaroum.log("Persuasive["+extractData(expectedData,attributePattern)+"]");
				foundry.utils.setProperty(newValues, "system.attributes.persuasive.value", parseInt(extractData(expectedData,attributePattern)));
				attributePattern = /Quick ([0-9]+).+\)/;
				// game.symbaroum.log("Quick["+extractData(expectedData,attributePattern)+"]");
				foundry.utils.setProperty(newValues, "system.attributes.quick.value", parseInt(extractData(expectedData,attributePattern)));
				attributePattern = /Resolute ([0-9]+)/;
				// game.symbaroum.log("Resolute["+extractData(expectedData,attributePattern)+"]");
				foundry.utils.setProperty(newValues, "system.attributes.resolute.value", parseInt(extractData(expectedData,attributePattern)));
				attributePattern = /Strong ([0-9]+)/;
				// game.symbaroum.log("Strong["+extractData(expectedData,attributePattern)+"]");
				foundry.utils.setProperty(newValues, "system.attributes.strong.value", parseInt(extractData(expectedData,attributePattern)));
				attributePattern = /Vigilant ([0-9]+)/;
				// game.symbaroum.log("Vigilant["+extractData(expectedData,attributePattern)+"]");
				foundry.utils.setProperty(newValues, "system.attributes.vigilant.value", parseInt(extractData(expectedData,attributePattern)));

				let shadowPattern = /Shadow (.*) \(/;
				// game.symbaroum.log("Shadow["+extractData(expectedData,shadowPattern)+"]");    
				foundry.utils.setProperty(newValues, "system.bio.shadow", extractData(expectedData,shadowPattern));
				
				// If nomatch == thouroughly corrupt
				let corruptionPattern = /\(corruption: ([0-9]+).?\)/;
				// game.symbaroum.log("Permanent Corruption["+extractData(expectedData,corruptionPattern)+"]");   
				let corr = extractData(expectedData,corruptionPattern);
				if( corr !== null && corr !== "nomatch" ) {
						foundry.utils.setProperty(newValues, "system.health.corruption.permanent", parseInt(extractData(expectedData,corruptionPattern))); 
				}
				
				let tacticsPattern = / Tactics: (.*)/;
				// game.symbaroum.log("Tactics["+extractData(expectedData,tacticsPattern)+"]");
				foundry.utils.setProperty(newValues, "system.bio.tactics", extractData(expectedData,tacticsPattern));

				let actor = await Actor.create(newValues);

				let abilitiesPattern = /Abilities (.+?) Weapons /;
				let singleAbilityPattern = /([^,^\)]+?\))?/g;
				let abilityPattern = / ?([^\(]+)\((.+)\)/;
				let allAbilities = extractData(expectedData,abilitiesPattern);
				game.symbaroum.log("allAbilities:"+allAbilities);
				let abilitilist = allAbilities.match(singleAbilityPattern);
				let actorItems = [];
				game.symbaroum.log("abilitylist:"+abilitilist);

				// Normal abilities
				// Medicus (master), 
				additionalInfo += await this.extractSpecialItems(actorItems, "ability", abilitilist, abilityPattern);
				additionalInfo += await this.extractSpecialItems(actorItems, "mysticalPower", abilitilist, abilityPattern);
				// Mystical Power
				// let mysticalPowerPattern = /Mystical [Pp]ower \(([^,]+), ([^\)]*)\)/g;
				let singleMysticalPowerPattern = /Mystical [Pp]ower \(([^\)]*)\)/g;
				abilitilist = allAbilities.match(singleMysticalPowerPattern);
				let mysticalPowerPattern = /\(([^,]+), (.*)\)/
				game.symbaroum.log("abilitylist[mp]:"+JSON.stringify(abilitilist));
				// Mystical Power (Bend Will, master)
				additionalInfo += await this.extractSpecialItems(actorItems, "mysticalPower", abilitilist, mysticalPowerPattern);

				let traitsPattern = /Traits (.+) Accurate [0-9]/;
				game.symbaroum.log("Traits["+extractData(expectedData,traitsPattern)+"]");
				let traitstlist = extractData(expectedData,traitsPattern).match(singleAbilityPattern);
				// game.symbaroum.log("traitslist ="+JSON.stringify(traitstlist));
				additionalInfo += await this.extractSpecialItems(actorItems, "trait", traitstlist, abilityPattern);

				// game.symbaroum.log("actorItems:"+JSON.stringify(actorItems));

				let updateObj = await actor.createEmbeddedDocuments("Item", actorItems);
				// game.symbaroum.log("updateObj "+JSON.stringify(updateObj));

				let healMe = {_id:actor.id};
				foundry.utils.setProperty(healMe, "system.health.toughness.value", foundry.utils.getProperty(actor, "system.health.toughness.max") );
				await Actor.updateDocuments([healMe]);

				let message = `Created ${actor.name}<br/>${additionalInfo}`;
				ChatMessage.create({
						speaker: ChatMessage.getSpeaker({alias: "Character Importer Macro"}),
						whisper: [game.user],
						content: message
				});

				actor.sheet.render(true);
		}
		
    /**********************************************
     * Macro: starterSetCharacterImport
		* To use this macro, paste monster data from a pdf, for the starter set or haunted wastes:
		* including the name of the monster, to the end of the "Tactics" section
		* 
		* If you use qpdfviewer - press 4 returns after the name
		* 
		* 
		* 
		*  
		* Make sure you have all abilities, traits and powers in the "Items" in Foundry.
		* 
		*/
	starterSetCharacterImport() {
			let dialog_content = `  
			<div class="symbaroum dialog">
					<div style="width:100%; text-align:center">
							<h3><a href="https://freeleaguepublishing.com/en/store/?product_id=7092044267669" target="_blank">Symbaroum Starter Set</a> Character Importer</h3>
					</div>
					<div class="advantage">
							<label for="isplayer">Player</label>
							<span class="lblfavour"><input type="checkbox" id="isplayer" name="isplayer"></span>
					</div>
					<div class="advantage">
							<label for="npctext">Paste PDF data</label>
							<textarea name="npctext" type="text" cols=30 rows=8></textarea>
					</div>
			</div>`;

			symbDialog({
			width: 400,
					content : dialog_content,
					buttons : 
					{
							Ok : { label : `Ok`, callback : async (html)=> await this.extractAllDataStartSet(html[0].querySelector('[name=npctext]').value, html[0].querySelector("#isplayer").checked)},
							Cancel : {label : `Cancel`}
					}
			});

	}
	/*
	async extractSpecialItems(actorItems, type, abilitilist, abilityPattern)
	{
			let message = "";
			if( abilitilist !== null) {
					await abilitilist.forEach(async element => { 
							let tmpdata = element.trim().match(abilityPattern);            
							if( tmpdata != null && tmpdata.length == 3)
							{
									game.symbaroum.log("tmpdata = ",tmpdata);
									let higherLevel = false;
									let ability = game.items.filter(element => element.name.trim().toLowerCase() === tmpdata[1].trim().toLowerCase() && element.type === type);
									if(ability.length > 0 )
									{
											// game.symbaroum.log("ability="+JSON.stringify(ability));

											ability = foundry.utils.duplicate(ability[0].data);
											let abilityAction = "";

											// Master ability
											if(tmpdata[2] === "master" || tmpdata[2] === "III") {                    
													higherLevel = true;
													foundry.utils.setProperty(ability, "data.master.isActive",true);                                            
											}                
											abilityAction = foundry.utils.getProperty(ability, "data.master.action");
											if( abilityAction === "") {
													foundry.utils.setProperty(ability, "data.master.action", "A");
											}
											// Adept ability
											if(tmpdata[2] === "adept" || tmpdata[2] === "II" || higherLevel) {                
													higherLevel = true;
													foundry.utils.setProperty(ability, "data.adept.isActive",true);                        

											}    
											abilityAction = foundry.utils.getProperty(ability, "data.adept.action");
											if( abilityAction === "") {
													foundry.utils.setProperty(ability, "data.adept.action", "A");
											}
											// Novice ability
											if(tmpdata[2] === "novice" || tmpdata[2] === "I" || higherLevel) {                              
													higherLevel = true;
													foundry.utils.setProperty(ability, "data.novice.isActive",true);                        
											}
											abilityAction = foundry.utils.getProperty(ability, "data.novice.action");
											if( abilityAction === "") {
													foundry.utils.setProperty(ability, "data.novice.action", "A");
											}
											if( !higherLevel ) {
													message += `Could not establish level for ${ability.name} - change manually <br/>`;
											}
											// game.symbaroum.log("Final ability "+JSON.stringify(ability));
											game.symbaroum.log("Added ability "+ability.name)
											actorItems.push(ability);
									}

							}
							else if( element.trim() !== "")
							{
									// message += `${element} not added - not found under Items - add manually <br/>`;
									game.symbaroum.log("element["+element+"] not found - add manually");           
							}
					});

			}    
			return message;    
	}
 */

	async extractAllDataStartSet(npcData, player)
	{
			let additionalInfo = "";
			const countnl = (str) => {
				const re = /[\n\r]/g
				return ((str || '').match(re) || []).length
			}
			const countother = (pattern, str) => {
				const re = pattern
				return ((str || '').match(re) || []).length
			}

			const extractData = function(inputData, inputPattern) {
				let tmp = inputData.match(inputPattern);
				if( tmp != null && tmp.length >= 2) {
						// successful match
						return tmp[1];
				}
				return "nomatch";
			};

			const extractWeapons = async function(actorItems, type, weaponList)
			{
					game.symbaroum.log(actorItems, type, weaponList);
					if(weaponList !== null)
					{

					}
					return "";
			};

			// Count new lines
			if( countnl(npcData) > 3 ) {
					npcData = npcData.replace(/[\r|\n]/, " NLMARKER ");
			} else {
					// Find text after name - not sure this is doable - hack it for now?
					// Recommendation is to "have 4 linebreaks after name"

			}
			let expectedData = npcData.replace(/[\r|\n]/g, " ");
			expectedData = expectedData.replace(/[–−]/g, "-");
			expectedData = expectedData.replace(/Integrated -?/g,""); 
			// expectedData = expectedData.replace(/Abilities /g,""); 
			// Hack
			expectedData = expectedData.replace(/Traits -?/g,""); 
			expectedData = expectedData.replace(/Abilities -/g,"Abilities ");
			// expectedData = expectedData.replace(/ ?[-]/g,"");
			
			game.symbaroum.log(expectedData);    

			let namePattern = /^(.+?) (Race|Manner|NLMARKER)/;
			let newValues = {
					name: extractData(expectedData,namePattern),
					type: player ? "player": "monster",
					folder: null,
					sort: 12000,
					data: {},
					token: {},
					items: [],
					flags: {}        
			}

			let mannerPattern = /resistance “(.*)”/;
			foundry.utils.setProperty(newValues, "system.bio.manner",extractData(expectedData,mannerPattern));

			let racePattern = /NLMARKER (.*?), .* resistance/;
			foundry.utils.setProperty(newValues, "system.bio.race",extractData(expectedData,racePattern));

			let myMatches = [];
			game.symbaroum.log("My count other is "+countother(/ACC CUN DIS PER QUI RES STR VIG/g,expectedData));
			if( countother(/ACC CUN DIS PER QUI RES STR VIG/g,expectedData) == 1 ) {
					// do it this way
					myMatches = expectedData.match(/ACC CUN DIS PER QUI RES STR VIG ([-+]?[0-9]+) ([-+]?[0-9]+) ([-+]?[0-9]+) ([-+]?[0-9]+) ([-+]?[0-9]+) ([-+]?[0-9]+) ([-+]?[0-9]+) ([-+]?[0-9]+)/);
					
			} else {         
					// do it the other way
					myMatches = expectedData.match(/ACC ([-+]?[0-9]+) CUN ([-+]?[0-9]+) DIS ([-+]?[0-9]+) PER ([-+]?[0-9]+) QUI ([-+]?[0-9]+) RES ([-+]?[0-9]+) STR ([-+]?[0-9]+) VIG ([-+]?[0-9]+)/);
			}
			game.symbaroum.log(myMatches);
			if(myMatches !== null && myMatches.length === 9 ) {
					foundry.utils.setProperty(newValues, "system.attributes.accurate.value", 10 - parseInt(myMatches[1]) );
					foundry.utils.setProperty(newValues, "system.attributes.cunning.value", 10 - parseInt(myMatches[2]) );    
					foundry.utils.setProperty(newValues, "system.attributes.discreet.value", 10 - parseInt(myMatches[3]) );    
					foundry.utils.setProperty(newValues, "system.attributes.persuasive.value", 10 - parseInt(myMatches[4]) );    
					foundry.utils.setProperty(newValues, "system.attributes.quick.value", 10 - parseInt(myMatches[5]) );    
					foundry.utils.setProperty(newValues, "system.attributes.resolute.value", 10 - parseInt(myMatches[6]) );    
					foundry.utils.setProperty(newValues, "system.attributes.strong.value", 10 - parseInt(myMatches[7]) );    
					foundry.utils.setProperty(newValues, "system.attributes.vigilant.value", 10 - parseInt(myMatches[8]) );    
			} else {
					additionalInfo += "Could not find the attributes<br/>";
			}
			let shadowPattern = /Shadow ([^\(]*)/;
			game.symbaroum.log("Shadow["+extractData(expectedData,shadowPattern)+"]");    
			foundry.utils.setProperty(newValues, "system.bio.shadow", extractData(expectedData,shadowPattern));
			
			// If nomatch == thouroughly corrupt
			let corruptionPattern = /\(corruption: ([0-9]+).?\)/;
			// game.symbaroum.log("Permanent Corruption["+extractData(expectedData,corruptionPattern)+"]");   
			let corr = extractData(expectedData,corruptionPattern);
			if( corr !== null && corr !== "nomatch" ) {
					foundry.utils.setProperty(newValues, "system.health.corruption.permanent", parseInt(extractData(expectedData,corruptionPattern))); 
			}
			
			let tacticsPattern = / Tactics: (.*)/;
			game.symbaroum.log("Tactics["+extractData(expectedData,tacticsPattern)+"]");
			foundry.utils.setProperty(newValues, "systembio.tactics", extractData(expectedData,tacticsPattern));

			let actor = await Actor.create(newValues);

			let abilitiesPattern = /Abilities(.+?) (Shadow|Equipment)/;
			let singleAbilityPattern = /([^,^\)]+?\))?/g;
			let abilityPattern = / ?([^\(]+)\((.+)\)/;
			let allAbilities = extractData(expectedData,abilitiesPattern);
			// game.symbaroum.log("allAbilities:"+allAbilities);
			let abilitilist = allAbilities.match(singleAbilityPattern);
			let actorItems = [];
			// game.symbaroum.log("abilitylist:"+abilitilist);

			// Normal abilities
			// Medicus (master), 
			additionalInfo += await this.extractSpecialItems(actorItems, "ability", abilitilist, abilityPattern);
			additionalInfo += await this.extractSpecialItems(actorItems, "mysticalPower", abilitilist, abilityPattern);
			additionalInfo += await this.extractSpecialItems(actorItems, "trait", abilitilist, abilityPattern);

			// game.symbaroum.log("actorItems:"+JSON.stringify(actorItems));
			// Weapons
			let weaponsPattern = /Weapons (.+?) (Abilities|Traits)/;
			let singelWeaponPattern = / ?([^0-9]*)[0-9]+/g;
			let allWeapons = extractData(expectedData,weaponsPattern);
			game.symbaroum.log("allWeapons", allWeapons)
			additionalInfo += await extractWeapons(allWeapons, "weapon", abilitilist, singelWeaponPattern);

			let updateObj = await actor.createEmbeddedDocuments("Item", actorItems);
			// game.symbaroum.log("updateObj "+JSON.stringify(updateObj));

			let healMe = {_id:actor.id};
			foundry.utils.setProperty(healMe, "system.health.toughness.value", foundry.utils.getProperty(actor, "system.health.toughness.max") );
			await Actor.updateDocuments([healMe]);

			let message = `Created ${actor.name}<br/>${additionalInfo}`;
			ChatMessage.create({
					speaker: ChatMessage.getSpeaker({alias: "Character Importer Macro"}),
					whisper: [game.user],
					content: message
			});
			actor.sheet.render(true);
	}		
    /**********************************************
	 * GM utility macros (Rudolf, 22.10.): create-once macro documents
	 * for the four GM utility helpers in the system macro folder, so they
	 * show up in the macro directory with an icon and can be dragged to
	 * the hotbar. The scripts enforce GM-only at runtime (all methods
	 * check game.user.isGM first).
	 */
	async setupGMUtilityMacros() {
		if (!game.user.isGM) return;
		const folderName = game.symbaroum.config.SYSTEM_MACRO_FOLDER;
		let folder = game.folders.filter((f) => f.type === "Macro").find((f) => f.name === folderName);
		if (!folder) {
			folder = await Folder.create({ name: folderName, type: "Macro", parent: null });
		}
		const utilities = [
			{
				name: game.i18n.localize("MACRO.RESET_STATUS_NAME"),
				command: "game.symbaroum.macros.resetStatus();",
				img: "icons/svg/aura.svg",
				migrateIcons: ["icons/svg/forbidden.svg"],
			},
			{
				name: game.i18n.localize("MACRO.RESET_TOUGHNESS_NAME"),
				command: "game.symbaroum.macros.resetToughness();",
				img: "icons/svg/heal.svg",
				migrateIcons: ["icons/svg/regeneration.svg"],
			},
			{
				name: game.i18n.localize("MACRO.RESET_CORRUPTION_NAME"),
				command: "game.symbaroum.macros.resetTemporaryCorruption();",
				// A25 F11 (Rudolf, 23.10.): ice-aura icon for the corruption
				// reset; migrateIcons refreshes the previous poison.svg default
				// if the icon was never manually changed
				img: "icons/svg/ice-aura.svg",
				migrateIcons: ["icons/svg/poison.svg"],
			},
			{
				// A35 (Rudolf's test round, Befund 10): abort regeneration
				// as a permanent GM utility macro; clockwork icon chosen by
				// Rudolf
				name: game.i18n.localize("MACRO.REGEN_ABORT_NAME"),
				command: "game.symbaroum.macros.abortRegeneration();",
				img: "icons/svg/clockwork.svg",
			},
			{
				// A38 Währungssystem: Einmal-Migration der alten money-Werte
				// und cost-Freitexte in das neue Crucible-Modell
				name: game.i18n.localize("MACRO.CURRENCY_MIGRATION_NAME"),
				command: "game.symbaroum.macros.currencyMigration();",
				img: "icons/svg/coins.svg",
			},
			{
				// A39 Belastungssystem: Einmal-Migration der Gewichtskategorien
				// (Vorschläge aus Waffen-Qualitäten bzw. Rüstungsbehinderung)
				name: game.i18n.localize("MACRO.WEIGHT_MIGRATION_NAME"),
				command: "game.symbaroum.macros.encumbranceMigration();",
				img: "systems/symbaroum/asset/image/biceps.svg",
			},
			{
				// Behältersystem v1: bestehende Ausrüstungs-Items mit Behälter-
				// Namen (Rucksack, Beutel, Truhe ...) in den Typ "container"
				// überführen - editierbare Kapazitäts-Vorschläge, wiederholbar,
				// Kompendien bleiben unberührt.
				name: game.i18n.localize("MACRO.CONTAINER_MIGRATION_NAME"),
				command: "game.symbaroum.macros.containerMigration();",
				img: "systems/symbaroum/asset/image/container.svg",
			},
		];
		for (const def of utilities) {
			// create only once, never overwrite an edited macro
			const existing = game.macros.find((m) => m.command === def.command);
			if (existing) {
				// icon migration: refresh a previous system default icon to
				// the current one - a manually chosen icon stays untouched
				if (def.migrateIcons?.includes(existing.img) && existing.img !== def.img) {
					await existing.update({ img: def.img });
				}
				continue;
			}
			await Macro.create({
				name: def.name,
				type: "script",
				img: def.img,
				command: def.command,
				flags: { "symbaroum.gmUtilityMacro": true },
				folder: folder?.id,
			});
		}
	}

	/**********************************************
	 * GM utility macro: common token selection - the currently
	 * controlled tokens, or - with none controlled - the scope chosen in
	 * a dialog (all tokens / all player tokens / all monster tokens of
	 * the current scene). Resolves null when the dialog is cancelled.
	 */
	async selectGMUtilityTokens(titleKey) {
		const controlled = canvas.tokens.controlled;
		if (controlled.length > 0) return controlled;
		return new Promise((resolve) => {
			symbDialog({
				width: 300,
				title: game.i18n.localize(titleKey),
				content: `<div class="symbaroum dialog">
					<div class="simplebox"><label class="lblfavour"><input type="radio" name="gmResetScope" value="all" checked> ${game.i18n.localize("MACRO.SCOPE_ALL")}</label></div>
					<div class="simplebox"><label class="lblfavour"><input type="radio" name="gmResetScope" value="players"> ${game.i18n.localize("MACRO.SCOPE_PLAYERS")}</label></div>
					<div class="simplebox"><label class="lblfavour"><input type="radio" name="gmResetScope" value="monsters"> ${game.i18n.localize("MACRO.SCOPE_MONSTERS")}</label></div>
				</div>`,
				buttons: {
					yes: {
						icon: "<i class='fas fa-check'></i>",
						label: game.i18n.localize("DIALOG.OK"),
						callback: (html) => {
							const scope = html[0].querySelector("input[name='gmResetScope']:checked")?.value ?? "all";
							resolve(
								canvas.tokens.placeables.filter((token) => {
									if (!token.actor) return false;
									if (scope === "players") return token.actor.type === "player";
									if (scope === "monsters") return token.actor.type === "monster";
									return true;
								})
							);
						},
					},
					no: {
						icon: "<i class='fas fa-times'></i>",
						label: game.i18n.localize("DIALOG.CANCEL"),
						callback: () => resolve(null),
					},
				},
				default: "yes",
			});
		});
	}

	/**********************************************
	 * GM utility macro: Reset Status - removes all status symbols
	 * (every active effect that renders with a status icon) from the
	 * selected tokens, or from all/player/monster tokens of the scene.
	 * GM only.
	 */
	async resetStatus() {
		if (!game.user.isGM) {
			ui.notifications.warn(game.i18n.localize("MACRO.GM_ONLY"));
			return;
		}
		const tokens = await this.selectGMUtilityTokens("MACRO.RESET_STATUS_NAME");
		if (!tokens) return;
		if (tokens.length === 0) {
			ui.notifications.info(game.i18n.localize("MACRO.RESET_NO_TOKENS"));
			return;
		}
		let removed = 0;
		for (const token of tokens) {
			const actor = token.actor;
			if (!actor) continue;
			const statusEffectIds = actor.effects.filter((e) => e.statuses?.size > 0).map((e) => e.id);
			if (statusEffectIds.length === 0) continue;
			await actor.deleteEmbeddedDocuments("ActiveEffect", statusEffectIds);
			removed += statusEffectIds.length;
		}
		ui.notifications.info(game.i18n.format("MACRO.RESET_STATUS_DONE", { count: removed }));
	}

	/**********************************************
	 * GM utility macro: Reset Toughness - sets the toughness of the
	 * selected tokens (or all/player/monster tokens of the scene) back
	 * to its maximum. GM only.
	 */
	async resetToughness() {
		if (!game.user.isGM) {
			ui.notifications.warn(game.i18n.localize("MACRO.GM_ONLY"));
			return;
		}
		const tokens = await this.selectGMUtilityTokens("MACRO.RESET_TOUGHNESS_NAME");
		if (!tokens) return;
		if (tokens.length === 0) {
			ui.notifications.info(game.i18n.localize("MACRO.RESET_NO_TOKENS"));
			return;
		}
		let reset = 0;
		for (const token of tokens) {
			const actor = token.actor;
			if (!actor?.system?.health?.toughness) continue;
			await actor.update({ "system.health.toughness.value": actor.system.health.toughness.max });
			reset++;
		}
		ui.notifications.info(game.i18n.format("MACRO.RESET_TOUGHNESS_DONE", { count: reset }));
	}

	/**********************************************
	 * GM utility macro: Reset Temporary Corruption - sets the temporary
	 * corruption of the selected tokens (or all/player/monster tokens of
	 * the scene) back to zero. GM only.
	 */
	async resetTemporaryCorruption() {
		if (!game.user.isGM) {
			ui.notifications.warn(game.i18n.localize("MACRO.GM_ONLY"));
			return;
		}
		const tokens = await this.selectGMUtilityTokens("MACRO.RESET_CORRUPTION_NAME");
		if (!tokens) return;
		if (tokens.length === 0) {
			ui.notifications.info(game.i18n.localize("MACRO.RESET_NO_TOKENS"));
			return;
		}
		let reset = 0;
		for (const token of tokens) {
			const actor = token.actor;
			if (!actor?.system?.health?.corruption) continue;
			await actor.update({ "system.health.corruption.temporary": 0 });
			reset++;
		}
		ui.notifications.info(game.i18n.format("MACRO.RESET_CORRUPTION_DONE", { count: reset }));
	}

	/**********************************************
	 * GM utility macro (A35, Rudolf's test round, Befund 10): Abort
	 * Regeneration - removes the regeneration active effect from the
	 * controlled tokens, or - with none controlled - from every scene
	 * token that carries it, and posts one chat card per token.
	 * GM only.
	 */
	async abortRegeneration() {
		if (!game.user.isGM) {
			ui.notifications.warn(game.i18n.localize("MACRO.GM_ONLY"));
			return;
		}
		const selected = canvas.tokens.controlled;
		const tokens = selected.length > 0 ? selected : canvas.tokens.placeables.filter((t) => t.actor?.hasCondition("regeneration"));
		if (tokens.length === 0) {
			ui.notifications.warn(game.i18n.localize("COMBAT.REGEN_ABORT_NONE"));
			return;
		}
		for (const token of tokens) {
			const effect = token.actor?.hasCondition("regeneration");
			if (!effect) continue;
			await token.actor.deleteEmbeddedDocuments("ActiveEffect", [effect._id]);
			await ChatMessage.create({
				user: game.user.id,
				speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: token.actor.id }),
				content: `<div class="symbaroum chat ability"><div class="foreground"><div class="finalTxt"><p>${game.i18n.format("COMBAT.REGEN_ABORTED", { name: token.name })}</p></div></div></div>`,
			});
		}
	}

	/**********************************************
	 * A36 GM utility macro: Bulk Assign Creature Category - opens a dialog
	 * with one row per world NPC (actor type "monster"): a category dropdown
	 * (pre-selected with the stored value, or a keyword suggestion when unset -
	 * the suggestion map below is deliberately small and meant to be edited)
	 * plus a free subtype input. One "Apply" click writes all changed actors in
	 * place: no export/import round trip, no Foundry ids touched. The world
	 * NPCs stay the master data. GM only. Run as a script macro or from the
	 * console: game.symbaroum.macros.bulkAssignCreatureCategory()
	 */
	async bulkAssignCreatureCategory() {
		if (!game.user.isGM) {
			ui.notifications.warn(game.i18n.localize("MACRO.GM_ONLY"));
			return;
		}
		const categorySelection = game.symbaroum.config.CREATURE_CATEGORY_SELECTION;
		/* Keyword suggestions for actors without a stored category: first
		   matching group wins, entries are lowercase substrings of the actor
		   name. Purely a dialog pre-selection - nothing is written silently. */
		const keywordSuggestions = [
			{ category: "undead", keywords: ["untot", "zombie", "skelett", "skeleton", "leiche", "ghoul", "vampir", "wraith", "nachtmahr"] },
			{ category: "abomination", keywords: ["abscheulich", "abomination", "aberration", "gorgone", "hydra", "kraken", "verschlinger"] },
			{ category: "beast", keywords: ["bestie", "wolf", "spinn", "bär", "bear", "schlange", "drache", "skorpion", "wurm", "räuber"] },
			{ category: "phenomenon", keywords: ["phänomen", "geist", "schatten", "dämon", "demon", "elementar", "gespenst", "phantom"] },
			{ category: "flora", keywords: ["flora", "pflanze", "baum", "wurzel", "dornbusch"] },
			{ category: "civilized", keywords: ["kulturschaffend", "mensch", "zwerg", "elf", "ork", "goblin", "troll", "halbling", "bandit", "krieger", "soldat", "hexer", "priester", "schamane"] },
		];
		const actors = game.actors.filter((a) => a.type === "monster").sort((a, b) => a.name.localeCompare(b.name));
		if (actors.length === 0) {
			ui.notifications.info(game.i18n.localize("MACRO.CATEGORY_NO_NPC"));
			return;
		}
		const suggestCategory = function (actor) {
			const name = actor.name.toLowerCase();
			for (const entry of keywordSuggestions) {
				if (entry.keywords.some((kw) => name.includes(kw))) return entry.category;
			}
			return "";
		};
		let rows = "";
		for (const actor of actors) {
			const current = actor.system.creatureCategory ?? "";
			const suggested = current !== "" ? current : suggestCategory(actor);
			const options = Object.values(categorySelection)
				.map((c) => `<option value="${c.id}" ${c.id === suggested ? "selected" : ""}>${game.i18n.localize(c.label)}</option>`)
				.join("");
			rows = rows.concat(`<tr>
                    <td style="padding:2px 6px 2px 0;">${foundry.utils.escapeHTML(actor.name)}</td>
                    <td style="padding:2px 6px;"><select style="width:100%;" data-actor="${actor.id}" class="category-select">${options}</select></td>
                    <td style="padding:2px 6px;"><input style="width:100%;" type="text" data-actor="${actor.id}" class="subtype-input" value="${foundry.utils.escapeHTML(actor.system.creatureSubtype ?? "")}" /></td>
                </tr>`);
		}
		/* A36Fix: no form-group class here - Foundry core styles .form-group as
		   a flex row (label left, field right) which squeezed the whole dialog
		   into one narrow column (Rudolf's test round, Befund 7). Also no
		   h2: the dialog window already carries the title. Plain column
		   layout instead, with the scroll container at full width. */
		let dialog_content = `
        <div style="display:flex; flex-direction:column;">
        <p style="margin:0 0 6px 0;">${game.i18n.localize("MACRO.CATEGORY_DIALOG_HEADER")}</p>
        <div style="width:100%; max-height:60vh; overflow-y:auto;">
        <table style="width:100%; border-collapse:collapse;">
            <tr>
                <th style="text-align:left;">${game.i18n.localize("BIO.NAME")}</th>
                <th>${game.i18n.localize("CREATURE_CATEGORY.CATEGORY")}</th>
                <th>${game.i18n.localize("CREATURE_CATEGORY.SUBTYPE")}</th>
            </tr>
            ${rows}
        </table>
        </div>
        </div>`;
		symbDialog({
			width: 600,
			title: game.i18n.localize("MACRO.CATEGORY_DIALOG_TITLE"),
			content: dialog_content,
			buttons: {
				Apply: {
					label: game.i18n.localize("MACRO.CATEGORY_APPLY"),
					callback: async (html) => {
						const root = html[0];
						let updated = 0;
						for (const actor of actors) {
							const categorySelect = root.querySelector(`select.category-select[data-actor="${actor.id}"]`);
							const subtypeInput = root.querySelector(`input.subtype-input[data-actor="${actor.id}"]`);
							if (!categorySelect || !subtypeInput) continue;
							const newCategory = categorySelect.value;
							const newSubtype = subtypeInput.value.trim();
							const oldCategory = actor.system.creatureCategory ?? "";
							const oldSubtype = actor.system.creatureSubtype ?? "";
							if (newCategory === oldCategory && newSubtype === oldSubtype) continue;
							await actor.update({ "system.creatureCategory": newCategory, "system.creatureSubtype": newSubtype });
							updated++;
						}
						ui.notifications.info(game.i18n.format("MACRO.CATEGORY_DONE", { count: updated }));
					},
				},
				Cancel: {
					label: game.i18n.localize("BUTTON.CANCEL"),
				},
			},
			default: "Apply",
		});
	}

	/**********************************************
	 * A38 Währungssystem: Currency Migration - opens an overview dialog with
	 * one row per *unmigrated* world actor (player/monster, recognized by
	 * system.currency === undefined) and one row per *unmigrated* world item
	 * (weapon/armor/equipment, recognized by system.price === undefined).
	 *
	 * Actor rows: old money values as text, the suggested base total in
	 * Orteg as an editable input (computed with the configured rates).
	 * Item rows: old cost free-text (with a warning mark when the parser
	 * was unsure) plus an editable value/denomination pair.
	 *
	 * One "Accept" button writes everything: actors get system.currency
	 * (integer, Orteg), items get system.price {value, denomination}. The
	 * old fields (system.money, system.cost) are kept untouched - they are
	 * only hidden; deletion happens in a later release (Rudolf's decision 1).
	 * Repeatable: already migrated documents no longer show up. GM only.
	 * Run as a script macro or from the console:
	 * game.symbaroum.macros.currencyMigration()
	 */
	async currencyMigration() {
		if (!game.user.isGM) {
			ui.notifications.warn(game.i18n.localize("MACRO.GM_ONLY"));
			return;
		}
		const rates = getCurrencyRates();
		const denominations = getDenominations();
		const warnMark = " &#9888;";

		/* --- Actors: old system.money -> suggested system.currency --- */
		const allActors = game.actors.filter((a) => a.type === "player" || a.type === "monster");
		const unmigratedActors = allActors.filter((a) => a.system.currency === undefined);
		/* v1-Schadensbegrenzung: falls ein Aktor durch v1-Tests bereits ein
		   currency-Feld mit 0 bekommen hat, obwohl alte money-Werte > 0
		   existieren (Vorlagen-Mischung kann persisted sein), wird er als
		   Verdachtszeile mit Warnungszeichen angezeigt - der GM entscheidet. */
		const suspectActors = allActors.filter((a) => {
			if (a.system.currency === undefined) return false;
			if (a.system.currency !== 0) return false;
			const t = Number(a.system.money?.thaler ?? 0);
			const s = Number(a.system.money?.shilling ?? 0);
			const o = Number(a.system.money?.orteg ?? 0);
			return t * rates.thaler + s * rates.shilling + o > 0;
		});
		const actors = [...unmigratedActors, ...suspectActors].sort((a, b) => a.name.localeCompare(b.name));

		/* --- Items: old system.cost free-text -> suggested system.price ---
		   Runde-1-Erweiterung (Rudolfs Fund): auch Inventar-Items (embedded)
		   erfassen - Welt-Items allein migrieren keine Aktor-Inventare.
		   Besitzer-Label für die Anzeige; Welt-Items haben owner null. */
		const itemEntries = [];
		for (const item of game.items) {
			if (["weapon", "armor", "equipment"].includes(item.type)) itemEntries.push({ item, owner: null });
		}
		for (const actor of game.actors) {
			for (const item of actor.items) {
				if (["weapon", "armor", "equipment"].includes(item.type)) itemEntries.push({ item, owner: actor.name });
			}
		}
		const allItems = itemEntries.map((e) => e.item);
		const unmigratedItems = itemEntries.filter((e) => e.item.system.price === undefined);
		/* v1-Schadensbegrenzung: migriertes Preisfeld 0, obwohl der alte
		   cost-Text einen positiven Betrag nennt -> Verdachtszeile. */
		const suspectItems = itemEntries.filter((e) => {
			if (e.item.system.price === undefined) return false;
			if (getItemPriceBase(e.item) !== 0) return false;
			const parsed = parseCostString(e.item.system.cost);
			return (parsed.value ?? 0) > 0;
		});
		const items = [...unmigratedItems, ...suspectItems].sort(
			(a, b) =>
				(a.owner ?? "").localeCompare(b.owner ?? "") ||
				a.item.name.localeCompare(b.item.name)
		);

		if (actors.length === 0 && items.length === 0) {
			ui.notifications.info(game.i18n.localize("MACRO.CURRENCY_MIGRATION_NONE"));
			return;
		}

		const moneyText = function (money) {
			const t = Number(money?.thaler ?? 0);
			const s = Number(money?.shilling ?? 0);
			const o = Number(money?.orteg ?? 0);
			return `${t} / ${s} / ${o}`;
		};

		let actorRows = "";
		for (const actor of actors) {
			const t = Number(actor.system.money?.thaler ?? 0);
			const s = Number(actor.system.money?.shilling ?? 0);
			const o = Number(actor.system.money?.orteg ?? 0);
			const rawTotal = t * rates.thaler + s * rates.shilling + o;
			const isInteger = Number.isInteger(rawTotal);
			const isSuspect = typeof actor.system.currency === "number";
			const suggested = isSuspect ? Math.max(0, Math.round(actor.system.currency)) : Math.round(rawTotal);
			actorRows = actorRows.concat(`<tr>
                    <td style="padding:2px 6px 2px 0;">${foundry.utils.escapeHTML(actor.name)}</td>
                    <td style="padding:2px 6px;">${moneyText(actor.system.money)}${isSuspect || !isInteger ? warnMark : ""}</td>
                    <td style="padding:2px 6px;"><input style="width:100%; text-align:right;" type="number" min="0" step="1" data-actor-id="${actor.id}" class="currency-total" value="${suggested}" /></td>
                </tr>`);
		}

		let itemRows = "";
		let itemIdx = 0;
		for (const entry of items) {
			const item = entry.item;
			const isSuspect = item.system.price !== undefined;
			const parsed = parseCostString(item.system.cost);
			const suggestedValue = isSuspect ? Math.max(0, Math.round(Number(item.system.price.value) || 0)) : (parsed.value ?? 0);
			const suggestedDenomination = isSuspect ? (item.system.price.denomination ?? "orteg") : (parsed.denomination ?? "orteg");
			const costText = String(item.system.cost ?? "").trim();
			const oldCell = costText === "" ? "&mdash;" : foundry.utils.escapeHTML(costText);
			const displayName = entry.owner ? `${item.name} (${entry.owner})` : item.name;
			const options = denominations
				.map((d) => `<option value="${d.id}"${d.id === suggestedDenomination ? " selected" : ""}>${d.abbreviation}</option>`)
				.join("");
			itemRows = itemRows.concat(`<tr>
                    <td style="padding:2px 6px 2px 0;">${foundry.utils.escapeHTML(displayName)}</td>
                    <td style="padding:2px 6px;">${oldCell}${isSuspect || !parsed.certain ? warnMark : ""}</td>
                    <td style="padding:2px 6px; white-space:nowrap;"><input style="width:5em; text-align:right;" type="number" min="0" step="1" data-entry-idx="${itemIdx}" class="price-value" value="${suggestedValue}" />&nbsp;<select data-entry-idx="${itemIdx}" class="price-denomination">${options}</select></td>
                </tr>`);
			itemIdx++;
		}

		const actorSection =
			actors.length === 0
				? `<p style="margin:6px 0 0 0; font-style:italic;">${game.i18n.localize("MACRO.CURRENCY_MIGRATION_ACTORS_NONE")}</p>`
				: `<table style="width:100%; border-collapse:collapse;">
            <tr>
                <th style="text-align:left;">${game.i18n.localize("BIO.NAME")}</th>
                <th>${game.i18n.localize("MACRO.CURRENCY_MIGRATION_OLD")} (T / S / O)</th>
                <th style="text-align:right;">${game.i18n.localize("MACRO.CURRENCY_MIGRATION_NEW")}</th>
            </tr>
            ${actorRows}
        </table>`;
		const itemSection =
			items.length === 0
				? `<p style="margin:6px 0 0 0; font-style:italic;">${game.i18n.localize("MACRO.CURRENCY_MIGRATION_ITEMS_NONE")}</p>`
				: `<table style="width:100%; border-collapse:collapse;">
            <tr>
                <th style="text-align:left;">${game.i18n.localize("BIO.NAME")}</th>
                <th>${game.i18n.localize("MACRO.CURRENCY_MIGRATION_OLD")}</th>
                <th style="text-align:right;">${game.i18n.localize("MACRO.CURRENCY_MIGRATION_NEW")}</th>
            </tr>
            ${itemRows}
        </table>`;

		const dialog_content = `
        <div style="display:flex; flex-direction:column;">
        <p style="margin:0 0 6px 0;">${game.i18n.localize("MACRO.CURRENCY_MIGRATION_HEADER")}</p>
        <p style="margin:0 0 4px 0; font-size:0.9em; opacity:0.8;">${game.i18n.format("MACRO.CURRENCY_MIGRATION_ALREADY", {
			actors: allActors.length - unmigratedActors.length,
			actorsTotal: allActors.length,
			items: allItems.length - unmigratedItems.length,
			itemsTotal: allItems.length,
		})}</p>
        <p style="margin:8px 0 2px 0; font-weight:bold;">${game.i18n.localize("MACRO.CURRENCY_MIGRATION_ACTORS")}</p>
        <div style="width:100%; max-height:40vh; overflow-y:auto;">${actorSection}</div>
        <p style="margin:8px 0 2px 0; font-weight:bold;">${game.i18n.localize("MACRO.CURRENCY_MIGRATION_ITEMS")}</p>
        <div style="width:100%; max-height:40vh; overflow-y:auto;">${itemSection}</div>
        </div>`;

		symbDialog({
			width: 700,
			title: game.i18n.localize("MACRO.CURRENCY_MIGRATION_DIALOG_TITLE"),
			content: dialog_content,
			buttons: {
				Accept: {
					label: game.i18n.localize("MACRO.CURRENCY_MIGRATION_ACCEPT"),
					callback: async (html) => {
						const root = html[0];
						let actorCount = 0;
						for (const actor of actors) {
							const input = root.querySelector(`input.currency-total[data-actor-id="${actor.id}"]`);
							if (!input) continue;
							const total = Math.max(0, Math.round(Number(input.value) || 0));
							await actor.update({ "system.currency": total });
							actorCount++;
						}
						let itemCount = 0;
						for (let i = 0; i < items.length; i++) {
							const valueInput = root.querySelector(`input.price-value[data-entry-idx="${i}"]`);
							const denomSelect = root.querySelector(`select.price-denomination[data-entry-idx="${i}"]`);
							if (!valueInput || !denomSelect) continue;
							const value = Math.max(0, Math.round(Number(valueInput.value) || 0));
							const denomination = denomSelect.value;
							await items[i].item.update({ "system.price": { value, denomination } });
							itemCount++;
						}
						ui.notifications.info(game.i18n.format("MACRO.CURRENCY_MIGRATION_DONE", { actors: actorCount, items: itemCount }));
					},
				},
				Cancel: {
					label: game.i18n.localize("BUTTON.CANCEL"),
				},
			},
			default: "Accept",
		});
	}

	/**********************************************
	 * A39 Belastungssystem: Weight Migration - opens an overview dialog with
	 * one row per *unmigrated* item (weapon/armor/equipment/artifact,
	 * recognized by system.weight === undefined) and a category dropdown with
	 * an editable suggestion. Runde-1-Erweiterung: erfasst seit Testrunde 1
	 * sowohl Welt-Items als auch Inventar-Items aller Welt-Akteure (embedded,
	 * mit Besitzer-Label) - die Last eines Akteurs wird aus seinen eigenen
	 * Items berechnet:
	 *   weapon:  Massive -> Schwer, Kurz -> Leicht, sonst Normal
	 *   armor:   nach Rüstungsbehinderung (Laufzeitwert): 0 -> Keine Angabe,
	 *            2 -> Schwer, 3 und 4 -> Sehr schwer (4 wird bewusst auf
	 *            3 GE abgerundet - grobe Kategorisierung, Rudolfs Entscheidung;
	 *            Abrundung mit Warnmarke)
	 *   equipment/artifact: Normal als neutraler Vorschlag
	 * One "Accept" click writes all categories; old fields stay untouched.
	 * Repeatable: already migrated items no longer show up. GM only.
	 * Run as a script macro or from the console:
	 * game.symbaroum.macros.encumbranceMigration()
	 */
	async encumbranceMigration() {
		if (!game.user.isGM) {
			ui.notifications.warn(game.i18n.localize("MACRO.GM_ONLY"));
			return;
		}
		const warnMark = " &#9888;";
		const gearTypes = ["weapon", "armor", "equipment", "artifact"];
		/* Runde-1-Erweiterung (Rudolfs Fund): auch Inventar-Items (embedded)
		   erfassen - die Last eines Akteurs wird aus SEINEN Items berechnet,
		   Welt-Items allein reichen nicht. Besitzer-Label für die Anzeige;
		   Welt-Items haben owner null. */
		const entries = [];
		for (const item of game.items) {
			if (gearTypes.includes(item.type)) entries.push({ item, owner: null });
		}
		for (const actor of game.actors) {
			for (const item of actor.items) {
				if (gearTypes.includes(item.type)) entries.push({ item, owner: actor.name });
			}
		}
		const total = entries.length;
		const items = entries
			.filter((e) => e.item.system.weight === undefined)
			.sort(
				(a, b) =>
					(a.owner ?? "").localeCompare(b.owner ?? "") ||
					a.item.name.localeCompare(b.item.name)
			);
		if (items.length === 0) {
			ui.notifications.info(game.i18n.localize("MACRO.WEIGHT_MIGRATION_NONE"));
			return;
		}
		const weightConfig = game.symbaroum.config.weight;
		const weightOrder = game.symbaroum.config.weightOrder;
		const suggestWeightCategory = function (item) {
			if (item.type === "weapon") {
				if (item.system.qualities?.massive) return "heavy";
				if (item.system.qualities?.short) return "light";
				return "normal";
			}
			if (item.type === "armor") {
				const impeding = item.impeding ?? 0;
				if (impeding <= 0) return "none";
				if (impeding === 2) return "heavy";
				return "veryheavy";
			}
			return "normal";
		};
		let worldRows = "";
		let ownedRows = "";
		let idx = 0;
		for (const entry of items) {
			const item = entry.item;
			const suggested = suggestWeightCategory(item);
			/* Warnmarke, wenn die Kategorie bewusst abgerundet wird:
			   Rüstungsbehinderung 4 (1d8-Panzer) -> Sehr schwer = 3 GE */
			const isAbridged = item.type === "armor" && (item.impeding ?? 0) >= 4;
			const displayName = entry.owner ? `${item.name} (${entry.owner})` : item.name;
			const options = weightOrder
				.map((id) => `<option value="${id}"${id === suggested ? " selected" : ""}>${game.i18n.localize(weightConfig[id].label)}</option>`)
				.join("");
			const row = `<tr>
                    <td style="padding:2px 6px 2px 0;">${foundry.utils.escapeHTML(displayName)}</td>
                    <td style="padding:2px 6px; white-space:nowrap;">${foundry.utils.escapeHTML(game.i18n.localize("ITEM.Type" + item.type.capitalize()))}${isAbridged ? warnMark : ""}</td>
                    <td style="padding:2px 6px;"><select style="width:100%;" data-entry-idx="${idx}" class="weight-select">${options}</select></td>
                </tr>`;
			if (entry.owner) ownedRows = ownedRows.concat(row);
			else worldRows = worldRows.concat(row);
			idx++;
		}
		const entryTable = (rows) => `<table style="width:100%; border-collapse:collapse;">
            <tr>
                <th style="text-align:left;">${game.i18n.localize("BIO.NAME")}</th>
                <th style="text-align:left;">${game.i18n.localize("MACRO.WEIGHT_MIGRATION_TYPE")}</th>
                <th style="text-align:right;">${game.i18n.localize("WEIGHT.LABEL")}</th>
            </tr>
            ${rows}
        </table>`;
		const dialog_content = `
        <div style="display:flex; flex-direction:column;">
        <p style="margin:0 0 6px 0;">${game.i18n.localize("MACRO.WEIGHT_MIGRATION_HEADER")}</p>
        <p style="margin:0 0 4px 0; font-size:0.9em; opacity:0.8;">${game.i18n.format("MACRO.WEIGHT_MIGRATION_ALREADY", {
			items: total - items.length,
			total: total,
		})}</p>
        <div style="width:100%; max-height:60vh; overflow-y:auto;">
        ${worldRows ? `<p style="margin:8px 0 2px 0; font-weight:bold;">${game.i18n.localize("MACRO.WEIGHT_MIGRATION_WORLD")}</p>${entryTable(worldRows)}` : ""}
        ${ownedRows ? `<p style="margin:8px 0 2px 0; font-weight:bold;">${game.i18n.localize("MACRO.WEIGHT_MIGRATION_OWNED")}</p>${entryTable(ownedRows)}` : ""}
        </div>
        </div>`;
		symbDialog({
			width: 600,
			title: game.i18n.localize("MACRO.WEIGHT_MIGRATION_DIALOG_TITLE"),
			content: dialog_content,
			buttons: {
				Accept: {
					label: game.i18n.localize("MACRO.WEIGHT_MIGRATION_ACCEPT"),
					callback: async (html) => {
						const root = html[0];
						let count = 0;
						for (let i = 0; i < items.length; i++) {
							const select = root.querySelector(`select.weight-select[data-entry-idx="${i}"]`);
							if (!select) continue;
							await items[i].item.update({ "system.weight": select.value });
							count++;
						}
						ui.notifications.info(game.i18n.format("MACRO.WEIGHT_MIGRATION_DONE", { count }));
					},
				},
				Cancel: {
					label: game.i18n.localize("BUTTON.CANCEL"),
				},
			},
			default: "Accept",
		});
	}

	/**
	 * Behältersystem (Projekt "Behälter" v1): GM-Makro zur Konvertierung
	 * bestehender Ausrüstungs-Items in den neuen Typ "container".
	 *  - Findet Ausrüstung (Welt- und eingebettete Aktor-Items) über eine
	 *    Namens-Heuristik (Rucksack, Beutel, Tasche, Sack, Kiste, Truhe,
	 *    Köcher, Satteltaschen, Pack, Bag, Pouch, Chest, Case ...).
	 *  - Vorschläge: Gewichtskategorie (Aktueller Stand, umstellbar) und
	 *    Fassungsvermögen in GE (Default 0 = unbegrenzt - bewusst KEINE
	 *    RAW-Werte erfunden, Rudolfs Entscheidung; der GM editiert).
	 *  - Konvertierung: Neues Item vom Typ "container" mit derselben ID
	 *    (Name, Bild, Beschreibung, Gewicht, Preis wandern mit; die A38-
	 *    preise werden übernommen, alle Felder bekommen den Template-
	 *    Default des NEUEN Typs - A38-sicher, keine Altbestände berührt).
	 *  - Wiederholbar: Bereits konvertierte Items sind Typ "container" und
	 *    tauchen nicht mehr in der Liste auf; Kompendien bleiben außen vor.
	 */
	async containerMigration() {
		if (!game.user.isGM) {
			ui.notifications.warn(game.i18n.localize("MACRO.GM_ONLY"));
			return;
		}
		const namePattern = /(rucksack|handsack|beutel|tasche|sack|kiste|truhe|köcher|quiver|satteltasche|pack|bag|pouch|chest|backpack)/i;
		const weightConfig = game.symbaroum.config.weight;
		const weightOrder = game.symbaroum.config.weightOrder;

		const entries = [];
		for (const item of game.items) {
			if (item.type === "equipment" && namePattern.test(item.name ?? "")) entries.push({ item, owner: null });
		}
		for (const actor of game.actors) {
			for (const item of actor.items) {
				if (item.type === "equipment" && namePattern.test(item.name ?? "")) entries.push({ item, owner: actor.name });
			}
		}
		entries.sort((a, b) => (a.owner ?? "").localeCompare(b.owner ?? "") || a.item.name.localeCompare(b.item.name));

		if (entries.length === 0) {
			ui.notifications.info(game.i18n.localize("MACRO.CONTAINER_MIGRATION_NONE"));
			return;
		}

		let rows = "";
		for (let i = 0; i < entries.length; i++) {
			const { item, owner } = entries[i];
			const displayName = owner ? `${item.name} (${owner})` : item.name;
			const currentWeight = typeof item.system.weight === "string" ? item.system.weight : "light";
			const options = weightOrder
				.map((id) => `<option value="${id}"${id === currentWeight ? " selected" : ""}>${game.i18n.localize(weightConfig[id].label)}</option>`)
				.join("");
			rows = rows.concat(`<tr>
                    <td style="padding:2px 6px 2px 0;">${foundry.utils.escapeHTML(displayName)}</td>
                    <td style="padding:2px 6px; white-space:nowrap;"><select style="width:100%;" data-entry-idx="${i}" class="weight-select">${options}</select></td>
                    <td style="padding:2px 6px;"><input style="width:5em; text-align:right;" type="number" min="0" step="0.5" data-entry-idx="${i}" class="capacity-input" value="0" /></td>
                </tr>`);
		}
		const dialog_content = `
        <div style="display:flex; flex-direction:column;">
        <p style="margin:0 0 6px 0;">${game.i18n.localize("MACRO.CONTAINER_MIGRATION_HEADER")}</p>
        <div style="width:100%; max-height:60vh; overflow-y:auto;">
        <table style="width:100%; border-collapse:collapse;">
            <tr>
                <th style="text-align:left;">${game.i18n.localize("BIO.NAME")}</th>
                <th style="text-align:left;">${game.i18n.localize("WEIGHT.LABEL")}</th>
                <th style="text-align:right;">${game.i18n.localize("MACRO.CONTAINER_MIGRATION_CAPACITY")}</th>
            </tr>
            ${rows}
        </table>
        </div>
        <p style="margin:6px 0 0 0; font-size:0.9em; opacity:0.8;">${game.i18n.localize("MACRO.CONTAINER_MIGRATION_HINT")}</p>
        </div>`;
		symbDialog({
			width: 600,
			title: game.i18n.localize("MACRO.CONTAINER_MIGRATION_DIALOG_TITLE"),
			content: dialog_content,
			buttons: {
				Accept: {
					label: game.i18n.localize("MACRO.CONTAINER_MIGRATION_ACCEPT"),
					callback: async (html) => {
						const root = html[0];
						let count = 0;
						for (let i = 0; i < entries.length; i++) {
							const select = root.querySelector(`select.weight-select[data-entry-idx="${i}"]`);
							const capacityInput = root.querySelector(`input.capacity-input[data-entry-idx="${i}"]`);
							if (!select) continue;
							const { item, owner } = entries[i];
							const data = item.toObject();
							data.type = "container";
							data.system.weight = select.value;
							data.system.capacity = Math.max(0, Number(capacityInput?.value) || 0);
							/* Zustands-Defaults des neuen Typs; Alt-Felder der
							   Ausrüstung (number/state) bleiben als tote Daten
							   harmlos im system-Objekt stehen. */
							data.system.carried = true;
							data.system.countLoad = true;
							data.system.currency = 0;
							data.system.weightlessContents = false;
							if (data.system.price === undefined) data.system.price = { value: 0, denomination: "orteg" };
							if (item.parent) {
								/* Eingebettet: alte ID beibehalten, damit keine
								   Referenzen brechen; erst löschen, dann mit der
								   alten _id neu anlegen (Typ ist in Foundry
								   unveränderbar). */
								await item.parent.deleteEmbeddedDocuments("Item", [item.id]);
								await item.parent.createEmbeddedDocuments("Item", [data]);
							} else {
								await item.delete();
								await Item.create(data);
							}
							count++;
						}
						ui.notifications.info(game.i18n.format("MACRO.CONTAINER_MIGRATION_DONE", { count }));
					},
				},
				Cancel: {
					label: game.i18n.localize("BUTTON.CANCEL"),
				},
			},
			default: "Accept",
		});
	}
}
