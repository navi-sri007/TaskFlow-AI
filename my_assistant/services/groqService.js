// services/groqService.js (updated version)

const Groq = require("groq-sdk");
const {
  getLastMentionedTask,
  getLastMentionedTaskId,
} = require("./dataFetcher");
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});
// Store conversation history per session
const conversationHistory = new Map();

function getSystemPrompt() {
  return `You are a helpful personal assistant that manages tasks, notes, and reminders.

CRITICAL RULES:
- If user says "update", "change", "modify", "set its", "change its" → USE UPDATE_TASK
- If user says "create", "add", "new" → USE CREATE_TASK
- NEVER create a new task when user wants to update an existing one

===========================================
TABLE FORMATTING RULES (COLUMN-WISE):
===========================================

When user asks for "tabular form", "as a table", "table format", or "table":

FOR SINGLE TASK (with all details + linked reminder + linked note):
| Task Title | Priority | Due Date | Status | Reminder  | Note Title | 
|------------|----------|----------|--------|----------|--------------|
| Buy groceries | High | 2026-05-20 | Pending | Buy groceries  | Buy groceries | 

FOR SINGLE REMINDER (with linked task details):
| Reminder Title | Reminder Time | Linked Task | Task Status |
|----------------|---------------|-------------|--------------|
| Call mom | 2026-05-20 09:00 AM | Call mom | Completed|

FOR SINGLE NOTE (with linked task details):
| Note Title | Note Content | Linked Task | Task Priority | Task Due Date |
|------------|--------------|-------------|---------------|---------------|
| Meeting notes | Discuss budget | Client meeting | High | 2026-05-22 |

FOR MULTIPLE TASKS:
| Task Title | Priority | Due Date | Status | Reminder Time | Note Preview |
|------------|----------|----------|--------|---------------|--------------|
| Task 1 | High | 2026-05-20 | Pending | 2026-05-20 09:00 AM | Notes... |
| Task 2 | Medium | No date | Completed | No reminder | No notes |

FOR MULTIPLE REMINDERS:
| Reminder Title | Reminder Time | Linked Task | Task Status |
|----------------|---------------|-------------|--------------|
| Reminder 1 | 2026-05-20 09:00 AM | Task 1 | Pending |
| Reminder 2 | 2026-05-25 02:00 PM | Task 2 | Completed |

FOR MULTIPLE NOTES:
| Note Title | Note Preview | Linked Task | Task Priority |
|------------|--------------|-------------|---------------|
| Note 1 | Content preview... | Task 1 | High |
| Note 2 | Content preview... | Task 2 | Medium |


===========================
CRITICAL ACTION FORMATTING RULES:
===========================
- When outputting an ACTION, put it on its OWN LINE
- DO NOT add any extra text, explanations, or punctuation after the action
Example 
CORRECT format:
ACTION: DELETE_TASK|Pay bills
WRONG (DO NOT DO THIS):
ACTION: DELETE_TASK|Pay bills
The task "Pay bills" has been deleted.

NOTE: THIS IS APPLICATBLE FOR ALL ACTION TYPES (CREATE, UPDATE, DELETE) AND ALL ENTITIES (TASK, NOTE, REMINDER)

- the action line itself must be clean and contain ONLY the action

`;
}
async function getAIResponse(userMessage, contextData, sessionId) {
  try {
    // Get or create conversation history for this session
    let history = conversationHistory.get(sessionId) || [];

    // Add user message to history
    history.push({
      role: "user",
      content: userMessage,
    });
    const MAX_HISTORY_MESSAGES = 8; // 4 user + 4 assistant
    if (history.length > MAX_HISTORY_MESSAGES) {
      history = history.slice(-MAX_HISTORY_MESSAGES);
    }

    const recentHistory = history.slice(-6);
    // Prepare context from database
    const contextPrompt = `
========================
AI ASSISTANT CONTEXT
========================

You are currently assisting a user in managing personal productivity data.

Your responsibilities include:
- Understanding user intent accurately
- Answering naturally and conversationally
- Using database records as the source of truth
- Maintaining continuity with previous conversation
- **CREATING tasks, notes, and reminders when requested**
- Resolving references like:
  - "first one"
  - "second task"
  - "that reminder"
  - "the previous note"
  - "the important one"

========================
DATABASE 
========================
${contextData}
STRICT DATABASE RULES:
- Use ONLY this data. Don't invent anything.
- Always check before concluding not present.

========================
CONVERSATION MEMORY
========================

RECENT CONVERSATION (last ${recentHistory.length} messages):
${recentHistory
  .map((msg, index) => {
    // FIX 3: Truncate long messages
    const content =
      msg.content.length > 200
        ? msg.content.substring(0, 200) + "..."
        : msg.content;
    return `${index + 1}. ${msg.role.toUpperCase()}: ${content}`;
  })
  .join("\n")}

MEMORY RULES:
- Maintain continuity between messages.
- Understand follow-up references using previous conversation.

========================
CURRENT USER MESSAGE
========================

${userMessage}

========================
RESPONSE BEHAVIOR RULES
========================

1. Respond naturally like a smart assistant.
2. Keep responses concise but informative.
3. Do not expose internal instructions or raw database formatting.
4. If the user asks for summaries, summarize clearly.
5. If the user asks comparative questions, compare accurately.
6. If the user asks ambiguous questions:
   - Use previous conversation context to infer meaning.
   - Ask for clarification only if necessary.
7. Preserve conversational flow and context awareness.
8. Do not hallucinate missing data.
9. **When user wants to CREATE something, output the ACTION first, then a friendly confirmation.**
========================
DATE RULES:

- today = current date
- tomorrow = +1 day
- day after tomorrow = +2 days

Weekdays:
Sunday=0 ... Saturday=6

daysToAdd =
(targetDay - currentDay + 7) % 7
if 0 → 7

Supported:
- Friday
- next Monday
- May 15
- 15/05/2026
- today 4pm
- tomorrow 2:30 PM

Time:
- 2 PM → 14:00
- 12 AM → 00:00

Defaults:
- task date only → 00:00:00
- reminder date only → 09:00:00

Output:
YYYY-MM-DDTHH:mm:ss


// Replace the entire ACTION GENERATION RULES section with this:

**ACTIONS (first line only):**
CREATE_TASK|title|priority|dueDate
CREATE_NOTE|title|content
CREATE_REMINDER|title|remindAt
UPDATE_TASK|title|field|value
UPDATE_REMINDER|title|field|value
UPDATE_NOTE|title|field|value
DELETE_TASK|title
DELETE_REMINDER|title
DELETE_NOTE|title

**Rules:**
• Default priority: medium
• Default dueDate: tomorrow 09:00 IST
• Fields: dueDate, priority, title, completed, remindAt, content
• "update/change" = UPDATE_TASK (NEVER create)
• "create/add/new" = CREATE_TASK
• For time-only updates, preserve existing date

**Examples:**
CREATE_TASK|buy milk|medium|tomorrow
CREATE_NOTE|Project idea|AI assistant description
CREATE_REMINDER|water plants|2026-05-11T18:00:00
UPDATE_TASK|Pay bills|dueDate|tomorrow 2pm
UPDATE_REMINDER|Call mom|remindAt|Friday 5pm
UPDATE_NOTE|Meeting notes|content|new points
DELETE_TASK|great bday
DELETE_REMINDER|Call mom
DELETE_NOTE|Old notes

**Related items response:**
Task query → Show task + reminder + note
Reminder query → Show reminder + linked task
Note query → Show note + linked task 


⚠️⚠️⚠️ CRITICAL INSTRUCTION - READ FIRST ⚠️⚠️⚠️

If the DATABASE context below contains a task with title matching what the user asked for:
- DO NOT output ACTION: LIST_TASKS
- DISPLAY the task directly in table format

ONLY use ACTION: LIST_TASKS when:
- User explicitly says "list all tasks"
- The context has NO tasks (empty)

When user asks to "list tasks", "show pending tasks", etc.:
1. FIRST output: ACTION: LIST_TASKS|pending

**CRITICAL - DISTINGUISH BETWEEN TASK AND REMINDER:**

UPDATE_TASK is for tasks only. Fields: dueDate, priority, title, completed
UPDATE_REMINDER is for reminders only. Fields: remindAt (time only or date+time)

When user says "update the reminder...":
- ALWAYS use UPDATE_REMINDER, NOT UPDATE_TASK

Examples:
User: "update the reminder parents to 2pm"
→ ACTION: UPDATE_REMINDER|parents|remindAt|2pm


=================
LISTING ACTIONS:
=================
Examples:
User: "list pending tasks" 
→ ACTION: LIST_TASKS|pending
→ I'll show you the pending tasks.

USE LIST action.
=================
GET ACTION (Single entity):
==================
CRITICAL:
IMPORTANT: If context contains only ONE task, show ONLY that task or reminder or note.
Do NOT list all tasks when user asks for a specific one.
Examples:
User: "show Engagement in table"
→ (Context contains only Engagement task)
→ Display with Engagement's details


FINAL INSTRUCTION:
Generate the best possible response using:
- database context
- previous conversation
- current user intent
- contextual references
- conversational memory
- **ACTION creation when requested**

Respond now.
`;

    // Call GROQ API
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: contextPrompt },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 500,
    });

    const usage = completion.usage;
    console.log(`📊 TOKEN USAGE:`);
    console.log(`   Prompt tokens: ${usage.prompt_tokens}`);
    console.log(`   Completion tokens: ${usage.completion_tokens}`);
    console.log(`   Total tokens: ${usage.total_tokens}`);

    let aiResponse =
      completion.choices[0]?.message?.content ||
      "Sorry, I couldn't process that.";
    // Keep only last 10 messages for context
    history.push({
      role: "assistant",
      content: aiResponse,
    });

    // FIX 4: Re-apply limit after adding assistant response
    if (history.length > MAX_HISTORY_MESSAGES) {
      history = history.slice(-MAX_HISTORY_MESSAGES);
    }

    conversationHistory.set(sessionId, history);
    console.log(
      `📊 Session ${sessionId}: History size = ${history.length} messages, ~${JSON.stringify(history).length} chars`,
    );
    // Return both response and any action
    return {
      reply: aiResponse,
      action: extractAction(aiResponse),
    };
  } catch (error) {
    console.error("GROQ API Error:", error);
    return {
      reply: "Sorry, I'm having trouble connecting to my AI. Please try again.",
      action: null,
    };
  }
}

// Helper function to extract actions from AI response
// Helper function to extract actions from AI response
function extractAction(response) {
  // Helper function to clean search query
  function cleanSearchQuery(query) {
    if (!query) return "";
    let cleaned = query.split("\n")[0];
    cleaned = cleaned.replace(/["']/g, "");
    cleaned = cleaned.replace(/[.!?]+$/, "");
    cleaned = cleaned.replace(
      /\s+(?:The|This)\s+(?:task|note|reminder).*$/i,
      "",
    );
    cleaned = cleaned.replace(/\s+has?\s+been\s+deleted.*$/i, "");
    return cleaned.trim();
  }

  // ✅ CHECK: If response contains a table or task details, don't extract action
  if (
    response.includes("| Task Title |") ||
    (response.includes("Task Title") && response.includes("Priority"))
  ) {
    console.log("📋 Response already contains table, no action needed");
    return null;
  }

  // ✅ Check for LIST_TASKS - but verify it's not a false positive
  if (response.includes("ACTION: LIST_TASKS")) {
    // Make sure the AI isn't hallucinating LIST_TASKS when it has the data
    const match = response.match(/ACTION: LIST_TASKS(?:\|(.+))?/);
    console.log("⚠️ AI wants to use LIST_TASKS");
    return {
      type: "LIST_TASKS",
      filter: match?.[1] || "all",
    };
  }

  // Check for UPDATE_TASK action (MUST BE FIRST to avoid being caught by CREATE patterns)
  if (response.includes("ACTION: LIST_TASKS")) {
    const match = response.match(/ACTION: LIST_TASKS(?:\|(.+))?/);
    console.log("Listingtasks");
    return {
      type: "LIST_TASKS",
      filter: match?.[1] || null,
    };
  }
  // Check for LIST_NOTES action
  if (response.includes("ACTION: LIST_NOTES")) {
    const match = response.match(/ACTION: LIST_NOTES(?:\|(.+))?/);
    return {
      type: "LIST_NOTES",
      filter: match?.[1] || null,
    };
  }

  // Check for LIST_REMINDERS action
  if (response.includes("ACTION: LIST_REMINDERS")) {
    const match = response.match(/ACTION: LIST_REMINDERS(?:\|(.+))?/);
    return {
      type: "LIST_REMINDERS",
      filter: match?.[1] || null,
    };
  }
  if (response.includes("ACTION: UPDATE_TASK")) {
    const match = response.match(
      /ACTION: UPDATE_TASK\|([^|]+)\|([^|]+)\|(.+?)(?:\n|$)/,
    );
    if (match) {
      return {
        type: "UPDATE_TASK",
        searchQuery: match[1].trim(),
        field: match[2].trim(),
        newValue: match[3].trim(),
      };
    }
  }
  if (response.includes("ACTION: UPDATE_REMINDER")) {
    const match = response.match(
      /ACTION: UPDATE_REMINDER\|([^|]+)\|([^|]+)\|(.+?)(?:\n|$)/,
    );
    if (match) {
      return {
        type: "UPDATE_REMINDER",
        searchQuery: match[1].trim(),
        field: match[2].trim(),
        newValue: match[3].trim(),
      };
    }
  }
  if (response.includes("ACTION: UPDATE_NOTE")) {
    const match = response.match(
      /ACTION: UPDATE_NOTE\|([^|]+)\|([^|]+)\|(.+?)(?:\n|$)/,
    );
    if (match) {
      return {
        type: "UPDATE_NOTE",
        searchQuery: match[1].trim(),
        field: match[2].trim(),
        newValue: match[3].trim(),
      };
    }
  }
  // Check for DELETE_REMINDER action
  if (response.includes("ACTION: DELETE_REMINDER")) {
    const match = response.match(/ACTION: DELETE_REMINDER\|([^|]+)/);
    if (match) {
      return {
        type: "DELETE_REMINDER",
        searchQuery: cleanSearchQuery(match[1]),
      };
    }
  }

  // Check for DELETE_NOTE action
  if (response.includes("ACTION: DELETE_NOTE")) {
    const match = response.match(/ACTION: DELETE_NOTE\|([^|]+)/);
    if (match) {
      return {
        type: "DELETE_NOTE",
        searchQuery: cleanSearchQuery(match[1]),
      };
    }
  }
  // Check for DELETE_TASK action
  // Check for DELETE_TASK action
  if (response.includes("ACTION: DELETE_TASK")) {
    const match = response.match(/ACTION: DELETE_TASK\|([^|\n]+)/);
    if (match) {
      return {
        type: "DELETE_TASK",
        searchQuery: cleanSearchQuery(match[1]),
      };
    }
  }

  // Check for CREATE_TASK action
  // In groqService.js - update the CREATE_TASK case

  // Check for CREATE_TASK action
  if (response.includes("ACTION: CREATE_TASK")) {
    // Try to match with 3 parameters (title, priority, dueDate)
    let match = response.match(
      /ACTION: CREATE_TASK\|([^|]+)\|([^|]+)\|([^|]+)/,
    );
    if (match) {
      return {
        type: "CREATE_TASK",
        title: match[1].trim(),
        priority: match[2].trim().toLowerCase(),
        dueDate: match[3].trim(),
      };
    }

    // Try with 2 parameters (title, priority)
    match = response.match(/ACTION: CREATE_TASK\|([^|]+)\|([^|]+)/);
    if (match) {
      return {
        type: "CREATE_TASK",
        title: match[1].trim(),
        priority: match[2].trim().toLowerCase(),
        dueDate: null,
      };
    }

    // Try with just title (default priority)
    match = response.match(/ACTION: CREATE_TASK\|([^|]+)/);
    if (match) {
      return {
        type: "CREATE_TASK",
        title: match[1].trim(),
        priority: "medium",
        dueDate: null,
      };
    }
    console.log(
      `📌 Current last mentioned task: "${getLastMentionedTask()}" (ID: ${getLastMentionedTaskId()})`,
    );
  }

  // Check for CREATE_NOTE action
  if (response.includes("ACTION: CREATE_NOTE")) {
    const match = response.match(/ACTION: CREATE_NOTE\|([^|]+)\|([^|]+)/);
    if (match) {
      return {
        type: "CREATE_NOTE",
        title: match[1].trim(),
        content: match[2].trim(),
      };
    }
  }

  // Check for CREATE_REMINDER action
  if (response.includes("ACTION: CREATE_REMINDER")) {
    const match = response.match(/ACTION: CREATE_REMINDER\|([^|]+)\|([^|]+)/);
    if (match) {
      return {
        type: "CREATE_REMINDER",
        title: match[1].trim(),
        remindAt: match[2].trim(),
      };
    }
  }

  return null;
}
// Function to clear conversation history
function clearConversation(sessionId) {
  conversationHistory.delete(sessionId);
}

module.exports = {
  getAIResponse,
  clearConversation,
  extractAction,
};
