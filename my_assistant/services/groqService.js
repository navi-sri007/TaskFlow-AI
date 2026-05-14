// services/groqService.js (updated version)

const Groq = require("groq-sdk");

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
| Buy groceries | High | 2026-05-20 | Pending | Buy groceries reminder | Buy groceries note | 

FOR SINGLE REMINDER (with linked task details):
| Reminder Title | Reminder Time | Linked Task | Task Priority | Task Due Date |
|----------------|---------------|-------------|---------------|---------------|
| Call mom | 2026-05-20 09:00 AM | Call mom | High | 2026-05-25 |

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

===========================================
CRITICAL RULES FOR TABLES:
===========================================
1. When user asks for a TASK → Show Task details + its linked Reminder + its linked Note (all in ONE row)
2. When user asks for a REMINDER → Show Reminder details + its linked Task details (NO extra information)
3. When user asks for a NOTE → Show Note details + its linked Task details (NO extra information)
4. Use column headers as the field names
5. Put values directly below each column
6. NO "Field | Value" pairs - only column-wise tables
===========================================
ACTION FORMATS:
===========================================


CREATE_TASK (only for new tasks):
ACTION: CREATE_TASK|title|priority|dueDate

UPDATE_TASK (for existing tasks):
ACTION: UPDATE_TASK|existing_title|field_to_update|new_value

UPDATE Examples:
- User: "update its duedate to tomorrow" → ACTION: UPDATE_TASK|UPDATE|dueDate|tomorrow
- User: "update its priority as low" → ACTION: UPDATE_TASK|UPDATE|priority|low
- User: "set its duedate to tomorrow" → ACTION: UPDATE_TASK|UPDATE|dueDate|tomorrow
- User: "change priority to high" → ACTION: UPDATE_TASK|task_title|priority|high

Available fields for UPDATE_TASK: dueDate, priority, title, completed

Always output ACTION: on the first line.`;
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

The following records were retrieved from the database based on the user's request.

${contextData}

IMPORTANT RULES:
- Never invent tasks, notes, or reminders that are not present.
- If no matching records exist, clearly tell the user.
- Use only the provided database records while answering.
- Treat database information as the highest priority source of truth.

========================
CONVERSATION MEMORY
========================

Recent conversation history:

${history
  .slice(-8)
  .map((msg, index) => {
    return `${index + 1}. ${msg.role.toUpperCase()}: ${msg.content}`;
  })
  .join("\n")}

MEMORY RULES:
- Maintain continuity between messages.
- Understand follow-up references using previous conversation.
- If the user refers indirectly to something previously discussed,
  infer the correct reference intelligently.
- Give priority to the most recent relevant conversation context.

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
TASK UNDERSTANDING RULES
========================

When interpreting user requests:
- "today" means current date
- "tomorrow" means next day
- "important" refers to priority=important
- "high priority" refers to priority=high

Understand intent variations such as:
- "show"
- "list"
- "tell me"
- "what are"
- "do I have"
- "add"
- "create"
- "make a note"
- "remind me"
- "set a task"

All may refer to retrieving or creating records.

========================
DATE PARSING RULES FOR ACTIONS
========================

Parse natural language dates to ISO format:
- "today" -> current date at 9:00 AM
- "tomorrow" -> next day at 9:00 AM
- "next Monday" -> upcoming Monday at 9:00 AM
- "May 15th" -> May 15, current year at 9:00 AM
- "May 15th at 2pm" -> May 15, current year at 14:00:00
- "Friday" -> upcoming Friday at 9:00 AM

For tasks without specific time, use the date at 00:00:00.

========================
ACTION GENERATION RULES
========================

When user wants to CREATE something, respond with action THEN confirmation.

Format:
ACTION: CREATE_TYPE|field1|field2|field3
Then on new line: "✅ I'll create that for you!"

Rules:
- Do not include explanations before the action.
- Use the exact extracted details from context.
- For tasks: title, priority, dueDate (priority default: medium, dueDate default: tomorrow)
- For notes: title, content
- For reminders: title, remindAt (ISO datetime)
- Only generate actions when the user's intent is clearly requesting creation.

Examples:
User: "Add task to buy milk tomorrow"
ACTION: CREATE_TASK|buy milk|medium|2026-05-12
✅ I'll create that for you!

User: "Take a note: Project idea about AI assistant"
ACTION: CREATE_NOTE|Project idea|AI assistant that can manage tasks naturally
✅ Note saved!

User: "Remind me to water plants at 6pm today"
ACTION: CREATE_REMINDER|water plants|2026-05-11T18:00:00
✅ Reminder set!


When user asks about related items, respond with:

For task queries:
"show me everything related to [task name]"
Response: Here's the complete information for task "[task name]":
- Task: [title] (Priority: X, Due: Y)
- Reminder: [reminder title] at [time]
- Note: [note title] - [preview of content]

For reminder queries:
"what task is this reminder for?"
Response: This reminder "[reminder name]" is for task "[task name]" which has priority [priority].

For note queries:
"show me the task for this note"
Response: This note belongs to task "[task name]" which is due on [date].
========================
FINAL INSTRUCTION
========================

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

    let aiResponse =
      completion.choices[0]?.message?.content ||
      "Sorry, I couldn't process that.";

    // Add AI response to history
    history.push({
      role: "assistant",
      content: aiResponse,
    });

    // Keep only last 10 messages for context
    if (history.length > 10) {
      history = history.slice(-10);
    }
    conversationHistory.set(sessionId, history);

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
  // Check for UPDATE_TASK action (MUST BE FIRST to avoid being caught by CREATE patterns)
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

  // Check for DELETE_TASK action
  if (response.includes("ACTION: DELETE_TASK")) {
    const match = response.match(/ACTION: DELETE_TASK\|([^|]+)/);
    if (match) {
      return {
        type: "DELETE_TASK",
        searchQuery: match[1].trim(),
      };
    }
  }

  // Check for CREATE_TASK action
  if (response.includes("ACTION: CREATE_TASK")) {
    const match = response.match(
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
    // Try without due date
    const matchWithoutDate = response.match(
      /ACTION: CREATE_TASK\|([^|]+)\|([^|]+)/,
    );
    if (matchWithoutDate) {
      return {
        type: "CREATE_TASK",
        title: matchWithoutDate[1].trim(),
        priority: matchWithoutDate[2].trim().toLowerCase(),
        dueDate: null,
      };
    }
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
