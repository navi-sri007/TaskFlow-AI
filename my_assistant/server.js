// server.js
process.env.TZ = "Asia/Kolkata";
require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");

const app = express();

function buildCorsOptions() {
  const fromEnv = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const extra = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = [...new Set([...fromEnv, ...extra])];

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowed.length === 0) return callback(null, true);
      const ok = allowed.some(
        (a) => origin === a || origin.startsWith(a.replace(/\/$/, "")),
      );
      if (ok) return callback(null, true);
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };
}

app.use(cors(buildCorsOptions()));
app.use(express.json());

// API routes must be registered before static files (split deploy: Vercel UI + Render API)
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "taskflow-backend",
    time: new Date().toISOString(),
  });
});

app.use(express.static("public"));

const mongoUrl = process.env.MONGODB_URL;
if (!mongoUrl) {
  console.error("MONGODB_URL is not set — API will fail until configured on Render.");
} else {
  mongoose
    .connect(mongoUrl)
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.error("MongoDB connection error:", err.message));
}

const Task = require("./models/Task.js");
const Note = require("./models/Note.js");
const Reminder = require("./models/Reminder.js");
const Chat = require("./models/Chat.js");
const UserPattern = require("./models/UserPattern");
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
const {
  updateUserPattern,
  getPersonalizedSuggestions,
  suggestPriority,
} = require("./services/patternLearning");

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

// Add these helper functions at the top of server.js (after requires)

/**
 * Generate pie chart URL for task status distribution
 */
function generateStatusPieChartUrl(stats) {
  const { pending, completed, overdue } = stats;
  const total = pending + completed + overdue;

  if (total === 0) return null;

  // Build data for chart
  const labels = [];
  const data = [];
  const colors = [];

  if (pending > 0) {
    labels.push("Pending");
    data.push(pending);
    colors.push("#FFA726");
  }
  if (completed > 0) {
    labels.push("Completed");
    data.push(completed);
    colors.push("#66BB6A");
  }
  if (overdue > 0) {
    labels.push("Overdue");
    data.push(overdue);
    colors.push("#EF5350");
  }

  // Create chart config
  const chartConfig = {
    type: "doughnut", // or 'pie'
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: "#ffffff",
        },
      ],
    },
    options: {
      title: {
        display: true,
        text: "📊 Task Status Distribution",
        fontSize: 18,
        fontColor: "#333",
      },
      legend: {
        position: "bottom",
        labels: {
          fontSize: 12,
          fontColor: "#333",
        },
      },
      plugins: {
        datalabels: {
          display: false,
        },
      },
      tooltips: {
        callbacks: {
          label: function (tooltipItem, data) {
            const dataset = data.datasets[tooltipItem.datasetIndex];
            const total = dataset.data.reduce((a, b) => a + b, 0);
            const value = dataset.data[tooltipItem.index];
            const percentage = ((value / total) * 100).toFixed(1);
            return `${data.labels[tooltipItem.index]}: ${value} (${percentage}%)`;
          },
        },
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encodedConfig}&w=300&h=250`;
}

/**
 * Generate pie chart URL for priority distribution
 */
function generatePriorityPieChartUrl(tasks) {
  const priorityCounts = {
    important: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  tasks.forEach((task) => {
    if (priorityCounts[task.priority] !== undefined) {
      priorityCounts[task.priority]++;
    }
  });

  const labels = [];
  const data = [];
  const colors = [];
  const priorityLabels = {
    important: "🔴 Important",
    high: "🟠 High",
    medium: "🟡 Medium",
    low: "🟢 Low",
  };
  const priorityColors = {
    important: "#7E57C2",
    high: "#EF5350",
    medium: "#FFA726",
    low: "#66BB6A",
  };

  for (const [priority, count] of Object.entries(priorityCounts)) {
    if (count > 0) {
      labels.push(priorityLabels[priority]);
      data.push(count);
      colors.push(priorityColors[priority]);
    }
  }

  if (data.length === 0) return null;

  const chartConfig = {
    type: "pie",
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: "#ffffff",
        },
      ],
    },
    options: {
      title: {
        display: true,
        text: "📊 Task Priority Distribution (Pending)",
        fontSize: 18,
        fontColor: "#333",
      },
      legend: {
        position: "bottom",
        labels: {
          fontSize: 12,
          fontColor: "#333",
        },
      },
      tooltips: {
        callbacks: {
          label: function (tooltipItem, data) {
            const dataset = data.datasets[tooltipItem.datasetIndex];
            const total = dataset.data.reduce((a, b) => a + b, 0);
            const value = dataset.data[tooltipItem.index];
            const percentage = ((value / total) * 100).toFixed(1);
            return `${data.labels[tooltipItem.index]}: ${value} (${percentage}%)`;
          },
        },
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encodedConfig}&w=300&h=250`;
}

/**
 * Generate pie chart for reminders distribution
 */
function generateReminderPieChartUrl(reminders) {
  const today = new Date();
  const todayStart = getISTStartOfDay();
  const tomorrowStart = getISTStartOfNextDay();
  const nextWeekStart = new Date(todayStart);
  nextWeekStart.setDate(todayStart.getDate() + 7);

  let todayCount = 0;
  let tomorrowCount = 0;
  let thisWeekCount = 0;
  let futureCount = 0;

  reminders.forEach((reminder) => {
    const remindDate = new Date(reminder.remindAt);
    if (remindDate >= todayStart && remindDate < tomorrowStart) {
      todayCount++;
    } else if (remindDate >= tomorrowStart && remindDate < nextWeekStart) {
      if (remindDate.getDate() === tomorrowStart.getDate()) {
        tomorrowCount++;
      } else {
        thisWeekCount++;
      }
    } else if (remindDate >= nextWeekStart) {
      futureCount++;
    }
  });

  const labels = [];
  const data = [];
  const colors = [];

  if (todayCount > 0) {
    labels.push("Today");
    data.push(todayCount);
    colors.push("#EF5350");
  }
  if (tomorrowCount > 0) {
    labels.push("Tomorrow");
    data.push(tomorrowCount);
    colors.push("#FFA726");
  }
  if (thisWeekCount > 0) {
    labels.push("This Week");
    data.push(thisWeekCount);
    colors.push("#66BB6A");
  }
  if (futureCount > 0) {
    labels.push("Future");
    data.push(futureCount);
    colors.push("#42A5F5");
  }

  if (data.length === 0) return null;

  const chartConfig = {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: "#ffffff",
        },
      ],
    },
    options: {
      title: {
        display: true,
        text: "⏰ Reminder Distribution",
        fontSize: 18,
        fontColor: "#333",
      },
      legend: {
        position: "bottom",
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encodedConfig}&w=300&h=250`;
}
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

// Helper function to capitalize first letter of each word in title
function capitalizeTitle(title) {
  if (!title || typeof title !== "string") return "";

  // Split by spaces and capitalize each word
  return title
    .split(" ")
    .map((word) => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

// Helper function to check for duplicate task
async function isDuplicateTask(title, excludeId = null) {
  const capitalizedTitle = capitalizeTitle(title);
  const query = {
    title: { $regex: new RegExp(`^${escapeRegex(capitalizedTitle)}$`, "i") },
  };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  const existing = await Task.findOne(query);
  return existing ? existing : null;
}

// Helper function to check for duplicate reminder
async function isDuplicateReminder(title, excludeId = null) {
  const capitalizedTitle = capitalizeTitle(title);
  const query = {
    title: { $regex: new RegExp(`^${escapeRegex(capitalizedTitle)}$`, "i") },
  };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  const existing = await Reminder.findOne(query);
  return existing ? existing : null;
}

// Helper function to check for duplicate note
async function isDuplicateNote(title, excludeId = null) {
  const capitalizedTitle = capitalizeTitle(title);
  const query = {
    title: { $regex: new RegExp(`^${escapeRegex(capitalizedTitle)}$`, "i") },
  };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  const existing = await Note.findOne(query);
  return existing ? existing : null;
}

async function findTaskByUpdateSearch(searchQuery) {
  // ✅ Handle task reference
  if (searchQuery === "THIS_TASK_REFERENCE") {
    const id = getLastMentionedTaskId();
    if (!id) return null;
    console.log(`📌 Using last mentioned task ID: ${id}`);
    return Task.findById(id);
  }

  // ✅ Handle reminder reference (get task of last mentioned reminder)
  if (searchQuery === "THIS_REMINDER_REFERENCE") {
    const reminderId = getLastMentionedReminderId();
    if (!reminderId) return null;
    const reminder = await Reminder.findById(reminderId);
    if (!reminder || !reminder.taskId) return null;
    console.log(`📌 Getting task from reminder: "${reminder.title}"`);
    return Task.findById(reminder.taskId);
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
  if (searchQuery === "THIS_REMINDER_REFERENCE") {
    const id = getLastMentionedReminderId();
    if (!id) {
      console.log(`⚠️ No last mentioned reminder found`);
      return null;
    }
    console.log(`📌 Using last mentioned reminder ID: ${id}`);
    return Reminder.findById(id);
  }

  // ✅ Handle task reference (get reminder of last mentioned task)
  if (searchQuery === "THIS_TASK_REFERENCE") {
    const taskId = getLastMentionedTaskId();
    if (!taskId) {
      console.log(`⚠️ No last mentioned task found`);
      return null;
    }
    const task = await Task.findById(taskId);
    if (!task || !task.reminderId) {
      console.log(`⚠️ Task has no reminder`);
      return null;
    }
    console.log(`📌 Getting reminder of task: "${task.title}"`);
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

  if (reminder) {
    response += `\n⏰ **Reminder:** "${reminder.title}" at ${formatISTDate(reminder.remindAt)}\n`;
  }

  if (note) {
    let content = note.content ? note.content.replace(/\n/g, " ") : "Empty";
    if (content.length > 100) content = content.substring(0, 100) + "...";
    response += `\n📝 **Note:** "${note.title}"\n`;
    response += `📄 Content: ${content}\n`;
  }

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

  // ✅ IMPORTANT: Store previous values for dependency tracking
  const previousValues = {
    oldDueDate: taskToUpdate.dueDate ? new Date(taskToUpdate.dueDate) : null,
    oldTitle: taskToUpdate.title,
    oldPriority: taskToUpdate.priority,
    oldCompleted: taskToUpdate.completed,
  };

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
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (newDueDate < today) {
            const todayIST = formatISTDate(today);
            const dueIST = formatISTDate(tempDate);
            finalReply =
              `❌ Cannot set due date in the past!\n\n` +
              `📅 **Attempted due date:** ${dueIST}\n` +
              `📅 **Today's date:** ${todayIST}\n\n` +
              `💡 Please provide a due date that is today or in the future.`;
            break;
          }
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

      default:
        changes.push(`❌ Unknown field: ${field}`);
    }
  }

  await taskToUpdate.save();

  // ✅ Pass previousValues to track what changed
  await updateDependencies(taskToUpdate, updateLog, previousValues);

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

  return `📋 **${title}** (${tasks.length} found):\n\n${table}`;
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

  return `Found ${reminders.length} reminder(s):\n\n${table}`;
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

  return `Found ${notes.length} note(s):\n\n${table}`;
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

  return `📋 **Recently Created Tasks** (Last ${tasks.length}):\n\n${table}`;
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

// ========== ADD THESE ROUTES TO YOUR BACKEND (Express example) ==========

// GET single note by ID
app.get("/api/notes/:id", async (req, res) => {
  try {
    const note = await Note.findById(req.params.id); // or your DB method
    if (!note) return res.status(404).json({ error: "Note not found" });
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE note (PUT)
app.put("/api/notes/:id", async (req, res) => {
  try {
    const { title, content } = req.body;
    const updatedNote = await Note.findByIdAndUpdate(
      req.params.id,
      { title, content, updatedAt: new Date() },
      { new: true, runValidators: true },
    );
    if (!updatedNote) return res.status(404).json({ error: "Note not found" });
    res.json(updatedNote);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE note
app.delete("/api/notes/:id", async (req, res) => {
  try {
    const deletedNote = await Note.findByIdAndDelete(req.params.id);
    if (!deletedNote) return res.status(404).json({ error: "Note not found" });
    res.json({ message: "Note deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

          // ✅ Capitalize the title
          const capitalizedTaskTitle = capitalizeTitle(action.title);
          console.log(`   Capitalized title: "${capitalizedTaskTitle}"`);

          // ✅ Check for duplicate task
          const existingTask = await isDuplicateTask(capitalizedTaskTitle);
          if (existingTask) {
            finalReply =
              `⚠️ Task "${capitalizedTaskTitle}" already exists!\n\n` +
              `📋 Existing task details:\n` +
              `| Field | Value |\n|-------|-------|\n` +
              `| **Title** | ${existingTask.title} |\n` +
              `| **Priority** | ${existingTask.priority} |\n` +
              `| **Status** | ${existingTask.completed ? "Completed" : "Pending"} |\n` +
              `| **Due Date** | ${existingTask.dueDate ? formatISTDate(existingTask.dueDate) : "No due date"} |\n\n` +
              `💡 Use "update task ${existingTask.title}" to modify it instead.`;
            break;
          }

          let dueDate = null;
          let originalDueDateString = action.dueDate || "";
          let hasExplicitTime = false;

          if (
            action.dueDate &&
            action.dueDate !== "null" &&
            action.dueDate !== "undefined"
          ) {
            dueDate = await parseDate(action.dueDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (dueDate < today) {
              console.log("Oh no! The due is past");
              const todayIST = formatISTDate(today);
              const dueIST = formatISTDate(dueDate);
              finalReply =
                `❌ Cannot create task with due date in the past!\n\n` +
                `📅 **Provided due date:** ${dueIST}\n` +
                `📅 **Today's date:** ${todayIST}\n\n` +
                `💡 Please provide a due date that is today or in the future.\n` +
                `   Examples: "tomorrow", "next Friday", "May 30", "today 5pm"`;
              break;
            }
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
            title: capitalizedTaskTitle, // ✅ Use capitalized title
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

          let successMessage = `✅ Task "${savedTask.title}" has been created with ${action.priority || "medium"} priority!\n\n`;

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
          await updateUserPattern(sessionId, "CREATE_TASK", {
            title: action.title,
            priority: action.priority || "medium",
          });

          // 🧠 Get personalized priority suggestion
          const suggestedPriority = await suggestPriority(
            sessionId,
            action.title,
          );
          if (suggestedPriority !== (action.priority || "medium")) {
            finalReply += `\n\n💡 Based on your patterns, you might want to set this as **${suggestedPriority}** priority.`;
          }
          createdItem = savedTask;
          actionResult = savedTask;
          finalReply = successMessage.trim();
          break;

        // Add after existing cases in the chat endpoint
        case "LEARN_PATTERNS":
          console.log(`🧠 Learning patterns for session: ${sessionId}`);

          const learnAction = action.learnAction || "analyze";

          switch (learnAction) {
            case "analyze":
              // Analyze and update patterns based on user's task history
              const allTasks = await Task.find();
              const completedTasks = await Task.find({ completed: true });

              // Update pattern with historical data
              for (const task of allTasks) {
                if (task.completed) {
                  await updateUserPattern(sessionId, "COMPLETE_TASK", {
                    title: task.title,
                    priority: task.priority,
                    createdAt: task.createdAt,
                    completedAt: task.updatedAt,
                  });
                } else {
                  await updateUserPattern(sessionId, "CREATE_TASK", {
                    title: task.title,
                    priority: task.priority,
                  });
                }
              }

              const insights = await getPersonalizedSuggestions(sessionId);

              finalReply =
                `🧠 **I've analyzed your patterns!**\n\n` +
                `📊 **Your Stats:**\n` +
                `| Metric | Value |\n|--------|-------|\n` +
                `| Tasks Created | ${allTasks.length} |\n` +
                `| Tasks Completed | ${completedTasks.length} |\n` +
                `| Completion Rate | ${((completedTasks.length / allTasks.length) * 100).toFixed(1)}% |\n\n` +
                `💡 **Personalized Insights:**\n${insights.map((s) => `• ${s}`).join("\n")}`;
              break;

            case "suggest":
              // Get personalized suggestions
              const suggestions = await getPersonalizedSuggestions(sessionId);

              if (!suggestions || suggestions.length === 0) {
                finalReply = `🧠 I need more data to learn your patterns. Create and complete more tasks first!`;
              } else {
                finalReply = `🧠 **Based on your work patterns:**\n\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
              }
              break;

            case "insights":
              // Deep insights about user behavior
              const pattern = await UserPattern.findOne({ sessionId });

              if (!pattern || pattern.interactions.totalTasksCreated < 5) {
                finalReply = `📊 Not enough data yet. Complete at least 5 tasks for meaningful insights!`;
              } else {
                const completionRate =
                  (pattern.interactions.totalTasksCompleted /
                    pattern.interactions.totalTasksCreated) *
                  100;

                finalReply =
                  `📊 **Your Work Pattern Insights**\n\n` +
                  `| Metric | Value |\n|--------|-------|\n` +
                  `| 🎯 Most Productive Hour | ${pattern.taskCreation.mostActiveHour}:00 |\n` +
                  `| 📅 Most Productive Day | ${pattern.taskCreation.mostActiveDay} |\n` +
                  `| ⭐ Default Priority | ${pattern.taskCreation.averagePriority} |\n` +
                  `| ✅ Completion Rate | ${completionRate.toFixed(1)}% |\n` +
                  `| 🏆 Best Priority | ${pattern.completion.bestPerformingPriority || "N/A"} |\n` +
                  `| ⏰ Morning Productivity | ${pattern.timePatterns.morningProductivity} tasks |\n` +
                  `| ☀️ Afternoon Productivity | ${pattern.timePatterns.afternoonProductivity} tasks |\n` +
                  `| 🌙 Evening Productivity | ${pattern.timePatterns.eveningProductivity} tasks |\n\n` +
                  `🔑 **Top Keywords in your tasks:**\n${pattern.taskCreation.commonKeywords.slice(0, 10).join(", ")}`;
              }
              break;
          }
          break;
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

              break;

            default:
              finalReply = `📋 Found: "${item.title}" (${itemType}) - Position #${itemIndex}`;
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

        case "COUNT_ENTITY":
          console.log(
            `🔢 Counting ${action.entity} with filters: "${action.filters}"`,
          );

          let count = 0;
          let filterDescription = "";
          let countResult = null;

          try {
            // Parse filters (split by |)
            const filters = (action.filters || "all")
              .split("|")
              .map((f) => f.toLowerCase().trim());

            switch (action.entity) {
              case "tasks":
                let taskQuery = {};
                filterDescription = "";

                for (const filter of filters) {
                  switch (filter) {
                    case "pending":
                      taskQuery.completed = false;
                      filterDescription = "pending ";
                      break;
                    case "completed":
                      taskQuery.completed = true;
                      filterDescription = "completed ";
                      break;
                    case "overdue":
                      const todayStart = getISTStartOfDay();
                      taskQuery.dueDate = { $lt: todayStart };
                      taskQuery.completed = false;
                      filterDescription = "overdue ";
                      break;
                    case "today":
                      const { start, end } = getISTDayRange();
                      taskQuery.dueDate = { $gte: start, $lt: end };
                      filterDescription = "due today ";
                      break;
                    case "tomorrow":
                      const tomorrowStart = getISTStartOfNextDay();
                      const dayAfter = new Date(
                        tomorrowStart.getTime() + 24 * 60 * 60 * 1000,
                      );
                      taskQuery.dueDate = {
                        $gte: tomorrowStart,
                        $lt: dayAfter,
                      };
                      filterDescription = "due tomorrow ";
                      break;
                    case "this-week":
                      const { start: weekStart } = getISTDayRange();
                      const endOfWeek = new Date(weekStart);
                      const istWeekday = getISTWeekday();
                      endOfWeek.setTime(
                        weekStart.getTime() +
                          (7 - istWeekday) * 24 * 60 * 60 * 1000,
                      );
                      taskQuery.dueDate = { $gte: weekStart, $lte: endOfWeek };
                      filterDescription = "due this week ";
                      break;
                    case "high":
                      taskQuery.priority = "high";
                      filterDescription += "high priority ";
                      break;
                    case "medium":
                      taskQuery.priority = "medium";
                      filterDescription += "medium priority ";
                      break;
                    case "low":
                      taskQuery.priority = "low";
                      filterDescription += "low priority ";
                      break;
                    case "important":
                      taskQuery.priority = "important";
                      filterDescription += "important ";
                      break;
                    case "has-reminder":
                      taskQuery.reminderId = { $ne: null };
                      filterDescription += "with reminders ";
                      break;
                    case "has-note":
                      taskQuery.noteId = { $ne: null };
                      filterDescription += "with notes ";
                      break;
                    case "no-reminder":
                      taskQuery.reminderId = null;
                      filterDescription += "without reminders ";
                      break;
                    case "all":
                    default:
                      // No filter
                      break;
                  }
                }

                count = await Task.countDocuments(taskQuery);
                countResult = {
                  entity: "tasks",
                  count,
                  filters: filterDescription || "total",
                };
                break;

              case "reminders":
                let reminderQuery = {};
                filterDescription = "";

                for (const filter of filters) {
                  switch (filter) {
                    case "today":
                      const { start, end } = getISTDayRange();
                      reminderQuery.remindAt = { $gte: start, $lt: end };
                      filterDescription = "for today ";
                      break;
                    case "tomorrow":
                      const tomorrowStart = getISTStartOfNextDay();
                      const dayAfter = new Date(
                        tomorrowStart.getTime() + 24 * 60 * 60 * 1000,
                      );
                      reminderQuery.remindAt = {
                        $gte: tomorrowStart,
                        $lt: dayAfter,
                      };
                      filterDescription = "for tomorrow ";
                      break;
                    case "upcoming":
                      const now = new Date();
                      reminderQuery.remindAt = { $gte: now };
                      filterDescription = "upcoming ";
                      break;
                    case "all":
                    default:
                      break;
                  }
                }

                count = await Reminder.countDocuments(reminderQuery);
                countResult = {
                  entity: "reminders",
                  count,
                  filters: filterDescription || "total",
                };
                break;

              case "notes":
                let noteQuery = {};
                filterDescription = "";

                for (const filter of filters) {
                  switch (filter) {
                    case "linked":
                      noteQuery.taskId = { $ne: null };
                      filterDescription = "linked to tasks ";
                      break;
                    case "standalone":
                      noteQuery.taskId = null;
                      filterDescription = "standalone ";
                      break;
                    case "with-content":
                      noteQuery.content = { $ne: "", $exists: true };
                      filterDescription = "with content ";
                      break;
                    case "all":
                    default:
                      break;
                  }
                }

                count = await Note.countDocuments(noteQuery);
                countResult = {
                  entity: "notes",
                  count,
                  filters: filterDescription || "total",
                };
                break;

              default:
                finalReply = `❌ I can only count tasks, reminders, or notes.`;
                break;
            }

            if (countResult) {
              // Format the response as a clean table
              finalReply = `| Metric | Count |\n|--------|-------|\n| **${countResult.entity.charAt(0).toUpperCase() + countResult.entity.slice(1)}** ${countResult.filters} | **${countResult.count}** |`;

              // Add a helpful note if count is zero
              if (countResult.count === 0) {
                finalReply += `\n\n📌 No ${countResult.entity} found ${countResult.filters ? `with ${countResult.filters}` : ""}.`;
              }
            }
          } catch (error) {
            console.error("Error counting entities:", error);
            finalReply = `❌ Sorry, I couldn't count the ${action.entity}. Please try again.`;
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
              }
              if (field === "content") {
                // Append new content to existing content
                const existingContent = noteToUpdateMulti.content || "";
                const newContent = value;

                // Add a separator if existing content is not empty
                if (existingContent && existingContent.trim()) {
                  noteToUpdateMulti.content = `${existingContent}\n\n${newContent}`;
                  noteChanges.push(
                    `✅ Content appended (existing content preserved)`,
                  );
                } else {
                  noteToUpdateMulti.content = newContent;
                  noteChanges.push(`✅ Content added`);
                }
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

          console.log(`📋 LIST_TASKS received:`, {
            status: action.status,
            special: action.special,
            dateRangeType: action.dateRangeType,
            dateFrom: action.dateFrom,
            dateTo: action.dateTo,
            specificDate: action.specificDate,
          });

          // ============================================
          // HANDLE DATE RANGE (from the AI)
          // ============================================
          if (
            action.dateRangeType === "date-range" &&
            action.dateFrom &&
            action.dateTo
          ) {
            console.log(
              `📅 Processing date range from AI: ${action.dateFrom} to ${action.dateTo}`,
            );

            const fromDate = await parseDate(action.dateFrom);
            const toDate = await parseDate(action.dateTo);

            if (fromDate && toDate) {
              const startDate = new Date(fromDate);
              startDate.setHours(0, 0, 0, 0);
              const endDate = new Date(toDate);
              endDate.setHours(23, 59, 59, 999);

              let query = {
                dueDate: { $gte: startDate, $lte: endDate },
              };

              if (action.status === "pending") query.completed = false;
              else if (action.status === "completed") query.completed = true;

              console.log(
                `📅 Date range query:`,
                JSON.stringify(query, null, 2),
              );

              let tasks = await Task.find(query).sort({ dueDate: 1 }).limit(50);

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
                finalReply = `📋 No tasks found between ${action.dateFrom} and ${action.dateTo}.`;
              } else {
                finalReply = formatTaskListWithDetailsTable(tasksWithDeps, {
                  status: "date-range",
                  special: `${action.dateFrom} to ${action.dateTo}`,
                });
              }
              break;
            } else {
              finalReply = `❌ Could not parse dates: "${action.dateFrom}" to "${action.dateTo}".`;
              break;
            }
          }

          // ============================================
          // HANDLE SPECIFIC DATE
          // ============================================
          if (action.dateRangeType === "specific-date" && action.specificDate) {
            console.log(
              `📅 Processing specific date from AI: ${action.specificDate}`,
            );

            const targetDate = await parseDate(action.specificDate);

            if (targetDate) {
              const startDate = new Date(targetDate);
              startDate.setHours(0, 0, 0, 0);
              const endDate = new Date(targetDate);
              endDate.setHours(23, 59, 59, 999);

              let query = {
                dueDate: { $gte: startDate, $lte: endDate },
              };

              if (action.status === "pending") query.completed = false;
              else if (action.status === "completed") query.completed = true;

              let tasks = await Task.find(query).sort({ dueDate: 1 }).limit(50);

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
                finalReply = `📋 No tasks found due on ${action.specificDate}.`;
              } else {
                finalReply = formatTaskListWithDetailsTable(tasksWithDeps, {
                  status: "specific-date",
                  special: action.specificDate,
                });
              }
              break;
            }
          }

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
            case "today":
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

            // ============================================
            // NEW CASES FOR DATE RANGES
            // ============================================

            case "upcoming":
              // Tasks due in the future (from today onwards)
              filters.dueDate = "upcoming";
              filters.status = "pending";
              break;

            case "next-3-days":
              // Tasks due in next 3 days
              filters.dueDate = "next-3-days";
              filters.status = "pending";
              break;

            case "next-5-days":
              // Tasks due in next 5 days
              filters.dueDate = "next-5-days";
              filters.status = "pending";
              break;

            case "next-7-days":
              // Tasks due in next 7 days (next week)
              filters.dueDate = "next-7-days";
              filters.status = "pending";
              break;

            case "next-14-days":
              // Tasks due in next 14 days (2 weeks)
              filters.dueDate = "next-14-days";
              filters.status = "pending";
              break;

            case "next-30-days":
              // Tasks due in next 30 days (this month)
              filters.dueDate = "next-30-days";
              filters.status = "pending";
              break;

            case "this-month":
              // Tasks due in current month
              filters.dueDate = "this-month";
              filters.status = "pending";
              break;

            case "next-month":
              // Tasks due in next month
              filters.dueDate = "next-month";
              filters.status = "pending";
              break;

            case "completed-last-7-days":
              // Tasks completed in last 7 days
              filters.dueDate = "completed-last-7-days";
              filters.status = "completed";
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
                filters.dueDate = "weekend";
                break;
              case "has-reminder":
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
              case "upcoming":
                filters.dueDate = "upcoming";
                break;
            }
          }

          // ============================================
          // BUILD QUERY BASED ON FILTERS
          // ============================================

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

          // ============================================
          // DATE RANGE FILTERS
          // ============================================

          const now = new Date();
          const todayStart = getISTStartOfDay();

          if (filters.dueDate === "overdue") {
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
            const dayAfterTomorrow = new Date(todayStart);
            dayAfterTomorrow.setDate(todayStart.getDate() + 2);
            const nextDay = new Date(dayAfterTomorrow);
            nextDay.setDate(dayAfterTomorrow.getDate() + 1);
            query.dueDate = { $gte: dayAfterTomorrow, $lt: nextDay };
          } else if (filters.dueDate === "this-week") {
            const { start } = getISTDayRange();
            const endOfWeek = new Date(start);
            const istWeekday = getISTWeekday();
            endOfWeek.setTime(
              start.getTime() + (7 - istWeekday) * 24 * 60 * 60 * 1000,
            );
            query.dueDate = { $gte: start, $lte: endOfWeek };
          } else if (filters.dueDate === "upcoming") {
            // Tasks due from today onwards (not overdue)
            query.dueDate = { $gte: todayStart };
            query.completed = false;
          } else if (filters.dueDate === "next-3-days") {
            const endDate = new Date(todayStart);
            endDate.setDate(todayStart.getDate() + 3);
            query.dueDate = { $gte: todayStart, $lte: endDate };
            query.completed = false;
          } else if (filters.dueDate === "next-5-days") {
            const endDate = new Date(todayStart);
            endDate.setDate(todayStart.getDate() + 5);
            query.dueDate = { $gte: todayStart, $lte: endDate };
            query.completed = false;
          } else if (filters.dueDate === "next-7-days") {
            const endDate = new Date(todayStart);
            endDate.setDate(todayStart.getDate() + 7);
            query.dueDate = { $gte: todayStart, $lte: endDate };
            query.completed = false;
          } else if (filters.dueDate === "next-14-days") {
            const endDate = new Date(todayStart);
            endDate.setDate(todayStart.getDate() + 14);
            query.dueDate = { $gte: todayStart, $lte: endDate };
            query.completed = false;
          } else if (filters.dueDate === "next-30-days") {
            const endDate = new Date(todayStart);
            endDate.setDate(todayStart.getDate() + 30);
            query.dueDate = { $gte: todayStart, $lte: endDate };
            query.completed = false;
          } else if (filters.dueDate === "this-month") {
            const startOfMonth = new Date(todayStart);
            startOfMonth.setDate(1);
            const endOfMonth = new Date(todayStart);
            endOfMonth.setMonth(todayStart.getMonth() + 1);
            endOfMonth.setDate(0);
            endOfMonth.setHours(23, 59, 59, 999);
            query.dueDate = { $gte: startOfMonth, $lte: endOfMonth };
          } else if (filters.dueDate === "next-month") {
            const startOfNextMonth = new Date(todayStart);
            startOfNextMonth.setMonth(todayStart.getMonth() + 1);
            startOfNextMonth.setDate(1);
            const endOfNextMonth = new Date(startOfNextMonth);
            endOfNextMonth.setMonth(startOfNextMonth.getMonth() + 1);
            endOfNextMonth.setDate(0);
            endOfNextMonth.setHours(23, 59, 59, 999);
            query.dueDate = { $gte: startOfNextMonth, $lte: endOfNextMonth };
          } else if (filters.dueDate === "weekend") {
            // Weekend = upcoming Saturday and Sunday
            const currentDay = todayStart.getDay();
            let daysUntilSaturday = 6 - currentDay;
            if (daysUntilSaturday < 0) daysUntilSaturday += 7;
            const saturday = new Date(todayStart);
            saturday.setDate(todayStart.getDate() + daysUntilSaturday);
            const sunday = new Date(saturday);
            sunday.setDate(saturday.getDate() + 1);
            const sundayEnd = new Date(sunday);
            sundayEnd.setHours(23, 59, 59, 999);
            query.dueDate = { $gte: saturday, $lte: sundayEnd };
          } else if (filters.dueDate === "completed-last-7-days") {
            const sevenDaysAgo = new Date(todayStart);
            sevenDaysAgo.setDate(todayStart.getDate() - 7);
            query.completed = true;
            query.updatedAt = { $gte: sevenDaysAgo, $lte: todayStart };
          }

          // Handle custom date (if passed as special parameter)
          if (action.specificDate) {
            const specificDate = await parseDate(action.specificDate);
            if (specificDate) {
              const startOfDay = new Date(specificDate);
              startOfDay.setHours(0, 0, 0, 0);
              const endOfDay = new Date(startOfDay);
              endOfDay.setDate(startOfDay.getDate() + 1);
              query.dueDate = { $gte: startOfDay, $lt: endOfDay };
              query.completed = false;
            }
          }

          // Handle date range (from - to)
          if (action.dateFrom && action.dateTo) {
            const fromDate = await parseDate(action.dateFrom);
            const toDate = await parseDate(action.dateTo);
            if (fromDate && toDate) {
              query.dueDate = { $gte: fromDate, $lte: toDate };
            }
          }

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
              const today = new Date();
              today.setHours(0, 0, 0, 0);

              const newDueDateStart = new Date(newDueDate);
              newDueDateStart.setHours(0, 0, 0, 0);

              if (newDueDateStart < today) {
                const todayIST = formatISTDate(today);
                const dueIST = formatISTDate(newDueDate);
                finalReply =
                  `❌ Cannot set due date in the past!\n\n` +
                  `📅 **Attempted due date:** ${dueIST}\n` +
                  `📅 **Today's date:** ${todayIST}\n\n` +
                  `💡 Please provide a due date that is today or in the future.`;
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
              // ✅ Capitalize the new title
              const capitalizedNewTitle = capitalizeTitle(action.newValue);

              // ✅ Check for duplicate with new title
              const existingWithNewTitle = await isDuplicateTask(
                capitalizedNewTitle,
                taskToUpdate._id,
              );
              if (existingWithNewTitle) {
                finalReply = `⚠️ A task with title "${capitalizedNewTitle}" already exists. Cannot rename to a duplicate title.`;
                break;
              }

              taskToUpdate.title = capitalizedNewTitle;

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
              if (
                action.field === "completed" &&
                (action.newValue === "true" || action.newValue === "completed")
              ) {
                await updateUserPattern(sessionId, "COMPLETE_TASK", {
                  title: taskToUpdate.title,
                  priority: taskToUpdate.priority,
                  createdAt: taskToUpdate.createdAt,
                  completedAt: new Date(),
                });
              }

              // If postponing (due date moved forward)
              if (
                action.field === "dueDate" &&
                taskToUpdate.dueDate > oldDueDate
              ) {
                await updateUserPattern(sessionId, "POSTPONE_TASK", {
                  title: taskToUpdate.title,
                });
              }
              break;
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

          // ✅ RESOLVE THE REFERENCE FIRST
          let taskToDelete = null;

          if (action.searchQuery === "THIS_TASK_REFERENCE") {
            const lastTaskId = getLastMentionedTaskId();
            if (lastTaskId) {
              taskToDelete = await Task.findById(lastTaskId);
              console.log(
                `📌 Using last mentioned task: "${taskToDelete?.title}"`,
              );
            } else {
              finalReply = `❌ No task is currently selected. Please view a task first by saying "show task [name]" or list tasks and pick one.`;
              break;
            }
          } else {
            // Normal search by title
            let taskSearchTitle = action.searchQuery
              .split("\n")[0]
              .replace(/["']/g, "")
              .trim();
            console.log(
              `🔍 Searching for task to delete: "${taskSearchTitle}"`,
            );

            taskToDelete = await Task.findOne({
              title: {
                $regex: new RegExp(`^${escapeRegex(taskSearchTitle)}$`, "i"),
              },
            });

            if (!taskToDelete) {
              taskToDelete = await Task.findOne({
                title: {
                  $regex: new RegExp(escapeRegex(taskSearchTitle), "i"),
                },
              });
            }
          }

          if (!taskToDelete) {
            finalReply = `❌ Could not find a task to delete.`;
            break;
          }

          console.log(
            `🗑️ Deleting task: "${taskToDelete.title}" (ID: ${taskToDelete._id})`,
          );

          // Delete dependencies and task
          await deleteDependencies(taskToDelete._id);
          await Task.findByIdAndDelete(taskToDelete._id);

          // ✅ Clear references after deletion
          clearLastMentioned("task");
          clearLastMentioned("reminder");
          clearLastMentioned("note");

          finalReply = `✅ Task "${taskToDelete.title}" and its associated reminder & note have been permanently deleted!`;
          createdItem = null;
          actionResult = null;
          break;

        case "DELETE_REMINDER":
          console.log(`⏰ Deleting reminder: "${action.searchQuery}"`);

          let reminderToDelete = null;

          // ✅ RESOLVE THE REFERENCE
          if (action.searchQuery === "THIS_TASK_REFERENCE") {
            const lastTaskId = getLastMentionedTaskId();
            if (lastTaskId) {
              const task = await Task.findById(lastTaskId);
              if (task && task.reminderId) {
                reminderToDelete = await Reminder.findById(task.reminderId);
                console.log(
                  `📌 Using reminder from last mentioned task: "${reminderToDelete?.title}"`,
                );
              }
            }
          } else if (action.searchQuery === "THIS_REMINDER_REFERENCE") {
            const lastReminderId = getLastMentionedReminderId();
            if (lastReminderId) {
              reminderToDelete = await Reminder.findById(lastReminderId);
              console.log(
                `📌 Using last mentioned reminder: "${reminderToDelete?.title}"`,
              );
            }
          } else {
            // Normal search by title
            let reminderSearchTitle = action.searchQuery
              .split("\n")[0]
              .replace(/["']/g, "")
              .trim();
            console.log(
              `🔍 Searching for reminder to delete: "${reminderSearchTitle}"`,
            );

            reminderToDelete = await Reminder.findOne({
              title: {
                $regex: new RegExp(
                  `^${escapeRegex(reminderSearchTitle)}$`,
                  "i",
                ),
              },
            });

            if (!reminderToDelete) {
              reminderToDelete = await Reminder.findOne({
                title: {
                  $regex: new RegExp(escapeRegex(reminderSearchTitle), "i"),
                },
              });
            }
          }

          if (!reminderToDelete) {
            finalReply = `❌ Could not find a reminder to delete.`;
            break;
          }

          console.log(`🗑️ Deleting reminder: "${reminderToDelete.title}"`);

          // Clear reminderId from linked task BEFORE deleting reminder
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

          // ✅ Clear reference after deletion
          clearLastMentioned("reminder");

          break;

        case "DELETE_NOTE":
          console.log(`📝 Deleting note: "${action.searchQuery}"`);

          let noteToDelete = null;

          // ✅ RESOLVE THE REFERENCE
          if (action.searchQuery === "THIS_TASK_REFERENCE") {
            const lastTaskId = getLastMentionedTaskId();
            if (lastTaskId) {
              const task = await Task.findById(lastTaskId);
              if (task && task.noteId) {
                noteToDelete = await Note.findById(task.noteId);
                console.log(
                  `📌 Using note from last mentioned task: "${noteToDelete?.title}"`,
                );
              }
            }
          } else if (action.searchQuery === "THIS_NOTE_REFERENCE") {
            const lastNoteId = getLastMentionedNoteId();
            if (lastNoteId) {
              noteToDelete = await Note.findById(lastNoteId);
              console.log(
                `📌 Using last mentioned note: "${noteToDelete?.title}"`,
              );
            }
          } else {
            // Normal search by title
            let noteSearchTitle = action.searchQuery
              .split("\n")[0]
              .replace(/["']/g, "")
              .trim();
            console.log(
              `🔍 Searching for note to delete: "${noteSearchTitle}"`,
            );

            noteToDelete = await Note.findOne({
              title: {
                $regex: new RegExp(`^${escapeRegex(noteSearchTitle)}$`, "i"),
              },
            });

            if (!noteToDelete) {
              noteToDelete = await Note.findOne({
                title: {
                  $regex: new RegExp(escapeRegex(noteSearchTitle), "i"),
                },
              });
            }
          }

          if (!noteToDelete) {
            finalReply = `❌ Could not find a note to delete.`;
            break;
          }

          console.log(`🗑️ Deleting note: "${noteToDelete.title}"`);

          // Clear noteId from linked task BEFORE deleting note
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

          // ✅ Clear reference after deletion
          clearLastMentioned("note");

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

        case "CREATE_REMINDER":
          console.log(`📝 Creating reminder:`);
          console.log(`   Title: "${action.title}"`);
          console.log(`   Remind At: "${action.remindAt}"`);

          // ✅ Capitalize the title
          const capitalizedReminderTitle = capitalizeTitle(action.title);
          console.log(`   Capitalized title: "${capitalizedReminderTitle}"`);

          // ✅ Check for duplicate reminder
          const existingReminder = await isDuplicateReminder(
            capitalizedReminderTitle,
          );
          if (existingReminder) {
            finalReply =
              `⚠️ Reminder "${capitalizedReminderTitle}" already exists!\n\n` +
              `📋 Existing reminder details:\n` +
              `| Field | Value |\n|-------|-------|\n` +
              `| **Title** | ${existingReminder.title} |\n` +
              `| **Time** | ${formatISTDate(existingReminder.remindAt)} |\n` +
              `| **Linked Task** | ${existingReminder.taskId ? "Yes" : "No"} |\n\n` +
              `💡 Use "update reminder ${existingReminder.title}" to modify it instead.`;
            break;
          }

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
            title: capitalizedReminderTitle, // ✅ Use capitalized title
            remindAt: remindAt,
          });

          createdItem = await reminder.save();
          actionResult = reminder;
          finalReply = `✅ Reminder "${reminder.title}" set for ${formatISTDate(remindAt)}!`;
          break;
        case "SHOW_PIE_CHART":
          console.log(`📊 Generating pie chart for type: ${action.chartType}`);

          let chartUrl = null;
          let chartTitle = "";
          let statsTable = "";

          try {
            switch (action.chartType) {
              case "status":
                // Get task counts
                const totalTasks = await Task.countDocuments();
                const pendingTasks = await Task.countDocuments({
                  completed: false,
                });
                const completedTasks = await Task.countDocuments({
                  completed: true,
                });
                const overdueTasks = await Task.countDocuments({
                  completed: false,
                  dueDate: { $lt: getISTStartOfDay() },
                });

                const statusStats = {
                  pending: pendingTasks,
                  completed: completedTasks,
                  overdue: overdueTasks,
                };

                chartUrl = generateStatusPieChartUrl(statusStats);
                chartTitle = "📊 Task Status Distribution";

                statsTable =
                  `\n\n| Status | Count | Percentage |\n|--------|-------|------------|\n` +
                  `| ⏳ Pending | ${pendingTasks} | ${totalTasks > 0 ? ((pendingTasks / totalTasks) * 100).toFixed(1) : 0}% |\n` +
                  `| ✅ Completed | ${completedTasks} | ${totalTasks > 0 ? ((completedTasks / totalTasks) * 100).toFixed(1) : 0}% |\n` +
                  `| ⚠️ Overdue | ${overdueTasks} | ${totalTasks > 0 ? ((overdueTasks / totalTasks) * 100).toFixed(1) : 0}% |\n` +
                  `| **Total** | **${totalTasks}** | **100%** |`;
                break;

              case "priority":
                const pendingTasksForPriority = await Task.find({
                  completed: false,
                });

                if (pendingTasksForPriority.length === 0) {
                  finalReply = `📊 No pending tasks found to show priority distribution.`;
                  break;
                }

                chartUrl = generatePriorityPieChartUrl(pendingTasksForPriority);
                chartTitle = "📊 Task Priority Distribution (Pending Tasks)";

                const priorityCounts = {
                  important: 0,
                  high: 0,
                  medium: 0,
                  low: 0,
                };
                pendingTasksForPriority.forEach((task) => {
                  if (priorityCounts[task.priority] !== undefined) {
                    priorityCounts[task.priority]++;
                  }
                });

                statsTable =
                  `\n\n| Priority | Count | Percentage |\n|----------|-------|------------|\n` +
                  `| 🔴 Important | ${priorityCounts.important} | ${((priorityCounts.important / pendingTasksForPriority.length) * 100).toFixed(1)}% |\n` +
                  `| 🟠 High | ${priorityCounts.high} | ${((priorityCounts.high / pendingTasksForPriority.length) * 100).toFixed(1)}% |\n` +
                  `| 🟡 Medium | ${priorityCounts.medium} | ${((priorityCounts.medium / pendingTasksForPriority.length) * 100).toFixed(1)}% |\n` +
                  `| 🟢 Low | ${priorityCounts.low} | ${((priorityCounts.low / pendingTasksForPriority.length) * 100).toFixed(1)}% |\n` +
                  `| **Total** | **${pendingTasksForPriority.length}** | **100%** |`;
                break;

              case "reminders":
                const allReminders = await Reminder.find();

                if (allReminders.length === 0) {
                  finalReply = `⏰ No reminders found to show distribution.`;
                  break;
                }

                chartUrl = generateReminderPieChartUrl(allReminders);
                chartTitle = "⏰ Reminder Distribution";

                // Calculate reminder stats
                const todayStart = getISTStartOfDay();
                const tomorrowStart = getISTStartOfNextDay();
                const nextWeekStart = new Date(todayStart);
                nextWeekStart.setDate(todayStart.getDate() + 7);

                let todayCount = 0,
                  tomorrowCount = 0,
                  thisWeekCount = 0,
                  futureCount = 0;
                allReminders.forEach((reminder) => {
                  const remindDate = new Date(reminder.remindAt);
                  if (remindDate >= todayStart && remindDate < tomorrowStart)
                    todayCount++;
                  else if (
                    remindDate >= tomorrowStart &&
                    remindDate < nextWeekStart
                  ) {
                    if (remindDate.getDate() === tomorrowStart.getDate())
                      tomorrowCount++;
                    else thisWeekCount++;
                  } else if (remindDate >= nextWeekStart) futureCount++;
                });

                statsTable =
                  `\n\n| Period | Count | Percentage |\n|--------|-------|------------|\n` +
                  `| 🔴 Today | ${todayCount} | ${((todayCount / allReminders.length) * 100).toFixed(1)}% |\n` +
                  `| 🟠 Tomorrow | ${tomorrowCount} | ${((tomorrowCount / allReminders.length) * 100).toFixed(1)}% |\n` +
                  `| 🟡 This Week | ${thisWeekCount} | ${((thisWeekCount / allReminders.length) * 100).toFixed(1)}% |\n` +
                  `| 🔵 Future | ${futureCount} | ${((futureCount / allReminders.length) * 100).toFixed(1)}% |\n` +
                  `| **Total** | **${allReminders.length}** | **100%** |`;
                break;

              default:
                finalReply = `❌ Unknown chart type. Available: status, priority, reminders`;
                break;
            }

            if (chartUrl) {
              // Format response with image and table (like tables embed)
              finalReply =
                `## ${chartTitle}\n\n` +
                `![Pie Chart](${chartUrl})\n` +
                `${statsTable}\n\n` +
                `💡 You can ask:\n` +
                `• "show priority pie chart"\n` +
                `• "show reminder distribution"\n` +
                `• "list all tasks" for detailed view`;
            }
          } catch (error) {
            console.error("Error generating pie chart:", error);
            finalReply = `❌ Sorry, couldn't generate the chart. Please try again.`;
          }
          break;
        case "CREATE_NOTE":
          console.log(`📝 Creating note:`);
          console.log(`   Title: "${action.title}"`);
          console.log(`   Content: "${action.content?.substring(0, 100)}..."`);

          // ✅ Capitalize the title
          const capitalizedNoteTitle = capitalizeTitle(
            action.title || "Untitled",
          );
          console.log(`   Capitalized title: "${capitalizedNoteTitle}"`);

          // ✅ Check for duplicate note
          const existingNote = await isDuplicateNote(capitalizedNoteTitle);
          if (existingNote) {
            finalReply =
              `⚠️ Note "${capitalizedNoteTitle}" already exists!\n\n` +
              `📋 Existing note details:\n` +
              `| Field | Value |\n|-------|-------|\n` +
              `| **Title** | ${existingNote.title} |\n` +
              `| **Content Preview** | ${existingNote.content ? existingNote.content.substring(0, 100) : "Empty"} |\n` +
              `| **Linked Task** | ${existingNote.taskId ? "Yes" : "No"} |\n\n` +
              `💡 Use "update note ${existingNote.title}" to modify it instead.`;
            break;
          }

          const newNote = new Note({
            title: capitalizedNoteTitle, // ✅ Use capitalized title
            content: action.content || "",
          });

          createdItem = await newNote.save();
          actionResult = newNote;
          finalReply = `✅ Note "${newNote.title}" has been saved!\n\n`;
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
