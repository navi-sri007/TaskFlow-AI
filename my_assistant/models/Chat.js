// models/Chat.js (create this file if it doesn't exist)

const mongoose = require("mongoose");

const ChatSchema = new mongoose.Schema({
  usermsg: { type: String, required: true },
  botmsg: { type: String, required: true },
  responseData: { type: Object, default: {} },
  actionTaken: {
    type: String,
    enum: [
      null,
      "CREATE_TASK",
      "UPDATE_TASK",
      "CREATE_NOTE",
      "UPDATE_NOTE",
      "CREATE_REMINDER",
      "UPDATE_REMINDER",
      "DELETE_TASK",
      "DELETE_NOTE",
      "DELETE_REMINDER",
      "VIEW_TASKS",
      "LIST_TASKS",
      "LIST_NOTES",
      "LIST_REMINDERS",
      "RECENT_TASKS",
      "RECENT_NOTES",
      "RECENT_REMINDERS",
      "RECENT_ALL",
      "GET_NOTE",
      "GET_REMINDER",
      "SHOW_STATS",
      "SHOW_DASHBOARD",
      "QUICK_OVERVIEW",
    ],
    default: null,
  },
  createdItemId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "actionTaken",
  },
  sessionId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Chat", ChatSchema);
