/**
 * Suite 2: stacking.js - Stapel-Identität und -Operationen (AP2 v2, Stand v1.4).
 *
 * Ziel (A4): Die reine Datenlogik der Stapel-Regeln gegen die ECHTEN Module
 * aus script/common/ testen (stacking.js, currency.js, container.js,
 * resources.js) - nur die Foundry-Laufzeit kommt aus tests/setup.mjs.
 *
 * Enthalten (Konzept-Doc §4.1):
 *  - isStackableItem: komplette Regel-Matrix (Behälter nie, Uniform-Regel
 *    über system.stackable, Typ-Default nur Ausrüstung ohne Artefakt-Flag)
 *  - getStackKey: Identität Typ + Name (getrimmt) + normalisierter Preis
 *    (getItemPriceBase, Altformat über Kurse) + Gewicht ("none" == fehlend)
 *  - findStackTarget: Match, Quell-Ausschluss, verpackte Items, Behälter-Modus
 *  - mergeStackDrop: Rechte-Gate, Rations-Kapazitäts-Ausschluss (v1.4),
 *    Kapazitäts-Klemme mit Überhang (v1.2, "Wegbrot 7 Teile"-Muster)
 *  - splitStackItem: Gates, Klemmung 1..number-1, Favoriten-Flag-Verlust
 */
import { describe, it, expect } from "vitest";
import {
	isStackableItem,
	getStackKey,
	findStackTarget,
	mergeStackDrop,
	splitStackItem,
} from "../../script/common/stacking.js";
import { makeItem, makeActor, makeTorch } from "../helpers/fixtures.mjs";

/* -------------------------------------------- */
/*  isStackableItem: Regel-Matrix                */
/* -------------------------------------------- */

describe("stacking: isStackableItem (Uniform-Regel v2)", () => {
	it("lehnt null/undefined ab", () => {
		expect(isStackableItem(null)).toBe(false);
		expect(isStackableItem(undefined)).toBe(false);
	});

	it("lässt Behälter NIE zu, auch nicht mit stackable true", () => {
		expect(isStackableItem({ type: "container" })).toBe(false);
		expect(isStackableItem({ type: "container", system: { stackable: true } })).toBe(false);
	});

	it("lehnt Nicht-Gear-Typen ab (Eigenschaft, Kraft, Segen)", () => {
		expect(isStackableItem({ type: "trait" })).toBe(false);
		expect(isStackableItem({ type: "ability" })).toBe(false);
		expect(isStackableItem({ type: "boon" })).toBe(false);
	});

	it("stapelt Ausrüstung per Typ-Default, ohne Artefakt-Flag", () => {
		expect(isStackableItem({ type: "equipment", system: {} })).toBe(true);
		expect(isStackableItem({ type: "equipment", system: { isArtifact: true } })).toBe(false);
	});

	it("stapelt Waffe/Rüstung/Artefakt per Default NICHT", () => {
		expect(isStackableItem({ type: "weapon", system: {} })).toBe(false);
		expect(isStackableItem({ type: "armor", system: {} })).toBe(false);
		expect(isStackableItem({ type: "artifact", system: {} })).toBe(false);
	});

	it("überschreibt den Typ-Default mit system.stackable (true wie false)", () => {
		expect(isStackableItem({ type: "weapon", system: { stackable: true } })).toBe(true);
		expect(isStackableItem({ type: "equipment", system: { stackable: false } })).toBe(false);
	});
});

/* -------------------------------------------- */
/*  getStackKey: Identität                       */
/* -------------------------------------------- */

describe("stacking: getStackKey (Identitätsregel)", () => {
	it("bildet identische Items auf denselben Schlüssel ab", () => {
		const a = makeTorch();
		const b = makeTorch();
		expect(getStackKey(a)).toBe(getStackKey(b));
	});

	it("unterscheidet Preis (normalisiert über getItemPriceBase)", () => {
		const cheap = makeTorch({ system: { number: 1, price: 2, weight: "none" } });
		const pricey = makeTorch({ system: { number: 1, price: 3, weight: "none" } });
		expect(getStackKey(cheap)).not.toBe(getStackKey(pricey));
	});

	it("behandelt fehlenden Preis als unbekannt (null-Preis ist NICHT gleich)", () => {
		const noPrice = makeTorch({ system: { number: 1, weight: "none" } });
		const zeroPrice = makeTorch({ system: { number: 1, price: 0, weight: "none" } });
		expect(getStackKey(noPrice)).not.toBe(getStackKey(zeroPrice));
	});

	it("rechnet das Altformat {value, denomination} über die Standard-Kurse (Schilling = 10 Orteg)", () => {
		const modern = makeTorch({ system: { number: 1, price: 250, weight: "none" } });
		const legacy = makeTorch({
			system: { number: 1, price: { value: 25, denomination: "shilling" }, weight: "none" },
		});
		expect(getStackKey(modern)).toBe(getStackKey(legacy));
	});

	it("trimmt den Namen (case-sensitiv)", () => {
		const padded = makeTorch({ name: "  Fackel  " });
		expect(getStackKey(padded)).toBe(getStackKey(makeTorch()));
		expect(getStackKey(makeTorch({ name: "fackel" }))).not.toBe(getStackKey(makeTorch()));
	});

	it("behandelt Gewicht undefined und \"none\" als gleich", () => {
		const noWeight = makeTorch({ system: { number: 1, price: 2 } });
		const noneWeight = makeTorch({ system: { number: 1, price: 2, weight: "none" } });
		expect(getStackKey(noWeight)).toBe(getStackKey(noneWeight));
	});
});

/* -------------------------------------------- */
/*  findStackTarget                              */
/* -------------------------------------------- */

describe("stacking: findStackTarget", () => {
	it("findet einen identischen unverpackten Stapel im Inventar", () => {
		const actor = makeActor({ items: [makeTorch({ system: { number: 3, price: 2, weight: "none" } })] });
		const source = makeTorch();
		const target = findStackTarget(actor, source);
		expect(target).not.toBeNull();
		expect(target.system.number).toBe(3);
	});

	it("findet bei abweichendem Preis nichts", () => {
		const actor = makeActor({ items: [makeTorch({ system: { number: 3, price: 5, weight: "none" } })] });
		expect(findStackTarget(actor, makeTorch())).toBeNull();
	});

	it("schließt das eingebettete Quell-Item selbst aus (parent === actor)", () => {
		const actor = makeActor({ items: [] });
		const own = makeTorch();
		own.parent = actor;
		actor.items.push(own);
		expect(findStackTarget(actor, own)).toBeNull();
	});

	it("ignoriert verpackte Items im Inventar-Modus (system.container referenziert Behälter)", () => {
		const bag = makeItem({ id: "bag-1", name: "Beutel", type: "container" });
		const packed = makeTorch({ system: { number: 3, price: 2, weight: "none", container: "bag-1" } });
		const actor = makeActor({ items: [bag, packed] });
		expect(findStackTarget(actor, makeTorch())).toBeNull();
	});

	it("berücksichtigt im Behälter-Modus NUR direkte Kinder des Behälters", () => {
		const packed = makeTorch({ system: { number: 3, price: 2, weight: "none", container: "bag-1" } });
		const loose = makeTorch({ system: { number: 2, price: 2, weight: "none" } });
		const actor = makeActor({ items: [packed, loose] });
		const found = findStackTarget(actor, makeTorch(), { containerId: "bag-1" });
		expect(found).toBe(packed);
		expect(findStackTarget(actor, packed, { containerId: "other-bag" })).toBeNull();
	});

	it("ehrt excludeId", () => {
		const stack = makeItem({ id: "stack-1", name: "Fackel", type: "equipment", system: { number: 3, price: 2, weight: "none" } });
		const actor = makeActor({ items: [stack] });
		expect(findStackTarget(actor, makeTorch(), { excludeId: "stack-1" })).toBeNull();
	});

	it("lehnt nicht stapelbare Quellen ab", () => {
		const actor = makeActor({ items: [makeTorch({ system: { number: 3, price: 2, weight: "none" } })] });
		expect(findStackTarget(actor, makeItem({ type: "weapon", name: "Fackel" }))).toBeNull();
	});
});

/* -------------------------------------------- */
/*  mergeStackDrop                               */
/* -------------------------------------------- */

describe("stacking: mergeStackDrop", () => {
	it("lehnt ab, wenn der Nutzer den Ziel-Aktor nicht besitzt", async () => {
		const actor = makeActor({ items: [makeTorch()], isOwner: false });
		expect(await mergeStackDrop(actor, makeTorch())).toBeNull();
	});

	it("schließt Rations-Kapazitäts-Items als QUELLE aus (v1.4: Rationen stapeln nie)", async () => {
		const actor = makeActor({ items: [makeTorch()] });
		const ration = makeItem({
			name: "Fackel",
			type: "equipment",
			system: { number: 2, price: 2, weight: "none", resourceCategory: "essensration", maxNumber: 7 },
		});
		expect(await mergeStackDrop(actor, ration)).toBeNull();
	});

	it("schließt Rations-Kapazitäts-Items als ZIEL aus", async () => {
		const rationStack = makeItem({
			name: "Fackel",
			type: "equipment",
			system: { number: 2, price: 2, weight: "none", resourceCategory: "wasserration", maxNumber: 7 },
		});
		const actor = makeActor({ items: [rationStack] });
		expect(await mergeStackDrop(actor, makeTorch())).toBeNull();
	});

	it("addiert Anzahlen ohne Kapazität und löscht eine eingebettete Quelle", async () => {
		const target = makeTorch({ system: { number: 3, price: 2, weight: "none" } });
		const actor = makeActor({ items: [target] });
		const sourceActor = makeActor({ items: [] });
		const source = makeTorch({ system: { number: 2, price: 2, weight: "none" } });
		source.parent = sourceActor;
		const merged = await mergeStackDrop(actor, source);
		expect(merged).toBe(target);
		expect(target.updates[0]["system.number"]).toBe(5);
		expect(sourceActor.deleted).toEqual([source.id]);
	});

	it("klemmt auf maxNumber und legt den Überhang aus einer Verzeichnis-Quelle als Kopie an (v1.2-Muster)", async () => {
		const target = makeItem({
			name: "Köcher",
			type: "equipment",
			system: { number: 5, price: 4, weight: "none", maxNumber: 7 },
		});
		const actor = makeActor({ items: [target] });
		const source = makeItem({
			name: "Köcher",
			type: "equipment",
			system: { number: 4, price: 4, weight: "none" },
		});
		const merged = await mergeStackDrop(actor, source);
		expect(merged).toBe(target);
		expect(target.updates[0]["system.number"]).toBe(7);
		expect(actor.created).toHaveLength(1);
		expect(actor.created[0].system.number).toBe(2);
	});

	it("schrumpft manuell überfüllte Stapel NICHT (merged bleibt beim Bestand)", async () => {
		const target = makeItem({
			name: "Köcher",
			type: "equipment",
			system: { number: 9, price: 4, weight: "none", maxNumber: 7 },
		});
		const actor = makeActor({ items: [target] });
		await mergeStackDrop(actor, makeItem({ name: "Köcher", type: "equipment", system: { number: 2, price: 4, weight: "none" } }));
		expect(target.updates[0]["system.number"]).toBe(9);
		expect(actor.created[0].system.number).toBe(2);
	});
});

/* -------------------------------------------- */
/*  splitStackItem                               */
/* -------------------------------------------- */

describe("stacking: splitStackItem", () => {
	it("lehnt Items ab, die nicht im Aktor eingebettet sind", async () => {
		const actor = makeActor({ items: [] });
		const loose = makeTorch({ system: { number: 5, price: 2, weight: "none" } });
		expect(await splitStackItem(actor, loose, 2)).toBeNull();
	});

	it("lehnt ab, wenn der Nutzer den Aktor nicht besitzt", async () => {
		const stack = makeTorch({ system: { number: 5, price: 2, weight: "none" } });
		const actor = makeActor({ items: [stack], isOwner: false });
		expect(await splitStackItem(actor, stack, 2)).toBeNull();
	});

	it("lehnt nicht stapelbare Items und Einzelstapel ab", async () => {
		const sword = makeItem({ name: "Schwert", type: "weapon" });
		const single = makeTorch({ system: { number: 1, price: 2, weight: "none" } });
		const actor = makeActor({ items: [sword, single] });
		expect(await splitStackItem(actor, sword, 1)).toBeNull();
		expect(await splitStackItem(actor, single, 1)).toBeNull();
	});

	it("klemmt count auf 1..number-1 (Über-Anforderung nimmt nur den Rest)", async () => {
		const stack = makeTorch({ system: { number: 5, price: 2, weight: "none" } });
		const actor = makeActor({ items: [stack] });
		const created = await splitStackItem(actor, stack, 99);
		expect(created.system.number).toBe(4);
		expect(stack.updates[0]["system.number"]).toBe(1);
	});

	it("klemmt count < 1 auf 1 hoch", async () => {
		const stack = makeTorch({ system: { number: 3, price: 2, weight: "none" } });
		const actor = makeActor({ items: [stack] });
		const created = await splitStackItem(actor, stack, 0);
		expect(created.system.number).toBe(1);
		expect(stack.updates[0]["system.number"]).toBe(2);
	});

	it("kopiert NICHT das Favoriten-Flag und behält die Behälter-Referenz", async () => {
		const stack = makeTorch({
			system: { number: 4, price: 2, weight: "none", container: "bag-1" },
			flags: { symbaroum: { favorite: true, other: "bleibt" } },
		});
		const actor = makeActor({ items: [stack] });
		const created = await splitStackItem(actor, stack, 2);
		expect(created.system.container).toBe("bag-1");
		expect(created.flags.symbaroum.favorite).toBeUndefined();
		expect(created.flags.symbaroum.other).toBe("bleibt");
	});
});
