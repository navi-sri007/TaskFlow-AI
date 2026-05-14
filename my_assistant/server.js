// server.js (updated sections)

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
} = require("./services/dataFetcher");
const { parseDate } = require("./services/dateParser");
// In server.js, update this import:
const {
  autoCreateDependencies,
  updateDependencies,
  deleteDependencies,
  getTaskWithDependencies,
  getReminderWithDependenciesById,
  getNoteWithDependenciesById,
  searchAllByKeyword,
} = require("./services/autoCreateService.js");

// Get note with its task and reminder using note._id

// Search by keyword using ID-based lookup

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
    await Note.findByIdAndDelete(req.params.id);
    res.json({ message: "Note deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/search/:keyword", async (req, res) => {
  const result = await searchAllByKeyword(req.params.keyword);
  if (!result) return res.json({ message: "No results found" });
  res.json(result);
});

// Delete reminder
app.delete("/api/reminders/:id", async (req, res) => {
  try {
    await Reminder.findByIdAndDelete(req.params.id);
    res.json({ message: "Reminder deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
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

app.get("/api/task/:id", async (req, res) => {
  const result = await getTaskWithDependencies(req.params.id);
  if (!result) return res.status(404).json({ error: "Task not found" });
  res.json(result);
});
// Get task with its reminder and note by task name
app.get("/api/task/by-name/:title", async (req, res) => {
  const task = await Task.findOne({
    title: { $regex: new RegExp(`^${req.params.title}$`, "i") },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });

  const result = await getTaskWithDependencies(task._id);
  console.log("Result:", result);
  res.json(result);
});
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

// Get note with its task and reminder by note name
app.get("/api/note/by-name/:title", async (req, res) => {
  const note = await Note.findOne({
    title: { $regex: new RegExp(req.params.title, "i") },
  });
  if (!note) return res.status(404).json({ error: "Note not found" });

  const result = await getNoteWithDependenciesById(note._id);
  res.json(result);
});
app.get("/api/note/:id", async (req, res) => {
  const result = await getNoteWithDependenciesById(req.params.id);
  if (!result) return res.status(404).json({ error: "Note not found" });
  res.json(result);
});

// Search all by keyword
app.get("/api/search/:keyword", async (req, res) => {
  const result = await searchAllByKeyword(req.params.keyword);
  res.json(result);
});
app.get("/api/notes", async (req, res) => {
  try {
    const notes = await Note.find();
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/reminders", async (req, res) => {
  try {
    const reminders = await Reminder.find();
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/tasks", async (req, res) => {
  try {
    const task = new Task(req.body);
    const savedTask = await task.save();
    const result = await autoCreateDependencies(savedTask);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
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
      switch (action.type) {
        case "CREATE_TASK":
          console.log(`📝 Creating task: "${action.title}"`);

          // Parse due date if provided
          let dueDate = null;
          if (action.dueDate) {
            dueDate = await parseDate(action.dueDate);
            console.log(`  Parsed due date: ${dueDate}`);
          }

          // Create the task
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

          // Save the task
          const savedTask = await task.save();
          console.log(`  ✅ Task saved with ID: ${savedTask._id}`);

          // AUTO-CREATE REMINDER AND NOTE
          const {
            reminder: autoReminder,
            note: autoNote,
            error: autoError,
          } = await autoCreateDependencies(savedTask);

          // Prepare response message
          let successMessage = `✅ Task "${action.title}" has been created with ${action.priority || "medium"} priority!\n\n`;

          if (autoReminder) {
            successMessage += `⏰ Reminder set for: ${new Date(autoReminder.remindAt).toLocaleString()}\n`;
          }

          if (autoNote) {
            successMessage += `📝 Notes page created for tracking progress\n`;
          }

          if (autoError) {
            successMessage += `\n⚠️ Note: Auto-reminder/note creation had issues, but task was saved.`;
          }

          createdItem = savedTask;
          actionResult = savedTask;
          finalReply =
            successMessage +
            (reply ? reply.replace(/ACTION: CREATE_TASK[^\n]*\n?/, "") : "");
          break;

        // In your /api/chat endpoint, add this case inside the switch statement

        case "UPDATE_TASK":
          console.log(`📝 Updating task: "${action.searchQuery}"`);
          console.log(`  Field to update: ${action.field}`);
          console.log(`  New value: ${action.newValue}`);

          // Find the task (case-insensitive search)
          const taskToUpdate = await Task.findOne({
            title: { $regex: new RegExp(`^${action.searchQuery}$`, "i") },
          });

          if (!taskToUpdate) {
            finalReply = `❌ Could not find a task titled "${action.searchQuery}". Please check the name and try again.`;
            break;
          }

          console.log(
            `  ✅ Found task: ${taskToUpdate.title} (ID: ${taskToUpdate._id})`,
          );

          // Track what's being updated for dependency sync
          const updates = {};
          let oldTitle = taskToUpdate.title;

          // Apply the update based on field
          switch (action.field) {
            case "dueDate":
              const newDueDate = await parseDate(action.newValue);
              if (newDueDate) {
                // Set to 9 AM
                newDueDate.setHours(9, 0, 0, 0);
                taskToUpdate.dueDate = newDueDate;
                updates.dueDate = true;
                console.log(`  ✅ Due date updated to: ${newDueDate}`);
              } else {
                console.log(`  ❌ Failed to parse date: ${action.newValue}`);
              }
              break;

            case "priority":
              if (
                ["low", "medium", "high", "important"].includes(
                  action.newValue.toLowerCase(),
                )
              ) {
                taskToUpdate.priority = action.newValue.toLowerCase();
                updates.priority = true;
                console.log(`  ✅ Priority updated to: ${action.newValue}`);
              } else {
                console.log(`  ❌ Invalid priority value: ${action.newValue}`);
              }
              break;

            case "title":
              taskToUpdate.title = action.newValue;
              updates.title = true;
              console.log(
                `  ✅ Title updated from "${oldTitle}" to "${action.newValue}"`,
              );
              break;

            case "completed":
              const isCompleted =
                action.newValue === "true" ||
                action.newValue === "completed" ||
                action.newValue === "done";
              taskToUpdate.completed = isCompleted;
              updates.completed = true;
              console.log(`  ✅ Completed status updated to: ${isCompleted}`);
              break;

            default:
              console.log(`  ❌ Unknown field to update: ${action.field}`);
              finalReply = `❌ I don't know how to update the field "${action.field}".`;
              break;
          }

          // Save the updated task
          await taskToUpdate.save();

          // Update dependencies (reminder and note)
          if (Object.keys(updates).length > 0) {
            await updateDependencies(taskToUpdate, updates);
          }

          // Get updated dependencies for response
          const updatedDeps = await getTaskWithDependencies(taskToUpdate._id);

          // Prepare success message
          let updateMessage = `✅ Task "${action.searchQuery}" has been updated!\n\n`;

          if (updates.dueDate && updatedDeps.reminder) {
            updateMessage += `⏰ Reminder updated to: ${updatedDeps.reminder.remindAt.toLocaleString()}\n`;
          }

          if (updates.title && updatedDeps.note) {
            updateMessage += `📝 Note title updated to: "${updatedDeps.note.title}"\n`;
          }

          if (updates.priority) {
            updateMessage += `⭐ Priority changed to: ${taskToUpdate.priority}\n`;
          }

          if (updates.completed) {
            updateMessage += taskToUpdate.completed
              ? `🎉 Task marked as completed!\n`
              : `📋 Task marked as pending.\n`;
          }

          createdItem = taskToUpdate;
          actionResult = taskToUpdate;
          finalReply =
            updateMessage +
            (reply ? reply.replace(/ACTION: UPDATE_TASK[^\n]*\n?/, "") : "");
          break;
        case "CREATE_NOTE":
          const newNote = new Note({
            title: action.title || "Untitled",
            content: action.content || "",
          });

          createdItem = await newNote.save();
          actionResult = newNote;
          finalReply =
            `✅ Note "${action.title}" has been saved!\n\n` +
            (reply ? reply.replace(/ACTION: CREATE_NOTE[^\n]*\n?/, "") : "");
          break;

        case "CREATE_REMINDER":
          // Use AI-powered date parser
          let remindAt = null;
          if (action.remindAt) {
            remindAt = await parseDate(action.remindAt);
            console.log(
              `Parsed remind date "${action.remindAt}" -> ${remindAt}`,
            );
          }

          if (!remindAt) {
            // Fallback to tomorrow if parsing failed
            remindAt = new Date();
            remindAt.setDate(remindAt.getDate() + 1);
            remindAt.setHours(9, 0, 0, 0);
          }

          const reminder = new Reminder({
            title: action.title,
            remindAt: remindAt,
          });

          createdItem = await reminder.save();
          actionResult = reminder;
          let cleanDateString = action.remindAt;
          const isoDateMatch = cleanDateString.match(
            /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
          );
          cleanDateString = isoDateMatch[0];
          finalReply =
            `✅ Reminder "${action.title}" set for "${cleanDateString}" ` +
            (reply
              ? reply.replace(/ACTION: CREATE_REMINDER[^\n]*\n?/, "")
              : "");
          break;
      }
    }

    // Clean up any remaining action lines in the reply
    if (finalReply && finalReply.includes("ACTION:")) {
      finalReply = finalReply.replace(/ACTION: [^\n]*\n?/g, "").trim();
    }

    // 4. Save to chat history
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
