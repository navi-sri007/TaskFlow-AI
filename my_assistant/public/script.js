process.env.TZ = "Asia/Kolkata";
require("dotenv").config();
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
// Format UTC ISO dates from API as IST for display
function formatISTDate(date) {
  if (!date) return "No date";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}
// ========== TAB SWITCHING ==========
function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.classList.remove("active");
  });

  // Show selected tab
  document.getElementById(`${tabName}-tab`).classList.add("active");

  // Update button styles
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  event.target.classList.add("active");

  // Refresh data when switching tabs
  if (tabName === "tasks") loadTasks();
  if (tabName === "notes") loadNotes();
  if (tabName === "reminders") loadReminders();
}

// Generate or get session ID
let sessionId = localStorage.getItem("chatSessionId");
if (!sessionId) {
  sessionId =
    "user_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  localStorage.setItem("chatSessionId", sessionId);
}
// ========== TASKS ==========
document.getElementById("taskForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const taskData = {
    title: document.getElementById("taskTitle").value,
    priority: document.getElementById("taskPriority").value,
    completed: document.getElementById("taskCompleted").value === "true", // Convert string to boolean
    dueDate: document.getElementById("taskDueDate").value || null,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskData),
    });

    if (response.ok) {
      alert("Task added successfully!");
      document.getElementById("taskForm").reset();
      loadTasks();
    }
  } catch (error) {
    console.error("Error adding task:", error);
  }
});

async function loadTasks() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tasks`);
    const tasks = await response.json();

    const tasksList = document.getElementById("tasksList");
    if (!tasks.length) {
      tasksList.innerHTML = "<p>No tasks yet. Add one above!</p>";
      return;
    }

    tasksList.innerHTML = tasks
      .map(
        (task) => `
            <div class="item-card">
                <strong>${task.title}</strong><br>
                📌 Priority: ${task.priority}<br>
                ✅ Completed: ${task.completed ? "Yes" : "No"}<br>
                ${task.dueDate ? `📅 Due: ${formatISTDate(task.dueDate)}` : "⏰ No due date"}
            </div>
        `,
      )
      .join("");
  } catch (error) {
    console.error("Error loading tasks:", error);
  }
}

// ========== NOTES ==========
document.getElementById("noteForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const noteData = {
    title: document.getElementById("noteTitle").value || "Untitled",
    content: document.getElementById("noteContent").value,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(noteData),
    });

    if (response.ok) {
      alert("Note saved successfully!");
      document.getElementById("noteForm").reset();
      loadNotes();
    }
  } catch (error) {
    console.error("Error saving note:", error);
  }
});

// Store current note being edited
let currentEditingNoteId = null;

async function loadNotes() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/notes`);
    const notes = await response.json();

    const notesList = document.getElementById("notesList");
    if (!notes.length) {
      notesList.innerHTML = "<p>📭 No notes yet. Add one above!</p>";
      return;
    }

    notesList.innerHTML = notes
      .map(
        (note) => `
            <div class="item-card" data-note-id="${note.id || note._id}">
                <strong>📄 ${escapeHtml(note.title)}</strong><br>
                <div class="note-preview">${escapeHtml(note.content.substring(0, 120))}${note.content.length > 120 ? "..." : ""}</div>
                <small class="note-meta">📅 ${formatISTDate(note.createdAt)}</small>
                <div class="note-actions">
                    <button class="edit-note-btn" onclick="openEditNoteModal('${note.id || note._id}')">
                        ✏️ Edit
                    </button>
                    <button class="delete-note-btn" onclick="deleteNote('${note.id || note._id}')">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `,
      )
      .join("");
  } catch (error) {
    console.error("Error loading notes:", error);
    document.getElementById("notesList").innerHTML =
      "<p style='color: #dc2626;'>⚠️ Failed to load notes. Make sure backend is running.</p>";
  }
}

// Helper function to escape HTML to prevent XSS
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}
// Open modal to edit note
async function openEditNoteModal(noteId) {
  try {
    // Fetch the specific note details
    const response = await fetch(`${API_BASE_URL}/api/notes/${noteId}`);
    if (!response.ok) {
      throw new Error("Failed to fetch note");
    }
    const note = await response.json();

    currentEditingNoteId = noteId;

    // Create modal overlay
    const modal = document.createElement("div");
    modal.className = "note-editor-overlay";
    modal.id = "noteEditorModal";
    modal.innerHTML = `
      <div class="note-editor-modal">
        <div class="note-editor-header">
          <h3>✏️ Edit Note</h3>
          <button class="close-editor" onclick="closeNoteEditor()">&times;</button>
        </div>
        <div class="note-editor-body">
          <input type="text" id="editNoteTitleInput" class="edit-note-title" value="${escapeHtmlAttribute(note.title)}" placeholder="Note title">
          <textarea id="editNoteContentInput" class="edit-note-content" rows="8" placeholder="Write your note content here...">${escapeHtmlAttribute(note.content)}</textarea>
        </div>
        <div class="note-editor-footer">
          <button class="btn-cancel" onclick="closeNoteEditor()">Cancel</button>
          <button class="btn-update" onclick="updateNote()">💾 Save Changes</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close on overlay click
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeNoteEditor();
    });
  } catch (error) {
    console.error("Error opening editor:", error);
    showFloatingMessage("Could not load note for editing", "error");
  }
}

// Helper to escape for HTML attributes
function escapeHtmlAttribute(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Close the note editor modal
function closeNoteEditor() {
  const modal = document.getElementById("noteEditorModal");
  if (modal) {
    modal.remove();
  }
  currentEditingNoteId = null;
}

// Update note via PUT/PATCH request
async function updateNote() {
  if (!currentEditingNoteId) {
    showFloatingMessage("No note selected", "error");
    return;
  }

  const updatedTitle = document
    .getElementById("editNoteTitleInput")
    .value.trim();
  const updatedContent = document.getElementById("editNoteContentInput").value;

  if (!updatedTitle) {
    showFloatingMessage("Title cannot be empty", "error");
    return;
  }

  const updateData = {
    title: updatedTitle || "Untitled",
    content: updatedContent || "",
  };

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/notes/${currentEditingNoteId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      },
    );

    if (response.ok) {
      showFloatingMessage("✅ Note updated successfully!", "success");
      closeNoteEditor();
      loadNotes(); // Refresh notes list
    } else if (response.status === 404) {
      showFloatingMessage("Note not found (maybe deleted)", "error");
      closeNoteEditor();
      loadNotes();
    } else {
      const errorText = await response.text();
      console.error("Update failed:", errorText);
      showFloatingMessage("Failed to update note", "error");
    }
  } catch (error) {
    console.error("Error updating note:", error);
    showFloatingMessage("Network error while updating", "error");
  }
}

// Delete note function
async function deleteNote(noteId) {
  if (
    !confirm(
      "⚠️ Are you sure you want to delete this note? This action cannot be undone.",
    )
  ) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/notes/${noteId}`, {
      method: "DELETE",
    });

    if (response.ok) {
      showFloatingMessage("🗑️ Note deleted successfully", "success");
      loadNotes(); // Refresh the notes list
    } else if (response.status === 404) {
      showFloatingMessage("Note already deleted", "info");
      loadNotes();
    } else {
      showFloatingMessage("Could not delete note", "error");
    }
  } catch (error) {
    console.error("Error deleting note:", error);
    showFloatingMessage("Error deleting note", "error");
  }
}

// Floating message helper (toast)
function showFloatingMessage(message, type = "success") {
  // Remove existing floating message
  const existing = document.querySelector(".update-status");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "update-status";
  toast.style.background =
    type === "success" ? "#10b981" : type === "error" ? "#ef4444" : "#3b82f6";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100px)";
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// Override existing notification to avoid conflicts
window.showNotification =
  window.showNotification ||
  function (msg) {
    showFloatingMessage(msg, "success");
  };

// Also update the note form submission to refresh after saving
const originalNoteFormHandler = document.getElementById("noteForm");
if (originalNoteFormHandler) {
  // Remove any existing listener to prevent duplicate, then attach
  const newForm = originalNoteFormHandler.cloneNode(true);
  originalNoteFormHandler.parentNode.replaceChild(
    newForm,
    originalNoteFormHandler,
  );

  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const noteData = {
      title: document.getElementById("noteTitle").value || "Untitled",
      content: document.getElementById("noteContent").value,
    };

    try {
      const response = await fetch(`${API_BASE_URL}/api/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(noteData),
      });

      if (response.ok) {
        showFloatingMessage("📝 Note saved successfully!", "success");
        document.getElementById("noteForm").reset();
        loadNotes();
      } else {
        showFloatingMessage("Error saving note", "error");
      }
    } catch (error) {
      console.error("Error saving note:", error);
      showFloatingMessage("Failed to save note", "error");
    }
  });
}

// ========== BACKEND API FALLBACK HANDLING (for demo purposes) ==========
// Note: This frontend expects backend REST endpoints:
// GET    /api/notes
// POST   /api/notes
// GET    /api/notes/:id
// PUT    /api/notes/:id
// DELETE /api/notes/:id
// If your backend currently doesn't support PUT/DELETE for individual notes,
// you'll need to implement those routes. I'll add a compatibility note.

console.log(
  "✅ Notes editor enhancement loaded (Edit/Update/Delete supported)",
);
console.log(
  "💡 Make sure your backend has PUT /api/notes/:id and DELETE /api/notes/:id",
);

// ========== TASKS & REMINDERS remain same (optional: add delete for tasks) ==========
// Add optional quick delete for tasks to keep consistency
async function deleteTask(taskId) {
  if (!confirm("Delete this task?")) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      showFloatingMessage("Task deleted", "success");
      loadTasks();
    }
  } catch (e) {
    console.error(e);
  }
}

// ========== Refresh on tab switch for notes ==========
// Ensure notes load properly when switching to notes tab
const originalSwitchTab = window.switchTab;
if (originalSwitchTab) {
  window.switchTab = function (tabName) {
    originalSwitchTab(tabName);
    if (tabName === "notes") {
      loadNotes();
    }
  };
}

// Make functions globally accessible for inline onclick handlers
window.openEditNoteModal = openEditNoteModal;
window.closeNoteEditor = closeNoteEditor;
window.updateNote = updateNote;
window.deleteNote = deleteNote;
window.showFloatingMessage = showFloatingMessage;

// ========== REMINDERS ==========
document
  .getElementById("reminderForm")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const reminderData = {
      title: document.getElementById("reminderTitle").value,
      remindAt: document.getElementById("reminderTime").value,
    };

    try {
      const response = await fetch(`${API_BASE_URL}/api/reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reminderData),
      });

      if (response.ok) {
        alert("Reminder set successfully!");
        document.getElementById("reminderForm").reset();
        loadReminders();
      }
    } catch (error) {
      console.error("Error setting reminder:", error);
    }
  });

async function loadReminders() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/reminders`);
    const reminders = await response.json();

    const remindersList = document.getElementById("remindersList");
    if (!reminders.length) {
      remindersList.innerHTML = "<p>No reminders yet. Add one above!</p>";
      return;
    }

    remindersList.innerHTML = reminders
      .map(
        (reminder) => `
            <div class="item-card">
                <strong>${reminder.title}</strong><br>
                ⏰ ${reminder.remindAt ? formatISTDate(reminder.remindAt) : "No time set"}
            </div>
        `,
      )
      .join("");
  } catch (error) {
    console.error("Error loading reminders:", error);
  }
}

// ========== CHATBOT ==========
async function sendMessage() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();

  if (!message) return;

  // Add user message to chat
  addMessageToChat("user", message);
  input.value = "";
  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes("related to") ||
    lowerMsg.includes("everything about") ||
    (lowerMsg.includes("show me") &&
      lowerMsg.includes("task") &&
      lowerMsg.includes("reminder"))
  ) {
    // Extract keyword
    const match = message.match(
      /(?:related to|everything about|show me.*?["']?)(\w+)/i,
    );
    if (match) {
      const keyword = match[1];
      const relatedInfo = await searchRelated(keyword);
      addMessageToChat("bot", relatedInfo);
      return;
    }
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, sessionId: sessionId }),
    });

    const data = await response.json();
    addMessageToChat("bot", data.reply || "Sorry, I could not process that.");
  } catch (error) {
    console.error("Chat error:", error);
    addMessageToChat("bot", "Sorry, something went wrong. Please try again.");
  }
}

marked.setOptions({
  breaks: true,
});

function addMessageToChat(sender, message) {
  const chatMessages = document.getElementById("chatMessages");

  const messageDiv = document.createElement("div");

  messageDiv.className = sender === "user" ? "user-message" : "bot-message";

  if (sender === "user") {
    messageDiv.textContent = message;
  } else {
    messageDiv.innerHTML = marked.parse(message);
  }

  chatMessages.appendChild(messageDiv);

  chatMessages.scrollTop = chatMessages.scrollHeight;
}
// public/script.js - add this function near the chat section

// Update the sendMessage function to show better feedback
async function sendMessage() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();

  if (!message) return;

  // Add user message to chat
  addMessageToChat("user", message);
  input.value = "";

  // Show typing indicator
  showTypingIndicator();

  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, sessionId: sessionId }),
    });

    const data = await response.json();

    // Remove typing indicator
    removeTypingIndicator();

    // Add bot response
    addMessageToChat("bot", data.reply || "Sorry, I could not process that.");

    // Refresh data if an item was created
    if (data.action) {
      // Refresh the appropriate tab's data
      if (data.action.type === "CREATE_TASK") {
        loadTasks();
        // Optional: Show a brief notification
        showNotification("Task created successfully!");
      } else if (data.action.type === "CREATE_NOTE") {
        loadNotes();
        showNotification("Note saved successfully!");
      } else if (data.action.type === "CREATE_REMINDER") {
        loadReminders();
        showNotification("Reminder set successfully!");
      }
    }
  } catch (error) {
    console.error("Chat error:", error);
    removeTypingIndicator();
    addMessageToChat("bot", "Sorry, something went wrong. Please try again.");
  }
}
async function searchRelated(keyword) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/search/${encodeURIComponent(keyword)}`,
    );
    const data = await response.json();

    if (!data || !data.task) {
      return `No related items found for "${keyword}"`;
    }

    let message = `📋 **Complete Information for "${keyword}"**\n\n`;

    // Task details
    message += `**Task:** ${data.task.title}\n`;
    message += `📌 Priority: ${data.task.priority}\n`;
    message += `📅 Due: ${data.task.dueDate ? formatISTDate(data.task.dueDate) : "No due date"}\n`;
    message += `✅ Status: ${data.task.completed ? "Completed" : "Pending"}\n\n`;

    // Reminder details
    if (data.reminder) {
      message += `**⏰ Reminder:** ${data.reminder.title}\n`;
      message += `   At: ${formatISTDate(data.reminder.remindAt)}\n\n`;
    } else {
      message += `**⏰ Reminder:** Not set\n\n`;
    }

    // Note details
    if (data.note) {
      message += `**📝 Note:** ${data.note.title}\n`;
      message += `   Content: ${data.note.content.substring(0, 150)}${data.note.content.length > 150 ? "..." : ""}\n`;
    } else {
      message += `**📝 Note:** Not created\n`;
    }

    return message;
  } catch (error) {
    console.error("Error:", error);
    return `Error fetching related items for "${keyword}"`;
  }
}

// Add typing indicator functions
function showTypingIndicator() {
  const chatMessages = document.getElementById("chatMessages");
  const indicator = document.createElement("div");
  indicator.id = "typing-indicator";
  indicator.className = "bot-message";
  indicator.textContent = "🤔 Assistant is thinking...";
  chatMessages.appendChild(indicator);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  if (indicator) {
    indicator.remove();
  }
}

// Add notification function
function showNotification(message) {
  // Create a temporary notification div
  const notification = document.createElement("div");
  notification.className = "notification";
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background-color: #4CAF50;
    color: white;
    padding: 12px 20px;
    border-radius: 5px;
    z-index: 1000;
    animation: fadeInOut 3s ease-in-out;
  `;

  document.body.appendChild(notification);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Add CSS animation for notification (add to style.css)
const style = document.createElement("style");
style.textContent = `
  @keyframes fadeInOut {
    0% { opacity: 0; transform: translateY(20px); }
    15% { opacity: 1; transform: translateY(0); }
    85% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-20px); }
  }
`;
document.head.appendChild(style);
// Allow Enter key in chat input
document.getElementById("chatInput")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

// ========== LOAD DATA ON PAGE START ==========
loadTasks();
loadNotes();
loadReminders();
