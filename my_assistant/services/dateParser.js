// services/dateParser.js
const chrono = require("chrono-node");

/**
 * Parse natural language dates
 * @param {string} dateString
 * @returns {Promise<Date|null>}
 */

async function parseDate(dateString) {
  if (!dateString) return null;

  try {
    const parsedDate = chrono.parseDate(dateString);

    if (!parsedDate) {
      return null;
    }

    // If user did NOT specify time,
    // set default time to 9 AM
    const hasExplicitTime =
      /(\d{1,2}:\d{2}\s*(am|pm)?|\d{1,2}\s*(am|pm))/i.test(dateString);

    if (!hasExplicitTime) {
      parsedDate.setHours(9, 0, 0, 0);
    }

    console.log(`📅 Parsed "${dateString}" → ${parsedDate}`);

    return parsedDate;
  } catch (error) {
    console.error("Date parsing error:", error);

    return null;
  }
}

module.exports = { parseDate };
