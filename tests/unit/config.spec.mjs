/**
 * Suite 1: config.js - gepinnte Regel-Konstanten (MM2/Queenscross-Stand).
 *
 * Ziel (A4 "Erst-Suite minimal"): Die Regel-Enden, die Rudolf im MM2-Paket
 * bewusst festgezurrt hat, per Regressionstest pinnen. Der Test schlägt an,
 * wenn eine spätere Änderung die Werte verschiebt - er bewertet NICHT, ob
 * die Werte regellich richtig sind (das ist Rudolfs Bewertungsrunde).
 *
 * Enthalten (Konzept-Doc §4.1):
 *  - MM2_WEB_SHOTS_PER_LEVEL und CROSS_WEAPON_TRAITS.web (Knochengeschoss)
 *  - Gift-Leitern POISON_GRADE_DAMAGE / POISON_GRADE_NPC_DAMAGE inklusive
 *    Konsistenz der NPC-Ableitung über npcFixedFromDice
 *  - itemValid (enthält "rezeptur" - v1.1-Regression!) und itemSortOrder
 *  - GATHER_BONUS_ABILITIES / GATHER_BONUS_CAP (Sammel-Bonus, Deckel 3)
 */
import { describe, it, expect } from "vitest";
import { SYMBAROUM } from "../../script/common/config.js";

describe("config.js: MM2 Knochengeschoss (web)", () => {
	it("pinnt MM2_WEB_SHOTS_PER_LEVEL auf [0, 0, 1, 3]", () => {
		expect(SYMBAROUM.MM2_WEB_SHOTS_PER_LEVEL).toEqual([0, 0, 1, 3]);
	});

	it("pinnt den CROSS_WEAPON_TRAITS.web-Block komplett", () => {
		expect(SYMBAROUM.CROSS_WEAPON_TRAITS.web).toEqual({
			attribute: "accurate",
			isMelee: false,
			isDistance: true,
			noDamage: true,
			numAttacks: 3,
			numAttacksFromLevel: 3,
			rowFromLevel: 2,
			probeShots: true,
		});
	});
});

describe("config.js: Gift-Leitern", () => {
	it("pinnt POISON_GRADE_DAMAGE als 1d4/1d6/1d8 je Grad", () => {
		expect(SYMBAROUM.POISON_GRADE_DAMAGE).toEqual({ 1: "1d4", 2: "1d6", 3: "1d8" });
	});

	it("pinnt die NPC-Festwerte 2/3/4 je Grad", () => {
		expect(SYMBAROUM.POISON_GRADE_NPC_DAMAGE).toEqual({ 1: 2, 2: 3, 3: 4 });
	});

	it("leitet die NPC-Werte konsistent über npcFixedFromDice ab (Muster (Würfel+1)/2)", () => {
		for (const [grade, dice] of Object.entries(SYMBAROUM.POISON_GRADE_DAMAGE)) {
			expect(SYMBAROUM.POISON_GRADE_NPC_DAMAGE[grade]).toBe(SYMBAROUM.npcFixedFromDice(dice));
		}
	});
});

describe("config.js: Item-Typ-Listen", () => {
	it("pinnt itemValid inklusive rezeptur (v1.1-Regression: Typ erschien sonst nie im Neuanlage-Dialog)", () => {
		expect(SYMBAROUM.itemValid).toEqual([
			"ability",
			"armor",
			"boon",
			"burden",
			"container",
			"equipment",
			"mysticalPower",
			"rezeptur",
			"ritual",
			"trait",
			"weapon",
		]);
		expect(SYMBAROUM.itemValid).toContain("rezeptur");
	});

	it("pinnt itemSortOrder (12 Einträge, rezeptur zuletzt)", () => {
		expect(SYMBAROUM.itemSortOrder).toEqual([
			"ability",
			"trait",
			"mysticalPower",
			"ritual",
			"boon",
			"burden",
			"armor",
			"weapon",
			"equipment",
			"container",
			"artifact",
			"rezeptur",
		]);
	});
});

describe("config.js: Sammel-Bonus (S5-Vorarbeit)", () => {
	it("pinnt GATHER_BONUS_ABILITIES (alchemy => Fähigkeit, bushcraft => Segen, je Stufe 1)", () => {
		expect(SYMBAROUM.GATHER_BONUS_ABILITIES).toEqual([
			{ reference: "alchemy", itemType: "ability", perLevel: 1 },
			{ reference: "bushcraft", itemType: "boon", perLevel: 1 },
		]);
	});

	it("pinnt den Bonus-Deckel GATHER_BONUS_CAP auf 3", () => {
		expect(SYMBAROUM.GATHER_BONUS_CAP).toBe(3);
	});
});
