import {
  baseRoll,
  createRollData,
  damageRollWithDiceParams,
  simpleDamageRoll,
  getAttributeValue,
  getOwnerPlayer,
  createModifyTokenChatButton,
  createModifyTokenAutoApply,
  beginGmCardCollection,
  flushGmCardCollection,
  createResistRollChatButton,
  getRollResultLevelKey,
} from "./roll.js";
import { createLineDisplay } from "./dialog.js";
import { symbDialog } from "./symbDialog.js";
import { isModernDialogActive, modernDialogClasses } from "./modernSheetConfig.js";
// Ressourcen v1: Verbraucher-Registry + Abbuch-/Verfügbarkeits-Helfer des
// kategoriebasierten Ressourcenverbrauchs (Kategorie Kraeuterarznei für den
// Medicus; Setting „Ressourcenverbrauch" GM-seitig, Default AUS)
import { RESOURCE_CONSUMERS, isResourceConsumptionEnabled, getHerbalCureAvailability, consumeHerbalCure, getBandageAvailability, consumeBandage, getItemCount } from "./resources.js";
// Kräfte-Paket 2 (Rudolfs Freigabe 23.11.2026 „Baue Paket 2", Block A
// Sturmpfeil, Entscheidung 8: Material als Munition, ABBUCHUNG je
// abgefeuertem Pfeil wenn das Setting „Munitionsverbrauch" aktiv ist):
// Bestands- und Stapel-Helfer der Munitions-Kategorie „pfeilbolzen"
// (bewusst GEMEINSAM für Pfeile und Bolzen, config.js). Kein Import-
// Zyklus - ammo.js importiert nichts aus item.js.
import { isAmmoConsumptionEnabled, findAmmoStacks, getAmmoTotal } from "./ammo.js";
// Elixier-Automatisierung v1: Benommen-Malus-Vorbelegung im Faehigkeits-
// Wuerfeldialog (Nebelball) - Helfer aus elixirs.js
// Elixiere v1.7 (Waffengift-Dialog-Vereinheitlichung): + consumeElixirDose
// fuer die vereinheitlichte Waffengift-Zeile im Modifier-Dialog
import { getDazedPenalty, consumeElixirDose } from "./elixirs.js";
// Segen & Lasten S1 (Rudolfs Freigabe 04.11.): Wurf-Setup der 15 Typ-W-
// Segen/Lasten (Kanonik BOON_ROLLS, Delegation getBoonsConfig/
// getBurdensConfig, Ertrags-Result-Funktionen) - der kreisförmige Import
// (boon.js importiert modifierDialog/standardPowerResult zurück) folgt
// dem etablierten Muster dialog.js <-> item.js
import { getBoonRollConfig } from "./boon.js";
// Segen & Lasten S2 (Rudolfs „Leg los“, 06.11.2026): Kontext-Zeilen im
// Kräfte-/Fähigkeits-Würfeldialog (Typ B + B/G „Zweite Chance“ mit
// Radio-Exklusivität) — Kanonik und Helfer in boon.js
import { getBoonLinesForActor, collectCheckedBoonLines, activateBoonLineExclusive, formatModifierChain, hasBoonFireProtection, getEpilepsyPenalty, hasPoisonResilient, hasPoisonManual, getWeakeningHymnFavour, getMissgunstFavour, getShapeshiftFavour } from "./boon.js";
// S4-Paket „Tag/Reise/Ressourcen" (Rudolfs Freigabe 07.11.2026):
// Hunger/Durst-Missgunst als Radio-VORBELEGUNG + Hunger-Stärke-Malus
// als Modifikator-Vorbelegung im Fähigkeits-Würfeldialog (Helfer aus
// travel.js). Zykel-Sicherheit wie dialog.js <-> item.js: nur
// Funktionsdeklarationen, Aufruf erst zur Laufzeit.
import { getTravelTestFavour, getHungerPenalty } from "./travel.js";
import { itemHasTraditionKnowledge } from "./tradition.js";
import { hymnActiveForCaster, hymnRegionTokens, hymnRegionById, removeHymnZoneRegions, removeAuraZoneRegions, removeGlyphZoneRegions, removeSymbolZoneRegions, placeAuraZone, placeGlyphZone, placeSymbolZone, senseBlocked, placeThornCloakZone, thornCloakRegionFor, removeThornCloakZones } from "./aoe.js";

export class SymbaroumItem extends Item {
  /* -------------------------------------------- */
  /*  Importing and Exporting                     */
  /* -------------------------------------------- */

  /**
   * Present a Dialog form to create a new Document of this type.
   * Choose a name and a type from a select menu of types.
   * @param {object} data              Initial data with which to populate the creation form
   * @param {object} [context={}]      Additional context options or dialog positioning options
   * @returns {Promise<Document|null>} A Promise which resolves to the created Document, or null if the dialog was
   *                                   closed.
   * @memberof ClientDocumentMixin
   */
  static async createDialog(data = {},createOptions={}, {folders, types, template, ...dialogOptions}={}) {
    // Collect data
    console.log("createDialog", types);
    types = game.symbaroum.config.itemValid;
    return super.createDialog(data, createOptions , { folders, types, template, dialogOptions });
  }

  static async create(data, options) {
    if (!data.img) {
      if (data.type in game.symbaroum.config.itemImages) data.img = game.i18n.format(game.symbaroum.config.imageRef, { filename: game.symbaroum.config.itemImages[data.type] });
      else data.img = game.i18n.format(game.symbaroum.config.imageRef, { filename: "unknown-item.png" });
    }
    return super.create(data, options);
  }

  prepareBaseData() {
    // Foundry VTT V14: keep the base data preparation chain intact
    super.prepareBaseData();
    // We do nothing for now
  }

  prepareDerivedData()
	{
    this._initializeData(this);
    this._computeCombatData(this.system);
  }

  _initializeData(item) {
    let system = this.system;
    let transl = {
      A: "ACTION.ACTIVE",
      M: "ACTION.MOVEMENT",
      T: "ACTION.FULL_TURN",
      F: "ACTION.FREE",
      P: "ACTION.PASSIVE",
      R: "ACTION.REACTION",
      S: "ACTION.SPECIAL",
    };

    system[`is${this.type.capitalize()}`] = true;

    system.isPower = system.isTrait || system.isAbility || system.isMysticalPower || system.isRitual || system.isBurden || system.isBoon;
    system.hasLevels = system.isTrait || system.isAbility || system.isMysticalPower;
    system.isArtifact = this.type === "artifact" || system.isArtifact;
    system.isGear = system.isWeapon || system.isArmor || system.isEquipment || system.isArtifact;
    system.isMarker = system.marker === "active";

    if (system.isTrait && system.reference && system.reference !== "") {
      let label = game.symbaroum.config.traitsList[system.reference];
      if (label) system.itemLabel = game.i18n.localize(label);
    } else if (system.isAbility) {
      let label = game.symbaroum.config.abilitiesList[system.reference];
      if (label) system.itemLabel = game.i18n.localize(label);
    } else if (system.isMysticalPower) {
      let label = game.symbaroum.config.powersList[system.reference];
      if (label) system.itemLabel = game.i18n.localize(label);
    }

    if (system.isGear) {
      system.isActive = system.state === "active";
      system.isEquipped = system.state === "equipped";
    }

    if (this.type === "weapon") {
      system.pcDamage = "";
      system.npcDamage = 0;
    } else if (this.type === "armor") {
      system.isStackableArmor = system.baseProtection === "0";
      system.isSkin = system.baseProtection === "1d0";
      system.isLightArmor = system.baseProtection === "1d4";
      system.isMediumArmor = system.baseProtection === "1d6";
      system.isHeavyArmor = system.baseProtection == "1d8";
      system.isSuperArmor = system.baseProtection == "1d10" || system.baseProtection == "1d12";
      if (system.isStackableArmor) {
        system.reference = "stackable";
      } else if (system.isSkin) {
        system.reference = "skin";
      } else if (system.isLightArmor) {
        system.reference = "lightarmor";
      } else if (system.isMediumArmor) {
        system.reference = "mediumarmor";
      } else if (system.isHeavyArmor) {
        system.reference = "heavyarmor";
      } else {
        system.reference = "superarmor";
      }
      system.pcProtection = "";
      system.npcProtection = 0;
    } else if (this.type == "artifact") {
      if (system.power1.action !== "-") {
        system.power1.actionlabel = transl[system.power1.action];
      }
      if (system.power2.action !== "-") {
        system.power2.actionlabel = transl[system.power2.action];
      }
      if (system.power3.action !== "-") {
        system.power3.actionlabel = transl[system.power3.action];
      }
    }
    if (system.isPower) this._computeExperienceCost(system);
  }

  _computeExperienceCost(system) {
    let expCost = 0;

    if (system.isRitual) {
      system.actions = "Ritual";
    } else if (system.isBurden) {
      system.actions = "Burden";
      expCost = game.symbaroum.config.expCosts.burden["cost"] * system.level;
    } else if (system.isBoon) {
      system.actions = "Boon";
      expCost = game.symbaroum.config.expCosts.boon["cost"] * system.level;
    } else if (system.isPower) {
      let novice = "-";
      let adept = "-";
      let master = "-";
      if (system.novice.isActive || system.marker) {
        novice = system.novice.action ?? "?";
        expCost += game.symbaroum.config.expCosts.power["novice"];
      }
      if (system.adept.isActive && !system.marker) {
        adept = system.adept.action ?? "?";
        expCost += game.symbaroum.config.expCosts.power["adept"];
      }
      if (system.master.isActive && !system.marker) {
        master = system.master.action ?? "?";
        expCost += game.symbaroum.config.expCosts.power["master"];
      }
      if (game.symbaroum.config.expCosts.power["nocost"].includes(system.reference)) {
        expCost = 0;
      }

      if (system.marker) {
        system.actions = ``;
      } else {
        system.actions = `${novice}/${adept}/${master}`;
      }
    }
    system.bonus.experience.cost = expCost;
  }

  _computeCombatData(system) {
    if (this.type === "weapon") {
      system.isMelee = game.symbaroum.config.meleeWeapons.includes(system.reference);
      system.isDistance = game.symbaroum.config.rangeWeapons.includes(system.reference);
      let baseDamage = system.baseDamage;
      // game.symbaroum.log("baseDamage["+baseDamage+"]");
      if (baseDamage === null || baseDamage === undefined || baseDamage === "") {
        baseDamage = game.symbaroum.config.baseDamage;
      }
      let diceSides = baseDamage.match(/[0-9]d([1-9]+)/)[1];
      // game.symbaroum.log("diceSides["+diceSides+"]");
      if (system.qualities?.massive) {
        baseDamage = "2d" + Math.ceil(diceSides) + "kh";
      }
      if (system.bonusDamage != "") {
        if (system.bonusDamage.charAt(0) !== "+") {
          system.bonusDamage = "+" + system.bonusDamage;
        }
        baseDamage += system.bonusDamage;
      }
      system.pcDamage += baseDamage;
      if (system.qualities?.deepImpact) {
        system.pcDamage += "+1";
      }
      try {
        let weaponRoll = new Roll(baseDamage).evaluateSync({ maximize: true });
        system.npcDamage = Math.ceil(weaponRoll.total / 2);
      } catch (err) {
        system.npcDamage = 0;
        ui.notifications?.error("Could not evaulate weapon - check bonus damage fields - " + err);
      }
      if (system.qualities?.deepImpact) {
        system.npcDamage += 1;
      }
    } else if (this.type === "armor") {
      let protection = system.baseProtection;
      let armorRoll = null;
      if (protection === null || protection === undefined || protection === "") {
        protection = game.symbaroum.config.baseProtection;
      }
      if (protection === "0") {
        protection = "";
      }

      if (system.bonusProtection && system.bonusProtection != "") {
        let plus = "+";
        if (system.bonusProtection.charAt(0) === "+") {
          plus = "";
        }
        protection += plus + system.bonusProtection;
      }
      system.pcProtection = protection;
      if (system.qualities?.reinforced) {
        system.pcProtection += "+1";
      }

      system.npcProtection = 0;
      if (protection !== "" && Roll.validate(protection)) {
        system.npcProtection = Math.ceil(new Roll(protection).evaluateSync({ maximize: true }).total / 2);
      }
      if (system.qualities?.reinforced) {
        system.npcProtection += 1;
      }
    }
  }

  _getArtifactInfo(field) {
    let system = this.system;
    if (this.type == "artifact") {
      return `${system.power1[field]}/${system.power2[field]}/${system.power3[field]}`;
    } else if (system.isArtifact) {
      if (system.power === null || system.power == {}) {
        return "";
      }
      let keys = Object.keys(system.power);
      let actionStr = "";
      let notfirst = false;

      for (let i = 0; i < keys.length; i++) {
        if (notfirst) {
          actionStr += "/";
        } else {
          notfirst = true;
        }
        actionStr += system.power[keys[i]][field];
      }
      return actionStr;
    } else {
      return "";
    }
  }

  getArtifactActions() {
    return this._getArtifactInfo("action");
  }

  getArtifactCorruptions() {
    return this._getArtifactInfo("corruption");
  }

  /* affect reference on this item */
  async affectReference() {

    // TOTO: Unable to test as the calling function _prepareRegisterAbility(event) in item.js is not called???
    let list;
    if (this.type === "ability") {
      list = game.symbaroum.config.abilitiesList;
    } else if (this.type === "mysticalPower") {
      list = game.symbaroum.config.powersList;
    } else if (this.type === "trait") {
      list = game.symbaroum.config.traitsList;
    } else {
      return;
    }
    let referenceOptions = "";
    for (let [key, label] of Object.entries(list)) {
      referenceOptions += `<option value=${key}>${game.i18n.localize(label)} </option>`;
    }

    let htmlTemplate = `
        <h1> ${game.i18n.localize("ABILITYREF.DIALOG_TITLE")} </h1>
        <p> ${game.i18n.localize("ABILITYREF.DIALOG")}</p>
        <div style="display:flex">
        <div  style="flex:1"><select id="reference">${referenceOptions}</select></div>
        </div>`;
    symbDialog({
      title: game.i18n.localize("ABILITYREF.DIALOG_TITLE"),
      content: htmlTemplate,
      // P26 (Dialog-Audit): Modern-Chrome bei modernen Blättern
      classes: isModernDialogActive() ? modernDialogClasses('modern-abilityref-dialog') : [],
      buttons: {
        validate: {
          label: "Validate",
          callback: (html) => {
            let selectedRef = html[0].querySelector("#reference").value;
            this.update({ "system.reference": selectedRef });
            return selectedRef;
          },
        },
        close: {
          label: "Close",
        },
      },
    });
  }

  getLevel() {
    if (!this.system.hasLevels) {
      return { level: 0, lvlName: null };
    }
    let powerLvl = 0;
    let lvlName = game.i18n.localize("ABILITY.NOT_LEARNED");
    if (this.system.master.isActive) {
      powerLvl = 3;
      lvlName = game.i18n.localize("ABILITY.MASTER");
    } else if (this.system.adept.isActive) {
      powerLvl = 2;
      lvlName = game.i18n.localize("ABILITY.ADEPT");
    } else if (this.system.novice.isActive) {
      powerLvl = 1;
      lvlName = game.i18n.localize("ABILITY.NOVICE");
    }
    return { level: powerLvl, lvlName: lvlName };
  }

  getItemModifiers(combatMods, armors, weapons, abilities) {
    if (!this.isOwned || this.system.reference === undefined || this.system.reference === null) {
      return;
    }
    let ref = this.system.reference.capitalize();
    if (typeof this["getItemModifier" + ref] == "function") {
      this["getItemModifier" + ref](combatMods, armors, weapons, abilities);
    }
  }

  getAbilitiesConfig() {
    let base = {
      id: this.id,
      label: this.name,
      reference: this.system.reference,
      type: "ability",
      corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
      impeding: game.symbaroum.config.IMPEDING_NOT,
      isScripted: false,
      powerLvl: this.getLevel(),
      attributes: [],
      casting: game.symbaroum.config.CASTING,
      maintain: game.symbaroum.config.MAINTAIN_NOT,
      castingAttributeName: "cunning",
      targetText: game.i18n.localize("ABILITY.CHAT_TARGET_VICTIM"),
      package: [],
      autoParams: "",
    };
    if (!this.isOwned || this.system.reference === undefined || this.system.reference === null) {
      return base;
    }
    let ref = this.system.reference.capitalize();
    if (typeof this["abilitySetup" + ref] == "function") {
      base.isScripted = true;
      return this["abilitySetup" + ref](base);
    } else return base;
  }

  getMysticPowersConfig() {
    let base = {
      id: this.id,
      label: this.name,
      reference: this.system.reference,
      type: "mysticalPower",
      corruption: game.symbaroum.config.TEMPCORRUPTION_NORMAL,
      impeding: game.symbaroum.config.IMPEDING_MAGIC,
      isScripted: false,
      traditions: [],
      powerLvl: this.getLevel(),
      healingBonus: "",
      attributes: [],
      castingAttributeName: "resolute",
      targetText: game.i18n.localize("ABILITY.CHAT_TARGET_VICTIM"),
      package: [],
      autoParams: "",
    };
    if (!this.isOwned || this.system.reference === undefined || this.system.reference === null) {
      return base;
    }
    let ref = this.system.reference.capitalize();
    if (typeof this["mysticPowerSetup" + ref] == "function") {
      base.isScripted = true;
      return this["mysticPowerSetup" + ref](base);
    } else return base;
  }

  getTraitsConfig() {
    let base = {
      id: this.id,
      label: this.name,
      reference: this.system.reference,
      type: "trait",
      corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
      impeding: game.symbaroum.config.IMPEDING_NOT,
      casting: game.symbaroum.config.CASTING,
      maintain: game.symbaroum.config.MAINTAIN_NOT,
      isScripted: false,
      powerLvl: this.getLevel(),
      attributes: [],
      castingAttributeName: "quick",
      targetText: game.i18n.localize("ABILITY.CHAT_TARGET_VICTIM"),
      package: [],
      autoParams: "",
    };
    if (!this.isOwned || this.system.reference === undefined || this.system.reference === null) {
      return base;
    }
    let ref = this.system.reference.capitalize();
    if (typeof this["traitSetup" + ref] == "function") {
      base.isScripted = true;
      return this["traitSetup" + ref](base);
    } else return base;
  }

  // Segen & Lasten S1 (04.11.): duenner Delegations-Wrapper auf die
  // Kanonik in boon.js - ohne Kanonik-Treffer bleibt isScripted false
  // und der Button bleibt stumm (Verhalten wie bisher)
  getBoonsConfig() {
    return getBoonRollConfig(this);
  }

  getBurdensConfig() {
    return getBoonRollConfig(this);
  }

  get impeding() {
    if (this.system.isArmor) {
      const armorImpeding = game.symbaroum.config.IMPEDING_DEFAULTS[this.system.reference] ?? 0;
      const armorFlexible = this.system.qualities.flexible ? game.symbaroum.config.IMPEDING_DEFAULTS["flexible"] : 0;
      const armorCumbersome = this.system.qualities.cumbersome ? game.symbaroum.config.IMPEDING_DEFAULTS["cumbersome"] : 0;
      const armorImpedingBonus = (this.system.bonus.impeding ?? 0) * -1;
      return Math.max(0, armorImpeding + armorFlexible + armorCumbersome + armorImpedingBonus);
    } else {
      return 0;
    }
  }

  _getPackageFormat(label) {
    return {
      id: this.id,
      label: label ?? this.name,
      type: game.symbaroum.config.PACK_CHECK,
      member: [],
    };
  }

  _getBaseFormat() {
    return {
      id: this.id,
      label: this.name,
      reference: this.system.reference,
      // Automatisierungspaket 1 v1.2 (Rudolfs Testrunde 2, Punkt 4 -
      // Eisenfaust-Adept-Fund): Mitglieder, die eine FÄHIGKEIT/ein
      // MERKMAL/eine KRAFT selbst erzeugt (isPower deckt traits, abilities,
      // mystical powers, rituals, burdens, boons ab), erhalten dieses
      // Herkunfts-Flag. Werden sie (wie bei Eisenfaust Novize/Adept) ins
      // Default-Paket (Paket 0) einer Waffe geschoben, rendert der moderne
      // Würfeldialog sie sonst fälschlich zwischen den Waffenqualitäten.
      // Waffen-/Rüstungs-Items bleiben ohne Flag (Waffenqualitäten-Block).
      // Klassische Templates ignorieren das Flag (unverändertes Rendering).
      abilityMod: !!(this.system?.isPower),
    };
  }

  // Reference combat modifiers
  // Armors
  _getOwnArmorBonuses(combatMods, armors) {
    for (let i = 0; i < armors.length; i++) {
      if (this.id == armors[i].id) {
        if (this.system.bonusProtection != "") {
          let base = this._getBaseFormat();
          let plus = "+";
          if (this.system.bonusProtection.charAt(0) === "+") {
            plus = "";
          }
          // NPC - cant get away from this
          let npcProt = 0;
          try {
            npcProt = Math.ceil(new Roll(this.system.bonusProtection).evaluateSync({ maximize: true }).total / 2);
          } catch (err) {
            ui.notifications?.error(`Could not evaulate armor bonus protection for ${this.name} - check bonus damage fields -` + err);
          }

          base.type = game.symbaroum.config.DAM_FIXED;
          base.alternatives = [
            {
              protectionMod: plus + this.system.bonusProtection,
              protectionModNPC: npcProt,
              displayMod: plus + this.system.bonusProtection,
            },
          ];
          combatMods.armors[armors[i].id].protectionChoices.push(base);
        }
        if (!this.system.isStackableArmor && this.system.qualities.reinforced) {
          let base = this._getBaseFormat();
          base.label = `${this.name}: ${game.i18n.localize("QUALITY.REINFORCED")}`;
          base.type = game.symbaroum.config.DAM_FIXED;
          base.alternatives = [
            {
              protectionMod: "+1d1",
              protectionModNPC: 1,
            },
          ];
          combatMods.armors[armors[i].id].protectionChoices.push(base);
        }
        if (!this.system.isStackableArmor) {
          if (this.system.qualities.flexible) {
            let base = this._getBaseFormat();
            base.label = `${this.name}: ${game.i18n.localize("QUALITY.FLEXIBLE")}`;
            base.modifier = 0; // Already calculated in total
            combatMods.armors[armors[i].id].impedingModifiers.push(base);
          }
          if (this.system.qualities.cumbersome) {
            let base = this._getBaseFormat();
            base.label = `${this.name}: ${game.i18n.localize("QUALITY.CUMBERSOME")}`;
            base.modifier = 0; // Already calcualted in total
            combatMods.armors[armors[i].id].impedingModifiers.push(base);
          }
          if (this.system.bonus.impeding) {
            let base = this._getBaseFormat();
            base.label = `${this.name}: ${game.i18n.localize("BONUS.IMPEDING_REDUCTION")}`;
            base.modifier = 0; // Already calcualted in total
            combatMods.armors[armors[i].id].impedingModifiers.push(base);
          }
        }
      } else if (this.system.isStackableArmor && !armors[i].system.isStackableArmor && this.system.isActive) {
        if (this.system.bonusProtection != "") {
          let base = this._getBaseFormat();
          let plus = "+";
          let npcProt = 0;
          try {
            npcProt = Math.ceil(new Roll(this.system.bonusProtection).evaluateSync({ maximize: true }).total / 2);
          } catch (err) {
            ui.notifications?.error(`Could not evaluate armor bonus protection for ${this.name} - check bonus damage fields -` + err);
          }
          base.type = game.symbaroum.config.DAM_FIXED;
          base.alternatives = [
            {
              protectionMod: plus + this.system.bonusProtection,
              protectionModNPC: npcProt,
              displayMod: plus + this.system.bonusProtection,
            },
          ];
          combatMods.armors[armors[i].id].protectionChoices.push(base);
        }
      }
    }
  }

  // All armor types
  getItemModifierStackable(combatMods, armors, weapons, abilities) {
    this._getOwnArmorBonuses(combatMods, armors);
  }

  getItemModifierLightarmor(combatMods, armors, weapons, abilities) {
    this._getOwnArmorBonuses(combatMods, armors);
  }

  getItemModifierMediumarmor(combatMods, armors, weapons, abilities) {
    this._getOwnArmorBonuses(combatMods, armors);
  }

  getItemModifierHeavyarmor(combatMods, armors, weapons, abilities) {
    this._getOwnArmorBonuses(combatMods, armors);
  }
  // Higher than d8
  getItemModifierSuperarmor(combatMods, armors, weapons, abilities) {
    this._getOwnArmorBonuses(combatMods, armors);
  }

  // Weapons
  _getOwnWeaponBonuses(combatMods, armors, weapons, abilities) {
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].id != this.id) {
        continue;
      }
      if (this.system.bonusDamage && this.system.bonusDamage !== "") {
        let base = this._getBaseFormat();
        base.display = game.i18n.localize("WEAPON.BONUS_DAMAGE") + ": ";
        let plus = "+";
        if (this.system.bonusDamage.charAt(0) === "+") {
          plus = "";
        }
        // NPC - cant get away from this
        let npcDam = 0;
        try {
          npcDam = Math.ceil(new Roll(this.system.bonusDamage).evaluateSync({ maximize: true }).total / 2);
        } catch (err) {
          ui.notifications?.error(`Could not evaluate weapon bonus for ${this.name} - check bonus damage fields - ` + err);
        }
        base.type = game.symbaroum.config.DAM_MOD;
        base.alternatives = [
          {
            damageMod: plus + this.system.bonusDamage,
            damageModNPC: npcDam,
            displayMod: plus + this.system.bonusDamage,
          },
        ];
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (this.system.qualities.deepImpact) {
        // Add 1
        let base = this._getBaseFormat();
        base.label = game.i18n.localize("QUALITY.DEEPIMPACT");
        base.type = game.symbaroum.config.DAM_MOD;
        base.value = "+1";
        // A30: quality marker - the one-handed bastard grip filters this member
        base.qualityRef = "deepImpact";
        base.alternatives = [
          {
            damageMod: "+1d1",
            damageModNPC: 1,
          },
        ];
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (this.system.qualities.precise) {
        // Add 1
        let base = this._getBaseFormat();
        base.label = game.i18n.localize("QUALITY.PRECISE");
        base.type = game.symbaroum.config.TYPE_ROLL_MOD;
        base.modifier = 1;
        base.value = "1";
        // A30: quality marker - the one-handed bastard grip filters this member
        base.qualityRef = "precise";
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (this.system.qualities.flaming) {
        let base = this._getBaseFormat();
        base.label = game.i18n.localize("QUALITY.FLAMING");
        base.value = game.i18n.localize("QUALITY.FLAMING");
        base.type = game.symbaroum.config.STATUS_DOT;
        base.damagePerRound = "1d4";
        base.damagePerRoundNPC = 2;
        base.duration = "1d4";
        base.durationNPC = 2;
        base.effectIcon = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "burning"));
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (this.system.qualities.bloodLetting) {
        // A28 G2/G3: Aderlass (Vault model) - 1 point of toughness per round,
        // stackable +1 per further hit (handled by addCondition), permanent
        // until the symbol is removed (First Aid / healing); the round/DoT
        // engine in hooks.js ticks it at the victim's turn start
        let base = this._getBaseFormat();
        base.label = game.i18n.localize("QUALITY.BLOODLETTING");
        base.value = game.i18n.localize("QUALITY.BLOODLETTING");
        base.type = game.symbaroum.config.STATUS_DOT;
        base.damagePerRound = "1";
        base.damagePerRoundNPC = 1;
        base.duration = "";
        base.durationNPC = 0;
        base.effectIcon = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bleeding"));
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (this.system.qualities.acidcoated) {
        // A28 G2: Säurebeschichtet - 1d4 acid damage per round for 1d4 rounds,
        // each round dealt as a SEPARATE hit (Vault); the wielder risk on a
        // natural 20 stays a GM hint (no automation), the round/DoT engine
        // ticks the damage at the victim's turn start
        let base = this._getBaseFormat();
        base.label = game.i18n.localize("QUALITY.ACIDCOATED");
        base.value = game.i18n.localize("QUALITY.ACIDCOATED");
        base.type = game.symbaroum.config.STATUS_DOT;
        base.damagePerRound = "1d4";
        base.damagePerRoundNPC = 2;
        base.duration = "1d4";
        base.durationNPC = 2;
        base.effectIcon = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "acid"));
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (this.system.qualities.poison) {
        // A28 fix (Rudolfs Testrunde): Giftbeschichtet had NO code path at all.
        // This member makes the quality visible in the attack dialog like the
        // other DoT qualities; the actual application deliberately does NOT
        // happen in the damageOverTime loop - Giftbeschichtet runs through the
        // established GRW opposed-roll poison path (cunning vs strong, see the
        // auto light-dose select in attackResult), keeping G5 intact
        let base = this._getBaseFormat();
        base.label = game.i18n.localize("QUALITY.POISON");
        base.value = game.i18n.localize("QUALITY.POISON");
        base.type = game.symbaroum.config.STATUS_DOT;
        base.damagePerRound = "1d4";
        base.damagePerRoundNPC = 2;
        base.duration = "1d4";
        base.durationNPC = 2;
        base.effectIcon = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "poison"));
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (this.system.qualities.massive) {
        let base = this._getBaseFormat();
        base.label = game.i18n.localize("QUALITY.MASSIVE");
        base.value = game.i18n.localize("DIALOG.FAVOUR_FAVOUR");
        base.type = game.symbaroum.config.DAM_FAVOUR;
        // A30: quality marker - the one-handed bastard grip drops Massive
        base.qualityRef = "massive";
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
        combatMods.weapons[weapons[i].id].specialEffects.push(game.symbaroum.config.DAM_FAVOUR);
      }
      if (this.system.alternativeDamage !== "none") {
        let base = this._getBaseFormat();
        base.label = game.i18n.localize("ATTRIBUTE.MODIFIER") + " (" + game.i18n.localize("QUALITY.PRECISE") + "): ";
        base.type = game.symbaroum.config.TYPE_ALTERNATIVE_DAMAGE;
        base.AltDmgAttribute = this.system.alternativeDamage;
        base.value = this.system.alternativeDamage;
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (this.system.isActive && this.system.qualities.balanced) {
        // A30: Ausbalanciert is deactivated while a bastard weapon is wielded
        // one-handed - the grip choice persists as a flag on the weapon item
        // (written by the attack dialog radio), because this quality works on
        // the wielder's passive defense, not on the attack flow
        const a30GripOne = this.system.qualities.bastard && this.getFlag(game.system.id, "grip") === "one";
        if (!a30GripOne) {
        for (let i = 0; i < armors.length; i++) {
          if (!this.system.isActive || !armors[i].system.isActive || armors[i].system.isStackableArmor) {
            continue;
          }
          let base = this._getBaseFormat();
          base.label = `${this.name}: ${game.i18n.localize("QUALITY.BALANCED")}`;
          base.modifier = 1;
          this.system.isIntegrated = true;
          combatMods.armors[armors[i].id].defenseModifiers.push(base);
        }
        }
      }
    }
  }

  // All melee weapons
  getItemModifierUnarmed(combatMods, armors, weapons, abilities) {
    this._getOwnWeaponBonuses(combatMods, armors, weapons, abilities);
  }
  getItemModifier1handed(combatMods, armors, weapons, abilities) {
    this._getOwnWeaponBonuses(combatMods, armors, weapons, abilities);
  }
  getItemModifierShort(combatMods, armors, weapons, abilities) {
    this._getOwnWeaponBonuses(combatMods, armors, weapons, abilities);
  }
  getItemModifierLong(combatMods, armors, weapons, abilities) {
    this._getOwnWeaponBonuses(combatMods, armors, weapons, abilities);
  }
  getItemModifierShield(combatMods, armors, weapons, abilities) {
    this._getOwnWeaponBonuses(combatMods, armors, weapons, abilities);
    if (!this.system.isActive) {
      return;
    }
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].id != this.id) {
        continue;
      }
      for (let i = 0; i < armors.length; i++) {
        if (!armors[i].system.isActive || armors[i].system.isStackableArmor) {
          continue;
        }
        let base = this._getBaseFormat();
        base.modifier = 1;
        combatMods.armors[armors[i].id].defenseModifiers.push(base);
      }
    }
  }

  getItemModifierHeavy(combatMods, armors, weapons, abilities) {
    this._getOwnWeaponBonuses(combatMods, armors, weapons, abilities);
  }
  // All ranged
  getItemModifierRanged(combatMods, armors, weapons, abilities) {
    this._getOwnWeaponBonuses(combatMods, armors, weapons, abilities);
  }
  getItemModifierThrown(combatMods, armors, weapons, abilities) {
    this._getOwnWeaponBonuses(combatMods, armors, weapons, abilities);
  }
  // End weapons

  // Start abilities & traits
  getItemModifierAlternativedamage(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage === "none") {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = base.type = game.symbaroum.config.DAM_DICEUPGRADE;
      base.diceUpgrade = 2 * lvl.level;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }
  getItemModifierArmored(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    // Many headed penalties
    let hasManyHeaded = this.actor.items.filter((manyheaded) => {
      return game.symbaroum.config.traitManyHeaded == manyheaded.system.reference;
    });
    if (hasManyHeaded.length > 0 && hasManyHeaded[0].getLevel().level > 1) {
      lvl.level = Math.max(0, lvl.level - hasManyHeaded[0].getLevel().level + 1);
      hasManyHeaded[0].system.isIntegrated = true;
      this.system.isIntegrated = true;
    }

    if (lvl.level == 0) return;

    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      let modifier = 0;
      // game.symbaroum.log("getItemModifierArmored", armors[i]); // TODO Remove
      if (armors[i].isNoArmor || armors[i].system.isSkin) {
        modifier = 4; // 1d4 armor
      }
      base.type = base.type = game.symbaroum.config.DAM_DICEUPGRADE;
      base.diceUpgrade = modifier + 2 * (lvl.level - 1); // Exclude novice - it is accounted for either in the noArmor check, or by the armor itself
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].protectionChoices.push(base);
    }
  }

  getItemModifierArmoredmystic(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      if (armors[i].system.isLightArmor || armors[i].system.isMediumArmor || (armors[i].system.isHeavyArmor && lvl.level > 1)) {
        let base = this._getBaseFormat();
        base.modifierMagic = armors[i].system.impeding; // Reduce with up to current impeding
        this.system.isIntegrated = true;
        combatMods.armors[armors[i].id].impedingModifiers.push(base);
      }
      if (lvl.level > 2) {
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_FIXED;
        base.alternatives = [
          {
            protectionMod: "+1d4",
            protectionModNPC: 2,
            displayMod: "+1d4",
          },
        ];
        this.system.isIntegrated = true;
        combatMods.armors[armors[i].id].protectionChoices.push(base);
      }
    }
  }

  getItemModifierBackstab(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level < 1) return;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none") {
        continue;
      }
      let pack = this._getPackageFormat();
      let basedmg = this._getBaseFormat();
      basedmg.type = game.symbaroum.config.DAM_MOD;
      if (lvl.level < 3) {
        basedmg.value = "+1d4";
        basedmg.alternatives = [
          {
            damageMod: "+1d4",
            damageModNPC: 2,
            restrictions: [game.symbaroum.config.DAM_1STATTACK],
          },
        ];
      } else {
        // Only master gives +1d8
        basedmg.value = "+1d8";
        basedmg.alternatives = [
          {
            damageMod: "+1d8",
            damageModNPC: 4,
          },
        ];
      }
      pack.member.push(basedmg);

      let baseAtt = this._getBaseFormat();
      baseAtt.type = game.symbaroum.config.TYPE_ATTRIBUTE;
      baseAtt.attribute = "discreet";
      pack.member.push(baseAtt);

      if (lvl.level > 1) {
        let baseBleed = this._getBaseFormat();
        baseBleed.value = game.i18n.localize("COMBAT.BLEED");
        baseBleed.type = game.symbaroum.config.STATUS_DOT;
        // A28 G3: the bleeding condition follows the Vault Aderlass model - 1 point
        // of toughness per round (stacks handled by addCondition), not 1d4
        baseBleed.damagePerRound = "1";
        baseBleed.damagePerRoundNPC = 1;
        baseBleed.duration = "";
        baseBleed.durationNPC = 0;
        baseBleed.effectIcon = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bleeding"));
        if (lvl.level == 2) {
          baseBleed.restrictions = [game.symbaroum.config.DAM_1STATTACK];
        }
        pack.member.push(baseBleed);
      }
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package.push(pack);
    }
  }

  getItemModifierBeastlore(combatMods, armors, weapons, abilities) {
    // Bestienkunde v1 (Rudolfs Freigabe 28.10.): KEINE Pauschal-Pakete mehr
    // (frueher: manuelle Dialog-Checkbox "+1d4/+1d6" auf alle Waffen und
    // schadensverursachenden Kraeften, ohne Kategorie-Pruefung). Der Bonus
    // laeuft jetzt vollautomatisch NUR gegen die auf dem Item-Blatt
    // gewaehlte Kategorie des anvisierten Ziels - Verbraucher:
    // getBeastloreDamageBonus (Waffen: attackResult/Beide Pfade, Kraefte:
    // modifierDialog-Callback). Novize unberuehrt (SL-Wissensprobe).
    return;
  }

  getItemModifierBerserker(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    // Make this ActiveEffect - check if this aligns with existing bersker in the modules
    if (!this.actor.hasCondition("berserker") && !this.actor.getFlag(game.system.id, "berserker")) {
      this.system.isIntegrated = false;
      return;
    }

    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      if (lvl.level > 1) {
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_FIXED;
        base.alternatives = [
          {
            protectionMod: "+1d4",
            protectionModNPC: 2,
            displayMod: "+1d4",
          },
        ];
        this.system.isIntegrated = true;
        combatMods.armors[armors[i].id].protectionChoices.push(base);
      }
      if (lvl.level < 3) {
        this.system.isIntegrated = true;
        combatMods.armors[armors[i].id].specialEffects.push(game.symbaroum.config.SPECIAL_MIN_DEFENSE);
      }
    }
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || !weapons[i].system.isMelee) {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.DAM_MOD;
      base.value = "+1d6";
      base.alternatives = [
        {
          damageMod: "+1d6",
          damageModNPC: 3,
        },
      ];
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }

  getItemModifierBlessedshield(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    this.system.isIntegrated = !!this.actor.hasCondition("holyShield");
  }

  getItemModifierBlessings(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    if (lvl.level > 1) {
      /* Hymnen-Paket 1.1: Traditionswissen-Gate (siehe getItemModifierSymbolism) */
      /* Hymnen-Paket 1.2 (Rudolfs Anmerkung zu Testpunkt 5): Stufen-
         abgleich wie bei Trollsingen - die Reduktion greift nur, wenn
         die Wirkstufe der Kraft die Traditionsstufe nicht übersteigt. */
      for (let i = 0; i < abilities.length; i++) {
        if (combatMods.abilities[abilities[i].id].type === "mysticalPower" && itemHasTraditionKnowledge(abilities[i], game.symbaroum.config.TRAD_BLESSINGS) && (combatMods.abilities[abilities[i].id].powerLvl?.level ?? 1) <= lvl.level) {
          combatMods.abilities[abilities[i].id].corruption = game.symbaroum.config.TEMPCORRUPTION_ONE;
          if (lvl.level > 2) {
            combatMods.abilities[abilities[i].id].healingBonus += "+1d4[" + this.name + "]";
            let pack = this._getPackageFormat();
            let base = this._getBaseFormat();
            base.type = game.symbaroum.config.DAM_MOD;
            base.value = "+1d4";
            base.alternatives = [
              {
                damageMod: "+1d4",
                damageModNPC: 2,
              },
            ];
            pack.member.push(base);
            this.system.isIntegrated = true;
            combatMods.abilities[abilities[i].id].package.push(pack);
          }
        }
      }
    }
    let base = this._getBaseFormat();
    base.value = game.symbaroum.config.TRAD_BLESSINGS;
    base.level = lvl.level;
    this.system.isIntegrated = true;
    combatMods.traditions.push(base);
  }

  getItemModifierChanneling(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    if (lvl.level > 1) {
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.TEMPCORRUPTION_FAVOUR;
      this.system.isIntegrated = true;
      combatMods.corruption.push(base);
    }
  }

  getItemModifierColossal(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    if (lvl.level > 2) {
      for (let i = 0; i < armors.length; i++) {
        if (armors[i].system.isStackableArmor) {
          continue;
        }
        let base = this._getBaseFormat();
        base.normal = 0;
        this.system.isIntegrated = true;
        combatMods.armors[armors[i].id].damageReductions.push(base);
      }
    }
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none") {
        continue;
      }
      let base = this._getBaseFormat();
      base.label = game.i18n.localize("QUALITY.MASSIVE");
      base.type = game.symbaroum.config.DAM_FAVOUR;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
      combatMods.weapons[weapons[i].id].specialEffects.push(game.symbaroum.config.DAM_FAVOUR);
      if (lvl.level > 1) {
        let base2 = this._getBaseFormat();
        base2.type = game.symbaroum.config.TYPE_FAVOUR;
        base2.value = game.i18n.localize("DIALOG.FAVOUR_FAVOUR");
        base2.favourMod = 1;
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base2);
      }
    }
  }

  getItemModifierCorruptingattack(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.reference !== "unarmed") {
        continue;
      }
      let base = this._getBaseFormat();
      base.label = game.i18n.localize("TRAIT_LABEL.CORRUPTINGATTACK");
      base.type = game.symbaroum.config.CORRUPTION_DAMAGE;
      base.damage = "1d" + ((1 + lvl.level) * 2).toString();
      base.damageNPC = 1 + lvl.level;
      base.value = base.damage;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }

  /* Konzept Runde 3 Teil A (Knochengeschoss): Meister-Bonus-Mitglied
     (+1W4, Kalibrierung - der Vault-Steckbrief nennt keine Formel) und
     Korruptionsangriff (Muster getItemModifierCorruptingattack) als
     AUTOMATISCHE Paket-Mitglieder der Cross-Waffe - keine Checkbox,
     nur bei Meisterstufe. Die Cross-Waffe IST dieses Merkmals-Item,
     existsGuard falls _getWeapons sie (noch) nicht als Waffe fuehrt. */
  getItemModifierBoneprojectile(combatMods, armors, weapons, abilities) {
    const lvl = this.getLevel();
    if (lvl.level < 3) return;
    if (!combatMods.weapons[this.id]) return;
    this.system.isIntegrated = true;
    const masterCfg = game.symbaroum.config.MM2_BONE_MASTER_BONUS ?? { damageMod: "+1d4", damageModNPC: 2 };
    let base = this._getBaseFormat();
    base.label = game.i18n.localize("TRAIT_BONEPROJECTILE.MASTER_BONUS");
    base.type = game.symbaroum.config.DAM_MOD;
    base.value = masterCfg.damageMod;
    base.alternatives = [{ damageMod: masterCfg.damageMod, damageModNPC: masterCfg.damageModNPC }];
    combatMods.weapons[this.id].package[0].member.push(base);
    const caLvl = this.actor ? getActorAbilityLevel(this.actor, "corruptingattack") : 0;
    if (caLvl > 0) {
      let caBase = this._getBaseFormat();
      caBase.label = game.i18n.localize("TRAIT_LABEL.CORRUPTINGATTACK");
      caBase.type = game.symbaroum.config.CORRUPTION_DAMAGE;
      caBase.damage = "1d" + ((1 + caLvl) * 2).toString();
      caBase.damageNPC = 1 + caLvl;
      caBase.value = caBase.damage;
      combatMods.weapons[this.id].package[0].member.push(caBase);
    }
  }

  getItemModifierDancingweapon(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0 || (!this.actor.hasCondition("dancingweapon") && !this.actor.getFlag(game.system.id, "dancingweapon"))) {
      return;
    }
    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.attribute = "resolute";
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].attributes.push(base);
    }
    for (let i = 0; i < weapons.length; i++) {
      if (!weapons[i].system.isMelee) {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
      base.attribute = "resolute";
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }

  getItemModifierDominate(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < weapons.length; i++) {
      if (!weapons[i].system.isMelee) {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
      base.attribute = "persuasive";
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }

  getItemModifierFeatofstrength(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < weapons.length; i++) {
      if (!weapons[i].system.isMelee) {
        continue;
      }
      if (lvl.level == 3 && this.actor.system.health.toughness.value <= this.actor.system.health.toughness.max / 2) {
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_MOD;
        base.value = "+1d4";
        base.alternatives = [
          {
            damageMod: "+1d4",
            damageModNPC: 2,
          },
        ];
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (lvl.level > 1 && this.actor.system.health.toughness.value <= this.actor.system.health.toughness.max / 2) {
        let base2 = this._getBaseFormat();
        base2.type = game.symbaroum.config.TYPE_FAVOUR;
        base2.condition = "conditionFeatofStrength";
        base2.value = game.i18n.localize("DIALOG.FAVOUR_FAVOUR");
        base2.favourMod = 1;
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base2);
      }
    }
    let base3 = this._getBaseFormat();
    base3.type = game.symbaroum.config.SEC_ATT_BONUS;
    base3.value = 5;
    this.system.isIntegrated = true;
    combatMods.toughness.push(base3);
  }

  conditionFeatofStrength() {
    return weapon.attribute === "strong";
  }

  getItemModifierFeint(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    if (lvl.level > 1) {
      for (let i = 0; i < armors.length; i++) {
        if (armors[i].system.isStackableArmor) {
          continue;
        }
        let base = this._getBaseFormat();
        base.attribute = "discreet";
        this.system.isIntegrated = true;
        combatMods.armors[armors[i].id].attributes.push(base);
      }
    }
    for (let i = 0; i < weapons.length; i++) {
      if (!weapons[i].system.isMelee || !(weapons[i].system.qualities.precise || weapons[i].system.qualities.short)) {
        continue;
      }
      let base = this._getBaseFormat();
      base.attribute = "discreet";
      base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }

  getItemModifierHuntersinstinct(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level < 1) return;
    for (let i = 0; i < weapons.length; i++) {
      if (!weapons[i].system.isDistance) {
        continue;
      }
      let pack = this._getPackageFormat();
      let baseFav = this._getBaseFormat();
      baseFav.type = game.symbaroum.config.TYPE_FAVOUR;
      baseFav.value = game.i18n.localize("DIALOG.FAVOUR_FAVOUR");
      baseFav.favourMod = 1;
      pack.member.push(baseFav);
      if (lvl.level > 1) {
        let baseDmg = this._getBaseFormat();
        baseDmg.type = game.symbaroum.config.DAM_MOD;
        (baseDmg.value = "+1d4"),
          (baseDmg.alternatives = [
            {
              damageMod: "+1d4",
              damageModNPC: 2,
            },
          ]);
        pack.member.push(baseDmg);
      }
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package.push(pack);
    }
  }

  getItemModifierIronfist(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || !weapons[i].system.isMelee) {
        continue;
      }
      if (lvl.level > 0) {
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
        base.attribute = "strong";
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (lvl.level == 2) {
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_MOD;
        base.value = "+1d4";
        base.alternatives = [
          {
            damageMod: "+1d4",
            damageModNPC: 2,
          },
        ];
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (lvl.level == 3) {
        let pack = this._getPackageFormat();
        pack.label = game.i18n.localize("ABILITY_LABEL.IRON_FIST");
        pack.type = game.symbaroum.config.PACK_RADIO;
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_RADIO;
        if (this.actor.type === "player") {
          pack.defaultSelect = "+1d4";
        } else {
          pack.defaultSelect = "2";
        }
        base.alternatives = [
          {
            label: game.i18n.localize("ABILITY_LABEL.IRON_FIST"),
            damageMod: "+1d8",
            damageModNPC: 4,
            restrictions: [game.symbaroum.config.DAM_ACTIVE],
          },
          {
            label: game.i18n.localize("ABILITY_LABEL.IRON_FIST"),
            damageMod: "+1d4",
            damageModNPC: 2,
            restrictions: [game.symbaroum.config.DAM_NOTACTIVE],
          },
        ];
        pack.member.push(base);
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package.push(pack);
      }
    }
  }

  getItemModifierKnifeplay(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < weapons.length; i++) {
      if (!weapons[i].system.qualities.knifePlayCompatibility) {
        continue;
      }
      let base = this._getBaseFormat();
      base.attribute = "quick";
      base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
      if (lvl.level > 1) {
        let base2 = this._getBaseFormat();
        base2.type = game.symbaroum.config.TYPE_ATTACKINCREASE;
        base2.modifier = 1;
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base2);
        combatMods.weapons[weapons[i].id].maxAttackNb += 1;
      }
    }
  }

  getItemModifierLeader(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < abilities.length; i++) {
      if (combatMods.abilities[abilities[i].id].type === "mysticalPower") {
        let base = this._getBaseFormat();
        base.attribute = "persuasive";
        base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
        this.system.isIntegrated = true;
        combatMods.abilities[abilities[i].id].attributes.push(base);
      }
    }
    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.lvl = lvl;
      base.type = game.symbaroum.config.TYPE_ALT_RESIST_ATTR_RESOLUTE;
      base.attribute = "persuasive";
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].damageReductions.push(base);
    }
  }

  getItemModifierManatarms(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    let hasArmored = this.actor.items.filter((armored) => {
      return game.symbaroum.config.abilityArmor.includes(armored.system.reference);
    });
    for (let i = 0; i < armors.length; i++) {
      if ((hasArmored.length == 0 && armors[i].isNoArmor) || armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = base.type = game.symbaroum.config.DAM_DICEUPGRADE;
      base.diceUpgrade = 2;
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].protectionChoices.push(base);
      if (lvl.level > 1) {
        base = this._getBaseFormat();
        base.modifier = armors[i].impeding; // Reduce with up to current impeding
        this.system.isIntegrated = true;
        combatMods.armors[armors[i].id].impedingModifiers.push(base);
      }
    }
  }

  getItemModifierMarksman(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || weapons[i].system.reference != "ranged") {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = base.type = game.symbaroum.config.DAM_DICEUPGRADE;
      base.diceUpgrade = 2;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }

  getItemModifierNaturalwarrior(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || weapons[i].system.reference !== "unarmed") {
        continue;
      }
      if (lvl.level > 0) {
        let base = this._getBaseFormat();
        base.type = base.type = game.symbaroum.config.DAM_DICEUPGRADE;
        base.diceUpgrade = 2;
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
      if (lvl.level > 1) {
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.TYPE_ATTACKINCREASE;
        base.modifier = 1;
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
        combatMods.weapons[weapons[i].id].maxAttackNb += 1;
      }
      if (lvl.level > 2) {
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_MOD;
        base.value = "+1d6";
        base.alternatives = [
          {
            damageMod: "+1d6",
            damageModNPC: 3,
          },
        ];
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
    }
  }

  getItemModifierNaturalweapon(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || weapons[i].system.reference !== "unarmed") {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = base.type = game.symbaroum.config.DAM_DICEUPGRADE;
      base.diceUpgrade = 2 * lvl.level;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }

  /* MM-Paket 1 v1.1 (Rudolfs Checkbox-Entscheidung "wie bei den
     Faehigkeiten"): Die Nahkampf-Treffer-Merkmale des Pakets legen
     ein JE-MERKMAL-Checkbox-Paket auf die NATUERLICHE Waffe (unarmed)
     des Merkmalsträgers - VORANGEHAKT (Automatik-Naehe, Rudolfs
     Entscheidung), im Waffendialog abwaehlbar. Die Auswahl reitet als
     mm1Ticked-Map (dialog.js) in den Angriff; die mm1AttackerTraits-
     Kette feuert dann NUR noch angehakte Merkmale (kein Dialog im
     Fluss = v1.0-Automatik). Das leere member-Array ist Absicht:
     Merkmale wirken ueber die eigene Kette, nicht ueber Paket-
     Mitglieder; die autoParams-Zeile der Ergebniskarte (Analogon zu
     den Faehigkeits-Paketen) kommt aus dem Tick-Handling des Dialogs.
     isIntegrated gibt das "vollautomatisch"-Badge (Muster Natuerliche
     Waffe/Robust). */
  getItemModifierAcidicattack(combatMods, armors, weapons, abilities) {
    const lvl = this.getLevel();
    if (lvl.level === 0) return;
    this.system.isIntegrated = true;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.reference !== "unarmed" || weapons[i].system.alternativeDamage !== "none") continue;
      const pack = this._getPackageFormat(game.i18n.localize("TRAIT_LABEL.ACIDICATTACK"));
      pack.mm1TraitRef = "acidicattack";
      pack.preselect = true;
      combatMods.weapons[weapons[i].id].package.push(pack);
    }
  }

  getItemModifierParalyzingvenom(combatMods, armors, weapons, abilities) {
    const lvl = this.getLevel();
    if (lvl.level === 0) return;
    this.system.isIntegrated = true;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.reference !== "unarmed" || weapons[i].system.alternativeDamage !== "none") continue;
      const pack = this._getPackageFormat(game.i18n.localize("TRAIT_LABEL.PARALYZINGVENOM"));
      pack.mm1TraitRef = "paralyzingvenom";
      pack.preselect = true;
      combatMods.weapons[weapons[i].id].package.push(pack);
    }
  }

  getItemModifierInfectious(combatMods, armors, weapons, abilities) {
    const lvl = this.getLevel();
    if (lvl.level === 0) return;
    this.system.isIntegrated = true;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.reference !== "unarmed" || weapons[i].system.alternativeDamage !== "none") continue;
      const pack = this._getPackageFormat(game.i18n.localize("TRAIT_LABEL.INFECTIOUS"));
      pack.mm1TraitRef = "infectious";
      pack.preselect = true;
      combatMods.weapons[weapons[i].id].package.push(pack);
    }
  }

  /* Saeureblut bleibt Verteidiger-VOLLautomatik (Rudolfs Bestaetigung:
     keine Checkbox) - die Methode setzt NUR das Badge. */
  getItemModifierAcidicblood(combatMods, armors, weapons, abilities) {
    const lvl = this.getLevel();
    if (lvl.level === 0) return;
    this.system.isIntegrated = true;
  }

  /* ================================================================
   * MM-Paket 2 v1 „Festhalten & Kampf-Kontrolle" (Rudolfs Baufreigabe
   * 24.11.2026, Konzept Rev. 2 + Rudolfs Baufrage-Antwort „Kern MIT
   * Gestaltwandel bauen"). Checkbox-Pakete der REAKTIONS-Merkmale an
   * der natürlichen Waffe (v1.1-Muster: vorangehakt, abwählbar, im
   * Freien Angriff sichtbar, dialog.js sammelt in functionStuff.mm2Ticked,
   * leere Map = bewusst aus, fehlende Map = v1.0-Automatik-Rückfall):
   * - Erdrückende Umarmung (crushingembrace): Escape [GW<-PR]-Probe
   *   (mm2AttackerTraits), Fehlschlag = bind + Griff-DoT 2/3/4 je
   *   Stufe (A28-Festwert, ignoriert Rüstung nativ).
   * - Verschlingen (devour): Biss-Trigger (Novize: Schaden, Adept:
   *   Treffer), verzögert bis zum Kreaturen-Zug (Meister: sofort);
   *   Kolossal-Gate mit Hinweis.
   * - Zerstörer (wrecker): [ST<-ST]-Reaktion auf Schaden (Nov/Adept,
   *   Checkbox), Meister-passiv trägt die Qualität Zerstörend als
   *   eigenes Label-Paket auf die unbewaffnete Waffe (isIntegrated).
   * - Blitzschnell (swift): KEIN Paket - die Reaktion läuft als
   *   Hinweiszeile + Button auf der ERGEBNISKARTE jedes Angriffs
   *   (mm2AttackerTraits); hier bleibt nur das Badge.
   * ================================================================ */
  getItemModifierCrushingembrace(combatMods, armors, weapons, abilities) {
    const lvl = this.getLevel();
    if (lvl.level === 0) return;
    this.system.isIntegrated = true;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.reference !== "unarmed" || weapons[i].system.alternativeDamage !== "none") continue;
      const pack = this._getPackageFormat(game.i18n.localize("TRAIT_LABEL.CRUSHINGEMBRACE"));
      pack.mm2TraitRef = "crushingembrace";
      pack.preselect = true;
      combatMods.weapons[weapons[i].id].package.push(pack);
    }
  }

  getItemModifierDevour(combatMods, armors, weapons, abilities) {
    const lvl = this.getLevel();
    if (lvl.level === 0) return;
    this.system.isIntegrated = true;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.reference !== "unarmed" || weapons[i].system.alternativeDamage !== "none") continue;
      const pack = this._getPackageFormat(game.i18n.localize("TRAIT_LABEL.DEVOUR"));
      pack.mm2TraitRef = "devour";
      pack.preselect = true;
      combatMods.weapons[weapons[i].id].package.push(pack);
    }
  }

  getItemModifierWrecker(combatMods, armors, weapons, abilities) {
    const lvl = this.getLevel();
    if (lvl.level === 0) return;
    this.system.isIntegrated = true;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.reference !== "unarmed" || weapons[i].system.alternativeDamage !== "none") continue;
      if (lvl.level >= 3) {
        /* Meister (RAW passiv): Angriffe mit den natürlichen Waffen
           haben die Qualität Zerstörend (QUALITY.WRECKING existiert als
           i18n-Key). Bewusst als VORANGEHAKTES Label-Paket OHNE
           Mechanik - die Objekt-Schadens-Engine (Zerstörend gegen
           Objekte) kommt mit Paket 2a; hier bleibt die sichtbare
           Qualitäts-Zeile im Waffendialog (Präzedenz naturalweapon). */
        const pack = this._getPackageFormat(game.i18n.localize("QUALITY.WRECKING"));
        pack.mm2TraitRef = "wreckerquality";
        pack.preselect = true;
        pack.member = [];
        combatMods.weapons[weapons[i].id].package.push(pack);
      } else {
        /* Novize/Adept: [ST<-ST]-Reaktion auf erlittenen Schaden -
           Checkbox-Paket, Auswertung in mm2AttackerTraits. */
        const pack = this._getPackageFormat(game.i18n.localize("TRAIT_LABEL.WRECKER"));
        pack.mm2TraitRef = "wrecker";
        pack.preselect = true;
        combatMods.weapons[weapons[i].id].package.push(pack);
      }
    }
  }

  getItemModifierSwift(combatMods, armors, weapons, abilities) {
    const lvl = this.getLevel();
    if (lvl.level === 0) return;
    /* Reaktion erkennt JEDE Kampfaktion (Nahkampf/Fernkampf/mystisch;
   RAW) - kein Waffen-Paket, nur das „vollautomatisch"-Badge; die
   Hinweiszeile entsteht in mm2AttackerTraits auf der Ergebniskarte. */
    this.system.isIntegrated = true;
  }

  /* MM-Paket 2 v1 (Gestaltwandel-Baustein, Rudolfs Baufrage-Antwort
     „Kern MIT Gestaltwandel bauen"): FORM-QUALITÄTEN der Kraft, bewusst
     formgebunden - alle Mitglieder greifen NUR bei AKTIVEM shapeshift-
     Marker (Feuerseele-Gate-Muster firesoulActiveLevel). RAW (Vault
     „Gestaltwandel"): Novize kleine Bestiengestalt (Probe/Gunst läuft
     über boon.js getShapeshiftFavour); Adept Kampfbestie + Gepanzert
     (I) (natürliche Rüstung 1W4, Armored-Präzedenz Hundepanzer) +
     Natürliche Waffe (I) (unbewaffnete Waffe +1 Würfelstufe, Präzedenz
     naturalweapon); Meister zusätzlich Regeneration (I) (1W4 Heilung
     je Runde über den A28-Heil-DoT auf dem Marker) + Robust (M) (I)
     (+2 Zähigkeitsschwelle, actor.js _computeSecondaryAttributes
     liest den aktiven Marker). */
  getItemModifierShapeshift(combatMods, armors, weapons, abilities) {
    const formLevel = shapeshiftActiveLevel(this.actor);
    if (formLevel === 0) return;
    this.system.isIntegrated = true;
    if (formLevel >= 2) {
      for (let i = 0; i < armors.length; i++) {
        if (armors[i].system.isStackableArmor) continue;
        if (armors[i].isNoArmor || armors[i].system.isSkin) {
          const base = this._getBaseFormat();
          base.type = game.symbaroum.config.DAM_DICEUPGRADE;
          base.diceUpgrade = 4; // natürliche Rüstung 1W4 (Gepanzert I)
          combatMods.armors[armors[i].id].protectionChoices.push(base);
        }
      }
      for (let i = 0; i < weapons.length; i++) {
        if (weapons[i].system.reference !== "unarmed" || weapons[i].system.alternativeDamage !== "none") continue;
        const base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_DICEUPGRADE;
        base.diceUpgrade = 2; // unbewaffnete Waffe +1 Stufe (Natürliche Waffe I)
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
    }
  }

  getItemModifierNopainthreshold(combatMods, armors, weapons, abilities) {
    let base = this._getBaseFormat();
    base.type = game.symbaroum.config.NO_TRESHOLD;
    this.system.isIntegrated = true;
    combatMods.toughness.push(base);
  }

  getItemModifierPoisonresilient(combatMods, armors, weapons, abilities) {
    let boonLevel = this.system.level;
    if (boonLevel < 1) return;
    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.lvl = boonLevel;
      base.type = game.symbaroum.config.TYPE_ROLL_MOD;
      base.modifier = boonLevel;
      base.value = boonLevel.toString();
      base.powers = ["poisoner", "poisonous"];
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].damageReductions.push(base);
    }
  }

  getItemModifierPolearmmastery(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || !weapons[i].system.isMelee || !weapons[i].system.qualities.long) {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.DAM_DICEUPGRADE;
      base.diceUpgrade = 2;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }

  getItemModifierProtectiverunes(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    this.system.isIntegrated = !!this.actor.hasCondition("protectiverunes");
    if (!this.actor.hasCondition("protectiverunes")) return;
    let bonusDice = lvl.level === 3 ? "1d6" : "1d4";
    let npcBonus = lvl.level === 3 ? 3 : 2;
    for (let i = 0; i < armors.length; i++) {
      let base = this._getBaseFormat();
      base.label = game.i18n.localize("POWER_LABEL.PROTECTIVE_RUNES");
      base.type = game.symbaroum.config.DAM_FIXED;
      base.alternatives = [
        {
          protectionMod: "+" + bonusDice,
          protectionModNPC: npcBonus,
          displayMod: "+" + bonusDice,
        },
      ];
      combatMods.armors[armors[i].id].protectionChoices.push(base);
    }
  }

  getItemModifierRapidfire(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.reference !== "ranged") {
        continue;
      }
      let attackNb = 1;
      if (lvl.level > 2) attackNb = 2;
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.TYPE_ATTACKINCREASE;
      base.modifier = attackNb;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
      combatMods.weapons[weapons[i].id].maxAttackNb += attackNb;
    }
  }

  getItemModifierRapidreflexes(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level < 1) return;
    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.lvl = lvl;
      base.type = game.symbaroum.config.TYPE_DMG_AVOIDING;
      base.powers = game.symbaroum.config.rapidReflexesResistList;
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].damageReductions.push(base);
    }
  }

  getItemModifierRevenantstrike(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level < 1 || (!this.actor.hasCondition("revenantstrike") && !this.actor.getFlag(game.system.id, "revenantstrike"))) {
      return;
    }
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || !weapons[i].system.qualities?.desecrated) {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.DAM_MOD;
      (base.value = lvl.level > 2 ? "+1d8" : "+1d4"),
        (base.alternatives = [
          {
            damageMod: lvl.level > 2 ? "+1d8" : "+1d4",
            damageModNPC: lvl.level > 2 ? 4 : 2,
          },
        ]);
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }

  getItemModifierRobust(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();

    // Many headed penalties
    let hasManyHeaded = this.actor.items.filter((manyheaded) => {
      return game.symbaroum.config.traitManyHeaded == manyheaded.system.reference;
    });
    if (hasManyHeaded.length > 0 && hasManyHeaded[0].getLevel().level > 1) {
      lvl.level = Math.max(0, lvl.level - hasManyHeaded[0].getLevel().level + 1);
      hasManyHeaded[0].system.isIntegrated = true;
      this.system.isIntegrated = true;
    }

    if (lvl.level == 0) return;

    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.DAM_MOD;
      base.alternatives = [
        {
          protectionMod: "+1d" + (2 + lvl.level * 2),
          protectionModNPC: 1 + lvl.level,
        },
      ];
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].protectionChoices.push(base);
      base = this._getBaseFormat();
      base.modifier = -1 * lvl.level - 1; // Reduce with up to current impeding
      combatMods.armors[armors[i].id].defenseModifiers.push(base);
    }
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || !weapons[i].system.isMelee) {
        continue;
      }
      let pack = this._getPackageFormat();
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.DAM_MOD;
      base.value = "+1d" + (2 + lvl.level * 2);
      base.alternatives = [
        {
          damageMod: "+1d" + (2 + lvl.level * 2),
          damageModNPC: 1 + lvl.level,
          restrictions: [game.symbaroum.config.DAM_1STATTACK],
        },
      ];
      pack.member.push(base);
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package.push(pack);
    }
  }

  getItemModifierShieldfighter(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let haveShieldEquipped = this.actor.items.filter((element) => element.system?.reference === "shield" && element.system.isActive);
      if (haveShieldEquipped.length === 0) {
        continue;
      }
      let base = this._getBaseFormat();
      base.modifier = 1;
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].defenseModifiers.push(base);
    }
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.isMelee && ["1handed", "short", "unarmed"].includes(weapons[i].system.reference)) {
        let haveShieldEquipped = this.actor.items.filter((element) => element.system?.reference === "shield" && element.system.isActive);
        if (haveShieldEquipped.length === 0) {
          continue;
        }
        // Upgrade weapon
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_DICEUPGRADE;
        base.diceUpgrade = 2;
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      } else if (weapons[i].system.reference === "shield" && lvl.level > 2) {
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_DICEUPGRADE;
        base.diceUpgrade = 4;
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
    }
  }

  getItemModifierSixthsense(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    // Level 2
    if (lvl.level > 1) {
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.TYPE_INITIATIVE;
      base.attribute = "vigilant";
      this.system.isIntegrated = true;
      combatMods.initiative.push(base);
    }
    if (lvl.level > 1) {
      for (let i = 0; i < armors.length; i++) {
        if (armors[i].system.isStackableArmor) {
          continue;
        }
        let base = this._getBaseFormat();
        base.attribute = "vigilant";
        base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
        this.system.isIntegrated = true;
        combatMods.armors[armors[i].id].attributes.push(base);
      }
    }
    // Level 1
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || !weapons[i].system.isDistance) {
        continue;
      }
      let base = this._getBaseFormat();
      base.attribute = "vigilant";
      base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }
  //TODO sorcery level>1
  getItemModifierSorcery(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    if (lvl.level > 1) {
      for (let i = 0; i < abilities.length; i++) {
        if (combatMods.abilities[abilities[i].id].type === "mysticalPower" && combatMods.abilities[abilities[i].id].corruption == game.symbaroum.config.TEMPCORRUPTION_NORMAL) {
          combatMods.abilities[abilities[i].id].corruption = game.symbaroum.config.TEMPCORRUPTION_TESTFORONE;
        }
      }
    }
    let base = this._getBaseFormat();
    base.value = game.symbaroum.config.TRAD_SORCERY;
    base.level = lvl.level;
    this.system.isIntegrated = true;
    combatMods.traditions.push(base);
  }

  getItemModifierSphere(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    if (!this.actor.hasCondition("sphere") && !this.actor.getFlag(game.system.id, "sphere")) return;
    /* Kräfte-Paket 1 (Wahlmodell B, Rudolfs Entscheidung 5): Die
       Substitution greift nur, wenn im Aktivierungsdialog Willenskraft
       gewaehlt wurde - Radio-Wahl mit Bindung bis zum Kraftende. Legacy-
       Marker ohne Wahl-Feld (alte Aktiverungs-Residuen) behalten das
       A16-Verhalten: Substitution anlegen, der Typ-@-Mechanismus wendet
       sie nur an, wenn Willenskraft die hoehere Eigenschaft ist. */
    const sphereMarker = this.actor.hasCondition("sphere");
    const sphereFlagData = sphereMarker?.getFlag(game.system.id, "flagData");
    if (sphereFlagData && typeof sphereFlagData === "object" && sphereFlagData.choice) {
      if (sphereFlagData.choice !== "resolute") return;
    }
    // A16 Sphere (active toggle): while the sphere condition is active, defense is
    // rolled with Resolute instead of Quick (same replacement mechanism as Tactician,
    // applied when Resolute is the higher attribute)
    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.attribute = "resolute";
      base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
      base.label = game.i18n.localize("POWER_LABEL.SPHERE");
      /* Wahlmodell B: erzwungene Substitution bei gebundener Wahl
         (keine Höher-Wert-Automatik); Legacy-Marker ohne choice-Feld
         (null) bleiben bedingt (A16). */
      base.force = !!(sphereFlagData && typeof sphereFlagData === "object" && sphereFlagData.choice === "resolute");
      this.system.isIntegrated = !!(sphereFlagData && typeof sphereFlagData === "object" && sphereFlagData.choice === "resolute");
      combatMods.armors[armors[i].id].attributes.push(base);
    }
  }

  getItemModifierSpiritform(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.normal = 0.5;
      base.poison = 0;
      base.bleeding = 0;
      if (lvl.level > 1) {
        base.mysticArm = 0.5;
        base.mysticIgnArm = 0.5;
        base.elemental = 0.5;
        base.holy = 0.5;
        base.mysticalWeapon = 0.5;
      }
      if (lvl.level > 2) {
        base.normal = 0;
        base.elemental = 0;
      }
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].damageReductions.push(base);
    }
  }

  getItemModifierStafffighting(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    let haveStaffEquipped = this.actor.items.filter((element) => element.system.isWeapon && element.system.qualities.long && element.system.isActive);
    if (haveStaffEquipped.length) {
      let mod = 1;
      if (this.actor.items.filter((element) => element.system.isWeapon && element.system.isActive && element.system.qualities.staffFightingCompatibility).length) mod = 2;
      for (let i = 0; i < armors.length; i++) {
        if (armors[i].system.isStackableArmor) {
          continue;
        }
        let base = this._getBaseFormat();
        base.modifier = mod;
        this.system.isIntegrated = true;
        combatMods.armors[armors[i].id].defenseModifiers.push(base);
      }
    }
  }

  getItemModifierStaffmagic(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    let activeStaff = false;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.isMelee && ["long"].includes(weapons[i].system.reference) && weapons[i].system.qualities.staffMagicCompatibility) {
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_MOD;
        base.value = "+1d4";
        base.alternatives = [
          {
            damageMod: "+1d4",
            damageModNPC: 2,
          },
        ];
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
        activeStaff = weapons[i].system.isActive || activeStaff;
      }
    }
    if (lvl.level > 1 && activeStaff) {
      /* Hymnen-Paket 1.1: Traditionswissen-Gate (siehe getItemModifierSymbolism) */
      /* Hymnen-Paket 1.2 (Rudolfs Anmerkung zu Testpunkt 5): Stufen-
         abgleich wie bei Trollsingen - die Reduktion greift nur, wenn
         die Wirkstufe der Kraft die Traditionsstufe nicht übersteigt. */
      for (let j = 0; j < abilities.length; j++) {
        if (combatMods.abilities[abilities[j].id].type === "mysticalPower" && itemHasTraditionKnowledge(abilities[j], game.symbaroum.config.TRAD_STAFFM) && (combatMods.abilities[abilities[j].id].powerLvl?.level ?? 1) <= lvl.level) {
          combatMods.abilities[abilities[j].id].corruption = lvl.level == 2 ? game.symbaroum.config.TEMPCORRUPTION_FAVOUR : game.symbaroum.config.TEMPCORRUPTION_NONE;
        }
      }
    }
    let base = this._getBaseFormat();
    base.value = game.symbaroum.config.TRAD_STAFFM;
    base.level = lvl.level;
    this.system.isIntegrated = true;
    combatMods.traditions.push(base);
  }

  getItemModifierSteadfast(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level < 1) return;
    for (let i = 0; i < armors.length; i++) {
      // Do we apply it if they just wear stackable armor?
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.lvl = lvl;
      base.type = game.symbaroum.config.TYPE_FAVOUR;
      base.value = game.i18n.localize("DIALOG.FAVOUR_FAVOUR");
      base.favourMod = -1;
      base.powers = game.symbaroum.config.steadFastNovResistList;
      if (lvl.level > 1) {
        base.powers = base.powers.concat(game.symbaroum.config.steadFastAdeptResistList);
      }
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].damageReductions.push(base);
    }
  }

  getItemModifierSteelthrow(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || weapons[i].system.reference != "thrown") {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = base.type = game.symbaroum.config.DAM_DICEUPGRADE;
      base.diceUpgrade = 2;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
      if (lvl.level > 1) {
        let attackNb = 1;
        if (lvl.level > 2) attackNb = 2;
        let base2 = this._getBaseFormat();
        base2.type = game.symbaroum.config.TYPE_ATTACKINCREASE;
        base2.modifier = attackNb;
        combatMods.weapons[weapons[i].id].package[0].member.push(base2);
        combatMods.weapons[weapons[i].id].maxAttackNb += attackNb;
      }
    }
  }

  getItemModifierStronggift(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level < 2) return;
    let base = this._getBaseFormat();
    base.type = game.symbaroum.config.SEC_ATT_MULTIPLIER;
    base.value = 2;
    combatMods.corruption.push(base);
    let base2 = this._getBaseFormat();
    base2.type = game.symbaroum.config.THRESHOLD_MULTIPLIER;
    base2.value = 1;
    this.system.isIntegrated = true;
    combatMods.corruption.push(base2);
  }

  getItemModifierSturdy(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    let base = this._getBaseFormat();
    base.type = game.symbaroum.config.SEC_ATT_MULTIPLIER;
    if (lvl.level == 1) base.value = 1.5;
    else base.value = lvl.level;
    this.system.isIntegrated = true;
    combatMods.toughness.push(base);
  }

  getItemModifierSurvivalinstinct(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level < 2) return;
    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.DAM_FIXED;
      base.alternatives = [
        {
          protectionMod: "+1d4",
          protectionModNPC: 2,
          displayMod: "+1d4",
        },
      ];
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].protectionChoices.push(base);
    }
  }

  getItemModifierSwarm(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < armors.length; i++) {
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.normal = 0.5;
      base.mysticArm = 0.5;
      base.mysticIgnArm = 0.5;
      base.elemental = 0.5;
      base.holy = 0.5;
      base.mysticalWeapon = 0.5;
      base.poison = 0;
      base.bleeding = 0;
      if (lvl.level > 2) {
        base.normal = 0.25;
        base.mysticArm = 0.25;
        base.mysticIgnArm = 0.25;
        base.elemental = 0.25;
        base.holy = 0.25;
        base.mysticalWeapon = 0.25;
      }
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].damageReductions.push(base);
    }
  }

  getItemModifierSwordsaint(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.qualities.swordSaintCompatibility) {
        // Upgrade weapon
        let base = this._getBaseFormat();
        base.type = game.symbaroum.config.DAM_DICEUPGRADE;
        base.diceUpgrade = lvl.level == 3 ? 4 : 2;
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
    }
  }

  getItemModifierSymbolism(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    // A16: per APG, symbolists pay at most one point of temporary corruption for
    // powers of their tradition on every tradition level (novice, adept and master)
    /* Hymnen-Paket 1.1 (Rudolfs Regel „Traditionswissen auswerten, gilt
       für alle Items“): das Gate läuft über das Traditionswissen-Feld
       DES KRAFT-ITEMS (Traditionen-Tab), nicht mehr über die hartcodierte
       Traditionsliste des Setups. Ohne gesetztes Feld keine Reduktion. */
    for (let i = 0; i < abilities.length; i++) {
      /* Hymnen-Paket 1.2 (Rudolfs Anmerkung zu Testpunkt 5): Stufen-
         abgleich wie bei Trollsingen - Reduktion nur, wenn die Wirk-
         stufe der Kraft die Traditionsstufe nicht übersteigt. */
      if (combatMods.abilities[abilities[i].id].type === "mysticalPower" && itemHasTraditionKnowledge(abilities[i], game.symbaroum.config.TRAD_SYMBOLISM) && (combatMods.abilities[abilities[i].id].powerLvl?.level ?? 1) <= lvl.level) {
        combatMods.abilities[abilities[i].id].corruption = game.symbaroum.config.TEMPCORRUPTION_ONE;
      }
    }
    let base = this._getBaseFormat();
    base.value = game.symbaroum.config.TRAD_SYMBOLISM;
    base.level = lvl.level;
    this.system.isIntegrated = true;
    combatMods.traditions.push(base);
  }

  getItemModifierTactician(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    let base = this._getBaseFormat();
    base.attribute = "cunning";
    base.type = game.symbaroum.config.TYPE_INITIATIVE;
    combatMods.initiative.push(base);
    if (lvl.level > 1) {
      for (let i = 0; i < armors.length; i++) {
        // Do we apply it if they just wear stackable armor?
        if (armors[i].system.isStackableArmor) {
          continue;
        }
        base = this._getBaseFormat();
        base.attribute = "cunning";
        base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
        this.system.isIntegrated = true;
        combatMods.armors[armors[i].id].attributes.push(base);
      }
    }
    if (lvl.level > 2) {
      for (let i = 0; i < weapons.length; i++) {
        // Can use cunning for attacks for any attack, except heavy - as example an undead, this includes alternate damage
        if (weapons[i].system.reference == "heavy") {
          continue;
        }
        base = this._getBaseFormat();
        base.attribute = "cunning";
        base.type = game.symbaroum.config.TYPE_ATTRIBUTE;
        this.system.isIntegrated = true;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
    }
  }

  getItemModifierTheurgy(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    if (lvl.level > 1) {
      /* Hymnen-Paket 1.1: Traditionswissen-Gate (siehe getItemModifierSymbolism) */
      /* Hymnen-Paket 1.2 (Rudolfs Anmerkung zu Testpunkt 5): Stufen-
         abgleich wie bei Trollsingen - die Reduktion greift nur, wenn
         die Wirkstufe der Kraft die Traditionsstufe nicht übersteigt. */
      for (let i = 0; i < abilities.length; i++) {
        if (combatMods.abilities[abilities[i].id].type === "mysticalPower" && itemHasTraditionKnowledge(abilities[i], game.symbaroum.config.TRAD_THEURGY) && (combatMods.abilities[abilities[i].id].powerLvl?.level ?? 1) <= lvl.level) {
          combatMods.abilities[abilities[i].id].corruption = game.symbaroum.config.TEMPCORRUPTION_ONE;
          if (lvl.level > 2) {
            combatMods.abilities[abilities[i].id].healingBonus += "+1d4[" + this.name + "]";
            let pack = this._getPackageFormat();
            let base = this._getBaseFormat();
            base.type = game.symbaroum.config.DAM_MOD;
            base.value = "+1d4";
            base.alternatives = [
              {
                damageMod: "+1d4",
                damageModNPC: 2,
              },
            ];
            pack.member.push(base);
            this.system.isIntegrated = true;
            combatMods.abilities[abilities[i].id].package.push(pack);
          }
        }
      }
    }
    let base = this._getBaseFormat();
    base.value = game.symbaroum.config.TRAD_THEURGY;
    base.level = lvl.level;
    this.system.isIntegrated = true;
    combatMods.traditions.push(base);
  }

  getItemModifierTrollsinging(combatMods, armors, weapons, abilities) {
    /* Hymnen-Paket v1 (Rudolfs Kalibrierung 16.11.2026): Trollgesang-Kräfte
       kosten nur 1 Punkt temporäre Korruption statt 1W4, wenn die Fähigkeit
       Trollsingen mindestens auf der Stufe steht, auf der die jeweilige Kraft
       gewirkt wird (A16-Symbolisten-Muster auf Trollsingen übertragen).
       Paket 1.1 (Rudolfs Testrunde 17.11., seine Regel „Gilt für alle
       Items“): das Traditions-Gate läuft über das Traditionswissen-Feld
       DES KRAFT-ITEMS (Traditionen-Tab), nicht mehr über die hartcodierte
       Setups-Liste - Tanzende Waffe lernt er also via Trollgesang ODER
       Stabmagie, die Reduktion greift nur bei zugeordnetem Trollgesang. */
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < abilities.length; i++) {
      const entry = combatMods.abilities[abilities[i].id];
      if (entry?.type === "mysticalPower" && itemHasTraditionKnowledge(abilities[i], game.symbaroum.config.TRAD_TROLLS) && (entry?.powerLvl?.level ?? 1) <= lvl.level) {
        combatMods.abilities[abilities[i].id].corruption = game.symbaroum.config.TEMPCORRUPTION_ONE;
      }
    }
    let base = this._getBaseFormat();
    base.value = game.symbaroum.config.TRAD_TROLLS;
    base.level = lvl.level;
    this.system.isIntegrated = true;
    combatMods.traditions.push(base);
  }

  getItemModifierThoroughlycorrupt(combatMods, armors, weapons, abilities) {
    let base = this._getBaseFormat();
    base.type = game.symbaroum.config.NO_TRESHOLD;
    this.system.isIntegrated = true;
    combatMods.corruption.push(base);
  }

  getItemModifierTwinattack(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    for (let i = 0; i < weapons.length; i++) {
      if (!weapons[i].system.isMelee || !["1handed", "short"].includes(weapons[i].system.reference)) {
        continue;
      }
      let twoWeapon = this.actor.items.filter((element) => ["1handed", "short"].includes(element.system?.reference) && element.system.isActive);
      if (twoWeapon.length < 2) {
        return;
      }

      let base = this._getBaseFormat();
      base.modifier = 1;
      base.type = game.symbaroum.config.TYPE_ATTACKINCREASE;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
      if (this.actor.type === "monster") combatMods.weapons[weapons[i].id].maxAttackNb += 1;

      if (lvl.level < 3 || this.actor.type === "player" || !game.settings.get("symbaroum", "showNpcAttacks")) {
        // Continue - do not want to indent further
        continue;
      }

      /* Calculations only for NPCs - can't easily be judged otherwise */
      // Master ability
      // Look at all active weapons of 1handed or short
      // If the current weapon is the first 1d6 or 1d8 base damage one - upgrade
      // If the current weapon is the first (or potentially second) 1d6 base damage one - upgrade
      let foundd8 = 0;
      let foundd6 = 0;
      let spared6weap = null;
      for (let j = 0; j < twoWeapon.length; j++) {
        if (twoWeapon[j].system.reference === "short") {
          foundd6++;
          if (foundd6 === 1 && twoWeapon[j].id == weapons[i].id) {
            base = this._getBaseFormat();
            base.type = game.symbaroum.config.DAM_DICEUPGRADE;
            base.diceUpgrade = 2;
            combatMods.weapons[weapons[i].id].package[0].member.push(base);
            // First short, upgrade
          } else if (foundd6 === 2 && spared6weap === null && twoWeapon[j].id === weapons[i].id) {
            // Store away this and if there is no d8 found once we are done, upgrade d8
            spared6weap = twoWeapon[j];
          }
        } else if (twoWeapon[j].system.reference === "1handed") {
          foundd8++;
          if (foundd8 === 1 && twoWeapon[j].id == weapons[i].id) {
            base = this._getBaseFormat();
            base.type = game.symbaroum.config.DAM_DICEUPGRADE;
            base.diceUpgrade = 2;
            combatMods.weapons[weapons[i].id].package[0].member.push(base);
          }
        }
      }
      if (foundd8 === 0 && spared6weap != null) {
        // Only wielding d6 weapons and this is the last d6 weapon, so upgrade it too
        base.type = game.symbaroum.config.DAM_DICEUPGRADE;
        base.diceUpgrade = 2;
        combatMods.weapons[weapons[i].id].package[0].member.push(base);
      }
    }
  }

  getItemModifierTwohandedforce(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;

    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.reference != "heavy") {
        continue;
      }
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.DAM_DICEUPGRADE;
      base.diceUpgrade = 2;
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package[0].member.push(base);
    }
  }

  getItemModifierUndead(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level < 1) return;
    for (let i = 0; i < armors.length; i++) {
      // Do we apply it if they just wear stackable armor?
      if (armors[i].system.isStackableArmor) {
        continue;
      }
      let base = this._getBaseFormat();
      base.poison = 0;
      base.bleeding = 0;
      if (lvl.level > 1) {
        base.normal = 0.5;
        base.elemental = 0.5;
        base.mysticArm = 0.5;
      }
      if (lvl.level > 2) {
        base.mysticIgnArm = 0.5;
      }
      this.system.isIntegrated = true;
      combatMods.armors[armors[i].id].damageReductions.push(base);
    }
  }

  getItemModifierWitchcraft(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    if (lvl.level > 1) {
      /* Hymnen-Paket 1.5 (Rudolfs Testrunde v1.4, P8 - Root-Cause):
         Der Hexerei-Reduzierer pruefte die HARTCODIERTE Setup-Liste
         (traditions.includes(TRAD_WITCHCRAFT)) statt des Traditions-
         wissen-Felds des Kraft-Items - als EINZIGEM Traditions-
         Reduzierer war er bei der 1.1/1.2-Umstellung ("Gilt fuer alle
         Items") uebersprungen worden: Jeder Hexerei-Adept+ bekam die
         Reduktion auf 1 temporäre Korruption fuer ALLE Hexerei-
         gescripteten Kraefte, egal was im Kraft-Item stand (Rudolfs
         Befund: "falsche Tradition eingestellt, trotzdem 1 statt
         1W4"). Jetzt wie alle uebrigen Reduzierer (Muster getItem-
         ModifierWizardry): Traditionswissen-Gate (Feld "Traditions-
         wissen?"=Ja UND Hexerei im Traditionen-Tab des Kraft-Items)
         plus Stufenabgleich (Rudolfs 1.5-Entscheidung "Mit Stufen-
         abgleich wie die anderen") - die Reduktion greift nur, wenn
         die Wirkstufe der Kraft die Hexerei-Stufe nicht uebersteigt. */
      for (let i = 0; i < abilities.length; i++) {
        if (combatMods.abilities[abilities[i].id].type === "mysticalPower" && itemHasTraditionKnowledge(abilities[i], game.symbaroum.config.TRAD_WITCHCRAFT) && (combatMods.abilities[abilities[i].id].powerLvl?.level ?? 1) <= lvl.level) {
          combatMods.abilities[abilities[i].id].corruption = game.symbaroum.config.TEMPCORRUPTION_ONE;
        }
      }
    }
    let base = this._getBaseFormat();
    base.value = game.symbaroum.config.TRAD_WITCHCRAFT;
    base.level = lvl.level;
    this.system.isIntegrated = true;
    combatMods.traditions.push(base);
  }

  getItemModifierWitchhammer(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level < 1 || (!this.actor.hasCondition("witchhammer") && !this.actor.getFlag(game.system.id, "witchhammer"))) {
      return;
    }
    for (let i = 0; i < weapons.length; i++) {
      if (weapons[i].system.alternativeDamage !== "none" || !weapons[i].system.isMelee) {
        continue;
      }
      let pack = this._getPackageFormat();
      pack.label = game.i18n.localize("POWER_LABEL.WITCH_HAMMER");
      pack.type = game.symbaroum.config.PACK_RADIO;
      let base = this._getBaseFormat();
      base.type = game.symbaroum.config.DAM_RADIO;
      if (this.actor.type === "player") {
        pack.defaultSelect = "+1d4";
      } else {
        pack.defaultSelect = "2";
      }
      base.alternatives = [
        {
          label: game.i18n.localize("POWER_LABEL.WITCH_HAMMER"),
          damageMod: "+1d4",
          damageModNPC: 2,
          restrictions: [game.symbaroum.config.DAM_ACTIVE],
        },
        {
          label: game.i18n.localize("POWER_LABEL.WITCH_HAMMER"),
          damageMod: "+1d" + (4 + lvl.level * 2).toString(),
          damageModNPC: 2 + lvl.level,
          restrictions: [game.symbaroum.config.DAM_NOTACTIVE],
        },
      ];
      pack.member.push(base);
      this.system.isIntegrated = true;
      combatMods.weapons[weapons[i].id].package.push(pack);
    }
  }

  getItemModifierWizardry(combatMods, armors, weapons, abilities) {
    let lvl = this.getLevel();
    if (lvl.level == 0) return;
    if (lvl.level > 1) {
      /* Hymnen-Paket 1.1: Traditionswissen-Gate (siehe getItemModifierSymbolism) */
      /* Hymnen-Paket 1.2 (Rudolfs Anmerkung zu Testpunkt 5): Stufen-
         abgleich wie bei Trollsingen - die Reduktion greift nur, wenn
         die Wirkstufe der Kraft die Traditionsstufe nicht übersteigt. */
      for (let i = 0; i < abilities.length; i++) {
        if (combatMods.abilities[abilities[i].id].type === "mysticalPower" && itemHasTraditionKnowledge(abilities[i], game.symbaroum.config.TRAD_WIZARDRY) && (combatMods.abilities[abilities[i].id].powerLvl?.level ?? 1) <= lvl.level) {
          combatMods.abilities[abilities[i].id].corruption = game.symbaroum.config.TEMPCORRUPTION_ONE;
          if (lvl.level > 2) {
            let pack = this._getPackageFormat();
            let base = this._getBaseFormat();
            base.type = game.symbaroum.config.TYPE_FAVOUR;
            base.value = game.i18n.localize("DIALOG.FAVOUR_FAVOUR");
            base.favourMod = 1;
            pack.member.push(base);
            this.system.isIntegrated = true;
            combatMods.abilities[abilities[i].id].package.push(pack);
          }
        }
      }
    }
    let base = this._getBaseFormat();
    base.value = game.symbaroum.config.TRAD_WIZARDRY;
    base.level = lvl.level;
    this.system.isIntegrated = true;
    combatMods.traditions.push(base);
  }

  //MysticPowers
  mysticPowerSetupAnathema(base) {
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY, game.symbaroum.config.TRAD_THEURGY, game.symbaroum.config.TRAD_STAFFM];
    base.getTarget = true;
    base.targetMandatory = true;
    base.targetResistAttribute = "resolute";
    base.introText = game.i18n.localize("POWER_ANATHEMA.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_ANATHEMA.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_ANATHEMA.CHAT_FAILURE");
    base.maintain = game.symbaroum.config.MAINTAIN_NOT;
    base.casting = game.symbaroum.config.CASTING_RES;

    if (base.powerLvl.level > 1) base.chain = game.symbaroum.config.CHAIN;
    return base;
  }

  mysticPowerSetupBanishingseal(base) {
    /* v2.8.1 G7 (Rudolfs Option B): KEIN Zielzwang - das Bannsiegel
       ist eine frei platzierbare Zone (Picker im Zauberlauf), die
       Kategorie waehlt der preDialog, der Erstgesang filtert die
       Feinde der Region gegen sie. */
    base.getTarget = false;
    base.targetMandatory = false;
    base.traditions = [game.symbaroum.config.TRAD_SYMBOLISM];
    base.targetResistAttribute = "resolute";
    base.casting = game.symbaroum.config.CASTING_RES;
    base.maintain = game.symbaroum.config.MAINTAIN_NOT;
    base.multipleTargets = true;
    base.multipleTargetsNb = 10;
    base.preDialogFunction = preDialogBanishingSeal;
    base.addTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "banishingseal"))];
    base.introText = game.i18n.localize("POWER_BANISHINGSEAL.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_BANISHINGSEAL.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_BANISHINGSEAL.CHAT_FAILURE");
    if (base.powerLvl.level === 2) {
      base.finalTextSucceed = game.i18n.localize("POWER_BANISHINGSEAL.CHAT_ADEPT");
    } else if (base.powerLvl.level === 3) {
      base.finalTextSucceed = game.i18n.localize("POWER_BANISHINGSEAL.CHAT_MASTER");
    }
    return base;
  }

  mysticPowerSetupBrimstonecascade(base) {
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY];
    base.hasDamage = true;
    base.damageDice = "1d12";
    base.avoidDamageDice = "1d6";
    base.damageType = {
      mysticArm: true,
      // P4 Feuer-Paket (S2.1): Feuerschaden - loest den Feuergeschmiedet-
      // Schutz des Ziels in mathDamageProt aus
      fire: true,
    };
    base.getTarget = true;
    base.targetMandatory = true;
    base.targetResistAttribute = "quick";
    base.targetImpeding = true;
    base.introText = game.i18n.localize("POWER_BRIMSTONECASC.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_BRIMSTONECASC.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_BRIMSTONECASC.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_BRIMSTONECASC.CHAT_FAILURE");
    base.casting = game.symbaroum.config.CASTING_RES;
    if (base.powerLvl.level > 1) base.chain = game.symbaroum.config.CHAIN;
    base.rollFailedFSmod = {
      damageDice: "1d6",
      avoidDamageDice: "0d0",
    };
    return base;
  }

  mysticPowerSetupBattlesymbol(base) {
    /* v2.8.1 G7 (Rudolfs Option B): KEIN Zielzwang - Picker-Platzierung
       im Zauberlauf, Erstgesang je Feind der Region (Glyphe-Modell). */
    base.getTarget = false;
    base.targetMandatory = false;
    base.traditions = [game.symbaroum.config.TRAD_SYMBOLISM];
    base.targetResistAttribute = "resolute";
    base.casting = game.symbaroum.config.CASTING_RES;
    base.introText = game.i18n.localize("POWER_BATTLESYMBOL.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_BATTLESYMBOL.CHAT_INTRO_M");
    base.resultTextSuccess = game.i18n.localize("POWER_BATTLESYMBOL.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_BATTLESYMBOL.CHAT_FAILURE");
    if (base.powerLvl.level === 1) {
      // A25 stage 4: novice - one round of berserk rage; A34: the "one round"
      // is the victim's current turn - the berserker symbol now expires
      // automatically at the END of that turn (turn-end engine), the GM no
      // longer removes it by hand
      base.addTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "berserker"))];
      base.targetEffectTurnEnd = true;
      base.finalTextSucceed = game.i18n.localize("POWER_BATTLESYMBOL.CHAT_NOVICE");
    } else {
      // adept/master: the rage holds while the symbol is maintained; the
      // mystic's Resolute test (minus the damage of the triggering hit,
      // entered as a dialog modifier) keeps it up (APG, Rudolf 22.10.)
      base.maintain = game.symbaroum.config.MAINTAIN_RES;
      base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "berserker"))];
      base.finalTextSucceed = game.i18n.localize("POWER_BATTLESYMBOL.CHAT_ADEPT");
    }
    if (base.powerLvl.level === 3) {
      base.finalTextSucceed = game.i18n.localize("POWER_BATTLESYMBOL.CHAT_MASTER");
    }
    // v2.8 G7 (Rudolfs finale Konzeptrunde 21.11.): Kampfsymbol legt
    // eine DAUERHAFTE Symbolzone an - erneute Anwahl bei laufender
    // Zone oeffnet den Abbruch-Dialog (preDialogSymbolZoneChoice).
    base.preDialogFunction = preDialogSymbolZoneChoice;
    return base;
  }

  mysticPowerSetupBendwill(base) {
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY, game.symbaroum.config.TRAD_WITCHCRAFT];
    base.targetResistAttribute = "resolute";
    base.getTarget = true;
    base.targetMandatory = true;
    base.casting = game.symbaroum.config.CASTING_RES;
    base.maintain = game.symbaroum.config.MAINTAIN_RES;
    base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bendwill"))];
    base.introText = game.i18n.localize("POWER_BENDWILL.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_BENDWILL.CHAT_INTRO_M");
    base.resultTextSuccess = game.i18n.localize("POWER_BENDWILL.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_BENDWILL.CHAT_FAILURE");
    base.finalText = "";
    return base;
  }

  mysticPowerSetupBlackbolt(base) {
    base.traditions = [game.symbaroum.config.TRAD_SORCERY];
    base.targetResistAttribute = "quick";
    base.hasDamage = true;
    base.getTarget = true;
    base.targetMandatory = true;
    base.targetImpeding = true;
    base.introText = game.i18n.localize("POWER_BLACKBOLT.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_BLACKBOLT.CHAT_INTRO");
    base.resultTextSuccessT = game.i18n.localize("POWER_BLACKBOLT.CHAT_SUCCESS");
    base.resultTextFailT = game.i18n.localize("POWER_BLACKBOLT.CHAT_FAILURE");
    base.damageDice = "1d6";
    base.damageType = {
      mystic: true,
    };
    base.addTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "paralysis"))];
    base.ignoreArm = true;
    // A23-F2: the 1d6 damage belongs to the initial impact only (APG) - no
    // damage re-roll on maintain rounds
    base.maintainDamage = false;
    base.maintain = game.symbaroum.config.MAINTAIN_RES;
    base.casting = game.symbaroum.config.CASTING_RES;

    if (base.powerLvl.level > 1) base.chain = game.symbaroum.config.CHAIN;
    return base;
  }

  mysticPowerSetupBlackbreath(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.traditions = [game.symbaroum.config.TRAD_SORCERY];
    /* A25 stage 4 (APG) + Hymnen-Paket 1.2 (Rudolfs Testrunde v1.1,
       Antwort 2): Schwarzer Atem würfelt jetzt eine ECHTE Eigen-
       schaftsprobe (Standard-Würfeldialog, 1.3: FESTE Eigenschaft
       Willenskraft statt des 1.2-Attribut-Dropdowns, Rudolfs Testrunde
       v1.2 P6b) -
       die d4/d6-Wirkung gegen die GESAMTE Korruption des Ziels läuft
       unverändert in standardPowerResult (functionStuff.blackbreath,
       nur bei Probeerfolg), die Meister-Kette läuft weiter, solange
       das vorige Ziel Korruption ERLITTEN hat (blackbreathChainResult
       - der Primärziel-Aufruf war beim AoE-v2.4-Refactor verloren
       gegangen und ist in 1.2 wiederhergestellt). */
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "resolute";
    base.maintain = game.symbaroum.config.MAINTAIN_NOT;
    base.blackbreath = true;
    base.introText = game.i18n.localize("POWER_BLACKBREATH.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_BLACKBREATH.CHAT_SUCCESS");
    return base;
  }

  mysticPowerSetupBlessedshield(base) {
    base.casting = game.symbaroum.config.CASTING;
    base.traditions = [game.symbaroum.config.TRAD_THEURGY];
    base.addCasterEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "holyShield"))];
    base.introText = game.i18n.localize("POWER_BLESSEDSHIELD.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_BLESSEDSHIELD.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_BLESSEDSHIELD.CHAT_FAILURE");
    if (base.powerLvl.level > 1) {
      base.multipleTargets = true;
      base.multipleTargetsNb = base.powerLvl.level - 1;
    }
    return base;
  }

  mysticPowerSetupBlindingsymbol(base) {
    /* v2.8.1 G7 (Rudolfs Option B): KEIN Zielzwang - Picker-Platzierung
       im Zauberlauf, Erstgesang je Feind der Region (Glyphe-Modell). */
    base.getTarget = false;
    base.targetMandatory = false;
    base.traditions = [game.symbaroum.config.TRAD_SYMBOLISM];
    base.casting = game.symbaroum.config.CASTING_RES;
    base.targetResistAttribute = "resolute";
    base.maintain = base.powerLvl.level === 2 ? game.symbaroum.config.MAINTAIN_RES : game.symbaroum.config.MAINTAIN_NOT;
    base.introTextMaintain = game.i18n.localize("POWER_BLINDINGSYMBOL.CHAT_INTRO_M");
    base.resultTextSuccess = game.i18n.localize("POWER_BLINDINGSYMBOL.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_BLINDINGSYMBOL.CHAT_FAILURE");
    /* v2.8 (RAW-Bewertung 13.11., Vault-APG-Text): der NOVIZE blendet nur
       EINE RUNDE ("bevor sie automatisch wieder sehen können") - das
       blind-Symbol läuft jetzt über die A34-Zugende-Engine wie beim
       Kampfsymbol-Novizen (targetEffectTurnEnd, Wirkungsdauer = bis zum
       Ende des eigenen Zugs, kein Maintain, keine A29-Erinnerung). Der
       Adept hält mit [Wille-Schaden] gegen, der Meister blendet bis
       Heilung - beide behalten das aktiv aufrechterhaltene Symbol
       (P26-fix2: nur der Adept trägt den Maintain-Marker). */
    if (base.powerLvl.level === 1) {
      base.addTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "blind"))];
      base.targetEffectTurnEnd = true;
      base.finalTextSucceed = game.i18n.localize("POWER_BLINDINGSYMBOL.CHAT_NOVICE");
    } else {
      base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "blind"))];
      if (base.powerLvl.level === 3) {
        base.finalTextSucceed = game.i18n.localize("POWER_BLINDINGSYMBOL.UNTIL_HEALED");
      }
    }
    // A25 stage 2: the runes trigger a chain of blindings on EVERY level (the
    // APG novice text already describes the chain). Deliberately NO chain flag:
    // the flag's only runtime effect is showing the casting/maintain dropdown,
    // and novice/master have no maintain per APG - the chain itself is purely
    // dispatched in getPowerResultFunction; the adept already has MAINTAIN_RES
    // v2.8 G7 (Rudolfs finale Konzeptrunde 21.11.): Blendendes Symbol
    // legt eine DAUERHAFTE Symbolzone an - erneute Anwahl bei laufen-
    // der Zone oeffnet den Abbruch-Dialog (preDialogSymbolZoneChoice).
    base.preDialogFunction = preDialogSymbolZoneChoice;
    return base;
  }

  mysticPowerSetupCombathymn(base) {
    /* Hymnen-Paket v1 (Rudolfs Startsignal „Leg los“ 16.11.2026, RAW:
    Kampfhymne, Tradition Trollgesang): Aktion Frei, KEINE Zauberprobe
    (CASTING_NOT) - der Gesang läuft als Maintain OHNE Probe (1.4,
    APG-Abgleich: Abbruch nur durch eine andere mystische Kraft oder
    Willenskraft-Schaden; A29-Erinnerung über die maintained-Marker auf
    den Verbündeten-Symbolen, ihre „Ja"-Runde läuft wurflos und still).
    Novize wählt EIN Attribut für alle
    Betroffenen (Rudolfs Vereinfachung, preDialogHymnChoice), Adept und
    Meister buffen alle drei Attribute (quick/strong/accurate); der
    Meister gibt zusätzlich 1× pro Szene bei Liedbeginn jedem Betroffe-
    nen 1W6 Zähigkeit zurück (je Betroffenem ein eigener Wurf, Flag
    hymnMasterScene + SL-Reset-Karte). Kosten: Standard 1W4 temporäre
    Korruption, mit der Fähigkeit Trollsingen auf der entsprechenden
    Stufe nur 1 Punkt (getItemModifierTrollsinging). */
    base.traditions = [game.symbaroum.config.TRAD_TROLLS];
    base.casting = game.symbaroum.config.CASTING_NOT;
    base.maintain = game.symbaroum.config.MAINTAIN;
    base.needToken = true;
    base.hymnAttributes = ["quick", "strong", "accurate"];
    base.hymnMasterHeal = true;
    base.introText = game.i18n.localize("POWER_COMBAT_HYMN.CHAT_INTRO");
    /* 1.4: introTextMaintain entfällt - Hymnen-Maintain-Runden wuerfeln
       nicht mehr, die Karte wird nie erreicht (Schluessel entfernt). */
    base.resultTextSuccess = game.i18n.localize("POWER_COMBAT_HYMN.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_COMBAT_HYMN.CHAT_FAILURE");
    base.preDialogFunction = preDialogHymnChoice;
    return base;
  }

  mysticPowerSetupConfusion(base) {
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY, game.symbaroum.config.TRAD_TROLLS];
    base.targetResistAttribute = "resolute";
    base.getTarget = true;
    base.targetMandatory = true;
    base.maintain = game.symbaroum.config.MAINTAIN_RES;
    base.casting = game.symbaroum.config.CASTING_RES;
    base.confusion = true;
    base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "confusion"))];
    // A25: Master level extends the confusion to a chain of targets (GRW);
    // the per-round 1d6 effect table stays in standardPowerResult
    if (base.powerLvl.level > 2) base.chain = game.symbaroum.config.CHAIN;
    return base;
  }

  mysticPowerSetupCurse(base) {
    base.casting = game.symbaroum.config.CASTING_NOT;
    base.getTarget = true;
    base.targetMandatory = true;
    base.traditions = [game.symbaroum.config.TRAD_WITCHCRAFT];
    base.resultText = game.i18n.localize("POWER_CURSE.CHAT_SUCCESS_N");
    if (base.powerLvl.level == 2) {
      base.resultText = game.i18n.localize("POWER_CURSE.CHAT_SUCCESS_A");
    } else if (base.powerLvl.level == 3) {
      base.resultText = game.i18n.localize("POWER_CURSE.CHAT_SUCCESS_M");
    }
    base.maintain = game.symbaroum.config.MAINTAIN;
    base.introText = game.i18n.localize("POWER_CURSE.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_CURSE.CHAT_INTRO_M");
    base.resultTextSuccess = base.resultText;
    base.resultTextFail = game.i18n.localize("POWER_CURSE.CHAT_FAILURE");
    base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "curse"))];
    base.rollFailedFSmod = {
      finalText: game.i18n.localize("POWER_CURSE.CHAT_FAIL_FINAL"),
    };
    return base;
  }

  mysticPowerSetupThorncloak(base) {
    /* Hymnen-Paket 1.5 (Rudolfs Startsignal 17.11.2026): Dornenmantel
       (APG, Tradition Hexenwissen/Gruenweber, Vault-Karte). Aktion
       Aktiv, KEINE Probe (CASTING_NOT, Berserker-Muster), KEIN
       Maintain-Wurf - die Kraft ist ein Toggle an/aus (flagTest,
       Tanzende-Waffe-Muster), Korruption 1W4 nur auf die Aktivierung
       (Deaktivierung frei, flagPresentFSmod TEMPCORRUPTION_NONE).
       Wirkung als Ruestungs-Item (Bonusgeschuetz-Precedenz create-
       BlessedShield): +1W4 auf Ruestung, +1W6 solange der Mystiker
       sich seit dem letzten eigenen Zug nicht bewegt hat (Bewegungs-
       Hook hooks.js + je-Runde-Abgleich im A29-Rescan, Rudolfs
       Entscheidungen "automatisches Flag" und "je Runde pruefen");
       Adept+ schuetzt zusaetzlich alle Verbuendeten IN der Dornen-
       mantel-Flaeche (v1.2 F7/v1.3 F12: angehaengte Core-Region, Kreis-Radius aus
       dem Zonen-Tab, Default 2 Zellen, move-geschnitten; Notfall-
       Naehe szenen-unabhaengig als Fallback ohne Flaeche) -
       der A29-Turnus (Rudolfs Vorschlag) prueft die je-Runde-Naehe
       im Rescan; Meister-Rueckschlag 1W10 (Ruestung ignoriert)
       laeuft automatisch als Reaktions-Karte in attackResult (Rudolfs
       Entscheidung "Ja, automatisch"). Die VerbUndeten-Marker tragen
       maintained + Autor-Marker (A29-Erinnerung feuert am eigenen
       Zug, "Ja" = Rescan, "Nein" = Ende). v1.6 (Rudolfs Test-
       runde v1.5, Punkte 5a/5c, Entscheidung "Maintain-Modell mit
       A29-Turnus", 17.11.2026): Das CASTER-Symbol traegt den
       Maintain-Marker jetzt ebenfalls (thornCloakResult patcht
       flagData maintained/caster/ability) - die A29-Erinnerung
       feuert auch beim Solo-Novizen ohne Verbuendete, ein
       Maintain-WURF bleibt keiner. */
    base.traditions = [game.symbaroum.config.TRAD_WITCHCRAFT];
    base.casting = game.symbaroum.config.CASTING_NOT;
    base.maintain = game.symbaroum.config.MAINTAIN;
    base.needToken = true;
    base.flagTest = "thorncloak";
    base.preDialogFunction = preDialogThornCloakChoice;
    base.flagPresentFSmod = {
      introText: game.i18n.localize("POWER_THORN_CLOAK.CHAT_DEACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_THORN_CLOAK.CHAT_RESULT_DEACTIVATE"),
      corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
      removeCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "thorncloak"))],
    };
    base.flagNotPresentFSmod = {
      /* flagData.thorncloakArmor ist der Ruestungs-Schluessel: Der
         preDeleteActiveEffect-Hook (hooks.js) loescht mit dem Symbol
         das Ruestungs-Item; maintained/level reiten als Autor- und
         Adept-Gate mit (Novize ohne Marker wird im Konzentration-
         Pfad ueber die Condition erkannt). */
      flagData: { thorncloakArmor: true, level: base.powerLvl.level },
      introText: game.i18n.localize("POWER_THORN_CLOAK.CHAT_ACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_THORN_CLOAK.CHAT_RESULT_ACTIVATE"),
      addCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "thorncloak"))],
    };
    return base;
  }

  mysticPowerSetupWeakeninghymn(base) {
    /* Hymnen-Paket 1.5 (Rudolfs Startsignal 17.11.2026): Schwaechende
       Hymne (APG, Tradition Trollsingen, Vault-Karte). Aktion Frei,
       muss laut gesungen werden. Erstgesang: opponierte Probe
       Ausstrahlung<-Willenskraft JE Feind in der Gesangsflaeche
       (Novize nur verwundete Feinde, Adept+ alle; je Feind ein
       eigener Wurf, Maintain-Chain-Muster baseRoll), danach wirkt
       sie "solange der Gesang weitergeht" (v1.3 F14, Rudolfs Freigabe
       20.11.: A29-"Ja"-Runde laeuft jetzt der hymnZoneRescan - die
       Hymne haelt die Dauerzone AUCH leer, Nachzuegler ziehen je
       Feind mit opponierter Erstgesangs-Probe nach, Hinausgegangene
       verlieren den Missgunst-Marker). Betraf-
       fene Feinde tragen den Missgunst-Marker (weakeninghymn-Symbol,
       favourMod -1-Vorbelegung in BEIDEN Wurfdialogen - Rudolfs
       Systemabbildung fuer "eine zweite Chance, alle Erfolgsproben
       nicht zu bestehen", dokumentierte Abbildungsentscheidung).
       Meister-1W4 ("wegen der Hymne nicht bestanden") bleibt SL-
       Sache (dokumentierte Grenze, Hinweiszeile). Abbruch: andere
       mystische Kraft (buildRolls-Gate), A29-"Nein", Abbruch-
       Dialog, Konzentration (1.5). Korruption 1W4 auf den Einsatz
       (Trollsingen-Reduzierer greift, Traditions-Gate seit 1.2). */
    base.traditions = [game.symbaroum.config.TRAD_TROLLS];
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "persuasive";
    base.targetResistAttribute = "resolute";
    base.getTarget = true;
    base.maintain = game.symbaroum.config.MAINTAIN;
    base.needToken = true;
    base.introText = game.i18n.localize("POWER_WEAKENING_HYMN.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_WEAKENING_HYMN.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_WEAKENING_HYMN.CHAT_FAILURE");
    base.preDialogFunction = preDialogWeakeningHymnChoice;
    return base;
  }

  mysticPowerSetupDancingweapon(base) {
    /* Hymnen-Paket 1.2 (Rudolfs Testrunde v1.1, P4 + Antwort 1): echte
       Eigenschaftsprobe im Standard-Würfeldialog statt der wurflosen
       Bestätigung - Aktivierung nur bei Probeerfolg, Korruption bucht
       die Ergebnis-Karte AUCH bei Fehlschlag (Standard-Pfad, ergeb-
       nisunabhängig). Deaktivierung: Ja/Nein-Dialog in actor.js
       usePower (kein Wurf, keine Korruption).
       Hymnen-Paket 1.3 (Rudolfs Testrunde v1.2, P6b + Entscheidung
       "Fest Willenskraft, kein Dropdown"): Die Probe läuft FEST auf
       Willenskraft (resolute) - das 1.2-Attribut-Dropdown ("Mystische
       Kraft", alle Eigenschaften wählbar) ist ENTFERNT, Modifikator
       und Gunst bleiben wählbar (Modifikator-Feld + Gunst-Radio). */
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "resolute";
    base.traditions = [game.symbaroum.config.TRAD_TROLLS, game.symbaroum.config.TRAD_STAFFM];
    base.corruption = false;
    base.gmOnlyChatResultNPC = true;
    base.flagTest = "dancingweapon";
    base.flagPresentFSmod = {
      introText: game.i18n.localize("POWER_DANCINGWEAPON.CHAT_DEACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_DANCINGWEAPON.CHAT_RESULT_DEACTIVATE"),
      corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
      removeCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "dancingweapon"))],
    };
    base.flagNotPresentFSmod = {
      flagData: base.powerLvl.level,
      introText: game.i18n.localize("POWER_DANCINGWEAPON.CHAT_ACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_DANCINGWEAPON.CHAT_RESULT_ACTIVATE"),
      addCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "dancingweapon"))],
    };
    return base;
  }

  mysticPowerSetupDrainingglyph(base) {
    base.getTarget = true;
    /* v2.1 F23 (Rudolfs Testrunde v2, G5-2-Freigabe): targetMandatory
       false - die Glyphe soll auch FREI auf leeren Boden platzierbar
       sein. Ohne Ziel laeuft der Erstzauber ohne Primaerblock
       (Korruptionsgebuehr, Platzierung, Regionen-Batch - siehe
       drainingGlyphResult). */
    base.targetMandatory = false;
    /* v2.1 F22 (Rudolfs G4/G5-Freigabe, Hymnen-Ablauf): Icon-Anwahl bei
       LAUFENDEM Glyphen-Kreis zeigt den Abbruch-Dialog, A29-"Ja" den
       Maintain-Wurf-Dialog (preDialogGlyphChoice). */
    base.preDialogFunction = preDialogGlyphChoice;
    base.traditions = [game.symbaroum.config.TRAD_SYMBOLISM];
    base.casting = game.symbaroum.config.CASTING_RES;
    base.targetResistAttribute = "strong";
    base.maintain = game.symbaroum.config.MAINTAIN_RES;
    base.hasDamage = true;
    base.damageDice = "1d4";
    base.damageType = {
      mysticIgnArm: true,
    };
    base.ignoreArm = true;
    base.introText = game.i18n.localize("POWER_DRAININGGLYPH.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_DRAININGGLYPH.CHAT_INTRO_M");
    base.resultTextSuccess = game.i18n.localize("POWER_DRAININGGLYPH.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_DRAININGGLYPH.CHAT_FAILURE");
    base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "drainingglyph"))];
    // A25 F11 (Rudolf's ruling, 23.10.): the glyph deals its 1d4 round damage
    // on the maintain summary card for EVERY still-held target starting at
    // Novice level (the rule text is ambiguous - this is the interpretation
    // played at this table), via the F8 chainRoundDamage mechanism
    base.chainRoundDamage = true;
    if (base.powerLvl.level === 3) {
      base.finalTextSucceed = game.i18n.localize("POWER_DRAININGGLYPH.CHAT_MASTER_HEAL");
    }
    return base;
  }

  mysticPowerSetupEarthbinding(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.traditions = [game.symbaroum.config.TRAD_WITCHCRAFT];
    base.maintain = game.symbaroum.config.MAINTAIN_RES;
    // A25 stage 4 (GRW): free action, once per round; the setup mirrors
    // the ORIGINAL Entangling Vines model exactly (F7): Novice and Adept
    // bind with an unopposed Resolute probe, Master with an opposed
    // [Resolute<-Strong] test and ground damage, the per-round escape
    // test runs through the A23 maintain chain
    base.casting = base.powerLvl.level === 3 ? game.symbaroum.config.CASTING_RES : game.symbaroum.config.CASTING;
    base.targetResistAttribute = "strong";
    base.hasDamage = base.powerLvl.level === 3;
    base.damageDice = "1d6";
    base.damageType = {
      mysticIgnArm: true,
    };
    // A25 F8: the Master-level ground damage rolls on the maintain summary
    // card for every still-held target (maintainChainResult), identical to
    // the Entangling Vines mechanism
    base.chainRoundDamage = true;
    base.introText = game.i18n.localize("POWER_EARTHBINDING.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_EARTHBINDING.CHAT_INTRO_M");
    base.resultTextSuccess = game.i18n.localize("POWER_EARTHBINDING.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_EARTHBINDING.CHAT_FAILURE");
    base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bind"))];
    base.ignoreArm = true;
    // Adept+: the binding chains from target to target (GRW); Adept
    // follow-ups probe unopposed, Master against Strong
    if (base.powerLvl.level > 1) base.chain = game.symbaroum.config.CHAIN;
    return base;
  }

  mysticPowerSetupEarthshot(base) {
    base.casting = game.symbaroum.config.CASTING_RES;
    base.getTarget = true;
    base.targetMandatory = true;
    base.targetResistAttribute = "quick";
    base.targetImpeding = true;
    // A32: no maintain (GRW) - Earth Shot is a single attack action; from
    // Adept on 1d4 rocks are thrown as separate attacks (earthshotResult)
    base.traditions = [game.symbaroum.config.TRAD_BLESSINGS];
    base.hasDamage = true;
    base.damageDice = "1d8";
    if (base.powerLvl.level > 2) {
      base.ignoreArm = true;
    }
    return base;
  }

  mysticPowerSetupEntanglingvines(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.traditions = [game.symbaroum.config.TRAD_WITCHCRAFT];
    base.maintain = game.symbaroum.config.MAINTAIN_RES;
    // A25: Novice and Adept wrap with an unopposed Resolute probe; Master
    // wraps with an opposed [Resolute<-Strong] test and thorns damage (GRW)
    base.casting = base.powerLvl.level === 3 ? game.symbaroum.config.CASTING_RES : game.symbaroum.config.CASTING;
    base.targetResistAttribute = "strong";
    base.hasDamage = base.powerLvl.level === 3;
    base.damageDice = "1d6";
    base.damageType = {
      mysticIgnArm: true,
    };
    // A25 F8: the Master-level thorns damage rolls on the maintain summary
    // card for every still-held target (maintainChainResult), identical to
    // the Earthbinding mechanism
    base.chainRoundDamage = true;
    base.introTextMaintain = game.i18n.localize("POWER_ENTANGLINGVINES.CHAT_INTRO_M");
    base.resultTextSuccess = game.i18n.localize("POWER_ENTANGLINGVINES.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_ENTANGLINGVINES.CHAT_FAILURE");
    base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "entanglingvines"))];
    base.ignoreArm = true;
    // A25: from Adept on the vines can wrap a chain of creatures (GRW);
    // Adept follow-ups probe unopposed, Master against Strong
    if (base.powerLvl.level > 1) base.chain = game.symbaroum.config.CHAIN;
    return base;
  }

  mysticPowerSetupFlamewall(base) {
    /* AoE-Rest Paket 1 (Rudolfs Startsignal „Baue es“ 18.11.2026, RAW:
    Flammenwand, Wizardry): KEINE Zauberprobe beim Erschaffen (CASTING_NOT
    - der Original-Badge war toter Code, die Zone-Aktivierung läuft jetzt
    wurflos über den buildRolls-CASTING_NOT-Zweig), Maintain-Runden ohne
    Wurf (A29 wird ohnehin nie getriggert, da keine Maintain-Symbole
    gesetzt werden). Schaden macht flamewallResult selbst (1W12 Feuer je
    Opfer, nicht das generische hasDamage-Setup), damageDice/damageType
    nur als Referenz fuer die Modifikator-Vorschau. */
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY];
    base.casting = game.symbaroum.config.CASTING_NOT;
    base.maintain = game.symbaroum.config.MAINTAIN;
    base.introText = game.i18n.localize("POWER_FLAMEWALL.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_FLAMEWALL.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_FLAMEWALL.CHAT_FAILURE");
    base.damageDice = "1d12";
    base.damageType = {
      fire: true,
    };
    return base;
  }

  mysticPowerSetupFiresoul(base) {
    /* Kraefte-Paket 1 v1.3 (Rudolfs Baufreigabe 22.11.2026): Feuerseele
       wird zur MANUELL aktivierbaren Kraft analog Schutzrunen (Rudolfs
       Entscheidung 2 + Ergaenzung): Kachel-Klick = Wuerfeldialog mit
       Willenskraft-Probe (Modifikator/Gunst waehlbar), die Ergebnis-Karte
       bucht 1W4 temporaere Korruption ergebnisunabhaengig (Standard-Pfad),
       bei Probeerfolg setzt sie den firesoul-Marker MIT Maintain-Tags - der
       nimmt automatisch am A29-Maintain-Reminder im Kampf (je Runde) UND
       am Weltzeit-Reminder (alle 15 Minuten ohne Kampf, AoE v2.5) teil;
       der Besitzer entscheidet behalten/abbrechen. Erneuter Klick bei
       aktivem Marker = Deaktivierungs-Dialog (flagTest-Toggle-Pfad, keine
       Korruption). Alle Aurawirkungen (NK-Rueckstoss, Feuerschutzwurf,
       Meister: 0 Feuerschaden + halbe Heilung + Distanz-Vergeltung) greifen
       nur im AKTIVEN Zustand (Gates laufen ueber firesoulActiveLevel).
       Bewusste RAW-Abweichung (RAW: dauerhafte Reaktion ohne Kosten), von
       Rudolf so entschieden (Entscheidung 1 + 2). */
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "resolute";
    base.gmOnlyChatResultNPC = true;
    base.flagTest = "firesoul";
    base.flagPresentFSmod = {
      introText: game.i18n.localize("POWER_FIRESOUL.CHAT_DEACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_FIRESOUL.CHAT_RESULT_DEACTIVATE"),
      corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
      removeCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "firesoul"))],
    };
    base.flagNotPresentFSmod = {
      flagData: base.powerLvl.level,
      introText: game.i18n.localize("POWER_FIRESOUL.CHAT_ACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_FIRESOUL.CHAT_RESULT_ACTIVATE"),
      addCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "firesoul"))],
    };
    base.finalText = game.i18n.localize("POWER_FIRESOUL.CHAT_AURA_HINT");
    return base;
  }

  mysticPowerSetupShapeshift(base) {
    /* MM-Paket 2 v1 (Gestaltwandel-Baustein, Rudolfs Baufrage-Antwort
       „Kern MIT Gestaltwandel bauen"): Gestaltwandel als MANUELL
       aktivierbare Kraft IM Feuerseele-Muster (mysticPowerSetup-afters-
       hapeshift): Kachel-Klick = Würfeldialog mit [Willenskraft]-
       Probe, die Ergebnis-Karte bucht 1W4 temporäre Korruption ergeb-
       nisunabhängig (Standard-Pfad), bei Probeerfolg setzt sie den
       shapeshift-Marker MIT Maintain-Tags (A29-Erinnerung + Konzent-
       rations-Maschine), erneuter Klick bei aktivem Marker = Rück-
       verwandlung ([WS]-Probe, Feuerseele-Toggle-Pfad, keine Korrup-
       tion). Form-Qualitäten (Gepanzert I/Natürliche Waffe I ab Adept,
       Regeneration I + Robust (M) I ab Meister) schaltet getItem-
       ModifierShapeshift formgebunden frei; alle [Heimlichkeit]/
       [Gewandtheit]-Proben sind in Bestiengestalt wiederholbar (boon.js
       getShapeshiftFavour, Vorbelegung). KEINE Freien Angriffe gegen
       den Mystiker in Bestiengestalt = Hinweiszeile (bewusste Grenze:
       Freie Angriffe sind SL-Verantwortung). */
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "resolute";
    base.gmOnlyChatResultNPC = true;
    base.flagTest = "shapeshift";
    base.flagPresentFSmod = {
      introText: game.i18n.localize("POWER_SHAPESHIFT.CHAT_REVERT"),
      resultTextSuccess: game.i18n.localize("POWER_SHAPESHIFT.CHAT_RESULT_REVERTED"),
      corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
      removeCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "shapeshift"))],
    };
    /* Form-Marker: flagData als OBJEKT {level, maintained} - die Form-
       Qualitäten (getItemModifierShapeshift, boon.js, actor.js
       Zähigkeitsschwelle) lesen die Stufe daraus; A29-Maintain-Tags
       nehmen den Marker in die Erinnerung/Konzentrations-Maschine auf
       (Feuerseele-/Sphären-Muster). Meister: Regeneration (I) = 1W4
       Heilung je Runde über den A28-Heil-DoT AUF dem Marker. */
    const shapeshiftFlagData = {
      level: base.powerLvl.level,
      maintained: true,
      caster: null,
      ability: "shapeshift",
    };
    if (base.powerLvl.level >= 3) {
      shapeshiftFlagData.dot = {
        label: "TRAIT_LABEL.REGENERATION",
        formula: "1d4",
        resource: "heal",
        separateRoll: false,
      };
    }
    base.flagNotPresentFSmod = {
      flagData: shapeshiftFlagData,
      introText: game.i18n.localize("POWER_SHAPESHIFT.CHAT_TRANSFORM"),
      resultTextSuccess: game.i18n.localize("POWER_SHAPESHIFT.CHAT_RESULT_TRANSFORMED"),
      addCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "shapeshift"))],
    };
    base.finalText = game.i18n.localize("POWER_SHAPESHIFT.CHAT_FORM_HINT");
    return base;
  }

  mysticPowerSetupHeroichymn(base) {
    /* Hymnen-Paket v1 (Rudolfs Startsignal „Leg los“ 16.11.2026, RAW:
    Heldenhafte Hymne, Tradition Trollgesang): Aktion Frei, KEINE
    Zauberprobe (CASTING_NOT), Maintain-Runden WURFLOS (1.4, APG-
    Abgleich: keine Probe beim Aufrechterhalten) - wie die Kampfhymne,
    nur dass die Attribute
    cunning/resolute/persuasive gebufft werden und der Meister statt
    Zähigkeit 1× pro Szene bei Liedbeginn jedem Betroffenen 1W4 tem-
    poräre Korruption abwäscht (je Betroffenem ein eigener Wurf, Flag
    hymnMasterScene + SL-Reset-Karte). Kosten siehe getItemModifier-
    Trollsinging. */
    base.traditions = [game.symbaroum.config.TRAD_TROLLS];
    base.casting = game.symbaroum.config.CASTING_NOT;
    base.maintain = game.symbaroum.config.MAINTAIN;
    base.needToken = true;
    base.hymnAttributes = ["cunning", "resolute", "persuasive"];
    base.hymnMasterCleanse = true;
    base.introText = game.i18n.localize("POWER_HEROIC_HYMN.CHAT_INTRO");
    /* 1.4: introTextMaintain entfällt - Hymnen-Maintain-Runden wuerfeln
       nicht mehr, die Karte wird nie erreicht (Schluessel entfernt). */
    base.resultTextSuccess = game.i18n.localize("POWER_HEROIC_HYMN.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_HEROIC_HYMN.CHAT_FAILURE");
    base.preDialogFunction = preDialogHymnChoice;
    return base;
  }

  mysticPowerSetupHolyaura(base) {
    base.casting = game.symbaroum.config.CASTING;
    base.traditions = [game.symbaroum.config.TRAD_THEURGY];
    base.maintain = game.symbaroum.config.MAINTAIN;
    base.introText = game.i18n.localize("POWER_HOLYAURA.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_HOLYAURA.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_HOLYAURA.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_HOLYAURA.CHAT_FAILURE");
    base.activelyMaintaninedCasterEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "holyaura"))];
    /* v2 F9 (Rudolfs Freigabe 20.11.): Erneute Icon-Anwahl bei LAUFENDER
       Aura fragt den Abbruch ab (Hymnen-Modell, preDialogAuraChoice);
       ohne laufende Aura laeuft der normale Erstcast. */
    base.preDialogFunction = preDialogAuraChoice;
    // A36-Verbraucher (Heilige Aura, GRW): the aura dice per level - 1d6/
    // 1d8/1d10 damage against abominations and undead, 1d4/1d6 healing for
    // allies from Adept on. The values used to be printed as an informative
    // finalText only; holyAuraResult now automates the run (immediate
    // damage + engine-managed damage symbol per victim, regeneration symbol
    // per ally) and reports on its own summary card, so the old finalText
    // is gone.
    base.auraDamageDice = "1d6";
    base.auraHealDice = "1d4";
    if (base.powerLvl.level == 2) {
      base.auraDamageDice = "1d8";
    } else if (base.powerLvl.level == 3) {
      base.auraDamageDice = "1d10";
      base.auraHealDice = "1d6";
    }
    return base;
  }

  mysticPowerSetupIllusorycorrection(base) {
    /* Kraefte-Paket 1 v1.3 (Rudolfs Baufreigabe 22.11.2026): Die Kachel
       ist ab sofort klickbar - usePower kehrt bei fehlendem Setup sonst
       STILL zurueck (Testschwerpunkt 5/12-14 der Testrunde 1). Klick =
       direkter Wuerfeldialog mit Willenskraft-Probe (Modifikator/Gunst
       waehlbar), die Ergebnis-Karte bucht 1W4 temporaere Korruption
       ergebnisunabhaengig (Standard-Pfad) - das ist der MANUELLE Pfad
       fuer ALLE STUFEN (Rudolfs Entscheidung 3: Adept/Meister bleiben
       bewusst SL-Verwaltung, Spieler aktiviert manuell, Wirkung und
       Wiederholung steuert die SL). Der NOVIZE zusaetzlich automatisiert:
       nach misslungener eigener Verteidigung oeffnet sich ein Dialog
       (attackResult, resistRoll-Fluss), der bei Ja die Willenskraft-Probe
       PUR wuerfelt + 1W4 Korruption bucht und bei Probeerfolg die
       Verteidigung komplett wiederholt (1x/Runde, Trollsingen-Schluessel).
       Bewusste RAW-Abweichung (RAW: keine Korruption pro Nutzung), von
       Rudolf so entschieden (Entscheidung 1). */
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "resolute";
    base.gmOnlyChatResultNPC = true;
    base.introText = game.i18n.localize("POWER_ILLUSORYCORRECTION.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_ILLUSORYCORRECTION.CHAT_RESULT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_ILLUSORYCORRECTION.CHAT_RESULT_FAIL");
    return base;
  }

  mysticPowerSetupInheritwound(base) {
    base.casting = game.symbaroum.config.CASTING;
    base.maintain = game.symbaroum.config.MAINTAIN_NOT;
    base.getTarget = true;
    base.targetMandatory = true;
    base.traditions = [game.symbaroum.config.TRAD_WITCHCRAFT, game.symbaroum.config.TRAD_THEURGY];
    base.healedToken = game.symbaroum.config.TARGET_TOKEN;
    base.introText = game.i18n.localize("POWER_INHERITWOUND.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_INHERITWOUND.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_INHERITWOUND.CHAT_FAILURE");
    base.healFormulaSucceed = base.powerLvl.level > 1 ? "1d8" : "1d6";
    base.damageType = {
      mysticIgnArm: true,
    };
    base.targetText = game.i18n.localize("ABILITY_MEDICUS.CHAT_TARGET");
    return base;
  }

  mysticPowerSetupLarvaeboils(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.targetResistAttribute = "strong";
    base.casting = game.symbaroum.config.CASTING_NOT;
    base.maintain = game.symbaroum.config.MAINTAIN_RES;
    base.traditions = [game.symbaroum.config.TRAD_WITCHCRAFT];
    base.hasDamage = true;
    base.damageDice = "1d" + (2 * base.powerLvl.level + 2).toString();
    base.damageType = {
      mysticIgnArm: true,
    };
    base.introText = game.i18n.localize("POWER_LARVAEBOILS.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_LARVAEBOILS.CHAT_INTRO_M");
    base.resultTextSuccess = game.i18n.localize("POWER_LARVAEBOILS.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_LARVAEBOILS.CHAT_FAILURE");
    base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "larvaeboils"))];
    base.ignoreArm = true;
    return base;
  }

  mysticPowerSetupLayonhands(base) {
    base.casting = game.symbaroum.config.CASTING;
    base.getTarget = true;
    base.targetMandatory = true;
    base.traditions = [game.symbaroum.config.TRAD_WITCHCRAFT, game.symbaroum.config.TRAD_THEURGY];
    base.healFormulaSucceed = "1d6";
    if (base.powerLvl.level > 1) {
      base.healFormulaSucceed = "1d8";
      base.removeTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "poison")), foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bleeding"))];
    }
    base.healedToken = game.symbaroum.config.TARGET_TOKEN;
    base.targetText = game.i18n.localize("ABILITY_MEDICUS.CHAT_TARGET");

    if (base.powerLvl.level > 2) {
      base.preDialogFunction = preDialogLayonHands;
    }
    return base;
  }

  mysticPowerSetupLevitate(base) {
    base.casting = game.symbaroum.config.CASTING;
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY, game.symbaroum.config.TRAD_THEURGY];
    base.maintain = game.symbaroum.config.MAINTAIN;
    base.addCasterEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "fly"))];
    if (base.powerLvl.level > 1) {
      base.getTarget = true;
      base.targetResistAttribute = "strong";
      base.casting = game.symbaroum.config.CASTING_RES;
      base.addTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "fly"))];
    }
    // A25 stage 4 (GRW): Master floats himself AND a chain of allies
    if (base.powerLvl.level > 2) base.chain = game.symbaroum.config.CHAIN;
    return base;
  }

  mysticPowerSetupLifegiver(base) {
    /* v2.12 (Rudolfs Freigabe 15.11., Gruppe C): Lebensspender (APG,
       Theurgie). Novize: 1W4 temporäre Korruption von EINER Kreatur in
       Sichtweite abwaschen - alle überschüssigen Punkte heilen stattdessen
       Zähigkeit; ohne markiertes Ziel wirkt die Kraft auf den Mystiker
       selbst (RAW). Adept: selbst + alle Verbündeten in Sichtweite
       (Frisch-Zielen-Kette bzw. Sweep-Filter 'Verbündete'). Meister =
       REAKTION: passive Aura (lifegiver-Symbol auf dem Mystiker,
       Korruptions-Reduktion um 1W4 über applyCorruptionMasterReactions
       in hooks.js, NICHT auf den Mystiker selbst; SL entfernt das Symbol
       zum Deaktivieren). RAW nennt keine Probe - CASTING_NOT. */
    base.traditions = [game.symbaroum.config.TRAD_THEURGY];
    base.casting = game.symbaroum.config.CASTING_NOT;
    base.maintain = game.symbaroum.config.MAINTAIN_NOT;
    if (base.powerLvl.level < 3) {
      base.getTarget = true;
      base.targetMandatory = false;
      base.introText = game.i18n.localize("POWER_LIFEGIVER.CHAT_INTRO");
      base.resultTextSuccess = game.i18n.localize("POWER_LIFEGIVER.CHAT_SUCCESS");
      base.resultTextFail = game.i18n.localize("POWER_LIFEGIVER.CHAT_FAILURE");
    } else {
      base.introText = game.i18n.localize("POWER_LIFEGIVER.CHAT_INTRO_MASTER");
      base.resultTextSuccess = game.i18n.localize("POWER_LIFEGIVER.CHAT_SUCCESS_MASTER");
      base.resultTextFail = game.i18n.localize("POWER_LIFEGIVER.CHAT_FAILURE");
    }
    return base;
  }

  mysticPowerSetupMaltransformation(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.traditions = [game.symbaroum.config.TRAD_WITCHCRAFT];
    base.casting = game.symbaroum.config.CASTING_RES;
    base.maintain = game.symbaroum.config.MAINTAIN_RES;
    base.targetResistAttribute = "resolute";
    base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "maltransformation"))];
    // A25: Master level can unleash a chain of transformations (GRW)
    if (base.powerLvl.level > 2) base.chain = game.symbaroum.config.CHAIN;
    return base;
  }

  mysticPowerSetupMarkoftorment(base) {
    /* v2.8.1 G7 (Rudolfs Option B): KEIN Zielzwang - Picker-Platzierung
       im Zauberlauf, Erstgesang je Feind der Region (Glyphe-Modell). */
    base.getTarget = false;
    base.targetMandatory = false;
    base.traditions = [game.symbaroum.config.TRAD_SYMBOLISM];
    base.targetResistAttribute = "resolute";
    base.casting = game.symbaroum.config.CASTING_RES;
    base.introText = game.i18n.localize("POWER_MARKOFTORMENT.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_MARKOFTORMENT.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_MARKOFTORMENT.CHAT_FAILURE");
    /* A33 (Rudolf's redesign, GO 23.10. spät): the three levels get distinct
       time models. NOVICE/ADEPT: maintain-coupled pain (Blinding-Symbol
       pattern) - MAINTAIN_RES + activelyMaintainedTargetEffect stun symbol;
       while the mystic maintains, the victim may not act, stopping the
       maintain (or a failed maintain roll) removes the symbol via the A25
       chain. ADEPT additionally grants every attacker of the victim
       automatic favour (dialog.js target scan, attackerFavour flag) - the
       GRW "defense twice, worse counts" is rule-equivalent to attacker
       favour (Rudolf's A31 decision); free-form macro rolls outside the
       standard path deliberately get nothing. MASTER: deliberately NO
       maintain and the effect lasts only the current round (Rudolf's
       correction 23.10. spät, overriding the earlier entangling-vines
       answer): one-shot stun via the A34 turn-end marker (ends with the
       victim's turn, no GM bookkeeping), the Adept attacker favour while
       the mark lasts, plus the immediate 1d6 pain damage with armor
       ignored. */
    if (base.powerLvl.level === 3) {
      base.maintain = game.symbaroum.config.MAINTAIN_NOT;
      base.addTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "stun"))];
      base.targetEffectTurnEnd = true;
      base.hasDamage = true;
      base.damageDice = "1d6";
      base.damageType = {
        mysticIgnArm: true,
      };
      base.ignoreArm = true;
      base.finalTextSucceed = game.i18n.localize("POWER_MARKOFTORMENT.CHAT_MASTER");
    } else {
      base.maintain = game.symbaroum.config.MAINTAIN_RES;
      base.introTextMaintain = game.i18n.localize("POWER_MARKOFTORMENT.CHAT_INTRO_M");
      base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "stun"))];
      base.finalTextSucceed = game.i18n.localize(
        base.powerLvl.level > 1 ? "POWER_MARKOFTORMENT.CHAT_ADEPT" : "POWER_MARKOFTORMENT.CHAT_NOVICE"
      );
    }
    // v2.8 G7 (Rudolfs finale Konzeptrunde 21.11.): Zeichen der Pein
    // legt eine DAUERHAFTE Symbolzone an - erneute Anwahl bei laufen-
    // der Zone oeffnet den Abbruch-Dialog (preDialogSymbolZoneChoice).
    // v2.8.2 (Rudolfs Testrunde v2.8.1, 4/5): Der Dialog sass bis
    // v2.8.1 als Apply-Fehler im MINDTHROW-Setup - Pein hatte dadurch
    // keinen Abbruch und der Icon-Klick lief als stiller Replace
    // durch (neue Platzierung, alte Zone geloescht). Jetzt sitzt er
    // hier: Klick bei laufender Zone = Abbruch (F41-Karte), kein
    // Neuwurf im selben Klick.
    base.preDialogFunction = preDialogSymbolZoneChoice;
    return base;
  }

  mysticPowerSetupMindthrow(base) {
    base.getTarget = true;
    // A25 stage 2: the object attack (novice) probes against Quick, the
    // enemy throw (Adept+) against Strong (GRW)
    base.targetResistAttribute = base.powerLvl.level > 1 ? "strong" : "quick";
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY];
    base.targetPresentFSmod = {
      hasDamage: true,
      casting: game.symbaroum.config.CASTING_RES,
      damageDice: "1d8",
      targetImpeding: true,
      damageType: {
        mysticArm: true,
      },
    };
    if (base.powerLvl.level > 2) {
      base.maintain = game.symbaroum.config.MAINTAIN;
      // A25 stage 2: Master can throw a chain of enemies (GRW)
      base.chain = game.symbaroum.config.CHAIN;
    }
    return base;
  }

  mysticPowerSetupPriosburningglass(base) {
    base.casting = game.symbaroum.config.CASTING;
    base.getTarget = true;
    base.targetMandatory = true;
    // A32: no maintain (GRW) - Prios' Burning Glass is a single attack
    // action; the corrupted dialog question stays with the Novice single
    // target, from Adept on the bonus dice are auto-detected per target
    // (priosBurningGlassResult)
    base.traditions = [game.symbaroum.config.TRAD_THEURGY];
    base.introText = game.i18n.localize("POWER_PRIOSBURNINGGLASS.CHAT_INTRO");
    base.hasDamage = true;
    base.askCorruptedTarget = base.powerLvl.level === 1;
    if (base.powerLvl.level === 1) {
      base.damageDice = "1d6";
      base.targetFullyCorruptedFSmod = {
        damageDice: "1d8",
      };
    } else {
      base.damageDice = "1d8";
      base.targetFullyCorruptedFSmod = {
        damageDice: "1d12",
      };
    }
    base.damageType = {
      holy: true,
      mysticArm: true,
      // P4 Feuer-Paket (S2.1): Feuerschaden - loest den Feuergeschmiedet-
      // Schutz des Ziels in mathDamageProt aus
      fire: true,
    };
    return base;
  }

  mysticPowerSetupProtectiverunes(base) {
    /* Hymnen-Paket 1.2 (Rudolfs Testrunde v1.1, P4 + Antwort 1): echte
       Eigenschaftsprobe im Standard-Würfeldialog statt der wurflosen
       Bestätigung - Aktivierung nur bei Probeerfolg, Korruption bucht
       die Ergebnis-Karte AUCH bei Fehlschlag (Standard-Pfad, ergeb-
       nisunabhängig). Deaktivierung: Ja/Nein-Dialog in actor.js
       usePower (kein Wurf, keine Korruption).
       Hymnen-Paket 1.3 (Rudolfs Testrunde v1.2, P6b + Entscheidung
       "Fest Willenskraft, kein Dropdown"): Die Probe läuft FEST auf
       Willenskraft (resolute) - das 1.2-Attribut-Dropdown ("Mystische
       Kraft", alle Eigenschaften wählbar) ist ENTFERNT, Modifikator
       und Gunst bleiben wählbar (Modifikator-Feld + Gunst-Radio). */
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "resolute";
    base.traditions = [game.symbaroum.config.TRAD_STAFFM, game.symbaroum.config.TRAD_SYMBOLISM];
    base.gmOnlyChatResultNPC = true;
    base.flagTest = "protectiverunes";
    base.flagPresentFSmod = {
      introText: game.i18n.localize("POWER_PROTECTIVERUNES.CHAT_DEACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_PROTECTIVERUNES.CHAT_RESULT_DEACTIVATE"),
      corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
      removeCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "protectiverunes"))],
    };
    base.flagNotPresentFSmod = {
      flagData: base.powerLvl.level,
      introText: game.i18n.localize("POWER_PROTECTIVERUNES.CHAT_ACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_PROTECTIVERUNES.CHAT_RESULT_ACTIVATE"),
      addCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "protectiverunes"))],
    };
    if (base.powerLvl.level === 3) {
      base.flagNotPresentFSmod.finalText = game.i18n.localize("POWER_PROTECTIVERUNES.CHAT_RETRIBUTION_MASTER");
    } else if (base.powerLvl.level === 2) {
      base.flagNotPresentFSmod.finalText = game.i18n.localize("POWER_PROTECTIVERUNES.CHAT_RETRIBUTION_ADEPT");
    }
    return base;
  }

  mysticPowerSetupPurgatory(base) {
    /* v2.12 (Rudolfs Freigabe 15.11., Gruppe C): Fegefeuer (APG, Theurgie).
       Novize/Adept: KEINE Mystiker-Probe (CASTING_NOT) - der Mystiker
       zwingt die Opfer zum Wurf: je Ziel 1W20 gegen dessen GESAMTKORRUPTION
       (temporary + longterm + permanent), bei Wurf <= Gesamtkorruption ist
       das Ziel akuten Schmerzen ausgesetzt und eine volle Runde handlungs-
       unfaehig (Stun-Symbol, endet mit dem Zug des Ziels, A34-Muster);
       VOELLIG VERDORBENE Kreaturen erleiden stattdessen automatisch 1W6
       Schaden, Ruestung ignoriert (GM-Apply-Karte). Novize = Einzelziel;
       Adept = alle Feinde in Sichtweite (manuell Frisch-Zielen-Kette,
       als Sweep-Zone dialogfrei - Rudolfs Sichtweiten-Festlegung 13.11.:
       Sichtweite = 100 m = Extrem, als platzierte Flaeche dargestellt).
       Meister = REAKTION: reaktive Aura (purgatory-Symbol auf dem
       Mystiker, Korruptions-Spiegelschaden ueber applyCorruptionMaster-
       Reactions in hooks.js, SL entfernt das Symbol zum Deaktivieren). */
    base.traditions = [game.symbaroum.config.TRAD_THEURGY];
    base.casting = game.symbaroum.config.CASTING_NOT;
    base.maintain = game.symbaroum.config.MAINTAIN_NOT;
    if (base.powerLvl.level < 3) {
      base.getTarget = true;
      base.targetMandatory = true;
      base.introText = game.i18n.localize("POWER_PURGATORY.CHAT_INTRO");
      base.resultTextSuccess = game.i18n.localize("POWER_PURGATORY.CHAT_SUCCESS");
      base.resultTextFail = game.i18n.localize("POWER_PURGATORY.CHAT_FAILURE");
    } else {
      base.introText = game.i18n.localize("POWER_PURGATORY.CHAT_INTRO_MASTER");
      base.resultTextSuccess = game.i18n.localize("POWER_PURGATORY.CHAT_SUCCESS_MASTER");
      base.resultTextFail = game.i18n.localize("POWER_PURGATORY.CHAT_FAILURE");
    }
    return base;
  }

  mysticPowerSetupRevenantstrike(base) {
    /* Hymnen-Paket 1.2 (Rudolfs Testrunde v1.1, P4 + Antwort 1): echte
       Eigenschaftsprobe im Standard-Würfeldialog statt der wurflosen
       Bestätigung - Aktivierung nur bei Probeerfolg, Korruption bucht
       die Ergebnis-Karte AUCH bei Fehlschlag (Standard-Pfad, ergeb-
       nisunabhängig). Deaktivierung: Ja/Nein-Dialog in actor.js
       usePower (kein Wurf, keine Korruption).
       Hymnen-Paket 1.3 (Rudolfs Testrunde v1.2, P6b + Entscheidung
       "Fest Willenskraft, kein Dropdown"): Die Probe läuft FEST auf
       Willenskraft (resolute) - das 1.2-Attribut-Dropdown ("Mystische
       Kraft", alle Eigenschaften wählbar) ist ENTFERNT, Modifikator
       und Gunst bleiben wählbar (Modifikator-Feld + Gunst-Radio). */
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "resolute";
    base.gmOnlyChatResultNPC = true;
    base.flagTest = "revenantstrike";
    base.flagPresentFSmod = {
      introText: game.i18n.localize("POWER_REVENANTSTRIKE.CHAT_DEACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_REVENANTSTRIKE.CHAT_RESULT_DEACTIVATE"),
      corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
      removeCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "revenantstrike"))],
    };
    base.flagNotPresentFSmod = {
      flagData: base.powerLvl.level,
      introText: game.i18n.localize("POWER_REVENANTSTRIKE.CHAT_ACTIVATE"),
      addCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "revenantstrike"))],
    };
    base.flagNotPresentFSmod.resultTextSuccess = game.i18n.localize("POWER_REVENANTSTRIKE.CHAT_RESULT");
    return base;
  }

  mysticPowerSetupSphere(base) {
    /* Hymnen-Paket 1.2 (Rudolfs Testrunde v1.1, P4 + Antwort 1): echte
       Eigenschaftsprobe im Standard-Würfeldialog statt der wurflosen
       Bestätigung - Aktivierung nur bei Probeerfolg, Korruption bucht
       die Ergebnis-Karte AUCH bei Fehlschlag (Standard-Pfad, ergeb-
       nisunabhängig). Deaktivierung: Ja/Nein-Dialog in actor.js
       usePower (kein Wurf, keine Korruption).
       Hymnen-Paket 1.3 (Rudolfs Testrunde v1.2, P6b + Entscheidung
       "Fest Willenskraft, kein Dropdown"): Die Probe läuft FEST auf
       Willenskraft (resolute) - das 1.2-Attribut-Dropdown ("Mystische
       Kraft", alle Eigenschaften wählbar) ist ENTFERNT, Modifikator
       und Gunst bleiben wählbar (Modifikator-Feld + Gunst-Radio). */
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "resolute";
    base.traditions = [game.symbaroum.config.TRAD_STAFFM];
    base.gmOnlyChatResultNPC = true;
    /* Kräfte-Paket 1 (Sphäre, Rudolfs Baufreigabe 21.11.): Wahlmodell B
       (Rudolfs Entscheidung 5) - Radio-Wahl im Aktivierungsdialog
       (Gewandtheit ODER Willenskraft), Bindung bis zum Kraftende, kein
       Wechsel zwischendurch, keine Höher-Wert-Automatik. Die Wahl wandert
       als {level, choice} in die Marker-flagData; die TYPE_ATTRIBUTE-
       Substitution in getItemModifierSphere greift nur bei Wahl
       "resolute" (Legacy-Marker ohne Wahl-Feld behalten das A16-
       Verhalten "substitutiere, wenn Willenskraft höher" unverändert).
       Meister-Verbündeten-Sphäre siehe standardPowerResult. */
    base.askSphereChoice = true;
    base.flagTest = "sphere";
    base.flagPresentFSmod = {
      introText: game.i18n.localize("POWER_SPHERE.CHAT_DEACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_SPHERE.CHAT_RESULT_DEACTIVATE"),
      corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
      removeCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "sphere"))],
    };
    base.flagNotPresentFSmod = {
      flagData: base.powerLvl.level,
      introText: game.i18n.localize("POWER_SPHERE.CHAT_ACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_SPHERE.CHAT_RESULT_ACTIVATE"),
      addCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "sphere"))],
    };
    if (base.powerLvl.level === 3) {
      base.flagNotPresentFSmod.finalText = game.i18n.localize("POWER_SPHERE.CHAT_MASTER");
    } else if (base.powerLvl.level === 2) {
      base.flagNotPresentFSmod.finalText = game.i18n.localize("POWER_SPHERE.CHAT_ADEPT");
    }
    return base;
  }

  mysticPowerSetupStaffprojectile(base) {
    base.traditions = [game.symbaroum.config.TRAD_STAFFM];
    base.getTarget = true;
    base.targetMandatory = true;
    base.targetResistAttribute = "defense";
    base.casting = game.symbaroum.config.CASTING_RES;
    base.hasDamage = true;
    base.damageType = {
      mysticArm: true,
    };
    base.introText = game.i18n.localize("POWER_STAFFPROJECTILE.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_STAFFPROJECTILE.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_STAFFPROJECTILE.CHAT_FAILURE");
    if (base.powerLvl.level === 1) {
      base.damageDice = "1d8";
    } else if (base.powerLvl.level === 2) {
      base.damageDice = "1d10";
      base.finalTextSucceed = game.i18n.localize("POWER_STAFFPROJECTILE.CHAT_ADEPT");
    } else {
      base.damageDice = "1d12";
      base.multipleTargets = true;
      base.multipleTargetsNb = 5;
      base.preDialogFunction = preDialogStaffProjectile;
    }
    return base;
  }

  /* Kräfte-Paket 2 „Sprung & Schuss" (Rudolfs Freigabe 23.11.2026, Konzept-
     Doc Kraefte-Paket2-Konzept-v1): Sturmpfeil (GRW, Vault Sturmpfeil.md).
     Aktivierung = probenpflichtige Verzauberung von bis zu fünf Pfeilen
     (Standard-Wurfdialog, Res); der Bestand wohnt im Actor-Flag „stormArrow"
     (KEIN Symbol, nichts Sichtbares am Token - die Pfeile selbst bleiben
     als ordinäre Stapel im Inventar). Zweiter Klick auf die Kraft-Kachel
     öffnet über preDialogStormArrow den Aktions-Dialog: freier Schuss
     (1×/Runde), Salve (Adept 2 / Meister 3 Pfeile, Kampfaktion, blockiert
     den freien Schuss derselben Runde) oder Kraft-Ende. Treffer erfolg-
     sicher (kein Angriffswurf), Schaden fest 1W6 (N) / 1W8 (A/M) -
     Rudolfs Entscheidung 1: KEINE Übernahme von Pfeilqualitäten, Fähig-
     keiten wie Scharfschütze greifen nicht. Munitionsabbuchung je
     ABGEFEUERTEM Pfeil (Entscheidung 8 + b), Setting aus = keine Buchung;
     Abbruch/Szenenende lässt die restlichen Pfeile im Vorrat. */
  mysticPowerSetupStormarrow(base) {
    base.traditions = [game.symbaroum.config.TRAD_WITCHCRAFT];
    base.needToken = true;
    base.preDialogFunction = preDialogStormArrow;
    base.introText = game.i18n.localize("POWER_STORMARROW.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_STORMARROW.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_STORMARROW.CHAT_FAILURE");
    return base;
  }

  /* Kräfte-Paket 2, Block B Teleport (APG, Vault Teleport.md). Aktivierung:
     Standard-Wurfdialog (Res, unopponiert; Novize erleidet 1W4 Reisescha-
     den, Rüstung ignoriert - bucht als GM-Anwenden-Karte). SL verschiebt
     das Token (Rudolfs Entscheidung 2, keine Reichweiten-/Sichtbarkeits-
     Automatik): Hinweiskarte an die SLen. Fehlschlag: NUR Hinweiskarte
     (Entscheidung 3): Novize Dämonen-Agent (1W6-Liste), Adept/Meister
     Aufhalteproben-Hinweis (Rudolfs c: bewusst KEINE Wurftaste). Meister:
     preDialogTeleport hängt einen Mitreisenden aus der Nahkampfreichweite
     an; widerwillige Personen laufen als opponierte [Res<-Res]-Probe im
     Wurfdialog (Entscheidung 4, Schlingranken-Muster - EIN Wurf regelt
     Reise und Zwang, dokumentierte Vereinfachung). Mitreisender:
     1W4 Schaden + 1W4 temporäre Korruption (RAW), willig ohne Probe. */
  mysticPowerSetupTeleport(base) {
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY];
    base.needToken = true;
    base.preDialogFunction = preDialogTeleport;
    base.introText = game.i18n.localize("POWER_TELEPORT.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_TELEPORT.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_TELEPORT.CHAT_FAILURE");
    return base;
  }

  mysticPowerSetupTormentingspirits(base) {
    base.casting = game.symbaroum.config.CASTING;
    base.getTarget = true;
    base.targetMandatory = true;
    base.maintain = game.symbaroum.config.MAINTAIN;
    base.traditions = [game.symbaroum.config.TRAD_WITCHCRAFT];
    base.isAlternativeDamage = true;
    base.alternativeDamageAttribute = "resolute";
    base.introText = game.i18n.localize("POWER_TORMENTINGSPIRITS.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_TORMENTINGSPIRITS.CHAT_INTRO_M");
    base.resultTextSuccess = game.i18n.localize("POWER_TORMENTINGSPIRITS.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_TORMENTINGSPIRITS.CHAT_FAILURE");
    base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "tormentingspirits"))];

    if (base.powerLvl.level > 1) {
      base.hasDamage = true;
      base.damageDice = "1d" + (2 * base.powerLvl.level).toString();
      base.ignoreArm = true;
      base.damageType = {
        mysticIgnArm: true,
      };
    }
    return base;
  }

  mysticPowerSetupTrueform(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY, game.symbaroum.config.TRAD_THEURGY];
    base.targetResistAttribute = "resolute";
    base.casting = game.symbaroum.config.CASTING_RES;
    base.maintain = game.symbaroum.config.MAINTAIN_NOT;
    base.introText = game.i18n.localize("POWER_TRUEFORM.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("POWER_TRUEFORM.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_TRUEFORM.CHAT_FAILURE");
    base.addTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "trueform"))];
    if (base.powerLvl.level === 1) {
      // novice reaction: revealed illusions vanish (GM)
      base.finalTextSucceed = game.i18n.localize("POWER_TRUEFORM.CHAT_NOVICE");
    } else if (base.powerLvl.level === 3) {
      // master: a new transformation needs a Resolute test on the target's
      // initiative (GM)
      base.finalTextSucceed = game.i18n.localize("POWER_TRUEFORM.CHAT_MASTER");
    }
    // Adept+: chains from creature to creature (GRW) - via dispatch only,
    // no chain flag (no maintain on any level, so no maintain dropdown)
    return base;
  }

  mysticPowerSetupUnholyaura(base) {
    /* v2.12 (Rudolfs Freigabe 15.11., Gruppe C): Unheilige Aura (GRW,
       Zauberei) - 1:1-Spiegel der Heiligen Aura (A36-Verbraucher):
       Resolute-Probe, Maintain bis Probe-Misserfolg/Konzentrations-
       abbruch (Standard-Maintain-Pfad räumt über unholyAuraEndCleanup),
       Schaden an KULTURWESEN und BESTIEN in Sichtweite (Freund UND Feind -
       Kategorie-Filter statt Disposition, die Novizenstufe schadet
       ausdrücklich Verbündeten mit), 1W6 (Novize/Adept) bzw. 1W8
       (Meister), Rüstung ignoriert, je Opfer eine Resist-Chance gegen
       die gesnapshottete Willenskraft des Mystikers (Ein-Wurf-Modell wie
       Heilige Aura) und ein unholyaura-Schadenssymbol mit Resist-Marke
       (A28-Engine tickt am Beginn der Opfer-Züge). Adept+ kann lebende
       Verbündete ausschließen (Bestätigungsdialog je verbündetem Opfer,
       Default Nein - RAW "kann wählen"). Meister heilt zusätzlich
       verbündete Abscheulichkeiten und Untote in der Nähe um 1W8
       Zähigkeit (Regenerations-DOT, Heilige-Aura-Loop-2-Muster, ohne
       deren Korruptionsgebühr - RAW nennt keine). */
    base.casting = game.symbaroum.config.CASTING;
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY];
    base.maintain = game.symbaroum.config.MAINTAIN;
    base.introText = game.i18n.localize("POWER_UNHOLYAURA.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("POWER_UNHOLYAURA.CHAT_INTRO_M");
    base.resultTextSuccess = game.i18n.localize("POWER_UNHOLYAURA.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("POWER_UNHOLYAURA.CHAT_FAILURE");
    base.activelyMaintaninedCasterEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "unholyaura"))];
    /* v2 F9: siehe Heilige Aura - erneute Icon-Anwahl bei LAUFENDER Aura
       fragt den Abbruch ab (Hymnen-Modell), sonst normaler Erstcast. */
    base.preDialogFunction = preDialogAuraChoice;
    base.auraDamageDice = "1d6";
    base.auraHealDice = "1d8";
    if (base.powerLvl.level === 3) base.auraDamageDice = "1d8";
    return base;
  }

  mysticPowerSetupUnnoticeable(base) {
    base.casting = game.symbaroum.config.CASTING;
    base.traditions = [game.symbaroum.config.TRAD_WIZARDRY, game.symbaroum.config.TRAD_THEURGY];
    base.gmOnlyChatResultNPC = true;
    base.addCasterEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "unnoticeable"))];
    return base;
  }

  mysticPowerSetupWitchhammer(base) {
    /* Hymnen-Paket 1.2 (Rudolfs Testrunde v1.1, P4 + Antwort 1): echte
       Eigenschaftsprobe im Standard-Würfeldialog statt der wurflosen
       Bestätigung - Aktivierung nur bei Probeerfolg, Korruption bucht
       die Ergebnis-Karte AUCH bei Fehlschlag (Standard-Pfad, ergeb-
       nisunabhängig). Deaktivierung: Ja/Nein-Dialog in actor.js
       usePower (kein Wurf, keine Korruption).
       Hymnen-Paket 1.3 (Rudolfs Testrunde v1.2, P6b + Entscheidung
       "Fest Willenskraft, kein Dropdown"): Die Probe läuft FEST auf
       Willenskraft (resolute) - das 1.2-Attribut-Dropdown ("Mystische
       Kraft", alle Eigenschaften wählbar) ist ENTFERNT, Modifikator
       und Gunst bleiben wählbar (Modifikator-Feld + Gunst-Radio). */
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "resolute";
    base.gmOnlyChatResultNPC = true;
    base.flagTest = "witchhammer";
    base.traditions = [game.symbaroum.config.TRAD_THEURGY];
    base.flagPresentFSmod = {
      introText: game.i18n.localize("POWER_WITCHHAMMER.CHAT_DEACTIVATE"),
      resultTextSuccess: game.i18n.localize("POWER_WITCHHAMMER.CHAT_RESULT_DEACTIVATE"),
      corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
      removeCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "witchhammer"))],
    };
    base.flagNotPresentFSmod = {
      flagData: base.powerLvl.level,
      introText: game.i18n.localize("POWER_WITCHHAMMER.CHAT_ACTIVATE"),
      addCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "witchhammer"))],
    };
    base.flagNotPresentFSmod.resultTextSuccess = game.i18n.localize("POWER_WITCHHAMMER.CHAT_RESULT");
    return base;
  }

  // ********************************************* ABILITIES *****************************************************

  abilitySetupAcrobatics(base) {
    base.castingAttributeName = "quick";
    base.impeding = game.symbaroum.config.IMPEDING_MOVE;
    return base;
  }

  abilitySetupArtifactcrafting(base) {
    return base;
  }

  abilitySetupAlchemy(base) {
    return base;
  }

  abilitySetupBeastlore(base) {
    return base;
  }

  abilitySetupAxeartist(base) {
    // Axtkünstler v1.1 (Rudolfs Testrunde 1, 29.10.): Der Angriff läuft
    // über die AKTIVIERUNG DER WAFFE — die Technik-Auswahl sitzt als
    // Radio-Block im Würfeldialog (Einfach/Kurzer Hieb/Doppelschlag,
    // dialog.js). Der Fähigkeits-Button informiert nur noch über Status
    // und Weg; Meister (+1d4) läuft passiv in attackResult.
    base.isScripted = true;
    base.preDialogFunction = async function (functionStuff) {
      await axeArtistButtonInfo(functionStuff);
    };
    return base;
  }

  // Dreckiger Kampf v1 (Rudolfs Auswahlrunde 29.10.): gleiche Architektur
  // wie Axtkünstler v1.1 — Novizen-Technik (Fieser Schlag) im Würfeldialog
  // der Nahkampfwaffe, Adept (Stolpern) und Meister (Riposte) laufen passiv
  // in attackResult. Der Button informiert nur über Status und Weg.
  abilitySetupCheapshot(base) {
    base.isScripted = true;
    base.preDialogFunction = async function (functionStuff) {
      await cheapshotButtonInfo(functionStuff);
    };
    return base;
  }

  abilitySetupBerserker(base) {
    /* Hymnen-Paket 1.3 (Rudolfs Testrunde v1.2, P6a + Entscheidungen
       "Bestätigungsdialog wie 1.1" / "Alte Funktion wieder herstellen"):
       Berserker ist eine FÄHIGKEIT, keine mystische Kraft - die Akti-
       vierung läuft OHNE Würfelwurf (Rückbau des 1.2-Probe-Baus auf
       den 1.1-Zustand): formloser Bestätigungsdialog (Wirken/Abbrechen,
       CASTING_NOT), Anwendung direkt, KEINE Korruption (Fähigkeit).
       Die Deaktivierung läuft weiter über den Ja/Nein-Dialog in
       actor.js usePower (flagTest-Pfad, aus 1.2 unverändert). */
    base.casting = game.symbaroum.config.CASTING_NOT;
    base.gmOnlyChatResultNPC = true;
    base.flagTest = "berserker";
    base.flagPresentFSmod = {
      introText: game.i18n.localize("ABILITY_BERSERKER.CHAT_DEACTIVATE"),
      resultTextSuccess: game.i18n.localize("ABILITY_BERSERKER.CHAT_RESULT_DEACTIVATE"),
      removeCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "berserker"))],
    };
    base.flagNotPresentFSmod = {
      flagData: base.powerLvl.level,
      introText: game.i18n.localize("ABILITY_BERSERKER.CHAT_ACTIVATE"),
      addCasterEffect: [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "berserker"))],
    };
    if (base.powerLvl.level == 2) base.flagNotPresentFSmod.resultTextSuccess = game.i18n.localize("ABILITY_BERSERKER.CHAT_RESULT_LVL2");
    else if (base.powerLvl.level > 2) base.flagNotPresentFSmod.resultTextSuccess = game.i18n.localize("ABILITY_BERSERKER.CHAT_RESULT_LVL3");
    else base.flagNotPresentFSmod.resultTextSuccess = game.i18n.localize("ABILITY_BERSERKER.CHAT_RESULT_LVL1");
    return base;
  }

  abilitySetupBlacksmith(base) {
    return base;
  }

  abilitySetupDominate(base) {
    if (base.powerLvl.level < 2) {
      base.isScripted = false;
    } else {
      base.getTarget = true;
      base.targetMandatory = true;
      base.casting = game.symbaroum.config.CASTING_RES;
      base.castingAttributeName = "persuasive";
      base.targetResistAttribute = "resolute";
      base.addTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "fear"))];
    }
    if (base.powerLvl.level == 2) {
      // A34: the adept's fear is a "lost round" - the fear symbol expires
      // automatically at the END of the target's turn (turn-end engine);
      // the master (level 3) keeps its permanent GM-managed behaviour (E0)
      base.targetEffectTurnEnd = true;
      base.introText = game.i18n.localize("ABILITY_DOMINATE_ADEPT.CHAT_INTRO");
      base.resultTextSuccess = game.i18n.localize("ABILITY_DOMINATE_ADEPT.CHAT_SUCCESS");
    } else {
      base.introText = game.i18n.localize("ABILITY_DOMINATE_MASTER.CHAT_INTRO");
      base.resultTextSuccess = game.i18n.localize("ABILITY_DOMINATE_MASTER.CHAT_SUCCESS");
    }
    return base;
  }

  abilitySetupLeader(base) {
    if (base.powerLvl.level < 2) {
      base.isScripted = false;
    } else {
      base.getTarget = true;
      base.targetMandatory = true;
      base.casting = game.symbaroum.config.CASTING_NOT;
      base.resultTextSuccess = game.i18n.localize("ABILITY_LEADER.CHAT_SUCCESS");
      base.addTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "eye"))];
    }
    return base;
  }

  abilitySetupLoremaster(base) {
    base.introText = game.i18n.localize("ABILITY_LOREMASTER.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("ABILITY_LOREMASTER.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("ABILITY_LOREMASTER.CHAT_FAILURE");
    return base;
  }

  abilitySetupMedicus(base) {
    (base.castingAttributeName = "cunning"), (base.getTarget = true);
    base.healFormulaSucceed = "1d4";
    base.medicusExam = true;
    base.targetPresentFSmod = {
      medicusExam: false,
      healedToken: game.symbaroum.config.TARGET_TOKEN,
      targetText: game.i18n.localize("ABILITY_MEDICUS.CHAT_TARGET"),
      subText: base.label + " (" + base.powerLvl.lvlName + ")",
      medicus: true,
    };
    if (base.powerLvl.level == 1) {
      base.targetPresentFSmod.healFormulaSucceed = "1d4";
    } else if (base.powerLvl.level == 2) {
      base.targetPresentFSmod.healFormulaSucceed = "1d6";
    } else {
      base.targetPresentFSmod.healFormulaSucceed = "1d8";
      base.targetPresentFSmod.healFormulaFailed = "1d4";
    }
    return base;
  }

  abilitySetupPoisoner(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.casting = game.symbaroum.config.CASTING_RES;
    base.castingAttributeName = "cunning";
    base.targetResistAttribute = "strong";
    base.usePoison = true;
    base.poisoner = true;
    return base;
  }

  abilitySetupRecovery(base) {
    base.casting = game.symbaroum.config.CASTING;
    base.castingAttributeName = "resolute";
    base.healedToken = game.symbaroum.config.ACTING_TOKEN;

    if (base.powerLvl.level == 2) {
      base.healFormulaSucceed = "1d6";
    } else if (base.powerLvl.level == 3) {
      base.healFormulaSucceed = "1d8";
    } else {
      base.healFormulaSucceed = "1d4";
    }
    return base;
  }

  abilitySetupQuickdraw(base) {
    base.castingAttributeName = "quick";
    base.impeding = game.symbaroum.config.IMPEDING_MOVE;
    return base;
  }

  abilitySetupStrangler(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.casting = game.symbaroum.config.CASTING_RES;
    base.maintain = game.symbaroum.config.MAINTAIN_RES;
    base.castingAttributeName = "cunning";
    base.targetResistAttribute = "cunning";
    base.askCastingAttribute = false;
    base.impeding = game.symbaroum.config.IMPEDING_MOVE;
    base.introText = game.i18n.localize("ABILITY_STRANGLER.CHAT_INTRO");
    base.introTextMaintain = game.i18n.localize("ABILITY_STRANGLER.CHAT_INTRO_M");
    base.resultTextSuccess = game.i18n.localize("ABILITY_STRANGLER.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("ABILITY_STRANGLER.CHAT_FAILURE");
    base.activelyMaintainedTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "strangler"))];
    base.hasDamage = true;
    base.ignoreArm = true;
    base.damageDice = "1d6";
    base.newStuffIfMaintain = {
      castingAttributeName: "cunning",
      targetResistAttribute: "cunning",
      askCastingAttribute: false
    };
    return base;
  }

  abilitySetupWitchsight(base) {
    base.castingAttributeName = "vigilant";
    base.targetResistAttribute = "discreet";
    base.getTarget = true;
    base.targetPresentFSmod = {
      casting: game.symbaroum.config.CASTING_RES,
    };
    if (base.powerLvl.level == 2) {
      base.corruption = game.symbaroum.config.TEMPCORRUPTION_NORMAL;
    } else if (base.powerLvl.level > 2) {
      base.corruption = game.symbaroum.config.TEMPCORRUPTION_D6;
    } else base.corruption = game.symbaroum.config.TEMPCORRUPTION_ONE;
    base.introText = game.i18n.localize("ABILITY_WITCHSIGHT.CHAT_INTRO");
    base.resultTextSuccess = game.i18n.localize("ABILITY_WITCHSIGHT.CHAT_SUCCESS");
    base.resultTextFail = game.i18n.localize("ABILITY_WITCHSIGHT.CHAT_FAILURE");
    return base;
  }

  // ********************************************* TRAITS *****************************************************

  traitSetupPoisonous(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.casting = game.symbaroum.config.CASTING_RES;
    base.castingAttributeName = "cunning";
    base.targetResistAttribute = "strong";
    base.usePoison = true;
    base.poison = base.powerLvl.level;
    // Gift v1 B5 (Rudolfs Freigabe 08.11.2026): Das Merkmal Giftig nutzt
    // FESTE RAW-Werte je Stufe (Novize 2 Runden a 2, Adept 3 a 3, Meister
    // 4 a 4, Vault-Notiz „Giftig.md") statt des Grad-Wuerfelmodells - der
    // Wurffluss bleibt unverändert einseitig [Scharfsinn<-Stärke] (Rudolfs
    // Rückmeldung 2: „nur die Spieler würfeln").
    base.poisonFixedValues = true;
    return base;
  }

  /* MM-Paket 1 (Rudolfs Baufreigabe 24.11.2026, B7-Backlog der Gift-Reihe):
     Giftspucke als KLICKBARER Trait, Muster traitSetupPoisonous. Der
     Trait-Klick ist ein Fernkampfangriff [Präzision<-Gewandtheit]
     (CASTING_RES, askCastingAttribute false - RAW nutzt die Spucke
     immer Präzision); NUR bei Treffer folgt die SEPARATE Giftresistenz
     [Scharfsinn<-Stärke] (Verarbeitung im usePoison-Block der
     standardPowerResult, Flag poisonResistSeparate), deren Scheitern den
     Gift-DoT mit B5-Festwerten je Stufe legt (2/2, 3/3, 4/4).
     Kein Waffenschaden - die Spucke wirkt allein über das Gift (Vault-
     Notiz "Giftspucke.md"). Bewusst KEINE Reichweiten-Prüfung (Kurz,
     SL-Angelegenheit, Muster der übrigen Trait-Angriffe). */
  /* MM-Paket 2 v1.2 Cross-Flag-Waffen (Konzept Runde 3, Teil A - Commit 1):
     Giftspucke ist keine eigene Kachel-Wurfmaschine mehr - das Merkmal
     stiftet die FERNKAMPF-Cross-Waffe (config CROSS_WEAPON_TRAITS, actor.js
     _getWeapons/_evaluateWeapons). Kachel-Klick und Waffenzeile oeffnen
     denselben Standard-Waffendialog; die Gift-Engine haengt als Rider an
     der Cross-Referenz (mm2AttackerTraits): separate Giftresistenz
     [Scharfsinn<-Staerke] NUR bei Treffer, B5-Festwerte je Stufe am NSC
     bzw. SC-Grad-Wuerfelmodell (v1.1-Bewertungsfrage 2 bleibt unveraen-
     dert). Kein Waffenschaden - die Spucke wirkt allein ueber das Gift
     (Vault-Notiz "Giftspucke.md"), Anzeige "speziell". Bewusst KEINE
     Reichweiten-Pruefung (Kurz, SL-Angelegenheit, Muster der uebrigen
     Trait-Angriffe). */
  traitSetupPoisonspit(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.casting = game.symbaroum.config.CASTING_NOT;
    return base;
  }

  /* MM-Paket 2 v1.2 Cross-Flag-Waffen (Konzept Runde 3, Teil A - Commit 1):
     Knochengeschoss (NEUES Merkmal, Vault-Steckbrief) - Klick auf die
     Kachel oeffnet den Standard-Waffendialog der Cross-Waffe (Wurfwaffe,
     Schaden nach Natuerliche-Waffe-Stufe, ab Adept 2 Projektile/Runde,
     Meister +1W4 Bonus [Kalibrierung] + Korruptionsangriff/Giftig-Rider
     je Stufe des korrespondierenden Merkmals). */
  traitSetupBoneprojectile(base) {
    base.getTarget = true;
    base.targetMandatory = true;
    base.casting = game.symbaroum.config.CASTING_NOT;
    return base;
  }

  /* ================================================================
   * MM-Paket 2 v1 (Rudolfs Baufreigabe 24.11.2026, Konzept Rev. 2):
   * Die AKTIVEN Kampfkontroll-Merkmale als KLICKBARE Traits über den
   * traitSetup*-Dispatcher (Giftspucke-Präzedenz). ALLE MM2-Kachel
   * klicks laufen bewusst OHNE eigenen Würfeldialog (CASTING_NOT) -
   * der Dispatcher getPowerResultFunction schickt sie in die je
   * Merkmal eigene Karten-Maschine (Netz: Kartenfläche mit Verfangen-
   * und Befreiungs-Buttons; Greifzunge/Greifklauen: öffnen den
   * Waffendialog der natürlichen Waffe mit MM2-Presets; Rammen:
   * SL-Kettendialog; Blitzschnell: Hinweiskarte). Stufenlos:
   * Greifzunge hat KEINE Novize/Adept/Meister-Stufen (Vault-Notiz) -
   * der Zweig fragt keine Stufe ab.
   * ================================================================ */
  traitSetupWeb(base) {
    base.casting = game.symbaroum.config.CASTING_NOT;
    return base;
  }

  traitSetupGrapplingtongue(base) {
    base.casting = game.symbaroum.config.CASTING_NOT;
    return base;
  }

  traitSetupPrehensileclaws(base) {
    base.casting = game.symbaroum.config.CASTING_NOT;
    return base;
  }

  traitSetupRampage(base) {
    base.casting = game.symbaroum.config.CASTING_NOT;
    return base;
  }

  traitSetupSwift(base) {
    base.casting = game.symbaroum.config.CASTING_NOT;
    return base;
  }

  traitSetupRegeneration(base) {
    base.introText = game.i18n.localize("TRAIT_REGENERATION.CHAT_ACTION");
    base.casting = game.symbaroum.config.CASTING_NOT;
    base.healedToken = game.symbaroum.config.ACTING_TOKEN;

    if (base.powerLvl.level == 2) {
      base.healFormulaSucceed = "1d6";
    } else if (base.powerLvl.level == 3) {
      base.healFormulaSucceed = "1d8";
    } else {
      base.healFormulaSucceed = "1d4";
    }
    let regenDice = 2 + 2 * base.powerLvl.level;
    base.healFormulaSucceed = "1d" + regenDice.toString();
    return base;
  }

  traitSetupShapeshifter(base) {
    base.castingAttributeName = "resolute";
    return base;
  }

  traitSetupWisdomages(base) {
    base.castingAttributeName = "resolute";
    return base;
  }

  async getFunctionStuffDefault(actor, actingToken) {
    let functionStuff = {
      casting: game.symbaroum.config.CASTING,
      maintain: game.symbaroum.config.MAINTAIN_NOT,
      chain: game.symbaroum.config.CHAIN_NOT,
      ability: this.system,
      abilityName: this.name,
      abilityImg: this.img,
      abilityId: this._id,
      actor: actor,
      askTargetAttribute: false,
      askCastingAttribute: false,
      attackFromPC: actor.type !== "monster",
      autoParams: "",
      combat: false,
      corruption: false,
      favour: 0,
      isMaintained: false,
      modifier: 0,
      targetMandatory: false,
      targetData: { hasTarget: false, leaderTarget: false },
      token: actingToken,
      tokenId: actingToken?.id,
      actingCharName: actingToken?.name ?? actor.name,
      actingCharImg: actingToken?.img ?? actor.img,
      addCasterEffect: [],
      addTargetEffect: [],
      activelyMaintainedTargetEffect: [],
      activelyMaintaninedCasterEffect: [],
      removeTargetEffect: [],
      removeCasterEffect: [],
      introText: game.i18n.localize("POWER.CHAT_INTRO") + this.name + ' ".',
      introTextMaintain: game.i18n.localize("POWER.CHAT_INTRO_M") + this.name + ' ".',
      resultTextSuccess: game.i18n.localize("POWER.CHAT_SUCCESS"),
      resultTextFail: game.i18n.localize("POWER.CHAT_FAILURE"),
      resistRollText: "",
      hasDamage: false,
      isAlternativeDamage: false,
      dmgModifier: "",
      hasAdvantage: false,
      ignoreArm: false,
    };
    return functionStuff;
  }
}

/* v1.0.1 (Rudolfs Testrunde Commit 1, Befund 11): einheitlicher Subtext-
   Bau der Angriffs-Ergebniskarten - weaponTypeLabel null (Cross-Waffen)
   laesst den Klammerzusatz weg, alles andere bleibt "Name (Klasse)". */
async function mm2WeaponSubText(weapon) {
  const typeLabel = await weaponTypeLabel(weapon);
  return typeLabel ? `${weapon.name} (${typeLabel})` : weapon.name;
}

async function weaponTypeLabel(weapon) {
  switch (weapon.reference) {
    case "1handed":
      return game.i18n.localize("WEAPON_CLASS.1HANDED");
    case "short":
      return game.i18n.localize("WEAPON_CLASS.SHORT");
    case "long":
      return game.i18n.localize("WEAPON_CLASS.LONG");
    case "unarmed":
      return game.i18n.localize("WEAPON_CLASS.UNARMED");
    case "heavy":
      return game.i18n.localize("WEAPON_CLASS.HEAVY");
    case "ranged":
      return game.i18n.localize("WEAPON_CLASS.RANGED");
    case "thrown":
      return game.i18n.localize("WEAPON_CLASS.THROWN");
    case "shield":
      return game.i18n.localize("WEAPON_CLASS.SHIELD");
    case "other":
      return game.i18n.localize("GEAR.OTHER");
    /* Konzept Runde 3 Teil A: Cross-Flag-Waffen (Merkmals-Referenzen
       als Waffenklass-Ersatz). v1.0.1 (Rudolfs Testrunde Commit 1,
       Befund 11): KEIN Klassen-Klammernzusatz mehr auf den Angriffs-
       Ergebnis-Karten - null laesst mm2WeaponSubText den Klammeranteil
       wegfallen; das Label bleibt als Kachel-Titel-Fallback
       (mm2CrossWeaponFlow). */
    case "grapplingtongue":
    case "prehensileclaws":
    case "poisonspit":
    case "boneprojectile":
      return null;
  }
  return game.i18n.localize("GEAR.OTHER");
}

/* format the string to print the roll result, including the 2 dice if favour was involved, and the second roll when the option rare crits is enabled
@returns:  {string} the formated and localized string*/
export function formatRollResult(rollDataElement) {
  let rollResult = game.i18n.localize("ABILITY.ROLL_RESULT") + rollDataElement.diceResult.toString();
  if (rollDataElement.favour != 0) {
    rollResult += "  (" + rollDataElement.dicesResult[0].toString() + " , " + rollDataElement.dicesResult[1].toString() + ")";
  }
  if (rollDataElement.secondRollResult) {
    rollResult += " - " + game.i18n.localize("ABILITY.SECOND_ROLL_RESULT") + rollDataElement.secondRollResult.toString();
  }
  // Automatisierungspaket 1 (28.10.): 6-stufige Benennung - additives Feld
  // resultLevelKey (aus doBaseRoll) haengt die Wirkungsstufe an
  if (rollDataElement.resultLevelKey) {
    rollResult += " - " + game.i18n.localize(rollDataElement.resultLevelKey);
  }
  return rollResult;
}

/* Elixiere v1.5 (Korruptionsschwellen-Karte, Rudolfs Freigabe 02.11.): jetzt
   EXPORTIERT - die Karte haengt nicht mehr an zwei lokalen Aufrufstellen
   (Faeigkeiten/verseuchter Angriff), sondern an den ZWEI generischen
   Auslieferungspunkten fuer Korruption (GM-Anwendungskarte und A28-Tick in
   hooks.js). Damit feuert sie bei JEDEM Korruptionsanstieg im System:
   Faehigkeiten, verseuchte Angriffe, Lebenselixier-Runde fuer Runde,
   Selbst-Elixiere, Heiliges Feld (Mystiker-Kosten), Schwarzatem - und alle
   kuenftigen Pfade. Design-Entscheidung (Rudolfs Paket-Freigabe): die Karte
   kommt bei TATSAECHLICHER Anwendung - bei GM-Freigabe-Karten also erst beim
   Klick, nicht schon zur Wurfzeit. Die beiden ehemaligen Rollzeit-Aufrufe
   sind bewusst ENTFERNT (sonst Doppelkarten). */
export async function checkCorruptionThreshold(actor, corruptionGained) {
  let img = "icons/magic/air/wind-vortex-swirl-purple.webp";
  let introText = actor.name + game.i18n.localize("CORRUPTION.CHAT_WARNING");
  let finalText = actor.name + game.i18n.localize("CORRUPTION.CHAT_WARNING");
  if (!actor.system.health.corruption.threshold) return;
  else if (actor.system.health.corruption.value < actor.system.health.corruption.threshold) {
    if (actor.system.health.corruption.value + corruptionGained >= actor.system.health.corruption.threshold) {
      introText = actor.name + game.i18n.localize("CORRUPTION.CHAT_INTRO");
      finalText = actor.name + game.i18n.localize("CORRUPTION.CHAT_THRESHOLD");
      img = "icons/magic/acid/dissolve-arm-flesh.webp";
    } else if (actor.system.health.corruption.value + corruptionGained != actor.system.health.corruption.threshold - 1) {
      return;
    }
  } else if (actor.system.health.corruption.value < actor.system.health.corruption.max) {
    if (actor.system.health.corruption.value + corruptionGained >= actor.system.health.corruption.max) {
      introText = actor.name + game.i18n.localize("CORRUPTION.CHAT_INTRO");
      finalText = actor.name + game.i18n.localize("CORRUPTION.CHAT_MAX");
      img = "icons/creatures/unholy/demon-horned-winged-laughing.webp";
    } else if (actor.system.health.corruption.value + corruptionGained != actor.system.health.corruption.max - 1) {
      return;
    }
  }

  let templateData = {
    targetData: false,
    hasTarget: false,
    introText: introText,
    introImg: actor.img,
    targetText: "",
    subText: "",
    subImg: img,
    hasRoll: false,
    rollString: "",
    rollResult: "",
    resultText: "",
    finalText: finalText,
    haveCorruption: false,
    corruptionText: "",
  };

  const html = await foundry.applications.handlebars.renderTemplate("systems/symbaroum/template/chat/ability.hbs", templateData);
  const chatData = {
    user: game.user.id,
    content: html,
  };
  if (!actor.hasPlayerOwner) {
    let gmList = ChatMessage.getWhisperRecipients("GM");
    if (gmList.length > 0) {
      chatData.whisper = gmList;
    }
  }
  let NewMessage = await ChatMessage.create(chatData);
}

// check if pain (damage > toughness treshold)
function checkPainEffect(functionStuff, damageTotal) {
  if (
    !functionStuff.isAlternativeDamage &&
    functionStuff.targetData.actor.system.health.toughness.threshold &&
    damageTotal > functionStuff.targetData.actor.system.health.toughness.threshold
  ) {
    return true;
  }
  return false;
}

/* Hymnen-Paket 1.1 (Rudolfs Testrunde 17.11., Entscheidung „Alle
   Bestätigungs-Kräfte“): confirmPowerDialog (Ja/Nein-Bestätigung für
   gescriptete CASTING_NOT-Kräfte) ist ENTFALLEN - alle acht Kräfte
   (Tanzende Waffe, Schwarzodem, Schutzrunen, Revenant-Stoß, Sphäre,
   Hexenhammer, Berserker, Hexenblick) laufen jetzt über den normalen
   Würfeldialog (usePower/executeZonePower, modifierDialog).
   Hymnen-Paket 1.2 (Testrunde v1.1, P4): Die Toggle-Kräfte tragen
   jetzt eine echte Eigenschaftsprobe (casting CASTING + wählbare
   Eigenschaft, siehe die Setups), die Deaktivierung fragt ein kleiner
   Ja/Nein-Dialog (actor.js usePower) - der Titel-Suffix ist entfallen.
   Die Kosten zeigt die Ergebnis-Karte (standardPowerResult);
   getCorruptionPreview (actor.js) ist mit dem einzigen Aufrufer mit
   entfernt. */

/*usualy called by any prepareAbility function, or the combat function
will send to screen a windows asking for modifiers for the roll, then roll, then call the abilityResult function (sent as a parameter)
   * @param {item} ability      The base (active or reactive) ability power or trait for the roll.
   * @param {actor} actor       The actor of the roll
   * @param {string} castingAttributeName   The name of the casting attribute. If null, the player will be asked to choose one
   * @param {actor} targetActor Can be null (no target)
   * @param {string} targetAttributeName Can be null (no opposition attribute to roll)
   * @param {string} autoParams Can be null. The list of parameters, passive abilities and such, that are already included (to inform the player he doesn't have to type them in)
   * @param {number} modifier  A modifier for the roll
   * @param {string}  favour: "0", "-1", "1"
   * @param {boolean} checkMaintain: if true, ask the player whether the roll is for casting the ability or maintaining it 
   * @param {any}   functionStuff  an object of parameters not used in the dialog function, but useful for resultFunction */
export async function modifierDialog(functionStuff) {
  /* v1.0.1 (Rudolfs Testrunde Commit 1, Befund 3): Cross-Waffen-Kacheln
     liefen VOR dem Waffendialog durch diesen leeren Merkmals-Dialog
     (CASTING_NOT zeigt keine Wurffelder, nur OK). Cross-Referenzen
     springen direkt in buildRolls - der CASTING_NOT-Zweig am Ende ruft
     mm2CrossWeaponFlow, der den Standard-Waffendialog oeffnet. */
  if (game.symbaroum.config.CROSS_WEAPON_TRAITS[functionStuff.ability?.reference]) {
    await buildRolls(functionStuff);
    return;
  }
  let hasTarget = functionStuff.targetData.hasTarget;
  // Segen & Lasten v1.2 (Rudolfs Testrunde v1.1, P6 + Rückmeldung b):
  // Die v1.1-Ziel-Hinweiszeile (addBoonTargetHint) ist ENTFERNT — die
  // Opposed-Segene/-Lasten zeigen die Zieleigenschaft jetzt über den
  // regulären Kräfte-Pfad auf der Karte an; die Ursache des fehlenden
  // Opposed war notResisted im Submit-Callback (nun false in den
  // Boon-Setups, siehe boon.js Setup-Builder).
  let isWeaponRoll = false;
  let askCorruptedTargetDefaultYes = functionStuff.askCorruptedTarget && functionStuff.targetFullyCorrupted;
  let askCorruptedTargetDefaultNo = functionStuff.askCorruptedTarget && !functionStuff.targetFullyCorrupted;
  let leaderTarget = functionStuff.targetData.leaderTarget ?? false;
  let medicus = functionStuff.medicus ?? false;
  let poisoner = functionStuff.poisoner ?? false;
  let targetImpeding = functionStuff.targetImpeding ?? false;
  let weaponDamage = "";
  let actorWeapons;
  let askImpeding = false;
  let impedingValue = 0;
  /* Hymnen-Paket 1.4 (Rudolfs Testrunde v1.3, Punkt 8 + RAW-Entscheid):
     Maintain-Runden formlos gewirkter Kräfte würfeln WIRKLICH - Fluch
     (unopponierte Willenskraft je Runde) und Larvenbeulen (opponierte
     Probe je Runde gegen die Stärke des Opfers), beide von Rudolf gegen
     das RAW bestätigt. Deren A29-Maintain-Dialog braucht deshalb die
     Wurffelder (Modifikator, Gunst-Radio, Segen-und-Lasten-Zeilen) plus
     „Aufrechterhalten"-Vorbelegung - die 1.3-Version blendete sie aus,
     obwohl der Wurf lief (Rudolfs Befund: „Hymnen-Würfeldialog ohne
     Modifikator, Gunst-Block etc."). Die Hymnen erreichen preset-
     Maintain hier NIE mehr (preDialogHymnChoice wendet ihre Maintain-
     Runde wurflos direkt an); ihr Erstgesangs-Dialog bleibt bewusst
     schlank (keine Probe -> keine Wurffelder, RAW-gerecht). */
  let hasRoll = functionStuff.casting !== game.symbaroum.config.CASTING_NOT || functionStuff.presetMaintain;
  let d8 = "(+1d8)";
  let d6 = "(+1d6)";
  let d4 = "(+1d4)";
  let checkMaintain = functionStuff.maintain !== game.symbaroum.config.MAINTAIN_NOT || functionStuff.chain === game.symbaroum.config.CHAIN;
  if (functionStuff?.impeding === game.symbaroum.config.IMPEDING_MAGIC) {
    impedingValue = functionStuff.actor.system.combat.impedingMagic;
    if (impedingValue) askImpeding = true;
  } else if (functionStuff?.impeding === game.symbaroum.config.IMPEDING_MAGIC) {
    impedingValue = functionStuff.actor.system.combat.impedingMov;
    if (impedingValue) askImpeding = true;
  }
  if (functionStuff.askWeapon) {
    actorWeapons = functionStuff.actor.items.filter((item) => item.type == "weapon");
    if (actorWeapons.length == 0) {
      ui.notifications.error("No weapon in hand.");
      return;
    }
  }
  if (functionStuff.combat) {
    isWeaponRoll = true;
    if (functionStuff?.weapon) {
      if (functionStuff.attackFromPC || functionStuff.targetData.actor.type === "monster") {
        weaponDamage = functionStuff.weapon.damage.pc;
      } else {
        weaponDamage = functionStuff.weapon.damage.npc.toString();
        d8 = " (+4)";
        d6 = " (+3)";
        d4 = " (+2)";
      }
      if (functionStuff.isAlternativeDamage) {
        weaponDamage += " (" + game.symbaroum.api.getAttributeLabel(functionStuff.actor, functionStuff.alternativeDamageAttribute) + ")";
      }
    }
  }
  let targetAttributeName = null;
  if (functionStuff.targetData.resistAttributeName) {
    targetAttributeName = functionStuff.targetData.resistAttributeName;
  }
  createLineDisplay(functionStuff, functionStuff.attackFromPC);
  // Automatisierungspaket "Zweihandkraft" v1.1 (Rudolfs Testrunde 1, Befund 6):
  // die "Ruestung ignorieren"-Checkbox ist initial angehakt, wenn dieser
  // Angriff eine Ruestung ignorierende Quelle hat (Zweihandkraft-Meister
  // mit schwerer Waffe, GRW) - beide Dialogvarianten rendern den Haken aus
  // functionStuff.ignoreArm; der RAW-Zwang im Callback (siehe unten bei
  // #ignarm) bleibt als Absicherung erhalten
  if (isWeaponRoll && isHeavyWeapon(functionStuff.weapon) && getActorAbilityLevel(functionStuff.actor, "twohandedforce") >= 3) {
    functionStuff.ignoreArm = true;
  }
  // Automatisierungspaket 1 (28.10.): Würfeldialog im modernen Design, wenn
  // der Nutzer die modernen Blätter nutzt (pro User GLOBAL) - gleiche
  // Feld-IDs, nur das Layout ist neu
  const modernRoll = isModernDialogActive();
  // Ressourcen v1: Kraeuterarznei-Verfügbarkeit für die herbalcure-Checkbox
  // (Rudolfs Entscheidung 2: ausgegraut + Tooltip statt Nachhin-Fehler).
  // Nur relevant, wenn Medicus + Ziel + Welt-Setting aktiviert - sonst
  // bleibt die Checkbox komplett unangetastet (Verhalten wie bisher).
  let herbalCureUnavailable = false;
  if (medicus && hasTarget && isResourceConsumptionEnabled()) {
    herbalCureUnavailable = !getHerbalCureAvailability(functionStuff.actor).available;
  }
  // Ressourcen v1.3 (Bandagen-Runde, 31.10.): Verbandsmaterial-Status fuer
  // die AUTOMATISCHE Anzeigezeile im Wuerfeldialog (keine Checkbox, der
  // Spieler waehlt nichts - Rudolfs Festlegung). null = Zeile gar nicht
  // zeigen (kein Medicus-Ziel oder Welt-Setting aus); true = vorhanden
  // (Check-Glyph, wird beim Submit abgebucht); false = fehlt (X-Glyph +
  // „−1"-Badge, der Wurf erhaelt automatisch −1).
  let bandageAvailable = null;
  if (medicus && hasTarget && isResourceConsumptionEnabled()) {
    bandageAvailable = getBandageAvailability(functionStuff.actor).available;
  }
  // Elixier-Automatisierung v1 (Nebelball): Benommen-Malus (-1/-3/-5 auf
  // alle Erfolgsproben) als VORBELEGUNG des Modifikator-Felds dieses
  // Faehigkeits-/Zauberwurfs - sichtbar und ueberschreibbar, dazu eine
  // autoParams-Zeile (Muster dialog.js/Ruestungsbehinderung). Der Submit
  // uebernimmt den Input-Wert in functionStuff.modifier, der Malus ist
  // damit genau einmal eingebracht. Kein Wurf (hasRoll false) = keine
  // Injektion; Freiform-Makro-Wuerfe bleiben draussen (Dokumentation).
  const elixirDazedPenalty = hasRoll ? getDazedPenalty(functionStuff.actor) : 0;
  if (elixirDazedPenalty > 0) {
    functionStuff.modifier = (Number(functionStuff.modifier) || 0) - elixirDazedPenalty;
    functionStuff.autoParams += game.i18n.format("ELIXIR.DAZED_AUTOPARAM", { penalty: elixirDazedPenalty }) + ", ";
  }
  // S3 (Last Epileptisch, Phase 2 — Rudolfs Freigabe 07.11.2026):
  // Erschöpfungs-Malus −1 auf alle Erfolgsproben nach einem Anfall
  // (Condition „epilepsy", bis zum Szenenende, SL-Reset) — identische
  // Injektion wie der Benommen-Malus: VORBELEGUNG des Modifikator-
  // Felds, sichtbar und überschreibbar, plus autoParams-Zeile. Nur
  // bei Würfen (hasRoll); Freiform-Makro-Würfe bleiben draussen
  // (gleiche dokumentierte Begrenzung). Die Todesprobe läuft über
  // prepareRollDeathTest (dialog.js) OHNE Epilepsie-Malus — Rudolfs
  // Grenzentscheidung (Benommen-Präzedenz): SL kann −1 manuell ins
  // Modifikator-Feld des Todesprobe-Dialogs eintragen.
  const epilepsyPenalty = hasRoll ? getEpilepsyPenalty(functionStuff.actor) : 0;
  if (epilepsyPenalty > 0) {
    functionStuff.modifier = (Number(functionStuff.modifier) || 0) - epilepsyPenalty;
    functionStuff.autoParams += game.i18n.format("EPILEPSY.AUTOPARAM", { penalty: epilepsyPenalty }) + ", ";
  }
  // S4-Paket „Tag/Reise/Ressourcen" (07.11.2026): Hunger (≥5 Tage ohne /
  // ≥10 Tage halbe Ration) und Durst (≥3 Tage ohne Wasser) geben auf
  // diesem Fähigkeitswurf automatisch MISSGUNST — VORBELEGUNG des Gunst-
  // Radios (defaultFavour unten), NICHT verriegelt, plus Hinweiszeile
  // travelFavourHint über dem Radio (Rudolfs Runde-1-Wortlaut „1 und
  // Hinweiszeile im Würfeldialog"). Der Stärke-Malus scheiternder
  // Hunger-Proben greift nur bei festen Stärke-Würfen (Muster Benommen/
  // Epilepsie: Modifikator-VORBELEGUNG + autoParams-Zeile). Die Todes-
  // probe läuft bewusst über ihren eigenen Pfad OHNE beides (S3-Grenz-
  // entscheidung); Freiform-Makro-Würfe bleiben draussen (dokumentiert).
  const travelFavour = hasRoll ? getTravelTestFavour(functionStuff.actor) : { forced: false, favour: 0, labelKey: null };
  if (travelFavour.forced) {
    functionStuff.autoParams += game.i18n.localize(travelFavour.labelKey) + ", ";
  }
  // Hymnen-Paket 1.5 (Schwaechende Hymne, Rudolfs Entscheidung
  // "Missgunst-Marker bei Opfer"): Betroffene Feinde bekommen "eine
  // zweite Chance, alle Erfolgsproben nicht zu bestehen" als
  // MISSGUNST-VORBELEGUNG des Gunst-Radios (favourMod -1, exakt das
  // Hunger/Durst-Muster oben), NICHT verriegelt, plus autoParams-
  // Zeile. Nur bei Wuerfen (hasRoll); Freiform-Makro-Wuerfe bleiben
  // draussen (gleiche dokumentierte Begrenzung wie Benommen/Epilep-
  // sie/Hunger).
  const weakeningHymnFavour = hasRoll ? getWeakeningHymnFavour(functionStuff.actor) : { forced: false, favour: 0, labelKey: null };
  if (weakeningHymnFavour.forced) {
    functionStuff.autoParams += game.i18n.localize(weakeningHymnFavour.labelKey) + ", ";
  }
  // MM-Paket 1 v1.1 (Bewertungsfrage 3): Missgunst-VORBELEGUNG des Gunst-
  // Radios fuer die missgunst-Condition (Laehmendes Gift) - drittes
  // Glied der erzwungenen Gunst-Kette (Hunger/Durst, Schwaechende
  // Hymne, jetzt Missgunst), NICHT verriegelt, plus autoParams-Zeile.
  // Nur bei Wuerfen (hasRoll); Freiform-Makro-Wuerfe bleiben draussen
  // (gleiche dokumentierte Begrenzung).
  const missgunstFavour = hasRoll ? getMissgunstFavour(functionStuff.actor) : { forced: false, favour: 0, labelKey: null };
  if (missgunstFavour.forced) {
    functionStuff.autoParams += game.i18n.localize(missgunstFavour.labelKey) + ", ";
  }
  // MM-Paket 2 v1 (Gestaltwandel-Baustein): Bestiengestalt - [Heim-
  // lichkeit]/[Gewandtheit] wiederholbar als Gunst-VORBELEGUNG auch im
  // Faehigkeits-/Kraft-Dialog (dialog.js-Pendant, nicht verriegelt).
  const shapeshiftFavourModDialog = hasRoll
    ? getShapeshiftFavour(functionStuff.actor, functionStuff.castingAttributeName)
    : { favour: 0, labelKey: null };
  if (shapeshiftFavourModDialog.favour !== 0 && !missgunstFavour.forced) {
    functionStuff.autoParams += game.i18n.localize(shapeshiftFavourModDialog.labelKey) + ", ";
  }
  const travelStrengthPenalty =
    hasRoll && !functionStuff.askCastingAttribute && functionStuff.castingAttributeName === "strong"
      ? getHungerPenalty(functionStuff.actor)
      : 0;
  // Hunger-Paket v1 (Rudolfs Option A, 09.11.2026): Der Stärke-Malus
  // scheiternder Hungerproben steckt ab jetzt IM STÄRKE-GESAMTWERT
  // (actor.js _computeSecondaryAttributes) — hier bleibt NUR die
  // Anzeige (autoParams-Zeile + gesperrte Dialog-Zeile in
  // dialog2.hbs/dialog2-modern.hbs mit dem Hinweis, dass der Wert
  // bereits im Eigenschaftswert steckt). Die frühere fixe Abziehung
  // beim Submit ist ENTFALLEN (hätte sonst doppelt abgezogen).
  if (travelStrengthPenalty > 0) {
    functionStuff.autoParams += game.i18n.format("TRAVEL.STRENGTH_AUTOPARAM", { penalty: travelStrengthPenalty }) + ", ";
  }
  // Gift v1.1 (Rudolfs P9): Das Handbuch-+1 des Giftmischers wird
  // SICHTBAR im Wuerfeldialog vorbelegt (Modifikator-Feld, Epilepsie-
  // Muster) statt unsichtbar erst beim Submit (Rudolfs Befund: "Kein
  // Bonus in Wuerfeldialog"). Voraussetzung bleibt das Ausruestungs-
  // Item mit Referenz poisonmanual - deren Feld ist seit v1.1 am
  // Ausruestungs-Blatt editierbar (sheet/item.js referenceTypes).
  // Das Feld bleibt manuell aenderbar, der Submit bucht NICHT doppelt.
  // Gift v1.2 (Rudolfs v1.1-Runde, P11 - Rudolfs Wortlaut: Das Handbuch-
  // +1 "soll auch im Wuerfeldialog fuer Kampf und 'Giftmischer' auf-
  // tauchen mit UNVERAENDERLICHEM Bonus analog zu Waffenqualitaeten
  // wie 'Durchschlagend'"): Das +1 ist KEINE Vorbelegung des editier-
  // baren Modifikator-Felds mehr (v1.1, Epilepsie-Muster), sondern eine
  // FESTE, gesperrte Bonus-Zeile im Dialog (Muster Waffenqualitaets-
  // Zeilen: Label + disabled-Feld). Der Submit wendet es selbst an
  // (Giftmischer-Handler unten), das Modifikator-Feld bleibt sauber.
  const poisonManualBonus = poisoner && hasPoisonManual(functionStuff.actor);
  // Elixiere v1.7 (Rudolfs Waffengift-Dialog-Vereinheitlichung): die alte
  // Grad-Zeile "Gift aufgetragen?" im Modifier-Dialog entfaellt - DIE
  // Waffengift-Zeile ist "Gift auftragen" (gleiche Zeile wie im EC-Dialog,
  // dialog.js): Inventar-Gifte (Ausruestungs-Items mit Waffengift-Flag bzw.
  // Legacy-Giftstufe, Bestand > 0) PLUS die unbegrenzte EIGENGIFT-Option
  // fuer Traeger des Merkmals Giftig (poisonous) - Grad aus der Merkmals-
  // stufe, im Dialog VORSELEKTIERT, ohne Ressourcenverbrauch. Eigengift
  // laeuft ueber den Vergifter-Pfad (functionStuff.poison -> poisonCalc),
  // Inventar-Gift ueber den Coating-Pfad (functionStuff.poisonCoating).
  // Gift v1 (08.11.2026): B4 - Eigengift NUR noch das Merkmal Giftig
  // (die Faehigkeit Giftmischer braucht Dosen aus dem Inventar, RAW-
  // widrige unbegrenzte Gratis-Gifte entfallen). B3 - Adept/Meister
  // sehen zusaetzlich die AKTIVE Szenen-Beschichtung (Condition
  // poisoncoat, kein Verbrauch, Vergifter-Pfad); Inventar-Dosen tragen
  // jetzt ihren Gift-Grad (getElixirPoisonGrade) fuer die B3-Logik.
  let askPoisonCoating = false;
  let poisonCoatingChoices = [];
  let ownPoison = null;
  let activeCoatGrade = 0;
  let pendingCoat = null;
  if (isWeaponRoll) {
    // Gift v1.1 (P9): zentraler Dosen-Filter (Handbuch der Gifte mit
    // Referenz poisonmanual bleibt ausserhalb aller Auswahllisten).
    const poisonCoatingItems = functionStuff.actor.items.filter((it) => isWeaponPoisonDose(it));
    if (poisonCoatingItems.length > 0) {
      askPoisonCoating = true;
      poisonCoatingChoices = poisonCoatingItems.map((it) => {
        const eff = it.system.elixirEffect ?? {};
        const formula = String(eff.damagePerRound ?? "").trim() || String(eff.damage ?? "").trim() || "1d4";
        const roundsFormula = String(eff.rounds ?? "").trim() || "1d4";
        return { id: it.id, name: it.name, count: getItemCount(it), formula, roundsFormula, grade: getElixirPoisonGrade(it) };
      });
    }
    // B4: Eigengift nur noch ueber das Merkmal Giftig (poisonous)
    const ownPoisonGrade = getActorAbilityLevel(functionStuff.actor, "poisonous");
    if (ownPoisonGrade > 0) {
      ownPoison = {
        grade: ownPoisonGrade,
        label: game.i18n.format("DIALOG.OWN_POISON_OPTION", {
          grade: game.i18n.localize(
            ownPoisonGrade === 1 ? "DIALOG.LIGHT_POISON" : ownPoisonGrade === 2 ? "DIALOG.MEDIUM_POISON" : "DIALOG.STRONG_POISON"
          ),
        }),
      };
      askPoisonCoating = true;
    }
    // B3: aktive Szenen-Beschichtung (Adept/Meister) als Option ohne
    // Verbrauch; sie ist auch waehlbar, wenn das Inventar leer ist
    activeCoatGrade = getActivePoisonCoatGrade(functionStuff.actor);
    if (activeCoatGrade > 0) askPoisonCoating = true;
    // Gift v1.1 (P4): anhaltende Dosen-Beschichtung (Actor-Flag) als
    // VORSELEKTIERTE Option (dosecoat) - sie wirkt ab jetzt automatisch
    // bei jedem Angriff (Auto-Apply in attackResult), bis eine Vergiftung
    // gelingt oder "Kein Gift" sie abwischt.
    pendingCoat = getPendingWeaponCoat(functionStuff.actor);
    if (pendingCoat) askPoisonCoating = true;
  }
  // Gift v1 B3/B4: Grad-Auswahl des Giftmischer-Faehigkeitswurfs ist an
  // den Vorrat gebunden - nur Stufen mit vorhandener Dosis (Inventar-
  // Union) plus die aktive Szenen-Beschichtung, sonst "Kein Gift".
  // Meister-Bonusstufe und Gunst werden im Submit-Handler gesetzt.
  let poisonerChoices = [];
  if (poisoner) {
    const invGrades = new Set(
      functionStuff.actor.items
        .filter((it) => isWeaponPoisonDose(it))
        .map((it) => getElixirPoisonGrade(it))
        .filter((g) => g >= 1)
    );
    const coatGrade = getActivePoisonCoatGrade(functionStuff.actor);
    if (coatGrade >= 1) invGrades.add(coatGrade);
    const gradeLabel = (g) =>
      game.i18n.localize(g === 1 ? "DIALOG.LIGHT_POISON" : g === 2 ? "DIALOG.MEDIUM_POISON" : "DIALOG.STRONG_POISON");
    poisonerChoices = [...invGrades]
      .sort((a, b) => a - b)
      .map((g) => ({
        value: g,
        label: gradeLabel(g) + (g === coatGrade ? " " + game.i18n.localize("POISON.COAT_ACTIVE_SHORT") : ""),
        selected: g === coatGrade,
      }));
    poisonerChoices.unshift({ value: 0, label: game.i18n.localize("DIALOG.NO_POISON"), selected: coatGrade < 1 });
  }
  // Segen & Lasten S2 (Rudolfs „Leg los“, 06.11.2026): Kontext-Zeilen der
  // besessenen Segen/Lasten für die Wurf-Eigenschaft — nur bei FIXER
  // Eigenschaft (bei Wahl-Eigenschaft askCastingAttribute weiß der
  // Spieler erst im Dialog, womit er würfelt; die Zeilen blieben sonst
  // stur auf der Vorbereichungs-Eigenschaft liegen). 'defense'-Würfe
  // bleiben draußen (boonLineAttrMatch).
  // S2.1 (P4 Feuer-Paket): Feuergeschmiedet erscheint NUR im Feuer-
  // Kontext — die drei Feuer-Kräfte (FIRE_DAMAGE_REFERENCES) und das
  // Stabgeschoss (dort entscheidet erst die gewählte Elementarrune,
  // ob der Wurf feuerverbunden ist; die Zeile bleibt deshalb bei
  // Stabgeschoss immer angeboten und gilt nur bei Rune Feuer).
  const fireContext =
    game.symbaroum.config.FIRE_DAMAGE_REFERENCES.includes(functionStuff.reference) || functionStuff.reference === "staffprojectile";
  const boon_lines =
    !functionStuff.askCastingAttribute && functionStuff.castingAttributeName
      ? getBoonLinesForActor(functionStuff.actor, functionStuff.castingAttributeName, { fire: fireContext })
      : [];
  const html = await foundry.applications.handlebars.renderTemplate(modernRoll ? "systems/symbaroum/template/chat/dialog2-modern.hbs" : "systems/symbaroum/template/chat/dialog2.hbs", {
    hasTarget: hasTarget,
    askCastingAttribute: functionStuff.askCastingAttribute,
    // Kräfte-Paket 1 (Sphäre): Radio-Wahl Gewandtheit/Willenskraft im
    // Aktivierungsdialog (Wahlmodell B, Rudolfs Entscheidung 5)
    askSphereChoice: functionStuff.askSphereChoice === true,
    sphereChoices: {
      resolute: game.i18n.localize("ATTRIBUTE.RESOLUTE"),
      quick: game.i18n.localize("ATTRIBUTE.QUICK"),
    },
    defaultSphereChoice: "resolute",
    askTargetAttribute: functionStuff.askTargetAttribute,
    isWeaponRoll: isWeaponRoll,
    autoparamsText: game.i18n.localize("DIALOG.AUTOPARAMS") + functionStuff.autoParams + functionStuff.targetData.autoParams,
    isArmorRoll: null,
    ignoreArmor: functionStuff.ignoreArm,
    leaderTarget: leaderTarget,
    packages: functionStuff.package,
    askImpeding: askImpeding,
    askCorruptedTargetDefaultYes: askCorruptedTargetDefaultYes,
    askCorruptedTargetDefaultNo: askCorruptedTargetDefaultNo,
    weaponDamage: weaponDamage,
    contextualDamage: functionStuff.hasDamage,
    // S2.1 (P4 Feuer-Paket): Elementarrune nur im Stabgeschoss-Dialog
    isStaffProjectile: functionStuff.reference === "staffprojectile",
    d8: d8,
    d4: d4,
    choices: { 0: game.i18n.localize("DIALOG.FAVOUR_NORMAL"), "-1": game.i18n.localize("DIALOG.FAVOUR_DISFAVOUR"), 1: game.i18n.localize("DIALOG.FAVOUR_FAVOUR") },
    groupName: "favour",
    // MM-Paket 1 v1.1: Missgunst als drittes Glied der Vorbelegungs-Kette
    // (alle drei erzwingen -1; Reihenfolge nur fuer die Auswertung relevant)
    // MM-Paket 2 v1 (Gestaltwandel): Form-Gunst als LETZTES, NICHT-
    // verriegeltes Glied - erzwungene Missgunst/Reise/Hymne gewinnt,
    // sonst +1 bei aktivem Form-Marker und Form-Attribut.
    defaultFavour: travelFavour.forced ? String(travelFavour.favour) : weakeningHymnFavour.forced ? String(weakeningHymnFavour.favour) : missgunstFavour.forced ? String(missgunstFavour.favour) : shapeshiftFavourModDialog.favour !== 0 ? String(shapeshiftFavourModDialog.favour) : "0",
    // S4: Hinweiszeile über dem Gunst-Radio (dialog2[-modern].hbs)
    travelFavourHint: travelFavour.forced ? game.i18n.localize(travelFavour.labelKey) : null,
    defaultModifier: functionStuff.modifier,
    defaultAdvantage: "",
    defaultDamModifier: "",
    checkMaintain: checkMaintain,
    maintainChoices: { C: "DIALOG.CASTING", M: "DIALOG.MAINTAINING" },
    // A29 (G2b): the Zug-Start maintain reminder can open this dialog preset
    // to "M" ("Aufrechterhalten") - otherwise "C" (Erster Zauber) stays the default
    defaultMaintain: functionStuff.presetMaintain ? "M" : "C",
    askWeapon: functionStuff.askWeapon,
    targetImpeding: targetImpeding,
    weapons: actorWeapons,
    medicus: medicus,
    herbalCureUnavailable: herbalCureUnavailable,
    bandageStatus: bandageAvailable !== null,
    bandageAvailable: !!bandageAvailable,
    askPoisonCoating: askPoisonCoating,
    poisonCoatingChoices: poisonCoatingChoices,
    ownPoison: ownPoison,
    // Gift v1 B3: aktive Szenen-Beschichtung als eigene Select-Option
    activeCoat: activeCoatGrade > 0 ? { grade: activeCoatGrade } : null,
    // Gift v1.1 P4: anhaltende Dosen-Beschichtung als vorselektierte Option
    pendingCoat: pendingCoat,
    poisoner: poisoner,
    poisonerChoices: poisonerChoices,
    // Gift v1.2 (P11): festes Handbuch-Bonus-Flag fuer die gesperrte
    // Dialog-Zeile (dialog2.hbs, Muster Waffenqualitaet)
    poisonManualBonus: poisonManualBonus,
    // S4 v1.2: Hunger-Stärke-Malus für die gesperrte Dialog-Zeile
    travelStrengthPenalty: travelStrengthPenalty,
    hasRoll: hasRoll,
    boon_lines: boon_lines
  });
  let title;
  if (functionStuff.ability) {
    title = functionStuff.abilityName;
  } else {
    title = functionStuff.weapon.name;
  }
  const baseDialogTitle = title;
  // Segen & Lasten v1.1 (Rudolfs Design-Runde): Titelleiste der Würfel-
  // dialoge „{Segen/Last} - {Eigenschaft}" — nur für Segen/Lasten, alle
  // anderen Würfe behalten ihren bisherigen Titel.
  if ((functionStuff.type === "boon" || functionStuff.type === "burden") && functionStuff.castingAttributeName) {
    title = `${title} - ${game.symbaroum.api.getAttributeLabel(functionStuff.actor, functionStuff.castingAttributeName)}`;
  }
  /* v2.12 (Rudolfs Testrunde 11, P2a): Der close-Handler unten räumt die
     In-Flight-Marke der Zonen-AKTIVIERUNG auch bei X/ESC - das Fenster-
     kreuz (und ESC) feuert KEINEN cancel-Callback, deshalb blieb die Marke
     nach dem Schließen bis zum 5-Minuten-Stale-Schutz stehen und die Zone
     war nicht erneut auslösbar. Die Flag unterscheidet Button-Schließungen
     (roll UND cancel setzen sie synchron am Callback-Anfang) von X/ESC:
     nur ohne Flag räumt der Handler. Feuert das close-Event vor dem
     Callback-Ende, verhindert die Flag das vorzeitige Räumen des Erfolg-
     pfads (der über aoeZoneActivationCompleted räumt; delete ist idempotent). */
  /* Hymnen-Paket 1.2: gleiche Wächter-Flag für die frisch platzierte
     Gesangsfläche (Erstgesang über den Ausführungsdialog) - roll und
     cancel setzen sie synchron am Callback-Anfang, X/ESC ohne Flag
     räumen über cleanupFreshHymnZone; das Committed-Flag von
     hymnResult schützt den Erfolgspfad. */
  let hymnDialogClosedByButton = false;
  let zoneDialogClosedByButton = false;
  let dialog = symbDialog({
    title: title,
    content: html,
    // Automatisierungspaket 1: modernes Fenster-Chrome (A6v9-Muster).
    // v1.2: Marker-Klassen 'symb-roll-dialog' + Nutzer-ID, damit beim
    // Design-/Ansichtswechsel die offenen Würfeldialoge dieses Nutzers
    // geschlossen werden können (closeOpenRollDialogs).
    classes: [`symb-roll-dialog`, `symb-roll-user-${game.user.id}`, ...(modernRoll ? modernDialogClasses("modern-roll-dialog") : [])],
    // Segen & Lasten S2: Gunst-/Missgunst-Exklusivität der B/G-Zeilen
    onRender: (element) => activateBoonLineExclusive(element),
    // Kosmetik v1.1: größenveränderbar und Breiten-Skalierung sind
    // jetzt symbDialog-Defaults (siehe symbDialog.js) - hier nicht mehr
    // pro Aufrufstelle nötig.
    buttons: {
      roll: {
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize("BUTTON.ROLL"),
        callback: async (html) => {
          // v2.12 (Testrunde 11, P2a): Button-Schließung markieren - der
          // close-Handler räumt dann nicht vorzeitig (Erfolgspfad räumt
          // über aoeZoneActivationCompleted).
          zoneDialogClosedByButton = true;
          // Hymnen-Paket 1.2: hier ebenso - der Gesang läuft, hymnResult
          // setzt hymnZoneCommitted vor dem Close-Event.
          hymnDialogClosedByButton = true;
          /* v2.7 (Testrunde 7, Rudolfs Schritt 2): die Bannsiegel-Kategorie-
             Prüfung läuft jetzt bei der WAHL (preDialogBanishingSeal bzw.
             Zonen-Platzierung), NICHT mehr erst beim „Würfeln" - ein
             blockierter Wurf mit nachträglicher In-Flight-Freigabe gehört
             der Vergangenheit an. Der v2.6-Check-Block (Novize + Fehl-
             kategorie + Zonen-Activ-In-Flight-Cleanup) ist damit tot und
             entfernt. */
          if (functionStuff.askWeapon) {
            let wepID = html[0].querySelector("#weapon")[0].value;
            functionStuff.weapon = functionStuff.actor.items.find((item) => item.id == wepID);
            functionStuff.castingAttributeName = functionStuff.weapon.system.attribute;
            if (functionStuff.weapon.system.qualities.precise) {
              functionStuff.modifier += 1;
              functionStuff.autoParams += game.i18n.localize("COMBAT.PARAMS_PRECISE");
            }
          }
          // acting attribute for d20roll
          if (functionStuff.askCastingAttribute) {
            functionStuff.castingAttributeName = html[0].querySelector("#castAt").value;
          }

          // Automatisierungspaket 1 (Rudolf, 28.10.): "Freier Angriff"-
          // Toggle - die RAW-Auslöser bleiben SL-Buchhaltung, der Toggle
          // markiert die AUSFÜHRUNG: hartes Präzision-Override (gilt auch
          // gegen Fähigkeiten, die andere Eigenschaften erlauben) und
          // Unterdrückung aktiver PACK_CHECK-Pakete (RAW: passive ja,
          // aktive nein). Muss NACH askWeapon/askCastingAttribute greifen.
          let isFreeAttack = false;
          if (isWeaponRoll) {
            const faBox = html[0].querySelector("#freeattack");
            isFreeAttack = !!(faBox && faBox.checked);
          }
          if (isFreeAttack) {
            functionStuff.castingAttributeName = "accurate";
            functionStuff.freeAttack = true;
            functionStuff.autoParams += game.i18n.localize("CHAT.CRITICAL_FREEATTACK") + ", ";
          }

          // Kräfte-Paket 1 (Sphäre): Wahlmodell B - Radio-Wahl im
          // Aktivierungsdialog (Gewandtheit ODER Willenskraft), Bindung
          // bis zum Kraftende. Fehlender Fallback = Willenskraft.
          if (functionStuff.askSphereChoice) {
            const sphereRadio = html[0].querySelector('input[name="sphere-choice"]:checked');
            functionStuff.sphereChoice = sphereRadio?.value === "quick" ? "quick" : "resolute";
          }

          //resist attribute for d20roll
          if (functionStuff.askTargetAttribute) {
            if (html[0].querySelector("#resistAtt").length > 0) {
              targetAttributeName = html[0].querySelector("#resistAtt").value;
              functionStuff.targetData.resistAttributeName = targetAttributeName;
              functionStuff.targetData.resistAttributeValue = getAttributeValue(functionStuff.targetData.actor, targetAttributeName);
            }
          }
          if (hasRoll) {
            //custom modifier for d20roll
            const bonus = html[0].querySelector("#bonus").value;
            let modifierCustom = parseInt(bonus, 10);
            functionStuff.modifier = modifierCustom;
            // S2.1 (P5+P9): freier Modifikator RAW (nur DIALOG-Feld) für
            // die einheitliche Wurfzeile „+ 1 (Modifikator)".
            functionStuff.freeModifier = modifierCustom;
            //Favour (2d20 keep best) or disfavour(2d20 keep worst)
            let favours = html[0].querySelectorAll("input[name='favour']");
            let fvalue = 0;
            for (let f of favours) {
              if (f.checked) fvalue = parseInt(f.value, 10);
            }
            functionStuff.favour += fvalue;
            /* AoE v2.4 (Rudolfs Testrunde 4, Entscheidungen a+b): Bei der
               ZONEN-AKTIVIERUNG laufen die reinen DIALOG-Werte (Modifikator
               + Gunst, ohne die ziel-spezifischen Zusätze wie Segenszeilen
               oder Resolute-Schadensreduktionen des Primärziels) als
               SNAPSHOT mit - buildRolls schreibt sie in die Region-Flags
               (aoe.snapshot) und jede Folge-Auslösung (Betreten, erneute
               Auslöse-Taste, Maintain-Runde) würfelt die Ziel-Token da-
               gegen, ohne neuen Dialog. */
            if (functionStuff.zoneActivation) {
              functionStuff.zoneDialogModifier = modifierCustom;
              functionStuff.zoneDialogFavour = fvalue;
            }
            // Segen & Lasten S2.1 (P6): Kontext-Zeilen auswerten — Bonus-Zeilen
            // addieren auf functionStuff.modifier (DIALOG-Feld setzt den
            // Startwert, Zeilen laufen additiv dazu) UND wandern mit
            // Name+Wert in die einheitliche Wurfzeile (formatModifierChain,
            // Labels dafür aus autoParams). sc-Zeilen (Gunst/Missgunst)
            // setzen KEINEN Override — sie wirken als Vorauswahl des
            // Gunst-Radios (activateBoonLineExclusive), das Radio ist im
            // Submit die Autorität (Rudolfs P6-Entscheid) und behält sein
            // Label in autoParams.
            const boonChecked = collectCheckedBoonLines(html, boon_lines);
            functionStuff.boonLineChain = [];
            for (const line of boonChecked) {
              if (line.sc) {
                functionStuff.autoParams += line.label + ", ";
                continue;
              }
              functionStuff.boonLineChain.push({ boonName: line.boonName, bonus: line.bonus });
              functionStuff.modifier += line.bonus;
            }
            // Hunger-Paket v1 (Rudolfs Option A, 09.11.2026): KEINE
            // Abziehung mehr — der Malus steckt bereits im Stärke-
            // Gesamtwert und damit im Wurfziel; die frühere
            // Subtraktion hier hätte doppelt abgezogen. Gesperrte
            // Dialog-Zeile + autoParams sind reine Anzeige.
          }

          //Power/Ability has already been started and is maintained or chained
          // A25 F12: the maintain select became radio buttons - read them
          // like the favour radios; "C" (Erster Zauber) is the checked default
          let maintainRadios = html[0].querySelectorAll("input[name='maintain']");
          for (let r of maintainRadios) {
            if (r.checked && r.value === "M") {
              functionStuff.isMaintained = true;
            }
          }
          if (askImpeding) {
            if (html[0].querySelector("#impeding").checked) {
              functionStuff.modifier += -impedingValue;
              functionStuff.autoParams += game.i18n.localize("ARMOR.IMPEDINGLONG") + ", ";
            }
          }
          if (targetImpeding) {
            if (html[0].querySelector("#impTarget").checked) {
              functionStuff.modifier += functionStuff.targetImpeding;
              functionStuff.autoParams += game.i18n.localize("ARMOR.IMPEDING_TARGET") + ", ";
            }
          }
          if (askCorruptedTargetDefaultYes || askCorruptedTargetDefaultNo) {
            functionStuff.targetFullyCorrupted = html[0].querySelector("#targetCorrupt").checked;
            if (functionStuff.targetFullyCorrupted) {
              functionStuff = Object.assign({}, functionStuff, functionStuff.targetFullyCorruptedFSmod);
              functionStuff.targetData.autoParams += game.i18n.localize("TOOLTIP.HEALTH.CORRUPTION_NA_TEXT");
            }
          }
          //combat roll stuff
          if (functionStuff.hasDamage) {
            functionStuff.hasAdvantage = html[0].querySelector("#advantage").checked;
            if (functionStuff.hasAdvantage) {
              functionStuff.modifier += 2;
              functionStuff.autoParams += game.i18n.localize("DIALOG.ADVANTAGE") + ", ";
            }
            let hasDamModifier = html[0].querySelector("#dammodifier") != null;
            let damModifier = "";
            let damModifierNPC = 0;
            if (hasDamModifier) {
              let damString = html[0].querySelector("#dammodifier").value;
              // Save - it is a string
              damString = damString.trim();

              if (damString.length) {
                functionStuff.additionalModifier = damString; // Regardless if valid or not, set it as attri_defaults
                let plus = "+";
                let damSource = "[" + game.i18n.localize("DIALOG.DAMAGE_MODIFIER") + "] ";
                if (damString.charAt(0) === "+") {
                  plus = ""; // If it already has plus, do not add another
                }
                if (/\[[^\]]+\]/.test(damString)) {
                  damSource = ""; // If it has "[damage source]" already in roll string, do not add another one
                }
                damModifier = `${plus}${damString}${damSource}`;

                try {
                  // Validate string as valid roll object
                  let r = await new Roll(damModifier, {}).evaluate();
                } catch (err) {
                  ui.notifications.error(`The ${game.i18n.localize("DIALOG.DAMAGE_MODIFIER")} can't be used for rolling damage ${err}`);
                  return;
                }
                // damModifierAttSup = damModifier;
                if (!functionStuff.attackFromPC && functionStuff.targetData.hasTarget && functionStuff.targetData.actor.type !== "monster") {
                  let parsedMod = parseInt(damString);
                  if (!isNaN(parsedMod)) {
                    damModifierNPC = parsedMod;
                  }
                }
              }
            }
            // S2.1 (P4 Feuer-Paket, Rudolfs Freigabe 06.11.2026): Elementar-
            // rune des Stabgeschosses (RAW Stabmagie-Novize: freie Aktion,
            // eine aktivierte Rune addiert +1W4 Stabschaden — Feuer/Blitz/
            // Kälte/Säure im selben Dropdown). Rune Feuer markiert den
            // Stabschoss zusätzlich als Feuerschaden (damageType.fire):
            // der Feuergeschmiedet-Schutz des ZIELS greift (mathDamageProt,
            // −1, mit Kartentext), und auf der Anwenderseite erscheint die
            // Feuergeschmiedet-Kontextzeile im Wurf-Dialog (s. boon_lines-
            // Aufruf oben). Die übrigen Runen addieren nur Schaden, ohne
            // Schadensart (RAW verifiziert, Vault-Notiz Elementarrune).
            // NPC-Stabmagier brauchen keinen Statikwert: simpleDamageRoll
            // maximiert die Formel (1d4 → 4).
            const runeSelect = html[0].querySelector("#elementalrune");
            const runeValue = runeSelect?.value ?? "none";
            if (runeValue !== "none") {
              const runeStr = `+1d4[${game.i18n.localize("POWER_STAFFPROJECTILE.ELEMENTAL_RUNE")}]`;
              try {
                // Validate string as valid roll object
                await new Roll(runeStr, {}).evaluate();
              } catch (err) {
                ui.notifications.error(game.i18n.format("POWER_STAFFPROJECTILE.ELEMENTAL_RUNE_ERROR", { err }));
                return;
              }
              damModifier += `${runeStr} `;
              if (runeValue === "fire") {
                functionStuff.damageType = functionStuff.damageType ?? {};
                functionStuff.damageType.fire = true;
              }
            }
            for (let pack of functionStuff.package) {
              if (pack.type === game.symbaroum.config.PACK_CHECK) {
                // Automatisierungspaket 1: aktive Pakete sind beim Freien
                // Angriff unterdrückt (RAW: passive ja, aktive nein)
                if (isFreeAttack) continue;
                // Find if the box is checked
                let ticked = html[0].querySelector(`#${pack.id}`);
                if (ticked.length > 0 && ticked[0].checked) {
                  /* MM-Paket 2 v1 (Rudolfs v1.1-Punkt B, Fix-Entwurf
                     Konzept §4.1): Komma-Normalisierung, item.js-Äquivalent
                     zum dialog.js-Check-Pack-Tick - kein fuehrendes Komma
                     bei Leerstart, keine Doppelkommas nach Trailing-Kommas. */
                  functionStuff.autoParams = (functionStuff.autoParams ? functionStuff.autoParams.replace(/[,\s]+$/, "") + ", " : "") + pack.label;
                  for (let member of pack.member) {
                    if (member.type == game.symbaroum.config.DAM_MOD) {
                      damModifier += `${member.alternatives[0].damageMod}[${pack.label}]`;
                      damModifierNPC += member.alternatives[0].damageModNPC;
                    }
                  }
                }
              }
            }

            if (damModifier.length > 0) {
              functionStuff.dmgModifier = damModifier;
              functionStuff.dmgModifierNPC = damModifierNPC;
            }
          }
          // Bestienkunde v1 (Rudolfs Freigabe 28.10.): Bonus fuer KRAEFTE mit
          // Schaden - vollautomatisch nur gegen die auf dem Item-Blatt
          // gewaehlte Kategorie des anvisierten Ziels (der Waffen-Bonus
          // sitzt stattdessen in attackResult, damit BEIDE Dialogpfade
          // abgedeckt sind - hier ist isWeaponRoll false, keine Dopplung)
          if (!isWeaponRoll && functionStuff.hasDamage && !functionStuff.isReturnSwing) {
            const beastlorePowerBonus = getBeastloreDamageBonus(functionStuff.actor, functionStuff.targetData?.actor);
            if (beastlorePowerBonus) {
              // Bestienkunde v1.1 (Rudolfs Testrunde 1, Befund 5): derselbe
              // Flavor-Tag wie auf dem Waffen-Pfad (damageRollWithDiceParams),
              // damit der Zusatzschaden-Wuerfel in der Karte als
              // "+1d4[Bestienkunde]" erscheint - simpleDamageRoll haengt
              // dmgModifier unverarbeitet an die Formel
              functionStuff.dmgModifier += " " + beastlorePowerBonus.damageMod + "[" + game.i18n.localize("ABILITY_LABEL.BEAST_LORE") + "]";
              functionStuff.dmgModifierNPC = (functionStuff.dmgModifierNPC ?? 0) + beastlorePowerBonus.damageModNPC;
              functionStuff.autoParams += beastlorePowerBonus.label + ", ";
            }
          }
          if (isWeaponRoll) {
            functionStuff.ignoreArm = html[0].querySelector("#ignarm").checked;
            // Zweihandkraft v1.2 (Rudolfs Testrunde 2): KEIN Zwang mehr -
            // bei schwerer Waffe + Zweihandkraft-Meister ist die Checkbox nur
            // vorbelegt (siehe Vorbelegung vor dem renderTemplate); die
            // Checkbox gewinnt, der Meister kann abwaehlen
            if (functionStuff.ignoreArm) functionStuff.autoParams += game.i18n.localize("COMBAT.CHAT_DMG_PARAMS_IGN_ARMOR") + ", ";
            // Elixiere v1.7 (Waffengift-Dialog-Vereinheitlichung): die
            // Grad-Zeile "Gift aufgetragen?" (#poison) ist ENTFALLEN -
            // gelesen wird die vereinheitlichte Zeile "Gift auftragen"
            // (#poisonCoating). Gift v1 (08.11.): Aufloesung ueber den
            // gemeinsamen Helper (beide Wuerfeldialoge): 'ownpoison' =
            // Eigengift (B4: nur noch Merkmal Giftig, kein Verbrauch,
            // Vergifter-Pfad), 'activecoat' = laufende Adept-Beschichtung
            // (kein Verbrauch, Vergifter-Pfad), 'coatscene' = Inventar-
            // Dosis startet die Szenen-Beschichtung (1 Dosis beim Submit,
            // Vergifter-Pfad; Rueckgabe null = Abbuchung gescheitert,
            // KEIN Wurf), 'dosecoat' = anhaltende Beschichtung bleibt
            // (reine Anzeige), Inventar-Dosis (Novize/jeder) = ANHALTENDE
            // Beschichtung (Gift v1.1, P4: Dosis bleibt auf der Klinge,
            // bis eine Vergiftung gelingt - auch Treffer in spaeteren
            // Runden tragen es; Abbuchung ERST bei gelungener Vergiftung,
            // effectiv im Coating-Block von attackResult), 'none' =
            // kein Gift UND Abwischen der anhaltenden Beschichtung.
            // Gift v1.2 (P9, Rudolfs Freigabe): "Kein Gift" wischt BEIDE
            // Beschichtungen DAUERHAFT - die anhaltende Dosen-Beschichtung
            // UND die aktive Szenen-Beschichtung (Condition poisoncoat);
            // Re-Vergiftung nur mit neuer Dosis.
            if (askPoisonCoating) {
              const coatingChoice = html[0].querySelector("#poisonCoating")?.value ?? "none";
              functionStuff.poisonChoice = coatingChoice;
              if (coatingChoice === "none") await wipeWeaponPoisonCoats(functionStuff.actor);
              const resolved = await resolveWeaponPoisonChoice(functionStuff.actor, coatingChoice, { ownPoison, poisonCoatingChoices });
              if (!resolved) return;
              if (resolved.kind === "ownpoison" || resolved.kind === "activecoat" || resolved.kind === "coatscene") {
                functionStuff.poison = resolved.poison;
                if (resolved.kind !== "ownpoison") {
                  functionStuff.poisonChosen = resolved.poison;
                  functionStuff.poisonFromCoat = resolved.kind === "activecoat";
                }
                functionStuff.autoParams +=
                  (resolved.kind === "ownpoison" ? game.i18n.localize("DIALOG.OWN_POISON_PARAM") : game.i18n.localize("DIALOG.POISON_COAT_PARAM")) + ", ";
              } else if (resolved.kind === "dose") {
                await setPendingWeaponCoat(functionStuff.actor, resolved.poisonCoating);
                functionStuff.autoParams += game.i18n.format("DIALOG.POISON_COATING_PARAM", { name: resolved.poisonCoating.name }) + ", ";
              } else if (resolved.kind === "dosecoat" && resolved.poisonCoating) {
                functionStuff.autoParams += game.i18n.format("DIALOG.POISON_COATING_PARAM", { name: resolved.poisonCoating.name }) + ", ";
              }
            }
          }
          if (medicus) {
            if (hasTarget) {
              functionStuff.herbalCure = html[0].querySelector("#herbalcure").checked;
              functionStuff.medicusExam = html[0].querySelector("#exam").checked;
              // Ressourcen v1 (Rudolfs Entscheidungen 1+2): Beim Submit wird
              // die Kraeuterarznei ABGEBUCHT - unabhaengig vom Wurfergebnis
              // (DSA5-Stil, die Arznei ist eingesetzt), kategoriebasiert
              // (resourceCategory kraeuterarznei, kulturell gefaerbte
              // Arzneien zaehlen mit). Verbraucher-Definition aus der
              // zentralen Registry (resources.js), keine Hartkopplung.
              // Doppelte Sicherheit gegen den Ausgrau-Zustand: Nichts mehr
              // im Inventar (zwischen Dialogöffnung und Submit entfernt)?
              // => Warnung + Wurf OHNE Arznei statt stiller Teilnahme.
              // Reine Untersuchung (medicusExam) verbraucht nichts - der
              // Heilblock (standardPowerResult) behandelt bei Untersuchung
              // ohnehin nicht, die Arznei waere nur verbrannt.
              if (functionStuff.herbalCure && !functionStuff.medicusExam && isResourceConsumptionEnabled()) {
                const consumedHerb = await consumeHerbalCure(functionStuff.actor);
                if (consumedHerb) {
                  functionStuff.resourceConsumed = consumedHerb;
                  functionStuff.autoParams += consumedHerb.label + ", ";
                } else {
                  functionStuff.herbalCure = false;
                  ui.notifications.warn(game.i18n.localize("RESOURCE.ERR_NONE_LEFT_MEDICUS"));
                }
              }
              // Ressourcen v1.3/v1.4 (Bandagen-Runde): Verbandsmaterial ist
              // notwendig beim Behandeln von Wunden - der Spieler waehlt
              // nichts. v1.4 (Diagnose-Entscheidung, 31.10.): Die Gilt-
              // Bereich ist NUR noch die VOLLE Behandlung; die umbenannte
              // Option „Diagnose" (medicusExam) verbraucht KEIN Verbands-
              // material und nimmt KEINEN −1 in Kauf (Diagnose ist die
              // reine Untersuchung, die Wunde wird nicht versorgt).
              // Volle Behandlung, Verbandsmaterial vorhanden: 1 Einheit
              // wird beim Submit abgebucht (unabhaengig vom Wurfergebnis,
              // wie Kraeuterarznei). Fehlt es: automatischer −1 auf den
              // Wurf, keine Abbuchung. Der Abzug landet hier NACH dem
              // #bonus-Read (der das Feld angibt und functionStuff.modifier
              // UEBERSCHREIBT) und VOR dem Zielwiderstand - er bleibt also
              // in jedem Fall wirksam und additiv. resourceConsumed bleibt
              // Kraeuterarznei-vorbehalten (die Basis-Heilung bei Fehlschlag
              // ist die Arznei-Wirkung, NICHT die des Verbandsmaterials).
              if (!functionStuff.medicusExam && isResourceConsumptionEnabled()) {
                const consumedBandage = await consumeBandage(functionStuff.actor);
                if (consumedBandage) {
                  functionStuff.autoParams += consumedBandage.label + ", ";
                } else {
                  functionStuff.modifier -= 1;
                  functionStuff.autoParams += game.i18n.localize("RESOURCE.BANDAGE_MISSING_PARAMS") + ", ";
                }
              }
              let customHealingFormula = html[0].querySelector("#customhealing").value;
              if (customHealingFormula.length > 0) {
                functionStuff.healFormulaSucceed = customHealingFormula;
              } else if (functionStuff.herbalCure) {
                functionStuff.subText += ", " + game.i18n.localize("ABILITY_MEDICUS.HERBALCURE");
                if (functionStuff.powerLvl.level == 1) {
                  functionStuff.healFormulaSucceed = "1d6";
                } else if (functionStuff.powerLvl.level == 2) {
                  functionStuff.healFormulaSucceed = "1d8";
                } else {
                  functionStuff.healFormulaSucceed = "1d10";
                  functionStuff.healFormulaFailed = "1d6";
                }
              } else functionStuff.subText += ", " + game.i18n.localize("ABILITY_MEDICUS.NOHERBALCURE");
              if (!functionStuff.medicusExam) {
                // Ressourcen v1.4 (Rudolfs Nachfrage, 31.10.): Die VOLLE
                // Behandlung (nicht die Diagnose) entfernt bei erfolgreicher
                // Medicus-Probe die zusaetzlich zum Aderlass auch die
                // Vergiftung des Ziels - beide als echte CONFIG-Objekte
                // (Muster mysticPowerSetupLayonhands): Der alte String-
                // Eintrag "icons/svg/blood.svg" war KEIN gueltiger Status-
                // Effekt (die Verarbeitung liest effect.id), deshalb wurde
                // Aderlass bislang nie entfernt.
                functionStuff.removeTargetEffect = [
                  foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bleeding")),
                  foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "poison")),
                ];
                functionStuff.introText = game.i18n.localize("ABILITY_MEDICUS.CHAT_INTRO");
                functionStuff.resultTextFail = game.i18n.localize("ABILITY_MEDICUS.CHAT_FAILURE");
                functionStuff.resultTextSuccess = game.i18n.localize("ABILITY_MEDICUS.CHAT_SUCCESS");
              }
            } else functionStuff.medicusExam = true;
          }
          // Gift v1 B3/B4/B6 (Giftmischer-Faehigkeitswurf): Grad-Select ist
          // an den Vorrat gebunden (poisonerChoices). 0 = "Kein Gift" -
          // dann laeuft der Faehigkeitswurf ohne Giftauswertung. Der
          // gewaehlte Grad wird in poisonChosen gemerkt (B3-Dosis-Logik im
          // usePoison-Block); eine bereits laufende Szenen-Beschichtung
          // derselben Stufe wird NICHT neu abgebucht (poisonFromCoat).
          // Meister (Stufe 3): gewaehltes Gift zaehlt 1 Stufe hoeher
          // (schwach->moderat, moderat->stark); bereits STARKES Gift
          // (Grad 3) gibt stattdessen GUNST auf die Giftprobe (Rudolfs
          // Entscheidung 3, 08.11.).
          // Handbuch der Gifte (B6): Das +1 auf die Giftmischer-Probe
          // ist seit v1.2 eine FESTE, gesperrte Bonus-Zeile im Dialog
          // (poisonManualBonus, Muster Waffenqualitaet) - der Submit
          // wendet es hier an (die v1.1-Feld-Vorbelegung ist entfallen).
          if (poisoner) {
            // Gift v1.2 (P11): fester Handbuch-Bonus +1 auf den
            // Giftmischer-Wurf (Karte zeigt den Handbuch-Parameter).
            if (hasPoisonManual(functionStuff.actor)) {
              functionStuff.modifier = (Number(functionStuff.modifier) || 0) + 1;
              functionStuff.autoParams += game.i18n.localize("DIALOG.POISON_MANUAL_PARAM") + ", ";
            }
            const chosen = Number(html[0].querySelector("#poisoner").value);
            functionStuff.poisonChosen = chosen;
            if (chosen === 0) {
              functionStuff.poison = 0;
            } else {
              const poisonerLevel = getActorAbilityLevel(functionStuff.actor, "poisoner");
              functionStuff.poisonFromCoat = getActivePoisonCoatGrade(functionStuff.actor) === chosen;
              if (poisonerLevel >= 3 && chosen < 3) {
                functionStuff.poison = chosen + 1;
                functionStuff.autoParams += game.i18n.localize("DIALOG.POISON_MASTER_UPGRADE_PARAM") + ", ";
              } else if (poisonerLevel >= 3 && chosen === 3) {
                functionStuff.poison = 3;
                functionStuff.favour += 1;
                functionStuff.autoParams += game.i18n.localize("DIALOG.POISON_MASTER_FAVOUR_PARAM") + ", ";
              } else {
                functionStuff.poison = chosen;
              }
            }
          }
          functionStuff.notResisted =
            functionStuff.notResisted ??
            !(
              (functionStuff.casting === game.symbaroum.config.CASTING_RES && !functionStuff.isMaintained) ||
              (functionStuff.maintain === game.symbaroum.config.MAINTAIN_RES && functionStuff.isMaintained)
            );
          if (hasTarget && !functionStuff.combat && !functionStuff.notResisted) {
            let targetResMod = checkSpecialResistanceMod(
              functionStuff.targetData.actor.system.combat.damageReductions,
              functionStuff.targetData.autoParams,
              functionStuff.ability.reference
            );
            functionStuff.favour += targetResMod.favour;
            functionStuff.modifier += -1 * targetResMod.modifier;
            functionStuff.dmgavoiding = targetResMod.dmgavoiding;
            functionStuff.autoParams += targetResMod.autoParams;
          }
          if (hasTarget && !functionStuff.notResisted) {
            // A24-F2: Anathema resists with the ORIGINATOR's snapshotted
            // willpower - the marked target's player has nothing to roll,
            // so no resist button; the dispeling mystic always rolls
            if (
              functionStuff.ability?.reference === "anathema" ||
              functionStuff.attackFromPC ||
              functionStuff.targetData.actor.type === "monster"
            ) {
              functionStuff.resistRoll = false;
              buildRolls(functionStuff);
            } else {
              functionStuff.resistRoll = true;
              functionStuff.resistRollText = isWeaponRoll
                ? functionStuff.targetData.name + game.i18n.localize("COMBAT.DEFENSE_ROLL")
                : functionStuff.targetData.name + game.i18n.localize("ABILITY.RESIST_ROLL");
              let userArray = await getOwnerPlayer(functionStuff.targetData.actor);
              if (userArray.length > 0 && game.settings.get("symbaroum", "playerResistButton")) {
                functionStuff.targetUserId = userArray[0].id;
                functionStuff.targetUserName = userArray[0].name;
                createResistRollChatButton(functionStuff);
              } else {
                buildRolls(functionStuff);
              }
            }
          } else {
            buildRolls(functionStuff);
          }
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("BUTTON.CANCEL"),
        /* v2.11 (Rudolfs Testrunde 10, P15): Wird der Wuerfeldialog einer
           Zonen-AKTIVIERUNG abgebrochen, raeumt der Abbruch die In-Flight-
           Marke SOFORT - bisher geschah das nur beim erfolgreichen Abschluss
           bzw. nach 5 Minuten Stale-Schutz, die Zone war nach dem Abbruch
           bis dahin nicht erneut ausloesbar. Ohne zoneActivation ist der
           Callback wie bisher eine Nulloperation. */
        callback: () => {
          // v2.12 (Testrunde 11, P2a): Button-Schließung markieren - der
          // Abbrechen-Button räumt selbst (unten), der close-Handler darf
          // nicht doppelt eingreifen (idempotent, aber der Flag bleibt
          // der saubere Zustand).
          zoneDialogClosedByButton = true;
          hymnDialogClosedByButton = true;
          if (functionStuff?.zoneActivation?.regionId) {
            game.symbaroum.api?.aoeZoneActivationAborted?.(functionStuff.zoneActivation.regionId);
          }
          /* Hymnen-Paket 1.2: Abbruch des Gesangsdialogs nach frisch
             platzierter Gesangsfläche (nur der Erstgesang über „Zone
             platzieren“ setzt hymnZone am functionStuff) - der Gesang
             lief nie, die Region muss wieder weg. */
          cleanupFreshHymnZone(functionStuff);
        },
      },
    },
    default: "roll",
  });
  // v2.12 (Rudolfs Testrunde 11, P2a): close-Handler auf der Dialog-Instanz
  // für die Zonen-AKTIVIERUNG - X und ESC schließen den Würfeldialog ohne
  // Button-Callback, der Handler räumt die In-Flight-Marke dann sofort
  // (Muster: symbDialog nutzt dasselbe close-Event für die Single-Instance-
  // Registry). Ohne zoneActivation bleibt der Handler unregistriert.
  if (functionStuff?.zoneActivation?.regionId) {
    try {
      dialog.addEventListener?.("close", () => {
        if (!zoneDialogClosedByButton) {
          game.symbaroum.api?.aoeZoneActivationAborted?.(functionStuff.zoneActivation.regionId);
        }
      });
    } catch (closeErr) {
      game.symbaroum.log("v2.12: zone activation close guard unavailable");
    }
  }
  // Hymnen-Paket 1.2: gleiche Wächter-Logik für die frisch platzierte
  // Gesangsfläche - X/ESC ohne Button-Callback räumen die Region ab,
  // wenn der Gesang nie startete (cleanupFreshHymnZone prüft das
  // Committed-Flag, das hymnResult im Erfolgspfad setzt).
  else if (functionStuff?.hymnZone?.regionId) {
    try {
      dialog.addEventListener?.("close", () => {
        if (!hymnDialogClosedByButton) {
          cleanupFreshHymnZone(functionStuff);
        }
      });
    } catch (hymnCloseErr) {
      game.symbaroum.log("Hymnen 1.2: Gesangsbereich-Close-Wächter nicht verfügbar");
    }
  }
  // Automatisierungspaket 1: Freier-Angriff-Toggle - Fenstertitel-Suffix
  // und das Ausblenden der aktiven Paket-Checkboxen folgen live dem Häkchen
  // (Muster A30: symbDialog startet das Rendern selbst; das erneute await
  // rendert sichtbar identisch und hängt die Listener erst danach an). Die
  // Callback-seitige Auswertung oben ist autoritativ, das hier ist Anzeige.
  if (isWeaponRoll) {
    try {
      Promise.resolve(dialog.render({ force: true })).then(
        () => {
          const faRoot = dialog.element;
          if (!faRoot) return;
          const faBox = faRoot.querySelector("#freeattack");
          if (!faBox) return;
          const faTitle = faRoot.querySelector(".window-title");
          const faSuppress = faRoot.querySelectorAll(".freeattack-suppress");
          const faApply = () => {
            const faOn = faBox.checked;
            if (faTitle) faTitle.textContent = baseDialogTitle + (faOn ? " — " + game.i18n.localize("CHAT.CRITICAL_FREEATTACK") : "");
            for (const faRow of faSuppress) {
              faRow.style.display = faOn ? "none" : "";
            }
            // v1.1 (Rudolfs Testrunde): Das Eigenschafts-Dropdown (castAt)
            // springt bei aktivem Freiem Angriff optisch auf Praezision und
            // zurueck auf die vorherige Wahl beim Abwaehlen - das harte
            // Praezision-Override wird so im Dialog sichtbar. Der Callback
            // oben bleibt autoritativ (castingAttributeName="accurate").
            const castAtSel = faRoot.querySelector("#castAt");
            if (castAtSel) {
              if (faOn) {
                if (!castAtSel.dataset.faPrev) castAtSel.dataset.faPrev = castAtSel.value;
                castAtSel.value = "accurate";
              } else if (castAtSel.dataset.faPrev) {
                castAtSel.value = castAtSel.dataset.faPrev;
                delete castAtSel.dataset.faPrev;
              }
            }
          };
          faBox.addEventListener("change", faApply);
        },
        () => {}
      );
    } catch (err) {
      game.symbaroum.log("Auto1: free-attack live display unavailable");
    }
  }
  // Ressourcen v1.4 (Diagnose-Runde, Rudolfs Wahl B - live gekoppelt): Die
  // Verbandsmaterial-Statuszeile im Medicus-Dialog ist LIVE an die
  // Diagnose-Checkbox (#exam) gekoppelt - beim Anhaken verschwindet die
  // Zeile (Diagnose verbraucht kein Verbandsmaterial und nimmt keinen −1
  // in Kauf), beim Abwaehlen kehrt sie zurueck. Der Submit-Code oben ist
  // autoritativ, das hier ist Anzeige. Ohne Ressourcenverbrauch-Setting
  // existiert die Zeile nicht - der Listener laeuft dann ins Leere.
  if (medicus && hasTarget) {
    try {
      Promise.resolve(dialog.render({ force: true })).then(
        () => {
          const diagRoot = dialog.element;
          if (!diagRoot) return;
          const examBox = diagRoot.querySelector("#exam");
          if (!examBox) return;
          const bandageRows = diagRoot.querySelectorAll(".bandage-status");
          if (!bandageRows.length) return;
          const examApply = () => {
            for (const row of bandageRows) row.style.display = examBox.checked ? "none" : "";
          };
          examBox.addEventListener("change", examApply);
        },
        () => {}
      );
    } catch (err) {
      game.symbaroum.log("v1.4: bandage status live coupling unavailable");
    }
  }
}

/* AoE v2.4 (Rudolfs Testrunde 4, Entscheidung a+b): Snapshot der Zonen-
   Aktivierung in die Region-Flags schreiben (aoe.activated + aoe.snap-
   shot). Läuft in buildRolls - dort stehen die finalen Werte des
   Standard-Würfeldialogs. zoneDialogModifier/zoneDialogFavour gibt
   modifierDialog direkt nach dem Feld-Read mit (freier Modifikator ohne
   ziel-spezifische Zusätze - der Snapshot gilt für ALLE künftigen
   Proben der Zonen-Instanz). One-Shot-Zonen (mode instant) enden nach
   der Aktivierung über endAfter (cancel der Dialoge lässt die Zone
   stehen - buildRolls lief nie). */
async function captureZoneActivationSnapshot(functionStuff) {
  try {
    const { regionId, sceneId, endAfter } = functionStuff.zoneActivation;
    const scene = game.scenes.get(sceneId) ?? game.scenes.viewed ?? null;
    const region = scene?.regions?.get(regionId) ?? null;
    const aoe = region?.flags?.symbaroum?.aoe;
    if (!region || !aoe || aoe.free) return;
    aoe.activated = true;
    const attributeName = functionStuff.castingAttributeName;
    const attributeValue = Number(functionStuff.actor?.system?.attributes?.[attributeName]?.total);
    aoe.snapshot = {
      attributeName,
      attributeValue: Number.isFinite(attributeValue) ? attributeValue : 10,
      modifier: Number(functionStuff.zoneDialogModifier ?? functionStuff.modifier) || 0,
      favour: Number(functionStuff.zoneDialogFavour ?? functionStuff.favour) || 0,
      /* v2.5 (Baustein d - Bannsiegel-Kategorie im Snapshot): die
         Kateogrie-Auswahl des Aktivierungsdialogs (Bannsiegel-Pfade)
         wandert mit in den Snapshot, damit Folge-Ausloesungen (Betreten,
         Maintain-Runde, Ausloese-Taste) dieselbe Kategorie verwenden,
         ohne dass der Spieler erneut gefragt wird oder die Kategorie im
         Folge-Pfad undefiniert bleibt (Rudolfs Testrunde 5, Punkt 12a). */
      sealCategoryId: functionStuff.sealCategoryId ?? null,
    };
    await region.setFlag('symbaroum', 'aoe', aoe);
    /* v2.5 (Baustein a - In-Flight-Guard): erst NACH dem Snapshot ist die
       Aktivierung abgeschlossen - die Guard-Map in aoe.js wird freigegeben
       (ENTER-Events, die während des Dialogs hereinschossen, laufen ab
       jetzt wieder normal in den Aktivierungs-/Snapshot-Pfad). */
    await game.symbaroum.api?.aoeZoneActivationCompleted?.(regionId, sceneId);
    if (endAfter) {
      await game.symbaroum.api?.aoeConcludeInstantZone?.(regionId, sceneId);
    }
  } catch (error) {
    console.warn('Symbaroum AoE: activation snapshot capture failed', error);
  }
}

/* v2.5 (Baustein e - Rueckbau der Zielmarkierungen): executeZonePower
   markiert die Zonenziele mit setTarget (sichtbare Fadenkreuze). Bei
   Zonen-Ausloesungen bleiben diese Markierungen nach der Ausfuehrung
   stehen - der Rueckbau fehlte komplett (Rudolfs Testrunde 5, Punkt 13).
   Dieser Helper entfernt die Markierungen aller zoneChainTargets-Ids
   einmalig, OHNE die Markierungen anderer Nutzer anzutasten
   (releaseOthers: false). Aufruf nach jedem resultFunction-Return im
   Zonen-Pfad (buildRolls und executeZonePower preset-Zweig). Ohne
   zoneChainTargets ist der Helper wirkungslos - normale Wuerfe
   behalten ihr Foundry-Standard-Verhalten. */
function releaseZoneTargets(functionStuff) {
  const ids = functionStuff?.zoneChainTargets;
  if (!ids || ids.size === 0) return;
  const scene = game.scenes.viewed;
  if (!scene) return;
  for (const tokenId of ids) {
    const tokenDoc = scene.tokens.get(tokenId) ?? scene.getEmbeddedDocument('Token', tokenId);
    tokenDoc?.object?.setTarget(false, { releaseOthers: false });
  }
}

export async function buildRolls(functionStuff) {
  game.symbaroum.log("...buildRolls", ...arguments);

  /* Kräfte-Paket 1 (Sphäre, Rudolfs Baufreigabe 21.11., Baustein C):
     (1) RAW-Endebedingung - greift der Marker-Halter an oder wirkt er
     eine andere mystische Kraft (Maintains ausgenommen, Adept-Hymnen-
     Präzedenz: "aktive mystische Effekte dürfen aufrechterhalten
     werden"), bricht die Sphäre automatisch zusammen (Marker weg +
     eigene Ergebnis-Karte).
     (2) Adept/Meister-Auto-Parade (Rudolfs Entscheidung 6): gegen den
     Marker-Halter gerichtete PHYSISCHE Angriffe verpuffen KOMPLETT
     WURFLOS - keine Probe, keine Schadenskarte, unbegrenzt pro Runde.
     Mystische Kräfte, AoE und Alternative-Schaden laufen regulär durch
     (dieses Gate feuert nur im Waffenpfad). */
  const ownSphereMarker = getSphereMarkerData(functionStuff.actor);
  if (ownSphereMarker) {
    if (
      functionStuff.combat === true ||
      (functionStuff?.type === "mysticalPower" &&
        functionStuff?.ability?.reference !== "sphere" &&
        !functionStuff.isMaintained &&
        !game.symbaroum.config.HYMN_REFERENCES.includes(functionStuff?.ability?.reference))
    ) {
      await functionStuff.actor.deleteEmbeddedDocuments("ActiveEffect", [
        ownSphereMarker.marker._id ?? ownSphereMarker.marker.id,
      ]);
      await postMaintainChainCard(
        functionStuff,
        `<h4>${game.i18n.localize("POWER_SPHERE.CHAT_END_TITLE")}</h4>`,
        [`<p>${game.i18n.format("POWER_SPHERE.CHAT_END", { actorname: functionStuff.actingCharName })}</p>`],
        []
      );
    }
  }
  const targetSphereMarker = getSphereMarkerData(functionStuff.targetData?.actor);
  if (functionStuff.combat === true && targetSphereMarker && targetSphereMarker.level >= 2) {
    await postMaintainChainCard(
      functionStuff,
      `<h4>${game.i18n.localize("POWER_SPHERE.CHAT_AUTOPARRY_TITLE")}</h4>`,
      [`<p>${game.i18n.format("POWER_SPHERE.CHAT_AUTOPARRY", { targetname: functionStuff.targetData.name })}</p>`],
      []
    );
    return null;
  }

  /* AoE v2.4 (Rudolfs Testrunde 4, Entscheidungen a+b): Zonen-AKTIVIE-
     RUNG - buildRolls läuft hier mit den finalen Werten (Dialog-Modi-
     fikator/Gunst stehen in functionStuff). Der Snapshot (Wirkattributs-
     wert + Dialog-Modifikator + Dialog-Gunst) wird in die Region-Flags
     geschrieben und markiert die Zone als aktiviert (aoe.activated):
     jede Folge-Auslösung würfelt die Ziel-Token gegen diesen Snapshot
     statt die Kraft neu zu wirken (kein Dialog, keine Korruption mehr). */
  if (functionStuff?.zoneActivation?.regionId) {
    await captureZoneActivationSnapshot(functionStuff);
  }

  /* Hymnen-Paket v1 (RAW-literal, Rudolfs Detail-Antwort 2b): Jede
     ANDERE mystische Kraft - Erstzauber, Maintain-Runde oder Zonen-
     Aktivierung, jeder buildRolls-Lauf - beendet die Maintain-Funktion
     eines laufenden Gesangs (Kampfhymne/Heldenhafte Hymne) automatisch.
     Eigene Hymnen-Runden sind ausgenommen; Willenskraft-Schaden als
     Abbruchgrund bleibt SL-verwaltet (dokumentierte Grenze). */
  if (functionStuff?.type === "mysticalPower" && !game.symbaroum.config.HYMN_REFERENCES.includes(functionStuff?.ability?.reference)) {
    await endActiveHymns(functionStuff.actor);
  }

  /* Hymnen-Paket 1.2: Die interaktive Platzierung des Gesangs-
     bereichs läuft NICHT mehr hier im buildRolls-Haken, sondern VOR
     dem Gesangsdialog über den Ausführungsdialog (aoe.js maybe-
     ZoneExecutionChoice, „Sichtweite | Zone platzieren | Abbrechen“,
     Rudolfs Entscheidung 4); usePower übernimmt die frisch platzierte
     Region über die aoe.js-Pending-Map (actor.js). Die 1.1-Version
     übergab versehentlich functionStuff.ability - laut getFunction-
     StuffDefault NUR die System-DATEN des Items, nicht das Item-
     Dokument. placeHymnZone/getZoneConfig lasen damit auf undefined
     und brachen STILL ab ({configured: false}): keine Platzierung,
     Sichtweiten-Fallback (alle Token der Testszene), kein Actor-
     Flag, kein Maintain-Re-Scan, kein Region-Aufräumen - Rudolfs
     Testrunde v1.1, P6/P7/P8 aus EINER Wurzel. */
  if (functionStuff.casting === game.symbaroum.config.CASTING_NOT && !functionStuff.isMaintained) {
    // A25 stage 4: a CASTING_NOT power can define its own result function
    // (Black Breath rolls d4/d6 against the total corruption) - every
    // other CASTING_NOT power keeps the standard result without a roll
    const resultFunction = getPowerResultFunction(functionStuff);
    const res = await resultFunction(null, functionStuff);
    /* v2.5 (Baustein e): Zielmarkierungen der Zonen-Ausfuehrung nach
       dem Ergebnis freigeben (nur Zonen-Pfade mit zoneChainTargets). */
    releaseZoneTargets(functionStuff);
    return res;
  }
  let isWeaponRoll = functionStuff.combat;
  let rollData = [];
  if (isWeaponRoll) {
    for (let j = 1; j <= functionStuff.numberofAttacks; j++) {
      rollData.push(
        await baseRoll(
          functionStuff.actor,
          functionStuff.castingAttributeName,
          functionStuff.targetData.actor,
          functionStuff.targetData.resistAttributeName,
          functionStuff.favour,
          functionStuff.modifier,
          functionStuff.resistRoll
        )
      );
    }
  } else if (functionStuff.targetData.hasTarget && !functionStuff.notResisted) {
    // A24-F2: Anathema is probed against the ORIGINATOR's snapshotted
    // willpower (displayed with the originator's name, default 11 for an
    // unknown originator), not against the target's own resist attribute
    const isAnathema = functionStuff.ability?.reference === "anathema";
    rollData.push(
      await baseRoll(
        functionStuff.actor,
        functionStuff.castingAttributeName,
        isAnathema ? anathemaResistActor(functionStuff.targetData.token?.actor) : functionStuff.targetData.actor,
        isAnathema ? "resolute" : functionStuff.targetData.resistAttributeName,
        functionStuff.favour,
        functionStuff.modifier,
        functionStuff.resistRoll
      )
    );
  } else {
    rollData.push(await baseRoll(functionStuff.actor, functionStuff.castingAttributeName, null, null, functionStuff.favour, functionStuff.modifier, functionStuff.resistRoll));
  }
  if (isWeaponRoll) {
    const weaponRes = await attackResult(rollData, functionStuff);
    /* B1.2 (Rudolfs Testrunde v1.1, Punkt 12 + Freigabe 26.11.2026):
       Knochengeschoss "Zwei Ziele" - das zweite Projektil feuert als
       eigene Karte auf ein FRISCH markiertes Ziel. Rudolfs Verweis auf
       den funktionierenden Kettendialog bei den Kraeften (chainSequence-
       Result): nach der ersten Karte (inkl. ihrer Reaktionskarten) fragt
       "Weiteres Ziel fuer Kette?", die SL markiert neu, dann laeuft der
       zweite Wurf als Sub-Lauf im Doppelschlag-Muster (Klon erbt Waffe/
       Rider/Modifikatoren, Meister-Bonus je Projektil ueber mm2Attacker-
       Traits automatisch je Karte), AUCH bei Fehlschlag des ersten
       Projektils (RAW: unabhaengige Projektile). Die Kette haengt
       BEWUSST hier im buildRolls-Waffen-Ast und NICHT in attackResult:
       attackResult erzeugt Sub-Karten als functionStuff-Klone (Freier
       Angriff, Riposte, Doppelschlag), die den Marker sonst ERBEN und
       die Kette erneut feuern wuerden; hier feuert sie GENAU EINMAL je
       Wurf-Submit. Abbruch oder keine frische Markierung: das zweite
       Projektil verfaellt (SL-Sache, Praezedenz Kraefte-Kette); kein
       Ziel doppelt in EINER Kette (handled-Set) - fuer einen weiteren
       Schuss auf dasselbe Ziel die Zeile erneut klicken. isBoneSecond
       ist die Rekursions-Sperre. */
    if (
      functionStuff.mm2BoneSplit &&
      !functionStuff.isBoneSecond &&
      functionStuff.weapon?.reference === "boneprojectile" &&
      functionStuff.targetData?.hasTarget
    ) {
      /* Waffen-functionStuff hat KEIN abilityName (nur introText) - der
         Kettendialog kriegt einen flachen Klon mit dem Merkmals-Label
         als Titel, ohne functionStuff selbst zu mutieren. */
      const boneChainPrompt = Object.assign({}, functionStuff, {
        abilityName: game.i18n.localize("TRAIT_LABEL.BONEPROJECTILE"),
      });
      const boneContinue = await glyphNextTargetConfirmation(boneChainPrompt, "DIALOG.CHAIN_NEXT_TARGET");
      if (boneContinue) {
        const boneHandled = new Set([functionStuff.targetData.tokenId]);
        const nextBoneToken = Array.from(game.user.targets).find(
          (token) => token.actor && !boneHandled.has(token.id)
        );
        if (!nextBoneToken?.actor) {
          ui.notifications.warn(game.i18n.localize("DIALOG.CHAIN_NO_NEW_TARGET"));
        } else {
          const fsBoneSecond = Object.assign({}, functionStuff, {
            isBoneSecond: true,
            numberofAttacks: 1,
            targetData: buildGlyphTargetData(nextBoneToken, functionStuff.targetData.resistAttributeName),
          });
          fsBoneSecond.introText = functionStuff.introText + game.i18n.localize("TRAIT_BONEPROJECTILE.CHAT_SECOND_SHOT");
          const rdBoneSecond = await baseRoll(
            functionStuff.actor,
            functionStuff.castingAttributeName,
            nextBoneToken.actor,
            functionStuff.targetData.resistAttributeName,
            functionStuff.favour,
            functionStuff.modifier,
            false
          );
          await attackResult([rdBoneSecond], fsBoneSecond);
        }
      }
    }
    return weaponRes;
  } else {
    const resultFunction = getPowerResultFunction(functionStuff);
    /* Trollsingen-Reroll (Hymnen-Paket v1, Rudolfs Entscheidungen 8+10,
       Erstbau - Variante a): Eligibility NUR im Standard-Pfad (result-
       Function === standardPowerResult); Ketten, Auren, Zonen-Aktivie-
       rungen und Waffen bleiben bewusst ohne Taste (dokumentierte
       Grenze). Der Payload ist der bereinigte functionStuff-Schnapp-
       schuss (resistRoll-Muster: Dokument-Referenzen genullt), die
       Kosten sind bereits bezahlt (TEMPCORRUPTION_NONE). */
    if (resultFunction === standardPowerResult && !functionStuff.zoneActivation) {
      const payload = trollRerollPayload(functionStuff, rollData);
      if (payload) functionStuff.trollRerollPayload = payload;
    }
    const res = await resultFunction(rollData, functionStuff);
    /* v2.5 (Baustein e): Zielmarkierungen der Zonen-Ausfuehrung nach
       dem Ergebnis freigeben (nur Zonen-Pfade mit zoneChainTargets). */
    releaseZoneTargets(functionStuff);
    return res;
  }
}

/* A16 chain powers: scripted powers that strike one target after another
   (Staff Projectile master, Banishing Seal). buildRolls only rolls the opposed
   test against the primary target; the result functions below continue the
   sequence. v2.11 (Rudolfs Testrunde 10, P11): Stabgeschoss läuft auf
   FRISCHES ZIELEN (A36V-Muster wie chainSequenceResult) - die Vorauswahl
   liefert nur das PRIMÄRZIEL, jedes Folgeziel wird nach „Weiteres Ziel?"
   über eine NEUE Markierung gewählt (siehe staffProjectileChainResult).
   v2.10 (Rudolfs v2.10-Entscheidung, Vault-RAW): Stabgeschoss stoppt NICHT
   beim ersten Miss - der frühere Stopp war eine unbe-
   absichtigte Abweichung; im Zonen-Batch (zoneChainTargets) entfällt die
   je-Ziel-Bestätigung dialogfrei und die Kette deckelt auf multipleTargetsNb
   Ziele. Chain targets pay corruption per target
   on the initial casting (A20); maintaining later costs nothing.
   A19: the Kette powers Anathema, Brimstone Cascade and Black Bolt (Adept+) use
   the same mechanism with targets marked one after another (see
   chainSequenceResult below).
   A23: while maintaining, the test runs for every target the caster still holds
   a status symbol on, found by a scene scan (see maintainChainResult below).
   A25: further chain powers join the mechanism (Entangling Vines Adept+,
   Confusion, Maltransformation, Blinding Symbol and Mind Throw Master -
   see entanglingVinesChainResult and its siblings below); Entangling Vines
   at Adept probes its follow-ups unopposed (GRW). */
function getPowerResultFunction(functionStuff) {
  // Segen & Lasten S1: Ertrags-Result-Funktionen (Buschwissen, Unternehmen)
  // hängen am functionStuff - der Hook greift vor der Referenz-Dispatch
  if (functionStuff.boonResultFunction) return functionStuff.boonResultFunction;
  /* MM-Paket 2 v1 (Rudolfs Baufreigabe 24.11.2026, Konzept Rev. 2):
     Die klickbaren Kampfkontroll-Merkmale laufen OHNE eigenen Wurf
     (CASTING_NOT, traitSetup*) direkt in ihre je Merkmal eigene
     Karten-Maschine (Baustein 6 + Steckbriefe §3): Netz = SL-Wahl-
     dialog Netzzone/Netz-Geschosse (Konzept Runde 3 Teil B),
     Cross-Flag-Waffen
     (v1.2, Konzept Runde 3: Greifzunge/Greifklauen/Giftspucke/
     Knochengeschoss) = STANDARD-Waffendialog der Merkmals-eigenen
     Waffe, Rammen = SL-Kettendialog, Blitzschnell = Hinweiskarte (die
     eigentliche Reaktion sitzt auf der Angriffs-Ergebniskarte). */
  switch (functionStuff.ability?.reference) {
    case "web":
      return mm2WebFlow;
    /* MM-Paket 2 v1.2 Cross-Flag-Waffen (Konzept Runde 3, Teil A - Commit 1,
       Rudolfs Entscheidung A-3 "Kachel behalten"): Kachel-Klick oeffnet den
       STANDARD-Waffendialog der Cross-Waffe - dieselbe Zeile wie im Kampf-Tab,
       die v1/v1.1-Preset-Flows auf der unbewaffneten Waffe sind ENTFERNT. */
    case "grapplingtongue":
    case "prehensileclaws":
    case "poisonspit":
    case "boneprojectile":
      return mm2CrossWeaponFlow;
    case "rampage":
      return mm2RampageChain;
    case "swift":
      return mm2SwiftInfo;
  }
  switch (functionStuff.ability?.reference) {
    case "staffprojectile":
      return staffProjectileChainResult;
    case "banishingseal":
      /* v2.8.1 G7: Der Bannsiegel-Zauber legt die Zone (Erstgesang je
         Feind der Region, Kategorie-Filter); die alte SL-Zielkette
         (banishingSealChainResult) laeuft nicht mehr - ihr Flucht- und
         Schadens-Muster lebt im Erstgesang weiter.
         v2.8.3: Ausfuehrungs-Dialog „Manuell" = klassischer Einzel-
         ziel-Zauber ohne Zone (Rudolfs Testrunde v2.8.2, 2). */
      return functionStuff.symbolZoneManual ? standardPowerResult : symbolZoneResult;
    case "drainingglyph":
      /* v2.1 F22 (Hymnen-Ablauf): Maintain-Runde = Standard-Kette plus
         glypheRegionRescan (Joiner/Leaver des Glyphen-Kreises). */
      return functionStuff.isMaintained ? drainingGlyphMaintainResult : drainingGlyphResult;
    case "anathema":
      return functionStuff.powerLvl.level > 1 && !functionStuff.isMaintained ? anathemaChainResult : standardPowerResult;
    case "brimstonecascade":
      return functionStuff.powerLvl.level > 1 && !functionStuff.isMaintained ? brimstoneCascadeChainResult : standardPowerResult;
    case "blackbolt":
      return functionStuff.powerLvl.level > 1 && !functionStuff.isMaintained
        ? blackboltChainResult
        : functionStuff.isMaintained
          ? maintainChainResult
          : standardPowerResult;
    // A25: further chain powers - first casting chains, maintaining runs as
    // the A23 maintain chain with the per-target repeated test
    case "entanglingvines":
      return functionStuff.powerLvl.level > 1 && !functionStuff.isMaintained
        ? entanglingVinesChainResult
        : functionStuff.isMaintained
          ? maintainChainResult
          : standardPowerResult;
    case "confusion":
      return functionStuff.powerLvl.level > 2 && !functionStuff.isMaintained
        ? confusionChainResult
        : functionStuff.isMaintained
          ? maintainChainResult
          : standardPowerResult;
    case "maltransformation":
      return functionStuff.powerLvl.level > 2 && !functionStuff.isMaintained
        ? maltransformationChainResult
        : functionStuff.isMaintained
          ? maintainChainResult
          : standardPowerResult;
    // A25 stage 2: Blinding Symbol chains on every level (APG novice text);
    // Mind Throw chains at Master only with a marked target - the object
    // attack without a target stays a local roll
    case "blindingsymbol":
      /* v2.8.1 G7 (Glyphe-Muster drainingGlyphMaintainResult): Erst-
         zauber = symbolZoneResult (Platzierung + Erstgesang), Maintain-
         runde = Standard-Kette plus Zonen-Rescan (Joiner/Leaver der
         Maintain-Stufen ab Adept). Die alte SL-Zielkette entfaellt.
         v2.8.3: Ausfuehrungs-Dialog „Manuell" = klassischer Einzel-
         ziel-Zauber ohne Zone (Rudolfs Testrunde v2.8.2, 2). */
      return functionStuff.symbolZoneManual
        ? standardPowerResult
        : functionStuff.isMaintained
          ? symbolZoneMaintainResult
          : symbolZoneResult;
    case "mindthrow":
      return functionStuff.powerLvl.level > 2 && !functionStuff.isMaintained && functionStuff.targetData?.hasTarget
        ? mindThrowChainResult
        : standardPowerResult;
    // A25 stage 4: the Ketten-Runde package 1 powers. Earthbinding and
    // Battle Symbol maintain through the A23 maintain chain (the escape /
    // rage tests repeat per bound or berserk target; from Master on the
    // still-held targets of a chainRoundDamage power also take their
    // per-round damage there, A25 F8), their first castings chain -
    // Earthbinding from Adept on only (A25 F8 fix: the Novice level no
    // longer chains, mirroring the Entangling Vines gate); Battle Symbol
    // (every level - the novice text already describes the chain) chains on
    // every level; Mark of Torment chains on every level without any
    // maintain; True Form chains from Adept on; Black Breath dispatches to
    // its own corruption comparison on every level (no probe, no maintain);
    // Levitate chains allies at Master - and maintaining NEVER chains
    // (A25 F2, Rudolf's test round): the concentration hold runs for every
    // levitating creature at once (levitateMaintainResult)
    case "earthbinding":
      return functionStuff.powerLvl.level > 1 && !functionStuff.isMaintained
        ? earthbindingChainResult
        : functionStuff.isMaintained
          ? maintainChainResult
          : standardPowerResult;
    case "battlesymbol":
      /* v2.8.1 G7: wie Blendendes Symbol - Maintain-Stufen (ab Adept)
         rescanen die Zone je Runde, der Rest laeuft sofort.
         v2.8.3: Ausfuehrungs-Dialog „Manuell" = klassischer Einzel-
         ziel-Zauber ohne Zone (Rudolfs Testrunde v2.8.2, 2). */
      return functionStuff.symbolZoneManual
        ? standardPowerResult
        : functionStuff.isMaintained
          ? symbolZoneMaintainResult
          : symbolZoneResult;
    // Hymnen-Paket 1.5: Schwaechende Hymne (Erstgesang mit je-Feind-
    // Proben; die A29-Maintain-Runde laeuft still ueber preDialog-
    // WeakeningHymnChoice und erreicht den Dispatch nie) und Dornen-
    // mantel (Toggle-Aktivierung/-Deaktivierung ueber den CASTING_NOT-
    // Pfad von buildRolls und den Deaktivierungs-Dialog).
    case "weakeninghymn":
      return functionStuff.isMaintained ? standardPowerResult : weakeningHymnResult;
    case "thorncloak":
      return thornCloakResult;
    case "blackbreath":
      return blackbreathChainResult;
    case "trueform":
      return functionStuff.powerLvl.level > 1 ? trueformChainResult : standardPowerResult;
    case "markoftorment":
      /* A33: novice/adept maintain rounds run the maintain chain (the stun
         symbols stay while maintained); the master one-shot has NO
         maintain by Rudolf's rule.
         v2.8.1 G7 (Glyphe-Muster): Erstzauber mit Zonen-Platzierung,
         Maintain-Runden (Novize/Adept) als Standard-Kette plus Zonen-
         Rescan, Meister ausserdem als sofort-Stufe (Bewegungs-Tracker,
         config SYMBOL_ZONE_IMMEDIATE_LEVELS). Die alte SL-Zielkette
         (markoftormentChainResult) laeuft nicht mehr.
         v2.8.3: Ausfuehrungs-Dialog „Manuell" = klassischer Einzel-
         ziel-Zauber ohne Zone (Rudolfs Testrunde v2.8.2, 2). */
      return functionStuff.symbolZoneManual
        ? standardPowerResult
        : functionStuff.isMaintained
          ? symbolZoneMaintainResult
          : symbolZoneResult;
    case "levitate":
      return functionStuff.isMaintained
        ? levitateMaintainResult
        : functionStuff.powerLvl.level > 2
          ? levitateChainResult
          : standardPowerResult;
    // A32: Earth Shot (Adept+) throws its 1d4 rocks as separate attacks
    // (one opposed test per rock), Prios' Burning Glass (Adept+) focuses
    // every enemy in sight with ONE unopposed Resolute probe and a damage
    // roll per target - both powers have no maintain (GRW), the Novice
    // levels stay with the standard result
    case "earthshot":
      return functionStuff.powerLvl.level > 1 ? earthshotResult : standardPowerResult;
    case "priosburningglass":
      return functionStuff.powerLvl.level > 1 ? priosBurningGlassResult : standardPowerResult;
    // A36-Verbraucher (Heilige Aura): every level runs the automated aura
    // flow - the cast places the aura symbols (see holyAuraResult), the
    // maintain rounds keep them alive and the failed roll removes them
    case "holyaura":
      return holyAuraResult;
    /* Hymnen-Paket v1 (Rudolfs Startsignal „Leg los“ 16.11.2026): Die
       Kampfhymne und die Heldenhafte Hymne laufen über die gemeinsame
       hymnResult - Erstgesang (kein Wurf, CASTING_NOT) plaziert die
       Verbündeten-Symbole inklusive Sänger und löst den Meister-Effekt
       aus. Hymnen-Paket 1.4: Die Maintain-Runden würfeln NICHT mehr
       (APG-Abgleich: keine Probe beim Aufrechterhalten) - sie laufen
       wurflos und still über preDialogHymnChoice (nur Re-Scan). */
    case "combathymn":
    case "heroichymn":
      return hymnResult;
    // v2.12 (Gruppe C, Rudolfs Freigabe 15.11.): Unheilige Aura = 1:1-
    // Spiegel der Heiligen Aura (every level runs the automated mirror
    // flow); Fegefeuer und Lebenspender trennen die Meister-REAKTIONS-
    // Aktivierung (Aura-Symbol auf dem Mystiker) von den aktiven Stufen
    // (Opfer-Zwangswürfe bzw. Korruptions-Waschung).
    case "unholyaura":
      return unholyAuraResult;
    case "purgatory":
      return functionStuff.powerLvl.level > 2 ? purgatoryMasterResult : purgatoryResult;
    // AoE-Rest Paket 1: Flammenwand - Aktivierung und jede Ausloesung
    // (Enter/Anfangsbestand) laufen ueber flamewallResult (1W12 Feuer
    // je Opfer), Maintain-Runden bleiben wurflos (keine Symbole)
    case "flamewall":
      return flamewallResult;
    case "lifegiver":
      return functionStuff.powerLvl.level > 2 ? lifegiverMasterResult : lifegiverResult;
    // Kräfte-Paket 2 „Sprung & Schuss": Sturmpfeil setzt das Bestands-Flag
    // nur bei bestandener Aktivierung; Teleport hängt Erfolgs-Buchungen
    // (Reiseschaden/Mitreisender) und SL-Hinweiskarten an die Standard-Karte
    case "stormarrow":
      return stormarrowResult;
    case "teleport":
      return teleportResult;
    default:
      return standardPowerResult;
  }
}

/* v2.3 (Rudolfs Testrunde 3, Punkt 7 - Kettendialog-Auto-Ende): Bei
   Zonen-Ausloesungen (executeZonePower) stehen ALLE Zonenziele von Anfang
   an fest (functionStuff.zoneChainTargets, Token-Ids). Sobald die Kette
   jeden von ihnen abgearbeitet hat, springt dieser Guard die 'Weiteres
   Ziel?'-Bestaetigung UEBER - der Dialog fragte sonst nach dem letzten
   Zonenziel ins Leere (Rudolfs Testrunde-3-Befund). Ohne zoneChainTargets
   (normales Wirken) ist der Guard wirkungslos; die Zonen-Ziele laufen in
   der Ketten-Schleife (chainSequenceResult/staffProjectileChainResult)
   ohnehin dialogfrei und brauchen keinen Guard. */
function zoneChainDone(functionStuff, handled) {
  const zoneTargets = functionStuff?.zoneChainTargets;
  if (!zoneTargets || zoneTargets.size === 0) return false;
  for (const tokenId of zoneTargets) {
    if (!handled?.has(tokenId)) return false;
  }
  return true;
}

/* v2.5 (Baustein b - Mehrziel-Aktivierung ohne Kettendialog): Bei
   Zonen-Ausloesungen (executeZonePower) stehen alle Ziele von Anfang an
   fest und werden automatisch in Zielwahl-Reihenfolge abgearbeitet.
   Dieser Wrapper unterdrueckt daher die 'Weiteres Ziel?'-Bestaetigung
   fuer ALLE call-sites, sobald zoneChainTargets gesetzt ist: es
   bleiben noch unhandled Ziele uebrig, wird true geliefert (Kette
   laeuft weiter, ganz ohne Dialog); ist die Kette durch, liefert false
   (zoneChainDone-Guard greift ohnehin). Ohne zoneChainTargets (normales
   Wirken) verhaelt sich der Helper 1:1 wie glyphNextTargetConfirmation
   - der Kettendialog bleibt dort unberuehrt. */
async function zoneChainContinue(functionStuff, questionKey) {
  if (functionStuff?.zoneChainTargets?.size > 0) return true;
  return glyphNextTargetConfirmation(functionStuff, questionKey);
}

/* v2.11 (Rudolfs Testrunde 10, P11 + Freigabe): Die MANUELLE Meister-Kette
   des Stabgeschosses läuft auf FRISCHES ZIELEN umgestellt (A36V-Bannsiegel-
   Muster, wie chainSequenceResult): Nach dem Primärwurf fragt die Kette je
   Folgeziel „Weiteres Ziel?“ (DIALOG.CHAIN_NEXT_TARGET über zoneChainContinue)
   und der Spieler markiert das nächste Ziel NEU - die Vorauswahl vor dem
   Würfeln liefert nur noch das Primärziel (preDialogStaffProjectile).
   Bisher galt das A16-Vorauswahl-Modell (functionStuff.chainTargets, je-Ziel-
   Bestätigung mit Zielname + Würfel über die v2.10-Funktionen chainResult/
   chainTargetConfirmation): Die Kette traf nur vor dem Würfeln markierte
   Ziele - mit einer einzigen Marke lief nie ein Kettendialog (Rudolfs
   P11-Befund „kein Kettendialog nach erstem Ziel“). Beide Funktionen sind
   damit ohne Nutzer und ENTFERNT (Fork-Konvention: toter Code fliegt raus,
   Muster v2.7-Kettencheck-Rückbau).

   RAW unverändert aus v2.10: kein Stopp bei Miss (Vault-Notiz), Schadens-
   leiter 1W10 → 1W8 → 1W6 → 1W4 (min 1W4), Deckel multipleTargetsNb
   (5 Ziele gesamt = Primärziel + max 4 Folgeziele). Die Kette ist Teil
   EINES Wirkens: je Folgeziel keine erneute Korruption (das Setup bucht
   die Kosten des Wirkens auf dem Primärwurf, A16). Im Zonen-Batch bleibt
   alles dialogfrei (zoneChainTargets, zoneChainDone/zoneChainContinue
   greifen wie bei chainSequenceResult): Die Zonen-Ziele stehen als
   Nutzer-Markierungen (executeZonePower), die Kette arbeitet sie ab,
   bis alle behandelt sind oder der RAW-Deckel greift - Verhalten und
   Deckel identisch zur v2.10-Zonen-Auslösung (P10 der Testrunde 10 grün). */
async function staffProjectileChainResult(rollData, functionStuff) {
  // Primärziel: Standardverhalten (Chat, 1W12-Schaden aus dem Setup, Korruption, Effekte)
  await standardPowerResult(rollData, functionStuff);
  // Vorteil gilt nur für den ersten Angriff
  functionStuff.hasAdvantage = false;
  const dice = ["1d10", "1d8", "1d6", "1d4"];
  /* v2.10-RAW-Deckel (multipleTargetsNb): 5 Ziele gesamt = Primärziel +
     max 4 Folgeziele - Parität zwischen Manuell und Zonen-Batch. */
  const maxFollowUps = Number.isFinite(functionStuff.multipleTargetsNb)
    ? Math.max(0, functionStuff.multipleTargetsNb - 1)
    : dice.length;
  if (maxFollowUps <= 0) return;
  const savedCorruption = functionStuff.corruption;
  const savedDamageDice = functionStuff.damageDice;
  // die Kette ist Teil eines Wirkens: je Folgeziel keine erneute Korruption
  functionStuff.corruption = game.symbaroum.config.TEMPCORRUPTION_NONE;
  const handled = new Set([functionStuff.targetData.tokenId]);
  let followUps = 0;
  while (
    followUps < maxFollowUps &&
    !zoneChainDone(functionStuff, handled) &&
    (await zoneChainContinue(functionStuff, "DIALOG.CHAIN_NEXT_TARGET"))
  ) {
    const nextToken = Array.from(game.user.targets).find((token) => !handled.has(token.id));
    if (!nextToken) {
      ui.notifications.warn(game.i18n.localize("DIALOG.CHAIN_NO_NEW_TARGET"));
      break;
    }
    handled.add(nextToken.id);
    followUps++;
    // Schadensleiter je Folgeziel (min 1W4, v2.10-RAW)
    functionStuff.damageDice = dice[Math.min(followUps - 1, dice.length - 1)];
    functionStuff.targetData = buildGlyphTargetData(nextToken, functionStuff.targetResistAttribute ?? "defense");
    const rollDataNext = [
      await baseRoll(
        functionStuff.actor,
        functionStuff.castingAttributeName,
        nextToken.actor,
        functionStuff.targetData.resistAttributeName ?? "defense",
        functionStuff.favour,
        functionStuff.modifier,
        false
      ),
    ];
    // kein Stopp bei Miss (v2.10-RAW, Vault-Notiz) - die Kette läuft weiter
    await standardPowerResult(rollDataNext, functionStuff);
  }
  functionStuff.corruption = savedCorruption;
  functionStuff.damageDice = savedDamageDice;
}

/* v2.7 (Testrunde 7, Rudolfs Schritt 2, stufenunabhängig): Prüfung der
   gewählten Kategorie gegen ein Ziel bei der WAHL (manueller Wirk-Dialog
   gegen das Primärziel). Fehlkategorie = Warnung + Abbruch - für ALLE
   Stufen, ohne den v2.6-Adept/Master-Kartenschaden-Pfad (sealPrimaryMismatch
   entfällt komplett, Rudolfs v2.7-Spec „Warnung und Abbruch"). Eine leere
   Wahl („keine Kategorie") hält den Check deaktiviert (SL-Buchhaltung). */
function banishingSealPrimaryCategoryCheck(functionStuff) {
  if (functionStuff.ability?.reference !== "banishingseal" || !functionStuff.sealCategoryId) return true;
  const primaryActor = functionStuff.targetData?.actor ?? functionStuff.targetData?.token?.actor;
  if (!primaryActor) return true;
  if (game.symbaroum.config.getCreatureCategory(primaryActor) === functionStuff.sealCategoryId) return true;
  const targetname = functionStuff.targetData?.name ?? primaryActor.name ?? "";
  /* v2.1 F24 (Rudolfs Testrunde v2, G6): Warnung als gefluesterte
     SL-Karte statt als Toast - die Meldung bleibt als Chat-Beleg
     stehen (postAuraSkipDiagCard-Muster). Fire-and-forget: Die Pruef-
     Funktion bleibt synchron, ein Karten-Fehler wirft nie in den
     Ablauf zurueck. */
  void postSealCategoryGmCard([`<p>${game.i18n.format("POWER_BANISHINGSEAL.WARN_CATEGORY_MISMATCH", { targetname: targetname })}</p>`], functionStuff?.actor ?? null).catch(() => {});
  return false;
}

/* v2.1 F24 (Rudolfs Testrunde v2, G6 - "Warnmeldungen wegen falscher
   Kategorie in GM-Karte uebertragen. Warnmeldungen loeschen."): Die
   Fehlkategorie-Hinweise des Bannsiegels laufen als EINE gefluesterte
   SL-Karte statt als Toast-Warnungen - die Meldung bleibt als Chat-
   Beleg stehen und der Bildschirm flutet nicht (postAuraSkipDiag-
   Card-Muster). Empfaenger: aktive GMs plus der ausloesende Nutzer
   (ein abbrechender Spieler-Wirker sieht die Begruendung seines
   Abbruchs); Exportiert fuer die beiden Zonen-Stellen in aoe.js. */
export async function postSealCategoryGmCard(lines, actor = null) {
  if (!Array.isArray(lines) || lines.length === 0) return;
  const titleHtml = `<h4>${game.i18n.localize("POWER_BANISHINGSEAL.GM_CARD_TITLE")}</h4>`;
  const body = lines.map((line) => `<div class="finalTxt">${line}</div>`).join("");
  const html = `<div class="symbaroum chat ability"><div class="foreground">${titleHtml}${body}</div></div>`;
  const targets = new Map();
  for (const user of game.users) {
    if (user.active && user.isGM) targets.set(user.id, user.id);
  }
  targets.set(game.user.id, game.user.id);
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ alias: game.user.name, ...(actor?.id ? { actor: actor.id } : {}) }),
    content: html,
    whisper: [...targets.values()],
  });
}

/* v2.7 (Testrunde 7, Rudolfs RAW-Bestätigung, Musterablauf v1.1 Schritt 9):
   Schadensfall der misslungenen Bann-Probe gegen ein Ziel des GEWÄHLTten
   Typs: Novize KEIN Schaden (die Kraft endet), Adept 1W4 / Meister 1W8
   Schaden, ignoriert Rüstung (toughnessChange, SL-Anwenden-Karte). */
async function banishingSealDamageCard(functionStuff, targetData) {
  const level = functionStuff.powerLvl?.level ?? 1;
  const dice = level >= 3 ? "1d8" : "1d4";
  const damageRoll = await new Roll(dice).evaluate();
  await createModifyTokenChatButton([
    {
      tokenId: targetData?.tokenId,
      actorId: targetData?.actor?.id,
      toughnessChange: -damageRoll.total,
      label: game.i18n.format("POWER_BANISHINGSEAL.CHAT_DAMAGE", { dice: dice, total: damageRoll.total }),
    },
  ]);
  return damageRoll.total;
}

/* v2.7: Ausgang einer misslungenen Bann-Probe im Ketten-Kontext. Rückgabe:
   'continue' (Kette läuft weiter), 'end' (Kette endet), 'zoneEnded' (Kette
   endet, die Zone wurde bereits beendet).
   - Manuell: die Kette ENDET (RAW „until a test fails"); Adept/Meister
     nehmen vorher die Schadenskarte.
   - Zonen-Batch (Aktivierung, zoneActivation gesetzt): Novize endet
     Kette UND Zone (Rudolfs Schritt 9: Kraft + Zone enden), Adept/Meister
     laufen mit Schadenskarte weiter. */
async function banishingSealFailedProbe(functionStuff, targetData) {
  const level = functionStuff.powerLvl?.level ?? 1;
  const isZoneBatch = !!functionStuff.zoneActivation?.regionId;
  if (level > 1) {
    await banishingSealDamageCard(functionStuff, targetData);
    return isZoneBatch ? "continue" : "end";
  }
  if (isZoneBatch) {
    await game.symbaroum.api?.aoeEndZone?.(functionStuff.zoneActivation.regionId, functionStuff.zoneActivation.sceneId);
    return "zoneEnded";
  }
  return "end";
}

async function banishingSealChainResult(rollData, functionStuff) {
  // A36V test round (Rudolf, 25.10.): the seal's chain no longer needs a
  // multi-selection made BEFORE the casting - after the primary target's
  // card a glyph-style confirmation asks for the next target (fresh
  // targeting per target, the Brennglas pattern he asked for), every
  // follow-up is its own opposed test, and the follow-ups cost no further
  // corruption (one casting). Targets that fell to the seal flee: each gets
  // the Verängstigt symbol via ONE GM apply card - the combat tracker stays
  // untouched, the SL removes fleeing combatants manually (Rudolf's choice).
  /* v2.7 (Testrunde 7, Rudolfs v2.7-Spec „EINE GM-Karte pro Vorgang"):
     der Sammel-Modus hält ALLE GM-Anwendungseinträge des Vorgangs -
     Korruption + Bannsiegel-Symbol je Standardkarte, Schadenskarten des
     v2.7-RAW-Schadensfalls, Verängstigt am Ende - zurück und versendet
     sie als EINE GM-Anwenden-Karte mit sichtbarer Liste (Testrunde 7,
     P2d: zwei getrennte GM-Karten je Vorgang). */
  beginGmCardCollection();
  try {
    await standardPowerResult(rollData, functionStuff);
    const fleeing = [];
    if (rollData?.[0]?.trueActorSucceeded) {
      fleeing.push(functionStuff.targetData.tokenId);
    } else {
      /* v2.7 (Schadensfall, RAW): misslingt die Probe gegen das Ziel des
         gewählten Typs endet der Novize ohne Schaden, Adept/Meister
         nehmen die Schadenskarte; manuell endet die Kette, im Zonen-Batch
         läuft sie für Adept/Meister weiter. */
      if ((await banishingSealFailedProbe(functionStuff, functionStuff.targetData)) !== "continue") return;
    }
    const handled = new Set([functionStuff.targetData.tokenId]);
    const savedCorruption = functionStuff.corruption;
    functionStuff.corruption = game.symbaroum.config.TEMPCORRUPTION_NONE;
    while (!zoneChainDone(functionStuff, handled) && (await zoneChainContinue(functionStuff, "POWER_BANISHINGSEAL.CHAT_NEXT_TARGET"))) {
      const nextToken = Array.from(game.user.targets).find((token) => !handled.has(token.id));
      if (!nextToken) {
        /* v2.7 (Rudolfs Schritt 8): „kein neues Ziel" trotz Bestätigung =
           Warnung + Dialog-NEUSTART (continue) statt Abbruch - die
           Bestätigungsfrage fragt erneut, bis ein Ziel markiert oder
           abgebrochen wird. */
        ui.notifications.warn(game.i18n.localize("POWER_BANISHINGSEAL.CHAT_NO_NEW_TARGET"));
        continue;
      }
      handled.add(nextToken.id);
      /* v2.7 (Testrunde 7, stufenunabhängig): Fehlkategorie in der Kette =
         Warnung + Überspringen für ALLE Stufen (der v2.6-Adept/Master-
         Wurf mit Kartenschaden entfällt, Rudolfs „Warnung und Abbruch"
         ohne Stufenunterschied). Eine leere Kategorie-Wahl hält den
         Check aus (SL-Buchhaltung). */
      if (functionStuff.sealCategoryId && game.symbaroum.config.getCreatureCategory(nextToken.actor) !== functionStuff.sealCategoryId) {
        /* v2.1 F24 (G6): Fehlkategorie-Hinweis auf der gefluesterten
           SL-Karte statt als Toast (Skip bleibt wie bisher). */
        await postSealCategoryGmCard([`<p>${game.i18n.format("POWER_BANISHINGSEAL.CHAT_WRONG_CATEGORY", { targetname: nextToken.name })}</p>`], functionStuff.actor ?? null);
        continue;
      }
      functionStuff.targetData = buildGlyphTargetData(nextToken, functionStuff.targetResistAttribute);
      const rollDataNext = [
        await baseRoll(
          functionStuff.actor,
          functionStuff.castingAttributeName,
          nextToken.actor,
          functionStuff.targetResistAttribute,
          functionStuff.favour,
          functionStuff.modifier,
          false
        ),
      ];
      await standardPowerResult(rollDataNext, functionStuff);
      if (!rollDataNext[0].trueActorSucceeded) {
        /* v2.7 (Schadensfall je Folge-Probe): Novize beendet Kette und
           (im Zonen-Batch) die Zone, Adept/Meister nehmen die Schadens-
           karte und laufen im Zonen-Batch weiter (manuell: Ende, RAW
           „until a test fails"). */
        if ((await banishingSealFailedProbe(functionStuff, functionStuff.targetData)) !== "continue") break;
        continue;
      }
      fleeing.push(nextToken.id);
    }
    functionStuff.corruption = savedCorruption;
    if (fleeing.length > 0) {
      // core status 'fear' (V14 id, German "Verängstigt" via SYMBAROUM.STATUS_FEAR);
      // dual access like actor.js addCondition - .find over the array, then the id key
      const fearEffect = CONFIG.statusEffects.find((e) => e.id === "fear") ?? CONFIG.statusEffects["fear"];
      await createModifyTokenChatButton(fleeing.map((tokenId) => ({ tokenId: tokenId, addEffect: foundry.utils.duplicate(fearEffect) })));
      ui.notifications.info(game.i18n.localize("POWER_BANISHINGSEAL.CHAT_FLEEING_INFO"));
    }
  } finally {
    await flushGmCardCollection();
  }
}

/* A32 Earth Shot (Erdschuss) Adept/Master (GRW): no maintain - one attack
   action throws 1d4 rocks ("Brocken"), each one a separate opposed
   [Resolute<-Quick] attack that may be distributed over one or several
   targets (Rudolf: the player picks the target per rock, for an NPC
   attacker the GM picks). Modelled after the A17 glyph loop: the primary
   target takes the first rock, the 1d4 roll is shown on its result card,
   then a confirmation dialog offers every further rock (with the number of
   rocks remaining), the next token being read fresh from the user's
   targeting - the same token may be marked again for a second rock.
   Every rock rolls its own opposed test; a miss does not end the sequence
   (the rocks are independent attacks), the sequence ends when the player
   cancels or marks no token. One casting: the follow-up rocks cost no
   further corruption; advantage (+1d4 damage) applies to the first rock
   only. From Master on every rock ignores armor (setup: ignoreArm). */
function earthshotNextBrockenConfirmation(functionStuff, remaining) {
  return new Promise((resolve) => {
    symbDialog({
      title: functionStuff.abilityName,
      // A25 optics: the question renders as the centred dark banner label
      // of the roll dialog (see glyphNextTargetConfirmation)
      classes: ["chain-confirm", ...(isModernDialogActive() ? modernDialogClasses('modern-chain-confirm-dialog') : [])],
      content: `<div class="symbaroum dialog"><p class="lblfavour">${game.i18n.format("POWER_EARTHSHOT.CHAT_NEXT_BROCKEN", { count: remaining })}</p></div>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("BUTTON.YES"),
          callback: () => resolve(true),
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.NO"),
          callback: () => resolve(false),
        },
      },
      default: "yes",
    });
  });
}

async function earthshotResult(rollData, functionStuff) {
  // 1d4 rocks in total, the primary target takes the first one
  const brockenRoll = await new Roll("1d4").evaluate();
  functionStuff.resultRolls = [brockenRoll];
  functionStuff.finalText = game.i18n.format(game.i18n.localize("POWER_EARTHSHOT.CHAT_BROCKEN"), { count: brockenRoll.total });
  await standardPowerResult(rollData, functionStuff);
  // the count roll and its text belong to the first card only; advantage
  // (+1d4 damage) applies to the first rock only
  functionStuff.resultRolls = null;
  functionStuff.finalText = "";
  functionStuff.hasAdvantage = false;
  // one casting: the follow-up rocks cost no further corruption
  const savedCorruption = functionStuff.corruption;
  functionStuff.corruption = game.symbaroum.config.TEMPCORRUPTION_NONE;
  for (let remaining = brockenRoll.total - 1; remaining > 0; remaining--) {
    if (!(await earthshotNextBrockenConfirmation(functionStuff, remaining))) break;
    const nextToken = Array.from(game.user.targets)[0];
    if (!nextToken) {
      ui.notifications.warn(game.i18n.localize("POWER_EARTHSHOT.CHAT_NO_NEW_TARGET"));
      break;
    }
    functionStuff.targetData = buildGlyphTargetData(nextToken, functionStuff.targetResistAttribute);
    const rollDataNext = [
      await baseRoll(
        functionStuff.actor,
        functionStuff.castingAttributeName,
        nextToken.actor,
        functionStuff.targetResistAttribute,
        functionStuff.favour,
        functionStuff.modifier,
        false
      ),
    ];
    // each rock is its own attack: a miss does not end the sequence
    await standardPowerResult(rollDataNext, functionStuff);
  }
  functionStuff.corruption = savedCorruption;
}

/* A32 Prios' Burning Glass Adept/Master (GRW): no maintain - one casting
   probes the caster's Resolute ONCE (unopposed) and on success every enemy
   in sight takes the holy damage. Modelled after the A17 glyph loop: the
   primary target's card carries the probe and the first damage roll, then
   a confirmation dialog offers the next enemy, whose token is read fresh
   from the user's targeting (each enemy once). The follow-ups need no new
   probe - one probe covers the whole casting - and cost no further
   corruption; advantage (+1d4 damage) applies to the first damage roll
   only. The thoroughly-corrupted bonus dice (Adept+: 1d12 instead of 1d8)
   are auto-detected per target - no dialog question from Adept on. A34: at
   Master each thoroughly corrupted target gets the OPTIONAL stun wired in
   (GRW) - after its damage card a dialog asks whether to attempt the stun,
   an automated opposed [Resolute<-Resolute] probe decides, and on success
   the stun symbol rides on its own GM apply card and expires automatically
   at the END of the target's turn (turn-end engine in hooks.js). */
async function priosBurningGlassResult(rollData, functionStuff) {
  const baseDamageDice = functionStuff.damageDice;
  // primary target: the one unopposed Resolute probe (GRW) + damage; the
  // unholy bonus (auto-detected) raises this first damage roll as well.
  // v2.13 (Rudolfs Testrunde 12, P6a): the bonus predicate is now
  // isUnholyCreatureTarget - creature category undead/abomination OR
  // thoroughly corrupted (the category is NOT auto-adjusted when
  // corruption reaches its maximum mid-scene, so both criteria stay)
  if (game.symbaroum.config.isUnholyCreatureTarget(functionStuff.targetData?.actor)) {
    Object.assign(functionStuff, functionStuff.targetFullyCorruptedFSmod);
    functionStuff.targetData.autoParams += game.i18n.localize("TOOLTIP.HEALTH.CORRUPTION_NA_TEXT");
  }
  await standardPowerResult(rollData, functionStuff);
  // the single probe decides for every enemy: on a miss nothing hits
  if (rollData?.[0]?.trueActorSucceeded === false) return;
  // A34: Master - the unholy primary target can additionally be stunned
  // for one round (GRW, optional): opposed [Resolute<-Resolute].
  // v2.13 (P6a decision): RAW "alle durch und durch verdorbenen und
  // untoten Feinde" - same unified unholy predicate as the bonus dice
  if (functionStuff.powerLvl.level > 2 && game.symbaroum.config.isUnholyCreatureTarget(functionStuff.targetData?.actor)) {
    await priosBurningGlassMasterStun(functionStuff, functionStuff.targetData);
  }
  functionStuff.hasAdvantage = false;
  // one casting: the follow-ups cost no further corruption
  const savedCorruption = functionStuff.corruption;
  functionStuff.corruption = game.symbaroum.config.TEMPCORRUPTION_NONE;
  const handled = new Set([functionStuff.targetData.tokenId]);
  while (!zoneChainDone(functionStuff, handled) && (await zoneChainContinue(functionStuff, "POWER_PRIOSBURNINGGLASS.CHAT_NEXT_TARGET"))) {
    const nextToken = Array.from(game.user.targets).find((token) => !handled.has(token.id));
    if (!nextToken) {
      ui.notifications.warn(game.i18n.localize("POWER_PRIOSBURNINGGLASS.CHAT_NO_NEW_TARGET"));
      break;
    }
    handled.add(nextToken.id);
    functionStuff.targetData = buildGlyphTargetData(nextToken, null);
    // per-target auto-detection of the unholy bonus dice (v2.13, P6a:
    // category undead/abomination OR thoroughly corrupted - see config.js
    // isUnholyCreatureTarget)
    if (game.symbaroum.config.isUnholyCreatureTarget(nextToken.actor)) {
      functionStuff.damageDice = functionStuff.targetFullyCorruptedFSmod.damageDice;
      functionStuff.finalTextSucceed = functionStuff.targetFullyCorruptedFSmod.finalTextSucceed;
      functionStuff.targetData.autoParams += game.i18n.localize("TOOLTIP.HEALTH.CORRUPTION_NA_TEXT");
    } else {
      functionStuff.damageDice = baseDamageDice;
      functionStuff.finalTextSucceed = undefined;
    }
    // no new probe - one probe covers the whole casting
    await standardPowerResult(null, functionStuff);
    // A34: Master - the optional stun applies to this unholy follow-up
    // target as well (v2.13: same unified predicate as the bonus dice)
    if (functionStuff.powerLvl.level > 2 && game.symbaroum.config.isUnholyCreatureTarget(functionStuff.targetData?.actor)) {
      await priosBurningGlassMasterStun(functionStuff, functionStuff.targetData);
    }
  }
  functionStuff.corruption = savedCorruption;
}

/* A34 Prios' Burning Glass Master (GRW): the mystic MAY stun a thoroughly
   corrupted (or undead) enemy for one round - opposed [Resolute<-Resolute].
   v2.13 (Rudolfs Testrunde 12, P6a): the CALL SITES gate on the unified
   unholy predicate (category undead/abomination OR thoroughly corrupted,
   config.js isUnholyCreatureTarget) - RAW "alle durch und durch verdorbenen
   und untoten Feinde".
   A dialog asks per target whether to attempt it (whoever triggered the
   casting answers - player owner of the caster, GM fallback), the probe is
   rolled automatically and posted as its own small card (DOT card optics);
   on success the stun symbol rides on a GM apply card and is engine-managed:
   it expires at the END of the target's turn (turn-end engine in hooks.js),
   the GM only confirms the apply. A target that already carries the stun
   symbol is skipped, a failed probe just posts the resisted line. */
async function priosBurningGlassMasterStun(functionStuff, targetData) {
  if (targetData.actor.hasCondition("stun")) return;
  if (!(await priosStunConfirmation(functionStuff, targetData.name))) return;
  const probe = await baseRoll(functionStuff.actor, "resolute", targetData.actor, "resolute", 0, 0, false);
  const stunned = probe.trueActorSucceeded === true;
  const title = `<h4>${functionStuff.abilityName}${game.i18n.localize("POWER_PRIOSBURNINGGLASS.STUN_TITLE")}</h4>`;
  const line = game.i18n.format(
    game.i18n.localize(stunned ? "POWER_PRIOSBURNINGGLASS.STUN_SUCCESS" : "POWER_PRIOSBURNINGGLASS.STUN_FAIL"),
    { targetname: targetData.name }
  );
  const html = `<div class="symbaroum chat ability"><div class="foreground">${title}<div class="finalTxt"><p>${line}</p></div></div></div>`;
  const chatData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: functionStuff.actor.id }),
    rollMode: game.settings.get("core", "messageMode"),
    content: html,
  };
  chatData.rolls = [createRollData(probe.rolls)];
  ChatMessage.applyMode(chatData, "public");
  await ChatMessage.create(chatData);
  if (!stunned) return;
  await createModifyTokenChatButton([
    {
      tokenId: targetData.tokenId,
      addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "stun")),
      effectDuration: 1,
      turnEnd: true,
      casterId: functionStuff.actor.id,
      abilityRef: functionStuff.ability?.reference,
      casterResolute: getAttributeValue(functionStuff.actor, "resolute"),
      casterName: functionStuff.actingCharName,
    },
  ]);
}

function priosStunConfirmation(functionStuff, targetname) {
  return new Promise((resolve) => {
    symbDialog({
      title: functionStuff.abilityName,
      // A25 optics: the question renders as the centred dark banner label of
      // the roll dialog (see glyphNextTargetConfirmation); the default is NO -
      // the stun stays the deliberate optional choice of the GRW text
      classes: ["chain-confirm", ...(isModernDialogActive() ? modernDialogClasses('modern-chain-confirm-dialog') : [])],
      content: `<div class="symbaroum dialog"><p class="lblfavour">${game.i18n.format(game.i18n.localize("POWER_PRIOSBURNINGGLASS.STUN_QUESTION"), { targetname })}</p></div>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("BUTTON.YES"),
          callback: () => resolve(true),
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.NO"),
          callback: () => resolve(false),
        },
      },
      default: "no",
    });
  });
}

/* A36-Verbraucher — Heilige Aura (GRW Theurgie, E4): the standard card posts
   the unopposed Resolute probe (CASTING), the corruption cost and the
   caster's maintain symbol exactly as before; the actual effects are now
   engine-managed instead of the old informative finalText:
   - On a successful CAST the player marks every affected creature in TWO
     glyph-style selection loops (fresh targeting per target, confirmation
     before each follow-up, NO per-target probe - "automatische Anwendung"
     per Rudolf's design). Loop 1 (every level) marks abominations and
     undead via the A36 category flags: each marked victim takes the aura
     damage 1d6/1d8/1d10 immediately (armor ignored, GM apply card with the
     A25 F9 dying feedback) and receives the holyaura damage symbol whose
     dot block ticks the same dice at the START of its own turn every round
     (A28 engine, NO duration - it ticks until the aura ends). Loop 2
     (Adept+) marks allies - monsters included - who receive the
     regeneration symbol with the aura heal rate 1d4/1d6 (the A35 heal
     resource). Allied abominations/undead are excluded by simply not
     marking them, which fulfils the novice exclusion rule without a
     dialog. v2.13 (Rudolfs Testrunde 12, P13 + Entscheidung): every
     included ally is ALSO healed IMMEDIATELY on inclusion (one own roll,
     positive toughnessChange on the same GM card, clamped to max) -
     symmetry with loop 1's immediate damage; the DOT keeps ticking the
     following rounds. All lines and rolls go onto ONE aura summary card (F8 optics).
   - MAINTAIN: the existing per-round casting roll. A success keeps the
     aura and ALL symbols ticking without any further clicks; a failure
     ends the power - every scene symbol carrying this caster's author
     markers for the holyaura ability is removed via one GM card
     (holyAuraEndCleanup). The A29 Zug-Start reminder finds the placed
     symbols via their maintained marker + author flags, so the reminder
     and its "Nein" abort chain run along for free.
   Boundaries (deliberate, Freigabe 24.10.): creatures entering sight later
     are only caught by abort + recast or manual symbols; an ally with the
     A35 Regeneration trait or an aura regeneration symbol gets no second
     symbol; damage ticks apply raw (armor ignored per GRW, damage
     reductions do not apply to engine ticks - A28 model); no immediate heal
     on cast (the rule heals "per round", the first tick comes with the
     ally's next turn). */
async function holyAuraResult(rollData, functionStuff) {
  const succeeded = rollData?.[0]?.trueActorSucceeded !== false;
  // standard card first: probe, corruption, caster maintain symbol
  // (added on cast success, removed on maintain failure by the standard path)
  await standardPowerResult(rollData, functionStuff);
  if (functionStuff.isMaintained) {
    // v2 F9: maintain round - success runs the aura rescan (joiners/
    // leavers like the hymns), a failed roll ends the aura, its symbols
    // AND the attached zone region
    if (!succeeded) {
      await holyAuraEndCleanup(functionStuff);
    } else {
      await auraZoneRescan(functionStuff);
    }
    return;
  }
  if (!succeeded) {
    // A36V test round (Rudolf, 25.10.): a failed FIRST casting blocks the
    // power for the rest of the scene - SL administration, the system does
    // not enforce it, the notification just tells the table
    ui.notifications.warn(game.i18n.localize("POWER_HOLYAURA.SCENE_BLOCKED"));
    return;
  }
  /* v2 F9 (Rudolfs Freigabe 20.11.): Erstaktivierung durch PLATZIEREN -
     die Aura legt eine am WIRKER angehaengte Sicht-Region fixer Sicht-
     weite an (placeAuraZone, Hymnen-Mechanik: ERST platzieren DANN
     attachment). Die Bestands-Loops laufen danach dialogfrei als
     Zonen-Batch ueber die Regions-Token (zoneChainTargets + Ziel-
     markierungen): die Region entscheidet die Geometrie, die Kategorie-
     Filter wirken darunter, Proben/Sofortwirkung/Symbol-DOTs bleiben
     Bestandscode. Picker-Abbruch (declined): Fallback auf die SL-
     Markierkette (dokumentiert). */
  /* v2.8 F39: Erstgesang-Kopf aus dem MASTER-RAHMEN - Region,
     Flag, F28-Trace; typ-spezifisch bleibt die Wirk-Klassen-
     Verwaltung darunter (Ziel-Markierung + Batch-Loops). */
  const auraFrame = await zoneErstgesangFrame(functionStuff, {
    refs: ["holyaura"],
    flagPrefix: "aurazone",
    flagLabel: "Auren-Flag",
    placeRegion: (frameCasterToken) =>
      placeAuraZone(frameCasterToken, functionStuff.actor, "holyaura", functionStuff.ability),
  });
  if (auraFrame?.region) {
    functionStuff.zoneChainTargets = new Set(auraFrame.zoneIds);
    for (const auraZoneId of auraFrame.zoneIds) {
      const auraZoneToken = canvas.tokens?.placeables?.find((t) => t.id === auraZoneId);
      if (auraZoneToken) {
        try {
          auraZoneToken.setTarget(true, { releaseOthers: false });
        } catch (auraTargetError) {
          /* Ziel-Markierung nur Kosmetik fuer die Batch-Loops */
        }
      }
    }
  }
  const flagDataArray = [];
  const auraRolls = [];
  const lines = [];
  // v2.16 (Rudolfs Testrunde 15, N2-Entscheidung): Skip-Diagnose-Zeilen
  // laufen auf EINE eigene geflüsterte SL-Karte (postAuraSkipDiagCard),
  // die öffentliche Zusammenfassungskarte zeigt nur noch Wirkungen.
  const skipLines = [];
  const handled = new Set();
  const auraDamageDice = functionStuff.auraDamageDice ?? "1d6";
  const auraHealDice = functionStuff.auraHealDice ?? "1d4";
  // the caster's snapshotted Resolute - author marker AND resistance target
  const casterResolute = getAttributeValue(functionStuff.actor, "resolute");
  // v2.14 (Rudolfs Testrunde-13-Entscheidungen): Wirker-Id und -Disposition
  // für die Zonen-Batch-Schutzregeln - der Wirker bleibt im Zonen-Batch von
  // der eigenen Aura unberührt (Schaden wie Heilung), Heil-Empfänger sind
  // dort nur verbündete Token (dispositions-relativ >= Wirker)
  const casterHealTokenId = functionStuff.tokenId ?? functionStuff.token?.id ?? null;
  const casterHealDisposition = functionStuff.token?.document?.disposition ?? 0;
  /* AoE-Rest Paket 1 (Sinn-Paket S1, fester Code-Default SICHT): Bei
     aktivem Welt-Setting aoeSenseWalls prüft die Aura je anvisiertem
     Ziel den Sicht-Blocker (senseBlocked, Ray gegen Kanten
     edge[sense]==='normal' + Regions-Restriktionen); Messfehler wirken
     das Ziel weiter (SL-Urteil), ein Blocker überspringt das Ziel
     sichtbar als skipLine (NIE still). Nah-Distanz bleibt SL-Sache
     (A36V-Konvention, Hinweiszeile ab 5 Szenen-Einheiten unverändert). */
  const auraCasterToken =
    functionStuff.token ?? (casterHealTokenId ? canvas.tokens?.placeables?.find((t) => t.id === casterHealTokenId) ?? null : null);
  const auraSightPasses = (nextToken) => {
    if (!auraCasterToken || nextToken.id === auraCasterToken.id) return true;
    const sightCheck = senseBlocked(auraCasterToken, nextToken, "sight");
    if (sightCheck.error) {
      skipLines.push(`<p>${game.i18n.format("AOE.SENSE_MEASURE_FAIL", { targetname: nextToken.name })}</p>`);
      return true;
    }
    if (sightCheck.blocked) {
      skipLines.push(
        `<p>${game.i18n.format("AOE.SENSE_SKIP", { targetname: nextToken.name, sense: game.i18n.localize("AOE.SENSE_SIGHT") })}</p>`
      );
      return false;
    }
    return true;
  };
  // A36V test round (Rudolf, 25.10.): the damage symbol carries a resist
  // block so the A28 engine runs the per-round opposition (see hooks.js) -
  // the author markers stay identical to the first delivery
  const pushAuraDamageSymbol = (tokenId) => {
    flagDataArray.push({
      tokenId: tokenId,
      addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "holyaura")),
      casterId: functionStuff.actor.id,
      abilityRef: functionStuff.ability?.reference,
      casterResolute: casterResolute,
      casterName: functionStuff.actingCharName,
      maintained: true,
      dot: {
        label: "POWER_LABEL.HOLY_AURA",
        formula: auraDamageDice,
        resource: "toughness",
        separateRoll: false,
        resist: {
          attribute: "resolute",
          value: casterResolute,
        },
      },
    });
  };
  // loop 1 - damage (every level): abominations, undead and thoroughly
  // corrupt creatures (A36V test round: the corrupt evaluation joins the
  // two category flags - isThoroughlyCorruptTarget with the Abso. fallback)
  while (!zoneChainDone(functionStuff, handled) && (await zoneChainContinue(functionStuff, "POWER_HOLYAURA.CHAT_NEXT_ENEMY"))) {
    const nextToken = Array.from(game.user.targets).find((token) => !handled.has(token.id));
    if (!nextToken) {
      /* v2.15 (Rudolfs Testrunde 14, P13-max): Abbruch-Hinweis als Zeile auf
         der Zusammenfassungskarte statt ui.notifications-Warnung - alle
         Hinweise des Wirkens stehen damit an einem Ort. */
      lines.push(`<p>${game.i18n.localize("POWER_HOLYAURA.CHAT_NO_NEW_TARGET")}</p>`);
      break;
    }
    handled.add(nextToken.id);
    /* v2.14 (Rudolfs Entscheidung, Testrunde 13, Spiegel der Unheiligen
       Aura): im ZONEN-BATCH bleibt der Wirker-Token von der eigenen Aura
       unberührt - ein völlig verdorbener Mystiker stünde sonst ohne jede
       Rückfrage im eigenen Schadens-Batch; manuell entscheidet die SL
       weiter per Markierung. */
    if ((functionStuff.zoneChainTargets?.size ?? 0) > 0 && nextToken.id === casterHealTokenId) {
      /* v2.15 (Rudolfs Testrunde 14, P13-max): der bisher stille Wirker-Skip
         im Zonen-Batch bekommt eine Zeile MIT GRUND - jeder Skip ist damit
         auf der Karte sichtbar statt still. */
      skipLines.push(`<p>${game.i18n.localize("POWER_HOLYAURA.SKIP_CASTER")}</p>`);
      continue;
    }
    const category = game.symbaroum.config.getCreatureCategory(nextToken.actor);
    if (category !== "undead" && category !== "abomination" && !game.symbaroum.config.isThoroughlyCorruptTarget(nextToken.actor)) {
      /* v2.15 (Rudolfs P13-max): Kategorie-Warnung als Kartenzeile statt
         ui.notifications (Bestands-Key wird wiederverwendet). */
      skipLines.push(`<p>${game.i18n.format("POWER_HOLYAURA.CHAT_WRONG_CATEGORY", { targetname: nextToken.name })}</p>`);
      continue;
    }
    // S1: Sicht-Blocker prüfen (Setting aoeSenseWalls, Default AN)
    if (!auraSightPasses(nextToken)) continue;
    // A36V test round (Rudolf, 25.10.): EVERY damage application is opposed
    // - Resolute vs the caster's Resolute, the system's one-roll opposed
    // model (1d20 <= victim value + 10 - caster value). A successful
    // resistance cancels THIS immediate damage only: the symbol stays,
    // every round tick gets its own attempt via the resist block
    const resistRoll = await new Roll("1d20").evaluate();
    auraRolls.push(resistRoll);
    const resistTarget = getAttributeValue(nextToken.actor, "resolute") + 10 - casterResolute;
    if (resistRoll.total <= resistTarget) {
      lines.push(`<p>${game.i18n.format("POWER_HOLYAURA.ENEMY_RESISTED", { targetname: nextToken.name, roll: resistRoll.total, target: resistTarget })}</p>`);
      pushAuraDamageSymbol(nextToken.id);
      continue;
    }
    lines.push(`<p>${game.i18n.format("POWER_HOLYAURA.ENEMY_NO_RESIST", { targetname: nextToken.name, roll: resistRoll.total, target: resistTarget })}</p>`);
    // immediate damage, armor ignored (GRW) - one roll per victim on the
    // summary card, applied via the GM card toughnessChange
    const damageRoll = await new Roll(auraDamageDice).evaluate();
    auraRolls.push(damageRoll);
    flagDataArray.push({
      tokenId: nextToken.id,
      toughnessChange: -1 * damageRoll.total,
    });
    lines.push(`<p>${game.i18n.format("POWER_HOLYAURA.ENEMY_DAMAGE", { targetname: nextToken.name, count: damageRoll.total })}</p>`);
    // the damage killed the victim (same dying check as the A25 F10/F11
    // paths) - no damage symbol on a dead token, the defeated flag marks
    // it in the combat tracker like the standard attack path
    const targetToughness = nextToken.actor?.system?.health?.toughness?.value;
    if (targetToughness !== undefined && damageRoll.total >= targetToughness) {
      if (ui.combat.viewed && (ui.combat.viewed.getCombatantsByToken(nextToken.id) ?? []).length > 0) {
        flagDataArray.push({ tokenId: nextToken.id, defeated: true });
      }
      continue;
    }
    pushAuraDamageSymbol(nextToken.id);
  }
  // loop 2 - healing (Adept+): allies receive the regeneration symbol
  // (A35 heal resource, ticks at the START of the ally's own turn).
  // v2.14 (Testrunde-13-Root-Cause): Loop 2 läuft mit EIGENEM handled-Set -
  // im Fluss-Pfad bleiben damit in Loop 1 mit Kategorie-Warnung übersprungene
  // Token neu markierbar - und bei ZONEN-AKTIVIERTER Auslösung als DIALOG-
  // FREIER ZWEITER DURCHLAUF über die Zonenziele: Loop 1 verbraucht im
  // Zonen-Batch ALLE Zonenziele, der gemeinsame zoneChainDone-Gard
  // übersprang den Heil-Loop deshalb still (Rudolfs Testrunde-13-Befunde
  // P7-P10 - der Loop-2-Dialog erschien nie). Empfänger im Zonen-Batch:
  // verbündet (dispositions-relativ >= Wirker, Konvention der Zonen-
  // Zielfilter); der Wirker selbst wird nie geheilt (Rudolfs Entscheidung;
  // Spiegel der Lebensspender-Meister-Reaktion, erspart dem Mystiker die
  // Selbst-Heilung samt eigener Korruptionsgebühr). Manuell entscheidet
  // die SL wie gehabt über die Markierung.
  let allyCorruption = 0;
  if (functionStuff.powerLvl.level > 1) {
    const markHolyAuraAlly = async (nextToken) => {
      const allyCategory = game.symbaroum.config.getCreatureCategory(nextToken.actor);
      if (allyCategory === "undead" || allyCategory === "abomination") {
        /* v2.15 (Rudolfs Testrunde 14, P13-max): der Kategorie-Skip läuft in
           Zone UND Fluss künftig als Kartenzeile (v2.14 übersprang im
           Zonen-Batch noch still); Bestands-Key wird wiederverwendet, der
           silentCategorySkip-Mechanismus entfällt. */
        skipLines.push(`<p>${game.i18n.format("POWER_HOLYAURA.CHAT_ALLY_NOT_LIVING", { targetname: nextToken.name })}</p>`);
        return;
      }
      if (nextToken.actor?.hasCondition("regeneration")) {
        /* v2.15 (Rudolfs P13-max): Regenerations-Warnung als Kartenzeile. */
        skipLines.push(`<p>${game.i18n.format("POWER_HOLYAURA.CHAT_ALLY_HAS_REGEN", { targetname: nextToken.name })}</p>`);
        return;
      }
      // S1: Sicht-Blocker prüfen (Setting aoeSenseWalls, Default AN)
      if (!auraSightPasses(nextToken)) return;
      // A36V test round 2 (Rudolf, 25.10.): the healing corruption goes to
      // the MYSTIC, not to the healed ally - one temporary corruption
      // point per healed ally, summed up and applied to the CASTER via
      // ONE GM apply card entry (corruptionChange on the caster's token,
      // see below the loop). The "Nah" distance stays with the SL: the
      // summary card only prints a hint when the measured distance
      // exceeds short range (5 scene units), no blocking
      allyCorruption += 1;
      lines.push(`<p>${game.i18n.format("POWER_HOLYAURA.ALLY_CORRUPTION", { targetname: nextToken.name, castername: functionStuff.actingCharName })}</p>`);
      try {
        if (functionStuff.token && canvas.grid.measureDistance(functionStuff.token, nextToken) > 5) {
          lines.push(`<p>${game.i18n.format("POWER_HOLYAURA.ALLY_TOO_FAR", { targetname: nextToken.name })}</p>`);
        }
      } catch (distanceError) {
        // no grid/scene measurement available - the SL judges the distance alone
      }
      flagDataArray.push({
        tokenId: nextToken.id,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "regeneration")),
        casterId: functionStuff.actor.id,
        abilityRef: functionStuff.ability?.reference,
        casterResolute: getAttributeValue(functionStuff.actor, "resolute"),
        casterName: functionStuff.actingCharName,
        maintained: true,
        dot: {
          label: "POWER_LABEL.HOLY_AURA",
          formula: auraHealDice,
          resource: "heal",
          separateRoll: false,
        },
      });
      lines.push(`<p>${game.i18n.format("POWER_HOLYAURA.ALLY_REGEN", { targetname: nextToken.name, dice: auraHealDice })}</p>`);
      // v2.13 (Rudolfs Testrunde 12, P13 + Entscheidung): the first heal
      // fires IMMEDIATELY on inclusion (symmetry with loop 1's immediate
      // damage) - one own roll per ally on this summary card, applied as
      // a positive toughnessChange on the same GM card, clamped to the
      // maximum; no line at full toughness. The regeneration DOT keeps
      // ticking every round from the ally's own turn on (RAW "heilen jede
      // Runde"); A33Fix2/A33Fix3 suppressions stay with the TICKS - the
      // immediate application also heals a dying ally (toughness 0),
      // only the ongoing ticks follow the dying rule
      const immediateHealRoll = await new Roll(auraHealDice).evaluate();
      const allyToughness = nextToken.actor?.system?.health?.toughness;
      const immediateHealed = Math.max(0, Math.min(immediateHealRoll.total, Number(allyToughness?.max ?? 0) - Number(allyToughness?.value ?? 0)));
      if (immediateHealed > 0) {
        auraRolls.push(immediateHealRoll);
        flagDataArray.push({ tokenId: nextToken.id, toughnessChange: immediateHealed });
        lines.push(`<p>${game.i18n.format("POWER_HOLYAURA.ALLY_HEAL_IMMEDIATE", { targetname: nextToken.name, count: immediateHealed })}</p>`);
      }
    };
    const handledHeal = new Set();
    const zoneHealTargetIds = [...(functionStuff.zoneChainTargets ?? [])];
    if (zoneHealTargetIds.length > 0) {
      // Zonen-Batch: dialogfreier zweiter Durchlauf im Zonen-Stil wie Loop 1
      for (const tokenId of zoneHealTargetIds) {
        if (handledHeal.has(tokenId)) continue;
        const nextToken = canvas.tokens?.placeables?.find((t) => t.id === tokenId);
        if (!nextToken?.actor) continue;
        handledHeal.add(tokenId);
        if (tokenId === casterHealTokenId) {
          /* v2.15 (Rudolfs Testrunde 14, P13-max): stiller Wirker-Skip wird
             Zeile MIT GRUND (wie Loop 1). */
          skipLines.push(`<p>${game.i18n.localize("POWER_HOLYAURA.SKIP_CASTER")}</p>`);
          continue;
        }
        if ((nextToken.document?.disposition ?? 0) < casterHealDisposition) {
          /* v2.15 (Rudolfs Testrunde 14, P2/P5-Root-Cause): der stille
             Dispositions-Skip war die Ursache des undiagnostizierbaren
             "Kein Heilen-Loop für Zone"-Befunds - ab jetzt Zeile MIT GRUND;
             der Filter selbst bleibt unverändert (Rudolfs RAW-Entscheidung:
             nur Verbündete sind Heil-Empfänger). */
          skipLines.push(`<p>${game.i18n.format("POWER_HOLYAURA.SKIP_DISPOSITION", { targetname: nextToken.name })}</p>`);
          continue;
        }
        await markHolyAuraAlly(nextToken);
      }
    } else {
      while (await zoneChainContinue(functionStuff, "POWER_HOLYAURA.CHAT_NEXT_ALLY")) {
        const nextToken = Array.from(game.user.targets).find((token) => !handledHeal.has(token.id));
        if (!nextToken) {
          /* v2.15 (Rudolfs P13-max): Abbruch-Hinweis als Kartenzeile. */
          lines.push(`<p>${game.i18n.localize("POWER_HOLYAURA.CHAT_NO_NEW_TARGET")}</p>`);
          break;
        }
        handledHeal.add(nextToken.id);
        await markHolyAuraAlly(nextToken);
      }
    }
  } else {
    /* v2.15 (Rudolfs Testrunde 14, P13-max): Stufen-Gate-Zeile - bisher
       lief der Heil-Loop still nie, wenn die Stufe unter der Schwelle
       liegt; die Zeile macht das auf der Karte sichtbar. */
    skipLines.push(`<p>${game.i18n.format("POWER_HOLYAURA.LEVEL_GATE_HEAL", { lvlname: functionStuff.powerLvl.lvlName })}</p>`);
  }
  // A36V test round 2 (Rudolf, 25.10.): the summed healing corruption lands
  // on the caster's own token - ONE GM apply card entry. Without a caster
  // token on the scene (macro edge case) the SL tracks the points manually.
  if (allyCorruption > 0) {
    const casterTokenId = functionStuff.token?.id ?? functionStuff.tokenId;
    if (casterTokenId) {
      flagDataArray.push({ tokenId: casterTokenId, corruptionChange: allyCorruption });
    }
  }
  if (lines.length > 0) {
    const title = `<h4>${game.i18n.format("POWER_HOLYAURA.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
    await postMaintainChainCard(functionStuff, title, lines, auraRolls);
  }
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
  // v2.16 (N2): Skip-Diagnose als eigene geflüsterte SL-Karte (nur falls
  // tatsächlich Ziele übersprungen wurden - keine leere Karte).
  if (skipLines.length > 0) {
    await postAuraSkipDiagCard(functionStuff, skipLines, "POWER_HOLYAURA.SKIP_CARD_TITLE");
  }
}

/* A36-Verbraucher — Heilige Aura: the aura ends (failed maintain roll or
   the A29 "Nein" abort path) - every scene symbol carrying this caster's
   author markers for the holyaura ability (damage dots on abominations/
   undead, ally regeneration symbols) goes onto ONE GM removal card; the
   caster's own maintain symbol was already removed by standardPowerResult.
   Untagged conditions are never touched (A23/K6 marker protection); the
   effect ids come from the ActiveEffect statuses so both symbol types
   (holyaura, regeneration) are removed through the same removeCondition
   path as the other GM cards. */
async function holyAuraEndCleanup(functionStuff) {
  const casterId = functionStuff.actor.id;
  const abilityRef = functionStuff.ability?.reference;
  const flagDataArray = [];
  const seen = new Set();
  for (const token of canvas.tokens.placeables) {
    const tokenActor = token.actor;
    if (!tokenActor) continue;
    for (const effect of tokenActor.effects) {
      const effectFlagData = effect.getFlag(game.system.id, "flagData");
      if (effectFlagData?.caster !== casterId || effectFlagData?.ability !== abilityRef) continue;
      const statusId = effect.statuses?.size ? [...effect.statuses][0] : null;
      if (!statusId) continue;
      const key = token.id + "|" + statusId;
      if (seen.has(key)) continue;
      seen.add(key);
      flagDataArray.push({ tokenId: token.id, removeEffect: statusId });
    }
  }
  if (flagDataArray.length > 0) {
  /* v2.7 F40: Ende-Raeumung automatisch (GM-Client, keine Karte). */
    await createModifyTokenAutoApply(flagDataArray);
  }  /* v2 F9 (Rudolfs Freigabe 20.11.): Mit den Symbolen endet auch die
     Auren-Region (Loeschen + Akteur-Flag, endAuraZoneState). */
  await endAuraZoneState(functionStuff.actor, abilityRef);

}

/* =====================================================================
   Hymnen-Paket v1 (Rudolfs Startsignal „Leg los“ 16.11.2026, Gruppe D):
   Kampfhymne + Heldenhafte Hymne (Tradition Trollgesang) und die
   Trollsingen-Wiederholungsprobe (Erstbau, Rudolfs Entscheidungen 1-10
   aus der RAW-Bewertung Gruppe D).

   Hymnen: Aktion Frei, keine Zauberprobe (CASTING_NOT) - der Erstgesang
   platziert auf JEDEM Verbündeten in Sichtweite (Sichtweiten-Abstrak-
   tion 100 m = SIGHT_RANGE_UNITS, Dispositions-Filter v2.14-Konvention:
   verbündet = disposition >= Wirker) und auf dem Sänger selbst EIN
   Statussymbol (combathymn/heroichymn) mit attrSymbol-Buff-Daten, je
   betroffenem Token +1 auf die Hymnen-Attribute über die reguläre GM-
   Anwenden-Karte (attributeChange-Einträge; das Löschen des Symbols
   revertiert über den deleteActiveEffect-Haken, Elixier-Muster). Die
   Maintain-Runde läuft als unopponierte Willenskraft-Probe über den
   Standard-Würfeldialog (Wirken/Aufrechterhalten-Radio), die A29-
   Erinnerung greift über die maintained-Marker auf den Symbolen. Ein
   Fehlschlag der Maintain-Probe beendet den Gesang. RAW-literal (Rudolfs
   Detail-Antwort): JEDE andere mystische Kraft beendet den Gesang
   automatisch (buildRolls-Hook) - nur andere aufrechterhaltene Kräfte
   zu zählen wäre die enge Lesart, Rudolf hat die wörtliche gewählt.
   Willenskraft-Schaden als Abbruchgrund bleibt SL-verwaltet (dokumen-
   tierte Grenze, Epilepsie-Präzedenz).

   Novize: EIN Attribut für alle Betroffene (Rudolfs Vereinfachung,
   Wahl-Dialog vor dem Würfeldialog). Adept: alle drei Attribute.
   Meister: alle drei + 1×/Szene-Effekt bei Liedbeginn (Kampfhymne:
   je Betroffenem eigener 1W6-Zähigkeitswurf; Heldenhafte Hymne: je
   Betroffenem eigener 1W4-Korruptions-Waschung; Flag hymnMasterScene
   + SL-Reset-Karte, dokumentierte Szenen-Grenze).

   Trollsingen-Reroll (Variante a, Rudolfs Entscheidung 8): Taste auf
   der eigenen Ergebniskarte bei fehlgeschlagener Geist-Beeinflussungs-
   Probe (resolute-Resist), Eligibility NUR im Standard-Pfad (result
   Function === standardPowerResult - Ketten/Auren/Zonen bewusst aus-
   geschlossen, dokumentierte Grenze; Waffen sowieso). Ketten-Regel:
   Novize KEIN Reroll für Ketten-Glieder (chain) ODER Maintain-Runden,
   Adept/Meister erlaubt. Frequenz (Entscheidung 9): Novize 1×/Szene,
   Adept 1×/Runde, Meister unbegrenzt; Konsum erst beim KLICK.
   ===================================================================== */

/* Hymnen-Paket 1.1: die Hymnen-Referenz-Liste liegt in config.js
   (SYMBAROUM.HYMN_REFERENCES) - Single Source auch für aoe.js
   (Hymnen sind vom Zonen-Auswahl-Flow ausgenommen). */

/* Hymnen-Paket 1.2: hymnActiveForCaster ist nach aoe.js VERLEGT und
   wird oben importiert - der Ausführungsdialog des Erstgesangs braucht
   dieselbe Kanonik für die Maintain-Erkennung (lauffender Gesang
   schweigt dort, siehe aoe.js maybeZoneExecutionChoice). */

/* Hymnen-Paket 1.2: Abbruch-Aufräumen einer frisch platzierten Gesangs-
   fläche - der Ausführungsdialog hat platziert („Zone platzieren“),
   aber der Gesang startete nie (Abbruch-Taste oder X/ESC im Gesangs-
   dialog, kein Betroffener). hymnResult setzt hymnZoneCommitted,
   sobald der Gesangszustand steht (Actor-Flag) - dann ist Aufräumen
   verboten. Idempotent (removeHymnZoneRegions toleriert fehlende
   Regionen). */
function cleanupFreshHymnZone(functionStuff) {
  if (!functionStuff?.hymnZone?.regionId || functionStuff.hymnZoneCommitted) return;
  /* v2.8.2 G7 (Rudolfs Testrunde v2.8.1, 1a/3): Auch die frisch
     platzierte SYMBOLZONE laeuft als hymnZone-Pending durch dieses
     Netz (Picker-Platzierung VOR dem Wuerfeldialog, Glyphe-
     Paritaet) - Cancel/X/ESC des Wuerfeldialogs raeumt dann die
     Symbol-Region statt der Hymnen-Region (removeSymbolZone-
     Regions, kein aoe-Flag auf der Region). */
  const cleanupRef = String(functionStuff.ability?.reference ?? "");
  if ((game.symbaroum.config.SYMBOL_ZONE_POWERS ?? []).includes(cleanupRef)) {
    removeSymbolZoneRegions(functionStuff.actor?.id ?? null, [cleanupRef]);
    return;
  }
  removeHymnZoneRegions(functionStuff.actor?.id ?? null, [functionStuff.ability?.reference]);
}

/* Hymnen-Paket 1.4 (Rudolfs Testrunde v1.3, Punkt 8 + RAW-Abgleich
   gegen den Vault): Kampfhymne und Heldenhafte Hymne haben nach APG
   KEINE Probe - weder beim Wirken noch beim Aufrechterhalten („Aktion:
   Frei", Wirkung „solange der Gesang andauert", Abbruch nur durch eine
   andere mystische Kraft oder Willenskraft-Schaden). Der v1-Baustein
   „je Runde eine unopponierte Willenskraft-Probe" war eine Hausregel
   und ist ENTFERNT. Drei Pfade:
   - A29-„Ja" (presetMaintain): die Maintain-Runde läuft DIREKT und
     STILL - kein Dialog, kein Wurf, keine Korruption (RAW: nur der
     Einsatz kostet), nur der Re-Scan der Gesangsfläche (hymnZone-
     Rescan; Joiner/Leaver-Zeilen, stille Runde ohne Bewegung).
   - Klick auf die Hymne bei laufendem Gesang: kleiner Bestätigungs-
     dialog „Soll {Kraft} abgebrochen werden?" (Muster Tanzende Waffe:
     DIALOG.CONFIRM_DEACTIVATE-Optik, generischer Kraftname des
     LAUFENDEN Gesangs). Ja räumt komplett (Symbole, Region, Flag -
     das von Rudolf bestätigte Abräumen) und postet die Ende-Karte,
     Nein lässt den Gesang unberührt weiterlaufen. Der schlanke
     C/M-Dialog mit „Würfeln"-Option (Rudolfs Testbefund: irritierend,
     der „Würfeln"-Wurf auf Vorbelegung „Aufrechterhalten" beendete
     den Gesang bei Fehlschlag) entfällt damit komplett.
   - Erstgesang (kein Gesang aktiv): Novize wählt EIN Attribut für
     alle Betroffenen (Rudolfs Vereinfachung), dann der schlanke
     Gesangsdialog - jetzt OHNE „Erster Zauber | Aufrechterhalten"-
     Radios (keine Maintain-Probe mehr, die Wahl wäre wirkungslos;
     checkMaintain in modifierDialog liest functionStuff.maintain,
     functionStuff ist je usePower-Aufruf ein frischer Clone). */
async function preDialogHymnChoice(functionStuff) {
  if (functionStuff.presetMaintain) {
    /* 1.1 (Rudolfs Antwort „automatisch nachziehen"), 1.4 wurflos:
       Der Gesangsbereich wird je Maintain-Runde NEU gescannt - neu
       in der Fläche = Buff kommt automatisch (mit GM-Anwenden-Karte),
       herausbewegt = Buff endet. Runden-Rhythmus (Gesangsbeginn + je
       Runde), keine Echtzeit-Reaktion auf Token-Bewegung (dokumen-
       tierte Grenze); stille Runde ohne Bewegung. */
    await hymnZoneRescan(functionStuff);
    return;
  }
  const runningRef = hymnActiveForCaster(functionStuff.actor);
  if (runningRef) {
    const runningLabel = hymnPowerLabel(runningRef);
    symbDialog({
      title: functionStuff.abilityName,
      content: `<p>${game.i18n.format("POWER_HYMN.CONFIRM_ABORT", { powername: runningLabel })}</p>`,
      classes: isModernDialogActive() ? modernDialogClasses("modern-power-confirm-dialog") : [],
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("BUTTON.YES"),
          callback: async () => {
            await postHymnEndCard(
              { actor: functionStuff.actor, actingCharName: functionStuff.actingCharName, abilityName: runningLabel },
              "POWER_HYMN.CHAT_END_ABORTED"
            );
            await endActiveHymns(functionStuff.actor, { silent: true });
          },
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.NO"),
        },
      },
      default: "yes",
    });
    return;
  }
  /* 1.4: Maintain-Radios im Erstgesangs-Dialog aus (siehe Block-
     kommentar oben). Die A29-Erinnerung scannt die maintained-Marker
     auf den Symbolen (flagData.maintained, hooks.js a29Scan-
     MaintainedPowers), nicht diese Dialog-Konfiguration - sie feuert
     unverändert je Runde. */
  functionStuff.maintain = game.symbaroum.config.MAINTAIN_NOT;
  if (functionStuff.powerLvl.level === 1) {
    const radioButtons = functionStuff.hymnAttributes
      .map((attr, index) => {
        const attrLabel = game.i18n.localize(game.symbaroum.config.attributeLabels[attr]);
        return `<label class="lblfavour" style="display:block;margin:2px 0;"><input type="radio" name="hymnAttribute" value="${attr}"${index === 0 ? " checked" : ""} style="margin-right:6px;">${attrLabel}</label>`;
      })
      .join("");
    /* Hymnen-Paket 1.2: Auch dieser Zwischendialog räumt eine frisch
       platzierte Gesangsfläche bei Abbruch auf (Taste oder X/ESC) -
       der cast-Pfad übergibt die Verantwortung an den Würfeldialog,
       dessen eigener Wächter (modifierDialog) übernimmt. */
    let hymnAttrClosedByButton = false;
    const hymnAttrDialog = symbDialog({
      title: functionStuff.abilityName,
      content: `<p>${game.i18n.localize("POWER_HYMN.DIALOG_ATTRIBUTE")}</p>${radioButtons}`,
      // P26 (Dialog-Audit): Modern-Chrome bei modernen Blättern
      classes: isModernDialogActive() ? modernDialogClasses("modern-hymn-attribute-dialog") : [],
      buttons: {
        cast: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("POWER_BANISHINGSEAL.BUTTON_APPLY"),
          callback: (html) => {
            hymnAttrClosedByButton = true;
            functionStuff.hymnChosenAttribute = html[0].querySelector('input[name="hymnAttribute"]:checked')?.value ?? functionStuff.hymnAttributes[0];
            modifierDialog(functionStuff);
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.CANCEL"),
          callback: () => {
            hymnAttrClosedByButton = true;
            cleanupFreshHymnZone(functionStuff);
          },
        },
      },
      default: "cast",
    });
    try {
      hymnAttrDialog.addEventListener?.("close", () => {
        if (!hymnAttrClosedByButton) cleanupFreshHymnZone(functionStuff);
      });
    } catch (hymnAttrCloseErr) {
      game.symbaroum.log("Hymnen 1.2: Attribut-Dialog-Close-Wächter nicht verfügbar");
    }
    return;
  }
  await modifierDialog(functionStuff);
}

/* Zielauswahl der Hymnen. Paket 1.1 (Rudolfs Entscheidung A): ist ein
   Gesangsbereich platziert (functionStuff.hymnZone, buildRolls-Haken),
   zählt nur, wer IN der Fläche steht (Mittelpunkt-Test, Muster
   _collectRegionTokens) - der Sänger selbst IMMER, unabhängig von
   seiner Position. Ohne Gesangsbereich gilt die v1-Sichtweiten-
   Abstraktion (100 m = SIGHT_RANGE_UNITS, config.js, Messfehler
   schließen ein - Fegefeuer-Präzedenz).
   v1.2 F8 (Rudolfs Entscheidung "strikter Core-Clip", 20.11.2026):
   Der eigene Schall-Strahlen-Filter ist am ZONEN-Pfad ENTFERNT - die
   sichtbar geclippte Region (Core-Wall-Restriktion) ist die alleinige
   Quelle der Wahrheit, jeder Token in der Flaeche zaehlt (Optik =
   Pruefung). Der Sinn-Filter laeuft NUR NOCH im Sichtweiten-Fallback
   ohne Gesangsbereich (Messfehler schliessen ein, SL-Urteil wirkt;
   blockierte Verbündete als skipLines an hymnResult, Kartenzeile
   AOE.SENSE_SKIP mit Sinn-Label). Rückgabe: { tokens, skipLines }. */
function getHymnAffectedTokens(functionStuff) {
  const casterToken = functionStuff.token ?? canvas.tokens?.placeables?.find((t) => t.id === functionStuff.tokenId);
  if (!casterToken) return { tokens: [], skipLines: [] };
  const casterDisposition = casterToken.document?.disposition ?? 0;
  const skipLines = [];
  // S1: Schall-Blocker je Verbündetem (Sänger selbst immer betroffen)
  const soundPasses = (token) => {
    const soundCheck = senseBlocked(casterToken, token, "sound");
    if (soundCheck.error) {
      // Messfehler => Verbündeten einschließen, SL-Urteil wirkt
      skipLines.push(`<p>${game.i18n.format("AOE.SENSE_MEASURE_FAIL", { targetname: token.name })}</p>`);
      return true;
    }
    if (soundCheck.blocked) {
      skipLines.push(
        `<p>${game.i18n.format("AOE.SENSE_SKIP", { targetname: token.name, sense: game.i18n.localize("AOE.SENSE_SOUND") })}</p>`
      );
      return false;
    }
    return true;
  };
  const affected = [];
  if (functionStuff.hymnZone?.regionId) {
    const region = hymnRegionById(functionStuff.hymnZone.regionId);
    if (region) {
      const inZone = new Set(hymnRegionTokens(region).map((t) => t.id));
      for (const token of canvas.tokens?.placeables ?? []) {
        if (!token.actor) continue;
        if (token.id !== casterToken.id) {
          if ((token.document?.disposition ?? 0) < casterDisposition) continue;
          if (!inZone.has(token.id)) continue;
          /* v1.2 F8: Kein zweiter Strahl in der Flaeche - die geclippte
             Region ist die Wahrheit (Nur-Fallback-Filter unten). */
        }
        affected.push(token);
      }
      return { tokens: affected, skipLines };
    }
    /* Region fehlt (manuell gelöscht oder Szenen-Wechsel): Sichtweiten-
       Fallback, SL-Urteil wirkt. */
  }
  const sightLimit = game.symbaroum.config.SIGHT_RANGE_UNITS ?? 50;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.actor) continue;
    if (token.id !== casterToken.id) {
      if ((token.document?.disposition ?? 0) < casterDisposition) continue;
      try {
        if (canvas.grid.measureDistance(casterToken, token) > sightLimit) continue;
      } catch (distanceError) {
        // Messung nicht verfügbar => Ziel einschließen, SL-Urteil wirkt
      }
      if (!soundPasses(token)) continue;
    }
    affected.push(token);
  }
  return { tokens: affected, skipLines };
}

/* Gemeinsame Ergebnis-Funktion beider Hymnen (Dispatch combathymn/
   heroichymn). Erstgesang: eigene Verbündeten-Symbole MIT Buff-Daten
   (der Standard-Pfad würde das Sänger-Symbol ohne flagData pushen - das
   eigene Symbol läuft mit conditionData auf dieselbe GM-Karte).
   Hymnen-Paket 1.4: Der Maintain-Zweig ist ENTFERNT - nach APG
   (Vault-Abgleich) haben die Hymnen keine Probe beim Aufrechter-
   halten; die Maintain-Runde läuft wurflos und still über pre-
   DialogHymnChoice (A29-„Ja" -> hymnZoneRescan), ein Fehlschlag-Ende
   kann es nicht mehr geben. Abbruch-Wege: andere mystische Kraft
   (buildRolls), A29-„Nein" (hooks.js), Abbruch-Dialog (preDialog-
   HymnChoice), Willenskraft-Schaden (SL-Sache, dokumentierte Grenze). */
async function hymnResult(rollData, functionStuff) {
  const abilityRef = functionStuff.ability?.reference;
  const casterEffects = functionStuff.activelyMaintaninedCasterEffect;
  functionStuff.activelyMaintaninedCasterEffect = [];
  await standardPowerResult(rollData, functionStuff);
  functionStuff.activelyMaintaninedCasterEffect = casterEffects;
  const hymnSelection = getHymnAffectedTokens(functionStuff);
  const affectedTokens = hymnSelection.tokens;
  const affectedSkipLines = hymnSelection.skipLines;
  if (affectedTokens.length === 0) {
    /* Hymnen-Paket 1.2: Ohne Betroffene startet kein Gesang - eine
       frisch platzierte Gesangsfläche muss wieder weg (mit dem
       Sänger praktisch unerreichbar, defensiv). */
    cleanupFreshHymnZone(functionStuff);
    functionStuff.hymnZoneCommitted = true;
    ui.notifications.warn(game.i18n.localize("POWER_HYMN.NO_TOKENS"));
    return;
  }
  /* Hymnen-Paket 1.1: Bei Platzierung eines Gesangsbereichs (Baustein E:
     interaktive Platzierung im buildRolls-Haken) die Region am Akteur
     vermerken - der Re-Scan der Maintain-Runde und endActiveHymns lesen
     dieses Flag. Eine Region aus einem FRÜHEREN Gesang desselben Refs
     (Neuaufnahme über eine neue Fläche) wird gezielt entfernt, eine
     verwaiste Fläche darf nicht stehen bleiben. */
  /* v2.8 F39: Erstgesang-Kopf (Region uebernehmen, alte Flaeche
     raeumen, Flag setzen, F28-Trace) aus dem MASTER-RAHMEN
     (zoneErstgesangFrame) - typ-spezifisch bleibt die Betroffenen-
     wahl darunter. Der Gesangszustand steht erst NACH dem Flag-
     Commit (onCommitted, Muster Hymnen-Paket 1.2). */
  await zoneErstgesangFrame(functionStuff, {
    refs: game.symbaroum.config.HYMN_REFERENCES,
    flagPrefix: "hymnZone",
    flagLabel: "Hymnen-Flag",
    replacePrevious: true,
    flagPayload: () => functionStuff.hymnZone,
    onCommitted: () => {
      functionStuff.hymnZoneCommitted = true;
    },
  });
  const attributeNames = functionStuff.powerLvl.level > 1 ? functionStuff.hymnAttributes : [functionStuff.hymnChosenAttribute ?? functionStuff.hymnAttributes[0]];
  const attributeLabels = attributeNames.map((attr) => game.i18n.localize(game.symbaroum.config.attributeLabels[attr]));
  const casterResolute = getAttributeValue(functionStuff.actor, "resolute");
  const flagDataArray = [];
  // S1: Skip-Diagnosezeilen des Schall-Filters fliessen VOR die Wirkungs-
  // zeilen (NIE stiller Skip, v2.15-P13-max-Muster)
  const lines = [...affectedSkipLines];
  const hymnRolls = [];
  for (const token of affectedTokens) {
    // Kein Stacking: ein Token mit diesem Sängers Hymnen-Symbol ist
    // bereits erfasst (Erneutes Wirken bei laufendem Gesang - der
    // C/M-Dialog öffnet zwar, ein frischer Erstgesang überspringt
    // bestehende Symbole aber sichtbar als Zeile)
    const alreadySung = token.actor.effects.some((effect) => {
      const fd = effect.getFlag(game.system.id, "flagData");
      return fd?.caster === functionStuff.actor.id && fd?.ability === abilityRef;
    });
    if (alreadySung) {
      lines.push(`<p>${game.i18n.format("POWER_HYMN.ALREADY_ACTIVE", { targetname: token.name })}</p>`);
      continue;
    }
    const attributeChanges = attributeNames.map((attr) => ({ name: attr, value: 1 }));
    flagDataArray.push({
      tokenId: token.id,
      addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === abilityRef)),
      effectDuration: 1,
      maintained: true,
      casterId: functionStuff.actor.id,
      abilityRef: abilityRef,
      casterResolute: casterResolute,
      casterName: functionStuff.actingCharName,
      conditionData: { attrSymbol: true, attributeChanges: attributeChanges },
    });
    for (const attr of attributeNames) {
      flagDataArray.push({ tokenId: token.id, attributeName: attr, attributeChange: 1 });
    }
    lines.push(`<p>${game.i18n.format("POWER_HYMN.ALLY_BUFFED", { targetname: token.name, attributes: attributeLabels.join(", ") })}</p>`);
  }
  /* Meister-Effekt, 1× pro Szene bei Liedbeginn: Kampfhymne heilt je
     Betroffenem 1W6 Zähigkeit, Heldenhafte Hymne wäscht je Betroffenem
     1W4 temporäre Korruption ab - je Betroffenem ein eigener Wurf. */
  if (functionStuff.powerLvl.level > 2) {
    const masterUsed = functionStuff.actor.getFlag(game.system.id, "hymnMasterScene")?.[abilityRef] === true;
    if (masterUsed) {
      lines.push(`<p>${game.i18n.localize("POWER_HYMN.MASTER_SCENE_USED")}</p>`);
    } else {
      const isHeal = functionStuff.hymnMasterHeal === true;
      const dice = isHeal ? "1d6" : "1d4";
      for (const token of affectedTokens) {
        const masterRoll = await new Roll(dice).evaluate();
        hymnRolls.push(masterRoll);
        if (isHeal) {
          flagDataArray.push({ tokenId: token.id, toughnessChange: masterRoll.total });
          lines.push(`<p>${game.i18n.format("POWER_HYMN.MASTER_HEAL_LINE", { targetname: token.name, count: masterRoll.total })}</p>`);
        } else {
          flagDataArray.push({ tokenId: token.id, corruptionChange: -1 * masterRoll.total });
          lines.push(`<p>${game.i18n.format("POWER_HYMN.MASTER_CLEANSE_LINE", { targetname: token.name, count: masterRoll.total })}</p>`);
        }
      }
      await functionStuff.actor.setFlag(game.system.id, `hymnMasterScene.${abilityRef}`, true);
      await postTrollSceneResetCard(functionStuff);
    }
  }
  if (lines.length > 0) {
    const title = `<h4>${game.i18n.format("POWER_HYMN.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
    await postMaintainChainCard(functionStuff, title, lines, hymnRolls);
  }
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
}

/* Re-Scan des Gesangsbereichs je Maintain-Runde (Rudolfs Entscheidung:
   automatisch nachziehen). Vergleicht die Token in der Hymnen-Region mit
   den Token, die das Hymnen-Symbol dieses Sängers tragen: Heraus-
   bewegte Verbündete verlieren den Buff (Revert über den Standard-
   Handler), in die Fläche eingebrochene Verbündete erhalten ihn
   automatisch mit dem identischen Erstgesang-Payload. Der Sänger
   selbst trägt das Symbol unabhängig vom Standort. Vorlage für die
   Attribut-Liste ist ein BESTEHENDES Symbol (Stabilität über die
   Runden); sind alle Symbole manuell entfernt, bleibt der Re-Scan
   stumm (dokumentierte Grenze). */
/* =====================================================================
   v2.2 F26: MASTER-ZONEN-LIFECYCLE (Rudolfs A4-Bewertung der Testrunde
   v2.1: Die Zonentypen liefen als KOPIERTE Ablaeufe mit punktuellen
   Abweichungen - derselbe Fehler kehrte je Typ wieder). Der Lebens-
   zyklus-Kern ist jetzt EINE Maschine; typspezifisch bleibt nur das
   JOIN-Verhalten und die Karten-Texte (Profil je Typ):
   - Hymnen (hymnZone.-Flag, Buff-/Schwaeche-Dynamik, Proben je Typ)
   - Auren (aurazone.-Flag, Sichtweiten-Radius, Wirk-Klassen/Kategorie)
   - Glyphe (glyphzone.-Flag, Tab-Radius, opponierte Join-Probe, Feind nur)
   - Dornenmantel (thorncloak, Ruestungs-Pfad + Notfall-Naehe - bleibt
     am Rahmen angedockt, die Rescan-Spezialwege bleiben typ-lokal)
   Die generische Zonen-Engine schweigt fuer alle OWN_ZONE_REFERENCES
   (F25, siehe config.js/aoe.js/hooks.js). Hier: Traeger-Erfassung,
   Marker-Raeum-Sweep, Rescan-Rahmen, Attribut-Vorlage, Ende-Sweep. */
function zoneCarriersFor(casterId, abilityRefs, { requireStatusId = true } = {}) {
  const wanted = new Set(Array.isArray(abilityRefs) ? abilityRefs : [abilityRefs]);
  const carriers = new Map();
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.actor?.effects) continue;
    for (const effect of token.actor.effects) {
      const fd = effect.getFlag(game.system.id, "flagData");
      if (fd?.caster === casterId && wanted.has(fd.ability)) {
        const statusId = effect.statuses?.size ? [...effect.statuses][0] : null;
        if (!requireStatusId || statusId) carriers.set(token.id, { token, effect, fd, statusId });
        break;
      }
    }
  }
  return carriers;
}

/* ALLE passenden Marker-Effekte aller Szenen-Token raeumen (End-Sweeps:
   je Effekt OHNE break, status-dedupliert) - GM-Anwenden-Payload. */
function zoneAllMarkerRemovals(casterId, abilityRefs) {
  const wanted = new Set(Array.isArray(abilityRefs) ? abilityRefs : [abilityRefs]);
  const flagDataArray = [];
  const seen = new Set();
  for (const token of canvas.tokens?.placeables ?? []) {
    const tokenActor = token.actor;
    if (!tokenActor?.effects) continue;
    for (const effect of tokenActor.effects) {
      const fd = effect.getFlag(game.system.id, "flagData");
      if (!fd || fd.caster !== casterId || !wanted.has(fd.ability)) continue;
      const statusId = effect.statuses?.size ? [...effect.statuses][0] : null;
      if (!statusId) continue;
      const key = token.id + "|" + statusId;
      if (seen.has(key)) continue;
      seen.add(key);
      flagDataArray.push({ tokenId: token.id, removeEffect: statusId });
    }
  }
  return { flagDataArray, seen };
}

/* Vorlage-Snapshot eines fremden Carriers (Erfassungs-Reihenfolge),
   Fallback auf den eigenen Wirker-Carrier (Hymnen/Glyphen-Muster). */
function zoneTemplateFd(carriers, casterToken) {
  for (const entry of carriers.values()) {
    if (entry.token.id !== casterToken.id) return entry.fd;
  }
  return carriers.get(casterToken.id)?.fd ?? null;
}

/* gemeinsamer Rescan-Rahmen: guard/Flag/Region/Caster/Bestand - die
   Join/Leave-Blaeufe der Typen sitzen AUF dem Frame.
   v2.4 F32B: optionale Erweiterungen, alle mit Defaults - das
   Verhalten der Hymnen/Auren/Glyphen bleibt unveraendert.
   lookupRegion = eigener Region-Lookup (Dornenmantel: flaechen-
   basiert via thornCloakRegionFor statt Akteur-Flag-RegionId),
   selfHeal = stille Rueckanlage einer fehlenden Flaeche (Dornen-
   mantel: forceAuto, nie gegen thornCloakZoneDeclined),
   allowMissing = fehlende Region als legaler Zustand (Dornen-
   mantel-Notfall-Naehe, inZone bleibt leer) statt Abbruch. */
async function zoneRegionScanFrame(functionStuff, opts) {
  const abilityRef = functionStuff.ability?.reference;
  if (!opts.guard(abilityRef)) return null;
  let region = null;
  if (opts.lookupRegion) {
    region = opts.lookupRegion(functionStuff.actor?.id ?? null);
  } else {
    const zoneFlag = functionStuff.actor.getFlag(game.system.id, `${opts.flagPrefix}.${abilityRef}`);
    if (!zoneFlag?.regionId) return null;
    region = hymnRegionById(zoneFlag.regionId);
    if (!region) return null;
  }
  const casterToken = functionStuff.token ?? canvas.tokens?.placeables?.find((t) => t.id === functionStuff.tokenId);
  if (!casterToken) return null;
  /* v2.4 F32B: Self-Heal VOR der Abbruch-Entscheidung - ohne die
     Option bricht eine fehlende Region wie bisher ab. */
  if (!region && opts.selfHeal) {
    try {
      region = (await opts.selfHeal(casterToken, functionStuff.actor, abilityRef)) ?? null;
    } catch (selfHealError) {
      console.warn("Symbaroum Hymnen: Zonen-Selfheal fehlgeschlagen", selfHealError);
    }
  }
  if (!region && !opts.allowMissing) return null;
  const carriers = zoneCarriersFor(functionStuff.actor.id, abilityRef, { requireStatusId: opts.requireStatusId ?? true });
  const inZone = new Set(region ? hymnRegionTokens(region).map((t) => t.id) : []);
  /* v2.2 F28 (Rudolfs Testrunde v2.1, G3-Leave unklar): Trace-Bestand
     fuer die Testrunde - Join/Leave-Diagnose ohne Karten-Spam. */
  console.info("Symbaroum Hymnen [trace] Zonen-Rescan-Bestand", {
    ref: String(abilityRef ?? ""),
    regionId: region?.id ?? null,
    inZone: [...inZone],
    carriers: [...carriers.keys()],
  });
  return { abilityRef, region, casterToken, carriers, inZone, casterDisposition: casterToken.document?.disposition ?? 0 };
}

/* gemeinsamer Ende-Sweep (endActiveAura/endActiveGlyph-Zwillinge bis
   v2.1): Szenen-Marker ueber die GM-Anwenden-Karte raeumen, Region
   loeschen, Akteur-Flag loeschen. Rueckgabe: Marker gefunden. */
async function zoneSweepClose(actor, ref, opts) {
  const { flagDataArray, seen } = zoneAllMarkerRemovals(actor.id, [ref]);
  /* v2.7 F40: Ende-Raeumung automatisch (GM-Client, keine Karte). */
  if (flagDataArray.length > 0) {
    await createModifyTokenAutoApply(flagDataArray);
  }
  await opts.removeRegions(actor.id ?? null, [ref]);
  try {
    await actor.unsetFlag(game.system.id, `${opts.flagPrefix}.${ref}`);
  } catch (flagError) {
    console.warn(`Symbaroum Hymnen: ${opts.flagLabel} konnte nicht entfernt werden`, flagError);
  }
  return seen.size > 0;
}

/* v2.8 F39 (Rudolfs Buendel-Freigabe 21.11., F39+G7+F41): MASTER-
   ERSTGESANG-RAHMEN. Die Kopf-Teilschritte des Erstgesangs laufen
   EINMAL hier: gueltige Kraft (opts.refs), Wirker-Token + Dispo-
   sition, Region UEBERNEHMEN (pending functionStuff.hymnZone mit
   ref/Szenen-Check) oder ERST PLATZIEREN (opts.placeRegion, Glyphe/
   Auren-Picker), vorherige Flaeche desselben Refs raeumen (opts.
   replacePrevious, nur Hymnen), Akteur-Flag setzen (opts.flagPrefix
   mit opts.flagPayload), F28-Bestands-Trace in Erstgesangs-Form
   (loest die F36/Auren-Sondertraces ab). Typ-spezifisch bleibt NUR
   der apply-Code am Aufrufort: Glyphe = Opposed-Kette + Meister-
   Heilung (F38-A-Rumpf unveraendert), Auren = Wirk-Klassen-Batch-
   Loops, Hymnen = Betroffenenwahl. Der Dornenmantel bleibt bewusst
   typ-lokal (F26-Praezedenz, SL-Anhang). Die G7-Symbolzonen sind
   aoe-seitig gesetzt (placeZoneFromItem). Rueckgabe: frame-Objekt
   oder null bei falscher Kraft. */
async function zoneErstgesangFrame(functionStuff, opts) {
  const abilityRef = functionStuff.ability?.reference;
  if (!((opts?.refs ?? []).includes(abilityRef))) return null;
  const sceneId = canvas.scene?.id ?? null;
  const casterToken = functionStuff.token ?? canvas.tokens?.placeables?.find((t) => t.id === functionStuff.tokenId) ?? null;
  const casterDisposition = casterToken?.document?.disposition ?? 0;
  const pendingZone = functionStuff.hymnZone ?? null;
  const pendingRegion =
    pendingZone && pendingZone.ref === abilityRef && pendingZone.sceneId === sceneId && pendingZone.regionId
      ? canvas.scene?.regions?.get(pendingZone.regionId) ?? null
      : null;
  const placement = pendingRegion
    ? { region: pendingRegion, declined: false }
    : opts?.placeRegion
      ? await opts.placeRegion(casterToken)
      : pendingZone?.regionId
        ? { region: canvas.scene?.regions?.get(pendingZone.regionId) ?? null, declined: false }
        : { region: null, declined: true };
  const region = placement?.region ?? null;
  let committed = false;
  if (region) {
    if (opts?.replacePrevious) {
      const previousZone = functionStuff.actor.getFlag(game.system.id, `${opts.flagPrefix}.${abilityRef}`);
      if (previousZone?.regionId && previousZone.regionId !== region.id) {
        const previousRegion = hymnRegionById(previousZone.regionId);
        if (previousRegion) {
          try {
            await previousRegion.delete();
          } catch (previousRegionError) {
            console.warn(`Symbaroum Hymnen: Alte Flaeche fuer ${abilityRef} konnte nicht entfernt werden`, previousRegionError);
          }
        }
      }
    }
    try {
      const flagPayload = opts?.flagPayload ? opts.flagPayload(region) : { regionId: region.id, sceneId: sceneId };
      await functionStuff.actor.setFlag(game.system.id, `${opts.flagPrefix}.${abilityRef}`, flagPayload);
      committed = true;
    } catch (erstgesangFlagError) {
      console.warn(`Symbaroum Hymnen: ${opts?.flagLabel ?? "Zonen-Flag"} konnte nicht gesetzt werden`, erstgesangFlagError);
    }
    if (opts?.onCommitted) opts.onCommitted(region);
  }
  /* F28-Bestands-Trace (Erstgesangs-Form): erfasste Region-Token mit
     Disposition (tolerant gelesen) und die disposition-bedingt
     uebersprungenen Ids - Leer-Platzierung bleibt still. */
  const traceHandled = opts?.traceHandled ?? new Set();
  const collected = region ? hymnRegionTokens(region) : [];
  const traceTd = (t) => ({ id: t.id, disp: t.document?.disposition ?? t.disposition ?? 0 });
  console.info("Symbaroum Hymnen [trace] Zonen-Erstgesang", {
    ref: String(abilityRef ?? ""),
    regionId: region?.id ?? null,
    pendingUsed: pendingRegion !== null,
    committed: committed,
    collected: collected.map((t) => traceTd(t)),
    skippedDisposition: collected
      .filter((t) => {
        const td = traceTd(t);
        return !traceHandled.has(td.id) && td.disp >= casterDisposition;
      })
      .map((t) => t.id),
  });
  return {
    abilityRef,
    region,
    casterToken,
    casterDisposition,
    zoneIds: collected.map((t) => t.id),
    pendingUsed: pendingRegion !== null,
    committed: committed,
    declined: placement?.declined ?? false,
  };
}

async function hymnZoneRescan(functionStuff) {
  /* v2.2 F26: Kopf aus dem MASTER-ZONEN-Rahmen (zoneRegionScanFrame)
     - Buff-/Schwaeche-Logik bleibt Hymnen-Spezifik. */
  const frame = await zoneRegionScanFrame(functionStuff, {
    flagPrefix: "hymnZone",
    guard: (ref) => game.symbaroum.config.HYMN_REFERENCES.includes(ref),
    requireStatusId: false,
  });
  if (!frame) return;
  const { abilityRef, casterToken, casterDisposition, inZone, carriers: carrying } = frame;
  /* v1.3 F14 (Rudolfs Freigabe 20.11.): Die Schwächende Hymne teilt jetzt
     die Hymnen-Maschine - Dauerzone AUCH leer, Joiner/Leaver je Runde im
     Rescan. Ihr Zweig braucht KEINE Attribut-Liste vom Vorlage-Symbol
     (Missgunst-Marker statt Attribut-Buff, Guard nur für die Buff-Hymnen),
     Joiner sind FEINDE (Disposition relativ zum Sänger), die je Joiner
     mit der opponierten Erstgesangs-Probe nachziehen; Novize zieht nur
     verwundete Feinde nach (getWeakeningHymnTargets-Muster). */
  const isWeakening = abilityRef === "weakeninghymn";
  /* v2.2 F26: Bestand + Attribut-Vorlage aus den Master-Helfern
     (zoneCarriersFor/zoneTemplateFd - bis v2.1 wortgleiche Kopie). */
  const templateFd = zoneTemplateFd(carrying, casterToken);
  if (!isWeakening && !templateFd) return;
  /* Hymnen-Paket 1.3 (Rudolfs Testrunde v1.2, P4 - Root-Cause): Die
     Vorlage liest die Attribut-Liste FLACH vom Effekt-Flag
     (flags.symbaroum.flagData.attributeChanges). addCondition
     (actor.js) speichert das GMC-Karten-Payload GEFALTET in
     conditionData, der Apply-Handler (hooks.js, GM-Anwenden-Karte)
     klappt es beim Anlegen FLACH auseinander: flagData = { caster,
     ability, resolute, casterName, maintained, attrSymbol,
     attributeChanges } - derselbe Kontrakt wie der deleteActiveEffect-
     Revert (fd.attributeChanges). Die 1.2-Version las
     conditionData?.attributeChanges auf dem EFFEKT - dort nie
     vorhanden => attributeNames leer => stiller Rückweg VOR dem
     Join/Leave-Vergleich: Joiner und Leaver wurden nie erkannt (beide
     Wirkungsmodi, eine Wurzel). Der conditionData-Fallback bleibt als
     Gürtel für Symbole aus der Zeit vor diesem Fix. */
  const attributeNames = isWeakening
    ? []
    : (templateFd.attributeChanges ?? templateFd.conditionData?.attributeChanges ?? []).map((c) => c.name);
  if (!isWeakening && attributeNames.length === 0) return;
  const attributeLabels = attributeNames.map((attr) => game.i18n.localize(game.symbaroum.config.attributeLabels[attr]));
  const flagDataArray = [];
  const rolls = [];
  const lines = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.actor || token.id === casterToken.id) continue;
    const hasBuff = carrying.has(token.id);
    if (hasBuff && !inZone.has(token.id)) {
      /* Herausbewegt: Buff endet, Revert läuft über den Entfernen-Handler */
      const statusId = carrying.get(token.id).effect.statuses?.size ? [...carrying.get(token.id).effect.statuses][0] : null;
      if (!statusId) continue;
      flagDataArray.push({ tokenId: token.id, removeEffect: statusId });
      lines.push(`<p>${game.i18n.format("POWER_HYMN.ZONE_LEFT", { targetname: token.name })}</p>`);
    } else if (!hasBuff && inZone.has(token.id)) {
      if (isWeakening) {
        /* Eingetreten (FEIND): opponierte Erstgesangs-Probe je Joiner
           (Messfehler schließen ein, baseRoll/SL-Urteil), Novize nur
           verwundete Feinde; Widerstand = RESIST_LINE, kein Marker. */
        if ((token.document?.disposition ?? 0) >= casterDisposition) continue;
        if (functionStuff.powerLvl?.level === 1) {
          const toughness = token.actor.system?.health?.toughness;
          if (Number(toughness?.value ?? 0) >= Number(toughness?.max ?? 0)) continue;
        }
        const probe = await baseRoll(
          functionStuff.actor,
          functionStuff.castingAttributeName ?? "persuasive",
          token.actor,
          functionStuff.targetResistAttribute ?? "resolute",
          functionStuff.favour,
          functionStuff.modifier,
          false
        );
        rolls.push(...(probe.rolls ?? []));
        if (probe.trueActorSucceeded) {
          flagDataArray.push({
            tokenId: token.id,
            addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === abilityRef)),
            effectDuration: 1,
            maintained: true,
            casterId: functionStuff.actor.id,
            abilityRef: abilityRef,
            casterName: functionStuff.actingCharName,
          });
          lines.push(`<p>${game.i18n.format("POWER_WEAKENING_HYMN.WEAKENED_LINE", { targetname: token.name })}</p>`);
        } else {
          lines.push(`<p>${game.i18n.format("POWER_WEAKENING_HYMN.RESIST_LINE", { targetname: token.name })}</p>`);
        }
      } else {
        /* Eingetreten (VERBÜNDETER): Disposition relativ zum Sänger,
           Sichtweiten-Muster des Erstgesangs, wufloses Nachziehen */
        if ((token.document?.disposition ?? 0) < casterDisposition) continue;
        const attributeChanges = attributeNames.map((attr) => ({ name: attr, value: 1 }));
        flagDataArray.push({
          tokenId: token.id,
          addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === abilityRef)),
          effectDuration: 1,
          maintained: true,
          casterId: functionStuff.actor.id,
          abilityRef: abilityRef,
          /* 1.3: Auf dem Effekt heißt das Snapshot-Feld 'resolute'
             (Apply-Handler), nicht 'casterResolute' - der 1.2-Fallback
             griff sonst auf den AKTUELLEN statt des Erstschafts-Werts
             zurück. Beide Namen als Kette für Alt-Symbole. */
          casterResolute: templateFd.resolute ?? templateFd.casterResolute ?? getAttributeValue(functionStuff.actor, "resolute"),
          casterName: templateFd.casterName ?? functionStuff.actingCharName,
          conditionData: { attrSymbol: true, attributeChanges: attributeChanges },
        });
        for (const attr of attributeNames) {
          flagDataArray.push({ tokenId: token.id, attributeName: attr, attributeChange: 1 });
        }
        lines.push(`<p>${game.i18n.format("POWER_HYMN.ZONE_JOINED", { targetname: token.name, attributes: attributeLabels.join(", ") })}</p>`);
      }
    }
  }
  if (lines.length === 0) return;
  const title = `<h4>${game.i18n.format("POWER_HYMN.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
  await postMaintainChainCard(functionStuff, title, lines, rolls);
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
}

/* Ende-Karte: kleiner öffentlicher Hinweis, WARUM der Gesang endete
   (Maintain-Fehlschlag, andere mystische Kraft). */
async function postHymnEndCard(functionStuff, lineKey) {
  /* v2.8 F41 (Rudolfs Testrunde 7, Sonstiges-Neu, Buendel-Freigabe
     21.11.): Ende-Karten nennen die KRAFT im Titel - "{Kraft}
     beendet" via CHAT_END_POWER (de/en vorhanden), nur ohne Namen
     bleibt der generische Titel. Alle 4 Abbruch-Dialog-Stellen plus
     die G7-Symbolzonen liefern abilityName mit. */
  const title = functionStuff.abilityName
    ? `<h4>${game.i18n.format("POWER_HYMN.CHAT_END_POWER", { powername: functionStuff.abilityName })}</h4>`
    : `<h4>${game.i18n.localize("POWER_HYMN.CHAT_END")}</h4>`;
  const line = `<p>${game.i18n.format(lineKey, { actorname: functionStuff.actingCharName, powername: functionStuff.abilityName })}</p>`;
  await postMaintainChainCard(functionStuff, title, [line], []);
}

/* Räumt ALLE Hymnen-Symbole eines Sängers über die GM-Anwenden-Karte
   ab (holyAuraEndCleanup-Muster, beide Hymnen-Referenzen). Ohne
   aktiven Gesang ist der Lauf ein stiller No-Op. Rückgabe: ob ein
   Gesang beendet wurde. options.silent unterdrückt die generische
   Ende-Karte (die Aufrufstelle postet die spezifische Zeile selbst).
   Hymnen-Anhang v1.1: exportiert fuer hymnTokenDeleted (Token-
   Löschungs-Auto-Ende, aoe.js deleteToken-Hook); options.extraRefs
   (Set) ergänzt Referenzen, deren Symbole NICHT mehr über Szene-
   Token erreichbar sind (Sänger-Symbol am Akteur bereits gelöscht)
   in der Ende-Karte. */
async function endActiveHymns(actor, options = {}) {
  if (!actor) return false;
  const casterId = actor.id;
  const flagDataArray = [];
  const endedRefs = new Set(options.extraRefs ?? []);
  const seen = new Set();
  for (const token of canvas.tokens?.placeables ?? []) {
    const tokenActor = token.actor;
    if (!tokenActor?.effects) continue;
    for (const effect of tokenActor.effects) {
      const fd = effect.getFlag(game.system.id, "flagData");
      if (fd?.caster !== casterId || !game.symbaroum.config.HYMN_REFERENCES.includes(fd?.ability)) continue;
      const statusId = effect.statuses?.size ? [...effect.statuses][0] : null;
      if (!statusId) continue;
      const key = token.id + "|" + statusId;
      if (seen.has(key)) continue;
      seen.add(key);
      endedRefs.add(fd.ability);
      flagDataArray.push({ tokenId: token.id, removeEffect: statusId });
    }
  }
  /* v2.7 F40: Ende-Raeumung automatisch (GM-Client, keine Karte). */
  if (flagDataArray.length > 0) {
    await createModifyTokenAutoApply(flagDataArray);
  }
  /* Hymnen-Paket 1.1: Gesangsbereiche des Sängers aufräumen (Region
     löschen, Flag entfernen). endActiveHymns beendet den GESAMTEN
     Gesangszustand, deshalb beide Referenzen; auch ohne je gefundenes
     Symbol kann eine verwaiste Fläche stehen bleiben (Symbole manuell
     entfernt), die darf nicht überdauern. */
  for (const ref of game.symbaroum.config.HYMN_REFERENCES) {
    const zoneFlag = actor.getFlag(game.system.id, `hymnZone.${ref}`);
    if (!zoneFlag?.regionId) continue;
    const region = hymnRegionById(zoneFlag.regionId);
    if (region) {
      /* v2 F19a (Rudolfs Hymnen-Nachtest): der dritte, ungeschuetzte
         region.delete-Pfad - Existenz-Check + try/catch wie alle
         anderen Raeumungen, keine "does not exist"-Meldung mehr. */
      try {
        await region.delete();
      } catch (hymnRegionError) {
        console.warn("Symbaroum Hymnen: Gesangsflaeche konnte nicht entfernt werden", hymnRegionError);
      }
    }
    await actor.unsetFlag(game.system.id, `hymnZone.${ref}`);
  }
  if (endedRefs.size > 0 && !options.silent) {
    const casterName = options.casterName ?? actor.name;
    const lines = [...endedRefs].map((ref) => {
      const powerLabel = hymnPowerLabel(ref);
      return `<p>${game.i18n.format("POWER_HYMN.CHAT_END_LINE", { actorname: casterName, powername: powerLabel })}</p>`;
    });
    /* v2.8 F41: Ein-Gesang-Fall nennt die Kraft im Titel ("{Kraft}
       beendet"), bei mehreren beendeten Gesaengen bleibt der
       generische Titel (Klartext steht ohnehin in den Zeilen). */
    const endedTitle =
      endedRefs.size === 1
        ? `<h4>${game.i18n.format("POWER_HYMN.CHAT_END_POWER", { powername: hymnPowerLabel([...endedRefs][0]) })}</h4>`
        : `<h4>${game.i18n.localize("POWER_HYMN.CHAT_END")}</h4>`;
    await postMaintainChainCard({ actor: actor, actingCharName: casterName }, endedTitle, lines, []);
  }
  return endedRefs.size > 0;
}

/* Hymnen-Paket 1.5: Drei-Wege-Kraftname der Gesaenge (combathymn /
   heroichymn / weakeninghymn) - die binaeren Terrarnaeren der v1.4-
   Standorte (endActiveHymns, preDialogHymnChoice, a29AbortMaintain-
   Power) wurden mit der dritten Hymne mehrdeutig. */
export function hymnPowerLabel(ref) {
  const labelKey = ref === "combathymn" ? "POWER_LABEL.COMBAT_HYMN" : ref === "heroichymn" ? "POWER_LABEL.HEROIC_HYMN" : "POWER_LABEL.WEAKENING_HYMN";
  return game.i18n.localize(labelKey);
}

/* v2 F19b (Rudolfs Testrunde V5b): Geloeschter WIRKER-Token - die
   Dornenmantel-Effekte blieben am AKTEUR gespeichert. Die Funktion
   raeumt das Wirker-Symbol und alle Betroffenen-Marker (fd.ability ===
   "thorncloak", fd.caster === Akteur) NACH der verzoegerten Region-
   Raeumung (aoe.js deleteToken-Hook, F19a) und postet die kleine
   Ende-Karte. Ohne Dornenmantel-Bestand stiller No-Op (kein Karten-
   Spam bei gewoehnlichen Token-Loeschungen). */
export async function thorncloakTokenDeleted(tokenDoc) {
  const actor = tokenDoc?.actor ?? null;
  if (!actor) return false;
  let changed = false;
  for (const effect of [...(actor.effects ?? [])]) {
    const fd = effect.getFlag(game.system.id, "flagData");
    if (fd?.ability !== "thorncloak" || fd?.caster !== actor.id) continue;
    try {
      await effect.delete();
      changed = true;
    } catch (error) {
      console.warn("Symbaroum Hymnen: Dornenmantel-Symbol konnte nicht entfernt werden", error);
    }
  }
  /* v2.2 F26: Szenen-Sweep aus dem Master-Helfer. */
  const { flagDataArray, seen } = zoneAllMarkerRemovals(actor.id, "thorncloak");
  if (seen.size > 0) changed = true;
  /* v2.7 F40: Ende-Raeumung automatisch (GM-Client, keine Karte). */
  if (flagDataArray.length > 0) {
    await createModifyTokenAutoApply(flagDataArray);
  }
  if (!changed) return false;
  const powerLabel = game.i18n.localize("POWER_LABEL.THORN_CLOAK");
  const endTitle = `<h4>${game.i18n.format("POWER_HYMN.CHAT_END_POWER", { powername: powerLabel })}</h4>`;
  const endLine = `<p>${game.i18n.format("POWER_THORN_CLOAK.CHAT_TOKEN_DELETED", { actorname: actor.name })}</p>`;
  await postMaintainChainCard({ actor: actor, actingCharName: actor.name }, endTitle, [endLine], []);
  return true;
}

/* v2 F9 (Rudolfs Freigabe 20.11.): Auren-Kraftname (Deaktivierungs- und
   Rescan-Karten, hymnPowerLabel-Muster). */
export function auraPowerLabel(ref) {
  return game.i18n.localize(ref === "unholyaura" ? "POWER_LABEL.UNHOLY_AURA" : "POWER_LABEL.HOLY_AURA");
}

/* v2 F9: Wirk-Klassen-Kategorien der Auren (Bestands-Loop-Konventionen,
   fuer den Rescan - Heilige Aura schaedigt Untote/Abscheulichkeiten/
   voellig Korrumpierte und heilt lebende Verbuendete; Unheilige Aura
   schaedigt Zivilisierte/Bestien und heilt untote/verdorbene
   Verbuendete). */
function auraHurtsCategory(ref, targetActor) {
  const category = game.symbaroum.config.getCreatureCategory(targetActor);
  if (ref === "unholyaura") return category === "civilized" || category === "beast";
  return category === "undead" || category === "abomination" || game.symbaroum.config.isThoroughlyCorruptTarget(targetActor);
}

function auraHealsCategory(ref, targetActor) {
  const category = game.symbaroum.config.getCreatureCategory(targetActor);
  if (ref === "unholyaura") return category === "undead" || category === "abomination" || game.symbaroum.config.isThoroughlyCorruptTarget(targetActor);
  return category !== "undead" && category !== "abomination";
}

/* v2 F9: Auren-Region + Akteur-Flag abraeumen (Ende egal warum). */
async function endAuraZoneState(actor, ref) {
  if (!actor || !ref) return;
  await removeAuraZoneRegions(actor.id ?? null, [ref]);
  try {
    await actor.unsetFlag(game.system.id, `aurazone.${ref}`);
  } catch (error) {
    console.warn("Symbaroum Hymnen: Auren-Flag konnte nicht entfernt werden", error);
  }
}

/* v2 F9: Beendet eine laufende Aura vollstaendig (alle Szenen-Symbole
   ueber die GM-Anwenden-Karte, Region, Flag) - Deaktivierung durch
   erneute Icon-Anwahl. */
export async function endActiveAura(actor, ref) {
  if (!actor || !ref) return false;
  /* v2.4 F34 (Rudolfs Testrunde v2.3, A6): Das Wirker-Maintain-
     Symbol (activelyMaintaninedCasterEffect, KEIN flagData) blieb
     nach dem Icon-Abbruch am Wirker stehen - der Szenen-Sweep
     unten erfasst nur Marker MIT flagData. Der Standard-Fehlschlag-
     Pfad (standardPowerResult) und der A29-Abbruch (a29Abort-
     MaintainPower) raeumen das Symbol via combatMods/remove-
     Condition, der Abbruch-Dialog-Pfad hatte den Schritt nie
     (auch nicht vor v2.2, kein F26-Regret). Heilige und unheilige
     Aura identisch (beide tragen das eigene Symbol). */
  try {
    const auraItem = actor.items.find((it) => it.system?.reference === ref) ?? null;
    const casterSymbols = actor.system?.combat?.combatMods?.abilities?.[auraItem?.id]?.activelyMaintaninedCasterEffect ?? [];
    for (const effect of casterSymbols) {
      await actor.removeCondition(effect);
    }
  } catch (casterSymbolError) {
    console.warn("Symbaroum Hymnen: Auren-Wirker-Symbol konnte nicht entfernt werden", casterSymbolError);
  }
  /* v2.2 F26: gemeinsame Ende-Maschine (zoneSweepClose) - bis v2.1
     wortgleiche Kopie des endActiveGlyph-Szenen-Sweeps. */
  return zoneSweepClose(actor, ref, {
    removeRegions: removeAuraZoneRegions,
    flagPrefix: "aurazone",
    flagLabel: "Auren-Flag",
  });
}

/* v2 F9: Auren-Rescan (hymnZoneRescan-Muster) - Join/Leave je Runde:
   Herausge bewegte Symbole enden (removeEffect, Revert), neue Token in
   der Region ziehen das Symbol ihrer Wirk-Klasse nach (Kopie des
   Vorlage-dot-Blocks: Wuerfel, resist-Snapshot, Regenerations-Formel).
   Schadens-Klasse = dot.resource "toughness" (Kategorie-Filter,
   Bestands-Konvention), Heil-Klasse = dot.resource "heal" (Verbuendete,
   Kategorie, Korruptionsgebuehr nur Heilige Aura). Stille Runde ohne
   Bewegung (keine Karte). */
export async function auraZoneRescan(functionStuff) {
  /* v2.2 F26: Kopf aus dem MASTER-ZONEN-Rahmen - Wirk-Klassen- und
     Kategorie-Spezifik des Auren-Joiners bleibt hier (v2 F9). */
  const frame = await zoneRegionScanFrame(functionStuff, {
    flagPrefix: "aurazone",
    guard: (ref) => (game.symbaroum.config.AURA_REFERENCES ?? []).includes(ref),
  });
  if (!frame) return;
  const { abilityRef, casterToken, casterDisposition, inZone, carriers: carrying } = frame;
  const templateByClass = new Map();
  for (const entry of carrying.values()) {
    const cls = entry.fd?.dot?.resource === "heal" ? "heal" : "toughness";
    if (!templateByClass.has(cls)) templateByClass.set(cls, entry);
  }
  const joinedKey = abilityRef === "holyaura" ? "POWER_HOLYAURA.ZONE_JOINED" : "POWER_UNHOLYAURA.ZONE_JOINED";
  const leftKey = abilityRef === "holyaura" ? "POWER_HOLYAURA.ZONE_LEFT" : "POWER_UNHOLYAURA.ZONE_LEFT";
  const flagDataArray = [];
  const lines = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.actor || token.id === casterToken.id) continue;
    const hasBuff = carrying.has(token.id);
    if (hasBuff && !inZone.has(token.id)) {
      flagDataArray.push({ tokenId: token.id, removeEffect: carrying.get(token.id).statusId });
      lines.push(`<p>${game.i18n.format(leftKey, { targetname: token.name })}</p>`);
      continue;
    }
    if (hasBuff || !inZone.has(token.id)) continue;
    const joinClass = (token.document?.disposition ?? 0) >= casterDisposition ? "heal" : "toughness";
    const templateEntry = templateByClass.get(joinClass);
    if (!templateEntry) continue;
    if (joinClass === "toughness" && !auraHurtsCategory(abilityRef, token.actor)) continue;
    if (joinClass === "heal" && !auraHealsCategory(abilityRef, token.actor)) continue;
    flagDataArray.push({
      tokenId: token.id,
      addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === templateEntry.statusId)),
      maintained: true,
      casterId: functionStuff.actor.id,
      abilityRef: abilityRef,
      casterResolute: templateEntry.fd.casterResolute ?? getAttributeValue(functionStuff.actor, "resolute"),
      casterName: templateEntry.fd.casterName ?? functionStuff.actingCharName,
      dot: foundry.utils.duplicate(templateEntry.fd.dot),
    });
    lines.push(`<p>${game.i18n.format(joinedKey, { targetname: token.name })}</p>`);
    if (joinClass === "heal" && abilityRef === "holyaura") {
      /* Heilige Aura: 1 temporEre Korruption je geheilttem Verbuendeten
         an den MYSTIKER (Bestands-Konvention des Erstcasts). */
      flagDataArray.push({ tokenId: casterToken.id, corruptionChange: 1 });
      lines.push(`<p>${game.i18n.format("POWER_HOLYAURA.ALLY_CORRUPTION", { targetname: token.name, castername: functionStuff.actingCharName })}</p>`);
    }
  }
  if (lines.length === 0) return;
  const title = `<h4>${game.i18n.format("POWER.MAINTAIN_CHAIN_SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
  await postMaintainChainCard(functionStuff, title, lines, []);
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
}

/* v2 F9: Erneute Icon-Anwahl bei LAUFENDER Aura = Abbruch-Dialog
   (Hymnen-Modell, preDialogThornCloakChoice-Muster). Ohne laufende Aura
   laeuft der normale Erstcast (Wuerfeldialog). */
async function preDialogAuraChoice(functionStuff) {
  const ref = functionStuff.ability?.reference;
  if (!(game.symbaroum.config.AURA_REFERENCES ?? []).includes(ref)) {
    await modifierDialog(functionStuff);
    return;
  }
  /* v2.1 F21 (Rudolfs Testrunde v2, A5 ROT): A29-"Ja" (presetMaintain)
     fuehrt in den Maintain-Wurf-Dialog statt in den Abbruch-Dialog -
     die LAUFENDE Zone ist kein Abbruch-Grund (der Icon-Klick ohne
     A29-Kontext bleibt der Abbruchsweg; Join/Leave laeuft je Runde
     ueber hymnAutoRescanRound mit). */
  if (functionStuff.presetMaintain) {
    await modifierDialog(functionStuff);
    return;
  }
  const running = functionStuff.actor?.getFlag(game.system.id, `aurazone.${ref}`)?.regionId ? ref : null;
  if (!running) {
    await modifierDialog(functionStuff);
    return;
  }
  const runningLabel = auraPowerLabel(running);
  symbDialog({
    title: functionStuff.abilityName,
    content: `<p>${game.i18n.format("POWER_HYMN.CONFIRM_ABORT", { powername: runningLabel })}</p>`,
    classes: isModernDialogActive() ? modernDialogClasses("modern-power-confirm-dialog") : [],
    buttons: {
      yes: {
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize("BUTTON.YES"),
        callback: async () => {
          await postHymnEndCard(
            { actor: functionStuff.actor, actingCharName: functionStuff.actingCharName, abilityName: runningLabel },
            "POWER_HYMN.CHAT_END_ABORTED"
          );
          await endActiveAura(functionStuff.actor, running);
        },
      },
      no: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("BUTTON.NO"),
      },
    },
    default: "yes",
  });
}

/* v2.1 F22 (Rudolfs G4/G5-Freigabe 21.11., Rudolfs Wortlauf "keine
   Haertung, sondern denselben Ablauf wie bei den Hymnen; auch die
   anderen Glyphen (Bannsiegel etc.) sollen so funktionieren"):
   Glyphen-Rescan (auraZoneRescan/hymnZoneRescan-Muster) - Join/Leave
   je Runde fuer den Glyphen-Kreis. Hinausgegangene Marker enden
   (removeEffect, Revert), NEU in der Region eingetretene FEINDE
   (Disposition KLEINER als die des Wirkers) ziehen mit der opponierten
   Erstgesangs-Probe [Resolute<-Strong] nach (Erstzauber-Konvention:
   eine Probe pro Ziel, ein Widerstand verhindert nur dieses eine
   Symbol); der Joiner-Marker traegt maintained + Autor-Snapshot wie
   die Erstgesangs-Follow-ups (A29/F11-Rundenschaden greifen darueber).
   Stille Runde ohne Bewegung (keine Karte). */
async function glypheRegionRescan(functionStuff) {
  /* v2.2 F26: Kopf aus dem MASTER-ZONEN-Rahmen - die opponierte
     Join-Probe bleibt Glyphen-Spezifik. */
  const frame = await zoneRegionScanFrame(functionStuff, {
    flagPrefix: "glyphzone",
    guard: (ref) => (game.symbaroum.config.GLYPH_ZONE_REFERENCES ?? []).includes(ref),
  });
  if (!frame) return;
  const { abilityRef, casterToken, casterDisposition, inZone, carriers: carrying } = frame;
  /* Vorlage-Snapshot (casterResolute/casterName) eines fremden Markers,
     sonst Fallback ueber den aktuellen Wirker. */
  const templateFd = zoneTemplateFd(carrying, casterToken);
  const flagDataArray = [];
  const rolls = [];
  const lines = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.actor || token.id === casterToken.id) continue;
    const hasMarker = carrying.has(token.id);
    if (hasMarker && !inZone.has(token.id)) {
      /* Hinaus bewegt: Marker endet (removeEffect, Revert-Handler). */
      flagDataArray.push({ tokenId: token.id, removeEffect: carrying.get(token.id).statusId });
      lines.push(`<p>${game.i18n.format("POWER_DRAININGGLYPH.ZONE_LEFT", { targetname: token.name })}</p>`);
      continue;
    }
    if (hasMarker || !inZone.has(token.id)) continue;
    /* Eingetreten (FEIND): opponierte Probe je Joiner, ein Widerstand
       verhindert nur dieses eine Symbol (Erstzauber-Muster). */
    if ((token.document?.disposition ?? 0) >= casterDisposition) continue;
    const probe = await baseRoll(
      functionStuff.actor,
      functionStuff.castingAttributeName ?? "resolute",
      token.actor,
      functionStuff.targetResistAttribute ?? "strong",
      /* v2.5 F35 (Rudolfs Testrunde v2.4, Konsolenstack roll.js:344):
         der Runden-Auto-Rescan baute sein functionStuff OHNE
         favour/modifier - undefined durchreicht, doBaseRoll wertet
         undefined != 0 als wahr und liest das zweite Wurfresult des
         1d20-Wurfs. Absicherung am Aufruf. */
      functionStuff.favour ?? 0,
      functionStuff.modifier ?? 0,
      false
    );
    rolls.push(...(probe.rolls ?? []));
    if (probe.trueActorSucceeded) {
      flagDataArray.push({
        tokenId: token.id,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === abilityRef)),
        effectDuration: 1,
        maintained: true,
        casterId: functionStuff.actor.id,
        abilityRef: abilityRef,
        casterResolute: templateFd?.casterResolute ?? getAttributeValue(functionStuff.actor, "resolute"),
        casterName: templateFd?.casterName ?? functionStuff.actingCharName,
      });
      lines.push(`<p>${game.i18n.format("POWER_DRAININGGLYPH.ZONE_JOINED", { targetname: token.name })}</p>`);
    } else {
      lines.push(`<p>${game.i18n.format("POWER_DRAININGGLYPH.ZONE_RESIST", { targetname: token.name })}</p>`);
    }
  }
  if (lines.length === 0) return;
  const title = `<h4>${game.i18n.format("POWER.MAINTAIN_CHAIN_SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
  await postMaintainChainCard(functionStuff, title, lines, rolls);
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
}

/* v2.1 F22: Beendet eine laufende Glyphe vollstaendig (alle Szenen-
   Marker ueber die GM-Anwenden-Karte, Glyphen-Kreis-Region am Boden,
   Akteur-Flag) - endActiveAura-Muster, still (die Ende-Karte posten
   die Aufrufstellen: Icon-Abbruch, A29-"Nein", Token-Loeschung). */
export async function endActiveGlyph(actor, ref) {
  if (!actor || !ref) return false;
  if (!(game.symbaroum.config.GLYPH_ZONE_REFERENCES ?? []).includes(ref)) return false;
  /* v2.2 F26: gemeinsame Ende-Maschine (zoneSweepClose, endActiveAura-Zwilling). */
  return zoneSweepClose(actor, ref, {
    removeRegions: removeGlyphZoneRegions,
    flagPrefix: "glyphzone",
    flagLabel: "Glyphen-Flag",
  });
}

/* v2.1 F22: Erneute Icon-Anwahl bei LAUFENDem Glyphen-Kreis =
   Abbruch-Dialog (Hymnen-Modell, preDialogAuraChoice-Muster); ohne
   laufenden Kreis der normale Erstzauber (Wurfel- bzw. Leer-
   Platzierung), A29-"Ja" (presetMaintain) der Maintain-Wurf-Dialog. */
async function preDialogGlyphChoice(functionStuff) {
  const ref = functionStuff.ability?.reference;
  if (!(game.symbaroum.config.GLYPH_ZONE_REFERENCES ?? []).includes(ref)) {
    await modifierDialog(functionStuff);
    return;
  }
  if (functionStuff.presetMaintain) {
    await modifierDialog(functionStuff);
    return;
  }
  const running = functionStuff.actor?.getFlag(game.system.id, `glyphzone.${ref}`)?.regionId ? ref : null;
  if (!running) {
    await modifierDialog(functionStuff);
    return;
  }
  const runningLabel = game.i18n.localize("POWER_LABEL.DRAINING_GLYPH");
  symbDialog({
    title: functionStuff.abilityName,
    content: `<p>${game.i18n.format("POWER_HYMN.CONFIRM_ABORT", { powername: runningLabel })}</p>`,
    classes: isModernDialogActive() ? modernDialogClasses("modern-power-confirm-dialog") : [],
    buttons: {
      yes: {
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize("BUTTON.YES"),
        callback: async () => {
          await postHymnEndCard(
            { actor: functionStuff.actor, actingCharName: functionStuff.actingCharName, abilityName: runningLabel },
            "POWER_HYMN.CHAT_END_ABORTED"
          );
          await endActiveGlyph(functionStuff.actor, running);
        },
      },
      no: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("BUTTON.NO"),
      },
    },
    default: "yes",
  });
}

/* v2.8.1 G7 (Rudolfs Option B, Glyphe-Paritaet, Freigabe 21.11.):
   Gemeinsame Maschinen der vier Symbolzonen (Bannsiegel, Blendendes
   Symbol, Zeichen der Pein, Kampfsymbol) - die Familie Symbolismus
   laeuft so aehnlich wie moeglich wie die Schwaeche-Glyphe:
   - symbolZoneResult (ERSTZAUBER): Picker-Platzierung im Zauberlauf
     (zoneErstgesangFrame + placeSymbolZone), Akteur-Flag symbolzone.<ref>
     mit Stufen-/Kategorie-Snapshot, Erstgesang JE Feind in der Region
     mit voller Standard-Karte (opposed Probe, Marker je Stufe aus dem
     Setup) - Korruption EINMAL je Zauber (erster Feind oder Leer-
     stand-Karte, A16-Engine), jeder weitere Feind kostenfrei; Bannsiegel
     filtert gegen die Kategorie (Skip-Zeilen auf der SL-Karte) und
     behaelt Flucht-/Schadens-Muster der alten Kette.
   - symbolZoneMaintainResult + symbolZoneRescan (MAINTAIN-RUNDEN,
     Blendend ab Adept, Kampfsymbol ab Adept, Pein Novize/Adept):
     Standard-Maintain-Kette plus stiller Joiner/Leaver-Rescan mit
     Sammelkarte (glypheRegionRescan-Zwilling).
   - symbolZoneImmediateJoiner (SOFORT-STUFEN per Bewegungs-Tracker
     in aoe.js: Blendend/Kampfsymbol Novize, Pein Meister, Bannsiegel
     alle Stufen): stille opposed Probe je Betreter, EINE Sammelkarte
     im Maintain-Ketten-Optik (Rudolfs Vorgabe), Marker je Kraft.
   - endActiveSymbolZone / symbolZoneTokenDeleted (ENDE, nur Icon-
     Abbruch/A29/Wirker-Token-Loeschung): Region, Flag und Marker raeumen
     - AUSNAHME Blendendes Symbol ab Adept: die bis-Heilung-Marker
     bleiben mit abgeraeumtem maintained-Flag stehen (Rudolfs Anmerkung:
     Erhalten bei ALLEM). Danach ist die Zone verbraucht: neue Nutzung
     = NEUE Platzierung (Adept: zeichnen in einer Aktion). */

function symbolZoneMarkerId(ref) {
  return game.symbaroum.config.SYMBOL_ZONE_MARKER?.[String(ref)] ?? String(ref ?? "");
}

export function symbolZonePowerLabel(ref) {
  return game.i18n.localize(
    ref === "banishingseal"
      ? "POWER_LABEL.BANISHING_SEAL"
      : ref === "blindingsymbol"
        ? "POWER_LABEL.BLINDING_SYMBOL"
        : ref === "markoftorment"
          ? "POWER_LABEL.MARK_OF_TORMENT"
          : "POWER_LABEL.BATTLE_SYMBOL"
  );
}

/* v2.8.1 G7: maintained-Flag der verbleibenden Blendend-ab-Adept-
   Marker abdraeumen (bis Heilung - keine A29-Erinnerung mehr, da die
   Zone und ihr Maintain weg sind). */
export async function setSymbolMarkersUnmaintained(actorId, ref) {
  if (!actorId || !ref) return;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.actor?.effects) continue;
    for (const effect of token.actor.effects) {
      const flagData = effect.getFlag(game.system.id, "flagData");
      if (!flagData || flagData.caster !== actorId || flagData.ability !== ref) continue;
      try {
        if (flagData.maintained !== false) {
          await effect.update({ [`flags.${game.system.id}.flagData.maintained`]: false });
        }
      } catch (markerFlagError) {
        console.warn("Symbaroum Hymnen: Blendend-Marker konnte nicht abgeraeumt werden", markerFlagError);
      }
    }
  }
}

async function symbolZoneResult(rollData, functionStuff) {
  const ref = functionStuff.ability?.reference ?? "";
  const powerLvl = functionStuff.powerLvl?.level ?? 1;
  const savedCorruption = functionStuff.corruption;
  const savedMaintain = functionStuff.maintain;
  const savedActivelyMaintained = functionStuff.activelyMaintainedTargetEffect;
  /* Picker-Platzierung + Akteur-Flag + Bestands-Trace: der v2.8 F39-
     Rahmen (loest hier den aoe-seitigen v2.8-Ansatz ab). */
  const frame = await zoneErstgesangFrame(functionStuff, {
    refs: game.symbaroum.config.SYMBOL_ZONE_POWERS,
    flagPrefix: "symbolzone",
    flagLabel: "Symbolzonen-Flag",
    placeRegion: (frameCasterToken) =>
      placeSymbolZone(frameCasterToken, functionStuff.actor, ref, functionStuff.ability, {
        symbolLevel: powerLvl,
        sealCategoryId: functionStuff.sealCategoryId ?? null,
        sealSubtype: functionStuff.sealSubtype ?? "",
      }),
    flagPayload: (region) => ({
      regionId: region.id,
      sceneId: canvas.scene?.id ?? null,
      symbolLevel: powerLvl,
      sealCategoryId: functionStuff.sealCategoryId ?? null,
    }),
  });
  /* v2.8.2 G7: Die Region pendet meist schon aus preDialog (Picker
     VOR dem Wuerfeldialog, Glyphe-Paritaet) - beim Commit das
     Committed-Flag setzen, damit der Cancel-/Close-Waechter des
     Wuerfeldialogs sie nicht mehr wegraeumt (Hymnen-1.2-Muster,
     cleanupFreshHymnZone prueft hymnZoneCommitted). */
  if (frame?.committed) functionStuff.hymnZoneCommitted = true;
  const region = frame?.region ?? null;
  const skipLines = [];
  const fleeing = [];
  let firstEnemy = true;
  if (region) {
    for (const nextTokenId of frame.zoneIds) {
      const nextToken = canvas.tokens?.placeables?.find((t) => t.id === nextTokenId) ?? null;
      if (!nextToken?.actor || nextTokenId === frame.casterToken?.id) continue;
      if ((nextToken.document?.disposition ?? 0) >= frame.casterDisposition) continue;
      if (ref === "banishingseal" && functionStuff.sealCategoryId && game.symbaroum.config.getCreatureCategory(nextToken.actor) !== functionStuff.sealCategoryId) {
        skipLines.push(`<p>${game.i18n.format("POWER_SYMBOL.ZONE_SKIPPED", { targetname: nextToken.name })}</p>`);
        continue;
      }
      if (!firstEnemy) {
        /* die Folgewuerfe eines Zauber: kostenfrei, kein Maintain-
           reset (F10-Glyphen-Muster); maintained-Marker der Stufe
           bleiben ueber followUpMaintainedMarker erhalten. */
        functionStuff.corruption = game.symbaroum.config.TEMPCORRUPTION_NONE;
        functionStuff.maintain = game.symbaroum.config.MAINTAIN_NOT;
        functionStuff.followUpMaintainedMarker = savedMaintain !== game.symbaroum.config.MAINTAIN_NOT;
      }
      functionStuff.targetData = buildGlyphTargetData(nextToken, functionStuff.targetResistAttribute);
      const rollDataNext = [
        await baseRoll(
          functionStuff.actor,
          functionStuff.castingAttributeName,
          nextToken.actor,
          functionStuff.targetResistAttribute,
          functionStuff.favour,
          functionStuff.modifier,
          false
        ),
      ];
      await standardPowerResult(rollDataNext, functionStuff);
      firstEnemy = false;
      /* Bannsiegel: Flucht-/Schadens-Muster der alten v2.7-Kette -
         Erfolge fliehen (fear-GM-Karte + Hinweis unten), Adept/Meister
         nehmen bei misslungener Probe die Schadenskarte (Novize
         bleibt ohne Schaden, RAW). */
      if (ref === "banishingseal") {
        if (rollDataNext[0]?.trueActorSucceeded === true) {
          fleeing.push(nextToken.id);
        } else if (powerLvl > 1) {
          await banishingSealFailedProbe(functionStuff, functionStuff.targetData);
        }
      }
    }
  }
  functionStuff.corruption = savedCorruption;
  functionStuff.maintain = savedMaintain;
  functionStuff.activelyMaintainedTargetEffect = savedActivelyMaintained;
  functionStuff.followUpMaintainedMarker = false;
  /* Picker-Abbruch: kein Wirken, keine Karte, keine Korruption
     (dokumentierte Grenze des Option-B-Ablaufs). */
  if (frame?.declined) return;
  /* Leerstand (oder alle uebersprungen): Aktivierungsgebuehr wie
     beim Glyphen-Leerstand (F23-Modell: getCorruption + GM-Karte +
     kleine Gebuehr-Karte). */
  if (firstEnemy) {
    const emptyCorruption = await functionStuff.actor.getCorruption(functionStuff);
    if (emptyCorruption.value > 0) {
      await createModifyTokenChatButton([
        {
          tokenId: functionStuff.tokenId,
          actorId: functionStuff.actor.id,
          corruptionChange: emptyCorruption.value,
        },
      ]);
    }
    await postMaintainChainCard(
      functionStuff,
      `<h4>${functionStuff.abilityName}</h4>`,
      [`<p>${game.i18n.format("POWER_SYMBOL.CHAT_NO_TARGET_COST", { count: emptyCorruption.value })}</p>`],
      emptyCorruption.corruptionRoll ? [emptyCorruption.corruptionRoll] : []
    );
  }
  if (skipLines.length > 0) {
    await postSealCategoryGmCard(skipLines, functionStuff.actor ?? null);
  }
  if (ref === "banishingseal" && fleeing.length > 0) {
    const fearEffect = CONFIG.statusEffects.find((e) => e.id === "fear") ?? CONFIG.statusEffects["fear"];
    await createModifyTokenChatButton(fleeing.map((tokenId) => ({ tokenId: tokenId, addEffect: foundry.utils.duplicate(fearEffect) })));
    ui.notifications.info(game.i18n.localize("POWER_BANISHINGSEAL.CHAT_FLEEING_INFO"));
  }
}

async function symbolZoneMaintainResult(rollData, functionStuff) {
  /* v2.8.1 G7: die Maintain-Runde der Symbolzonen ist das Glyphen-
     Modell drainingGlyphMaintainResult - Standard-Kette je gehaltenem
     Marker plus stiller Zonen-Rescan (Joiner/Leaver). */
  await maintainChainResult(rollData, functionStuff);
  await symbolZoneRescan(functionStuff);
}

async function symbolZoneRescan(functionStuff) {
  /* v2.8.1 G7: glypheRegionRescan-Zwilling - stille opposed Probe je
     Joiner (Erfolg: Marker mit maintained-Flag; Widerstand: nur dieses
     eine Symbol), Leaver verliert den Marker mit ZONE_LEFT-Zeile,
     alles auf EINER Sammelkarte im Maintain-Ketten-Optik. AUSNAHME:
     Blendendes Symbol ab Adept haelt bis Heilung - der Leaver behaelt
     seinen Marker (v2.8-Verhalten, Rudolfs Anmerkung). */
  const keepBlinding =
    functionStuff.ability?.reference === "blindingsymbol" &&
    Number(functionStuff.actor.getFlag(game.system.id, "symbolzone.blindingsymbol")?.symbolLevel ?? 1) >= 2;
  const frame = await zoneRegionScanFrame(functionStuff, {
    flagPrefix: "symbolzone",
    guard: (ref) => (game.symbaroum.config.SYMBOL_ZONE_POWERS ?? []).includes(ref),
  });
  if (!frame) return;
  const { abilityRef, casterToken, casterDisposition, inZone, carriers: carrying } = frame;
  const templateFd = zoneTemplateFd(carrying, casterToken);
  const flagDataArray = [];
  const rolls = [];
  const lines = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.actor || token.id === casterToken.id) continue;
    const hasMarker = carrying.has(token.id);
    if (hasMarker && !inZone.has(token.id)) {
      if (keepBlinding) continue;
      flagDataArray.push({ tokenId: token.id, removeEffect: carrying.get(token.id).statusId });
      lines.push(`<p>${game.i18n.format("POWER_SYMBOL.ZONE_LEFT", { targetname: token.name })}</p>`);
      continue;
    }
    if (hasMarker || !inZone.has(token.id)) continue;
    if ((token.document?.disposition ?? 0) >= casterDisposition) continue;
    const probe = await baseRoll(
      functionStuff.actor,
      functionStuff.castingAttributeName ?? "resolute",
      token.actor,
      functionStuff.targetResistAttribute ?? "resolute",
      functionStuff.favour ?? 0,
      functionStuff.modifier ?? 0,
      false
    );
    rolls.push(...(probe.rolls ?? []));
    if (probe.trueActorSucceeded) {
      flagDataArray.push({
        tokenId: token.id,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === symbolZoneMarkerId(abilityRef))),
        effectDuration: 1,
        maintained: true,
        casterId: functionStuff.actor.id,
        abilityRef: abilityRef,
        casterResolute: templateFd?.casterResolute ?? getAttributeValue(functionStuff.actor, "resolute"),
        casterName: templateFd?.casterName ?? functionStuff.actingCharName,
      });
      lines.push(`<p>${game.i18n.format("POWER_SYMBOL.ZONE_JOINED", { targetname: token.name })}</p>`);
    } else {
      lines.push(`<p>${game.i18n.format("POWER_SYMBOL.ZONE_RESIST", { targetname: token.name })}</p>`);
    }
  }
  if (lines.length === 0) return;
  const title = `<h4>${game.i18n.format("POWER.MAINTAIN_CHAIN_SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
  await postMaintainChainCard(functionStuff, title, lines, rolls);
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
}

export async function symbolZoneImmediateJoiner(regionDoc, enteringTokenId = null) {
  /* v2.8.1 G7: SOFORT-Ausloesung der sofort-Stufen bei BETRETEN der
     Region (aoe.js Bewegungs-Tracker); Main-Runden der Maintain-
     Stufen laufen in symbolZoneRescan. Stille opposed Probe je
     Betreter (ein Widerstand verhindert nur dieses eine Symbol),
     EINE Sammelkarte im Maintain-Ketten-Optik, Marker je Kraft OHNE
     maintained (Sofort-Stufen sind maintain-los), Bannsiegel filtert
     gegen die gespeicherte Kategorie. KEINE Korruption (die zahlt
     die Erstplatzierung, A16). Der Wirker wird ueber das Region-Flag
     aufgeloest - ist er nicht mehr greifbar, wertet die SL manuell
     (Trace).
     v2.8.3 (Rudolfs Testrunde v2.8.2, 6): Geprueft wird NUR der neu
     BETRETENDE - bis v2.8.2 durchlief der Joiner bei jedem Betreten
     den gesamten Region-Bestand (Rudolfs Befund: „die Kette für
     alle Token in der Zone gefeuert, nicht nur für den neuen").
     enteringTokenId kommt aus aoe.js _symbolZoneEnter; ohne Id
     Rueckzug als Sicherheitsnetz (kein Bestands-Feuer mehr). Bannsiegel-Kategorie-Filter und Skip-Zeile laufen nur fuer den Betreter, Erstgesang und Maintain-Rescan bleiben unberuehrt. */
  const zf = regionDoc?.flags?.symbaroum?.symbolzone ?? null;
  const ref = String(zf?.ref ?? "");
  if (!zf || !(game.symbaroum.config.SYMBOL_ZONE_POWERS ?? []).includes(ref)) return;
  if (!((game.symbaroum.config.SYMBOL_ZONE_IMMEDIATE_LEVELS?.[ref] ?? []).includes(Number(zf.symbolLevel ?? 1)))) return;
  if (!enteringTokenId) return;
  const caster = zf.casterActorUuid ? fromUuidSync(zf.casterActorUuid) : null;
  if (!caster?.id) {
    console.warn("Symbaroum Hymnen [trace] Symbolzone-Sofort-Ausloesung ohne Wirker (SL wertet manuell)", { ref, regionId: regionDoc.id });
    return;
  }
  const casterDisposition = Number(zf.casterDisposition ?? 0);
  /* v2.8.3: Fokus auf den BETRETENDEN (Betreter-Id aus dem
     Bewegungs-Tracker), kein Region-Bestand-Loop mehr. */
  const tokenIds = [String(enteringTokenId)];
  const flagDataArray = [];
  const rolls = [];
  const lines = [];
  for (const nextTokenId of tokenIds) {
    const nextToken = canvas.tokens?.placeables?.find((t) => t.id === nextTokenId) ?? null;
    if (!nextToken?.actor || nextTokenId === zf.casterTokenId) continue;
    if ((nextToken.document?.disposition ?? 0) >= casterDisposition) continue;
    if (ref === "banishingseal" && zf.sealCategoryId && game.symbaroum.config.getCreatureCategory(nextToken.actor) !== zf.sealCategoryId) {
      lines.push(`<p>${game.i18n.format("POWER_SYMBOL.ZONE_SKIPPED", { targetname: nextToken.name })}</p>`);
      continue;
    }
    const probe = await baseRoll(caster, "resolute", nextToken.actor, "resolute", 0, 0, false);
    rolls.push(...(probe.rolls ?? []));
    if (probe.trueActorSucceeded) {
      flagDataArray.push({
        tokenId: nextToken.id,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === symbolZoneMarkerId(ref))),
        effectDuration: 1,
        maintained: false,
        casterId: caster.id,
        abilityRef: ref,
        casterResolute: getAttributeValue(caster, "resolute"),
        casterName: zf.casterName ?? caster.name ?? "",
      });
      lines.push(`<p>${game.i18n.format("POWER_SYMBOL.ZONE_JOINED", { targetname: nextToken.name })}</p>`);
    } else {
      lines.push(`<p>${game.i18n.format("POWER_SYMBOL.ZONE_RESIST", { targetname: nextToken.name })}</p>`);
    }
  }
  if (lines.length === 0) return;
  const title = `<h4>${game.i18n.format("POWER.MAINTAIN_CHAIN_SUMMARY", { powername: symbolZonePowerLabel(ref) })}</h4>`;
  await postMaintainChainCard(
    { actor: caster, actingCharName: zf.casterName ?? caster.name ?? "", tokenId: zf.casterTokenId ?? null },
    title,
    lines,
    rolls
  );
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
  console.info("Symbaroum Hymnen [trace] Symbolzone sofort ausgeloest", { ref, regionId: regionDoc.id, enteringTokenId: String(enteringTokenId), lines: lines.length, markers: flagDataArray.length });
}

export async function symbolZoneTokenDeleted(tokenDoc) {
  /* v2.8.1 G7 (Rudolfs Anmerkung): Geloeschter WIRKER-Token beendet
     seine Symbolzonen komplett (Region, Flag, Marker - glypheToken-
     Deleted-Muster) - AUSNAHME Blendendes Symbol ab Adept: die bis-
     Heilung-Marker bleiben (endActiveSymbolZone). */
  const actor = tokenDoc?.actor ?? null;
  if (!actor) return false;
  const refs = game.symbaroum.config.SYMBOL_ZONE_POWERS ?? [];
  const changed = [];
  for (const ref of refs) {
    if (!actor.getFlag(game.system.id, `symbolzone.${ref}`)?.regionId) continue;
    await endActiveSymbolZone(actor, ref);
    await postHymnEndCard(
      { actor: actor, actingCharName: actor.name, abilityName: symbolZonePowerLabel(ref) },
      "POWER_HYMN.CHAT_END_ABORTED"
    );
    changed.push(ref);
  }
  if (changed.length === 0) return false;
  console.info("Symbaroum Hymnen [trace] Symbolzonen nach Wirker-Token-Loeschung beendet", { actorId: actor.id, refs: changed });
  return true;
}

/* v2.8.1 G7 (Rudolfs finale Konzeptrunde 21.11. + v2.8-Testrunde):
   Beendet eine laufende Symbolzone vollstaendig (Region, Akteur-Flag,
   Szenen-Marker ueber die F40-Auto-Raeumung) - EIGENE Raeumschleife
   statt zoneSweepClose wegen der Blendend-ab-Adept-Ausnahme: die bis-
   Heilung-Marker bleiben stehen (Rudolfs Anmerkung: Erhalten bei
   ALLEM - Icon-Abbruch, A29-Nein, Wirker-Token-Loeschung), verlieren
   nur ihr maintained-Flag (keine weitere A29-Erinnerung). Danach ist
   die Zone verbraucht: eine neue Nutzung bedeutet NEUE Platzierung
   (Adept: zeichnen in einer Aktion). */
export async function endActiveSymbolZone(actor, ref) {
  if (!actor || !ref) return false;
  if (!(game.symbaroum.config.SYMBOL_ZONE_POWERS ?? []).includes(ref)) return false;
  const keepBlinding = ref === "blindingsymbol" && Number(actor.getFlag(game.system.id, `symbolzone.${ref}`)?.symbolLevel ?? 1) >= 2;
  const { flagDataArray, seen } = zoneAllMarkerRemovals(actor.id, [ref]);
  const doomed = keepBlinding ? [] : flagDataArray;
  /* v2.7 F40: Ende-Raeumung automatisch (GM-Client, keine Karte). */
  if (doomed.length > 0) {
    await createModifyTokenAutoApply(doomed);
  }
  if (keepBlinding) {
    await setSymbolMarkersUnmaintained(actor.id, ref);
  }
  await removeSymbolZoneRegions(actor.id, [ref]);
  try {
    await actor.unsetFlag(game.system.id, `symbolzone.${ref}`);
  } catch (flagError) {
    console.warn("Symbaroum Hymnen: Symbolzonen-Flag konnte nicht entfernt werden", flagError);
  }
  return seen.size > 0;
}

/* v2.8 G7: Erneute Icon-Anwahl bei LAUFENDER Symbolzone = Abbruch-
   Dialog (preDialogGlyphChoice-Muster, Titel "{Kraft} beendet" via
   F41); ohne laufende Zone der normale Wuerfeldialog. Gilt fuer
   Blendendes Symbol, Zeichen der Pein und Kampfsymbol (Bannsiegel
   hat seinen eigenen preDialog-Zweig, siehe preDialogBanishingSeal). */
/* v2.8.3 G7 (Rudolfs Testrunde v2.8.2, 2 + Freigabe „Leg los"):
   Ausfuehrungs-Dialog der vier Symbolkraefte, BAUGLEICH zum
   Glyphen-Dialog (maybeZoneExecutionChoice: Titel, Hinweis, und die
   Drei Tasten Manuell / Zone platzieren / Abbrechen mit denselben
   i18n-Keys AOE.EXEC_* und DIALOG.CANCEL - keine neuen Schluessel).
   Rueckgabe: "manual" | "zone" | "cancel" (X/ESC = cancel). Die
   Ausfuehrungswege bleiben die Symbol-Maschinen (Icon-Cast, Picker,
   Erstgesang, Ende nur ueber Icon) - nur der Dialog ist das
   Glyphe-1:1-Modell. */
function symbolZoneExecutionChoiceDialog(functionStuff) {
  const choiceModern = isModernDialogActive();
  const content = `<div class="symbaroum${choiceModern ? " modern-roll-dialog" : " dialog"}"><p>${game.i18n.localize("AOE.EXEC_HINT")}</p></div>`;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = symbDialog({
      title: game.i18n.format("AOE.EXEC_TITLE", { power: functionStuff.abilityName }),
      content,
      classes: isModernDialogActive() ? modernDialogClasses("modern-power-exec-dialog") : [],
      buttons: {
        manual: {
          icon: '<i class="fas fa-user"></i>',
          label: game.i18n.localize("AOE.EXEC_MANUAL"),
          callback: () => settle("manual"),
        },
        zone: {
          icon: '<i class="fas fa-draw-polygon"></i>',
          label: game.i18n.localize("AOE.EXEC_ZONE"),
          callback: () => settle("zone"),
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("DIALOG.CANCEL"),
          callback: () => settle("cancel"),
        },
      },
      onRender: (element) => {
        const btns = element?.querySelectorAll?.("footer button");
        if (!btns || btns.length === 0) return;
        const footer = btns[0].closest("footer") ?? btns[0].parentElement;
        if (footer) {
          footer.style.display = "flex";
          footer.style.flexDirection = "column";
          footer.style.gap = "0.25rem";
        }
        for (const b of btns) {
          b.style.boxSizing = "border-box";
          b.style.setProperty("width", "100%", "important");
          b.style.setProperty("align-self", "stretch", "important");
        }
      },
      default: "manual",
      width: 460,
    });
    try {
      dialog.addEventListener("close", () => settle("cancel"));
    } catch (closeError) {
      /* symbDialog-Guard nicht verfuegbar: die Button-Callbacks
         decken den Normalfall ab, X/ESC blieben dann ohne Wirkung. */
      game.symbaroum.log?.("v2.8.3: Symbol-Ausfuehrungsdialog ohne Close-Waechter");
    }
  });
}

/* v2.8.2 G7 (Rudolfs Testrunde v2.8.1, 1a/3 - GLYPHEN-Ablauf-
   Paritaet): Picker-Platzierung VOR dem Wuerfeldialog. Die platzierte
   Region pendet als functionStuff.hymnZone (Hymnen-1.2-Netz): der
   Erstgesang uebernimmt sie ueber zoneErstgesangFrame (pendingRegion),
   Cancel/X/ESC des Wuerfeldialogs raeumen sie bei Abbruch still
   (cleanupFreshHymnZone, oben um die Symbolzonen erweitert).
   Rueckgabe false = Picker-Abbruch: Zauber endet still und
   KOSTENLOS (Rudolfs Test 2 blieb gruen). */
async function symbolZonePlaceBeforeDialog(functionStuff, ref) {
  const casterToken =
    functionStuff.token ?? canvas.tokens?.placeables?.find((t) => t.id === functionStuff.tokenId) ?? null;
  const placement = await placeSymbolZone(casterToken, functionStuff.actor, String(ref ?? ""), functionStuff.ability, {
    symbolLevel: functionStuff.powerLvl?.level ?? 1,
    sealCategoryId: functionStuff.sealCategoryId ?? null,
    sealSubtype: functionStuff.sealSubtype ?? "",
  });
  if (!placement?.region) return false;
  functionStuff.hymnZone = {
    ref: String(ref ?? ""),
    sceneId: canvas.scene?.id ?? null,
    regionId: placement.region.id,
  };
  return true;
}

async function preDialogSymbolZoneChoice(functionStuff) {
  const ref = functionStuff.ability?.reference;
  if (!(game.symbaroum.config.SYMBOL_ZONE_POWERS ?? []).includes(ref)) {
    await modifierDialog(functionStuff);
    return;
  }
  if (functionStuff.presetMaintain) {
    await modifierDialog(functionStuff);
    return;
  }
  const running = functionStuff.actor?.getFlag(game.system.id, `symbolzone.${ref}`)?.regionId ? ref : null;
  if (!running) {
    /* v2.8.3 G7 (Rudolfs Testrunde v2.8.2, 2 - GLYPHEN-Ablauf-
       Paritaet, Freigabe „Leg los"): Beim FRISCHEN Zauber oeffnet
       zuerst der AUSFUEHRUNGS-DIALOG (Glyphe 1:1: Manuell / Zone
       platzieren / Abbrechen). „Zone platzieren" = Picker-Platzierung,
       dann Wuerfeldialog (Region pendet als functionStuff.hymnZone,
       der Erstgesang uebernimmt sie, Cancel/X/ESC des Wuerfeldialogs
       raeumt still ab, Picker-Abbruch endet ohne Karte und
       KOSTENLOS). „Manuell" = klassischer Einzelziel-Zauber OHNE
       Zone (Zielzwang, symbolZoneManual-Flag fuer den Dispatcher,
       Standard-Wuerfeldialog, danach KEINE Zone, kein Icon-
       Abbruch). Abbrechen/X/ESC = still, kein Wirken, keine
       Korruption. */
    const choice = await symbolZoneExecutionChoiceDialog(functionStuff);
    if (choice === "cancel") return;
    if (choice === "manual") {
      if (!functionStuff.targetData?.hasTarget && functionStuff.targets?.length) {
        functionStuff.targetData = functionStuff.targets[0];
      }
      /* v2.8.4 (Rudolfs Testrunde v2.8.3, 3 - roter Punkt „Ziel-Token
         gewaehlt, aber trotzdem Zielzwang-Meldung"): Die Setups der drei
         Icon-Kraefte sammeln KEINE functionStuff.targets (nur das
         Bannsiegel-Setup mappt die Nutzer-Markierungen zu Zielen), also
         greift der targets-Fallback hier ins Leere. Die AKTUELLE
         Nutzer-Marke wird deshalb vor der Fehlermeldung gelesen -
         Standardmuster des Systems (Bannsiegel-Setup und Ketten lesen
         ebenfalls Array.from(game.user.targets)). Widerstands-Attribut
         konsistent zum Zonen-Erstgesang: targetResistAttribute des
         Setups (resolute), Fallback "resolute". */
      if (!functionStuff.targetData?.hasTarget) {
        const manualToken = Array.from(game.user.targets)[0] ?? null;
        if (manualToken?.actor) {
          functionStuff.targetData = buildGlyphTargetData(manualToken, functionStuff.targetResistAttribute ?? "resolute");
        }
      }
      if (!functionStuff.targetData?.hasTarget) {
        ui.notifications.error(game.i18n.localize("ERROR.NO_TARGET_SELECTED"));
        return;
      }
      functionStuff.symbolZoneManual = true;
      await modifierDialog(functionStuff);
      return;
    }
    const placed = await symbolZonePlaceBeforeDialog(functionStuff, ref);
    if (!placed) return;
    await modifierDialog(functionStuff);
    return;
  }
  const runningLabel = symbolZonePowerLabel(ref);
  symbDialog({
    title: functionStuff.abilityName,
    content: `<p>${game.i18n.format("POWER_HYMN.CONFIRM_ABORT", { powername: runningLabel })}</p>`,
    classes: isModernDialogActive() ? modernDialogClasses("modern-power-confirm-dialog") : [],
    buttons: {
      yes: {
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize("BUTTON.YES"),
        callback: async () => {
          await postHymnEndCard(
            { actor: functionStuff.actor, actingCharName: functionStuff.actingCharName, abilityName: runningLabel },
            "POWER_HYMN.CHAT_END_ABORTED"
          );
          await endActiveSymbolZone(functionStuff.actor, running);
        },
      },
      no: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("BUTTON.NO"),
      },
    },
    default: "yes",
  });
}

/* v2.1 F22: Maintain-Runde der Glyphe = Standard-Kette (maintainChain-
   Result: je gehaltem Ziel eine opponierte Probe, F11-Rundenschaden,
   Meister-Heilung unberuehrt) PLUS glypheRegionRescan - Joiner/Leaver
   je Runde wie bei den Hymnen. */
async function drainingGlyphMaintainResult(rollData, functionStuff) {
  await maintainChainResult(rollData, functionStuff);
  await glypheRegionRescan(functionStuff);
}

/* v2.1 F22: Geloeschter WIRKER-Token - der Glyphen-Kreis liegt am
   BODEN (kein Anhang, die Region ueberlebt das Token), deshalb raeumt
   der Helper Kreis, Flag und Marker (thorncloakTokenDeleted-Muster)
   und postet die kleine Ende-Karte. Ohne Glyphen-Bestand stiller
   No-Op (kein Karten-Spam bei gewoehnlichen Token-Loeschungen). */
export async function glypheTokenDeleted(tokenDoc) {
  const actor = tokenDoc?.actor ?? null;
  if (!actor) return false;
  const glyphRefs = game.symbaroum.config.GLYPH_ZONE_REFERENCES ?? [];
  if (glyphRefs.length === 0) return false;
  let changed = false;
  for (const effect of [...(actor.effects ?? [])]) {
    const fd = effect.getFlag(game.system.id, "flagData");
    if (!fd || fd.caster !== actor.id || !glyphRefs.includes(fd.ability)) continue;
    try {
      await effect.delete();
      changed = true;
    } catch (error) {
      console.warn("Symbaroum Hymnen: Glyphen-Symbol konnte nicht entfernt werden", error);
    }
  }
  await removeGlyphZoneRegions(actor.id, glyphRefs);
  for (const ref of glyphRefs) {
    if (actor.getFlag(game.system.id, `glyphzone.${ref}`)) changed = true;
    try {
      await actor.unsetFlag(game.system.id, `glyphzone.${ref}`);
    } catch (error) {
      console.warn("Symbaroum Hymnen: Glyphen-Flag konnte nicht entfernt werden", error);
    }
  }
  /* v2.2 F26: Szenen-Sweep aus dem Master-Helfer (alle Glyphen-refs). */
  const { flagDataArray, seen } = zoneAllMarkerRemovals(actor.id, glyphRefs);
  if (seen.size > 0) changed = true;
  /* v2.7 F40: Ende-Raeumung automatisch (GM-Client, keine Karte). */
  if (flagDataArray.length > 0) {
    await createModifyTokenAutoApply(flagDataArray);
  }
  if (!changed) return false;
  const powerLabel = game.i18n.localize("POWER_LABEL.DRAINING_GLYPH");
  const endTitle = `<h4>${game.i18n.format("POWER_HYMN.CHAT_END_POWER", { powername: powerLabel })}</h4>`;
  const endLine = `<p>${game.i18n.format("POWER_DRAININGGLYPH.CHAT_TOKEN_DELETED", { actorname: actor.name })}</p>`;
  await postMaintainChainCard({ actor: actor, actingCharName: actor.name }, endTitle, [endLine], []);
  return true;
}

/* Hymnen-Anhang v1.1 (Rudolfs Testrunde v1, P3 + Freigabe 20.11.):
   Token von der Szene entfernt => Gesang endet AUTOMATISCH vollstän-
   dig. Erst fallen vom AKTEUR des Sängers selbst (der Token ist weg,
   die Szene-Symbol-Schleife des endActiveHymns sieht ihn nicht mehr)
   dessen eigene Hymnen-Symbole (Effekt-Löschung reverts die Attribut-
   Buffs über den deleteActiveEffect-Haken wie die GM-Karten auch),
   dann räumt die endActiveHymns-Maschine Betroffenen-Symbole, Gesangs-
   flächen (Actor-Flags hymnZone.{ref}) und postet die Ende-Karte.
   Wird vom korrigierten deleteToken-Hook in aoe.js aufgerufen (GM). */
export async function hymnTokenDeleted(tokenDoc) {
  const actor = tokenDoc?.actor ?? null;
  if (!actor) return false;
  const refs = new Set();
  for (const effect of [...(actor.effects ?? [])]) {
    const fd = effect.getFlag(game.system.id, "flagData");
    if (!fd || fd.caster !== actor.id) continue;
    if (!game.symbaroum.config.HYMN_REFERENCES.includes(fd.ability)) continue;
    refs.add(fd.ability);
    try {
      await effect.delete();
    } catch (error) {
      console.warn("Symbaroum Hymnen: Sänger-Symbol konnte nicht entfernt werden", error);
    }
  }
  return endActiveHymns(actor, { extraRefs: refs });
}

/* Hymnen-Anhang v1.1 (Rudolfs Testrunde v1, P12 - Freigabe 20.11.):
   Rundenwechsel-/Weltzeit-Maintain-Scan. Fuer jeden Sänger-Akteur auf
   der Szene mit eigenem Hymnen-Symbol UND vermerkter aktiver Gesangs-
   flaeche laeuft der gewurflose hymnZoneRescan nach (Heraus-Bewegte
   verlieren das Symbol, Hinein-Bewegte ziehen es automatisch nach,
   wie die A29-"Ja"-Maintain-Runde auch - dieselbe Maschine, nur ohne
   Spielerklick). GM-only (Aufrufstelle updateCombat/updateWorldTime
   in aoe.js ist bereits GM-gated); ein zweimaliger Lauf je Runde
   (Kampf + Weltzeit) ist idempotent - der Vergleich setzt Symbole
   nur bei Bestands-Abweichung. */
export async function hymnAutoRescanRound() {
  if (!game.user?.isGM) return;
  const seenActors = new Set();
  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || seenActors.has(actor.id)) continue;
    let ref = null;
    for (const effect of actor.effects ?? []) {
      const fd = effect.getFlag(game.system.id, "flagData");
      if (fd?.caster === actor.id && game.symbaroum.config.HYMN_REFERENCES.includes(fd?.ability)) {
        ref = fd.ability;
        break;
      }
    }
    if (!ref) continue;
    if (!actor.getFlag(game.system.id, `hymnZone.${ref}`)?.regionId) continue;
    seenActors.add(actor.id);
    await hymnZoneRescan({
      actor: actor,
      token: token,
      tokenId: token.id,
      ability: { reference: ref },
      abilityName: hymnPowerLabel(ref),
      actingCharName: actor.name,
    });
  }
  /* v2 F9 (Rudolfs Freigabe 20.11.): Die Auren laufen im selben Runden-
     Rhythmus mit (Hymnen-Modell) - je WIRKER mit Auren-Symbol (fd.caster
     === Akteur, fd.ability in AURA_REFERENCES) und vermerkter Auren-
     Region laeuft der auraZoneRescan (Joiner/Leaver, s.u.) nach.
     GM-gated wie oben, idempotent, seenActors verhindert Doppel-Laeufe. */
  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || seenActors.has(actor.id)) continue;
    let auraRef = null;
    for (const effect of actor.effects ?? []) {
      const fd = effect.getFlag(game.system.id, "flagData");
      if (fd?.caster === actor.id && (game.symbaroum.config.AURA_REFERENCES ?? []).includes(fd?.ability)) {
        auraRef = fd.ability;
        break;
      }
    }
    if (!auraRef) continue;
    if (!actor.getFlag(game.system.id, `aurazone.${auraRef}`)?.regionId) continue;
    seenActors.add(actor.id);
    await auraZoneRescan({
      actor: actor,
      token: token,
      tokenId: token.id,
      ability: { reference: auraRef },
      abilityName: auraPowerLabel(auraRef),
      actingCharName: actor.name,
    });
  }
  /* v2.1 F22 (Rudolfs G5-1-Freigabe "GLYPHEN braucht Join/Leave je
     Runde"): Der Glyphen-Kreis laeuft im selben Runden-Rhythmus mit
     (Hymnen-Modell) - je WIRKER mit vermerkter Glyphen-Region (Flag
     glyphzone.{ref}; KEIN Symbol als Anker noetig, auch ein leerer
     Erstgesang haelt den Kreis) und EXISTIERENDER Region laeuft der
     glypheRegionRescan (Joiner/Leaver). Eigenes seen-Set: Ein Akteur
     kann Gesang/Aura UND Glyphe halten, beide Rescans laufen. */
  const glyphSeen = new Set();
  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || glyphSeen.has(actor.id)) continue;
    for (const glyphRef of game.symbaroum.config.GLYPH_ZONE_REFERENCES ?? []) {
      if (!actor.getFlag(game.system.id, `glyphzone.${glyphRef}`)?.regionId) continue;
      glyphSeen.add(actor.id);
      await glypheRegionRescan({
        /* v2.5 F35: Defaults wie getFunctionStuffDefault - die opponierte
           Joiner-Probe des Rescans darf nie undefined weiterreichen. */
        actor: actor,
        token: token,
        tokenId: token.id,
        ability: { reference: glyphRef },
        abilityName: game.i18n.localize("POWER_LABEL.DRAINING_GLYPH"),
        actingCharName: actor.name,
        favour: 0,
        modifier: 0,
      });
      break;
    }
  }
}

/* Hymnen-Paket 1.5 - Schwaechende Hymne, Ausfuehrungs-Vorlauf
   (Muster preDialogHymnChoice): A29-"Ja" (presetMaintain) fuehrt die
   Gesangsrunde WURFLOS und STILL aus - keine Probe, kein Re-Scan,
   keine neuen Proben (Rudolfs Entscheidung), die Missgunst-Marker
   wirken unbefristet weiter. Klick auf die Hymne bei LAUFENDEM
   Gesang zeigt den Abbruch-Dialog (POWER_HYMN.CONFIRM_ABORT, generi-
   scher Kraftname des LAUFENDEN Gesangs). Erstgesang: Maintain-Radios
   aus (keine Maintain-Probe, die Wahl waere wirkungslos - 1.4-
   Parallele), sonst der volle Wurfeldialog (Casting CASTING, Modifi-
   kator/Gunst/Segen-Zeilen wie im Fluch-Maintain-Dialog). */
async function preDialogWeakeningHymnChoice(functionStuff) {
  /* v1.3 F14 (Rudolfs Freigabe 20.11.): A29-"Ja" laeuft jetzt wie bei
     den Buff-Hymnen durch hymnZoneRescan - Hinausgegangene verlieren
     den Missgunst-Marker, eindringende Feinde ziehen mit opponierter
     Erstgesangs-Probe nach (das v1.2-Ruhe-Modell entfaellt). */
  if (functionStuff.presetMaintain) {
    await hymnZoneRescan(functionStuff);
    return;
  }
  const runningRef = hymnActiveForCaster(functionStuff.actor);
  if (runningRef === "weakeninghymn") {
    symbDialog({
      title: functionStuff.abilityName,
      content: `<p>${game.i18n.format("POWER_HYMN.CONFIRM_ABORT", { powername: hymnPowerLabel(runningRef) })}</p>`,
      classes: isModernDialogActive() ? modernDialogClasses("modern-power-confirm-dialog") : [],
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("BUTTON.YES"),
          callback: async () => {
            await postHymnEndCard(
              { actor: functionStuff.actor, actingCharName: functionStuff.actingCharName, abilityName: hymnPowerLabel(runningRef) },
              "POWER_HYMN.CHAT_END_ABORTED"
            );
            await endActiveHymns(functionStuff.actor, { silent: true });
          },
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.NO"),
        },
      },
      default: "yes",
    });
    return;
  }
  functionStuff.maintain = game.symbaroum.config.MAINTAIN_NOT;
  await modifierDialog(functionStuff);
}

/* Feinde der Schwaechenden Hymne im Gesangsbereich (Sichtweiten-
   Fallback ohne Flaeche, Muster getHymnAffectedTokens mit umgekehrter
   Disposition): Feinde = Disposition KLEINER als die des Saengers;
   der Saenger selbst zaehlt nie. Novize (Stufe 1): nur VERWUNDETE
   Feinde (Zaehigkeit unter Maximum, RAW "jedem verwundeten Feind"),
   Adept+ alle.
   v1.2 F8 (strikter Core-Clip): Am ZONEN-Pfad zaehlt nur die geclippte
   Flaeche - der Schall-Strahlen-Filter ist entfernt und laeuft NUR NOCH
   im Sichtweiten-Fallback ohne Flaeche (Messfehler schliessen ein,
   SL-Urteil wirkt; blockierte Feinde als skipLines an weakening-
   HymnResult, Kartenzeile AOE.SENSE_SKIP). Rückgabe: { tokens, skipLines }. */
function getWeakeningHymnTargets(functionStuff) {
  const casterToken = functionStuff.token ?? canvas.tokens?.placeables?.find((t) => t.id === functionStuff.tokenId);
  if (!casterToken) return { tokens: [], skipLines: [] };
  const casterDisposition = casterToken.document?.disposition ?? 0;
  const inZone = new Set();
  if (functionStuff.hymnZone?.regionId) {
    const region = hymnRegionById(functionStuff.hymnZone.regionId);
    if (region) {
      for (const t of hymnRegionTokens(region)) inZone.add(t.id);
    }
  }
  const skipLines = [];
  const soundPasses = (token) => {
    const soundCheck = senseBlocked(casterToken, token, "sound");
    if (soundCheck.error) {
      // Messfehler => Feind einschließen, SL-Urteil wirkt
      skipLines.push(`<p>${game.i18n.format("AOE.SENSE_MEASURE_FAIL", { targetname: token.name })}</p>`);
      return true;
    }
    if (soundCheck.blocked) {
      skipLines.push(
        `<p>${game.i18n.format("AOE.SENSE_SKIP", { targetname: token.name, sense: game.i18n.localize("AOE.SENSE_SOUND") })}</p>`
      );
      return false;
    }
    return true;
  };
  const sightLimit = game.symbaroum.config.SIGHT_RANGE_UNITS ?? 50;
  const enemies = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.actor) continue;
    if ((token.document?.disposition ?? 0) >= casterDisposition) continue;
    if (functionStuff.hymnZone?.regionId) {
      if (!inZone.has(token.id)) continue;
    } else {
      try {
        if (canvas.grid.measureDistance(casterToken, token) > sightLimit) continue;
      } catch (distanceError) {
        // Messung nicht verfuegbar => Ziel einschliessen, SL-Urteil wirkt
      }
      /* v1.2 F8: Schall-Filter NUR im Sichtweiten-Fallback - in der
         Flaeche zaehlt die geclippte Region, kein zweiter Strahl. */
      if (!soundPasses(token)) continue;
    }
    if (functionStuff.powerLvl.level === 1) {
      const toughness = token.actor.system?.health?.toughness;
      if (Number(toughness?.value ?? 0) >= Number(toughness?.max ?? 0)) continue;
    }
    enemies.push(token);
  }
  return { tokens: enemies, skipLines };
}

/* Hymnen-Paket 1.5 - Ergebnis der Schwaechenden Hymne (nur Erst-
   gesang): Standard-Karte (markierte Ziel-Probe oder einfacher Wurf
   ohne Markierung), danach JE Feind aus der Gesangsflaeche eine
   eigene opponierte Probe Ausstrahlung<-Willenskraft mit denselben
   Dialog-Werten (Maintain-Chain-Muster: eine Gesangsentscheidung,
   je Feind ein Wurf, baseRoll). Bestandene Proben setzen den
   Missgunst-Marker (weakeninghymn-Symbol mit Autor-Marker,
   maintained - A29-Erinnerung und alle RAEumpfade greifen darueber).
   Der Saenger selbst traegt das Symbol ebenfalls (Sichtbarkeit,
   endActiveHymns-Raeumung, hymnResult-Parallele). */
async function weakeningHymnResult(rollData, functionStuff) {
  const abilityRef = functionStuff.ability?.reference;
  const casterEffects = functionStuff.activelyMaintaninedCasterEffect;
  functionStuff.activelyMaintaninedCasterEffect = [];
  await standardPowerResult(rollData, functionStuff);
  functionStuff.activelyMaintaninedCasterEffect = casterEffects;
  const weakeningSelection = getWeakeningHymnTargets(functionStuff);
  const affectedEnemies = weakeningSelection.tokens;
  const affectedSkipLines = weakeningSelection.skipLines;
  /* v1.3 F14 (Rudolfs Freigabe 20.11.): Gesangsflaeche VERMERKEN, BEVOR
     die Feind-Zaehlung entscheidet - die Hymne haelt die Dauerzone AUCH
     LEER (Leer-Karte, Nachzuegler kommen je Runde per hymnZoneRescan;
     hymnResult-Muster: vorherige Flaeche desselben Refs raeumen, der
     Close-Waechter des Dialogs darf sie jetzt nicht mehr anfassen). */
  if (functionStuff.hymnZone?.regionId) {
    const previousZone = functionStuff.actor.getFlag(game.system.id, `hymnZone.${abilityRef}`);
    if (previousZone?.regionId && previousZone.regionId !== functionStuff.hymnZone.regionId) {
      const previousRegion = hymnRegionById(previousZone.regionId);
      if (previousRegion) await previousRegion.delete();
    }
    await functionStuff.actor.setFlag(game.system.id, `hymnZone.${abilityRef}`, functionStuff.hymnZone);
    functionStuff.hymnZoneCommitted = true;
  }
  if (affectedEnemies.length === 0) {
    /* Ohne platzierte Flaeche (Abbruch/Rechte-Rest) bleibt beim Leer-
       Wurf der alte Raeum-Pfad - die committete Zone bleibt hingegen
       stehen und bekommt die Leer-Karte. */
    if (!functionStuff.hymnZoneCommitted) cleanupFreshHymnZone(functionStuff);
    /* v1.4 F17 (Rudolfs Testrunde v1.3.1, T9/T10): Der LEERE Erstgesang
       traegt jetzt ebenfalls das Caster-Symbol (Muster des besetzten
       Pfads) - darueber laufen A29-Runde, Abbruch und der Join/Leave-
       Rescan; vorher endete die Hymne still nach der Leer-Karte (kein
       Maintain, kein Abbruch, hymnActiveForCaster leer, kein Rescan). */
    if (functionStuff.hymnZoneCommitted && functionStuff.tokenId) {
      await createModifyTokenChatButton([
        {
          tokenId: functionStuff.tokenId,
          addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === abilityRef)),
          effectDuration: 1,
          maintained: true,
          casterId: functionStuff.actor.id,
          abilityRef: abilityRef,
          casterName: functionStuff.actingCharName,
        },
      ]);
    }
    const emptyTitle = `<h4>${game.i18n.format("POWER_HYMN.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
    const emptyLines = [...affectedSkipLines, `<p>${game.i18n.localize("POWER_WEAKENING_HYMN.EMPTY_ZONE")}</p>`];
    await postMaintainChainCard(functionStuff, emptyTitle, emptyLines, []);
    return;
  }
  const flagDataArray = [];
  const rolls = [];
  // S1: Skip-Diagnosezeilen des Schall-Filters zuerst (NIE stiller Skip)
  const lines = [...affectedSkipLines];
  if (functionStuff.tokenId) {
    flagDataArray.push({
      tokenId: functionStuff.tokenId,
      addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === abilityRef)),
      effectDuration: 1,
      maintained: true,
      casterId: functionStuff.actor.id,
      abilityRef: abilityRef,
      casterName: functionStuff.actingCharName,
    });
  }
  const markedTokenId = functionStuff.targetData?.hasTarget ? functionStuff.targetData.tokenId : null;
  let weakenedCount = 0;
  for (const token of affectedEnemies) {
    let succeeded = false;
    const markedProbe = token.id === markedTokenId && rollData?.[0]?.trueActorSucceeded !== undefined;
    if (markedProbe) {
      succeeded = rollData[0].trueActorSucceeded !== false;
    } else {
      const probe = await baseRoll(
        functionStuff.actor,
        functionStuff.castingAttributeName,
        token.actor,
        functionStuff.targetResistAttribute,
        functionStuff.favour,
        functionStuff.modifier,
        false
      );
      rolls.push(...(probe.rolls ?? []));
      succeeded = probe.trueActorSucceeded;
    }
    if (succeeded) {
      weakenedCount++;
      flagDataArray.push({
        tokenId: token.id,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === abilityRef)),
        effectDuration: 1,
        maintained: true,
        casterId: functionStuff.actor.id,
        abilityRef: abilityRef,
        casterName: functionStuff.actingCharName,
      });
      lines.push(`<p>${game.i18n.format("POWER_WEAKENING_HYMN.WEAKENED_LINE", { targetname: token.name })}</p>`);
    } else {
      lines.push(`<p>${game.i18n.format("POWER_WEAKENING_HYMN.RESIST_LINE", { targetname: token.name })}</p>`);
    }
  }
  if (functionStuff.powerLvl.level > 2 && weakenedCount > 0) {
    lines.push(`<p>${game.i18n.localize("POWER_WEAKENING_HYMN.MASTER_HINT")}</p>`);
  }
  const title = `<h4>${game.i18n.format("POWER_HYMN.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
  await postMaintainChainCard(functionStuff, title, lines, rolls);
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
}

/* Hymnen-Paket 1.5 - Dornenmantel, Ausfuehrungs-Vorlauf: A29-"Ja"
   (presetMaintain) = Re-Scan (Naehe-Pruefung + Bewegungs-Abgleich +
   Nachzieher), Klick auf das aktive Toggle = Deaktivierungs-Dialog
   (Berserker-/Tanzende-Waffe-Muster: der flagTest-Zweig in actor.js
   usePower wuerde identisch arbeiten, wird aber vom preDialog-
   Function umgangen - hier identisch nachgebaut, Ja wendet die
   flagPresent-Abwicklung direkt an: kein Wurf, keine Korruption),
   Erstaktivierung = schmaler formloser Dialog (CASTING_NOT, ohne
   Maintain-Radios - 1.4-Parallele). */
async function preDialogThornCloakChoice(functionStuff) {
  if (functionStuff.presetMaintain) {
    await thornCloakRescan(functionStuff);
    return;
  }
  const toggleActive = Boolean(
    functionStuff.actor.hasCondition(functionStuff.flagTest) || functionStuff.actor.getFlag(game.system.id, functionStuff.flagTest)
  );
  if (toggleActive) {
    symbDialog({
      title: functionStuff.abilityName,
      content: `<p>${game.i18n.format("DIALOG.CONFIRM_DEACTIVATE", { ability: functionStuff.abilityName })}</p>`,
      classes: isModernDialogActive() ? modernDialogClasses("modern-power-confirm-dialog") : [],
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("BUTTON.YES"),
          callback: async () => {
            await thornCloakResult(null, functionStuff);
          },
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.NO"),
        },
      },
      default: "yes",
    });
    return;
  }
  functionStuff.maintain = game.symbaroum.config.MAINTAIN_NOT;
  await modifierDialog(functionStuff);
}

/* v1.6 (Rudolfs Testrunde v1.5, Punkt 5b): Nahkampfreichweite =
   benachbarte Felder szenen-UNABHAENGIG messen. Die v1.5-Messung
   (canvas.grid.measureDistance gegen 2 Szenen-Einheiten) haengt an
   der gridDistance-Einstellung der Szene und filterte in Rudolfs
   Testszene JEDES benachbarte Token aus; der Zauberstab misst jetzt
   die Chebyshev-Distanz der Token-Zentren gegen 1.5 Grid-Zellen
   (benachbarte Felder orthogonal UND diagonal; deutlich groessere
   Kreaturen daneben = SL-Urteil, dokumentierte Grenze). Messfehler
   schliessen das Ziel EIN (SL-Urteil, Muster getHymnAffected-
   Tokens). */
/* Zentrum eines Tokens tolerant bestimmen: Placeables haben center,
   TokenDocuments (getActorToken liefert seit V10 TokenDocuments,
   nicht Placeables) nicht - dort Bildmitte aus x/y + width/height
   rekonstruieren, damit die Chebyshev-Messung immer Zentren gegen
   Zentren stellt (v1.7, Rudolfs Testrunde v1.6.1 Punkt 2). */
function thornCloakTokenCenter(token) {
  if (token?.center) return token.center;
  const width = token?.width ?? 0;
  const height = token?.height ?? 0;
  return { x: (token?.x ?? 0) + width / 2, y: (token?.y ?? 0) + height / 2 };
}

/* NOTFALL-Naehe (v1.2 F7, bewusst behaltener Notfall-Pfad mit Trace):
   benachbarte Felder, szenen-unabhaengig. Laeuft nur, wenn KEINE Dornen-
   mantel-Flaeche existiert (Anlage gescheitert, geloescht, Rechte). */
function thornCloakInMeleeRange(tokenA, tokenB) {
  try {
    const cell = canvas.grid?.sizeX ?? canvas.grid?.w ?? canvas.grid?.size ?? 100;
    const a = thornCloakTokenCenter(tokenA);
    const b = thornCloakTokenCenter(tokenB);
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= cell * 1.5;
  } catch (rangeError) {
    return true;
  }
}

/* v1.2 F7: Zone-Mitgliedschaft eines Tokens - mit Flaeche entscheidet die
   Region (Core-Containment testInsideRegion, Rueckfall region.tokens-Id-
   Liste; die geclippte Optik ist die Wahrheit), ohne Flaeche die Notfall-
   Naehe (thornCloakInMeleeRange, Notfall-Pfad mit Trace). */
function thornCloakTokenInZone(casterToken, token, region) {
  if (!region) return thornCloakInMeleeRange(casterToken, token);
  const doc = token?.document ?? token;
  if (typeof doc?.testInsideRegion === "function") {
    try {
      return doc.testInsideRegion(region);
    } catch (zoneTestError) {
      game.symbaroum.log("Hymnen v1.2: Dornenmantel-Zonentest", zoneTestError);
    }
  }
  const zoneIds = new Set(hymnRegionTokens(region).map((t) => t.id));
  return zoneIds.has(String(doc?.id ?? token?.id ?? ""));
}

/* Verbuendete in der Dornenmantel-Flaeche des Mystikers (v1.2 F7,
   Rudolfs Freigabe 20.11.): Mit Flaeche zaehlt die Region-Mitgliedschaft
   (Core-Containment testInsideRegion auf der geclippten Zone, Optik =
   Pruefung), ohne Flaeche die szenen-unabhaengige Notfall-Naehe
   (thornCloakInMeleeRange, Notfall-Pfad mit Trace) - der Mystiker
   selbst nie.
   v1.7 (unveraendert uebernommen): Dispositions-Regel - FEINDLICHE
     Token zaehlen nur bei feindlichem Mystiker als Verbuendete;
     NEUTRALE immer (vorher fielen sie bei freundlichem Mystiker
     durch das < heraus).
   - casterToken kann Placeable ODER TokenDocument sein - Disposition
     tolerant lesen.
   - Skip-Diagnosezeilen (Muster der Heilaura v2.15): Nahe Token (bis 3
     Chebyshev-Zellen), die NICHT gewoben wurden, werden mit GRUND
     zurueckgeliefert (Disposition/Distanz/bereits gewoben), damit
     stille Skips auf der Aktivierungs- und Rescan-Karte lesbar sind. */
function thornCloakAlliesInZone(functionStuff, casterToken, region) {
  /* v2.2 F29 (Rudolfs Testrunde v2.1, R3): Die Dornenmantel-Flaeche
     ist sichtbar - die "nicht gewoben"-Diagnosezeilen und der
     Chebyshev-Nahbereichs-Scan entfallen. Die Region-Mitgliedschaft
     (bzw. ohne Flaeche die Notfall-Naehe, bewusst behalten) ist die
     Autoritaet; die v1.7-Dispositions-Regel und der Bereits-Gewoben-
     Check bleiben als funktionale Filter (Doppel-Webe-Schutz).
     Rueckgabe ist die reine Verbuendeten-Liste. */
  if (!region) {
    console.info("Symbaroum Hymnen [trace] Dornenmantel ohne Flaeche - Notfall-Naehe (Chebyshev 1,5 Zellen) aktiv", { casterId: String(casterToken?.id ?? casterToken?.document?.id ?? "") });
  }
  const casterDisposition = casterToken?.document?.disposition ?? casterToken?.disposition ?? 0;
  const casterId = casterToken?.id ?? casterToken?.document?.id;
  const allies = [];
  try {
    for (const token of canvas.tokens?.placeables ?? []) {
      if (!token.actor || token.id === casterId) continue;
      /* v1.7-Dispositions-Regel: FEINDLICHE Token zaehlen nur bei
         feindlichem Mystiker, NEUTRALE immer. */
      const tokenDisp = token.document?.disposition ?? 0;
      if (tokenDisp < 0 && casterDisposition >= 0) continue;
      const alreadyWoven = token.actor.effects.some((effect) => {
        const fd = effect.getFlag(game.system.id, "flagData");
        return fd?.caster === functionStuff.actor.id && fd?.ability === "thorncloak";
      });
      if (alreadyWoven) continue;
      if (!thornCloakTokenInZone(casterToken, token, region)) continue;
      allies.push(token);
    }
  } catch (sweepError) {
    game.symbaroum.log("Hymnen v2.2: Dornenmantel-Sweep", sweepError);
  }
  return allies;
}

/* Dornenmantel-Ruestungs-Item am Akteur auf die aktuelle Bonus-Stufe
   stellen (Bewegungs-Hook und Rescan teilen diesen Helfer). */
async function thornCloakSetArmorDice(actor, dice) {
  for (const item of actor.items) {
    if (item.getFlag(game.system.id, "thorncloakarmor") && item.system?.bonusProtection !== dice) {
      await item.update({ "system.bonusProtection": dice });
    }
  }
}

/* Raeumt alle Dornenmantel-VerbUndeten-Marker eines Mystikers ueber
   die GM-Anwenden-Karte (ihre Ruestungs-Items folgen dem Symbol ueber
   den preDeleteActiveEffect-Hook in hooks.js). */
async function endThornCloakAllies(functionStuff, options = {}) {
  const casterId = functionStuff.actor.id;
  const flagDataArray = [];
  const lines = [];
  const seen = new Set();
  for (const token of canvas.tokens?.placeables ?? []) {
    const tokenActor = token.actor;
    if (!tokenActor?.effects) continue;
    for (const effect of tokenActor.effects) {
      const fd = effect.getFlag(game.system.id, "flagData");
      if (fd?.caster !== casterId || fd?.ability !== "thorncloak") continue;
      const statusId = effect.statuses?.size ? [...effect.statuses][0] : null;
      if (!statusId) continue;
      const key = token.id + "|" + statusId;
      if (seen.has(key)) continue;
      seen.add(key);
      flagDataArray.push({ tokenId: token.id, removeEffect: statusId });
      lines.push(`<p>${game.i18n.format("POWER_THORN_CLOAK.ALLY_END_LINE", { targetname: token.name })}</p>`);
    }
  }
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
  if (lines.length > 0 && !options.silent) {
    const title = `<h4>${game.i18n.format("POWER_THORN_CLOAK.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
    await postMaintainChainCard(functionStuff, title, lines, []);
  }
}

/* Hymnen-Paket 1.5 - Dornenmantel-Ergebnis: Aktivierung (Ruestungs-
   Item am Mystiker +1W6 Startstufe, Adept+ Verbuendete in Nahkampf-
   reichweite mit Marker +1W4) und Deaktivierung (VerbUndeten-Marker
   ueber die Karte, Caster-Symbol/Ruestung ueber den Standard-Pfad +
   Hook). */
async function thornCloakResult(rollData, functionStuff) {
  const wasActive = Boolean(
    functionStuff.actor.hasCondition(functionStuff.flagTest) || functionStuff.actor.getFlag(game.system.id, functionStuff.flagTest)
  );
  if (wasActive) {
    /* v2.8.1 (Rudolfs v2.8-Testrunde, Punkt-11-Anmerkung): Der Icon-
       Abbruch postet die Ende-Karte im F41-Satz (CHAT_END_POWER-Titel
       plus CHAT_END_ABORTED-Zeile, Hymnen-Muster) statt der "entlaesst"-
       Standardkarte. Maschinenraeumung wie im alten standardPowerResult-
       Pfad: Caster-Symbol (removeCondition inkl. preDeleteActiveEffect-
       Kette fuer die Ruestungs-Items), Verbundete, Flaeche, Bewegungs-
       Flag. */
    try {
      await functionStuff.actor.removeCondition(functionStuff.flagTest);
    } catch (deactivateError) {
      console.warn("Symbaroum Hymnen: Dornenmantel-Symbol konnte nicht entfernt werden", deactivateError);
    }
    try {
      await functionStuff.actor.unsetFlag(game.system.id, functionStuff.flagTest);
    } catch (legacyFlagError) {
      game.symbaroum.log("Hymnen: Dornenmantel-Legacy-Flag-Raeumung", legacyFlagError);
    }
    await endThornCloakAllies(functionStuff);
    /* v1.2 F7: Deaktivierung raeumt die Dornenmantel-Flaeche der Szene
       mit ab (Optik = Pruefung; Muster Gesangs-Ende). */
    await removeThornCloakZones(functionStuff.actor.id);
    await functionStuff.actor.unsetFlag(game.system.id, "thornCloakMoved");
    await postHymnEndCard(
      { actor: functionStuff.actor, actingCharName: functionStuff.actingCharName, abilityName: game.i18n.localize("POWER_LABEL.THORN_CLOAK") },
      "POWER_HYMN.CHAT_END_ABORTED"
    );
    return;
  }
  await standardPowerResult(rollData ?? null, functionStuff);
  const casterToken = functionStuff.token ?? canvas.tokens?.placeables?.find((t) => t.id === functionStuff.tokenId);
  /* v1.2 F7/v1.3 F9a/F12 (Rudolfs Freigabe 20.11.): Erstaktivierung
     folgt dem Zonen-Tab - Autoplatzierung AN = Direkt-Anlage mittig,
     AUS = interaktiver SL-Picker (konsistent mit den Hymnen); Kreis-
     Radius aus dem Tab (F12, Default 2 Zellen), hidden optional (F9b).
     Ohne Flaeche (Rechte, Socket-Rest) entscheidet die Notfall-Naehe
     weiter, der Trace zeichnet den Weg. */
  await functionStuff.actor.unsetFlag(game.system.id, "thornCloakZoneDeclined");
  const placement = casterToken
    ? await placeThornCloakZone(casterToken, functionStuff.actor, functionStuff.ability)
    : { region: null, declined: false };
  const cloakRegion = placement?.region ?? null;
  if (placement?.declined) {
    /* Bewusster Picker-Abbruch: Merker am Akteur - der A29-Self-Heal
       legt gegen den Abbruch NICHT still nach. */
    await functionStuff.actor.setFlag(game.system.id, "thornCloakZoneDeclined", true);
    console.info("Symbaroum Hymnen [trace] Dornenmantel-Platzierung abgebrochen - Notfall-Naehe uebernimmt (Rescan heilt nicht gegen den Abbruch)", {
      actorId: functionStuff.actor.id,
    });
  }
  /* v1.6 (Rudolfs Testrunde v1.5, Punkte 5a/5c, Rudolfs Entscheidung
     "Maintain-Modell mit A29-Turnus", 17.11.2026): Das Caster-Symbol
     traegt jetzt den A29-Autor-Marker (maintained + caster + ability)
     - die A29-Erinnerung feuert JE EIGENE RUNDE (Ja = thornCloakRescan:
     1W6-Wiederaufbau ohne Bewegung seit dem letzten eigenen Zug,
     Leaver raus, Joiner ab Adept rein; Nein = Ende mit vollstaendiger
     Raeumung), die Konzentration erfasst die Kraft ohne den alten
     hasCondition-Fallback (der bleibt als Sicherheitsnetz stehen).
     Ein Maintain-WURF bleibt weiterhin keiner (Toggle ohne Probe). */
  try {
    const cloakEffect = functionStuff.actor.effects.find((e) => e.statuses?.has?.("thorncloak"));
    if (cloakEffect) {
      const cloakFlagData = cloakEffect.getFlag(game.system.id, "flagData") ?? {};
      await cloakEffect.update({
        [`flags.${game.system.id}.flagData`]: { ...cloakFlagData, maintained: true, caster: functionStuff.actor.id, ability: "thorncloak" },
      });
    }
  } catch (cloakFlagError) {
    game.symbaroum.log("Hymnen 1.6: Dornenmantel-Maintain-Marker", cloakFlagError);
  }
  const flagDataArray = [];
  const lines = [];
  if (functionStuff.tokenId) {
    flagDataArray.push({
      tokenId: functionStuff.tokenId,
      actorId: functionStuff.actor.id,
      addObject: "thorncloakarmor",
      protection: "1d6",
    });
    lines.push(`<p>${game.i18n.format("POWER_THORN_CLOAK.ARMOR_LINE", { targetname: functionStuff.actingCharName, dice: "1d6" })}</p>`);
  }
  if (functionStuff.powerLvl.level > 1 && casterToken) {
    /* v1.7: Sweep liefert allies + Skip-Diagnosezeilen (Punkt 2);
       v1.2 F7: Sweep gegen die Flaeche statt Chebyshev. */
    const allies = thornCloakAlliesInZone(functionStuff, casterToken, cloakRegion);
    for (const token of allies) {
      flagDataArray.push({
        tokenId: token.id,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "thorncloak")),
        effectDuration: 1,
        maintained: true,
        thorncloakArmor: true,
        casterId: functionStuff.actor.id,
        abilityRef: "thorncloak",
        casterName: functionStuff.actingCharName,
      });
      flagDataArray.push({
        tokenId: token.id,
        actorId: token.actor.id,
        addObject: "thorncloakarmor",
        protection: "1d4",
      });
      lines.push(`<p>${game.i18n.format("POWER_THORN_CLOAK.ALLY_LINE", { targetname: token.name })}</p>`);
    }
  }
  if (functionStuff.powerLvl.level > 2) {
    lines.push(`<p>${game.i18n.localize("POWER_THORN_CLOAK.MASTER_HINT")}</p>`);
  }
  const title = `<h4>${game.i18n.format("POWER_THORN_CLOAK.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
  await postMaintainChainCard(functionStuff, title, lines, []);
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
  await functionStuff.actor.unsetFlag(game.system.id, "thornCloakMoved");
}

/* A29-Rescan des Dornenmantels (Rudolfs Entscheidung: je eigene Runde
   ueber die A29-Erinnerung, keine Echtzeit-Reaktion auf Bewegung -
   dokumentierte Grenze, Hymnen-Parallele): Bewegungs-Abgleich des
   Mystikers (+1W6 ohne Bewegung seit dem letzten eigenen Zug, sonst
   +1W4, danach Flag neu), Zonen-Pruefung der geschuetzten Verbuende-
   ten (v1.2 F7: Dornenmantel-Flaeche; fehlt sie, stellt der Rescan sie
   erneut her - Self-Heal - und ohne Anlage greift die Notfall-Naehe
   2 m = Nachbarfelder; Hinausbewegte verlieren Marker und Ruestung,
   Hinzugezogene ab Adept erhalten beides automatisch). */
async function thornCloakRescan(functionStuff) {
  /* v2.4 F32B (Rudolfs Auswahlrunde): Voll-Migration des Kopfes auf
     den MASTER-ZONEN-Rahmen zoneRegionScanFrame - Guard, Region-
     Lookup (v1.2 F7: thornCloakRegionFor statt Akteur-Flag),
     Self-Heal-Rueckanlage (STILL mit forceAuto, BEVOR Leaver/
     Joiner geprueft werden, nie gegen einen bewussten Picker-
     Abbruch des Wirkers - thornCloakZoneDeclined, die Notfall-
     Naehe bleibt dann gewollt aktiv), Bestand (v2.2 F26: require-
     StatusId false, der Marker wirkt auch ohne Status-Icon) und
     der Bestands-Trace (F28) laufen jetzt IM Rahmen; eine
     fehlende Flaeche ist der LEGALE Notfall-Zustand (Notfall-Naehe v1.6,
     inZone leer) statt Abbruch. Der Ruestungspfad bleibt
     Mantel-lokal NACH dem Rahmen-Kopf. */
  const frame = await zoneRegionScanFrame(functionStuff, {
    guard: (ref) => ref === "thorncloak",
    flagPrefix: "thornCloakZone",
    lookupRegion: (actorId) => thornCloakRegionFor(actorId),
    selfHeal: async (frameCasterToken, frameActor) => {
      if (frameActor.getFlag(game.system.id, "thornCloakZoneDeclined") === true) return null;
      return (await placeThornCloakZone(frameCasterToken, frameActor, functionStuff.ability, { forceAuto: true }))?.region ?? null;
    },
    allowMissing: true,
    requireStatusId: false,
  });
  if (!frame) return;
  const { casterToken, region: cloakRegion, carriers: carrying } = frame;
  const moved = functionStuff.actor.getFlag(game.system.id, "thornCloakMoved") === true;
  await thornCloakSetArmorDice(functionStuff.actor, moved ? "1d4" : "1d6");
  const flagDataArray = [];
  const lines = [];
  if (functionStuff.powerLvl.level > 1) {
    for (const entry of carrying.values()) {
      if (entry.token.id === casterToken.id) continue;
      const inRange = thornCloakTokenInZone(casterToken, entry.token, cloakRegion);
      if (!inRange) {
        const statusId = entry.effect.statuses?.size ? [...entry.effect.statuses][0] : null;
        if (!statusId) continue;
        flagDataArray.push({ tokenId: entry.token.id, removeEffect: statusId });
        lines.push(`<p>${game.i18n.format("POWER_THORN_CLOAK.ZONE_LEFT", { targetname: entry.token.name })}</p>`);
      }
    }
    /* v1.7: Sweep liefert allies + Skip-Diagnosezeilen (Punkt 4,
       Leaver/Joiner-Diagnose auf der Rescan-Karte); v1.2 F7: Sweep
       gegen die Flaeche statt Chebyshev. */
    const allies = thornCloakAlliesInZone(functionStuff, casterToken, cloakRegion);
    for (const token of allies) {
      flagDataArray.push({
        tokenId: token.id,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "thorncloak")),
        effectDuration: 1,
        maintained: true,
        thorncloakArmor: true,
        casterId: functionStuff.actor.id,
        abilityRef: "thorncloak",
        casterName: functionStuff.actingCharName,
      });
      flagDataArray.push({
        tokenId: token.id,
        actorId: token.actor.id,
        addObject: "thorncloakarmor",
        protection: "1d4",
      });
      lines.push(`<p>${game.i18n.format("POWER_THORN_CLOAK.ZONE_JOINED", { targetname: token.name })}</p>`);
    }
  }
  if (lines.length > 0) {
    const title = `<h4>${game.i18n.format("POWER_THORN_CLOAK.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
    await postMaintainChainCard(functionStuff, title, lines, []);
  }
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
  await functionStuff.actor.unsetFlag(game.system.id, "thornCloakMoved");
}

/* Hymnen-Paket 1.5 (Dornenmantel-Meister, Rudolfs Entscheidung
   "automatisch"): Jeder erfolgreiche Nahkampftreffer gegen den
   Mystiker oder einen geschuetzten Verbuendeten loest die Rueck-
   schlags-Karte aus - 1W10 Schaden, Ruestung ignoriert (direkte
   Zaehigkeits-Buchung ueber die GM-Anwenden-Karte), FRISCHE Distanz-
   messung zum Dornenmantel-Mystiker (die je-Runde-Tracking-Grenze
   faengt hier keinen rausgewanderten Verbuendeten ab). Aufgerufen am
   Ende von attackResult (EC- und klassischer Pfad). */
async function thornCloakRetaliation(functionStuff, damageTot, rollData) {
  try {
    if (damageTot <= 0) return;
    /* v1.6 (Rudolfs Testrunde v1.5, Punkt 5): attackResult arbeitet
       mit FLACHEN Waffen-Klonen (actor.system.weapons, Original:
       functionStuff.weapon.isMelee an 4 Stellen) - system?.isMelee
       war immer undefined, das Gate brach jeden Rueckschlag ab.
       Flach lesen, system nur als Rueckfalle. */
    const isMeleeWeapon = Boolean(functionStuff.weapon?.isMelee ?? functionStuff.weapon?.system?.isMelee);
    /* v1.7 (Rudolfs Testrunde v1.6.1, Punkt 3): resistRoll aus dem
       Gate ENTFERNT - dialog.js setzt resistRoll=true fuer jeden
       NSC->PC-Angriff mit aktiver Verteidigung des Spieler-Ziels,
       das Gate brach deshalb JEDENS NSC->PC-Rueckschlag ab. Der
       Verteidigungswurf ist bereits ueber die trueActorSucceeded-
       Probe unten abgedeckt; echte Resistenzzweige laufen ohnehin
       ueber isAlternativeDamage. */
    if (!isMeleeWeapon || functionStuff.isAlternativeDamage) return;
    if (!rollData.some((r) => r.trueActorSucceeded)) return;
    const defenderToken = functionStuff.targetData?.token;
    const defenderActor = functionStuff.targetData?.actor;
    if (!defenderToken || !defenderActor) return;
    if (!defenderActor.items.some((i) => i.getFlag(game.system.id, "thorncloakarmor"))) return;
    /* Schutz-Ursprung: Caster-Aktor aus dem Dornenmantel-Marker (am
       Mystiker selbst traegt die flagTest-Condition den Marker). */
    let casterActor = defenderActor;
    const marker = defenderActor.effects.find((e) => {
      const fd = e.getFlag(game.system.id, "flagData");
      return e.statuses?.has?.("thorncloak") && fd?.caster;
    });
    if (marker) {
      const fd = marker.getFlag(game.system.id, "flagData");
      casterActor = game.actors.get(fd.caster) ?? canvas.tokens?.placeables?.find((t) => t.actor?.id === fd.caster)?.actor ?? defenderActor;
    }
    const cloakItem = casterActor.items.find((it) => it.system?.reference === "thorncloak");
    if (!cloakItem || (cloakItem.getLevel?.()?.level ?? 0) < 3) return;
    /* Frische Zugehoerigkeit (v1.2 F7): Verbuendete nur in der Dornen-
       mantel-Flaeche des Mystikers; bei fehlender Messung wirkt der
       Schutz (SL-Urteil). Ohne Flaeche greift die Notfall-Naehe
       (thornCloakInMeleeRange, v1.6-Fallback). */
    if (casterActor !== defenderActor) {
      const casterToken = canvas.tokens?.placeables?.find((t) => t.actor?.id === casterActor.id);
      const cloakRegion = thornCloakRegionFor(casterActor.id);
      if (casterToken && !thornCloakTokenInZone(casterToken, defenderToken, cloakRegion)) return;
    }
    const retaliationRoll = await new Roll("1d10").evaluate();
    await createModifyTokenChatButton([{ tokenId: functionStuff.tokenId, actorId: functionStuff.actor.id, toughnessChange: -1 * retaliationRoll.total }]);
    const title = `<h4>${game.i18n.localize("POWER_THORN_CLOAK.RETALIATION_TITLE")}</h4>`;
    const line = `<p>${game.i18n.format("POWER_THORN_CLOAK.RETALIATION_LINE", { targetname: functionStuff.actingCharName, count: retaliationRoll.total })}</p>`;
    await postMaintainChainCard({ actor: casterActor, actingCharName: casterActor.name }, title, [line], [retaliationRoll]);
  } catch (retaliationError) {
    game.symbaroum.log("Hymnen 1.5: Dornenmantel-Rueckschlag", retaliationError);
  }
}

/* Kraefte-Paket 1 (Rudolfs Baufreigabe "Paket 1 bauen", 21.11., Baustein B):
   Schutzrunen-Vergeltung + Maintain-Abbruch.
   Trigger (Rudolfs Entscheidung 2, Dornenmantel-Parallele): physischer
   Treffer MIT SCHADEN > 0 auf den Runen-Marker-Traeger - NK UND FK
   physisch (Entscheidung 1), ein Missgeschoss ohne Schaden loest den
   Spiegel NICHT aus. Alternative-Schaden-Angriffe und Mystik-Pfade
   bleiben draussen (isAlternativeDamage-Gate wie beim Dornenmantel).
   Vergeltungs-Spiegel ab Adept: 1W4 (Adept) bzw. 1W6 (Meister) Schaden
   an den Angreifer, RUESTUNG IGNORIERT (Pur-Buchung ueber die
   GM-Apply-Karte, Muster thornCloakRetaliation); eine eigene
   Reaktionskarte zeigt den Spiegelwurf.
   v1.3 (Rudolfs 4a-Entscheidung): Die [Resolute - Schaden]-Probe bei
   erlittenem Schaden laeuft NICHT mehr still auf dieser Karte, sondern
   ueber die generische Hymnen-1.5/1.6-Konzentrations-maschine
   (preUpdateActor: GM-Karte mit Proben-Taste + SC-Spieler-Karte, bei
   Misslingen Ende ueber a29AbortMaintainPower) - der Marker traegt die
   Maintain-Tags {maintained, caster, ability} (siehe standardPowerResult). */
async function protectiveRunesRetaliation(functionStuff, damageTot, rollData) {
  try {
    if (damageTot <= 0) return;
    if (functionStuff.isAlternativeDamage) return;
    if (!rollData.some((r) => r.trueActorSucceeded)) return;
    const defenderToken = functionStuff.targetData?.token;
    const defenderActor = functionStuff.targetData?.actor;
    if (!defenderToken || !defenderActor) return;
    const marker = defenderActor.hasCondition("protectiverunes");
    if (!marker) return;
    /* Stufe: Item-Referenz schlägt, Fallback auf die flagData-Nummer
       im Marker (Setup schreibt powerLvl.level als flagData). */
    const runeItem = defenderActor.items.find((it) => it.system?.reference === "protectiverunes");
    const itemLevel = runeItem?.getLevel?.()?.level ?? 0;
    const markerFlagData = marker.getFlag(game.system.id, "flagData");
    /* v1.3: Marker-flagData ist jetzt ein OBJEKT {level, maintained, caster,
       ability} - Level aus .level, Legacy-Zahl bleibt lesbar. */
    const level = itemLevel > 0 ? itemLevel : Number(markerFlagData?.level) || Number(markerFlagData) || 0;
    if (level < 2) {
      /* Novize: kein Spiegel (erst ab Adept) - und die [Willenskraft -
         Schaden]-Probe laeuft v1.3 nicht mehr still hier, sondern ueber
         die generische Konzentrations-Karte (preUpdateActor). Kein
       Karteninhalt => keine Karte. */
      return;
    }
    /* 1) Vergeltungs-Spiegel (ab Adept), Ruestung ignoriert */
    let retaliationRoll = null;
    let mirrorLine = "";
    if (level >= 2) {
      const mirrorDie = level >= 3 ? "1d6" : "1d4";
      retaliationRoll = await new Roll(mirrorDie).evaluate();
      await createModifyTokenChatButton([
        { tokenId: functionStuff.tokenId, actorId: functionStuff.actor.id, toughnessChange: -1 * retaliationRoll.total },
      ]);
      mirrorLine = `<p>${game.i18n.format("POWER_PROTECTIVERUNES.CHAT_RETALIATION", {
        targetname: functionStuff.actingCharName,
        count: retaliationRoll.total,
      })}</p>`;
    }
    /* v1.3 (Rudolfs 4a-Entscheidung): KEINE stille [Willenskraft -
       Schaden]-Probe mehr auf dieser Karte - die Konzentrations-Abfrage
       feuert bei Schaden ueber die generische Hymnen-1.5/1.6-Maschine
       (gefluesterte GM-Karte mit Proben-Taste + EIGENE Spieler-Karte,
       Abbruch via a29AbortMaintainPower mit Ende-Karte im Glyphen/
       Hymnen-Stil). Auf der Reaktionskarte bleibt nur der Spiegel. */
    const title = `<h4>${game.i18n.localize("POWER_PROTECTIVERUNES.CHAT_REACTION_TITLE")}</h4>`;
    await postMaintainChainCard({ actor: defenderActor, actingCharName: defenderActor.name }, title, [mirrorLine], [retaliationRoll]);
  } catch (runesError) {
    game.symbaroum.log("Kraefte-Paket 1: Schutzrunen-Reaktion", runesError);
  }
}

/* Kraefte-Paket 1 (Baustein A, Feuerseele): Rueckstoss-/Vergeltungs-
   formel mit dem REGULAEREN Ruestungsweg (Rudolfs Entscheidung 4:
   "Ruestung schuetzt wie ueblich" gilt auf ALLEN Stufen) - dieselbe
   Konvention wie damageRollWithDiceParams: Charakter-Quelle wuerfelt
   den Rueckstoss und die Ruestung des Ziels zieht als statischer
   Wert ab (protectionNpc), NSC-Quelle hat Fixwerte (1W6=3 / 1W10=5)
   und die Charakter-Ruestung des Ziels wird ALS WURF abgezogen
   (protectionPc, unfavour-Variante bewusst nicht - der Rueckstoss
   ist kein Gunst-/Missgunst-Angriff). */
function firesoulCounterFormula(sourceActor, targetActor, die) {
  const label = game.i18n.localize("POWER_LABEL.FIRE_SOUL");
  if (sourceActor?.type === "character" || targetActor?.type === "monster") {
    const protNpc = Number(targetActor?.system?.combat?.protectionNpc ?? 0);
    return `${die}[${label}] - ${protNpc}`;
  }
  const npcFixed = die === "1d6" ? 3 : 5;
  const protPc = targetActor?.system?.combat?.protectionPc;
  if (protPc && Number(protPc) !== 0) {
    return `${npcFixed}[${label}] - (${protPc})`;
  }
  return `${npcFixed}[${label}] - 0`;
}

/* Kraefte-Paket 1, Baustein A (Rudolfs Baufreigabe 21.11.): Feuerseele-
   Rueckstoss am Ende der Angriffs-Ergebniskarte.
   Novize/Adept: wird der Mystiker im NAHKAMPF getroffen (Schaden > 0),
   feuert der Rueckstoss 1W6/1W10 auf den Angreifer - durch dessen
   Ruestung (Entscheidung 4, obige Formel). MEISTER zusaetzlich die
   Fernkampf-Vergeltung: auch physische FK-Angriffe (Ruestung schuetzt,
   RAW explizit) loesen 1W10 aus; Mystik- und Alternative-Schaden-
   Pfade bleiben draussen (die Kraft-Pfad-Vergeltung des Meisters
   laeuft separat in standardPowerResult, firesoulMasterPowerCounter).
   Kein Aktivierungstoggle - die Kraft wirkt als dauerhafte
   Reaktionsaura (RAW kennt keine Aktivierung). */
async function firesoulRetaliation(functionStuff, damageTot, rollData) {
  try {
    if (damageTot <= 0) return;
    if (functionStuff.isAlternativeDamage) return;
    if (!rollData.some((r) => r.trueActorSucceeded)) return;
    const defenderToken = functionStuff.targetData?.token;
    const defenderActor = functionStuff.targetData?.actor;
    if (!defenderToken || !defenderActor) return;
    /* v1.3: Marker-Gate - der Rueckstoss feuert nur im AKTIVEN Zustand */
    const level = firesoulActiveLevel(defenderActor);
    if (level < 1) return;
    const isMeleeWeapon = Boolean(functionStuff.weapon?.isMelee ?? functionStuff.weapon?.system?.isMelee);
    if (!isMeleeWeapon && level < 3) return;
    const die = isMeleeWeapon ? (level >= 2 ? "1d10" : "1d6") : "1d10";
    const counterRoll = await new Roll(firesoulCounterFormula(defenderActor, functionStuff.actor, die)).evaluate();
    const dealt = Math.max(0, counterRoll.total);
    if (dealt > 0) {
      await createModifyTokenChatButton([
        { tokenId: functionStuff.tokenId, actorId: functionStuff.actor.id, toughnessChange: -1 * dealt },
      ]);
    }
    const title = `<h4>${game.i18n.localize("POWER_FIRESOUL.CHAT_REACTION_TITLE")}</h4>`;
    const line = `<p>${game.i18n.format("POWER_FIRESOUL.CHAT_RETALIATION", {
      targetname: functionStuff.actingCharName,
      count: dealt,
    })}</p>`;
    await postMaintainChainCard({ actor: defenderActor, actingCharName: defenderActor.name }, title, [line], [counterRoll]);
  } catch (firesoulError) {
    game.symbaroum.log("Kraefte-Paket 1: Feuerseele-Rueckstoss", firesoulError);
  }
}

/* Kraefte-Paket 1, Baustein A: Feuerseele-Meister FERN-Vergeltung auf
   dem Kraft-Pfad - direkte Schadenswuerfe auf den Mystiker (Rudolfs
   Entscheidung 3) loesen 1W10 durch die Ruestung des Angreifers aus.
   Filter: Geistesbeeinflussende/alternative Schaden (Resolute-)
   Pfade loesen NICHT aus (isAlternativeDamage), Feuer-Schaeden wird
   vom Meister absorbiert (0 Schaden => kein Trigger). */
async function firesoulMasterPowerCounter(functionStuff, damageTot) {
  try {
    if (damageTot <= 0) return;
    if (functionStuff.isAlternativeDamage) return;
    const defenderActor = functionStuff.targetData?.actor;
    if (!defenderActor) return;
    /* v1.3: Marker-Gate - die Distanz-Vergeltung nur im AKTIVEN Zustand */
    const level = firesoulActiveLevel(defenderActor);
    if (level < 3) return;
    const counterRoll = await new Roll(firesoulCounterFormula(defenderActor, functionStuff.actor, "1d10")).evaluate();
    const dealt = Math.max(0, counterRoll.total);
    if (dealt > 0) {
      await createModifyTokenChatButton([
        { tokenId: functionStuff.tokenId, actorId: functionStuff.actor.id, toughnessChange: -1 * dealt },
      ]);
    }
    const title = `<h4>${game.i18n.localize("POWER_FIRESOUL.CHAT_REACTION_TITLE")}</h4>`;
    const line = `<p>${game.i18n.format("POWER_FIRESOUL.CHAT_DISTANT_RETALIATION", {
      targetname: functionStuff.actingCharName,
      count: dealt,
    })}</p>`;
    await postMaintainChainCard({ actor: defenderActor, actingCharName: defenderActor.name }, title, [line], [counterRoll]);
  } catch (firesoulError) {
    game.symbaroum.log("Kraefte-Paket 1: Feuerseele-Distanz-Vergeltung", firesoulError);
  }
}

/* MM-Paket 1 v1.1 (Rudolfs Testrunde-Entscheidungen): Pruefen, ob ein
   Widerstands-OPFER die Probe SELBST wuerfeln darf - identische
   Kriterien wie der etablierte playerResistButton-Fluss
   (Verteidigungswurf): Opfer ist KEIN Monster, hat einen
   Spieler-Besitzer und die Einstellung steht. Rueckgabe: der erste
   Besitzer-User oder null (null = Auto-Wurf wie in v1.0). */
async function mm1ProbeOwner(victimActor) {
  try {
    if (!victimActor || victimActor.type === "monster") return null;
    const owners = await getOwnerPlayer(victimActor);
    if (!owners || owners.length === 0) return null;
    if (!game.settings.get("symbaroum", "playerResistButton")) return null;
    return owners[0];
  } catch (mm1Error) {
    game.symbaroum.log("MM-Paket 1: Widerstands-Besitzerfrage", mm1Error);
    return null;
  }
}

/* MM-Paket 1 v1.1 (SC-Widerstandsproben, Rudolfs Wunsch 1): Anfrage-
   karte an den SC-Besitzer (Muster ConcentrationCard) plus Whisper-
   GM-Info. EINE Karte, EIN Button je haengigem Merkmal - die Auswertung
   laeuft im renderChatMessageHTML-Handler zum Flag mm1ResistRequest
   (hooks.js) bzw. im symbcomms-MM1ResistProbe-Branch. */
async function mm1SendResistProbe(probeOwner, victimTokenId, victimName, attackerName, probes) {
  game.symbaroum.emit({
    type: "MM1ResistProbe",
    data: {
      targetUserId: probeOwner.id,
      targetUserName: probeOwner.name ?? probeOwner.id,
      victimName: victimName,
      attackerName: attackerName,
      tokenId: victimTokenId,
      probes: probes,
    },
  });
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ alias: game.user.name }),
    whisper: ChatMessage.getWhisperRecipients("GM"),
    content: `<div class="symbaroum chat ability"><div class="foreground"><div class="finalTxt"><p>${game.i18n.format("TRAIT_MM1.PROBE_GM_INFO", { username: probeOwner.name ?? probeOwner.id, victim: victimName })}</p></div></div></div>`,
  });
}

/* ================================================================
 * MM-Paket 1 „Oberflächen-DoT & Gifte" (Rudolfs Baufreigabe 24.11.2026,
 * v1.1-Umbau nach Rudolfs Testrunde 26.11.2026).
 * Automatisierung der aufgeladenen Nahkampf-Monstermerkmale:
 * - Säure-Angriff (acidicattack, Reaktion): unbewaffneter Treffer mit
 *   Schaden legt einen Säure-DoT - KEINE Widerstandsprobe (Vault-Notiz
 *   „Säure-Angriff.md"), Anzeige auf der Angriffs-Karte über die
 *   native Säurezeile (printAcid/acidChat, A28-Muster). v1.1
 *   (Bewertungsfrage 2, Baustein-0-Konvention): der MERKMALSTRÄGER
 *   würfelt den Rundenschaden als SC über die WÜRFEL-Formel
 *   1d6/1d8/1d10 je Stufe (MM1_ACID_DICE), für NSC-Träger leitet
 *   dotDiceOrNpcFixed den Festwert 3/4/5 ab (MM1_ACID_DAMAGE).
 * - Lähmendes Gift (paralyzingvenom, passiv) und Infektiös
 *   (infectious, Reaktion): Stärke-Einfachprobe des Opfers (1W20 <=
 *   Stärke, Meister: [Stärke-5]) auf einer EIGENEN Reaktionskarte
 *   hinter der Angriffs-Karte, Titel v1.1 „Wirkung von {Merkmal}"
 *   (Rudolfs Wunsch 2). Erfolg = MISSGUNST statt Benommen (Rudolfs
 *   Bewertungsfrage 3: „zwei Chancen zu scheitern" = eine Runde alle
 *   Erfolgsproben mit Missgunst-Vorbelegung, boon.js), Novize/Adept-
 *   Fehlschlag = nur noch reaktive Aktionen (SL-Hinweis), Meister-
 *   Fehlschlag = vollständig gelähmt 1W8 (paralysis, S3-Muster).
 *   v1.1 (Rudolfs Wunsch 1): SC-Opfer würfeln die Probe SELBST über
 *   eine Anfragekarte (playerResistButton-Kriterien), NSC-Opfer
 *   bleiben Vollautomatik.
 * - v1.1 (Rudolfs Checkbox-Entscheidung „wie bei den Fähigkeiten"):
 *   Der Waffendialog der natürlichen Waffe zeigt je Merkmal eine
 *   VORANGEHAKTE Checkbox (dialog.js sammelt die Auswahl in
 *   functionStuff.mm1Ticked); über einen Dialog geführter Angriff
 *   feuert NUR noch angehakte Merkmale. Fehlt die Map komplett
 *   (Flows ohne Dialog, z. B. Makro/Riposte), greift die v1.0-
 *   Vollautomatik als Rückfall (mm1Ticked === undefined).
 * ================================================================ */
async function mm1AttackerTraits(functionStuff, damageTot, targetDies, rollData, templateData) {
  const result = { flags: [], reactionCard: null };
  try {
    // Payload reitet nur auf einem Rüstung durchdringenden Treffer mit
    // Schaden (Säure muss laut Vault die Rüstung des Ziels durchdringen;
    // ein totes Opfer lähmt/infiziert nicht mehr)
    if (damageTot <= 0 || targetDies) return result;
    if (functionStuff.isAlternativeDamage) return result;
    if (!rollData.some((r) => r.trueActorSucceeded)) return result;
    const weaponRef = functionStuff.weapon?.system?.reference ?? functionStuff.weapon?.reference;
    if (weaponRef !== "unarmed") return result;
    const attacker = functionStuff.actor;
    const victim = functionStuff.targetData;
    if (!attacker || !victim?.actor || !victim.tokenId) return result;
    const cfg = game.symbaroum.config;
    const acidEffect = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "acid"));

    // v1.1: Checkbox-Gating des Waffendialogs (siehe Blockkopf)
    const mm1Ticked = functionStuff.mm1Ticked;
    const mm1Auto = mm1Ticked === undefined;
    const traitWanted = (ref) => mm1Auto || mm1Ticked[ref] === true;

    // v1.1: Säure-Werte - Würfel je Stufe für SC-Träger, Festwert 3/4/5
    // für NSC-Träger (dotDiceOrNpcFixed leitet den Spiegelwert ab)
    const acidRounds = (lvl) => cfg.MM1_ACID_ROUNDS[lvl] ?? cfg.MM1_ACID_ROUNDS[3];
    const acidDice = (lvl) => cfg.MM1_ACID_DICE[lvl] ?? cfg.MM1_ACID_DICE[3];
    const acidDamageFixed = (lvl) => cfg.MM1_ACID_DAMAGE[lvl] ?? cfg.MM1_ACID_DAMAGE[3];
    const attackerIsPlayer = Boolean(attacker.system?.isPlayer);
    const mm1AcidDotSpec = (lvl) => {
      const spec = cfg.dotDiceOrNpcFixed(attackerIsPlayer, acidDice(lvl));
      return {
        formula: spec.formula,
        fixedDamage: spec.fixedDamage,
        dmgText: attackerIsPlayer ? acidDice(lvl) : String(acidDamageFixed(lvl)),
      };
    };

    const acidLvl = getActorAbilityLevel(attacker, "acidicattack");
    const paralyzeLvl = getActorAbilityLevel(attacker, "paralyzingvenom");
    const infectiousLvl = getActorAbilityLevel(attacker, "infectious");
    const lines = [];
    const reactionRolls = [];
    const reactionTraits = [];
    const pendingProbes = [];

    // --- Säure-Angriff: DoT ohne Widerstandsprobe, Zeile auf der Angriffs-Karte ---
    if (acidLvl > 0 && traitWanted("acidicattack")) {
      reactionTraits.push(game.i18n.localize("TRAIT_LABEL.ACIDICATTACK"));
      const rounds = acidRounds(acidLvl);
      const dotSpec = mm1AcidDotSpec(acidLvl);
      templateData.printAcid = true;
      if (victim.actor.hasCondition?.("acid")) {
        // NOTEXTEND (Muster Gift): bereits säuerndes Ziel läuft weiter
        templateData.acidChat = game.i18n.format("TRAIT_ACIDICATTACK.CHAT_NOTEXTEND", { targetname: victim.name });
      } else {
        const appliedLine = game.i18n.format("TRAIT_ACIDICATTACK.CHAT_APPLIED", { targetname: victim.name, damage: dotSpec.dmgText, rounds });
        templateData.acidChat = appliedLine;
        result.flags.push({
          tokenId: victim.tokenId,
          addEffect: acidEffect,
          effectDuration: rounds,
          label: appliedLine,
          dot: {
            label: "CONDITION.ACID",
            formula: dotSpec.formula,
            fixedDamage: dotSpec.fixedDamage,
            resource: "toughness",
            damageType: "acid",
            stackable: false,
            separateRoll: false,
          },
        });
      }
    }

    // --- Lähmendes Gift + Infektiös: Proben auf der eigenen Reaktionskarte ---
    const paralyzeWanted = paralyzeLvl > 0 && traitWanted("paralyzingvenom");
    const infectiousWanted = infectiousLvl > 0 && traitWanted("infectious");
    const probeOwner = paralyzeWanted || infectiousWanted ? await mm1ProbeOwner(victim.actor) : null;
    const strongVal = getAttributeValue(victim.actor, "strong");

    if (paralyzeWanted) {
      const traitLabel = game.i18n.localize("TRAIT_LABEL.PARALYZINGVENOM");
      reactionTraits.push(traitLabel);
      // Meister: [Stärke-5] (Vault-Notiz „Lähmendes Gift.md")
      const targetVal = paralyzeLvl >= 3 ? strongVal - 5 : strongVal;
      if (probeOwner) {
        // v1.1 (Rudolfs Wunsch 1): SC-Opfer würfelt selbst - Anfrage-
        // karte statt Auto-Wurf, Ergebnis landet beim Besitzer-Button
        pendingProbes.push({
          kind: "paralyzingvenom",
          label: traitLabel,
          target: targetVal,
          level: paralyzeLvl,
          victimName: victim.name,
        });
        lines.push(`<p>${traitLabel}: ${game.i18n.format("TRAIT_MM1.CHAT_PROBE_PENDING", { targetname: victim.name })}</p>`);
      } else {
        const probe = await new Roll("1d20").evaluate();
        reactionRolls.push(probe);
        if (probe.total <= targetVal) {
          // Erfolg v1.1: MISSGUNST statt Benommen (Rudolfs Bewertungs-
          // frage 3) - eine Runde alle Erfolgsproben mit Missgunst-
          // Vorbelegung (boon.js getMissgunstFavour), Zugende-Räumer wie
          // beim v1.0-Benommen (Turn Ende der A34-Engine)
          const effectLine = game.i18n.format("TRAIT_PARALYZINGVENOM.CHAT_MISSGUNST", { targetname: victim.name, roll: probe.total, target: targetVal });
          result.flags.push({
            tokenId: victim.tokenId,
            addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "missgunst")),
            turnEnd: true,
            effectDuration: 1,
            conditionData: {},
            label: `${traitLabel}: ${effectLine}`,
          });
          lines.push(`<p>${traitLabel}: ${effectLine}</p>`);
        } else if (paralyzeLvl >= 3) {
          // Meister-Fehlschlag: vollständig gelähmt 1W8 Runden (S3-Muster)
          const roundsRoll = await new Roll("1d8").evaluate();
          reactionRolls.push(roundsRoll);
          const effectLine = game.i18n.format("TRAIT_PARALYZINGVENOM.CHAT_PARALYZED", { targetname: victim.name, roll: probe.total, target: targetVal, rounds: roundsRoll.total });
          result.flags.push({
            tokenId: victim.tokenId,
            addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "paralysis")),
            turnEnd: true,
            effectDuration: roundsRoll.total,
            conditionData: {},
            label: `${traitLabel}: ${effectLine}`,
          });
          lines.push(`<p>${traitLabel}: ${effectLine}</p>`);
        } else {
          // Novize/Adept-Fehlschlag: nur noch reaktive Aktionen - keine
          // Zustands-Engine im System, SL wendet die Einschränkung an
          lines.push(`<p>${traitLabel}: ${game.i18n.format("TRAIT_PARALYZINGVENOM.CHAT_REACTIVE", { targetname: victim.name, roll: probe.total, target: targetVal })}</p>`);
        }
      }
    }
    if (infectiousWanted) {
      const traitLabel = game.i18n.localize("TRAIT_LABEL.INFECTIOUS");
      reactionTraits.push(traitLabel);
      if (probeOwner) {
        pendingProbes.push({
          kind: "infectious",
          label: traitLabel,
          target: strongVal,
          level: infectiousLvl,
          victimName: victim.name,
        });
        lines.push(`<p>${traitLabel}: ${game.i18n.format("TRAIT_MM1.CHAT_PROBE_PENDING", { targetname: victim.name })}</p>`);
      } else {
        const probe = await new Roll("1d20").evaluate();
        reactionRolls.push(probe);
        if (probe.total <= strongVal) {
          lines.push(`<p>${traitLabel}: ${game.i18n.format("TRAIT_INFECTIOUS.CHAT_RESISTED", { targetname: victim.name, roll: probe.total, target: strongVal })}</p>`);
        } else {
          // Krankheit je Stufe (leicht/mittelschwer/schwer) - keine
          // Krankheits-Engine im System, SL wendet die Folge an
          const severity = game.i18n.localize("TRAIT_INFECTIOUS.SEVERITY_" + infectiousLvl);
          lines.push(`<p>${traitLabel}: ${game.i18n.format("TRAIT_INFECTIOUS.CHAT_DISEASE", { targetname: victim.name, roll: probe.total, target: strongVal, severity })}</p>`);
        }
      }
    }
    if (pendingProbes.length > 0) {
      await mm1SendResistProbe(probeOwner, victim.tokenId, victim.name, functionStuff.actingCharName, pendingProbes);
    }
    if (lines.length > 0) {
      // v1.1 (Rudolfs Wunsch 2): Titel „Wirkung von {Merkmalsname}", bei
      // mehreren Merkmalen mit „ & " verbunden, statt Pauschal-Titel
      const titleName = reactionTraits.join(" & ");
      result.reactionCard = {
        titleHtml: `<h4>${game.i18n.format("TRAIT_MM1.CHAT_REACTION_TITLE_ONE", { name: titleName })}</h4>`,
        lines,
        rolls: reactionRolls,
      };
    }
  } catch (mm1Error) {
    game.symbaroum.log("MM-Paket 1: Angreifer-Merkmale", mm1Error);
  }
  return result;
}

/* MM-Paket 1: Säureblut - Verteidiger-Reaktion NACH der Angriffs-Karte
   (Nachschalter-Muster Feuerseele-Rückstoß). Wer die Kreatur im
   Nahkampf trifft und Schaden verursacht, muss eine Verteidigungs-
   Einfachprobe bestehen (1W20 <= Verteidigungswert des Angreifers),
   sonst erfasst ihn die Säure (Condition acid, A28-Engine). v1.1 nach
   Rudolfs Testrunde: (Bewertungsfrage 2) der Rundenschaden läuft über
   die WÜRFEL-Formel 1d6/1d8/1d10 je Stufe, wenn der MERKMALSTRÄGER
   (Säureblut-Kreatur) ein SC ist, sonst Festwert 3/4/5; (Wunsch 1) ein
   SC-ANGREIFER würfelt die Verteidigungsprobe selbst über eine
   Anfragekarte (playerResistButton-Kriterien), NSC-Angreifer bleiben
   wie in v1.0 Vollautomatik. */
async function mm1AcidicBlood(functionStuff, damageTot, rollData) {
  try {
    if (damageTot <= 0) return;
    if (functionStuff.isAlternativeDamage) return;
    if (!rollData.some((r) => r.trueActorSucceeded)) return;
    const defenderActor = functionStuff.targetData?.actor;
    if (!defenderActor) return;
    const lvl = getActorAbilityLevel(defenderActor, "acidicblood");
    if (lvl < 1) return;
    const isMeleeWeapon = Boolean(functionStuff.weapon?.isMelee ?? functionStuff.weapon?.system?.isMelee);
    if (!isMeleeWeapon) return;
    const attackerActor = functionStuff.actor;
    if (!attackerActor || !functionStuff.tokenId) return;
    const cfg = game.symbaroum.config;
    const defenceVal = Number(attackerActor.system?.combat?.defense ?? 0);

    // v1.1 (Bewertungsfrage 2): Würfel je Stufe für SC-Träger, Festwert
    // für NSC-Träger (Kriterium MERKMALSTRÄGER, wie beim Säure-Angriff)
    const defenderIsPlayer = Boolean(defenderActor.system?.isPlayer);
    const acidDice = cfg.MM1_ACID_DICE[lvl] ?? cfg.MM1_ACID_DICE[3];
    const acidDamageFixed = cfg.MM1_ACID_DAMAGE[lvl] ?? cfg.MM1_ACID_DAMAGE[3];
    const dotSpec = cfg.dotDiceOrNpcFixed(defenderIsPlayer, acidDice);
    const dmgText = defenderIsPlayer ? acidDice : String(acidDamageFixed);
    const rounds = cfg.MM1_ACID_ROUNDS[lvl] ?? cfg.MM1_ACID_ROUNDS[3];

    // v1.1 (Rudolfs Wunsch 1): SC-Angreifer würfelt die Verteidigungs-
    // probe selbst (Anfragekarte + GM-Info); die Reaktionskarte der
    // Kreatur vermerkt die ausstehende Probe
    const probeOwner = await mm1ProbeOwner(attackerActor);
    if (probeOwner) {
      const traitLabel = game.i18n.localize("TRAIT_LABEL.ACIDICBLOOD");
      const probes = [
        {
          kind: "acidicblood",
          label: traitLabel,
          target: defenceVal,
          level: lvl,
          victimName: functionStuff.actingCharName,
          rounds: rounds,
          formula: dotSpec.formula,
          fixedDamage: dotSpec.fixedDamage,
          dmgText: dmgText,
          alreadyAcid: Boolean(attackerActor.hasCondition?.("acid")),
        },
      ];
      const pendingLine = game.i18n.format("TRAIT_MM1.CHAT_PROBE_PENDING", { targetname: functionStuff.actingCharName });
      await mm1SendResistProbe(probeOwner, functionStuff.tokenId, functionStuff.actingCharName, defenderActor.name, probes);
      const title = `<h4>${game.i18n.format("TRAIT_MM1.CHAT_REACTION_TITLE_ONE", { name: traitLabel })}</h4>`;
      await postMaintainChainCard({ actor: defenderActor, actingCharName: defenderActor.name }, title, [`<p>${traitLabel}: ${pendingLine}</p>`], []);
      return;
    }

    // NSC-Angreifer: v1.0-Automatik (vom System gewürfelte Einfachprobe)
    const probe = await new Roll("1d20").evaluate();
    const lines = [];
    if (probe.total <= defenceVal) {
      lines.push(`<p>${game.i18n.format("TRAIT_ACIDICBLOOD.CHAT_RESISTED", { targetname: functionStuff.actingCharName, roll: probe.total, target: defenceVal })}</p>`);
    } else if (attackerActor.hasCondition?.("acid")) {
      // NOTEXTEND (Muster Gift): bereits säuerndes Ziel läuft weiter
      lines.push(`<p>${game.i18n.format("TRAIT_ACIDICBLOOD.CHAT_NOTEXTEND", { targetname: functionStuff.actingCharName })}</p>`);
    } else {
      const appliedLine = game.i18n.format("TRAIT_ACIDICBLOOD.CHAT_APPLIED", { targetname: functionStuff.actingCharName, damage: dmgText, rounds });
      lines.push(`<p>${appliedLine}</p>`);
      await createModifyTokenChatButton([
        {
          tokenId: functionStuff.tokenId,
          addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "acid")),
          effectDuration: rounds,
          label: appliedLine,
          dot: {
            label: "CONDITION.ACID",
            formula: dotSpec.formula,
            fixedDamage: dotSpec.fixedDamage,
            resource: "toughness",
            damageType: "acid",
            stackable: false,
            separateRoll: false,
          },
        },
      ]);
    }
    const title = `<h4>${game.i18n.format("TRAIT_MM1.CHAT_REACTION_TITLE_ONE", { name: game.i18n.localize("TRAIT_LABEL.ACIDICBLOOD") })}</h4>`;
    await postMaintainChainCard({ actor: defenderActor, actingCharName: defenderActor.name }, title, lines, [probe]);
  } catch (mm1Error) {
    game.symbaroum.log("MM-Paket 1: Säureblut", mm1Error);
  }
}

/* ================================================================
 * MM-Paket 2 v1 „Festhalten & Kampf-Kontrolle“ (Rudolfs Baufreigabe
 * 24.11.2026, Konzept Rev. 2 + Baufrage-Antwort „Kern MIT Gestalt-
 * wandel bauen“). Engine-Block:
 * - shapeshiftActiveLevel: aktive Form-Stufe (Feuerseele-Gate-Muster
 *   firesoulActiveLevel);getItemModifierShapeshift, boon.js
 *   getShapeshiftFavour und actor.js (Zaehigkeitsschwelle-Robust-
 *  _bonus, dort INLINE gelesen) konsumieren den Marker.
 * - Gemeinsame Helfer: Robust-Stufe, unbewaffnete Waffe, Ziel-Daten,
 *   Zug-Verschiebung eines Token, Befreiungskarte (Karten-Buttons,
 *   Besitzer wuerfelt selbst; SL/Player-Buchung 1x pro Runde).
 * - Karten-Maschinen der klickbaren Merkmale (Dispatch in
 *   getPowerResultFunction): mm2WebFlow (Netz-Kachel platziert seit
 *   B1 „Kampftab & Netz" NUR die Zone - die Geschosse feuern ueber
 *   die Waffenzeile, s. mm2WebShotsFlow),
 *   mm2CrossWeaponFlow (Cross-Flag-Waffen: Kachel-Klick oeffnet den
 *   Standard-Waffendialog der Merkmals-eigenen Waffe),
 *   mm2RampageChain (SL-Kettendialog), mm2SwiftInfo
 *   (Hinweiskarte; die eigentliche Reaktion sitzt auf der Angriffs-
 *   Ergebniskarte).
 * - mm2AttackerTraits: Reaktions-Merkmale im Angriffs-Pfad (parallel
 *   zu mm1AttackerTraits; Reaktions-Merkmale weiter im Checkbox-Gating
 *   mm2Ticked mit v1.1-Semantik, Cross-Flag-Waffen-aequivalente Rider
 *   dagegen automatisch an der Waffen-Referenz): Erdrueckende Umarmung,
 *   Verschlingen, Zerstörer, Greifzunge-/Greifklauen-Rider,
 *   Giftspucke-Giftbindung, Knochengeschoss, Blitzschnell-Hinweis.
 * - Verschlingens-/Greifklauen-Zaegeloesung (mm2ResolveDevourPending /
 *   mm2ResolveClawPull, Export fuer den hooks.js-Zugbeginn-Hook) und
 *   mm2WreckerKnockdown (Export fuer den Anfragekarten-Handler).
 * - applyFallDamage (Konzept Baustein 9, GRW „Schaden durch einen
 *   Sturz“): exportiert und ueber game.symbaroum.api makro-aufrufbar.
 * Gemeinsame Konventionen (Konzept §2): Festhalten ueber die
 * bestehende Condition „bind“ (bedeutet: Ziel kann sich nicht
 * bewegen); Befreiungs-/Verfangens-Proben als Karten-Buttons;
 * automatische Symbol-Loeschung bei gelungener Befreiung;
 * „verfangen“ = Disfavoured ueber die Missgunst-Kette (boon.js,
 * MM1-Präzedenz); „zu Boden“ = Foundry-Core prone; A28-Festwert-DoT
 * ignoriert Ruestung nativ (Umarmung/Bauch); KEINE Reichweiten-Gates
 * (SL-Verantwortung, Giftspucke-Präzedenz).
 * ================================================================ */
export function shapeshiftActiveLevel(actor) {
  if (!actor) return 0;
  const marker = actor.hasCondition?.("shapeshift");
  if (!marker) return 0;
  const markerFlagData = marker.getFlag?.(game.system.id, "flagData");
  const level = Number(markerFlagData?.level) || 0;
  if (level >= 1) return level;
  return getActorAbilityLevel(actor, "shapeshift");
}

function mm2RobustLevel(actor) {
  return getActorAbilityLevel(actor, "robust");
}

/* MM-Paket 2 v1.2 Cross-Flag-Waffen (Konzept Runde 3, Teil A - Commit 1):
   Der Kachel-Klick sucht die VORBEREITETE Cross-Waffe in
   actor.system.weapons (v1.1-Nachtest-D1-Lernweis bleibt bestehen:
   enhancedAttackRoll/rollWeapon erwarten das Kurzfeld-Objekt aus
   actor.js _evaluateWeapons, nie das raw Item-Dokument). Die
   Referenz-Suche ersetzt den alten unbewaffneten Rueckgriff - das
   Merkmal stiftet JEWEILS seine eigene Waffenzeile. */
function mm2PreparedCrossWeapon(actor, reference) {
  return actor?.system?.weapons?.find((w) => w?.reference === reference) ?? null;
}

/* Zug-Verschiebung: Opfer-Token eine Zellbreite DIREKT AN den Anker-
   heranziehen (Richtung aus der alten Position, SL justiert Hex-/
   Freiform-Raster und grosse Token manuell nach - bewusst globale
   Grenze, kein Pfad-Engine-Anspruch wie beim SL-Kettendialog). */
/* MM-Paket 2 v1.2 Cross-Flag-Waffen: exportiert, weil die Greifzunge-
   Zugprobe auch von der SC-Anfragekarte (hooks.js, probe.kind "mm2tongue")
   aufgeloist wird - Opfer-Besitzer zieht das eigene Token. */
export async function mm2PullTokenAdjacent(movedToken, anchorToken) {
  try {
    if (!movedToken || !anchorToken) return false;
    const size = canvas.dimensions?.size ?? 100;
    const anchorDoc = anchorToken.document ?? anchorToken;
    const movedDoc = movedToken.document ?? movedToken;
    const anchorCellW = Math.max(1, Number(anchorDoc.width) || 1);
    const anchorCellH = Math.max(1, Number(anchorDoc.height) || 1);
    const aw = anchorCellW * size;
    const ah = anchorCellH * size;
    const ax = Number(anchorDoc.x) || 0;
    const ay = Number(anchorDoc.y) || 0;
    const anchorCenter = { x: ax + aw / 2, y: ay + ah / 2 };
    const movedCenter = { x: (Number(movedDoc.x) || 0) + size / 2, y: (Number(movedDoc.y) || 0) + size / 2 };
    const dx = movedCenter.x - anchorCenter.x;
    const dy = movedCenter.y - anchorCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const reach = Math.max(aw, ah) / 2 + size / 2 + 1;
    const tx = dist > 0 ? anchorCenter.x + (dx / dist) * reach : anchorCenter.x + reach;
    const ty = dist > 0 ? anchorCenter.y + (dy / dist) * reach : anchorCenter.y;
    const snapped = canvas.grid?.getSnappedPosition?.(tx, ty, size) ?? { x: tx, y: ty };
    await movedDoc.update({ x: snapped.x, y: snapped.y });
    return true;
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Zug-Verschiebung", mm2Error);
    return false;
  }
}

/* Befreiungskarte (Konzept Baustein 2): an GM + Opfer-Besitzer
   gefluestert, EIN Button, 1W20 <= Zielwert laut Quelle; Klick
   wuerfelt auf dem Klick-Client (hooks.js-Handler zum Flag
   mm2Liberate), Erfolg entfernt das bind-Symbol (bei Netz zusaetzlich
   die Verfangen-Missgunst) automatisch ueber die GM-Anwenden-Karte,
   Fehlschlag verbleibt im Zustand. 1x pro Runde = SL/Player-
   Buchung (Konzept: bewusst keine Runden-Sperre). MM2 v1.1 (Rudolfs
   Nachtest 4a): gepostet ERST AM OPFER-ZUGBEGINN (hooks.js updateCombat)
   statt sofort beim Fangen - die Liberationsdaten (target/source/attr)
   reisen beim Fangen in der bind-Condition (conditionData.mm2Liberate
   -> flagData). attr = Attributs-Notation-Label je Quelle (Punkt 17). */
export async function mm2PostLiberateCard(victimTokenId, victimName, { target, source, attr, titleHtml }) {
  try {
    if (!victimTokenId || target == null) return;
    const attrLabel = attr ?? "";
    const recipients = new Set();
    for (const user of game.users) {
      if (user.active && user.isGM) recipients.add(user.id);
    }
    const victimToken = canvas.tokens?.placeables?.find((t) => t.id === victimTokenId);
    if (victimToken?.actor) {
      const owners = await getOwnerPlayer(victimToken.actor);
      for (const user of owners ?? []) recipients.add(user.id);
    }
    if (recipients.size === 0) recipients.add(game.user.id);
    const buttonHtml = `<button class="mm2-liberate-probe"><i class="fas fa-dice-d20"></i> ${game.i18n.format("TRAIT_MM2.LIBERATE_BUTTON", { target, attr: attrLabel })}</button>`;
    const hintLine = game.i18n.format("TRAIT_MM2.LIBERATE_HINT", { targetname: victimName, attr: attrLabel });
    const htmlBody = `<div class="symbaroum chat ability"><div class="foreground">${titleHtml}<div class="finalTxt"><p>${hintLine}</p><p>${buttonHtml}</p></div></div></div>`;
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize("DIALOG.SYSTEM_MESSAGE") }),
      whisper: [...recipients],
      content: htmlBody,
    };
    chatData[`flags.${game.system.id}.mm2Liberate`] = { tokenId: victimTokenId, victimName, target, source, attr: attrLabel };
    await ChatMessage.create(chatData);
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Befreiungskarte", mm2Error);
  }
}

/* Netz-Kachel (B1 „Kampftab & Netz", R4-13-ENTSCHEIDUNG §11.6): Die
   Kachel SCHRUMPFT AUF DIE NETZZONE - der v2.0-SL-Wahl-Dialog (Zone/
   Geschosse) ist ENTFALLEN, denn die Netz-GESCHOSSE feuern seit B1
   ueber die WAFFENZEILE der Cross-Waffe web (Adept 1, Meister 3,
   Novize ohne Zeile; actor.js rollWeapon-Router -> mm2WebShotsFlow,
   M1-Probenmodell). ALLE Stufen platzieren also direkt: die passive
   Region mit Verfangen-Probe [GW<-SF] beim BETRETEN und je RUNDEN-
   BEGINN im Netz (Standard-Radius MM2_WEB_ZONE_RADIUS_CELLS, SL darf
   frei skalieren) - genau der Novizen-Weg, und der Meister nutzt
   Zone PLUS Geschosse je Belieben. */
async function mm2WebFlow(_null, functionStuff) {
  return mm2WebZonePlace(functionStuff);
}

/* Behavior-Skripte der Netzzone (Region-Script-Behaviors, V14-Typname
   'executeScript' - aoe.js-Lernweis v2.1). Beide routen auf den aktiven
   GM (AoE-Muster: Behaviors laufen auf ALLEN Clients). Der Enter-Event
   mit moved === false ist die Behavior-AKTIVIERUNG beim Platzieren
   (Foundry feuert TOKEN_ENTER auch dafuer, aoe.js v2.5-Lernweis) und
   wird ignoriert - die Zone fackelt nicht fuer bereits stehende Token. */
const MM2_WEB_ZONE_ENTER_SCRIPT = [
  'const r = (typeof region !== "undefined") ? region : null;',
  'const zexec = game.users.activeGM?.id ?? null;',
  'if (!zexec || game.user.id !== zexec) return;',
  'const ev = (typeof event !== "undefined") ? event : null;',
  'if (ev?.data?.moved === false) return;',
  'const t = ev?.data?.token ?? ev?.token ?? (typeof token !== "undefined" ? token : null);',
  'const rid = r?.id ?? r?.document?.id ?? null;',
  'const tid = t?.document?.id ?? t?.id ?? null;',
  'if (!rid || !tid) return;',
  'game.symbaroum.api?.mm2WebZoneEnter?.(rid, tid);',
].join("\n");
const MM2_WEB_ZONE_EXIT_SCRIPT = [
  'const r = (typeof region !== "undefined") ? region : null;',
  'const zexec = game.users.activeGM?.id ?? null;',
  'if (!zexec || game.user.id !== zexec) return;',
  'const ev = (typeof event !== "undefined") ? event : null;',
  'const t = ev?.data?.token ?? ev?.token ?? (typeof token !== "undefined" ? token : null);',
  'const rid = r?.id ?? r?.document?.id ?? null;',
  'const tid = t?.document?.id ?? t?.id ?? null;',
  'if (!rid || !tid) return;',
  'game.symbaroum.api?.mm2WebZoneExit?.(rid, tid);',
].join("\n");

/* Netzzone platzieren: Region mit ENTER- und EXIT-Behavior (GM-Anlage,
   Foundry untersagt Behaviors fuer Nicht-SLs - bewusst GM-only-Kachel).
   Rechtsklick im Legewerkzeug = Abbruch ohne Karte. */
async function mm2WebZonePlace(functionStuff) {
  try {
    const attacker = functionStuff.actor;
    if (!attacker) return null;
    const cfg = game.symbaroum.config;
    const actingToken = game.symbaroum.api.getActorToken(attacker);
    const creatureName = functionStuff.actingCharName ?? actingToken?.name ?? attacker.name;
    const creatureSF = getAttributeValue(attacker, "cunning");
    const gridSize = Math.max(1, Math.round(canvas.scene?.grid?.size ?? 0)) || 100;
    const radiusCells = Math.max(1, Number(cfg.MM2_WEB_ZONE_RADIUS_CELLS) || 2);
    const regionData = {
      name: game.i18n.format("TRAIT_WEB.ZONE_NAME", { creaturename: creatureName }),
      color: game.user.color,
      displayMeasurements: true,
      highlightMode: "coverage",
      /* B1.1 (Rudolfs Testrunde, Punkt 3): nur fuer die SL sichtbar
         (GAMEMASTER-Stufe, V14-Konstante). Behaviors (Betreten/
         Verlassen/Verfangen-Proben) laufen unberuehrt ueber den
         GM-Client; die SL sieht und skaliert die Zone im Regionen-
         Werkzeug wie gehabt, Spieler sehen sie nicht mehr. */
      visibility: CONST.REGION_VISIBILITY.GAMEMASTER,
      shapes: [{ type: "circle", radius: radiusCells * gridSize, x: 0, y: 0, rotation: 0 }],
      flags: { symbaroum: { mm2WebZone: { creatureActorId: attacker.id, creatureName, creatureSF } } },
      behaviors: [
        { type: "executeScript", system: { source: MM2_WEB_ZONE_ENTER_SCRIPT, events: [CONST.REGION_EVENTS.TOKEN_ENTER] } },
        { type: "executeScript", system: { source: MM2_WEB_ZONE_EXIT_SCRIPT, events: [CONST.REGION_EVENTS.TOKEN_EXIT] } },
      ],
    };
    let placed = null;
    try {
      placed = await canvas.regions.placeRegions([regionData]);
    } catch (placeError) {
      game.symbaroum.log("MM-Paket 2: Netzzone-Platzierung", placeError);
      return null;
    }
    if (!Array.isArray(placed) || placed.length === 0) return null;
    const title = `<h4>${game.i18n.localize("TRAIT_WEB.CARD_TITLE")}</h4>`;
    await postMaintainChainCard(functionStuff, title, [game.i18n.format("TRAIT_WEB.ZONE_PLACED", { creaturename: creatureName })].map((l) => `<p>${l}</p>`), []);
    return null;
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Netzzone-Platzierung", mm2Error);
    return null;
  }
}

/* GM-Anwenden-Paket eines VERFANGENEN Opfers (Zone und Geschoss
   teilen den Bau): bind mit Netz-Befreiungsdaten [ST<-SF, Karte am
   Opfer-Zugbeginn, v1.1-Nachtest-4a-Muster] + Verfangen-Missgunst.
   In Zonen (regionId != null) traegt die Missgunst conditionData.
   mm2WebZone {regionId} - beim VERLASSEN DER ZONE endet NUR diese
   zonen-gebundene Missgunst (mm2WebZoneExit); Geschoss-Missgunst und
   bind bleiben bis zur Befreiung. Exportiert: hooks.js loest die
   SC-Anfragekarte (probe.kind 'mm2web') ueber denselben Bau. */
export function mm2WebEntangleGmActions(tokenDoc, meta, regionId) {
  const victimActor = tokenDoc?.actor ?? null;
  const victimName = tokenDoc?.name ?? victimActor?.name ?? "";
  const traitsLabel = game.i18n.localize("TRAIT_LABEL.WEB");
  const creatureSF = Number(meta?.creatureSF ?? 10);
  const actions = [];
  const conditionData = { mm2Bind: { source: "web" } };
  if (regionId) conditionData.mm2WebZone = { regionId };
  if (victimActor) {
    conditionData.mm2Liberate = {
      target: getAttributeValue(victimActor, "strong") + (10 - creatureSF),
      source: "web",
      attr: game.i18n.localize("TRAIT_MM2.LIBERATE_ATTR_WEB"),
    };
  }
  actions.push({
    tokenId: tokenDoc?.id,
    addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bind")),
    conditionData,
    label: `${traitsLabel}: ${game.i18n.format("TRAIT_WEB.CHAT_CAUGHT", { targetname: victimName })}`,
  });
  actions.push({
    tokenId: tokenDoc?.id,
    addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "missgunst")),
    conditionData: regionId ? { mm2WebZone: { regionId } } : {},
    label: `${traitsLabel}: ${game.i18n.format("TRAIT_WEB.CHAT_MISSGUNST_LINE", { targetname: victimName })}`,
  });
  return actions;
}

/* Verfangen-Aufloesung (Betreten UND Rundenbeginn teilen den Kern):
   Verfangen-Probe [GW<-SF], Gelingen = entwischt, Misslingen = bind +
   Verfangen-Missgunst + Befreiungsdaten. SC-Opfer wuerfeln selbst
   (Anfragekarte, kind 'mm2web' - Auswertung im hooks.js-mm1Resist-
   Request-Dispatcher), NSC-Opfer inline mit GM-Anwenden-Karte.
   Bestehender Netz-bind KEIN Doppel-Fangen (Flucht in die Nachbar-
   zone): die laufende Befreiung bleibt unberuehrt. */
async function mm2WebEntangleResolve({ tokenDoc, meta, regionId, introLines = [] }) {
  try {
    const victimActor = tokenDoc.actor;
    const victimName = tokenDoc.name ?? victimActor.name ?? "";
    const traitsLabel = game.i18n.localize("TRAIT_LABEL.WEB");
    const bind = victimActor.hasCondition?.("bind");
    if (bind?.getFlag(game.system.id, "flagData")?.mm2Bind?.source === "web") return;
    const target = getAttributeValue(victimActor, "quick") + (10 - Number(meta.creatureSF ?? 10));
    const probeOwner = await mm1ProbeOwner(victimActor);
    if (probeOwner) {
      const probes = [
        {
          kind: "mm2web",
          label: traitsLabel,
          target,
          webSF: Number(meta.creatureSF ?? 10),
          regionId: regionId ?? null,
          creatureName: meta.creatureName ?? "",
        },
      ];
      await mm1SendResistProbe(probeOwner, tokenDoc.id, victimName, meta.creatureName ?? "", probes);
      for (const l of introLines) await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ alias: game.user.name }), content: `<div class="symbaroum chat ability"><div class="foreground"><div class="finalTxt"><p>${traitsLabel}: ${l}</p></div></div></div>` });
      return;
    }
    const probeRoll = await new Roll("1d20").evaluate();
    const lines = [];
    if (probeRoll.total <= target) {
      lines.push(game.i18n.format("TRAIT_WEB.CHAT_ESCAPED", { targetname: victimName, roll: probeRoll.total, target }));
    } else {
      lines.push(game.i18n.format("TRAIT_WEB.CHAT_CAUGHT", { targetname: victimName, roll: probeRoll.total, target }));
    }
    lines.push(...introLines);
    const title = `<h4>${game.i18n.format("TRAIT_MM2.CHAT_REACTION_TITLE_ONE", { name: traitsLabel })}</h4>`;
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ alias: game.user.name }),
      rolls: [createRollData([probeRoll])],
      content: `<div class="symbaroum chat ability"><div class="foreground">${title}<div class="finalTxt">${lines.map((l) => `<p>${traitsLabel}: ${l}</p>`).join("")}</div></div></div>`,
    });
    if (probeRoll.total > target) {
      await createModifyTokenChatButton(mm2WebEntangleGmActions(tokenDoc, meta, regionId ?? null));
    }
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Verfangen-Aufloesung", mm2Error);
  }
}

/* Zone BETRETEN (Script-Behavior -> api.mm2WebZoneEnter, laeuft auf dem
   aktiven GM-Client). Versteckte Token und die Netz-Kreatur selbst
   bleiben aussen vor. */
export async function mm2WebZoneEnter(regionId, tokenId) {
  try {
    if (!game.user.isGM) return;
    const scene = game.scenes.viewed ?? canvas.scene ?? null;
    const region = scene?.regions?.get?.(regionId) ?? null;
    const meta = region?.flags?.symbaroum?.mm2WebZone;
    if (!region || !meta) return;
    const tokenDoc = region.parent?.tokens?.get?.(tokenId) ?? null;
    if (!tokenDoc?.actor || tokenDoc.hidden) return;
    if (meta.creatureActorId && tokenDoc.actor.id === meta.creatureActorId) return;
    await mm2WebEntangleResolve({ tokenDoc, meta, regionId, introLines: [game.i18n.format("TRAIT_WEB.ZONE_ENTER_LINE", { targetname: tokenDoc.name ?? tokenDoc.actor.name ?? "" })] });
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Netzzone betreten", mm2Error);
  }
}

/* Zone VERLASSEN (Script-Behavior -> api.mm2WebZoneExit): NUR die an
   DIESER Region gebundene Verfangen-Missgunst endet (conditionData.
   mm2WebZone.regionId-Match auf dem Missgunst-Effect); die Geschoss-
   Missgunst und das bind bleiben bis zur Befreiung am Opferzug. */
export async function mm2WebZoneExit(regionId, tokenId) {
  try {
    if (!game.user.isGM) return;
    const scene = game.scenes.viewed ?? canvas.scene ?? null;
    const region = scene?.regions?.get?.(regionId) ?? null;
    if (!region?.flags?.symbaroum?.mm2WebZone) return;
    const tokenDoc = region.parent?.tokens?.get?.(tokenId) ?? null;
    const victimActor = tokenDoc?.actor ?? null;
    if (!victimActor) return;
    const victimName = tokenDoc.name ?? victimActor.name ?? "";
    const zoneEffects = (victimActor.effects ?? []).filter((e) => {
      if (!e.statuses?.has?.("missgunst")) return false;
      const fd = e.getFlag(game.system.id, "flagData") ?? null;
      return fd?.mm2WebZone?.regionId === regionId;
    });
    if (zoneEffects.length === 0) return;
    await Promise.all(zoneEffects.map((e) => e.delete()));
    const traitsLabel = game.i18n.localize("TRAIT_LABEL.WEB");
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize("DIALOG.SYSTEM_MESSAGE") }),
      content: `<div class="symbaroum chat ability"><div class="foreground"><div class="finalTxt"><p>${traitsLabel}: ${game.i18n.format("TRAIT_WEB.ZONE_EXIT_LINE", { targetname: victimName })}</p></div></div></div>`,
    });
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Netzzone verlassen", mm2Error);
  }
}

/* Netzzone-RUNDENTICK (hooks.js mm2TurnStartSweep): Kampf = nur die
   Zonen der AKTIVEN Kreatur (creatureActorId-Match), Weltzeit = ALLE
   Netzonen der angesehenen Szene. JE im Netz stehendes Token ohne
   aktiven Netz-bind bekommt die Verfangen-Probe erneut - Entwischt
   (Probe gelungen) und dennoch Dabeistehen gibt die naechste Runde
   eine neue Chance, Gebundene laufen ueber die Befreiungskarte weiter. */
export async function mm2WebZoneRoundProbes(creatureActor = null) {
  try {
    if (!game.user.isActiveGM) return;
    const scene = game.scenes.viewed ?? null;
    const zones = (scene?.regions ?? []).filter((r) => r.flags?.symbaroum?.mm2WebZone);
    if (zones.length === 0) return;
    for (const region of zones) {
      const meta = region.flags.symbaroum.mm2WebZone;
      if (creatureActor && meta.creatureActorId !== creatureActor.id) continue;
      for (const tokenDoc of mm2WebZoneTokens(region)) {
        if (!tokenDoc.actor || tokenDoc.hidden) continue;
        if (meta.creatureActorId && tokenDoc.actor.id === meta.creatureActorId) continue;
        const bind = tokenDoc.actor.hasCondition?.("bind");
        if (bind?.getFlag(game.system.id, "flagData")?.mm2Bind?.source === "web") continue;
        await mm2WebEntangleResolve({ tokenDoc, meta, regionId: region.id, introLines: [game.i18n.format("TRAIT_WEB.ZONE_ROUND_LINE", { targetname: tokenDoc.name ?? tokenDoc.actor.name ?? "" })] });
      }
    }
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Netzzone-Rundentick", mm2Error);
  }
}

/* Mitgliedschaft der Netzzone: prim die Core-Geometrie (RegionDocument.
   tokens), Fallback TokenDocument#testInsideRegion (aoe.js-
   _collectRegionTokens-Prinzip, F5-Lernweis). */
function mm2WebZoneTokens(region) {
  try {
    const core = [...(region?.tokens ?? [])];
    if (core.length > 0) return core;
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Netzzone-Geometrie", mm2Error);
  }
  const found = [];
  const docs = region?.parent?.tokens?.contents ?? [];
  for (const doc of docs) {
    if (!doc?.actor) continue;
    if (typeof doc.testInsideRegion === "function") {
      try {
        if (doc.testInsideRegion(region)) found.push(doc);
      } catch (mm2Error) {
        game.symbaroum.log("MM-Paket 2: testInsideRegion", mm2Error);
      }
    }
  }
  return found;
}

/* Netz-GESCHOSSE, M1-PROBENMODELL (B1 „Kampftab & Netz", R4-13-
   ENTSCHEIDUNG §11.6): Feuern laeuft ueber die WAFFENZEILE der Cross-
   Waffe web (actor.js rollWeapon-Router) - die v2.0-Geschoss-KARTE
   mit je-Token-Buttons, ihr hooks.js-Handler und der geplante Eigen-
   bau-Kettendialog sind ALLE ENTFALLEN. B1.2 (Rudolfs Entscheidung
   zur Testrunde v1.1, Punkt 12) laeuft die Kette ueber den KRAFT-
   KETTENDIALOG (Muster chainSequenceResult): das erste markierte
   Ziel ist das Primaergeschoss, JE Folgeschuss fragt die Karte
   "Weiteres Netz-Geschoss?" und liest die FRISCHE Zielmarkierung;
   Deckel ist das Stufen-Magazin shotsMax (Adept 1, Meister 3).
   Je Ziel laeuft
   die RAW-genaue [GE<-SF]-AUSWEICHPROBE DES OPFERS - die Kreatur
   wuerfelt NICHT, damit entfaellt das Parier-Problem (Befund 7a)
   komplett; der geteilte Kern bleibt mm2WebEntangleResolve (wie bei
   der Zone): SC-Opfer wuerfeln selbst (Anfragekarte kind 'mm2web',
   Auswertung im hooks.js-mm1ResistRequest-Dispatcher), NSC-Opfer
   inline, Misslingen = verfangen (GM-Anwenden-Karte ueber
   mm2WebEntangleGmActions mit regionId null - die Geschoss-Missgunst
   ist nicht zonen-gebunden, sie endet nur ueber die Befreiung);
   bestehender Netz-bind wird nicht doppelt gefangen.
   Munition: JE Geschoss bucht gegen mm2WebThreads {round, used} am
   Kreatur-Token - der Runden-Reset pflegt jetzt AUCH counter.round
   (v2.0-Befunde 10+11: das Rundfeld blieb an beiden v2.0-Stellen
   stehen, der Zaehler lief entweder voll oder ins Grenzenlose);
   leergeschossen die MASTER_SPENT-Zeile und Ketten-Abbruch. Ohne
   Kreatur-Token laeuft KEINE Buchung (Welt-Actor ohne Spielstein -
   bewusste Grenze, JE Feuern startet mit vollem Magazin). */
export async function mm2WebShotsFlow(attacker, weapon) {
  try {
    if (!attacker) return null;
    const cfg = game.symbaroum.config;
    const traitsLabel = game.i18n.localize("TRAIT_LABEL.WEB");
    const actingToken = game.symbaroum.api.getActorToken(attacker);
    /* MM2 v1.2-Lernweis (Testbefund 12): getActorToken liefert bei
       SYNTHETISCHEM Actor das TokenDOCUMENT statt des Placeables. */
    const actingTokenDoc = actingToken?.document ?? actingToken ?? null;
    const creatureName = actingToken?.name ?? attacker.name;
    const creatureSF = getAttributeValue(attacker, "cunning");
    const shotsMax = Number(cfg.MM2_WEB_SHOTS_PER_LEVEL?.[getActorAbilityLevel(attacker, "web")] ?? 0);
    if (shotsMax <= 0) {
      /* Defensiv-Guard (Novize hat normalerweise gar keine Zeile,
         rowFromLevel-Gate in actor.js _getWeapons); F5-freundliche
         Rueckmeldung statt stiller Funkstille. */
      const title = `<h4>${game.i18n.localize("TRAIT_WEB.CARD_TITLE")}</h4>`;
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ alias: game.user.name }),
        content: `<div class="symbaroum chat ability"><div class="foreground">${title}<div class="finalTxt"><p>${traitsLabel}: ${game.i18n.localize("TRAIT_WEB.SHOTS_NONE")}</p></div></div></div>`,
      });
      return null;
    }
    /* Runden-Reset MIT Rundfeld-Pflege (B1-Fix zu v2.0-Befunden 10+11).
       B1.1 (Rudolfs Testrunde, Punkt 6): OHNE laufenden Kampf zaehlt
       das Magazin je WELTZEIT-Runde nach dem A28-Modell des Korrup-
       tionsabbaus (SL-Setting dotWorldTimeRoundMinutes, Default 15
       Minuten, 0 = Weltzeit-Takt aus; Marke = floor(Weltzeit /
       (Minuten*60)) im mm2WebThreads-Flag, kein eigener Hook noetig
       - die Pruefung hier beim Feuern genuegt). Im aktiven Kampf
       gewinnt der Kampftracker wie gehabt ("ein Takt, keine zweite
       Uhr"). Takt aus: dokumentierter Rueckfall - JE Feuern startet
       mit vollem Magazin (SL-Sache; sonst stuende der alte Freeze-
       Bug wieder: Zaehler laeuft voll und friert). */
    const combatRound = game.combat?.round ?? 0;
    let counter = { round: combatRound, used: 0 };
    if (actingTokenDoc) {
      counter = (await actingTokenDoc.getFlag(game.system.id, "mm2WebThreads")) ?? { round: combatRound, used: 0 };
      if (combatRound > 0) {
        /* Kampfpfad: Reset je Kampfrundenwechsel (unveraendert). */
        if (counter.round !== combatRound) {
          counter.round = combatRound;
          counter.used = 0;
        }
      } else {
        /* Ohne Kampf: Weltzeit-Fenster, Takt-aus-Rueckfall darunter. */
        const wtMinutes = Math.max(0, Math.round(Number(game.settings.get("symbaroum", "dotWorldTimeRoundMinutes")) || 0));
        if (wtMinutes > 0) {
          const wtMark = Math.floor(Number(game.time?.worldTime ?? 0) / (wtMinutes * 60));
          if (counter.wtMark !== wtMark) {
            counter.wtMark = wtMark;
            counter.used = 0;
          }
        } else {
          counter.used = 0;
        }
        counter.round = combatRound;
      }
    }
    /* B1.2 (Rudolfs Entscheidung zur Testrunde v1.1, Punkt 12): NETZ auf
       das Kettendialog-Modell der Kraefte umgebaut (Retest im Testplan).
       Das ERSTE markierte Ziel ist das Primaerziel (1. Geschoss), JE
       Folgeschuss fragt die Karte "Weiteres Netz-Geschoss?" (Muster
       glyphNextTargetConfirmation/chainSequenceResult) und liest die
       FRISCHE Zielmarkierung - keine Mehrfach-Auswahl noetig; Abbruch
       jederzeit. Kein Ziel doppelt in EINER Kette (handled-Set) - fuer
       weitere Faeden auf dasselbe Ziel die Zeile erneut klicken
       (bewusste Ausgestaltung, RAW je Faden ein Geschoss). Das Doppel-
       Fangen-Gate bleibt VOR der Buchung aktiv (kein Verbrauch, Kette
       laeuft weiter zur Abfrage). Leeres Magazin beim KLICK: MASTER_SPENT-
       Karte (Eintritts-Guard, wie B1); durchgeschossenes Magazin IN der
       Kette: stiller Abbruch - der naechste Klick zeigt MASTER_SPENT. */
    const marked = Array.from(game.user.targets).filter((t) => t.actor && t.id !== actingToken?.id);
    if (marked.length === 0) {
      ui.notifications?.warn(game.i18n.localize("TRAIT_MM2.NO_TARGET"));
      return null;
    }
    if (counter.used >= shotsMax) {
      const title = `<h4>${game.i18n.format("TRAIT_MM2.CHAT_REACTION_TITLE_ONE", { name: traitsLabel })}</h4>`;
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ alias: game.user.name }),
        content: `<div class="symbaroum chat ability"><div class="foreground">${title}<div class="finalTxt"><p>${traitsLabel}: ${game.i18n.format("TRAIT_WEB.MASTER_SPENT", { max: shotsMax })}</p></div></div></div>`,
      });
      return null;
    }
    const handled = new Set();
    let primary = true;
    while (counter.used < shotsMax) {
      let targetToken;
      if (primary) {
        targetToken = marked[0];
        primary = false;
      } else {
        targetToken = Array.from(game.user.targets).find(
          (t) => t.actor && t.id !== actingToken?.id && !handled.has(t.id)
        );
        if (!targetToken) {
          ui.notifications?.warn(game.i18n.localize("DIALOG.CHAIN_NO_NEW_TARGET"));
          break;
        }
      }
      handled.add(targetToken.id);
      const tokenDoc = targetToken.document ?? targetToken;
      /* Netz-Doppel-Fangen-Gate vor der Buchung: Einem bereits im NETZ
         Gebundenen (anderes Halten zaehlt nicht) keine Munition stumm
         verbrennen - Hinweiskarte, kein Geschoss (dasselbe Gate wie im
         geteilten Kern mm2WebEntangleResolve, hier SL-sichtbar). */
      const alreadyWebBound =
        tokenDoc.actor?.hasCondition?.("bind")?.getFlag(game.system.id, "flagData")?.mm2Bind?.source === "web";
      if (alreadyWebBound) {
        const heldTitle = `<h4>${game.i18n.format("TRAIT_MM2.CHAT_REACTION_TITLE_ONE", { name: traitsLabel })}</h4>`;
        const heldLine = game.i18n.format("TRAIT_MM2.CHAT_ALREADY_HELD", {
          targetname: tokenDoc.name ?? targetToken.name ?? "",
        });
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ alias: game.user.name }),
          content: `<div class="symbaroum chat ability"><div class="foreground">${heldTitle}<div class="finalTxt"><p>${traitsLabel}: ${heldLine}</p></div></div></div>`,
        });
      } else {
        counter.used += 1;
        if (actingTokenDoc) {
          await actingTokenDoc.setFlag(game.system.id, "mm2WebThreads", counter);
        }
        await mm2WebEntangleResolve({
          tokenDoc,
          meta: { creatureActorId: attacker.id, creatureName, creatureSF },
          regionId: null,
          introLines: [
            game.i18n.format("TRAIT_WEB.SHOTS_FIRE_LINE", { creaturename: creatureName, targetname: tokenDoc.name ?? targetToken.name ?? "" }),
            game.i18n.format("TRAIT_WEB.MASTER_THREADS", { used: counter.used, max: shotsMax }),
          ],
        });
      }
      if (counter.used >= shotsMax) break;
      const nextShot = await glyphNextTargetConfirmation({ abilityName: traitsLabel }, "TRAIT_WEB.CHAT_NEXT_SHOT");
      if (!nextShot) break;
    }
    return null;
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Netz-Geschoss-Feuern", mm2Error);
    return null;
  }
}

/* MM-Paket 2 v1.2 Cross-Flag-Waffen (Konzept Runde 3, Teil A - Commit 1,
   Rudolfs Freigabe 25.11.2026): Kachel-Klick oeffnet den STANDARD-Waffen-
   dialog der MERKMALS-EIGENEN Waffe (config CROSS_WEAPON_TRAITS, actor.js
   _getWeapons/_evaluateWeapons) - dieselbe Zeile wie im Kampf-Tab. Ersetzt
   die v1/v1.1-Preset-Flows auf der unbewaffneten Waffe (Marker-Loesung
   ENTFERNT): die Rider reisen ab sofort an der Waffen-Referenz selbst
   (mm2AttackerTraits), die Serien-Vorbelegung (Greifklauen 2x, Knochen-
   geschoss ab Adept 2x) uebernimmt enhancedAttackRoll aus der vorbereiteten
   Waffe. Kein Reichweiten/Gate-Filter (Präzedenz Giftspucke, SL-Sache). */
async function mm2CrossWeaponFlow(_null, functionStuff) {
  try {
    const attacker = functionStuff.actor;
    const reference = functionStuff.ability?.reference;
    if (!attacker || !reference) return null;
    const weapon = mm2PreparedCrossWeapon(attacker, reference);
    if (!weapon) {
      /* Kanonik-Label statt Item-Namen: functionStuff.ability ist nur die
         System-DATEN-Kopie des Items (Hymnen-v1.2-Lernweis). */
      const labelKey = game.symbaroum.config.traitsList[reference] ?? "TRAIT_MM2.CROSS_WEAPON_LABEL";
      const title = `<h4>${game.i18n.localize(labelKey)}</h4>`;
      await postMaintainChainCard(functionStuff, title, [`<p>${game.i18n.localize("TRAIT_MM2.ERROR_NO_CROSS_WEAPON")}</p>`], []);
      return null;
    }
    await attacker.enhancedAttackRoll(weapon);
    return null;
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Cross-Waffen-Kachel", mm2Error);
    return null;
  }
}

/* Rammen (§3.6): SL-Kettendialog statt Movement-Auswertung (Konzept
   Entscheidung 4) - je Ziel-Token ein Probe-Button, Kette stoppt nach
   der ersten bestandenen (Opfer-)Probe. Schaden je Stufe (config),
   Ruestung schuetzt wie immer, Robust ±2 je Stufe beidseitig im
   Zielwert. Akrobatik-Alternative nur als Hinweiszeile (RAW: weicht
   aus, stoppt den Amoklauf NICHT). */
async function mm2RampageChain(_null, functionStuff) {
  try {
    const attacker = functionStuff.actor;
    if (!attacker) return null;
    const cfg = game.symbaroum.config;
    const lvl = getActorAbilityLevel(attacker, "rampage");
    const actingToken = game.symbaroum.api.getActorToken(attacker);
    const damage = cfg.MM2_RAMPAGE_DAMAGE[lvl] ?? cfg.MM2_RAMPAGE_DAMAGE[3];
    const robC = mm2RobustLevel(attacker);
    const strongC = getAttributeValue(attacker, "strong");
    const marked = Array.from(game.user.targets).filter((t) => t.actor && t.id !== actingToken?.id);
    const candidates = marked.length > 0 ? marked : (canvas.tokens?.placeables ?? []).filter((t) => t.actor && t.id !== actingToken?.id);
    if (candidates.length === 0) {
      ui.notifications?.warn(game.i18n.localize("TRAIT_MM2.NO_TARGET"));
      return null;
    }
    const victims = candidates.map((t) => ({
      tokenId: t.id,
      name: t.name,
      target: strongC + (robC - mm2RobustLevel(t.actor)) * cfg.MM2_ROBUST_BONUS_PER_LEVEL,
      hasAcrobat: getActorAbilityLevel(t.actor, "acrobatics") > 0,
    }));
    const acrobatLines = victims
      .filter((v) => v.hasAcrobat)
      .map((v) => `<p>${game.i18n.format("TRAIT_RAMPAGE.ACROBAT_HINT", { targetname: v.name })}</p>`)
      .join("");
    const buttons = victims
      .map((v) => `<button class="mm2-rampage-probe" data-victim="${v.tokenId}"><i class="fas fa-dice-d20"></i> ${game.i18n.format("TRAIT_RAMPAGE.PROBE_BUTTON", { targetname: v.name })}</button>`)
      .join(" ");
    const title = `<h4>${game.i18n.localize("TRAIT_RAMPAGE.CARD_TITLE")}</h4>`;
    const htmlBody = `<div class="symbaroum chat ability"><div class="foreground">${title}<div class="finalTxt">${acrobatLines}<p>${buttons}</p></div></div></div>`;
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: attacker.id }),
      content: htmlBody,
    };
    chatData[`flags.${game.system.id}.mm2Rampage`] = {
      creatureTokenId: actingToken?.id ?? null,
      creatureActorId: attacker.id,
      creatureName: attacker.name,
      level: lvl,
      damage,
      victims,
      stopped: false,
    };
    await ChatMessage.create(chatData);
    return null;
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Rammen-Kette", mm2Error);
    return null;
  }
}

/* Blitzschnell (§3.8): reine Hinweiskarte - die Stufen-Reaktion
   (Treffer/Schaden/Angriff -> 1/2/2 Freie Angriffe) laeuft als
   Hinweiszeile + Button auf der Angriffs-Ergebniskarte
   (mm2AttackerTraits), KEIN vollautomatischer Angriff ohne Dialog. */
async function mm2SwiftInfo(_null, functionStuff) {
  try {
    if (!functionStuff.actor) return null;
    const title = `<h4>${game.i18n.localize("TRAIT_SWIFT.INFO_TITLE")}</h4>`;
    await postMaintainChainCard(functionStuff, title, [`<p>${game.i18n.localize("TRAIT_SWIFT.INFO_BODY")}</p>`], []);
    return null;
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Blitzschnell-Hinweis", mm2Error);
    return null;
  }
}

/* Verschlingen: Verschlucken-Buchung (Meister sofort im Angriff;
   Novize/Adept erst in der Folgerunde ueber den Zugbeginn-Hook).
   Bauch-DoT = A28-Festwert 2 je Zug, ignoriert Ruestung nativ;
   Zustands-Bind bis Ausspucken (freie Aktion der Kreatur), Ausspucken
   per GM-Rundendialog am Zugbeginn der Kreatur (hooks.js, MM2 v1.1). */
async function mm2DevourSwallow(victim, devourer, traitLabel, result, lines) {
  const swallowedLine = game.i18n.format("TRAIT_DEVOUR.CHAT_SWALLOWED", { targetname: victim.name });
  lines.push(`<p>${traitLabel}: ${swallowedLine}</p>`);
  result.flags.push({
    tokenId: victim.tokenId,
    addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bind")),
    conditionData: { mm2Bind: { source: "devoured", creatureActorId: devourer.id } },
    dot: {
      label: "TRAIT_DEVOUR.DOT_LABEL",
      fixedDamage: game.symbaroum.config.MM2_BELLY_DOT,
      resource: "toughness",
      separateRoll: false,
      stackable: false,
    },
    label: `${traitLabel}: ${swallowedLine}`,
  });
  /* MM2 v1.1 (Rudolfs Nachtest 9b): KEINE Ausspucken-Chat-Karte mehr -
     der GM-Rundendialog (hooks.js updateCombat) fragt zu JEDEM Zug der
     Kreatur je verschlucktem Opfer (mm2Bind.creatureActorId) nach. */
}

/* Verschlingens-Loesung am Zugbeginn der KREATUR (hooks.js ruft bei
   bind+flagData.mm2DevourPending mit passendem devourerActorId):
   Verschlingens-Probe [Staerke<-Staerke, Robust ±2 je Stufe beid-
   seitig], Fehlschlag = verschluckt (Bauch-DoT + Ausspucken-Karte),
   Erfolg = Entkommen (bind wird automatisch entfernt). */
export async function mm2ResolveDevourPending(victimToken, devourerActor) {
  try {
    const victimActor = victimToken?.actor;
    if (!victimActor || !devourerActor) return;
    const bind = victimActor.hasCondition?.("bind");
    if (!bind) return;
    const fd = bind.getFlag(game.system.id, "flagData");
    if (!fd?.mm2DevourPending) return;
    const cfg = game.symbaroum.config;
    const traitLabel = game.i18n.localize("TRAIT_LABEL.DEVOUR");
    const target = getAttributeValue(devourerActor, "strong") + (mm2RobustLevel(devourerActor) - mm2RobustLevel(victimActor)) * cfg.MM2_ROBUST_BONUS_PER_LEVEL;
    /* Pending-Flag zuerst raeumen (kein Doppellauf bei Hook-Wieder-
       holung), dann Ergebnis buchen */
    await bind.unsetFlag(game.system.id, "flagData.mm2DevourPending");
    const probe = await new Roll("1d20").evaluate();
    const lines = [];
    if (probe.total <= target) {
      lines.push(game.i18n.format("TRAIT_DEVOUR.CHAT_PROBE_LINE", { roll: probe.total, target }));
      /* MM2 v1.1 (9b): creatureActorId fuer den GM-Rundendialog
         (hooks.js updateCombat) - Ausspucken fragt je Kreaturen-Zug */
      await bind.setFlag(game.system.id, "flagData.mm2Bind", { source: "devoured", creatureActorId: devourerActor.id });
      await bind.setFlag(game.system.id, "flagData.dot", {
        label: "TRAIT_DEVOUR.DOT_LABEL",
        fixedDamage: cfg.MM2_BELLY_DOT,
        resource: "toughness",
        separateRoll: false,
        stackable: false,
      });
      lines.push(game.i18n.format("TRAIT_DEVOUR.CHAT_SWALLOWED", { targetname: victimToken.name }));
    } else {
      await victimActor.removeCondition("bind");
      lines.push(game.i18n.format("TRAIT_DEVOUR.CHAT_ESCAPED", { targetname: victimToken.name, roll: probe.total }));
    }
    const title = `<h4>${game.i18n.format("TRAIT_MM2.CHAT_REACTION_TITLE_ONE", { name: traitLabel })}</h4>`;
    await postMaintainChainCard({ actor: devourerActor, actingCharName: devourerActor.name }, title, lines.map((l) => `<p>${traitLabel}: ${l}</p>`), [probe]);
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Verschlingens-Zaegelloesung", mm2Error);
  }
}

/* Greifklauen-Folgezug (hooks.js ruft bei bind+flagData.mm2ClawPending
   mit passendem pullerActorId): Zug-Probe [Staerke<-Staerke], Erfolg
   der Kreatur = Opfer wird herangezogen (bind bleibt bis Befreiung),
   Fehlschlag = Griff bricht (bind automatisch entfernt). */
export async function mm2ResolveClawPull(victimToken, pullerActor) {
  try {
    const victimActor = victimToken?.actor;
    if (!victimActor || !pullerActor) return;
    const bind = victimActor.hasCondition?.("bind");
    if (!bind) return;
    const fd = bind.getFlag(game.system.id, "flagData");
    if (!fd?.mm2ClawPending) return;
    await bind.unsetFlag(game.system.id, "flagData.mm2ClawPending");
    const traitLabel = game.i18n.localize("TRAIT_LABEL.PREHENSILECLAWS");
    const pullerName = game.symbaroum.api.getActorToken(pullerActor)?.name ?? pullerActor.name;
    const target = getAttributeValue(pullerActor, "strong") + (10 - getAttributeValue(victimActor, "strong"));
    const probe = await new Roll("1d20").evaluate();
    const lines = [];
    lines.push(game.i18n.format("TRAIT_PREHENSILECLAWS.CHAT_PULL_LINE", { roll: probe.total, target, creaturename: pullerName }));
    if (probe.total <= target) {
      const pullerToken = game.symbaroum.api.getActorToken(pullerActor);
      const moveOk = await mm2PullTokenAdjacent(victimToken, pullerToken);
      lines.push(moveOk ? game.i18n.format("TRAIT_PREHENSILECLAWS.CHAT_PULLED", { targetname: victimToken.name, creaturename: pullerName }) : game.i18n.format("TRAIT_GRAPPLINGTONGUE.CHAT_MOVE_MANUAL", { targetname: victimToken.name, creaturename: pullerName }));
    } else {
      await victimActor.removeCondition("bind");
      lines.push(game.i18n.format("TRAIT_PREHENSILECLAWS.CHAT_PULL_RESISTED", { targetname: victimToken.name, roll: probe.total, target }));
    }
    const title = `<h4>${game.i18n.format("TRAIT_MM2.CHAT_REACTION_TITLE_ONE", { name: traitLabel })}</h4>`;
    await postMaintainChainCard({ actor: pullerActor, actingCharName: pullerActor.name }, title, lines.map((l) => `<p>${traitLabel}: ${l}</p>`), [probe]);
    /* MM2 v1.1 (4a): KEINE Befreiungskarte mehr hier - sie erscheint am
       OPFER-ZUGBEGINN (hooks.js updateCombat) aus den beim Packeln
       gespeicherten mm2Liberate-Daten der bind-Condition, solange
       gebunden (Novize/Adept, RAW 1x je Runde). */
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Greifklauen-Folgezug", mm2Error);
  }
}

/* Zerstörer-Reaktion (§3.7, Novize/Adept): Opfer-Probe [Staerke<-
   Staerke, Robust ±2 je Stufe beidseitig], Fehlschlag = prone
   (Foundry-Core), Adept zusaetzlich 1W6 Meter Rueckschleuderung +
   Fallschaden (applyFallDamage, Ruestung schuetzt normal) + SL-
   Verschiebe-Hinweis (Richtung manuell - bewusste Grenze). Export
   fuer den Anfragekarten-Handler (SC-Opfer wuerfeln selbst). */
/* MM-Paket 2 v1.1 (Rudolfs Nachtest 11b/14): Fallschaden-SL-Karte -
   gefluestert an die GMs mit Dialog-Oeffnen-Taste statt stiller Buchung;
   Klick (hooks.js-Handler zum Flag mm2FallPrompt) oeffnet den Fallschaden-
   Dialog am GM-Client mit vorbefuelltem Opfer + Fallhoehe. Laeuft auch,
   wenn die Rueckschleuderungs-Reaktion auf dem Opfer-Spieler-Client
   ausgewertet wurde. */
export async function mm2FallPromptCard(victimTokenId, victimName, meter) {
  try {
    if (!victimTokenId) return;
    const recipients = new Set();
    for (const user of game.users) {
      if (user.active && user.isGM) recipients.add(user.id);
    }
    if (recipients.size === 0) recipients.add(game.user.id);
    const title = `<h4>${game.i18n.localize("FALL.PROMPT_TITLE")}</h4>`;
    const line = game.i18n.format("FALL.PROMPT_LINE", { targetname: victimName ?? "", meter: Number(meter) || 0 });
    const buttonHtml = `<button class="mm2-fall-dialog"><i class="fas fa-dice-d20"></i> ${game.i18n.localize("FALL.PROMPT_BUTTON")}</button>`;
    const htmlBody = `<div class="symbaroum chat ability"><div class="foreground">${title}<div class="finalTxt"><p>${line}</p><p>${buttonHtml}</p></div></div></div>`;
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize("DIALOG.SYSTEM_MESSAGE") }),
      whisper: [...recipients],
      content: htmlBody,
    };
    chatData[`flags.${game.system.id}.mm2FallPrompt`] = { tokenId: victimTokenId, victimName: victimName ?? "", meter: Number(meter) || 0 };
    await ChatMessage.create(chatData);
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Fallschaden-SL-Karte", mm2Error);
  }
}

/* MM-Paket 2 v1.1 (Rudolfs Nachtest 11b/14): Fallschaden-SL-Dialog
   (GM-Utility-Makro "Fallschaden" + Oeffnen-Taste der SL-Karte):
   Ziel-Dropdown (Spieler-SCs + Szenen-Token-Akteure, dedupliziert),
   hart/weich-Radios (hart default), numerisches Fallhoehenfeld;
   Bestaetigen bucht applyFallDamage MIT [Gewandtheit]-Probe (withProbe)
   ueber die GM-Anwenden-Karte. GM-only (Utility-Makro im System-Ordner,
   keine Spieler-Freigabe - im Gegensatz zum Bergen-Muster). */
export async function openFallDamageDialog(prefill = {}) {
  try {
    if (!game.user.isGM) return;
    const candidates = [];
    const seen = new Set();
    const addCandidate = (actor) => {
      if (!actor || seen.has(actor.id)) return;
      seen.add(actor.id);
      candidates.push(actor);
    };
    for (const actor of game.actors ?? []) {
      if (actor.type === "character") addCandidate(actor);
    }
    for (const token of canvas.tokens?.placeables ?? []) addCandidate(token.actor);
    if (candidates.length === 0) {
      ui.notifications.warn(game.i18n.localize("FALL.DIALOG_NO_TARGET"));
      return;
    }
    candidates.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    let preselect = null;
    if (prefill.tokenId) {
      const prefillToken = canvas.tokens?.placeables?.find((t) => t.id === prefill.tokenId) ?? null;
      if (prefillToken?.actor && seen.has(prefillToken.actor.id)) preselect = prefillToken.actor.id;
    }
    const options = candidates
      .map((a) => `<option value="${a.id}"${a.id === preselect ? " selected" : ""}>${a.name}</option>`)
      .join("");
    const opts = { actorId: "", meter: 0, weich: false };
    const action = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("FALL.DIALOG_TITLE") },
      classes: ["symb-dialog", "modern-dialog", "modern-theme-dark"],
      position: { width: 440 },
      content: `<div>
  <div style="margin-bottom:0.6rem;"><label style="display:block;margin-bottom:0.25rem;">${game.i18n.localize("FALL.DIALOG_TARGET")}</label>
  <select id="mm2-fall-target" style="width:100%;">${options}</select></div>
  <div style="margin-bottom:0.6rem;"><label style="display:block;margin-bottom:0.25rem;">${game.i18n.localize("FALL.DIALOG_METER")}</label>
  <input type="number" id="mm2-fall-meter" value="${Number(prefill.meter ?? 0) > 0 ? Number(prefill.meter) : ""}" min="1" step="1" style="width:6rem;"></div>
  <div><label class="lblfavour"><input type="radio" name="mm2FallGround" value="hard" checked> ${game.i18n.localize("FALL.DIALOG_HARD")}</label></div>
  <div><label class="lblfavour"><input type="radio" name="mm2FallGround" value="soft"> ${game.i18n.localize("FALL.DIALOG_SOFT")}</label></div>
</div>`,
      buttons: [
        {
          action: "fall",
          label: game.i18n.localize("FALL.DIALOG_BUTTON"),
          default: true,
          /* Formularwerte NUR im Button-Callback lesen (DialogV2.wait
             loest erst nach dem Schliessen auf - Bergen-Muster) */
          callback: (event, button, dialog) => {
            const root = dialog?.element ?? event?.target?.closest("dialog") ?? document;
            opts.actorId = root.querySelector("#mm2-fall-target")?.value ?? "";
            opts.meter = Number(root.querySelector("#mm2-fall-meter")?.value ?? 0) || 0;
            opts.weich = root.querySelector('input[name="mm2FallGround"]:checked')?.value === "soft";
          },
        },
        { action: "cancel", label: game.i18n.localize("BUTTON.CANCEL") },
      ],
    });
    if (action !== "fall") return;
    const targetActor = candidates.find((a) => a.id === opts.actorId) ?? null;
    if (!targetActor) {
      ui.notifications.warn(game.i18n.localize("FALL.DIALOG_NO_TARGET"));
      return;
    }
    if (!(opts.meter > 0)) {
      ui.notifications.warn(game.i18n.localize("FALL.DIALOG_NO_METER"));
      return;
    }
    await applyFallDamage(targetActor, opts.meter, { weich: opts.weich, withProbe: true });
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Fallschaden-Dialog", mm2Error);
  }
}

export async function mm2WreckerKnockdown(victim, attacker, wreckerLvl, probe, probeTarget, lines, rolls, resultFlags) {
  const traitLabel = game.i18n.localize("TRAIT_LABEL.WRECKER");
  /* Opfer probe total <= Zielwert = widestand geglueckt (steht),
     > Zielwert = zu Boden geschleudert - identische Semantik wie der
     mm2wrecker-Handler in hooks.js (SC-Anfragekarten-Pfad). */
  if (probe.total <= probeTarget) {
    lines.push(`<p>${traitLabel}: ${game.i18n.format("TRAIT_WRECKER.CHAT_STOOD", { targetname: victim.name, roll: probe.total, target: probeTarget })}</p>`);
    return;
  }
  const proneLine = game.i18n.format("TRAIT_WRECKER.CHAT_PRONE_LINE", { targetname: victim.name, roll: probe.total, target: probeTarget });
  lines.push(`<p>${traitLabel}: ${proneLine}</p>`);
  resultFlags.push({
    tokenId: victim.tokenId,
    addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "prone")),
    label: `${traitLabel}: ${proneLine}`,
  });
  if (wreckerLvl >= 2) {
    const distRoll = await new Roll("1d6").evaluate();
    rolls.push(distRoll);
    lines.push(`<p>${traitLabel}: ${game.i18n.format("TRAIT_WRECKER.CHAT_THROWN", { targetname: victim.name, count: distRoll.total })}</p>`);
    /* MM2 v1.1 (Nachtest 11b/14): kein stiller applyFallDamage-Aufruf
       mehr - gefluesterte SL-Karte mit Dialog-Oeffnen-Taste (Opfer +
       1W6-Distanz vorbefüllt), funktioniert auch vom Spieler-Client
       (Klick öffnet den Dialog am GM-Client). Zugrichtung zieht der SL
       manuell am Token (bewusste Grenze, unveraendert). */
    await mm2FallPromptCard(victim.tokenId, victim.name, distRoll.total);
  }
}

/* ================================================================
 * MM-Paket 2 v1: Angreifer-seitige Reaktions-Merkmale im Angriffs-
 * Pfad (Attack-Engine-Integration parallel zu mm1AttackerTraits).
 * Checkbox-Gating: functionStuff.mm2Ticked aus dialog.js - leere Map
 * = bewusst aus, fehlende Map (Flows ohne Waffendialog, z.B. Makro/
 * Riposte) = v1.0-Automatik-Rueckfall (identische v1.1-Semantik).
 * ================================================================ */
async function mm2AttackerTraits(functionStuff, damageTot, targetDies, rollData, templateData) {
  const result = { flags: [], reactionCards: [], swiftButton: null };
  try {
    if (functionStuff.isAlternativeDamage) return result;
    const attacker = functionStuff.actor;
    const victim = functionStuff.targetData;
    if (!attacker || !victim?.actor || !victim.tokenId) return result;
    const cfg = game.symbaroum.config;
    const weaponRef = functionStuff.weapon?.system?.reference ?? functionStuff.weapon?.reference;
    const isUnarmed = weaponRef === "unarmed";
    const hits = rollData.filter((r) => r.trueActorSucceeded).length;
    const anyHit = hits > 0;
    const mm2Ticked = functionStuff.mm2Ticked;
    const mm2Auto = mm2Ticked === undefined;
    const traitWanted = (ref) => mm2Auto || mm2Ticked[ref] === true;

    const lines = [];
    const reactionRolls = [];
    const reactionTraits = [];
    const pendingProbes = [];
    const alreadyHeld = () => Boolean(victim.actor.hasCondition?.("bind"));
    const bindLabelLine = (traitLabel, key, formatArgs) => `<p>${traitLabel}: ${game.i18n.format(key, formatArgs)}</p>`;

    /* --- Erdrueckende Umarmung (§3.4): Treffer der natuerlichen
       Waffe MIT Schaden -> Verfangens-Escape [GW<-PR]; Fehlschlag:
       bind + A28-Festwert-Griffschaden 2/3/4 je Stufe (ignoriert
       Ruestung nativ) + Befreiungskarte [ST<-ST]. SC-Opfer wuerfeln
       die Escape-Probe selbst (Anfragekarte, mm1SendResistProbe-
       Muster), NSC-Opfer Vollautomatik. Kartentexte fuer "Opfer kann
       nicht handeln / Kreatur ohne weitere Angriffe" als Hinweis
       (keine harte Action-Sperre - bewusste Grenze). */
    const embraceLvl = getActorAbilityLevel(attacker, "crushingembrace");
    if (
      embraceLvl > 0 &&
      traitWanted("crushingembrace") &&
      isUnarmed &&
      damageTot > 0 &&
      anyHit &&
      !targetDies &&
      !functionStuff.freeAttack
    ) {
      const traitLabel = game.i18n.localize("TRAIT_LABEL.CRUSHINGEMBRACE");
      reactionTraits.push(traitLabel);
      const griffDamage = cfg.MM2_EMBRACE_DOT[embraceLvl] ?? cfg.MM2_EMBRACE_DOT[3];
      if (alreadyHeld()) {
        lines.push(bindLabelLine(traitLabel, "TRAIT_MM2.CHAT_ALREADY_HELD", { targetname: victim.name }));
      } else {
        const escapeTarget = getAttributeValue(victim.actor, "quick") + (10 - getAttributeValue(attacker, "accurate"));
        const probeOwner = await mm1ProbeOwner(victim.actor);
        if (probeOwner) {
          pendingProbes.push({
            kind: "mm2embrace",
            label: traitLabel,
            target: escapeTarget,
            level: embraceLvl,
            victimName: victim.name,
            griffDamage,
            liberateTarget: getAttributeValue(victim.actor, "strong") + (10 - getAttributeValue(attacker, "strong")),
            sourceTokenId: functionStuff.tokenId,
          });
          lines.push(bindLabelLine(traitLabel, "TRAIT_MM2.CHAT_PROBE_PENDING", { targetname: victim.name }));
        } else {
          const probe = await new Roll("1d20").evaluate();
          reactionRolls.push(probe);
          if (probe.total <= escapeTarget) {
            lines.push(bindLabelLine(traitLabel, "TRAIT_CRUSHINGEMBRACE.CHAT_RESISTED", { targetname: victim.name, roll: probe.total, target: escapeTarget }));
          } else {
            const appliedLine = game.i18n.format("TRAIT_CRUSHINGEMBRACE.CHAT_APPLIED", { targetname: victim.name, damage: griffDamage });
            lines.push(`<p>${traitLabel}: ${appliedLine}</p>`);
            lines.push(`<p>${game.i18n.localize("TRAIT_CRUSHINGEMBRACE.CHAT_NOACTION_HINT")}</p>`);
            result.flags.push({
              tokenId: victim.tokenId,
              addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bind")),
              /* MM2 v1.1 (Nachtest 4a): Befreiungsdaten reiten in der
                 bind-Condition mit - die Karte erscheint ERST AM
                 OPFER-ZUGBEGINN (hooks.js updateCombat), solange gebunden */
              conditionData: {
                mm2Bind: { source: "embrace" },
                mm2Liberate: {
                  target: getAttributeValue(victim.actor, "strong") + (10 - getAttributeValue(attacker, "strong")),
                  source: "embrace",
                  attr: game.i18n.localize("TRAIT_MM2.LIBERATE_ATTR_STRONG"),
                },
              },
              dot: {
                label: "TRAIT_CRUSHINGEMBRACE.CHAT_DOT_LABEL",
                fixedDamage: griffDamage,
                resource: "toughness",
                separateRoll: false,
                stackable: false,
              },
              label: `${traitLabel}: ${appliedLine}`,
            });
          }
        }
      }
    }

    /* --- Verschlingen (§3.5): Biss-Trigger Novize (Schaden) / Adept
       (Treffer), Meister sofort im selben Angriff. Kolossal-Gate als
       Hinweiszeile (Kapazitaet 1/3/6 traegt der SL). Nov/Adept:
       bind + Pending-Flag, Auflsung im Zugbeginn-Hook (A34-Nachbarschaft);
       Meister: verzoegerungsfreie Verschlingens-Probe. Verschlungen =
       bind + Bauch-Festwert-DoT + Ausspucken-Karte. */
    const devourLvl = getActorAbilityLevel(attacker, "devour");
    if (devourLvl > 0 && traitWanted("devour") && isUnarmed && anyHit && !targetDies && !functionStuff.freeAttack) {
      const triggered = devourLvl >= 3 || (devourLvl === 2 && anyHit) || (devourLvl === 1 && damageTot > 0);
      if (triggered) {
        const traitLabel = game.i18n.localize("TRAIT_LABEL.DEVOUR");
        reactionTraits.push(traitLabel);
        const colossalLvl = getActorAbilityLevel(attacker, "colossal");
        if (colossalLvl < 1) {
          lines.push(`<p>${traitLabel}: ${game.i18n.localize("TRAIT_DEVOUR.GATE_MISSING")}</p>`);
        } else if (alreadyHeld()) {
          lines.push(bindLabelLine(traitLabel, "TRAIT_MM2.CHAT_ALREADY_HELD", { targetname: victim.name }));
        } else if (devourLvl >= 3) {
          const target = getAttributeValue(attacker, "strong") + (mm2RobustLevel(attacker) - mm2RobustLevel(victim.actor)) * cfg.MM2_ROBUST_BONUS_PER_LEVEL;
          const probe = await new Roll("1d20").evaluate();
          reactionRolls.push(probe);
          lines.push(`<p>${traitLabel}: ${game.i18n.format("TRAIT_DEVOUR.CHAT_PROBE_LINE", { roll: probe.total, target })}</p>`);
          if (probe.total <= target) {
            await mm2DevourSwallow(victim, attacker, traitLabel, result, lines);
          } else {
            lines.push(bindLabelLine(traitLabel, "TRAIT_DEVOUR.CHAT_ESCAPED", { targetname: victim.name, roll: probe.total }));
          }
        } else {
          const appliedLine = game.i18n.format("TRAIT_DEVOUR.CHAT_PENDING", { targetname: victim.name });
          lines.push(`<p>${traitLabel}: ${appliedLine}</p>`);
          result.flags.push({
            tokenId: victim.tokenId,
            addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bind")),
            conditionData: {
              mm2Bind: { source: "devour" },
              mm2DevourPending: { devourerActorId: attacker.id },
            },
            label: `${traitLabel}: ${appliedLine}`,
          });
        }
      }
    }

    /* --- Zerstörer (§3.7, Novize/Adept - Meister laeuft passiv als
       Zerstörend-Qualitaet, getItemModifierWrecker): Opfer nimmt
       Schaden durch die NATUERLICHE Waffe -> [ST<-ST, Robust ±2 je
       Stufe beidseitig], Fehlschlag = prone (+ Adept-Rueckschleuderung
       mit 1W6 + Fallschaden). SC-Opfer: Anfragekarte; NSC: Auto. */
    const wreckerLvl = getActorAbilityLevel(attacker, "wrecker");
    if (
      wreckerLvl > 0 &&
      wreckerLvl < 3 &&
      traitWanted("wrecker") &&
      isUnarmed &&
      damageTot > 0 &&
      anyHit &&
      !targetDies &&
      !functionStuff.freeAttack
    ) {
      const traitLabel = game.i18n.localize("TRAIT_LABEL.WRECKER");
      reactionTraits.push(traitLabel);
      if (victim.actor.hasCondition?.("prone")) {
        lines.push(`<p>${traitLabel}: ${game.i18n.format("TRAIT_MM2.CHAT_ALREADY_PRONE", { targetname: victim.name })}</p>`);
      } else {
        const probeTarget = getAttributeValue(victim.actor, "strong") + (mm2RobustLevel(victim.actor) - mm2RobustLevel(attacker)) * cfg.MM2_ROBUST_BONUS_PER_LEVEL;
        const probeOwner = await mm1ProbeOwner(victim.actor);
        if (probeOwner) {
          pendingProbes.push({
            kind: "mm2wrecker",
            label: traitLabel,
            target: probeTarget,
            level: wreckerLvl,
            victimName: victim.name,
          });
          lines.push(bindLabelLine(traitLabel, "TRAIT_MM2.CHAT_PROBE_PENDING", { targetname: victim.name }));
        } else {
          const probe = await new Roll("1d20").evaluate();
          reactionRolls.push(probe);
          await mm2WreckerKnockdown(victim, attacker, wreckerLvl, probe, probeTarget, lines, reactionRolls, result.flags);
        }
      }
    }

    /* --- Greifzunge (Cross-Waffe, Konzept Runde 3 Teil A - Bola-Form;
   B1.1: NUR Referenz-gebunden): Treffer + Opfer mindestens eine
   Robust-Stufe schwaecher -> Zug-Probe [ST<-ST] (SC-Opfer wuerfeln
   per Anfragekarte, NSC automatisch), Misslingen dem Opfer = adjacent
   zur Kreatur herangezogen. IMMER Zeile, auch beim Angriffs-Fehl-
   schlag (v1.1-Testbefunde 2/3: kein stiller Wurf, keine leeren
   Dialoge); Freie Angriffe bleiben ohne Rider (RAW-Praezedenz
   aktive Merkmale im Freien Angriff).
   B1.1 (Rudolfs Testrunde, Punkt 18): Der B1-Qualitaets-Pfad (Upstream-
   Qualitaet 'Fangend'/ensnaring) ist ENTFERNT - RAW (MCX) belegt das
   Heranziehen allein fuer die Zungen-Referenz; fuer die Qualitaet
   traegt das APG ein FESSEL-Modell [Praezision<-Gewandtheit] OHNE
   Heranziehen. Das Fessel-Modell wartet auf eine eigene Freigabe,
   bis dahin wirkt die Fangend-Checkbox rein konfigurativ (kein
   Kampftab-Rider; QUALITY.ENSNARING bleibt Upstream-Label des
   Qualitaeten-Katalogs). */
    if (weaponRef === "grapplingtongue" && !functionStuff.isAlternativeDamage) {
      const traitLabel = game.i18n.localize("TRAIT_LABEL.GRAPPLINGTONGUE");
      reactionTraits.push(traitLabel);
      if (!anyHit || targetDies) {
        lines.push(bindLabelLine(traitLabel, "TRAIT_GRAPPLINGTONGUE.CHAT_MISS", { targetname: victim.name }));
      } else if (!functionStuff.freeAttack) {
        if (mm2RobustLevel(attacker) <= mm2RobustLevel(victim.actor)) {
          lines.push(bindLabelLine(traitLabel, "TRAIT_GRAPPLINGTONGUE.CHAT_NO_ROBUST_EDGE", { targetname: victim.name }));
        } else {
          const pullTarget = getAttributeValue(attacker, "strong") + (10 - getAttributeValue(victim.actor, "strong"));
          const probeOwner = await mm1ProbeOwner(victim.actor);
          if (probeOwner) {
           pendingProbes.push({
              kind: "mm2tongue",
              label: traitLabel,
              target: pullTarget,
              victimName: victim.name,
              pullerTokenId: functionStuff.tokenId,
              creatureName: functionStuff.actingCharName ?? "",
            });
            lines.push(bindLabelLine(traitLabel, "TRAIT_MM2.CHAT_PROBE_PENDING", { targetname: victim.name }));
          } else {
            const probe = await new Roll("1d20").evaluate();
            reactionRolls.push(probe);
            lines.push(`<p>${traitLabel}: ${game.i18n.format("TRAIT_GRAPPLINGTONGUE.CHAT_PULL_LINE", { roll: probe.total, target: pullTarget, creaturename: functionStuff.actingCharName })}</p>`);
            if (probe.total <= pullTarget) {
              const moveOk = await mm2PullTokenAdjacent(victim.token, functionStuff.token);
              lines.push(bindLabelLine(traitLabel, moveOk ? "TRAIT_GRAPPLINGTONGUE.CHAT_PULLED" : "TRAIT_GRAPPLINGTONGUE.CHAT_MOVE_MANUAL", { targetname: victim.name, creaturename: functionStuff.actingCharName }));
            } else {
              lines.push(bindLabelLine(traitLabel, "TRAIT_GRAPPLINGTONGUE.CHAT_PULL_RESISTED", { targetname: victim.name, roll: probe.total, target: pullTarget }));
            }
          }
        }
      }
    }

    /* --- Greifklauen (Cross-Waffe, Konzept Runde 3 Teil A): 2er-Serie
       gegen dasselbe Ziel in EINER Karte (Serien-Vorbelegung aus der
       vorbereiteten Waffe), Packeln je Stufe (Novize: BEIDE Klaue-
       angriffe muessen treffen; Adept: einer genuegt; Meister: sofortiges
       Ziehen bei einem Treffer, Befreiung nur noch Tod/Loslassen), bind-
       Folgerunde ueber mm2ClawPending am Opfer-Zugbeginn (hooks.js
       unberuehrt). Treffer-/Packel-Zeilen IMMER sichtbar. */
    if (weaponRef === "prehensileclaws" && !functionStuff.isAlternativeDamage) {
      const traitLabel = game.i18n.localize("TRAIT_LABEL.PREHENSILECLAWS");
      const clawsLvl = getActorAbilityLevel(attacker, "prehensileclaws");
      const totalRolls = rollData.length;
      reactionTraits.push(traitLabel);
      lines.push(bindLabelLine(traitLabel, "TRAIT_PREHENSILECLAWS.CHAT_SERIES_LINE", { hits: hits, total: totalRolls }));
      if (anyHit && !targetDies && !functionStuff.freeAttack && !alreadyHeld()) {
        const packThreshold = clawsLvl >= 2 ? 1 : totalRolls;
        if (hits >= packThreshold) {
          const packTarget = getAttributeValue(attacker, "strong") + (10 - getAttributeValue(victim.actor, "strong"));
          const probe = await new Roll("1d20").evaluate();
          reactionRolls.push(probe);
          if (probe.total <= packTarget) {
            const packedLine = game.i18n.format("TRAIT_PREHENSILECLAWS.CHAT_PACKED", { targetname: victim.name, roll: probe.total, target: packTarget });
            lines.push(`<p>${traitLabel}: ${packedLine}</p>`);
            if (clawsLvl >= 3) {
              const moveOk = await mm2PullTokenAdjacent(victim.token, functionStuff.token);
              lines.push(bindLabelLine(traitLabel, moveOk ? "TRAIT_PREHENSILECLAWS.CHAT_PULLED" : "TRAIT_GRAPPLINGTONGUE.CHAT_MOVE_MANUAL", { targetname: victim.name, creaturename: functionStuff.actingCharName }));
              lines.push(bindLabelLine(traitLabel, "TRAIT_PREHENSILECLAWS.CHAT_MASTER_BIND", { targetname: victim.name, creaturename: functionStuff.actingCharName }));
              result.flags.push({
                tokenId: victim.tokenId,
                addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bind")),
                conditionData: { mm2Bind: { source: "clawsMaster" } },
                label: `${traitLabel}: ${packedLine}`,
              });
            } else {
              lines.push(bindLabelLine(traitLabel, "TRAIT_PREHENSILECLAWS.CHAT_HELD", { targetname: victim.name, creaturename: functionStuff.actingCharName }));
              result.flags.push({
                tokenId: victim.tokenId,
                addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bind")),
                /* MM2 v1.1 (Nachtest 4a): Befreiungsdaten reiten in der
                   bind-Condition mit - Karte erst am Opfer-Zugbeginn
                   (hooks.js updateCombat), solange gebunden */
                conditionData: {
                  mm2Bind: { source: "claws" },
                  mm2ClawPending: { pullerActorId: attacker.id, level: clawsLvl },
                  mm2Liberate: {
                    target: getAttributeValue(victim.actor, "strong") + (10 - getAttributeValue(attacker, "strong")),
                    source: "claws",
                    attr: game.i18n.localize("TRAIT_MM2.LIBERATE_ATTR_STRONG"),
                  },
                },
                label: `${traitLabel}: ${packedLine}`,
              });
            }
          } else {
            lines.push(bindLabelLine(traitLabel, "TRAIT_PREHENSILECLAWS.CHAT_PACK_RESISTED", { targetname: victim.name, roll: probe.total }));
          }
        } else {
          lines.push(bindLabelLine(traitLabel, "TRAIT_PREHENSILECLAWS.CHAT_NO_PACK", { hits: hits, total: totalRolls }));
        }
      }
    }

    /* --- Giftspucke (Cross-Waffe, Konzept Runde 3 Teil A): Treffer ->
       SEPARATE Giftresistenz [Scharfsinn<-Staerke] und Gift-DoT ueber die
       bestehende Gift-Engine (poisonCalc): NSC-Traeger B5-Festwerte je
       Stufe, SC-Traeger Grad-Wuerfelmodell (v1.1-Bewertungsfrage 2
       unveraendert). Kein Waffenschaden - die Spucke wirkt allein ueber
       das Gift (Vault-Notiz), IMMER Zeile. */
    if (weaponRef === "poisonspit" && !functionStuff.isAlternativeDamage) {
      const traitLabel = game.i18n.localize("TRAIT_LABEL.POISONSPIT");
      reactionTraits.push(traitLabel);
      lines.push(`<p>${traitLabel}: ${game.i18n.localize("TRAIT_POISONSPIT.CHAT_SPIT_ONLY")}</p>`);
      if (!anyHit || targetDies || functionStuff.freeAttack) {
        lines.push(bindLabelLine(traitLabel, "TRAIT_POISONSPIT.CHAT_MISS", { targetname: victim.name }));
      } else if (!functionStuff.targetData.actor.system.combat.damageProt.poison) {
        lines.push(bindLabelLine(traitLabel, "TRAIT_POISONSPIT.CHAT_IMMUNE", { targetname: victim.name }));
      } else {
        const spitLvl = getActorAbilityLevel(attacker, "poisonspit");
        functionStuff.poison = Math.max(1, spitLvl);
        if (attacker.system.isPlayer) {
          functionStuff.poisonSpitSC = true;
        } else {
          functionStuff.poisonFixedValues = true;
        }
        /* Resistenzprobe Muster Giftspucke v1: einseitig
           [Scharfsinn<-Staerke], NICHT der Angriffswurf */
        const spitResistRoll = await baseRoll(attacker, "cunning", victim.actor, "strong", 0, 0, functionStuff.resistRoll);
        if (spitResistRoll?.rolls) reactionRolls.push(...spitResistRoll.rolls);
        const poisonRes = await poisonCalc(functionStuff, spitResistRoll);
        if (poisonRes.roll) reactionRolls.push(poisonRes.roll);
        if (poisonRes.poisonDotRoll) reactionRolls.push(poisonRes.poisonDotRoll);
        lines.push(`<p>${traitLabel}: ${poisonRes.poisonChatResult ?? ""}</p>`);
        /* v1.0.1 (Rudolfs Testrunde Commit 1, Befund 6a): giftspit war das
           einzige MM2-Flag ohne label - der GM-Anwenden-Karte blieb der
           Bullets-Text leer. Label nachreichen, poisons phone poisonChatResult. */
        if (poisonRes.flagData) {
          if (!poisonRes.flagData.label) poisonRes.flagData.label = `${traitLabel}: ${poisonRes.poisonChatResult ?? ""}`;
          result.flags.push(poisonRes.flagData);
        }
      }
    }

    /* --- Knochengeschoss (Cross-Waffe, Konzept Runde 3 Teil A,
       Vault-Steckbrief): Wurfwaffen-Angriff, Schaden nach Natuerliche-
       Waffe-Stufe; Meister-Bonus und Korruptionsangriff wirken als
       automatische Paket-Mitglieder (getItemModifierBoneprojectile),
       Giftig je Stufe im Angriffspfad (attackResult) - hier bleibt die
       IMMER-Zeile. */
    if (weaponRef === "boneprojectile" && !functionStuff.isAlternativeDamage) {
      const traitLabel = game.i18n.localize("TRAIT_LABEL.BONEPROJECTILE");
      reactionTraits.push(traitLabel);
      if (!anyHit || targetDies) {
        lines.push(bindLabelLine(traitLabel, "TRAIT_BONEPROJECTILE.CHAT_MISS", { targetname: victim.name }));
      }
    }

    /* --- Blitzschnell (§3.8): Stufen-Reaktion auf die Angriffs-
       Ergebniskarte - Novize: Treffer -> 1 Freier Angriff, Adept:
       Schaden -> 2, Meister: Angriff (egal ob Treffer) -> 2. KEINE
       Rekursion (Freie Angriffe und Swift-Klone sind ausgeschlossen),
       kein vollautomatischer Angriff ohne Dialog: Hinweiszeile +
       Button, Klick oeffnet den Waffendialog mit vorangehakter
       Freier-Angriff-Box (Vorbelegung, kein Zwang). */
    if (!functionStuff.freeAttack && !functionStuff.isSwiftFreeAttack && !functionStuff.isReturnSwing) {
      const swiftLvl = getActorAbilityLevel(attacker, "swift");
      let freeAttacks = 0;
      if (swiftLvl === 1 && anyHit) freeAttacks = 1;
      else if (swiftLvl === 2 && damageTot > 0) freeAttacks = 2;
      else if (swiftLvl >= 3 && rollData.length > 0) freeAttacks = 2;
      if (freeAttacks > 0) {
        templateData.mm2SwiftHint = true;
        templateData.mm2SwiftHintText = game.i18n.format("TRAIT_SWIFT.CHAT_HINT", { name: functionStuff.actingCharName ?? attacker.name, count: freeAttacks });
        result.swiftButton = {
          tokenId: functionStuff.tokenId,
          actorId: attacker.id,
          weaponId: functionStuff.weapon?.id ?? null,
          weaponName: functionStuff.weapon?.name ?? null,
          freeAttacks,
        };
        /* Template-Flag rendert die Taste (combat.hbs), die Klick-
           Daten laufen als Nachrichten-Flag mm2SwiftAttack */
        templateData.mm2SwiftButton = true;
      }
    }

    if (pendingProbes.length > 0) {
      const probeOwner = await mm1ProbeOwner(victim.actor);
      if (probeOwner) {
        await mm1SendResistProbe(probeOwner, victim.tokenId, victim.name, functionStuff.actingCharName, pendingProbes);
      }
    }
    if (lines.length > 0) {
      const titleName = reactionTraits.join(" & ");
      result.reactionCards.push({
        titleHtml: `<h4>${game.i18n.format("TRAIT_MM2.CHAT_REACTION_TITLE_ONE", { name: titleName })}</h4>`,
        lines,
        rolls: reactionRolls,
      });
    }
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Angreifer-Merkmale", mm2Error);
  }
  return result;
}

/* MM-Paket 2 v1 (Fallschaden-Baustein, Konzept Rudolfs Entscheidung
   9, GRW/Vault „Schaden durch einen Sturz“): Schaden = Sturzmeter;
   gelungene [Gewandtheit]-Probe reduziert um 3 Meter (erst bei
   withProbe=true), weicher Untergrund um 5 Meter; Ruestung schuetzt
   wie immer (Feuerseele-Konvention: Charaktere wuerfeln die Ruestungs-
   formel, NSC ziehen den Festwert protectionNpc ab). Buchung der
   Zaehigkeit ueber die GM-Anwenden-Karte (auch vom Spieler-Client
   aufrufbar), Ergebnis-Karte mit allen Wuerfen. Exportiert UND ueber
   game.symbaroum.api.applyFallDamage makro-aufrufbar. */
export async function applyFallDamage(victim, sturzmeter, { weich = false, withProbe = true } = {}) {
  try {
    let actor = null;
    let token = null;
    if (victim?.actor) {
      token = victim;
      actor = victim.actor;
    } else if (victim) {
      actor = victim;
      token = canvas.tokens?.placeables?.find((t) => t.actor?.id === victim.id) ?? null;
    }
    if (!actor) return null;
    const cfg = game.symbaroum.config;
    let meters = Math.max(0, Math.round(Number(sturzmeter) || 0));
    if (meters <= 0) meters = 0;
    const rolls = [];
    const lines = [];
    let reduced = 0;
    if (meters > 0 && withProbe) {
      const quick = getAttributeValue(actor, "quick");
      const probe = await new Roll("1d20").evaluate();
      rolls.push(probe);
      if (probe.total <= quick) {
        reduced += cfg.MM2_FALL_PROBE_REDUCE;
        lines.push(game.i18n.format("FALL.PROBE_SUCCESS", { roll: probe.total, target: quick, reduce: cfg.MM2_FALL_PROBE_REDUCE }));
      } else {
        lines.push(game.i18n.format("FALL.PROBE_FAIL", { roll: probe.total, target: quick }));
      }
    }
    if (meters > 0 && weich) {
      reduced += cfg.MM2_FALL_SOFT_REDUCE;
      lines.push(game.i18n.localize("FALL.SOFT_LINE"));
    }
    meters = Math.max(0, meters - reduced);
    let armorValue = 0;
    let armorText = "0";
    if (meters > 0) {
      if (actor.type === "character") {
        const protPc = String(actor.system?.combat?.protectionPc ?? "0") || "0";
        try {
          const armorRoll = await new Roll(protPc).evaluate();
          rolls.push(armorRoll);
          armorValue = armorRoll.total;
          armorText = protPc;
        } catch (armorError) {
          game.symbaroum.log("MM-Paket 2: Fallschaden-Ruestungsformel", armorError);
          armorValue = 0;
          armorText = protPc;
        }
      } else {
        armorValue = Number(actor.system?.combat?.protectionNpc ?? 0) || 0;
        armorText = String(armorValue);
      }
    }
    const damage = Math.max(0, meters - armorValue);
    lines.push(game.i18n.format("FALL.CHAT_LINE", { name: token?.name ?? actor.name, meter: meters, damage, armor: armorText }));
    if (damage > 0) {
      const damageChange = -(damage);
      await createModifyTokenChatButton([
        { tokenId: token?.id, actorId: actor.id, toughnessChange: damageChange, label: game.i18n.format("FALL.CHAT_LINE", { name: token?.name ?? actor.name, meter: meters, damage, armor: armorText }) },
      ]);
    }
    const title = `<h4>${game.i18n.localize("FALL.CARD_TITLE")}</h4>`;
    await postMaintainChainCard({ actor, actingCharName: actor.name }, title, lines.map((l) => `<p>${l}</p>`), rolls);
    return { meters, damage, armor: armorValue };
  } catch (mm2Error) {
    game.symbaroum.log("MM-Paket 2: Fallschaden", mm2Error);
    return null;
  }
}

/* Kraefte-Paket 1 (Sphaere): Marker-Daten robust lesen - die flagData ist
   ab Paket 1 ein OBJEKT {level, choice} (Aktivierungsdialog-Wahlmodell B);
   Legacy-Marker tragen die nackte Stufenzahl, choice bleibt dann null
   (A16-Verhalten: Substitution nur, wenn Willenskraft hoeher ist). */
export function getSphereMarkerData(actor) {
  const marker = actor?.hasCondition?.("sphere");
  if (!marker) return null;
  const fd = marker.getFlag(game.system.id, "flagData");
  if (fd && typeof fd === "object") {
    return { level: Number(fd.level) || 0, choice: typeof fd.choice === "string" ? fd.choice : null, marker };
  }
  return { level: Number(fd) || 0, choice: null, marker };
}

/* Kraefte-Paket 1 v1.5 (Rudolfs Freigabe 23.11. "Baue v1.5"): Sphaere-
   Marker-Suche ueber die Caster-Marke (flagData.caster) - findet den
   Marker UNABHAENGIG vom Halter (Mystiker selbst oder Meister-Projektion
   auf dem Verbundeten), Muster a29ScanMaintainedPowers. Ausfuhrlich:
   der Kachel-Abbruch und die Toggle-Aufloesung in standardPowerResult
   laufen damit auch, wenn der Verbundete die Sphaere haelt (Testrunde
   v1.4 Punkt 5a). Alte Marker OHNE Caster-Marke (Sessions vor v1.5)
   werden hier nicht gefunden - der SL entfernt sie manuell (dokumen-
   tierte Migration im Auslieferungsdoc). */
export function findSphereMarkerByCaster(casterId) {
  if (!casterId) return null;
  for (const token of canvas.tokens?.placeables ?? []) {
    const tokenActor = token.actor;
    if (!tokenActor) continue;
    for (const effect of tokenActor.effects) {
      const fd = effect.getFlag(game.system.id, "flagData");
      if (typeof fd === "object" && fd?.ability === "sphere" && fd?.caster === casterId) {
        return { tokenActor, effect, flagData: fd };
      }
    }
  }
  return null;
}

/* Kraefte-Paket 1 v1.5: Deaktivierungs-Aufraeumung - entfernt ALLE
   Sphaeren-Marker mit der Caster-Marke des Mystikers in der Szene
   (eigenen hat removeCondition kurz vorher schon weggeraeumt; der
   VERBUENDETEN-Marker ist der eigentliche Fall). Fehler je Loeschung
   werden geloggt und uebersprungen (ein Token-Defekt darf den Rest-
   Abruf nicht blockieren). */
async function removeSphereMarkersByCaster(casterActor) {
  if (!casterActor?.id) return;
  const doomed = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    const tokenActor = token.actor;
    if (!tokenActor) continue;
    for (const effect of [...tokenActor.effects]) {
      const fd = effect.getFlag(game.system.id, "flagData");
      if (typeof fd === "object" && fd?.ability === "sphere" && fd?.caster === casterActor.id) {
        doomed.push([tokenActor, effect]);
      }
    }
  }
  for (const [tokenActor, effect] of doomed) {
    try {
      await tokenActor.deleteEmbeddedDocuments("ActiveEffect", [effect._id ?? effect.id]);
    } catch (sphereRemoveError) {
      game.symbaroum.log("Kraefte-Paket 1 v1.5: Sphaere-Marker-Loeschung", sphereRemoveError);
    }
  }
}

/* Kräfte-Paket 1 v1.6 (Rudolfs Freigabe 24.11.2026 „Baue v1.6“, Nahbereichs-
   Ergänzung): Sphären-Rescan je eigene Runde - Rolle des thornCloakRescan
   (Dornenmantel-Modell, Sphären-Marker-Datenmodell statt Zone). Der Rescan
   läuft NUR über die A29-Erinnerung des Mystikers („Ja“ = Rescan, „Nein“ =
   Abbruch über die bestehende Maschine) - Rudolfs Entscheidungen „genau wie
   beim Dornenmantel“ und „A29-Rescan je eigene Runde“ (rahmenkonform,
   dokumentierte Grenze des Dornenmantel-Modells: KEINE Echtzeit-Reaktion
   auf Bewegung). Prüfung: Chebyshev-Distanz der Token-Zentren (thornCloak-
   TokenCenter, Zellen-Größe mit Gridless-Fallback 100 px - dieselbe
   Mess-Konvention wie die Verbündeten-Auswahl in sphereMasterAllyPlacement).
   Verlässt der VERBÜNDETE den 1,5-Zellen-Nahbereich zum Wirker - Bewegung
   des Verbündeten ODER des Wirkers, je eigene Runde erfasst - verliert er
   den Schutz: Marker räumen (Muster removeSphereMarkersByCaster, je
   Löschung try/catch) plus kleine Ende-Karte (Dornenmantel-Muster, Titel
   CHAT_END_POWER mit Kraftnamen). Kein Auto-Return (Rudolfs Entscheidung):
   Rückkehr in den Nahbereich stellt den Schutz NICHT wieder her, nur
   Neuaktivierung. Betroffen ist nur der Verbündeten-Marker mit Caster-
   Marke; läuft die Sphäre auf dem Mystiker selbst, bleibt die Runde
   still. Wirker ohne Token in der Szene: SL-Urteil, Marker bleiben
   unangetastet. Läuft auf dem GM-Client (direkt aus dem formlosen
   Behalten-Zweig in actor.js oder über den a29SphereRescan-Socket). */
export async function sphereRescanMaintain(actor, powerLabel) {
  try {
    const casterActor = actor;
    if (!casterActor?.id) return;
    const mysticToken = canvas.tokens?.placeables?.find((t) => t.actor?.id === casterActor.id);
    const cellSize = canvas.grid?.sizeX ?? canvas.grid?.w ?? canvas.grid?.size ?? 100;
    const leavers = [];
    const checkDiag = [];
    for (const token of canvas.tokens?.placeables ?? []) {
      const tokenActor = token.actor;
      if (!tokenActor || tokenActor.id === casterActor.id) continue;
      for (const effect of [...tokenActor.effects]) {
        const fd = effect.getFlag(game.system.id, "flagData");
        if (typeof fd !== "object" || fd?.ability !== "sphere" || fd?.caster !== casterActor.id) continue;
        if (!mysticToken) continue;
        try {
          const a = thornCloakTokenCenter(mysticToken);
          const b = thornCloakTokenCenter(token);
          const distCells = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / cellSize;
          checkDiag.push({ name: token.name, distCells });
          if (distCells > 1.5) leavers.push({ tokenActor, effect, name: token.name });
        } catch (measureError) {
          checkDiag.push({ name: token.name, distCells: null });
        }
      }
    }
    game.symbaroum.log("Kräfte-Paket 1 v1.6: Sphären-Rescan (A29-Runde)", {
      mystic: casterActor.name,
      cellSize,
      checked: checkDiag,
      leavers: leavers.map((l) => l.name),
    });
    for (const leaver of leavers) {
      try {
        await leaver.tokenActor.deleteEmbeddedDocuments("ActiveEffect", [leaver.effect._id ?? leaver.effect.id]);
      } catch (sphereRemoveError) {
        game.symbaroum.log("Kraefte-Paket 1 v1.6: Sphaere-Marker-Loeschung nach Nahbereichs-Verlassen", sphereRemoveError);
      }
    }
    if (leavers.length > 0) {
      const label = powerLabel ?? game.i18n.localize("POWER_LABEL.SPHERE");
      const lines = leavers
        .map((leaver) => `<p>${game.i18n.format("POWER_SPHERE.CHAT_END_LEFT_RANGE", { targetname: leaver.name, actorname: casterActor.name })}</p>`)
        .join("");
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: casterActor.id }),
        content: `<div class="symbaroum chat ability"><div class="foreground"><h4>${game.i18n.format("POWER_HYMN.CHAT_END_POWER", { powername: label })}</h4><div class="finalTxt">${lines}</div></div></div>`,
      });
    }
  } catch (sphereRescanError) {
    game.symbaroum.log("Kraefte-Paket 1 v1.6: Sphaeren-Rescan", sphereRescanError);
  }
}

/* Kraefte-Paket 1 (Sphaere-Meister, Rudolfs Entscheidung 7): Verbündeten-
   Sphaere mit Distanz-Gate Nah - gueltige Ziele sind nur Verbündete im
   1-Feld-Abstand zum Mystiker (gemessen in Rasterfeldern). GENAU EIN
   Kandidat => automatische Auswahl; MEHRERE => Auswahl-Dialog (HUD-
   Manual entfaellt); KEIN Kandidat => Marker bleibt auf dem Mystiker
   mit SL-Hinweiskarte. Der Marker traegt Stufe 3 + die Dialog-Wahl. */
async function sphereMasterAllyPlacement(functionStuff) {
  try {
    const mysticToken = functionStuff.token ?? canvas.tokens?.placeables?.find((t) => t.actor?.id === functionStuff.actor.id);
    if (!mysticToken) return;
    /* Kraefte-Paket 1 v1.4 (Rudolfs Baufreigabe 23.11., Testrunde-1-Punkt 8):
       Szenen-UNABHAENGIGE Naehe-Messung. v1.3 mass ueber canvas.grid.
       measureDistance gegen gridDistance*1.5 - das kennt in Rudolfs
       GRIDLESS-Testszene keine Zellen (rohe Szenen-Einheiten) und
       schnitt dadurch JEDES benachbarte Token aus (Fallback-Karte trotz
       direkter Nachbarschaft). Fork-Konvention statt dessen wie
       Zauberstab-Meister v1.6/v1.7 und Dornenmantel-Notfallnaehe
       (thornCloakInMeleeRange): Chebyshev-Distanz der Token-ZENTREN
       (thornCloakTokenCenter, tolerant fuer Placeables UND Documents)
       gegen 1,5 Rasterzellen (gridSize mit Gridless-Fallback 100px) -
       orthogonal (1 Zelle) UND diagonal (~1,41 Zellen) zaehlen, gridded
       wie gridless identisch. Diagnose-Log: gepruefte Distanzen je
       Verbundenem in Zellen landen im game.symbaroum.log. */
    const cellSize = canvas.grid?.sizeX ?? canvas.grid?.w ?? canvas.grid?.size ?? 100;
    const allyDiag = [];
    const candidates = (canvas.tokens?.placeables ?? [])
      .filter((t) => t?.actor && t.id !== mysticToken.id)
      .filter((t) => t.document?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY)
      .filter((t) => {
        try {
          const a = thornCloakTokenCenter(mysticToken);
          const b = thornCloakTokenCenter(t);
          const distCells = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / cellSize;
          allyDiag.push({ name: t.name, distCells });
          return distCells <= 1.5;
        } catch (measureError) {
          allyDiag.push({ name: t.name, distCells: null });
          return false;
        }
      });
    game.symbaroum.log("Kraefte-Paket 1 v1.4: Sphaere-Verbündeten-Kandidaten", {
      mystic: functionStuff.actingCharName,
      cellSize,
      checked: allyDiag,
      candidates: candidates.map((c) => c.name),
    });
    const sphereFlagData = {
      level: 3,
      choice: functionStuff.sphereChoice ?? "resolute",
      /* Kraefte-Paket 1 v1.5: dieselben Maintain-/Caster-Tags wie auf dem
         Mystiker-Marker (Rudolfs Entscheidung 23.11.: Sphaere nimmt am
         Maintain-Reminder + Konzentrations-Maschine teil, "wie Feuerseele") */
      maintained: true,
      caster: functionStuff.actor.id,
      ability: "sphere",
    };
    /* Kein Kandidat: Marker bleibt auf dem Mystiker (SL-Hinweis).
       v1.4: EIGENER Titel (v1.3 verwendete der Fehler-"Sphaere endet"-
       Key, irrefuehrend) PLUS Hint-Zeile, damit die 1,5-Zellen-Bedingung
       auch ohne Auswahl-Dialog sichtbar ist. */
    if (candidates.length === 0) {
      await postMaintainChainCard(
        functionStuff,
        `<h4>${game.i18n.localize("POWER_SPHERE.ALLY_FALLBACK_TITLE")}</h4>`,
        [
          `<p>${game.i18n.format("POWER_SPHERE.CHAT_ALLY_FALLBACK", { actorname: functionStuff.actingCharName })}</p>`,
          `<p>${game.i18n.localize("POWER_SPHERE.ALLY_SELECT_HINT")}</p>`,
        ],
        []
      );
      return;
    }
    let chosen = candidates[0];
    if (candidates.length > 1) {
      chosen = await new Promise((resolve) => {
        const allyOptions = candidates
          .map(
            (c, idx) =>
              `<label class="lblfavour"><input type="radio" name="sphere-ally" value="${c.id}"${idx === 0 ? " checked" : ""}> ${c.name}</label>`
          )
          .join(" ");
        symbDialog({
          title: game.i18n.localize("POWER_SPHERE.ALLY_SELECT_TITLE"),
          /* Kraefte-Paket 1 v1.4 (Rudolfs Testrunde v1.3 Punkt 6/8):
             dialog im MODERNEN Design, wenn Modern-Design aktiv (Muster
             wie die anderen System-Dialoge via modernDialogClasses) */
          classes: isModernDialogActive() ? modernDialogClasses("modern-sphere-ally-dialog") : [],
          content: `<p>${game.i18n.localize("POWER_SPHERE.ALLY_SELECT_HINT")}</p><div class="favour">${allyOptions}</div>`,
          buttons: {
            ok: {
              icon: '<i class="fas fa-check"></i>',
              label: game.i18n.localize("BUTTON.CONFIRM"),
              callback: (html) => {
                const picked = html?.[0]?.querySelector('input[name="sphere-ally"]:checked')?.value;
                resolve(candidates.find((c) => c.id === picked) ?? null);
              },
            },
            cancel: {
              icon: '<i class="fas fa-times"></i>',
              label: game.i18n.localize("BUTTON.CANCEL"),
              callback: () => resolve(null),
            },
          },
          default: "ok",
        });
      });
      if (!chosen) return;
    }
    /* Kräfte-Paket 1 v1.7 (Rudolfs Freigabe 24.11.2026, Vault-RAW-Abgleich):
       Dornenmantel-Modell - der Mystiker BEHÄLT seinen eigenen Sphären-
       Marker (eigner Schutz, Vault-Notiz Sphäre-Meister: „ohne die Waffe zu
       berühren ... Verbündeten in die Sphäre einschließen", die Hände frei;
       nirgends verliert der Mystiker seine Sphäre - das v1.3-„statt"-Modell
       war die unbemerkte Abweichung und erzeugte über das ungetaggte
       13768er-Restsymbol den halbgeräumten Zustand aus Testrunde v1.6
       Punkt 7). Der VERBÜNDETE bekommt seinen getaggten Marker ZUSÄTZLICH;
       kein Löschen/Verschieben des Mystiker-Markers mehr. Der A29-Rescan
       (v1.6) räumt bei Nahbereichs-Verlassen nur den Verbündeten-Marker,
       der Mystiker-Marker bleibt - „kein Rejoin" (Rudolfs Ausnahme zum
       Dornenmantel): Neue Projektion nur per Neuaktivierung. */
    await chosen.actor.addCondition("sphere", { ...sphereFlagData });
    await postMaintainChainCard(
      functionStuff,
      `<h4>${game.i18n.localize("POWER_SPHERE.CHAT_ALLY_TITLE")}</h4>`,
      [`<p>${game.i18n.format("POWER_SPHERE.CHAT_ALLY_CHOSEN", { targetname: chosen.name, actorname: functionStuff.actingCharName })}</p>`],
      []
    );
  } catch (sphereAllyError) {
    game.symbaroum.log("Kraefte-Paket 1: Sphaere-Verbündetenwahl", sphereAllyError);
  }
}

/* SL-Reset-Karte für die 1×/Szene-Verwaltung (dokumentierte Szenen-
   Grenze, Epilepsie-Präzedenz): geflüsterte GM-Karte mit Button, der
   hymnMasterScene UND trollRerollScene des Sängers freigibt (Hooks-
   Handler in hooks.js, GM-only). */
async function postTrollSceneResetCard(functionStuff) {
  const html = `<div class="symbaroum chat ability">
    <div class="foreground">
      <h4>${game.i18n.localize("POWER_HYMN.SCENE_RESET_TITLE")}</h4>
      <div class="finalTxt"><p>${game.i18n.format("POWER_HYMN.SCENE_RESET_LINE", { actorname: functionStuff.actingCharName })}</p></div>
      <p><button id="trollSceneResetButton">${game.i18n.localize("POWER_HYMN.SCENE_RESET_BUTTON")}</button></p>
    </div>
  </div>`;
  const gmList = ChatMessage.getWhisperRecipients("GM");
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: functionStuff.actor.id }),
    content: html,
    whisper: gmList.length > 0 ? gmList : undefined,
    flags: { [game.system.id]: { trollSceneReset: { actorId: functionStuff.actor.id } } },
  });
}

/* Runden-Schlüssel der Runden-Frequenz (Adept): aktiver Kampf = Kampf-
   Runde, sonst Weltzeit-Takt aus dem dotWorldTimeRoundMinutes-Setting.
   Ohne jeden Takt (Setting 0, kein Kampf) gilt null = SL-Urteil
   (dokumentierte Grenze, Rudolfs Entscheidung 9). */
function trollRerollRoundKey() {
  if (game.combat?.active && game.combat.round > 0) return "c" + game.combat.round;
  const minutes = Number(game.settings.get("symbaroum", "dotWorldTimeRoundMinutes")) || 0;
  if (minutes > 0) return "w" + Math.floor(game.time.worldTime / (minutes * 60));
  return null;
}

function trollRerollFrequencyFree(actor, level) {
  if (level >= 3) return true;
  if (level === 2) {
    const key = trollRerollRoundKey();
    if (key === null) return true;
    return actor.getFlag(game.system.id, "trollRerollRound") !== key;
  }
  return actor.getFlag(game.system.id, "trollRerollScene") !== true;
}

/* Eligibility + Payload der Wiederholungsprobe: nur fehlgeschlagene
   resolute-Resist-Proben eines Sängers mit Trollsingen; der Payload
   ist die bereinigte functionStuff-Kopie (resistRoll-Muster: Dokument-
   Referenzen genullt), Kosten bereits bezahlt (TEMPCORRUPTION_NONE).
   Novize: KEIN Reroll in Ketten-Gliedern oder Maintain-Runden. */
function trollRerollPayload(functionStuff, rollData) {
  const roll = rollData?.[0];
  if (!roll || roll.trueActorSucceeded !== false) return null;
  if (functionStuff.targetData?.resistAttributeName !== "resolute") return null;
  if (functionStuff.zoneActivation) return null;
  const level = getActorAbilityLevel(functionStuff.actor, "trollsinging");
  if (level < 1) return null;
  if (level === 1 && (functionStuff.chain === game.symbaroum.config.CHAIN || functionStuff.isMaintained)) return null;
  if (!trollRerollFrequencyFree(functionStuff.actor, level)) return null;
  const emitData = Object.assign({}, functionStuff);
  emitData.actor = null;
  emitData.token = null;
  emitData.targetData = Object.assign({}, functionStuff.targetData);
  emitData.targetData.token = null;
  emitData.targetData.actor = null;
  emitData.trollRerollPayload = null;
  emitData.trollRerollLevel = level;
  emitData.corruption = game.symbaroum.config.TEMPCORRUPTION_NONE;
  return emitData;
}

/* Klick auf die Reroll-Taste (hooks.js-Handler): Frequenz-Verbrauch
   NUR hier (Novize trollRerollScene, Adept trollRerollRound mit
   aktuellem Schlüssel, Meister ohne Verbrauch), dann der reguläre
   buildRolls-Lauf mit dem restaurierten functionStuff. */
export async function trollRerollInvoke(functionStuff) {
  const level = functionStuff.trollRerollLevel ?? 1;
  if (level === 1) {
    await functionStuff.actor.setFlag(game.system.id, "trollRerollScene", true);
  } else if (level === 2) {
    const key = trollRerollRoundKey();
    if (key !== null) await functionStuff.actor.setFlag(game.system.id, "trollRerollRound", key);
  }
  await buildRolls(functionStuff);
}

/* Kräfte-Paket 1 (Anhang, Rudolfs Baufreigabe 21.11.) — Illusorische
   Korrektur (Novize, reference "illusorycorrection" im Base-Pack
   verifiziert): eine misslungene eigene Verteidigungsprobe darf 1x
   pro Runde wiederholt werden, gegen eine Willenskraft-Probe (1W20
   <= Willenskraft, pur ohne Gunst/Modifikator - RAW nennt keine).
   Praezedenz Trollsingen-Reroll: v1 hing eine TASTE an die Ergebniskarte
   des Verteidigungswurfs; v1.3 (Rudolfs Entscheidung 3, Auswahlrunde 2)
   oeffnet stattdessen DIREKT den Aktivierungs-DIALOG (Je-neu-Entscheidung
   je misslungene Verteidigung). Der Konsum der Runden-Frequenz erfolgt
   ERST im invoke (dort auch erneut geprueft), 1x/Runde nach dem
   Runden-Schluessel-Modell wie Trollsingen (Troll-RerollRoundKey:
   aktiver Kampf = Kampfrunde, sonst Weltzeit-Takt, null = SL-Urteil mit
   dokumentierter Grenze). */
function illusoryCorrectionFrequencyFree(actor) {
  const key = trollRerollRoundKey();
  if (key !== null && actor.getFlag(game.system.id, "illusoryCorrectionRound") === key) return false;
  return true;
}

/* Eligibility + Payload: NUR im Verteidigungswurf-Fluss (resistRoll =
   true, d.h. NSC-Angriff auf SC-Ziel mit aktiver Verteidigung - dialog.js
   setzt das Flag) und NUR wenn die Verteidigung misslang (Perspektiv-
   Dreh: trueActorSucceeded === true bedeutet im resistRoll-Fluss, dass
   der Angreiffer durchdrang). Der statisch verteidigte Angriffs-Wurf
   (SC-Angreifer, kein Verteidigungswurf) ist bewusst AUSSEN vor -
   dort gibt es keine eigene Verteidigungsprobe, SL-Sache (offener
   Punkt fuer das Auslieferungsdoc). */
function illusoryCorrectionPayload(functionStuff, rollData) {
  const roll = rollData?.[0];
  if (!functionStuff.resistRoll || !roll || roll.trueActorSucceeded !== true) return null;
  const defenderActor = functionStuff.targetData?.actor;
  if (!defenderActor) return null;
  const level = getActorAbilityLevel(defenderActor, "illusorycorrection");
  if (level < 1) return null;
  if (!illusoryCorrectionFrequencyFree(defenderActor)) return null;
  const emitData = Object.assign({}, functionStuff);
  /* v1.3: Der Aktivierungs-Dialog laeuft IM PROZESS (keine Serialisierung
     ueber ein Chat-Flag mehr wie bei der v1-Taste) - die Dokument-
     Referenzen im Payload koennen daher LIVE bleiben, das invoke braucht
     keine Rekonstruktion. */
  emitData.illusoryCorrectionPayload = null;
  // Die Illusion gehoert dem VERTEIDIGER (targetData), nicht dem Wuerfelnden
  emitData.illusoryCorrectionDefenderId = defenderActor.id;
  return emitData;
}

/* Aktivierung der Korrektur (v1.3: aufgerufen aus dem Aktivierungs-
   Dialog, offIllusoryCorrectionDialog; v1.3 kostet jede Aktivierung
   zusaetzlich 1W4 temporaere Korruption - Rudolfs Entscheidungen 1+2,
   "immer buchen", Schutzrunen-Muster): Frequenz-Verbrauch hier
   (Runden-Schluessel bzw. "manual" ohne Takt), nochmaliger Frequenz-
   Gate gegen Parallel-Karten, dann die Korruptionsbuchung, die
   Willenskraft-Probe als eigene Karte und bei Erfolg der reguläre
   buildRolls-Lauf (= komplette Wiederholung der Verteidigung, Schaden/
   Kosten wie im Original-Lauf). Bei Misslingen bleibt es beim
   urspruenglichen Ergebnis, die Frequenz ist verbraucht. */
export async function illusoryCorrectionInvoke(payload) {
  const defenderActor =
    game.actors.get(payload.illusoryCorrectionDefenderId) ??
    canvas.tokens?.placeables?.find((t) => t.actor?.id === payload.illusoryCorrectionDefenderId)?.actor ??
    null;
  if (!defenderActor) return;
  if (!illusoryCorrectionFrequencyFree(defenderActor)) {
    ui.notifications.warn(game.i18n.localize("POWER_ILLUSORYCORRECTION.WARN_SPENT"));
    return;
  }
  const key = trollRerollRoundKey();
  await defenderActor.setFlag(game.system.id, "illusoryCorrectionRound", key ?? "manual");
  /* Kräfte-Paket 1 v1.3 (Rudolfs Entscheidungen 1+2, Auswahlrunde 2:
     "immer buchen", Schutzrunen-Muster): Jede Aktivierung kostet 1W4
     temporaere Korruption, ergebnisunabhaengig gebucht (Probeerfolg UND
     -misserfolg), ein eigener Wurf, Buchung ueber die GM-Anwenden-Karte
     am Verteidiger-Token (Bewusst RAW-abweichend - RAW kostet die Kraft
     nichts pro Nutzung). */
  const corruptionRoll = await new Roll("1d4").evaluate();
  const corruptionEntry = { corruptionChange: corruptionRoll.total };
  if (payload.targetData?.tokenId) corruptionEntry.tokenId = payload.targetData.tokenId;
  else corruptionEntry.actorId = defenderActor.id;
  await createModifyTokenChatButton([corruptionEntry]);
  const target = getAttributeValue(defenderActor, "resolute");
  const probe = await new Roll("1d20").evaluate();
  await probe.toMessage({
    speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: defenderActor.id }),
    flavor:
      `<div class="symbaroum chat ability"><div class="foreground">` +
      `<h4>${game.i18n.localize("POWER_ILLUSORYCORRECTION.CHAT_PROBE_TITLE")}</h4>` +
      `<div class="finalTxt"><p>` +
      (probe.total <= target
        ? game.i18n.format("POWER_ILLUSORYCORRECTION.CHAT_PROBE_SUCCESS", { actorname: defenderActor.name })
        : game.i18n.format("POWER_ILLUSORYCORRECTION.CHAT_PROBE_FAIL", {
            actorname: defenderActor.name,
            roll: probe.total,
            target: target,
          })) +
      `</p></div></div></div>`,
  });
  if (probe.total <= target) {
    await buildRolls(payload);
  }
}

/* Kräfte-Paket 1 v1.3 (Rudolfs Entscheidung 3, Auswahlrunde 2): Statt
   der v1-Reroll-Taste auf der Ergebniskarte öffnet sich nach der
   misslungenen Verteidigung DIREKT der Aktivierungs-Dialog (Je-neu-
   Entscheidung je misslungene Verteidigung, 1x/Runde-Frequenz prueft
   und verbraucht erst das invoke). Bei Ja: Frequenzverbrauch +
   1W4-Korruptionsbuchung + Willenskraft-Probe PUR als Karte, bei
   Probeerfolg komplette Wiederholung der Verteidigung (siehe
   illusoryCorrectionInvoke); bei Nein bleibt alles unverändert und die
   Frequenz unangetastet. Der Dialog öffnet auf dem auswertenden Client
   (GM-Standard bei NSC-Angriffen); Eigentums-Check wie beim v1-Handler
   (GM darf immer, sonst nur der Verteidiger-Besitzer). */
export function openIllusoryCorrectionDialog(payload) {
  const defenderActor =
    game.actors.get(payload.illusoryCorrectionDefenderId) ??
    canvas.tokens?.placeables?.find((t) => t.actor?.id === payload.illusoryCorrectionDefenderId)?.actor ??
    null;
  if (!defenderActor) return;
  if (!game.user.isGM && !defenderActor.isOwner) return;
  symbDialog({
    title: game.i18n.localize("POWER_ILLUSORYCORRECTION.DIALOG_TITLE"),
    /* Kraefte-Paket 1 v1.4 (Rudolfs Testrunde v1.3 Punkt 6): Aktivierungs-
       Dialog im MODERNEN Design, wenn Modern-Design aktiv (Muster wie die
       anderen System-Dialoge via modernDialogClasses) */
    classes: isModernDialogActive() ? modernDialogClasses("modern-illusorycorrection-dialog") : [],
    content: `<p>${game.i18n.format("POWER_ILLUSORYCORRECTION.DIALOG_HINT", { actorname: defenderActor.name })}</p>`,
    buttons: {
      ok: {
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize("BUTTON.CONFIRM"),
        callback: async () => {
          await illusoryCorrectionInvoke(payload);
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("BUTTON.CANCEL"),
      },
    },
    default: "cancel",
  });
}

/* v2.12 (Rudolfs Freigabe 15.11., Gruppe C) — Fegefeuer (APG Theurgie),
   Novize/Adept: keine Mystiker-Probe, der Mystiker zwingt die Opfer zum
   Wurf. je Ziel 1W20 gegen die GESAMTKORRUPTION (temporary + longterm +
   permanent): bei Wurf <= Korruption akute Schmerzen, das Ziel ist eine
   volle Runde handlungsunfähig (Stun-Symbol über die GM-Apply-Karte, endet
   mit dem Zug des Ziels - A34-Muster wie der Brennglas-Stun); völlig
   verdorbene Kreaturen (isThoroughlyCorruptTarget inkl. Abso.-Fallback)
   erleiden stattdessen automatisch 1W6 Schaden, Rüstung ignoriert. Novize =
   Einzelziel; Adept = alle Feinde in Sichtweite: manuell als Frisch-Zielen-
   Kette (Muster priosBurningGlassResult), als Sweep-Zone dialogfrei über
   zoneChainTargets (Zone = Sichtweiten-Abstraktion, Rudolfs Festlegung
   13.11.). Kein Zauberer-Vorteil/Modifikator im Zonen-Batch (execute-
   ZonePower stellt das ein). */
/* AoE-Rest Paket 1 (Rudolfs Startsignal „Baue es“ 18.11.2026, RAW:
   Flammenwand, Wizardry): Die Kraft erschafft die dauerhafte Kraft-Zone
   (Ausnahme-Regelwerk in aoe.js, Weg b), KEINE Zauberprobe (CASTING_NOT)
   - standardPowerResult bucht nur die Korruption via A16-Engine und
   postet die Aktivierungskarte (rollData darf null sein, Erfolg gilt).
   Der Schaden 1W12 FEUER laeuft hier selbst je Opfer (deswegen setzt
   das Setup KEIN hasDamage): Aktivierung (Anfangsbestand, stehende
   Tokens im Ring - _executeZoneTrigger feuert placeZoneFromItem einmal)
   und jede Enter-Ausloesung laufen dialogfrei im Zonen-Batch (v1.1,
   Rudolfs Testrunde 1, P2a: deterministische Kette uber zoneChainTargets-
   Ids plus offene User-Markierungen, NIE ein Kettendialog). Feuergeschmiedet
   (damageType.fire), Schmerz (Schwelle) als prone-Symbol, Tod wie im
   standardPowerResult-Muster (Kampfteilnehmer defeated, sonst dead-
   Overlay), Summary ueber postMaintainChainCard + GM-Apply-Karte. */
async function flamewallResult(rollData, functionStuff) {
  await standardPowerResult(rollData, functionStuff);
  const rolls = [];
  const lines = [];
  const flagDataArray = [];
  const handled = new Set();
  const applyFlamewall = async (token) => {
    if (!token?.actor) return;
    handled.add(token.id);
    const victim = token.actor;
    const damageRoll = await new Roll("1d12").evaluate();
    rolls.push(damageRoll);
    const finalDmg = await mathDamageProt(victim, damageRoll.total, { fire: true });
    const damageTot = finalDmg.damage;
    // Kraefte-Paket 1 (Feuerseele-Meister): Feuerschaden wird zu Heilung
    if (finalDmg.firesoulHeal > 0) {
      flagDataArray.push({ tokenId: token.id, toughnessChange: finalDmg.firesoulHeal });
    }
    lines.push(
      `<p>${game.i18n.format("POWER_FLAMEWALL.CHAT_DAMAGE", { targetname: token.name, count: damageRoll.total })}${finalDmg.text}</p>`
    );
    if (damageTot <= 0) return;
    const targetToughness = victim.system?.health?.toughness?.value;
    const threshold = victim.system?.health?.toughness?.threshold;
    if (targetToughness !== undefined && damageTot >= targetToughness) {
      if (ui.combat.viewed && (ui.combat.viewed.getCombatantsByToken(token.id) ?? []).length > 0) {
        flagDataArray.push({ tokenId: token.id, defeated: true });
      } else {
        flagDataArray.push({
          tokenId: token.id,
          addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "dead")),
          overlay: true,
          effectDuration: 1,
        });
      }
    } else if (threshold !== undefined && damageTot > threshold) {
      flagDataArray.push({
        tokenId: token.id,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "prone")),
        effectDuration: 1,
      });
    }
    flagDataArray.push({ tokenId: token.id, toughnessChange: -1 * damageTot });
  };
  // Primärziel (manuell markiert bzw. Zonen-Batch: erstes Auto-Ziel)
  const primaryToken = functionStuff.targetData?.hasTarget
    ? canvas.tokens?.placeables?.find((t) => t.id === functionStuff.targetData.tokenId) ?? null
    : null;
  if (primaryToken) {
    await applyFlamewall(primaryToken);
  }
  // v1.1 (Rudolfs Testrunde 1, P2a): Die Flammenwand-Kette laeuft IMMER
  // dialogfrei und deterministisch - Primärziel, dann alle zoneChainTargets-
  // Ids (Zonen-Batch, Reihenfolge wie geliefert), dann zusätzlich noch
  // manuell markierte User-Ziele. NIE glyphNextTargetConfirmation: die
  // Ausloesung endet nach dem Wuerfeldialog/Wurf, kein Kettendialog.
  for (const tokenId of functionStuff?.zoneChainTargets ?? []) {
    if (handled.has(tokenId)) continue;
    const token = canvas.tokens?.placeables?.find((t) => t.id === tokenId) ?? null;
    if (token) await applyFlamewall(token);
  }
  for (const token of Array.from(game.user.targets)) {
    if (handled.has(token.id)) continue;
    await applyFlamewall(token);
  }
  if (lines.length > 0) {
    const title = `<h4>${game.i18n.format("POWER_FLAMEWALL.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
    await postMaintainChainCard(functionStuff, title, lines, rolls);
  }
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
}

async function purgatoryResult(rollData, functionStuff) {
  // Aktionskarte (CASTING_NOT) mit den Korruptionskosten des Wirkens
  await standardPowerResult(rollData, functionStuff);
  const rolls = [];
  const lines = [];
  const flagDataArray = [];
  const handled = new Set();
  const applyPurgatory = async (token) => {
    if (!token?.actor) return;
    handled.add(token.id);
    const victim = token.actor;
    const corr = victim.system?.health?.corruption;
    const totalCorruption = corr ? Number(corr.temporary ?? 0) + Number(corr.longterm ?? 0) + Number(corr.permanent ?? 0) : 0;
    if (game.symbaroum.config.isThoroughlyCorruptTarget(victim)) {
      const damageRoll = await new Roll("1d6").evaluate();
      rolls.push(damageRoll);
      lines.push(`<p>${game.i18n.format("POWER_PURGATORY.CHAT_DAMAGE", { targetname: token.name, count: damageRoll.total })}</p>`);
      flagDataArray.push({ tokenId: token.id, toughnessChange: -1 * damageRoll.total });
      // Getötet-Prüfung wie Heilige-Aura-Loop (A25 F9/F11-Muster)
      const targetToughness = victim.system?.health?.toughness?.value;
      if (targetToughness !== undefined && damageRoll.total >= targetToughness) {
        if (ui.combat.viewed && (ui.combat.viewed.getCombatantsByToken(token.id) ?? []).length > 0) {
          flagDataArray.push({ tokenId: token.id, defeated: true });
        }
      }
      return;
    }
    const forcedRoll = await new Roll("1d20").evaluate();
    rolls.push(forcedRoll);
    if (forcedRoll.total <= totalCorruption) {
      lines.push(`<p>${game.i18n.format("POWER_PURGATORY.CHAT_PAIN", { targetname: token.name, roll: forcedRoll.total, corruption: totalCorruption })}</p>`);
      flagDataArray.push({
        tokenId: token.id,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "stun")),
        effectDuration: 1,
        turnEnd: true,
        casterId: functionStuff.actor.id,
        abilityRef: functionStuff.ability?.reference,
        casterResolute: getAttributeValue(functionStuff.actor, "resolute"),
        casterName: functionStuff.actingCharName,
      });
    } else {
      lines.push(`<p>${game.i18n.format("POWER_PURGATORY.CHAT_RESISTED", { targetname: token.name, roll: forcedRoll.total, corruption: totalCorruption })}</p>`);
    }
  };
  // Primärziel (manuell markiert bzw. Zonen-Batch: erstes Auto-Ziel)
  const primaryToken = functionStuff.targetData?.hasTarget ? canvas.tokens?.placeables?.find((t) => t.id === functionStuff.targetData.tokenId) ?? null : null;
  if (primaryToken) {
    await applyPurgatory(primaryToken);
  }
  // Adept: Kette über frisch markierte Ziele; Novize bleibt Einzelziel
  // (Zonen-Batch degeneriert analog aufs Primärziel, Gruppen-B-Muster)
  while (
    functionStuff.powerLvl.level > 1 &&
    !zoneChainDone(functionStuff, handled) &&
    (await zoneChainContinue(functionStuff, "POWER_PURGATORY.CHAT_NEXT_TARGET"))
  ) {
    const nextToken = Array.from(game.user.targets).find((token) => !handled.has(token.id));
    if (!nextToken) {
      ui.notifications.warn(game.i18n.localize("POWER_PURGATORY.CHAT_NO_NEW_TARGET"));
      break;
    }
    await applyPurgatory(nextToken);
  }
  if (lines.length > 0) {
    const title = `<h4>${game.i18n.format("POWER_PURGATORY.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
    await postMaintainChainCard(functionStuff, title, lines, rolls);
  }
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
}

/* v2.12 — Fegefeuer MEISTER (APG): Reaktion, keine Probe. Die Aktivierung
   setzt das purgatory-Symbol auf den Mystiker-Token (GM-Apply-Karte) - das
   Markiert die reaktive Aura: jeder FEINDLICHE Korruptionsempfänger in
   Sichtweite erleidet denselben Betrag als körperlichen Schaden (Rüstung
   ignoriert), gebucht über applyCorruptionMasterReactions (unten), das
   an den beiden System-Auslieferungspunkten der Korruption hängt (GM-
   Apply-Karte in hooks.js + Bestätigungs-Dialog in buildRolls). Die SL
   entfernt das Symbol, um die Aura zu deaktivieren (RAW nennt keine
   Dauer); die Näherung "Korruption durch Kräfte/Artefakte" = jede
   System-Korruptionsbuchung, der Rest bleibt SL-Urteil. */
async function purgatoryMasterResult(rollData, functionStuff) {
  await standardPowerResult(rollData, functionStuff);
  const tokenId = functionStuff.tokenId ?? functionStuff.token?.id ?? null;
  if (!tokenId) return;
  await createModifyTokenChatButton([
    {
      tokenId,
      addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "purgatory")),
      casterId: functionStuff.actor.id,
      abilityRef: functionStuff.ability?.reference,
      casterResolute: getAttributeValue(functionStuff.actor, "resolute"),
      casterName: functionStuff.actingCharName,
    },
  ]);
}

/* v2.12 — Lebensspender (APG Theurgie), Novize/Adept: keine Probe (RAW
   nennt keine). je Ziel 1W4: temporäre Korruption abwaschen (nie unter 0,
   negative Klemmung wie im GM-Apply-Pfad), alle überschüssigen Punkte
   heilen stattdessen Zähigkeit (GM-Apply-Karte: corruptionChange negativ +
   toughnessChange positiv). Novize: EIN Ziel in Sichtweite, ohne Marke
   wirkt die Kraft auf den Mystiker selbst (RAW "auch auf sich selbst").
   Adept: selbst + alle Verbündeten in Sichtweite (selbst automatisch,
   Verbündete über Frisch-Zielen-Kette; als Sweep-Zone mit Filter
   'Verbündete' dialogfrei über zoneChainTargets). Kein Dispositions-
   Zwangsfilter - die Markierung ist die Spielerentscheidung, die SL
   wacht wie bei den Glyphen-Schleifen. */
async function lifegiverResult(rollData, functionStuff) {
  await standardPowerResult(rollData, functionStuff);
  const rolls = [];
  const lines = [];
  const flagDataArray = [];
  const handled = new Set();
  const washCorruption = async (token) => {
    if (!token?.actor) return;
    handled.add(token.id);
    const corr = token.actor.system?.health?.corruption;
    if (!corr) return;
    const washRoll = await new Roll("1d4").evaluate();
    rolls.push(washRoll);
    const temp = Math.max(0, Number(corr.temporary ?? 0));
    const washed = Math.min(washRoll.total, temp);
    const overflow = washRoll.total - washed;
    if (washed > 0) {
      flagDataArray.push({ tokenId: token.id, corruptionChange: -washed });
    }
    lines.push(`<p>${game.i18n.format("POWER_LIFEGIVER.CHAT_WASH", { targetname: token.name, count: washed, dice: washRoll.total })}</p>`);
    if (overflow > 0) {
      flagDataArray.push({ tokenId: token.id, toughnessChange: overflow });
      lines.push(`<p>${game.i18n.format("POWER_LIFEGIVER.CHAT_OVERFLOW", { targetname: token.name, count: overflow })}</p>`);
    }
  };
  const selfToken = functionStuff.token ?? canvas.tokens?.placeables?.find((t) => t.id === functionStuff.tokenId) ?? null;
  const primaryToken = functionStuff.targetData?.hasTarget ? canvas.tokens?.placeables?.find((t) => t.id === functionStuff.targetData.tokenId) ?? null : null;
  // Adept: selbst immer; Novize: nur selbst, OHNE markiertes Ziel
  if (selfToken && (functionStuff.powerLvl.level > 1 || !primaryToken)) {
    await washCorruption(selfToken);
  }
  if (primaryToken && !handled.has(primaryToken.id)) {
    await washCorruption(primaryToken);
  }
  // Adept: weitere Verbündete über frisch markierte Ziele
  while (
    functionStuff.powerLvl.level > 1 &&
    !zoneChainDone(functionStuff, handled) &&
    (await zoneChainContinue(functionStuff, "POWER_LIFEGIVER.CHAT_NEXT_ALLY"))
  ) {
    const nextToken = Array.from(game.user.targets).find((token) => !handled.has(token.id));
    if (!nextToken) {
      ui.notifications.warn(game.i18n.localize("POWER_LIFEGIVER.CHAT_NO_NEW_TARGET"));
      break;
    }
    await washCorruption(nextToken);
  }
  if (lines.length > 0) {
    const title = `<h4>${game.i18n.format("POWER_LIFEGIVER.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
    await postMaintainChainCard(functionStuff, title, lines, rolls);
  }
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
}

/* v2.12 — Lebensspender MEISTER (APG): Reaktion, keine Probe, keine
   Ziele. Die Aktivierung setzt das lifegiver-Symbol auf den Mystiker-
   Token - die passive Aura reduziert jede System-Korruptionsbuchung
   FREUNDLICHER Verbündeter in Sichtweite um 1W4 (applyCorruptionMaster-
   Reactions unten), nie aber die des Mystikers selbst (RAW). SL entfernt
   das Symbol zum Deaktivieren. */
async function lifegiverMasterResult(rollData, functionStuff) {
  await standardPowerResult(rollData, functionStuff);
  const tokenId = functionStuff.tokenId ?? functionStuff.token?.id ?? null;
  if (!tokenId) return;
  await createModifyTokenChatButton([
    {
      tokenId,
      addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "lifegiver")),
      casterId: functionStuff.actor.id,
      abilityRef: functionStuff.ability?.reference,
      casterResolute: getAttributeValue(functionStuff.actor, "resolute"),
      casterName: functionStuff.actingCharName,
    },
  ]);
}

/* v2.12 — Unheilige Aura (GRW Zauberei), Adept-Ausschluss-Bestätigung:
   RAW "kann lebende Verbündete ausschließen" - je verbündetem Opfer fragt
   der Dialog, ob es in die Aura eingeschlossen wird; Default NEIN
   (ausschließen), Muster priosStunConfirmation. */
function unholyAllyIncludeConfirmation(functionStuff, targetname) {
  return new Promise((resolve) => {
    symbDialog({
      title: functionStuff.abilityName,
      classes: ["chain-confirm", ...(isModernDialogActive() ? modernDialogClasses("modern-chain-confirm-dialog") : [])],
      content: `<div class="symbaroum dialog"><p class="lblfavour">${game.i18n.format(game.i18n.localize("POWER_UNHOLYAURA.ALLY_QUESTION"), { targetname })}</p></div>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("BUTTON.YES"),
          callback: () => resolve(true),
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.NO"),
          callback: () => resolve(false),
        },
      },
      default: "no",
    });
  });
}

/* v2.12 — Unheilige Aura (GRW Zauberei): 1:1-Spiegel der Heiligen Aura
   (A36-Verbraucher-Muster). Standard-Karte: Resolute-Probe, Korruption,
   Maintain-Symbol auf dem Wirker (unholyaura). Maintain-Runde: gescheiterte
   Probe räumt alle Aura-Symbole (unholyAuraEndCleanup). Loop 1 (jede
   Stufe): je frisch markiertem Opfer Kategorie-Filter KULTURWESEN oder
   BESTIE (Freund UND Feind - Novize schadet ausdrücklich Verbündete mit,
   Adept+ fragt je Verbündetem die Ausschluss-Bestätigung, Default Nein),
   dann die Resist-Chance gegen die gesnapshottete Willenskraft des
   Mystikers (Ein-Wurf-Modell 1W20 <= Opfer-Resolute + 10 - Mystiker-
   Resolute, identisch Heilige Aura): widerstanden -> nur Schadenssymbol
   mit Resist-Marke (A28-Engine tickt je Opfer-Zug), sonst sofortiger
   Schaden 1W6/1W8 (Rüstung ignoriert, GM-Apply-Karte mit A25-F9-Sterbe-
   Feedback) plus Schadenssymbol. Loop 2 (Meister): je frisch markiertem
   verbündeten ABSCHEULICHKEIT/UNTOTEN ODER (v2.13, Rudolfs Entscheidung)
   VÖLLIG VERDORBENEN (Korruption >= max) das Regenerations-DOT 1W8
   Zähigkeit (Heilige-Aura-Loop-2-Muster, OHNE deren Korruptionsgebühr -
   RAW nennt keine) PLUS (v2.13, P10a/P13) eine SOFORT-Heilung bei
   Aufnahme. Zusammenfassung auf einer eigenen Karte (postMaintainChainCard). */
async function unholyAuraResult(rollData, functionStuff) {
  const succeeded = rollData?.[0]?.trueActorSucceeded !== false;
  // Standard-Karte: Probe, Korruption, Maintain-Symbol des Wirkers
  await standardPowerResult(rollData, functionStuff);
  if (functionStuff.isMaintained) {
    // v2 F9: Maintain-Runde - Erfolg zieht Joiner/Leaver nach (auraZone-
    // Rescan, Hymnen-Modell), Fehlschlag beendet die Aura samt Region
    if (!succeeded) {
      await unholyAuraEndCleanup(functionStuff);
    } else {
      await auraZoneRescan(functionStuff);
    }
    return;
  }
  if (!succeeded) {
    // gescheitertes erstes Wirken: keine Aura (Neuversuch erlaubt - die
    // Szenen-Sperre der Heiligen Aura war ein A36V-Testrunden-Beschluss
    // für DIESE Kraft, RAW schreibt sie hier nicht)
    ui.notifications.warn(game.i18n.localize("POWER_UNHOLYAURA.CHAT_FAILED_CAST"));
    return;
  }
  /* v2 F9: siehe Heilige Aura - Erstaktivierung durch Platzieren, die
     Bestands-Loops laufen dialogfrei als Zonen-Batch ueber die
     Regions-Token (Kategorie-Filter unterhalb der Geometrie). */
  /* v2.8 F39: Heilige-Aura-Zwilling - identischer Frame-Aufruf mit
     unholyaura (Twin-Funktionen, identische Bloecke). */
  const auraFrame = await zoneErstgesangFrame(functionStuff, {
    refs: ["unholyaura"],
    flagPrefix: "aurazone",
    flagLabel: "Auren-Flag",
    placeRegion: (frameCasterToken) =>
      placeAuraZone(frameCasterToken, functionStuff.actor, "unholyaura", functionStuff.ability),
  });
  if (auraFrame?.region) {
    functionStuff.zoneChainTargets = new Set(auraFrame.zoneIds);
    for (const auraZoneId of auraFrame.zoneIds) {
      const auraZoneToken = canvas.tokens?.placeables?.find((t) => t.id === auraZoneId);
      if (auraZoneToken) {
        try {
          auraZoneToken.setTarget(true, { releaseOthers: false });
        } catch (auraTargetError) {
          /* Ziel-Markierung nur Kosmetik fuer die Batch-Loops */
        }
      }
    }
  }
  const flagDataArray = [];
  const auraRolls = [];
  const lines = [];
  // v2.16 (Rudolfs Testrunde 15, N2-Entscheidung): Skip-Diagnose-Zeilen
  // laufen auf EINE eigene geflüsterte SL-Karte (postAuraSkipDiagCard),
  // die öffentliche Zusammenfassungskarte zeigt nur noch Wirkungen.
  const skipLines = [];
  const handled = new Set();
  const auraDamageDice = functionStuff.auraDamageDice ?? "1d6";
  const auraHealDice = functionStuff.auraHealDice ?? "1d8";
  const casterResolute = getAttributeValue(functionStuff.actor, "resolute");
  const casterTokenId = functionStuff.tokenId ?? functionStuff.token?.id ?? null;
  const casterDisposition = functionStuff.token?.document?.disposition ?? 0;
  /* AoE-Rest Paket 1 (Sinn-Paket S1, fester Code-Default SICHT): Spiegel
     der Heiligen Aura - Sicht-Blocker je anvisiertem Ziel bei aktivem
     Welt-Setting aoeSenseWalls, Messfehler wirken weiter, Blocker nur als
     skipLine (NIE still). */
  const auraCasterToken =
    functionStuff.token ?? (casterTokenId ? canvas.tokens?.placeables?.find((t) => t.id === casterTokenId) ?? null : null);
  const auraSightPasses = (nextToken) => {
    if (!auraCasterToken || nextToken.id === auraCasterToken.id) return true;
    const sightCheck = senseBlocked(auraCasterToken, nextToken, "sight");
    if (sightCheck.error) {
      skipLines.push(`<p>${game.i18n.format("AOE.SENSE_MEASURE_FAIL", { targetname: nextToken.name })}</p>`);
      return true;
    }
    if (sightCheck.blocked) {
      skipLines.push(
        `<p>${game.i18n.format("AOE.SENSE_SKIP", { targetname: nextToken.name, sense: game.i18n.localize("AOE.SENSE_SIGHT") })}</p>`
      );
      return false;
    }
    return true;
  };
  const pushAuraDamageSymbol = (tokenId) => {
    flagDataArray.push({
      tokenId: tokenId,
      addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "unholyaura")),
      casterId: functionStuff.actor.id,
      abilityRef: functionStuff.ability?.reference,
      casterResolute: casterResolute,
      casterName: functionStuff.actingCharName,
      maintained: true,
      dot: {
        label: "POWER_LABEL.UNHOLY_AURA",
        formula: auraDamageDice,
        resource: "toughness",
        separateRoll: false,
        resist: {
          attribute: "resolute",
          value: casterResolute,
        },
      },
    });
  };
  // Loop 1 - Schaden (jede Stufe): Kulturwesen und Bestien, Freund UND Feind
  while (!zoneChainDone(functionStuff, handled) && (await zoneChainContinue(functionStuff, "POWER_UNHOLYAURA.CHAT_NEXT_VICTIM"))) {
    const nextToken = Array.from(game.user.targets).find((token) => !handled.has(token.id));
    if (!nextToken) {
      /* v2.15 (Rudolfs Testrunde 14, P13-max): Abbruch-Hinweis als Zeile auf
         der Zusammenfassungskarte statt ui.notifications-Warnung. */
      lines.push(`<p>${game.i18n.localize("POWER_UNHOLYAURA.CHAT_NO_NEW_TARGET")}</p>`);
      break;
    }
    handled.add(nextToken.id);
    /* v2.14 (Rudolfs Entscheidung, Testrunde 13): im ZONEN-BATCH bleibt der
       Wirker-Token von der eigenen Aura unberührt - die Adept-Ausschlussfrage
       springt den Wirker ohnehin (nextToken.id !== casterTokenId), ein
       Zonen-Selbst-Schaden träte also automatisch und folgenlos auf; manuell
       entscheidet die SL weiter per Markierung. */
    if ((functionStuff.zoneChainTargets?.size ?? 0) > 0 && nextToken.id === casterTokenId) {
      /* v2.15 (Rudolfs Testrunde 14, P13-max): stiller Wirker-Skip wird
         Zeile MIT GRUND (Spiegel der Heiligen Aura). */
      skipLines.push(`<p>${game.i18n.localize("POWER_UNHOLYAURA.SKIP_CASTER")}</p>`);
      continue;
    }
    const category = game.symbaroum.config.getCreatureCategory(nextToken.actor);
    if (category !== "civilized" && category !== "beast") {
      /* v2.15 (Rudolfs P13-max): Kategorie-Warnung als Kartenzeile statt
         ui.notifications (Bestands-Key wird wiederverwendet). */
      skipLines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.CHAT_WRONG_CATEGORY", { targetname: nextToken.name })}</p>`);
      continue;
    }
    // S1: Sicht-Blocker prüfen (Setting aoeSenseWalls, Default AN)
    if (!auraSightPasses(nextToken)) continue;
    /* v2.14 (Rudolfs Entscheidung, Testrunde 13, P7): völlig Verdorbene
       (Korruption >= max) werden von der Unheiligen Aura NICHT mehr
       geschädigt - Spiegel-Symmetrie zur Heiligen Aura; dasselbe Kriterium,
       das sie als HEIL-Empfänger qualifiziert (Loop 2), soll sie nicht
       zusätzlich Schaden nehmen lassen. Zeile + Skip, in Zone UND Fluss. */
    if (game.symbaroum.config.isThoroughlyCorruptTarget(nextToken.actor)) {
      /* v2.15 (Rudolfs P13-max): Warnung als Kartenzeile. */
      skipLines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.CHAT_VICTIM_CORRUPT", { targetname: nextToken.name })}</p>`);
      continue;
    }
    // Adept+: lebende Verbündete ausschließen (RAW "kann wählen") - der
    // Heuristik-Vergleich ist DISPOSITIONS-RELATIV zum Wirker ( >= ), damit
    // auch die üblichen neutralen SC-Tokens als Verbündete erkannt werden;
    // die Bestätigung fragt nur nach, die SL entscheidet wie immer
    if (
      functionStuff.powerLvl.level > 1 &&
      nextToken.id !== casterTokenId &&
      (nextToken.document?.disposition ?? 0) >= casterDisposition &&
      !(await unholyAllyIncludeConfirmation(functionStuff, nextToken.name))
    ) {
      lines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.ALLY_EXCLUDED", { targetname: nextToken.name })}</p>`);
      continue;
    }
    // je Anwendung EINE Resist-Chance gegen die gesnapshottete Willenskraft
    const resistRoll = await new Roll("1d20").evaluate();
    auraRolls.push(resistRoll);
    const resistTarget = getAttributeValue(nextToken.actor, "resolute") + 10 - casterResolute;
    if (resistRoll.total <= resistTarget) {
      lines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.VICTIM_RESISTED", { targetname: nextToken.name, roll: resistRoll.total, target: resistTarget })}</p>`);
      pushAuraDamageSymbol(nextToken.id);
      continue;
    }
    lines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.VICTIM_NO_RESIST", { targetname: nextToken.name, roll: resistRoll.total, target: resistTarget })}</p>`);
    // sofortiger Schaden, Rüstung ignoriert (GRW) - je Opfer eine Wurfzeile
    // auf der Zusammenfassungskarte, angewendet über die GM-Karte
    const damageRoll = await new Roll(auraDamageDice).evaluate();
    auraRolls.push(damageRoll);
    flagDataArray.push({
      tokenId: nextToken.id,
      toughnessChange: -1 * damageRoll.total,
    });
    lines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.VICTIM_DAMAGE", { targetname: nextToken.name, count: damageRoll.total })}</p>`);
    // der Schaden tötete das Opfer (A25 F10/F11-Muster) - kein Symbol
    const targetToughness = nextToken.actor?.system?.health?.toughness?.value;
    if (targetToughness !== undefined && damageRoll.total >= targetToughness) {
      if (ui.combat.viewed && (ui.combat.viewed.getCombatantsByToken(nextToken.id) ?? []).length > 0) {
        flagDataArray.push({ tokenId: nextToken.id, defeated: true });
      }
      continue;
    }
    pushAuraDamageSymbol(nextToken.id);
  }
  // Loop 2 - Heilung (Meister): verbündete Abscheulichkeiten, Untote und
  // (v2.13, Rudolfs Entscheidung) völlig Verdorbene in der Nähe heilen
  // 1W8 Zähigkeit - SOFORT bei Aufnahme (v2.13, P10a/P13) plus
  // Regenerations-DOT (A35-Heil-Ressource).
  // v2.14 (Testrunde-13-Root-Cause): Loop 2 läuft mit EIGENEM handled-Set -
  // im Fluss-Pfad bleiben damit in Loop 1 mit Kategorie-Warnung übersprungene
  // Token neu markierbar - und bei ZONEN-AKTIVIERTER Auslösung als DIALOG-
  // FREIER ZWEITER DURCHLAUF über die Zonenziele: Loop 1 verbraucht im
  // Zonen-Batch ALLE Zonenziele, der gemeinsame zoneChainDone-Gard
  // übersprang den Heil-Loop deshalb still (Rudolfs Testrunde-13-Befunde
  // P7-P10 - der Loop-2-Dialog erschien nie). Empfänger im Zonen-Batch:
  // verbündet (dispositions-relativ >= Wirker, Konvention der Zonen-
  // Zielfilter) UND Kategorie (undead/abomination ODER völlig verdorben);
  // der Wirker selbst wird nie geheilt (Rudolfs Entscheidung; Spiegel der
  // Lebensspender-Meister-Reaktion). Manuell entscheidet die SL wie gehabt
  // über die Markierung (kein Dispositions-Zwang, keine Wirker-Sperre).
  if (functionStuff.powerLvl.level > 2) {
    const markUnholyAuraAlly = async (nextToken) => {
      const allyCategory = game.symbaroum.config.getCreatureCategory(nextToken.actor);
      // v2.13 (Rudolfs Testrunde 12, P10a + Entscheidung): heal recipients
      // = allied undead/abominations OR thoroughly corrupted creatures
      // (Korruption >= max) - RAW names only "verbündete Abscheulichkeiten
      // und Untote", Rudolf extends the list to the thoroughly corrupted.
      // v2.15 (Rudolfs Testrunde 14, P13-max): der Kategorie-Skip läuft in
      // Zone UND Fluss als Kartenzeile (v2.14 übersprang im Zonen-Batch
      // noch still); Bestands-Key wird wiederverwendet, der silentCategory-
      // Skip-Mechanismus entfällt.
      if (allyCategory !== "undead" && allyCategory !== "abomination" && !game.symbaroum.config.isThoroughlyCorruptTarget(nextToken.actor)) {
        skipLines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.CHAT_ALLY_NOT_UNDEAD", { targetname: nextToken.name })}</p>`);
        return;
      }
      // S1: Sicht-Blocker prüfen (Setting aoeSenseWalls, Default AN)
      if (!auraSightPasses(nextToken)) return;
      flagDataArray.push({
        tokenId: nextToken.id,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "regeneration")),
        casterId: functionStuff.actor.id,
        abilityRef: functionStuff.ability?.reference,
        casterResolute: casterResolute,
        casterName: functionStuff.actingCharName,
        maintained: true,
        dot: {
          label: "POWER_LABEL.UNHOLY_AURA",
          formula: auraHealDice,
          resource: "heal",
          separateRoll: false,
        },
      });
      lines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.ALLY_HEAL", { targetname: nextToken.name, dice: auraHealDice })}</p>`);
      // v2.13 (Rudolfs Testrunde 12, P10a/P13 + Entscheidung): the first
      // heal fires IMMEDIATELY on inclusion (symmetry with loop 1's
      // immediate damage) - one own roll per ally on this summary card,
      // applied as a positive toughnessChange on the same GM card,
      // clamped to the maximum; nothing to line up at full toughness.
      // The regeneration DOT keeps ticking every round from the ally's
      // own turn on (A33Fix2/A33Fix3 suppressions stay with the TICKS -
      // the immediate application also heals a dying ally at 0)
      const immediateHealRoll = await new Roll(auraHealDice).evaluate();
      const allyToughness = nextToken.actor?.system?.health?.toughness;
      const immediateHealed = Math.max(0, Math.min(immediateHealRoll.total, Number(allyToughness?.max ?? 0) - Number(allyToughness?.value ?? 0)));
      if (immediateHealed > 0) {
        auraRolls.push(immediateHealRoll);
        flagDataArray.push({ tokenId: nextToken.id, toughnessChange: immediateHealed });
        lines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.ALLY_HEAL_IMMEDIATE", { targetname: nextToken.name, count: immediateHealed })}</p>`);
      }
    };
    const handledHeal = new Set();
    const zoneHealTargetIds = [...(functionStuff.zoneChainTargets ?? [])];
    if (zoneHealTargetIds.length > 0) {
      // Zonen-Batch: dialogfreier zweiter Durchlauf im Zonen-Stil wie Loop 1
      for (const tokenId of zoneHealTargetIds) {
        if (handledHeal.has(tokenId)) continue;
        const nextToken = canvas.tokens?.placeables?.find((t) => t.id === tokenId);
        if (!nextToken?.actor) continue;
        handledHeal.add(tokenId);
        if (tokenId === casterTokenId) {
          /* v2.15 (Rudolfs Testrunde 14, P13-max): stiller Wirker-Skip wird
             Zeile MIT GRUND (Spiegel der Heiligen Aura). */
          skipLines.push(`<p>${game.i18n.localize("POWER_UNHOLYAURA.SKIP_CASTER")}</p>`);
          continue;
        }
        if ((nextToken.document?.disposition ?? 0) < casterDisposition) {
          /* v2.15 (Rudolfs Testrunde 14, P2/P5-Root-Cause): der stille
             Dispositions-Skip war die Ursache des undiagnostizierbaren
             "Kein Heilen-Loop für Zone"-Befunds - ab jetzt Zeile MIT GRUND;
             der Filter selbst bleibt unverändert (Rudolfs RAW-Entscheidung:
             nur Verbündete sind Heil-Empfänger). */
          skipLines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.SKIP_DISPOSITION", { targetname: nextToken.name })}</p>`);
          continue;
        }
        await markUnholyAuraAlly(nextToken);
      }
    } else {
      while (await zoneChainContinue(functionStuff, "POWER_UNHOLYAURA.CHAT_NEXT_ALLY")) {
        const nextToken = Array.from(game.user.targets).find((token) => !handledHeal.has(token.id));
        if (!nextToken) {
          /* v2.15 (Rudolfs P13-max): Abbruch-Hinweis als Kartenzeile. */
          lines.push(`<p>${game.i18n.localize("POWER_UNHOLYAURA.CHAT_NO_NEW_TARGET")}</p>`);
          break;
        }
        handledHeal.add(nextToken.id);
        await markUnholyAuraAlly(nextToken);
      }
    }
  } else {
    /* v2.15 (Rudolfs Testrunde 14, P13-max): Stufen-Gate-Zeile - der Heil-
       Loop der Unheiligen Aura läuft erst ab Meister; die Zeile macht das
       stillle Schweigen auf der Karte sichtbar. */
    skipLines.push(`<p>${game.i18n.format("POWER_UNHOLYAURA.LEVEL_GATE_HEAL", { lvlname: functionStuff.powerLvl.lvlName })}</p>`);
  }
  if (lines.length > 0) {
    const title = `<h4>${game.i18n.format("POWER_UNHOLYAURA.SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
    await postMaintainChainCard(functionStuff, title, lines, auraRolls);
  }
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
  // v2.16 (N2): Skip-Diagnose als eigene geflüsterte SL-Karte (nur falls
  // tatsächlich Ziele übersprungen wurden - keine leere Karte).
  if (skipLines.length > 0) {
    await postAuraSkipDiagCard(functionStuff, skipLines, "POWER_UNHOLYAURA.SKIP_CARD_TITLE");
  }
}

/* v2.12 — Unheilige Aura: die Aura endet (gescheiterte Maintain-Probe oder
   A29-"Nein"-Abbruch) - 1:1-Spiegel von holyAuraEndCleanup: jedes Szenen-
   Symbol mit den Autoren-Markern dieses Wirkers für die unholyaura-Kraft
   (Schadenspunkte auf Kulturwesen/Bestien, Regenerations-Symbole der
   Verbündeten) geht auf EINE GM-Entfernungs-Karte; das eigene Maintain-
   Symbol hat standardPowerResult bereits geräumt. Unmarkierte Bedingungen
   bleiben unberührt (A23/K6-Markerschutz). */
async function unholyAuraEndCleanup(functionStuff) {
  const casterId = functionStuff.actor.id;
  const abilityRef = functionStuff.ability?.reference;
  const flagDataArray = [];
  const seen = new Set();
  for (const token of canvas.tokens.placeables) {
    const tokenActor = token.actor;
    if (!tokenActor) continue;
    for (const effect of tokenActor.effects) {
      const effectFlagData = effect.getFlag(game.system.id, "flagData");
      if (effectFlagData?.caster !== casterId || effectFlagData?.ability !== abilityRef) continue;
      const statusId = effect.statuses?.size ? [...effect.statuses][0] : null;
      if (!statusId) continue;
      const key = token.id + "|" + statusId;
      if (seen.has(key)) continue;
      seen.add(key);
      flagDataArray.push({ tokenId: token.id, removeEffect: statusId });
    }
  }
  if (flagDataArray.length > 0) {
  /* v2.7 F40: Ende-Raeumung automatisch (GM-Client, keine Karte). */
    await createModifyTokenAutoApply(flagDataArray);
  }  /* v2 F9 (Rudolfs Freigabe 20.11.): Mit den Symbolen endet auch die
     Auren-Region (Loeschen + Akteur-Flag, endAuraZoneState). */
  await endAuraZoneState(functionStuff.actor, abilityRef);

}

/* v2.12 (Rudolfs Freigabe 15.11.) — Korruptions-Reaktion der beiden
   MEISTER-Auren (Fegefeuer APG: Spiegelschaden; Lebensspender APG:
   Reduktion). Läuft an BEIDEN System-Auslieferungspunkten einer Korruptions-
   buchung: dem GM-Apply-Karten-Handler (hooks.js, flagData.corruptionChange).
   Hymnen-Paket 1.1: der zweite frühere Auslieferungspunkt (Bestätigungs-
   Dialog-Pfad in standardPowerResult, direkte Anwendung ohne GM-Karte)
   ist mit dem Ja/Nein-Dialog entfallen, alle früheren confirmDialog-
   Kräfte buchen seit 1.1 über die GM-Anwenden-Karte. Die mechanische
   Näherung für RAW "Korruption durch Kräfte oder Artefakte" ist damit
   JEDE System-Korruptionsbuchung, was außerhalb des Systems passiert,
   bleibt SL-Urteil. Rückgabewert: der (ggf.
   reduzierte) anzuwendende Betrag.
   - Fegefeuer: jeder Mystiker-Token mit purgatory-Symbol (flagData.ability
     === "purgatory") bestraft HOSTILE Korruptionsempfänger in Sichtweite
     (SIGHT_RANGE_UNITS, Messung nicht verfügbar => SL-Urteil wirkt) mit
     demselben Betrag als körperlichen Schaden, Rüstung ignoriert (direkte
     toughnessChange-GM-Karte, keine Rekursion: körperlicher Schaden bucht
     keine Korruption).
   - Lebensspender: jeder Mystiker-Token mit lifegiver-Symbol reduziert die
     Korruptionsbuchung FREUNDLICHER Token (dispositions-relativ, nie der
     Mystiker selbst) in Sichtweite um 1W4 (mindestens 0); bei mehreren
     aktiven Lebensspendern greift die GRÖSSTE einzelne Reduktion (keine
     RAW-Stacking-Regel, konservative Lesung).
   Disposition: absolut HOSTILE/FRIENDLY wie die v2.1-Zielfilter-Entscheidung
   (aoe.js _filterTargets), neutrale Token bleiben SL-Urteil und feuern
   keine der beiden Reaktionen. */
export async function applyCorruptionMasterReactions(actor, tokenId, amount) {
  let applied = Number(amount) || 0;
  if (!(applied > 0)) return applied;
  try {
    const victimToken = canvas.tokens?.placeables?.find((t) => t.id === tokenId) ?? null;
    if (!victimToken) return applied;
    const sightLimit = game.symbaroum.config.SIGHT_RANGE_UNITS ?? 50;
    /* AoE-Rest Paket 1 (Sinn-Paket S1, fester Code-Default SICHT): Bei
       aktivem Welt-Setting aoeSenseWalls prüft die Sicht neben der
       Sichtweiten-Abstraktion zusätzlich den Sicht-Blocker (senseBlocked,
       Ray gegen Kanten edge[sense]==='normal' + Regions-Restriktionen);
       Messfehler wirken die Reaktion weiter (SL-Urteil), ein Blocker
       ueberspringt die Reaktion sichtbar als Zeile - NIE still. */
    const lines = [];
    const inSight = (mysticToken) => {
      try {
        if (canvas.grid.measureDistance(mysticToken, victimToken) > sightLimit) return false;
      } catch (distanceError) {
        // Messung nicht verfügbar => Sicht gelten lassen, SL-Urteil wirkt
      }
      const sightCheck = senseBlocked(mysticToken, victimToken, "sight");
      if (sightCheck.error) {
        lines.push(`<p>${game.i18n.format("AOE.SENSE_MEASURE_FAIL", { targetname: victimToken.name })}</p>`);
        return true;
      }
      if (sightCheck.blocked) {
        lines.push(
          `<p>${game.i18n.format("AOE.SENSE_SKIP", { targetname: victimToken.name, sense: game.i18n.localize("AOE.SENSE_SIGHT") })}</p>`
        );
        return false;
      }
      return true;
    };
    const rolls = [];
    const flagDataArray = [];
    const victimName = victimToken.name ?? actor?.name ?? "";
    for (const mysticToken of canvas.tokens?.placeables ?? []) {
      const mysticActor = mysticToken.actor;
      if (!mysticActor?.effects) continue;
      for (const effect of mysticActor.effects) {
        if (!effect.statuses?.has?.("purgatory") && !effect.statuses?.has?.("lifegiver")) continue;
        const effectFlagData = effect.getFlag(game.system.id, "flagData") ?? {};
        if (mysticToken.id === victimToken.id || mysticActor.id === actor?.id) continue;
        if (effect.statuses.has("purgatory") && effectFlagData.ability === "purgatory") {
          // Fegefeuer-Spiegel: nur hostile Korruptionsempfänger
          if ((victimToken.document?.disposition ?? 0) !== CONST.TOKEN_DISPOSITIONS.HOSTILE) continue;
          if (!inSight(mysticToken)) continue;
          flagDataArray.push({ tokenId: victimToken.id, toughnessChange: -1 * applied });
          lines.push(
            `<p>${game.i18n.format("POWER_PURGATORY.MASTER_MIRROR", { victimname: victimName, castername: effectFlagData.casterName ?? mysticToken.name, count: applied })}</p>`
          );
        } else if (effect.statuses.has("lifegiver") && effectFlagData.ability === "lifegiver") {
          // Lebensspender-Reduktion: nur freundliche Empfänger, nie der
          // Mystiker selbst; größte einzelne Reduktion gewinnt
          if ((victimToken.document?.disposition ?? 0) < (mysticToken.document?.disposition ?? 0)) continue;
          if (!inSight(mysticToken)) continue;
          const reductionRoll = await new Roll("1d4").evaluate();
          rolls.push(reductionRoll);
          const before = applied;
          applied = Math.max(0, applied - reductionRoll.total);
          if (before !== applied) {
            lines.push(
              `<p>${game.i18n.format("POWER_LIFEGIVER.MASTER_REDUCTION", { victimname: victimName, castername: effectFlagData.casterName ?? mysticToken.name, count: before - applied, kept: applied })}</p>`
            );
          }
        }
      }
    }
    if (lines.length > 0) {
      const title = `<h4>${game.i18n.localize("POWER.MASTER_REACTIONS")}</h4>`;
      const html = `<div class="symbaroum chat ability"><div class="foreground">${title}${lines.map((line) => `<div class="finalTxt">${line}</div>`).join("")}</div></div>`;
      const chatData = {
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: actor?.id }),
        rollMode: game.settings.get("core", "messageMode"),
        content: html,
      };
      if (rolls.length > 0) chatData.rolls = [createRollData(rolls)];
      await ChatMessage.create(chatData);
      if (flagDataArray.length > 0) {
        await createModifyTokenChatButton(flagDataArray);
      }
    }
    return applied;
  } catch (reactionError) {
    // Niemals die Korruptionsbuchung blockieren - ohne Reaktion weiterbuchen
    game.symbaroum.log("v2.12: corruption master reactions unavailable");
    return Number(amount) || 0;
  }
}

/* A17 draining glyph: the glyph affects every enemy that can see the symbol
   and stands in front of it - one casting, one independent opposed test per
   target. Targets are handled one after another (Rudolf's design): after
   each roll a dialog offers the next enemy, whose token is read fresh from
   the user's targeting, so no multi-target selection is needed. The maintain
   test stays with the primary target only; additional targets just carry the
   condition marker - the GM applies their per-round damage and removes the
   marker. Follow-ups cost no additional corruption (one casting), advantage
   applies to the first attack only, and a failed test does not end the
   sequence. */
function glyphNextTargetConfirmation(functionStuff, questionKey = "POWER_DRAININGGLYPH.CHAT_NEXT_TARGET") {
  return new Promise((resolve) => {
    symbDialog({
      title: functionStuff.abilityName,
      // A25 (optics): the question renders as the centred dark banner label
      // of the roll dialog (p.lblfavour inside .symbaroum.dialog), the
      // Ja/Nein buttons shrink to ~50% (see .chain-confirm in symbaroum.css)
      classes: ["chain-confirm", ...(isModernDialogActive() ? modernDialogClasses('modern-chain-confirm-dialog') : [])],
      content: `<div class="symbaroum dialog"><p class="lblfavour">${game.i18n.localize(questionKey)}</p></div>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("BUTTON.YES"),
          callback: () => resolve(true),
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.NO"),
          callback: () => resolve(false),
        },
      },
      default: "yes",
    });
  });
}

function buildGlyphTargetData(targetToken, resistAttributeName) {
  const leaderEffect = targetToken?.actor.hasCondition("eye");
  return {
    hasTarget: true,
    token: targetToken,
    actor: targetToken.actor,
    name: targetToken.name,
    tokenId: targetToken.id,
    resistAttributeName: resistAttributeName,
    leaderTarget: leaderEffect,
    autoParams: leaderEffect ? game.i18n.localize("COMBAT.CHAT_DMG_PARAMS_LEADER") : "",
  };
}

/* v2.8 (Rudolfs Festlegung 13.11. - Glyphe-Meister-Heilung): RAW heilt
   der Effekt auf Meisterstufe "den Mystiker ODER einen Verbündeten" um
   1W4 Zähigkeit je Runde, solange die Glyphe aufrechterhalten wird
   (Vault-APG-Text). Rudolfs Ideal-Design: WAHL DURCH DEN MYSTIKER nach
   Durchlauf der Opfer-Zielkette (Initialzauber über drainingGlyphResult
   UND je Maintain-Runde, siehe maintainChainResult) - ist KEIN Opfer-
   Ziel betroffen, gibt es keine Heilung. Abbruch oder "Keine Heilung"
   beendet ohne Buchung; die Heilung selbst läuft als Eintrag der SL-
   Anwenden-Karte (toughnessChange, Muster Ketten-Rundenschaden A25 F8).
   Empfänger: der Wirker oder ein befreundetes Token der Szene
   (Szenen-Scan, Dispositions-Vergleich wie die Zonen-Zielfilter). */
async function drainingGlyphMasterHeal(functionStuff, affectedTargets) {
  if (functionStuff.ability?.reference !== "drainingglyph") return;
  if (functionStuff.powerLvl?.level !== 3) return;
  if (!affectedTargets || affectedTargets < 1) return;
  const caster = functionStuff.actor;
  if (!caster) return;
  const seen = new Set();
  const allies = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token?.actor;
    if (!actor || token.document?.hidden) continue;
    if ((token.document?.disposition ?? 0) !== CONST.TOKEN_DISPOSITIONS.FRIENDLY) continue;
    if (actor.id === caster.id || seen.has(actor.id)) continue;
    seen.add(actor.id);
    allies.push({ actor, tokenId: token.document.id });
  }
  const escapeHtml = (text) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const optionsHtml =
    `<option value="">${escapeHtml(game.i18n.localize("POWER_DRAININGGLYPH.DIALOG_MASTER_HEAL_NONE"))}</option>` +
    `<option value="self" selected>${escapeHtml(
      game.i18n.format("POWER_DRAININGGLYPH.DIALOG_MASTER_HEAL_CASTER", { name: caster.name })
    )}</option>` +
    allies.map((ally) => `<option value="${ally.actor.id}">${escapeHtml(ally.actor.name)}</option>`).join("");
  const chosen = await new Promise((resolve) => {
    symbDialog({
      title: game.i18n.localize("POWER_DRAININGGLYPH.DIALOG_MASTER_HEAL_TITLE"),
      content: `<p>${escapeHtml(game.i18n.localize("POWER_DRAININGGLYPH.DIALOG_MASTER_HEAL_QUESTION"))}</p>
        <select id="glyph-master-heal-target" style="width: 100%">${optionsHtml}</select>`,
      classes: isModernDialogActive() ? modernDialogClasses("modern-glyph-heal-dialog") : [],
      buttons: {
        apply: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("POWER_BANISHINGSEAL.BUTTON_APPLY"),
          callback: (html) => {
            resolve(html[0].querySelector("#glyph-master-heal-target")?.value ?? "");
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.CANCEL"),
          callback: () => resolve(""),
        },
      },
      default: "apply",
    });
  });
  if (!chosen) return;
  const healRoll = await new Roll("1d4").evaluate();
  let targetActor = caster;
  let tokenId = functionStuff.tokenId ?? null;
  if (chosen !== "self") {
    const ally = allies.find((a) => a.actor.id === chosen);
    if (!ally) return;
    targetActor = ally.actor;
    tokenId = ally.tokenId;
  }
  await createModifyTokenChatButton([
    {
      tokenId,
      actorId: targetActor.id,
      toughnessChange: healRoll.total,
      label: game.i18n.format("POWER_DRAININGGLYPH.CHAT_MASTER_HEAL_APPLIED", {
        castername: functionStuff.actingCharName ?? caster.name,
        targetname: targetActor.name,
        count: healRoll.total,
      }),
    },
  ]);
}

async function drainingGlyphResult(rollData, functionStuff) {
  /* v2.1 F23 (Rudolfs Testrunde v2, G5-2-Freigabe): Ohne angreifbares
     Primaerziel laeuft KEIN Primaerblock - die Glyphe wird frei auf
     leeren Boden platziert; die Korruptionsgebuehr bucht die Standard-
     Engine (getCorruption-Wurf, GM-Anwenden-Karte mit Schwellen-Check
     wie beim normalen Zauber, Symbolismus-Engine unberuehrt), die
     kleine Karte nennt die Gebuehr. Danach der Regions-Batch wie
     gehabt (Ketten-Marker, A29/F11, Meister-Heilung unangetastet). */
  const hasPrimary = Boolean(functionStuff.targetData?.tokenId);
  let affectedTargets = 0;
  if (hasPrimary) {
    // primary target: standard behaviour (chat, damage, corruption, maintain)
    await standardPowerResult(rollData, functionStuff);
    /* v2.8 (Glyphe-Meister-Heilung): zählen, wie viele Opfer die Glyphe
       tatsächlich betroffen hat (gelungene Proben der Zielkette) - die
       Meister-Heilung läuft nur mit mindestens einem betroffenen Opfer. */
    affectedTargets = rollData?.[0]?.trueActorSucceeded === true ? 1 : 0;
  } else {
    const emptyCorruption = await functionStuff.actor.getCorruption(functionStuff);
    if (emptyCorruption.value > 0) {
      await createModifyTokenChatButton([
        {
          tokenId: functionStuff.tokenId,
          actorId: functionStuff.actor.id,
          corruptionChange: emptyCorruption.value,
        },
      ]);
    }
    const emptyLines = [`<p>${game.i18n.format("POWER_DRAININGGLYPH.CHAT_NO_TARGET_COST", { count: emptyCorruption.value })}</p>`];
    await postMaintainChainCard(functionStuff, `<h4>${functionStuff.abilityName}</h4>`, emptyLines, emptyCorruption.corruptionRoll ? [emptyCorruption.corruptionRoll] : []);
  }
  // advantage (+1d4 damage) applies to the first attack only
  functionStuff.hasAdvantage = false;
  const savedCorruption = functionStuff.corruption;
  const savedMaintain = functionStuff.maintain;
  const savedMaintainedEffect = functionStuff.activelyMaintainedTargetEffect;
  const savedAddTargetEffect = functionStuff.addTargetEffect;
  // the follow-ups belong to one casting: no further corruption, no maintain
  functionStuff.corruption = game.symbaroum.config.TEMPCORRUPTION_NONE;
  functionStuff.maintain = game.symbaroum.config.MAINTAIN_NOT;
  /* v2.9 (Rudolfs Testrunde 8, Befund 5b: „Zahl der Ziele im Maintain-
     Dialog immer 1"): Die Glyphe ist auf jeder Stufe maintain-fähig,
     also tragen auch ihre Follow-up-Marker das maintained-Flag (die
     A29-Erinnerung zählt dann alle gebundenen Ziele). Die maintain-
     Konfiguration (MAINTAIN_NOT) bleibt unangetastet, damit A20-Kosten
     und Recast-Semantik der Follow-ups exakt gleich bleiben. */
  functionStuff.followUpMaintainedMarker = savedMaintain !== game.symbaroum.config.MAINTAIN_NOT;
  functionStuff.activelyMaintainedTargetEffect = [];
  functionStuff.addTargetEffect = [foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "drainingglyph"))];
  const handled = new Set(hasPrimary ? [functionStuff.targetData.tokenId] : []);
  /* v2 F10 (Rudolfs Freigabe 20.11.): Die Glyphe ist KEINE Sweep-Kraft
     mehr (config.js) - der Erstgesang legt einen dauerhaften Zonen-Kreis
     an (placeGlyphZone, Radius aus dem Zonen-Tab, Default 1 Zelle =
     Nah, modulweit einheitlich mit dem Dornenmantel) und probt JE Feind
     in der Region die opponierte Glyphe-Probe (weakening-Muster: Dispo-
     sition relativ zum Wirker, eine Probe pro Ziel, ein Widerstand
     verhindert nur dieses eine Symbol). Die SL-Zielkette mit dem
     Zauberer-Zentren-Sicht-Guard (S1-Approximation, die instant-Zone
     stand bei der Ketten-Ausloesung nie als Region) ist ENTFERNT - die
     Region entscheidet die Geometrie (Sicht-Clip ueber aoeSenseWalls),
     das Primaerziel bleibt das vor dem Wurf angezielte Token (in der
     Region nicht doppelt probiert; ausserhalb: SL-Anvisierung gewinnt,
     dokumentiert). Picker-Abbruch: Nur-Primaerziel-Zauber ohne Region
     (dokumentiert); Maintain-Kette/A29/F11-Rundenschaden unberuehrt. */
  /* v2.8 F39: Erstgesang-Kopf aus dem MASTER-RAHMEN (zoneErstgesang-
     Frame): pending-Flaeche oder Picker-Platzierung (F30/F37-Logik
     unverändert im Rahmen), Akteur-Flag, F28-Bestands-Trace in Erst-
     gesangs-Form (loest den F36-Sondertrace ab, Felder identisch).
     Typ-spezifisch bleibt die Opposed-Kette + Meister-Heilung (F38-A-
     Rumpf, ab hier unveraendert). */
  const glyphFrame = await zoneErstgesangFrame(functionStuff, {
    refs: game.symbaroum.config.GLYPH_ZONE_REFERENCES,
    flagPrefix: "glyphzone",
    flagLabel: "Glyphen-Flag",
    placeRegion: (frameCasterToken) =>
      placeGlyphZone(frameCasterToken, functionStuff.actor, "drainingglyph", functionStuff.ability),
    traceHandled: handled,
  });
  const glyphRegion = glyphFrame?.region ?? null;
  if (glyphRegion) {
    /* v2.6 F38 Option A (Rudolfs Freigabe, N3-Wurzel aus der v2.5-
       Testrunde): hymnRegionTokens liefert TOKEN-DOKUMENTE; der Erst-
       gesang-Loop iterierte die Eintraege selbst und las
       nextToken.document?.disposition ?? 0 - auf einem Doku-Eintrag
       ist .document undefined, der Wert also IMMER 0, und ein neu-
       traler Wirker (disp 0) skippte so JEDES Ziel (0 >= 0): Erfassung
       ohne Proben. Auren-Musterangleich: hier nur die Ids ziehen und
       je Id das Placeable aufloesen (canvas.tokens.placeables.find);
       ab dann unveraenderter Rumpf - die Disposition wird korrekt
       gelesen und buildGlyphTargetData erhaelt das Placeable, das es
       laut allen Callsites erwartet. */
    for (const nextTokenId of glyphFrame.zoneIds) {
      const nextToken = canvas.tokens?.placeables?.find((t) => t.id === nextTokenId) ?? null;
      if (!nextToken || !nextToken?.actor || handled.has(nextTokenId)) continue;
      handled.add(nextTokenId);
      if ((nextToken.document?.disposition ?? 0) >= glyphFrame.casterDisposition) continue;
      functionStuff.targetData = buildGlyphTargetData(nextToken, functionStuff.targetResistAttribute);
      const rollDataNext = [
        await baseRoll(
          functionStuff.actor,
          functionStuff.castingAttributeName,
          nextToken.actor,
          functionStuff.targetResistAttribute,
          functionStuff.favour,
          functionStuff.modifier,
          false
        ),
      ];
      // one independent test per target: a failure does not end the sequence
      await standardPowerResult(rollDataNext, functionStuff);
      if (rollDataNext[0]?.trueActorSucceeded === true) affectedTargets++;
    }
  }
  functionStuff.corruption = savedCorruption;
  functionStuff.maintain = savedMaintain;
  functionStuff.activelyMaintainedTargetEffect = savedMaintainedEffect;
  functionStuff.addTargetEffect = savedAddTargetEffect;
  functionStuff.followUpMaintainedMarker = false;
  /* v2.8 (Glyphe-Meister-Heilung): nach Durchlauf der Opfer-Zielkette -
     Wahl des Empfängers durch den Mystiker (nur Meisterstufe, nur mit
     mindestens einem betroffenen Opfer). */
  await drainingGlyphMasterHeal(functionStuff, affectedTargets);
}

/* A19 Kette (chain): from Adept level on, Anathema, Brimstone Cascade and
   Black Bolt can strike one enemy after another (GRW "Kette": one probe per
   target in a player-chosen order). Like the A17 glyph, follow-up targets are
   handled one after another through a confirmation dialog, the next token
   being read fresh from the user's targeting. Each follow-up keeps the
   power's own setup effects (Black Bolt paralysis, Brimstone Cascade damage
   incl. its reduced fail damage), pays corruption per target (A20: one
   corruption cost per target on the initial casting; maintaining later
   costs nothing) and gets no advantage (first attack only). Anathema and Black
   Bolt stop at the first failed probe; Brimstone Cascade stops at the first
   failed probe as Adept and only at the second failed probe as Master.
   Maintaining an earlier casting never chains. */
async function chainSequenceResult(rollData, functionStuff, opts) {
  // primary target: standard behaviour (chat, damage, corruption, effects)
  await standardPowerResult(rollData, functionStuff);
  // advantage applies to the first attack only
  functionStuff.hasAdvantage = false;
  // A24: for Anathema the dispel probes against the originators decide the
  // chain (anathemaDispelFailed is set by standardPowerResult above); targets
  // without tagged effects fall back to the standard probe (G3)
  const isAnathema = functionStuff.ability?.reference === "anathema";
  // A25: a power can probe its follow-ups UNOPPOSED (Entangling Vines Adept:
  // GRW has the chain test as the caster's Resolute probe alone) - the
  // follow-ups then roll without a resist actor
  const unresisted = opts.unresisted === true;
  const primaryFailed = isAnathema ? functionStuff.anathemaDispelFailed === true : rollData?.[0]?.trueActorSucceeded === false;
  let fails = primaryFailed ? 1 : 0;
  if (fails >= opts.stopAfterFails) return;
  const savedMaintain = functionStuff.maintain;
  const savedCorruption = functionStuff.corruption;
  // follow-ups pay corruption per target (A20); maintain stays with the primary target
  functionStuff.maintain = game.symbaroum.config.MAINTAIN_NOT;
  /* v2.9 (Rudolfs Testrunde 8, Befunde 5a/5c: „Zahl der Ziele im
     Maintain-Dialog immer 1"): Maintain-FÄHIGE Kräfte markieren auch
     ihre Ketten-Follow-up-Symbole als maintained - die A29-Erinnerung
     zählt dann alle gebundenen Ziele statt nur das Primärziel. Der
     Marker greift NUR hier im Follow-up-Kontext; die maintain-Konfigu-
     ration (MAINTAIN_NOT) bleibt unangetastet, damit A20-Kosten und
     Recast-Semantik der Follow-ups exakt gleich bleiben. Kräfte OHNE
     Maintain auf der gewirkten Stufe (Blendend Novize/Meister, Kampf-
     symbol Novize) bekommen das Flag NICHT - ihre Symbole sind Ein-
     Runden- bzw. bis-Heilung-Wirkungen und dürfen die A29-Erinnerung
     nie auslösen. */
  functionStuff.followUpMaintainedMarker = savedMaintain !== game.symbaroum.config.MAINTAIN_NOT;
  // A25 stage 3: symbolist powers (Blinding Symbol) cost their corruption
  // ONCE per application - the chain follow-ups are free (Rudolf, 22.10.);
  // opts.followUpsFree turns that on per power, everything else keeps A20
  if (opts.followUpsFree === true) functionStuff.corruption = game.symbaroum.config.TEMPCORRUPTION_NONE;
  const handled = new Set([functionStuff.targetData.tokenId]);
  while (!zoneChainDone(functionStuff, handled) && (await zoneChainContinue(functionStuff, "DIALOG.CHAIN_NEXT_TARGET"))) {
    const nextToken = Array.from(game.user.targets).find((token) => !handled.has(token.id));
    if (!nextToken) {
      ui.notifications.warn(game.i18n.localize("DIALOG.CHAIN_NO_NEW_TARGET"));
      break;
    }
    handled.add(nextToken.id);
    functionStuff.targetData = buildGlyphTargetData(nextToken, unresisted ? null : functionStuff.targetResistAttribute);
    const rollDataNext = [
      await baseRoll(
        functionStuff.actor,
        functionStuff.castingAttributeName,
        // A25: unresisted follow-ups roll without a resist actor
        // A24-F2: Anathema follow-ups are also probed against the ORIGINATOR's
        // willpower (displayed with the originator's name, default 11)
        unresisted ? null : isAnathema ? anathemaResistActor(nextToken.actor) : nextToken.actor,
        unresisted ? null : isAnathema ? "resolute" : functionStuff.targetResistAttribute,
        functionStuff.favour,
        functionStuff.modifier,
        false
      ),
    ];
    await standardPowerResult(rollDataNext, functionStuff);
    if (isAnathema ? functionStuff.anathemaDispelFailed === true : !rollDataNext[0].trueActorSucceeded) {
      fails++;
      if (fails >= opts.stopAfterFails) break;
    }
  }
  functionStuff.maintain = savedMaintain;
  functionStuff.corruption = savedCorruption;
  functionStuff.followUpMaintainedMarker = false;
}

async function anathemaChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: 1 });
}

async function brimstoneCascadeChainResult(rollData, functionStuff) {
  // Master: the chain only ends at the second failed probe
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: functionStuff.powerLvl.level === 3 ? 2 : 1 });
}

async function blackboltChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: 1 });
}

/* A25: further chain powers (GRW "Kette"). Entangling Vines (Adept+) wraps a
   chain of creatures - the Adept follow-ups are the caster's UNOPPOSED
   Resolute probes (GRW: "eine erfolgreiche Resolute-Probe... und so weiter,
   bis ein Versuch scheitert"), while the Master probes opposed against
   Strong (GRW) and adds the thorns damage per wrapped target. Confusion
   (Master) and Maltransformation (Master) probe each follow-up opposed
   against its willpower, Confusion rolling the per-target 1d6 effect table
   via standardPowerResult. All three stop at the first failed probe, pay
   corruption per target on the initial casting (A20) and get no advantage
   on follow-ups; their maintain rounds run as the A23 maintain chain
   (maintainChainResult) with the per-target repeated test. */
async function entanglingVinesChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, {
    stopAfterFails: 1,
    unresisted: functionStuff.powerLvl.level < 3,
  });
}

async function confusionChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: 1 });
}

async function maltransformationChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: 1 });
}

/* A25 stage 2: Blinding Symbol (EVERY level - the APG novice text already
   describes the chain) blinds one enemy after another with opposed
   [Resolute<-Resolute] probes, stopping at the first failure; the blind
   condition lasts one round (novice/master) or is maintained per target
   (adept, see maintainChainResult). Mind Throw (Master, GRW) throws a chain
   of enemies with opposed [Resolute<-Strong] probes and 1d8 damage per
   target, stopping at the first failure; the "lands on the back" rescue
   probe against Quick stays with the GM.
   A25 stage 3: as a SYMBOLIST power Blinding Symbol pays its corruption
   ONCE per application - the chain follow-ups are free (followUpsFree),
   unlike the A20 per-target cost of the other chain powers. */
async function blindingsymbolChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: 1, followUpsFree: true });
}

async function mindThrowChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: 1 });
}

/* A25 stage 4: the Ketten-Runde package 1 chain functions. Earthbinding
   (Adept+) binds one target after another (GRW) - Adept follow-ups probe
   unopposed, Master against Strong, mirroring the Entangling Vines chain -
   its per-round escape test [Resolute<-Strong] runs as the A23
   maintain chain; Battle Symbol (every level - the novice text already
   describes the chain) and Mark of Torment (every level) chain with opposed
   [Resolute<-Resolute] probes, stopping at the first failure - as
   SYMBOLIST powers both pay their corruption once per application
   (followUpsFree, A25 stage 3); True Form chains from Adept on, Levitate
   chains allies at Master with opposed [Resolute<-Strong] probes. */
async function earthbindingChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, {
    stopAfterFails: 1,
    unresisted: functionStuff.powerLvl.level < 3,
  });
}

async function battlesymbolChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: 1, followUpsFree: true });
}

async function markoftormentChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: 1, followUpsFree: true });
}

async function trueformChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: 1 });
}

async function levitateChainResult(rollData, functionStuff) {
  return chainSequenceResult(rollData, functionStuff, { stopAfterFails: 1 });
}

/* A25 stage 4: Black Breath has NO attribute test (CASTING_NOT means
   rollData is null) - the d4/d6 comparison against the target's TOTAL
   corruption runs in the functionStuff.blackbreath branch of
   standardPowerResult for the primary target and every follow-up. The
   MASTER chain continues only while the previous target SUFFERED
   corruption; a healed target breaks it automatically
   (blackbreathHealed is set in the branch above). */
async function blackbreathChainResult(rollData, functionStuff) {
  /* Hymnen-Paket 1.2: Primärziel-Aufruf wiederhergestellt. Dieser
     Aufruf stammte aus dem A25-Original (e55325cb), ging aber beim
     AoE-v2.4-Refactor (11.11.) verloren: Novize/Adept wirkten gar
     nicht (Früh-Rückkehr), dem Meister fehlte die Primär-Karte -
     nur die Folgeziele der Kette liefen. Seit 1.2 würft der Wirkende
     eine echte Eigenschaftsprobe (rollData), deren Ergebnis in
     standardPowerResult die Karte UND - nur bei Erfolg - die d4/d6-
     Wirkung (functionStuff.blackbreath) trägt. */
  await standardPowerResult(rollData, functionStuff);
  if (functionStuff.powerLvl.level < 3) return;
  const handled = new Set([functionStuff.targetData.tokenId]);
  while (!functionStuff.blackbreathHealed && !zoneChainDone(functionStuff, handled) && (await zoneChainContinue(functionStuff, "DIALOG.CHAIN_NEXT_TARGET"))) {
    const nextToken = Array.from(game.user.targets).find((token) => !handled.has(token.id));
    if (!nextToken) {
      ui.notifications.warn(game.i18n.localize("DIALOG.CHAIN_NO_NEW_TARGET"));
      break;
    }
    handled.add(nextToken.id);
    functionStuff.targetData = buildGlyphTargetData(nextToken, null);
    await standardPowerResult(null, functionStuff);
  }
}

/* A25 stage 4 F2 (Rudolf's test round): maintaining levitate is a pure
   concentration hold - GRW has no per-target probes, the dialog test
   decides for every creature this caster sent into the air at once. A
   failed hold breaks the flight: the fly symbols go to the GM card and
   the fallen take 1d6 armor-ignored damage - at Master the group floats
   down gently instead (GRW: "schweben sie alle zu Boden, ohne Schaden
   zu nehmen"). The caster's own symbol was applied directly at cast
   time (no flagData marker), so the caster's token is always checked;
   the allies carry the A23 caster/ability markers from the GM card. */
async function levitateMaintainResult(rollData, functionStuff) {
  const holds = rollData?.[0]?.trueActorSucceeded !== false;
  const casterId = functionStuff.actor.id;
  const abilityRef = functionStuff.ability?.reference;
  const master = functionStuff.powerLvl.level > 2;
  const flyEffect = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "fly"));
  const levitating = [];
  // the caster's own flight (applied without markers, found by token)
  if (functionStuff.token?.actor?.hasCondition("fly")) levitating.push(functionStuff.token);
  // every creature this caster levitated (marker scan, A23 flagData)
  for (const token of canvas.tokens.placeables) {
    if (token.id === functionStuff.tokenId) continue;
    const actor = token.actor;
    if (!actor) continue;
    const existing = actor.hasCondition("fly");
    const flagData = existing?.getFlag(game.system.id, "flagData");
    if (existing && flagData?.caster === casterId && flagData?.ability === abilityRef) {
      levitating.push(token);
    }
  }

  if (levitating.length === 0) {
    await postMaintainChainCard(functionStuff, "", [`<p>${game.i18n.localize("POWER.MAINTAIN_CHAIN_NO_TARGETS")}</p>`]);
    return;
  }

  const lines = [];
  // A25 F3 (test round): baseRoll returns wrapper objects - the card needs
  // the Foundry rolls inside them, not the wrappers themselves
  const rolls = [];
  for (const rollDataElement of rollData ?? []) rolls.push(...(rollDataElement.rolls ?? []));
  if (holds) {
    for (const token of levitating) {
      lines.push(`<p>${game.i18n.format("POWER.MAINTAIN_CHAIN_HOLDS", { targetname: token.name })}</p>`);
    }
  } else {
    const flagDataArray = [];
    for (const token of levitating) {
      flagDataArray.push({ tokenId: token.id, removeEffect: flyEffect });
      if (master) {
        lines.push(`<p>${game.i18n.format("POWER_LEVITATE.CHAT_LANDS", { targetname: token.name })}</p>`);
      } else {
        const fallRoll = await new Roll("1d6").evaluate();
        rolls.push(fallRoll);
        flagDataArray.push({ tokenId: token.id, toughnessChange: -1 * fallRoll.total });
        lines.push(`<p>${game.i18n.format("POWER_LEVITATE.CHAT_FALL", { targetname: token.name, count: fallRoll.total })}</p>`);
      }
    }
    await createModifyTokenChatButton(flagDataArray);
  }
  const title = `<h4>${game.i18n.format("POWER.MAINTAIN_CHAIN_SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
  await postMaintainChainCard(functionStuff, title, lines, rolls);
}

/* A23 maintain chain: when a power whose effects live as status symbols on the
   targets is maintained (Black Bolt paralysis, Draining Glyph marker), the
   repeated test runs for every target the caster still holds an effect on -
   not only the marked one (GRW "Anhaltende Wirkung auf eine Gruppe"). Targets
   are found by scanning the scene tokens for the power's condition; only
   effects applied by this caster carry the flagData author marker (see the
   casterId/abilityRef fields in standardPowerResult), so symbols of other
   casters, legacy symbols without flagData and symbols already removed by a
   third party (e.g. Anathema) are skipped automatically - no break-off logic
   needed. */
async function maintainChainResult(rollData, functionStuff) {
  game.symbaroum.log("maintainChainResult", ...arguments);
  const casterId = functionStuff.actor.id;
  // A24-F3 (test round 3): only the MAINTAIN POWER'S OWN symbols count - the
  // flagData carries the ability reference since A23, so symbols of the same
  // caster cast via a DIFFERENT power (same condition id) are not conflated
  const abilityRef = functionStuff.ability?.reference;
  const maintainEffects = [...functionStuff.addTargetEffect, ...functionStuff.activelyMaintainedTargetEffect];
  const markedTokenId = functionStuff.targetData?.tokenId;
  const markedName = functionStuff.targetData?.name ?? "";

  // A24-3 (test round 2): does the marked target carry one of the caster's own
  // symbols? Maintain only keeps existing symbols - a marked target without
  // one is NOT part of the maintained group
  const markedHasOwn = maintainEffects.some((effect) => {
    const existing = functionStuff.targetData?.token?.actor?.hasCondition(effect.id);
    const flagData = existing?.getFlag(game.system.id, "flagData");
    return flagData?.caster === casterId && flagData?.ability === abilityRef;
  });

  // A23-F2: Black Bolt's damage belongs to the initial impact only (APG) - a
  // power can opt out of re-rolling damage on maintain rounds via the setup
  // field maintainDamage (undefined = legacy behaviour)
  const savedHasDamage = functionStuff.hasDamage;
  if (functionStuff.maintainDamage === false) functionStuff.hasDamage = false;
  // A25 F8: a chainRoundDamage power (Entangling Vines / Earthbinding, Master
  // level) deals its per-round damage on the maintain summary card for EVERY
  // still-held target - the marked target's legacy damage roll on the
  // standard card is switched off here to avoid the double roll (hasDamage is
  // restored below like the maintainDamage opt-out)
  const roundDamage = functionStuff.chainRoundDamage === true && functionStuff.hasDamage;
  if (roundDamage) functionStuff.hasDamage = false;
  // A24-3: no fresh application and no damage on a target outside the
  // maintained group (maintain never casts anew)
  const savedAddTargetEffect = functionStuff.addTargetEffect;
  if (!markedHasOwn) {
    functionStuff.hasDamage = false;
    functionStuff.addTargetEffect = [];
  }
  // marked target: standard behaviour (chat card, damage, maintain handling)
  await standardPowerResult(rollData, functionStuff);
  functionStuff.hasDamage = savedHasDamage;
  functionStuff.addTargetEffect = savedAddTargetEffect;

  if (maintainEffects.length === 0) return;

  // scan the scene for tokens carrying this caster's symbols (marked target
  // is evaluated separately below)
  const scanned = [];
  for (const token of canvas.tokens.placeables) {
    if (token.id === markedTokenId) continue;
    const actor = token.actor;
    if (!actor) continue;
    for (const effect of maintainEffects) {
      const existing = actor.hasCondition(effect.id);
      const flagData = existing?.getFlag(game.system.id, "flagData");
      if (existing && flagData?.caster === casterId && flagData?.ability === abilityRef) {
        scanned.push({ token, effect });
        break;
      }
    }
  }

  if (!markedHasOwn && scanned.length === 0) {
    // nothing left to maintain (e.g. everything removed by Anathema)
    await postMaintainChainCard(functionStuff, "", [`<p>${game.i18n.localize("POWER.MAINTAIN_CHAIN_NO_TARGETS")}</p>`]);
    return;
  }

  const flagDataArray = [];
  const rolls = [];
  const lines = [];
  /* v2.8 (Glyphe-Meister-Heilung): Zähler der weiterhin gebundenen Ziele -
     die Meister-Heilung der Schwächenden Glyphe (1W4, Empfängerwahl des
     Mystikers) läuft NACH der Maintain-Kette, aber nur, solange mindestens
     ein Opfer weiterhin betroffen ist. */
  let heldTargets = 0;

  // A24-3 (test round 2): the marked target is part of the chain - its dialog
  // test shows up in the summary card like every other maintained target
  if (markedHasOwn) {
    const holds = rollData?.[0]?.trueActorSucceeded !== false;
    if (holds) heldTargets++;
    lines.push(
      `<p>${game.i18n.format(holds ? "POWER.MAINTAIN_CHAIN_HOLDS" : "POWER.MAINTAIN_CHAIN_BREAKS", { targetname: markedName })}</p>`
    );
    // A25 F8: bound another round - the per-round damage rolls here on the
    // summary card for the marked target (plain roll, armor ignored via the
    // direct toughnessChange on the shared GM card)
    if (holds && roundDamage) {
      const roundDamageRoll = await new Roll(functionStuff.damageDice).evaluate();
      rolls.push(roundDamageRoll);
      flagDataArray.push({ tokenId: markedTokenId, toughnessChange: -1 * roundDamageRoll.total });
      lines.push(`<p>${game.i18n.format("POWER.MAINTAIN_CHAIN_ROUND_DAMAGE", { targetname: markedName, count: roundDamageRoll.total })}</p>`);
      // A25 F10 (ii): the round damage killed the marked target - the power's
      // own symbols are removed alongside the damage so the dead token is
      // not re-tested in later maintain rounds (same dying check as the
      // standard path: armor-ignoring damage >= current toughness)
      const markedToughness = functionStuff.targetData?.token?.actor?.system?.health?.toughness?.value;
      if (markedToughness !== undefined && roundDamageRoll.total >= markedToughness) {
        for (const effect of maintainEffects) {
          const existing = functionStuff.targetData?.token?.actor?.hasCondition(effect.id);
          const effectFlagData = existing?.getFlag(game.system.id, "flagData");
          if (effectFlagData?.caster === casterId && effectFlagData?.ability === abilityRef) {
            flagDataArray.push({ tokenId: markedTokenId, removeEffect: effect });
          }
        }
      }
    }
    // failed test on the marked target: also remove add-target effects there
    // (standardPowerResult only removes actively maintained effects - the old
    // Black Bolt gap: paralysis was never removed on a failed maintain test)
    if (!holds) {
      for (const effect of functionStuff.addTargetEffect) {
        const existing = functionStuff.targetData.token?.actor.hasCondition(effect.id);
        const flagData = existing?.getFlag(game.system.id, "flagData");
        if (flagData?.caster === casterId && flagData?.ability === abilityRef) {
          flagDataArray.push({ tokenId: markedTokenId, removeEffect: effect });
        }
      }
    }
  }

  // every further scan target rolls the same opposed test with the same dialog
  // modifiers (one maintaining action = one modifier decision)
  for (const { token, effect } of scanned) {
    const roll = await baseRoll(
      functionStuff.actor,
      functionStuff.castingAttributeName,
      token.actor,
      functionStuff.targetResistAttribute,
      functionStuff.favour,
      functionStuff.modifier,
      false
    );
    rolls.push(...(roll.rolls ?? []));
    const holds = roll.trueActorSucceeded;
    if (holds) heldTargets++;
    lines.push(
      `<p>${game.i18n.format(holds ? "POWER.MAINTAIN_CHAIN_HOLDS" : "POWER.MAINTAIN_CHAIN_BREAKS", { targetname: token.name })}</p>`
    );
    if (!holds) {
      flagDataArray.push({ tokenId: token.id, removeEffect: effect });
    } else if (roundDamage) {
      // A25 F8: still bound - the per-round damage rolls here too, one plain
      // roll per still-held chain target on the summary card
      const roundDamageRoll = await new Roll(functionStuff.damageDice).evaluate();
      rolls.push(roundDamageRoll);
      flagDataArray.push({ tokenId: token.id, toughnessChange: -1 * roundDamageRoll.total });
      lines.push(`<p>${game.i18n.format("POWER.MAINTAIN_CHAIN_ROUND_DAMAGE", { targetname: token.name, count: roundDamageRoll.total })}</p>`);
      // A25 F10 (ii): the round damage killed this chain target - the power's
      // symbol is removed alongside the damage so the dead token is not
      // re-tested in later maintain rounds
      const targetToughness = token.actor?.system?.health?.toughness?.value;
      if (targetToughness !== undefined && roundDamageRoll.total >= targetToughness) {
        flagDataArray.push({ tokenId: token.id, removeEffect: effect });
      }
    }
  }

  if (lines.length > 0) {
    // A24-F3 (test round 3): title names the maintained power
    const title = `<h4>${game.i18n.format("POWER.MAINTAIN_CHAIN_SUMMARY", { powername: functionStuff.abilityName })}</h4>`;
    await postMaintainChainCard(functionStuff, title, lines, rolls);
  }
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }
  /* v2.8 (Glyphe-Meister-Heilung): nach der Maintain-Runde der Glyphe -
     Wahl des Empfängers durch den Mystiker (nur Meisterstufe, nur mit
     mindestens einem weiterhin gebundenen Opfer; der Helper prüft Referenz
     und Stufe selbst nach). */
  if (functionStuff.ability?.reference === "drainingglyph") {
    await drainingGlyphMasterHeal(functionStuff, heldTargets);
  }
}

/* A23 helper: summary card for the maintain chain and the Anathema dispel
   result, with the additional opposed tests attached as rolls.
   A24-F3 (test round 3): the result lines are wrapped in .finalTxt divs so
   they get the standard card typography (16px Signika, centred, via
   css/symbaroum.css) instead of the bare 12px default text; the h4 title is
   styled by the system's own .symbaroum.chat.ability h4 rule. */
async function postMaintainChainCard(functionStuff, titleHtml, lines, rolls = []) {
  const contentHtml = `${titleHtml}${lines.map((line) => `<div class="finalTxt">${line}</div>`).join("")}`;
  const html = `<div class="symbaroum chat ability"><div class="foreground">${contentHtml}</div></div>`;
  const chatData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({
      alias: game.user.name,
      actor: functionStuff.actor.id,
    }),
    rollMode: game.settings.get("core", "messageMode"),
    content: html,
  };
  if (rolls.length > 0) {
    chatData.rolls = [createRollData(rolls)];
  }
  ChatMessage.applyMode(chatData, "public");
  await ChatMessage.create(chatData);
}

/* v2.16 (Rudolfs Testrunde 15, N2-Entscheidung): Die Skip-Diagnose der
   Heiligen/Unheiligen Aura läuft auf EINE eigene geflüsterte Karte statt
   auf die öffentliche Zusammenfassungskarte - die öffentliche Karte bleibt
   "sauber" (nur Wirkungen), die Diagnose ist SL-Sache. Empfänger sind die
   aktiven GMs plus der Besitzer des Wirkers (Muster travel.js
   postWhisperSystemCard); Fallback der auslösende Nutzer. Der Abbruch-
   Hinweis CHAT_NO_NEW_TARGET bleibt bewusst öffentlich (er betrifft das
   gesamte Wirken, nicht nur ein einzelnes übersprungenes Ziel). */
async function postAuraSkipDiagCard(functionStuff, skipLines, titleKey) {
  const titleHtml = `<h4>${game.i18n.format(titleKey, { powername: functionStuff.abilityName })}</h4>`;
  const body = skipLines.map((line) => `<div class="finalTxt">${line}</div>`).join("");
  const html = `<div class="symbaroum chat ability">
    <div class="foreground">
      ${titleHtml}
      ${body}
    </div>
  </div>`;
  const targets = new Map();
  for (const user of game.users) {
    if (user.active && user.isGM) targets.set(user.id, user.id);
  }
  const owners = await getOwnerPlayer(functionStuff.actor);
  for (const user of owners) targets.set(user.id, user.id);
  if (targets.size === 0) targets.set(game.user.id, game.user.id);
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({
      alias: game.user.name,
      actor: functionStuff.actor.id,
    }),
    content: html,
    whisper: [...targets.values()],
  });
}

/* A24: Anathema nullifies the ongoing effects of a power on a being. Per GRW
   the probe is rolled against the RESOLUTE OF THE ORIGINATOR ("Die Resolute
   des Mystikers, der die Kraft entfesselt hat, wird als Widerstand bei der
   Probe verwendet"), snapshotted in the effect's flagData at casting time
   (casterResolute, A24-G1 - the originator actor may no longer exist). One
   probe per originator (A24-G2): the dialog roll against the first
   originator's willpower counts as their probe; every further originator is
   probed separately. A success removes all effects tagged with that
   originator on the target via the GM card, a failure leaves them in place.
   Targets without tagged effects are probed against the default 11 of an
   unknown originator, removal then stays with the GM (A24-G3). Returns null
   when nothing is tagged (G3), otherwise whether any dispel probe failed
   (drives the Adept chain). Master level (summoned effects and creatures)
   and rituals remain GM territory, in line with the A23 K6 philosophy. */
function anathemaGroups(targetActor) {
  const groups = new Map();
  if (!targetActor) return groups;
  for (const effect of targetActor.effects) {
    const flagData = effect.getFlag(game.system.id, "flagData");
    // A24-F2: legacy A23-F1 symbols ({caster, ability} without a resolute
    // snapshot) are included at the default 11 of an unknown originator
    if (!flagData?.caster) continue;
    const statusId = Array.from(effect.statuses)[0];
    const statusEffect = statusId ? CONFIG.statusEffects.find((e) => e.id === statusId) : null;
    if (!statusEffect) continue;
    let group = groups.get(flagData.caster);
    if (!group) {
      group = { resolute: flagData.resolute ?? 11, name: flagData.casterName ?? flagData.caster, effects: [] };
      groups.set(flagData.caster, group);
    }
    group.effects.push(statusEffect);
  }
  return groups;
}

/* A24-F3 (test round 3): with several originators the card shows the WEAKEST
   one (lowest snapshotted willpower) - the dialog roll runs against that
   value; every further originator keeps its own probe in anathemaDispel
   (Rudolf's decision: one probe per originator, weakest displayed). Ties in
   willpower resolve to the first group in effect order. */
function anathemaPrimaryGroup(groups) {
  let primary = null;
  for (const group of groups.values()) {
    if (!primary || group.resolute < primary.resolute) primary = group;
  }
  return primary;
}

/* A24-F2: pseudo-actor for the Anathema rolls - the probe runs against the
   originator's snapshotted willpower and is displayed with the originator's
   name; a target without tagged effects is probed against the default 11 of
   an unknown originator. getAttributeValue reads
   system.attributes.resolute.total, getAttributeLabel localizes
   system.attributes.resolute.label - plain strings pass through verbatim. */
function anathemaResistActor(targetActor) {
  const first = anathemaPrimaryGroup(anathemaGroups(targetActor));
  return {
    system: {
      attributes: {
        resolute: {
          total: first ? first.resolute : 11,
          label: first
            ? `${game.i18n.localize("ATTRIBUTE.RESOLUTE")} (${first.name})`
            : game.i18n.localize("ATTRIBUTE.RESOLUTE_UNKNOWN_ORIGINATOR"),
        },
      },
    },
  };
}

async function anathemaDispel(functionStuff, flagDataArray, rollData) {
  const targetActor = functionStuff.targetData.token?.actor;
  const groups = anathemaGroups(targetActor);
  if (groups.size === 0) return null;

  const rolls = [];
  const lines = [];
  let anyFailed = false;
  const title = `<h4>${game.i18n.localize("POWER_ANATHEMA.DISPEL_SUMMARY")}</h4>`;
  // A24-F3: the dialog roll was made against the weakest originator - that
  // group consumes it; every further originator gets its own probe (G2)
  const primary = anathemaPrimaryGroup(groups);
  for (const group of groups.values()) {
    // A24-F2: the dialog roll against the originator's willpower IS the probe
    // for the primary originator; further originators are probed here with a
    // pseudo-actor carrying their own snapshot value (A24-G2)
    let dispelled;
    if (group === primary && rollData?.[0]) {
      dispelled = rollData[0].trueActorSucceeded;
    } else {
      const originator = {
        system: {
          attributes: {
            resolute: {
              total: group.resolute,
              label: `${game.i18n.localize("ATTRIBUTE.RESOLUTE")} (${group.name})`,
            },
          },
        },
      };
      const roll = await baseRoll(
        functionStuff.actor,
        functionStuff.castingAttributeName,
        originator,
        "resolute",
        functionStuff.favour,
        functionStuff.modifier,
        false
      );
      rolls.push(...(roll.rolls ?? []));
      dispelled = roll.trueActorSucceeded;
    }
    lines.push(
      `<p>${game.i18n.format(dispelled ? "POWER_ANATHEMA.DISPEL_BREAKS" : "POWER_ANATHEMA.DISPEL_HOLDS", {
        originatorname: group.name,
        targetname: functionStuff.targetData?.name ?? "",
      })}</p>`
    );
    if (dispelled) {
      for (const effect of group.effects) {
        flagDataArray.push({ tokenId: functionStuff.targetData.tokenId, removeEffect: effect });
      }
    } else {
      anyFailed = true;
    }
  }
  await postMaintainChainCard(functionStuff, title, lines, rolls);
  return anyFailed;
}

export function checkSpecialResistanceMod(damageReductions, autoParams = "", abilityRef) {
  let favour = 0;
  let modifier = 0;
  let dmgavoiding = false;
  for (let i = 0; i < damageReductions.length; i++) {
    if (damageReductions[i].powers) {
      if (damageReductions[i].powers.includes(abilityRef)) {
        if (damageReductions[i].type === game.symbaroum.config.TYPE_FAVOUR) {
          favour = damageReductions[i].favourMod;
          autoParams += damageReductions[i].label + ", ";
        } else if (damageReductions[i].type === game.symbaroum.config.TYPE_ROLL_MOD) {
          autoParams += damageReductions[i].label + "(" + damageReductions[i].value + "), ";
          modifier += damageReductions[i].modifier;
        } else if (damageReductions[i].type === game.symbaroum.config.TYPE_DMG_AVOIDING) {
          autoParams += damageReductions[i].label + ", ";
          dmgavoiding = true;
        }
      }
    }
  }
  return {
    favour: favour,
    modifier: modifier,
    dmgavoiding: dmgavoiding,
    autoParams: autoParams,
  };
}

/* This function applies damage reduction (Undead trait, swarm...) to the final damage */
async function mathDamageProt(targetActor, damage, damageType = {}) {
  async function damageReductionText(value) {
    if (value != 1) {
      return " (x" + value + ")";
    } else return "";
  }
  let finalDamage = Math.max(0, damage);
  let infoText = "";
  if (damageType.holy) {
    finalDamage = Math.round(finalDamage * targetActor.system.combat.damageProt.holy);
    infoText = await damageReductionText(targetActor.system.combat.damageProt.holy);
  } else if (damageType.elemental) {
    finalDamage = Math.round(finalDamage * targetActor.system.combat.damageProt.elemental);
    infoText = await damageReductionText(targetActor.system.combat.damageProt.elemental);
  } else if (damageType.mysticArm) {
    finalDamage = Math.round(finalDamage * targetActor.system.combat.damageProt.mysticArm);
    infoText = await damageReductionText(targetActor.system.combat.damageProt.mysticArm);
  } else if (damageType.mysticIgnArm) {
    finalDamage = Math.round(finalDamage * targetActor.system.combat.damageProt.mysticIgnArm);
    infoText = await damageReductionText(targetActor.system.combat.damageProt.mysticIgnArm);
  } else if (damageType.mysticalWeapon) {
    finalDamage = Math.round(finalDamage * targetActor.system.combat.damageProt.mysticalWeapon);
    infoText = await damageReductionText(targetActor.system.combat.damageProt.mysticalWeapon);
  } else if (damageType.bleeding) {
    finalDamage = Math.round(finalDamage * targetActor.system.combat.damageProt.bleeding);
    infoText = await damageReductionText(targetActor.system.combat.damageProt.bleeding);
  } else {
    finalDamage = Math.round(finalDamage * targetActor.system.combat.damageProt.normal);
    infoText = await damageReductionText(targetActor.system.combat.damageProt.normal);
  }
  // Kraefte-Paket 1 (Baustein A, Feuerseele - Rudolfs Baufreigabe
  // 21.11., Entscheidung 4): Feuer-Ruestungsbonus PARALLEL zur
  // Multiplikator-Kette. Novize +1W6 / Adept +1W10 Schutz gegen
  // Feuerschaden (NSC-Fixwerte 3/5 nach Systemkonvention, Muster
  // Schutzrunen-NPC-Boni). MEISTER (Raw): KEIN Feuerschaden -
  // stattdessen Heilung um die Haelfte des erlittenen Feuerschadens;
  // die Heilung wird als firesoulHeal zurueckgegeben und vom Aufrufer
  // ueber die GM-Anwenden-Karte gebucht.
  const fireSoulLevel = damageType.fire ? firesoulActiveLevel(targetActor) : 0;
  if (fireSoulLevel > 0) {
    if (fireSoulLevel >= 3) {
      const fireHeal = Math.floor(finalDamage / 2);
      finalDamage = 0;
      infoText += " " + game.i18n.format("POWER_FIRESOUL.CHAT_MASTER_HEAL", { count: fireHeal });
      return { damage: 0, text: infoText, firesoulHeal: fireHeal };
    }
    if (targetActor?.type === "character") {
      const fireProtRoll = await new Roll(fireSoulLevel >= 2 ? "1d10" : "1d6").evaluate();
      finalDamage = Math.max(0, finalDamage - fireProtRoll.total);
      infoText += " " + game.i18n.format("POWER_FIRESOUL.CHAT_PROTECTION", { count: fireProtRoll.total });
    } else {
      const npcFireProt = fireSoulLevel >= 2 ? 5 : 3;
      finalDamage = Math.max(0, finalDamage - npcFireProt);
      infoText += " " + game.i18n.format("POWER_FIRESOUL.CHAT_PROTECTION", { count: npcFireProt });
    }
  }
  // S2.1 (P4 Feuer-Paket, Rudolfs Freigabe 06.11.2026): Feuergeschmiedet
  // (RAW verifiziert, Vault-Notiz): mystischer +1 Schutz gegen Feuer-
  // schaden — PARALLEL zur Multiplikator-Kette (kein weiterer else-if),
  // damit Feuer-Kräfte mit mysticArm/holy-Marker weiter ihren normalen
  // Schutz-Faktor behalten UND der Feuerschutz obendrauf greift. Der
  // Info-Text erscheint auf der Schadenskarte (Anzeige-Muster „(x2)“).
  if (damageType.fire && hasBoonFireProtection(targetActor)) {
    finalDamage = Math.max(0, finalDamage - 1);
    infoText += " " + game.i18n.localize("BOON.FIRE_PROTECTION_TEXT");
  }
  return { damage: finalDamage, text: infoText };
}

/* Automatisierungspaket "Zweihandkraft" (Rudolf, 28.10., Freigabe per
   Auswahlrunde): Stufe der Fähigkeit im Actor suchen - Ability-Items tragen
   die system.reference ("twohandedforce"), getLevel() liefert Novize=1,
   Adept=2, Meister=3, nicht erlernt=0 */
export function getActorAbilityLevel(actor, reference) {
  const ability = actor?.items?.find((i) => i.system?.reference === reference);
  return ability?.getLevel?.().level ?? 0;
}

/* Kraefte-Paket 1 v1.3 (Rudolfs Baufreigabe 22.11. "Leg los"): Die
   Feuerseele ist ab v1.3 eine MANUELL AKTIVIERBARE Reaktions-Aura
   analog Schutzrunen (Kachel-Klick -> Wuerfeldialog -> Marker bis zur
   Deaktivierung). ALLE Wirkungen - NK-Rueckstoss, Feuerschutzwurf in
   mathDamageProt, Meister: 0 Feuerschaden + halbe Heilung + Distanz-
   Vergeltung, A28-DoT-Feuerschutz je Tick - greifen NUR im aktiven
   Zustand. Diese Funktion ist das EINE Gate: 0 = inaktiv, sonst Stufe
   (Marker-flagData.level schlaegt, Fallback Item-Referenz fuer
   Legacy-Marker ohne Objekt-flagData). */
export function firesoulActiveLevel(actor) {
  if (!actor) return 0;
  const marker = actor.hasCondition?.("firesoul");
  if (!marker) return 0;
  const markerFlagData = marker.getFlag?.(game.system.id, "flagData");
  const level = Number(markerFlagData?.level) || 0;
  if (level >= 1) return level;
  return getActorAbilityLevel(actor, "firesoul");
}

/* schwere Waffe in beiden Waffen-Formen erkennen - die vorverarbeitete
   EC-Struktur (.reference) und das Item (.system.reference) */
export function isHeavyWeapon(weapon) {
  return (weapon?.reference ?? weapon?.system?.reference) === "heavy";
}

/* Bestienkunde v1 (Rudolfs Freigabe 28.10., Auswahlrunde): Bonus-Objekt,
   wenn der Angreifer Bestienkunde Adept/Meister hat, auf dem Item-Blatt
   eine Kategorie gewaehlt hat UND das anvisierte Ziel genau diese
   Kategorie traegt (A36: system.creatureCategory) - sonst null.
   Adept: +1d4 (NPC statisch +2), Meister: +1d6 (NPC statisch +3). */
/* Axtkünstler v1 (Rudolfs Freigabe 29.10.): Waffen-Flag "geeignet für
   Axtkünstler" (system.qualities.axeArtistCompatibility, Qualitäten-Tab
   der Waffe) — deckt beide Waffenformen ab: die vorbereitete EC-Struktur
   (.qualities direkt, actor.system.weapons) und das Item (.system.qualities). */
export function isAxeArtistWeapon(weapon) {
  return !!(weapon?.qualities?.axeArtistCompatibility ?? weapon?.system?.qualities?.axeArtistCompatibility);
}

/* Axtkünstler v1 (Adept): Würfelstufe eine Stufe niedriger — Leiter
   1W12→1W10→1W8→1W6→1W4 (Boden 1W4), NPC-Wert = halbe Stufe aufgerundet.
   Liefert {base, npcBase} oder null bei nicht passendem Wurf-Format. */
export function stepDownDamageDie(formula) {
  const match = /^(\d*)d(\d+)$/.exec((formula ?? "").toString().trim());
  if (!match) return null;
  const ladder = [4, 6, 8, 10, 12];
  const idx = ladder.indexOf(parseInt(match[2]));
  if (idx <= 0) return null;
  const newDie = ladder[idx - 1];
  const count = match[1] === "" ? 1 : parseInt(match[1]);
  // jeder Würfel eine Stufe niedriger; NPC-Statik = Anzahl × halbe Stufe
  return { base: count + "d" + newDie, npcBase: count * Math.ceil(newDie / 2) };
}

/* Axtkünstler v1.1 (Rudolfs Testrunde 1, 29.10.): Der Angriff läuft über
   die AKTIVIERUNG DER WAFFE (analog Zweihandkraft) — die Technik-Auswahl
   (Einfach/Kurzer Hieb/Doppelschlag) sitzt als Radio-Block im Würfeldialog
   (dialog.js), die Ausführungskette läuft automatisch in attackResult.
   Der Fähigkeits-Button informiert nur noch über Status und Weg. */
async function axeArtistButtonInfo(functionStuff) {
  if (!game.settings.get("symbaroum", "combatAutomation")) {
    ui.notifications.warn(game.i18n.localize("ERROR.AXEARTIST_NEEDS_EC"));
    return;
  }
  const actor = functionStuff.actor;
  const flagged = (actor.system.weapons ?? []).filter((w) => w.isActive && w.qualities?.axeArtistCompatibility);
  if (flagged.length === 0) {
    ui.notifications.warn(game.i18n.format("ERROR.NO_AXEARTIST_WEAPON", { name: functionStuff.abilityName ?? "" }));
    return;
  }
  ui.notifications.info(game.i18n.localize("DIALOG.AXEARTIST_INFO"));
}

/* Dreckiger Kampf v1 (Rudolfs Auswahlrunde 29.10.): Fähigkeits-Button =
   reine Info (Muster axeArtistButtonInfo) — die Novizen-Technik wird im
   Würfeldialog der Nahkampfwaffe gewählt, Adept/Meister laufen passiv. */
async function cheapshotButtonInfo(functionStuff) {
  if (!game.settings.get("symbaroum", "combatAutomation")) {
    ui.notifications.warn(game.i18n.localize("ERROR.AXEARTIST_NEEDS_EC"));
    return;
  }
  const actor = functionStuff.actor;
  const melee = (actor.system.weapons ?? []).filter((w) => w.isActive && w.isMelee);
  if (melee.length === 0) {
    ui.notifications.warn(game.i18n.format("ERROR.NO_MELEE_WEAPON", { name: functionStuff.abilityName ?? "" }));
    return;
  }
  ui.notifications.info(game.i18n.localize("DIALOG.CHEAPSHOT_INFO"));
}

export function getBeastloreDamageBonus(actor, targetActor) {
  const ability = actor?.items?.find((i) => i.system?.reference === "beastlore");
  const lvl = ability?.getLevel?.().level ?? 0;
  if (lvl < 2) return null;
  const category = ability?.system?.beastloreCategory ?? "";
  if (!category || !targetActor || game.symbaroum.config.getCreatureCategory(targetActor) !== category) {
    return null;
  }
  const isMaster = lvl >= 3;
  const categoryLabel = game.i18n.localize(game.symbaroum.config.CREATURE_CATEGORY_SELECTION[category]?.label ?? "");
  return {
    damageMod: isMaster ? "+1d6" : "+1d4",
    damageModNPC: lvl,
    label: game.i18n.localize("ABILITY_LABEL.BEAST_LORE") + " " + (isMaster ? "+1d6" : "+1d4") + " (" + categoryLabel + ")",
  };
}

async function attackResult(rollData, functionStuff) {
  let namesForText = { actorname: functionStuff.actingCharName, targetname: functionStuff.targetData?.name ?? "" };
  let damage;
  let hasDamage;
  let targetDies = false;
  let pain = false;
  let flagDataArray = [];
  let damageTot = 0;
  let damageText = "";
  let damageFinalText = "";
  let damageRollMod = "";
  let hasDmgMod = "false";
  let attackNumber = 1;
  let mysticalWeapon = functionStuff.weapon.qualities.mystical;
  let corruptionDmgFormula = "";
  let printCorruption = false;
  let corruptionChatResult = "";
  let corruptionTooltip = "";
  let targetValue = functionStuff.targetData.actor.system.health.toughness.value;
  let targetText = game.i18n.format(functionStuff.targetText ?? "", namesForText);
  if (functionStuff.isAlternativeDamage) {
    targetValue = getAttributeValue(functionStuff.targetData.actor, functionStuff.alternativeDamageAttribute);
  }
  let rolls = [];
  // Automatisierungspaket "Zweihandkraft" (Rudolf, 28.10.): Rueckwaertsschwung-
  // Sammler - der ERSTE verfehlte Angriff dieser Angriffsaktion mit einer
  // schweren Waffe loest den Adept-Effekt aus (Rudolfs Auswahlrunde: nur der
  // erste Fehlschlag pro Angriffsaktion); die Ausfuehrung folgt am Ende von
  // attackResult, nachdem die Karte des urspruenglichen Angriffs liegt
  let returnSwingFired = false;
  // Bestienkunde v1 (Rudolfs Freigabe 28.10.): vollautomatischer
  // Adept/Meister-Bonus nur gegen die auf dem Item-Blatt gewaehlte
  // Kategorie des Ziels (attackResult deckt den EC- UND den klassischen
  // Waffenpfad ab); Verbraucher ist damageRollWithDiceParams (roll.js).
  // Alternative-Schaden-Waffen bleiben draussen wie beim alten Paket.
  // Vorgefundener Fix (29.10.): isReturnSwing-Sperre — sonst wuerde der
  // pur-1W8-Rueckwaertsschwung-Klon den Bonus rechnerisch zurueckholen.
  const beastloreBonus =
    functionStuff.weapon && !functionStuff.isAlternativeDamage && !functionStuff.isReturnSwing
      ? getBeastloreDamageBonus(functionStuff.actor, functionStuff.targetData?.actor)
      : null;
  if (beastloreBonus) {
    functionStuff.beastloreDamageMod = beastloreBonus.damageMod;
    functionStuff.beastloreDamageModNPC = beastloreBonus.damageModNPC;
    functionStuff.beastloreLabel = beastloreBonus.label;
  }
  // Axtkünstler v1.1 (Rudolfs Testrunde 1, 29.10.): Technik-Auswahl kommt
  // jetzt aus dem Würfeldialog des Waffenangriffs (Marker axeArtistNovice
  // bzw. axeArtistDouble). Kurzer Hieb = purer 1W6-Schaden (kurzes Ende,
  // keine Boni — Rückwärtsschwung-Präzedenz), Doppelschlag = beide Schläge
  // eine Würfelstufe niedriger. Meister-Bonus +1d4 auf den ERSTEN TREFFER
  // der Kampfaktion (Rudolfs RAW-Lesart, Testrunde-1-Korrektur): egal
  // welche Technik — auch der Pur-Kurzhieb und der 2. Doppelschlag-Schlag
  // (wenn der 1. verfehlte) zählen, verbraucht pro Aktion (Consumed-Marker,
  // gesetzt erst bei real Damage-Roll im Verbraucher, Klone erben ihn).
  // attackResult deckt den EC- und den klassischen Pfad ab.
  const axeArtistOriginalWeapon = functionStuff.weapon;
  if (functionStuff.axeArtistNovice) {
    functionStuff.weapon = Object.assign({}, functionStuff.weapon, {
      damage: Object.assign({}, functionStuff.weapon.damage, { base: "1d6", npcBase: 3 }),
      qualities: {},
    });
    if (functionStuff.weapon.system) functionStuff.weapon.system = Object.assign({}, functionStuff.weapon.system, { qualities: {} });
    functionStuff.poison = 0;
    functionStuff.damageOverTime = [];
    functionStuff.corruptingattack = "";
    functionStuff.dmgModifier = "";
    functionStuff.dmgModifierNPC = 0;
    functionStuff.dmgModifierAttackSupp = "";
    functionStuff.dmgModifierAttackSuppNPC = 0;
    functionStuff.hasAdvantage = false;
    functionStuff.hallowedBonus = false;
    functionStuff.beastloreDamageMod = null;
    functionStuff.beastloreDamageModNPC = 0;
    functionStuff.beastloreLabel = "";
    functionStuff.introText = functionStuff.introText + game.i18n.localize("COMBAT.CHAT_AXEARTIST_SHORT_END");
  }
  if (functionStuff.axeArtistDouble && !functionStuff.isDoubleSecond) {
    const steppedDie = stepDownDamageDie(functionStuff.weapon.damage.base);
    if (steppedDie) {
      functionStuff.weapon = Object.assign({}, functionStuff.weapon, {
        damage: Object.assign({}, functionStuff.weapon.damage, steppedDie),
      });
    }
    functionStuff.introText = functionStuff.introText + game.i18n.localize("COMBAT.CHAT_AXEARTIST_DOUBLE");
  }
  const axeArtistMasterBonus =
    functionStuff.weapon &&
    !functionStuff.isAlternativeDamage &&
    !functionStuff.isReturnSwing &&
    !functionStuff.axeArtistDamageConsumed &&
    getActorAbilityLevel(functionStuff.actor, "axeartist") >= 3 &&
    isAxeArtistWeapon(axeArtistOriginalWeapon)
      ? true
      : false;
  if (axeArtistMasterBonus) {
    functionStuff.axeArtistDamageMod = "+1d4";
    functionStuff.axeArtistDamageModNPC = 2;
  } else {
    functionStuff.axeArtistDamageMod = null;
    functionStuff.axeArtistDamageModNPC = 0;
  }
  // Dreckiger Kampf v1 (Novize, Rudolfs Auswahlrunde 29.10.): "Fieser
  // Schlag" (Gossenkuss/Goblin-Quetsche) — purer 1W6-Schaden (Pur-Klon
  // Muster Kurzer Hieb: keine Waffenboni, Gift/DoT/Boni neutralisiert),
  // bei SCHADEN folgt am Karten-Ende der automatische Freie Angriff mit
  // der ECHTEN Waffe (Präzision-Override, Rudolfs FA-Regel) — OHNE Probe
  // (anders als Axtkünstler-Betäubung; RAW: Schaden reicht). XOR zur
  // Axtkünstler-Technik: sind beide Radios gesetzt, gewinnt der Kurze
  // Hieb (strengeres Pur-Konzept, dokumentierte Festlegung).
  const cheapshotOriginalWeapon = functionStuff.weapon;
  if (functionStuff.cheapshotNovice && !functionStuff.axeArtistNovice) {
    functionStuff.weapon = Object.assign({}, functionStuff.weapon, {
      damage: Object.assign({}, functionStuff.weapon.damage, { base: "1d6", npcBase: 3 }),
      qualities: {},
    });
    if (functionStuff.weapon.system) functionStuff.weapon.system = Object.assign({}, functionStuff.weapon.system, { qualities: {} });
    functionStuff.poison = 0;
    functionStuff.damageOverTime = [];
    functionStuff.corruptingattack = "";
    functionStuff.dmgModifier = "";
    functionStuff.dmgModifierNPC = 0;
    functionStuff.dmgModifierAttackSupp = "";
    functionStuff.dmgModifierAttackSuppNPC = 0;
    functionStuff.hasAdvantage = false;
    functionStuff.hallowedBonus = false;
    functionStuff.beastloreDamageMod = null;
    functionStuff.beastloreDamageModNPC = 0;
    functionStuff.beastloreLabel = "";
    functionStuff.introText = functionStuff.introText + game.i18n.localize("COMBAT.CHAT_CHEAPSHOT_STRIKE");
  }

  for (let rollDataElement of rollData) {
    rolls = rolls.concat(rollDataElement.rolls);

    rollDataElement.finalText = "";
    rollDataElement.resultText = functionStuff.actingCharName + game.i18n.localize("COMBAT.CHAT_SUCCESS") + functionStuff.targetData.name;
    // Automatisierungspaket 1 (28.10.): 6-stufige Benennung - das Etikett
    // folgt der Wirkungsstufe (Kritischer Erfolg/Außergewöhnlicher Erfolg/
    // Patzer) statt der schlichten Krit-Flag; die resistRoll-Perspektiv-
    // drehung (Etikett gehoert dem Wuerfelnden) steckt in
    // getRollResultLevelKey (roll.js). Der schlichte Erfolg/Fehlschlag
    // bleibt ohne Zusatzetikett.
    const faLevelKey = getRollResultLevelKey(rollDataElement, functionStuff.resistRoll);
    if (faLevelKey !== "CHAT.SUCCEED" && faLevelKey !== "CHAT.FAILED") {
      rollDataElement.resultText += " - " + game.i18n.localize(faLevelKey);
    }
    if (functionStuff.weapon.qualities.jointed && !rollDataElement.trueActorSucceeded && rollDataElement.diceResult % 2 != 0) {
      rollDataElement.resultText = game.i18n.localize("COMBAT.CHAT_JOINTED_SECONDARY");
    } else if (rollDataElement.trueActorSucceeded) {
      // A36-Verbraucher (Geweiht, APG): a hallowed weapon probes the wounded
      // target's corruption - thoroughly corrupt creatures fail automatically
      // (total corruption >= corruption max, isThoroughlyCorruptTarget with
      // Rudolf's corrected total-value reading), creatures with zero
      // corruption pass automatically (no roll), everything else rolls 1d20
      // and fails on a result <= its TOTAL corruption. A failed probe flags
      // +1d4 onto the damage roll (damageRollWithDiceParams, NPC attacker +2).
      // A36V test round (Rudolf, 25.10., Befund 2): targets of the monster
      // category ABOMINATION always take the bonus - no probe, no corruption
      // needed; undead keep running through the probe (no category shortcut,
      // undead are not abominations). Alternative-damage weapons
      // (Resolute/mystic damage) stay out, like the other weapon-quality
      // paths; armor quality hallowed is not scripted (SL side, deliberate).
      functionStuff.hallowedBonus = false;
      const hallowedQualities = functionStuff.weapon?.system?.qualities ?? functionStuff.weapon?.qualities;
      if (!functionStuff.isAlternativeDamage && hallowedQualities?.hallowed) {
        const hallowedTarget = functionStuff.targetData.actor;
        const hallowedTotalCorruption =
          Number(hallowedTarget?.system?.health?.corruption?.temporary ?? 0) +
          Number(hallowedTarget?.system?.health?.corruption?.longterm ?? 0) +
          Number(hallowedTarget?.system?.health?.corruption?.permanent ?? 0);
        if (
          game.symbaroum.config.isCreatureCategory(hallowedTarget, "abomination") ||
          game.symbaroum.config.isThoroughlyCorruptTarget(hallowedTarget)
        ) {
          functionStuff.hallowedBonus = true;
        } else if (hallowedTotalCorruption > 0) {
          const hallowedProbe = await new Roll("1d20").evaluate();
          rolls.push(hallowedProbe);
          functionStuff.hallowedBonus = hallowedProbe.total <= hallowedTotalCorruption;
        }
      }
      hasDamage = true;
      rollDataElement.hasDamage = true;
      damage = await damageRollWithDiceParams(functionStuff, rollDataElement.critSuccess, attackNumber);
      rolls.push(damage.roll);

      attackNumber += 1;
      rollDataElement.dmgFormula = game.i18n.localize("WEAPON.DAMAGE") + ": " + damage.roll._formula;
      rollDataElement.damageTooltip = new Handlebars.SafeString(await damage.roll.getTooltip());
      damageRollMod = game.i18n.localize("COMBAT.CHAT_DMG_PARAMS") + damage.autoParams;
      hasDmgMod = damage.autoParams.length > 0 ? true : false;
      //damage reduction (Undead trait, swarm...)
      let finalDmg = await mathDamageProt(functionStuff.targetData.actor, damage.roll.total, { mysticalWeapon: mysticalWeapon });
      // pain (damage > toughness treshold)
      pain = pain || checkPainEffect(functionStuff, finalDmg.damage);
      rollDataElement.dmg = finalDmg.damage;
      rollDataElement.dmgFormula += finalDmg.text;
      if (functionStuff.corruptingattack != "" && rollDataElement.dmg > 0) {
        if (corruptionDmgFormula != "") corruptionDmgFormula += "+";
        corruptionDmgFormula += functionStuff.corruptingattack;
        printCorruption = true;
      }
      rollDataElement.damageText = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_DAMAGE") + rollDataElement.dmg.toString();
      damageTot += rollDataElement.dmg;
      if (functionStuff.isAlternativeDamage) {
        rollDataElement.damageText += " (" + game.symbaroum.api.getAttributeLabel(functionStuff.actor, functionStuff.alternativeDamageAttribute) + ")";
      }
    } else {
      rollDataElement.resultText = functionStuff.actingCharName + game.i18n.localize("COMBAT.CHAT_FAILURE");
      // Automatisierungspaket 1: 6-stufige Benennung (siehe oben) - der
      // Freier-Angriff-Hinweis haengt nur an der bestätigten Krit-Stufe,
      // Patzer/Außergewöhnlicher Erfolg (unbestätigt) bleiben ohne Effekt
      const faLevelKey = getRollResultLevelKey(rollDataElement, functionStuff.resistRoll);
      if (faLevelKey !== "CHAT.SUCCEED" && faLevelKey !== "CHAT.FAILED") {
        rollDataElement.resultText += " - " + game.i18n.localize(faLevelKey);
        if (rollDataElement.critFail) {
          //critFail is in the attackers perspective, so it means the defenser gets a free attack
          if (functionStuff.resistRoll) {
            rollDataElement.resultText += " : " + game.i18n.localize("CHAT.CRITICAL_FREEATTACK");
          } else {
            rollDataElement.resultText += " : " + game.i18n.localize("CHAT.CRITICAL_FAILURE_FREEATTACK");
          }
        }
      }
      // Automatisierungspaket "Zweihandkraft" (GRW-Adept, Rudolfs
      // Auswahlrunde 28.10.): verfehlter Angriff mit schwerer Waffe ->
      // Rueckwaertsschwung. KEIN Rueckwaertsschwung bei Rohwurf 20 (Patzer
      // und Kritischer Patzer, Rudolfs Festlegung), beim Freien Angriff
      // (Rudolfs Festlegung: nur reguliere Angriffsaktionen), bei
      // alternativem Schaden und im Widerstandsprobe-Fluss (der Ziel-Spieler
      // wuerfelt selbst, asynchroner Button-Pfad) - und nie fuer den
      // Rueckwaertsschwung selbst (Rekursionssperre). Nur der ERSTE
      // Fehlschlag pro Angriffsaktion zaehlt.
      if (
        !returnSwingFired &&
        !functionStuff.isReturnSwing &&
        !functionStuff.freeAttack &&
        // Axtkünstler v1.1 (Rudolfs Testrunde 1, Punkt 6): der Rückwärtsschwung
        // bleibt dem EINFACHEN Schlag vorbehalten — Kurzer Hieb und
        // Doppelschlag (inkl. 2. Schlag, Marker wird vererbt) lösen ihn nie aus
        !functionStuff.axeArtistNovice &&
        !functionStuff.axeArtistDouble &&
        !functionStuff.isAlternativeDamage &&
        !functionStuff.resistRoll &&
        rollDataElement.diceResult !== 20 &&
        isHeavyWeapon(functionStuff.weapon) &&
        getActorAbilityLevel(functionStuff.actor, "twohandedforce") >= 2
      ) {
        returnSwingFired = true;
      }
    }
  }
  if (damageTot <= 0) {
    damageTot = 0;
    damageFinalText = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_DAMAGE_NUL");
  } else {
    if (damageTot >= targetValue) {
      targetDies = true;
      // A25 F11: Foundry V14 API - Combat#getCombatantByToken is deprecated
      // (V15 removes it), getCombatantsByToken returns the matching combatants
      if (ui.combat.viewed && (ui.combat.viewed.getCombatantsByToken(functionStuff.targetData.tokenId) ?? []).length > 0) {
        flagDataArray.push({
          tokenId: functionStuff.targetData.tokenId,
          defeated: true,
        });
      } else {
        flagDataArray.push({
          tokenId: functionStuff.targetData.tokenId,
          addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "dead")),
          overlay: true,
          effectDuration: 1,
        });
      }
      damageFinalText = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_DAMAGE_DYING");
    } else if (pain) {
      damageFinalText = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_DAMAGE_PAIN");
      flagDataArray.push({
        tokenId: functionStuff.targetData.tokenId,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "prone")),
        effectDuration: 1,
      });
    }
    if (functionStuff.isAlternativeDamage) {
      flagDataArray.push({
        tokenId: functionStuff.targetData.tokenId,
        attributeChange: damageTot * -1,
        attributeName: functionStuff.alternativeDamageAttribute,
      });
    } else {
      flagDataArray.push({
        tokenId: functionStuff.targetData.tokenId,
        toughnessChange: damageTot * -1,
      });
    }
  }

  if (printCorruption) {
    let corruptionRoll = await new Roll(corruptionDmgFormula).evaluate();
    rolls.push(corruptionRoll);
    corruptionChatResult = game.i18n.localize("COMBAT.CHAT_CORRUPTED_ATTACK") + corruptionRoll.total.toString();
    corruptionTooltip = new Handlebars.SafeString(await corruptionRoll.getTooltip());
    // Elixiere v1.5: Rollzeit-Check entfernt - die Karte kommt im GM-Apply-Pfad
    // (hooks.js) bei tatsaechlicher Anwendung.
    flagDataArray.push({
      tokenId: functionStuff.targetData.tokenId,
      corruptionChange: corruptionRoll.total,
    });
  }

  if (functionStuff.targetData.autoParams != "") {
    functionStuff.targetData.targetText += ": " + functionStuff.targetData.autoParams;
  }
  let templateData = {
    rollData: rollData,
    targetData: functionStuff.targetData,
    hasTarget: functionStuff.targetData.hasTarget,
    introText: functionStuff.introText,
    introImg: functionStuff.actingCharImg,
    targetText: targetText,
    subText: await mm2WeaponSubText(functionStuff.weapon),
    subImg: functionStuff.weapon.img,
    hasRoll: true,
    resistRoll: functionStuff.resistRoll,
    resistRollText: functionStuff.resistRollText,
    hasCorruption: false,
    rigged: rollData[0]?.rigged ?? 0,
    rollString: await formatRollString(rollData[0], functionStuff.targetData.hasTarget, rollData[0].modifier, { freeModifier: functionStuff.freeModifier ?? 0, boonLineChain: functionStuff.boonLineChain ?? [] }),
    hasDamage: hasDamage,
    hasDmgMod: hasDmgMod,
    damageRollMod: damageRollMod,
    damageText: damageText,
    damageFinalText: damageFinalText,
    printPoison: false,
    poisonRollString: "",
    poisonRollResultString: "",
    poisonChatIntro: "",
    poisonChatResult: "",
    poisonToolTip: "",
    // Axtkünstler v1 (Novize): Betäubungs-Probe [Präzision<-Willenskraft]
    // läuft INLINE in derselben Karte (Gift-Muster)
    printAxeArtistStun: false,
    axeArtistStunIntro: "",
    axeArtistStunRollString: "",
    axeArtistStunChat: "",
    axeArtistStunToolTip: "",
    // Dreckiger Kampf v1 (Adept): Stolpern/Grätsche-Probe
    // [Scharfsinn←Gewandtheit] läuft INLINE in derselben Karte
    printCheapshotProne: false,
    cheapshotProneIntro: "",
    cheapshotProneRollString: "",
    cheapshotProneChat: "",
    cheapshotProneToolTip: "",
    // Elixier-Automatisierung v1 (alchemistische Munition): Betaeubungs-
    // bolzen-Probe [Staerke-Schaden] laeuft INLINE in derselben Karte
    // (Betaeubungs-Probe-Muster) + Treffpfeil-Hinweiszeile
    printStunBolt: false,
    stunBoltIntro: "",
    stunBoltRollString: "",
    stunBoltChat: "",
    stunBoltToolTip: "",
    printAmmoEffectHint: false,
    ammoEffectHintText: "",
    printBleed: false,
    bleedChat: "",
    printFlaming: false,
    flamingChat: "",
    printAcid: false,
    acidChat: "",
    acidCarrierRisk: false,
    printCorruption: printCorruption,
    corruptionChatResult: corruptionChatResult,
    corruptionTooltip: corruptionTooltip,
  };
  // Gift v1.1 (Rudolfs Testrunde v1, 08.11.2026): P4 - anhaltende
  // Dosen-Beschichtung (Actor-Flag weaponCoat). Eine im Wuerfeldialog
  // gewaehlte Inventar-Dosis beschichtet die Waffe DAUERHAFT: Das Gift
  // bleibt auf der Klinge, bis eine Vergiftung gelingt - auch Treffer
  // in SPAETEREN Runden tragen es automatisch (hier angewendet, der
  // Coating-Block unten macht Karte/Probe/B1-Treppe/Verbrauch). Die
  // Dosis wird erst bei gelungener Vergiftung vergebucht und die Klinge
  // bleibt beschichtet, solange der Stapel Dosen hat; "Kein Gift" im
  // Dialog wischt sie ab (poisonChoice "none" = bewusster Opt-out).
  // P6 - die aktive SZENEN-Beschichtung (Condition poisoncoat) wirkt
  // jetzt zuverlaessig pro Angriff OHNE erneutes Auswaehlen: Ohne
  // explizite Gift-Wahl wird sie hier automatisch angewendet (Auto-
  // Apply); eine anhaltende Dosen-Beschichtung hat Vorrang, explizite
  // Auswahlen (Dosis/Eigengift) bleiben unberuehrt.
  if (functionStuff.poisonChoice !== "none") {
    if (!functionStuff.poison && !functionStuff.poisonCoating) {
      const pendingCoat = getPendingWeaponCoat(functionStuff.actor);
      if (pendingCoat) {
        functionStuff.poisonCoating = pendingCoat;
      } else {
        const coatGrade = getActivePoisonCoatGrade(functionStuff.actor);
        if (coatGrade > 0) {
          functionStuff.poison = coatGrade;
          functionStuff.poisonChosen = coatGrade;
          functionStuff.poisonFromCoat = true;
          functionStuff.autoParams += game.i18n.localize("DIALOG.POISON_COAT_PARAM") + ", ";
        }
      }
    }
    // Gift v1.1 P6a: Die Meister-Aufwertung der Waffen-Beschichtung
    // (Gift +1 Stufe, bereits starkes Gift stattdessen GUNST) wirkt
    // zentral hier - die Gunst bewusst NUR auf die GIFTPROBE
    // (poisonProbeFavour, weiter unten im Gift-Gate), nicht mehr auf
    // den Angriffswurf (Rudolfs P6-Befund: ecData.favour traf vorher
    // die Angriffsprobe). Der Faehigkeitswurf-Pfad (usePoison) behaelt
    // seine eigene Meister-Logik - dort IST der Wurf die Giftprobe.
    if (functionStuff.poison > 0 && functionStuff.poisonChosen > 0 && getActorAbilityLevel(functionStuff.actor, "poisoner") >= 3) {
      if (functionStuff.poison < 3) {
        functionStuff.poison = functionStuff.poison + 1;
        functionStuff.autoParams += game.i18n.localize("DIALOG.POISON_MASTER_UPGRADE_PARAM") + ", ";
      } else {
        functionStuff.poisonProbeFavour = (functionStuff.poisonProbeFavour ?? 0) + 1;
        functionStuff.autoParams += game.i18n.localize("DIALOG.POISON_MASTER_FAVOUR_PARAM") + ", ";
      }
    } else if (functionStuff.poisonCoating && getActorAbilityLevel(functionStuff.actor, "poisoner") >= 3) {
      /* Gift v1.2 (Rudolfs v1.1-Runde, P6/P7 - "In Karte wird nur ein
         Wurf angezeigt bei Vergiftungsprobe, keine Gunst erkennbar"):
         URSPRUNG DES BEFUNDES - die Meister-Aufwertung griff bisher NUR
         im Vergifter-Pfad (functionStuff.poison > 0), die ANHALTENDE
         Dosen-Beschichtung (poisonCoating) lief immer ohne Meister-
         Logik durch den Coating-Block. Ab jetzt wirkt der Meister auch
         auf der beschichteten Klinge: Grad-2-Dosis wird auf die Grad-3-
         Wuerfelleiter (1d8) aufgewertet (B2-Gradmodell, Dauer = Dosen-
         Formel unberuehrt - B1-"Zeitrahmen"-Praezedenz), eine STARKE
         Grad-3-Dosis erhaelt stattdessen GUNST auf die Beschichtungs-
         probe (coatingProbeFavour, 2 Wuerfel, besserer zaehlt). Die
         Karte zeigt die Meister-Zeile im subText und die Gunst als
         Würfelpaar in der Ergebniszeile. Grad 0 (alte Flags ohne
         ableitbares Dosen-Item): kein Meister-Effekt (Limitierung). */
      const coatGrade = Math.min(3, Math.max(0, Math.round(Number(functionStuff.poisonCoating.grade) || 0)));
      if (coatGrade === 3) {
        functionStuff.coatingProbeFavour = (functionStuff.coatingProbeFavour ?? 0) + 1;
        functionStuff.autoParams += game.i18n.localize("DIALOG.POISON_MASTER_FAVOUR_PARAM") + ", ";
      } else if (coatGrade >= 1) {
        functionStuff.poisonCoating = Object.assign({}, functionStuff.poisonCoating, {
          formula: game.symbaroum.config.POISON_GRADE_DAMAGE[coatGrade + 1] ?? functionStuff.poisonCoating.formula,
          masterUpgraded: true,
        });
        functionStuff.autoParams += game.i18n.localize("DIALOG.POISON_MASTER_UPGRADE_PARAM") + ", ";
      }
    }
  }
  // A28 fix (Rudolfs Testrunde): the Giftbeschichtet weapon quality had no
  // code path at all - a weapon with the quality auto-selects a light poison
  // dose so the established GRW opposed-roll model applies (cunning vs strong,
  // then 1d4/round for 1d4 rounds via the dot engine, NOTEXTEND for already
  // poisoned targets). An explicit pick in the dialog's poison select still
  // wins, so medium/strong doses remain available. Covers both weapon shapes:
  // EC weapon data (.qualities) and a picked Item (.system.qualities).
  // Gift v1.1: bei AKTIVER Beschichtung (anhaengende Dosis oder gewaehlte
  // Dosis) fuehrt die Klinge genau EIN Gift - die Qualitaet tritt zurueck
  // (kein Doppel-DoT, gerade jetzt beim Auto-Apply relevant).
  if (!functionStuff.poison && !functionStuff.poisonCoating && (functionStuff.weapon?.system?.qualities ?? functionStuff.weapon?.qualities)?.poison) {
    functionStuff.poison = 1;
    functionStuff.autoParams += game.i18n.localize("QUALITY.POISON") + ", ";
  }
  /* Konzept Runde 3 Teil A (Knochengeschoss Meister + Giftig): Muster
     Giftbeschichtet-Guess - der Knochengeschoss-Meister fuehrt das
     Giftig-Merkmal des Akteurs automatisch auf dem Projektil mit
     (Vault-Steckbrief); explizite Giftwahl/Beschichtung im Dialog bleibt
     vorrangig, Immunitaet und 0-Schaden greifen erst im Gift-Block. */
  const mm2BoneWeaponRef = functionStuff.weapon?.system?.reference ?? functionStuff.weapon?.reference;
  if (mm2BoneWeaponRef === "boneprojectile" && !functionStuff.poison && !functionStuff.poisonCoating && damageTot > 0) {
    if (getActorAbilityLevel(functionStuff.actor, "boneprojectile") >= 3) {
      const mm2BonePoisonousLvl = getActorAbilityLevel(functionStuff.actor, "poisonous");
      if (mm2BonePoisonousLvl > 0) {
        functionStuff.poison = mm2BonePoisonousLvl;
        functionStuff.poisonFixedValues = true;
        functionStuff.autoParams += game.i18n.localize("TRAIT_LABEL.POISONOUS") + ", ";
      }
    }
  }
  if (functionStuff.autoParams != "") {
    templateData.subText += ", " + functionStuff.autoParams;
  }

  if (functionStuff.poison > 0 && !targetDies && damageTot > 0 && functionStuff.targetData.actor.system.combat.damageProt.poison) {
    // Gift v1 B1: Giftresistent senkt schwaches Gift (Grad 1) auf 0 Schaden,
    // das Gift wird analog Antidot vollstaendig neutralisiert (Rudolfs
    // Rueckmeldung 2.11.). Da die Neutralisierung vor der Probe feststeht,
    // entfaellt die Giftprobe komplett; moderat/stark laufen mit gesenkter
    // Schadensstufe durch poisonCalc (Dauer unberuehrt).
    if (hasPoisonResilient(functionStuff.targetData.actor) && functionStuff.poison <= 1) {
      templateData.printPoison = true;
      templateData.poisonChatIntro = functionStuff.actingCharName + game.i18n.localize("COMBAT.CHAT_POISON") + functionStuff.targetData.name;
      templateData.poisonChatResult = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_POISON_RESILIENT_NEUTRALIZED");
      /* v1.7 (P10): combat.hbs rendert bei resistRoll true die
         poisonResistRollText-Zeile - im Abkuerzungspfad fehlte das
         Feld, removeMarkup crashte an undefined und riss die ganze
         Angriffskarte mit (Spieler-Verteidigung). Wert wie poisonCalc. */
      templateData.poisonResistRollText = functionStuff.targetData.name + game.i18n.localize("ABILITY.RESIST_ROLL");
    } else {
      let targetResMod = checkSpecialResistanceMod(functionStuff.targetData.actor.system.combat.damageReductions, functionStuff.targetData.autoParams, "poisoner");
      // Gift v1.1 P6a: Gunst des Meister-Coats NUR auf die Giftprobe
      let poisonFavour = targetResMod.favour + (functionStuff.poisonProbeFavour ?? 0);
      functionStuff.targetData.autoParams += targetResMod.autoParams;
      let poisonRoll = await baseRoll(functionStuff.actor, "cunning", functionStuff.targetData.actor, "strong", poisonFavour, -1 * targetResMod.modifier, functionStuff.resistRoll);
      let poisonFunctionStuff = Object.assign(functionStuff, { modifier: -1 * targetResMod.modifier, favour: poisonFavour });
      let poisonRes = await poisonCalc(poisonFunctionStuff, poisonRoll);
      // Gift v1: nur bei echtem Giftwurf auf die Karte (Neutralisierung via poisonCalc)
      if (poisonRes.roll) rolls.push(poisonRes.roll);
      // Elixiere v1.6: konstanter Gift-Rundenschaden als eigener Wurf auf der Karte
      if (poisonRes.poisonDotRoll) rolls.push(poisonRes.poisonDotRoll);
      if (poisonRes.flagData) flagDataArray.push(poisonRes.flagData);
      templateData = Object.assign(templateData, poisonRes);
    }
  }
  // MM-Paket 1 „Oberflächen-DoT & Gifte" (Rudolfs Baufreigabe 24.11.2026):
  // Angreifer-seitige Nahkampf-Merkmale (Säure-Angriff, Lähmendes Gift,
  // Infektiös) - Säure auf der NATIVEN Säurezeile der Angriffs-Karte
  // (printAcid/acidChat), Proben/Karteninformationen auf einer eigenen
  // Reaktionskarte nach der Angriffs-Karte, Zustands-Einträge in DIESEM
  // flagDataArray (EINE GM-Karte pro Vorgang, v2.7). Kein Aktivierungs-
  // toggle (RAW kennt keine Abwahl, SL löscht Symbole - Feuerseele-Muster).
  const mm1Traits = await mm1AttackerTraits(functionStuff, damageTot, targetDies, rollData, templateData);
  if (mm1Traits.flags.length > 0) {
    flagDataArray.push(...mm1Traits.flags);
  }
  // MM-Paket 2 v1 (Konzept Rev. 2): Angreifer-seitige Reaktions-Merkmale
  // (Erdrueckende Umarmung, Verschlingen, Zerstörer) plus die Greifzunge-/
  // Greifklauen-Rider der Kachel-Klicks und die Blitzschnell-Hinweiszeile
  // - identische Struktur zum MM1-Block (EINE GM-Karte je Vorgang)
  const mm2Traits = await mm2AttackerTraits(functionStuff, damageTot, targetDies, rollData, templateData);
  if (mm2Traits.flags.length > 0) {
    flagDataArray.push(...mm2Traits.flags);
  }
  // Elixiere v1.5 (Gift auftragen, Rudolfs Freigabe 02.11.): Waffenbeschichtung
  // aus dem INVENTAR - der Spieler hat im Wuerfeldialog einen Gift-Dosis-
  // Stapel gewaehlt (dialog.js, 1 Dosis je Angriff abgebucht, Muster
  // Spezialmunition-Opt-in; ecData.poisonCoating). Bei Treffer mit Schaden
  // laeuft die einseitige Probe [Staerke gegen Staerke] des Angreifers
  // (Rudolfs Beschichtungsmodell) INLINE auf der Angriffskarte (Gift-Muster
  // der Karte); bei Gelingen Gift-DoT mit den ITEM-Wirkungsfeldern: Formel
  // aus damagePerRound, Dauer aus rounds, Grad aus poisonGrade bzw. Formel-
  // Rueckschlag (Formel-Tabelle) - inklusive Antidot-Metadaten. Immunitaet
  // (damageProt.poison = 0) und NOTEXTEND (bereits vergiftet) wie beim
  // Waffenqualitaets-Gift. Bewusst UNABHAENGIG vom Giffter-Pfad oben: der
  // gilt weiterhin fuer die virtuellen Dosen des Giffter-Merkmals.
  if (
    functionStuff.poisonCoating &&
    !targetDies &&
    damageTot > 0 &&
    functionStuff.targetData?.hasTarget &&
    rollData.some((r) => r.trueActorSucceeded) &&
    functionStuff.targetData.actor.system.combat.damageProt.poison
  ) {
    if (functionStuff.targetData.actor.hasCondition?.("poison")) {
      templateData.printPoison = true;
      templateData.poisonChatIntro = game.i18n.format("COMBAT.CHAT_POISON_COATING_INTRO", { poison: functionStuff.poisonCoating.name });
      templateData.poisonChatResult = game.i18n.localize("COMBAT.CHAT_POISON_NOTEXTEND");
      /* v1.7 (P10): wie im Neutralisations-Pfad - poisonResistRollText
         fuer die resistRoll-Kartenzeile setzen (removeMarkup-Crash) */
      templateData.poisonResistRollText = functionStuff.targetData.name + game.i18n.localize("ABILITY.RESIST_ROLL");
    } else {
      // Gift v1 B6 (Handbuch der Gifte): +1 auf die Beschichtungsprobe,
      // wenn der Angreifer das Handbuch traegt UND die Faehigkeit
      // Giftmischer besitzt (reine Giftig-Merkmale geben keinen Bonus,
      // das Handbuch ist ein Giftmischer-Werkzeug).
      const manualBonus = hasPoisonManual(functionStuff.actor) && getActorAbilityLevel(functionStuff.actor, "poisoner") > 0 ? 1 : 0;
      /* Gift v1.2 (P7): Gunst des Meister-Giftmischers auf die
         Beschichtungsprobe (2 Wuerfel, besserer zaehlt - der Meister-
         Block oben setzt coatingProbeFavour bei STARKER Grad-3-Dosis;
         die Karte zeigt das Würfelpaar in der Ergebniszeile). */
      const coatingFavour = functionStuff.coatingProbeFavour ?? 0;
      const coatingRoll = await baseRoll(functionStuff.actor, "strong", functionStuff.targetData.actor, "strong", coatingFavour, manualBonus, false);
      rolls.push(...coatingRoll.rolls);
      templateData.printPoison = true;
      templateData.poisonChatIntro = game.i18n.format("COMBAT.CHAT_POISON_COATING_INTRO", { poison: functionStuff.poisonCoating.name });
      templateData.poisonRollString = await formatRollString(coatingRoll, true, manualBonus);
      templateData.poisonRollResultString =
        await formatRollResult(coatingRoll) + (manualBonus ? " " + game.i18n.localize("DIALOG.POISON_MANUAL_PARAM") : "");
      if (coatingRoll.trueActorSucceeded) {
        // Gift v1 B1: Giftresistent senkt die Beschichtungs-Formel eine
        // Stufe (1W8->1W6, 1W6->1W4); 1W4 wird auf 0 gesenkt und das
        // Gift analog Antidot VOLLSTAENDIG neutralisiert (Rudolfs
        // Rueckmeldung 2.11.). Exotische Formeln ausserhalb der Treppe
        // bleiben unberuehrt. Nur der SCHADEN sinkt, die Dauer laeuft
        // normal - hier ist die Dauer aber itemseitig fix definiert.
        let coatFormula = functionStuff.poisonCoating.formula;
        let neutralizedByResilient = false;
        let reducedByResilient = false;
        if (hasPoisonResilient(functionStuff.targetData.actor) && Object.prototype.hasOwnProperty.call(game.symbaroum.config.POISON_COAT_STAIRS, coatFormula)) {
          const stair = game.symbaroum.config.POISON_COAT_STAIRS[coatFormula];
          if (stair === null) neutralizedByResilient = true;
          else if (stair) {
            coatFormula = stair;
            reducedByResilient = true;
          }
        }
        if (neutralizedByResilient) {
          // Kein DoT, keine Runden, keine Dosis-Abbuchung (das Gift
          // kommt gar nicht zur Wirkung).
          templateData.poisonChatResult =
            functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_POISON_RESILIENT_NEUTRALIZED");
        } else {
          const coatingRounds = await new Roll(functionStuff.poisonCoating.roundsFormula).evaluate();
          rolls.push(coatingRounds);
          // Elixiere v1.6 (Rudolfs Antidot-Modell): der Rundenschaden eines
          // Gifts wird bei der Anwendung EINMAL gewuerfelt und bleibt fuer
          // die gesamte Rundenlaufzeit KONSTANT (dot.fixedDamage - die A28-
          // Tick-Engine wendet den Festwert an statt je Runde neu zu wuerfeln;
          // das Antidot senkt genau diesen Wert um 2 Punkte je Stufe).
          const coatingDamage = await new Roll(coatFormula).evaluate();
          rolls.push(coatingDamage);
          templateData.poisonChatResult =
            functionStuff.targetData.name +
            game.i18n.format("COMBAT.CHAT_POISON_COATING_SUCCESS", { damage: coatingDamage.total, rounds: coatingRounds.total }) +
            (reducedByResilient ? game.i18n.localize("COMBAT.CHAT_POISON_RESILIENT_REDUCED") : "");
          // Gift v1 B3: Dosis wird erst bei gelungener Vergiftung
          // abgebucht (consume-on-hit statt consume-on-submit); bei
          // Misslingen oder Neutralisierung bleibt der Vorrat unberuehrt.
          // Gift v1.1 P4: Die anhaltende Beschichtung (Actor-Flag)
          // bleibt danach bestehen, solange der Stapel Dosen hat
          // ("1 Dosis je vergiftetem Treffer"); erst bei leeren
          // Vorrat (oder geloeschtem Item) wird das Flag entfernt.
          if (functionStuff.poisonCoating.itemId) {
            const doseItem = functionStuff.actor.items.get(functionStuff.poisonCoating.itemId);
            if (doseItem) {
              await consumeElixirDose(doseItem);
              if (getItemCount(doseItem) <= 0) await clearPendingWeaponCoat(functionStuff.actor);
            } else {
              await clearPendingWeaponCoat(functionStuff.actor);
            }
          }
          const poisonEffect = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "poison"));
          flagDataArray.push({
            tokenId: functionStuff.targetData.tokenId,
            addEffect: poisonEffect,
            effectDuration: coatingRounds.total,
            dot: {
              label: "QUALITY.POISON",
              formula: coatFormula,
              fixedDamage: coatingDamage.total,
              resource: "toughness",
              damageType: "poison",
              stackable: false,
              separateRoll: false,
            },
            conditionData: {
              poison: {
                damage: coatingDamage.total,
                formula: coatFormula,
                rounds: coatingRounds.total,
                roundsFormula: functionStuff.poisonCoating.roundsFormula,
              },
            },
          });
        }
      } else {
        templateData.poisonChatResult = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_POISON_COATING_RESIST");
      }
    }
  }
  // Axtkünstler v1 (Novize, Rudolfs Freigabe 29.10. — "vollautomatische
  // Kette"): nach einem TREFFER des Kurzen Hiebs läuft die Betäubungs-Probe
  // [Präzision<-Willenskraft] automatisch INLINE in derselben Karte
  // (Gift-Muster); Modifikator/Gunst pur (RAW nennt keine), kein resistRoll.
  // Bei Erfolg folgt am Ende der Karte der automatische Freie Angriff.
  let axeArtistStunned = false;
  if (
    functionStuff.axeArtistNovice &&
    !functionStuff.isAxeArtistFreeAttack &&
    functionStuff.targetData.hasTarget &&
    rollData.some((r) => r.trueActorSucceeded)
  ) {
    const axeArtistProbe = await baseRoll(functionStuff.actor, "accurate", functionStuff.targetData.actor, "resolute", 0, 0, false);
    rolls.push(...axeArtistProbe.rolls);
    axeArtistStunned = axeArtistProbe.trueActorSucceeded;
    templateData.printAxeArtistStun = true;
    templateData.axeArtistStunIntro = game.i18n.localize("COMBAT.CHAT_AXEARTIST_STUN_INTRO");
    templateData.axeArtistStunRollString = await formatRollString(axeArtistProbe, true, 0);
    templateData.axeArtistStunChat =
      functionStuff.targetData.name +
      (axeArtistStunned ? game.i18n.localize("COMBAT.CHAT_AXEARTIST_STUNNED") : game.i18n.localize("COMBAT.CHAT_AXEARTIST_NOT_STUNNED"));
    templateData.axeArtistStunToolTip = axeArtistProbe.toolTip;
  }
  // Dreckiger Kampf v1 (Adept, Rudolfs Auswahlrunde 29.10. — "nur bei
  // NORMALEM Nahkampf-Angriff mit Schaden"): nach einem schaden-
  // verursachenden normalen Nahkampfangriff läuft die Stolpern/Grätsche-
  // Probe [Scharfsinn←Gewandtheit] automatisch INLINE in derselben Karte
  // (Betäubungs-Probe-Muster), Modifikator/Gunst pur (RAW nennt keine).
  // Bei Erfolg fällt das Ziel zu Boden (prone via flagDataArray →
  // GM-Karte, Muster Pain-Effekt). NICHT bei Technik-Angriffen
  // (Fieser Schlag/Kurzer Hieb), nicht bei Freiem Angriff,
  // Rückwärtsschwung, Riposte oder alternativem Schaden.
  // v1.2 (Rudolfs Testrunde-2-Entscheidung 29.10.): feuert JETZT AUCH im
  // NSC→SC-Fluss (resistRoll) — Guard entfernt, konsistent mit dem
  // Axtkünstler-Betäubungs-Block; feuert also nach Auto-Auflösung bzw.
  // nach Spieler-Klick auf die Resist-Schaltfläche.
  if (
    functionStuff.weapon &&
    functionStuff.weapon.isMelee &&
    !functionStuff.cheapshotNovice &&
    !functionStuff.axeArtistNovice &&
    !functionStuff.freeAttack &&
    !functionStuff.isReturnSwing &&
    !functionStuff.isRiposte &&
    !functionStuff.isAlternativeDamage &&
    functionStuff.targetData?.hasTarget &&
    damageTot > 0 &&
    rollData.some((r) => r.trueActorSucceeded) &&
    getActorAbilityLevel(functionStuff.actor, "cheapshot") >= 2
  ) {
    const cheapshotProneProbe = await baseRoll(functionStuff.actor, "cunning", functionStuff.targetData.actor, "quick", 0, 0, false);
    rolls.push(...cheapshotProneProbe.rolls);
    const cheapshotProne = cheapshotProneProbe.trueActorSucceeded;
    templateData.printCheapshotProne = true;
    templateData.cheapshotProneIntro = game.i18n.localize("COMBAT.CHAT_CHEAPSHOT_PRONE_INTRO");
    templateData.cheapshotProneRollString = await formatRollString(cheapshotProneProbe, true, 0);
    templateData.cheapshotProneChat =
      functionStuff.targetData.name +
      (cheapshotProne ? game.i18n.localize("COMBAT.CHAT_CHEAPSHOT_PRONE") : game.i18n.localize("COMBAT.CHAT_CHEAPSHOT_STABLE"));
    templateData.cheapshotProneToolTip = cheapshotProneProbe.toolTip;
    if (cheapshotProne && !targetDies) {
      flagDataArray.push({
        tokenId: functionStuff.targetData.tokenId,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "prone")),
        effectDuration: 1,
      });
    }
  }
  // Elixier-Automatisierung v1 (Rudolfs Freigabe 01.11., "Dann baue v1"):
  // Betaeubungsbolzen (alchemistische Munition, ammoEffect 'stunBolt' -
  // stash aus dem abgebuchten Stapel, ammo.js consumeAmmoForAttack). RAW:
  // "jeder, der von dem Bolzen getroffen wird, muss eine Stärke-[Schaden]-
  // Probe bestehen oder zu Boden fallen; Robust gibt +2 in Stärke pro
  // Stufe". Die Probe laeuft nach einem TREFFER (Schadenshoehe als Modifikator
  // - auch bei durch Ruestung absorbiertem Schaden, dann pur) INLINE in
  // derselben Karte (Betaeubungs-Probe-Muster); Modifikator/Gunst pur, kein
  // resistRoll - die Ziel-Probe ist ein einseitiger Wurf. Misslingen =
  // prone via flagDataArray -> GM-Karte (Stolpern-Muster).
  if (functionStuff.ammoEffect === "stunBolt" && functionStuff.targetData?.hasTarget && !targetDies && rollData.some((r) => r.trueActorSucceeded)) {
    const robustLevel = getActorAbilityLevel(functionStuff.targetData.actor, "robust");
    const stunBoltModifier = -1 * damageTot + 2 * robustLevel;
    const stunBoltProbe = await baseRoll(functionStuff.targetData.actor, "strong", null, null, 0, stunBoltModifier, false);
    rolls.push(...stunBoltProbe.rolls);
    const stunBoltFell = !stunBoltProbe.trueActorSucceeded;
    templateData.printStunBolt = true;
    templateData.stunBoltIntro = game.i18n.format("COMBAT.CHAT_STUNBOLT_INTRO", { name: functionStuff.targetData.name });
    templateData.stunBoltRollString = await formatRollString(stunBoltProbe, false, stunBoltModifier);
    templateData.stunBoltChat =
      functionStuff.targetData.name + (stunBoltFell ? game.i18n.localize("COMBAT.CHAT_STUNBOLT_PRONE") : game.i18n.localize("COMBAT.CHAT_STUNBOLT_STABLE"));
    templateData.stunBoltToolTip = stunBoltProbe.toolTip;
    if (stunBoltFell) {
      flagDataArray.push({
        tokenId: functionStuff.targetData.tokenId,
        addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "prone")),
        effectDuration: 1,
      });
    }
  }
  // Elixier-Automatisierung v1: Treffpfeil (ammoEffect 'seekingArrow') - nur
  // Hinweiszeile auf der Angriffskarte (keine Sichtlinien-Automatisierung,
  // RAW verlangt weiterhin eine normale Angriffsprobe; SL-Angelegenheit).
  if (functionStuff.ammoEffect === "seekingArrow") {
    templateData.printAmmoEffectHint = true;
    templateData.ammoEffectHintText = game.i18n.format("COMBAT.CHAT_SEEKINGARROW_HINT", { ammo: functionStuff.ammoEffectName ?? "" });
  }
  for (let doTime of functionStuff.damageOverTime) {
    if (doTime.effectIcon?.id === "bleeding" && !targetDies && damageTot > 0) {
      templateData.printBleed = true;
      let bleedDamage = doTime.damagePerRound;
      if (!functionStuff.attackFromPC) bleedDamage = doTime.damagePerRoundNPC.toString();
      // A28 G3 (Aderlass, Vault model): 1 point per round, +1 stack per further hit
      // (addCondition), permanent until the symbol is removed; the round/DoT engine
      // applies the damage automatically at the start of the victim's turn
      templateData.bleedChat =
        functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_BLEED") + bleedDamage;
      let finalbleedDmg = await mathDamageProt(functionStuff.targetData.actor, 1, { bleeding: true });
      templateData.bleedChat += finalbleedDmg.text;
      flagDataArray.push({
        tokenId: functionStuff.targetData.tokenId,
        addEffect: doTime.effectIcon,
        dot: {
          label: "QUALITY.BLOODLETTING",
          formula: "1",
          resource: "toughness",
          damageType: "bleeding",
          stackable: true,
          separateRoll: false,
        },
      });
    } else if (doTime.effectIcon?.id === "burning" && hasDamage) {
      let flamingRoundsRoll = 2;
      let flamingRounds = 2;
      let flamingDamage = " 2";
      if (functionStuff.attackFromPC || functionStuff.targetData.actor.type === "monster") {
        flamingRoundsRoll = await new Roll("1d4").evaluate();
        rolls.push(flamingRoundsRoll);
        flamingRounds = flamingRoundsRoll.total;
        flamingDamage = " 1d4";
      }
      flagDataArray.push({
        tokenId: functionStuff.targetData.tokenId,
        addEffect: doTime.effectIcon,
        effectDuration: flamingRounds,
        // A28 Stufe 1: the dot block opts the burning condition into the
        // round/DoT engine - 1d4 (PC attacker / monster target, fixed 2 for NPC
        // attackers like the chat display) fire damage per round at the start of
        // the victim's turn, first tick on its next turn ("round after the hit"),
        // armor is ignored per the Vault (no armor roll in the rules text)
        dot: {
          label: "QUALITY.FLAMING",
          formula: functionStuff.attackFromPC || functionStuff.targetData.actor.type === "monster" ? "1d4" : "2",
          resource: "toughness",
          damageType: "fire",
          stackable: false,
          separateRoll: false,
        },
      });
      templateData.printFlaming = true;
      templateData.flamingChat =
        functionStuff.targetData.name +
        game.i18n.localize("COMBAT.CHAT_FLAMING_SUCCESS1") +
        flamingDamage +
        game.i18n.localize("COMBAT.CHAT_POISON_SUCCESS2") +
        flamingRounds.toString();
      let finalburningDmg = await mathDamageProt(functionStuff.targetData.actor, 2, { elemental: true, fire: true });
      templateData.flamingChat += finalburningDmg.text;
    } else if (doTime.effectIcon?.id === "acid" && hasDamage) {
      // A28 G2: Säurebeschichtet - 1d4 acid damage per round for 1d4 rounds,
      // rolled as a SEPARATE hit each round (Vault); no initial damage, the
      // wielder risk on a natural 20 is a GM hint only (no automation)
      let acidRoundsRoll = 2;
      let acidRounds = 2;
      let acidDamage = " 2";
      if (functionStuff.attackFromPC || functionStuff.targetData.actor.type === "monster") {
        acidRoundsRoll = await new Roll("1d4").evaluate();
        rolls.push(acidRoundsRoll);
        acidRounds = acidRoundsRoll.total;
        acidDamage = " 1d4";
      }
      flagDataArray.push({
        tokenId: functionStuff.targetData.tokenId,
        addEffect: doTime.effectIcon,
        effectDuration: acidRounds,
        dot: {
          label: "QUALITY.ACIDCOATED",
          formula: functionStuff.attackFromPC || functionStuff.targetData.actor.type === "monster" ? "1d4" : "2",
          resource: "toughness",
          damageType: "acid",
          stackable: false,
          separateRoll: true,
        },
      });
      templateData.printAcid = true;
      templateData.acidChat =
        functionStuff.targetData.name +
        game.i18n.localize("COMBAT.CHAT_ACID_SUCCESS1") +
        acidDamage +
        game.i18n.localize("COMBAT.CHAT_POISON_SUCCESS2") +
        acidRounds.toString();
      if (rollData?.[0]?.diceResult === 20) {
        // Vault: on a natural 20 on the attack roll the acid may hit the wielder
        // (reroll compared with Precision) - chat hint for the GM, no automation
        templateData.acidCarrierRisk = true;
      }
    } else if (doTime.effectIcon?.id === "poison" && hasDamage) {
      // A28 fix (Rudolfs Testrunde): display-only member - Giftbeschichtet is
      // NOT applied here but via the GRW opposed-roll poison path above
    }
  }
  // Here
  // Maestro support
  let actorid = functionStuff.actor.id;
  if (functionStuff.attackFromPC) {
    templateData.id = functionStuff.weapon.id;
  } else {
    templateData.id = functionStuff.targetData?.actor?.system.combat.id;
    actorid = functionStuff.targetData?.actor.id;
  }
  // end Maestro support
  // Kräfte-Paket 1 v1.3 (Anhang): Illusorische Korrektur - nur im
  // misslungenen Verteidigungswurf-Fluss mit der Kraft beim Verteidiger.
  // Statt der v1-Taste auf der Karte oeffnet sich NACH der Karte direkt
  // der AKTIVIERUNGS-DIALOG (Rudolfs Entscheidung 3, Auswahlrunde 2) -
  // Frequency/Kosten/Wiederholung macht illusoryCorrectionInvoke.
  const illusoryPayload = illusoryCorrectionPayload(functionStuff, rollData);
  const html = await foundry.applications.handlebars.renderTemplate("systems/symbaroum/template/chat/combat.hbs", templateData);
  const chatData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({
      alias: game.user.name,
      actor: actorid,
    }),
    content: html,
    rolls: [createRollData(rolls)],
    rollMode: game.settings.get("core", "messageMode"),
  };
  ChatMessage.applyMode(chatData, "public");
  let NewMessage = await ChatMessage.create(chatData);
  // MM-Paket 1: Reaktionskarte der Angreifer-Merkmale (Lähmendes Gift/
  // Infektiös-Proben) NACH der Angriffs-Karte (Optik nach Feuerseele-
  // Rückstoß: Wirkung folgt dem auslösenden Treffer in der Chat-Folge)
  if (mm1Traits.reactionCard) {
    await postMaintainChainCard(functionStuff, mm1Traits.reactionCard.titleHtml, mm1Traits.reactionCard.lines, mm1Traits.reactionCard.rolls);
  }
  // MM-Paket 2 v1: Reaktionskarten der MM2-Merkmale NACH der Angriffs-
  // Karte (gleiche Chat-Folge-Optik wie die MM1-Reaktionskarte)
  for (const mm2ReactionCard of mm2Traits.reactionCards) {
    await postMaintainChainCard(functionStuff, mm2ReactionCard.titleHtml, mm2ReactionCard.lines, mm2ReactionCard.rolls);
  }
  // MM-Paket 2 (Blitzschnell, §3.8): Button-Daten der Freien Angriffe
  // als Flag an die Angriffs-Karte (combat.hbs rendert die Hinweis-
  // zeile + Taste, hooks.js verdrahtet den Klick auf den Flag)
  if (mm2Traits.swiftButton && NewMessage) {
    try {
      await NewMessage.setFlag(game.system.id, "mm2SwiftAttack", mm2Traits.swiftButton);
    } catch (mm2FlagError) {
      game.symbaroum.log("MM-Paket 2: Blitzschnell-Flag", mm2FlagError);
    }
  }
  // Kräfte-Paket 1 v1.3 (Anhang): Aktivierungs-Dialog nach der Karte
  // (Besitzer-/GM-Check im Dialog selbst; kein Karten-Flag, kein
  // hooks.js-Handler mehr - die v1-Taste ist ersetzt).
  if (illusoryPayload) {
    openIllusoryCorrectionDialog(illusoryPayload);
  }
  if (flagDataArray.length > 0) {
    await createModifyTokenChatButton(flagDataArray);
  }

  // Automatisierungspaket "Zweihandkraft" (GRW-Adept, Rudolfs Auswahlrunde
  // 28.10.): der gesammelte Rueckwaertsschwung laeuft NACH der Karte des
  // urspruenglichen Angriffs - identische Angriffsprobe (Eigenschaft,
  // Favorit, Modifikator, Zielwiderstand), Schaden FIX 1W8 ohne Boni und
  // ohne Waffenqualitaets-Effekte (Gift/Bluten/mystisch aus, Rekursions-
  // sperre per isReturnSwing). Die Ruestung greift normal, ab Meister wird
  // sie automatisch ignoriert (functionStuff.ignoreArm aus dem
  // modifierDialog-Override vererbt). Kritischer Erfolg auf dem
  // Rueckwaertsschwung wuerfelt den Krit-Bonus mit (+1d6, RAW-Stufe).
  if (returnSwingFired && !functionStuff.isReturnSwing) {
    const fsSwing = Object.assign({}, functionStuff, {
      isReturnSwing: true,
      numberofAttacks: 1,
      // Axtkünstler v1: die Schwung-Klon-Marker neutralisieren — sonst
      // wuerde der pur-1W8-Schwung erneut gestuft oder als Kurzer Hieb
      // gefuehrt (Klon erbt die Felder per Spread)
      axeArtistNovice: false,
      axeArtistDouble: false,
      poison: 0,
      damageOverTime: [],
      corruptingattack: "",
      dmgModifier: "",
      dmgModifierNPC: 0,
      dmgModifierAttackSupp: "",
      dmgModifierAttackSuppNPC: 0,
      hasAdvantage: false,
      hallowedBonus: false,
      freeAttack: false,
      // Bestienkunde v1: auch der Bestienkunde-Bonus gehoert zu den Boni,
      // die der Rueckwaertsschwung nicht erhaelt (Rudolfs Runde-1-Festlegung
      // "fix 1W8, keine Boni")
      beastloreDamageMod: null,
      beastloreDamageModNPC: 0,
      beastloreLabel: "",
    });
    // purer 1W8: NPC-Angreifer rechnen statisch (max/2 = 4), die
    // Qualitaets-Effekte der Waffe sind fuer den Rueckwaertsschwung aus
    fsSwing.weapon = Object.assign({}, functionStuff.weapon, {
      damage: Object.assign({}, functionStuff.weapon.damage, { base: "1d8", npcBase: 4 }),
      qualities: {},
    });
    if (fsSwing.weapon.system) fsSwing.weapon.system = Object.assign({}, functionStuff.weapon.system, { qualities: {} });
    // Leader-Bonus gehoert nicht zum puren 1W8 (Rudolf: keine Boni)
    fsSwing.targetData = Object.assign({}, functionStuff.targetData, { leaderTarget: false });
    fsSwing.introText = functionStuff.introText + game.i18n.localize("COMBAT.CHAT_RETURNSWING");
    const rdSwing = await baseRoll(
      functionStuff.actor,
      functionStuff.castingAttributeName,
      functionStuff.targetData.actor,
      functionStuff.targetData.resistAttributeName,
      functionStuff.favour,
      functionStuff.modifier,
      false
    );
    await attackResult([rdSwing], fsSwing);
  }
  // Axtkünstler v1.1 (Novize, Rudolfs Freigabe 29.10. + Testrunde 1):
  // automatischer Freier Angriff nach erfolgreicher Betäubungs-Probe —
  // läuft als eigene Karte NACH der Kurzer-Hieb-Karte. Präzision-Override
  // wie beim FA-Toggle (AP1-Festlegung), identische Gunst/Modifikator des
  // Angriffs (Rückwärtsschwung-Muster), die ECHTE Waffe (nicht der
  // 1W6-Pur-Klon). Meister-Bonus: der Kurzhieb-Treffer hat das +1d4 beim
  // Schadenswurf bereits verbraucht (Consumed-Marker wird vererbt), der
  // Freie Angriff geht daher leer aus — "+1d4 auf den ersten Treffer der
  // Kampfaktion, einmal pro Aktion". Rekursions-Sperre per
  // isAxeArtistFreeAttack.
  if (functionStuff.axeArtistNovice && axeArtistStunned && !functionStuff.isAxeArtistFreeAttack && axeArtistOriginalWeapon) {
    const fsFreeAttack = Object.assign({}, functionStuff, {
      isAxeArtistFreeAttack: true,
      freeAttack: true,
      axeArtistNovice: false,
      numberofAttacks: 1,
      poison: 0,
      damageOverTime: [],
      corruptingattack: "",
      dmgModifier: "",
      dmgModifierNPC: 0,
      dmgModifierAttackSupp: "",
      dmgModifierAttackSuppNPC: 0,
      hasAdvantage: false,
      hallowedBonus: false,
      beastloreDamageMod: null,
      beastloreDamageModNPC: 0,
      beastloreLabel: "",
      castingAttributeName: "accurate",
      weapon: axeArtistOriginalWeapon,
    });
    fsFreeAttack.introText = functionStuff.introText + game.i18n.localize("COMBAT.CHAT_AXEARTIST_FREE_ATTACK");
    const rdFreeAttack = await baseRoll(
      functionStuff.actor,
      "accurate",
      functionStuff.targetData.actor,
      functionStuff.targetData.resistAttributeName,
      functionStuff.favour,
      functionStuff.modifier,
      false
    );
    await attackResult([rdFreeAttack], fsFreeAttack);
  }
  // Dreckiger Kampf v1 (Novize, Rudolfs Auswahlrunde 29.10.): automatischer
  // Freier Angriff, sobald der Fiese Schlag SCHADEN verursacht hat (RAW:
  // "wenn der Gegner Schaden erleidet" — kein Treffer-Bonus, keine Probe;
  // Rüstungsreduktion muss > 0 bleiben). Läuft als eigene Karte nach der
  // Fieser-Schlag-Karte, mit der ECHTEN Waffe (nicht der 1W6-Pur-Klon) und
  // Präzision-Override (Rudolfs FA-Regel, AP1-Festlegung), identische
  // Gunst/Modifikator des Angriffs (Rückwärtsschwung-Muster).
  // Rekursions-Sperre per isCheapshotFreeAttack.
  if (functionStuff.cheapshotNovice && !functionStuff.isCheapshotFreeAttack && damageTot > 0 && cheapshotOriginalWeapon) {
    const fsCheapshotFA = Object.assign({}, functionStuff, {
      isCheapshotFreeAttack: true,
      freeAttack: true,
      // v1.1-Hotfix (vorgefundener Fix im selben Fluss): NSC-Angriff auf
      // SC trägt resistRoll = true — der Freie Angriff ist ein EIGENER,
      // einseitig gewürfelter Angriff (baseRoll mit resistRoll false);
      // geerbt würde die FA-Karte als Verteidigungswurf des Ziels
      // dargestellt (Etiketten + resistRollText). Wie bei der Riposte
      // neutralisiert.
      resistRoll: false,
      resistRollText: "",
      cheapshotNovice: false,
      numberofAttacks: 1,
      poison: 0,
      damageOverTime: [],
      corruptingattack: "",
      dmgModifier: "",
      dmgModifierNPC: 0,
      dmgModifierAttackSupp: "",
      dmgModifierAttackSuppNPC: 0,
      hasAdvantage: false,
      hallowedBonus: false,
      beastloreDamageMod: null,
      beastloreDamageModNPC: 0,
      beastloreLabel: "",
      castingAttributeName: "accurate",
      weapon: cheapshotOriginalWeapon,
    });
    fsCheapshotFA.introText = functionStuff.introText + game.i18n.localize("COMBAT.CHAT_CHEAPSHOT_FREE_ATTACK");
    const rdCheapshotFA = await baseRoll(
      functionStuff.actor,
      "accurate",
      functionStuff.targetData.actor,
      functionStuff.targetData.resistAttributeName,
      functionStuff.favour,
      functionStuff.modifier,
      false
    );
    await attackResult([rdCheapshotFA], fsCheapshotFA);
  }
  // Axtkünstler v1.1 (Adept, Rudolfs Freigabe 29.10. + Testrunde 1):
  // Doppelschlag — der zweite Schlag läuft als eigene Karte nach dem
  // ersten Angriff, mit identischen Modifikatoren (Rückwärtsschwung-
  // Muster) und der bereits gestuften Waffe (Klon erbt sie), AUCH bei
  // Fehlschlag des ersten Schlags (RAW: 2 Angriffe pro Kampfhandlung).
  // Gift/DoT wirken pro Schlag mit. Meister-Bonus über den Consumed-
  // Marker: trifft Schlag 1, verbraucht er das +1d4 und Schlag 2 geht
  // leer aus; verfehlt Schlag 1, erbt Schlag 2 den Bonus (erster
  // TREFFER der Aktion). isDoubleSecond ist Rekursions-Sperre und
  // blockt seinerseits die Stufung ein zweites Mal.
  if (functionStuff.axeArtistDouble && !functionStuff.isDoubleSecond) {
    const fsSecond = Object.assign({}, functionStuff, {
      isDoubleSecond: true,
      numberofAttacks: 1,
    });
    fsSecond.introText = functionStuff.introText + game.i18n.localize("COMBAT.CHAT_AXEARTIST_DOUBLE_SECOND");
    const rdSecond = await baseRoll(
      functionStuff.actor,
      functionStuff.castingAttributeName,
      functionStuff.targetData.actor,
      functionStuff.targetData.resistAttributeName,
      functionStuff.favour,
      functionStuff.modifier,
      false
    );
    await attackResult([rdSecond], fsSecond);
  }
  // Pfeil-Stoß v1.1 (Rudolfs Festlegung aus Testrunde 1, Punkt 8 — Freigabe
  // 29.10.): pro Angriff maximal EINE Reaktionsattacke, Priorität
  // Pfeil-Stoß > Dreckiger-Kampf-Riposte. Vollständige Vorhersage des
  // Stich-Triggers (identische Bedingungen inkl. Loop-Guards wie der
  // Stich-Block unten), damit die Riposte nur entfällt, wenn der Stich
  // WIRKLICH feuert — feuert der Stich nicht (z. B. nach Freien Angriffen,
  // !freeAttack-Guard, oder ohne aktiven Bogen), ripostiert der
  // Dreckiger-Kampf-Meister weiterhin.
  const jabDefender = functionStuff.targetData;
  const jabLevel = getActorAbilityLevel(jabDefender?.actor, "arrowjab");
  const jabBow = (jabDefender?.actor?.system?.weapons ?? []).find((w) => w.isActive && w.reference === "ranged");
  const arrowJabWillFire =
    Boolean(jabBow) &&
    functionStuff.weapon &&
    functionStuff.weapon.isMelee &&
    !functionStuff.isRiposte &&
    !functionStuff.freeAttack &&
    !functionStuff.isArrowJab &&
    !functionStuff.isAlternativeDamage &&
    functionStuff.targetData?.hasTarget &&
    functionStuff.targetData.actor !== functionStuff.actor &&
    jabLevel >= 1;
  // Dreckiger Kampf v1.2 (Meister; v1.1 Rudolfs Auswahlrunde 29.10. +
  // Hotfix 29.10.; v1.2 aus Rudolfs MM-Paket-1-Testrunde 26.11.2026,
  // Wunsch 3): blutige Riposte — feuert JEDEM Nahkampf-Angriffsaufruf
  // gegen den Meister nach, ABER nur noch bei TREFFER (auch Schaden 0),
  // nicht mehr bei Fehlschlag (Rudolfs Befund: Fehlschlag-Riposte ist
  // zu rerlastig; Guard = rollData.some(trueActorSucceeded), das Flag
  // steht auch im Verteidigungswurf-Fluss aus ANGREIFER-Sicht,
  // v1.1-Lernweis roll.js). Rest des v1.1-Bestands unverändert: feuert
  // AUCH im Verteidigungswurf-Fluss — wenn ein NSC
  // einen SC-Meister angreift, würfelt das System die Verteidigung
  // automatisch (resistRoll = true, Setting playerResistButton aus) bzw.
  // der Spieler per Button (Setting an); der v1-Guard !resistRoll ließ die
  // Riposte dort nie laufen (Rudolfs Befund: Monster mit natürlicher
  // Waffe gegen SC-Meister). Stolpern/FA bleiben im resistRoll-Fluss
  // bewusst unterdrückt — deren Ausschluss ist RAW-vertretbar (Rudolfs
  // Auswahlrunde-Entscheidung 4), die "nach jedem Angriff"-Riposte nicht.
  // Volle Automatik (Rudolfs Reaktions-Option A, 28.10.): eigene Karte
  // mit Perspektiv-Dreher — der VERTEIDIGER würfelt Präzision gegen die
  // VTD des Angreifers (Rudolfs Festlegung), purer 1W6-Schaden der
  // Rüstung ignoriert (ignoreArm). Rekursions-Sperre per isRiposte: die
  // Riposte selbst ist kein triggerbarer "Angriff" mehr (kein Ping-Pong
  // bei beidseitigen Meistern, kein Rückwärtsschwung aus der Riposte —
  // freeAttack-Sperre wie beim FA).
  if (
    functionStuff.weapon &&
    functionStuff.weapon.isMelee &&
    !functionStuff.isRiposte &&
    !functionStuff.isAlternativeDamage &&
    functionStuff.targetData?.hasTarget &&
    functionStuff.targetData.actor !== functionStuff.actor &&
    !arrowJabWillFire &&
    // v1.2 (Rudolfs MM1-Testrunde, Wunsch 3): nur bei Treffer des
    // Original-Angriffs (auch mit Schaden 0), nicht bei Fehlschlag
    rollData.some((r) => r.trueActorSucceeded) &&
    getActorAbilityLevel(functionStuff.targetData.actor, "cheapshot") >= 3
  ) {
    const defender = functionStuff.targetData;
    const fsRiposte = Object.assign({}, functionStuff, {
      isRiposte: true,
      freeAttack: true,
      // v1.1-Hotfix: der Original-Angriff kann im Verteidigungswurf-Fluss
      // resistRoll = true tragen (NSC -> SC) — die Riposte ist aber ein
      // EIGENER, einseitig gewürfelter Angriff (baseRoll mit resistRoll
      // false). Geerbt waere das Flag falsch: Krit-Etiketten-Perspektive
      // (getRollResultLevelKey) und resistRollText (Karte) wuerden die
      // Riposte als Verteidigungswurf des ANGREIFERS darstellen.
      resistRoll: false,
      resistRollText: "",
      cheapshotNovice: false,
      axeArtistNovice: false,
      axeArtistDouble: false,
      numberofAttacks: 1,
      actor: defender.actor,
      token: defender.token,
      tokenId: defender.tokenId,
      actingCharName: defender.name,
      actingCharImg: defender.token?.img ?? defender.actor.img,
      castingAttributeName: "accurate",
      favour: 0,
      modifier: 0,
      poison: 0,
      damageOverTime: [],
      corruptingattack: "",
      dmgModifier: "",
      dmgModifierNPC: 0,
      dmgModifierAttackSupp: "",
      dmgModifierAttackSuppNPC: 0,
      hasAdvantage: false,
      hallowedBonus: false,
      ignoreArm: true,
      isMystical: false,
      beastloreDamageMod: null,
      beastloreDamageModNPC: 0,
      beastloreLabel: "",
      attackFromPC: defender.actor.type !== "monster" || functionStuff.actor.type === "monster",
      targetData: {
        hasTarget: true,
        token: functionStuff.token,
        actor: functionStuff.actor,
        name: functionStuff.actingCharName,
        tokenId: functionStuff.tokenId,
        resistAttributeName: "defense",
        leaderTarget: false,
        autoParams: "",
        isCorrupted: game.symbaroum.config.isThoroughlyCorruptTarget(functionStuff.actor),
      },
      weapon: Object.assign({}, functionStuff.weapon, {
        damage: Object.assign({}, functionStuff.weapon.damage, { base: "1d6", npcBase: 3 }),
        qualities: {},
      }),
    });
    if (fsRiposte.weapon.system) fsRiposte.weapon.system = Object.assign({}, functionStuff.weapon.system, { qualities: {} });
    fsRiposte.introText =
      defender.name + game.i18n.localize("COMBAT.CHAT_INTRO") + game.i18n.localize("COMBAT.CHAT_CHEAPSHOT_RIPOSTE");
    const rdRiposte = await baseRoll(defender.actor, "accurate", functionStuff.actor, "defense", 0, 0, false);
    await attackResult([rdRiposte], fsRiposte);
  }
  // Pfeil-Stoß v1 (Rudolfs Freigabe 29.10. via Auswahlrunde) / v1.1
  // (Rudolfs Festlegung Testrunde-1-Punkt 8): Reaktion auf JEDEN
  // Nahkampfangriff gegen den Charakter (auch bei Fehlschlag des
  // Angreifers, Riposte-Präzedenz) — feuert in BEIDEN Flüssen, der Guard
  // darf resistRoll NICHT ausschließen (NSC->SC läuft immer im
  // Verteidigungswurf-Fluss, v1.1/v1.2-Lernweis Dreckiger Kampf).
  // v1.1: gewinnt der Stich, entfällt die Dreckiger-Kampf-Riposte (Guard
  // arrowJabWillFire am Riposte-Trigger, s. Vorberechnung oben).
  // Loop-Sperre (Rudolfs Auswahlrunde-Entscheidung 4): keine Reaktion auf
  // Riposten oder Freie Angriffe. RAW: "mit jeder Art von Bogen oder
  // Armbrust" -> EC-Filter reference === "ranged" schließt Wurfwaffen
  // ("thrown") aus. Rüstung greift normal ab (Entscheidung 1, kein pur),
  // Qualitäten: KEINE Bogen-Qualitäten (Entscheidung 2) — RAW meint die
  // Eigenschaften des GESCHOSSSES; die Spezialpfeil-Qualitäten werden erst
  // mit dem Munitions-Paket verdrahtet (Qualitäts-Hook dann hier am Klon).
  if (
    functionStuff.weapon &&
    functionStuff.weapon.isMelee &&
    !functionStuff.isRiposte &&
    !functionStuff.freeAttack &&
    !functionStuff.isArrowJab &&
    !functionStuff.isAlternativeDamage &&
    functionStuff.targetData?.hasTarget &&
    functionStuff.targetData.actor !== functionStuff.actor &&
    getActorAbilityLevel(functionStuff.targetData.actor, "arrowjab") >= 1
  ) {
    // v1.1: jabDefender/jabLevel/jabBow sind oberhalb des Riposte-Blocks
    // vorberechnet (Reaktions-Priorität) — hier nur noch verbrauchen.
    if (jabBow) {
      const fsArrowJab = Object.assign({}, functionStuff, {
        isArrowJab: true,
        freeAttack: true,
        // v1.1-Lernweis Dreckiger Kampf: der Original-Angriff kann im
        // Verteidigungswurf-Fluss resistRoll = true tragen — der Stich ist
        // ein EIGENER, einseitig gewürfelter Angriff; geerbtes Flag würde
        // Etiketten-Perspektive und Kartentext verfälschen.
        resistRoll: false,
        resistRollText: "",
        cheapshotNovice: false,
        axeArtistNovice: false,
        axeArtistDouble: false,
        numberofAttacks: 1,
        actor: jabDefender.actor,
        token: jabDefender.token,
        tokenId: jabDefender.tokenId,
        actingCharName: jabDefender.name,
        actingCharImg: jabDefender.token?.img ?? jabDefender.actor.img,
        castingAttributeName: jabBow.attribute ?? "accurate",
        favour: 0,
        modifier: 0,
        poison: 0,
        damageOverTime: [],
        corruptingattack: "",
        dmgModifier: "",
        dmgModifierNPC: 0,
        dmgModifierAttackSupp: "",
        dmgModifierAttackSuppNPC: 0,
        hasAdvantage: false,
        hallowedBonus: false,
        ignoreArm: false,
        isMystical: false,
        beastloreDamageMod: null,
        beastloreDamageModNPC: 0,
        beastloreLabel: "",
        attackFromPC: jabDefender.actor.type !== "monster" || functionStuff.actor.type === "monster",
        targetData: {
          hasTarget: true,
          token: functionStuff.token,
          actor: functionStuff.actor,
          name: functionStuff.actingCharName,
          tokenId: functionStuff.tokenId,
          resistAttributeName: "defense",
          leaderTarget: false,
          autoParams: "",
          isCorrupted: game.symbaroum.config.isThoroughlyCorruptTarget(functionStuff.actor),
        },
        weapon: Object.assign({}, jabBow, {
          damage: Object.assign({}, jabBow.damage, jabLevel >= 2 ? { base: "1d8", npcBase: 4 } : { base: "1d6", npcBase: 3 }),
          qualities: {},
        }),
      });
      if (fsArrowJab.weapon.system) fsArrowJab.weapon.system = Object.assign({}, jabBow.system, { qualities: {} });
      fsArrowJab.introText =
        jabDefender.name + game.i18n.localize("COMBAT.CHAT_INTRO") + game.i18n.localize("COMBAT.CHAT_ARROWJAB");
      const rdArrowJab = await baseRoll(jabDefender.actor, fsArrowJab.castingAttributeName, functionStuff.actor, "defense", 0, 0, false);
      await attackResult([rdArrowJab], fsArrowJab);
      // Meister: Freier Angriff mit dem Bogen, wenn der Stich trifft —
      // NORMALER Fernkampfangriff (baseDamage/Qualitäten des Bogens,
      // Rüstung greift normal), NICHT der Stub-1W8.
      if (jabLevel >= 3 && rdArrowJab.trueActorSucceeded) {
        const fsArrowJabFA = Object.assign({}, fsArrowJab, {
          isArrowJab: false,
          isArrowJabFA: true,
          introText:
            jabDefender.name + game.i18n.localize("COMBAT.CHAT_INTRO") + game.i18n.localize("COMBAT.CHAT_ARROWJAB_FA"),
          weapon: Object.assign({}, jabBow, {
            damage: Object.assign({}, jabBow.damage),
            qualities: Object.assign({}, jabBow.qualities),
          }),
        });
        if (fsArrowJabFA.weapon.system) fsArrowJabFA.weapon.system = Object.assign({}, jabBow.system);
        const rdArrowJabFA = await baseRoll(jabDefender.actor, fsArrowJabFA.castingAttributeName, functionStuff.actor, "defense", 0, 0, false);
        await attackResult([rdArrowJabFA], fsArrowJabFA);
      }
    }
  }
  /* Hymnen-Paket 1.5: Dornenmantel-Meister-Rueckschlag (siehe
     thornCloakRetaliation) - nach der Angriffs-Karte, nur bei
     erfolgreichem Nahkampftreffer mit Schaden auf einen geschuetzten
     Akteur. */
  await thornCloakRetaliation(functionStuff, damageTot, rollData);
  /* Kraefte-Paket 1 (Baustein B): Schutzrunen-Vergeltung + Maintain-
     Abbruch - gleiche Trigger-Stelle wie der Dornenmantel-Rueckschlag,
     NK UND FK physisch, nur bei Schaden > 0 auf den Marker-Traeger. */
  await protectiveRunesRetaliation(functionStuff, damageTot, rollData);
  /* Kraefte-Paket 1 (Baustein A): Feuerseele-Rueckstoss - NK Nov/Adept,
     NK+FK Meister, durch die Ruestung des Angreifers. */
  await firesoulRetaliation(functionStuff, damageTot, rollData);
  // MM-Paket 1: Säureblut-Verteidigerreaktion als Nachschalter wie der
  // Feuerseele-Rückstoß (eigene Karte + eigene GM-Karte hinter der
  // Angriffs-Karte) - auch der Rueckwaertsschwung und alle weiteren
  // Nahkampftreffer loesen die Reaktion aus (RAW: "wer die Kreatur im
  // Nahkampf trifft und ihr Schaden zufügt")
  await mm1AcidicBlood(functionStuff, damageTot, rollData);
  return templateData;
}

/**
 * S2.1 (P5+P9, Rudolfs Freigabe 06.11.2026): einheitliche Wurfzeilen-
 * Darstellung (alter Doppelpunkt-Stil „Attr : (10) Modifikator: 1"
 * entfällt): „{Attr} ({Wert}) + 1 (Modifikator) + 1 (Archivar)" — der
 * freie Modifikator trägt das Label (Modifikator), Segen-/Last-Zeilen
 * ihr boonName, Komponenten nur bei Wert ≠ 0. Echter Opposed behält
 * den Anhang „⬅ {Zielattr} ({finalMod})". Ohne chainData (Sekundär-
 * proben: Gift, Betäubung, Sturmbolzen …) gilt der modifier-Parameter
 * als freier Modifikator. Boon-Zeilen-Labels laufen NICHT mehr über
 * autoParams, sondern nur noch über diese Kette.
 */
async function formatRollString(rollDataElement, hasTarget, modifier, chainData = null) {
  const cd = chainData ?? { freeModifier: modifier, boonLineChain: [] };
  let rollString = `${rollDataElement.actingAttributeLabel} (${rollDataElement.actingAttributeValue})`;
  rollString += formatModifierChain(cd.freeModifier, cd.boonLineChain);
  if (hasTarget && rollDataElement.targetAttributeLabel) {
    let attributeMod = 10 - rollDataElement.resistAttributeValue;
    rollString += `  ⬅  ${rollDataElement.targetAttributeLabel} (${attributeMod})`;
  }
  return rollString;
}

async function healing(healFormula, targetToken, attackFromPC) {
  let healRoll;
  let totalResult = 0;
  let damageTooltip = "";
  if (attackFromPC) {
    healRoll = await new Roll(healFormula).evaluate();
    (totalResult = healRoll.total), (damageTooltip = new Handlebars.SafeString(await healRoll.getTooltip()));
  } else {
    healRoll = await new Roll(healFormula).evaluate({ maximize: true });
    totalResult = Math.ceil(healRoll.total / 2);
  }
  let healed = Math.min(totalResult, targetToken.actor.system.health.toughness.max - targetToken.actor.system.health.toughness.value);
  return {
    hasDamage: true,
    roll: healRoll,
    healed: healed,
    dmgFormula: game.i18n.localize("POWER_LAYONHANDS.CHAT_FINAL") + healFormula,
    damageText: game.i18n.localize("POWER_LAYONHANDS.CHAT_FINAL") + healed.toString(),
    damageTooltip: damageTooltip,
    flagData: {
      tokenId: targetToken.id,
      toughnessChange: healed,
    },
  };
}

/* ===== Gift v1 (Rudolfs Freigabe 08.11.2026): Helfer B1/B3/B4 ===== */

/* B4/Grad-Ableitung einer Inventar-Gift-Dosis: v1.5-Legacy-Feld
   poisonGrade (falls numerisch), sonst Standard-Formel-Mapping
   (Schaden/Runde 1d4 -> 1, 1d6 -> 2, 1d8 -> 3; exotische SL-
   Kalibrierungen haben keinen Grad, Rueckgabe 0). */
export function getElixirPoisonGrade(item) {
  if (item?.type !== "equipment") return 0;
  const eff = item.system?.elixirEffect ?? {};
  const legacy = Number(String(eff.poisonGrade ?? "").trim());
  if (Number.isFinite(legacy) && legacy >= 1) return Math.min(3, Math.round(legacy));
  const formula = (String(eff.damagePerRound ?? "").trim() || String(eff.damage ?? "").trim()).toLowerCase();
  const stairs = { "1d4": 1, "1d6": 2, "1d8": 3 };
  return stairs[formula] ?? 0;
}

/* B3-Adept: Grad der aktiven Szenen-Beschichtung (Condition poisoncoat,
   flagData.poisoncoat.grade); 0 = keine aktive Beschichtung. */
export function getActivePoisonCoatGrade(actor) {
  const eff = actor?.hasCondition?.("poisoncoat");
  if (!eff || eff === "") return 0;
  const grade = Number(eff.getFlag?.(game.system.id, "flagData")?.poisoncoat?.grade);
  return Number.isFinite(grade) && grade >= 1 && grade <= 3 ? Math.round(grade) : 0;
}

/* B3-Adept: Szenen-Beschichtung setzen - eine andere Stufe ersetzt die
   alte (neue Dosis = neue Beschichtung). Bewusst OHNE duration/dot/
   turnEnd: das Symbol ist permanent, Ruecksetzen nach dem Kampf ist
   reine SL-Sache (HUD, Rudolfs Wunsch analog Regeneration). */
export async function setPoisonCoat(actor, grade) {
  const g = Math.min(3, Math.max(1, Math.round(Number(grade) || 0)));
  const effect = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "poisoncoat"));
  if (actor?.hasCondition?.("poisoncoat")) await actor.removeCondition("poisoncoat");
  await actor.addCondition(effect, { poisoncoat: { grade: g } });
  return g;
}

/* B3-Novize: 1 Dosis je vergiftetem Treffer - bucht EIN passendes
   Dosen-Item der gewaehlten Stufe ab (Warnung, wenn keins mehr da ist;
   das Gift wirkt dennoch - SL-korrigierbar, dokumentierte Begrenzung). */
export async function consumePoisonDoseByGrade(actor, grade) {
  const target = Math.round(Number(grade) || 0);
  if (target < 1) return false;
  const candidates = (actor?.items ?? []).filter((it) => isWeaponPoisonDose(it) && getElixirPoisonGrade(it) === target);
  if (candidates.length === 0) {
    ui.notifications.warn(game.i18n.format("POISON.ERR_NO_DOSE_BY_GRADE", { grade: target }));
    return false;
  }
  return consumeElixirDose(candidates[0]);
}

/* Gift v1.1 (Rudolfs Testrunde v1, 08.11.2026, P9): zentraler Dosen-
   Filter fuer ALLE Waffengift-Listen (beide Dialog-Kontexte, Grad-
   Union des Faehigkeitswurfs, consumePoisonDoseByGrade): Ein Aus-
   ruestungs-Item ist eine waffengift-faehige Dosis, wenn es das
   Waffengift-Flag (bzw. die Legacy-Giftstufe) traegt - ABER NICHT das
   Handbuch der Gifte ist (Referenz poisonmanual): Das Handbuch ist
   Werkzeug, kein Gift, und taucht seit v1.1 nicht mehr in den
   Auswahllisten auf (Rudolfs Befund: sein Handbuch-Item trug Dosen-
   Daten und erschien doppelt). */
export function isWeaponPoisonDose(item) {
  if (item?.type !== "equipment") return false;
  if (String(item.system?.reference ?? "").trim() === "poisonmanual") return false;
  const eff = item.system?.elixirEffect ?? {};
  const isWeaponPoison = eff.weaponPoison === true || eff.weaponPoison === "true" || String(eff.poisonGrade ?? "").trim() !== "";
  return isWeaponPoison && getItemCount(item) > 0;
}

/* Gift v1.1 (Rudolfs Testrunde v1, 08.11.2026, P4): anhaltende Dosen-
   Beschichtung. Eine im Wuerfeldialog gewaehlte Inventar-Dosis be-
   schichtet die Waffe DAUERHAFT (Actor-Flag weaponCoat, bewusst KEINE
   Condition - der Novize bleibt symbollos, Rudolfs v1-Konzept): Das
   Gift bleibt auf der Klinge, bis eine Vergiftung GELINGT - auch
   Treffer in SPAETEREN Runden tragen es (Rudolfs P4-Befund). Die
   Dosis wird erst bei gelungener Vergiftung vergebucht (consume-on-
   hit bleibt), danach bleibt die Klinge beschichtet, solange der
   Stapel Dosen hat ("1 Dosis je vergiftetem Treffer"). "Kein Gift" im
   Dialog wischt die Beschichtung ab (manuelle Spieler/SL-Kontrolle). */
export function getPendingWeaponCoat(actor) {
  const coat = actor?.getFlag?.(game.system.id, "weaponCoat");
  if (!coat || !coat.itemId || !coat.formula) return null;
  /* Gift v1.2 (Rudolfs v1.1-Runde, P6/P7): Der GRAD der Dosis reist ab
     jetzt mit dem Beschichtungs-Flag (Meister-Aufwertung +1 Stufe bzw.
     Gunst braucht ihn). Alte v1.1-Flags ohne Grad werden rueckwaerts-
     kompatibel aus dem Dosen-Item hergeleitet - ist das Item geloescht,
     bleibt Grad 0 und der Meister-Effekt entfaellt (dokumentierte
     Begrenzung, SL kann neu beschichten). */
  let grade = Math.min(3, Math.max(0, Math.round(Number(coat.grade) || 0)));
  if (grade < 1) {
    const doseItem = actor?.items?.get?.(coat.itemId);
    grade = doseItem ? Math.min(3, Math.max(0, Math.round(Number(getElixirPoisonGrade(doseItem)) || 0))) : 0;
  }
  return Object.assign({}, coat, { grade });
}

export async function setPendingWeaponCoat(actor, coat) {
  if (!actor?.setFlag || !coat?.itemId || !coat.formula) return null;
  /* Gift v1.2 (P6/P7): Grad mitfuehren - die Meister-Aufwertung der
     Dosen-Beschichtung braucht ihn (siehe attackResult). */
  return actor.setFlag(game.system.id, "weaponCoat", {
    name: coat.name ?? "",
    formula: coat.formula,
    roundsFormula: coat.roundsFormula ?? "1d4",
    itemId: coat.itemId,
    grade: Math.min(3, Math.max(0, Math.round(Number(coat.grade) || 0))),
  });
}

export async function clearPendingWeaponCoat(actor) {
  if (actor?.unsetFlag) await actor.unsetFlag(game.system.id, "weaponCoat");
}

/* Gift v1.2 (Rudolfs v1.1-Runde, P9 - Rudolfs Wortlaut: "Opt-out ent-
   spricht Abwischen. 'Aktive Beschichtung' loeschen. Wenn Waffe wieder
   vergiftet werden soll, muss eine neue Dosis aufgetragen werden"):
   "Kein Gift" im Waffengift-Dialog wischt ab jetzt BEIDE Beschichtungen
   - die anhaltende Dosen-Beschichtung (Actor-Flag) UND die aktive
   Szenen-Beschichtung (Condition poisoncoat) - und zwar DAUERHAFT, nicht
   nur als Opt-out fuer den einzelnen Angriff. Re-Vergiftung nur ueber
   eine neue Dosis. clearPendingWeaponCoat bleibt unangetastet, weil es
   auch beim Dosen-Aufbrauch im Coating-Block laeuft und dort die
   Condition NICHT anfassen darf. */
export async function wipeWeaponPoisonCoats(actor) {
  await clearPendingWeaponCoat(actor);
  if (actor?.hasCondition?.("poisoncoat")) await actor.removeCondition("poisoncoat");
}

/* B3/B4: gemeinsame Aufloesung der Waffengift-Zeile (beide Wuerfe-
   dialoge, dialog.js EC-Dialog + Modifier-Dialog in item.js):
   'none' = kein Gift, 'ownpoison' = Eigengift (B4: nur noch das
   Merkmal Giftig), 'activecoat' = aktive Adept-Beschichtung (kein
   Verbrauch, Vergifter-Pfad), Item-ID = Inventar-Dosis:
   Adept/Meister-Giftmischer starten damit die Szenen-Beschichtung
   (1 Dosis abgebucht, Grad-Modell ueber den Vergifter-Pfad, Condition
   poisoncoat), Novize/jeder andere laufen ueber den Coating-Pfad mit
   Abbuchung ERST bei gelungener Vergiftung (poisonCoating.itemId,
   B3-Novizen-Korrektur). Rueckgabe null = Abbuchung gescheitert
   (Abbruch des Wurfs, bestehende Konvention). */
export async function resolveWeaponPoisonChoice(actor, choiceId, context) {
  const result = { kind: "none", poison: 0, poisonCoating: null };
  if (!choiceId || choiceId === "none") return result;
  if (choiceId === "ownpoison") {
    result.kind = "ownpoison";
    result.poison = context?.ownPoison?.grade ?? 0;
    return result.poison > 0 ? result : null;
  }
  if (choiceId === "activecoat") {
    result.kind = "activecoat";
    result.poison = getActivePoisonCoatGrade(actor);
    return result.poison > 0 ? result : null;
  }
  /* Gift v1.1 (P4): voreingestellte Option der aktiven Dosen-
     Beschichtung - kein Verbrauch, kein neuer Zustand, das Actor-
     Flag bleibt unangetastet (reine Anzeige/Auffrischung, die
     Wirkung laeuft ueber das Auto-Apply in attackResult). Faellt
     das Flag inzwischen weg, laeuft der Angriff schlicht ohne
     Gift (kein null-Abbruch - hier ging nie etwas schief). */
  if (choiceId === "dosecoat") {
    result.kind = "dosecoat";
    result.poisonCoating = getPendingWeaponCoat(actor);
    return result;
  }
  const choice = (context?.poisonCoatingChoices ?? []).find((c) => c.id === choiceId);
  const poisonItem = actor?.items?.get?.(choiceId);
  if (!choice || !poisonItem) return null;
  const grade = getElixirPoisonGrade(poisonItem);
  const poisonerLvl = getActorAbilityLevel(actor, "poisoner");
  if (poisonerLvl >= 2 && grade >= 1) {
    if (!(await consumeElixirDose(poisonItem))) return null;
    await setPoisonCoat(actor, grade);
    result.kind = "coatscene";
    result.poison = grade;
    return result;
  }
  result.kind = "dose";
  result.poisonCoating = {
    name: poisonItem.name,
    formula: choice.formula,
    roundsFormula: choice.roundsFormula,
    itemId: poisonItem.id,
    grade,
  };
  return result;
}

async function poisonCalc(functionStuff, poisonRoll) {
  let poisonRes = {};
  poisonRes.printPoison = false;
  poisonRes.poisonChatIntro = functionStuff.actingCharName + game.i18n.localize("COMBAT.CHAT_POISON") + functionStuff.targetData.name;
  let poisonDamage = "0";
  const effect = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "poison"));
  poisonRes.poisonResistRollText = functionStuff.targetData.name + game.i18n.localize("ABILITY.RESIST_ROLL");

  if (!poisonRoll.trueActorSucceeded) {
    poisonRes.poisonChatResult = game.i18n.localize("COMBAT.CHAT_POISON_FAILURE");
  } else {
    // Gift v1 (Rudolfs Freigabe 08.11.2026): Stufenmodell der Gift-Engine.
    // B2: Dauer 1d(2*Grad+2) je ORIGINALEM Grad (RAW-konform 1W4/1W6/1W8),
    // Rundenschaden je SCHADENSSTUFE gradabhaengig (PC bzw. Monsteropfer
    // wuerfeln 1d4/1d6/1d8, NPC-Angreifer nutzen den fixen Spiegelwert
    // 2/3/4, Muster healing()). B1: Giftresistent senkt NUR DEN SCHADEN
    // um eine Stufe (Dauer unberuehrt, Vault-Notiz „Der Zeitrahmen ist
    // nicht betroffen"); ein schwaches Gift wird neutralisiert (Rudolfs
    // Rueckmeldung 2, analog zum Antidot-<=0-Modell - bewusste Abweichung
    // von der Notiz „1 Punkt"). B5: Das Merkmal Giftig nutzt feste
    // RAW-Werte (Runden 2/3/4, Schaden 2/3/4) statt der Grad-Wuerfel.
    const cfg = game.symbaroum.config;
    const origGrade = Math.max(1, Math.min(3, Math.round(Number(functionStuff.poison) || 1)));
    const fixedValues = functionStuff.poisonFixedValues === true;
    const resilient = hasPoisonResilient(functionStuff.targetData.actor);
    const damageGrade = resilient ? origGrade - 1 : origGrade;
    if (damageGrade < 1) {
      // B1-Floor: Schaden 0 = Gift aufgehoben - keine Condition, kein
      // DoT, keine Schadens-/Dauerwuerfe; nur die Kennzeichnung.
      poisonRes.poisonChatResult = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_POISON_RESILIENT_NEUTRALIZED");
    } else if (functionStuff.targetData.token.actor?.hasCondition(effect.id)) {
      poisonRes.poisonChatResult = game.i18n.localize("COMBAT.CHAT_POISON_NOTEXTEND");
    } else {
      // B2/B5: Der je Anwendung EINMAL ermittelte Rundenschaden bleibt
      // v1.6-konstant ueber die Laufzeit (dot.fixedDamage, A28-Tick; das
      // Antidot senkt ihn um 2 Punkte je Stufe - unveraendert).
      let NewPoisonRounds;
      let poisonDotFormula;
      let poisonDotTotal;
      const buildFlagData = () => ({
        tokenId: functionStuff.targetData.tokenId,
        addEffect: effect,
        effectDuration: NewPoisonRounds,
        // A28 G2: der dot-Block meldet die Condition an die Runden-/DoT-
        // Engine - Ruestung ignoriert, erster Tick am naechsten Zug des
        // Opfers (unveraendert)
        dot: {
          label: "QUALITY.POISON",
          formula: poisonDotFormula,
          fixedDamage: poisonDotTotal,
          resource: "toughness",
          damageType: "poison",
          stackable: false,
          separateRoll: false,
        },
        // Elixiere v1.6: Festwert-Metadaten fuer das Antidot (Hooks-
        // Handler senkt conditionData.poison.damage um 2 je Antidotstufe
        // und schreibt dot.fixedDamage mit); Restdauer UNVERAENDERT.
        conditionData: {
          poison: {
            damage: poisonDotTotal,
            formula: poisonDotFormula,
            rounds: NewPoisonRounds,
            roundsFormula: fixedValues ? String(NewPoisonRounds) : poisonDamage,
          },
        },
      });
      if (fixedValues) {
        // B5 (Giftig): feste RAW-Werte - Runden 2/3/4 und Schaden 2/3/4
        // je Stufe, KEINE Wuerfel (poisonRes.roll/poisonDotRoll bleiben
        // weg, die Aufrufer pushen nur vorhandene Wuerfe).
        NewPoisonRounds = cfg.POISONOUS_FIXED_ROUNDS[origGrade];
        poisonDotTotal = cfg.POISONOUS_FIXED_DAMAGE[damageGrade];
        poisonDotFormula = String(poisonDotTotal);
      } else if (functionStuff.poisonSpitSC === true) {
        // MM-Paket 1 v1.1 (Bewertungsfrage 2): Giftspucke eines SC-
        // Merkmalstraegers - HYBRID aus B5-RUNDEN (RAW-fest 2/3/4) und
        // Baustein-0-SCHADEN (Grad-Wuerfel 1d4/1d6/1d8, einmal gewuerfelt
        // und v1.6-konstant ueber die Laufzeit als dot.fixedDamage);
        // Giftresistent senkt wie ueblich NUR den Schaden um eine Stufe.
        NewPoisonRounds = cfg.POISONOUS_FIXED_ROUNDS[origGrade];
        poisonDotFormula = cfg.POISON_GRADE_DAMAGE[damageGrade];
        const poisonDotRoll = await new Roll(poisonDotFormula).evaluate();
        poisonRes.poisonDotRoll = poisonDotRoll;
        poisonDotTotal = poisonDotRoll.total;
      } else {
        // B2: Dauer mit der Originalstufe (B1: Giftresistent fasst die
        // Dauer NICHT an), Schaden mit der (ggf. gesenkten) Stufe.
        poisonDamage = "1d" + (2 * origGrade + 2).toString();
        const PoisonRoundsRoll = await new Roll(poisonDamage).evaluate();
        poisonRes.roll = PoisonRoundsRoll;
        NewPoisonRounds = PoisonRoundsRoll.total;
        if (functionStuff.attackFromPC || functionStuff.targetData.actor.type === "monster") {
          poisonDotFormula = cfg.POISON_GRADE_DAMAGE[damageGrade];
          const poisonDotRoll = await new Roll(poisonDotFormula).evaluate();
          poisonRes.poisonDotRoll = poisonDotRoll;
          poisonDotTotal = poisonDotRoll.total;
        } else {
          poisonDotTotal = cfg.POISON_GRADE_NPC_DAMAGE[damageGrade];
          poisonDotFormula = String(poisonDotTotal);
        }
      }
      poisonRes.poisonApplied = true;
      poisonRes.flagData = buildFlagData();
      poisonRes.poisonChatResult =
        functionStuff.targetData.name +
        game.i18n.localize("COMBAT.CHAT_POISON_SUCCESS1") +
        poisonDotTotal.toString() +
        game.i18n.localize("COMBAT.CHAT_POISON_SUCCESS2") +
        NewPoisonRounds.toString();
      if (resilient) {
        poisonRes.poisonChatResult += game.i18n.localize("COMBAT.CHAT_POISON_RESILIENT_REDUCED");
      }
    }
  }
  poisonRes.printPoison = true;
  poisonRes.poisonRollString = await formatRollString(poisonRoll, functionStuff.targetData.hasTarget, functionStuff.modifier);
  poisonRes.poisonRollResultString = await formatRollResult(poisonRoll);
  poisonRes.poisonToolTip = poisonRoll.toolTip;
  return poisonRes;
}

// Segen & Lasten S1: Export fuer die Delegation der Ertrags-Result-
// Funktionen in boon.js (buschcraftResult/enterpriseResult reichen
// finalText + resultRolls weiter und delegieren an diese Funktion)
/* ================================================================
 * Kräfte-Paket 2 „Sprung & Schuss" (Rudolfs Freigabe 23.11.2026,
 * Konzept-Doc Kraefte-Paket2-Konzept-v1): Block A Sturmpfeil + Block B
 * Teleport. Entscheidungsprotokoll und bewusste Abweichungen: siehe
 * die Setup-Kommentare und das Auslieferungsdoc.
 * ================================================================ */

/* Runden-Schlüssel der Sturmpfeil-Gates (Muster trollRerollRoundKey,
 * lokale Kopie - die Original-Funktion ist nicht exportiert): aktiver
 * Kampf = Kampfrunde, sonst Weltzeit-Takt aus dem Weltzeit-Setting,
 * ganz ohne Takt null = SL-Urteil (Gate gilt dann als offen, dokumen-
 * tierte Grenze). RAW: freier Schuss 1×/Runde (auch in der Aktivierungs-
 * runde - das Gate startet unbenutzt), die Salve ist eine Kampfaktion
 * und beendet den freien Schuss derselben Runde. */
function stormArrowRoundKey() {
  if (game.combat?.active && game.combat.round > 0) return "c" + game.combat.round;
  const minutes = Number(game.settings.get("symbaroum", "dotWorldTimeRoundMinutes")) || 0;
  if (minutes > 0) return "w" + Math.floor(game.time.worldTime / (minutes * 60));
  return null;
}

/* Sturmpfeil-Bestand am Aktor lesen - nur für die AKTUELLE Szene gültig:
 * Szenenwechsel lässt das Flag still verfallen (RAW „Rest der Szene"),
 * die Pfeile selbst sind dank je-Schuss-Buchung nie aus dem Inventar
 * entfernt worden, es gibt nichts zurückzubuchen. */
function stormArrowActiveFlag(actor) {
  const flag = actor?.getFlag(game.system.id, "stormArrow");
  if (!flag) return null;
  if (String(flag.sceneId ?? "") !== String(game.scenes.current?.id ?? "")) return null;
  return flag;
}

/* Munitionsabbuchung EINES abgefeuerten Sturmpfeils (Rudolfs Entschei-
 * dungen 8 + b): Setting aus = keine Buchung. Bevorzugt werden die bei
 * der Aktivierung gemerkten Stapel, danach fällt die Buchung auf die
 * gesamte Kategorie zurück (Mischbestand, AP2-Stapelreihenfolge wie
 * consumeAmmoForAttack); bis 0 erlaubt - die Zeile bleibt stehen. */
async function stormArrowConsumeOne(actor, flag) {
  if (!isAmmoConsumptionEnabled()) return false;
  const stacks = [];
  const seen = new Set();
  for (const id of flag?.stacks ?? []) {
    const item = actor.items.get(id);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      stacks.push(item);
    }
  }
  for (const item of findAmmoStacks(actor, "pfeilbolzen")) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      stacks.push(item);
    }
  }
  for (const item of stacks) {
    const current = getItemCount(item);
    if (current <= 0) continue;
    await item.update({ "system.number": current - 1 });
    return true;
  }
  return false;
}

/* Salve: je Folgepfeil eine kleine Bestätigung (Erdschoss-Brocken-
 * Muster) - gleiche Wahl übernehmen oder ein NEUES Ziel anvisieren
 * (Mehrfachziel über die Zielwahl-Schiene, Konzept-Abschnitt 2). */
function stormArrowNextShotConfirmation(functionStuff, remaining) {
  return new Promise((resolve) => {
    symbDialog({
      title: functionStuff.abilityName,
      classes: ["chain-confirm", ...(isModernDialogActive() ? modernDialogClasses("modern-chain-confirm-dialog") : [])],
      content: `<div class="symbaroum dialog"><p class="lblfavour">${game.i18n.format(game.i18n.localize("POWER_STORMARROW.CONFIRM_NEXT_SHOT"), { count: remaining })}</p></div>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("BUTTON.YES"),
          callback: () => resolve(true),
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.NO"),
          callback: () => resolve(false),
        },
      },
      default: "yes",
    });
  });
}

/* Sturmpfeil abfeuern: freier Schuss (1 Pfeil) oder Salve (Adept 2 /
 * Meister 3, auf den Bestand geklemmt). Treffer erfolgsicher - pro
 * Pfeil läuft eine eigene Schadenskarte (standardPowerResult null-
 * Wurf-Muster, Doppelformat wie Prios' Brennglas-Folgeschläge), Muna-
 * tion je Schuss, Gates am Schluss. Abbruch der Salve lässt die
 * restlichen Pfeile bewaffnet (Rudolfs b). */
async function stormArrowFireShots(functionStuff, flag, requested, isVolley) {
  const actor = functionStuff.actor;
  const volleySize = Math.min(requested, flag.count);
  if (volleySize <= 0) {
    ui.notifications.warn(game.i18n.localize("POWER_STORMARROW.WARN_OUT"));
    return;
  }
  const roundKey = stormArrowRoundKey();
  if (roundKey !== null) {
    if (isVolley) {
      if (flag.volleyKey === roundKey) {
        ui.notifications.warn(game.i18n.localize("POWER_STORMARROW.WARN_ROUND_VOLLEY"));
        return;
      }
    } else if (flag.freeKey === roundKey || flag.volleyKey === roundKey) {
      ui.notifications.warn(game.i18n.localize("POWER_STORMARROW.WARN_ROUND"));
      return;
    }
  }
  let targetToken = Array.from(game.user.targets)[0];
  if (!targetToken) {
    ui.notifications.warn(game.i18n.localize("POWER_STORMARROW.WARN_NO_TARGET"));
    return;
  }
  /* Karten-Mutation je Schuss (Erdschoss-Muster), Restore danach: die
     Folge-Schüsse zahlen KEINE Korruption (nur die Aktivierung zahlt),
     Schaden fest je Stufe, Rüstung schützt (RAW-gerecht, kein ignore). */
  const saved = {
    targetData: functionStuff.targetData,
    corruption: functionStuff.corruption,
    hasDamage: functionStuff.hasDamage,
    damageDice: functionStuff.damageDice,
    ignoreArm: functionStuff.ignoreArm,
    introText: functionStuff.introText,
    resultTextSuccess: functionStuff.resultTextSuccess,
    resultTextFail: functionStuff.resultTextFail,
    finalTextSucceed: functionStuff.finalTextSucceed,
  };
  functionStuff.corruption = game.symbaroum.config.TEMPCORRUPTION_NONE;
  functionStuff.hasDamage = true;
  functionStuff.ignoreArm = false;
  functionStuff.damageDice = flag.level >= 2 ? "1d8" : "1d6";
  functionStuff.introText = game.i18n.localize("POWER_STORMARROW.CHAT_SHOT_INTRO");
  functionStuff.resultTextSuccess = game.i18n.localize("POWER_STORMARROW.CHAT_SHOT_SUCCESS");
  functionStuff.resultTextFail = game.i18n.localize("POWER_STORMARROW.CHAT_SHOT_FAILURE");
  let fired = 0;
  while (fired < volleySize) {
    if (fired > 0) {
      if (!(await stormArrowNextShotConfirmation(functionStuff, volleySize - fired))) break;
      const freshTarget = Array.from(game.user.targets)[0];
      if (freshTarget) targetToken = freshTarget;
    }
    functionStuff.targetData = buildGlyphTargetData(targetToken, null);
    await standardPowerResult(null, functionStuff);
    await stormArrowConsumeOne(actor, flag);
    fired += 1;
    flag.count -= 1;
  }
  Object.assign(functionStuff, saved);
  /* Gates nachziehen: der freie Schuss verbraucht sein Runden-Gate; die
     Salve blockiert zusätzlich den freien Schuss derselben Runde (RAW:
     „... kann er keinen weiteren Pfeil als freie Aktion abschießen"). */
  const newKey = stormArrowRoundKey();
  if (isVolley) {
    flag.volleyKey = newKey;
  } else {
    flag.freeKey = newKey;
  }
  await actor.setFlag(game.system.id, "stormArrow", flag);
  if (flag.count <= 0) {
    await actor.unsetFlag(game.system.id, "stormArrow");
    /* Paket-2 v2: alle Pfeile abgefeuert - das Kraftsymbol am Token
       verschwindet mit (Reihenfolge-Konvention: Flag zuerst, Marker
       danach, der deleteActiveEffect-Hook bleibt damit still). */
    await stormArrowClearMarker(actor);
    await postMaintainChainCard(functionStuff, `<h4>${functionStuff.abilityName}</h4>`, [game.i18n.localize("POWER_STORMARROW.CHAT_OUT")], []);
  }
}

/* Aktions-Dialog des aktiven Sturmpfeils (zweiter Klick auf die Kraft-
 * Kachel): freier Schuss / Salve (Adept+) / Kraft beenden. Ziel vorher
 * anvisieren (Hinweiszeile im Dialog). */
function stormArrowActionDialog(functionStuff, flag) {
  return new Promise((resolve) => {
    const volleyArrows = Math.min(flag.level >= 3 ? 3 : 2, flag.count);
    const buttons = {
      shot: {
        icon: '<i class="fas fa-crosshairs"></i>',
        label: game.i18n.format(game.i18n.localize("POWER_STORMARROW.BUTTON_SHOT"), { count: flag.count }),
        callback: async () => {
          await stormArrowFireShots(functionStuff, flag, 1, false);
          resolve();
        },
      },
    };
    if (flag.level >= 2) {
      buttons.volley = {
        icon: '<i class="fas fa-burst"></i>',
        label: game.i18n.format(game.i18n.localize("POWER_STORMARROW.BUTTON_VOLLEY"), { count: volleyArrows }),
        callback: async () => {
          await stormArrowFireShots(functionStuff, flag, flag.level >= 3 ? 3 : 2, true);
          resolve();
        },
      };
    }
    buttons.end = {
      icon: '<i class="fas fa-ban"></i>',
      label: game.i18n.localize("POWER_STORMARROW.BUTTON_END"),
      callback: async () => {
        await functionStuff.actor.unsetFlag(game.system.id, "stormArrow");
        /* Paket-2 v2: "Kraft beenden" nimmt das Kraftsymbol am Token
           mit ab (Flag zuerst, Marker danach, Hook bleibt still - die
           Ende-Karte kommt direkt darunter). */
        await stormArrowClearMarker(functionStuff.actor);
        await postMaintainChainCard(functionStuff, `<h4>${functionStuff.abilityName}</h4>`, [game.i18n.localize("POWER_STORMARROW.CHAT_END")], []);
        resolve();
      },
    };
    buttons.cancel = {
      icon: '<i class="fas fa-times"></i>',
      label: game.i18n.localize("BUTTON.CANCEL"),
      callback: async () => resolve(),
    };
    symbDialog({
      title: functionStuff.abilityName,
      content: `<div class="symbaroum dialog"><p class="lblfavour">${game.i18n.format(game.i18n.localize("POWER_STORMARROW.ACTIVE_STATUS"), { count: flag.count })}</p><p>${game.i18n.localize("POWER_STORMARROW.ACTION_HINT")}</p></div>`,
      classes: isModernDialogActive() ? modernDialogClasses("modern-stormarrow-action-dialog") : [],
      /* Paket-2 v2 (Rudolfs Testrunde v1: "Tasten übereinander anordnen
         wie bei Alchemie", Freigabe 23.11.): Footer-Buttons unterein-
         ander, gleiche Breite - 1:1 das Muster des Alchemie-Menüs
         (brewing.js): DialogV2 rendert sie im <footer>, das Spalten-
         Layout am Footer-Container; width 100% je Button braucht das
         WICHTIGE Inline-Style gegen die System-Regel
         "dialog.symb-dialog footer button" (width:auto !important),
         box-sizing + align-self sichern die exakt gleiche Breite. */
      onRender: (element) => {
        const btns = element?.querySelectorAll?.("footer button");
        if (!btns || btns.length === 0) return;
        const footer = btns[0].closest("footer") ?? btns[0].parentElement;
        if (footer) {
          footer.style.display = "flex";
          footer.style.flexDirection = "column";
          footer.style.gap = "0.25rem";
        }
        for (const b of btns) {
          b.style.boxSizing = "border-box";
          b.style.setProperty("width", "100%", "important");
          b.style.setProperty("align-self", "stretch", "important");
        }
      },
      buttons,
      default: "shot",
    });
  });
}

/* Sturmpfeil-Dispatch vor dem Würfeldialog (Hymnen-Muster): aktives
 * Flag in der aktuellen Szene = Aktions-Dialog (kein neuer Wurf, keine
 * Korruption); sonst Aktivierung mit Bestandscap aus dem Inventar. */
async function preDialogStormArrow(functionStuff) {
  const actor = functionStuff.actor;
  /* Paket-2 v2: Szenenwechsel lässt das Flag still verfallen (RAW
     "Rest der Szene") - dabei wird JETZT auch das Kraftsymbol am Token
     mit abgeräumt (vorher hing die Marke in der neuen Szene am Aktor,
     obwohl die Verzauberung kraftlos war) und das Flag gelöscht, dann
     ist sofort eine Neuaktivierung möglich. */
  const rawFlag = actor?.getFlag(game.system.id, "stormArrow");
  if (rawFlag && String(rawFlag.sceneId ?? "") !== String(game.scenes.current?.id ?? "")) {
    await actor.unsetFlag(game.system.id, "stormArrow");
    await stormArrowClearMarker(actor);
  }
  let flag = stormArrowActiveFlag(actor);
  if (flag && flag.count <= 0) {
    // verbrauchtes Flag räumt still (alle Pfeile verschossen) - danach
    // darf die Kraft sofort NEU aktiviert werden; das Kraftsymbol am
    // Token nimmt der normale Endpfad schon mit (v2), hier nur Nachsoge
    await actor.unsetFlag(game.system.id, "stormArrow");
    await stormArrowClearMarker(actor);
    flag = null;
  }
  /* Kräfte-Paket 2 v3 (Rudolfs Korrekturwunsch 2, Testrunde v2): A29-
     „Beibehalten" läuft STILL weiter (Feuerseele/Schutzrunen-Muster:
     kein Dialog, kein Wurf, keine Karte); der Aktions-Dialog (Salve/
     Abbruch) erscheint NUR beim direkten Kachel-Klick. */
  if (functionStuff.presetMaintain && flag) {
    return;
  }
  if (flag) {
    await stormArrowActionDialog(functionStuff, flag);
    return;
  }
  let count = 5;
  let stackIds = [];
  if (isAmmoConsumptionEnabled()) {
    const stacks = findAmmoStacks(actor, "pfeilbolzen");
    const total = getAmmoTotal(actor, "pfeilbolzen");
    if (total < 1) {
      ui.notifications.warn(game.i18n.localize("POWER_STORMARROW.WARN_NO_ARROWS"));
      return;
    }
    count = Math.min(5, total);
    stackIds = stacks.map((item) => item.id);
  }
  functionStuff.stormArrowCount = count;
  functionStuff.stormArrowStacks = stackIds;
  /* Erfolgszeile der Aktivierungskarte (Paket-2-v2-Fix, Rudolfs Testrunde
     Punkt 1): i18n.format ersetzt UNBELEGT bleibende Platzhalter mit
     "undefined" - der v1-Kommentar (Doppelformat, {actorname} bleibt für
     standardPowerResult stehen) war falsch, die Karte zeigte "undefined
     verzaubert 5 Pfeile". Beide Platzhalter werden HIER komplett eingesetzt;
     standardPowerResult formatiert den fertigen String ein zweites Mal,
     findet dann keinen Platzhalter mehr und laesst ihn unveraendert. */
  functionStuff.finalTextSucceed = game.i18n.format(game.i18n.localize("POWER_STORMARROW.CHAT_ARROWS"), {
    count,
    actorname: functionStuff.actingCharName ?? functionStuff.actor?.name ?? "",
  });
  await modifierDialog(functionStuff);
}

/* Sturmpfeil-Aktivierungsergebnis: Standard-Karte (probe/abgebucht wie
 * immer), bei Bestehen setzt sie den Bestands-Flag - die Pfeile bleiben
 * sonst ohne jede sichtbare Marke am Token (SL verschiebt/verwaltet). */
async function stormarrowResult(rollData, functionStuff) {
  await standardPowerResult(rollData, functionStuff);
  const succeeded = rollData == null || rollData[0].trueActorSucceeded === true;
  if (!succeeded) return;
  const count = Math.max(0, Math.min(5, Math.round(Number(functionStuff.stormArrowCount ?? 5)) || 0));
  if (count <= 0) return;
  await functionStuff.actor.setFlag(game.system.id, "stormArrow", {
    level: functionStuff.powerLvl?.level ?? 1,
    count: count,
    sceneId: String(game.scenes.current?.id ?? ""),
    stacks: functionStuff.stormArrowStacks ?? [],
    freeKey: null,
    volleyKey: null,
  });
  /* Paket-2 v2 (Rudolfs Testrunde v1: Kraftsymbol am Token + Maintain-
     Reminder nach Weltzeit, Freigabe 23.11.): Das Bestandsflag bleibt
     die alleinige Wahrheit; ZUSÄTZLICH trägt der Aktor jetzt das
     Sturmpfeil-Statussymbol (config.js statusEffects), dessen flagData
     {maintained, caster, ability, stormArrow} die A29-Maschine scannt
     (Kampf je Runde + Weltzeit alle 15 Minuten ohne Kampf, Sphäre-
     Präzedenzfall 1.5): "Beibehalten" öffnet über preDialogStormArrow
     den Aktions-Dialog (Kraft läuft weiter), "Abbrechen" löscht das
     Symbol -> der deleteActiveEffect-Hook (hooks.js) räumt Flag nach.
     Der Marker wird vor dem Neu-Antrag still entfernt (Rest-Marke
     nach Szenenwechsel oder händischem Flag-Lösch). */
  await stormArrowClearMarker(functionStuff.actor);
  await functionStuff.actor.addCondition("stormarrow", {
    maintained: true,
    caster: functionStuff.actor.id,
    ability: "stormarrow",
    stormArrow: true,
  });
}

/* Paket-2 v2: Sturmpfeil-Marker still abschrauben (idempotent, kein
   Fehler ohne Symbol). Reihenfolge-Konvention: IMMER zuerst das
   Bestandsflag räumen, DANACH den Marker - der deleteActiveEffect-
   Hook_postet seine Ende-Karte nur, solange das Flag noch stand
   (A29-Abbruch / SL zieht Icon ab); die eigenen Enden-Pfade (Kraft
   beenden, alle Pfeile verschossen) räumen das Flag zuerst, der Hook
   bleibt still, die eigene Karte des Endpfads erscheint. */
async function stormArrowClearMarker(actor) {
  if (!actor?.hasCondition?.("stormarrow")) return;
  await actor.removeCondition("stormarrow");
}

/* Teleport: Mitreisende eines Meister-Rituals - alle Token in Nah-
 * kampfreichweite des Mystikers (Chebyshev <= 1,5 Zellen, A29-Maßstab
 * thornCloakInMeleeRange), versteckte ausgenommen. */
function teleportCompanionCandidates(functionStuff) {
  const casterToken = functionStuff.token;
  const candidates = [];
  if (!casterToken) return candidates;
  for (const token of canvas.tokens.placeables) {
    if (!token?.actor || token.id === casterToken.id) continue;
    if (token.document?.hidden === true) continue;
    if (thornCloakInMeleeRange(casterToken, token)) candidates.push(token);
  }
  return candidates;
}

function teleportTravelDialog(functionStuff) {
  const candidates = teleportCompanionCandidates(functionStuff);
  const radios = candidates
    .map(
      (token, index) =>
        `<label class="lblfavour" style="display:block;margin:2px 0;"><input type="radio" name="teleport-companion" value="${token.id}"${index === 0 ? " checked" : ""} style="margin-right:6px;">${token.name}</label>`
    )
    .join("");
  const companionPick = candidates.length > 0
    ? `<label class="m-sec-label">${game.i18n.localize("POWER_TELEPORT.COMPANION_SELECT")}</label>${radios}`
    : `<p>${game.i18n.localize("POWER_TELEPORT.WARN_RANGE")}</p>`;
  const buttons = {
    alone: {
      icon: '<i class="fas fa-person-walking"></i>',
      label: game.i18n.localize("POWER_TELEPORT.BUTTON_ALONE"),
      callback: async () => {
        await modifierDialog(functionStuff);
      },
    },
  };
  if (candidates.length > 0) {
    const pickCompanion = (unwilling, html) => {
      const tokenId = html?.[0]?.querySelector?.('input[name="teleport-companion"]:checked')?.value ?? candidates[0]?.id;
      const token = candidates.find((t) => t.id === tokenId) ?? candidates[0];
      functionStuff.teleportCompanion = {
        tokenId: token.id,
        name: token.name,
        unwilling: unwilling,
      };
      /* Widerwillige: opponierte [Res<-Res]-Probe im Wurfdialog (Rudolfs
         Entscheidung 4, Schlingranken-Muster) - EIN Wurf regelt Reise
         UND Zwang, dokumentierte Vereinfachung des RAW-Zweiwurfs. */
      if (unwilling) {
        functionStuff.targetData = buildGlyphTargetData(token, "resolute");
      }
    };
    buttons.willing = {
      icon: '<i class="fas fa-handshake"></i>',
      label: game.i18n.localize("POWER_TELEPORT.BUTTON_WILLING"),
      callback: async (html) => {
        pickCompanion(false, html);
        await modifierDialog(functionStuff);
      },
    };
    buttons.unwilling = {
      icon: '<i class="fas fa-magnet"></i>',
      label: game.i18n.localize("POWER_TELEPORT.BUTTON_UNWILLING"),
      callback: async (html) => {
        pickCompanion(true, html);
        await modifierDialog(functionStuff);
      },
    };
  }
  buttons.cancel = {
    icon: '<i class="fas fa-times"></i>',
    label: game.i18n.localize("BUTTON.CANCEL"),
    callback: async () => {},
  };
  symbDialog({
    title: functionStuff.abilityName,
    content: `<div class="symbaroum dialog"><p class="lblfavour">${game.i18n.localize("POWER_TELEPORT.MASTER_DIALOG_HINT")}</p>${companionPick}</div>`,
    classes: isModernDialogActive() ? modernDialogClasses("modern-teleport-travel-dialog") : [],
    buttons,
    default: "alone",
  });
}

/* Teleport-Dispatch vor dem Würfeldialog: Novize/Adept reisen direkt
 * (normaler Wurfdialog), Meister wählt die Reise-Art. */
async function preDialogTeleport(functionStuff) {
  if ((functionStuff.powerLvl?.level ?? 1) < 3) {
    await modifierDialog(functionStuff);
    return;
  }
  teleportTravelDialog(functionStuff);
}

/* Teleport-Ergebnis: Standard-Karte (Wurf/Korruption wie immer), dann
 * bei Erfolg: Novize 1W4 Reiseschaden (Rüstung ignoriert - reiner
 * Zähigkeitsimpuls, kein Angriffs-Ereignis, keine Freie Attacke) und
 * beim Meister 1W4 Schaden + 1W4 temporäre Korruption auf den Mit-
 * reisenden, beides als eigene Zusammenfassungs-Karte mit Würfen plus
 * GM-Anwenden-Karte; anschließend die SL-Hinweiskarte (Token verschie-
 * ben, Rudolfs 2). Fehlschlag: NUR SL-Hinweiskarte (Rudolfs 3 + c) -
 * Novize Dämonen-Agent (1W6-Liste), Adept/Meister Aufhalteproben-
 * Hinweis, KEINE Wurftaste. */
async function teleportResult(rollData, functionStuff) {
  await standardPowerResult(rollData, functionStuff);
  const succeeded = rollData == null || rollData.some((r) => r.trueActorSucceeded === true);
  const level = functionStuff.powerLvl?.level ?? 1;
  if (!succeeded) {
    await postTeleportGmHintCard(functionStuff, level === 1 ? "POWER_TELEPORT.GM_DEMON" : "POWER_TELEPORT.GM_DEMON_HOLD", false);
    return;
  }
  const rolls = [];
  const lines = [];
  const gmApply = [];
  if (level === 1) {
    const travelRoll = await new Roll("1d4").evaluate();
    rolls.push(travelRoll);
    /* Paket-2-v2-Fix (Rudolfs Testrunde Punkt 8): TRAVEL_TEXT traegt den
       {actorname}-Platzhalter - ohne ihn schrieb i18n.format "Undefined
       erleidet ... Schaden". Der Wirkername ist im functionStuff verfueg-
       bar (setup: actingCharName). */
    lines.push(
      game.i18n.format(game.i18n.localize("POWER_TELEPORT.TRAVEL_TEXT"), {
        count: travelRoll.total,
        actorname: functionStuff.actingCharName ?? functionStuff.actor?.name ?? "",
      })
    );
    gmApply.push({
      tokenId: functionStuff.tokenId,
      actorId: functionStuff.actor.id,
      toughnessChange: -1 * travelRoll.total,
    });
  }
  const companion = functionStuff.teleportCompanion;
  if (companion) {
    const damageRoll = await new Roll("1d4").evaluate();
    const corruptionRoll = await new Roll("1d4").evaluate();
    rolls.push(damageRoll, corruptionRoll);
    lines.push(
      game.i18n.format(game.i18n.localize("POWER_TELEPORT.CHAT_COMPANION_COST"), {
        targetname: companion.name,
        count: damageRoll.total,
        corruption: corruptionRoll.total,
      })
    );
    gmApply.push({
      tokenId: companion.tokenId,
      toughnessChange: -1 * damageRoll.total,
      corruptionChange: corruptionRoll.total,
    });
  }
  if (lines.length > 0) {
    await postMaintainChainCard(functionStuff, `<h4>${functionStuff.abilityName}</h4>`, lines, rolls);
  }
  if (gmApply.length > 0) {
    await createModifyTokenChatButton(gmApply);
  }
  await postTeleportGmHintCard(functionStuff, "POWER_TELEPORT.GM_MOVE", Boolean(companion));
}

/* Geflüsterte SL-Hinweiskarte des Teleports (Muster der GM-Whisper-
 * Karten): Token verschieben nach Erfolg, Dämonen-Agent bzw. Aufhalte-
 * probe(n) nach Fehlschlag. Pflegt die SL ad hoc - Rudolfs 2/3/c. */
async function postTeleportGmHintCard(functionStuff, hintKey, withCompanion) {
  const namesForText = {
    actorname: functionStuff.actingCharName,
    targetname: functionStuff.teleportCompanion?.name ?? "",
  };
  let content = game.i18n.format(game.i18n.localize(hintKey), namesForText);
  if (withCompanion) {
    content += "<br>" + game.i18n.format(game.i18n.localize("POWER_TELEPORT.GM_MOVE_COMPANION"), namesForText);
  }
  const titleHtml = `<h4>${functionStuff.abilityName}</h4>`;
  const html = `<div class="symbaroum chat ability"><div class="foreground">${titleHtml}<div class="finalTxt"><p>${content}</p></div></div></div>`;
  const gmList = ChatMessage.getWhisperRecipients("GM");
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ alias: game.user.name, actor: functionStuff.actor.id }),
    content: html,
    whisper: gmList.length > 0 ? gmList : undefined,
  });
}

export async function standardPowerResult(rollData, functionStuff) {
  game.symbaroum.log("standardPowerResult", ...arguments);
  let hasRoll = false;
  let trueActorSucceeded = true; //true by default for powers without rolls
  let rolls = [];
  let rollString = "";
  let rollResult = "";
  let rollToolTip = "";
  if (rollData != null) {
    hasRoll = true;
    trueActorSucceeded = rollData[0].trueActorSucceeded;
    rollString = await formatRollString(rollData[0], functionStuff.targetData.hasTarget, rollData[0].modifier, { freeModifier: functionStuff.freeModifier ?? 0, boonLineChain: functionStuff.boonLineChain ?? [] });
    rollResult = rollData[0].rollResult;
    rollToolTip = rollData[0].toolTip;
    for (let i = 0; i < rollData.length; i++) {
      rolls = rolls.concat(rollData[i].rolls);
    }
  }

  if (functionStuff.rollFailedFSmod && !trueActorSucceeded) {
    functionStuff = Object.assign({}, functionStuff, functionStuff.rollFailedFSmod);
  }
  let flagData =
    functionStuff.actor.getFlag(game.system.id, functionStuff.flagTest) ?? functionStuff.actor.hasCondition(functionStuff.flagTest)?.getFlag(game.system.id, "flagData");

  game.symbaroum.log("Flag data", flagData);

  /* Kraefte-Paket 1 v1.5 (Rudolfs Testrunde v1.4 Punkt 5a): Bei der
     Sphaere liegt der Marker bei der Meister-Projektion auf dem
     VERBUENDETEN - der Mystiker traegt ihn NICHT. Die Toggle-Aufloesung
     (Aktivierung vs. Deaktivierung) muss den Verbundeten-Marker daher
     ueber die Caster-Marke (flagData.caster) finden, Muster a29Scan-
     MaintainedPowers; ohne den Lookup lief der Kachel-Abbruch in den
     AKTIVIERUNGS-Zweig zurueck (Endlos-Schleife, Testrunde v1.4). */
  if (functionStuff.flagTest === "sphere" && !flagData) {
    flagData = findSphereMarkerByCaster(functionStuff.actor?.id)?.flagData ?? null;
  }

  game.symbaroum.log("functionStuff before merge", functionStuff);
  /* Kräfte-Paket 1 (Sphäre): Marker-flagData als OBJEKT {level, choice} -
     die Radio-Wahl des Aktivierungsdialogs (Wahlmodell B, Rudolfs
     Entscheidung 5) wandert in den Marker; getItemModifierSphere, die
     buildRolls-Auto-Parade und die konditionsbasierte Verbündeten-
     Substitution (actor.js) lesen Stufe und Wahl daraus. Pfade ohne
     Dialog (Legacy) defaulten auf resolute. */
  /* v1.2 Hotfix (Rudolfs Testrunde 1, Punkt 16): Optional-Chaining-Guard -
     Ketten-/Zonenkraefte (Schwefelkaskade, Flammenwand, Schwächende Glyphe,
     Fegefeuer u. a.) haben KEIN flagNotPresentFSmod im Setup; der v1-Zugriff
     ohne Guard riss standardPowerResult fuer JEDE dieser Kraefte mit
     "TypeError: Cannot read properties of undefined (reading 'flagData')"
     ab (item.js:12900). Die Basis liest flagData NUR im gesicherten Zweig. */
  let markerFlagData = functionStuff.flagNotPresentFSmod?.flagData;
  const isSphereActivation = functionStuff.flagTest === "sphere" && functionStuff.ability?.reference === "sphere" && !flagData;
  if (isSphereActivation) {
    /* Kraefte-Paket 1 v1.5 (Rudolfs Entscheidung 23.11., "wie Feuerseele"):
       Die Sphaere traegt JETZT die Maintain-/Caster-Tags - damit nimmt sie
       am A29-Maintain-Reminder teil (Kampf je Runde + Weltzeit alle 15 min
       ohne Kampf "Behalten/Abbrechen") UND an der Hymnen-1.5/1.6-Konzen-
       trations-Maschine (Zahigkeitsverlust => GM-+Spieler-Karte, EINE
       verfehlte Probe beendet ALLE) - vorher bewusst ohne Tags (Rudolfs
       Entscheidung 5 in der v1.3-Auswahlrunde, jetzt ersetzt). {level,
       choice} bleiben unveraendert (Auto-Parade/Wahl lesen weiter daraus). */
    markerFlagData = {
      level: Number(functionStuff.flagNotPresentFSmod.flagData) || functionStuff.powerLvl?.level || 1,
      choice: functionStuff.sphereChoice ?? "resolute",
      maintained: true,
      caster: functionStuff.actor.id,
      ability: "sphere",
    };
  }
  /* Kraefte-Paket 1 v1.3 (Rudolfs Baufreigabe 22.11. "Leg los"): Feuerseele
     und Schutzrunen tragen ihre Marker ab sofort als OBJEKT mit den
     Maintain-Tags {maintained, caster, ability} - so erkennen sie die
     bestehenden Maschinen: der A29-Maintain-Reminder (Kampf je Runde +
     Weltzeit alle 15 Minuten ohne Kampf, AoE v2.5) UND die Hymnen-1.5/1.6-
     Konzentrations-Karte (preUpdateActor auf Zaehigkeitsverlust: geflues-
     terte GM-Karte mit Proben-Taste je andauernder Kraft PLUS EIGENE
     Spieler-Karte, 1W20 <= [Willenskraft - Schaden], EINE verfehlte Probe
     beendet ALLE, Abraeumen via a29AbortMaintainPower mit Ende-Karten im
     Glyphen/Hymnen-Stil). Die stille Maintain-Auto-Probe aus
     protectiveRunesRetaliation ist damit ENTFERNT (Rudolfs 4a-Wunsch:
     interaktive Probe statt stiller Wuerfe, "gilt fuer alle Kraefte" -
     hier ueber die generische Schadens-Erkennung abgedeckt). Die Sphaere
     bleibt bewusst OHNE Maintain-Tags (Rudolfs Entscheidung: keine
     Konzentrations-Logik, Ende laeuft ueber den Angriffs-/Kraft-Trigger). */
  const isFiresoulActivation = functionStuff.flagTest === "firesoul" && functionStuff.ability?.reference === "firesoul" && !flagData;
  if (isFiresoulActivation) {
    markerFlagData = {
      level: functionStuff.powerLvl?.level ?? 1,
      maintained: true,
      caster: functionStuff.actor.id,
      ability: "firesoul",
    };
  }
  const isProtectiveRunesActivation = functionStuff.flagTest === "protectiverunes" && functionStuff.ability?.reference === "protectiverunes" && !flagData;
  if (isProtectiveRunesActivation) {
    const protectiveRunesLevel = Number(functionStuff.flagNotPresentFSmod?.flagData) || functionStuff.powerLvl?.level || 1;
    markerFlagData = {
      level: protectiveRunesLevel,
      maintained: true,
      caster: functionStuff.actor.id,
      ability: "protectiverunes",
    };
  }
  if (functionStuff.flagTest && trueActorSucceeded) {
    if (flagData) {
      // The following line is just for clean-up legacy
      await functionStuff.actor.unsetFlag(game.system.id, functionStuff.flagTest);
      await functionStuff.actor.removeCondition(functionStuff.flagTest);
      /* Kraefte-Paket 1 v1.5 (Punkt 5a): Bei der Sphaere kann der Marker
         auf dem VERBUENDETEN liegen (Meister-Projektion) - die Deakti-
         vierung raeumt zusaetzlich ALLE Sphaeren-Marker mit dieser
         Caster-Marke in der Szene ab, sonst bliebe der Verbundete
         ewig umschlossen und der Abbruch startete die Aktivierung neu. */
      if (functionStuff.flagTest === "sphere") {
        await removeSphereMarkersByCaster(functionStuff.actor);
      }
      functionStuff = Object.assign({}, functionStuff, functionStuff.flagPresentFSmod);
    } else {
      await functionStuff.actor.addCondition(functionStuff.flagTest, markerFlagData);
      functionStuff = Object.assign({}, functionStuff, functionStuff.flagNotPresentFSmod);
      /* Kräfte-Paket 1 (Sphäre-Meister, Rudolfs Entscheidung 7; v1.7
         Vault-RAW-Abgleich): Der VERBÜNDETE wird zusätzliche eingeschlossen
         (Distanz-Gate Nah = 1,5 Felder Abstand zum Mystiker; genau EIN
         Kandidat => automatisch, mehrere => Auswahl-Dialog, HUD-Manual
         entfällt; ohne Kandidat bleibt es bei der Mystiker-Sphäre, SL-
         Hinweis auf der Karte). Seit v1.7 BEHÄLT der Mystiker seinen
         eigenen Marker (Dornenmantel-Modell, Vault-RAW: kein „statt"). */
      if (isSphereActivation && (functionStuff.powerLvl?.level ?? 0) >= 3) {
        await sphereMasterAllyPlacement(functionStuff);
      }
    }
  }
  game.symbaroum.log("functionStuff after merge", functionStuff);

  let flagDataArray = functionStuff.flagDataArray ?? [];
  let haveCorruption = false;
  let corruptionText = "";
  let corruption;
  let namesForText = {
    actorname: functionStuff.actingCharName,
    targetname: functionStuff.targetData?.name ?? "",
    targetshadow: functionStuff.targetData?.actor?.system.bio.shadow ?? "",
  };
  let targetText = game.i18n.format(functionStuff.targetText ?? "", namesForText);
  if (!functionStuff.isMaintained && functionStuff.corruption !== game.symbaroum.config.TEMPCORRUPTION_NONE) {
    haveCorruption = true;
    corruption = await functionStuff.actor.getCorruption(functionStuff);
    corruptionText = game.i18n.localize("POWER.CHAT_CORRUPTION") + corruption.value;
    if (corruption.sorceryRoll) corruptionText += " (sorcery roll result:" + corruption.sorceryRoll.diceResult + ")";
    // Hymnen-Paket 1.1: der ehemalige confirmDialog-Direktpfad (Anwendung
    // ohne GM-Karte, inkl. Schwellen-Check und Meister-Reaktionen hier im
    // Ergebnis-Pfad) ist entfallen - alle Kräfte buchen die Korruption
    // seit 1.1 über die GM-Anwenden-Karte (Flag corruptionChange, Handler
    // in hooks.js führt Schwellen-Check und Meister-Reaktionen aus).
    flagDataArray.push({
      tokenId: functionStuff.tokenId,
      actorId: functionStuff.actor.id,
      corruptionChange: corruption.value,
    });
  }

  if (functionStuff.resultRolls !== undefined && functionStuff.resultRolls !== null) {
    rolls = rolls.concat(functionStuff.resultRolls);
  }
  let resultText = game.i18n.format(trueActorSucceeded ? functionStuff.resultTextSuccess : functionStuff.resultTextFail, namesForText);
  let finalText = game.i18n.format(functionStuff.finalText ?? "", namesForText);
  let subText = functionStuff.subText ?? functionStuff.abilityName + " (" + functionStuff.powerLvl.lvlName + ")";
  let introText = game.i18n.format(functionStuff.isMaintained ? functionStuff.introTextMaintain : functionStuff.introText, namesForText);
  if (functionStuff.finalTextSucceed && trueActorSucceeded) finalText = game.i18n.format(functionStuff.finalTextSucceed, namesForText);
  else if (functionStuff.targetData.hasTarget && functionStuff.targetData.autoParams != "") {
    targetText += ": " + functionStuff.targetData.autoParams;
  }

  let hasDamage = functionStuff.hasDamage;
  let doDamage = (hasDamage && trueActorSucceeded) || functionStuff.avoidDamageDice;
  let damageTot = 0;
  let damageText = "";
  let damageRollResult = "";
  let dmgFormula = "";
  let damageTooltip = "";
  let damageFinalText = "";
  let damageDice = functionStuff.dmgavoiding ? functionStuff.avoidDamageDice : functionStuff.damageDice;
  let targetDies = false;

  if (damageDice === "0d0") {
    doDamage = false;
    resultText = game.i18n.format(game.i18n.localize("POWER_BRIMSTONECASC.CHAT_FAILURE_RR"), namesForText);
  }
  if (functionStuff.ability.reference === "blessedshield" && trueActorSucceeded) {
    let protectionFormula = "1d" + (2 + 2 * functionStuff.powerLvl.level);

    flagDataArray.push({
      tokenId: functionStuff.tokenId,
      actorId: functionStuff.actor.id,
      addObject: "blessedshield",
      protection: protectionFormula,
    });
    finalText = game.i18n.format(game.i18n.localize("POWER_BLESSEDSHIELD.PROTECTED"), namesForText) + " (" + protectionFormula + ")";

    if (functionStuff.targets) {
      for (let target of functionStuff.targets) {
        let effect = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "holyShield"));
        flagDataArray.push(
          {
            tokenId: target.tokenId,
            addEffect: effect,
            effectDuration: 1,
          },
          {
            tokenId: target.tokenId,
            addObject: "blessedshield",
            protection: protectionFormula,
          }
        );
        finalText += ", " + game.i18n.format(game.i18n.localize("POWER_BLESSEDSHIELD.PROTECTED"), { actorname: target.name });
      }
    }
  }

  if (functionStuff.confusion && trueActorSucceeded) {
    let confusionRoll = await new Roll("1d6").evaluate();
    rolls.push(confusionRoll);

    finalText = confusionRoll.total.toString() + ": ";
    if (confusionRoll.total < 3) {
      finalText += game.i18n.format(game.i18n.localize("POWER_CONFUSION.EFFECT12"), namesForText);
    } else if (confusionRoll.total < 5) {
      finalText += game.i18n.format(game.i18n.localize("POWER_CONFUSION.EFFECT34"), namesForText);
    } else {
      finalText += game.i18n.format(game.i18n.localize("POWER_CONFUSION.EFFECT56"), namesForText);
    }
  }

  if (functionStuff.blackbreath && trueActorSucceeded) {
    // A25 stage 4 (APG): a d4/d6 rolls against the target's TOTAL
    // corruption - a low roll heals its corruption, a high one corrupts;
    // a healed target breaks the Master's chain (blackbreathHealed)
    const corruptionRoll = await new Roll(functionStuff.powerLvl.level > 1 ? "1d6" : "1d4").evaluate();
    rolls.push(corruptionRoll);
    const targetCorruption = functionStuff.targetData.actor.system.health.corruption;
    if (corruptionRoll.total <= targetCorruption.value) {
      const healed = Math.min(corruptionRoll.total, targetCorruption.temporary);
      flagDataArray.push({ tokenId: functionStuff.targetData.tokenId, corruptionChange: -1 * healed });
      finalText = game.i18n.format("POWER_BLACKBREATH.CHAT_HEAL", { targetname: functionStuff.targetData.name, count: healed });
      functionStuff.blackbreathHealed = true;
    } else {
      flagDataArray.push({ tokenId: functionStuff.targetData.tokenId, corruptionChange: corruptionRoll.total });
      finalText = game.i18n.format("POWER_BLACKBREATH.CHAT_CORRUPTED", { targetname: functionStuff.targetData.name, count: corruptionRoll.total });
    }
    if (functionStuff.powerLvl.level > 2 && functionStuff.blackbreathHealed) {
      finalText += " " + game.i18n.localize("POWER_BLACKBREATH.CHAT_CHAIN_END");
    }
  }

  if (functionStuff.usePoison && functionStuff.poison > 0) {
    /* MM-Paket 1 (Giftspucke): Flag poisonResistSeparate (traitSetupPoisonspit)
       - der Angriffswurf [Präzision<-Gewandtheit] ist NICHT die Resistenz;
       bei TREFFER folgt die SEPARATE Giftresistenz [Scharfsinn<-Stärke]
       (RAW: das Opfer widersteht dem Gift mit [Stärke<-Scharfsinn], Vault-
       Notiz "Giftspucke.md") als eigener einseitiger Wurf - Funktion wie die
       Giftprobe im Angriffs-Pfad (Muster baseRoll-Giftprobe im
       Angriffs-Block der attackResult).
       Bei ANGRIFFS-MISSERFELG läuft KEIN Giftpfad: die Karte zeigt allein
       den Fehlschlag (bewusster Unterschied zum Giftig-Pfad, dessen
       Aktionswurf identisch mit der Resistenz ist). */
    /* Konzept Runde 3 Teil A: die separate Giftspucke-Resistenz laeuft
       jetzt INLINE im Cross-Waffen-Rider (mm2AttackerTraits) - der
       poisonResistSeparate-Flag-Pfad (ehemaliger traitSetupPoisonspit-
       Setter) ist tot und wurde entfernt. */
    const poisonRes = await poisonCalc(functionStuff, rollData[0]);
    if (poisonRes) {
      // Gift v1: nur bei echtem Giftwurf auf die Karte (Neutralisierung
      // durch Giftresistent zeigt poisonCalc ohne eigenen Wurf an).
      if (poisonRes.roll) rolls.push(poisonRes.roll);
      // Elixiere v1.6: konstanter Gift-Rundenschaden als eigener Wurf auf der Karte
      if (poisonRes.poisonDotRoll) rolls.push(poisonRes.poisonDotRoll);

      introText = poisonRes.poisonChatIntro;
      resultText = poisonRes.poisonChatResult;
      if (poisonRes.flagData) flagDataArray.push(poisonRes.flagData);
      // Gift v1 B3 (Stufen des Giftmischers): Dosis-Abbuchung erst bei
      // GELUNGENER Vergiftung (poisonApplied), nie bei Misslingen oder
      // Neutralisierung; poisonFromCoat = der Wurf lief schon ueber eine
      // abgebuchte Beschichtungs-Dosis, kein zweiter Verbrauch.
      // Novize: 1 Dosis je vergiftetem Treffer (je Stufe).
      // Adept/Meister: 1 Dosis startet die Beschichtung fuer die GANZE
      // Kampfszene (Condition poisoncoat); laeuft dieselbe Stufe bereits,
      // wird NICHT neu abgebucht.
      if (poisonRes.poisonApplied && functionStuff.poisonChosen > 0 && !functionStuff.poisonFromCoat) {
        const poisonerLevel = getActorAbilityLevel(functionStuff.actor, "poisoner");
        if (poisonerLevel === 1) {
          await consumePoisonDoseByGrade(functionStuff.actor, functionStuff.poisonChosen);
        } else if (poisonerLevel >= 2) {
          const coatGrade = getActivePoisonCoatGrade(functionStuff.actor);
          if (coatGrade !== functionStuff.poisonChosen) {
            if (await consumePoisonDoseByGrade(functionStuff.actor, functionStuff.poisonChosen)) {
              await setPoisonCoat(functionStuff.actor, functionStuff.poisonChosen);
            }
          }
        }
      }
    }
  }

  if (functionStuff.ability.reference === "strangler" && trueActorSucceeded) {
    functionStuff.hasAdvantage = false; //to prevent +1d4 damage
  }

  if (functionStuff.ability.reference === "witchsight" && functionStuff.targetData?.hasTarget && trueActorSucceeded) {
    finalText = game.i18n.format(game.i18n.localize("ABILITY_WITCHSIGHT.CHAT_FINAL"), namesForText);
  }

  if (doDamage) {
    let targetValue = functionStuff.targetData.actor.system.health.toughness.value;
    if (functionStuff.isAlternativeDamage) {
      targetValue = getAttributeValue(functionStuff.targetData.actor, functionStuff.alternativeDamageAttribute);
    }
    let damage = await simpleDamageRoll(functionStuff, damageDice);
    rolls.push(damage.roll);

    damageRollResult += await formatRollResult(damage);
    dmgFormula = game.i18n.localize("WEAPON.DAMAGE") + ": " + damage.roll._formula;

    //damage reduction (Undead trait, swarm...)
    let finalDmg = await mathDamageProt(functionStuff.targetData.actor, damage.roll.total, functionStuff.damageType);
    // Kraefte-Paket 1 (Feuerseele-Meister): Heilung aus mathDamageProt
    // (Feuerschaden => Haelfte als Zaehigkeit zurueck) mitbuchen
    if (finalDmg.firesoulHeal > 0) {
      flagDataArray.push({ tokenId: functionStuff.targetData.tokenId, toughnessChange: finalDmg.firesoulHeal });
    }
    // pain (damage > toughness treshold)
    let pain = checkPainEffect(functionStuff, finalDmg.damage);
    damageTot = finalDmg.damage;
    dmgFormula += finalDmg.text;

    damageText = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_DAMAGE") + damageTot.toString();
    damageTooltip = new Handlebars.SafeString(await damage.roll.getTooltip());

    if (functionStuff.isAlternativeDamage) {
      dmgFormula += " (" + game.symbaroum.api.getAttributeLabel(functionStuff.targetData.actor, functionStuff.alternativeDamageAttribute) + ")";
      damageText += " (" + game.symbaroum.api.getAttributeLabel(functionStuff.targetData.actor, functionStuff.alternativeDamageAttribute) + ")";
    }
    if (damageTot <= 0) {
      damageTot = 0;
      damageText = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_DAMAGE_NUL");
    } else {
      if (damageTot >= targetValue) {
        targetDies = true;
        damageFinalText = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_DAMAGE_DYING");
        // A25 F11: Foundry V14 API - Combat#getCombatantByToken is deprecated
        // (V15 removes it), getCombatantsByToken returns the matching combatants
        if (ui.combat.viewed && (ui.combat.viewed.getCombatantsByToken(functionStuff.targetData.tokenId) ?? []).length > 0) {
          flagDataArray.push({
            tokenId: functionStuff.targetData.tokenId,
            defeated: true,
          });
        } else {
          flagDataArray.push({
            tokenId: functionStuff.targetData.tokenId,
            addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "dead")),
            overlay: true,
            effectDuration: 1,
          });
        }
      } else if (pain) {
        damageFinalText = functionStuff.targetData.name + game.i18n.localize("COMBAT.CHAT_DAMAGE_PAIN");
        flagDataArray.push({
          tokenId: functionStuff.targetData.tokenId,
          addEffect: foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "prone")),
          effectDuration: 1,
        });
      }
      if (functionStuff.isAlternativeDamage) {
        flagDataArray.push({
          tokenId: functionStuff.targetData.tokenId,
          attributeChange: damageTot * -1,
          attributeName: functionStuff.alternativeDamageAttribute,
        });
      } else {
        flagDataArray.push({
          tokenId: functionStuff.targetData.tokenId,
          toughnessChange: damageTot * -1,
        });
      }
    }
  }

  let templateData = {
    targetData: functionStuff.targetData,
    hasTarget: functionStuff.targetData.hasTarget,
    introText: introText,
    introImg: functionStuff.actingCharImg,
    targetText: targetText,
    subText: subText,
    subImg: functionStuff.abilityImg,
    hasRoll: hasRoll,
    resistRoll: functionStuff.resistRoll,
    resistRollText: functionStuff.resistRollText,
    rollString: rollString,
    rollResult: rollResult,
    rollToolTip: rollToolTip,
    /* S3: „Test-Rig“-Zeile (ability.hbs) auch auf Fähigkeitskarten —
       rigged kommt aus doBaseRoll (applyRigToBaseRoll, roll.js) und
       ist bei normalen Würfen 0/undefined (Zeile entfällt). */
    rigged: hasRoll ? rollData[0]?.rigged ?? 0 : 0,
    resultText: resultText,
    finalText: finalText,
    hasDamage: doDamage,
    damageText: damageText,
    damageRollResult: damageRollResult,
    dmgFormula: dmgFormula,
    damageRollMod: "",
    damageTooltip: damageTooltip,
    damageFinalText: damageFinalText,
    haveCorruption: haveCorruption,
    corruptionText: corruptionText,
  };
  if (functionStuff.autoParams != "") {
    templateData.subText += ", " + functionStuff.autoParams;
  }
  /* Trollsingen-Reroll (Hymnen-Paket v1, Rudolfs Entscheidungen 8+10,
     Erstbau): Die Ergebniskarte einer fehlgeschlagenen Geist-Beein-
     flussungs-Probe (resolute-Resist) eines Trollsängers erhält die
     Wiederholungs-Taste - buildRolls hat die Eligibility geprüft und
     den Payload mitgegeben, der Konsum der Frequenz (Novize 1×/Szene,
     Adept 1×/Runde, Meister beliebig) erfolgt erst beim KLICK über
     den hooks.js-Handler. */
  if (functionStuff.trollRerollPayload && !trueActorSucceeded && hasRoll) {
    templateData.trollReroll = true;
    templateData.subText += ", " + game.i18n.localize("TROLLSINGING.REROLL_TAG");
  }

  /* if the power / ability have healing effects  */
  if (functionStuff.healFormulaSucceed && !functionStuff.medicusExam) {
    let healResult;
    let healingBonus = functionStuff.healingBonus ?? "";
    if (functionStuff.healedToken === game.symbaroum.config.TARGET_TOKEN) {
      functionStuff.healedToken = functionStuff.targetData.token;
    } else functionStuff.healedToken = functionStuff.token;
    if (trueActorSucceeded) {
      healResult = await healing(functionStuff.healFormulaSucceed + healingBonus, functionStuff.healedToken, functionStuff.attackFromPC);
      if (functionStuff.attackFromPC) rolls.push(healResult.roll);
    } else if (!trueActorSucceeded && functionStuff.healFormulaFailed) {
      healResult = await healing(functionStuff.healFormulaFailed + healingBonus, functionStuff.healedToken, functionStuff.attackFromPC);
      if (functionStuff.attackFromPC) rolls.push(healResult.roll);
    } else if (
      !trueActorSucceeded &&
      functionStuff.resourceConsumed &&
      functionStuff.resourceConsumed.category === RESOURCE_CONSUMERS.medicus.category &&
      rollData?.[0]?.critFail !== true
    ) {
      // Ressourcen v1, Rudolfs Runde-1-Regel: Die Kraeuterarznei gibt IMMER
      // ihre Basis-Heilung von 1 Punkt Zaehigkeit - auch bei misslungenem
      // Wurf, AUSSER beim kritischen Patzer (kritischer Patzer = keine
      // Basis-Heilung). Diese Basis-Heilung greift genau dort, wo es bislang
      // KEINE fehlgeschlagene Heilformel gab (Novize/Adept); der Meister
      // behaelt seine RAW-1W6-Heilung bei Fehlschlag (healFormulaFailed
      // weiter oben, unabhaengig vom kritischem Patzer - unveraendertes
      // RAW-Verhalten), die die 1-Punkt-Basis-Heilung bereits einschliesst.
      // Die Chat-Karte zeigt den Verbrauch im subText (autoParams-Label
      // „<Stapelname> -1" aus dem modifierDialog-Submit).
      healResult = await healing("1" + healingBonus, functionStuff.healedToken, functionStuff.attackFromPC);
      if (functionStuff.attackFromPC) rolls.push(healResult.roll);
    }
    if (healResult) {
      // game.symbaroum.log(healResult)
      templateData.hasDamage = healResult.hasDamage;
      templateData.damageText = healResult.damageText;
      if (functionStuff.attackFromPC) {
        templateData.dmgFormula = healResult.dmgFormula;
        templateData.damageTooltip = healResult.damageTooltip;
      }
      templateData.damageFinalText = "";
      // Hymnen-Paket 1.1: der ehemalige confirmDialog-Direktpfad (Heilung
      // ohne GM-Karte, inkl. Stabilisierung hier im Ergebnis-Pfad) ist
      // entfallen - die Heilung laeuft seit 1.1 immer ueber die GM-
      // Anwenden-Karte (healResult.flagData, Stabilisierung im hooks.js-
      // Handler).
      flagDataArray.push(healResult.flagData);

      if (functionStuff.ability.reference === "inheritwound") {
        let inheritDamage = functionStuff.powerLvl.level > 1 ? Math.ceil(healResult.healed / 2) : healResult.healed;
        templateData.finalText +=
          game.i18n.format(game.i18n.localize("POWER_INHERITWOUND.CHAT_HEALED"), namesForText) +
          healResult.healed.toString() +
          "; " +
          game.i18n.format(game.i18n.localize("POWER_INHERITWOUND.CHAT_DAMAGE"), namesForText) +
          inheritDamage.toString();
        flagDataArray.push({
          tokenId: functionStuff.tokenId,
          toughnessChange: inheritDamage * -1,
        });
        if (functionStuff.powerLvl.level > 1) {
          templateData.finalText += game.i18n.localize("POWER_INHERITWOUND.CHAT_REDIRECT");
          const pEffect = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "poison"));
          let poisonedEffectCounter = functionStuff.targetData.token?.actor.hasCondition(pEffect.id);
          if (poisonedEffectCounter) {
            //target  poisoned
            //get the number of rounds left
            let timeLeft = 1;
            //set status to caster
            // A28 Stufe 1: the transferred poison keeps its nature - the dot block
            // makes the caster's condition engine-managed (1d4/round, one round as
            // intended by the transferred timeLeft)
            flagDataArray.push(
              {
                tokenId: functionStuff.tokenId,
                addEffect: pEffect,
                effectDuration: timeLeft,
                dot: {
                  label: "QUALITY.POISON",
                  formula: "1d4",
                  resource: "toughness",
                  damageType: "poison",
                  stackable: false,
                  separateRoll: false,
                },
              },
              {
                tokenId: functionStuff.targetData.tokenId,
                removeEffect: pEffect,
              }
            );
          }
          const bEffect = foundry.utils.duplicate(CONFIG.statusEffects.find((e) => e.id === "bleeding"));
          let bleedEffectCounter = functionStuff.targetData.token?.actor.hasCondition(bEffect.id);
          if (bleedEffectCounter) {
            //get the number of rounds left
            let timeLeft = 1;
            //set status to caster
            // A28 Stufe 1: the transferred bleeding keeps its nature - the dot block
            // makes the caster's condition engine-managed (1 point/round, stackable)
            flagDataArray.push(
              {
                tokenId: functionStuff.tokenId,
                addEffect: bEffect,
                effectDuration: timeLeft,
                dot: {
                  label: "QUALITY.BLOODLETTING",
                  formula: "1",
                  resource: "toughness",
                  damageType: "bleeding",
                  stackable: true,
                  separateRoll: false,
                },
              },
              {
                tokenId: functionStuff.targetData.tokenId,
                removeEffect: bEffect,
              }
            );
          }
        }
      }
    }
  }
  // Maestro
  let actorid = functionStuff.actor.id;
  templateData.id = functionStuff.abilityId;
  // End Maestro

  // Pick up roll system
  const html = await foundry.applications.handlebars.renderTemplate("systems/symbaroum/template/chat/ability.hbs", templateData);
  const chatData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({
      alias: game.user.name,
      actor: actorid,
    }),
    rollMode: game.settings.get("core", "messageMode"),
    content: html,
  };
  if (functionStuff.gmOnlyChatResultNPC && !functionStuff.attackFromPC) {
    let gmList = ChatMessage.getWhisperRecipients("GM");
    if (gmList.length > 0) {
      chatData.whisper = gmList;
    }
  } else if (rolls.length > 0) {
    // Only shows rolls if they are displayed to
    chatData.rolls = [createRollData(rolls)];
  }
  // Trollsingen-Reroll: der Payload reist als Nachrichten-Flag mit
  // (resistRoll-Muster), der hooks.js-Handler hängt die Referenzen beim
  // Klick wieder an und ruft trollRerollInvoke
  if (templateData.trollReroll) {
    chatData[`flags.${game.system.id}.trollReroll`] = functionStuff.trollRerollPayload;
  }
  ChatMessage.applyMode(chatData, "public");
  let NewMessage = await ChatMessage.create(chatData);
  // A25 F10 (i): a target killed by the initial cast receives no power
  // symbols at all - a dead token must not enter the chain (the standard
  // path's dying check already marks it defeated, this keeps the symbols off)
  if (trueActorSucceeded && !targetDies && functionStuff.addTargetEffect.length > 0) {
    for (let effect of functionStuff.addTargetEffect) {
      let effectPresent = functionStuff.targetData.token?.actor.hasCondition(effect.id);
      if (!effectPresent) {
        // A23: remember the caster so the maintain chain only maintains own symbols
        // A24: snapshot the originator's resolute (Anathema probe resistance) and name
        // A34: turn-end conditions (Dominance-Adept, Battlesymbol-Novice) mark their
        // entry - the payload of every other power stays byte-identical
        // A34-Fix (Rudolf's test round, Befunde 2+3): ONLY a maintain-capable
        // power marks its symbols as maintained - the author markers below alone
        // must never raise the A29 "maintain?" reminder (Dominance fear, Battlesymbol
        // -Novice berserker, Leader eye, Prios stun carry them for the maintain CHAIN)
        flagDataArray.push({
          tokenId: functionStuff.targetData.tokenId,
          addEffect: effect,
          effectDuration: 1,
          ...(functionStuff.targetEffectTurnEnd === true ? { turnEnd: true } : {}),
          ...((functionStuff.maintain !== game.symbaroum.config.MAINTAIN_NOT || functionStuff.followUpMaintainedMarker === true)
            ? { maintained: true }
            : {}),
          ...(functionStuff.ability?.reference === "markoftorment" && functionStuff.powerLvl.level > 1 ? { attackerFavour: true } : {}),
          casterId: functionStuff.actor.id,
          abilityRef: functionStuff.ability?.reference,
          casterResolute: getAttributeValue(functionStuff.actor, "resolute"),
          casterName: functionStuff.actingCharName,
        });
      }
    }
  }
  if (trueActorSucceeded && functionStuff.addCasterEffect.length > 0 && functionStuff.tokenId) {
    // Add condition to master actor first, that way when we loop through any effects for the token actor
    // we will not duplicate if it is a token actor - order is important here.
    await functionStuff.actor.addCondition(functionStuff.flagTest, flagData);
    for (let effect of functionStuff.addCasterEffect) {
      await functionStuff.token?.actor.addCondition(effect, flagData);
    }
  }
  if (trueActorSucceeded && functionStuff.removeTargetEffect.length > 0) {
    for (let effect of functionStuff.removeTargetEffect) {
      let effectPresent = functionStuff.targetData.token?.actor.hasCondition(effect.id);
      if (effectPresent) {
        flagDataArray.push({
          tokenId: functionStuff.targetData.tokenId,
          removeEffect: effect,
        });
      }
    }
  }
  if (trueActorSucceeded && functionStuff.removeCasterEffect.length > 0 && functionStuff.tokenId) {
    await functionStuff.actor.removeCondition(functionStuff.flagTest);
    for (let effect of functionStuff.removeCasterEffect) {
      await functionStuff.token?.actor.removeCondition(effect);
    }
  }
  // A25 F10 (i): a target killed by the initial cast receives no power
  // symbols at all - a dead token must not enter the chain
  if (trueActorSucceeded && !targetDies && !functionStuff.isMaintained && functionStuff.activelyMaintainedTargetEffect.length > 0) {
    for (let effect of functionStuff.activelyMaintainedTargetEffect) {
      let effectPresent = functionStuff.targetData.token?.actor.hasCondition(effect.id);
      if (!effectPresent) {
        // A23: remember the caster so the maintain chain only maintains own symbols
        // A24: snapshot the originator's resolute (Anathema probe resistance) and name
        // A34-Fix (Rudolf's test round, Befunde 2+3): genuine maintain symbols carry
        // the maintained marker so ONLY they raise the A29 "maintain?" reminder
        // P26-fix2 (Rudolf's fix1 test round): the marker is now CONDITIONAL, like
        // the A34-Fix already did in the addTargetEffect block above - a power
        // level without maintain (Blinding Symbol novice/master per APG: the adept
        // alone can maintain, master lasts until healed) must NOT tag its symbols
        // as maintained: the A29 reminder would ask "maintain?" for a power that
        // cannot be maintained on that level, "yes" recasts with full corruption
        // and "no" would delete an until-healed symbol. Verified: every other
        // activelyMaintainedTargetEffect power sets the symbol only on levels
        // with maintain (Battlesymbol adept/master, Mark of Torment novice/adept,
        // all others), so Blinding Symbol novice/master is the only behavior change.
        flagDataArray.push({
          tokenId: functionStuff.targetData.tokenId,
          addEffect: effect,
          effectDuration: 1,
          ...((functionStuff.maintain !== game.symbaroum.config.MAINTAIN_NOT || functionStuff.followUpMaintainedMarker === true)
            ? { maintained: true }
            : {}),
          ...(functionStuff.ability?.reference === "markoftorment" && functionStuff.powerLvl.level > 1 ? { attackerFavour: true } : {}),
          casterId: functionStuff.actor.id,
          abilityRef: functionStuff.ability?.reference,
          casterResolute: getAttributeValue(functionStuff.actor, "resolute"),
          casterName: functionStuff.actingCharName,
        });
      }
    }
  }
  if (!trueActorSucceeded && functionStuff.isMaintained && functionStuff.activelyMaintainedTargetEffect.length > 0) {
    for (let effect of functionStuff.activelyMaintainedTargetEffect) {
      let effectPresent = functionStuff.targetData.token?.actor.hasCondition(effect.id);
      if (effectPresent) {
        flagDataArray.push({
          tokenId: functionStuff.targetData.tokenId,
          removeEffect: effect,
        });
      }
    }
  }
  if (trueActorSucceeded && !functionStuff.isMaintained && functionStuff.activelyMaintaninedCasterEffect.length > 0 && functionStuff.tokenId) {
    for (let effect of functionStuff.activelyMaintaninedCasterEffect) {
      let effectPresent = functionStuff.token?.actor.hasCondition(effect.id);
      if (!effectPresent) {
        flagDataArray.push({
          tokenId: functionStuff.tokenId,
          addEffect: effect,
          effectDuration: 1,
        });
      }
    }
  }
  if (!trueActorSucceeded && functionStuff.isMaintained && functionStuff.activelyMaintaninedCasterEffect.length > 0 && functionStuff.tokenId) {
    for (let effect of functionStuff.activelyMaintaninedCasterEffect) {
      let effectPresent = functionStuff.token?.actor.hasCondition(effect.id);
      if (effectPresent) {
        flagDataArray.push({
          tokenId: functionStuff.tokenId,
          removeEffect: effect,
        });
      }
    }
  }

  // A24: Anathema dispels the originator-tagged effects on the target - the
  // dialog roll counts as the first originator's probe (see anathemaDispel),
  // further originators are probed there; removals go to the same GM card as
  // everything else. null = nothing tagged (G3), the standard probe result
  // then decides the chain
  if (functionStuff.ability?.reference === "anathema") {
    const dispelFailed = await anathemaDispel(functionStuff, flagDataArray, rollData);
    functionStuff.anathemaDispelFailed = dispelFailed ?? !trueActorSucceeded;
  }

  /* Kraefte-Paket 1 (Baustein A): Feuerseele-Meister-Vergeltung - der
     direkte Schadenswurf dieser Kraft auf einen Feuerseele-Meister
     loest die 1W10-Fern-Vergeltung aus (Ruestung schuetzt, RAW). */
  await firesoulMasterPowerCounter(functionStuff, damageTot);

  if (flagDataArray.length) {
    await createModifyTokenChatButton(flagDataArray);
  }
  return templateData;
}

/* A16 pre-dialog helpers for the chain powers: with multipleTargets the usePower
   flow collects all targeted tokens in functionStuff.targets and leaves targetData
   empty; these helpers promote the first target to the primary target.
   v2.11 (Rudolfs Testrunde 10, P11): Stabgeschoss läuft auf Frisch-Zielen -
   ein "Rest" wird NICHT mehr als chainTargets vorgegeben, die Kette wählt
   jedes Folgeziel nach „Weiteres Ziel?" über eine NEUE Markierung. */
async function preDialogStaffProjectile(functionStuff) {
  /* v2.11 (Rudolfs Testrunde 10, P11 + Freigabe): Frisch-Zielen nach dem
     A36V-Bannsiegel-Muster - eine Mehrfach-Auswahl vor dem Wirken liefert
     nur noch das PRIMÄRZIEL, weitere vorab markierte Tokens werden
     ignoriert. Die Meister-Kette fragt nach dem Primärwurf je Folgeziel
     „Weiteres Ziel?" und läuft dann auf die FRISCH markierten Ziele
     (staffProjectileChainResult). Bisher galt das A16-Vorauswahl-Modell
     (functionStuff.chainTargets): Die Kette traf nur vor dem Würfeln
     markierte Ziele - mit einer einzigen Marke lief nie ein Kettendialog
     (Rudolfs P11-Befund „kein Kettendialog nach erstem Ziel"). */
  if (!functionStuff.targetData.hasTarget && functionStuff.targets?.length) {
    functionStuff.targetData = functionStuff.targets[0];
  }
  if (!functionStuff.targetData.hasTarget) {
    ui.notifications.error(game.i18n.localize("POWER_STAFFPROJECTILE.CHAT_NO_TARGET"));
    return;
  }
  await modifierDialog(functionStuff);
}

async function preDialogBanishingSeal(functionStuff) {
  /* v2.8 G7 (Rudolfs finale Konzeptrunde 21.11.): LAUFENDE Bannsiegel-
     Zone + erneute Icon-Anwahl = Abbruch-Dialog (Glyphen-Modell),
     VOR dem Ziel-Zwang - der Abbruch braucht KEIN Ziel. Danach erst
     der gewohnte manuelle Ablauf (Ziel, Kategorie, Wurf). Das
     Siegel endet hier MIT der Zone und ist dann verbraucht. */
  const runningSeal = functionStuff.actor?.getFlag(game.system.id, "symbolzone.banishingseal")?.regionId
    ? "banishingseal"
    : null;
  if (runningSeal) {
    const runningLabel = game.i18n.localize("POWER_LABEL.BANISHING_SEAL");
    symbDialog({
      title: functionStuff.abilityName,
      content: `<p>${game.i18n.format("POWER_HYMN.CONFIRM_ABORT", { powername: runningLabel })}</p>`,
      classes: isModernDialogActive() ? modernDialogClasses("modern-power-confirm-dialog") : [],
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("BUTTON.YES"),
          callback: async () => {
            await postHymnEndCard(
              { actor: functionStuff.actor, actingCharName: functionStuff.actingCharName, abilityName: runningLabel },
              "POWER_HYMN.CHAT_END_ABORTED"
            );
            await endActiveSymbolZone(functionStuff.actor, runningSeal);
          },
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BUTTON.NO"),
        },
      },
      default: "yes",
    });
    return;
  }
  /* v2.8.1 G7 (Rudolfs Option B): KEIN Zielzwang mehr - das Bannsiegel
     ist eine frei platzierbare Zone (Picker im Zauberlauf). Ein vorab
     markiertes Token dient nur als Kategorie-Prefill des Dialogs, keins
     ist noetig. */
  if (!functionStuff.targetData?.hasTarget && functionStuff.targets?.length) {
    functionStuff.targetData = functionStuff.targets[0];
  }
  /* v2.8.3 G7 (Rudolfs Karte zur Testrunde v2.8.2, 2: „auch Bann-
     siegel: Ausfuehrungs-Dialog vor den Kategorie-Dialog"), Freigabe
     „Leg los": Der Glyphe-1:1-Ausfuehrungsdialog (Manuell / Zone
     platzieren / Abbrechen) laeuft vor dem Kategorie-Dialog. „Zone
     platzieren" = Kategorie-Dialog, dann Picker, dann Wuerfeldialog
     (Reihenfolge unveraendert gegen v2.8.2; die Kategorie bleibt VOR
     dem Picker - Rudolfs Testrunde-7-Festlegung, per Karte
     bestaetigt). „Manuell" = klassischer Einzelziel-Zauber ohne
     Zone: Kategorie-Dialog mit Prefill, Zielzwang (Fehlerkarte
     ERROR.NO_TARGET_SELECTED ohne Ziel), Standard-Wuerfeldialog,
     symbolZoneManual-Flag fuer den Dispatcher (standardPowerResult -
     Marker je Stufe; Flucht-/Schadens-Muster bleiben dem Zonen-
     Erstgesang vorbehalten, bewusste Grenze). Abbrechen/X/ESC =
     still, kein Wirken, keine Korruption. */
  const sealChoice = await symbolZoneExecutionChoiceDialog(functionStuff);
  if (sealChoice === "cancel") return;
  if (sealChoice === "manual") functionStuff.symbolZoneManual = true;
  /* v2.8.3: Manuell laeuft HIER weiter in den Kategorie-Dialog (der
     Callback unten verzweigt dann auf Zielzwang + Wuerfeldialog ohne
     Platzierung); nur Abbrechen beendet still. Zone laeuft wie bislang. */
  // A36-Verbraucher (Bannsiegel): the free-text creature type dialog becomes
  // a category dropdown (CREATURE_CATEGORY_SELECTION) plus a free subtype
  // field, both pre-filled from the primary target's stored A36 flags - a
  // target already categorised on its sheet needs no extra typing. The
  // choice feeds BOTH checks (primary on roll, chain per follow-up target);
  // the seal's damage effect stays SL-managed, and one dialog covers the
  // whole chain. A36V test round 3 (Rudolf, 25.10.): the confirm button no
  // longer pretends to roll - it adopts the category choice and hands over
  // to the roll dialog ("Übernehmen" instead of "Würfeln").
  const primaryActor = functionStuff.targetData?.token?.actor ?? functionStuff.targetData?.actor ?? null;
  /* v2.8.1 G7: ohne Ziel (Regelfall) bleibt der Prefill leer - die
     Kategorie waehlt der SL frei. */
  const presetCategory = primaryActor ? game.symbaroum.config.getCreatureCategory(primaryActor) : null;
  const presetSubtype = primaryActor?.system?.creatureSubtype ?? "";
  const categoryOptions = Object.values(game.symbaroum.config.CREATURE_CATEGORY_SELECTION)
    .map(
      (category) =>
        `<option value="${category.id}"${category.id === presetCategory ? " selected" : ""}>${game.i18n.localize(category.label)}</option>`
    )
    .join("");
  symbDialog({
    title: functionStuff.abilityName,
    content: `<p>${game.i18n.localize("POWER_BANISHINGSEAL.DIALOG_TYPE")}</p>
      <select id="creatureCategory" style="width: 100%">${categoryOptions}</select>
      <input type="text" id="creatureSubtype" style="width: 100%" value="${presetSubtype}">`,
    // P26 (Dialog-Audit): Modern-Chrome bei modernen Blättern
    classes: isModernDialogActive() ? modernDialogClasses('modern-seal-category-dialog') : [],
    buttons: {
      cast: {
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize("POWER_BANISHINGSEAL.BUTTON_APPLY"),
        callback: async (html) => {
          const categoryId = html[0].querySelector("#creatureCategory").value;
          const subtype = html[0].querySelector("#creatureSubtype").value.trim();
          // A36V test round 2 (Rudolf, 25.10.): the chosen category is no
          // longer display-only - banishingSealChainResult checks every
          // follow-up target against it (warning + skip, the Holy Aura
          // pattern). Empty selection ("no category") disables the check.
          functionStuff.sealCategoryId = categoryId;
          let typeLabel = "";
          if (categoryId) {
            typeLabel = game.i18n.localize(game.symbaroum.config.CREATURE_CATEGORY_SELECTION[categoryId]?.label ?? "");
          }
          if (subtype.length) {
            typeLabel = typeLabel.length ? typeLabel + ", " + subtype : subtype;
          }
          if (typeLabel.length) functionStuff.autoParams += "(" + typeLabel + "), ";
          /* v2.7 (Testrunde 7, Rudolfs Schritt 2, stufenunabhängig): die
             Kategorie-Prüfung läuft bei der WAHL gegen das Primärziel -
             bei Fehlkategorie Warnung + Abbruch VOR dem Würfeldialog
             (kein Würfeln mehr gegen ein falsches Ziel, der v2.6-Prüf-
             punkt im Roll-Button entfällt damit). Ohne gewählte Kategorie
             bleibt der Check aus (SL-Buchhaltung). */
          /* v2.8.1 G7: der Primarziel-Check laeuft nur mit
             markiertem Ziel (ohne Zielzwang ist der Regelfall ohne
             Ziel - der Erstgesang filtert je Feind der Region). */
          if (functionStuff.targetData?.hasTarget && !banishingSealPrimaryCategoryCheck(functionStuff)) {
            return;
          }
          /* v2.8 (Rudolfs Festlegung 13.11., ersetzt den v2.7-Schritt-4-
             Hardcode): das Wirken kostet TRADITIONSGERECHT - 1 temporäre
             Korruption (TEMPCORRUPTION_ONE) gilt NUR für Mystiker der
             Tradition Symbolismus; die A16-Engine (getItemModifier-
             Symbolism) setzt corr1 im combatMods-Setup genau für sie.
             Der Hardcode wird NICHT mehr gesetzt: alle anderen Wirker
             zahlen die Standard-Kraftkorruption 1W4 (Modus aus dem
             Setup, getCorruption würfelt). Manuell = Master. */
          /* v2.8.2 G7 (Rudolfs Testrunde v2.8.1, 1a/3 - GLYPHEN-
             Paritaet): Auch beim Bannsiegel laeuft die Picker-
             Platzierung VOR dem Wuerfeldialog - hinter dem Kategorie-
             Dialog, weil die Region die Kategorie im Flag traegt
             (Erstgesang-Filter). sealSubtype fuer das Region-Flag
             mitgeben; der Erstgesang uebernimmt die pendente Region
             (kein Zweit-Picker), Cancel des Wuerfeldialogs raeumt
             (cleanupFreshHymnZone). */
          functionStuff.sealSubtype = subtype;
          /* v2.8.3: Manuell-Zweig (Ausfuehrungs-Dialog vor dem
             Kategorie-Dialog): klassischer Einzelziel-Zauber ohne
             Zone - Zielzwang, Standard-Wuerfeldialog, KEINE
             Platzierung, kein Icon-Abbruch. */
          if (functionStuff.symbolZoneManual) {
            if (!functionStuff.targetData?.hasTarget) {
              ui.notifications.error(game.i18n.localize("ERROR.NO_TARGET_SELECTED"));
              return;
            }
            modifierDialog(functionStuff);
            return;
          }
          const placedSeal = await symbolZonePlaceBeforeDialog(functionStuff, "banishingseal");
          if (!placedSeal) return;
          modifierDialog(functionStuff);
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize("BUTTON.CANCEL"),
      },
    },
    default: "cast",
  });
}

async function preDialogLayonHands(functionStuff) {
  let layHandsDialogTemplate = `
    <h1> ${game.i18n.localize("POWER_LAYONHANDS.DIALOG")} </h1>
    `;
  symbDialog({
    title: game.i18n.localize("POWER_LABEL.LAY_ON_HANDS"),
    content: layHandsDialogTemplate,
    // P26 (Dialog-Audit): Modern-Chrome bei modernen Blättern
    classes: isModernDialogActive() ? modernDialogClasses('modern-layonhands-dialog') : [],
    buttons: {
      touch: {
        label: game.i18n.localize("POWER_LAYONHANDS.TOUCH"),
        callback: (html) => {
          functionStuff.healFormulaSucceed = "1d12";
          functionStuff.touch = true;
          modifierDialog(functionStuff);
        },
      },

      lineofSight: {
        label: game.i18n.localize("POWER_LAYONHANDS.REMOTE"),
        callback: (html) => {
          functionStuff.touch = false;
          modifierDialog(functionStuff);
        },
      },
      close: {
        label: "Close",
      },
    },
  });
}

/* AoE v2.4 (Rudolfs Testrunde 4, Entscheidung g): Bei Zonen-FOLGE-Aus-
   lösungen (Betreten, Maintain-Runde, erneute Auslöse-Taste) stand die
   ZONE als Quelle auf der Ergebnis-Karte statt des Wirkers - Name und
   Intro-Zeile werden umgebogen (die Standard-Karte zeigt
   Ziel + Icon, Probenwerte und Würfelergebnis wie gehabt; als Icon
   führt die Zone das Kraft-Icon mit).
   v2.6 (Rudolfs Testrunde 6, P11a, Rudolfs Entscheidung „Caster als
   Karten-Aktor"): die Folge-Karten zeigen den AUSLÖSER als Wirkenden -
   Name UND Porträt des Auslösers (zoneSourceImg) statt des Kraft-Icons;
   die Zone bleibt über ihren Regionsnamen (jetzt mit Auslöser-Namen)
   benannt. Ohne zoneSourceImg (Fallback) bleibt das Kraft-Icon. */
function _applyZoneCardSource(functionStuff, zoneSourceName, zoneSourceImg = null) {
  functionStuff.actingCharName = zoneSourceName;
  functionStuff.introText = "AOE.CHAT_ZONE_INTRO";
  if (zoneSourceImg) functionStuff.actingCharImg = zoneSourceImg;
  else if (functionStuff.abilityImg) functionStuff.actingCharImg = functionStuff.abilityImg;
}

/* =====================================================================
 * AoE Stufe 2a (Rudolfs Freigabe 2a+2b, 09.11.2026): programmatischer
 * Kraftwurf fuer Zonen-Ausloesungen (dauerhafte Kraft-Zonen via Ausloese-
 * taste/Betreten-Trigger, augenblickliche Zonen direkt nach der Platzie-
 * rung). Spiegel von actor.js usePower OHNE Dialog: die Ausloesung wuerfelt
 * wie die Ketten-Follow-ups (favour 0/modifier 0, auto) - Rudolfs v6-
 * Entscheidung; einzige Abweichung zum normalen Wirken ist die Korruption
 * (suppressCorruption bei dauerhaften Zonen: das Wirken samt Korruption
 * gehoert zur Platzierung, die Ausloesung kostet nichts - Zu-3-Antwort).
 *
 * Ketten-Recycling: die Regionstoken werden als Nutzerziele markiert
 * (td.object.setTarget, Stufe-1-Muster) - die Ketten-Result-Funktionen
 * (drainingGlyphResult, chainSequenceResult, banishingSealChainResult,
 * ...) iterieren game.user.targets und laufen daher unverändert weiter.
 * Wirkattribut-Alternativen und Resolute-Schadensreduktions-Alternativen
 * des Primärziels werden wie in usePower angewendet.
 * =================================================================== */
export async function executeZonePower(
  actor,
  ability,
  targetTokens,
  { suppressCorruption = true, zoneActivation = null, zoneSourceName = '', zoneSourceImg = null, presetRollData = null, zoneApplyDirect = false, zoneExtras = null } = {}
) {
  if (!actor || !ability || !Array.isArray(targetTokens) || targetTokens.length === 0) return;
  const specificStuff = actor.system?.combat?.combatMods?.abilities?.[ability.id];
  if (!specificStuff?.isScripted) {
    ui.notifications.warn(game.i18n.localize("AOE.ERR_NO_POWER_AUTOMATION"));
    return;
  }
  const stuff = foundry.utils.deepClone(specificStuff);
  // Wirkattribut-Alternativen wie usePower (höchstes Attribut gewinnt)
  if (Array.isArray(stuff.attributes) && stuff.attributes.length > 0) {
    let castingAttribute = stuff.castingAttributeName;
    let castingAttributeValue = actor.system.attributes[castingAttribute].total;
    let autoParams = "";
    for (let base of stuff.attributes) {
      let alternateValue = actor.system.attributes[base.attribute].total;
      if (castingAttributeValue < alternateValue) {
        castingAttribute = base.attribute;
        castingAttributeValue = alternateValue;
        autoParams = base.label + ", ";
      }
    }
    stuff.castingAttributeName = castingAttribute;
    stuff.autoParams = (stuff.autoParams ?? "") + autoParams;
  }
  const api = game.symbaroum.api;
  const actingToken = api.getActorToken(actor) ?? actor.getActiveTokens?.()[0] ?? null;
  // Zonenziele als Nutzerziele markieren (Ketten lesen game.user.targets)
  let first = true;
  for (const tokenDoc of targetTokens) {
    tokenDoc.object?.setTarget(true, { releaseOthers: first });
    first = false;
  }
  const placeables = Array.from(game.user.targets);
  // Primärziel + multipleTargets-Aufbau wie usePower/preDialogBanishingSeal
  stuff.targetData = buildGlyphTargetData(placeables[0] ?? targetTokens[0], stuff.targetResistAttribute ?? null);
  if (stuff.multipleTargets) {
    stuff.targets = placeables.map((t) => buildGlyphTargetData(t, stuff.targetResistAttribute ?? null));
    stuff.chainTargets = stuff.targets.slice(1);
  }
  // Resolute-Schadensreduktionen des Primärziels (Alternativ-Attribut) wie usePower
  if (
    stuff.targetData.hasTarget &&
    stuff.targetData.actor.system.combat.damageReductions.length &&
    stuff.targetResistAttribute === "resolute"
  ) {
    for (let i = 0; i < stuff.targetData.actor.system.combat.damageReductions.length; i++) {
      if (stuff.targetData.actor.system.combat.damageReductions[i].type === game.symbaroum.config.TYPE_ALT_RESIST_ATTR_RESOLUTE) {
        let resistributeValue = stuff.targetData.actor.system.attributes["resolute"].total;
        let alternateValue =
          stuff.targetData.actor.system.attributes[stuff.targetData.actor.system.combat.damageReductions[i].attribute].total;
        if (resistributeValue < alternateValue) {
          stuff.targetData.resistAttributeName = stuff.targetData.actor.system.combat.damageReductions[i].attribute;
          stuff.targetData.autoParams += stuff.targetData.actor.system.combat.damageReductions[i].label + ", ";
        }
      }
    }
  }
  const fsDefault = await ability.getFunctionStuffDefault(actor, actingToken);
  const functionStuff = Object.assign({}, fsDefault, stuff);
  /* v2.5 (Baustein d - Bannsiegel-Kategorie bei Folge-Ausloesungen): der
     Aktivierungs-Snapshot hat die Kategorie des Aktivierungsdialogs fest-
     gehalten (captureZoneActivationSnapshot); aoe.js reicht sie als
     zoneExtras.sealCategoryId durch. Ohne sie blieb die Kategorie im
     Folge-Pfad undefiniert (Rudolfs Testrunde 5, Punkt 12a: sealCategory-
     Filter liefen ins Leere). */
  if (zoneExtras?.sealCategoryId !== undefined && zoneExtras.sealCategoryId !== null) {
    functionStuff.sealCategoryId = zoneExtras.sealCategoryId;
  }
  // v2.3 (Rudolfs Testrunde 3, Punkt 7 - Kettendialog-Auto-Ende): die
  // Zonenziele als Token-Id-Menge mitfuehren - zoneChainDone ueberspringt
  // die 'Weiteres Ziel?'-Bestaetigung, sobald die Kette alle abgearbeitet
  // hat (siehe Helper zoneChainDone/zoneChainContinue). Normales Wirken ohne
  // Zone setzt das Feld nie, alle Ketten laufen dann unveraendert.
  functionStuff.zoneChainTargets = new Set(targetTokens.map((td) => td.id));
  // Ausloesung wuerfelt wie Ketten-Follow-ups: kein Vorteil, keine Modifikatoren
  functionStuff.hasAdvantage = false;
  functionStuff.favour = 0;
  functionStuff.modifier = 0;
  functionStuff.isMaintained = false;
  // Dauerhafte Zonen: Ausloesung ohne erneute Korruptionsbuchung
  if (suppressCorruption) functionStuff.corruption = game.symbaroum.config.TEMPCORRUPTION_NONE;
  /* AoE v2.4 (Rudolfs Testrunde 4, Sammel-Fix):
     - zoneActivation (AKTIVIERUNG der Zonen-Instanz, Entscheidung a):
       voller Kraftwurf MIT Standard-Würfeldialog (Modifikator/Gunst
       einstellbar - "sonst können keine Modifikatoren und Gunst ein-
       gestellt werden"), Korruption 1x nach Kraftregeln (je-Ziel-Kosten
       der Aktivierung inklusive, Folge-Auslösungen TEMPCORRUPTION_NONE).
       Der Kategorie-Pre-Dialog (Bannsiegel) läuft wie beim manuellen
       Wirken VOR dem Würfeldialog (Entscheidung i - im Zonen-Pfad fehlte
       er komplett, sealCategoryId blieb immer undefiniert). buildRolls
       schreibt den Aktivierungs-Snapshot in die Region-Flags.
     - presetRollData / zoneApplyDirect (FOLGE-Auslösungen: Betreten,
       Maintain-Runde, erneute Auslöse-Taste): die Probe wurde bereits
       gegen den Snapshot gewürfelt (baseRoll im Resist-Modus, aoe.js)
       bzw. die Kraft ist unwiderstehlich - hier läuft nur noch die
       Ergebnis-Funktion, mit der ZONE als Karten-Quelle statt dem
       Wirker (Entscheidung g, _applyZoneCardSource). */
  if (zoneActivation) {
    functionStuff.zoneActivation = zoneActivation;
    /* v2.7 (Testrunde 7, Rudolfs Schritt 2/4 + Musterablauf v1.1):
       Bannsiegel-Zonen tragen ihre Kreaturen-Kategorie seit der
       PLATZIERUNG im Zonen-Flag (aoe.sealCategoryId, oben via zoneExtras
       restauriert) - der Kategorie-Dialog läuft hier NICHT mehr (vorher
       je Aktivierung mit Vorbelegung des jeweiligen Primärziels,
       Rudolfs P2-Befund).
       v2.8 (Rudolfs Festlegung 13.11.): der Kosten-Hardcode (v2.7:
       pauschal TEMPCORRUPTION_ONE) ist ENTFALLEN - die Kosten bestimmt
       die Standard-Engine aus dem combatMods-Setup (A16: Symbolisten
       1 Punkt, alle anderen 1W4), wie im manuellen Wirkpfad. */
    if (functionStuff.ability?.reference === "banishingseal") {
      await modifierDialog(functionStuff);
    } else if (functionStuff.preDialogFunction) {
      await functionStuff.preDialogFunction(functionStuff);
    } else {
      /* Hymnen-Paket 1.1: confirmDialog-Zweig entfallen (siehe Kommentar
         oben bei der ehemaligen confirmPowerDialog) - auch Zonen-
         Aktivierungen gescripteter CASTING_NOT-Kräfte laufen über den
         Würfeldialog. */
      await modifierDialog(functionStuff);
    }
  } else if (presetRollData !== null || zoneApplyDirect) {
    if (zoneSourceName) _applyZoneCardSource(functionStuff, zoneSourceName, zoneSourceImg);
    /* v2.6 (Rudolfs Testrunde 6, P7, Rudolfs Entscheidung „A36V-Manuell-
       Verhalten konsistent"): der Kategorie-Check des PRIMÄRZIELS lief
       NUR im Aktivierungspfad (Roll-Button des Würfeldialogs) - im
       Folge-Pfad (Betreten/Maintain/erneute Auslöse-Taste) war seal-
       PrimaryMismatch NIE gesetzt, nicht-passende Ziele wurden VOLL
       gebannt (Probe + Wirkung + Fliehen-Karte). Jetzt läuft banishing-
       SealPrimaryCategoryCheck (mit der via zoneExtras restaurierten
       sealCategoryId) VOR der Ergebnis-Funktion: Novize + Fehlkategorie
       = Warnung + Skip (keine Wirkung, Markierungen frei), Adept/Master
       = Probe + Kartenschaden, kein Bann - exakt wie das manuelle
       Wirken. */
    if (!banishingSealPrimaryCategoryCheck(functionStuff)) {
      releaseZoneTargets(functionStuff);
      return;
    }
    const resultFunction = getPowerResultFunction(functionStuff);
    await resultFunction(presetRollData, functionStuff);
    /* v2.5 (Baustein e): Zielmarkierungen nach der Zonen-Ausfuehrung
       freigeben - sie blieben sonst als Fadenkreuze stehen (Rudolfs
       Testrunde 5, Punkt 13). */
    releaseZoneTargets(functionStuff);
  } else {
    await buildRolls(functionStuff);
  }
}
