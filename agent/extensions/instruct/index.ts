import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
let instructions = "";
try {
  const promptPath = join(__dirname, "prompt.md");
  if (existsSync(promptPath)) {
    instructions = readFileSync(promptPath, "utf-8").trim();
  }
} catch (err) {
  console.error("Warning: failed to read prompt.md in instruct extension:", err);
}

export default function (pi: ExtensionAPI) {
  (globalThis as any).__pi_extension_features?.push({
    name: "instruct",
    description: "Custom system instructions loaded from prompt.md",
    commands: ["/instructions"],
    tools: [],
    shortcuts: [],
  });

  pi.on("before_agent_start", async (_event) => {
    if (!instructions) return {};
    return {
      systemPrompt:
        _event.systemPrompt +
        `\n\n## Custom Instructions\n${instructions}`
    };
  });

  pi.registerCommand("instructions", {
    description: "Open prompt.md in your default editor",
    handler: (_args, ctx) => {
      const promptPath = join(__dirname, "prompt.md");
      let command = "xdg-open";
      let args = [promptPath];
      if (process.platform === "darwin") {
        command = "open";
      } else if (process.platform === "win32") {
        command = "cmd";
        args = ["/c", "start", "", promptPath];
      }

      try {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.on("error", (err) => {
          if (ctx.hasUI) {
            ctx.ui.notify(`Failed to open default editor: ${err.message}`, "warning");
          }
        });
        child.unref();
        if (ctx.hasUI) {
          ctx.ui.notify(`Opened ${promptPath}`);
        }
      } catch (err: any) {
        if (ctx.hasUI) {
          ctx.ui.notify(`Failed to spawn default editor: ${err.message}`, "warning");
        }
      }
    },
  });
}
