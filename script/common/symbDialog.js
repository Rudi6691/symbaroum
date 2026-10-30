/**
 * Compatibility helper for the legacy AppV1 `Dialog` (deprecated since Foundry VTT V13,
 * removal scheduled for V16).
 *
 * Accepts the classic V1 options object:
 *   {
 *     title: <string>,
 *     content: <html string>,
 *     buttons: { <key>: { icon, label, callback(html) } },
 *     default: <key of the default button>,
 *     width: <number>  (default 400, matching the V1 Dialog)
 *     resizable: <boolean> (Kosmetik v1.1; default true, opt-out via
 *               `resizable: false`)
 *   }
 *
 * and creates, renders and returns a foundry.applications.api.DialogV2 instance.
 *
 * Differences to V1 that this helper compensates for:
 *  - V1 buttons are a keyed object, V2 buttons are an array of {action, label, ...}
 *  - V1 icons are HTML strings ('<i class="fas fa-check"></i>'),
 *    V2 icons are plain FontAwesome class strings ('fas fa-check')
 *  - V1 button callbacks receive a jQuery-like `html` array; the callbacks here are
 *    invoked with the same shape: a one-element array containing the dialog's root
 *    element, so existing `html[0].querySelector(...)` callback code keeps working.
 *  - V1 dialogs were rendered by calling `render(true)`; DialogV2 instances are
 *    rendered by this helper.
 *
 * Kosmetik v1.1 (Rudolfs Wunsch, gilt zentral fuer ALLE System-Dialoge):
 * Die Dialogbreite skaliert mit der Foundry-Core-Schriftgroesse (Client-Setting
 * "Schriftgroesse", core.fontSize, Slider 1-10 mit Default 5). LERNWEIS V14:
 * Das Setting setzt NICHT mehr die Root-Schriftgroesse des Dokuments - das
 * war die Mechanik bis Core V12. Core V13/V14 skalieren stattdessen eine
 * rem-basierte Typo-Skala (--font-size-N-Variablen auf body); documentElement
 * bleibt konstant 16 px. Die Kosmetik-v1-Messung am Root lieferte daher immer
 * Faktor 1 (Rudolfs Testrunde: Dialogtext wächst, Fensterbreite nicht). Der
 * Faktor wird jetzt in _coreFontScale() aus dem Setting selbst abgeleitet
 * (Slider-Index -> px-Tabelle [8/10/12/14/16/18/20/24/28/32], Index 5 =
 * 16 px), mit der gemessenen Root-px als Fallback-Kette fuer alte Core-
 * Versionen und Module, die die Root-Schriftgroesse doch direkt setzen.
 * Bei Schriftgroesse 5 (Rudolfs Referenz) ist der Faktor exakt 1, die
 * bisherigen Breiten bleiben also unveraendert.
 *
 * Kosmetik v1.1 (Rudolfs Wunsch aus der Testrunde): Dialoge sind per Default
 * groessenveraenderbar (vorher Opt-in). ApplicationV2 liefert den Resize-
 * Handle und speichert die Fenstergroesse pro User.
 *
 * The V1 `close` callback option is intentionally not supported (all previous uses
 * in this system were empty no-ops).
 */
export function symbDialog(options = {}) {
  const { title, content, buttons = {}, default: defaultAction, width, resizable = true } = options;
  let dialog = null;

  const v2Buttons = Object.entries(buttons).map(([action, button]) => ({
    action,
    label: button.label ?? action,
    icon: _iconClasses(button?.icon),
    default: action === defaultAction,
    ...(button?.callback instanceof Function
      ? { callback: (event, btn) => button.callback([dialog.element], event, btn) }
      : {}),
  }));

  // DialogV2 cleans string content with foundry.utils.cleanHTML, which strips
  // the class attributes from the dialog templates. All system dialog styling
  // in scss/chat/_dialog.scss (.symbaroum.dialog label banners, input chrome,
  // .lblfavour, ...) is keyed on those classes, so a cleaned string loses the
  // V13 look. Passing a pre-built DOM element skips the cleaning entirely
  // ("If string, the content is cleaned ... Otherwise, the content is not
  // cleaned", Foundry V14 DialogV2 documentation).
  // NOTE: the element passed to DialogV2 must not have any attributes
  // (DialogV2._initializeApplicationOptions throws "config.content element
  // must have no attributes"), so the attribute-free wrapper <div> itself is
  // passed. The classed template root (e.g. <div class="symbaroum dialog">)
  // lives inside it as a child and keeps its classes.
  let domContent;
  if (typeof content === "string") {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = content ?? "";
    domContent = wrapper;
  } else {
    domContent = content ?? "";
  }

  const config = {
    // Tag every dialog created here so css/symbaroum.css can restore the
    // previous AppV1 dialog chrome (horizontal button row, window frame
    // free of native <dialog> user-agent styles) on the DialogV2 window.
    // A25 (optics): call sites can pass further marker classes - the chain
    // confirmation dialog adds .chain-confirm for its smaller Ja/Nein buttons
    classes: ["symb-dialog", ...(options.classes ?? [])],
    window: {
      title: title ?? '',
      // Kosmetik v1.1 (Rudolfs Wunsch aus der Testrunde): ALLE symbDialoge
      // sind per Default groessenveraenderbar (vorher Opt-in) - Geld,
      // Erfahrung, Eigenschaften, Ausruestung, Behaelter-Kontextmenue-Dialoge
      // usw. sind damit abgedeckt, ohne die 42 Aufrufstellen einzeln anzufassen.
      // Opt-out fuer einzelne Stellen: `resizable: false`.
      ...(resizable === false ? {} : { resizable: true }),
    },
    content: domContent,
    buttons: v2Buttons,
  };
  // The legacy V1 Dialog rendered with a default window width of 400px; ApplicationV2
  // defaults to "auto" which stretches the flex rows of the roll dialogs. Restore the
  // previous look unless the call site requests an explicit width.
  // Kosmetik v1.1: width is scaled with the core font size factor (see header
  // comment and _coreFontScale) so the dialog geometry follows the client's
  // font size setting.
  const baseWidth = width ?? 400;
  config.position = { width: Math.round(baseWidth * _coreFontScale()) };

  dialog = new foundry.applications.api.DialogV2(config);
  dialog.render({ force: true });
  return dialog;
}

/**
 * Kosmetik v1.1: effective core font size scale (factor relative to 16 px),
 * used to scale all system dialog widths.
 *
 * Core V13/V14 changed how the "font size" client setting (core.fontSize,
 * slider 1-10, default 5) takes effect: it no longer touches the document
 * root font size (that was the pre-V13 mechanic and still is some modules')
 * but scales a rem-based type scale (--font-size-N variables on body).
 * Measuring the root element therefore always yields 16 px under V14
 * (v1 test result: dialog text grows, window width does not).
 *
 * Chain:
 *  1. If the measured root font size deviates from 16 px (old core or a
 *     module applying the legacy mechanic), use it - robust fallback.
 *  2. Otherwise derive the factor from the setting itself via the
 *     documented pixel table. Index 5 = 16 px = factor 1.
 * Diagnostic: if a future core update drifts from the table, compare
 * `game.settings.get("core", "fontSize")` with the computed font size of a
 * dialog element (getComputedStyle) - see the delivery doc, section 6.
 *
 * @returns {number}
 */
const CORE_FONT_SIZE_PX = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32];
function _coreFontScale() {
  const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  if (Math.abs(rootFontSizePx - 16) > 0.25) return rootFontSizePx / 16;
  const index = Number(game?.settings?.get?.("core", "fontSize")) || 5;
  return (CORE_FONT_SIZE_PX[index - 1] ?? 16) / 16;
}

/**
 * Extract FontAwesome classes from a legacy V1-style icon HTML string.
 * '<i class="fas fa-check"></i>' -> 'fas fa-check'
 * Values that already are class lists are returned unchanged.
 * @param {string} icon
 * @returns {string|undefined}
 */
function _iconClasses(icon) {
  if (typeof icon !== 'string') return undefined;
  const match = icon.match(/class=["']([^"']+)["']/i);
  return (match ? match[1] : icon).trim();
}
