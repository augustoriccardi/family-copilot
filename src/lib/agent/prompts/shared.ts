/**
 * Returns the current date/time string to inject into any system prompt.
 */
export function currentDateTimeBlock(): string {
  const now = new Date();
  const currentDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const currentTime = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return `**Current date and time: ${currentDate} at ${currentTime}**`;
}

export const FORMATTING_RULES = `
**Response Formatting:**
- Format all responses in **well-structured Markdown**
- Use **bold** for important terms and critical information
- Use bullet points or numbered lists for multiple items
- Use headers (##, ###) to organize longer responses
- Be concise but thorough
`;
