// utils/dateFormatter.js
// IST (Asia/Kolkata) display; MongoDB stores UTC instants.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getISTDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Wall-clock IST components → UTC Date for DB storage */
function istToUTC(year, month, day, hour = 0, minute = 0, second = 0) {
  return new Date(
    Date.UTC(year, month, day, hour, minute, second) - IST_OFFSET_MS,
  );
}

/** Start of calendar day in IST, as UTC instant */
function getISTStartOfDay(date = new Date()) {
  const { year, month, day } = getISTDateParts(date);
  return istToUTC(year, month, day, 0, 0, 0);
}

/** Start of next calendar day in IST, as UTC instant */
function getISTStartOfNextDay(date = new Date()) {
  const start = getISTStartOfDay(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** Weekday (0=Sun) for the IST calendar date */
function getISTWeekday(date = new Date()) {
  const { year, month, day } = getISTDateParts(date);
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

/** { start, end } UTC range for an IST calendar day (end exclusive) */
function getISTDayRange(date = new Date()) {
  return {
    start: getISTStartOfDay(date),
    end: getISTStartOfNextDay(date),
  };
}

function formatISTDate(date) {
  if (!date) return "No date";

  const utcDate = new Date(date);

  const formatted = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(utcDate);

  const parts = formatted.split(",");
  const dateParts = parts[0].split("/");
  const timeParts = parts[1].trim();

  return `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}, ${timeParts}`;
}

function formatDisplayDate(date) {
  if (!date) return "No date set";

  const options = {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };

  return new Intl.DateTimeFormat("en-IN", options).format(new Date(date));
}

function debugDate(date, label = "Date") {
  if (!date) return;
  const d = new Date(date);
  console.log(`${label}:`);
  console.log(`  UTC: ${d.toISOString()}`);
  console.log(`  IST: ${formatISTDate(d)}`);
}

module.exports = {
  IST_OFFSET_MS,
  getISTDateParts,
  istToUTC,
  getISTStartOfDay,
  getISTStartOfNextDay,
  getISTWeekday,
  getISTDayRange,
  formatISTDate,
  formatDisplayDate,
  debugDate,
};
