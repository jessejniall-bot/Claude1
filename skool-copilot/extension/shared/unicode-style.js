/* =====================================================================
   Skool Community Copilot — Unicode text styling
   ---------------------------------------------------------------------
   Skool posts have no rich text, so creators style words with Unicode
   math alphanumerics (𝗯𝗼𝗹𝗱, 𝘪𝘵𝘢𝘭𝘪𝘤). These helpers convert plain
   A-Z / a-z / 0-9 to the sans-serif variants; everything else (emoji,
   punctuation, accents) passes through untouched.
   ===================================================================== */
(function (SC) {
  "use strict";

  // Code-point bases for the sans-serif math alphabets.
  var STYLES = {
    bold:       { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
    italic:     { upper: 0x1d608, lower: 0x1d622, digit: null },
    boldItalic: { upper: 0x1d63c, lower: 0x1d656, digit: 0x1d7ec },
  };

  function styleText(text, kind) {
    var map = STYLES[kind] || STYLES.bold;
    var out = "";
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0x41 && code <= 0x5a) {
        out += String.fromCodePoint(map.upper + (code - 0x41));
      } else if (code >= 0x61 && code <= 0x7a) {
        out += String.fromCodePoint(map.lower + (code - 0x61));
      } else if (code >= 0x30 && code <= 0x39 && map.digit) {
        out += String.fromCodePoint(map.digit + (code - 0x30));
      } else {
        out += text[i];
      }
    }
    return out;
  }

  // Detect whether text already contains styled characters (so toggling
  // twice doesn't double-encode — styled chars simply pass through, but
  // callers can use this to offer an "already styled" hint).
  function isStyled(text) {
    for (var i = 0; i < text.length; i++) {
      var code = text.codePointAt(i);
      if (code >= 0x1d400 && code <= 0x1d7ff) return true;
      if (code > 0xffff) i++; // skip low surrogate
    }
    return false;
  }

  // Apply a style to the current selection of an <input>/<textarea>.
  // With no selection, styles the whole value.
  function styleSelection(el, kind) {
    var value = el.value;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    if (start == null || end == null || start === end) {
      el.value = styleText(value, kind);
      return;
    }
    el.value =
      value.slice(0, start) + styleText(value.slice(start, end), kind) + value.slice(end);
    el.setSelectionRange(start, start);
  }

  SC.uni = { style: styleText, isStyled: isStyled, styleSelection: styleSelection };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
