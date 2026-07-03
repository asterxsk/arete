// feedback module — /feedback command to create GitHub issues from the TUI

import { execSync } from "child_process";

const MIN_WORDS = 5;
const MIN_CHARS = 30;
const REPO = "asterxsk/arete";

export function registerFeedbackCommand(pi: any): void {
  if (typeof pi.registerCommand !== "function") return;

  pi.registerCommand("feedback", {
    description: "Create a GitHub issue with your feedback",
    async handler(args: string, ctx: any) {
      const text = (args || "").trim();

      // Validate input
      if (text.length < MIN_CHARS || text.split(/\s+/).filter(Boolean).length < MIN_WORDS) {
        ctx.ui.notify("Please describe your issue further.", "warning");
        return {};
      }

      // Use first line as title, full text as body
      const lines = text.split("\n");
      const title = lines[0].slice(0, 80);
      const body = text;

      try {
        execSync(
          `gh issue create --repo ${REPO} --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`,
          { stdio: "pipe", timeout: 15000 },
        );
        ctx.ui.notify("Issue created", "success");
      } catch {
        ctx.ui.notify("Failed to create issue.", "error");
      }

      return {};
    },
  });
}
