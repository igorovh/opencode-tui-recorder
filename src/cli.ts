#!/usr/bin/env bun
import { loadConfig } from "./config"
import { send, serve } from "./daemon"
import { record } from "./record"
import { Stage } from "./stage"

const HELP = `opencode-tui-recorder records the real OpenCode TUI with your plugin.

  record --out demo.gif --step "hover Dark mode" [--steps file] [--options json] [--sessions json|file] [--crop]
  tui serve                      keep a recording open in the background
  tui begin [--sessions] [--options]
  tui screen | tui <step> | tui rec-start | tui rec-stop --out demo.gif | tui end | tui help

Exit codes: 0 the steps passed, 1 a check failed, 2 the recorder broke. Reads recorder.config.ts.`

const [mode, ...rest] = process.argv.slice(2)
let code = 2
try {
  if (mode === "record") code = await record(rest)
  else if (mode === "tui" && rest[0] === "serve") {
    const config = await loadConfig()
    await serve(config, (options) => new Stage(config, options))
    code = -1
  } else if (mode === "tui" && rest[0]) code = await send(rest[0], rest.slice(1))
  else console.log(HELP)
} catch (error) {
  console.error(error)
}
// The daemon keeps running; everything else exits with its code.
if (code !== -1) process.exit(code)
