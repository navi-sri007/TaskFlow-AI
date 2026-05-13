// models/Chat.js (create this file if it doesn't exist)

const mongoose = require("mongoose");

const ChatSchema = new mongoose.Schema({
  usermsg: { type: String, required: true },
  botmsg: { type: String, required: true },
  responseData: { type: Object, default: {} },
  actionTaken: {
    type: String,
    enum: ["CREATE_TASK", "CREATE_NOTE", "CREATE_REMINDER", null],
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
