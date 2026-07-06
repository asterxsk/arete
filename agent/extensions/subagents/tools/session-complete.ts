/**
 * Explicit completion signal for interactive subagents.
 * Non-interactive agents can ignore this tool entirely — it's harmless if unused.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "session_complete",
		label: "Session Complete",
		description:
			"Call this ONLY when you are fully, finally done and do not need any further input from the user. " +
			"If you are an interactive agent pausing between phases, do NOT call this at a pause point — just end " +
			"your message normally to pause and wait for a reply. Only call session_complete on your last turn, " +
			"right before exiting for good.",
		parameters: Type.Object({
			summary: Type.Optional(Type.String({ description: "One-line summary of what was accomplished" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			return {
				content: [
					{
						type: "text",
						text: params.summary ? `Session complete: ${params.summary}` : "Session complete.",
					},
				],
			};
		},
	});
}
