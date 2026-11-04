/**
 * Segen & Lasten S1 (Rudolfs Freigabe „Du kannst die erste Ausbaustufe
 * umsetzen“, 04.11.2026 — siebtes Arbeitspaket des Erweiterungsprojekts):
 * Wurf-Segen. Die 15 Segen/Lasten mit eigenem Wurf (Analyse-Canvas
 * „Segen & Lasten“, Typ W) bekommen ein echtes Setup analog zu den
 * geskripteten Fähigkeiten — der Aktivierungs-Button der Kräfte-Tabs
 * (klassisch wie modern) öffnet den Würfeldialog, und die Chat-Karte
 * zeigt Probe, Ergebnis und RAW-Hinweise. Alle übrigen Segen/Lasten
 * bleiben unangetastet (Stillstand wie bisher); ihre Integration
 * (Situations-Zeilen S2, Todesprobe S3, Tag/Reise S4) folgt in den
 * nächsten Ausbaustufen.
 *
 * Architektur (Muster tradition.js + etablierte Setup-Kette):
 *  - Kanonik: BOON_ROLLS mappt die kanonische Referenz (system.reference,
 *    gesetzt per Migrations-Makro „SegenLasten-Migration v1“) auf das
 *    Wurf-Setup. Die Liste ist bewusst NICHT in config.scriptedAbilities
 *    gepflegt — jene Liste hat an anderer Stelle Kampf-Semantik.
 *  - item.js getBoonsConfig()/getBurdensConfig() delegieren an
 *    getBoonRollConfig() hier; actor.js sammelt die Configs in
 *    combatMods.abilities (dort cases „boon“/„burden“).
 *  - Boons/Burdens haben KEINE hasLevels-Stufen (system.hasLevels false):
 *    powerLvl wird deshalb durch ein eigenes Objekt ersetzt —
 *    { level: max(1, system.level), lvlName: '' } — und JEDES geskriptete
 *    Setup setzt subText (sonst renderierte die Karte „(null)“).
 *    system.level bleibt reine Anzeige/Buchhaltung der Käufe (Entscheidung
 *    der Auswahlrunde); der wirksame Wert (Stapel-Bonus, Abstinenz-
 *    modifikator) liegt im NEUEN Feld system.bonusValue (template.json),
 *    initial gefüllt durch die Migration.
 *  - Wahl-Segen (Kontakte, Unternehmen, Profession, Buschwissen) tragen
 *    ihre Auswahl als preDialogFunction (symbDialog-Zwei-Tasten-Wahl,
 *    Muster preDialogLayonHands/preDialogBanishingSeal); Ertragswürfel
 *    (Buschwissen 1W6/1W10, Unternehmen 10+1W10) laufen als eigene
 *    Result-Funktion über den 1-Zeilen-Hook in getPowerResultFunction
 *    (functionStuff.boonResultFunction) und delegieren an
 *    standardPowerResult (finalText + resultRolls, Präzedenz Erdschuss).
 *  - Opposed Proben (Musikant [Ausstrahlung←Willenskraft], Betrügen,
 *    Bestialisch, Mystisches Mal [Heimlichkeit←Aufmerksamkeit]) nutzen
 *    getTarget + targetResistAttribute, targetMandatory false — ohne
 *    markiertes Ziel läuft eine einfache Probe.
 */
import { modifierDialog, standardPowerResult } from './item.js';
import { symbDialog } from './symbDialog.js';

const L = (key) => game.i18n.localize(key);

/* ---------------------------------------------------------------- */
/*  Wahl-Dialoge (preDialogFunction-Muster)                          */
/* ---------------------------------------------------------------- */

/*
 * Buschwissen (RAW APG): Unterwegs 1W6 Rationen pro Tag, ausschließlich
 * fokussiert (keine Bewegung) 1W10 Rationen. Terrainstufe I–III aus
 * system.level (Stufe = Käufe). Der Ertragswürfel wird NUR bei Erfolg
 * geworfen und auf der Karte gezeigt (bushcraftResult).
 */
function bushcraftPreDialog(functionStuff) {
  symbDialog({
    title: functionStuff.abilityName,
    content: `<div class="symbaroum dialog"><p class="lblfavour">${L('BOON_ROLL.BUSHCRAFT_MODE_TITLE')}</p></div>`,
    buttons: {
      onTheMove: {
        icon: '<i class="fas fa-hiking"></i>',
        label: L('BOON_ROLL.BUSHCRAFT_MODE_ON_THE_MOVE'),
        callback: () => {
          functionStuff.bushcraftYieldFormula = '1d6';
          functionStuff.autoParams += L('BOON_ROLL.BUSHCRAFT_PARAM_ON_THE_MOVE') + ', ';
          modifierDialog(functionStuff);
        },
      },
      focused: {
        icon: '<i class="fas fa-search"></i>',
        label: L('BOON_ROLL.BUSHCRAFT_MODE_FOCUSED'),
        callback: () => {
          functionStuff.bushcraftYieldFormula = '1d10';
          functionStuff.autoParams += L('BOON_ROLL.BUSHCRAFT_PARAM_FOCUSED') + ', ';
          modifierDialog(functionStuff);
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('BUTTON.CANCEL'),
      },
    },
    default: 'onTheMove',
  });
}

/*
 * Kontakte (RAW GRW + Rudolfs Klärung): RAW ruft sich der Charakter per
 * Ausstrahlung einen Kontakt ins Gedächtnis; als Hausregel kann der
 * Wurf auch Auskunft über die verbundene Gruppierung/Faktion geben
 * (Scharfsinn). Ein Feld für die Gruppierung folgt mit S2.
 */
function contactsPreDialog(functionStuff) {
  symbDialog({
    title: functionStuff.abilityName,
    content: `<div class="symbaroum dialog"><p class="lblfavour">${L('BOON_ROLL.CONTACTS_MODE_TITLE')}</p></div>`,
    buttons: {
      remember: {
        icon: '<i class="fas fa-user-friends"></i>',
        label: L('BOON_ROLL.CONTACTS_MODE_REMEMBER'),
        callback: () => {
          functionStuff.castingAttributeName = 'persuasive';
          functionStuff.introText = L('BOON_ROLL.CONTACTS_INTRO_REMEMBER');
          functionStuff.resultTextSuccess = L('BOON_ROLL.CONTACTS_SUCCESS_REMEMBER');
          functionStuff.resultTextFail = L('BOON_ROLL.CONTACTS_FAILURE_REMEMBER');
          functionStuff.autoParams += L('BOON_ROLL.CONTACTS_PARAM_REMEMBER') + ', ';
          modifierDialog(functionStuff);
        },
      },
      inquire: {
        icon: '<i class="fas fa-book"></i>',
        label: L('BOON_ROLL.CONTACTS_MODE_INQUIRE'),
        callback: () => {
          functionStuff.castingAttributeName = 'cunning';
          functionStuff.introText = L('BOON_ROLL.CONTACTS_INTRO_INQUIRE');
          functionStuff.resultTextSuccess = L('BOON_ROLL.CONTACTS_SUCCESS_INQUIRE');
          functionStuff.resultTextFail = L('BOON_ROLL.CONTACTS_FAILURE_INQUIRE');
          functionStuff.autoParams += L('BOON_ROLL.CONTACTS_PARAM_INQUIRE') + ', ';
          modifierDialog(functionStuff);
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('BUTTON.CANCEL'),
      },
    },
    default: 'remember',
  });
}

/*
 * Unternehmen (RAW APG): Scharfsinn (Handwerker) oder Ausstrahlung
 * (Dienstleister); Erfolg = 10+1W10 Thaler Gewinn (enterpriseResult).
 */
function enterprisePreDialog(functionStuff) {
  symbDialog({
    title: functionStuff.abilityName,
    content: `<div class="symbaroum dialog"><p class="lblfavour">${L('BOON_ROLL.ENTERPRISE_MODE_TITLE')}</p></div>`,
    buttons: {
      craft: {
        icon: '<i class="fas fa-hammer"></i>',
        label: L('BOON_ROLL.ENTERPRISE_MODE_CRAFT'),
        callback: () => {
          functionStuff.castingAttributeName = 'cunning';
          functionStuff.autoParams += L('BOON_ROLL.ENTERPRISE_PARAM_CRAFT') + ', ';
          modifierDialog(functionStuff);
        },
      },
      service: {
        icon: '<i class="fas fa-theater-masks"></i>',
        label: L('BOON_ROLL.ENTERPRISE_MODE_SERVICE'),
        callback: () => {
          functionStuff.castingAttributeName = 'persuasive';
          functionStuff.autoParams += L('BOON_ROLL.ENTERPRISE_PARAM_SERVICE') + ', ';
          modifierDialog(functionStuff);
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('BUTTON.CANCEL'),
      },
    },
    default: 'craft',
  });
}

/*
 * Profession (RAW GRW): relevantes Attribut, normalerweise Ausstrahlung
 * oder Scharfsinn. Der Posten ist nach 3 Fehlschlägen in Folge oder
 * einer 20 verloren (Hinweis auf der Karte).
 */
function professionPreDialog(functionStuff) {
  symbDialog({
    title: functionStuff.abilityName,
    content: `<div class="symbaroum dialog"><p class="lblfavour">${L('BOON_ROLL.PROFESSION_MODE_TITLE')}</p></div>`,
    buttons: {
      cunning: {
        icon: '<i class="fas fa-clipboard-list"></i>',
        label: L('BOON_ROLL.PROFESSION_MODE_CUNNING'),
        callback: () => {
          functionStuff.castingAttributeName = 'cunning';
          functionStuff.autoParams += L('BOON_ROLL.PROFESSION_PARAM_CUNNING') + ', ';
          modifierDialog(functionStuff);
        },
      },
      persuasive: {
        icon: '<i class="fas fa-handshake"></i>',
        label: L('BOON_ROLL.PROFESSION_MODE_PERSUASIVE'),
        callback: () => {
          functionStuff.castingAttributeName = 'persuasive';
          functionStuff.autoParams += L('BOON_ROLL.PROFESSION_PARAM_PERSUASIVE') + ', ';
          modifierDialog(functionStuff);
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('BUTTON.CANCEL'),
      },
    },
    default: 'persuasive',
  });
}

/* ---------------------------------------------------------------- */
/*  Result-Funktionen (Ertrag nur bei Erfolg, Präzedenz Erdschoss)   */
/* ---------------------------------------------------------------- */

async function bushcraftResult(rollData, functionStuff) {
  if (rollData?.[0]?.trueActorSucceeded) {
    const yieldRoll = await new Roll(functionStuff.bushcraftYieldFormula ?? '1d6').evaluate();
    functionStuff.resultRolls = [yieldRoll];
    functionStuff.finalText = game.i18n.format(L('BOON_ROLL.BUSHCRAFT_YIELD'), { count: yieldRoll.total });
  }
  await standardPowerResult(rollData, functionStuff);
}

async function enterpriseResult(rollData, functionStuff) {
  if (rollData?.[0]?.trueActorSucceeded) {
    const incomeRoll = await new Roll('1d10').evaluate();
    functionStuff.resultRolls = [incomeRoll];
    functionStuff.finalText = game.i18n.format(L('BOON_ROLL.ENTERPRISE_YIELD'), { amount: 10 + incomeRoll.total });
  }
  await standardPowerResult(rollData, functionStuff);
}

/* ---------------------------------------------------------------- */
/*  Kanonik: die 15 Wurf-Setups                                      */
/* ---------------------------------------------------------------- */

/**
 * Kanonik-Map: kanonische Referenz → Wurf-Setup (Typ W der Analyse).
 * attribute = Probe-Attribut; intro/success/failure = i18n-Keys der
 * Kartentexte; hint = finalText-Hinweis (RAW-Rahmen, immer sichtbar);
 * getTarget/targetResistAttribute = opposed Probe (Heimlichkeit←
 * Aufmerksamkeit bzw. Ausstrahlung←Willenskraft), Ziel optional;
 * favour = fest verdrahtete Gunst (Dunkles Geheimnis: zweite Chance);
 * modifierFromBonusValue = Abstinenz-Vorbelegung aus system.bonusValue
 * (Sucht, RAW −1 … −5, SL-seitig editierbar, Wurf-dialog überschreibt
 * tagesaktuell); preDialog = Wahl-Dialog; result = Ertrags-Roll.
 */
export const BOON_ROLLS = {
  // --- Segen ---
  bushcraft: {
    attribute: 'vigilant',
    intro: 'BOON_ROLL.BUSHCRAFT_INTRO',
    success: 'BOON_ROLL.BUSHCRAFT_SUCCESS',
    failure: 'BOON_ROLL.BUSHCRAFT_FAILURE',
    preDialog: bushcraftPreDialog,
    result: bushcraftResult,
    terrainSubText: true,
  },
  hideouts: {
    attribute: 'cunning',
    intro: 'BOON_ROLL.HIDEOUTS_INTRO',
    success: 'BOON_ROLL.HIDEOUTS_SUCCESS',
    failure: 'BOON_ROLL.HIDEOUTS_FAILURE',
    hint: 'BOON_ROLL.HIDEOUTS_HINT',
  },
  contacts: {
    preDialog: contactsPreDialog,
  },
  enterprise: {
    intro: 'BOON_ROLL.ENTERPRISE_INTRO',
    success: 'BOON_ROLL.ENTERPRISE_SUCCESS',
    failure: 'BOON_ROLL.ENTERPRISE_FAILURE',
    hint: 'BOON_ROLL.ENTERPRISE_HINT',
    preDialog: enterprisePreDialog,
    result: enterpriseResult,
  },
  profession: {
    intro: 'BOON_ROLL.PROFESSION_INTRO',
    success: 'BOON_ROLL.PROFESSION_SUCCESS',
    failure: 'BOON_ROLL.PROFESSION_FAILURE',
    hint: 'BOON_ROLL.PROFESSION_HINT',
    preDialog: professionPreDialog,
  },
  mirage: {
    attribute: 'persuasive',
    intro: 'BOON_ROLL.MIRAGE_INTRO',
    success: 'BOON_ROLL.MIRAGE_SUCCESS',
    failure: 'BOON_ROLL.MIRAGE_FAILURE',
    hint: 'BOON_ROLL.MIRAGE_HINT',
  },
  musician: {
    attribute: 'persuasive',
    intro: 'BOON_ROLL.MUSICIAN_INTRO',
    success: 'BOON_ROLL.MUSICIAN_SUCCESS',
    failure: 'BOON_ROLL.MUSICIAN_FAILURE',
    hint: 'BOON_ROLL.MUSICIAN_HINT',
    getTarget: true,
    targetResistAttribute: 'resolute',
  },
  cheat: {
    attribute: 'discreet',
    intro: 'BOON_ROLL.CHEAT_INTRO',
    success: 'BOON_ROLL.CHEAT_SUCCESS',
    failure: 'BOON_ROLL.CHEAT_FAILURE',
    hint: 'BOON_ROLL.CHEAT_HINT',
    getTarget: true,
    targetResistAttribute: 'vigilant',
  },
  // --- Lasten ---
  wanted: {
    attribute: 'discreet',
    intro: 'BOON_ROLL.WANTED_INTRO',
    success: 'BOON_ROLL.WANTED_SUCCESS',
    failure: 'BOON_ROLL.WANTED_FAILURE',
    hint: 'BOON_ROLL.WANTED_HINT',
  },
  darksecret: {
    attribute: 'discreet',
    intro: 'BOON_ROLL.DARKSECRET_INTRO',
    success: 'BOON_ROLL.DARKSECRET_SUCCESS',
    failure: 'BOON_ROLL.DARKSECRET_FAILURE',
    hint: 'BOON_ROLL.DARKSECRET_HINT',
    favour: 1,
    favourParam: 'BOON_ROLL.DARKSECRET_PARAM',
  },
  nightmares: {
    attribute: 'resolute',
    intro: 'BOON_ROLL.NIGHTMARES_INTRO',
    success: 'BOON_ROLL.NIGHTMARES_SUCCESS',
    failure: 'BOON_ROLL.NIGHTMARES_FAILURE',
    hint: 'BOON_ROLL.NIGHTMARES_HINT',
  },
  addiction: {
    attribute: 'resolute',
    intro: 'BOON_ROLL.ADDICTION_INTRO',
    success: 'BOON_ROLL.ADDICTION_SUCCESS',
    failure: 'BOON_ROLL.ADDICTION_FAILURE',
    hint: 'BOON_ROLL.ADDICTION_HINT',
    modifierFromBonusValue: true,
  },
  bloodthirst: {
    attribute: 'vigilant',
    intro: 'BOON_ROLL.BLOODTHIRST_INTRO',
    success: 'BOON_ROLL.BLOODTHIRST_SUCCESS',
    failure: 'BOON_ROLL.BLOODTHIRST_FAILURE',
    hint: 'BOON_ROLL.BLOODTHIRST_HINT',
  },
  bestial: {
    attribute: 'discreet',
    intro: 'BOON_ROLL.BESTIAL_INTRO',
    success: 'BOON_ROLL.BESTIAL_SUCCESS',
    failure: 'BOON_ROLL.BESTIAL_FAILURE',
    hint: 'BOON_ROLL.BESTIAL_HINT',
    getTarget: true,
    targetResistAttribute: 'vigilant',
  },
  mysticalmark: {
    attribute: 'discreet',
    intro: 'BOON_ROLL.MYSTICALMARK_INTRO',
    success: 'BOON_ROLL.MYSTICALMARK_SUCCESS',
    failure: 'BOON_ROLL.MYSTICALMARK_FAILURE',
    hint: 'BOON_ROLL.MYSTICALMARK_HINT',
    getTarget: true,
    targetResistAttribute: 'vigilant',
  },
};

/** Kanonik-Check für actor.js markScripted (isScripted-Badge der Kachel). */
export function isBoonRollScripted(reference) {
  return Boolean(reference && Object.prototype.hasOwnProperty.call(BOON_ROLLS, reference));
}

/* ---------------------------------------------------------------- */
/*  Setup-Builder (Delegation aus item.js getBoonsConfig/            */
/*  getBurdensConfig, Muster getTraitsConfig)                       */
/* ---------------------------------------------------------------- */

/**
 * Baut die combatMods-Config eines Segens/einer Last. Ohne Kanonik-
 * Treffer bleibt isScripted false — der Button bleibt wie bisher
 * stumm (kein Verhalten Bruch für unskriptete Segen/Lasten).
 */
export function getBoonRollConfig(item) {
  const lvl = Math.max(1, Number(item.system.level) || 1);
  const base = {
    id: item.id,
    label: item.name,
    reference: item.system.reference,
    type: item.type,
    corruption: game.symbaroum.config.TEMPCORRUPTION_NONE,
    impeding: game.symbaroum.config.IMPEDING_NOT,
    casting: game.symbaroum.config.CASTING,
    maintain: game.symbaroum.config.MAINTAIN_NOT,
    isScripted: false,
    // Boons/Burdens haben keine hasLevels-Stufen — eigenes powerLvl-Objekt,
    // damit die Karte kein "(null)" rendert; subText unten immer gesetzt
    powerLvl: { level: lvl, lvlName: '' },
    attributes: [],
    castingAttributeName: 'resolute',
    targetText: game.i18n.localize('ABILITY.CHAT_TARGET_VICTIM'),
    package: [],
    autoParams: '',
    subText: '',
  };
  if (!item.isOwned || !item.system.reference) return base;
  const spec = BOON_ROLLS[item.system.reference];
  if (!spec) return base;
  base.isScripted = true;
  if (spec.attribute) base.castingAttributeName = spec.attribute;
  if (spec.intro) base.introText = L(spec.intro);
  if (spec.success) base.resultTextSuccess = L(spec.success);
  if (spec.failure) base.resultTextFail = L(spec.failure);
  // RAW-Hinweis als finalText — i18n.format ohne Platzhalter gibt den
  // String unverändert zurück (Präzedenz Verwirrung/Schwarzer Atem)
  if (spec.hint) base.finalText = L(spec.hint);
  base.subText = game.i18n.format(L('BOON_ROLL.SUBTEXT_LEVEL'), { level: lvl });
  if (spec.terrainSubText) {
    base.subText = L('BOON_ROLL.BUSHCRAFT_TERRAIN_' + Math.min(3, lvl));
  }
  if (spec.getTarget) {
    base.getTarget = true;
    base.targetResistAttribute = spec.targetResistAttribute;
    base.targetMandatory = false;
  }
  if (spec.favour) {
    // fest verdrahtete Gunst (Dunkles Geheimnis: Wurf mit zweiter Chance,
    // RAW) — das Radio im Dialog bleibt frei, functionStuff.favour += fvalue
    // erhält die Vorbelegung; das autoParams-Etikett informiert den Spieler
    base.favour = spec.favour;
    base.autoParams += L(spec.favourParam) + ', ';
  }
  if (spec.modifierFromBonusValue) {
    // Sucht: Abstinenzmodifikator aus system.bonusValue (RAW −1 … −5,
    // Migration setzt −1) — der Bonusfeld-Vorbelegung im Würfeldialog,
    // tagesaktuell überschreibbar
    const bonusValue = Number(item.system.bonusValue);
    base.modifier = bonusValue < 0 ? bonusValue : -1;
    base.autoParams += L('BOON_ROLL.ADDICTION_PARAM') + ', ';
  }
  if (spec.preDialog) base.preDialogFunction = spec.preDialog;
  if (spec.result) base.boonResultFunction = spec.result;
  return base;
}
