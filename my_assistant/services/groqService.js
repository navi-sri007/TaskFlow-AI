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

DEFAULT ANSWERS:
If its a greeting , greet accordingly.
If the user asks irrelevant questions or single words , without **mentioning creation,updation,deletion or list **. Or if they are talking about something very irrelevant like "i have a party " , then reply with default answer , "Please ask about the relevant task,reminder and notes , only then i can hepl you".
If they say something like information , then answer with a confirmation , whether to set a task , note or reminder.
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
| Note Title  | Linked Task | Task Priority | Task Due Date |
|------------|-------------|---------------|---------------|
| Meeting notes | Client meeting | High | 2026-05-22 |

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

STRICT RULES:
- NOTES are separate from TASKS, even if they share the same title
- REMINDERS are separate from TASKS, even if they share the same title
- When user asks for a NOTE, look in the NOTES section ONLY
- When user asks for a REMINDER, look in the REMINDERS section ONLY
- When user asks for a TASK, look in the TASKS section ONLY

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
**- day after tomorrow = +2 days*****

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

**GET ACTIONS (Single Entity):**

GET_NOTE|title - Get a single note by its title
GET_REMINDER|title - Get a single reminder by its title

Examples:
User: "show note project ideas"
→ ACTION: GET_NOTE|project ideas

User: "show reminder call mom"
→ ACTION: GET_REMINDER|call mom

User: "what is the note for meeting"
→ ACTION: GET_NOTE|meeting

User: "display reminder dentist"
→ ACTION: GET_REMINDER|dentist

Actions:
- GET_TASK: When user asks about a task (e.g., "show me task X", "get task details", "what is this task")
- GET_NOTE: When user asks about a note (e.g., "show me note X", "get note content")
- GET_REMINDER: When user asks about a reminder (e.g., "show me reminder X", "when is reminder X")

For "this task", "this note", "this reminder" → Use searchQuery: "THIS_TASK_REFERENCE", "THIS_NOTE_REFERENCE", "THIS_REMINDER_REFERENCE"

These actions return the entity with all linked information.


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

When user says "update the reminder [named] ...":
- ALWAYS use UPDATE_REMINDER, NOT UPDATE_TASK

**SCHEDULE UPDATES (task name, reminder name, or THIS_TASK_REFERENCE):**
The server keeps **date** when only **time** is given, and keeps **time** when only **date** is given.

| User gives | What to put in value | Effect |
|------------|----------------------|--------|
| Time only: 3pm, 5:30 pm | 3pm | Same calendar date, new time |
| Date only: tomorrow, Friday, May 20 | tomorrow (no time in string) | Same time, new date |
| Both: tomorrow 3pm | tomorrow 3pm | Updates date and time |

Use the **exact task or reminder title** when the user names one. Use **THIS_TASK_REFERENCE** only for "this task" / "the task" / "same task".

**Task due date** (updates linked reminder automatically):
→ ACTION: UPDATE_TASK|{title or THIS_TASK_REFERENCE}|dueDate|{value}

**Reminder time** (updates linked task due date automatically):
→ ACTION: UPDATE_REMINDER|{title or THIS_TASK_REFERENCE}|remindAt|{value}

Examples:
User: "set reminder for this task to 3pm"
→ ACTION: UPDATE_TASK|THIS_TASK_REFERENCE|dueDate|3pm

User: "set reminder for Pay bills to 3pm"
→ ACTION: UPDATE_TASK|Pay bills|dueDate|3pm

User: "change Pay bills reminder to 5pm"
→ ACTION: UPDATE_REMINDER|Pay bills|remindAt|5pm

User: "move Pay bills to tomorrow" (no time mentioned)
→ ACTION: UPDATE_TASK|Pay bills|dueDate|tomorrow

User: "change due time of Pay bills to 2pm"
→ ACTION: UPDATE_TASK|Pay bills|dueDate|2pm

Never use the literal phrase "this task" as a database title — use THIS_TASK_REFERENCE.

When user says "update the reminder parents to 2pm":
→ ACTION: UPDATE_REMINDER|parents|remindAt|2pm


=================
LISTING ACTIONS:
=================
Examples:
User: "list pending tasks" 
→ ACTION: LIST_TASKS|pending
→ I'll show you the pending tasks.

USE LIST action.
| User Says | ACTION Output |
|-----------|---------------|
| "what's pending for this weekend" | ACTION: LIST_TASKS|pending|weekend |
| "list pending tasks with reminders" | ACTION: LIST_TASKS|pending|has-reminder |
| "show me what's important" | ACTION: LIST_TASKS|important |
| "what's overdue" | ACTION: LIST_TASKS|overdue |
| "show tasks due today" | ACTION: LIST_TASKS|today |
| "tasks for tomorrow" | ACTION: LIST_TASKS|tomorrow |
| "day after tomorrow tasks" | ACTION: LIST_TASKS|day-after-tomorrow |
| "high priority tasks" | ACTION: LIST_TASKS|high |
| "tasks due this week" | ACTION: LIST_TASKS|this-week |
| "completed tasks" | ACTION: LIST_TASKS|completed |

**FILTER FORMAT:** LIST_TASKS|{status}|{special}

Where:
- status: pending, completed, important, high, medium, low, overdue
- special: weekend, has-reminder, has-note, today, tomorrow, day-after-tomorrow, this-week

**Examples:**
- "what's pending for this weekend" →ACTION: LIST_TASKS|pending|weekend
- "list pending tasks with reminders" → ACTION: LIST_TASKS|pending|has-reminder
- "show me what's important" → ACTION: LIST_TASKS|important
- "what's overdue" → ACTION: LIST_TASKS|overdue

***When outputting ACTION, you MUST:****
1. Put ONLY the action on the FIRST line
2. NOTHING else on the same line as ACTION
3. NEVER add explanations, confirmations, or punctuation on the same line as ACTION LIKE "day-after-tomorrow
I'll show you the tasks for the day after tomorrow."
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
// Add to system prompt

**RECENT ITEMS COMMANDS:**

RECENT_TASKS|limit - Show recently created tasks
RECENT_REMINDERS|limit - Show recently created reminders  
RECENT_NOTES|limit - Show recently created notes
RECENT_ALL|limit - Show all recently created items

Examples:
User: "show recently set tasks"
→ ACTION: RECENT_TASKS|5

User: "what reminders did I recently create"
→ ACTION: RECENT_REMINDERS|5

User: "show me recent notes"
→ ACTION: RECENT_NOTES|5

User: "show everything I recently created"
→ ACTION: RECENT_ALL|5

The limit is optional. Default is 5.

**CREATE TASK RESPONSE FORMAT (EXACT):**
DONT GIVE ANY RESPONSE OTHER THAN ACTION : CREAT_TASK
NEVER REPLY ANYTHING 

**CRITICAL - TASK TITLE RULES:**
- The task title is EXACTLY what the user says after "set a task"
- DO NOT add the word "Task" to the title
- DO NOT modify the title unless it's a typo

Examples:
User: "set a task preparation with due next day"
→ Title: "preparation" (NOT "Task preparation")

// Add to system prompt

**STATISTICS AND DASHBOARD COMMANDS:**

SHOW_STATS - Show complete task statistics
SHOW_DASHBOARD - Show full dashboard view with all metrics
QUICK_OVERVIEW - Show quick overview of important metrics

Examples:
User: "show statistics"
→ ACTION: SHOW_STATS

User: "show dashboard view"
→ ACTION: SHOW_DASHBOARD

User: "what's my progress"
→ ACTION: SHOW_DASHBOARD

User: "give me a quick overview"
→ ACTION: QUICK_OVERVIEW

User: "show me summary"
→ ACTION: SHOW_DASHBOARD

VERY IMPORTANT: Remove these words from the searchQuery: "note", "reminder", "task", "details", "content", "show", "get", "me"

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
  const { normalizeSearchQuery } = require("./entityExtractor");

  function cleanSearchQuery(query) {
    return normalizeSearchQuery(query);
  }

  // Helper function to clean values from AI responses
  function cleanValue(value) {
    if (!value) return null;
    // Remove anything after newline
    let cleaned = value.split("\n")[0];
    // Remove any conversational text patterns
    cleaned = cleaned.replace(/\s+I'll\s+show\s+you.*$/i, "");
    cleaned = cleaned.replace(/\s+I've\s+created.*$/i, "");
    cleaned = cleaned.replace(/\s+Here\s+are.*$/i, "");
    cleaned = cleaned.replace(/\s+Let\s+me\s+.*$/i, "");
    cleaned = cleaned.replace(/\s+Found.*$/i, "");
    cleaned = cleaned.replace(/\s+Displaying.*$/i, "");
    cleaned = cleaned.replace(/\s+Showing.*$/i, "");
    cleaned = cleaned.replace(/\s+There\s+are.*$/i, "");
    cleaned = cleaned.replace(/\s+These\s+are.*$/i, "");
    // Remove trailing spaces and punctuation
    cleaned = cleaned.trim();
    cleaned = cleaned.replace(/[.!?]+$/, "");
    return cleaned;
  }
  // ============================================
  // STATISTICS AND DASHBOARD ACTIONS
  // ============================================

  // SHOW_STATS action
  if (response.includes("ACTION: SHOW_STATS")) {
    console.log("📊 SHOW_STATS action extracted");
    return {
      type: "SHOW_STATS",
    };
  }

  // SHOW_DASHBOARD action
  if (response.includes("ACTION: SHOW_DASHBOARD")) {
    console.log("📊 SHOW_DASHBOARD action extracted");
    return {
      type: "SHOW_DASHBOARD",
    };
  }

  // QUICK_OVERVIEW action
  if (response.includes("ACTION: QUICK_OVERVIEW")) {
    console.log("📋 QUICK_OVERVIEW action extracted");
    return {
      type: "QUICK_OVERVIEW",
    };
  }
  // ============================================
  // LIST ACTIONS
  // ============================================

  // LIST_TASKS action
  if (response.includes("ACTION: LIST_TASKS")) {
    const match = response.match(
      /ACTION: LIST_TASKS(?:\|([^|]+))?(?:\|([^|]+))?/,
    );
    console.log("📋 LIST_TASKS action extracted");

    const status = match?.[1] ? cleanValue(match[1]) : "all";
    const special = match?.[2] ? cleanValue(match[2]) : null;

    console.log(`   Status: "${status}", Special: "${special}"`);

    return {
      type: "LIST_TASKS",
      status: status,
      special: special,
      filter: status,
    };
  }

  // LIST_NOTES action
  if (response.includes("ACTION: LIST_NOTES")) {
    const match = response.match(/ACTION: LIST_NOTES(?:\|([^|]+))?/);
    const filter = match?.[1] ? cleanValue(match[1]) : null;
    console.log(`📝 LIST_NOTES action extracted, filter: "${filter}"`);
    return {
      type: "LIST_NOTES",
      filter: filter,
    };
  }

  // LIST_REMINDERS action
  if (response.includes("ACTION: LIST_REMINDERS")) {
    const match = response.match(/ACTION: LIST_REMINDERS(?:\|([^|]+))?/);
    const filter = match?.[1] ? cleanValue(match[1]) : null;
    console.log(`⏰ LIST_REMINDERS action extracted, filter: "${filter}"`);
    return {
      type: "LIST_REMINDERS",
      filter: filter,
    };
  }

  // ============================================
  // GET ACTIONS (Single Entity)
  // ============================================

  // GET_NOTE action
  if (response.includes("ACTION: GET_NOTE")) {
    const match = response.match(/ACTION: GET_NOTE\|([^|\n]+)/);
    if (match) {
      const searchQuery = cleanValue(match[1]);
      console.log(`📝 GET_NOTE action extracted, query: "${searchQuery}"`);
      return {
        type: "GET_NOTE",
        searchQuery: searchQuery,
      };
    }
  }

  // GET_REMINDER action
  if (response.includes("ACTION: GET_REMINDER")) {
    const match = response.match(/ACTION: GET_REMINDER\|([^|\n]+)/);
    if (match) {
      const searchQuery = cleanValue(match[1]);
      console.log(`⏰ GET_REMINDER action extracted, query: "${searchQuery}"`);
      return {
        type: "GET_REMINDER",
        searchQuery: searchQuery,
      };
    }
  }

  // ============================================
  // RECENT ACTIONS
  // ============================================

  // RECENT_TASKS action
  if (response.includes("ACTION: RECENT_TASKS")) {
    const match = response.match(/ACTION: RECENT_TASKS(?:\|(\d+))?/);
    const limit = match?.[1] ? parseInt(match[1]) : 5;
    console.log(`📋 RECENT_TASKS action extracted, limit: ${limit}`);
    return {
      type: "RECENT_TASKS",
      limit: limit,
    };
  }

  // RECENT_REMINDERS action
  if (response.includes("ACTION: RECENT_REMINDERS")) {
    const match = response.match(/ACTION: RECENT_REMINDERS(?:\|(\d+))?/);
    const limit = match?.[1] ? parseInt(match[1]) : 5;
    console.log(`⏰ RECENT_REMINDERS action extracted, limit: ${limit}`);
    return {
      type: "RECENT_REMINDERS",
      limit: limit,
    };
  }

  // RECENT_NOTES action
  if (response.includes("ACTION: RECENT_NOTES")) {
    const match = response.match(/ACTION: RECENT_NOTES(?:\|(\d+))?/);
    const limit = match?.[1] ? parseInt(match[1]) : 5;
    console.log(`📝 RECENT_NOTES action extracted, limit: ${limit}`);
    return {
      type: "RECENT_NOTES",
      limit: limit,
    };
  }

  // RECENT_ALL action
  if (response.includes("ACTION: RECENT_ALL")) {
    const match = response.match(/ACTION: RECENT_ALL(?:\|(\d+))?/);
    const limit = match?.[1] ? parseInt(match[1]) : 5;
    console.log(`📋 RECENT_ALL action extracted, limit: ${limit}`);
    return {
      type: "RECENT_ALL",
      limit: limit,
    };
  }

  // ============================================
  // UPDATE ACTIONS
  // ============================================

  // UPDATE_TASK action
  if (response.includes("ACTION: UPDATE_TASK")) {
    const match = response.match(
      /ACTION: UPDATE_TASK\|([^|]+)\|([^|]+)\|(.+?)(?:\n|$)/,
    );
    if (match) {
      return {
        type: "UPDATE_TASK",
        searchQuery: cleanSearchQuery(match[1].trim()),
        field: match[2].trim(),
        newValue: match[3].trim(),
      };
    }
  }

  // UPDATE_REMINDER action
  if (response.includes("ACTION: UPDATE_REMINDER")) {
    const match = response.match(
      /ACTION: UPDATE_REMINDER\|([^|]+)\|([^|]+)\|(.+?)(?:\n|$)/,
    );
    if (match) {
      return {
        type: "UPDATE_REMINDER",
        searchQuery: cleanSearchQuery(match[1].trim()),
        field: match[2].trim(),
        newValue: match[3].trim(),
      };
    }
  }

  // UPDATE_NOTE action
  if (response.includes("ACTION: UPDATE_NOTE")) {
    const match = response.match(
      /ACTION: UPDATE_NOTE\|([^|]+)\|([^|]+)\|(.+?)(?:\n|$)/,
    );
    if (match) {
      return {
        type: "UPDATE_NOTE",
        searchQuery: cleanSearchQuery(match[1].trim()),
        field: match[2].trim(),
        newValue: match[3].trim(),
      };
    }
  }

  // ============================================
  // DELETE ACTIONS
  // ============================================

  // DELETE_TASK action
  if (response.includes("ACTION: DELETE_TASK")) {
    const match = response.match(/ACTION: DELETE_TASK\|([^|\n]+)/);
    if (match) {
      return {
        type: "DELETE_TASK",
        searchQuery: cleanSearchQuery(match[1]),
      };
    }
  }

  // DELETE_REMINDER action
  if (response.includes("ACTION: DELETE_REMINDER")) {
    const match = response.match(/ACTION: DELETE_REMINDER\|([^|\n]+)/);
    if (match) {
      return {
        type: "DELETE_REMINDER",
        searchQuery: cleanSearchQuery(match[1]),
      };
    }
  }

  // DELETE_NOTE action
  if (response.includes("ACTION: DELETE_NOTE")) {
    const match = response.match(/ACTION: DELETE_NOTE\|([^|\n]+)/);
    if (match) {
      return {
        type: "DELETE_NOTE",
        searchQuery: cleanSearchQuery(match[1]),
      };
    }
  }

  // ============================================
  // CREATE ACTIONS
  // ============================================

  // CREATE_TASK action
  if (response.includes("ACTION: CREATE_TASK")) {
    // Try with 3 parameters (title, priority, dueDate)
    let match = response.match(
      /ACTION: CREATE_TASK\|([^|]+)\|([^|]+)\|([^|\n]+)/,
    );
    if (match) {
      return {
        type: "CREATE_TASK",
        title: cleanValue(match[1].trim()),
        priority: cleanValue(match[2].trim().toLowerCase()),
        dueDate: cleanValue(match[3].trim()),
      };
    }

    // Try with 2 parameters (title, priority)
    match = response.match(/ACTION: CREATE_TASK\|([^|]+)\|([^|\n]+)/);
    if (match) {
      return {
        type: "CREATE_TASK",
        title: cleanValue(match[1].trim()),
        priority: cleanValue(match[2].trim().toLowerCase()),
        dueDate: null,
      };
    }

    // Try with just title (default priority)
    match = response.match(/ACTION: CREATE_TASK\|([^|\n]+)/);
    if (match) {
      return {
        type: "CREATE_TASK",
        title: cleanValue(match[1].trim()),
        priority: "medium",
        dueDate: null,
      };
    }
  }

  // CREATE_NOTE action
  if (response.includes("ACTION: CREATE_NOTE")) {
    const match = response.match(/ACTION: CREATE_NOTE\|([^|]+)\|([^|\n]+)/);
    if (match) {
      return {
        type: "CREATE_NOTE",
        title: cleanValue(match[1].trim()),
        content: cleanValue(match[2].trim()),
      };
    }
  }

  // CREATE_REMINDER action
  if (response.includes("ACTION: CREATE_REMINDER")) {
    const match = response.match(/ACTION: CREATE_REMINDER\|([^|]+)\|([^|\n]+)/);
    if (match) {
      return {
        type: "CREATE_REMINDER",
        title: cleanValue(match[1].trim()),
        remindAt: cleanValue(match[2].trim()),
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
