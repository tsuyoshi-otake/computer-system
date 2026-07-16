export function hasCopySelection(input, documentSelection) {
  return (
    input.selectionStart !== input.selectionEnd ||
    documentSelection?.isCollapsed === false
  );
}

export function insertPastedCommand(
  value,
  pastedText,
  selectionStart,
  selectionEnd,
  maximumLength,
) {
  const normalized = pastedText.replace(/\r\n?|\n/gu, " ");
  const start = clamp(selectionStart, 0, value.length);
  const end = clamp(selectionEnd, start, value.length);
  const prefix = value.slice(0, start);
  const suffix = value.slice(end);
  const available = Math.max(0, maximumLength - prefix.length - suffix.length);
  const inserted = normalized.slice(0, available);
  return {
    cursor: prefix.length + inserted.length,
    value: `${prefix}${inserted}${suffix}`,
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
