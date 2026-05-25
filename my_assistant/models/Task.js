const mongoose = require("mongoose");
const TaskSchema = new mongoose.Schema({
  title: { type: String },
  priority: {
    type: String,
    enum: ["low", "high", "medium", "important"],
    default: "low",
  },
  createdAt: { type: Date, default: Date.now },
  completed: { type: Boolean, default: false },
  dueDate: { type: Date, default: null },
  reminderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Reminder",
    default: null,
  },
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: "Note", default: null },
});

module.exports = mongoose.model("Task", TaskSchema);
