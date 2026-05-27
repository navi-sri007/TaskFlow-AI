const UserPattern = require("../models/UserPattern");
const Task = require("../models/Task");

/**
 * Update user patterns after each interaction
 */
async function updateUserPattern(sessionId, action, data) {
  try {
    let pattern = await UserPattern.findOne({ sessionId });
    if (!pattern) {
      pattern = new UserPattern({ sessionId });
    }

    const now = new Date();
    const hour = now.getHours();
    const day = now.toLocaleDateString("en-US", { weekday: "long" });

    switch (action) {
      case "CREATE_TASK":
        pattern.interactions.totalTasksCreated++;
        pattern.taskCreation.averagePerDay =
          pattern.interactions.totalTasksCreated / 7 || 0;

        // Learn preferred priority
        if (data.priority) {
          const priorities = ["important", "high", "medium", "low"];
          const currentIndex = priorities.indexOf(
            pattern.taskCreation.averagePriority,
          );
          const newIndex = priorities.indexOf(data.priority);
          if (newIndex < currentIndex) {
            pattern.taskCreation.averagePriority = data.priority;
          }
        }

        // Learn task keywords
        if (data.title) {
          const words = data.title.toLowerCase().split(" ");
          words.forEach((word) => {
            if (
              word.length > 3 &&
              !pattern.taskCreation.commonKeywords.includes(word)
            ) {
              pattern.taskCreation.commonKeywords.push(word);
            }
          });
          // Keep only last 50 keywords
          if (pattern.taskCreation.commonKeywords.length > 50) {
            pattern.taskCreation.commonKeywords =
              pattern.taskCreation.commonKeywords.slice(-50);
          }
        }

        // Learn active time
        pattern.taskCreation.mostActiveHour = hour;
        pattern.taskCreation.mostActiveDay = day;
        break;

      case "COMPLETE_TASK":
        pattern.interactions.totalTasksCompleted++;

        // Calculate completion time
        if (data.createdAt && data.completedAt) {
          const created = new Date(data.createdAt);
          const completed = new Date(data.completedAt);
          const hoursToComplete = (completed - created) / (1000 * 60 * 60);

          pattern.completion.averageCompletionTime =
            (pattern.completion.averageCompletionTime + hoursToComplete) / 2;
        }

        // Learn completion by priority
        if (
          data.priority &&
          pattern.completion.completionRateByPriority[data.priority] !==
            undefined
        ) {
          pattern.completion.completionRateByPriority[data.priority]++;
        }

        // Learn productive time of day
        const completedHour = new Date(data.completedAt || now).getHours();
        if (completedHour < 12) {
          pattern.timePatterns.morningProductivity++;
        } else if (completedHour < 17) {
          pattern.timePatterns.afternoonProductivity++;
        } else {
          pattern.timePatterns.eveningProductivity++;
        }

        // Learn preferred days
        const completedDay = new Date(
          data.completedAt || now,
        ).toLocaleDateString("en-US", { weekday: "long" });
        if (!pattern.timePatterns.preferredDays.includes(completedDay)) {
          pattern.timePatterns.preferredDays.push(completedDay);
        }
        break;

      case "POSTPONE_TASK":
        // Learn what tasks user postpones
        if (data.title) {
          const keywords = data.title.toLowerCase().split(" ");
          keywords.forEach((word) => {
            if (
              word.length > 3 &&
              !pattern.completion.tasksUsuallyPostponed.includes(word)
            ) {
              pattern.completion.tasksUsuallyPostponed.push(word);
            }
          });
        }
        break;
    }

    pattern.interactions.lastUpdated = now;
    pattern.updatedAt = now;
    await pattern.save();

    console.log(`📊 Updated pattern for session ${sessionId}`);
    return pattern;
  } catch (error) {
    console.error("Error updating user pattern:", error);
    return null;
  }
}

/**
 * Get personalized suggestions based on learned patterns
 */
async function getPersonalizedSuggestions(sessionId) {
  const pattern = await UserPattern.findOne({ sessionId });
  if (!pattern) return null;

  const suggestions = [];

  // Suggest optimal work time
  const bestHour = pattern.taskCreation.mostActiveHour;
  suggestions.push(
    `💡 You're most active around ${bestHour}:00. Schedule important tasks then!`,
  );

  // Suggest priority that user completes best
  const bestPriority =
    pattern.completion.bestPerformingPriority ||
    Object.entries(pattern.completion.completionRateByPriority).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
  if (bestPriority) {
    suggestions.push(
      `✅ You complete ${bestPriority} priority tasks most often. Great job!`,
    );
  }

  // Suggest tasks to avoid postponing
  if (pattern.completion.tasksUsuallyPostponed.length > 0) {
    const topPostponed = pattern.completion.tasksUsuallyPostponed.slice(0, 3);
    suggestions.push(
      `⚠️ You often postpone tasks with: ${topPostponed.join(", ")}. Try breaking them down!`,
    );
  }

  // Suggest best day for productivity
  if (pattern.timePatterns.preferredDays.length > 0) {
    const bestDay = pattern.timePatterns.preferredDays[0];
    suggestions.push(`📅 You're most productive on ${bestDay}s!`);
  }

  // Suggest based on completion rate
  const completionRate =
    (pattern.interactions.totalTasksCompleted /
      pattern.interactions.totalTasksCreated) *
    100;
  if (completionRate < 50) {
    suggestions.push(
      `🎯 Your completion rate is ${completionRate.toFixed(1)}%. Try smaller, achievable tasks!`,
    );
  } else if (completionRate > 80) {
    suggestions.push(
      `🔥 Amazing! You complete ${completionRate.toFixed(1)}% of your tasks!`,
    );
  }

  return suggestions;
}

/**
 * Auto-suggest priority based on learned patterns
 */
async function suggestPriority(sessionId, taskTitle) {
  const pattern = await UserPattern.findOne({ sessionId });
  if (!pattern) return "medium";

  // Check if task contains keywords user usually postpones
  const taskLower = taskTitle.toLowerCase();
  const hasPostponedKeyword = pattern.completion.tasksUsuallyPostponed.some(
    (keyword) => taskLower.includes(keyword),
  );

  if (hasPostponedKeyword) {
    return "high"; // Suggest higher priority for tasks user tends to postpone
  }

  // Use user's average priority
  return pattern.taskCreation.averagePriority;
}

module.exports = {
  updateUserPattern,
  getPersonalizedSuggestions,
  suggestPriority,
};
