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
 *    markiertes Ziel läuft eine einfache Probe (Rudolfs Festlegung
 *    06.11.: auch ohne Ziel würfeln). v1.1 hatte das Gegenteil mit einer
 *    Ziel-Hinweiszeile (addBoonTargetHint) überdeckt; v1.2 behebt die
 *    eigentliche Ursache: notResisted false (siehe Setup-Builder) — mit
 *    Ziel wird die Zieleigenschaft auf der Karte angezeigt wie bei
 *    Kräften.
 *  - v1.1 (Rudolfs Testrunde 06.11.): Wahl-Dialoge nach Alchemie-Menü-
 *    Vorlage (boonChoiceDialog, Kopfzeile „{Segen/Last} - Was willst du
 *    tun?"); Buschwissen-Orientierungstaste, Musikant Beruhigen/
 *    Inspirieren mit Bestie-Gate, Bestialisch Verbergen/Einschüchtern,
 *    Unternehmens-Ertrag sofort aufs Geld (system.currency).
 *  - v1.2 (Rudolfs Testrunde v1.1, 06.11.): (P6/b) Opposed-Anzeige wie
 *    bei Kräften statt der v1.1-Hinweiszeile; (a) Hinweiszeile über den
 *    Tasten entfällt; (c) Wahl-Dialoge Single-Instance (erneuter Klick
 *    bringt den offenen Dialog in den Vordergrund, singleKey an
 *    symbDialog).
 *  - S2 „Würfeldialog-Boni & Kontakte-Gruppierung" (Rudolfs Startsignal
 *    „Leg los", 06.11.2026): (A) BOON_LINES-Kanonik — Situations-Zeilen
 *    (Typ B) und „Zweite Chance"-Zeilen (Sub-Typ B/G, Gunst-/Missgunst-
 *    Exklusivität) für beide Würfeldialog-Pfade (dialog.js EC-Dialog +
 *    item.js modifierDialog), Bonus aus system.bonusValue, leer +
 *    ankreuzbar nur bei Besitz; (B) Kontakte-Gruppierungsfeld
 *    (system.contactGroup, feste 7 + freier Text) fließt als Kontext in
 *    den Kontakte-Wurf; (D) Musikant Beruhigen setzt bei Erfolg am
 *    Bestien-Ziel das neue Statussymbol „Beruhigt" (Condition calmed,
 *    Icon icons/svg/aura.svg) über die GM-Karte „Effekte auf Token
 *    anwenden" (createModifyTokenChatButton, Muster Fliehende/fearEffect)
 *    — Rücksetzen ist reine SL-Sache, keine Runden-Engine.
 */
import { modifierDialog, standardPowerResult } from './item.js';
import { createModifyTokenChatButton } from './roll.js';
import { symbDialog } from './symbDialog.js';
import { isModernDialogActive, modernDialogClasses } from './modernSheetConfig.js';

const L = (key) => game.i18n.localize(key);

/* ---------------------------------------------------------------- */
/*  v1.1: Wahl-Dialog nach Alchemie-Menü-Vorlage (brewing.js          */
/*  openAlchemyMenu, Rudolfs Design-Runde 06.11.)                    */
/* ---------------------------------------------------------------- */

/**
 * Segen & Lasten v1.1 (Rudolfs Testrunde, Dialog-Design): Alle Wahl-
 * Dialoge der Segen/Lasten folgen EXAKT dem Alchemie-Menü-Muster —
 * Kopfzeile „{Segen/Last} - Was willst du tun?", Container-Klasse
 * symbaroum modern-roll-dialog|dialog je nach Nutzer-Design, Marker-
 * Klassen symb-roll-dialog/symb-roll-user (Design-Wechsel schließt
 * offene Dialoge, closeOpenRollDialogs) und die Footer-Buttons unter-
 * einander in gleicher Breite (onRender mit width 100% !important —
 * die System-CSS 7.1.8 schlägt jedes einfache Inline-Style, Lernweis
 * openAlchemyMenu).
 * v1.2 (Rudolfs Testrunde v1.1, Rückmeldung a): die Hinweiszeile über
 * den Tasten entfällt — der Titel trägt die Frage allein.
 * v1.2 (Rudolfs Testrunde v1.1, Rückmeldung c): Single-Instance — ist
 * der Wahl-Dialog zu diesem Segen/dieser Last beim selben Aktor bereits
 * offen, bringt der erneute Klick ihn in den Vordergrund statt einen
 * zweiten zu öffnen (singleKey an symbDialog, Rudolfs Entscheidung im
 * Freigabe-Dialog).
 */
function boonChoiceDialog(functionStuff, buttons, defaultAction) {
  const modern = isModernDialogActive();
  symbDialog({
    title: game.i18n.format(L('BOON_ROLL.CHOICE_TITLE'), { name: functionStuff.abilityName }),
    content: `<div class="symbaroum${modern ? ' modern-roll-dialog' : ' dialog'}"></div>`,
    classes: ['symb-roll-dialog', `symb-roll-user-${game.user.id}`, ...(modern ? modernDialogClasses('modern-roll-dialog') : [])],
    width: 360,
    singleKey: `boonChoice:${functionStuff.actor?.id ?? ''}:${functionStuff.ability?.reference ?? functionStuff.abilityName ?? ''}`,
    onRender: (element) => {
      const btns = element?.querySelectorAll?.('footer button');
      if (!btns || btns.length === 0) return;
      const footer = btns[0].closest('footer') ?? btns[0].parentElement;
      if (footer) {
        footer.style.display = 'flex';
        footer.style.flexDirection = 'column';
        footer.style.gap = '0.25rem';
      }
      for (const b of btns) {
        b.style.boxSizing = 'border-box';
        b.style.setProperty('width', '100%', 'important');
        b.style.setProperty('align-self', 'stretch', 'important');
      }
    },
    buttons,
    default: defaultAction,
  });
}

/** Standard-Abbruch-Taste der Wahl-Dialoge. */
function boonCancelButton() {
  return {
    icon: '<i class="fas fa-times"></i>',
    label: game.i18n.localize('BUTTON.CANCEL'),
  };
}

/* ---------------------------------------------------------------- */
/*  Wahl-Dialoge (preDialogFunction-Muster)                          */
/* ---------------------------------------------------------------- */

/*
 * Buschwissen (RAW APG): Orientierung in der Wildnis (v1.1, Rudolfs
 * Testrunde P4 — oberste Taste, Aufmerksamkeits-Wurf ohne Ertrag),
 * unterwegs 1W6 Rationen pro Tag, ausschließlich fokussiert (keine
 * Bewegung) 1W10 Rationen. Terrainstufe I–III aus system.level
 * (Stufe = Käufe). Der Ertragswürfel wird NUR bei Erfolg geworfen und
 * auf der Karte gezeigt (bushcraftResult).
 */
function bushcraftPreDialog(functionStuff) {
  boonChoiceDialog(
    functionStuff,
    {
      orient: {
        icon: '<i class="fas fa-compass"></i>',
        label: L('BOON_ROLL.BUSHCRAFT_MODE_ORIENTATION'),
        callback: () => {
          functionStuff.bushcraftOrientation = true;
          functionStuff.introText = L('BOON_ROLL.BUSHCRAFT_ORIENT_INTRO');
          functionStuff.resultTextSuccess = L('BOON_ROLL.BUSHCRAFT_ORIENT_SUCCESS');
          functionStuff.resultTextFail = L('BOON_ROLL.BUSHCRAFT_ORIENT_FAILURE');
          functionStuff.autoParams += L('BOON_ROLL.BUSHCRAFT_PARAM_ORIENTATION') + ', ';
          modifierDialog(functionStuff);
        },
      },
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
      cancel: boonCancelButton(),
    },
    'orient'
  );
}

/*
 * Kontakte (RAW GRW + Rudolfs Klärung): RAW ruft sich der Charakter per
 * Ausstrahlung einen Kontakt ins Gedächtnis; als Hausregel kann der
 * Wurf auch Auskunft über die verbundene Gruppierung/Faktion geben
 * (Scharfsinn).
 */
/* S2 Baustein B (Rudolfs „Leg los“, 06.11.2026): Gruppierung des
 * Kontakte-Segens (system.contactGroup, Single-Select der 7 offiziellen
 * Fraktionen + 'custom' mit freiem Text system.contactGroupCustom) als
 * Kontext-Etikett auf Dialog und Karte — bekannte Fraktion aus der
 * i18n-Liste, 'custom' trägt den freien Text (leer = fallback-Label);
 * unbelegtes Feld (Default '') zeigt nichts. RAW bleibt die Erinnerung
 * eine Ausstrahlungs-Probe; die Gruppierung ist reiner Kontext. */
function contactsGroupLabel(functionStuff) {
  const group = String(functionStuff.ability?.contactGroup ?? '').trim();
  if (!group) return '';
  if (group === 'custom') {
    const custom = String(functionStuff.ability?.contactGroupCustom ?? '').trim();
    return custom || L('BOON.CONTACT_GROUP.CUSTOM');
  }
  const key = `BOON.CONTACT_GROUP.${group.toUpperCase()}`;
  const label = L(key);
  return label !== key ? label : group;
}

function contactsPreDialog(functionStuff) {
  const groupParam = contactsGroupLabel(functionStuff);
  boonChoiceDialog(
    functionStuff,
    {
      remember: {
        icon: '<i class="fas fa-user-friends"></i>',
        label: L('BOON_ROLL.CONTACTS_MODE_REMEMBER'),
        callback: () => {
          functionStuff.castingAttributeName = 'persuasive';
          functionStuff.introText = L('BOON_ROLL.CONTACTS_INTRO_REMEMBER');
          functionStuff.resultTextSuccess = L('BOON_ROLL.CONTACTS_SUCCESS_REMEMBER');
          functionStuff.resultTextFail = L('BOON_ROLL.CONTACTS_FAILURE_REMEMBER');
          functionStuff.autoParams += L('BOON_ROLL.CONTACTS_PARAM_REMEMBER') + ', ';
          if (groupParam) functionStuff.autoParams += groupParam + ', ';
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
          if (groupParam) functionStuff.autoParams += groupParam + ', ';
          modifierDialog(functionStuff);
        },
      },
      cancel: boonCancelButton(),
    },
    'remember'
  );
}

/*
 * Unternehmen (RAW APG): Scharfsinn (Handwerker) oder Ausstrahlung
 * (Dienstleister); Erfolg = 10+1W10 Thaler Gewinn (enterpriseResult,
 * v1.1 sofort dem Geldvermögen des Aktors gutgeschrieben).
 */
function enterprisePreDialog(functionStuff) {
  boonChoiceDialog(
    functionStuff,
    {
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
      cancel: boonCancelButton(),
    },
    'craft'
  );
}

/*
 * Profession (RAW GRW): relevantes Attribut, normalerweise Ausstrahlung
 * oder Scharfsinn. Der Posten ist nach 3 Fehlschlägen in Folge oder
 * einer 20 verloren (Hinweis auf der Karte).
 */
function professionPreDialog(functionStuff) {
  boonChoiceDialog(
    functionStuff,
    {
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
      cancel: boonCancelButton(),
    },
    'persuasive'
  );
}

/* ---------------------------------------------------------------- */
/*  v1.1: Musikant und Bestialisch — Wahl-Dialoge                    */
/* ---------------------------------------------------------------- */

/*
 * Musikant (v1.1, Rudolfs Testrunde P9): Beruhigen (RAW: nur gegen
 * Bestien, Ausstrahlung gegen Willenskraft — mit angewähltem Ziel-
 * Token wird die Monsterkategorie geprüft, falsche Kategorie = Warnung
 * ohne Wurf; ohne Ziel-Token läuft die einfache Probe weiter) oder
 * Inspirieren (Ausstrahlung erhöhen für sich und Verbündete, kein
 * Opposed-Wurf, die SL verwaltet den Bonus).
 */
function musicianPreDialog(functionStuff) {
  boonChoiceDialog(
    functionStuff,
    {
      calm: {
        icon: '<i class="fas fa-dove"></i>',
        label: L('BOON_ROLL.MUSICIAN_MODE_CALM'),
        callback: () => {
          // Bestie-Gate (v1.1, Rudolf P9a): nur mit markiertem Ziel —
          // ohne Ziel bleibt der Wurf möglich (Rudolfs Festlegung)
          if (functionStuff.targetData?.hasTarget) {
            const category = functionStuff.targetData.actor?.system?.creatureCategory ?? '';
            if (category !== 'beast') {
              ui.notifications.warn(game.i18n.format(L('BOON_ROLL.MUSICIAN_NOT_BEAST'), { name: functionStuff.targetData.name ?? '' }));
              return;
            }
          }
          // S2 Baustein D (Rudolf 06.11.): Beruhigen-Modus-Marker für
          // musicianResult — nur bei ERFOLG wird das Statussymbol
          // „Beruhigt" über die GM-Karte angewendet; Inspirieren und
          // Misserfolge lösen nie eine Karte aus.
          functionStuff.musicianCalm = true;
          modifierDialog(functionStuff);
        },
      },
      inspire: {
        icon: '<i class="fas fa-music"></i>',
        label: L('BOON_ROLL.MUSICIAN_MODE_INSPIRE'),
        callback: () => {
          functionStuff.castingAttributeName = 'persuasive';
          // Inspirieren ist keine Opposed-Probe: ein markiertes Ziel
          // fließt NICHT in den Wurf ein (neutrales targetData)
          functionStuff.targetData = { hasTarget: false };
          functionStuff.introText = L('BOON_ROLL.MUSICIAN_INSPIRE_INTRO');
          functionStuff.resultTextSuccess = L('BOON_ROLL.MUSICIAN_INSPIRE_SUCCESS');
          functionStuff.resultTextFail = L('BOON_ROLL.MUSICIAN_INSPIRE_FAILURE');
          functionStuff.finalText = L('BOON_ROLL.MUSICIAN_INSPIRE_HINT');
          functionStuff.autoParams += L('BOON_ROLL.MUSICIAN_INSPIRE_PARAM') + ', ';
          modifierDialog(functionStuff);
        },
      },
      cancel: boonCancelButton(),
    },
    'calm'
  );
}

/*
 * Bestialisch (v1.1, Rudolfs Testrunde P10): zwei Anwendungen —
 * Verbergen der bestialischen Merkmale (Heimlichkeit gegen Aufmerk-
 * samkeit des Ziels, bisheriges Verhalten) oder Einschüchtern
 * (Ausstrahlung gegen Willenskraft des Ziels, Rudolfs Freigabe).
 * Beide mit optionalem Ziel (ohne Ziel-Token einfache Probe).
 */
function bestialPreDialog(functionStuff) {
  boonChoiceDialog(
    functionStuff,
    {
      hide: {
        icon: '<i class="fas fa-mask"></i>',
        label: L('BOON_ROLL.BESTIAL_MODE_HIDE'),
        callback: () => {
          functionStuff.autoParams += L('BOON_ROLL.BESTIAL_PARAM_HIDE') + ', ';
          modifierDialog(functionStuff);
        },
      },
      intimidate: {
        icon: '<i class="fas fa-ghost"></i>',
        label: L('BOON_ROLL.BESTIAL_MODE_INTIMIDATE'),
        callback: () => {
          functionStuff.castingAttributeName = 'persuasive';
          // Opposed-Attribut auf Willenskraft umlenken — getTarget()
          // lieferte Aufmerksamkeit (Setup-Default); modifierDialog
          // und buildRolls lesen resistAttributeName aus dem targetData
          if (functionStuff.targetData?.hasTarget) {
            functionStuff.targetData.resistAttributeName = 'resolute';
          }
          functionStuff.introText = L('BOON_ROLL.BESTIAL_INTIMID_INTRO');
          functionStuff.resultTextSuccess = L('BOON_ROLL.BESTIAL_INTIMID_SUCCESS');
          functionStuff.resultTextFail = L('BOON_ROLL.BESTIAL_INTIMID_FAILURE');
          functionStuff.finalText = L('BOON_ROLL.BESTIAL_INTIMID_HINT');
          functionStuff.autoParams += L('BOON_ROLL.BESTIAL_PARAM_INTIMID') + ', ';
          modifierDialog(functionStuff);
        },
      },
      cancel: boonCancelButton(),
    },
    'hide'
  );
}

/* ---------------------------------------------------------------- */
/*  S2 Baustein A (Rudolfs „Leg los“, 06.11.2026): Kontext-Zeilen      */
/* ---------------------------------------------------------------- */

/*
 * BOON_LINES-Kanonik: Situations-Zeilen (Typ B, Bonus) und „Zweite
 * Chance“-Zeilen (Sub-Typ B/G, sc: 'favour' | 'disfavour') aus der
 * Canvas-Analyse — pro kanonischem Ref (system.reference) eine Liste
 * von Zeilen-Objekten:
 *   attr  — Eigenschaft(en), auf die die Zeile passt: String,
 *           Array (Zeile deckt mehrere Eigenschaften ab) oder '*'
 *           (alle Eigenschaftsproben, z. B. Gerüchtekoch/Feuer-
 *           geschmiedet); 'defense'-Würfe bleiben bewusst draußen.
 *   label — i18n-Key der Zeile (BOON.LINE_*); Bonus bzw. Gunst/
 *           Missgunst hängt der Dialog-Builder als „(+X)“- bzw.
 *           „(Gunst)“-Suffix an.
 *   bonus — fester Bonus (Flinkfüßig +3 / Langsam −3, RAW Flucht &
 *           Jagd); ohne bonus gilt system.bonusValue (Stapel-Segene =
 *           Anzahl der Käufe, Migrations-Makro v2), Fallback +1 (RAW
 *           der Umwelt-Segene).
 *   sc    — 'favour' (2W20, besserer zählt) oder 'disfavour' (2W20,
 *           schlechterer zählt): Zeile ERSETZT die Gunst des Wurfs
 *           statt einen Bonus zu geben; pro Wurf ist nur EINE sc-Zeile
 *           anwählbar (Ankreuzen entsperrt/freistellt das Gunst-Radio,
 *           siehe activateBoonLineExclusive). Dunkles Geheimnis ist
 *           bereits S1 fest verdrahtet und steht hier nicht nochmal.
 * Augur bekommt KEINE Zeile (Rituale haben keinen Wurfdialog) — nur
 * den Hinweis-Chip am Ritual-Blatt; bornlucky/Glücksstern ist S3.
 */
const BOON_LINES = {
  // --- Bonus-Zeilen (Typ B) ---
  archivist: [{ attr: 'cunning', label: 'BOON.LINE_ARCHIVIST' }],
  bloodhound: [
    { attr: 'vigilant', label: 'BOON.LINE_BLOODHOUND_TRACK' },
    { attr: 'cunning', label: 'BOON.LINE_BLOODHOUND_HIDE' },
  ],
  shadowspawn: [{ attr: 'discreet', label: 'BOON.LINE_SHADOWSPAWN' }],
  dexterous: [{ attr: 'discreet', label: 'BOON.LINE_DEXTEROUS' }],
  catburglar: [
    { attr: 'quick', label: 'BOON.LINE_CATBURGLAR_QUICK' },
    { attr: 'discreet', label: 'BOON.LINE_CATBURGLAR_DISCREET' },
  ],
  impressionist: [
    { attr: 'discreet', label: 'BOON.LINE_IMPRESSIONIST' },
    { attr: 'discreet', label: 'BOON.LINE_IMPRESSIONIST_FAVOUR', sc: 'favour' },
    { attr: 'discreet', label: 'BOON.LINE_IMPRESSIONIST_DISFAVOUR', sc: 'disfavour' },
  ],
  conartist: [
    { attr: 'persuasive', label: 'BOON.LINE_CONARTIST_LIE' },
    { attr: 'vigilant', label: 'BOON.LINE_CONARTIST_SPOT' },
  ],
  manipulator: [{ attr: 'persuasive', label: 'BOON.LINE_MANIPULATOR' }],
  horrifying: [{ attr: 'persuasive', label: 'BOON.LINE_HORRIFYING' }],
  commandingvoice: [{ attr: 'persuasive', label: 'BOON.LINE_COMMANDINGVOICE' }],
  storyteller: [{ attr: 'persuasive', label: 'BOON.LINE_STORYTELLER' }],
  telltale: [{ attr: '*', label: 'BOON.LINE_TELLTALE' }],
  cartographer: [{ attr: ['vigilant', 'cunning'], label: 'BOON.LINE_CARTOGRAPHER' }],
  medium: [{ attr: ['vigilant', 'resolute', 'persuasive'], label: 'BOON.LINE_MEDIUM' }],
  gambler: [
    { attr: 'cunning', label: 'BOON.LINE_GAMBLER_PLAY' },
    { attr: 'vigilant', label: 'BOON.LINE_GAMBLER_SPOT' },
  ],
  greenthumb: [{ attr: ['vigilant', 'cunning'], label: 'BOON.LINE_GREENTHUMB' }],
  fireforged: [{ attr: '*', label: 'BOON.LINE_FIREFORGED' }],
  welltraveled: [{ attr: 'persuasive', label: 'BOON.LINE_WELLTRAVELED' }],
  streethome: [
    { attr: 'discreet', label: 'BOON.LINE_STREETHOME_BLEND' },
    { attr: 'vigilant', label: 'BOON.LINE_STREETHOME_TURF' },
  ],
  watersedge: [{ attr: ['strong', 'quick'], label: 'BOON.LINE_WATERSEDGE' }],
  marshrunner: [
    { attr: ['strong', 'quick'], label: 'BOON.LINE_MARSHRUNNER_TRAVEL' },
    { attr: 'vigilant', label: 'BOON.LINE_MARSHRUNNER_FOG' },
  ],
  mountainman: [
    { attr: ['quick', 'strong'], label: 'BOON.LINE_MOUNTAINMAN_TRAVEL' },
    { attr: 'strong', label: 'BOON.LINE_MOUNTAINMAN_CLIMB' },
  ],
  hardlife: [{ attr: ['strong', 'resolute'], label: 'BOON.LINE_HARDLIFE' }],
  musician: [{ attr: 'persuasive', label: 'BOON.LINE_MUSICIAN' }],
  mirage: [{ attr: 'persuasive', label: 'BOON.LINE_MIRAGE' }],
  'fleet-footed': [{ attr: 'quick', label: 'BOON.LINE_FLEETFOOTED', bonus: 3 }],
  slow: [{ attr: 'quick', label: 'BOON.LINE_SLOW', bonus: -3 }],
  // --- „Zweite Chance“-Zeilen (Sub-Typ B/G) ---
  pathfinder: [{ attr: 'vigilant', label: 'BOON.LINE_PATHFINDER', sc: 'favour' }],
  escapeartist: [{ attr: ['strong', 'quick', 'discreet'], label: 'BOON.LINE_ESCAPEARTIST', sc: 'favour' }],
  // Ref-Schreibweise 'priviledged' ist kanonisch (Migrations-Makro v2)
  priviledged: [{ attr: 'persuasive', label: 'BOON.LINE_PRIVILEDGED', sc: 'favour' }],
  bestial: [
    { attr: 'persuasive', label: 'BOON.LINE_BESTIAL_FAVOUR', sc: 'favour' },
    { attr: 'persuasive', label: 'BOON.LINE_BESTIAL_DISFAVOUR', sc: 'disfavour' },
  ],
  pariah: [
    { attr: 'persuasive', label: 'BOON.LINE_PARIAH_DISFAVOUR', sc: 'disfavour' },
    { attr: 'persuasive', label: 'BOON.LINE_PARIAH_FAVOUR', sc: 'favour' },
  ],
};

/** Zeilen-Attribut-Match ('*' deckt alles, 'defense' bleibt draußen). */
function boonLineAttrMatch(attr, attributeName) {
  if (attributeName === 'defense') return false;
  if (attr === '*') return true;
  if (Array.isArray(attr)) return attr.includes(attributeName);
  return attr === attributeName;
}

/*
 * Alle Kontext-Zeilen eines Akteurs für eine Eigenschaft — Zeilen
 * erscheinen NUR bei Besitz (Ref muss per Migrations-Makro v2 gesetzt
 * sein), bleiben im Dialog UNANGEHAKT (Rudolfs Entscheidung 1 der
 * Scoping-Runde); Bonus je Zeile aus line.bonus bzw. system.bonusValue
 * (Fallback +1). Dedupe pro Ref (erstes Item gewinnt), Sortierung nach
 * Label. Rückgabe: Array von { key, label, bonus, sc, boonName } —
 * key = `${ref}-${idx}` für DOM-IDs und Submit-Matching.
 */
export function getBoonLinesForActor(actor, attributeName) {
  if (!actor || !attributeName) return [];
  const out = [];
  const seenRefs = new Set();
  for (const item of actor.items ?? []) {
    if (item?.type !== 'boon' && item?.type !== 'burden') continue;
    const ref = String(item.system?.reference ?? '').trim();
    if (!ref || seenRefs.has(ref) || !BOON_LINES[ref]) continue;
    seenRefs.add(ref);
    const bonusValue = Number(item.system?.bonusValue);
    BOON_LINES[ref].forEach((line, idx) => {
      if (!boonLineAttrMatch(line.attr, attributeName)) return;
      let label = L(line.label);
      if (line.sc) {
        label += ` (${L(line.sc === 'favour' ? 'DIALOG.FAVOUR_FAVOUR' : 'DIALOG.FAVOUR_DISFAVOUR')})`;
        out.push({ key: `${ref}-${idx}`, label, bonus: 0, sc: line.sc, boonName: item.name });
      } else {
        const bonus = line.bonus ?? (Number.isFinite(bonusValue) && bonusValue !== 0 ? bonusValue : 1);
        label += ` (${bonus >= 0 ? '+' : '-'}${Math.abs(bonus)})`;
        out.push({ key: `${ref}-${idx}`, label, bonus, sc: null, boonName: item.name });
      }
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  return out;
}

/*
 * Geprüfte Zeilen-Checkboxen eines Dialogs gegen die Zeilen-Liste
 * auflösen (html = symbDialog-Callback-Form [element] oder Element).
 */
export function collectCheckedBoonLines(html, boonLines) {
  const root = html?.[0] ?? html;
  const map = new Map((boonLines ?? []).map((line) => [line.key, line]));
  const checked = [];
  for (const box of root?.querySelectorAll?.('[data-boonline]') ?? []) {
    if (!box.checked) continue;
    const line = map.get(box.dataset.boonline);
    if (line) checked.push(line);
  }
  return checked;
}

/*
 * Gunst-/Missgunst-Exklusivität am Live-DOM (symbDialog-onRender):
 * Eine angekreuzte sc-Zeile hebt alle ANDEREN sc-Zeilen ab und setzt
 * UND SPERRT das Gunst-Radio auf ihren Wert (pro Wurf genau EINE Gunst-
 * bzw. Missgunst-Quelle); normalen Bonus-Zeilen stören sich nicht und
 * sind mehrfach ankreuzbar (addieren sich). Abwählen der sc-Zeile
 * stellt das Radio auf „Normal“ zurück und entsperrt es wieder.
 */
export function activateBoonLineExclusive(element) {
  const root = element?.[0] ?? element;
  const boxes = root?.querySelectorAll?.('[data-boonline]');
  if (!boxes || boxes.length === 0) return;
  for (const box of boxes) {
    box.addEventListener('change', () => {
      const radios = root.querySelectorAll("input[name='favour']");
      if (!box.checked) {
        for (const radio of radios) {
          radio.disabled = false;
          radio.checked = radio.value === '0';
        }
        return;
      }
      const sc = box.dataset.sc;
      if (!sc) return;
      for (const other of boxes) {
        if (other !== box && other.dataset.sc) other.checked = false;
      }
      for (const radio of radios) {
        radio.disabled = true;
        radio.checked = sc === 'favour' ? radio.value === '1' : radio.value === '-1';
      }
    });
  }
}

/* ---------------------------------------------------------------- */
/*  Result-Funktionen (Ertrag nur bei Erfolg, Präzedenz Erdschoss)   */
/* ---------------------------------------------------------------- */

async function bushcraftResult(rollData, functionStuff) {
  // v1.1 (Rudolf P4): Orientierung ist ein reiner Aufmerk-
  // samkeits-Wurf — KEIN Ertragswürfel
  if (rollData?.[0]?.trueActorSucceeded && !functionStuff.bushcraftOrientation) {
    const yieldRoll = await new Roll(functionStuff.bushcraftYieldFormula ?? '1d6').evaluate();
    functionStuff.resultRolls = [yieldRoll];
    functionStuff.finalText = game.i18n.format(L('BOON_ROLL.BUSHCRAFT_YIELD'), { count: yieldRoll.total });
  }
  await standardPowerResult(rollData, functionStuff);
}

async function enterpriseResult(rollData, functionStuff) {
  if (rollData?.[0]?.trueActorSucceeded) {
    const incomeRoll = await new Roll('1d10').evaluate();
    const amount = 10 + incomeRoll.total;
    functionStuff.resultRolls = [incomeRoll];
    // v1.1 (Rudolf P6): Ertrag sofort auf das Geld des Aktors
    // gutschreiben. system.currency ist der Basiswert in ORTEG
    // (1 Thaler = 10 Schilling = 100 Orteg, Währungs-Dialog schreibt
    // dieselbe Einheit zurück); ist das Feld kein endlicher Zahlenwert
    // (z. B. Monster ohne Geld), bleibt es unberührt und der Kartentext
    // ohne Gutschrift-Hinweis.
    const current = Number(functionStuff.actor?.system?.currency);
    let credited = false;
    if (Number.isFinite(current)) {
      await functionStuff.actor.update({ 'system.currency': Math.max(0, Math.round(current + amount * 100)) });
      credited = true;
    }
    functionStuff.finalText = game.i18n.format(L(credited ? 'BOON_ROLL.ENTERPRISE_YIELD_CREDITED' : 'BOON_ROLL.ENTERPRISE_YIELD'), { amount });
  }
  await standardPowerResult(rollData, functionStuff);
}

/*
 * S2 Baustein D (Rudolfs Wunsch 06.11.): Musikant Beruhigen — bei
 * ERFOLG gegen ein Bestien-Ziel erhält die SL die GM-Karte „Wende die
 * Ergebnisse auf den Token an“ mit dem neuen Statussymbol „Beruhigt“
 * (Condition calmed, Icon icons/svg/aura.svg; Muster Fliehende/
 * fearEffect, item.js). Das Symbol ist permanent (keine flagData,
 * keine Runden-Engine, kein Ablauf) — Rücksetzen ist reine SL-Sache
 * (HUD). Inspirieren (targetData neutralisiert) und Misserfolge
 * lösen NIEMALS eine Karte aus; ohne Ziel-Token läuft die einfache
 * Probe weiter (Rudolfs Festlegung v1.2) und es erscheint nur der
 * Hinweis auf der Karte, wenn auch wirklich eine GM-Karte rausging.
 */
async function musicianResult(rollData, functionStuff) {
  const calmedEffect =
    functionStuff.musicianCalm &&
    rollData?.[0]?.trueActorSucceeded &&
    functionStuff.targetData?.hasTarget &&
    functionStuff.targetData.tokenId
      ? CONFIG.statusEffects.find((e) => e.id === 'calmed') ?? CONFIG.statusEffects['calmed']
      : null;
  if (calmedEffect) {
    functionStuff.finalText = (functionStuff.finalText ? `${functionStuff.finalText} ` : '') + L('BOON_ROLL.MUSICIAN_CALM_APPLY_HINT');
  }
  await standardPowerResult(rollData, functionStuff);
  if (calmedEffect) {
    await createModifyTokenChatButton([
      { tokenId: functionStuff.targetData.tokenId, addEffect: foundry.utils.duplicate(calmedEffect) },
    ]);
  }
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
    // v1.1 (Rudolf P9): Beruhigen (nur Bestien, Ziel-Gate) oder
    // Inspirieren (kein Opposed, SL verwaltet den Bonus)
    preDialog: musicianPreDialog,
    // S2 Baustein D: Beruhigen-Erfolg → GM-Karte „Beruhigt“ (calmed)
    result: musicianResult,
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
    // v1.1 (Rudolf P10): Verbergen (Heimlichkeit←Aufmerksamkeit) oder
    // Einschüchtern (Ausstrahlung←Willenskraft, Ziel-Attribut-Override)
    preDialog: bestialPreDialog,
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

/* v1.2 (Rudolfs Testrunde v1.1, Rückmeldung b): Die v1.1-Ziel-Hinweis-
 * zeile („widersteht mit {Eigenschaft}", addBoonTargetHint aus dem
 * modifierDialog-Kopf von item.js) ist ENTFERNT — stattdessen zeigen die
 * Opposed-Segene/-Lasten die Zieleigenschaft über den regulären
 * Kräfte-Pfad auf der Karte an („{Attr} : ({Wert}) ⬅ {Ziel-Attr} :
 * ({Wert})", formatRollString): Ursache des fehlenden Opposed war nie
 * die Anzeige, sondern notResisted im modifierDialog-Callback (siehe
 * Kommentar oben im Setup-Builder); der Ziel-Hinweis-Key aus v1.1 ist
 * mit der Funktion entfallen. */

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
    // v1.2 (Rudolfs Testrunde v1.1, P6 + Rückmeldung b): Der modifier-
    // Dialog-Callback leitet notResisted aus casting/maintain ab — und
    // Boon-Setups stehen auf casting: CASTING + maintain: MAINTAIN_NOT,
    // wodurch notResisted TRUE wurde und buildRolls in den Solo-Zweig
    // lief: Die Zieleigenschaft wurde nie ausgewertet, die Karte zeigte
    // keine „⬅"-Zeile. notResisted: false erzwingt den Opposed-Zweig —
    // mit Ziel-Token wird gegen targetResistAttribute geprobt und die
    // Karte zeigt „{Anwender-Attr} : ({Wert}) ⬅ {Ziel-Attr} : ({Wert})"
    // exakt wie bei Kräften (inkl. Resist-Wurf-Button des Ziel-Spielers);
    // ohne Ziel-Token bleibt targetMandatory false → einfache Probe
    // (Rudolfs Festlegung 06.11.). Musikant-Inspirieren setzt sein
    // targetData selbst auf hasTarget:false und bleibt Solo.
    base.notResisted = false;
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
