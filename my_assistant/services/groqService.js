// services/groqService.js (updated version)

const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Store conversation history per session
const conversationHistory = new Map();

function getSystemPrompt() {
  return `You are a helpful personal assistant that manages tasks, notes, and reminders.

You have access to the user's data through functions. When the user asks about:
- TASKS: You will receive task data (title, dueDate, priority, completed)
- NOTES: You will receive note data (title, content, createdAt)
- REMINDERS: You will receive reminder data (title, remindAt, repeat)

Your job is to:
1. Answer questions about the user's tasks, notes, and reminders
2. Maintain context between questions (e.g., "what about the second one?" refers to previous answer)
3. Help the user manage their data naturally
4. **CREATE new items when the user asks to add something**
5. Always refer the past conversation or the previous conversation if it present, then provide the answer to the present question based on it, if its relevant.

Be conversational, helpful, and concise and don't be rude.

IMPORTANT ACTION RULES:
When the user asks to CREATE something, respond with an action in this exact format:

For TASKS:
ACTION: CREATE_TASK|title|priority|dueDate

For NOTES:
ACTION: CREATE_NOTE|title|content

For REMINDERS:
ACTION: CREATE_REMINDER|title|remindAt

Examples:
- User: "Add a task to buy groceries tomorrow with high priority"
  Response: ACTION: CREATE_TASK|buy groceries|high|tomorrow

- User: "Remind me to call mom on May 15th at 2pm"
  Response: ACTION: CREATE_REMINDER|call mom|2026-05-15T14:00:00

- User: "Take a note: Meeting notes with client about budget"
  Response: ACTION: CREATE_NOTE|Meeting notes|Client meeting about budget

- User: "Create a task to finish the report by Friday"
  Response: ACTION: CREATE_TASK|finish the report|medium|this Friday

Rules for actions:
- Extract priority (low/medium/high/important) from the message
- Parse dates intelligently (today, tomorrow, next Monday, specific dates)
- For notes, the title is a short summary, content is the detailed text
- Only generate one action per response
- After generating action, add a friendly confirmation message
- Do not include explanations before or after the action in separate lines - keep action as the first line`;
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
function extractAction(response) {
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
