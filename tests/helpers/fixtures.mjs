/**
 * Test-Fixtures für die Symbaroum-Testumgebung v1.
 *
 * Bewusst schlichte Plain-Objekt-Stubs (kein Foundry-Dokument-Framework):
 * Die Produktmodule aus script/common/ arbeiten dokumentagnostisch - sie
 * lesen item.type/item.system/actor.items und rufen update/toObject/
 * createEmbeddedDocuments auf. Genau das bildet MockItem nach.
 *
 * makeActor() instanziiert den globalen Actor-Stub aus tests/setup.mjs,
 * damit instanceof-Prüfungen in mergeStackDrop (sourceParent instanceof
 * Actor) echt greifen - Lernweis: globalThis.Actor muss VOR dem Import der
 * Produktmodule stehen, deshalb importiert diese Datei selbst keins.
 */

let idCounter = 0;
const nextId = (prefix) => `${prefix}-${String(++idCounter)}`;

/** Setzt "system.number"-Pfade (Foundry-Update-Syntax) auf ein Objekt. */
export function applyFlat(target, key, value) {
	const parts = key.split(".");
	let node = target;
	for (let i = 0; i < parts.length - 1; i++) {
		if (node[parts[i]] === undefined || node[parts[i]] === null) node[parts[i]] = {};
		node = node[parts[i]];
	}
	node[parts[parts.length - 1]] = value;
}

/** Flache Kopie eines Daten-Objekts (verhindert Fixture-Überschneidungen). */
export function deepClone(data) {
	return JSON.parse(JSON.stringify(data));
}

/**
 * Item-Stub. Akzeptiert die gleichen Felder wie ein toObject()-Ergebnis:
 * { id?, name?, type?, system?, flags?, parent? }.
 * update(changes) wendet Flach-Schlüssel an und protokolliert die Calls
 * (item.updates), toObject() liefert eine saubere Kopie inklusive _id.
 */
export function makeItem(data = {}) {
	const item = {
		id: data.id ?? nextId("item"),
		name: data.name ?? "Fackel",
		type: data.type ?? "equipment",
		system: data.system ? deepClone(data.system) : {},
		flags: data.flags ? deepClone(data.flags) : {},
		parent: data.parent ?? null,
		updates: [],
	};
	item.toObject = () =>
		deepClone({
			_id: item.id,
			name: item.name,
			type: item.type,
			system: item.system,
			flags: item.flags,
		});
	item.update = async (changes) => {
		item.updates.push(deepClone(changes));
		for (const [key, value] of Object.entries(changes)) applyFlat(item, key, value);
		return item;
	};
	return item;
}

/**
 * Actor-Stub über den globalen MockActor (setup.mjs). items werden per
 * items.get(id) auffindbar gemacht, eingebettete Items bekommen parent
 * zugewiesen. isOwner steuert die Rechte-Gates (mergeStackDrop/
 * splitStackItem), created/deleted/updates protokollieren die
 * Dokument-Operationen.
 */
export function makeActor(options = {}) {
	return new globalThis.Actor(options);
}

/** Standard-Stapel-Fackel (Ausrüstung, stapelbar per Typ-Default). */
export function makeTorch(overrides = {}) {
	return makeItem({
		name: "Fackel",
		type: "equipment",
		system: { number: 1, price: 2, weight: "none" },
		...overrides,
	});
}
