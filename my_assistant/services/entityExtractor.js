// services/entityExtractor.js — parse task/reminder titles from natural language

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripQuotesAndPunctuation(text) {
  return String(text || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

/** Remove filler the model or regex often leaves in titles */
function normalizeEntityTitle(title) {
  let t = stripQuotesAndPunctuation(title);
  t = t.replace(/^(?:of|for)\s+(?:the\s+)?task\s+/i, "");
  t = t.replace(/^(?:the\s+)?task\s+/i, "");
  t = t.replace(/\s+time$/i, ""); // "project submission time" → "project submission"
  t = t.replace(/\s+(?:to|at|on)\s+.*$/i, "");
  return t.trim();
}

function isThisTaskPhrase(text) {
  const t = String(text || "")
    .toLowerCase()
    .trim();
  return (
    t === "this task" ||
    t === "that task" ||
    t === "same task" ||
    t === "the same task" ||
    t === "this_task_reference"
  );
}

/** "this/that/same task" only — not "the task" inside "of the task Pay bills" */
function messageRefersToThisTaskOnly(message) {
  const msg = String(message || "");
  if (/\b(?:reminder|task)\s+(?:of|for)\s+(?:the\s+)?task\s+\S/i.test(msg)) {
    return false;
  }
  return /\b(this|that|same)\s+task\b/i.test(msg);
}

/**
 * Extract task/reminder title from user message (ordered patterns).
 * @returns {string|null} title, THIS_TASK_REFERENCE, or null
 */
function extractEntityNameFromMessage(message) {
  if (!message) return null;
  const msg = message.trim().toLowerCase();
  const creationPatterns = [
    /^create\s+a?\s*task/i,
    /^add\s+a?\s*task/i,
    /^new\s+task/i,
    /^create\s+a?\s*reminder/i,
    /^set\s+reminder/i,
    /^create\s+a?\s*note/i,
    /^add\s+note/i,
  ];

  for (const pattern of creationPatterns) {
    if (pattern.test(message)) {
      console.log(
        `🚫 Skipping entity extraction - message is a creation command`,
      );
      return null;
    }
  }

  if (messageRefersToThisTaskOnly(msg)) {
    return "THIS_TASK_REFERENCE";
  }

  const patterns = [
    // set/change reminder for [task] to 3pm
    /(?:set|change|update)\s+(?:the\s+)?reminder\s+(?:for|of)\s+(?:the\s+)?task\s+["']?(.+?)["']?\s+(?:time\s+)?to\s+/i,
    /(?:set|change|update)\s+(?:the\s+)?reminder\s+for\s+(?:this\s+)?task\s+to\s+/i,
    /(?:set|change|update)\s+(?:the\s+)?reminder\s+for\s+["']?(.+?)["']?\s+to\s+/i,
    // change [title] reminder to 5pm
    /(?:change|update)\s+["']?(.+?)["']?\s+reminder\s+to\s+/i,
    // update the reminder of the task X ...
    /update\s+the\s+reminder\s+of\s+(?:the\s+)?task\s+["']?(.+?)["']?\s+(?:time\s+)?to\s+/i,
    /update\s+the\s+reminder\s+(?:of|for)\s+(?:the\s+)?task\s+["']?(.+?)["']?\s+/i,
    // update the reminder X to (no "of the task")
    /update\s+the\s+reminder\s+["']?(.+?)["']?\s+to\s+/i,
    /reminder\s+named\s+["']?(.+?)["']?(?:\s|\.|\?|$)/i,
    /(?:show|get|display)\s+(?:the\s+)?reminder\s+["']?(.+?)["']?(?:\s|\.|\?|$)/i,
    /tasks?\s+associated\s+with\s+the\s+reminder\s+["']?(.+?)["']?(?:\s|\.|\?|$)/i,
    // tasks
    /(?:set|create|add)\s+a?\s*task\s+["']?(.+?)["']?(?:\s+with|\s+due|\s+priority|$)/i,
    /details?\s+of\s+(?:the\s+)?task\s+["']?(.+?)["']?(?:\s|\.|\?|$)/i,
    /show\s+(?:me\s+)?(?:the\s+)?["']?(.+?)["']?\s+(?:task\s+)?in\s+table/i,
    /show\s+me\s+(?:the\s+)?["']?(.+?)["']?(?:\s+task)?/i,
    /update\s+(?:its|the|task)?\s*["']?(.+?)["']?\s+to\s+/i,
  ];

  for (const re of patterns) {
    const m = msg.match(re);
    if (!m) continue;
    if (!m[1]) return "THIS_TASK_REFERENCE";
    const name = normalizeEntityTitle(m[1]);
    if (name && !isThisTaskPhrase(name)) {
      return name;
    }
    if (isThisTaskPhrase(m[1])) return "THIS_TASK_REFERENCE";
  }

  return null;
}

/** Fix AI pipe-delimited searchQuery (strip junk prefixes/suffixes) */
function normalizeSearchQuery(query) {
  if (!query) return "";
  let q = stripQuotesAndPunctuation(query.split("\n")[0]);
  q = normalizeEntityTitle(q);
  q = q.replace(/\s+(?:The|This)\s+(?:task|note|reminder).*$/i, "").trim();
  if (isThisTaskPhrase(q)) return "THIS_TASK_REFERENCE";
  return q;
}

/**
 * Prefer message-based title when AI searchQuery looks wrong or empty.
 */
function resolveUpdateSearchQuery(userMessage, aiSearchQuery) {
  // ✅ FIRST: Check if AI sent a reference
  if (
    aiSearchQuery === "THIS_TASK_REFERENCE" ||
    aiSearchQuery === "THIS_REMINDER_REFERENCE" ||
    aiSearchQuery === "THIS_NOTE_REFERENCE"
  ) {
    console.log(`✅ Keeping reference: "${aiSearchQuery}"`);
    return aiSearchQuery;
  }

  // ✅ SECOND: Check if user message contains reference phrases
  const msg = userMessage.toLowerCase();
  if (
    msg.includes("this reminder") ||
    msg.includes("that reminder") ||
    msg === "this reminder"
  ) {
    console.log(
      `✅ User message refers to "this reminder" → returning THIS_REMINDER_REFERENCE`,
    );
    return "THIS_REMINDER_REFERENCE";
  }

  if (
    msg.includes("this task") ||
    msg.includes("that task") ||
    msg === "this task"
  ) {
    console.log(
      `✅ User message refers to "this task" → returning THIS_TASK_REFERENCE`,
    );
    return "THIS_TASK_REFERENCE";
  }

  if (
    msg.includes("this note") ||
    msg.includes("that note") ||
    msg === "this note"
  ) {
    console.log(
      `✅ User message refers to "this note" → returning THIS_NOTE_REFERENCE`,
    );
    return "THIS_NOTE_REFERENCE";
  }

  // ✅ THIRD: Try to extract from message
  const fromMessage = extractEntityNameFromMessage(userMessage);
  if (
    fromMessage === "THIS_TASK_REFERENCE" ||
    fromMessage === "THIS_REMINDER_REFERENCE" ||
    fromMessage === "THIS_NOTE_REFERENCE"
  ) {
    return fromMessage;
  }

  // ✅ FOURTH: Clean the AI search query
  const fromAi = normalizeSearchQuery(aiSearchQuery);

  // ✅ FIFTH: Prefer message extraction if it looks valid
  if (fromMessage && !/^(due|to|priority|and)$/i.test(fromMessage)) {
    const aiLooksWrong =
      !fromAi ||
      fromAi.includes('"') ||
      fromAi.includes("due") ||
      fromAi.length > fromMessage.length + 10;

    if (aiLooksWrong || fromAi.toLowerCase() !== fromMessage.toLowerCase()) {
      console.log(
        `🔧 Resolved search: AI="${fromAi}" → message="${fromMessage}"`,
      );
      return fromMessage;
    }
  }

  // ✅ SIXTH: Clean the AI result
  let cleaned = fromAi || fromMessage || "";
  cleaned = cleaned.replace(/["']/g, "");
  cleaned = cleaned.replace(/\s+(due|to|priority|and)$/i, "");
  cleaned = cleaned.trim();

  // ✅ FINAL: If it's still "this reminder" or similar, convert to reference
  if (
    cleaned === "this reminder" ||
    cleaned === "that reminder" ||
    cleaned === "reminder"
  ) {
    return "THIS_REMINDER_REFERENCE";
  }
  if (
    cleaned === "this task" ||
    cleaned === "that task" ||
    cleaned === "task"
  ) {
    return "THIS_TASK_REFERENCE";
  }
  if (
    cleaned === "this note" ||
    cleaned === "that note" ||
    cleaned === "note"
  ) {
    return "THIS_NOTE_REFERENCE";
  }

  return cleaned;
}

module.exports = {
  escapeRegex,
  normalizeEntityTitle,
  normalizeSearchQuery,
  extractEntityNameFromMessage,
  resolveUpdateSearchQuery,
  isThisTaskPhrase,
};
