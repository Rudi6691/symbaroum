import { SymbaroumItemSheet } from './item.js';

/**
 * Behältersystem (Projekt "Behälter" v1): Item-Blatt des neuen Typs
 * "container" - Titel/Bild über den Standard-Header, Gewichtskategorie
 * (A39-Liste), Fassungsvermögen in GE (0 = unbegrenzt), die beiden
 * Zustände "mitgeführt"/"auf Belastung anrechnen" sowie die Sonder-
 * eigenschaften "Inhalt wiegt nichts" (Magiebeutel) und optionales
 * Font-Awesome-Icon (leer = Item-Bild). Das Behälter-Geld wird hier als
 * reiner Anzeige-/GM-Wert gepflegt; Einlagern/Entnehmen läuft über den
 * Kontextdialog im modernen Ausrüstungs-Tab (atomar mit dem Aktor-Geld).
 * Muster: EquipmentSheet (ein Content-Part, Position 700x600).
 */
export class ContainerSheet extends SymbaroumItemSheet {
	static DEFAULT_OPTIONS = {
		position: {
			width: 440,
			height: 640,
		},
	};

	static PARTS = {
		main: {
			template: 'systems/symbaroum/template/sheet/container.hbs',
		},
	};
}
