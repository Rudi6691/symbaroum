/**
 * Suite 4: B2 v2 „Rüstungs-Cross“ (MM2, Konzept Runde 4 §3.7/R4-8/R4-9,
 * TDD-rot geschrieben). Erweitert die v1-Suite um die v2-Entscheidungen
 * der Testrunde 27./28.11. (Rudolf):
 *
 *  - Reines Merkmals-Zeilen-Modell: Zeilen entstehen NUR aus gepflegtem
 *    Grund-Schutz (Signatur); Bonus-only (Robust) ist reiner Verteiler
 *    ohne eigene Zeile (kein sichtbarer NoArmor-Ersatz für Bonus-Items).
 *  - Zeilen-Name/Icon: system.crossArmorName/crossArmorIcon überschreiben
 *    die Anzeige (leer = Merkmalsname/-bild, ?? ''-Guards für Altdaten);
 *    Zeilen tragen isCrossArmor-Marker (Ausrüstungs-Tab-Filter).
 *  - crossArmorStackable (Default aus): gepflegter Grund-Schutz wirkt
 *    zusätzlich als feste Schutz-Alternative auf alle anderen nicht-
 *    stapelbaren Zeilen (Semantik-Anker Schutzrunen, item.js L. 1739),
 *    NSC = halbierter maximierter Wurf.
 *  - crossFlag-Preset (AGENTS.md §6 KANONIK VOR RADIO): gespeichertes
 *    'none' (template-Default seit Commit A) darf die Kanonik-Vorbelegung
 *    NICHT schlagen - Anzeige-Lüge-Befund der v1-Testrunde, Punkt 2.
 *
 * B2 v2.1 (Testrunde 28.11., Punkte 4a/5/7a/10, Rudolf-freigegeben):
 *  - STUFENAUTOMATISCHE SIGNATUR (4a): Gepanzert (Kanonik) liefert ohne
 *    gepflegtes Grund-Schutz-Feld automatisch 1d4/1d6/1d8 nach Stufe
 *    (Progression aus dem Bestandsautomaten DiceUpgrade 4+2*(lvl-1)
 *    abgeleitet); gepflegtes Feld = SL-Override gewinnt.
 *  - ROBUST-OVERRIDE (7a): gepflegtes Bonus-Feld ersetzt den Automat-
 *    SCHUTZbeitrag dieses Merkmals (keine Doppelung); Verteidigungs- und
 *    Nahkampf-Waffenbeitrag des Automaten bleiben; leer = Automat läuft.
 *  - CHECKBOX-DEFENSIV (5): crossArmorStackable kann aus Foundry-Submits
 *    ohne data-dtype="Boolean" als STRING "true" ankommen - der Verteiler
 *    wertet "true" wie true (Altdaten-Rettung), alles andere wie aus.
 *  - repoPath statt new URL(..., import.meta.url) (10): der vitest-Modul-
 *    Runner trägt KEIN file:-Schema in import.meta.url („The URL must be
 *    of scheme file", Rudolfs npm test + CI rot) - der Bestand löst das
 *    über tests/helpers/repo-paths.mjs, die Suite folgt dem Muster.
 *
 * Enthalten: Eintrittspunkt _getArmors (Kanonik/crossFlag, Gelernt-Gate,
 * Wert-Gate base-only, Rezeptur-Gate, kein Typ-Flip), Signatur-Zeile
 * (Würfelseiten, impeding-Guard, Name/Icon-Override, Marker), RS-Bonus
 * (Verteiler scannt actor.items), Stapelbar-Verteilung (Schutzrunen-
 * Muster), Primär-Kandidat, Preset-Auflösung crossFlags.js, Datenbasis
 * (template.json-Addition, i18n de+en-Parität der neuen Keys).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { repoPath } from "../helpers/repo-paths.mjs";
import { SYMBAROUM } from "../../script/common/config.js";
import { SymbaroumActor } from "../../script/common/actor.js";
import { SymbaroumItem } from "../../script/common/item.js";

/* Mock-Lücken des Foundry-Layers, die erst diese Suite berührt (setup.mjs
   deckt i18n/settings/Hooks; die folgenden Bindungen sind jsdom-neutral und
   dokumentieren die Erweiterung des Mock-Layers für tiefe Modulketten): */
game.symbaroum.config = SYMBAROUM;
game.symbaroum.htmlEscape = game.symbaroum.htmlEscape ?? ((text) => String(text));
game.symbaroum.error = game.symbaroum.error ?? (() => {});
game.model = game.model ?? { Item: { armor: {} } };
foundry.utils.deepClone = foundry.utils.deepClone ?? ((data) => JSON.parse(JSON.stringify(data)));
globalThis.Roll = globalThis.Roll ?? class StubRoll {
	constructor(formula) { this.formula = String(formula); }
	/* Maximize-Semantik (evaluateSync({maximize:true})): NdM -> count*sides,
	   Flats addieren - NSC-Konvertierung halbiert diesen Wert. */
	evaluateSync() {
		let total = 0;
		let rest = this.formula;
		const diceRe = /(-?)(\d*)d(\d+)/g;
		let m;
		while ((m = diceRe.exec(this.formula))) {
			const sign = m[1] === "-" ? -1 : 1;
			const count = m[2] === "" ? 1 : parseInt(m[2], 10);
			total += sign * count * parseInt(m[3], 10);
			rest = rest.replace(m[0], "0");
		}
		for (const f of rest.match(/[+-]?\d+(\.\d+)?/g) ?? []) total += Number(f);
		return { total };
	}
};

/* B2 v2 Preset-Auflösung (script/common/crossFlags.js). Dynamischer Import
   mit Fallback: im TDD-rot-Zustand fehlt das Modul, die Preset-Tests
   dokumentieren dann den erwarteten Vertrag. */
let resolveCrossFlagDisplay = null;
try {
	({ resolveCrossFlagDisplay } = await import("../../script/common/crossFlags.js"));
} catch {
	/* TDD-rot: Modul fehlt noch */
}

/* -------------------------------------------- */
/*  Fixtures                                     */ 
/* -------------------------------------------- */

function makeProtoActor(items, system = {}) {
	const actor = Object.create(SymbaroumActor.prototype);
	actor.items = items;
	actor.system = {
		isPlayer: true,
		attributes: { quick: { total: 10 }, persuasive: { total: 8 }, resolute: { total: 9 } },
		bonus: { defense: 0 },
		...system,
	};
	return actor;
}

function makeTrait({
	id,
	name,
	reference,
	level = 1,
	crossFlag = "none",
	baseProtection = "",
	bonusProtection = "",
	type = "trait",
	hasLevels = true,
	crossArmorName = "",
	crossArmorIcon = "",
	crossArmorStackable = false,
	crossWeaponName = "",
	crossWeaponIcon = "",
	img,
}) {
	return {
		id,
		name,
		type,
		img: img ?? `systems/symbaroum/assets/traits/${id}.webp`,
		system: {
			reference,
			crossFlag,
			baseProtection,
			bonusProtection,
			crossArmorName,
			crossArmorIcon,
			crossArmorStackable,
			crossWeaponName,
			crossWeaponIcon,
			hasLevels,
			isArmor: false,
			qualities: {},
			bonus: {},
		},
		getLevel: () => ({ level }),
	};
}

function makeArmor({ id, name = "Lederrüstung", isActive = true, baseProtection = "1d6", bonusProtection = "" }) {
	return {
		id,
		name,
		type: "armor",
		img: "systems/symbaroum/assets/armor/lederruestung.webp",
		system: { isArmor: true, isActive, isStackableArmor: false, isSkin: false, baseProtection, bonusProtection, qualities: {}, bonus: {} },
		impeding: 0,
		getLevel: () => ({ level: 0 }),
	};
}

function makeCombatMods(ids) {
	const armors = {};
	for (const id of ids) {
		armors[id] = { specialEffects: [], attributes: [], defenseModifiers: [], impedingModifiers: [], damageReductions: [], protectionChoices: [], PowerResistances: [] };
	}
	return { armors, abilities: {}, weapons: {}, toughness: {}, corruption: {} };
}

/* -------------------------------------------- */
/*  1. Eintrittspunkt: _getArmors-Cross-Pfad    */
/* -------------------------------------------- */

describe("B2 Eintrittspunkt _getArmors", () => {
	beforeEach(() => {
		/* Kreuztabellen-Isolation: jede Zeile eigene Actor-Instanz. */
	});

	it("crossFlag='armor' mit gepflegter Signatur landet in der Rüstungsliste", () => {
		const gepanzert = makeTrait({ id: "t1", name: "Gepanzert", reference: "armored", level: 2, crossFlag: "armor", baseProtection: "1d8" });
		const actor = makeProtoActor([gepanzert]);
		const armors = actor._getArmors();
		expect(armors.map((a) => a.id)).toContain("t1");
	});

	it("Kanonik robust OHNE crossFlag (Radio nie submittet): Bonus-only erzeugt KEINE Zeile mehr (v2)", () => {
		const robust = makeTrait({ id: "r1", name: "Robust", reference: "robust", level: 1, crossFlag: "none", bonusProtection: "+2" });
		const actor = makeProtoActor([robust]);
		expect(actor._getArmors().some((a) => a.id === "r1")).toBe(false);
	});

	it("Wert-Gate v2: Custom-Item (keine Kanonik-Werte) ohne gepflegtes Grund-Schutz-Feld => keine Zeile (bonus-only bleibt draußen)", () => {
		const sonder = makeTrait({ id: "t2", name: "Steinhaut", reference: "customskin", level: 3, crossFlag: "armor", baseProtection: "", bonusProtection: "+2" });
		const actor = makeProtoActor([sonder]);
		expect(actor._getArmors().some((a) => a.id === "t2")).toBe(false);
	});

	it("Wert-Gate: Custom-Item mit beiden Pflege-Feldern leer => keine Zeile (Bestandswelt-Schutz)", () => {
		const sonder = makeTrait({ id: "t3", name: "Steinhaut", reference: "customskin", level: 3, crossFlag: "armor" });
		const actor = makeProtoActor([sonder]);
		expect(actor._getArmors().some((a) => a.id === "t3")).toBe(false);
	});

	it("Gelernt-Gate: gestuftes Merkmal ohne aktive Stufe (Novize 0) bleibt draußen", () => {
		const robust = makeTrait({ id: "r2", name: "Robust", reference: "robust", level: 0, bonusProtection: "+2" });
		const actor = makeProtoActor([robust]);
		expect(actor._getArmors().some((a) => a.id === "r2")).toBe(false);
	});

	it("Typ-Gate: Rezeptur mit crossFlag='armor' bleibt ausgeschlossen (R4-11-Präzedenz)", () => {
		const elixier = makeTrait({ id: "e1", name: "Hautbalsam", reference: "", type: "rezeptur", crossFlag: "armor", baseProtection: "1d4", hasLevels: false });
		const actor = makeProtoActor([elixier]);
		expect(actor._getArmors().some((a) => a.id === "e1")).toBe(false);
	});

	it("Kein Typ-Flip: Cross-Item bleibt trait, system.isArmor wird NICHT gesetzt", () => {
		const gepanzert = makeTrait({ id: "t4", name: "Gepanzert", reference: "armored", level: 1, crossFlag: "armor", baseProtection: "1d6" });
		const actor = makeProtoActor([gepanzert]);
		actor._getArmors();
		expect(gepanzert.type).toBe("trait");
		expect(gepanzert.system.isArmor).toBe(false);
	});

	it("Echte Rüstungen laufen unverändert durch (isArmor-Filter unberührt)", () => {
		const leder = makeArmor({ id: "w1" });
		const actor = makeProtoActor([leder]);
		const armors = actor._getArmors();
		expect(armors).toHaveLength(1);
		expect(armors[0].id).toBe("w1");
	});
});

/* --------------------------------------------------- */
/*  2. Abdeckung: Signatur-Zeile (Gepanzert)            */
/* --------------------------------------------------- */

describe("B2 Abdeckung: Signatur-Zeile", () => {
	it("Signatur-Zeile baut Würfelseiten und Anzeige-Text aus dem Grund-Schutz-Feld", () => {
		const gepanzert = makeTrait({ id: "t1", name: "Gepanzert", reference: "armored", level: 2, crossFlag: "armor", baseProtection: "1d8" });
		const actor = makeProtoActor([]);
		const rows = actor._evaluateArmors([gepanzert], makeCombatMods(["t1"]));
		expect(rows).toHaveLength(1);
		expect(rows[0].name).toBe("Gepanzert");
		expect(rows[0].protectionPc).toContain("1d8");
		expect(rows[0].base).toBe("1d8");
	});

	it("crossArmorName/crossArmorIcon überschreiben Zeilenname und Icon (v2)", () => {
		const chitin = makeTrait({
			id: "c1", name: "Natürliche Panzerung", reference: "armored", level: 1, crossFlag: "armor",
			baseProtection: "1d6", crossArmorName: "Chitinpanzer", crossArmorIcon: "icons/commodities/bones/chitin-blue.webp",
		});
		const actor = makeProtoActor([]);
		const rows = actor._evaluateArmors([chitin], makeCombatMods(["c1"]));
		expect(rows[0].name).toBe("Chitinpanzer");
		expect(rows[0].img).toBe("icons/commodities/bones/chitin-blue.webp");
	});

	it("Leere Override-Felder: Fallback auf Merkmalsname und Merkmalsbild (?? ''-Guards, Altdaten)", () => {
		const gepanzert = makeTrait({ id: "t2", name: "Gepanzert", reference: "armored", level: 1, crossFlag: "armor", baseProtection: "1d10" });
		delete gepanzert.system.crossArmorName; // Altdaten: Feld noch nicht materialisiert
		delete gepanzert.system.crossArmorIcon;
		const actor = makeProtoActor([]);
		const rows = actor._evaluateArmors([gepanzert], makeCombatMods(["t2"]));
		expect(rows[0].name).toBe("Gepanzert");
		expect(rows[0].img).toBe("systems/symbaroum/assets/traits/t2.webp");
	});

	it("isCrossArmor-Marker: Cross-Zeile true, echte Rüstung false (Ausrüstungs-Tab-Filter-Basis)", () => {
		const chitin = makeTrait({ id: "c1", name: "Chitinpanzer", reference: "armored", level: 1, crossFlag: "armor", baseProtection: "1d6" });
		const leder = makeArmor({ id: "w1" });
		const actor = makeProtoActor([]);
		const rows = actor._evaluateArmors([chitin, leder], makeCombatMods(["c1", "w1"]));
		expect(rows.find((r) => r.id === "c1").isCrossArmor).toBe(true);
		expect(rows.find((r) => r.id === "w1").isCrossArmor).toBe(false);
	});

	it("impeding-Guard: Cross-Zeile hat Behinderung 0 und keinen NaN-Verteidigungswert", () => {
		const gepanzert = makeTrait({ id: "t3", name: "Gepanzert", reference: "armored", level: 1, crossFlag: "armor", baseProtection: "1d10" });
		const actor = makeProtoActor([]);
		const rows = actor._evaluateArmors([gepanzert], makeCombatMods(["t3"]));
		expect(rows[0].impeding).toBe(0);
		expect(rows[0].impedingMov).toBe(0);
		expect(rows[0].impedingMagic).toBe(0);
	});

	it("Bonus-Schutz auf der EIGENEN Signatur-Zeile (plus Darstellung im Schutztext)", () => {
		const gepanzert = makeTrait({ id: "t4", name: "Gepanzert", reference: "armored", level: 2, crossFlag: "armor", baseProtection: "1d6", bonusProtection: "+1" });
		const actor = makeProtoActor([gepanzert]);
		const combatMods = makeCombatMods(["t4"]);
		actor._applyCrossArmorBonuses(combatMods, [gepanzert]);
		const rows = actor._evaluateArmors([gepanzert], combatMods);
		expect(rows[0].protectionPc).toContain("1d6");
		expect(rows[0].protectionPc).toContain("+1");
	});

	it("Bonus-Modus OHNE Signatur: kein Würfelseiten-Parse, kein 1d4-Fallback auf der Cross-Zeile", () => {
		/* v2: bonus-only erzeugt keine Zeile mehr - der Guard bleibt als
		   Bestandsschutz für den Fall, dass SL dennoch eine Zeile baut
		   (z. B. gepflegter Grund-Schutz ohne NdM-Muster). */
		const sonder = makeTrait({ id: "s1", name: "Steinhaut", reference: "customskin", level: 1, crossFlag: "armor", baseProtection: "2" });
		const actor = makeProtoActor([]);
		const rows = actor._evaluateArmors([sonder], makeCombatMods(["s1"]));
		expect(rows[0].protectionPc.includes("1d4")).toBe(false);
		expect(rows[0].protectionPc.includes("1d0")).toBe(false);
	});
});

/* --------------------------------------------------- */
/*  3. RS-Bonus (Robust): Verteiler scannt actor.items  */
/* --------------------------------------------------- */

describe("B2 RS-Bonus (Robust)", () => {
	it("Bonus-Schutz ohne Signatur wandert auf die getragene Rüstungszeile (Kandidat aus actor.items)", () => {
		const leder = makeArmor({ id: "w1" });
		const robust = makeTrait({ id: "r1", name: "Robust", reference: "robust", level: 1, bonusProtection: "+2" });
		const actor = makeProtoActor([robust]);
		const combatMods = makeCombatMods(["w1"]);
		actor._applyCrossArmorBonuses(combatMods, [leder]);
		const rows = actor._evaluateArmors([leder], combatMods);
		const wornRow = rows.find((r) => r.id === "w1");
		expect(wornRow.protectionPc).toContain("1d6");
		expect(wornRow.protectionPc).toContain("+2");
	});

	it("RS-Bonus wirkt auch auf die NoArmor-Zeile (natürliche Panzerung ungepanzert)", () => {
		const noArmor = { id: "NoArmorID", name: "Keine Rüstung", type: "armor", isNoArmor: true, impeding: 0, img: "icons/equipment/chest/shirt-simple-white.webp", system: { isArmor: true, isActive: true, isStackableArmor: false, baseProtection: "1d0", bonusProtection: "" } };
		const robust = makeTrait({ id: "r1", name: "Robust", reference: "robust", level: 1, bonusProtection: "+2" });
		const actor = makeProtoActor([robust]);
		const combatMods = makeCombatMods(["NoArmorID"]);
		actor._applyCrossArmorBonuses(combatMods, [noArmor]);
		expect(combatMods.armors.NoArmorID.protectionChoices).toHaveLength(1);
	});

	it("Kein Selbst-Schub: Signatur-Bonus bleibt auf der EIGENEN Zeile, getragene Rüstung unberührt", () => {
		const chitin = makeTrait({ id: "c1", name: "Chitinpanzer", reference: "armored", level: 1, crossFlag: "armor", baseProtection: "1d8", bonusProtection: "+1" });
		const leder = makeArmor({ id: "w1" });
		const actor = makeProtoActor([chitin]);
		const combatMods = makeCombatMods(["c1", "w1"]);
		actor._applyCrossArmorBonuses(combatMods, [chitin, leder]);
		expect(combatMods.armors.c1.protectionChoices).toHaveLength(1);
		expect(combatMods.armors.w1.protectionChoices).toHaveLength(0);
	});

	it("NPC-Konvertierung: Bonus-Schutz wird halbiert (maximierter Wurf) in die NPC-Spalte übernommen", () => {
		const leder = makeArmor({ id: "w1" });
		const robust = makeTrait({ id: "r1", name: "Robust", reference: "robust", level: 1, bonusProtection: "+2" });
		const actor = makeProtoActor([robust], { isPlayer: false });
		const combatMods = makeCombatMods(["w1"]);
		actor._applyCrossArmorBonuses(combatMods, [leder]);
		const rows = actor._evaluateArmors([leder], combatMods);
		const wornRow = rows.find((r) => r.id === "w1");
		/* 1d6 => NSC-Festwert 3, Bonus +2 => NSC 1 => 4 */
		expect(wornRow.protectionNpc).toBe("4");
	});
});

/* --------------------------------------------------- */
/*  4. Stapelbare natürliche Rüstung (Schutzrunen)     */
/* --------------------------------------------------- */

describe("B2 Stapelbare natürliche Rüstung (crossArmorStackable)", () => {
	it("Stapelbar-Häkchen: gepflegter Grund-Schutz verteilt sich als feste Alternative auf die getragene Zeile", () => {
		const leder = makeArmor({ id: "w1" });
		const chitin = makeTrait({
			id: "c1", name: "Natürliche Panzerung", reference: "armored", level: 1, crossFlag: "armor",
			baseProtection: "1d6", crossArmorStackable: true, crossArmorName: "Chitinpanzer",
		});
		const actor = makeProtoActor([chitin]);
		const combatMods = makeCombatMods(["c1", "w1"]);
		actor._applyCrossArmorBonuses(combatMods, [chitin, leder]);
		const rows = actor._evaluateArmors([chitin, leder], combatMods);
		const wornRow = rows.find((r) => r.id === "w1");
		expect(wornRow.protectionPc).toContain("1d6");
		expect(wornRow.protectionPc).toContain("+1d6[Chitinpanzer]");
	});

	it("Stapelbar NSC: fester Anteil = halbierter maximierter Wurf (1d6 => 3), Zeilen-NSC 3+3=6", () => {
		const leder = makeArmor({ id: "w1" });
		const chitin = makeTrait({
			id: "c1", name: "Natürliche Panzerung", reference: "armored", level: 1, crossFlag: "armor",
			baseProtection: "1d6", crossArmorStackable: true, crossArmorName: "Chitinpanzer",
		});
		const actor = makeProtoActor([chitin], { isPlayer: false });
		const combatMods = makeCombatMods(["c1", "w1"]);
		actor._applyCrossArmorBonuses(combatMods, [chitin, leder]);
		const rows = actor._evaluateArmors([chitin, leder], combatMods);
		const wornRow = rows.find((r) => r.id === "w1");
		expect(wornRow.protectionNpc).toBe("6");
	});

	it("Default (Häkchen aus): KEINE Verteilung des Grund-Schutzes - getragene Rüstung bleibt bei 1d6", () => {
		const leder = makeArmor({ id: "w1" });
		const chitin = makeTrait({
			id: "c1", name: "Natürliche Panzerung", reference: "armored", level: 1, crossFlag: "armor",
			baseProtection: "1d6", crossArmorStackable: false, crossArmorName: "Chitinpanzer",
		});
		const actor = makeProtoActor([chitin]);
		const combatMods = makeCombatMods(["c1", "w1"]);
		actor._applyCrossArmorBonuses(combatMods, [chitin, leder]);
		expect(combatMods.armors.w1.protectionChoices).toHaveLength(0);
		const rows = actor._evaluateArmors([chitin, leder], combatMods);
		expect(rows.find((r) => r.id === "w1").protectionPc).toBe("1d6");
	});

	it("Kein Selbst-Schub beim Stapelbar-Verteilen: eigene Zeile ohne die +-Alternative", () => {
		const leder = makeArmor({ id: "w1" });
		const chitin = makeTrait({
			id: "c1", name: "Natürliche Panzerung", reference: "armored", level: 1, crossFlag: "armor",
			baseProtection: "1d6", crossArmorStackable: true, crossArmorName: "Chitinpanzer",
		});
		const actor = makeProtoActor([chitin]);
		const combatMods = makeCombatMods(["c1", "w1"]);
		actor._applyCrossArmorBonuses(combatMods, [chitin, leder]);
		const rows = actor._evaluateArmors([chitin, leder], combatMods);
		const ownRow = rows.find((r) => r.id === "c1");
		expect(ownRow.protectionPc).toBe("1d6");
	});

	it("Verteilung erreicht auch die NoArmor-Zeile (Kreatur ohne getragene Rüstung)", () => {
		const noArmor = { id: "NoArmorID", name: "Keine Rüstung", type: "armor", isNoArmor: true, impeding: 0, img: "icons/equipment/chest/shirt-simple-white.webp", system: { isArmor: true, isActive: true, isStackableArmor: false, baseProtection: "1d0", bonusProtection: "" } };
		const chitin = makeTrait({
			id: "c1", name: "Natürliche Panzerung", reference: "armored", level: 1, crossFlag: "armor",
			baseProtection: "1d6", crossArmorStackable: true, crossArmorName: "Chitinpanzer",
		});
		const actor = makeProtoActor([chitin]);
		const combatMods = makeCombatMods(["NoArmorID", "c1"]);
		actor._applyCrossArmorBonuses(combatMods, [chitin, noArmor]);
		expect(combatMods.armors.NoArmorID.protectionChoices).toHaveLength(1);
	});
});

/* --------------------------------------------------- */
/*  5. Primär-Rüstung: natürliche Rüstung             */
/* --------------------------------------------------- */

describe("B2 natürliche Rüstung als Primär-Kandidat", () => {
	it("_getCrossSignatureArmor findet die Signatur-Zeile", () => {
		const gepanzert = makeTrait({ id: "t1", name: "Gepanzert", reference: "armored", level: 2, crossFlag: "armor", baseProtection: "1d8" });
		const actor = makeProtoActor([]);
		expect(actor._getCrossSignatureArmor([gepanzert])?.id).toBe("t1");
	});

	it("Nur-Bonus-Items sind KEINE Signatur (null), getragene Rüstungen sind keine Cross-Items", () => {
		const robust = makeTrait({ id: "r1", name: "Robust", reference: "robust", level: 1, bonusProtection: "+2" });
		const leder = makeArmor({ id: "w1" });
		const actor = makeProtoActor([]);
		expect(actor._getCrossSignatureArmor([robust])).toBeNull();
		expect(actor._getCrossSignatureArmor([leder])).toBeNull();
	});
});

/* --------------------------------------------------- */
/*  6. crossFlag-Preset (KANONIK VOR RADIO)           */
/* --------------------------------------------------- */

describe("B2 v2 crossFlag-Preset (resolveCrossFlagDisplay)", () => {
	it("Gespeichertes 'none' (template-Default seit Commit A) schlägt die Kanonik-Vorbelegung NICHT", () => {
		expect(resolveCrossFlagDisplay).toBeDefined();
		expect(resolveCrossFlagDisplay("none", "trait", "robust")).toBe("armor");
		expect(resolveCrossFlagDisplay("none", "trait", "armored")).toBe("armor");
	});

	it("Leerer Speicherstand: Kanonik-Gepanzert/Robust zeigen 'armor'", () => {
		expect(resolveCrossFlagDisplay("", "trait", "armored")).toBe("armor");
		expect(resolveCrossFlagDisplay(undefined, "trait", "robust")).toBe("armor");
	});

	it("Kanonik-Waffen-Merkmale (CROSS_WEAPON_TRAITS, z. B. Greifzunge) zeigen 'weapon'", () => {
		expect(resolveCrossFlagDisplay("", "trait", "web")).toBe("weapon");
		expect(resolveCrossFlagDisplay("none", "trait", "prehensileclaws")).toBe("weapon");
	});

	it("Custom-Merkmal ohne Kanonik: 'none'", () => {
		expect(resolveCrossFlagDisplay("", "trait", "bravestheart")).toBe("none");
		expect(resolveCrossFlagDisplay("none", "trait", "customref")).toBe("none");
	});

	it("Gespeicherter Wert gewinnt (SL-Override bleibt erhalten)", () => {
		expect(resolveCrossFlagDisplay("weapon", "trait", "armored")).toBe("weapon");
		expect(resolveCrossFlagDisplay("armor", "trait", "web")).toBe("armor");
	});

	it("Echte Waffen-/Rüstungs-Typen wirken über ihren Typ", () => {
		expect(resolveCrossFlagDisplay("none", "weapon", "")).toBe("weapon");
		expect(resolveCrossFlagDisplay("", "armor", "")).toBe("armor");
	});
});

/* --------------------------------------------------- */
/*  7. Datenbasis: template.json + i18n (AGENTS.md §6) */
/* --------------------------------------------------- */

describe("B2 v2 Datenbasis (template.json, i18n)", () => {
	const templateJson = JSON.parse(readFileSync(repoPath("template.json"), "utf8"));
	/* template.json: Item-Typen tragen die System-Felder DIREKT (Foundry
	   wrappt sie zur Laufzeit in .system) - Commit A hat crossFlag usw.
	   direkt unter Item.<type> materialisiert. */
	const crossFlagTypes = Object.entries(templateJson.Item)
		.filter(([, v]) => v && typeof v === "object" && "crossFlag" in v)
		.map(([k]) => k);
	const V2_FIELDS = ["crossArmorName", "crossArmorIcon", "crossArmorStackable", "crossWeaponName", "crossWeaponIcon"];

	it("Alle crossFlag-tragenden Item-Typen (Commit A) tragen die 5 v2-Felder additiv", () => {
		expect(crossFlagTypes.length).toBeGreaterThanOrEqual(9);
		for (const type of crossFlagTypes) {
			for (const field of V2_FIELDS) {
				expect(templateJson.Item[type]).toHaveProperty(field);
			}
		}
	});

	it("v2-Felder sind additive Defaults: Name/Icon leer, Stapelbar aus (kein Verhalten ohne SL-Pflege)", () => {
		for (const type of crossFlagTypes) {
			expect(templateJson.Item[type].crossArmorStackable).toBe(false);
			expect(templateJson.Item[type].crossArmorName).toBe("");
		}
	});

	it("i18n: die neuen sichtbaren Labels existieren in de UND en (Parität)", () => {
		const langDe = JSON.parse(readFileSync(repoPath("lang", "de.json"), "utf8"));
		const langEn = JSON.parse(readFileSync(repoPath("lang", "en.json"), "utf8"));
		const keys = [
			"STATUS.CROSS_ARMOR_NAME",
			"STATUS.CROSS_ARMOR_NAME_TOOLTIP",
			"STATUS.CROSS_ARMOR_ICON",
			"STATUS.CROSS_ARMOR_ICON_TOOLTIP",
			"STATUS.CROSS_ARMOR_STACKABLE",
			"STATUS.CROSS_ARMOR_STACKABLE_TOOLTIP",
			"STATUS.CROSS_WEAPON_NAME",
			"STATUS.CROSS_WEAPON_NAME_TOOLTIP",
			"STATUS.CROSS_WEAPON_ICON",
			"STATUS.CROSS_WEAPON_ICON_TOOLTIP",
			"TITLE.CROSS_ARMOR_PROT_NONE",
		];
		for (const key of keys) {
			expect(langDe[key]).toBeDefined();
			expect(langEn[key]).toBeDefined();
		}
	});
});

/* --------------------------------------------------- */
/*  8. B2 v2.1: Stufenautomatische Gepanzert-Signatur   */
/* --------------------------------------------------- */

describe("B2 v2.1 stufenautomatische Gepanzert-Signatur (Kanonik-Defaults)", () => {
	it("Gepanzert Novize OHNE Pflege: Zeile mit stufenautomatischer 1d4-Signatur", () => {
		const gepanzert = makeTrait({ id: "t1", name: "Gepanzert", reference: "armored", level: 1, baseProtection: "" });
		const actor = makeProtoActor([gepanzert]);
		const armors = actor._getArmors();
		expect(armors.some((a) => a.id === "t1")).toBe(true);
		const rows = actor._evaluateArmors(armors, makeCombatMods(["t1"]));
		expect(rows[0].base).toBe("1d4");
		expect(rows[0].protectionPc).toContain("1d4");
	});

	it("Stufenprogression aus der Kanonik: Adept 1d6, Meister 1d8", () => {
		for (const [level, dice] of [[2, "1d6"], [3, "1d8"]]) {
			const gepanzert = makeTrait({ id: `t${level}`, name: "Gepanzert", reference: "armored", level, baseProtection: "" });
			const actor = makeProtoActor([gepanzert]);
			const rows = actor._evaluateArmors(actor._getArmors(), makeCombatMods([`t${level}`]));
			expect(rows[0].base).toBe(dice);
			expect(rows[0].protectionPc).toContain(dice);
		}
	});

	it("SL-Override gewinnt: gepflegtes Feld 1d10 schlägt Kanonik-Default 1d4", () => {
		const gepanzert = makeTrait({ id: "t1", name: "Gepanzert", reference: "armored", level: 1, baseProtection: "1d10" });
		const actor = makeProtoActor([gepanzert]);
		const rows = actor._evaluateArmors(actor._getArmors(), makeCombatMods(["t1"]));
		expect(rows[0].base).toBe("1d10");
		expect(rows[0].protectionPc).toContain("1d10");
	});

	it("Robust bleibt Bonus-only: KEIN Kanonik-Grund-Schutz, keine Zeile ohne Pflege", () => {
		const robust = makeTrait({ id: "r1", name: "Robust", reference: "robust", level: 1, baseProtection: "" });
		const actor = makeProtoActor([robust]);
		expect(actor._getArmors().some((a) => a.id === "r1")).toBe(false);
	});

	it("_getCrossSignatureArmor erkennt die stufenautomatische Signatur als Primär-Kandidat", () => {
		const gepanzert = makeTrait({ id: "t1", name: "Gepanzert", reference: "armored", level: 2, baseProtection: "" });
		const actor = makeProtoActor([gepanzert]);
		expect(actor._getCrossSignatureArmor(actor._getArmors())?.id).toBe("t1");
	});

	it("Gelernt-Gate vor Kanonik-Werten: Stufe 0 => keine Zeile", () => {
		const gepanzert = makeTrait({ id: "t0", name: "Gepanzert", reference: "armored", level: 0, baseProtection: "" });
		const actor = makeProtoActor([gepanzert]);
		expect(actor._getArmors().some((a) => a.id === "t0")).toBe(false);
	});

	it("NSC-Anzeige: Novize ungepanzert => Schutz-Festwert 2 (halbiertes 1d4)", () => {
		const gepanzert = makeTrait({ id: "t1", name: "Gepanzert", reference: "armored", level: 1, baseProtection: "" });
		const actor = makeProtoActor([gepanzert], { isPlayer: false });
		const rows = actor._evaluateArmors(actor._getArmors(), makeCombatMods(["t1"]));
		expect(rows[0].protectionNpc).toBe("2");
	});

	it("Stapelbar mit stufenautomatischem Wert: getragene Zeile bekommt +1d6[Gepanzert], NSC 6", () => {
		const gepanzert = makeTrait({ id: "c1", name: "Gepanzert", reference: "armored", level: 2, baseProtection: "", crossArmorStackable: true });
		const leder = makeArmor({ id: "w1" });
		/* Spieler-Ansicht: das Alternativen-Label steht im PC-Schutztext;
		   die NSC-Spalte (protectionNpc) wird unabhängig berechnet. */
		const actor = makeProtoActor([gepanzert], { isPlayer: true });
		const combatMods = makeCombatMods(["c1", "w1"]);
		actor._applyCrossArmorBonuses(combatMods, [gepanzert, leder]);
		const rows = actor._evaluateArmors([gepanzert, leder], combatMods);
		const wornRow = rows.find((r) => r.id === "w1");
		expect(wornRow.protectionPc).toContain("+1d6[Gepanzert]");
		expect(wornRow.protectionNpc).toBe("6");
	});
});

/* --------------------------------------------------- */
/*  9. B2 v2.1: Robust-Override (Kalibrierung 7a)      */
/* --------------------------------------------------- */

describe("B2 v2.1 Robust-Override (Automat schweigt bei gepflegtem Bonus-Feld)", () => {
	function makeNoArmor() {
		return { id: "NoArmorID", name: "Keine Rüstung", type: "armor", isNoArmor: true, impeding: 0, img: "icons/equipment/chest/shirt-simple-white.webp", system: { isArmor: true, isActive: true, isStackableArmor: false, baseProtection: "1d0", bonusProtection: "" } };
	}

	function makeRobustItem({ level = 1, bonusProtection = "" } = {}) {
		const item = Object.create(SymbaroumItem.prototype);
		item.id = "r1";
		item.name = "Robust";
		item.type = "trait";
		item.system = { reference: "robust", bonusProtection, isPower: false };
		item.getLevel = () => ({ level });
		item.actor = { items: [] };
		return item;
	}

	it("Gepflegtes Bonus-Feld: Automat-SCHUTZbeitrag entfällt, Verteidigungs- und Nahkampf-Beitrag bleiben", () => {
		const robust = makeRobustItem({ level: 1, bonusProtection: "+1d4" });
		const noArmor = makeNoArmor();
		const combatMods = makeCombatMods(["NoArmorID", "w1"]);
		combatMods.weapons.w1 = { package: [], maxAttackNb: 1, specialEffects: [] };
		const melee = { id: "w1", system: { alternativeDamage: "none", isMelee: true } };
		robust.getItemModifierRobust(combatMods, [noArmor], [melee], []);
		expect(combatMods.armors.NoArmorID.protectionChoices).toHaveLength(0);
		expect(combatMods.armors.NoArmorID.defenseModifiers).toHaveLength(1);
		expect(combatMods.weapons.w1.package).toHaveLength(1);
	});

	it("Feld leer: Automat läuft wie bisher (+1d4-Schutz auf Novize, NSC-Beitrag 2)", () => {
		const robust = makeRobustItem({ level: 1, bonusProtection: "" });
		const noArmor = makeNoArmor();
		const combatMods = makeCombatMods(["NoArmorID"]);
		robust.getItemModifierRobust(combatMods, [noArmor], [], []);
		expect(combatMods.armors.NoArmorID.protectionChoices).toHaveLength(1);
		expect(combatMods.armors.NoArmorID.protectionChoices[0].alternatives[0].protectionMod).toBe("+1d4");
		expect(combatMods.armors.NoArmorID.protectionChoices[0].alternatives[0].protectionModNPC).toBe(2);
	});

	it("Integration 7a: Robust Novize, gepflegtes Feld +1d4, keine Rüstung => NSC-Schutz 2 (statt 4, keine Doppelung)", () => {
		const robust = makeRobustItem({ level: 1, bonusProtection: "+1d4" });
		const noArmor = makeNoArmor();
		const actor = makeProtoActor([robust], { isPlayer: false });
		const combatMods = makeCombatMods(["NoArmorID"]);
		robust.getItemModifierRobust(combatMods, [noArmor], [], []);
		actor._applyCrossArmorBonuses(combatMods, [noArmor]);
		const rows = actor._evaluateArmors([noArmor], combatMods);
		expect(rows[0].protectionNpc).toBe("2");
	});

	it("Integration, Feld leer: nur der Automat => NSC-Schutz 2 (Bestand)", () => {
		const robust = makeRobustItem({ level: 1, bonusProtection: "" });
		const noArmor = makeNoArmor();
		const actor = makeProtoActor([robust], { isPlayer: false });
		const combatMods = makeCombatMods(["NoArmorID"]);
		robust.getItemModifierRobust(combatMods, [noArmor], [], []);
		actor._applyCrossArmorBonuses(combatMods, [noArmor]);
		const rows = actor._evaluateArmors([noArmor], combatMods);
		expect(rows[0].protectionNpc).toBe("2");
	});
});

/* --------------------------------------------------- */
/*  10. B2 v2.1: Stapelbar-Checkbox defensiv           */
/* --------------------------------------------------- */

describe("B2 v2.1 Stapelbar-Checkbox defensiv (Foundry-Submit-Strings)", () => {
	it("String \"true\" (Submit ohne data-dtype Boolean) wirkt wie das Häkchen", () => {
		const leder = makeArmor({ id: "w1" });
		const chitin = makeTrait({
			id: "c1", name: "Natürliche Panzerung", reference: "armored", level: 1, crossFlag: "armor",
			baseProtection: "1d6", crossArmorStackable: "true", crossArmorName: "Chitinpanzer",
		});
		const actor = makeProtoActor([chitin]);
		const combatMods = makeCombatMods(["c1", "w1"]);
		actor._applyCrossArmorBonuses(combatMods, [chitin, leder]);
		const rows = actor._evaluateArmors([chitin, leder], combatMods);
		const wornRow = rows.find((r) => r.id === "w1");
		expect(wornRow.protectionPc).toContain("+1d6[Chitinpanzer]");
	});

	it("String \"false\" wirkt nicht (keine Verteilung)", () => {
		const leder = makeArmor({ id: "w1" });
		const chitin = makeTrait({
			id: "c1", name: "Natürliche Panzerung", reference: "armored", level: 1, crossFlag: "armor",
			baseProtection: "1d6", crossArmorStackable: "false", crossArmorName: "Chitinpanzer",
		});
		const actor = makeProtoActor([chitin]);
		const combatMods = makeCombatMods(["c1", "w1"]);
		actor._applyCrossArmorBonuses(combatMods, [chitin, leder]);
		expect(combatMods.armors.w1.protectionChoices).toHaveLength(0);
	});
});
