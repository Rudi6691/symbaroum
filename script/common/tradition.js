/**
 * Traditionen v1 (Rudolfs Startsignal „Leg los“ 03.11.2026 — sechstes
 * Arbeitspaket des Erweiterungsprojekts): Traditions-Zuordnung für Kräfte,
 * Rituale, Elixiere usw. (Feld „Traditionswissen?“, Muster „Bewirkt
 * Zustand“), vereinheitlichte Zugangsprüfung (Vorarbeit aus brewing.js),
 * APG-Qualitäts-Geheimnisse (Vault „Geheimnisse der Traditionen“) und
 * die Welt-Steuerung „bekannte Traditionen“ (z. B. Segnungen noch nicht
 * bekannt — steuert NUR die Listen-Sichtbarkeit, nicht die Zugangsprüfung).
 *
 * Datenmodell (template.json, gemeinsamer Template-Block „traditions“,
 * ALLE 12 Item-Typen): system.traditions = Komma-Join-String der
 * Traditions-Ids, system.traditionsActive = dreiwertiges Gate
 * 'true'/'false'/'' (Muster system.elixirEffect.conditionActive: ''
 * ist Altbestand-Ableitung und persistiert erst beim Submit — Ritual
 * mit gefülltem Freitext-Altbestand gilt als „Ja“). Der
 * „Verbotenes Wissen“-Segen nutzt Dasselbe traditions-Feld als
 * Single-Select (genau EINE Id; mehrfach erwerbbar = Segen mehrfach
 * anlegen) — KEIN separates boon-Feld.
 */
const L = (key) => game.i18n.localize(key);

/* ---------------------------------------------------------------- */
/*  Kanonik: die 8 Traditionen                                       */
/* ---------------------------------------------------------------- */

/** Alle Traditionen aus der config-Kanonik (TRADITIONS_LIST). */
function traditionList() {
	return game.symbaroum.config.TRADITIONS_LIST ?? [];
}

/** Lokalisiertes Label einer Tradition (TRADITION.*-Keys). */
export function traditionLabel(id) {
	if (!id) return '';
	return L(`TRADITION.${String(id).toUpperCase()}`);
}

/**
 * Komma-Join-String → Array von GÜLTIGEN Traditions-Ids (leere Teile
 * gefiltert, Duplikate entfernt, unbekannte Ids verworfen — Muster
 * Zustandsdialog: Alt-Ids außerhalb der Chip-Liste bleiben im String
 * erhalten, hier tauchen sie nur nicht auf).
 */
export function parseTraditions(raw) {
	if (typeof raw !== 'string') return [];
	const valid = new Set(traditionList().map((t) => t.id));
	const seen = new Set();
	for (const part of raw.split(',')) {
		const id = part.trim();
		if (id === '' || !valid.has(id) || seen.has(id)) continue;
		seen.add(id);
	}
	return [...seen];
}

/* ---------------------------------------------------------------- */
/*  Bekannte Traditionen (Welt-Setting, GM-Dialog)                   */
/* ---------------------------------------------------------------- */

/**
 * Bekannte Traditionen der Welt (Setting „traditionsKnown“, hooks.js;
 * Standard: alle außer Segnungen/blessings). Steuert NUR, welche
 * Traditionen in Dropdowns/Chips/Filtern auftauchen — KEINE Wirkung
 * auf Zugangsprüfung, Tagging oder Brau-Gate (Rudolfs Klärung j:
 * ein Segnungs-Aktor bleibt spielbar, solange die Tradition „unbe-
 * kannt“ ist). Setzen kann sie der GM über den Einstellungs-Dialog
 * (settings.registerMenu, TraditionsKnownConfig unten).
 */
export function knownTraditions() {
	const valid = new Set(traditionList().map((t) => t.id));
	const stored = game.settings.get('symbaroum', 'traditionsKnown');
	const ids = Array.isArray(stored) ? stored.filter((id) => valid.has(id)) : [];
	return ids;
}

/** Vorlokalisierte Auswahlliste der bekannten Traditionen ({id, label}). */
export function knownTraditionSelection() {
	return knownTraditions()
		.map((id) => ({ id, label: traditionLabel(id) }))
		.filter((t) => t.id !== '');
}

/* ---------------------------------------------------------------- */
/*  „Verbotenes Wissen“ (Segen, mehrfach erwerbbar)                  */
/* ---------------------------------------------------------------- */

/**
 * Ist das Item ein „Verbotenes Wissen“-Segen? Gate: system.reference
 * 'forbiddenknowledge' (config.js-Referenz) ODER Namen-Match (VW
 * existiert nur in Rudolfs Welt — der DE-Basis-Pack enthält keine
 * Segen; das Namens-Match läuft wie bisher in hasTraditionAccess).
 */
export function isForbiddenKnowledge(item) {
	if (!item || item.type !== 'boon') return false;
	if (String(item.system?.reference ?? '').toLowerCase() === 'forbiddenknowledge') return true;
	const n = String(item.name ?? '').toLowerCase();
	return n.includes('verbotenes wissen') || n.includes('forbidden knowledge');
}

/* ---------------------------------------------------------------- */
/*  Item-Traditionen (Feld + Gate)                                   */
/* ---------------------------------------------------------------- */

/**
 * Aufgelöste Traditionen eines Items inkl. abgeleitetem Gate-Wert
 * ('true'/'false'; ''-Altbestand wird NUR für die Anzeige abgeleitet
 * und persistiert erst beim Submit — Muster „Bewirkt Zustand“ v1.3:
 * Ritual mit gefülltem Freitext-Altbestand ⇒ „Ja“, alle anderen ⇒
 * „Nein“). labels sind vorlokalisiert (Beschreibungs-Tab-Anzeige,
 * Kräfte-Tab-Chips).
 */
export function resolveItemTraditions(item) {
	const s = item?.system ?? {};
	const ids = parseTraditions(s.traditions);
	let active = String(s.traditionsActive ?? '');
	if (active === '') {
		const freetext = String(s.tradition ?? '').trim();
		active = item?.type === 'ritual' && freetext !== '' ? 'true' : 'false';
	}
	return { active, ids, labels: ids.map((id) => traditionLabel(id)) };
}

/* ---------------------------------------------------------------- */
/*  Zugangsprüfung (vereinheitlicht; Vorarbeit brewing.js)           */
/* ---------------------------------------------------------------- */

/*
 * Traditions-Zugang (Reihenfolge, Traditionen v1):
 *  1. Fähigkeit/Merkmal/Mystische Kraft mit passender system.reference
 *     (TRAD_*-Keys, config.js — die Kompendium-Fähigkeiten referenzie-
 *     ren exakt diese Ids),
 *  2. „Verbotenes Wissen“-Segen mit GESETZTEM traditions-Feld (v1: Feld
 *     vor Namen — der Single-Select am VW-Segen schreibt genau EINE Id),
 *  3. „Verbotenes Wissen“-Segen mit Namen-Match inkl. lokalisiertem
 *     Label (Altbestand-Fallback, bleibt dauerhaft stehen).
 * Leere Tradition = Hörensagen, immer frei. XP-Abbuchung bleibt
 * manuelle GM-Sache (keine Automatik).
 */
export function hasTraditionAccess(actor, tradition) {
	if (!tradition) return true;
	const items = actor?.items ?? [];
	if (items.some((i) => (i?.system?.reference ?? '') === tradition)) return true;
	if (
		items.some(
			(i) => isForbiddenKnowledge(i) && parseTraditions(i?.system?.traditions).includes(tradition)
		)
	)
		return true;
	const label = traditionLabel(tradition).toLowerCase();
	return items.some((i) => {
		const n = String(i?.name ?? '').toLowerCase();
		if (!n.includes('verbotenes wissen') && !n.includes('forbidden knowledge')) return false;
		return n.includes(label) || n.includes(String(tradition).toLowerCase());
	});
}

/**
 * Zugang zu MINDESTENS EINER der zugeordneten Traditionen (ANY-
 * Semantik, RAW-nah: ein Geheimnis der eigenen Tradition genügt).
 * Keine zugeordneten Traditionen = Hörensagen, immer frei.
 */
export function hasAnyTraditionAccess(actor, traditions) {
	if (!Array.isArray(traditions) || traditions.length === 0) return true;
	return traditions.some((t) => hasTraditionAccess(actor, t));
}

/* ---------------------------------------------------------------- */
/*  APG-Qualitäten → Tradition (Vault „Geheimnisse der Traditionen“) */
/* ---------------------------------------------------------------- */

/*
 * Statische APG-Referenz-Map (Rudolfs 27.10.-Entscheidung, zweigleisig
 * mit den eigenen Rezept-Items je Qualität). Qualitätsgetrieben: der
 * Chip erscheint überall, wo die Qualität sitzt (Vergeltend ist nach
 * APG/Vault eine RÜSTUNGS-Qualität — der Boolean existiert Upstream in
 * template.json armor.qualities.retributive und wird v1 erstmals über
 * die armorQualities-Liste gerendert).
 */
export const QUALITY_TRADITION_MAP = {
	bloodLetting: 'witchcraft', // Aderlass → Hexenwissen
	retributive: 'witchcraft', // Vergeltend → Hexenwissen (RÜSTUNG)
	flaming: 'wizardry', // Flammend → Magierwissen
	poison: 'wizardry', // Giftbeschichtet → Magierwissen
	bane: 'symbolism', // Fluchwaffe → Symbolismus
	acidcoated: 'staffmagic', // Säurebeschichtet → Stabmagie
	concealed: 'sorcery', // Verborgen → Zauberei
	deathrune: 'sorcery', // Todesrune → Zauberei
	desecrated: 'sorcery', // Entweiht → Zauberei
	hallowed: 'theurgy', // Geweiht → Theurgie
	thundering: 'trollsinging', // Donnernd → Trollsingen
};

/** Vorlokalisierte Chip-Labels Qualität → „Geheimnis: <Tradition>“ (nur gemappte). */
export function qualitySecretLabels() {
	const out = {};
	for (const [quality, tradition] of Object.entries(QUALITY_TRADITION_MAP)) {
		out[quality] = `${L('TRADITION.QUALITY_SECRET')} ${traditionLabel(tradition)}`;
	}
	return out;
}

/* ---------------------------------------------------------------- */
/*  GM-Dialog „Bekannte Traditionen“ (settings.registerMenu)         */
/* ---------------------------------------------------------------- */

const { HandlebarsApplicationMixin, Application } = foundry.applications.api;

/**
 * Kleine Einstellungs-Anwendung (Muster SymbaroumConfig, minimal):
 * Checkbox je Tradition, Submit schreibt das Welt-Setting „traditions-
 * Known“ (Array). Aufgerufen über den „Konfigurieren“-Button in der
 * System-Einstellungsliste (registerMenu, GM-only). Steuert NUR die
 * Listen-Sichtbarkeit (Dropdowns/Chips/Filter), nicht die Zugangsprüfung.
 */
export class TraditionsKnownConfig extends HandlebarsApplicationMixin(Application) {
	static DEFAULT_OPTIONS = {
		classes: ['form'],
		tag: 'form',
		form: {
			handler: TraditionsKnownConfig.#submitHandler,
			closeOnSubmit: true,
			submitOnChange: false,
		},
		position: {
			width: 480,
		},
		window: {
			title: 'TRADITION.SETTING_KNOWN',
			contentClasses: ['standard-form'],
		},
	};

	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/traditionsKnownSettings.hbs',
			scrollable: [''],
		},
	};

	async _prepareContext(options) {
		const known = new Set(knownTraditions());
		return {
			traditions: traditionList().map((t) => ({
				id: t.id,
				label: L(t.label),
				checked: known.has(t.id),
			})),
		};
	}

	static async #submitHandler(event, form, formData) {
		const ids = traditionList()
			.map((t) => t.id)
			.filter((id) => formData.object[`known_${id}`]);
		await game.settings.set('symbaroum', 'traditionsKnown', ids);
	}
}
