/**
 * Brauen v1: Item-Blatt des neuen Typs „rezeptur“ (Rudolfs Freigabe
 * 02.11.) - Muster TraitSheet/RitualSheet (nur Position + ein PARTS-
 * Template; Fenster/Form/Actions erbt die Basisklasse sheet/item.js).
 *
 * Der Rezeptur-Tab ist GM-Sache (Welt-Taxonomie wie Ressourcen-Kategorie):
 * Drag&drop eines alchemistischen Elixier-Items verknüpft system.target
 * (UUID), denormalisiert die Alchemie-Stufe, setzt die Tradition über die
 * Namen-Zuordnung (brewing.js) und den Regelwert 5 x Listenpreis des
 * Elixiers als Basis-Integer (Orteg). Spieler sehen die Info-Chips
 * (Ziel/Stufe/Tradition/Wert/Besitz) lesend im Beschreibungs-Tab.
 */
import { SymbaroumItemSheet } from './item.js';
import { getElixirTradition } from '../common/brewing.js';
import { isAlchemical } from '../common/elixirs.js';
import { getItemPriceBase } from '../common/currency.js';
// Traditionen v1 (03.11.2026): Labels über die zentralen TRADITION.*-Keys
// (statt der alten REZEPTUR.TRADITION_*-Keys) + Filter der Auswahl auf die
// BEKANNTEN Traditionen der Welt (leere „Hörensagen“-Option bleibt).
import { traditionLabel, knownTraditions } from '../common/tradition.js';

const L = (key) => game.i18n.localize(key);

export class RezepturSheet extends SymbaroumItemSheet {
	static DEFAULT_OPTIONS = {
		position: {
			width: 440,
			height: 640,
		},
	};

	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/sheet/rezeptur.hbs',
		},
	};

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		// Ziel-Elixier lesend auflösen (Name für Info-Zeile/Chips); fehlt die
		// Verknüpfung oder das Quelldokument, bleibt die Platzhalter-Zeile.
		const targetUuid = String(this.item.system?.target ?? '').trim();
		const target = targetUuid !== '' ? foundry.utils.fromUuidSync(targetUuid) : null;
		context.targetUuid = targetUuid;
		context.targetName = target?.name ?? '';
		context.targetImg = target?.img ?? '';
		// Vorlokalisierte Auswahllisten (Muster Bestienkunde/Ressourcen-Kategorie
		// in sheet/item.js - selectOptions ohne localize-Helper).
		const selection = (list) =>
			Object.values(list).map((c) => ({ id: c.id, label: game.i18n.localize(c.label) }));
		context.alchemy_level_selection = selection(game.symbaroum.config.ALCHEMY_LEVEL_SELECTION);
		// Traditionen v1: nur BEKANNTE Traditionen im Dropdown (Setting
		// traditionsKnown; die leere „Hörensagen“-Option bleibt immer).
		const knownIds = new Set(knownTraditions());
		context.rezeptur_tradition_selection = selection(game.symbaroum.config.REZEPTUR_TRADITION_SELECTION).filter(
			(c) => c.id === '' || knownIds.has(c.id)
		);
		context.rezeptur_ownership_selection = selection(game.symbaroum.config.REZEPTUR_OWNERSHIP_SELECTION);
		context.rezeptur_culture_selection = selection(game.symbaroum.config.REZEPTUR_CULTURE_SELECTION);
		context.rezeptur_origin_selection = selection(game.symbaroum.config.REZEPTUR_ORIGIN_SELECTION);
		// Anzeige-Labels vorlokalisiert (kein dynamischer Key-Bau im Template,
		// Lernweis ItemSheets v3.1: Booleans/Labels fertig in JS vorbereiten).
		const level = String(this.item.system?.alchemyLevel ?? '');
		context.alchemyLevelLabel = level !== '' ? L(`ALCHEMY_LEVEL.${level.toUpperCase()}`) : L('ALCHEMY_LEVEL.NONE');
		const tradition = String(this.item.system?.alchemyTradition ?? '');
		context.traditionLabel = tradition !== '' ? traditionLabel(tradition) : L('TRADITION.NONE');
		const ownership = String(this.item.system?.ownership ?? 'owned');
		context.ownershipLabel = L(`REZEPTUR.${ownership.toUpperCase()}`);
		context.inventedChecked = !!this.item.system?.invented;
		return context;
	}

	/* Drag&drop: Elixier-Item (Welt-Item oder Inventarskopie) verknüpfen.
	 * Nur alchemistische Items mit getaggter Alchemie-Stufe; bestehende
	 * GM-Angaben (z.B. abweichender Wert, Bound-Kopie) werden NICHT
	 * still überschrieben - der Drop setzt Ziel, Stufe, Tradition und
	 * nur den Wert, wenn das Feld noch unberührt (0) ist. */
	async _onDrop(event) {
		let dragData = null;
		try {
			dragData = JSON.parse(event.dataTransfer?.getData('text/plain') ?? 'null');
		} catch {
			dragData = null;
		}
		if (dragData?.type !== 'Item') return super._onDrop(event);
		if (!this.isEditable || !this.item.isOwner) return;
		let item = null;
		try {
			item = await Item.fromDropData(dragData);
		} catch {
			item = null;
		}
		if (!item || item.type !== 'equipment' || !isAlchemical(item.system)) {
			ui.notifications.warn(L('REZEPTUR.ERR_DROP_NOT_ELIXIR'));
			return;
		}
		const level = typeof item.system.alchemyLevel === 'string' ? item.system.alchemyLevel : '';
		if (level === '') {
			ui.notifications.warn(L('REZEPTUR.ERR_DROP_NO_LEVEL'));
			return;
		}
		const update = {
			'system.target': item.uuid,
			'system.alchemyLevel': level,
			'system.alchemyTradition': getElixirTradition(item.name),
		};
		const currentPrice = Number(this.item.system?.price);
		if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
			update['system.price'] = (getItemPriceBase(item) ?? 0) * 5;
		}
		await this.item.update(update);
	}
}
