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
  const t = String(text || "").toLowerCase().trim();
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
  const msg = message.trim();

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
  const fromMessage = extractEntityNameFromMessage(userMessage);
  const fromAi = normalizeSearchQuery(aiSearchQuery);

  if (fromMessage === "THIS_TASK_REFERENCE") return "THIS_TASK_REFERENCE";

  if (fromMessage) {
    const aiLooksWrong =
      !fromAi ||
      /^of\s+(?:the\s+)?task/i.test(fromAi) ||
      /\btime$/i.test(fromAi) ||
      fromAi.length > fromMessage.length + 10;
    if (aiLooksWrong || fromAi.toLowerCase() !== fromMessage.toLowerCase()) {
      console.log(
        `🔧 Resolved search: AI="${fromAi}" → message="${fromMessage}"`,
      );
      return fromMessage;
    }
  }

  return fromAi || fromMessage || "";
}

module.exports = {
  escapeRegex,
  normalizeEntityTitle,
  normalizeSearchQuery,
  extractEntityNameFromMessage,
  resolveUpdateSearchQuery,
  isThisTaskPhrase,
};
