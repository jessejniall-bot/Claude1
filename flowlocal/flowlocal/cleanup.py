"""Light, rule-based cleanup of transcribed text.

Everything here runs locally with no model or network. Whisper already produces
decent punctuation, so this stage only tidies whitespace, fixes capitalization,
and (optionally) strips filler words.
"""

import re


def clean(
    text: str,
    *,
    auto_capitalize: bool = True,
    collapse_spaces: bool = True,
    remove_fillers: bool = False,
    filler_words=None,
    trailing_space: bool = False,
) -> str:
    if not text:
        return ""

    result = text.strip()

    if remove_fillers and filler_words:
        result = _remove_fillers(result, filler_words)

    if collapse_spaces:
        result = re.sub(r"[ \t]{2,}", " ", result)
        # No space before common punctuation ("word ." -> "word.")
        result = re.sub(r"[ \t]+([,.;:!?])", r"\1", result)

    if auto_capitalize:
        result = _capitalize(result)

    result = result.strip()
    if trailing_space and result:
        result += " "
    return result


def _remove_fillers(text: str, fillers) -> str:
    for word in fillers:
        text = re.sub(rf"(?i)\b{re.escape(word)}\b,?\s*", "", text)
    return re.sub(r"[ \t]{2,}", " ", text).strip()


def _capitalize(text: str) -> str:
    def cap(match):
        return match.group(1) + match.group(2).upper()

    # First letter of the string
    text = re.sub(r"^(\s*)([a-z])", cap, text)
    # First letter after sentence-ending punctuation
    text = re.sub(r"([.!?]\s+)([a-z])", cap, text)
    # Standalone "i" -> "I"
    text = re.sub(r"\bi\b", "I", text)
    return text
