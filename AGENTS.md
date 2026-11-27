# AGENTS.md - Arbeitsregeln für den Symbaroum-V14-Fork

Diese Datei richtet sich an KI-Assistenten (und menschliche Mitwirkende), die
an diesem Fork arbeiten. Sie ist verbindlich; im Zweifel fragen statt bauen.

## 1. Projekt und Branch

- Fork: Rudi6691/symbaroum, Arbeitsbranch `v14` (Foundry VTT 14, Systemversion 40.1.x).
- Rudolf Schmidt ist Eigentümer und Einziger Committer: Er entscheidet über
  Regelinhalte und committed selbst. Kein Release-Bump der Systemversion ohne
  seine ausdrückliche Anweisung.
- Regelinhalt (Regelwerk-Umsetzungen) wird NUR nach Rudolfs expliziter
  Freigabe umgesetzt ("Baue es", "Leg los"). Eine Antwort in einer
  Auswahlrunde ist KEINE Freigabe. Eine Freigabe gilt für den vereinbarten
  Umfang, einmal.

## 2. Bewertungsrunden und rote Testpunkte

- Rote Testpunkte aus Rudolfs Testrunden sind BEWERTUNGSFRAGEN, keine
  Fehlerbehebungsaufträge: nie eigenmächtig "kaputt" Fixen, sondern
  analysieren, Optionen mit Trade-offs vorlegen und Rudolf entscheiden lassen.
- OFFENKUNDIGE Fehler im Bestandsbaum (Tippfehler-Keys, eindeutige Brüche
  ohne Regelinhalt) werden als Bewertungsfrage VOR dem Auslieferungs-
  Schnüren vorgelegt - nicht als Known-Gaps-Eintrag in der fertigen
  Lieferung. Nur echte Bewertungsrunden (regelinhaltlich, mehrere Optionen)
  laufen wie bisher nach der Lieferung. (Verabredung 27.11.2026, Testumgebung v1.1.)
- Läuft eine neue Validierung gegen den bestehenden Baum rot, ist das ein
  Befund fürs Auslieferungsdoc (mit Fundort, Wirkung und Vorschlag), kein
  Stillschweigen-Kandidat und kein eigenmächtiger Fix im selben Zug.

## 3. Testumgebung (ab v1, 26.11.2026)

- Pipeline-Reihenfolge: `npm run validate` (statisch, sekundenschnell, nur
  Node-Builtins) VOR `npm test` (vitest-Unit-Suite). CI läuft beide.
- Neue Tests kommen als neue `tests/unit/*.spec.mjs` hinzu - die vitest-
  Konfiguration includes `tests/unit/` rekursiv, keine Config-Änderung nötig.
- Die Unit-Suite mockt die Foundry-Laufzeit in `tests/setup.mjs` (game, Hooks,
  ui, canvas, CONFIG, foundry.applications.api, globale Actor-/Item-Stubs).
  Zwei Reihenfolge-Regeln sind Lernweis-Kern und dürfen nicht umgestellt
  werden:
    1. `globalThis.Actor`/`globalThis.Item` MÜSSEN vor dem Import der
       Produktmodule stehen (mergeStackDrop prüft instanceof gegen den
       Global; Modul-Scope-Code referenziert game).
    2. `foundry.applications.api` muss VOR dem Import von stacking.js
       existieren, weil der Importzug (transitiv über container.js ->
       resources.js) modernSheetConfig.js lädt, das beim Import
       destrukturiert.
- i18n: de.json und en.json sind die Pflege-Sprachen des Forks (Parität ist
  ein Test). Community-Sprachen (es/fr/it/pt-BR/sv) werden nicht auf Parität
  geprüft.
- Nicht testen (Stand v1): keine Foundry-Lizenz, kein Netz, keine echte
  Foundry-Laufzeit. Was Foundry-Verhalten braucht, ist Phase 3 (Render-Smoke
  mit Playwright, lokal) - erst anfangen, wenn die definierten Auslöser
  dafür stehen.
- Testweltdaten sind Phase 2 (A3): bewusst NICHT in v1.

## 4. Foundry-Lernweise (Codestil betreffend)

- ApplicationV2-Buttons: `event.target.closest(...)` statt `currentTarget`.
- Neue .hbs-Partials in `preloadHandlebarsTemplates()` eintragen.
- Keine verschachtelten Handlebars-ifs im Attribut-Body; Booleans
  JS-seitig vorbereiten.
- template.json-Defaults füllen Altdaten nicht auf: Template-Fallback nutzen.
- Offene AppV2-Fenster: `foundry.applications.instances` (Map); `ui.windows`
  führt nur Legacy-V1-Fenster.
- AppV1-Header-Hooks wirken nicht auf ApplicationV2 (`_getHeaderControls`
  überschreiben statt hoffen).
- AppV2 ohne `scrollY`: Scroll-Retention selbst im `_onRender` handeln.
- CSS-Selektor-Hypothesen gegen die RENDERNDEN Regeln prüfen; nach zwei
  Fehlversuchen Catch-All `host > tag` in Betracht ziehen.
- Shared-Partials nie modern-spezifisch wrappen; Rail als direktes
  Root-Kind behalten.

## 5. Auslieferung

- Namensmuster: `Symbaroum-V14-{Schlagwort}-v{x.y}-*` (Overlay.zip,
  Installation.zip, Auslieferungsdoc).
- Auslieferungsdoc: 1. Befund -> 2. Umsetzung -> 3. Downloads + Hashes -> 4. Commit-Vorschlag (EN, einzeilig, kurz, nicht mehr als 150 Zeichen) -> 5. Versionskontext -> 6. Testplan (Punkt 1 = F5-Neustart der Dev-Instanz) -> Trennlinie -> 7. Testergebnisse als markdown-Checkboxen am Ende.
- Zips mit `python scripts/package_delivery.py --name ... --files ...`
  schnüren (git archive + Overlay, Hash-Tabellen, Roundtrip-Prüfung).
- Neue npm-Abhängigkeiten VOR dem Schnüren auf Peer-Dependency-Konflikte
  mit dem Bestandsbaum prüfen (Registry-Metadaten: peerDependencies,
  peerDependenciesMeta, engines). Lernweis v1.1: foundry-vtt-types (Beta)
  verlangt typescript ^5.4 als Peer, der Legacy-Stack pinnt ^4.0.5 - npm
  install brach mit ERESOLVE ab. Gefundene Konflikte vor der Lieferung
  lösen bzw. zur Bewertungsfrage machen, nicht dem Paket beilegen.
- Commit-Vorschlag nur VORSCHLAGEN: Rudolf committet selbst. Die
  package-lock.json aktualisiert Rudolf per `npm install` im selben Zug.

## 6. UI-/Dialog-Konventionen
(verbindlich; jede Berührung eines Pakets löst die Absicherungspflicht aus)

- STEUERELEMENTE: Exklusive Wahl = Radio-Gruppe (vollständig sichtbar oder
  vollständig versteckt, nie teilweise; Vorbelegung nach RAW, d.h. der
  Stufe der Kraft entsprechend). Unabhängige Optionen = Checkbox. Keine
  gemischten Zeilen, keine unbeschrifteten Inputs. Jede sichtbare Zeile
  über i18n-Key (de+en).
- KANONIK VOR RADIO: Was RAW für eine Stufe festlegt (z.B. Serien-
  Vorbelegung ab Adept), bekommt KEIN wählbares Steuerelement — der Wert
  ist fix, nicht übersteuerbar.
- SICHTBARKEIT STATT UMBAU: Optionale Elemente werden über Bedingungen
  (Referenz, Stufe, Modus) ausgeblendet; der Dialogfluss wird nicht
  umgebaut oder ersetzt.
- ZIELKETTE: Wirkungen über mehrere Ziele laufen als EIN Kettendialogfluss
  in Reihenfolge der Zielauswahl, nie als parallele Einzelkarten. Das
  Abbruchverhalten (ganze Kette abbrechen oder Rest weiterführen) wird
  je Kraft passend zur Regelung festgelegt und in der Umsetzung
  dokumentiert.
- MASTER-RAHMEN (Kraft-Anwendung): Der Master-Rahmen ist der zentrale
  Dialogfluss zum Anwenden von Kräften — vom Auslösen über Zielauswahl
  und Optionsabfrage bis zur Würfelung und Chat-Karte. Neue
  Automatisierungen ergänzen ihre Felder/Radios als Schritte in DIESEM
  Fluss, statt eigene parallele Dialoge zu öffnen.
- KEINE BLATT-CHROME: Keine Cross-Radios auf Waffen-/Rüstungsblättern
  (MM2-Konzept §7.2); native Stats-Tabs genügen.
- ABSICHERUNG: Jede berührte Konvention bekommt beim ersten Kontakt einen
  Unit-Test (TDD), greifbare Regeln zusätzlich als statische Checks in
  scripts/validate.mjs. Konventionsbruch aus einer Testrunde = roter
  Testpunkt = Bewertungsfrage.
  