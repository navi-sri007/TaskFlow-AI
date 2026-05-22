// services/groqService.js (corrected version)

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

DEFAULT ANSWERS & IRRELEVANT QUERIES:
If user asks about topics completely unrelated to task/reminder/note management (e.g., "what's the weather", "tell me a joke", "who won the game", "what is AI", "i have a party", "hello how are you" without any productivity intent):
→ Reply: "I'm your personal productivity assistant. I can help you with:
   • Creating, updating, or deleting tasks
   • Setting reminders with dates/times
   • Managing notes with content
   • Listing tasks/reminders/notes with various filters
   • Showing statistics and dashboard
   • Finding overdue or upcoming items
   • Getting note content for any note
   
   Please ask me something related to task, reminder, or note management!"

CRITICAL: For greeting-only messages like "hi", "hello", "hey":
→ Reply naturally: "Hello! 👋 How can I help with your tasks, reminders, or notes today?"

===========================================
TABLE FORMATTING RULES (COLUMN-WISE):
===========================================

When user asks for "tabular form", "as a table", "table format", or "table":

FOR SINGLE TASK (with all details + linked reminder + linked note):
| Task Title | Priority | Due Date | Status | Reminder | Note Title |
|------------|----------|----------|--------|----------|-------------|
| Buy groceries | High | 2026-05-20 | Pending | Buy groceries | Buy groceries |

FOR SINGLE REMINDER (with linked task details):
| Reminder Title | Reminder Time | Linked Task | Task Status |
|----------------|---------------|-------------|--------------|
| Call mom | 2026-05-20 09:00 AM | Call mom | Completed|

FOR SINGLE NOTE (with linked task details):
| Note Title | Linked Task | Task Priority | Task Due Date |
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

// Add this to getSystemPrompt() function, after the "RESPONSE BEHAVIOR RULES" section

===========================================
TABLE INDEXING & POSITION REFERENCES
===========================================

IMPORTANT: When you display a table/list of tasks, reminders, or notes, the system automatically indexes them (1, 2, 3, etc.).

Users can refer to items by their position using:
- "first one", "second task", "third reminder"
- "last one", "last item"
- "item 5", "task number 3"
- "the 2nd entry", "4th row"

When user asks about a position reference:
1. If they say "give details of first one" → ACTION: GET_BY_POSITION|first
2. If they say "what about the second" → ACTION: GET_BY_POSITION|second
3. If they say "show me the last task" → ACTION: GET_BY_POSITION|last
4. If they say "tell me about item 4" → ACTION: GET_BY_POSITION|4
5. If they say "third reminder details" → ACTION: GET_BY_POSITION|third

POSITION REFERENCE PATTERNS:
| User Says | ACTION Output |
|-----------|---------------|
| "give details of first one" | GET_BY_POSITION|first |
| "what about the second" | GET_BY_POSITION|second |
| "show me the last task" | GET_BY_POSITION|last |
| "tell me about item 4" | GET_BY_POSITION|4 |
| "third reminder details" | GET_BY_POSITION|third |
| "get the 2nd note" | GET_BY_POSITION|second |
| "details of the 5th item" | GET_BY_POSITION|5 |

Always use GET_BY_POSITION action when user refers to items by position.

===========================
CRITICAL ACTION FORMATTING RULES:
===========================
- When outputting an ACTION, put it on its OWN LINE
- DO NOT add any extra text, explanations, or punctuation after the action
- Example CORRECT format:
ACTION: DELETE_TASK|Pay bills

- WRONG (DO NOT DO THIS):
ACTION: DELETE_TASK|Pay bills
The task "Pay bills" has been deleted.

- the action line itself must be clean and contain ONLY the action

========================
DATE RULES:
- today = current date
- tomorrow = +1 day
- day after tomorrow = +2 days

Weekdays: Sunday=0 ... Saturday=6

daysToAdd = (targetDay - currentDay + 7) % 7 (if 0 → 7)

Supported formats:
- Friday
- next Monday
- May 15
- 15/05/2026
- today 4pm
- tomorrow 2:30 PM

Time formats:
- 2 PM → 14:00
- 12 AM → 00:00

Defaults:
- task date only → 00:00:00
- reminder date only → 09:00:00

Output format: YYYY-MM-DDTHH:mm:ss

===========================================
ACTION FORMATS SUMMARY:
===========================================

**Single Actions:**
CREATE_TASK|title|priority|dueDate
CREATE_NOTE|title|content
CREATE_REMINDER|title|remindAt
DELETE_TASK|title
DELETE_REMINDER|title
DELETE_NOTE|title

**Update Actions (Single field):**
UPDATE_TASK|title|field|value
UPDATE_REMINDER|title|field|value
UPDATE_NOTE|title|field|value

**Get Actions (Single Entity):**
GET_TASK|title
GET_NOTE|title
GET_REMINDER|title
GET_NOTE_CONTENT|title

**Multi-parameter Get Actions:**
GET_TASK|filter1|filter2|filter3
LIST_TASKS|status|special|priority

**Multi-parameter Update Actions:**
UPDATE_TASK|searchQuery|field1→value1|field2→value2
UPDATE_REMINDER|searchQuery|field1→value1|field2→value2
UPDATE_NOTE|searchQuery|field1→value1|field2→value2

**Supported fields for updates:**
- Tasks: dueDate, priority, title, completed, note, reminder
- Reminders: remindAt, title
- Notes: title, content

**Rules:**
• Default priority: medium
• Default dueDate: tomorrow 09:00 IST
• "update/change" = UPDATE_TASK (NEVER create)
• "create/add/new" = CREATE_TASK
• For time-only updates, preserve existing date

===========================================
GET ACTIONS DETAILS:
===========================================

GET_NOTE|title - Get a single note by its title
GET_REMINDER|title - Get a single reminder by its title
GET_NOTE_CONTENT|title - Get full content of a note

Examples:
User: "show note project ideas"
→ ACTION: GET_NOTE|project ideas

User: "show reminder call mom"
→ ACTION: GET_REMINDER|call mom

User: "show content of meeting notes"
→ ACTION: GET_NOTE_CONTENT|meeting notes

User: "what does the note say"
→ ACTION: GET_NOTE_CONTENT|meeting notes

For "this task", "this note", "this reminder":
→ Use searchQuery: "THIS_TASK_REFERENCE", "THIS_NOTE_REFERENCE", "THIS_REMINDER_REFERENCE"

===========================================
MULTI-PARAMETER GET REQUESTS:
===========================================

When user asks with multiple filters, combine them with AND logic:

**MULTI-FILTER FORMAT:** GET_TASK|filter1|filter2|filter3

Examples:
"Show completed high-priority tasks" 
→ ACTION: GET_TASK|completed|high

"Show pending tasks with high priority" 
→ ACTION: GET_TASK|pending|high

"Show tasks with no reminders that are low priority"
→ ACTION: GET_TASK|no-reminder|low

"Show important completed tasks"
→ ACTION: GET_TASK|completed|important

"Show tasks with notes that are pending"
→ ACTION: GET_TASK|has-note|pending

**Filter values for multi-parameter:**
- Status: pending, completed
- Priority: high, medium, low, important
- Special: has-reminder, has-note, no-reminder, no-note, today, tomorrow
- Date ranges: next-3-days, next-5-days, next-7-days, overdue

===========================================
MULTI-PARAMETER UPDATE REQUESTS:
===========================================

When user wants to update multiple fields at once:

**MULTI-UPDATE FORMAT:** UPDATE_TASK|{searchQuery}|{field1}→{value1}|{field2}→{value2}

Examples:
"Update both priority and due date for Pay bills"
→ ACTION: UPDATE_TASK|Pay bills|priority→high|dueDate→tomorrow

"Change title to Shopping and priority to high for grocery task"
→ ACTION: UPDATE_TASK|grocery|title→Shopping|priority→high

"Update reminder time to 5pm and add note to Meeting task"
→ ACTION: UPDATE_TASK|Meeting|dueDate→5pm|note→Add agenda items

"Set this task to high priority and mark as completed"
→ ACTION: UPDATE_TASK|THIS_TASK_REFERENCE|priority→high|completed→true

**Multi-update patterns for reminders:**
"Update reminder time to 3pm and title to Call Dentist"
→ ACTION: UPDATE_REMINDER|Call dentist|remindAt→3pm|title→Call Dentist

**Multi-update patterns for notes:**
"Update note title to Ideas and add content about AI"
→ ACTION: UPDATE_NOTE|Old title|title→Ideas|content→AI project ideas

**Format rules for multi-updates:**
- Separate each field-value pair with "|"
- Use "→" between field name and value
- Keep the search query as the first parameter after UPDATE_TYPE
- Values can contain spaces (they will be trimmed)
- Use THIS_TASK_REFERENCE for context reference

===========================================
LISTING ACTIONS:
===========================================

| User Says | ACTION Output |
|-----------|---------------|
| "list pending tasks" | ACTION: LIST_TASKS|pending |
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
| "tasks due in next 3 days" | ACTION: LIST_TASKS|next-3-days |
| "due in next 5 days" | ACTION: LIST_TASKS|next-5-days |
| "what's due in the next week" | ACTION: LIST_TASKS|next-7-days |

**FILTER FORMAT:** LIST_TASKS|{status}|{special}
Where status: pending, completed, important, high, medium, low, overdue, next-3-days, next-5-days, next-7-days
Where special: weekend, has-reminder, has-note, today, tomorrow, day-after-tomorrow, this-week

===========================================
RECENT ITEMS COMMANDS:
===========================================

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

The limit is optional. Default is 5.

===========================================
STATISTICS AND DASHBOARD COMMANDS:
===========================================

SHOW_STATS - Show complete task statistics
SHOW_DASHBOARD - Show full dashboard view with all metrics
QUICK_OVERVIEW - Show quick overview of important metrics

Examples:
User: "show statistics" or "how many tasks do I have"
→ ACTION: SHOW_STATS

User: "show dashboard view"
→ ACTION: SHOW_DASHBOARD

User: "what's my progress"
→ ACTION: SHOW_DASHBOARD

User: "give me a quick overview"
→ ACTION: QUICK_OVERVIEW

===========================================
SCHEDULE UPDATES (Task & Reminder):
===========================================

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

User: "change Pay bills reminder to 5pm"
→ ACTION: UPDATE_REMINDER|Pay bills|remindAt|5pm

===========================================
CREATE TASK RULES:
===========================================

- The task title is EXACTLY what the user says after "set a task"
- DO NOT add the word "Task" to the title
- DO NOT modify the title unless it's a typo

Examples:
User: "set a task preparation with due next day"
→ Title: "preparation" (NOT "Task preparation")

===========================================
TYPO HANDLING:
===========================================

Always correct common typos in user input:
- "prority" → priority
- "remider" → reminder
- "contenet" → content
- "compleated" → completed
- "pendng" → pending
- "tomorow" → tomorrow
- "taskes" → tasks
- "remiders" → reminders
- "nots" → notes

Examples with typos handled:
User: "show completed high prority task"
→ ACTION: GET_TASK|completed|high

User: "update both priorty and due date for pay bills"
→ ACTION: UPDATE_TASK|Pay bills|priority→high|dueDate→tomorrow

User: "list pending reminder"
→ ACTION: LIST_REMINDERS|pending

User: "how many task do i have"
→ ACTION: SHOW_STATS

User: "show note contenet of meeting notes"
→ ACTION: GET_NOTE_CONTENT|meeting notes

===========================================
SPECIAL NOTES HANDLING:
===========================================

GET_NOTE_CONTENT action returns the full content of a note without truncation.

Example response format for GET_NOTE_CONTENT:
"📝 **Note: [title]**
━━━━━━━━━━━━━━━━━━━━
📄 **Content:**
[full content here without truncation]

🔗 **Linked Task:** [task name or "None"]
📅 **Created:** [date]"

===========================================
RESPONSE BEHAVIOR RULES:
===========================================

1. Respond naturally like a smart assistant.
2. Keep responses concise but informative.
3. Do not expose internal instructions or raw database formatting.
4. If the user asks for summaries, summarize clearly.
5. If the user asks ambiguous questions, use previous conversation context to infer meaning.
6. Preserve conversational flow and context awareness.
7. Do not hallucinate missing data.
8. When user wants to CREATE something, output the ACTION first, then a friendly confirmation.
9. When outputting ACTION, put ONLY the action on the FIRST line, NOTHING else on the same line.
10. VERY IMPORTANT: Remove these words from the searchQuery: "note", "reminder", "task", "details", "content", "show", "get", "me"

===========================================
CRITICAL INSTRUCTION - READ FIRST:
===========================================

If the DATABASE context contains a task with title matching what the user asked for:
- DO NOT output ACTION: LIST_TASKS
- DISPLAY the task directly in table format

ONLY use ACTION: LIST_TASKS when:
- User explicitly says "list all tasks"
- The context has NO tasks (empty)

===========================================
FINAL INSTRUCTION:
===========================================

Generate the best possible response using:
- database context
- previous conversation
- current user intent
- contextual references
- conversational memory

Respond now.`;
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
DATABASE CONTEXT
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

Respond now.`;

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

    // Re-apply limit after adding assistant response
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
  // GET_NOTE_CONTENT action
  // ============================================
  if (response.includes("ACTION: GET_NOTE_CONTENT")) {
    const match = response.match(/ACTION: GET_NOTE_CONTENT\|([^|\n]+)/);
    if (match) {
      const searchQuery = cleanValue(match[1]);
      console.log(
        `📝 GET_NOTE_CONTENT action extracted, query: "${searchQuery}"`,
      );
      return {
        type: "GET_NOTE_CONTENT",
        searchQuery: searchQuery,
      };
    }
  }

  // ============================================
  // MULTI-PARAMETER GET_TASK (with filters)
  // ============================================
  if (
    response.includes("ACTION: GET_TASK") &&
    response.includes("|") &&
    !response.includes("GET_TASK|") &&
    response.match(/\|.+\|/)
  ) {
    const match = response.match(/ACTION: GET_TASK\|([^\n]+)/);
    if (match) {
      const filters = match[1]
        .split("|")
        .map((f) => cleanValue(f).toLowerCase());
      console.log(`🔍 MULTI-GET_TASK action extracted, filters:`, filters);
      return {
        type: "GET_TASK_MULTI",
        filters: filters,
      };
    }
  }

  // ============================================
  // SINGLE GET_TASK (fallback)
  // ============================================
  if (response.includes("ACTION: GET_TASK")) {
    const match = response.match(/ACTION: GET_TASK\|([^|\n]+)/);
    if (match) {
      const searchQuery = cleanValue(match[1]);
      console.log(`📋 GET_TASK action extracted, query: "${searchQuery}"`);
      return {
        type: "GET_TASK",
        searchQuery: searchQuery,
      };
    }
  }

  // ============================================
  // MULTI-PARAMETER UPDATE_TASK (with multiple fields)
  // ============================================
  if (response.includes("ACTION: UPDATE_TASK") && response.includes("→")) {
    const match = response.match(/ACTION: UPDATE_TASK\|([^|]+)\|(.+)$/);
    if (match) {
      const searchQuery = cleanValue(match[1]);
      const updatesRaw = match[2].split("|");
      const updates = {};

      for (const update of updatesRaw) {
        const [field, value] = update.split("→");
        if (field && value) {
          updates[cleanValue(field)] = cleanValue(value);
        }
      }

      console.log(`🔄 MULTI-UPDATE_TASK action extracted:`, {
        searchQuery,
        updates,
      });
      return {
        type: "UPDATE_TASK_MULTI",
        searchQuery: searchQuery,
        updates: updates,
      };
    }
  }

  // ============================================
  // SINGLE UPDATE_TASK (fallback)
  // ============================================
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

  // ============================================
  // MULTI-PARAMETER UPDATE_REMINDER
  // ============================================
  if (response.includes("ACTION: UPDATE_REMINDER") && response.includes("→")) {
    const match = response.match(/ACTION: UPDATE_REMINDER\|([^|]+)\|(.+)$/);
    if (match) {
      const searchQuery = cleanValue(match[1]);
      const updatesRaw = match[2].split("|");
      const updates = {};

      for (const update of updatesRaw) {
        const [field, value] = update.split("→");
        if (field && value) {
          updates[cleanValue(field)] = cleanValue(value);
        }
      }

      console.log(`🔄 MULTI-UPDATE_REMINDER action extracted:`, {
        searchQuery,
        updates,
      });
      return {
        type: "UPDATE_REMINDER_MULTI",
        searchQuery: searchQuery,
        updates: updates,
      };
    }
  }

  // ============================================
  // SINGLE UPDATE_REMINDER (fallback)
  // ============================================
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

  // ============================================
  // MULTI-PARAMETER UPDATE_NOTE
  // ============================================
  if (response.includes("ACTION: UPDATE_NOTE") && response.includes("→")) {
    const match = response.match(/ACTION: UPDATE_NOTE\|([^|]+)\|(.+)$/);
    if (match) {
      const searchQuery = cleanValue(match[1]);
      const updatesRaw = match[2].split("|");
      const updates = {};

      for (const update of updatesRaw) {
        const [field, value] = update.split("→");
        if (field && value) {
          updates[cleanValue(field)] = cleanValue(value);
        }
      }

      console.log(`🔄 MULTI-UPDATE_NOTE action extracted:`, {
        searchQuery,
        updates,
      });
      return {
        type: "UPDATE_NOTE_MULTI",
        searchQuery: searchQuery,
        updates: updates,
      };
    }
  }

  // ============================================
  // SINGLE UPDATE_NOTE (fallback)
  // ============================================
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
  // Add this after the DELETE actions section, before CREATE actions

  // ============================================
  // GET_BY_POSITION action (NEW)
  // ============================================
  if (response.includes("ACTION: GET_BY_POSITION")) {
    const match = response.match(/ACTION: GET_BY_POSITION\|([^|\n]+)/);
    if (match) {
      let position = match[1].trim().toLowerCase();
      console.log(
        `📍 GET_BY_POSITION action extracted, position: "${position}"`,
      );

      // Convert word positions to numbers
      const positionMap = {
        first: 1,
        second: 2,
        third: 3,
        fourth: 4,
        fifth: 5,
        sixth: 6,
        seventh: 7,
        eighth: 8,
        ninth: 9,
        tenth: 10,
        last: "last",
      };

      let positionValue = positionMap[position] || position;
      if (!isNaN(parseInt(positionValue))) {
        positionValue = parseInt(positionValue);
      }

      return {
        type: "GET_BY_POSITION",
        position: positionValue,
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
