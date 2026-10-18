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
 *     width: <number>
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
 * The V1 `close` callback option is intentionally not supported (all previous uses
 * in this system were empty no-ops).
 */
export function symbDialog(options = {}) {
  const { title, content, buttons = {}, default: defaultAction, width } = options;
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

  const config = {
    window: { title: title ?? '' },
    content: content ?? '',
    buttons: v2Buttons,
  };
  if (width !== undefined) config.position = { width };

  dialog = new foundry.applications.api.DialogV2(config);
  dialog.render({ force: true });
  return dialog;
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
