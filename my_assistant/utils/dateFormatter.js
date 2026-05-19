// utils/dateFormatter.js

function formatISTDate(date) {
  if (!date) return "No date";

  // Ensure we're working with a Date object
  const utcDate = new Date(date);

  // Format to IST
  const formatted = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(utcDate);

  // Convert to DD/MM/YYYY format
  const parts = formatted.split(",");
  const dateParts = parts[0].split("/");
  const timeParts = parts[1].trim();

  return `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}, ${timeParts}`;
}

// Helper function to format for display in responses
function formatDisplayDate(date) {
  if (!date) return "No date set";

  const istDate = new Date(date);
  const options = {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };

  return new Intl.DateTimeFormat("en-IN", options).format(istDate);
}

// Helper to debug date storage
function debugDate(date, label = "Date") {
  if (!date) return;
  const d = new Date(date);
  console.log(`${label}:`);
  console.log(`  UTC: ${d.toISOString()}`);
  console.log(`  IST: ${formatISTDate(d)}`);
}

module.exports = { formatISTDate, formatDisplayDate, debugDate };
