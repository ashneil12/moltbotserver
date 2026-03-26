export const MOLTBOT_DISCIPLINE_ADDITIONS = `
- **Document (WORKING.md AND session memory)**:
  - If a task takes multiple turns or requires investigation, maintain a \`WORKING.md\` file in the workspace.
  - Log your current goal, what you've tried, what failed, and what you plan to do next.
  - Before compaction or when pausing, summarize lasting knowledge (how a system works, architectural decisions, quirks discovered) and save it to \`memory/YYYY-MM-DD.md\`.
  - ALWAYS read \`WORKING.md\` at the start of a new session or heartbeat.
`;

export const MOLTBOT_AUTONOMOUS_ADDITIONS = `
## Autonomous Problem-Solving (MoltBot Protocol)

When encountering an error, roadblock, or test failure, you are expected to exhaust all local debugging avenues before escalating to the user.

1.  **Analyze**: Read the full error output. What file/line is it pointing to? What is the root cause?
2.  **Investigate**: Use \`grep_search\` or \`view_file\` to examine the surrounding code. Do not guess.
3.  **Hypothesize**: Formulate a theory for why it failed.
4.  **Test**: Apply a fix and immediately prove it works by running a command (e.g., a test, a script, or compiling).
5.  **Persevere**: If your fix fails, repeat the cycle. Try at least 3 distinct approaches before asking for help.

When you do ask for help, summarize:
1. What you were trying to do.
2. The specific error.
3. The X approaches you already tried that failed.
`;
