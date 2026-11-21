// The plain OpenCode TUI without a plugin, for this repository's own end-to-end check.
import { defineRecorder } from "../src/index"

export default defineRecorder({
  config: () => ({}),
  sessions: [{ project: "demo", title: "Record the plain TUI" }],
  ready: { label: "the home screen's prompt", test: (lines) => lines.some((line) => line.includes("Ask anything")) },
})
