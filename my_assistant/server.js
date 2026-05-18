// server.js
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
} = require("./services/dataFetcher");
const { parseDate } = require("./services/dateParser");
const {
  autoCreateDependencies,
  updateDependencies,
  deleteDependencies,
  getTaskWithDependencies,
  getReminderWithDependenciesById,
  getNoteWithDependenciesById,
  searchAllByKeyword,
} = require("./services/autoCreateService.js");
const { formatISTDate } = require("./utils/dateFormatter.js");

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
    await Note.findByIdAndDelete(req.params.id);
    res.json({ message: "Note deleted" });
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
    await Reminder.findByIdAndDelete(req.params.id);
    res.json({ message: "Reminder deleted" });
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

// Create task
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
      switch (action.type) {
        case "CREATE_TASK":
          console.log(`📝 Creating task: "${action.title}"`);

          let dueDate = null;
          let originalDueDateString = action.dueDate || "";
          let hasExplicitTime = false;

          if (action.dueDate) {
            dueDate = await parseDate(action.dueDate);
            console.log(`  Parsed due date: ${dueDate}`);

            hasExplicitTime =
              /(?:\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))/i.test(
                originalDueDateString,
              );
            console.log(`  Has explicit time: ${hasExplicitTime}`);
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

          const {
            reminder: autoReminder,
            note: autoNote,
            error: autoError,
          } = await autoCreateDependencies(savedTask, hasExplicitTime);

          let successMessage = `✅ Task "${action.title}" has been created with ${
            action.priority || "medium"
          } priority!\n\n`;

          if (autoReminder && originalDueDateString) {
            successMessage += `⏰ Reminder set for: ${originalDueDateString}\n`;
          }

          if (autoNote) {
            successMessage += `📝 Notes page created for tracking progress\n`;
          }

          if (autoError) {
            successMessage += `\n⚠️ Note: Auto-reminder/note creation had issues, but task was saved.`;
          }

          createdItem = savedTask;
          actionResult = savedTask;
          finalReply = successMessage;
          setLastMentionedTask(savedTask.title, savedTask._id);
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
                  newDueDate.setHours(
                    parsedTime.getHours(),
                    parsedTime.getMinutes(),
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
                  const oldDatePart = oldDueDate.toDateString();
                  const newDatePart = newDueDate.toDateString();

                  const oldTimePart = `${oldDueDate.getHours()}:${oldDueDate.getMinutes()}`;

                  const newTimePart = `${newDueDate.getHours()}:${newDueDate.getMinutes()}`;

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

                finalReply = `✅ Task "${action.searchQuery}" ${changeType} updated to ${newDueDate.toLocaleString()}`;

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

            if (isOnlyTime) {
              newRemindAt = new Date(reminderToUpdate.remindAt);
              const parsedTime = await parseDate(action.newValue);
              if (parsedTime) {
                newRemindAt.setHours(
                  parsedTime.getHours(),
                  parsedTime.getMinutes(),
                  0,
                  0,
                );
              } else {
                finalReply = `❌ Failed to parse time: ${action.newValue}`;
                break;
              }
              console.log(
                `  ⏰ Keeping original date (${newRemindAt.toDateString()}), updating time only`,
              );
            } else {
              newRemindAt = await parseDate(action.newValue);
            }

            if (newRemindAt) {
              reminderToUpdate.remindAt = newRemindAt;
              await reminderToUpdate.save();

              if (reminderToUpdate.taskId) {
                const linkedTask = await Task.findById(reminderToUpdate.taskId);
                if (linkedTask) {
                  linkedTask.dueDate = newRemindAt;
                  await linkedTask.save();
                  finalReply = `✅ Reminder "${action.searchQuery}" updated to ${newRemindAt.toLocaleString()}\n📋 Linked task "${linkedTask.title}" due date also updated.`;
                } else {
                  finalReply = `✅ Reminder "${action.searchQuery}" updated to ${newRemindAt.toLocaleString()}`;
                }
              } else {
                finalReply = `✅ Reminder "${action.searchQuery}" updated to ${newRemindAt.toLocaleString()}`;
              }
            } else {
              finalReply = `❌ Failed to parse date/time: ${action.newValue}`;
            }
          }
          break;

        case "DELETE_TASK":
          console.log(
            `🗑️ DELETE_TASK action received: "${action.searchQuery}"`,
          );

          let searchTitle = action.searchQuery.replace(/["']/g, "").trim();
          searchTitle = searchTitle.replace(/[.!?]+$/, "");

          const taskToDelete = await Task.findOne({
            title: { $regex: new RegExp(`^${searchTitle}$`, "i") },
          });

          if (!taskToDelete) {
            finalReply = `❌ Could not find a task titled "${searchTitle}".`;
            break;
          }

          await deleteDependencies(taskToDelete._id);
          await Task.findByIdAndDelete(taskToDelete._id);

          finalReply = `✅ Task "${taskToDelete.title}" and its associated reminder & note have been permanently deleted!`;
          createdItem = null;
          actionResult = null;
          break;

        case "DELETE_REMINDER":
          console.log(`⏰ Deleting reminder: "${action.searchQuery}"`);

          const reminderToDelete = await Reminder.findOne({
            title: { $regex: new RegExp(`^${action.searchQuery}$`, "i") },
          });

          if (!reminderToDelete) {
            finalReply = `❌ Could not find a reminder titled "${action.searchQuery}".`;
            break;
          }

          await Reminder.findByIdAndDelete(reminderToDelete._id);
          finalReply = `✅ Reminder "${action.searchQuery}" has been deleted.`;
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

        case "DELETE_NOTE":
          console.log(`📝 Deleting note: "${action.searchQuery}"`);

          const noteToDelete = await Note.findOne({
            title: { $regex: new RegExp(`^${action.searchQuery}$`, "i") },
          });

          if (!noteToDelete) {
            finalReply = `❌ Could not find a note titled "${action.searchQuery}".`;
            break;
          }

          await Note.findByIdAndDelete(noteToDelete._id);
          finalReply = `✅ Note "${action.searchQuery}" has been deleted.`;
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
          finalReply = `✅ Reminder "${action.title}" set for ${remindAt.toLocaleString()}!`;
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
