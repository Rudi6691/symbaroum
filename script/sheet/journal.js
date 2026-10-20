/**
 * The wide Symbaroum journal entry sheet (V13 opt-in sheet class,
 * registered in script/common/hooks.js).
 *
 * Foundry V14, 7.2.9: migrated from the deprecated ApplicationV1 base
 * (foundry.appv1.sheets.JournalSheet) to the ApplicationV2
 * JournalEntrySheet - the same base the V14 core uses for its own journal
 * entry sheets.
 *
 * Migration notes:
 * - The V1 class chain (SymbaroumJournalSheet -> JournalSheet) only widened
 *   the window to 1268px, added the "symbaroum-mod" class for the bithir-style
 *   journal CSS and provided the V1 _onConfigureSheet helper for the sheet
 *   configuration dialog. Under V2 the first two are plain DEFAULT_OPTIONS,
 *   and the sheet configuration is a core header control (DocumentSheetV2
 *   "configure" control) - the V1 helper is not needed anymore.
 * - The old SymbaroumJournalSheet intermediate class is dropped; nothing
 *   outside this file referenced it (hooks.js only imports SymbaroumWide),
 *   and no system code used its get journal() accessor.
 * - DEFAULT_OPTIONS merge through the class chain (arrays concatenate,
 *   objects merge): the explicit class list keeps the core layout classes
 *   (sheet/journal-sheet/journal-entry) that the V14 core CSS and the
 *   7.2.9 CSS block scope on - same explicit pattern as the item sheets
 *   (the verified frame: symbaroum sheet item application).
 * - Core journal window stays resizable (V13 behaviour); the initial
 *   height follows the V14 core default (800) instead of the V13 default -
 *   the window geometry is part of the A5 backlog step together with the
 *   item sheet resizing.
 * - hooks.js registration stays untouched (label + makeDefault: false):
 *   the sheet remains the opt-in choice in a journal entry's sheet
 *   configuration.
 * - The bithir look (parchment background, ornamental border-image frame,
 *   Primitive-font title input, light sidebar controls) is re-scoped from
 *   the V1 window chrome to the V2 DOM in the 7.2.9 CSS block at the end
 *   of css/symbaroum.css.
 */
export class SymbaroumWide extends foundry.applications.sheets.journal.JournalEntrySheet {
    static DEFAULT_OPTIONS = {
        classes: ['symbaroum-mod', 'journal-sheet', 'journal-entry', 'sheet'],
        position: {
            width: 1268,
            // 7.2.10 A5-light: height "auto" opens the wide journal with
            // its content height instead of the core's 800px default. The
            // core's #onWindowResizeStart converts "auto" to a pixel value
            // on the first resize drag, so the window stays resizable.
            height: 'auto',
        },
    };
}
