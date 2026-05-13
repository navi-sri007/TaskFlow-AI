// services/dataFetcher.js
const Task = require("../models/Task");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");

async function fetchRelevantData(userMessage) {
  const message = userMessage.toLowerCase();
  let context = {
    tasks: [],
    notes: [],
    reminders: [],
  };

  // Fetch tasks if relevant
  if (
    message.includes("task") ||
    message.includes("todo") ||
    message.includes("assignment") ||
    message.includes("list")
  ) {
    let query = {};

    // Parse dates
    if (message.includes("today")) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      query.dueDate = { $gte: today, $lt: tomorrow };
    } else if (message.includes("tomorrow")) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);
      query.dueDate = { $gte: tomorrow, $lt: dayAfter };
    } else if (message.includes("may")) {
      // Extract May date
      const match = message.match(/may (\d+)/i);
      if (match) {
        const date = new Date(2026, 4, parseInt(match[1])); // May = month 4
        date.setHours(0, 0, 0, 0);
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);
        query.dueDate = { $gte: date, $lt: nextDay };
      }
    }

    // Priority filter
    if (message.includes("important") || message.includes("urgent")) {
      query.priority = "important";
    } else if (message.includes("high")) {
      query.priority = "high";
    }

    context.tasks = await Task.find(query).sort({ dueDate: 1 }).limit(10);
  }

  // Fetch reminders if relevant
  if (message.includes("reminder") || message.includes("remind")) {
    context.reminders = await Reminder.find({ remindAt: { $gte: new Date() } })
      .sort({ remindAt: 1 })
      .limit(5);
  }

  // Fetch notes if relevant
  if (message.includes("note") || message.includes("memo")) {
    context.notes = await Note.find().sort({ createdAt: -1 }).limit(5);
  }

  return context;
}

function formatContextForAI(context) {
  let formatted = "";

  if (
    context.tasks.length === 0 &&
    context.notes.length === 0 &&
    context.reminders.length === 0
  ) {
    return "NO DATA FOUND - Tell user no matching records exist.";
  }

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

  return formatted;
}

module.exports = { fetchRelevantData, formatContextForAI };
