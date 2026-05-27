const mongoose = require("mongoose");

const userPatternSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },

  // Task creation patterns
  taskCreation: {
    averagePriority: { type: String, default: "medium" },
    preferredDueTime: { type: String, default: "09:00" }, // 9 AM IST
    commonKeywords: [String],
    averagePerDay: { type: Number, default: 0 },
    mostActiveHour: { type: Number, default: 9 },
    mostActiveDay: { type: String, default: "Monday" },
  },

  // Completion patterns
  completion: {
    averageCompletionTime: { type: Number, default: 0 }, // in hours
    bestPerformingPriority: { type: String, default: "medium" },
    worstPerformingPriority: { type: String, default: "low" },
    tasksUsuallyPostponed: [String], // keywords of tasks often delayed
    completionRateByPriority: {
      important: { type: Number, default: 0 },
      high: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      low: { type: Number, default: 0 },
    },
  },

  // Time-based patterns
  timePatterns: {
    morningProductivity: { type: Number, default: 0 }, // tasks completed before 12 PM
    afternoonProductivity: { type: Number, default: 0 }, // 12 PM - 5 PM
    eveningProductivity: { type: Number, default: 0 }, // after 5 PM
    preferredDays: [String], // days user completes most tasks
    procrastinationTriggers: [String], // keywords that lead to delays
  },

  // Learning data
  interactions: {
    totalTasksCreated: { type: Number, default: 0 },
    totalTasksCompleted: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now },
  },

  // User preferences (learned)
  preferences: {
    defaultPriority: { type: String, default: "medium" },
    defaultReminderOffset: { type: Number, default: 0 }, // minutes before due
    preferredNoteLength: { type: String, default: "medium" },
    notificationStyle: { type: String, default: "standard" },
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("UserPattern", userPatternSchema);
