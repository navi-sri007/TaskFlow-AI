// services/dateUpdate.js — merge date/time updates (IST), store UTC
const { parseDate } = require("./dateParser");
const { getISTDateParts, istToUTC } = require("../utils/dateFormatter");

const TIME_ONLY_RE = /^\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i;
const EXPLICIT_TIME_RE =
  /(?:\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))/i;

function hasExplicitTimeInInput(value) {
  return EXPLICIT_TIME_RE.test(String(value || ""));
}

function isTimeOnlyInput(value) {
  return TIME_ONLY_RE.test(String(value || "").trim());
}

/** @returns {'time-only'|'date-only'|'datetime'} */
function classifyUpdateMode(value) {
  const v = String(value || "").trim();
  if (!v) return "datetime";
  if (isTimeOnlyInput(v)) return "time-only";
  if (!hasExplicitTimeInInput(v)) return "date-only";
  return "datetime";
}

function detectChangeType(oldUtc, newUtc) {
  const oldIST = getISTDateParts(oldUtc);
  const newIST = getISTDateParts(newUtc);
  const dateChanged =
    oldIST.year !== newIST.year ||
    oldIST.month !== newIST.month ||
    oldIST.day !== newIST.day;
  const timeChanged =
    oldIST.hour !== newIST.hour || oldIST.minute !== newIST.minute;
  if (dateChanged && !timeChanged) return "date";
  if (!dateChanged && timeChanged) return "time";
  if (dateChanged && timeChanged) return "date and time";
  return "unchanged";
}

/**
 * Apply a schedule change while preserving date or time when only one is given.
 * @param {Date|null|undefined} existingUtc - current stored instant
 * @param {string} newValue - user/AI value (e.g. "3pm", "tomorrow", "tomorrow 3pm")
 * @returns {Promise<{ date?: Date, changeType?: string, mode?: string, error?: string }>}
 */
async function applyDateTimeUpdate(existingUtc, newValue) {
  const value = String(newValue || "").trim();
  if (!value) {
    return { error: "Empty date/time value" };
  }

  const mode = classifyUpdateMode(value);

  if (!existingUtc) {
    const date = await parseDate(value);
    if (!date) return { error: `Failed to parse: ${value}` };
    return { date, changeType: "date and time", mode: "datetime" };
  }

  const existing = new Date(existingUtc);
  const existingIST = getISTDateParts(existing);

  if (mode === "time-only") {
    const parsed = await parseDate(value);
    if (!parsed) return { error: `Failed to parse time: ${value}` };
    const timeIST = getISTDateParts(parsed);
    const date = istToUTC(
      existingIST.year,
      existingIST.month,
      existingIST.day,
      timeIST.hour,
      timeIST.minute,
      0,
    );
    return { date, changeType: "time", mode };
  }

  if (mode === "date-only") {
    const parsed = await parseDate(value);
    if (!parsed) return { error: `Failed to parse date: ${value}` };
    const dateIST = getISTDateParts(parsed);
    const date = istToUTC(
      dateIST.year,
      dateIST.month,
      dateIST.day,
      existingIST.hour,
      existingIST.minute,
      existingIST.second || 0,
    );
    return { date, changeType: "date", mode };
  }

  const date = await parseDate(value);
  if (!date) return { error: `Failed to parse date/time: ${value}` };
  const changeType = detectChangeType(existing, date);
  return { date, changeType, mode: "datetime" };
}

module.exports = {
  hasExplicitTimeInInput,
  isTimeOnlyInput,
  classifyUpdateMode,
  detectChangeType,
  applyDateTimeUpdate,
};
