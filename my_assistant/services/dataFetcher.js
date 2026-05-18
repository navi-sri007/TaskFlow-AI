// services/dataFetcher.js
const Task = require("../models/Task");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");
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

function extractEntityName(message) {
  let cleaned = cleanMessage(message);

  // FIRST: Handle "this task" reference
  if (cleaned.includes("this task")) {
    console.log("🔍 Detected 'this task' reference");
    return "THIS_TASK_REFERENCE";
  }

  // Remove common command words (but NOT "this" - handle separately)
  cleaned = cleaned.replace(
    /\b(give|delete|show|tell|display|fetch|details?|of|the|in|as|tabular|form|table|format|for|me|please|what|is|content|tasks?|reminders?|notes?|memo|everything|related|associated|linked|to)\b/g,
    "",
  );

  // Remove punctuation and extra spaces
  cleaned = cleaned.replace(/["'?]/g, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

async function fetchRelevantData(userMessage) {
  const message = userMessage.toLowerCase();
  let context = { tasks: [], notes: [], reminders: [] };

  const extractedName = extractEntityName(message);

  console.log("🎯 Extracted entity:", extractedName);

  // Handle "this task" reference
  if (extractedName === "THIS_TASK_REFERENCE" && lastMentionedTaskId) {
    console.log(`🔄 Using last mentioned task: "${lastMentionedTask}"`);
    const task = await Task.findById(lastMentionedTaskId);
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

  // Normal entity search
  if (
    extractedName &&
    extractedName !== "THIS_TASK_REFERENCE" &&
    !message.includes("list all") &&
    !message.includes("all tasks")
  ) {
    const task = await Task.findOne({
      title: { $regex: extractedName, $options: "i" },
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

  // If not asking about a specific task, fetch all
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
  console.log("Context being sent:", JSON.stringify(context, null, 2));
  return JSON.stringify(context, null, 2);
}

module.exports = {
  fetchRelevantData,
  formatContextForAI,
  setLastMentionedTask,
  getLastMentionedTask,
  getLastMentionedTaskId,
};
