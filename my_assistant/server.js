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
} = require("./services/dataFetcher");
const { parseDate, testDateParser } = require("./services/dateParser");
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
  formatISTDate,
  getISTDateParts,
  istToUTC,
  getISTStartOfNextDay,
} = require("./utils/dateFormatter.js");

// Add these helper functions to server.js

function formatRecentTasksTable(tasks) {
  if (!tasks || tasks.length === 0) {
    return "📋 No recent tasks found.";
  }

  let table = "| Task Title | Priority | Due Date | Status | Created |\n";
  table += "|------------|----------|----------|--------|---------|\n";

  for (const task of tasks) {
    const dueDate = task.dueDate ? formatISTDate(task.dueDate) : "No date";
    const status = task.completed ? "✅ Done" : "⏳ Pending";
    const created = formatISTDate(task.createdAt);
    table += `| ${task.title} | ${task.priority} | ${dueDate} | ${status} | ${created} |\n`;
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

function formatNotesAsTable(notes) {
  if (!notes || notes.length === 0) return "No notes found.";

  let table = "| Note Title | Content Preview | Linked Task |\n";
  table += "|------------|----------------|-------------|\n";

  for (const note of notes) {
    const preview = note.content ? note.content.substring(0, 50) : "Empty";
    const linkedTask = note.linkedTask ? note.linkedTask.title : "Standalone";
    table += `| ${note.title} | ${preview}... | ${linkedTask} |\n`;
  }

  return `Found ${notes.length} note(s):\n\n${table}`;
}

function formatRemindersAsTable(reminders) {
  if (!reminders || reminders.length === 0) return "No reminders found.";

  let table = "| Reminder Title | Reminder Time | Linked Task |\n";
  table += "|----------------|---------------|-------------|\n";

  for (const reminder of reminders) {
    const time = formatISTDate(reminder.remindAt);
    const linkedTask = reminder.linkedTask
      ? reminder.linkedTask.title
      : "Standalone";
    table += `| ${reminder.title} | ${time} | ${linkedTask} |\n`;
  }

  return `Found ${reminders.length} reminder(s):\n\n${table}`;
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
        case "LIST_TASKS":
          if (relevantData.tasks && relevantData.tasks.length === 1) {
            console.log(
              `⚠️ Overriding LIST_TASKS - Context has single task: "${relevantData.tasks[0].title}"`,
            );
            console.log(
              `   AI wanted to list all tasks, but user asked for specific task.`,
            );

            // Format and show the single task directly
            const task = relevantData.tasks[0];
            const reminder = relevantData.reminders?.[0];
            const note = relevantData.notes?.[0];

            let table = "| Task Title | Priority | Due Date | Status |\n";
            table += "|------------|----------|----------|--------|\n";
            table += `| ${task.title} | ${task.priority} | ${task.dueDate ? formatISTDate(task.dueDate) : "No date"} | ${task.completed ? "Done" : "Pending"} |\n`;

            if (reminder) {
              table += `\n⏰ Reminder: ${formatISTDate(reminder.remindAt)}`;
            }
            if (note) {
              const preview =
                note.content?.length > 100
                  ? note.content.substring(0, 100) + "..."
                  : note.content || "No content";
              table += `\n📝 Note: ${note.title} - ${preview}`;
            }

            finalReply = table;
            action = null; // Clear the action so it doesn't process further
            break; // Skip the action switch
          }
          console.log(`📋 Listing tasks with filter: "${action.filter}"`);

          const filters = {};

          // Parse the filter string
          if (action.filter) {
            const filterLower = action.filter.toLowerCase();
            if (filterLower.includes("pending")) filters.status = "pending";
            if (filterLower.includes("completed")) filters.status = "completed";
            if (filterLower.includes("high")) filters.priority = "high";
            if (filterLower.includes("medium")) filters.priority = "medium";
            if (filterLower.includes("low")) filters.priority = "low";
            if (filterLower.includes("today")) filters.dueDate = "today";
            if (filterLower.includes("tomorrow")) filters.dueDate = "tomorrow";
            if (filterLower.includes("overdue")) filters.dueDate = "overdue";
          }

          const tasks = await listTasks(filters);

          // Format response
          if (tasks.length === 0) {
            finalReply = `No tasks found matching your criteria.`;
          } else {
            finalReply = formatTaskListAsTable(tasks, filters);
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

          const taskToUpdate = await Task.findOne({
            title: { $regex: new RegExp(`^${action.searchQuery}$`, "i") },
          });

          if (!taskToUpdate) {
            finalReply = `❌ Could not find a task titled "${action.searchQuery}".`;
            break;
          }

          setLastMentionedTask(taskToUpdate.title, taskToUpdate._id);

          const updates = {};
          let oldTitle = taskToUpdate.title;

          switch (action.field) {
            // =========================================
            // UPDATE DUE DATE / TIME
            // =========================================
            case "dueDate":
              let newDueDate = null;

              const oldDueDate = taskToUpdate.dueDate
                ? new Date(taskToUpdate.dueDate)
                : null;

              const isOnlyTime =
                /^\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i.test(
                  action.newValue,
                );

              if (isOnlyTime && taskToUpdate.dueDate) {
                newDueDate = new Date(taskToUpdate.dueDate);

                const parsedTime = await parseDate(action.newValue);

                if (parsedTime) {
                  newDueDate.setUTCHours(
                    parsedTime.getUTCHours(),
                    parsedTime.getUTCMinutes(),
                    0,
                    0,
                  );
                } else {
                  finalReply = `❌ Failed to parse time: ${action.newValue}`;
                  break;
                }

                console.log(
                  `  ⏰ Keeping original date (${newDueDate.toDateString()}), updating time only`,
                );
              } else {
                newDueDate = await parseDate(action.newValue);
              }

              if (newDueDate) {
                // ====================================
                // DETECT WHAT CHANGED
                // ====================================
                let changeType = "date and time";

                if (oldDueDate) {
                  const oldP = getISTDateParts(oldDueDate);
                  const newP = getISTDateParts(newDueDate);
                  const oldDatePart = `${oldP.year}-${oldP.month}-${oldP.day}`;
                  const newDatePart = `${newP.year}-${newP.month}-${newP.day}`;

                  const oldTimePart = `${oldP.hour}:${oldP.minute}`;
                  const newTimePart = `${newP.hour}:${newP.minute}`;

                  const dateChanged = oldDatePart !== newDatePart;
                  const timeChanged = oldTimePart !== newTimePart;

                  if (dateChanged && !timeChanged) {
                    changeType = "date";
                  } else if (!dateChanged && timeChanged) {
                    changeType = "time";
                  }
                }

                taskToUpdate.dueDate = newDueDate;

                updates.dueDate = true;
                updates.changeType = changeType;

                await taskToUpdate.save();

                // ====================================
                // UPDATE DEPENDENCIES
                // ====================================
                await updateDependencies(taskToUpdate, updates, {
                  oldDueDate,
                });

                finalReply = `✅ Task "${action.searchQuery}" ${changeType} updated to ${formatISTDate(newDueDate)}`;

                if (taskToUpdate.reminderId) {
                  finalReply += `\n⏰ Linked reminder updated automatically.`;
                }
              } else {
                finalReply = `❌ Failed to parse date: ${action.newValue}`;
              }

              break;

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
        // Add these cases to the action switch in server.js

        case "RECENT_TASKS":
          console.log(`📋 Getting recent tasks (limit: ${action.limit})`);
          const recentTasks = await getRecentTasks(action.limit);
          finalReply = formatRecentTasksTable(recentTasks);
          break;

        case "RECENT_REMINDERS":
          console.log(`⏰ Getting recent reminders (limit: ${action.limit})`);
          const recentReminders = await getRecentReminders(action.limit);
          finalReply = formatRecentRemindersTable(recentReminders);
          break;

        case "RECENT_NOTES":
          console.log(`📝 Getting recent notes (limit: ${action.limit})`);
          const recentNotes = await getRecentNotes(action.limit);
          finalReply = formatRecentNotesTable(recentNotes);
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

          const reminderToUpdate = await Reminder.findOne({
            title: { $regex: new RegExp(`^${action.searchQuery}$`, "i") },
          });

          if (!reminderToUpdate) {
            finalReply = `❌ Could not find a reminder titled "${action.searchQuery}".`;
            break;
          }

          if (action.field === "remindAt") {
            let newRemindAt = null;
            const isOnlyTime =
              /^\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i.test(
                action.newValue,
              );

            if (isOnlyTime && reminderToUpdate.remindAt) {
              // Keep existing date, only update time
              const existingUTC = new Date(reminderToUpdate.remindAt);
              const parsedTimeUTC = await parseDate(action.newValue);

              if (parsedTimeUTC) {
                // parsedTimeUTC is already UTC from parseDate
                newRemindAt = new Date(existingUTC);
                newRemindAt.setUTCHours(
                  parsedTimeUTC.getUTCHours(),
                  parsedTimeUTC.getUTCMinutes(),
                  0,
                  0,
                );
                console.log(
                  `  ⏰ Keeping date (UTC): ${existingUTC.toISOString().split("T")[0]}`,
                );
                console.log(
                  `  ⏰ New UTC time: ${parsedTimeUTC.getUTCHours()}:${parsedTimeUTC.getUTCMinutes()}`,
                );
              } else {
                finalReply = `❌ Failed to parse time: ${action.newValue}`;
                break;
              }
            } else {
              newRemindAt = await parseDate(action.newValue);
            }

            if (newRemindAt) {
              reminderToUpdate.remindAt = newRemindAt;
              await reminderToUpdate.save();
              console.log(
                `  ✅ Reminder UTC updated to: ${newRemindAt.toISOString()}`,
              );
              console.log(
                `  ✅ Reminder IST display: ${formatISTDate(newRemindAt)}`,
              );

              if (reminderToUpdate.taskId) {
                const linkedTask = await Task.findById(reminderToUpdate.taskId);
                if (linkedTask) {
                  linkedTask.dueDate = newRemindAt;
                  await linkedTask.save();
                  finalReply = `✅ Reminder "${action.searchQuery}" updated to ${formatISTDate(newRemindAt)}\n📋 Linked task "${linkedTask.title}" due date also updated.`;
                } else {
                  finalReply = `✅ Reminder "${action.searchQuery}" updated to ${formatISTDate(newRemindAt)}`;
                }
              } else {
                finalReply = `✅ Reminder "${action.searchQuery}" updated to ${formatISTDate(newRemindAt)}`;
              }
            } else {
              finalReply = `❌ Failed to parse date/time: ${action.newValue}`;
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
