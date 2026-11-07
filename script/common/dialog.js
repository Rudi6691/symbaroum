import { getOwnerPlayer, createResistRollChatButton, rollDeathTest } from './roll.js';
import { buildRolls, isAxeArtistWeapon, getActorAbilityLevel, getActivePoisonCoatGrade, getPendingWeaponCoat, setPendingWeaponCoat, wipeWeaponPoisonCoats, isWeaponPoisonDose, resolveWeaponPoisonChoice } from './item.js';
import { symbDialog } from './symbDialog.js';
import { isModernDialogActive, modernDialogClasses } from './modernSheetConfig.js';
// Segen & Lasten S2 (Rudolfs „Leg los“, 06.11.2026): Kontext-Zeilen im
// Eigenschafts-Würfeldialog (Typ B + B/G „Zweite Chance“ mit Radio-
// Exklusivität) — Kanonik und Helfer in boon.js
// S3 (07.11.2026): getDeathTestFavour sperrt das Gunst-Radio des
// Todesprobe-Dialogs bei Zäh/Kränklich (Zwangswert), getEpilepsyPenalty
// vorbelegt den Modifikator in der Anfalls-Erschöpfungsphase (−1).
import { getBoonLinesForActor, collectCheckedBoonLines, activateBoonLineExclusive, getDeathTestFavour, getEpilepsyPenalty, hasPoisonManual } from './boon.js';
// Munitionsverbrauch v1: Abbuchung beim Wurf-Submit (Menge × Angriffs-
// anzahl, Block bei zu geringem Bestand - Pre-Flight lief in rollWeapon)
// Elixiere v1.4: + Spezialmunition-Opt-in (Betäubungspfeil/Treffpfeil)
import { consumeAmmoForAttack, getAmmoEffectTotal, consumeAmmoEffectForAttack } from './ammo.js';
// Elixier-Automatisierung v1: Benommen-Malus (Nebelball) als Dialog-Vorbelegung
import { getDazedPenalty } from './elixirs.js';
// Elixiere v1.5: Gift-Beschichtung - Bestandspruefung der Dosis-Stapel
import { getItemCount } from './resources.js';

let roll_defaults = {};

/* P26 (Rudolfs Entscheidung nach der S3-Testrunde, A5): der Shift-Klick-
   Quick-Pfad ist ENTFERNT - der Todeswurf öffnet IMMER den Dialog, ein
   versehentlicher Sofortwurf ohne Dialog ist nicht mehr möglich. */
export async function prepareRollDeathTest(actor) {
  const did = `${actor.id}${foundry.utils.randomID(20)}`; // dialogue ID - ensured unique IDs in form
  let attri_defaults = getRollDefaults("deathtest",false, false);
  /* S3 (Rudolfs Festlegungen 1–3, 07.11.2026) → P26-fix1 (Rudolfs
     Testrunde, P26-02): Bei Zäh (Gunst), Kränklich (Missgunst) oder
     beiden (neutral, ein Würfel) ist der Wert jetzt VORAUSWAHL des
     Gunst-Radios — das Radio bleibt MANUELL ÄNDERBAR („Nicht
     verriegeln. Manuelle Einstellung muss möglich sein."), der
     Segen/Last steht als Hinweiszeile über dem Radio. Der Submit liest
     die Radios und übergibt rollDeathTest das Flag manualFavour, damit
     die (ggf. geänderte) Dialog-Auswahl gewinnt; Makro-Aufrufe ohne
     Flag behalten weiterhin die Zwangsgunst. */
  const deathMod = getDeathTestFavour(actor);
  if (deathMod.forced) {
    attri_defaults.selectedFavour = String(deathMod.favour);
  }
  const dialoghtml = await foundry.applications.handlebars.renderTemplate('systems/symbaroum/template/chat/dialog-deathtest.hbs', {
    "did":did,
    "choices": { "0": "DIALOG.FAVOUR_NORMAL", "-1":"DIALOG.FAVOUR_DISFAVOUR", "1":"DIALOG.FAVOUR_FAVOUR"},
    "roll_defaults":attri_defaults,
    "groupName" : "favour",
    "deathMod": deathMod,
  });
  let dialog = symbDialog({
    title: "Death Test",
    content: dialoghtml,
    // P26 (Dialog-Audit, geboren aus S2-Testpunkt 26): modernes Fenster-Chrome, wenn der
    // Nutzer die modernen Blätter nutzt - der Todesprobe-Dialog war der letzte
    // große Wurfdialog ohne Modern-Styling (vorbestehend). Marker-Klassen
    // 'symb-roll-dialog' + Nutzer-ID wie bei allen Würfeldialogen, damit
    // closeOpenRollDialogs beim Designwechsel auch dieses Fenster schließt.
    classes: [`symb-roll-dialog`, `symb-roll-user-${game.user.id}`, ...(isModernDialogActive() ? modernDialogClasses('modern-roll-dialog') : [])],
    buttons: {
      roll: {
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize('BUTTON.ROLL'),
        callback: async (html) => {
          /* P26-fix1: Das Radio ist immer vorhanden (Vorauswahl bei
             Zäh/Kränklich, s.o.), der Submit liest die Auswahl des
             Spielers und gibt sie mit manualFavour-Flag weiter. */
          let fvalue = 0;
          let favours = html[0].querySelectorAll("input[name='favour']");
          for (let f of favours) {
            if (f.checked) fvalue = f.value;
          }
          attri_defaults.selectedFavour = '' + fvalue;
          const favour = fvalue;

          let modifier = Number(html[0].querySelector('#modifier-'+did).value);
          if(isNaN(modifier)) {
            modifier = 0;
          }
          attri_defaults.modifier = modifier;

          await rollDeathTest(actor, favour, modifier, true);
        },
      },
      cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('BUTTON.CANCEL'),
          callback: () => {},
      },
    },
    default: 'roll',
  });
}

/* A30 (GO1, Rudolfs Wahl = Empfehlung): one-handed grip on a bastard weapon -
   the damage die goes one step down (config.bastardGripDiceSteps, W4 floor,
   odd/upgraded sizes fall back to sides-2) and Massive loses its 2dXkh formula
   and the damage favour; Deep Impact's +1 arrives as a quality member and is
   filtered separately by the dialog callback */
function a30ReducedSides(sides) {
  const steps = game.symbaroum.config.bastardGripDiceSteps ?? {};
  if (steps[sides]) return steps[sides];
  return Math.max(4, sides - 2);
}

function a30OneHandedDamage(weapon) {
  const dmg = foundry.utils.deepClone(weapon.damage);
  const m = dmg.base?.match(/(\d+)d(\d+)/);
  if (m) dmg.base = `1d${a30ReducedSides(parseInt(m[2]))}`;
  if (typeof dmg.npcBase === "number") dmg.npcBase = Math.ceil(a30ReducedSides(Math.round(dmg.npcBase * 2)) / 2);
  dmg.damageFavour = 0;
  return dmg;
}

export async function prepareRollAttribute(actor, attributeName, armor, weapon, ecData = {targetData: {hasTarget: false, leaderTarget: false, actor: {}}}) {
  return new Promise(async (resolve, reject) => {
  let targetTokens = Array.from(game.user.targets);
  let attri_mods = getVersusModifiers(targetTokens);
	let attri_defaults = getRollDefaults(attributeName,armor !== null, weapon !== null, ecData);
  // Elixier-Automatisierung v1 (Nebelball, Verwendungsform vollautomatisch):
  // Benommene Werfer/Charaktere erhalten ihren Malus (-1/-3/-5 auf ALLE
  // Erfolgsproben) als VORBELEGUNG des Modifikator-Felds - sichtbar und
  // bewusst ueberschreibbar (Muster Impeding-Zeile), dazu eine autoParams-
  // Zeile fuer Dialog und Chat-Karte. Gilt fuer JEDE Attributprobe ueber
  // diesen Dialog (Faehigkeits- und Waffenwuerfe laufen zusaetzlich ueber
  // modifierDialog in item.js); Freiform-Makro-Wuerfe bleiben draussen
  // (dokumentierte Begrenzung).
  // BEWUSST kein In-place-Mutation: attri_defaults kann der GECACHTEN
  // Default-Instanz des saveCombatRoll/saveAttributeRoll-Speichers
  // entsprechen - der Malus wird nur in die KOPIE fuer das Template
  // eingerechnet (roll_defaults unten), sonst wuerde er mit jedem
  // Dialog-Oeffnen akkumulieren. Der Submit liest ohnehin das Input-Feld.
  const elixirDazedPenalty = getDazedPenalty(actor);
  if(elixirDazedPenalty > 0) {
    ecData.autoParams = (ecData.autoParams ?? '') + game.i18n.format('ELIXIR.DAZED_AUTOPARAM', { penalty: elixirDazedPenalty }) + ', ';
  }
  // S3 (Last Epileptisch, Phase 2 — Rudolfs Freigabe 07.11.2026):
  // Nach einem Anfall erschöpft der Charakter mit −1 auf alle
  // Erfolgsproben bis zum Szenenende (Condition „epilepsy“, Muster
  // Benommen-Malus oben): autoParams-Zeile + Modifikator-VORBELEGUNG
  // in dieselbe Kopie-Logik (keine In-place-Mutation der gecachten
  // Defaults, Summe aus Benommen + Epilepsie). Waffenwürfe laufen
  // zusätzlich über modifierDialog (item.js); Freiform-Makro-Würfe
  // bleiben draussen (gleiche dokumentierte Begrenzung wie dort).
  const epilepsyPenalty = getEpilepsyPenalty(actor);
  if(epilepsyPenalty > 0) {
    ecData.autoParams = (ecData.autoParams ?? '') + game.i18n.format('EPILEPSY.AUTOPARAM', { penalty: epilepsyPenalty }) + ', ';
  }
  let askImpeding = actor.system.combat.impeding !== 0 && weapon === null && armor === null;
  let weaponModifiers = null;
  let askTargetAttribute = ecData.askTargetAttribute ?? false;
  let askIgnoreArmor = ecData.askIgnoreArmor ?? false;
  let ignoreArm = ecData.ignoreArm ?? false;
  let attackFromPC = true;
  let askCorruptedTarget = ecData.askCorruptedTarget ?? false;
  let weaponDamage = "";
  let hasTarget = false;
  let askAttackNb = false;
  let ecOn = game.settings.get('symbaroum', 'combatAutomation');
  if(ecOn && weapon !== null) {
    attackFromPC = actor.type !== "monster" || ecData.targetData.actor.type === "monster";
    askImpeding = ecData.askImpeding;
    attri_defaults.impeding = ecData.impeding;
    hasTarget = ecData.targetData.hasTarget;
  } else {
    askTargetAttribute = targetTokens.length > 0;
  }
  if(weapon !== null) {
    weaponModifiers = foundry.utils.deepClone(actor.system.combat.combatMods.weapons[weapon.id]); // All modifiers needed
    // Create any radio box alternatives from weaponModifier
    createLineDisplay(weaponModifiers, attackFromPC);
    weaponDamage = attackFromPC ? weapon.damage.base : weapon.damage.npcBase;
    if(weapon.doAlternativeDamage){
      ecData.isAlternativeDamage = true;
      ecData.alternativeDamageAttribute = weapon.damage.alternativeDamageAttribute;
      ecData.ignoreArm = true;
      ecData.isMystical = true;
      weaponDamage += " ("+game.symbaroum.api.getAttributeLabel(actor, ecData.alternativeDamageAttribute)+")";
    }
    if(game.settings.get('symbaroum', 'combatAutomation')){
      askAttackNb = weaponModifiers.maxAttackNb > 1;
    }
  }
  // A30: bastard grip radio - only for melee bastard weapons in enhanced
  // combat (the one-handed damage model needs the EC roll path); the radio
  // default is the persisted wield state (flag on the weapon item, kept by
  // the dialog after every attack), fresh weapons start two-handed
  let askBastardGrip = false;
  let defaultGrip = "two";
  let weaponDamage2H = weaponDamage;
  let weaponDamage1H = weaponDamage;
  if (ecOn && weapon !== null && weapon.isMelee && weapon.qualities?.bastard) {
    askBastardGrip = true;
    defaultGrip = actor.items.get(weapon.id)?.getFlag(game.system.id, "grip") === "one" ? "one" : "two";
    const oneHanded = a30OneHandedDamage(weapon);
    weaponDamage1H = attackFromPC ? oneHanded.base : oneHanded.npcBase.toString();
    if (defaultGrip === "one") weaponDamage = weaponDamage1H;
  }
  // Axtkünstler v1.1 (Rudolfs Testrunde 1, 29.10.): Die Technik-Auswahl
  // läuft NICHT mehr über den Fähigkeits-Button, sondern als Radio-Block
  // direkt im Würfeldialog des Waffenangriffs (analog Zweihandkraft,
  // "Einfach" als Standard). Nur wenn die Waffe das Flag "geeignet für
  // Axtkünstler" trägt UND der Akteur die Fähigkeit gelernt hat;
  // "Doppelschlag" erst ab Stufe 2 (Adept).
  let askAxeArtist = false;
  let axeArtistChoices = [];
  if (ecOn && weapon !== null && isAxeArtistWeapon(weapon)) {
    const axeArtistLvl = getActorAbilityLevel(actor, "axeartist");
    if (axeArtistLvl >= 1) {
      askAxeArtist = true;
      axeArtistChoices = [
        {
          value: "simple",
          checked: true,
          label: game.i18n.localize("DIALOG.AXEARTIST_SIMPLE"),
          hint: game.i18n.localize("DIALOG.AXEARTIST_SIMPLE_HINT"),
        },
        {
          value: "shortend",
          checked: false,
          label: game.i18n.localize("DIALOG.AXEARTIST_SHORTEND"),
          hint: game.i18n.localize("DIALOG.AXEARTIST_SHORTEND_HINT"),
        },
      ];
      if (axeArtistLvl >= 2) {
        axeArtistChoices.push({
          value: "double",
          checked: false,
          label: game.i18n.localize("DIALOG.AXEARTIST_DOUBLE"),
          hint: game.i18n.localize("DIALOG.AXEARTIST_DOUBLE_HINT"),
        });
      }
    }
  }
  // Dreckiger Kampf v1 (Rudolfs Auswahlrunde 29.10.): Fiese-Schläge-Angriff
  // als Technik-Radio im Würfeldialog der Nahkampfwaffe (Muster Axtkünstler
  // v1.1). Gilt für JEDE aktive Nahkampfwaffe inkl. "Waffenloser Kampf"
  // (unarmed ∈ meleeWeapons, Vault Waffenlos.md) — KEIN Waffen-Flag nötig.
  // Adept (Stolpern) und Meister (Riposte) laufen passiv in attackResult.
  let askCheapshot = false;
  let cheapshotChoices = [];
  if (ecOn && weapon !== null && weapon.isMelee) {
    const cheapshotLvl = getActorAbilityLevel(actor, "cheapshot");
    if (cheapshotLvl >= 1) {
      askCheapshot = true;
      cheapshotChoices = [
        {
          value: "simple",
          checked: true,
          label: game.i18n.localize("DIALOG.AXEARTIST_SIMPLE"),
          hint: game.i18n.localize("DIALOG.AXEARTIST_SIMPLE_HINT"),
        },
        {
          value: "strike",
          checked: false,
          label: game.i18n.localize("DIALOG.CHEAPSHOT_STRIKE"),
          hint: game.i18n.localize("DIALOG.CHEAPSHOT_STRIKE_HINT"),
        },
      ];
    }
  }
  // Elixiere v1.4 (Rudolfs Freigabe 02.11.): Spezialmunition-Opt-in im
  // Wuerfeldialog des FERNKAMPF-Angriffs - Betaeubungspfeil (stunBolt) /
  // Treffpfeil (seekingArrow), nur EINE Wirkung waehlbar, Abbuchen beim
  // Wuerfeln (ammo.js consumeAmmoEffectForAttack). Rudolfs Design aus der
  // v1.0-Testrunde: bewusst NICHT an das Waffen-Munitions-Feld oder das
  // Munitionsverbrauch-Setting gebunden - das Opt-in ist die explizite
  // Spieler-Entscheidung; die Zeilen erscheinen nur, wenn der Akteur
  // passende Stapel IM INVENTAR hat. Die Wirkungs-Automatisierung
  // (Staerke-[Schaden]-Probe / Treffpfeil-Hinweis) feuert im
  // Kampfautomatik-Pfad weiter (attackResult, wie beim EC-Kategorie-Pfad).
  let askAmmoEffect = false;
  let ammoEffectChoices = [];
  if (weapon !== null && weapon.isMelee !== true) {
    const stunBoltTotal = getAmmoEffectTotal(actor, "stunBolt");
    const seekingArrowTotal = getAmmoEffectTotal(actor, "seekingArrow");
    if (stunBoltTotal > 0 || seekingArrowTotal > 0) {
      askAmmoEffect = true;
      ammoEffectChoices = [
        {
          value: "none",
          checked: true,
          label: game.i18n.localize("DIALOG.AMMO_EFFECT_NONE"),
          hint: game.i18n.localize("DIALOG.AMMO_EFFECT_NONE_HINT"),
        },
      ];
      if (stunBoltTotal > 0) {
        ammoEffectChoices.push({
          value: "stunBolt",
          checked: false,
          label: game.i18n.localize("DIALOG.AMMO_EFFECT_STUNBOLT"),
          hint: game.i18n.localize("DIALOG.AMMO_EFFECT_STUNBOLT_HINT"),
        });
      }
      if (seekingArrowTotal > 0) {
        ammoEffectChoices.push({
          value: "seekingArrow",
          checked: false,
          label: game.i18n.localize("DIALOG.AMMO_EFFECT_SEEKINGARROW"),
          hint: game.i18n.localize("DIALOG.AMMO_EFFECT_SEEKINGARROW_HINT"),
        });
      }
    }
  }
  // Elixiere v1.5 (Gift auftragen, Rudolfs Freigabe 02.11.): Waffen-
  // beschichtung aus dem INVENTAR - Kandidaten sind Ausruestungs-Items mit
  // gesetztem GM-Feld elixirEffect.poisonGrade (Grad 1-5 der Formel-Tabelle)
  // und Bestand > 0. Formel = damagePerRound, Dauer = rounds (beide mit
  // Fallback 1d4, falls der SL nur den Grad getaggt hat). Nah- UND Fern-
  // kampf (Klingen wie Bolzen tragen Gift); 1 Dosis je Angriff, Abbuchung
  // beim Wurf-Submit, Wirkung bei Treffer inline auf der Angriffskarte
  // ([Staerke gegen Staerke], Ausfuehrung attackResult). Muster:
  // Spezialmunition-Opt-in (explizite Spielerentscheidung, nicht Setting-
  // gebunden; Block nur mit Bestand im Inventar).
  let askPoisonCoating = false;
  let poisonCoatingChoices = [];
  let ownPoison = null;
  let activeCoatGrade = 0;
  let pendingCoat = null;
  if (weapon !== null) {
    // Gift v1.1 (P9): zentraler Dosen-Filter (Handbuch der Gifte mit
    // Referenz poisonmanual bleibt ausserhalb aller Auswahllisten).
    const poisonCoatingItems = actor.items.filter((it) => isWeaponPoisonDose(it));
    if (poisonCoatingItems.length > 0) {
      askPoisonCoating = true;
      poisonCoatingChoices = poisonCoatingItems.map((it) => {
        const eff = it.system.elixirEffect ?? {};
        // Formel-Kette: "Schaden/Runde" -> "Schaden" (Sofortfeld als DoT) ->
        // Default 1d4 (GM-Kalibrierung); Dauer aus "Runden" (Default 1d4).
        const formula = String(eff.damagePerRound ?? "").trim() || String(eff.damage ?? "").trim() || "1d4";
        const roundsFormula = String(eff.rounds ?? "").trim() || "1d4";
        return { id: it.id, name: it.name, count: getItemCount(it), formula, roundsFormula };
      });
    }
    // Elixiere v1.7 (Rudolfs Waffengift-Dialog-Vereinheitlichung): EIGEN-
    // GIFT als unbegrenzte Option - Traeger des Merkmals Giftig (poisonous)
    // tragen ihr eigenes Gift auf die Waffe auf, OHNE Ressourcenverbrauch
    // ("Giftig" = unbegrenzter Vorrat, Rudolfs Klaerung). Die Giftstufe
    // ist durch die Stufe des Merkmals vorgegeben (1 = Leichtes, 2 =
    // Mittleres, 3 = Starkes Gift) und im Dialog VORSELEKTIERT.
    // Gift v1 B4 (08.11.2026): Eigengift NUR noch Giftig - die Faehigkeit
    // Giftmischer (poisoner) braucht Dosen aus dem Inventar (RAW). B3:
    // Adept/Meister sehen ihre AKTIVE Szenen-Beschichtung (Condition
    // poisoncoat, kein Verbrauch, Vergifter-Pfad), auch ohne Inventar.
    const ownPoisonGrade = getActorAbilityLevel(actor, "poisonous");
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
    activeCoatGrade = getActivePoisonCoatGrade(actor);
    if (activeCoatGrade > 0) askPoisonCoating = true;
    // Gift v1.1 (P4): anhaltende Dosen-Beschichtung (Actor-Flag) als
    // VORSELEKTIERTE Option (dosecoat) - sie wirkt automatisch bei
    // jedem Angriff (Auto-Apply in attackResult), bis eine Vergiftung
    // gelingt oder "Kein Gift" sie abwischt.
    pendingCoat = getPendingWeaponCoat(actor);
    if (pendingCoat) askPoisonCoating = true;
  }
  // Gift v1.2 (Rudolfs v1.1-Runde, P11): FESTE Handbuch-Bonus-Zeile im
  // Waffen-Wuerfeldialog (Muster Waffenqualitaet "Durchschlagend",
  // gesperrtes Feld). Reine Anzeige - das +1 wirkt weiterhin auf die
  // Beschichtungsprobe (Coating-Block in item.js), NICHT auf den
  // Angriffswurf; der Faehigkeitswurf-Dialog hat sein eigenes +1.
  const poisonManualBonus = weapon !== null && getActorAbilityLevel(actor, "poisoner") > 0 && hasPoisonManual(actor);
  let targetAttribute_selection = foundry.utils.duplicate(game.symbaroum.config.ATTRIBUTE_SELECTION);
  targetAttribute_selection.defense = {
    id: "defense",
    label: game.i18n.localize(`ARMOR.DEFENSE`),
  };
  if(attri_mods?.show){
    for (const [key, value] of Object.entries(targetAttribute_selection)) {
      targetAttribute_selection[key].label = targetAttribute_selection[key].label +" "+attri_mods[key];
    }
  }
  targetAttribute_selection.custom = {
    id: "custom",
    label: game.i18n.localize(`WEAPON.NONE`),
  };
  const did = `${actor.id}${foundry.utils.randomID(20)}`; // dialogue ID - ensured unique IDs in form
  // Ressourcen v1.4 (A30-Live, Rudolfs Sammel-Fix): Bei Bastardwaffen werden
  // die einhändig unterdrueckten Qualitaets-Zeilen (Durchschlagend/Praezise/
  // Massiv) im Dialog mit der Markierungsklasse a30-grip-suppress versehen,
  // damit der Griff-Radio sie live ein-/ausblenden kann. Bewusst nur eine
  // TIEFE KOPIE fuer den Template-Kontext - der Submit liest weiterhin aus
  // dem Original (dessen member-Filter und Clone-Logik unangetastet bleiben).
  let weaponModifiersCtx = weaponModifiers;
  if (askBastardGrip && weaponModifiers) {
    weaponModifiersCtx = foundry.utils.deepClone(weaponModifiers);
    const a30Suppressed = game.symbaroum.config.bastardOneHandedQualities ?? [];
    for (let pack of weaponModifiersCtx.package ?? []) {
      if (pack.type == game.symbaroum.config.PACK_DEFAULT) {
        for (let member of pack.member ?? []) {
          member.a30GripSuppress = a30Suppressed.includes(member.qualityRef);
        }
      }
    }
  }
  // Segen & Lasten S2 (Rudolfs „Leg los“, 06.11.2026): Kontext-Zeilen der
  // besessenen Segen/Lasten für DIESE Eigenschaft (Typ B Bonus-Zeilen +
  // B/G „Zweite Chance“-Zeilen, Kanonik BOON_LINES in boon.js). Zeilen
  // erscheinen nur bei Besitz, bleiben leer/angehakt-frei und sind reine
  // Spieler-Opt-ins (RAW-Situationsboni); 'defense'-Rüstungs-Würfe und
  // freie Makro-Würfe bleiben bewusst draußen.
  const boon_lines = getBoonLinesForActor(actor, attributeName);
  // Automatisierungspaket 1 (28.10.): Würfeldialog im modernen Design, wenn
  // der Nutzer die modernen Blätter nutzt (pro User GLOBAL, Rudolfs
  // Entscheidung) - gleiche Feld-IDs, nur das Layout ist neu
  const modernRoll = isModernDialogActive();
  const dialoghtml = await foundry.applications.handlebars.renderTemplate(modernRoll ? 'systems/symbaroum/template/chat/dialog-modern.hbs' : 'systems/symbaroum/template/chat/dialog.hbs', {
    "did":did,
    "askTargetAttribute": askTargetAttribute,
    "isWeaponRoll" : weapon !== null,
    "weaponDamage" : weaponDamage,
    "askIgnoreArmor" : askIgnoreArmor,
    "ignoreArm": ignoreArm,
    "weaponModifiers" : weaponModifiersCtx,
    // Gift v1.2 (P11): festes Handbuch-Bonus-Flag fuer die gesperrte
    // Dialog-Zeile (dialog.hbs, Muster Waffenqualitaet)
    "poisonManualBonus": poisonManualBonus,
    "isArmorRoll" : armor !== null,
    "askImpeding" : askImpeding,
    "choices": { "0": game.i18n.localize("DIALOG.FAVOUR_NORMAL"), "-1":game.i18n.localize("DIALOG.FAVOUR_DISFAVOUR"), "1":game.i18n.localize("DIALOG.FAVOUR_FAVOUR")},
    "groupName":"favour",
    "attri_mods" : attri_mods,
    "roll_defaults": (elixirDazedPenalty + epilepsyPenalty) > 0 ? { ...attri_defaults, modifier: (Number(attri_defaults.modifier) || 0) - elixirDazedPenalty - epilepsyPenalty } : attri_defaults,
    "askAttackNb": askAttackNb,
    "attNbRadio": "attNbRadio",
    "targetAttribute_selection":targetAttribute_selection,
    "askBastardGrip": askBastardGrip,
    "gripChoices": { "two": "DIALOG.TWOHANDED", "one": "DIALOG.ONEHANDED" },
    "defaultGrip": defaultGrip,
    "askAxeArtist": askAxeArtist,
    "axeArtistChoices": axeArtistChoices,
    "askCheapshot": askCheapshot,
    "cheapshotChoices": cheapshotChoices,
    "askAmmoEffect": askAmmoEffect,
    "ammoEffectChoices": ammoEffectChoices,
    "askPoisonCoating": askPoisonCoating,
    "poisonCoatingChoices": poisonCoatingChoices,
    "ownPoison": ownPoison,
    // Gift v1 B3: aktive Szenen-Beschichtung als eigene Select-Option
    "activeCoat": activeCoatGrade > 0 ? { grade: activeCoatGrade } : null,
    // Gift v1.1 P4: anhaltende Dosen-Beschichtung als vorselektierte Option
    "pendingCoat": pendingCoat,
    "boon_lines": boon_lines
  });

  const baseDialogTitle = game.symbaroum.api.getAttributeLabel(actor, attributeName);
  const dialog = symbDialog({
    title: baseDialogTitle,
    content: dialoghtml,
    // Automatisierungspaket 1: modernes Fenster-Chrome (A6v9-Muster).
    // v1.2: Marker-Klassen 'symb-roll-dialog' + Nutzer-ID, damit beim
    // Design-/Ansichtswechsel die offenen Würfeldialoge dieses Nutzers
    // geschlossen werden können (closeOpenRollDialogs).
    classes: [`symb-roll-dialog`, `symb-roll-user-${game.user.id}`, ...(modernRoll ? modernDialogClasses('modern-roll-dialog') : [])],
    // S2: Gunst-/Missgunst-Exklusivität der B/G-Zeilen am Live-DOM
    // (bei Waffen-Würfen wird zusätzlich NACH dem zweiten Render im
    // A30-Block unten aktiviert, siehe dort)
    onRender: (element) => activateBoonLineExclusive(element),
    // Kosmetik v1.1: größenveränderbar und Breiten-Skalierung sind
    // jetzt symbDialog-Defaults (siehe symbDialog.js) - hier nicht mehr
    // pro Aufrufstelle nötig.
    buttons: {
      roll: {
        icon: '<i class="fas fa-check"></i>',
        label: game.i18n.localize('BUTTON.ROLL'),
        callback: async (html) => {          

          let dummyMod = "custom";
          if(askTargetAttribute){	
            if( html[0].querySelector("#targetAttribute-"+did).length > 0) {
              dummyMod = html[0].querySelector("#targetAttribute-"+did).value;											
            }
            if(game.settings.get('symbaroum', 'combatAutomation') && weapon !== null){
              ecData.targetData.resistAttributeName = dummyMod;
              ecData.targetData.resistAttributeValue = getAttributeValue(ecData.targetData.actor, dummyMod);
            }
          }
          attri_defaults.targetAttributeName = dummyMod;
          const targetAttributeName = dummyMod;
          // TODO  - NOT UNIQUE ID - BAD IDEA
          let modifier = Number(html[0].querySelector("#modifier-"+did).value);   
          if(isNaN(modifier)) {
            modifier = 0;
          }
          attri_defaults.modifier = modifier;
          ecData.modifier = modifier;
          // S2.1 (P5+P9): freier Modifikator RAW (nur Dialog-Feld, OHNE
          // Paket-Mitglieder/Segen-Zeilen/Behinderung) für die einheit-
          // liche Wurfzeile „+ 1 (Modifikator)" — die weiteren Modifi-
          // katoren tragen ihre eigenen autoParams-Labels.
          ecData.freeModifier = modifier;
          // TODO  - NOT UNIQUE ID - BAD IDEA
          let hasAdvantage = html[0].querySelector("#advantage-"+did)?.checked ?? false;
          attri_defaults.advantage = hasAdvantage ? "checked":"";
          const advantage = hasAdvantage; 
          ecData.hasAdvantage = advantage;
          if(advantage){
              ecData.modifier += 2;
              ecData.autoParams += game.i18n.localize('DIALOG.ADVANTAGE') + ", ";
              if(ecData.askBackstab && ecData.actor.system.attributes.discreet.total > ecData.actor.system.attributes[ecData.castingAttributeName].total){
                  ecData.castingAttributeName = "discreet";
              }
          }
          // Automatisierungspaket 1 (Rudolf, 28.10.): "Freier Angriff"-
          // Toggle. Die RAW-Auslöser (Langwaffe, Vorbeirennen/Flüchten,
          // Verpatzte Verteidigung ...) bleiben SL-Buchhaltung - der Toggle
          // markiert die AUSFÜHRUNG: hartes Präzision-Override (Rudolfs
          // Festlegung: gilt auch gegen Fähigkeiten, die für Angriffe eine
          // andere Eigenschaft erlauben) und Unterdrückung aktiver
          // PACK_CHECK-Pakete (RAW: passive ja, aktive nein)
          const hasFreeAttack = weapon !== null && !!(html[0].querySelector("#freeattack-"+did)?.checked);
          if(hasFreeAttack){
            attributeName = "accurate";
            ecData.castingAttributeName = "accurate";
            ecData.freeAttack = true;
            ecData.autoParams += game.i18n.localize('CHAT.CRITICAL_FREEATTACK') + ", ";
          }
          // TODO Not unique ID
          let hasDamModifier = html[0].querySelector("#dammodifier-"+did)?.value.length > 0;
          let damModifier = "";
          let damModifierNPC = 0;
          let damModifierAttSup ="";
          let damModifierAttSupNPC=0;
          if(hasDamModifier) {

            let damString = html[0].querySelector("#dammodifier-"+did)?.value;            
            // Save - it is a string
            damString = damString.trim();
            if(damString.length) {
              attri_defaults.additionalModifier = damString; // Regardless if valid or not, set it as attri_defaults
              let plus = '+';
              let damSource = "["+game.i18n.localize("DIALOG.DAMAGE_MODIFIER")+"] ";
              if(damString.charAt(0)=== "+" ) {
                plus = ""; // If it already has plus, do not add another
              }
              if(/\[[^\]]+\]/.test(damString) ) {
                damSource = ""; // If it has "[damage source]" already in roll string, do not add another one
              }
              damModifier = `${plus}${damString}${damSource}`;

                // Validate string as valid roll object              
              let r = Roll.validate(damModifier);
              if(!r) {
                  ui.notifications.error(`The ${html[0].querySelector("#dammodifier-"+did)?.value} ${game.i18n.localize("DIALOG.DAMAGE_MODIFIER")} can't be used for rolling damage`);
                  reject("invalid");
                  return;
              }
              damModifierAttSup = damModifier;
              if(!attackFromPC){
                let parsedMod = parseInt(damString);
                if (!isNaN(parsedMod)) { 
                  damModifierNPC = parsedMod;
                  damModifierAttSupNPC = parsedMod;
                }
              }
            }
          }          
          if( weapon !== null) {
            // A30: read the bastard grip radio BEFORE the package loop so the
            // filtered members apply to every consumer below
            if (askBastardGrip) {
              let a30Grip = defaultGrip;
              for (let g of html[0].querySelectorAll("input[name='bripType']")) {
                if (g.checked) a30Grip = g.value;
              }
              if (a30Grip === "one") {
                // one-handed: filter the quality members (Durchschlagend/
                // Präzise/Massiv) out of the default package, clone the
                // weapon with the reduced damage die (Massive loses 2dXkh
                // and the damage favour)
                const a30Suppressed = game.symbaroum.config.bastardOneHandedQualities ?? [];
                for (let pack of weaponModifiers.package) {
                  if (pack.type == game.symbaroum.config.PACK_DEFAULT) {
                    pack.member = pack.member.filter((m) => !a30Suppressed.includes(m.qualityRef));
                  }
                }
                ecData.weapon = foundry.utils.deepClone(weapon);
                ecData.weapon.damage = a30OneHandedDamage(weapon);
                const a30Qualities = weapon.qualities ?? {};
                const a30Off = [
                  a30Qualities.balanced && "QUALITY.BALANCED",
                  a30Qualities.precise && "QUALITY.PRECISE",
                  a30Qualities.deepImpact && "QUALITY.DEEPIMPACT",
                  a30Qualities.massive && "QUALITY.MASSIVE",
                ]
                  .filter(Boolean)
                  .map((k) => game.i18n.localize(k));
                ecData.autoParams +=
                  game.i18n.localize("COMBAT.PARAMS_BASTARD_1H") +
                  (a30Off.length ? " (" + a30Off.join(", ") + " " + game.i18n.localize("COMBAT.PARAMS_BASTARD_INACTIVE") + ")" : "") +
                  ", ";
              }
              // persist the wield state (Ausbalanciert's defense bonus and the
              // next dialog's radio default follow through the actor
              // preparation); no write when unchanged
              const a30WeaponItem = actor.items.get(weapon.id);
              if (a30WeaponItem && a30WeaponItem.getFlag(game.system.id, "grip") !== a30Grip) {
                await a30WeaponItem.setFlag(game.system.id, "grip", a30Grip);
              }
            }
            for(let pack of weaponModifiers.package) {
              //add all modifiers from the default package
              if(pack.type == game.symbaroum.config.PACK_DEFAULT) {
                for(let member of pack.member) {
                  if(member.type == game.symbaroum.config.DAM_MOD) {
                    if(/\[[^\]]+\]/.test(member.alternatives[0].damageMod)) {
                      damModifier += `${member.alternatives[0].damageMod}`;
                    } else {
                      damModifier += `${member.alternatives[0].damageMod}[${member.label}]`;
                    }
                    damModifierNPC += member.alternatives[0].damageModNPC;
                    if(!member.alternatives[0].restrictions || !alternatives[0].restrictions.includes(game.symbaroum.config.DAM_1STATTACK)){
                      damModifierAttSup +=`${member.alternatives[0].damageMod}[${pack.label}]`;
                      damModifierAttSupNPC+=member.alternatives[0].damageModNPC;
                    }
                  }
                  else if(member.type == game.symbaroum.config.TYPE_ROLL_MOD) {
                    modifier += member.modifier;
                    ecData.modifier += member.modifier;
                    ecData.autoParams += ", "+member.label;
                  }
                  else if(ecOn && member.type == game.symbaroum.config.STATUS_DOT) {
                    let dotime = Object.assign({}, member);
                    ecData.damageOverTime.push(dotime)
                  }
                  else if(member.type == game.symbaroum.config.TYPE_FAVOUR) {
                    // game.symbaroum.log("member", member);
                    ecData.favour += member.favourMod;
                  }
                  else if(member.type == game.symbaroum.config.CORRUPTION_DAMAGE) {
                    ecData.corruptingattack = member.value;
                  }
                  else if(member.type == game.symbaroum.config.TYPE_ALTERNATIVE_DAMAGE) {
                    ecData.isAlternativeDamage = true;
                    ecData.alternativeDamageAttribute = member.AltDmgAttribute;
                  }
                }
              } else if(pack.type === game.symbaroum.config.PACK_CHECK) {
                // Automatisierungspaket 1: aktive Pakete sind beim Freien
                // Angriff unterdrückt (RAW: passive ja, aktive nein)
                if(hasFreeAttack) continue;
                // Find if the box is checked
                let ticked = html[0].querySelector(`#pgkid-${did}-${pack.id}`);              
                if( ticked?.checked ){
                  ecData.autoParams += ", "+pack.label;
                  for(let member of pack.member) {
                    if(member.type == game.symbaroum.config.DAM_MOD) {
                      if(/\[[^\]]+\]/.test(member.alternatives[0].damageMod)) {
                        damModifier += `${member.alternatives[0].damageMod}`;
                      } else {
                        damModifier += `${member.alternatives[0].damageMod}[${pack.label}]`;
                      }
                      damModifierNPC += member.alternatives[0].damageModNPC;
                      if(!member.alternatives[0].restrictions || !member.alternatives[0].restrictions.includes(game.symbaroum.config.DAM_1STATTACK)){
                        damModifierAttSup +=`${member.alternatives[0].damageMod}[${pack.label}]`;
                        damModifierAttSupNPC+=member.alternatives[0].damageModNPC;
                      }
                    }
                    else if(ecOn && member.type == game.symbaroum.config.STATUS_DOT) {
                      let dotime = Object.assign({}, member);
                      ecData.damageOverTime.push(dotime);
                    }
                    else if(ecOn && member.type == game.symbaroum.config.TYPE_FAVOUR) {
                      ecData.favour += member.favourMod;
                    }
                    else if(member.type == game.symbaroum.config.TYPE_ROLL_MOD) {
                      modifier += member.modifier;
                    }
                    else if(member.type == game.symbaroum.config.TYPE_ATTRIBUTE) {
                      let replacementAttribute = member.attribute;
                      if(actor.system.attributes[attributeName].total < actor.system.attributes[replacementAttribute].total)
                      {
                        attributeName = replacementAttribute;
                        ecData.castingAttributeName = replacementAttribute;
                      }
                    }
                  }
                }
              } else if( pack.type === game.symbaroum.config.PACK_RADIO) {
                if(pack.member[0].type === game.symbaroum.config.DAM_RADIO){
                  let radioSelection = html[0].querySelectorAll(`input[name='${pack.id}']`);
                  for( let f of radioSelection) {
                    if( f.checked ){
                      damModifier += `${f.value}[${pack.label}]`;
                      damModifierNPC += parseInt(f.value);
                    }
                  }
                  for(let altern of pack.member[0].alternatives){
                    if(altern.restrictions && altern.restrictions.includes(game.symbaroum.config.DAM_NOTACTIVE)){
                      damModifierAttSup +=`${altern.damageMod}[${pack.label}]`;
                      damModifierAttSupNPC+=altern.damageModNPC;
                    }
                  }
                }
              }
            }
          }

          let favours = html[0].querySelectorAll("input[name='favour']");
          let fvalue = 0;
          for ( let f of favours) {						
            if( f.checked ) fvalue = f.value;
          }
          attri_defaults.selectedFavour = ""+fvalue;			
          let favour = fvalue;
          ecData.favour += parseInt(fvalue);
          // Segen & Lasten S2.1 (P5+P9): Kontext-Zeilen auswerten (NACH dem
          // Gunst-Radio, VOR Zeichen-der-Pein). Bonus-Zeilen addieren auf den
          // Modifikator (Dialog-Feld + ecData, damit der nicht-
          // automatisierte rollAttribute-Fallback denselben Bonus bekommt)
          // UND wandern mit Name+Wert in die einheitliche Wurfzeile
          // (formatModifierChain — ihre Labels entfallen dafür in
          // autoParams). sc-Zeilen (Gunst/Missgunst) sind KEIN numerischer
          // Bestandteil der Kette: sie wirken als Vorauswahl des Radios
          // (P6, Radio = Autorität im Submit) und behalten ihr Label in
          // autoParams.
          const boonChecked = collectCheckedBoonLines(html, boon_lines);
          let boonModifierDelta = 0;
          ecData.boonLineChain = [];
          for (const line of boonChecked) {
            if (line.sc) {
              ecData.autoParams += line.label + ", ";
              continue;
            }
            ecData.boonLineChain.push({ boonName: line.boonName, bonus: line.bonus });
            boonModifierDelta += line.bonus;
          }
          if (boonModifierDelta !== 0) {
            modifier += boonModifierDelta;
            ecData.modifier += boonModifierDelta;
            attri_defaults.modifier = modifier;
          }
          // A33 (Rudolf's Adept redesign, 23.10.): Zeichen der Pein -
          // attackers against a marked victim automatically attack with
          // favour (the GRW "defense twice, worse counts" is
          // rule-equivalent to attacker favour - Rudolf's A31 decision).
          // Standard weapon attack path with enhanced combat only;
          // free-form macro rolls get nothing (documented limit). Favour
          // never stacks past one; an active disfavour is cancelled to
          // normal by the mark.
          if (
            weapon !== null &&
            ecOn &&
            ecData.targetData?.hasTarget &&
            game.symbaroum.config.markOfTormentFavour(ecData.targetData.actor)
          ) {
            if (ecData.favour < 1) {
              ecData.favour = ecData.favour < 0 ? 0 : 1;
              ecData.autoParams += game.i18n.localize("COMBAT.PARAMS_MARK_OF_TORMENT") + ", ";
            }
          }

          if(askImpeding){
            if(html[0].querySelector("#impeding-"+did).checked){
              modifier = modifier - actor.system.combat.impeding;
              ecData.modifier += -ecData.impeding;
              ecData.autoParams += game.i18n.localize("ARMOR.IMPEDINGLONG") + ", ";
            }            
            attri_defaults.impeding = html[0].querySelector("#impeding-"+did).checked ? "checked":"";
          }
          if(askIgnoreArmor){
            ignoreArm = html[0].querySelector("#ignarm-"+did).checked;
            ecData.ignoreArm = ignoreArm;
            if(ignoreArm) ecData.autoParams += game.i18n.localize('COMBAT.CHAT_DMG_PARAMS_IGN_ARMOR') + ", ";
          }
          if(askAttackNb){
            let radioSelection = html[0].querySelectorAll(`input[name='attNbRadio']`);
            for( let f of radioSelection) {
              if( f.checked ){
                ecData.numberofAttacks = parseInt(f.value);
              }
            }
          }
          // Elixiere v1.7: die alte Grad-Zeile "Gift aufgetragen?" ist
          // ENTFALLEN - ecData.poison wird nur noch ueber die vereinheit-
          // lichte Waffengift-Zeile gesetzt (Eigengift siehe unten).
          if(askCorruptedTarget){
            ecData.targetFullyCorrupted = html[0].querySelector("#targetCorrupt-"+did).checked;
          }
          // Axtkünstler v1.1: Technik-Radio aus dem Würfeldialog lesen und
          // als Marker ins functionStuff schreiben - die Ausführungskette
          // (pur 1W6, Betäubungs-Probe, Freier Angriff, Doppelschlag,
          // Meister-Bonus) läuft komplett automatisch in attackResult
          if(askAxeArtist){
            let axeArtistTechnique = "simple";
            let axeArtistRadioSelection = html[0].querySelectorAll("input[name='axeArtistTechnique']");
            for( let f of axeArtistRadioSelection) {
              if( f.checked ){
                axeArtistTechnique = f.value;
              }
            }
            if(axeArtistTechnique === "shortend"){
              ecData.axeArtistNovice = true;
              ecData.autoParams += game.i18n.localize('DIALOG.AXEARTIST_SHORTEND') + ", ";
            } else if(axeArtistTechnique === "double"){
              ecData.axeArtistDouble = true;
              ecData.autoParams += game.i18n.localize('DIALOG.AXEARTIST_DOUBLE') + ", ";
            }
          }
          // Dreckiger Kampf v1 (Novize): Fiese-Schläge-Angriff — Radio
          // aus dem Würfeldialog lesen, Marker ins functionStuff
          // (ecData); die Kette (pur 1W6, Freier Angriff bei Schaden)
          // läuft automatisch in attackResult
          if(askCheapshot){
            let cheapshotTechnique = "simple";
            let cheapshotRadioSelection = html[0].querySelectorAll("input[name='cheapshotTechnique']");
            for( let f of cheapshotRadioSelection) {
              if( f.checked ){
                cheapshotTechnique = f.value;
              }
            }
            if(cheapshotTechnique === "strike"){
              ecData.cheapshotNovice = true;
              ecData.autoParams += game.i18n.localize('DIALOG.CHEAPSHOT_STRIKE') + ", ";
            }
          }
          // Munitionsverbrauch v1 (Rudolfs Freigabe 31.10.): Abbuchung beim
          // Wurf-Submit, UNABHAENIG vom Wurfergebnis (Medicus-Muster) -
          // Menge je Angriff × Angriffsanzahl, AP2-Stapelreihenfolge
          // (ammo.js). Deckt BEIDE Pfade (combatAutomation an/aus), weil
          // der Einsatz VOR der Verzweigung steht. Rueckgabe false =
          // BLOCKIERT (Bestand reicht fuer die gewaehlte Angriffsanzahl
          // nicht): KEIN Wurf, resolve(false) - die Notification kam aus
          // dem ammo-Modul. Rueckgabe null = nichts gebucht (Setting aus /
          // keine Kategorie), String = Label fuer autoParams.
          if(weapon !== null) {
            const ammoLabel = await consumeAmmoForAttack(actor, weapon, ecData.numberofAttacks ?? 1, ecData);
            if(ammoLabel === false) {
              resolve(false);
              return;
            }
            if(ammoLabel) ecData.autoParams += ammoLabel + ", ";
          }
          // Elixiere v1.4: Spezialmunition-Opt-in (Betaeubungspfeil/Treffpfeil)
          // - Radio aus dem Wuerfeldialog lesen, Abbuchung NACH dem Kategorie-
          // Pfad, damit die explizite Wahl einen eventuellen Mischbestands-
          // Stash ueberschreibt (Opt-in gewinnt). Wie oben: false = BLOCKIERT
          // (kein Wurf, Notification kam aus dem ammo-Modul), String = Label
          // fuer autoParams. Nicht Setting-gebunden: das Opt-in ist die
          // explizite Spieler-Entscheidung; 1 Stueck je Angriff.
          if(askAmmoEffect) {
            let ammoEffectChoice = "none";
            let ammoEffectRadioSelection = html[0].querySelectorAll("input[name='ammoEffectChoice']");
            for( let f of ammoEffectRadioSelection) {
              if( f.checked ){
                ammoEffectChoice = f.value;
              }
            }
            if(ammoEffectChoice !== "none") {
              const specialAmmoLabel = await consumeAmmoEffectForAttack(actor, ammoEffectChoice, ecData.numberofAttacks ?? 1, ecData);
              if(specialAmmoLabel === false) {
                resolve(false);
                return;
              }
              if(specialAmmoLabel) ecData.autoParams += specialAmmoLabel + ", ";
            }
          }
          // Elixiere v1.5 (Gift auftragen): Beschichtungs-Select lesen.
          // Elixiere v1.7 (Waffengift-Dialog-Vereinheitlichung): dies ist
          // DIE Gift-Zeile des Waffen-Dialogs.
          // Gift v1 (08.11.2026): Aufloesung ueber den gemeinsamen Helper
          // resolveWeaponPoisonChoice (gleiche Semantik wie im Modifier-
          // Dialog, item.js): 'ownpoison' = Eigengift (B4: nur noch
          // Merkmal Giftig, Vergifter-Pfad), 'activecoat' = laufende
          // Adept-Beschichtung (kein Verbrauch, Vergifter-Pfad),
          // 'coatscene' = Inventar-Dosis startet die Szenen-Beschichtung
          // (1 Dosis beim Submit; null-Rueckgabe = Abbuchung gescheitert,
          // kein Wurf), 'dosecoat' = anhaltende Beschichtung bleibt
          // (reine Anzeige), Inventar-Dosis = ANHALTENDE Beschichtung
          // (Gift v1.1, P4: Dosis bleibt auf der Klinge, bis eine
          // Vergiftung gelingt - auch Treffer in spaeteren Runden tragen
          // es; Abbuchung erst bei gelungener Vergiftung), 'none' =
          // kein Gift UND Abwischen der anhaltenden Beschichtung.
          // Gift v1.2 (P9, Rudolfs Freigabe): 'none' wischt BEIDE Be-
          // schichtungen DAUERHAFT (anhaltende Dosis + aktive Szenen-
          // Beschichtung, wipeWeaponPoisonCoats) - Re-Vergiftung nur
          // mit neuer Dosis.
          // Gift v1.1 (P6): Die Meister-Aufwertung wirkt zentral in
          // attackResult (Gift +1 Stufe bzw. Gunst NUR auf die Gift-
          // probe), nicht mehr hier im Submit.
          if(askPoisonCoating) {
            const coatingChoice = html[0].querySelector("#poisonCoating-"+did)?.value ?? "none";
            ecData.poisonChoice = coatingChoice;
            if(coatingChoice === "none") await wipeWeaponPoisonCoats(actor);
            const resolved = await resolveWeaponPoisonChoice(actor, coatingChoice, { ownPoison, poisonCoatingChoices });
            if(!resolved) {
              resolve(false);
              return;
            }
            if(resolved.kind === "ownpoison" || resolved.kind === "activecoat" || resolved.kind === "coatscene") {
              ecData.poison = resolved.poison;
              if(resolved.kind !== "ownpoison") {
                ecData.poisonChosen = resolved.poison;
                ecData.poisonFromCoat = resolved.kind === "activecoat";
              }
              ecData.autoParams +=
                (resolved.kind === "ownpoison" ? game.i18n.localize("DIALOG.OWN_POISON_PARAM") : game.i18n.localize("DIALOG.POISON_COAT_PARAM")) + ", ";
            } else if(resolved.kind === "dose") {
              await setPendingWeaponCoat(actor, resolved.poisonCoating);
              ecData.autoParams += game.i18n.format("DIALOG.POISON_COATING_PARAM", { name: resolved.poisonCoating.name }) + ", ";
            } else if(resolved.kind === "dosecoat" && resolved.poisonCoating) {
              ecData.autoParams += game.i18n.format("DIALOG.POISON_COATING_PARAM", { name: resolved.poisonCoating.name }) + ", ";
            }
          }
          if(weapon && game.settings.get('symbaroum', 'combatAutomation')){
            attackFromPC = actor.type !== "monster" || ecData.targetData.actor.type === "monster";
            if(damModifier.length > 0) {
                ecData.dmgModifier = damModifier;
                ecData.dmgModifierNPC = damModifierNPC;
                ecData.dmgModifierAttackSupp= damModifierAttSup;
                ecData.dmgModifierAttackSuppNPC= damModifierAttSupNPC;
            }
            ecData.notResisted = ecData.notResisted ?? (((ecData.casting === game.symbaroum.config.CASTING_RES) && !ecData.isMaintained ) || ((ecData.maintain === game.symbaroum.config.MAINTAIN_RES) && ecData.isMaintained));
            if(hasTarget && !ecData.notResisted){
              if(ecData.attackFromPC || ecData.targetData.actor.type === "monster"){
                  ecData.resistRoll = false;
                  buildRolls(ecData).then(val => resolve(val));
              } else {
                ecData.resistRoll = true;
                ecData.resistRollText = (weapon !== null) ? ecData.targetData.name+game.i18n.localize('COMBAT.DEFENSE_ROLL') : ecData.targetData.name+game.i18n.localize('ABILITY.RESIST_ROLL');
                let userArray = await getOwnerPlayer(ecData.targetData.actor);
                if(userArray.length>0 && game.settings.get('symbaroum', 'playerResistButton')){
                    ecData.targetUserId=userArray[0].id;
                    ecData.targetUserName=userArray[0].name;
                    createResistRollChatButton(ecData).then(val => resolve(val));
                }
                else{
                    buildRolls(ecData).then(val => resolve(val));
                }
              }
            }
            else{
                buildRolls(ecData).then((val)=>resolve(val))
            }
          } else {
            // S2.1 (P5+P9): chainData für die einheitliche Wurfzeile mit-
            // geben (freier Modifikator RAW + Segen-Zeilen; roll.js baut
            // daraus „+ 1 (Modifikator) + 1 (Archivar)").
            game.symbaroum.api.rollAttribute(actor, attributeName, getTarget(), targetAttributeName, favour, modifier, armor, weapon, advantage, damModifier, { freeModifier: ecData.freeModifier ?? 0, boonLineChain: ecData.boonLineChain ?? [] }).then((roll) => {resolve(roll)});
          }
        },
      },
      cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('BUTTON.CANCEL'),
          callback: () => {reject("Cancelled")},
      },
    },
    default: 'roll',
  });

  if (weapon !== null) {
    // A30 + Automatisierungspaket 1: gemeinsame Nach-Render-Verdrahtung.
    // symbDialog already kicked off the render; re-awaiting it here attaches
    // the listeners afterwards without a visible re-render (a second
    // render({force:true}) elsewhere would otherwise orphan these listeners).
    // A30: live-update of the damage formula field when the grip radio
    // changes (kept exactly as before).
    // Auto1: Freier-Angriff-Toggle - Fenstertitel-Suffix und das Ausblenden
    // der aktiven Paket-Checkboxen folgen live dem Häkchen (die Callback-
    // seitige Auswertung in 'roll' ist autoritativ, das hier ist Anzeige).
    try {
      Promise.resolve(dialog.render({ force: true })).then(
        () => {
          const postRoot = dialog.element;
          if (!postRoot) return;
          // Segen & Lasten S2: Der A30-Block erzwingt hier einen ZWEITEN
          // render()-Durchlauf — Listener, die symbDialogs onRender beim
          // ERSTEN Render gesetzt hat, könnten am ausgetauschten DOM
          // verwaist sein. Die Exklusivitäts-Verdrahtung der Kontext-
          // Zeilen wird deshalb hier NOCHMAL gesetzt; ihre Logik ist
          // idempotent (abwählen anderer sc-Zeilen, Radio setzen), ein
          // eventuell doppelt laufender Listener bleibt folgenlos.
          activateBoonLineExclusive(postRoot);
          if (askBastardGrip) {
            const a30DmgInput = postRoot.querySelector(`#weapondamage-${did}`);
            // Ressourcen v1.4 (A30-Live): Die einhändig unterdrueckten
            // Qualitaets-Zeilen (.a30-grip-suppress, siehe Template-Kontext-
            // Markierung oben) blenden live mit dem Griff-Radio ein und aus;
            // der Initial-Aufruf mit defaultGrip blendet sie bei gemerktem
            // Einhaendig-Zustand sofort aus, ohne das Radio anzufassen.
            const a30Rows = postRoot.querySelectorAll(".a30-grip-suppress");
            const a30Apply = (grip) => {
              if (a30DmgInput) a30DmgInput.value = grip === "one" ? weaponDamage1H : weaponDamage2H;
              for (const a30Row of a30Rows) a30Row.style.display = grip === "one" ? "none" : "";
            };
            for (let r of postRoot.querySelectorAll("input[name='bripType']")) {
              r.addEventListener("change", (ev) => a30Apply(ev.target.value));
            }
            a30Apply(defaultGrip);
          }
          const faBox = postRoot.querySelector(`#freeattack-${did}`);
          if (faBox) {
            const faTitle = postRoot.querySelector(".window-title");
            const faSuppress = postRoot.querySelectorAll(".freeattack-suppress");
            // v1.1 (Rudolfs Testrunde): Bei aktivem Freiem Angriff zeigt der
            // Fenstertitel die Eigenschaft Praezision statt der urspruenglichen
            // Eigenschaft (der Titel IST im Attributsdialog die Eigenschaft).
            const faPreciseLabel = game.symbaroum.api.getAttributeLabel(actor, "accurate");
            const faApply = () => {
              const faOn = faBox.checked;
              if (faTitle) faTitle.textContent = (faOn ? faPreciseLabel : baseDialogTitle) + (faOn ? " — " + game.i18n.localize("CHAT.CRITICAL_FREEATTACK") : "");
              for (const faRow of faSuppress) {
                faRow.style.display = faOn ? "none" : "";
              }
            };
            faBox.addEventListener("change", faApply);
          }
        },
        () => {}
      );
    } catch (err) {
      game.symbaroum.log("A30/Auto1: grip/free-attack live display unavailable");
    }
  }

  })
}

function getRollDefaults(attributeName, isArmor, isWeapon, ecData) {
  if( !game.settings.get('symbaroum', 'saveCombatRoll')) {
    if(isArmor || isWeapon) {
      return createDefaults(ecData);
    }
  }
  if( !game.settings.get('symbaroum', 'saveAttributeRoll')) {
    if(!isArmor && !isWeapon) {
      return createDefaults(ecData);
    }
  }
  if( roll_defaults[attributeName+":"+isArmor+":"+isWeapon] === undefined )
	{
		roll_defaults[attributeName+":"+isArmor+":"+isWeapon] = createDefaults(ecData);
	}
	return roll_defaults[attributeName+":"+isArmor+":"+isWeapon];
}

function createDefaults(ecData={}) {
  let defaultValues = {
		targetAttributeName: "custom",
		additionalModifier: "",
		selectedFavour: "0",
		modifier: "0",
    advantage: "",
    impeding: "",
    ignoreArmor: false,
    ecData: ecData
	};
  return(defaultValues)
}

function getVersusModifiers(targetTokens) {
  if( targetTokens.length === 0) {
    return null;
  }
  return {
    show: game.settings.get('symbaroum', 'showModifiersInDialogue'),
    custom:0,
    defense: (10 - targetTokens[0].actor.system?.combat.defense),
    accurate: (10 - targetTokens[0].actor.system?.attributes.accurate.total),
    cunning: (10 - targetTokens[0].actor.system?.attributes.cunning.total),
    discreet: (10 - targetTokens[0].actor.system?.attributes.discreet.total),
    persuasive: (10 - targetTokens[0].actor.system?.attributes.persuasive.total),
    quick: (10 - targetTokens[0].actor.system?.attributes.quick.total),
    resolute: (10 - targetTokens[0].actor.system?.attributes.resolute.total),
    strong: (10 - targetTokens[0].actor.system?.attributes.strong.total),
    vigilant: (10 - targetTokens[0].actor.system?.attributes.vigilant.total),
  };
}

export function createLineDisplay(weaponModifiers, attackFromPC) 
{
  game.symbaroum.log("...createLineDisplay", ...arguments);

  if(weaponModifiers.maxAttackNb > 1){
    let radioAttacks = {};
    for(let j = 1; j <= weaponModifiers.maxAttackNb; j++){
      radioAttacks[j] = j.toString()+"x"+game.i18n.localize("DIALOG.ATTACK");
    }
    weaponModifiers.radioAttacks = radioAttacks;
  }
  for(let i = 0; i < weaponModifiers.package.length; i++) 
  {
    let pack = weaponModifiers.package[i];
    if(pack.member.length !=0) {

      pack.member.forEach(member => {
        if(member.type == game.symbaroum.config.DAM_MOD) {
          for(let j = 0; j < member.alternatives.length; j++) 
          { // dispay NPC values for EC, and also reformat the "+1d1[something]" to just "+1"
            member.value = attackFromPC ? member.alternatives[j].damageMod.replace(/d1$/,'') : member.alternatives[j].damageModNPC;
          }
        }
        else if(member.type == game.symbaroum.config.STATUS_DOT) {
          let damageV= attackFromPC ? member.damagePerRound.replace(/d1$/,'') : member.damagePerRoundNPC.toString();
          member.value += ` (${damageV})`;
        }
        else if(member.type == game.symbaroum.config.CORRUPTION_DAMAGE) {
          if(!attackFromPC) {
            member.value = member.damageNPC.toString();
          }
        } else if(member.type == game.symbaroum.config.TYPE_ATTRIBUTE) {
          member.value = `${game.i18n.localize(game.symbaroum.config.attributeLabels[member.attribute])}`;
        }
      });
      if(pack.type === game.symbaroum.config.PACK_CHECK)
      {
        if(pack.value === undefined) pack.value = "";
        pack.member.forEach((member, index) => {
          if(index!=0) pack.value += ", ";
          pack.value += member.value;
        })
      }
      if(pack.type === game.symbaroum.config.PACK_RADIO) 
      {
        let member= pack.member[0];
        if(member.type === game.symbaroum.config.DAM_RADIO){
          let radioAlternatives = {};
          // Axtkünstler-Testrunde 1 (Rudolf, 29.10.): Der moderne Dialog
          // zeigt den Fähigkeits-Namen als Rahmen-Label - die Radios dort
          // tragen nur noch den Effekt (z. B. "+1d8")
          let radioAlternativesShort = {};
          for(let j = 0; j < member.alternatives.length; j++)
          {
            if(attackFromPC){
              radioAlternatives[`${member.alternatives[j].damageMod}`] = `${member.alternatives[j].label} ${member.alternatives[j].damageMod}`;
              radioAlternativesShort[`${member.alternatives[j].damageMod}`] = `${member.alternatives[j].damageMod}`;
            } else {
              radioAlternatives[`${member.alternatives[j].damageModNPC}`] = `${member.alternatives[j].label} ${member.alternatives[j].damageModNPC}`;
              radioAlternativesShort[`${member.alternatives[j].damageModNPC}`] = `${member.alternatives[j].damageModNPC}`;
            }
          }
          pack.radioAlternatives = radioAlternatives;
          pack.radioAlternativesShort = radioAlternativesShort;
          if(pack.defaultSelect === undefined || pack.defaultSelect === null) {
            if(attackFromPC) {
              pack.defaultSelect = `${member.alternatives[0].damageMod}`;
            } else {
              pack.defaultSelect = `${member.alternatives[0].damageModNPC}`;
            }
          }
        }
      }
    }
  }
}

function getTarget() {
  const target = game.user.targets.values().next().value;
  if (target === undefined) {
    return null;
  } else {
    return target.actor;
  }
}