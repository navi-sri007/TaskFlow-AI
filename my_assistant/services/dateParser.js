// services/dateParser.js
const chrono = require("chrono-node");

/**
 * Custom parser for weekday references
 */
function parseWeekdayReference(dateString, referenceDate = new Date()) {
  const lowerInput = dateString.toLowerCase();

  // Weekday mapping
  const weekdays = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  // Check for "next [weekday]" pattern
  const nextMatch = lowerInput.match(
    /next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/,
  );
  if (nextMatch) {
    const targetWeekday = weekdays[nextMatch[1]];
    const currentWeekday = referenceDate.getDay();

    // Calculate days to add
    let daysToAdd = targetWeekday - currentWeekday;
    if (daysToAdd <= 0) {
      daysToAdd += 7; // Go to next week
    } else {
      daysToAdd += 7; // Ensure it's the "next" week, not this week
    }

    const resultDate = new Date(referenceDate);
    resultDate.setDate(referenceDate.getDate() + daysToAdd);

    console.log(
      `📅 Custom parser: "${nextMatch[0]}" → ${daysToAdd} days from now → ${resultDate}`,
    );
    return resultDate;
  }

  // Check for "this [weekday]" pattern
  const thisMatch = lowerInput.match(
    /this\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/,
  );
  if (thisMatch) {
    const targetWeekday = weekdays[thisMatch[1]];
    const currentWeekday = referenceDate.getDay();

    let daysToAdd = targetWeekday - currentWeekday;
    if (daysToAdd < 0) {
      daysToAdd += 7;
    }

    const resultDate = new Date(referenceDate);
    resultDate.setDate(referenceDate.getDate() + daysToAdd);

    console.log(
      `📅 Custom parser: "${thisMatch[0]}" → ${daysToAdd} days from now → ${resultDate}`,
    );
    return resultDate;
  }

  // Check for just weekday name (assume "this" or "coming")
  const weekdayMatch = lowerInput.match(
    /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/,
  );
  if (
    weekdayMatch &&
    !lowerInput.includes("next") &&
    !lowerInput.includes("this")
  ) {
    const targetWeekday = weekdays[weekdayMatch[1]];
    const currentWeekday = referenceDate.getDay();

    let daysToAdd = targetWeekday - currentWeekday;
    if (daysToAdd <= 0) {
      daysToAdd += 7;
    }

    const resultDate = new Date(referenceDate);
    resultDate.setDate(referenceDate.getDate() + daysToAdd);

    console.log(
      `📅 Custom parser: "${weekdayMatch[0]}" (assumed this week) → ${daysToAdd} days → ${resultDate}`,
    );
    return resultDate;
  }

  return null;
}

/**
 * Parse natural language dates and return UTC date object
 * @param {string} dateString
 * @returns {Promise<Date|null>}
 */
async function parseDate(dateString) {
  if (!dateString) return null;

  try {
    const now = new Date();
    let parsedDate = null;
    let hasExplicitTime = false;

    // FIRST: Try custom weekday parser
    const weekdayDate = parseWeekdayReference(dateString, now);
    if (weekdayDate) {
      parsedDate = weekdayDate;

      // Check for time in the string
      const timeMatch = dateString.match(
        /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))/i,
      );
      if (timeMatch) {
        hasExplicitTime = true;
        // Parse the time
        const timeStr = timeMatch[1];
        let hours = 0,
          minutes = 0;

        if (timeStr.includes(":")) {
          const [h, m] = timeStr.split(":");
          hours = parseInt(h);
          minutes = parseInt(m);
        } else {
          const match = timeStr.match(/(\d+)\s*(am|pm)/i);
          if (match) {
            hours = parseInt(match[1]);
            const period = match[2].toLowerCase();
            if (period === "pm" && hours !== 12) hours += 12;
            if (period === "am" && hours === 12) hours = 0;
          }
        }

        parsedDate.setHours(hours, minutes, 0, 0);
      } else {
        // Default to 9 AM
        parsedDate.setHours(9, 0, 0, 0);
      }
    }

    // SECOND: Fall back to chrono-node if custom parser didn't match
    if (!parsedDate) {
      parsedDate = chrono.parseDate(dateString, now, {
        forwardDate: true,
      });

      if (!parsedDate) {
        return null;
      }

      // Check if user specified a time
      hasExplicitTime = /(\d{1,2}:\d{2}\s*(am|pm)?|\d{1,2}\s*(am|pm))/i.test(
        dateString,
      );

      // If no explicit time, set default to 9 AM
      if (!hasExplicitTime) {
        parsedDate.setHours(9, 0, 0, 0);
      }
    }

    // CRITICAL: Convert to UTC for MongoDB storage
    const utcDate = new Date(
      Date.UTC(
        parsedDate.getFullYear(),
        parsedDate.getMonth(),
        parsedDate.getDate(),
        parsedDate.getHours(),
        parsedDate.getMinutes(),
        parsedDate.getSeconds(),
      ),
    );

    console.log(`📅 Input: "${dateString}"`);
    console.log(`   Local time: ${parsedDate.toString()}`);
    console.log(`   UTC storage: ${utcDate.toISOString()}`);
    console.log(`   Has explicit time: ${hasExplicitTime}`);

    return utcDate;
  } catch (error) {
    console.error("Date parsing error:", error);
    return null;
  }
}

/**
 * Test function to verify date parsing
 */
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
