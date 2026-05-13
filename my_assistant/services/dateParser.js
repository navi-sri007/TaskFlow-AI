// services/dateParser.js
const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Parse natural language dates using AI
 * @param {string} dateString - Natural language date (e.g., "tomorrow at 3pm", "next Friday", "May 15th")
 * @returns {Promise<Date|null>} - JavaScript Date object or null
 */
async function parseDateWithAI(dateString) {
  if (!dateString) return null;

  try {
    const currentDate = new Date();
    const currentISO = currentDate.toISOString();

    const prompt = `You are a date parsing assistant. Convert the following natural language date to a valid ISO 8601 datetime string.

Current date/time: ${currentISO}

Natural language date: "${dateString}"

Rules:
1. Return ONLY the ISO datetime string (e.g., "2026-05-15T14:00:00.000Z")
2. Do NOT add any explanation, text, or formatting
3. If time is not specified, default to 09:00:00 (9 AM)
4. If only date is specified, use 09:00:00 as time
5. Handle relative dates (today, tomorrow, next week, next Monday)
6. Handle specific dates (May 15th, December 25)
7. Handle times (3pm, 14:30, 9:45 AM)
8. Handle combinations (tomorrow at 5pm, May 15th at 2:30 PM)

Examples:
- "tomorrow" → "calculate tomorrow's date according to today's date and return it "
- "today at 3pm" → "${currentISO.split("T")[0]}T15:00:00.000Z"
- "next Monday" → (next Monday's date)T09:00:00.000Z
- "May 15th at 2:30pm" → 2026-05-15T14:30:00.000Z

CRITICAL RULES FOR DATES:
- For dueDate or remindAt fields, return ONLY the date string (e.g., "2026-05-13T17:00:00.000Z")
- Do NOT add any explanatory text, emojis, or extra words to date fields
- Keep date fields pure and clean

Example of CORRECT output:
{
  "type": "CREATE_REMINDER",
  "title": "Team meeting",
  "remindAt": "2026-05-13T17:00:00.000Z"
}

Example of INCORRECT output (DO NOT DO THIS):
{
  "type": "CREATE_REMINDER", 
  "title": "Team meeting",
  "remindAt": "2026-05-13T17:00:00 ✅ I'll create that for you!"  // WRONG!
}

Convert: "${dateString}"`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a precise date parser. Convert natural language dates to ISO format. Return ONLY the ISO string, no other text.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1, // Low temperature for consistent parsing
      max_tokens: 100,
    });

    const isoString = completion.choices[0]?.message?.content?.trim();

    if (!isoString) {
      console.error("AI returned empty date string");
      return null;
    }

    // Parse the ISO string to Date object
    const parsedDate = new Date(isoString);

    if (isNaN(parsedDate.getTime())) {
      console.error(`AI returned invalid date: ${isoString}`);
      return null;
    }

    return parsedDate;
  } catch (error) {
    console.error("AI Date parsing error:", error);
    return null;
  }
}

/**
 * Fallback simple parser for when AI fails
 */
function simpleDateParser(dateString) {
  if (!dateString) return null;

  const lowerDate = dateString.toLowerCase();
  const now = new Date();

  // Handle simple relative dates
  if (lowerDate === "today") {
    now.setHours(9, 0, 0, 0);
    return now;
  }

  if (lowerDate === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow;
  }

  // Try standard Date parsing
  const standardDate = new Date(dateString);
  if (!isNaN(standardDate.getTime())) {
    return standardDate;
  }

  return null;
}

/**
 * Main date parser with AI fallback
 */
async function parseDate(dateString, useAI = true) {
  if (!dateString) return null;

  // First try simple parser for common cases (faster)
  const simpleResult = simpleDateParser(dateString);
  if (simpleResult) {
    return simpleResult;
  }

  // If simple parser fails and AI is enabled, use AI
  if (useAI) {
    try {
      const aiResult = await parseDateWithAI(dateString);
      if (aiResult) {
        return aiResult;
      }
    } catch (error) {
      console.error("AI parser failed, falling back to simple:", error);
    }
  }

  // Ultimate fallback: default to tomorrow
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(9, 0, 0, 0);
  return fallback;
}

module.exports = { parseDate, parseDateWithAI, simpleDateParser };
