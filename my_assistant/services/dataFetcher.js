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

// services/dataFetcher.js - Update extractEntityName function

function extractEntityName(message) {
  let cleaned = cleanMessage(message);

  console.log(`🔍 Cleaning message: "${message}"`);
  console.log(`   After cleanMessage: "${cleaned}"`);

  // ============================================
  // Handle "tasks associated with the note X"
  // ============================================
  // ✅ Fix: Use [\w_]+ to include underscores, and match until end of line or punctuation
  let match = message.match(
    /tasks? associated with the note\s+["']?([\w_]+(?:[\s\w_]*?))(?:\s|\.|\?|$)/i,
  );
  if (match) {
    let noteName = match[1].trim();
    // Remove trailing punctuation
    noteName = noteName.replace(/[.!?]+$/, "");
    console.log(`🎯 Extracted note name from association: "${noteName}"`);
    return noteName;
  }

  // Handle "tasks associated with the reminder X"
  match = message.match(
    /tasks? associated with the reminder\s+["']?([\w_]+(?:[\s\w_]*?))(?:\s|\.|\?|$)/i,
  );
  if (match) {
    let reminderName = match[1].trim();
    reminderName = reminderName.replace(/[.!?]+$/, "");
    console.log(
      `🎯 Extracted reminder name from association: "${reminderName}"`,
    );
    return reminderName;
  }

  // Handle "show note X" or "note X details"
  match = message.match(
    /show (?:the )?note\s+["']?([\w_]+(?:[\s\w_]*?))(?:\s|\.|\?|$)/i,
  );
  if (match) {
    let noteName = match[1].trim();
    noteName = noteName.replace(/[.!?]+$/, "");
    console.log(`🎯 Extracted note name: "${noteName}"`);
    return noteName;
  }

  // Handle "reminder named X" (existing)
  match = message.match(
    /reminder named\s+["']?([\w_]+(?:[\s\w_]*?))(?:\s|\.|\?|$)/i,
  );
  if (match) {
    let reminderName = match[1].trim();
    reminderName = reminderName.replace(/[.!?]+$/, "");
    console.log(`🎯 Extracted reminder name: "${reminderName}"`);
    return reminderName;
  }

  // Handle "update the reminder X"
  match = message.match(
    /update the reminder\s+["']?([\w_]+(?:[\s\w_]*?))(?:\s+to|\s*$)/i,
  );
  if (match) {
    let reminderName = match[1].trim();
    reminderName = reminderName.replace(/[.!?]+$/, "");
    console.log(`🎯 Extracted reminder name: "${reminderName}"`);
    return reminderName;
  }

  // Handle "this task" reference
  if (
    cleaned.includes("this task") ||
    message.toLowerCase().includes("show this task") ||
    message.toLowerCase().includes("details of this task") ||
    message.toLowerCase().includes("show the same") ||
    message.toLowerCase().includes("show in table")
  ) {
    console.log("🔍 Detected 'this task' reference");
    return "THIS_TASK_REFERENCE";
  }

  // Pattern for "set a task [title] with due [date]"
  match = message.match(
    /set a task\s+["']?([\w_]+(?:[\s\w_]*?))(?:\s+with|\s+due|\s+priority|$)/i,
  );
  if (match) {
    let title = match[1].trim();
    title = title.replace(/\s+(with|due|priority).*$/i, "");
    console.log(`🎯 Extracted task title from "set a task": "${title}"`);
    return title;
  }

  // Pattern for "show the details of [task name]"
  match = message.match(
    /details? of (?:the )?task\s+["']?([\w_]+(?:[\s\w_]*?))(?:\s|\.|\?|$)/i,
  );
  if (match) {
    let taskName = match[1].trim();
    taskName = taskName.replace(/[.!?]+$/, "");
    console.log(`🎯 Extracted task from "details of": "${taskName}"`);
    return taskName;
  }

  // Pattern for "show [task name] in table"
  match = message.match(
    /show (?:the )?["']?([\w_]+(?:[\s\w_]*?))["']?\s+(?:task\s+)?in table/i,
  );
  if (match) {
    let taskName = match[1].trim();
    taskName = taskName.replace(/[.!?]+$/, "");
    console.log(`🎯 Extracted task from "show in table": "${taskName}"`);
    return taskName;
  }

  // Pattern for "show me [task name]"
  match = message.match(
    /show me (?:the )?["']?([\w_]+(?:[\s\w_]*?))["']?(?:\s+task)?/i,
  );
  if (
    match &&
    !match[1].toLowerCase().includes("all") &&
    !match[1].toLowerCase().includes("table")
  ) {
    let taskName = match[1].trim();
    taskName = taskName.replace(/[.!?]+$/, "");
    console.log(`🎯 Extracted task from "show me": "${taskName}"`);
    return taskName;
  }

  // Pattern for "create task [title]"
  match = message.match(
    /create task\s+["']?([\w_]+(?:[\s\w_]*?))(?:\s+with|\s+due|$)/i,
  );
  if (match) {
    let title = match[1].trim();
    title = title.replace(/\s+(with|due|priority).*$/i, "");
    console.log(`🎯 Extracted task title from "create task": "${title}"`);
    return title;
  }

  // Pattern for "add task [title]"
  match = message.match(
    /add task\s+["']?([\w_]+(?:[\s\w_]*?))(?:\s+with|\s+due|$)/i,
  );
  if (match) {
    let title = match[1].trim();
    title = title.replace(/\s+(with|due|priority).*$/i, "");
    console.log(`🎯 Extracted task title from "add task": "${title}"`);
    return title;
  }

  // Pattern for "update [title]" or "update its [title]"
  match = message.match(
    /update (?:its|the|task)?\s*["']?([\w_]+(?:[\s\w_]*?))["']?(?:\s+to|\s+with|$)/i,
  );
  if (
    match &&
    !match[1].toLowerCase().includes("due") &&
    !match[1].toLowerCase().includes("priority")
  ) {
    let taskName = match[1].trim();
    taskName = taskName.replace(/[.!?]+$/, "");
    console.log(`🎯 Extracted task title from update: "${taskName}"`);
    return taskName;
  }

  // Remove common command words for simple extraction
  cleaned = cleaned.replace(
    /\b(give|delete|show|priority|tell|its|display|same|list|which|is|completed|are|pending|with|fetch|details?|of|the|in|as|tabular|form|table|format|for|me|please|what|is|content|tasks?|reminders?|notes?|memo|details|of|reminder|note|everything|related|associated|linked|to|set|a|create|add)\b/g,
    "",
  );

  // Remove punctuation and extra spaces
  cleaned = cleaned.replace(/["'?]/g, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // If what's left is too long, it might still have date info
  if (cleaned.length > 30) {
    const words = cleaned.split(" ");
    if (words.length > 3) {
      cleaned = words.slice(0, 3).join(" ");
    }
  }

  console.log(`🎯 Extracted entity: "${cleaned}"`);
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

  let extractedName = extractEntityName(message);
  console.log("🎯 Extracted entity:", extractedName);

  // ============================================
  // Handle "tasks associated with the note X"
  // ============================================
  if (
    message.includes("associated with the note") ||
    (message.includes("show the details") && message.includes("note"))
  ) {
    if (extractedName && extractedName !== "THIS_TASK_REFERENCE") {
      console.log(`🔍 Finding task by note title: "${extractedName}"`);

      // Import the function
      const { getTaskByNoteTitle } = require("./autoCreateService");
      const result = await getTaskByNoteTitle(extractedName);

      if (result && result.task) {
        context.tasks = [result.task];
        if (result.reminder) context.reminders = [result.reminder];
        if (result.note) context.notes = [result.note];
        console.log(
          `✅ Found task "${result.task.title}" linked to note "${extractedName}"`,
        );

        // ✅ CRITICAL: Set as last mentioned task
        setLastMentionedTask(result.task.title, result.task._id);
        console.log(
          `📌 Set last mentioned task to: "${result.task.title}" (from note association)`,
        );

        return context;
      } else {
        console.log(`❌ No task found linked to note "${extractedName}"`);
      }
    }
  }

  // ============================================
  // Handle "tasks associated with the reminder X"
  // ============================================
  if (message.includes("associated with the reminder")) {
    if (extractedName && extractedName !== "THIS_TASK_REFERENCE") {
      console.log(`🔍 Finding task by reminder title: "${extractedName}"`);

      // Import the function
      const { getTaskByReminderTitle } = require("./autoCreateService");
      const result = await getTaskByReminderTitle(extractedName);

      if (result && result.task) {
        context.tasks = [result.task];
        if (result.reminder) context.reminders = [result.reminder];
        if (result.note) context.notes = [result.note];
        console.log(
          `✅ Found task "${result.task.title}" linked to reminder "${extractedName}"`,
        );
        // ✅ CRITICAL: Set as last mentioned task
        setLastMentionedTask(result.task.title, result.task._id);
        console.log(
          `📌 Set last mentioned task to: "${result.task.title}" (from reminder association)`,
        );
        return context;
      } else {
        console.log(`❌ No task found linked to reminder "${extractedName}"`);
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
      if (note.taskId) {
        const { getTaskWithDependencies } = require("./autoCreateService");
        const result = await getTaskWithDependencies(note.taskId);
        if (result && result.task) {
          context.tasks = [result.task];
          if (result.reminder) context.reminders = [result.reminder];
        }
      }
      console.log(
        `✅ Found note "${extractedName}"${note.taskId ? " with linked task" : ""}`,
      );
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
      if (reminder.taskId) {
        const { getTaskWithDependencies } = require("./autoCreateService");
        const result = await getTaskWithDependencies(reminder.taskId);
        if (result && result.task) {
          context.tasks = [result.task];
          if (result.note) context.notes = [result.note];
        }
      }
      console.log(
        `✅ Found reminder "${extractedName}"${reminder.taskId ? " with linked task" : ""}`,
      );
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
  setLastMentionedTask,
  getLastMentionedTask,
  getLastMentionedTaskId,
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
};
