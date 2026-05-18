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
    dueDate: document.getElementById("taskDueDate").value || null,
  };

  try {
    const response = await fetch("/api/tasks", {
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
    const response = await fetch("/api/tasks");
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
                ${task.dueDate ? `📅 Due: ${new Date(task.dueDate).toDateString()}` : "⏰ No due date"}
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
    const response = await fetch("/api/notes", {
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

async function loadNotes() {
  try {
    const response = await fetch("/api/notes");
    const notes = await response.json();

    const notesList = document.getElementById("notesList");
    if (!notes.length) {
      notesList.innerHTML = "<p>No notes yet. Add one above!</p>";
      return;
    }

    notesList.innerHTML = notes
      .map(
        (note) => `
            <div class="item-card">
                <strong>${note.title}</strong><br>
                ${note.content.substring(0, 100)}${note.content.length > 100 ? "..." : ""}<br>
                <small>📅 ${new Date(note.createdAt).toLocaleString()}</small>
            </div>
        `,
      )
      .join("");
  } catch (error) {
    console.error("Error loading notes:", error);
  }
}

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
      const response = await fetch("/api/reminders", {
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
    const response = await fetch("/api/reminders");
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
                ⏰ ${reminder.remindAt ? new Date(reminder.remindAt).toLocaleString() : "No time set"}
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
    const response = await fetch("/api/chat", {
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
    const response = await fetch("/api/chat", {
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
    const response = await fetch(`/api/search/${encodeURIComponent(keyword)}`);
    const data = await response.json();

    if (!data || !data.task) {
      return `No related items found for "${keyword}"`;
    }

    let message = `📋 **Complete Information for "${keyword}"**\n\n`;

    // Task details
    message += `**Task:** ${data.task.title}\n`;
    message += `📌 Priority: ${data.task.priority}\n`;
    message += `📅 Due: ${data.task.dueDate ? new Date(data.task.dueDate).toLocaleDateString() : "No due date"}\n`;
    message += `✅ Status: ${data.task.completed ? "Completed" : "Pending"}\n\n`;

    // Reminder details
    if (data.reminder) {
      message += `**⏰ Reminder:** ${data.reminder.title}\n`;
      message += `   At: ${new Date(data.reminder.remindAt).toLocaleString()}\n\n`;
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
