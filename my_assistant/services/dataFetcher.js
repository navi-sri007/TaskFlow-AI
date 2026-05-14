// services/dataFetcher.js
const Task = require("../models/Task");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");

async function fetchRelevantData(userMessage) {
  const message = userMessage.toLowerCase();
  let context = { tasks: [], notes: [], reminders: [] };

  // ALL possible patterns to extract task name
  let taskName = null;

  const patterns = [
    // "show me everything related to X"
    /everything related to\s+['"]?([^'"]+?)['"]?$/i,
    // "show the notes and reminders associated with task X"
    /associated with task\s+['"]?([^'"]+?)['"]?/i,
    // "task X"
    /task\s+['"]?([^'"]+?)['"]?(?:\s|$|\.)/i,
    // "related to X"
    /related to\s+['"]?([^'"]+?)['"]?$/i,
    // quoted text
    /['"]([^'"]+)['"]/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      taskName = match[1];
      break;
    }
  }

  // Remove words like "and", "also", "for the task" from the extracted name
  if (taskName) {
    taskName = taskName
      .replace(/\s+(and|also|for the task|list).*$/i, "")
      .trim();
  }

  console.log("🎯 Extracted task name:", taskName);

  if (
    taskName &&
    !message.includes("list all") &&
    !message.includes("all tasks")
  ) {
    const task = await Task.findOne({
      title: { $regex: new RegExp(`^${taskName}$`, "i") },
    });

    if (task) {
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
    }
  }
  // If not asking about a specific task, fetch all (limited)
  if (
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
  }

  return context;
}

function formatContextForAI(context) {
  let formatted = "";

  // Specific task view (only 1 task with its linked items)
  if (
    context.tasks.length === 1 &&
    context.reminders.length <= 1 &&
    context.notes.length <= 1
  ) {
    const task = context.tasks[0];
    formatted += `TASK: "${task.title}"\n`;
    formatted += `- Priority: ${task.priority}\n`;
    formatted += `- Due Date: ${task.dueDate ? new Date(task.dueDate).toDateString() : "No due date"}\n`;
    formatted += `- Status: ${task.completed ? "Completed" : "Pending"}\n\n`;

    if (context.reminders.length > 0) {
      formatted += `LINKED REMINDER:\n`;
      context.reminders.forEach((r) => {
        formatted += `- "${r.title}" at ${new Date(r.remindAt).toLocaleString()}\n`;
      });
    } else {
      formatted += `LINKED REMINDER: None\n`;
    }
    formatted += `\n`;

    if (context.notes.length > 0) {
      formatted += `LINKED NOTE:\n`;
      context.notes.forEach((n) => {
        formatted += `- "${n.title}": ${n.content?.substring(0, 100)}${n.content?.length > 100 ? "..." : ""}\n`;
      });
    } else {
      formatted += `LINKED NOTE: None\n`;
    }

    return formatted;
  }

  // Multiple items view (existing logic)
  if (context.tasks.length > 0) {
    formatted += "TASKS:\n";
    context.tasks.forEach((task, i) => {
      const dueDate = task.dueDate
        ? new Date(task.dueDate).toDateString()
        : "No due date";
      const status = task.completed ? "Completed" : "Pending";
      formatted += `${i + 1}. Title: "${task.title}" | Due: ${dueDate} | Priority: ${task.priority} | Status: ${status}\n`;
    });
    formatted += "\n";
  }

  if (context.reminders.length > 0) {
    formatted += "REMINDERS:\n";
    context.reminders.forEach((reminder, i) => {
      const time = reminder.remindAt
        ? new Date(reminder.remindAt).toLocaleString()
        : "No time";
      formatted += `${i + 1}. Title: "${reminder.title}" | Time: ${time}\n`;
    });
    formatted += "\n";
  }

  if (context.notes.length > 0) {
    formatted += "NOTES:\n";
    context.notes.forEach((note, i) => {
      formatted += `${i + 1}. "${note.title}": ${note.content?.substring(0, 80)}...\n`;
    });
  }
  console.log("Context being sent:", JSON.stringify(context, null, 2));
  return formatted || "NO DATA FOUND - Tell user no matching records exist.";
}

module.exports = { fetchRelevantData, formatContextForAI };
