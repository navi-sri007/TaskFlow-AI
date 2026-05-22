// server.js
process.env.TZ = "Asia/Kolkata";
require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

mongoose.connect(process.env.MONGODB_URL);

const Task = require("./models/Task.js");
const Note = require("./models/Note.js");
const Reminder = require("./models/Reminder.js");
const Chat = require("./models/Chat.js");
const { getAIResponse } = require("./services/groqService");
const {
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
} = require("./services/dataFetcher");
const { parseDate, testDateParser } = require("./services/dateParser");
const { applyDateTimeUpdate } = require("./services/dateUpdate");
const {
  resolveUpdateSearchQuery,
  escapeRegex,
} = require("./services/entityExtractor");
const {
  autoCreateDependencies,
  updateDependencies,
  deleteDependencies,
  getTaskWithDependencies,
  getReminderWithDependenciesById,
  getNoteWithDependenciesById,
  searchAllByKeyword,
} = require("./services/autoCreateService.js");
const {
  IST_OFFSET_MS,
  getISTDateParts,
  istToUTC,
  getISTStartOfDay,
  getISTStartOfNextDay,
  getISTWeekday,
  getISTDayRange,
  formatISTDate,
  formatDisplayDate,
  debugDate,
} = require("./utils/dateFormatter.js");

/** User / AI said "this task" etc. — resolve via last-mentioned task id */
function isThisTaskPlaceholder(query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  return (
    q === "this_task_reference" ||
    q === "this task" ||
    q === "that task" ||
    q === "same task" ||
    q === "the same task"
  );
}

async function findTaskByUpdateSearch(searchQuery) {
  if (isThisTaskPlaceholder(searchQuery)) {
    const id = getLastMentionedTaskId();
    if (!id) return null;
    return Task.findById(id);
  }
  const safe = escapeRegex(searchQuery);
  let task = await Task.findOne({
    title: { $regex: new RegExp(`^${safe}$`, "i") },
  });
  if (!task) {
    task = await Task.findOne({
      title: { $regex: new RegExp(safe, "i") },
    });
  }
  return task;
}

async function findReminderByUpdateSearch(searchQuery) {
  if (isThisTaskPlaceholder(searchQuery)) {
    const id = getLastMentionedTaskId();
    if (!id) return null;
    const task = await Task.findById(id);
    if (!task?.reminderId) return null;
    return Reminder.findById(task.reminderId);
  }
  const safe = escapeRegex(searchQuery);
  let reminder = await Reminder.findOne({
    title: { $regex: new RegExp(`^${safe}$`, "i") },
  });
  if (!reminder) {
    reminder = await Reminder.findOne({
      title: { $regex: new RegExp(safe, "i") },
    });
  }
  // Task and linked reminder often share the same title
  if (!reminder) {
    const task = await findTaskByUpdateSearch(searchQuery);
    if (task?.reminderId) {
      reminder = await Reminder.findById(task.reminderId);
    }
  }
  return reminder;
}

/**
 * Format dashboard statistics as table
 * @param {Object} stats - Dashboard statistics
 * @returns {string} - Formatted dashboard
 */
function formatDashboardTable(stats) {
  if (!stats) return "Unable to fetch dashboard statistics.";

  return `
📊 **TASK DASHBOARD**
| Metric | Count |
|--------|-------|
| Total Tasks | ${stats.tasks.total} |
| Pending Tasks | ${stats.tasks.pending} |
| Completed Tasks | ${stats.tasks.completed} |
| Overdue Tasks | ⚠️ ${stats.tasks.overdue} |
| Due Today | 📅 ${stats.tasks.dueToday} |

**Priority Breakdown (Pending)**
| Priority | Count |
|----------|-------|
| Important | ${stats.tasks.byPriority.important} |
| High | ${stats.tasks.byPriority.high} |
| Medium | ${stats.tasks.byPriority.medium} |
| Low | ${stats.tasks.byPriority.low} |

⏰ **REMINDERS**
| Metric | Count |
|--------|-------|
| Total Reminders | ${stats.reminders.total} |
| Upcoming | ${stats.reminders.upcoming} |
| Today | ${stats.reminders.today} |

📝 **NOTES**
| Metric | Count |
|--------|-------|
| Total Notes | ${stats.notes.total} |
| Linked to Tasks | ${stats.notes.linkedToTasks} |
| Standalone | ${stats.notes.standalone} |

📈 **RECENT ACTIVITY (Last 7 Days)**
| Type | Created |
|------|---------|
| Tasks | ${stats.recentActivity.tasksCreated} |
| Reminders | ${stats.recentActivity.remindersCreated} |
| Notes | ${stats.recentActivity.notesCreated} |
`;
}

/**
 * Format quick overview as compact table
 * @param {Object} overview - Quick overview
 * @returns {string} - Formatted overview
 */
function formatQuickOverview(overview) {
  if (!overview) return "Unable to fetch overview.";

  let output = `📋 **QUICK OVERVIEW**
| Metric | Count |
|--------|-------|
| ⏳ Pending Tasks | ${overview.pendingTasks} |
| ⚠️ Overdue Tasks | ${overview.overdueTasks} |
| 📅 Due Today | ${overview.dueToday} |
| ⏰ Upcoming Reminders | ${overview.upcomingReminders} |

📝 **Recent Notes:**\n`;

  for (const note of overview.recentNotes) {
    output += `- ${note.title} (${formatISTDate(note.createdAt)})\n`;
  }

  return output;
}

// Add these helper functions to server.js
/**
 * Format a single note as table
 * @param {Object} noteData - Note data with linked task
 * @returns {string} - Formatted table
 */

function formatSingleTaskTable(task, reminder = null, note = null) {
  // ✅ CRITICAL: Set last mentioned TASK
  setLastMentionedTask(task.title, task._id, task);
  console.log(`📌 Set last mentioned task: "${task.title}"`);

  // Also set linked reminder if exists
  if (reminder) {
    setLastMentionedReminder(reminder.title, reminder._id, reminder);
    console.log(`📌 Also set last mentioned reminder: "${reminder.title}"`);
  }

  // Also set linked note if exists
  if (note) {
    setLastMentionedNote(note.title, note._id, note);
    console.log(`📌 Also set last mentioned note: "${note.title}"`);
  }

  // Format the response
  let response = `📋 **Task: "${task.title}"**\n`;
  response += `📌 Priority: ${task.priority}\n`;
  response += `✅ Status: ${task.completed ? "Completed" : "Pending"}\n`;
  if (task.dueDate) {
    response += `📅 Due: ${formatISTDate(task.dueDate)}\n`;
  }
  response += `🆔 ID: ${task._id}\n`;

  if (reminder) {
    response += `\n⏰ **Reminder:** "${reminder.title}" at ${formatISTDate(reminder.remindAt)}\n`;
  }

  if (note) {
    let content = note.content ? note.content.replace(/\n/g, " ") : "Empty";
    if (content.length > 100) content = content.substring(0, 100) + "...";
    response += `\n📝 **Note:** "${note.title}"\n`;
    response += `📄 Content: ${content}\n`;
  }

  response += `\n💡 You can now ask: "Show **its reminder**" or "Show **its note**"`;

  return response;
}

// Add after existing functions in server.js

/**
 * Get note content with full text (no truncation)
 */
async function getNoteContent(noteTitle) {
  try {
    console.log(`📝 Fetching content for note: "${noteTitle}"`);

    const note = await Note.findOne({
      title: { $regex: new RegExp(`^${escapeRegex(noteTitle)}$`, "i") },
    });

    if (!note) {
      return null;
    }

    // Get linked task info
    let linkedTask = null;
    if (note.taskId) {
      linkedTask = await Task.findById(note.taskId);
    }

    return {
      title: note.title,
      content: note.content || "Empty",
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      linkedTask: linkedTask,
    };
  } catch (error) {
    console.error("Error getting note content:", error);
    return null;
  }
}

/**
 * Format note content response
 */
function formatNoteContent(noteData) {
  if (!noteData) {
    return "📝 Note not found.";
  }

  let response = `📝 **Note: "${noteData.title}"**\n`;
  response += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `📄 **Content:**\n${noteData.content}\n\n`;
  response += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `📅 **Created:** ${formatISTDate(noteData.createdAt)}\n`;

  if (noteData.updatedAt && noteData.updatedAt !== noteData.createdAt) {
    response += `✏️ **Last Updated:** ${formatISTDate(noteData.updatedAt)}\n`;
  }

  if (noteData.linkedTask) {
    response += `🔗 **Linked Task:** ${noteData.linkedTask.title}\n`;
  } else {
    response += `📋 **Linked Task:** None (standalone note)\n`;
  }

  return response;
}

/**
 * Get tasks due in next N days
 */
async function getTasksDueInNextDays(days) {
  const now = new Date();
  const startOfToday = getISTStartOfDay();
  const endDate = new Date(startOfToday);
  endDate.setDate(startOfToday.getDate() + days);
  endDate.setHours(23, 59, 59, 999);

  // Convert to UTC for query
  const endUTC = new Date(endDate.getTime() - 5.5 * 60 * 60 * 1000);

  const tasks = await Task.find({
    dueDate: { $gte: startOfToday, $lte: endUTC },
    completed: false,
  }).sort({ dueDate: 1 });

  // Fetch reminders and notes
  const tasksWithDeps = await Promise.all(
    tasks.map(async (task) => {
      const reminder = task.reminderId
        ? await Reminder.findById(task.reminderId)
        : null;
      const note = task.noteId ? await Note.findById(task.noteId) : null;
      return { ...task.toObject(), reminder, note };
    }),
  );

  return tasksWithDeps;
}

/**
 * Handle multi-filter get tasks
 */
async function getTasksWithFilters(filters) {
  let query = { completed: false }; // Default to pending unless specified otherwise

  for (const filter of filters) {
    const f = filter.toLowerCase();

    // Status filters
    if (f === "completed") {
      query.completed = true;
    } else if (f === "pending") {
      query.completed = false;
    }

    // Priority filters
    else if (f === "high") {
      query.priority = "high";
    } else if (f === "medium") {
      query.priority = "medium";
    } else if (f === "low") {
      query.priority = "low";
    } else if (f === "important") {
      query.priority = "important";
    }

    // Special filters
    else if (f === "has-reminder" || f === "with reminder") {
      query.reminderId = { $ne: null };
    } else if (f === "no-reminder" || f === "without reminder") {
      query.reminderId = null;
    } else if (f === "has-note" || f === "with note") {
      query.noteId = { $ne: null };
    } else if (f === "no-note" || f === "without note") {
      query.noteId = null;
    }

    // Date filters
    else if (f === "today") {
      const { start, end } = getISTDayRange();
      query.dueDate = { $gte: start, $lt: end };
    } else if (f === "tomorrow") {
      const tomorrowStart = getISTStartOfNextDay();
      const dayAfter = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);
      query.dueDate = { $gte: tomorrowStart, $lt: dayAfter };
    } else if (f === "overdue") {
      const todayStart = getISTStartOfDay();
      query.dueDate = { $lt: todayStart };
      query.completed = false;
    }
  }

  let tasks = await Task.find(query)
    .sort({ dueDate: 1, createdAt: -1 })
    .limit(50);

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

  return tasksWithDeps;
}

/**
 * Handle multi-field task updates
 */
async function updateTaskMultiFields(searchQuery, updates) {
  const taskToUpdate = await findTaskByUpdateSearch(searchQuery);

  if (!taskToUpdate) {
    return { success: false, error: `Task "${searchQuery}" not found` };
  }

  const changes = [];
  const updateLog = {};
  let oldTitle = taskToUpdate.title;

  for (const [field, value] of Object.entries(updates)) {
    switch (field) {
      case "dueDate":
        const oldDueDate = taskToUpdate.dueDate
          ? new Date(taskToUpdate.dueDate)
          : null;
        const { date: newDueDate, error: dueError } = await applyDateTimeUpdate(
          oldDueDate,
          value,
        );

        if (dueError || !newDueDate) {
          changes.push(
            `❌ Due date: ${dueError || `Failed to parse ${value}`}`,
          );
        } else {
          taskToUpdate.dueDate = newDueDate;
          changes.push(`✅ Due date: ${formatISTDate(newDueDate)}`);
          updateLog.dueDate = true;
        }
        break;

      case "priority":
        if (
          ["low", "medium", "high", "important"].includes(value.toLowerCase())
        ) {
          taskToUpdate.priority = value.toLowerCase();
          changes.push(`✅ Priority: ${value}`);
          updateLog.priority = true;
        } else {
          changes.push(`❌ Priority: Invalid value "${value}"`);
        }
        break;

      case "title":
        taskToUpdate.title = value;
        changes.push(`✅ Title: "${oldTitle}" → "${value}"`);
        updateLog.title = true;
        break;

      case "completed":
        const isCompleted =
          value === "true" || value === "completed" || value === "done";
        taskToUpdate.completed = isCompleted;
        changes.push(`✅ Status: ${isCompleted ? "Completed" : "Pending"}`);
        updateLog.completed = true;
        break;

      case "note":
        let existingNote = taskToUpdate.noteId
          ? await Note.findById(taskToUpdate.noteId)
          : null;
        if (existingNote) {
          existingNote.content = value;
          await existingNote.save();
          changes.push(`✅ Note content updated`);
        } else {
          const newNote = new Note({
            title: `Note for ${taskToUpdate.title}`,
            content: value,
            taskId: taskToUpdate._id,
          });
          await newNote.save();
          taskToUpdate.noteId = newNote._id;
          changes.push(`✅ New note created with content`);
        }
        break;

      default:
        changes.push(`❌ Unknown field: ${field}`);
    }
  }

  await taskToUpdate.save();
  await updateDependencies(taskToUpdate, updateLog);

  return {
    success: true,
    task: taskToUpdate,
    changes: changes,
    message: `✅ Task "${taskToUpdate.title}" updated:\n${changes.join("\n")}`,
  };
}

function formatSingleNoteTable(noteData) {
  if (!noteData || !noteData.note) {
    return "📝 Note not found.";
  }

  const note = noteData.note;
  const task = noteData.linkedTask;
  const reminder = noteData.linkedReminder;

  // Set references
  setLastMentionedNote(note.title, note._id, note);
  if (task) setLastMentionedTask(task.title, task._id, task);
  if (reminder)
    setLastMentionedReminder(reminder.title, reminder._id, reminder);

  // ✅ CREATE TABLE FORMAT
  let table =
    "| Note Title | Content | Linked Task | Task Priority | Task Due Date |\n";
  table +=
    "|------------|---------|-------------|---------------|---------------|\n";

  // Clean content - remove newlines
  let content = note.content ? note.content.replace(/\n/g, " ") : "Empty";
  if (content.length > 50) {
    content = content.substring(0, 50) + "...";
  }

  const taskTitle = task ? task.title : "Standalone";
  const taskPriority = task ? task.priority : "N/A";
  const taskDueDate =
    task && task.dueDate ? formatISTDate(task.dueDate) : "No due date";

  table += `| ${note.title} | ${content} | ${taskTitle} | ${taskPriority} | ${taskDueDate} |\n`;

  if (reminder) {
    table += `\n⏰ **Reminder for this task:** ${reminder.title} at ${formatISTDate(reminder.remindAt)}\n`;
  }

  table += `\n💡 You can now ask: "Show **its task**" or "Show **its reminder**"`;

  return table;
}

function formatSingleReminderTable(reminderData) {
  if (!reminderData || !reminderData.reminder) {
    return "⏰ Reminder not found.";
  }

  const reminder = reminderData.reminder;
  const task = reminderData.linkedTask;
  const note = reminderData.linkedNote;

  // ✅ CRITICAL: Set last mentioned REMINDER
  setLastMentionedReminder(reminder.title, reminder._id, reminder);
  console.log(`📌 Set last mentioned reminder: "${reminder.title}"`);

  // Also set linked task if exists
  if (task) {
    setLastMentionedTask(task.title, task._id, task);
    console.log(`📌 Also set last mentioned task: "${task.title}"`);
  }

  // Also set linked note if exists
  if (note) {
    setLastMentionedNote(note.title, note._id, note);
    console.log(`📌 Also set last mentioned note: "${note.title}"`);
  }

  // Format the response
  let response = `⏰ **Reminder: "${reminder.title}"**\n`;
  response += `📅 Time: ${formatISTDate(reminder.remindAt)}\n`;
  response += `🆔 ID: ${reminder._id}\n`;

  if (task) {
    response += `\n📋 **Linked Task:** "${task.title}"\n`;
    response += `📌 Priority: ${task.priority}\n`;
    if (task.dueDate) response += `📅 Due: ${formatISTDate(task.dueDate)}\n`;
  } else {
    response += `\n📋 **Linked Task:** None (standalone reminder)\n`;
  }

  if (note) {
    response += `\n📝 **Linked Note:** "${note.title}"\n`;
  }

  response += `\n💡 You can now ask: "Show **its task**" or "Show **its note**"`;

  return response;
}
function formatSingleNoteTable(noteData) {
  if (!noteData || !noteData.note) {
    return "📝 Note not found.";
  }

  const note = noteData.note;
  const task = noteData.linkedTask;
  const reminder = noteData.linkedReminder;

  let response = `📝 **Note: "${note.title}"**\n`;
  response += `🆔 ID: ${note._id}\n`;

  let content = note.content ? note.content : "Empty";
  content = content.replace(/\n/g, " ");
  if (content.length > 200) content = content.substring(0, 200) + "...";
  response += `📄 Content: ${content}\n`;

  if (task) {
    response += `\n📋 **Linked Task:** "${task.title}"\n`;
    response += `📌 Priority: ${task.priority}\n`;
    if (task.dueDate) response += `📅 Due: ${formatISTDate(task.dueDate)}\n`;
  } else {
    response += `\n📋 **Linked Task:** None (standalone note)\n`;
  }

  if (reminder) {
    response += `\n⏰ **Reminder:** "${reminder.title}" at ${formatISTDate(reminder.remindAt)}\n`;
  }

  response += `\n💡 You can now ask: "Show **its task**" or "Get **task of this note**"`;

  return response;
}

/**
 * Format a single reminder as table
 * @param {Object} reminderData - Reminder data with linked task
 * @returns {string} - Formatted table
 */
function formatSingleReminderTable(reminderData) {
  if (!reminderData || !reminderData.reminder) {
    return "⏰ Reminder not found.";
  }

  const reminder = reminderData.reminder;
  const task = reminderData.linkedTask;
  const note = reminderData.linkedNote;

  let table =
    "| Reminder Title | Reminder Time | Linked Task | Task Priority | Task Status |\n";
  table +=
    "|----------------|---------------|-------------|---------------|-------------|\n";

  const taskTitle = task ? task.title : "Standalone";
  const taskPriority = task ? task.priority : "N/A";
  const taskStatus = task ? (task.completed ? "Completed" : "Pending") : "N/A";

  table += `| ${reminder.title} | ${formatISTDate(reminder.remindAt)} | ${taskTitle} | ${taskPriority} | ${taskStatus} |\n`;

  if (note) {
    const preview = note.content
      ? note.content.length > 50
        ? note.content.substring(0, 50) + "..."
        : note.content
      : "Empty";
    table += `\n📝 **Note for this task:** "${note.title}" - ${preview}`;
  }

  return table;
}
// Update formatTaskListWithDetailsTable function
function formatTaskListWithDetailsTable(tasks, action) {
  // Store the indexed table FIRST
  setLastDisplayedTable("tasks", tasks, action);

  let table =
    "| # | Task Title | Priority | Due Date | Status | Reminder | Note |\n";
  table +=
    "|---|------------|----------|----------|--------|----------|------|\n";

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const dueDate = task.dueDate ? formatISTDate(task.dueDate) : "No date";
    const status = task.completed ? "✅ Done" : "⏳ Pending";
    const reminder = task.reminder
      ? formatISTDate(task.reminder.remindAt)
      : "No reminder";
    const note = task.note ? (task.note.content ? "Yes" : "Empty") : "No note";

    table += `| ${i + 1} | ${task.title} | ${task.priority} | ${dueDate} | ${status} | ${reminder} | ${note} |\n`;
  }

  let title = "Tasks";
  if (action?.status === "pending") title = "Pending Tasks";
  if (action?.status === "important") title = "Important Tasks";
  if (action?.status === "overdue") title = "Overdue Tasks";
  if (action?.special === "weekend") title = "Weekend Tasks";
  if (action?.special === "has-reminder") title = "Tasks with Reminders";

  let footer = `\n💡 You can now ask: "Give details of **first one**" or "What about **second task**" or "Show me **the last one**"`;

  return `📋 **${title}** (${tasks.length} found):\n\n${table}${footer}`;
}

// Update formatRemindersAsTable function
function formatRemindersAsTable(reminders) {
  if (!reminders || reminders.length === 0) return "No reminders found.";

  // Store the indexed table
  setLastDisplayedTable("reminders", reminders);

  let table = "| # | Reminder Title | Time | Linked Task |\n";
  table += "|---|----------------|------|-------------|\n";

  for (let i = 0; i < reminders.length; i++) {
    const reminder = reminders[i];
    const title = reminder.title || "Untitled";
    const time = reminder.remindAt
      ? formatISTDate(reminder.remindAt)
      : "No time set";
    const linkedTask = reminder.linkedTask ? reminder.linkedTask.title : "None";

    table += `| ${i + 1} | ${title} | ${time} | ${linkedTask} |\n`;
  }

  let footer = `\n💡 You can now ask: "Give details of **first one**" or "What about **second reminder**" or "Show me **the last one**"`;

  return `Found ${reminders.length} reminder(s):\n\n${table}${footer}`;
}

// Update formatNotesAsTable function
function formatNotesAsTable(notes) {
  if (!notes || notes.length === 0) return "No notes found.";

  // Store the indexed table
  setLastDisplayedTable("notes", notes);

  let table = "| # | Note Title | Content Preview | Linked Task | Created |\n";
  table += "|---|------------|----------------|-------------|-------|\n";

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    let preview = note.content || "Empty";
    preview = preview.replace(/\n/g, " ").substring(0, 60);
    if (preview.length === 60) preview += "...";
    const linkedTask = note.linkedTask ? note.linkedTask.title : "Standalone";
    const created = note.createdAt ? formatISTDate(note.createdAt) : "Unknown";

    table += `| ${i + 1} | ${note.title} | ${preview} | ${linkedTask} | ${created} |\n`;
  }

  let footer = `\n💡 You can now ask: "Give details of **first one**" or "What about **second note**" or "Show me **the last one**"`;

  return `Found ${notes.length} note(s):\n\n${table}${footer}`;
}

// Update formatRecentTasksTable function
function formatRecentTasksTable(tasks) {
  if (!tasks || tasks.length === 0) return "📋 No recent tasks found.";

  // Store the indexed table
  setLastDisplayedTable("tasks", tasks, { type: "recent" });

  let table = "| # | Task Title | Priority | Due Date | Status | Created |\n";
  table += "|---|------------|----------|----------|--------|---------|\n";

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const dueDate = task.dueDate ? formatISTDate(task.dueDate) : "No date";
    const status = task.completed ? "✅ Done" : "⏳ Pending";
    const created = formatISTDate(task.createdAt);
    table += `| ${i + 1} | ${task.title} | ${task.priority} | ${dueDate} | ${status} | ${created} |\n`;
  }

  let footer = `\n💡 You can now ask: "Give details of **first one**" or "What about **second task**"`;

  return `📋 **Recently Created Tasks** (Last ${tasks.length}):\n\n${table}${footer}`;
}

function formatRecentRemindersTable(reminders) {
  if (!reminders || reminders.length === 0) {
    return "⏰ No recent reminders found.";
  }

  let table = "| Reminder Title | Reminder Time | Linked Task | Created |\n";
  table += "|----------------|---------------|-------------|---------|\n";

  for (const reminder of reminders) {
    const time = formatISTDate(reminder.remindAt);
    const linkedTask = reminder.linkedTask
      ? reminder.linkedTask.title
      : "Standalone";
    const created = formatISTDate(reminder.createdAt);
    table += `| ${reminder.title} | ${time} | ${linkedTask} | ${created} |\n`;
  }

  return `⏰ **Recently Created Reminders** (Last ${reminders.length}):\n\n${table}`;
}

function formatRecentNotesTable(notes) {
  if (!notes || notes.length === 0) {
    return "📝 No recent notes found.";
  }

  let table = "| Note Title | Content Preview | Linked Task | Created |\n";
  table += "|------------|----------------|-------------|---------|\n";

  for (const note of notes) {
    const preview = note.content
      ? note.content.substring(0, 50) + "..."
      : "Empty";
    const linkedTask = note.linkedTask ? note.linkedTask.title : "Standalone";
    const created = formatISTDate(note.createdAt);
    table += `| ${note.title} | ${preview} | ${linkedTask} | ${created} |\n`;
  }

  return `📝 **Recently Created Notes** (Last ${notes.length}):\n\n${table}`;
}

function formatRecentAllTable(recent) {
  let output = "";

  if (recent.tasks && recent.tasks.length > 0) {
    output += formatRecentTasksTable(recent.tasks) + "\n\n";
  }

  if (recent.reminders && recent.reminders.length > 0) {
    output += formatRecentRemindersTable(recent.reminders) + "\n\n";
  }

  if (recent.notes && recent.notes.length > 0) {
    output += formatRecentNotesTable(recent.notes);
  }

  if (!output) {
    output = "No recent items found.";
  }

  return output;
}
// Helper function to format tasks as table
function formatTaskListAsTable(tasks, filters = {}) {
  if (!tasks || tasks.length === 0) return "No tasks found.";

  let table = "| Task Title | Priority | Due Date | Status |\n";
  table += "|------------|----------|----------|--------|\n";

  for (const task of tasks) {
    const dueDate = task.dueDate ? formatISTDate(task.dueDate) : "No date";
    const status = task.completed ? "✅ Done" : "⏳ Pending";
    table += `| ${task.title} | ${task.priority} | ${dueDate} | ${status} |\n`;
  }

  return `Found ${tasks.length} task(s):\n\n${table}`;
}

// ============ API ENDPOINTS ============

// Delete task
app.delete("/api/tasks/:id", async (req, res) => {
  try {
    await deleteDependencies(req.params.id);
    await Task.findByIdAndDelete(req.params.id);
    res.json({ message: "Task and its dependencies deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Update task status
app.put("/api/tasks/:id", async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete note
app.delete("/api/notes/:id", async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (note && note.taskId) {
      // Clear noteId from linked task
      await Task.findByIdAndUpdate(note.taskId, { noteId: null });
    }
    await Note.findByIdAndDelete(req.params.id);
    res.json({ message: "Note deleted and task reference cleared" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search by keyword
app.get("/api/search/:keyword", async (req, res) => {
  const result = await searchAllByKeyword(req.params.keyword);
  if (!result) return res.json({ message: "No results found" });
  res.json(result);
});

// Delete reminder
app.delete("/api/reminders/:id", async (req, res) => {
  try {
    const reminder = await Reminder.findById(req.params.id);
    if (reminder && reminder.taskId) {
      // Clear reminderId from linked task
      await Task.findByIdAndUpdate(reminder.taskId, { reminderId: null });
    }
    await Reminder.findByIdAndDelete(req.params.id);
    res.json({ message: "Reminder deleted and task reference cleared" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all tasks
app.get("/api/tasks", async (req, res) => {
  try {
    const { priority, limit } = req.query;
    let query = {};
    if (priority) query.priority = priority;

    let tasks = Task.find(query).sort({ dueDate: 1 });
    if (limit) tasks = tasks.limit(parseInt(limit));

    res.json(await tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get task by ID with dependencies
app.get("/api/task/:id", async (req, res) => {
  const result = await getTaskWithDependencies(req.params.id);
  if (!result) return res.status(404).json({ error: "Task not found" });
  res.json(result);
});

// Get task by name
app.get("/api/task/by-name/:title", async (req, res) => {
  const task = await Task.findOne({
    title: { $regex: new RegExp(`^${req.params.title}$`, "i") },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });

  const result = await getTaskWithDependencies(task._id);
  console.log("Result:", result);
  res.json(result);
});

// Get reminder by ID
app.get("/api/reminder/:id", async (req, res) => {
  const result = await getReminderWithDependenciesById(req.params.id);
  if (!result) return res.status(404).json({ error: "Reminder not found" });
  res.json(result);
});

// Get reminder by name
app.get("/api/reminder/by-name/:title", async (req, res) => {
  const reminder = await Reminder.findOne({
    title: { $regex: new RegExp(req.params.title, "i") },
  });
  if (!reminder) return res.status(404).json({ error: "Reminder not found" });

  const result = await getReminderWithDependenciesById(reminder._id);
  res.json(result);
});

// Get note by name
app.get("/api/note/by-name/:title", async (req, res) => {
  const note = await Note.findOne({
    title: { $regex: new RegExp(req.params.title, "i") },
  });
  if (!note) return res.status(404).json({ error: "Note not found" });

  const result = await getNoteWithDependenciesById(note._id);
  res.json(result);
});

// Get note by ID
app.get("/api/note/:id", async (req, res) => {
  const result = await getNoteWithDependenciesById(req.params.id);
  if (!result) return res.status(404).json({ error: "Note not found" });
  res.json(result);
});

// Get all notes
app.get("/api/notes", async (req, res) => {
  try {
    const notes = await Note.find();
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all reminders
app.get("/api/reminders", async (req, res) => {
  try {
    const reminders = await Reminder.find();
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create reminder (datetime-local values treated as IST → stored UTC)
app.post("/api/reminders", async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.remindAt && typeof body.remindAt === "string") {
      body.remindAt = await parseDate(body.remindAt.replace("T", " "));
    }
    const reminder = new Reminder(body);
    const saved = await reminder.save();
    res.json(saved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create task
app.post("/api/tasks", async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.dueDate && typeof body.dueDate === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
        body.dueDate = await parseDate(`${body.dueDate} 9am`);
      } else {
        body.dueDate = await parseDate(body.dueDate.replace("T", " "));
      }
    }
    const task = new Task(body);
    const savedTask = await task.save();
    const result = await autoCreateDependencies(savedTask);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update task
app.put("/api/tasks/:id", async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ CHAT ENDPOINT ============

app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message) {
    return res.json({ reply: "Please send a message!" });
  }

  try {
    // 1. Fetch relevant data from database
    const relevantData = await fetchRelevantData(message);
    const contextData = formatContextForAI(relevantData);

    // 2. Get AI response
    const { reply, action } = await getAIResponse(
      message,
      contextData,
      sessionId,
    );

    let finalReply = reply;
    let actionResult = null;
    let createdItem = null;

    // 3. Handle actions from AI
    if (action) {
      console.log(`🤖 AI Action Detected: ${action.type}`);
      if (
        action.searchQuery &&
        (action.type === "UPDATE_TASK" ||
          action.type === "UPDATE_REMINDER" ||
          action.type === "DELETE_TASK" ||
          action.type === "DELETE_REMINDER" ||
          action.type === "GET_REMINDER")
      ) {
        action.searchQuery = resolveUpdateSearchQuery(
          message,
          action.searchQuery,
        );
        console.log(`🔍 Resolved searchQuery: "${action.searchQuery}"`);
      }
      switch (action.type) {
        case "CREATE_TASK":
          console.log(`📝 Creating task:`);
          console.log(`   Title: "${action.title}"`);
          console.log(`   Priority: "${action.priority}"`);
          console.log(`   Due Date String: "${action.dueDate}"`);

          let dueDate = null;
          let originalDueDateString = action.dueDate || "";
          let hasExplicitTime = false;

          if (
            action.dueDate &&
            action.dueDate !== "null" &&
            action.dueDate !== "undefined"
          ) {
            dueDate = await parseDate(action.dueDate);
            console.log(`   Parsed due date: ${dueDate}`);
            console.log(
              `   Parsed due date UTC: ${dueDate ? dueDate.toISOString() : "null"}`,
            );

            hasExplicitTime =
              /(?:\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))/i.test(
                originalDueDateString,
              );
            console.log(`   Has explicit time: ${hasExplicitTime}`);
          }

          const task = new Task({
            title: action.title,
            priority: ["low", "medium", "high", "important"].includes(
              action.priority,
            )
              ? action.priority
              : "medium",
            dueDate: dueDate,
            completed: false,
          });

          const savedTask = await task.save();
          console.log(`  ✅ Task saved with ID: ${savedTask._id}`);

          // ✅ Create dependencies FIRST
          const {
            reminder: autoReminder,
            note: autoNote,
            error: autoError,
          } = await autoCreateDependencies(savedTask, hasExplicitTime);

          // ✅ THEN set as last mentioned task (after full creation)
          setLastMentionedTask(savedTask.title, savedTask._id);
          console.log(
            `📌 Last mentioned task set to: "${savedTask.title}" (ID: ${savedTask._id})`,
          );

          let successMessage = `✅ Task "${action.title}" has been created with ${action.priority || "medium"} priority!\n\n`;

          if (autoReminder && originalDueDateString) {
            successMessage += `⏰ Reminder set for: ${originalDueDateString}\n`;
          } else if (autoReminder && dueDate) {
            successMessage += `⏰ Reminder set for: ${formatISTDate(dueDate)}\n`;
          }

          if (autoNote) {
            successMessage += `📝 Notes page created for tracking progress\n`;
          }

          if (autoError) {
            successMessage += `\n⚠️ Note: Auto-reminder/note creation had issues, but task was saved.`;
          }

          createdItem = savedTask;
          actionResult = savedTask;
          finalReply = successMessage.trim();
          break;

        // Add after existing cases in the chat endpoint

        case "GET_BY_POSITION":
          console.log(`📍 Getting item by position: "${action.position}"`);

          const tableData = getLastDisplayedTable();

          if (!tableData) {
            finalReply = `📋 No table data available. Please list tasks, reminders, or notes first (e.g., "list tasks", "show reminders", "get notes").`;
            break;
          }

          const positionResult = getItemByPosition({ value: action.position });

          if (positionResult.error) {
            finalReply = positionResult.error;
            break;
          }

          // Display the item based on its type
          const item = positionResult.item;
          const itemType = positionResult.type;
          const itemIndex = positionResult.index;

          console.log(
            `✅ Found item at position ${itemIndex}: "${item.title}" (${itemType})`,
          );

          // ============================================
          // CRITICAL: Set the appropriate last mentioned entity
          // ============================================

          switch (itemType) {
            case "tasks":
              // Set as last mentioned TASK
              setLastMentionedTask(item.title, item._id, item);
              console.log(
                `📌 Set last mentioned TASK: "${item.title}" (ID: ${item._id})`,
              );

              // Also fetch and set linked reminder if exists
              const reminder = item.reminderId
                ? await Reminder.findById(item.reminderId)
                : null;
              if (reminder) {
                setLastMentionedReminder(
                  reminder.title,
                  reminder._id,
                  reminder,
                );
                console.log(
                  `📌 Also set last mentioned REMINDER: "${reminder.title}"`,
                );
              }

              // Also fetch and set linked note if exists
              const note = item.noteId
                ? await Note.findById(item.noteId)
                : null;
              if (note) {
                setLastMentionedNote(note.title, note._id, note);
                console.log(`📌 Also set last mentioned NOTE: "${note.title}"`);
              }

              finalReply = formatSingleTaskTable(item, reminder, note);
              finalReply += `\n\n📍 **[Task ${itemIndex} of ${tableData.count}]** from your list.`;
              finalReply += `\n\n💡 You can now ask:\n   • "Show **its reminder**"\n   • "Show **its note**"\n   • "Update **this task**"`;
              break;

            case "reminders":
              // Set as last mentioned REMINDER
              setLastMentionedReminder(item.title, item._id, item);
              console.log(
                `📌 Set last mentioned REMINDER: "${item.title}" (ID: ${item._id})`,
              );

              // Fetch and set linked task if exists
              const linkedTask = item.taskId
                ? await Task.findById(item.taskId)
                : null;
              if (linkedTask) {
                setLastMentionedTask(
                  linkedTask.title,
                  linkedTask._id,
                  linkedTask,
                );
                console.log(
                  `📌 Also set last mentioned TASK: "${linkedTask.title}"`,
                );

                // Also fetch note for the task
                if (linkedTask.noteId) {
                  const linkedNote = await Note.findById(linkedTask.noteId);
                  if (linkedNote) {
                    setLastMentionedNote(
                      linkedNote.title,
                      linkedNote._id,
                      linkedNote,
                    );
                    console.log(
                      `📌 Also set last mentioned NOTE: "${linkedNote.title}"`,
                    );
                  }
                }
              }

              finalReply = formatSingleReminderTable({
                reminder: item,
                linkedTask: linkedTask,
              });
              finalReply += `\n\n📍 **[Reminder ${itemIndex} of ${tableData.count}]** from your list.`;
              if (linkedTask) {
                finalReply += `\n\n💡 You can now ask:\n   • "Show **its task**"\n   • "Show **its note**"\n   • "Update **this reminder**"`;
              } else {
                finalReply += `\n\n💡 You can now ask:\n   • "Update **this reminder**"\n   • "Delete **this reminder**"`;
              }
              break;

            case "notes":
              // Set as last mentioned NOTE
              setLastMentionedNote(item.title, item._id, item);
              console.log(
                `📌 Set last mentioned NOTE: "${item.title}" (ID: ${item._id})`,
              );

              // Fetch and set linked task if exists
              const linkedTaskForNote = item.taskId
                ? await Task.findById(item.taskId)
                : null;
              if (linkedTaskForNote) {
                setLastMentionedTask(
                  linkedTaskForNote.title,
                  linkedTaskForNote._id,
                  linkedTaskForNote,
                );
                console.log(
                  `📌 Also set last mentioned TASK: "${linkedTaskForNote.title}"`,
                );

                // Also fetch reminder for the task
                if (linkedTaskForNote.reminderId) {
                  const linkedReminder = await Reminder.findById(
                    linkedTaskForNote.reminderId,
                  );
                  if (linkedReminder) {
                    setLastMentionedReminder(
                      linkedReminder.title,
                      linkedReminder._id,
                      linkedReminder,
                    );
                    console.log(
                      `📌 Also set last mentioned REMINDER: "${linkedReminder.title}"`,
                    );
                  }
                }
              }

              finalReply = formatSingleNoteTable({
                note: item,
                linkedTask: linkedTaskForNote,
              });
              finalReply += `\n\n📍 **[Note ${itemIndex} of ${tableData.count}]** from your list.`;
              if (linkedTaskForNote) {
                finalReply += `\n\n💡 You can now ask:\n   • "Show **its task**"\n   • "Show **its reminder**"\n   • "Get **content of this note**"`;
              } else {
                finalReply += `\n\n💡 You can now ask:\n   • "Get **content of this note**"\n   • "Update **this note**"`;
              }
              break;

            default:
              finalReply = `📋 Found: "${item.title}" (${itemType}) - Position #${itemIndex}`;
          }

          // Add navigation hints
          if (positionResult.hasPrevious || positionResult.hasNext) {
            finalReply += `\n\n📋 **Navigation:**`;
            if (positionResult.hasPrevious) {
              finalReply += `\n   • "show previous" or "go to item ${itemIndex - 1}"`;
            }
            if (positionResult.hasNext) {
              finalReply += `\n   • "show next" or "go to item ${itemIndex + 1}"`;
            }
            finalReply += `\n   • "list all" to see the full table again`;
          }
          break;

        case "GET_NOTE_CONTENT":
          console.log(`📝 Getting note content: "${action.searchQuery}"`);

          const cleanNoteContentQuery = action.searchQuery
            .replace(
              /\b(note|content|of|the|show|read|display|get|me|what does|say)\b/gi,
              "",
            )
            .trim();

          const noteContentData = await getNoteContent(cleanNoteContentQuery);

          if (!noteContentData) {
            finalReply = `📝 Note "${action.searchQuery}" not found.`;
          } else {
            finalReply = formatNoteContent(noteContentData);
          }
          break;

        case "GET_TASK_MULTI":
          console.log(`🔍 Multi-filter get tasks:`, action.filters);

          const filteredTasks = await getTasksWithFilters(action.filters);

          if (filteredTasks.length === 0) {
            finalReply = `📋 No tasks found matching: ${action.filters.join(", ")}`;
          } else {
            finalReply = formatTaskListWithDetailsTable(filteredTasks, {
              status: "filtered",
            });

            // Set first task as last mentioned
            setLastMentionedTask(
              filteredTasks[0].title,
              filteredTasks[0]._id,
              filteredTasks[0],
            );
          }
          break;

        case "UPDATE_TASK_MULTI":
          console.log(`🔄 Multi-field update task:`, {
            searchQuery: action.searchQuery,
            updates: action.updates,
          });

          const multiUpdateResult = await updateTaskMultiFields(
            action.searchQuery,
            action.updates,
          );

          if (!multiUpdateResult.success) {
            finalReply = `❌ ${multiUpdateResult.error}`;
          } else {
            finalReply = multiUpdateResult.message;
            setLastMentionedTask(
              multiUpdateResult.task.title,
              multiUpdateResult.task._id,
              multiUpdateResult.task,
            );
          }
          break;

        case "UPDATE_REMINDER_MULTI":
          console.log(`🔄 Multi-field update reminder:`, action.updates);

          const reminderToUpdateMulti = await findReminderByUpdateSearch(
            action.searchQuery,
          );

          if (!reminderToUpdateMulti) {
            finalReply = `❌ Reminder "${action.searchQuery}" not found.`;
          } else {
            const reminderChanges = [];

            for (const [field, value] of Object.entries(action.updates)) {
              if (field === "remindAt") {
                const oldRemindAt = reminderToUpdateMulti.remindAt
                  ? new Date(reminderToUpdateMulti.remindAt)
                  : null;
                const { date: newRemindAt, error: remindError } =
                  await applyDateTimeUpdate(oldRemindAt, value);

                if (remindError || !newRemindAt) {
                  reminderChanges.push(
                    `❌ Remind at: ${remindError || `Failed to parse ${value}`}`,
                  );
                } else {
                  reminderToUpdateMulti.remindAt = newRemindAt;
                  reminderChanges.push(
                    `✅ Remind at: ${formatISTDate(newRemindAt)}`,
                  );
                }
              } else if (field === "title") {
                const oldTitle = reminderToUpdateMulti.title;
                reminderToUpdateMulti.title = value;
                reminderChanges.push(`✅ Title: "${oldTitle}" → "${value}"`);
              }
            }

            await reminderToUpdateMulti.save();

            if (reminderToUpdateMulti.taskId) {
              const linkedTask = await Task.findById(
                reminderToUpdateMulti.taskId,
              );
              if (
                linkedTask &&
                reminderChanges.some((c) => c.includes("Remind at"))
              ) {
                linkedTask.dueDate = reminderToUpdateMulti.remindAt;
                await linkedTask.save();
                reminderChanges.push(
                  `✅ Linked task due date updated to match`,
                );
              }
            }

            finalReply = `✅ Reminder updated:\n${reminderChanges.join("\n")}`;
          }
          break;

        case "UPDATE_NOTE_MULTI":
          console.log(`🔄 Multi-field update note:`, action.updates);

          const noteToUpdateMulti = await Note.findOne({
            title: {
              $regex: new RegExp(`^${escapeRegex(action.searchQuery)}$`, "i"),
            },
          });

          if (!noteToUpdateMulti) {
            finalReply = `❌ Note "${action.searchQuery}" not found.`;
          } else {
            const noteChanges = [];

            for (const [field, value] of Object.entries(action.updates)) {
              if (field === "title") {
                const oldTitle = noteToUpdateMulti.title;
                noteToUpdateMulti.title = value;
                noteChanges.push(`✅ Title: "${oldTitle}" → "${value}"`);
              } else if (field === "content") {
                noteToUpdateMulti.content = value;
                noteChanges.push(`✅ Content updated`);
              }
            }

            await noteToUpdateMulti.save();
            finalReply = `✅ Note updated:\n${noteChanges.join("\n")}`;
          }
          break;

        case "SHOW_STATS":
          console.log(`📊 Getting task statistics`);
          const stats = await getDashboardStats();
          finalReply = formatDashboardTable(stats);
          break;

        case "SHOW_DASHBOARD":
          console.log(`📊 Getting full dashboard`);
          const dashboardStats = await getDashboardStats();
          finalReply = formatDashboardTable(dashboardStats);
          break;

        case "QUICK_OVERVIEW":
          console.log(`📋 Getting quick overview`);
          const overview = await getQuickOverview();
          finalReply = formatQuickOverview(overview);
          break;
        case "LIST_TASKS":
          console.log(
            `📋 Listing tasks with status: "${action.status}", special: "${action.special}"`,
          );

          // Clean the status and special values
          let cleanStatus = action.status;
          let cleanSpecial = action.special;

          if (cleanStatus) {
            cleanStatus = cleanStatus.split("\n")[0];
            cleanStatus = cleanStatus.replace(/\s+I'll.*$/i, "");
            cleanStatus = cleanStatus.replace(/\s+Here.*$/i, "");
            cleanStatus = cleanStatus.replace(/\s+Let me.*$/i, "");
            cleanStatus = cleanStatus.trim();
          }

          if (cleanSpecial) {
            cleanSpecial = cleanSpecial.split("\n")[0];
            cleanSpecial = cleanSpecial.replace(/\s+I'll.*$/i, "");
            cleanSpecial = cleanSpecial.replace(/\s+Here.*$/i, "");
            cleanSpecial = cleanSpecial.replace(/\s+Let me.*$/i, "");
            cleanSpecial = cleanSpecial.trim();
          }
          const filters = {};

          // Handle status
          switch (action.status) {
            case "pending":
              filters.status = "pending";
              break;
            case "completed":
              filters.status = "completed";
              break;
            case "important":
              filters.priority = "important";
              filters.status = "pending";
              break;
            case "high":
              filters.priority = "high";
              filters.status = "pending";
              break;
            case "medium":
              filters.priority = "medium";
              filters.status = "pending";
              break;
            case "low":
              filters.priority = "low";
              filters.status = "pending";
              break;
            case "overdue":
              filters.dueDate = "overdue";
              filters.status = "pending";
              break;
            case "today": // ✅ ADD THIS - for "show me my day"
              filters.dueDate = "today";
              filters.status = "pending";
              break;
            case "tomorrow":
              filters.dueDate = "tomorrow";
              filters.status = "pending";
              break;
            case "day-after-tomorrow":
              filters.dueDate = "day after tomorrow";
              filters.status = "pending";
              break;
            case "this-week":
              filters.dueDate = "this-week";
              filters.status = "pending";
              break;
            default:
              if (!cleanSpecial) {
                filters.status = "pending";
              }
          }

          // Handle special filters
          if (action.special) {
            switch (action.special) {
              case "weekend":
                // Weekend = Saturday and Sunday
                // For simplicity, show tasks due in next 2-3 days
                const today = new Date();
                const currentDay = today.getDay(); // 0=Sunday, 1=Monday...
                let daysUntilSaturday = 6 - currentDay; // Saturday is 6
                if (daysUntilSaturday < 0) daysUntilSaturday += 7;
                filters.dueDate = "weekend";
                break;

              case "has-reminder":
                // Tasks that have a reminder
                filters.hasReminder = true;
                break;

              case "has-note":
                filters.hasNote = true;
                break;

              case "today":
                filters.dueDate = "today";
                break;

              case "tomorrow":
                filters.dueDate = "tomorrow";
                break;

              case "day-after-tomorrow":
                filters.dueDate = "day after tomorrow";
                break;

              case "this-week":
                filters.dueDate = "this-week";
                break;
            }
          }

          // Build query based on filters
          let query = {};

          // Status filter
          if (filters.status === "pending") {
            query.completed = false;
          } else if (filters.status === "completed") {
            query.completed = true;
          }

          // Priority filter
          if (filters.priority) {
            query.priority = filters.priority;
          }

          // Due date filter
          if (filters.dueDate === "overdue") {
            const todayStart = getISTStartOfDay();
            query.dueDate = { $lt: todayStart };
            query.completed = false;
          } else if (filters.dueDate === "today") {
            const { start, end } = getISTDayRange();
            query.dueDate = { $gte: start, $lt: end };
          } else if (filters.dueDate === "tomorrow") {
            const tomorrowStart = getISTStartOfNextDay();
            const dayAfter = new Date(
              tomorrowStart.getTime() + 24 * 60 * 60 * 1000,
            );
            query.dueDate = { $gte: tomorrowStart, $lt: dayAfter };
          } else if (filters.dueDate === "day after tomorrow") {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dayAfterTomorrow = new Date(today);
            dayAfterTomorrow.setDate(today.getDate() + 2);
            const nextDay = new Date(dayAfterTomorrow);
            nextDay.setDate(dayAfterTomorrow.getDate() + 1);
            const startUTC = new Date(
              dayAfterTomorrow.getTime() - 5.5 * 60 * 60 * 1000,
            );
            const endUTC = new Date(nextDay.getTime() - 5.5 * 60 * 60 * 1000);
            query.dueDate = { $gte: startUTC, $lt: endUTC };
          } else if (filters.dueDate === "this-week") {
            const { start } = getISTDayRange();
            const endOfWeek = new Date(start);
            const istWeekday = getISTWeekday();
            endOfWeek.setTime(
              start.getTime() + (7 - istWeekday) * 24 * 60 * 60 * 1000,
            );
            query.dueDate = { $gte: start, $lte: endOfWeek };
          } else if (filters.dueDate === "weekend") {
            // Weekend = upcoming Saturday and Sunday
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const currentDay = today.getDay();
            let daysUntilSaturday = 6 - currentDay;
            if (daysUntilSaturday < 0) daysUntilSaturday += 7;
            const saturday = new Date(today);
            saturday.setDate(today.getDate() + daysUntilSaturday);
            const sunday = new Date(saturday);
            sunday.setDate(saturday.getDate() + 1);
            const sundayEnd = new Date(sunday);
            sundayEnd.setHours(23, 59, 59, 999);
            const startUTC = new Date(
              saturday.getTime() - 5.5 * 60 * 60 * 1000,
            );
            const endUTC = new Date(sundayEnd.getTime() - 5.5 * 60 * 60 * 1000);
            query.dueDate = { $gte: startUTC, $lte: endUTC };
          }
          // Add this inside the LIST_TASKS case, in the due date filter section

          // NEXT X DAYS filter (NEW)

          // Has reminder filter
          if (filters.hasReminder) {
            query.reminderId = { $ne: null };
          }

          // Has note filter
          if (filters.hasNote) {
            query.noteId = { $ne: null };
          }

          console.log("📋 Final query:", JSON.stringify(query, null, 2));

          let tasks = await Task.find(query).sort({ dueDate: 1 }).limit(50);

          // Fetch reminders and notes
          const tasksWithDeps = await Promise.all(
            tasks.map(async (task) => {
              const reminder = task.reminderId
                ? await Reminder.findById(task.reminderId)
                : null;
              const note = task.noteId
                ? await Note.findById(task.noteId)
                : null;
              return { ...task.toObject(), reminder, note };
            }),
          );

          if (tasksWithDeps.length === 0) {
            finalReply = `📋 No tasks found matching your criteria.`;
          } else {
            finalReply = formatTaskListWithDetailsTable(tasksWithDeps, action);
          }
          break;
        case "LIST_NOTES":
          console.log(`📝 Listing notes with filter: "${action.filter}"`);

          const noteFilters = {};
          if (action.filter) {
            const filterLower = action.filter.toLowerCase();
            if (filterLower.includes("with content"))
              noteFilters.hasContent = true;
            if (filterLower.includes("linked")) noteFilters.linked = true;
            if (
              filterLower.includes("unlinked") ||
              filterLower.includes("standalone")
            )
              noteFilters.linked = false;
            if (filterLower.includes("recent"))
              noteFilters.createdAfter = new Date(
                Date.now() - 7 * 24 * 60 * 60 * 1000,
              );
          }

          const listedNotes = await listNotes(noteFilters);

          if (listedNotes.length === 0) {
            finalReply = `📝 No notes found matching your criteria.`;
          } else {
            finalReply = formatNotesAsTable(listedNotes);
          }
          break;

        case "LIST_REMINDERS":
          console.log(`⏰ Listing reminders with filter: "${action.filter}"`);

          const reminderFilters = {};
          if (action.filter) {
            const filterLower = action.filter.toLowerCase();
            if (filterLower.includes("today")) {
              reminderFilters.remindAt = "today";
            } else if (filterLower.includes("tomorrow")) {
              reminderFilters.remindAt = "tomorrow";
            } else if (filterLower.includes("this week")) {
              reminderFilters.remindAt = "this week"; // Keep as "this week" with space
            } else if (filterLower.includes("upcoming")) {
              reminderFilters.remindAt = "upcoming";
            }
          }
          const listedReminders = await listReminders(reminderFilters);

          if (listedReminders.length === 0) {
            finalReply = `⏰ No reminders found matching your criteria.`;
          } else {
            finalReply = formatRemindersAsTable(listedReminders);
          }
          break;

        case "UPDATE_TASK":
          console.log(`📝 Updating task: "${action.searchQuery}"`);

          const taskToUpdate = await findTaskByUpdateSearch(action.searchQuery);

          if (!taskToUpdate) {
            finalReply = isThisTaskPlaceholder(action.searchQuery)
              ? `❌ I don't have a current task in context. Open a task or mention one by name, then try again.`
              : `❌ Could not find a task titled "${action.searchQuery}".`;
            break;
          }

          setLastMentionedTask(taskToUpdate.title, taskToUpdate._id);

          const updates = {};
          let oldTitle = taskToUpdate.title;

          switch (action.field) {
            // =========================================
            // UPDATE DUE DATE / TIME
            // =========================================
            case "dueDate": {
              const oldDueDate = taskToUpdate.dueDate
                ? new Date(taskToUpdate.dueDate)
                : null;
              const {
                date: newDueDate,
                changeType,
                mode,
                error: dueError,
              } = await applyDateTimeUpdate(oldDueDate, action.newValue);

              if (dueError || !newDueDate) {
                finalReply = `❌ ${dueError || `Failed to parse: ${action.newValue}`}`;
                break;
              }

              console.log(
                `  📅 Task schedule update (${mode}): ${formatISTDate(newDueDate)}`,
              );

              taskToUpdate.dueDate = newDueDate;
              updates.dueDate = true;
              updates.changeType = changeType;
              await taskToUpdate.save();

              await updateDependencies(taskToUpdate, updates, { oldDueDate });

              finalReply = `✅ Task "${taskToUpdate.title}" ${changeType} updated to ${formatISTDate(newDueDate)}`;
              if (taskToUpdate.reminderId) {
                finalReply += `\n⏰ Linked reminder updated to match.`;
              }
              break;
            }

            // =========================================
            // UPDATE PRIORITY
            // =========================================
            case "priority":
              if (
                ["low", "medium", "high", "important"].includes(
                  action.newValue.toLowerCase(),
                )
              ) {
                taskToUpdate.priority = action.newValue.toLowerCase();

                updates.priority = true;

                await taskToUpdate.save();

                finalReply = `✅ Priority updated to: ${action.newValue}`;

                console.log(`  ✅ Priority updated to: ${action.newValue}`);
              } else {
                finalReply = `❌ Invalid priority value: ${action.newValue}`;
              }

              break;

            // =========================================
            // UPDATE TITLE
            // =========================================
            case "title":
              taskToUpdate.title = action.newValue;

              updates.title = true;

              await taskToUpdate.save();

              // Update reminder + note titles
              await updateDependencies(taskToUpdate, updates);

              finalReply =
                `✅ Title updated from "${oldTitle}" to "${action.newValue}"` +
                `\n📝 Linked reminder and note titles updated automatically.`;

              console.log(
                `  ✅ Title updated from "${oldTitle}" to "${action.newValue}"`,
              );

              break;

            // =========================================
            // UPDATE COMPLETED STATUS
            // =========================================
            case "completed":
              const isCompleted =
                action.newValue === "true" ||
                action.newValue === "completed" ||
                action.newValue === "done";

              taskToUpdate.completed = isCompleted;

              updates.completed = true;

              await taskToUpdate.save();

              finalReply = isCompleted
                ? `🎉 Task marked as completed!`
                : `📋 Task marked as pending.`;

              console.log(`  ✅ Completed status updated to: ${isCompleted}`);

              break;

            // =========================================
            // UNKNOWN FIELD
            // =========================================
            default:
              finalReply = `❌ I don't know how to update the field "${action.field}".`;

              break;
          }

          createdItem = taskToUpdate;
          actionResult = taskToUpdate;

          break;

        case "GET_TASK":
          console.log(`📋 Getting task: "${action.searchQuery}"`);

          let taskQuery = action.searchQuery;
          let taskToGet = null;
          let reminderDataForTask = null; // Renamed to avoid conflict
          let noteDataForTask = null; // Renamed to avoid conflict

          if (taskQuery === "THIS_TASK_REFERENCE") {
            const lastTaskId = getLastMentionedTaskId();
            if (lastTaskId) {
              const result = await getTaskWithDependencies(lastTaskId);
              if (result && result.task) {
                taskToGet = result.task;
                reminderDataForTask = result.reminder;
                noteDataForTask = result.note;
              }
            }
          } else {
            // Clean the query
            taskQuery = taskQuery.replace(/\b(task|details?)\b/gi, "").trim();
            taskToGet = await Task.findOne({
              title: { $regex: new RegExp(`^${escapeRegex(taskQuery)}$`, "i") },
            });

            if (taskToGet) {
              reminderDataForTask = taskToGet.reminderId
                ? await Reminder.findById(taskToGet.reminderId)
                : null;
              noteDataForTask = taskToGet.noteId
                ? await Note.findById(taskToGet.noteId)
                : null;
            }
          }

          if (!taskToGet) {
            finalReply = `📋 Task "${action.searchQuery}" not found.`;
          } else {
            // The formatSingleTaskTable will set all references
            finalReply = formatSingleTaskTable(
              taskToGet,
              reminderDataForTask,
              noteDataForTask,
            );
            // References are already set inside formatSingleTaskTable
          }
          break;

        case "GET_NOTE":
          console.log(`📝 Getting note: "${action.searchQuery}"`);

          // Clean the query
          let cleanNoteQuery = action.searchQuery
            .replace(/\b(note|reminder|task|details?)\b/gi, "")
            .trim();

          const noteDataResult = await getNoteByTitle(cleanNoteQuery);

          if (!noteDataResult || !noteDataResult.note) {
            finalReply = `📝 Note "${action.searchQuery}" not found.`;
          } else {
            // The formatSingleNoteTable will set all references
            finalReply = formatSingleNoteTable(noteDataResult);
            // References are already set inside formatSingleNoteTable
          }
          break;

        case "GET_REMINDER":
          console.log(`⏰ Getting reminder: "${action.searchQuery}"`);

          let cleanReminderQuery = action.searchQuery
            .replace(/\b(note|reminder|task|details?)\b/gi, "")
            .trim();

          const reminderDataResult =
            await getReminderByTitle(cleanReminderQuery);

          if (!reminderDataResult || !reminderDataResult.reminder) {
            finalReply = `⏰ Reminder "${action.searchQuery}" not found.`;
          } else {
            // The formatSingleReminderTable will set all references
            finalReply = formatSingleReminderTable(reminderDataResult);
            // References are already set inside formatSingleReminderTable
          }
          break;
        case "RECENT_REMINDERS":
          console.log(
            `⏰ Getting recent reminders (limit: ${action.limit || 5})`,
          );

          const recentReminders = await getRecentReminders(action.limit || 5);

          if (!recentReminders || recentReminders.length === 0) {
            finalReply = "⏰ No recent reminders found.";
          } else {
            // ✅ CRITICAL: Set the FIRST reminder as last mentioned
            const firstReminder = recentReminders[0];
            setLastMentionedReminder(
              firstReminder.title,
              firstReminder._id,
              firstReminder,
            );
            console.log(
              `📌 Set last mentioned reminder from recent list: "${firstReminder.title}"`,
            );

            // Also set linked task if exists
            if (firstReminder.linkedTask) {
              setLastMentionedTask(
                firstReminder.linkedTask.title,
                firstReminder.linkedTask._id,
                firstReminder.linkedTask,
              );
              console.log(
                `📌 Also set last mentioned task: "${firstReminder.linkedTask.title}"`,
              );
            }

            finalReply = formatRemindersAsTable(recentReminders);
          }
          break;

        case "RECENT_NOTES":
          console.log(`📝 Getting recent notes (limit: ${action.limit || 5})`);

          const recentNotes = await getRecentNotes(action.limit || 5);

          if (!recentNotes || recentNotes.length === 0) {
            finalReply = "📝 No recent notes found.";
          } else {
            // ✅ Set the FIRST note as last mentioned
            const firstNote = recentNotes[0];
            setLastMentionedNote(firstNote.title, firstNote._id, firstNote);
            console.log(
              `📌 Set last mentioned note from recent list: "${firstNote.title}"`,
            );

            // Also set linked task if exists
            if (firstNote.linkedTask) {
              setLastMentionedTask(
                firstNote.linkedTask.title,
                firstNote.linkedTask._id,
                firstNote.linkedTask,
              );
              console.log(
                `📌 Also set last mentioned task: "${firstNote.linkedTask.title}"`,
              );
            }

            finalReply = formatNotesAsTable(recentNotes);
          }
          break;

        case "RECENT_TASKS":
          console.log(`📋 Getting recent tasks (limit: ${action.limit || 5})`);

          const recentTasks = await getRecentTasks(action.limit || 5);

          if (!recentTasks || recentTasks.length === 0) {
            finalReply = "📋 No recent tasks found.";
          } else {
            // ✅ Set the FIRST task as last mentioned
            const firstTask = recentTasks[0];
            setLastMentionedTask(firstTask.title, firstTask._id, firstTask);
            console.log(
              `📌 Set last mentioned task from recent list: "${firstTask.title}"`,
            );

            // Also set reminder if exists
            if (firstTask.reminder) {
              setLastMentionedReminder(
                firstTask.reminder.title,
                firstTask.reminder._id,
                firstTask.reminder,
              );
            }

            // Also set note if exists
            if (firstTask.note) {
              setLastMentionedNote(
                firstTask.note.title,
                firstTask.note._id,
                firstTask.note,
              );
            }

            finalReply = formatRecentTasksTable(recentTasks);
          }
          break;

        case "RECENT_ALL":
          console.log(`📋 Getting all recent items (limit: ${action.limit})`);
          const allRecent = await getAllRecentItems(action.limit);
          finalReply = formatRecentAllTable(allRecent);
          break;
        case "DELETE_TASK":
          console.log(
            `🗑️ DELETE_TASK action received: "${action.searchQuery}"`,
          );

          let taskSearchTitle = action.searchQuery
            .split("\n")[0]
            .replace(/["']/g, "")
            .trim();
          console.log(`🔍 Searching for task to delete: "${taskSearchTitle}"`);

          let taskToDelete = await Task.findOne({
            title: { $regex: new RegExp(`^${taskSearchTitle}$`, "i") },
          });

          if (!taskToDelete) {
            taskToDelete = await Task.findOne({
              title: { $regex: new RegExp(taskSearchTitle, "i") },
            });
          }

          if (!taskToDelete) {
            finalReply = `❌ Could not find a task titled "${taskSearchTitle}".`;
            break;
          }

          console.log(
            `🗑️ Deleting task: "${taskToDelete.title}" (ID: ${taskToDelete._id})`,
          );

          // This already deletes both reminder and note
          await deleteDependencies(taskToDelete._id);
          await Task.findByIdAndDelete(taskToDelete._id);

          finalReply = `✅ Task "${taskToDelete.title}" and its associated reminder & note have been permanently deleted!`;
          createdItem = null;
          actionResult = null;
          break;

        case "DELETE_REMINDER":
          console.log(`⏰ Deleting reminder: "${action.searchQuery}"`);

          let reminderSearchTitle = action.searchQuery
            .split("\n")[0]
            .replace(/["']/g, "")
            .trim();
          console.log(
            `🔍 Searching for reminder to delete: "${reminderSearchTitle}"`,
          );

          let reminderToDelete = await Reminder.findOne({
            title: { $regex: new RegExp(`^${reminderSearchTitle}$`, "i") },
          });

          if (!reminderToDelete) {
            reminderToDelete = await Reminder.findOne({
              title: { $regex: new RegExp(reminderSearchTitle, "i") },
            });
          }

          if (!reminderToDelete) {
            finalReply = `❌ Could not find a reminder titled "${reminderSearchTitle}".`;
            break;
          }

          console.log(`🗑️ Deleting reminder: "${reminderToDelete.title}"`);

          // FIX: Clear reminderId from linked task BEFORE deleting reminder
          if (reminderToDelete.taskId) {
            const linkedTask = await Task.findById(reminderToDelete.taskId);
            if (linkedTask) {
              linkedTask.reminderId = null;
              await linkedTask.save();
              console.log(
                `  ✅ Cleared reminderId from linked task: "${linkedTask.title}"`,
              );
              finalReply = `✅ Reminder "${reminderToDelete.title}" has been deleted.\n📋 Removed reference from linked task "${linkedTask.title}".`;
            } else {
              finalReply = `✅ Reminder "${reminderToDelete.title}" has been deleted.`;
            }
          } else {
            finalReply = `✅ Reminder "${reminderToDelete.title}" has been deleted.`;
          }

          await Reminder.findByIdAndDelete(reminderToDelete._id);
          break;

        case "DELETE_NOTE":
          console.log(`📝 Deleting note: "${action.searchQuery}"`);

          let noteSearchTitle = action.searchQuery
            .split("\n")[0]
            .replace(/["']/g, "")
            .trim();
          console.log(`🔍 Searching for note to delete: "${noteSearchTitle}"`);

          let noteToDelete = await Note.findOne({
            title: { $regex: new RegExp(`^${noteSearchTitle}$`, "i") },
          });

          if (!noteToDelete) {
            noteToDelete = await Note.findOne({
              title: { $regex: new RegExp(noteSearchTitle, "i") },
            });
          }

          if (!noteToDelete) {
            finalReply = `❌ Could not find a note titled "${noteSearchTitle}".`;
            break;
          }

          console.log(`🗑️ Deleting note: "${noteToDelete.title}"`);

          // FIX: Clear noteId from linked task BEFORE deleting note
          if (noteToDelete.taskId) {
            const linkedTask = await Task.findById(noteToDelete.taskId);
            if (linkedTask) {
              linkedTask.noteId = null;
              await linkedTask.save();
              console.log(
                `  ✅ Cleared noteId from linked task: "${linkedTask.title}"`,
              );
              finalReply = `✅ Note "${noteToDelete.title}" has been deleted.\n📋 Removed reference from linked task "${linkedTask.title}".`;
            } else {
              finalReply = `✅ Note "${noteToDelete.title}" has been deleted.`;
            }
          } else {
            finalReply = `✅ Note "${noteToDelete.title}" has been deleted.`;
          }

          await Note.findByIdAndDelete(noteToDelete._id);
          break;
        case "UPDATE_REMINDER":
          console.log(`⏰ Updating reminder: "${action.searchQuery}"`);

          const reminderToUpdate = await findReminderByUpdateSearch(
            action.searchQuery,
          );

          if (!reminderToUpdate) {
            if (isThisTaskPlaceholder(action.searchQuery)) {
              finalReply = `❌ The current task has no linked reminder. Updating the task due time will create one automatically.`;
            } else {
              finalReply = `❌ Could not find a reminder titled "${action.searchQuery}".`;
            }
            break;
          }

          if (action.field === "remindAt") {
            const oldRemindAt = reminderToUpdate.remindAt
              ? new Date(reminderToUpdate.remindAt)
              : null;
            const {
              date: newRemindAt,
              changeType,
              mode,
              error: remindError,
            } = await applyDateTimeUpdate(oldRemindAt, action.newValue);

            if (remindError || !newRemindAt) {
              finalReply = `❌ ${remindError || `Failed to parse: ${action.newValue}`}`;
              break;
            }

            console.log(
              `  ⏰ Reminder schedule update (${mode}): ${formatISTDate(newRemindAt)}`,
            );

            reminderToUpdate.remindAt = newRemindAt;
            await reminderToUpdate.save();

            if (reminderToUpdate.taskId) {
              const linkedTask = await Task.findById(reminderToUpdate.taskId);
              if (linkedTask) {
                linkedTask.dueDate = newRemindAt;
                await linkedTask.save();
                setLastMentionedTask(linkedTask.title, linkedTask._id);
                finalReply = `✅ Reminder "${reminderToUpdate.title}" ${changeType} updated to ${formatISTDate(newRemindAt)}\n📋 Linked task "${linkedTask.title}" due date updated to match.`;
              } else {
                finalReply = `✅ Reminder "${reminderToUpdate.title}" ${changeType} updated to ${formatISTDate(newRemindAt)}`;
              }
            } else {
              finalReply = `✅ Reminder "${reminderToUpdate.title}" ${changeType} updated to ${formatISTDate(newRemindAt)}`;
            }
          } else {
            finalReply = `❌ I don't know how to update the field "${action.field}" for reminders.`;
          }
          break;

        case "UPDATE_NOTE":
          console.log(`📝 Updating note: "${action.searchQuery}"`);

          const noteToUpdate = await Note.findOne({
            title: { $regex: new RegExp(`^${action.searchQuery}$`, "i") },
          });

          if (!noteToUpdate) {
            finalReply = `❌ Could not find a note titled "${action.searchQuery}".`;
            break;
          }

          if (action.field === "title") {
            noteToUpdate.title = action.newValue;
            await noteToUpdate.save();
            finalReply = `✅ Note renamed from "${action.searchQuery}" to "${action.newValue}"`;
          } else if (action.field === "content") {
            noteToUpdate.content = action.newValue;
            await noteToUpdate.save();
            finalReply = `✅ Note "${action.searchQuery}" content updated.`;
          }
          break;

        case "CREATE_NOTE":
          const newNote = new Note({
            title: action.title || "Untitled",
            content: action.content || "",
          });

          createdItem = await newNote.save();
          actionResult = newNote;
          finalReply = `✅ Note "${action.title}" has been saved!\n\n`;
          break;

        case "CREATE_REMINDER":
          let remindAt = null;
          if (action.remindAt) {
            remindAt = await parseDate(action.remindAt);
            console.log(
              `Parsed remind date "${action.remindAt}" -> ${remindAt}`,
            );
          }

          if (!remindAt) {
            const tomorrow = getISTStartOfNextDay();
            const p = getISTDateParts(tomorrow);
            remindAt = istToUTC(p.year, p.month, p.day, 9, 0, 0);
          }

          const reminder = new Reminder({
            title: action.title,
            remindAt: remindAt,
          });

          createdItem = await reminder.save();
          actionResult = reminder;
          finalReply = `✅ Reminder "${action.title}" set for ${formatISTDate(remindAt)}!`;
          break;
      }
    }

    // Clean up any remaining action lines in the reply
    if (finalReply && finalReply.includes("ACTION:")) {
      finalReply = finalReply.replace(/ACTION: [^\n]*\n?/g, "").trim();
    }

    // Save to chat history
    const chat = new Chat({
      usermsg: message,
      botmsg: finalReply || "I've processed your request.",
      responseData: relevantData,
      actionTaken: action ? action.type : null,
      createdItemId: createdItem ? createdItem._id : null,
      sessionId: sessionId,
      timestamp: new Date(),
    });
    await chat.save();

    res.json({
      reply: finalReply || "I've processed your request.",
      responseData: relevantData,
      action: action,
      createdItem: createdItem,
    });
  } catch (error) {
    console.error("Chat error:", error);
    res
      .status(500)
      .json({ reply: "Sorry, something went wrong. Please try again." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
