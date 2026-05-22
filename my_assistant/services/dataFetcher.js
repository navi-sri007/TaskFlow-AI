// services/dataFetcher.js
const Task = require("../models/Task");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");
const {
  formatISTDate,
  getISTStartOfDay,
  getISTStartOfNextDay,
  getISTDayRange,
  getISTWeekday,
} = require("../utils/dateFormatter");
const {
  extractEntityNameFromMessage,
  escapeRegex,
} = require("./entityExtractor");

// Store last mentioned task for "this" references
// Store last mentioned entities for all types
let lastMentionedTask = null;
let lastMentionedTaskId = null;
let lastMentionedTaskData = null;

// NEW: For reminders
let lastMentionedReminder = null;
let lastMentionedReminderId = null;
let lastMentionedReminderData = null;

// NEW: For notes
let lastMentionedNote = null;
let lastMentionedNoteId = null;
let lastMentionedNoteData = null;

// NEW: Generic last mentioned entity (any type)
let lastMentionedEntity = null; // { type, title, id, data }
// Add these variables at the top of dataFetcher.js (after the other lastMentioned variables)

// Store the last displayed table/list with indexed items
let lastDisplayedTable = null; // { type, items, timestamp, context }

// Add these functions to dataFetcher.js
function setLastDisplayedTable(type, items, context = null) {
  lastDisplayedTable = {
    type: type, // 'tasks', 'reminders', 'notes'
    items: items.map((item, index) => ({
      index: index + 1, // 1-based index for user-friendliness
      originalIndex: index,
      data: item,
      title: item.title || item.name || "Untitled",
    })),
    timestamp: Date.now(),
    context: context,
    count: items.length,
  };
  console.log(`📊 Table indexed: ${type} with ${items.length} items`);
  return lastDisplayedTable;
}

function getLastDisplayedTable() {
  // Check if table is stale (older than 30 minutes)
  if (
    lastDisplayedTable &&
    Date.now() - lastDisplayedTable.timestamp > 30 * 60 * 1000
  ) {
    console.log(`📊 Last displayed table expired (older than 30 minutes)`);
    return null;
  }
  return lastDisplayedTable;
}

function clearLastDisplayedTable() {
  lastDisplayedTable = null;
  console.log(`📊 Cleared last displayed table`);
}

// Helper function to parse position references (first, second, third, last, etc.)
function parsePositionReference(query) {
  const lowerQuery = query.toLowerCase();

  // Map of words to numbers
  const positionMap = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    "1st": 1,
    "2nd": 2,
    "3rd": 3,
    "4th": 4,
    "5th": 5,
    "6th": 6,
    "7th": 7,
    "8th": 8,
    "9th": 9,
    "10th": 10,
    last: "last",
    previous: "previous",
    next: "next",
  };

  // Check for "first one", "second task", etc.
  for (const [word, number] of Object.entries(positionMap)) {
    const patterns = [
      new RegExp(
        `\\b${word}\\s+(?:one|item|task|reminder|note|entry)s?\\b`,
        "i",
      ),
      new RegExp(
        `\\b(?:the\\s+)?${word}\\s+(?:one|item|task|reminder|note|entry)\\b`,
        "i",
      ),
      new RegExp(`\\b${word}\\s+(?:element|row)\\b`, "i"),
      new RegExp(`\\b(?:get|show|tell|give\\s+me)\\s+${word}\\b`, "i"),
      new RegExp(`\\b${word}\\s+(?:details?|info|information)\\b`, "i"),
    ];

    for (const pattern of patterns) {
      if (pattern.test(lowerQuery)) {
        return { type: "position", value: number };
      }
    }
  }

  // Check for "the last one"
  if (
    /\b(?:the\s+)?last\s+(?:one|item|task|reminder|note|entry)\b/i.test(
      lowerQuery,
    )
  ) {
    return { type: "position", value: "last" };
  }

  // Check for ordinal numbers in text (e.g., "the 3rd item")
  const ordinalMatch = lowerQuery.match(
    /\b(?:the\s+)?(\d+)(?:st|nd|rd|th)\s+(?:one|item|task|reminder|note|entry)\b/i,
  );
  if (ordinalMatch) {
    return { type: "position", value: parseInt(ordinalMatch[1]) };
  }

  // Check for simple number reference (e.g., "item 5", "task number 3")
  const numberMatch = lowerQuery.match(
    /\b(?:item|task|reminder|note|entry)\s+(?:number\s+)?(\d+)\b/i,
  );
  if (numberMatch) {
    return { type: "position", value: parseInt(numberMatch[1]) };
  }

  return null;
}

// Function to get item by position from last displayed table
function getItemByPosition(positionRef, table = null) {
  const currentTable = table || getLastDisplayedTable();

  if (!currentTable) {
    return { error: "No table data available. Please list items first." };
  }

  let targetIndex;

  if (positionRef.value === "last") {
    targetIndex = currentTable.items.length;
  } else if (typeof positionRef.value === "number") {
    targetIndex = positionRef.value;
  } else {
    return { error: `Invalid position reference: ${positionRef.value}` };
  }

  if (targetIndex < 1 || targetIndex > currentTable.items.length) {
    return {
      error: `Position ${targetIndex} not found. The table has ${currentTable.items.length} item(s).`,
      totalItems: currentTable.items.length,
    };
  }

  const item = currentTable.items.find((i) => i.index === targetIndex);
  if (!item) {
    return { error: `Item at position ${targetIndex} not found.` };
  }

  return {
    success: true,
    item: item.data,
    index: item.index,
    title: item.title,
    type: currentTable.type,
  };
}

function cleanMessage(message) {
  return message.toLowerCase().trim();
}
// Add this function to dataFetcher.js
function formatTaskResponse(task, reminder = null, note = null) {
  let response = `✅ **Found the task for "${task.title}"**\n\n`;
  response += `📋 **Task Details:**\n`;
  response += `• Title: ${task.title}\n`;
  response += `• Priority: ${task.priority}\n`;
  response += `• Status: ${task.completed ? "✅ Completed" : "⏳ Pending"}\n`;

  if (task.dueDate) {
    response += `• Due Date: ${formatISTDate(task.dueDate)}\n`;
  }

  if (reminder) {
    response += `\n⏰ **Reminder:** "${reminder.title}"\n`;
    response += `   Time: ${formatISTDate(reminder.remindAt)}\n`;
  }

  if (note) {
    let content = note.content ? note.content.replace(/\n/g, " ") : "Empty";
    if (content.length > 150) content = content.substring(0, 150) + "...";
    response += `\n📝 **Note:** "${note.title}"\n`;
    response += `   Content: ${content}\n`;
  }

  response += `\n💡 You can now ask: "Show **its reminder**" or "Show **its note**"`;

  return response;
}
// ========== TASK FUNCTIONS (Existing) ==========
function setLastMentionedTask(taskTitle, taskId, taskData = null) {
  lastMentionedTask = taskTitle;
  lastMentionedTaskId = taskId;
  lastMentionedTaskData = taskData;

  // Also set generic entity
  setLastMentionedEntity("task", taskTitle, taskId, taskData);

  console.log(`📌 Last mentioned task: "${taskTitle}" (ID: ${taskId})`);
}

function getLastMentionedTask() {
  return lastMentionedTask;
}

function getLastMentionedTaskId() {
  return lastMentionedTaskId;
}

function getLastMentionedTaskData() {
  return lastMentionedTaskData;
}

// ========== NEW: REMINDER FUNCTIONS ==========
function setLastMentionedReminder(
  reminderTitle,
  reminderId,
  reminderData = null,
) {
  lastMentionedReminder = reminderTitle;
  lastMentionedReminderId = reminderId;
  lastMentionedReminderData = reminderData;

  // Also set generic entity
  setLastMentionedEntity("reminder", reminderTitle, reminderId, reminderData);

  console.log(
    `📌 Last mentioned reminder: "${reminderTitle}" (ID: ${reminderId})`,
  );
}

function getLastMentionedReminder() {
  return lastMentionedReminder;
}

function getLastMentionedReminderId() {
  return lastMentionedReminderId;
}

function getLastMentionedReminderData() {
  return lastMentionedReminderData;
}

// ========== NEW: NOTE FUNCTIONS ==========
function setLastMentionedNote(noteTitle, noteId, noteData = null) {
  lastMentionedNote = noteTitle;
  lastMentionedNoteId = noteId;
  lastMentionedNoteData = noteData;

  // Also set generic entity
  setLastMentionedEntity("note", noteTitle, noteId, noteData);

  console.log(`📌 Last mentioned note: "${noteTitle}" (ID: ${noteId})`);
}

function getLastMentionedNote() {
  return lastMentionedNote;
}

function getLastMentionedNoteId() {
  return lastMentionedNoteId;
}

function getLastMentionedNoteData() {
  return lastMentionedNoteData;
}

// ========== NEW: GENERIC ENTITY FUNCTIONS ==========
function setLastMentionedEntity(type, title, id, data = null) {
  lastMentionedEntity = { type, title, id, data };
  console.log(`📌 Last mentioned entity: ${type} "${title}" (ID: ${id})`);
}

function getLastMentionedEntity() {
  return lastMentionedEntity;
}

function clearLastMentioned() {
  lastMentionedTask = null;
  lastMentionedTaskId = null;
  lastMentionedTaskData = null;
  lastMentionedReminder = null;
  lastMentionedReminderId = null;
  lastMentionedReminderData = null;
  lastMentionedNote = null;
  lastMentionedNoteId = null;
  lastMentionedNoteData = null;
  lastMentionedEntity = null;
  console.log(`🧹 Cleared all last mentioned entities`);
}

// ========== HELPER: Get related item from last mentioned ==========
async function getRelatedTaskFromLastReminder() {
  if (!lastMentionedReminderId) {
    console.log(`⚠️ No last mentioned reminder found`);
    return null;
  }

  console.log(`🔍 Finding task for reminder: "${lastMentionedReminder}"`);
  const task = await Task.findOne({ reminderId: lastMentionedReminderId });

  if (task) {
    setLastMentionedTask(task.title, task._id, task);
    console.log(`✅ Found task: "${task.title}" for reminder`);
    return task;
  }

  console.log(`❌ No task found for reminder`);
  return null;
}

async function getRelatedTaskFromLastNote() {
  if (!lastMentionedNoteId) {
    console.log(`⚠️ No last mentioned note found`);
    return null;
  }

  console.log(`🔍 Finding task for note: "${lastMentionedNote}"`);
  const task = await Task.findOne({ noteId: lastMentionedNoteId });

  if (task) {
    setLastMentionedTask(task.title, task._id, task);
    console.log(`✅ Found task: "${task.title}" for note`);
    return task;
  }

  console.log(`❌ No task found for note`);
  return null;
}

async function getRelatedReminderFromLastTask() {
  if (!lastMentionedTaskId) {
    console.log(`⚠️ No last mentioned task found`);
    return null;
  }

  console.log(`🔍 Finding reminder for task: "${lastMentionedTask}"`);
  const task = await Task.findById(lastMentionedTaskId).populate("reminderId");

  if (task && task.reminderId) {
    setLastMentionedReminder(
      task.reminderId.title,
      task.reminderId._id,
      task.reminderId,
    );
    console.log(`✅ Found reminder: "${task.reminderId.title}" for task`);
    return task.reminderId;
  }

  console.log(`❌ No reminder found for task`);
  return null;
}

async function getRelatedNoteFromLastTask() {
  if (!lastMentionedTaskId) {
    console.log(`⚠️ No last mentioned task found`);
    return null;
  }

  console.log(`🔍 Finding note for task: "${lastMentionedTask}"`);
  const task = await Task.findById(lastMentionedTaskId).populate("noteId");

  if (task && task.noteId) {
    setLastMentionedNote(task.noteId.title, task.noteId._id, task.noteId);
    console.log(`✅ Found note: "${task.noteId.title}" for task`);
    return task.noteId;
  }

  console.log(`❌ No note found for task`);
  return null;
}

/**
 * Find reminder by title (case insensitive)
 */
async function findReminderByTitle(title) {
  const safe = escapeRegex(title);
  let reminder = await Reminder.findOne({
    title: { $regex: new RegExp(`^${safe}$`, "i") },
  });

  if (!reminder) {
    reminder = await Reminder.findOne({
      title: { $regex: new RegExp(safe, "i") },
    });
  }

  return reminder;
}

function extractEntityName(message) {
  console.log(`🔍 Cleaning message: "${message}"`);

  const fromPatterns = extractEntityNameFromMessage(message);
  if (fromPatterns) {
    console.log(`🎯 Extracted entity (patterns): "${fromPatterns}"`);
    return fromPatterns;
  }

  // Note-specific fallbacks
  let match = message.match(
    /tasks? associated with the note\s+["']?(.+?)["']?(?:\s|\.|\?|$)/i,
  );
  if (match) {
    const noteName = match[1].trim().replace(/[.!?]+$/, "");
    console.log(`🎯 Extracted note name from association: "${noteName}"`);
    return noteName;
  }

  match = message.match(/show (?:the )?note\s+["']?(.+?)["']?(?:\s|\.|\?|$)/i);
  if (match) {
    const noteName = match[1].trim().replace(/[.!?]+$/, "");
    console.log(`🎯 Extracted note name: "${noteName}"`);
    return noteName;
  }

  let cleaned = cleanMessage(message);
  cleaned = cleaned.replace(
    /\b(give|delete|show|priority|tell|its|time|display|same|list|which|is|completed|are|pending|with|fetch|details?|of|the|in|as|tabular|form|table|format|for|me|please|what|is|content|tasks?|reminders?|notes?|memo|everything|related|associated|linked|to|set|a|create|add)\b/g,
    "",
  );
  cleaned = cleaned.replace(/["'?]/g, "").replace(/\s+/g, " ").trim();

  if (cleaned.length > 30) {
    const words = cleaned.split(" ");
    if (words.length > 3) cleaned = words.slice(0, 3).join(" ");
  }

  console.log(`🎯 Extracted entity (fallback): "${cleaned}"`);
  return cleaned;
}
/**
 * Get recently created tasks
 * @param {number} limit - Number of tasks to return
 * @returns {Promise<Array>} - Recently created tasks
 */
async function getRecentTasks(limit = 5) {
  try {
    const tasks = await Task.find().sort({ createdAt: -1 }).limit(limit);

    // Fetch dependencies
    const tasksWithDeps = await Promise.all(
      tasks.map(async (task) => {
        const reminder = task.reminderId
          ? await Reminder.findById(task.reminderId)
          : null;
        const note = task.noteId ? await Note.findById(task.noteId) : null;
        return { ...task.toObject(), reminder, note };
      }),
    );

    console.log(`📋 Found ${tasksWithDeps.length} recent tasks`);
    return tasksWithDeps;
  } catch (error) {
    console.error("Error fetching recent tasks:", error);
    return [];
  }
}

/**
 * Get recently created reminders
 * @param {number} limit - Number of reminders to return
 * @returns {Promise<Array>} - Recently created reminders
 */
/**
 * Get recently created reminders
 * @param {number} limit - Number of reminders to return
 * @returns {Promise<Array>} - Recently created reminders
 */
async function getRecentReminders(limit = 5) {
  try {
    const reminders = await Reminder.find()
      .sort({ createdAt: -1 }) // Sort by newest first
      .limit(limit);

    // Fetch linked tasks
    const remindersWithTasks = await Promise.all(
      reminders.map(async (reminder) => {
        const task = reminder.taskId
          ? await Task.findById(reminder.taskId)
          : null;
        return {
          ...reminder.toObject(),
          linkedTask: task,
          createdAt: reminder.createdAt, // Ensure createdAt is included
          updatedAt: reminder.updatedAt,
        };
      }),
    );

    console.log(`⏰ Found ${remindersWithTasks.length} recent reminders`);
    return remindersWithTasks;
  } catch (error) {
    console.error("Error fetching recent reminders:", error);
    return [];
  }
}

/**
 * Get recently created notes
 * @param {number} limit - Number of notes to return
 * @returns {Promise<Array>} - Recently created notes
 */
async function getRecentNotes(limit = 5) {
  try {
    const notes = await Note.find().sort({ createdAt: -1 }).limit(limit);

    // Fetch linked tasks
    const notesWithTasks = await Promise.all(
      notes.map(async (note) => {
        const task = note.taskId ? await Task.findById(note.taskId) : null;
        return { ...note.toObject(), linkedTask: task };
      }),
    );

    console.log(`📝 Found ${notesWithTasks.length} recent notes`);
    return notesWithTasks;
  } catch (error) {
    console.error("Error fetching recent notes:", error);
    return [];
  }
}

/**
 * Get all recently created items (tasks, reminders, notes)
 * @param {number} limit - Limit per type
 * @returns {Promise<Object>} - Recent items grouped by type
 */
async function getAllRecentItems(limit = 5) {
  const [tasks, reminders, notes] = await Promise.all([
    getRecentTasks(limit),
    getRecentReminders(limit),
    getRecentNotes(limit),
  ]);

  return { tasks, reminders, notes };
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
  const istTodayStart = getISTStartOfDay();

  // Build the date condition properly
  const dateCondition = [];

  // Include tasks with due date >= start of today (IST)
  dateCondition.push({ dueDate: { $gte: istTodayStart } });

  // Include tasks with no due date
  dateCondition.push({ dueDate: null });

  if (filters.dueDate) {
    const filterValue = filters.dueDate.toLowerCase();

    // TODAY filter
    if (filterValue === "today") {
      const { start, end } = getISTDayRange();
      query.dueDate = { $gte: start, $lt: end };
      delete query.$or;
    }
    // TOMORROW filter
    else if (filterValue === "tomorrow") {
      const tomorrowStart = getISTStartOfNextDay();
      const dayAfter = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);
      query.dueDate = { $gte: tomorrowStart, $lt: dayAfter };
      delete query.$or;
    }
    // DAY AFTER TOMORROW filter (NEW)
    else if (
      filterValue === "day after tomorrow" ||
      filterValue === "day-after-tomorrow"
    ) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Calculate day after tomorrow
      const dayAfterTomorrow = new Date(today);
      dayAfterTomorrow.setDate(today.getDate() + 2);
      dayAfterTomorrow.setHours(0, 0, 0, 0);

      const nextDay = new Date(dayAfterTomorrow);
      nextDay.setDate(dayAfterTomorrow.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);

      // Convert to UTC for query
      const startUTC = new Date(
        dayAfterTomorrow.getTime() - 5.5 * 60 * 60 * 1000,
      );
      const endUTC = new Date(nextDay.getTime() - 5.5 * 60 * 60 * 1000);

      query.dueDate = { $gte: startUTC, $lt: endUTC };
      delete query.$or;
      console.log(
        `📅 Day after tomorrow filter: ${startUTC.toISOString()} to ${endUTC.toISOString()}`,
      );
    }
    // THIS WEEK filter
    else if (filterValue === "this-week") {
      const { start } = getISTDayRange();
      const endOfWeek = new Date(start);
      const istWeekday = getISTWeekday();
      endOfWeek.setTime(
        start.getTime() + (7 - istWeekday) * 24 * 60 * 60 * 1000,
      );
      query.dueDate = { $gte: start, $lte: endOfWeek };
      delete query.$or;
    }
    // NEXT WEEK filter
    else if (filterValue === "next-week") {
      const { start } = getISTDayRange();
      const nextWeekStart = new Date(start);
      nextWeekStart.setDate(start.getDate() + 7);
      const nextWeekEnd = new Date(nextWeekStart);
      nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
      nextWeekEnd.setHours(23, 59, 59, 999);
      query.dueDate = { $gte: nextWeekStart, $lte: nextWeekEnd };
      delete query.$or;
    }
    // NEXT MONTH filter
    else if (filterValue === "next-month") {
      const { start } = getISTDayRange();
      const nextMonthStart = new Date(start);
      nextMonthStart.setMonth(start.getMonth() + 1);
      nextMonthStart.setDate(1);
      const nextMonthEnd = new Date(nextMonthStart);
      nextMonthEnd.setMonth(nextMonthStart.getMonth() + 1);
      nextMonthEnd.setDate(0);
      nextMonthEnd.setHours(23, 59, 59, 999);
      query.dueDate = { $gte: nextMonthStart, $lte: nextMonthEnd };
      delete query.$or;
    }
    // OVERDUE filter (tasks due before today, not completed)
    else if (filterValue === "overdue") {
      const todayStart = getISTStartOfDay();
      query.dueDate = { $lt: todayStart };
      query.completed = false;
      delete query.$or;
    }
    // EXACT DATE filter (e.g., "2026-05-25", "25th may", "may 25 2026")
    else {
      // Try to parse as exact date
      const exactDate = await parseDate(filterValue);
      if (exactDate) {
        // Get start and end of that day in IST
        const dateStart = new Date(exactDate);
        dateStart.setHours(0, 0, 0, 0);
        const dateEnd = new Date(dateStart);
        dateEnd.setDate(dateStart.getDate() + 1);
        dateEnd.setHours(0, 0, 0, 0);

        // Convert to UTC for query
        const startUTC = new Date(dateStart.getTime() - 5.5 * 60 * 60 * 1000);
        const endUTC = new Date(dateEnd.getTime() - 5.5 * 60 * 60 * 1000);

        query.dueDate = { $gte: startUTC, $lt: endUTC };
        delete query.$or;
        console.log(
          `📅 Exact date filter: ${filterValue} → ${startUTC.toISOString()} to ${endUTC.toISOString()}`,
        );
      }
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
 * Get complete dashboard statistics
 * @returns {Promise<Object>} - Dashboard statistics
 */
async function getDashboardStats() {
  try {
    const now = new Date();
    const todayStart = getISTStartOfDay();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Task statistics
    const totalTasks = await Task.countDocuments();
    const pendingTasks = await Task.countDocuments({ completed: false });
    const completedTasks = await Task.countDocuments({ completed: true });
    const overdueTasks = await Task.countDocuments({
      dueDate: { $lt: todayStart },
      completed: false,
    });
    const dueTodayTasks = await Task.countDocuments({
      dueDate: {
        $gte: todayStart,
        $lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000),
      },
      completed: false,
    });

    // Priority wise tasks
    const highPriorityTasks = await Task.countDocuments({
      priority: "high",
      completed: false,
    });
    const mediumPriorityTasks = await Task.countDocuments({
      priority: "medium",
      completed: false,
    });
    const lowPriorityTasks = await Task.countDocuments({
      priority: "low",
      completed: false,
    });
    const importantTasks = await Task.countDocuments({
      priority: "important",
      completed: false,
    });

    // Reminder statistics
    const totalReminders = await Reminder.countDocuments();
    const upcomingReminders = await Reminder.countDocuments({
      remindAt: { $gte: now },
    });
    const remindersToday = await Reminder.countDocuments({
      remindAt: {
        $gte: todayStart,
        $lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    // Note statistics
    const totalNotes = await Note.countDocuments();
    const notesWithTasks = await Note.countDocuments({ taskId: { $ne: null } });
    const standaloneNotes = await Note.countDocuments({ taskId: null });

    // Recent activity (last 7 days)
    const tasksCreatedLastWeek = await Task.countDocuments({
      createdAt: { $gte: weekAgo },
    });
    const remindersCreatedLastWeek = await Reminder.countDocuments({
      createdAt: { $gte: weekAgo },
    });
    const notesCreatedLastWeek = await Note.countDocuments({
      createdAt: { $gte: weekAgo },
    });

    return {
      tasks: {
        total: totalTasks,
        pending: pendingTasks,
        completed: completedTasks,
        overdue: overdueTasks,
        dueToday: dueTodayTasks,
        byPriority: {
          high: highPriorityTasks,
          medium: mediumPriorityTasks,
          low: lowPriorityTasks,
          important: importantTasks,
        },
      },
      reminders: {
        total: totalReminders,
        upcoming: upcomingReminders,
        today: remindersToday,
      },
      notes: {
        total: totalNotes,
        linkedToTasks: notesWithTasks,
        standalone: standaloneNotes,
      },
      recentActivity: {
        tasksCreated: tasksCreatedLastWeek,
        remindersCreated: remindersCreatedLastWeek,
        notesCreated: notesCreatedLastWeek,
      },
    };
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return null;
  }
}

/**
 * Get quick overview for dashboard
 * @returns {Promise<Object>} - Quick overview
 */
async function getQuickOverview() {
  try {
    const todayStart = getISTStartOfDay();
    const now = new Date();

    const [
      pendingTasks,
      overdueTasks,
      dueToday,
      upcomingReminders,
      recentNotes,
    ] = await Promise.all([
      Task.countDocuments({ completed: false }),
      Task.countDocuments({ dueDate: { $lt: todayStart }, completed: false }),
      Task.countDocuments({
        dueDate: {
          $gte: todayStart,
          $lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000),
        },
        completed: false,
      }),
      Reminder.countDocuments({ remindAt: { $gte: now } }),
      Note.find().sort({ createdAt: -1 }).limit(5),
    ]);

    return {
      pendingTasks,
      overdueTasks,
      dueToday,
      upcomingReminders,
      recentNotes: recentNotes.map((n) => ({
        title: n.title,
        createdAt: n.createdAt,
      })),
    };
  } catch (error) {
    console.error("Error fetching quick overview:", error);
    return null;
  }
}

/**
 * List reminders with filtering options (ONLY FUTURE REMINDERS)
 * @param {Object} filters - Filter criteria
 * @returns {Promise<Array>} - Filtered reminders (only future remind times)
 */
async function listReminders(filters = {}) {
  let query = {};

  const now = new Date();

  // Filter by date (IST calendar boundaries)
  if (filters.remindAt) {
    const filterValue = filters.remindAt.toLowerCase();

    if (filterValue === "today") {
      const { start, end } = getISTDayRange();
      query.remindAt = { $gte: start, $lt: end };
    } else if (filterValue === "tomorrow") {
      const tomorrowStart = getISTStartOfNextDay();
      const dayAfter = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);
      query.remindAt = { $gte: tomorrowStart, $lt: dayAfter };
    } else if (filterValue === "upcoming") {
      query.remindAt = { $gte: now };
    } else if (filterValue === "this week" || filterValue === "this-week") {
      // ✅ Handle both "this week" and "this-week"
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(today);
      endOfWeek.setDate(today.getDate() + 7);
      endOfWeek.setHours(23, 59, 59, 999);

      console.log(
        `📅 This week range: ${today.toISOString()} to ${endOfWeek.toISOString()}`,
      );

      query.remindAt = {
        $gte: today,
        $lte: endOfWeek,
      };
    }
  } else {
    // Default: only future reminders
    query.remindAt = { $gte: now };
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

  const limit = filters.limit || 100;

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

  console.log(`⏰ Found ${remindersWithTasks.length} reminders`);
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
  } else if (
    lowerMsg.includes("day after tomorrow") ||
    lowerMsg.includes("day after tmr")
  ) {
    filters.dueDate = "day after tomorrow";
  } else if (lowerMsg.includes("this week")) {
    filters.dueDate = "this-week";
  } else if (lowerMsg.includes("next week")) {
    filters.dueDate = "next-week";
  } else if (lowerMsg.includes("next month")) {
    filters.dueDate = "next-month";
  } else {
    // Check for exact date patterns
    const datePatterns = [
      /(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?/i,
      /(\d{4})-(\d{2})-(\d{2})/,
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    ];

    for (const pattern of datePatterns) {
      const match = message.match(pattern);
      if (match) {
        filters.dueDate = match[0];
        console.log(`📅 Detected exact date filter: "${filters.dueDate}"`);
        break;
      }
    }
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

  // Wrap extractEntityName to auto-correct typos
  const originalExtractEntityName = extractEntityName;
  extractEntityName = function (message) {
    const correctedMessage = correctCommonTypos(message);
    return originalExtractEntityName(correctedMessage);
  };
  let extractedName = extractEntityName(message);

  console.log("🎯 Extracted entity:", extractedName);

  // ============================================
  // NEW: Handle "its task" reference (from last mentioned reminder/note)
  // ============================================
  // In your fetchRelevantData function
  if (message.includes("its task") || message.includes("task of this")) {
    console.log(`🔄 'its task' detected! Checking last mentioned entity...`);

    // Check for last mentioned reminder FIRST
    if (lastMentionedReminderId) {
      console.log(
        `📌 Last mentioned is reminder: "${lastMentionedReminder}", getting its task...`,
      );
      const task = await getRelatedTaskFromLastReminder();
      if (task) {
        console.log(`✅ Found task for reminder: "${task.title}"`);
        const { getTaskWithDependencies } = require("./autoCreateService");
        const result = await getTaskWithDependencies(task._id);
        if (result && result.task) {
          context.tasks = [result.task];
          if (result.reminder) context.reminders = [result.reminder];
          if (result.note) context.notes = [result.note];
          return context;
        }
      } else {
        console.log(`⚠️ No task found for reminder "${lastMentionedReminder}"`);
      }
    }

    // Then check for last mentioned note
    if (lastMentionedNoteId) {
      console.log(
        `📌 Last mentioned is note: "${lastMentionedNote}", getting its task...`,
      );
      const task = await getRelatedTaskFromLastNote();
      if (task) {
        console.log(`✅ Found task for note: "${task.title}"`);
        const { getTaskWithDependencies } = require("./autoCreateService");
        const result = await getTaskWithDependencies(task._id);
        if (result && result.task) {
          context.tasks = [result.task];
          if (result.reminder) context.reminders = [result.reminder];
          if (result.note) context.notes = [result.note];
          return context;
        }
      } else {
        console.log(`⚠️ No task found for note "${lastMentionedNote}"`);
      }
    }

    console.log(`⚠️ No last mentioned reminder or note found for 'its task'`);
  }
  // ============================================
  // NEW: Handle "its reminder" reference (from last mentioned task)
  // ============================================
  if (
    message.includes("its reminder") ||
    message.includes("reminder of this")
  ) {
    console.log(`🔄 'its reminder' detected! Checking last mentioned task...`);

    if (lastMentionedTaskId) {
      const reminder = await getRelatedReminderFromLastTask();
      if (reminder) {
        context.reminders = [reminder];
        // Also get the task if needed
        const { getTaskWithDependencies } = require("./autoCreateService");
        const result = await getTaskWithDependencies(lastMentionedTaskId);
        if (result && result.task) {
          context.tasks = [result.task];
          if (result.note) context.notes = [result.note];
        }
        return context;
      }
    }

    console.log(`⚠️ No last mentioned task found for 'its reminder'`);
  }

  // ============================================
  // NEW: Handle "its note" reference (from last mentioned task)
  // ============================================
  if (message.includes("its note") || message.includes("note of this")) {
    console.log(`🔄 'its note' detected! Checking last mentioned task...`);

    if (lastMentionedTaskId) {
      const note = await getRelatedNoteFromLastTask();
      if (note) {
        context.notes = [note];
        // Also get the task if needed
        const { getTaskWithDependencies } = require("./autoCreateService");
        const result = await getTaskWithDependencies(lastMentionedTaskId);
        if (result && result.task) {
          context.tasks = [result.task];
          if (result.reminder) context.reminders = [result.reminder];
        }
        return context;
      }
    }

    console.log(`⚠️ No last mentioned task found for 'its note'`);
  }

  // ============================================
  // Handle "tasks associated with the note X"
  // ============================================
  if (
    message.includes("associated with the note") ||
    (message.includes("show the details") && message.includes("note"))
  ) {
    if (extractedName && extractedName !== "THIS_TASK_REFERENCE") {
      console.log(`🔍 Finding task by note title: "${extractedName}"`);

      const { getTaskByNoteTitle } = require("./autoCreateService");
      const result = await getTaskByNoteTitle(extractedName);

      if (result && result.task) {
        context.tasks = [result.task];
        if (result.reminder) context.reminders = [result.reminder];
        if (result.note) {
          context.notes = [result.note];
          // ✅ Set last mentioned note
          setLastMentionedNote(result.note.title, result.note._id, result.note);
        }

        // ✅ Set last mentioned task
        setLastMentionedTask(result.task.title, result.task._id, result.task);

        console.log(
          `✅ Found task linked to note, set last mentioned note and task`,
        );
        return context;
      }
    }
  }
  // ============================================
  // Handle "tasks associated with the reminder X"
  // ============================================
  if (message.includes("associated with the reminder")) {
    if (extractedName && extractedName !== "THIS_TASK_REFERENCE") {
      console.log(`🔍 Finding task by reminder title: "${extractedName}"`);

      const { getTaskByReminderTitle } = require("./autoCreateService");
      const result = await getTaskByReminderTitle(extractedName);

      if (result && result.task) {
        context.tasks = [result.task];
        if (result.reminder) {
          context.reminders = [result.reminder];
          // ✅ Set last mentioned reminder
          setLastMentionedReminder(
            result.reminder.title,
            result.reminder._id,
            result.reminder,
          );
        }
        if (result.note) context.notes = [result.note];

        // ✅ Set last mentioned task
        setLastMentionedTask(result.task.title, result.task._id, result.task);

        console.log(
          `✅ Found task linked to reminder, set last mentioned reminder and task`,
        );
        return context;
      }
    }
  }

  // ============================================
  // Handle "the same" reference
  // ============================================
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
      const { getTaskWithDependencies } = require("./autoCreateService");
      const result = await getTaskWithDependencies(lastMentionedTaskId);

      if (result && result.task) {
        context.tasks = [result.task];
        if (result.reminder) context.reminders = [result.reminder];
        if (result.note) context.notes = [result.note];
        console.log(`✅ Found task: "${result.task.title}" with dependencies`);
        return context;
      }
    } else {
      console.log(`⚠️ 'Same' detected but no last mentioned task exists`);
    }
  }

  // ============================================
  // Handle "this task" reference
  // ============================================
  if (extractedName === "THIS_TASK_REFERENCE" && lastMentionedTaskId) {
    console.log(`🔄 Using last mentioned task: "${lastMentionedTask}"`);
    const { getTaskWithDependencies } = require("./autoCreateService");
    const result = await getTaskWithDependencies(lastMentionedTaskId);

    if (result && result.task) {
      context.tasks = [result.task];
      if (result.reminder) context.reminders = [result.reminder];
      if (result.note) context.notes = [result.note];
      console.log(`✅ Found task: "${result.task.title}" with dependencies`);
      return context;
    }
  }

  // ============================================
  // Handle "show note X" or "note X details"
  // ============================================
  if (
    message.includes("note") &&
    extractedName &&
    extractedName !== "THIS_TASK_REFERENCE" &&
    !message.includes("associated")
  ) {
    console.log(`🔍 Finding note: "${extractedName}"`);

    const note = await Note.findOne({
      title: { $regex: new RegExp(`^${extractedName}$`, "i") },
    });

    if (note) {
      context.notes = [note];
      // ✅ Set last mentioned note
      setLastMentionedNote(note.title, note._id, note);
      console.log(
        `✅ Found note "${extractedName}" - set as last mentioned note`,
      );

      if (note.taskId) {
        const { getTaskWithDependencies } = require("./autoCreateService");
        const result = await getTaskWithDependencies(note.taskId);
        if (result && result.task) {
          context.tasks = [result.task];
          if (result.reminder) context.reminders = [result.reminder];
          // Also set last mentioned task
          setLastMentionedTask(result.task.title, result.task._id, result.task);
        }
      }
      return context;
    }
  }

  // ============================================
  // Handle "show reminder X"
  // ============================================
  if (
    message.includes("reminder") &&
    extractedName &&
    extractedName !== "THIS_TASK_REFERENCE" &&
    !message.includes("associated")
  ) {
    console.log(`🔍 Finding reminder: "${extractedName}"`);

    const reminder = await Reminder.findOne({
      title: { $regex: new RegExp(`^${extractedName}$`, "i") },
    });

    if (reminder) {
      context.reminders = [reminder];
      // ✅ Set last mentioned reminder
      setLastMentionedReminder(reminder.title, reminder._id, reminder);
      console.log(
        `✅ Found reminder "${extractedName}" - set as last mentioned reminder`,
      );

      if (reminder.taskId) {
        const { getTaskWithDependencies } = require("./autoCreateService");
        const result = await getTaskWithDependencies(reminder.taskId);
        if (result && result.task) {
          context.tasks = [result.task];
          if (result.note) context.notes = [result.note];
          // Also set last mentioned task
          setLastMentionedTask(result.task.title, result.task._id, result.task);
        }
      }
      return context;
    }
  }

  // ============================================
  // Normal entity search (for tasks)
  // ============================================
  if (
    extractedName &&
    extractedName !== "THIS_TASK_REFERENCE" &&
    !message.includes("list all") &&
    !message.includes("all tasks") &&
    extractedName.length > 2
  ) {
    let task = await Task.findOne({
      title: { $regex: new RegExp(`^${extractedName}$`, "i") },
    });

    if (!task) {
      task = await Task.findOne({
        title: { $regex: new RegExp(extractedName, "i") },
      });
    }

    if (task) {
      console.log(`✅ Found specific task: "${task.title}"`);
      const { getTaskWithDependencies } = require("./autoCreateService");
      const result = await getTaskWithDependencies(task._id);

      if (result && result.task) {
        context.tasks = [result.task];
        if (result.reminder) context.reminders = [result.reminder];
        if (result.note) context.notes = [result.note];
        // ✅ Set last mentioned task
        setLastMentionedTask(task.title, task._id, task);
      }
      return context;
    }
  }

  // ============================================
  // List request detection
  // ============================================
  const isListRequest =
    message.includes("list all") ||
    (message.includes("list") && message.includes("tasks") && !extractedName);

  if (isListRequest) {
    console.log("📋 List request detected");
    return context;
  }

  return context;
}
/**
 * Get a single note by title with its linked task
 * @param {string} noteTitle - Title of the note
 * @returns {Promise<Object>} - Note with linked task and reminder
 */
async function getNoteByTitle(noteTitle) {
  try {
    console.log(`🔍 Searching for note: "${noteTitle}"`);

    // Try exact match first
    let note = await Note.findOne({
      title: { $regex: new RegExp(`^${noteTitle}$`, "i") },
    });

    // Try partial match if exact fails
    if (!note) {
      note = await Note.findOne({
        title: { $regex: new RegExp(noteTitle, "i") },
      });
    }

    if (!note) {
      console.log(`❌ Note "${noteTitle}" not found`);
      return null;
    }

    console.log(`✅ Found note: "${note.title}"`);

    // Get linked task if exists
    let linkedTask = null;
    let linkedReminder = null;

    if (note.taskId) {
      linkedTask = await Task.findById(note.taskId);
      if (linkedTask && linkedTask.reminderId) {
        linkedReminder = await Reminder.findById(linkedTask.reminderId);
      }
    }

    return {
      note,
      linkedTask,
      linkedReminder,
    };
  } catch (error) {
    console.error(`❌ Error fetching note:`, error);
    return null;
  }
}

/**
 * Get a single reminder by title with its linked task
 * @param {string} reminderTitle - Title of the reminder
 * @returns {Promise<Object>} - Reminder with linked task and note
 */
async function getReminderByTitle(reminderTitle) {
  try {
    console.log(`🔍 Searching for reminder: "${reminderTitle}"`);

    // Try exact match first
    let reminder = await Reminder.findOne({
      title: { $regex: new RegExp(`^${reminderTitle}$`, "i") },
    });

    // Try partial match if exact fails
    if (!reminder) {
      reminder = await Reminder.findOne({
        title: { $regex: new RegExp(reminderTitle, "i") },
      });
    }

    if (!reminder) {
      console.log(`❌ Reminder "${reminderTitle}" not found`);
      return null;
    }

    console.log(`✅ Found reminder: "${reminder.title}"`);

    // Get linked task if exists
    let linkedTask = null;
    let linkedNote = null;

    if (reminder.taskId) {
      linkedTask = await Task.findById(reminder.taskId);
      if (linkedTask && linkedTask.noteId) {
        linkedNote = await Note.findById(linkedTask.noteId);
      }
    }

    return {
      reminder,
      linkedTask,
      linkedNote,
    };
  } catch (error) {
    console.error(`❌ Error fetching reminder:`, error);
    return null;
  }
}
function formatContextForAI(context) {
  let output = "";

  // If this is a response to "its task" query
  if (context.tasks && context.tasks.length > 0) {
    const task = context.tasks[0];
    output += `USER ASKED FOR: The task related to a previously mentioned item\n\n`;
    output += `FOUND TASK:\n`;
    output += `- Title: ${task.title}\n`;
    output += `- Priority: ${task.priority}\n`;
    output += `- Status: ${task.completed ? "Completed" : "Pending"}\n`;
    if (task.dueDate) {
      output += `- Due Date: ${formatISTDate(task.dueDate)}\n`;
    }

    if (context.reminders && context.reminders.length > 0) {
      const reminder = context.reminders[0];
      output += `- Reminder: ${reminder.title} at ${formatISTDate(reminder.remindAt)}\n`;
    }

    if (context.notes && context.notes.length > 0) {
      const note = context.notes[0];
      let content = note.content ? note.content.replace(/\n/g, " ") : "Empty";
      if (content.length > 100) content = content.substring(0, 100) + "...";
      output += `- Note: "${note.title}" - ${content}\n`;
    }

    output += `\nRESPONSE INSTRUCTION: Tell the user you found the task and display the details in a friendly, organized way.`;
  }

  return output;
}
function correctCommonTypos(text) {
  const corrections = {
    // Priority typos
    prority: "priority",
    priorty: "priority",
    priorety: "priority",

    // Status typos
    compleated: "completed",
    completd: "completed",
    pendng: "pending",
    pendig: "pending",

    // Entity typos
    remider: "reminder",
    remiders: "reminders",
    remnders: "reminders",
    nots: "notes",
    taskes: "tasks",
    taskk: "task",

    // Date typos
    tomorow: "tomorrow",
    tommorow: "tomorrow",
    tommorrow: "tomorrow",
    yesturday: "yesterday",

    // Content typos
    contenet: "content",
    conten: "content",
    cntent: "content",
  };

  let corrected = text.toLowerCase();
  for (const [typo, correct] of Object.entries(corrections)) {
    const regex = new RegExp(`\\b${typo}\\b`, "gi");
    corrected = corrected.replace(regex, correct);
  }

  return corrected;
}

/**
 * Get productivity statistics with time-based analysis
 * @returns {Promise<Object>} - Productivity statistics
 */

/**
 * Get week number from date
 */

module.exports = {
  fetchRelevantData,
  formatContextForAI,

  // Task functions
  setLastMentionedTask,
  getLastMentionedTask,
  getLastMentionedTaskId,
  getLastMentionedTaskData,

  // NEW: Reminder functions
  setLastMentionedReminder,
  getLastMentionedReminder,
  getLastMentionedReminderId,
  getLastMentionedReminderData,

  // NEW: Note functions
  setLastMentionedNote,
  getLastMentionedNote,
  getLastMentionedNoteId,
  getLastMentionedNoteData,

  // NEW: Generic entity functions
  setLastMentionedEntity,
  getLastMentionedEntity,
  clearLastMentioned,

  // NEW: Relationship helpers
  getRelatedTaskFromLastReminder,
  getRelatedTaskFromLastNote,
  getRelatedReminderFromLastTask,
  getRelatedNoteFromLastTask,

  listTasks,
  listReminders,
  listNotes,
  parseFiltersFromMessage,
  handleListRequest,
  findReminderByTitle,
  getRecentTasks,
  getRecentReminders,
  getRecentNotes,
  getAllRecentItems,
  getNoteByTitle,
  getReminderByTitle,
  getQuickOverview,
  getDashboardStats,
  setLastDisplayedTable,
  getLastDisplayedTable,
  clearLastDisplayedTable,
  parsePositionReference,
  getItemByPosition,
};
