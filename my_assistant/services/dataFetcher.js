// services/dataFetcher.js
const Task = require("../models/Task");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");
const { formatISTDate } = require("../utils/dateFormatter");

// Store last mentioned task for "this" references

let lastMentionedTask = null;
let lastMentionedTaskId = null;

function setLastMentionedTask(taskTitle, taskId) {
  lastMentionedTask = taskTitle;
  lastMentionedTaskId = taskId;
  console.log(`📌 Last mentioned task: "${taskTitle}" (ID: ${taskId})`);
}

function getLastMentionedTask() {
  return lastMentionedTask;
}

function getLastMentionedTaskId() {
  return lastMentionedTaskId;
}

function cleanMessage(message) {
  return message.toLowerCase().trim();
}

/**
 * Find reminder by title (case insensitive)
 */
async function findReminderByTitle(title) {
  let reminder = await Reminder.findOne({
    title: { $regex: new RegExp(`^${title}$`, "i") },
  });

  if (!reminder) {
    reminder = await Reminder.findOne({
      title: { $regex: new RegExp(title, "i") },
    });
  }

  return reminder;
}

function extractEntityName(message) {
  let cleaned = cleanMessage(message);

  console.log(`🔍 Cleaning message: "${message}"`);
  console.log(`   After cleanMessage: "${cleaned}"`);

  let match = message.match(/reminder named\s+["']?([^"']+?)["']?/i);
  if (match) {
    console.log(`🎯 Extracted reminder name: "${match[1].trim()}"`);
    return match[1].trim();
  }

  // ✅ NEW: Handle "update the reminder X"
  match = message.match(/update the reminder\s+["']?([^"']+?)["']?(?: to|$)/i);
  if (match) {
    console.log(`🎯 Extracted reminder name: "${match[1].trim()}"`);
    return match[1].trim();
  }
  // Handle "this task" reference
  if (
    cleaned.includes("this task") ||
    message.toLowerCase().includes("show this task") ||
    message.toLowerCase().includes("details of this task") ||
    message.toLowerCase().includes("show the same")
  ) {
    console.log("🔍 Detected 'this task' reference");
    return "THIS_TASK_REFERENCE";
  }

  // ============================================
  // NEW: Extract task title from create/update commands
  // ============================================

  // Pattern for "set a task [title] with due [date]"
  match = message.match(/set a task (.+?)(?: with due| with priority|$)/i);
  if (match) {
    let title = match[1].trim();
    // Remove trailing words like "with", "due", "priority"
    title = title.replace(/\s+(with|due|priority).*$/i, "");
    console.log(`🎯 Extracted task title from "set a task": "${title}"`);
    return title;
  }

  // ✅ NEW: Handle "show the details of [task name]"
  match = message.match(/details? of (?:the )?task ["']?([^"']+?)["']?/i);
  if (match) {
    console.log(`🎯 Extracted task from "details of": "${match[1].trim()}"`);
    return match[1].trim();
  }

  // ✅ NEW: Handle "show [task name] in table"
  match = message.match(
    /show (?:the )?["']?([^"']+?)["']? (?:task )?in table/i,
  );
  if (match) {
    console.log(`🎯 Extracted task from "show in table": "${match[1].trim()}"`);
    return match[1].trim();
  }

  // ✅ NEW: Handle "show me [task name]"
  match = message.match(/show me (?:the )?["']?([^"']+?)["']?(?: task)?/i);
  if (
    match &&
    !match[1].toLowerCase().includes("all") &&
    !match[1].toLowerCase().includes("table")
  ) {
    console.log(`🎯 Extracted task from "show me": "${match[1].trim()}"`);
    return match[1].trim();
  }
  // Pattern for "set a task [title] with due [date]"
  match = message.match(/set a task (.+?)(?: with due| with priority|$)/i);
  if (match) {
    let title = match[1].trim();
    title = title.replace(/\s+(with|due|priority).*$/i, "");
    console.log(`🎯 Extracted task title from "set a task": "${title}"`);
    return title;
  }
  // Pattern for "create task [title]"
  match = message.match(/create task (.+?)(?: with due| with priority|$)/i);
  if (match) {
    let title = match[1].trim();
    title = title.replace(/\s+(with|due|priority).*$/i, "");
    console.log(`🎯 Extracted task title from "create task": "${title}"`);
    return title;
  }

  // Pattern for "add task [title]"
  match = message.match(/add task (.+?)(?: with due| with priority|$)/i);
  if (match) {
    let title = match[1].trim();
    title = title.replace(/\s+(with|due|priority).*$/i, "");
    console.log(`🎯 Extracted task title from "add task": "${title}"`);
    return title;
  }

  // Pattern for "update [title]" or "update its [title]"
  match = message.match(
    /update (?:its|the|task)?\s*["']?([^"']+?)["']?(?: to| with|$)/i,
  );
  if (
    match &&
    !match[1].toLowerCase().includes("due") &&
    !match[1].toLowerCase().includes("priority")
  ) {
    console.log(`🎯 Extracted task title from update: "${match[1].trim()}"`);
    return match[1].trim();
  }

  // Remove common command words for simple extraction
  cleaned = cleaned.replace(
    /\b(give|update|due|delete|show|tell|its|display|same|list|which|are|pending|with|fetch|details?|of|the|in|as|tabular|form|table|format|for|me|please|what|is|content|tasks?|reminders?|notes?|memo|everything|related|associated|linked|to|set|a|create|add)\b/g,
    "",
  );

  // Remove punctuation and extra spaces
  cleaned = cleaned.replace(/["'?]/g, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // If what's left is too long, it might still have date info
  if (cleaned.length > 30) {
    // Try to extract just the first few words as title
    const words = cleaned.split(" ");
    if (words.length > 3) {
      cleaned = words.slice(0, 3).join(" ");
    }
  }

  console.log(`🎯 Extracted entity: "${cleaned}"`);
  return cleaned;
}
/**
 * List tasks with filtering options
 * @param {Object} filters - Filter criteria
 * @returns {Promise<Array>} - Filtered tasks
 */
/**
 * List tasks with filtering options (ONLY FUTURE TASKS - not overdue)
 * @param {Object} filters - Filter criteria
 * @returns {Promise<Array>} - Filtered tasks (only future due dates)
 */
/**
 * List tasks with filtering options (ONLY FUTURE TASKS - not overdue)
 * @param {Object} filters - Filter criteria
 * @returns {Promise<Array>} - Filtered tasks (only future due dates)
 */
async function listTasks(filters = {}) {
  let query = {};

  // ============================================
  // CRITICAL: Only include future tasks
  // ============================================
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Start of today

  // Build the date condition properly
  const dateCondition = [];

  // Include tasks with due date >= today
  dateCondition.push({ dueDate: { $gte: now } });

  // Include tasks with no due date
  dateCondition.push({ dueDate: null });

  // If there's a specific due date filter, apply it
  if (filters.dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (filters.dueDate === "today") {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      query.dueDate = { $gte: today, $lt: tomorrow };
      delete query.$or; // Remove the default $or when specific filter is applied
    } else if (filters.dueDate === "tomorrow") {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);
      query.dueDate = { $gte: tomorrow, $lt: dayAfter };
      delete query.$or;
    } else if (filters.dueDate === "this-week") {
      const endOfWeek = new Date(today);
      endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
      query.dueDate = { $gte: today, $lte: endOfWeek };
      delete query.$or;
    }
  } else {
    // Apply the default future-only filter
    query.$or = dateCondition;
  }

  // Filter by priority
  if (filters.priority) {
    const priorityMap = {
      low: "low",
      medium: "medium",
      high: "high",
      important: "important",
    };
    query.priority = priorityMap[filters.priority.toLowerCase()];
  }

  // Filter by status
  if (filters.status) {
    if (filters.status === "pending") {
      query.completed = false;
    } else if (filters.status === "completed") {
      query.completed = true;
    }
  } else {
    // Default: only show pending tasks unless specified otherwise
    if (filters.showCompleted !== true) {
      query.completed = false;
    }
  }

  // Search by title
  if (filters.search) {
    query.title = { $regex: new RegExp(filters.search, "i") };
  }

  // Limit results
  const limit = filters.limit || 50;

  console.log("📋 Query:", JSON.stringify(query, null, 2));

  let tasks = await Task.find(query)
    .sort({ dueDate: 1, createdAt: -1 })
    .limit(limit);

  // Fetch reminders and notes for each task
  const tasksWithDeps = await Promise.all(
    tasks.map(async (task) => {
      const reminder = task.reminderId
        ? await Reminder.findById(task.reminderId)
        : null;
      const note = task.noteId ? await Note.findById(task.noteId) : null;
      return {
        ...task.toObject(),
        reminder,
        note,
      };
    }),
  );

  console.log(
    `📋 Found ${tasksWithDeps.length} future tasks (due today or later)`,
  );
  return tasksWithDeps;
}

/**
 * List reminders with filtering options (ONLY FUTURE REMINDERS)
 * @param {Object} filters - Filter criteria
 * @returns {Promise<Array>} - Filtered reminders (only future remind times)
 */
async function listReminders(filters = {}) {
  let query = {};

  // ============================================
  // CRITICAL: Only include future reminders
  // ============================================
  const now = new Date();

  // Default: only reminders with remindAt >= current time
  if (!filters.remindAt) {
    query.remindAt = { $gte: now };
  }

  // Filter by date
  if (filters.remindAt) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (filters.remindAt === "today") {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      query.remindAt = { $gte: today, $lt: tomorrow };
    } else if (filters.remindAt === "tomorrow") {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);
      query.remindAt = { $gte: tomorrow, $lt: dayAfter };
    } else if (filters.remindAt === "upcoming") {
      query.remindAt = { $gte: now };
    } else if (filters.remindAt === "this-week") {
      const endOfWeek = new Date(today);
      endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
      query.remindAt = { $gte: now, $lte: endOfWeek };
    }
  }

  // Filter by linked status
  if (filters.linked === true) {
    query.taskId = { $ne: null };
  } else if (filters.linked === false) {
    query.taskId = null;
  }

  // Search by title
  if (filters.search) {
    query.title = { $regex: new RegExp(filters.search, "i") };
  }

  const limit = filters.limit || 50;

  console.log("⏰ Query:", JSON.stringify(query, null, 2));

  let reminders = await Reminder.find(query).sort({ remindAt: 1 }).limit(limit);

  // Fetch linked tasks
  const remindersWithTasks = await Promise.all(
    reminders.map(async (reminder) => {
      const task = reminder.taskId
        ? await Task.findById(reminder.taskId)
        : null;
      return {
        ...reminder.toObject(),
        linkedTask: task,
      };
    }),
  );

  console.log(`⏰ Found ${remindersWithTasks.length} future reminders`);
  return remindersWithTasks;
}
/**
 * List notes with filtering options
 * @param {Object} filters - Filter criteria
 * @returns {Promise<Array>} - Filtered notes
 */
async function listNotes(filters = {}) {
  let query = {};

  // Filter by linked status
  if (filters.linked === true) {
    query.taskId = { $ne: null };
  } else if (filters.linked === false) {
    query.taskId = null;
  }

  // Search in title or content
  if (filters.search) {
    query.$or = [
      { title: { $regex: new RegExp(filters.search, "i") } },
      { content: { $regex: new RegExp(filters.search, "i") } },
    ];
  }

  // Filter by date range
  if (filters.createdAfter) {
    query.createdAt = { $gte: new Date(filters.createdAfter) };
  }

  const limit = filters.limit || 50;

  let notes = await Note.find(query).sort({ createdAt: -1 }).limit(limit);

  // Fetch linked tasks
  const notesWithTasks = await Promise.all(
    notes.map(async (note) => {
      const task = note.taskId ? await Task.findById(note.taskId) : null;
      return {
        ...note.toObject(),
        linkedTask: task,
      };
    }),
  );

  return notesWithTasks;
}

/**
 * Parse natural language filter requests
 * @param {string} message - User message like "list all tasks which are low priority"
 * @returns {Object} - Filter object
 */
function parseFiltersFromMessage(message) {
  const lowerMsg = message.toLowerCase();
  const filters = {};

  // Determine entity type
  if (lowerMsg.includes("task")) {
    filters.type = "task";
  } else if (lowerMsg.includes("reminder")) {
    filters.type = "reminder";
  } else if (lowerMsg.includes("note")) {
    filters.type = "note";
  } else {
    filters.type = "task"; // default
  }

  // Priority filter
  if (lowerMsg.includes("low priority") || lowerMsg.includes("priority low")) {
    filters.priority = "low";
  } else if (
    lowerMsg.includes("medium priority") ||
    lowerMsg.includes("priority medium")
  ) {
    filters.priority = "medium";
  } else if (
    lowerMsg.includes("high priority") ||
    lowerMsg.includes("priority high")
  ) {
    filters.priority = "high";
  } else if (lowerMsg.includes("important")) {
    filters.priority = "important";
  }

  // Status filter
  if (
    lowerMsg.includes("pending") ||
    lowerMsg.includes("incomplete") ||
    lowerMsg.includes("not completed")
  ) {
    filters.status = "pending";
  } else if (lowerMsg.includes("completed") || lowerMsg.includes("done")) {
    filters.status = "completed";
  }

  // Due date filters
  if (lowerMsg.includes("overdue") || lowerMsg.includes("past due")) {
    filters.dueDate = "overdue";
  } else if (lowerMsg.includes("today")) {
    filters.dueDate = "today";
  } else if (lowerMsg.includes("tomorrow")) {
    filters.dueDate = "tomorrow";
  } else if (lowerMsg.includes("this week")) {
    filters.dueDate = "this-week";
  }

  // Search term (extract quoted text or last words)
  const quotedMatch = message.match(/["']([^"']+)["']/);
  if (quotedMatch) {
    filters.search = quotedMatch[1];
  } else {
    // Try to extract search term after "containing", "with", "about"
    const searchPatterns = [
      /containing\s+(\w+)/i,
      /with\s+(\w+)/i,
      /about\s+(\w+)/i,
      /for\s+(\w+)/i,
    ];
    for (const pattern of searchPatterns) {
      const match = message.match(pattern);
      if (match) {
        filters.search = match[1];
        break;
      }
    }
  }

  // Limit
  const limitMatch = message.match(/(\d+)\s+tasks?/i);
  if (limitMatch) {
    filters.limit = parseInt(limitMatch[1]);
  }

  return filters;
}

/**
 * Main function to handle list requests
 * @param {string} message - User message
 * @returns {Promise<Object>} - Formatted list response
 */
async function handleListRequest(message) {
  const filters = parseFiltersFromMessage(message);
  let items = [];
  let type = filters.type;

  switch (type) {
    case "task":
      items = await listTasks(filters);
      break;
    case "reminder":
      items = await listReminders(filters);
      break;
    case "note":
      items = await listNotes(filters);
      break;
  }

  return {
    type,
    filters,
    items,
    count: items.length,
  };
}
async function fetchRelevantData(userMessage) {
  let message = userMessage.toLowerCase();
  let context = { tasks: [], notes: [], reminders: [] };

  let extractedName = extractEntityName(message);

  console.log("🎯 Extracted entity:", extractedName);
  // In dataFetcher.js - fetchRelevantData function

  // Handle "the same" reference
  if (
    message.includes("the same") ||
    message.includes("same task") ||
    message.includes("same in table")
  ) {
    console.log(
      `🔍 'Same' detected! Last mentioned task ID: ${lastMentionedTaskId}`,
    );
    console.log(`🔍 Last mentioned task name: "${lastMentionedTask}"`);

    if (lastMentionedTaskId) {
      console.log(`🔄 Using same task reference: "${lastMentionedTask}"`);
      const task = await Task.findById(lastMentionedTaskId);
      if (task) {
        console.log(`✅ Found task: "${task.title}"`);
        context.tasks = [task];
        if (task.reminderId) {
          const reminder = await Reminder.findById(task.reminderId);
          if (reminder) context.reminders = [reminder];
        }
        if (task.noteId) {
          const note = await Note.findById(task.noteId);
          if (note) context.notes = [note];
        }
        return context;
      } else {
        console.log(`❌ Task not found for ID: ${lastMentionedTaskId}`);
      }
    } else {
      console.log(`⚠️ 'Same' detected but no last mentioned task exists`);
    }
  }
  // ✅ Handle "this task" reference
  if (extractedName === "THIS_TASK_REFERENCE" && lastMentionedTaskId) {
    console.log(`🔄 Using last mentioned task: "${lastMentionedTask}"`);
    let task = await Task.findById(lastMentionedTaskId);
    if (task) {
      context.tasks = [task];
      if (task.reminderId) {
        let reminder = await Reminder.findById(task.reminderId);
        if (reminder) context.reminders = [reminder];
      }
      if (task.noteId) {
        let note = await Note.findById(task.noteId);
        if (note) context.notes = [note];
      }
      return context;
    }
  }

  // Normal entity search
  if (
    extractedName &&
    extractedName !== "THIS_TASK_REFERENCE" &&
    !message.includes("list all") &&
    !message.includes("all tasks") &&
    extractedName.length > 2
  ) {
    let task = await Task.findOne({
      title: { $regex: extractedName, $options: "i" },
    });

    if (!task) {
      task = await Task.findOne({
        title: { $regex: new RegExp(extractedName, "i") },
      });
    }

    if (task) {
      console.log(`✅ Found specific task: "${task.title}"`);
      context.tasks = [task];

      if (task.reminderId) {
        let reminder = await Reminder.findById(task.reminderId);
        if (reminder) context.reminders = [reminder];
      }

      if (task.noteId) {
        let note = await Note.findById(task.noteId);
        if (note) context.notes = [note];
      }

      return context; // ✅ Return early with just this task
    }
  }

  // If not asking about a specific task, fetch all
  /*if (
    message.includes("task") ||
    message.includes("todo") ||
    message.includes("list")
  ) {
    context.tasks = await Task.find().sort({ dueDate: 1 });
  }

  if (message.includes("reminder") || message.includes("remind")) {
    context.reminders = await Reminder.find().sort({ remindAt: 1 });
  }

  if (message.includes("note") || message.includes("memo")) {
    context.notes = await Note.find().sort({ createdAt: -1 });
  }*/
  const isListRequest =
    message.includes("list all") ||
    (message.includes("list") && message.includes("tasks") && !extractedName);

  if (isListRequest) {
    console.log("📋 List request detected");
    return context; // Return empty, AI should use LIST action
  }
  return context;
}

// services/dataFetcher.js

function formatContextForAI(context) {
  // Build complete but concise context
  let output = "";

  // TASKS with their FULL reminders and notes
  if (context.tasks && context.tasks.length > 0) {
    // ✅ Show if this is a single task or multiple
    if (context.tasks.length === 1) {
      output += `SINGLE TASK REQUEST (Show only this task):\n`;
    } else {
      output += `TASKS (${context.tasks.length} tasks):\n`;
    }
    for (const task of context.tasks) {
      output += `- ${task.title} | Priority: ${task.priority} | Status: ${task.completed ? "Done" : "Pending"}`;
      if (task.dueDate) {
        output += ` | Due: ${formatISTDate(task.dueDate)}`;
      }
      output += "\n";

      // Include reminder details if exists
      if (task.reminderId && context.reminders) {
        let reminder = context.reminders.find(
          (r) => r._id.toString() === task.reminderId.toString(),
        );
        if (reminder) {
          output += `  ↳ Reminder: "${reminder.title}" at ${formatISTDate(reminder.remindAt)}\n`;
        }
      }

      // Include note details if exists
      if (task.noteId && context.notes) {
        let note = context.notes.find(
          (n) => n._id.toString() === task.noteId.toString(),
        );
        if (note) {
          const preview =
            note.content.length > 100
              ? note.content.substring(0, 100) + "..."
              : note.content;
          output += `  ↳ Note: "${note.title}" - ${preview}\n`;
        }
      }
    }
  }

  // STANDALONE REMINDERS (not linked to tasks)
  if (context.reminders && context.reminders.length > 0) {
    const orphanReminders = context.reminders.filter((r) => !r.taskId);
    if (orphanReminders.length > 0) {
      output += "\nSTANDALONE REMINDERS:\n";
      for (const reminder of orphanReminders) {
        output += `- ${reminder.title} at ${formatISTDate(reminder.remindAt)}\n`;
      }
    }
  }

  // STANDALONE NOTES (not linked to tasks)
  if (context.notes && context.notes.length > 0) {
    const orphanNotes = context.notes.filter((n) => !n.taskId);
    if (orphanNotes.length > 0) {
      output += "\nSTANDALONE NOTES:\n";
      for (const note of orphanNotes) {
        const preview =
          note.content.length > 100
            ? note.content.substring(0, 100) + "..."
            : note.content;
        output += `- "${note.title}": ${preview}\n`;
      }
    }
  }

  console.log(
    `📦 Context size: ${output.length} chars, ~${Math.ceil(output.length / 4)} tokens`,
  );
  return output;
}

module.exports = {
  fetchRelevantData,
  formatContextForAI,
  setLastMentionedTask,
  getLastMentionedTask,
  getLastMentionedTaskId,
  listTasks,
  listReminders,
  listNotes,
  parseFiltersFromMessage,
  handleListRequest,
  findReminderByTitle,
};
