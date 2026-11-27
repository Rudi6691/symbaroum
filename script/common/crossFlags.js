/**
 * MM-Paket 2 (B2 v2 „Rüstungs-Cross“, Konzept Runde 4 §3.7): Zentrale,
 * rein lesende Auflösung der Cross-Flag-Radio-Vorbelegung.
 *
 * AGENTS.md §6 „KANONIK VOR RADIO“: Die Kanonik (CROSS_WEAPON_TRAITS /
 * CROSS_ARMOR_TRAITS aus config.js) bestimmt die Vorbelegung des Radios;
 * ein gespeicherter SL-Wert gewinnt dagegen immer.
 *
 * B2-v2-Fix (Testrunde 27./28.11., Punkt 2): Der template-Default
 * 'none' (seit Commit A in jedem Item materialisiert) schlug bisher die
 * Kanonik-Vorbelegung, sobald das Blatt einmal submittet wurde - das
 * Radio log für Gepanzert/Robust, obwohl die Engine (Kanonik ODER Flag)
 * das Item weiterhin aufnimmt. Auflösung: gespeichertes 'none' wird wie
 * ein LEERER Stand behandelt (Vorbelegung greift); die Abwahl eines
 * Cross-Items läuft bewusst über die leeren Pflege-Felder (Wert-Gate),
 * nicht über das Radio.
 */
export function resolveCrossFlagDisplay(stored, itemType, reference) {
	const value = String(stored ?? "").trim();
	if (value !== "" && value !== "none") return value;
	return crossFlagPreset(itemType, reference);
}

export function crossFlagPreset(itemType, reference) {
	/* Echte Waffen-/Rüstungs-Typen wirken über ihren Typ (Typ gewinnt). */
	if (itemType === "weapon" || itemType === "armor") return itemType;
	const cfg = game.symbaroum.config;
	if (cfg.CROSS_WEAPON_TRAITS[reference]) return "weapon";
	if (cfg.CROSS_ARMOR_TRAITS[reference]) return "armor";
	return "none";
}
