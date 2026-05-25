// services/dateParser.js
const chrono = require("chrono-node");
const {
  getISTDateParts,
  getISTWeekday,
  istToUTC,
  formatISTDate,
} = require("../utils/dateFormatter");

/**
 * Custom parser for weekday references (IST calendar)
 */
function parseWeekdayReference(dateString, referenceDate = new Date()) {
  const lowerInput = dateString.toLowerCase();

  const weekdays = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const ist = getISTDateParts(referenceDate);
  const currentWeekday = getISTWeekday(referenceDate);

  let targetWeekday = null;
  let daysToAdd = null;

  const nextMatch = lowerInput.match(
    /next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/,
  );
  if (nextMatch) {
    targetWeekday = weekdays[nextMatch[1]];
    daysToAdd = targetWeekday - currentWeekday;
    if (daysToAdd <= 0) daysToAdd += 7;
    else daysToAdd += 7;
  }

  const thisMatch = lowerInput.match(
    /this\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/,
  );
  if (!daysToAdd && thisMatch) {
    targetWeekday = weekdays[thisMatch[1]];
    daysToAdd = targetWeekday - currentWeekday;
    if (daysToAdd < 0) daysToAdd += 7;
  }

  const weekdayMatch = lowerInput.match(
    /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/,
  );
  if (
    !daysToAdd &&
    weekdayMatch &&
    !lowerInput.includes("next") &&
    !lowerInput.includes("this")
  ) {
    targetWeekday = weekdays[weekdayMatch[1]];
    daysToAdd = targetWeekday - currentWeekday;
    if (daysToAdd <= 0) daysToAdd += 7;
  }

  if (daysToAdd == null) return null;

  const ref = new Date(Date.UTC(ist.year, ist.month, ist.day));
  ref.setUTCDate(ref.getUTCDate() + daysToAdd);

  let hour = 9;
  let minute = 0;

  const timeMatch = dateString.match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))/i,
  );
  if (timeMatch) {
    const timeStr = timeMatch[1];
    if (timeStr.includes(":")) {
      const [h, m] = timeStr.split(":");
      hour = parseInt(h, 10);
      minute = parseInt(m, 10);
    } else {
      const match = timeStr.match(/(\d+)\s*(am|pm)/i);
      if (match) {
        hour = parseInt(match[1], 10);
        const period = match[2].toLowerCase();
        if (period === "pm" && hour !== 12) hour += 12;
        if (period === "am" && hour === 12) hour = 0;
      }
    }
  }

  const result = istToUTC(
    ref.getUTCFullYear(),
    ref.getUTCMonth(),
    ref.getUTCDate(),
    hour,
    minute,
    0,
  );

  console.log(
    `📅 Custom parser: "${dateString}" → ${daysToAdd} days (IST) → ${result.toISOString()}`,
  );
  return result;
}

/**
 * Parse natural language dates as IST, return UTC Date for MongoDB
 * @param {string} dateString
 * @returns {Promise<Date|null>}
 */
async function parseDate(dateString) {
  if (!dateString) return null;

  try {
    const now = new Date();
    let parsedUTC = null;

    const weekdayDate = parseWeekdayReference(dateString, now);
    if (weekdayDate) {
      parsedUTC = weekdayDate;
    }

    if (!parsedUTC) {
      const results = chrono.parse(dateString, now, { forwardDate: true });
      if (!results.length) return null;

      const start = results[0].start;
      let year = start.get("year");
      const month = start.get("month") - 1;
      const day = start.get("day");
      console.log("No change");
      console.log(year);

      // If chrono didn't set an explicit year, pick the next occurrence relative to IST "now"
      const nowIst = getISTDateParts(now);
      if (!start.isCertain || !start.isCertain("year") || year == null) {
        year = nowIst.year;
        // If parsed month/day is before today's IST date, advance to next year
      }

      // Handle two-digit years mistakenly parsed (e.g., '27' -> 2027)
      if (typeof year === "number" && year > 0 && year < 100) {
        year = 2000 + year;
        console.log(year);
        console.log("year+2000");
      }

      const hasExplicitTime =
        /(\d{1,2}:\d{2}\s*(am|pm)?|\d{1,2}\s*(am|pm))/i.test(dateString);

      const hour = hasExplicitTime ? (start.get("hour") ?? 9) : 9;
      const minute = hasExplicitTime ? (start.get("minute") ?? 0) : 0;
      const second = start.get("second") ?? 0;

      parsedUTC = istToUTC(year, month, day, hour, minute, second);
    }

    console.log(`📅 Input: "${dateString}"`);
    console.log(`   UTC storage: ${parsedUTC.toISOString()}`);
    console.log(`   IST display: ${formatISTDate(parsedUTC)}`);

    return parsedUTC;
  } catch (error) {
    console.error("Date parsing error:", error);
    return null;
  }
}

function testDateParser() {
  const testCases = [
    "next saturday 10 am",
    "next saturday",
    "this monday",
    "friday 2pm",
    "tomorrow 5pm",
    "may 25th 3pm",
  ];

  console.log("\n🧪 TESTING DATE PARSER:");
  testCases.forEach(async (test) => {
    const result = await parseDate(test);
    if (result) {
      console.log(`"${test}" → ${result.toISOString()}`);
    }
  });
}

module.exports = { parseDate, testDateParser };
