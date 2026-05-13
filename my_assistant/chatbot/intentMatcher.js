const { find } = require("../models/Note");

const intentMap = {
  important: [
    "important",
    "urgent",
    "asap",
    "immediately",
    "priority",
    "critical",
  ],
  tasks: ["task", "todo", "assignment"],
  reminders: ["reminder", "alert", "notification"],
  notes: ["note", "memo", "thought"],
  list: ["list", "shopping list", "to-do list"],
};

function normalize(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, ".");
}

function contains(message, words) {
  message = normalize(message);
  return words.some((word) => message.includes(word));
}

function extractNumber(message) {
  const keywordWithNumber = message.match(/\b(?:first|top)\s+(\d+)\b/i);
  if (keywordWithNumber) {
    return parseInt(keywordWithNumber[1]);
  }

  const numberWithWord = message.match(
    /\b(\d+)\s+(?:tasks|notes|reminders|items)\b/i,
  );
  if (numberWithWord) {
    return parseInt(numberWithWord[1]);
  }

  if (/\b(?:first|top)\b/i.test(message)) {
    return 5;
  }

  const standaloneNumber = message.match(/\b(\d+)\b/);
  if (standaloneNumber) {
    return parseInt(standaloneNumber[1]);
  }

  return null;
}

function detectIntent(message, lastConversation) {
  const msg = normalize(message);
  if (contains(msg, ["hi", "hello", "help"])) {
    return { intent: "greetings" };
  }
  if (lastConversation) {
    if (
      msg.includes("previous") ||
      msg.includes("before") ||
      msg.includes("earlier") ||
      msg.includes("last")
    ) {
      return {
        intent: "refer_to_previous",
        index: lastConversation.responseData?.length || 0,
      };
    }
    if (msg.includes("set reminder") && msg.includes("urgent task")) {
      return { intent: "set_reminder" };
    }
  }
  if (
    contains(msg, intentMap.tasks) ||
    (contains(msg, intentMap.list) &&
      contains(msg, ["priority", "due", "complete"]))
  ) {
    let priority = null;
    if (contains(msg, intentMap.important)) priority = "important";
    else if (contains(msg, ["high"])) priority = "high";
    else if (contains(msg, ["medium"])) priority = "medium";
    else if (contains(msg, ["low"])) priority = "low";

    let limit = extractNumber(msg);

    return { intent: "get_tasks", priority: priority, limit: limit };
  } else if (contains(msg, intentMap.notes)) {
    return { intent: "get_notes" };
  } else if (contains(msg, intentMap.reminders)) {
    return { intent: "get_reminders" };
  }

  return { intent: "unknown" };
}

module.exports = { detectIntent };
