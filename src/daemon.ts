// `tui serve` keeps one recording open between commands, so an agent can act, look and try again.
// Each `tui <command>` is a short client call; the daemon runs commands one at a time.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"
import type { RecorderConfig } from "./config"
import { CheckFailed, exitCode } from "./errors"
import { STAGE_OPTIONS, stageOptions } from "./record"
import { printable } from "./screen"
import type { Stage, StageOptions } from "./stage"
import { stepsHelp } from "./steps"

const STATE = path.join(os.tmpdir(), "opencode-tui-recorder", "daemon.json")

export interface Reply {
  code: number
  output: string
}

type StageLike = Pick<Stage, "begin" | "screen" | "step" | "markStart" | "finish" | "stop">

/** Handles one command against the open recording; `create` makes the stage, so tests can fake it. */
export function commands(config: RecorderConfig, create: (options: StageOptions) => StageLike) {
  let stage: StageLike | undefined
  const open = () => {
    if (!stage) throw new Error("No recording is running; run begin first")
    return stage
  }
  const screen = async () => printable(await open().screen())

  const handle = async (command: string, args: string[]): Promise<string> => {
    switch (command) {
      case "begin": {
        const { values } = parseArgs({ args, options: STAGE_OPTIONS })
        await stage?.stop()
        stage = undefined
        const next = create(stageOptions(values))
        try {
          await next.begin()
        } catch (error) {
          await next.stop()
          throw error
        }
        stage = next
        return screen()
      }
      case "screen":
        return screen()
      case "rec-start":
        open().markStart()
        return "Recording from here."
      case "rec-stop": {
        const { values } = parseArgs({ args, options: { out: { type: "string", default: "demo.gif" }, crop: { type: "boolean", default: false } } })
        const current = open()
        stage = undefined
        await current.finish(values.out, values.crop)
        return `Wrote ${values.out}. The recording is closed; run begin to start again.`
      }
      case "end":
        await stage?.stop()
        stage = undefined
        return "Stopped."
      case "help":
        return `Commands: begin [--sessions <json>] [--options <json>], screen, rec-start, rec-stop --out <file>, end, or a step.\n${stepsHelp(config)}`
      default: {
        const current = open()
        await current.step([command, ...args].join(" "))
        return screen()
      }
    }
  }

  return async (command: string, args: string[]): Promise<Reply> => {
    try {
      return { code: 0, output: await handle(command, args) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // expect steps already put the screen in their message.
      const after = !stage || message.includes("\n") ? "" : `\n\nScreen:\n${await screen().catch(() => "")}`
      return { code: exitCode(error), output: `${error instanceof CheckFailed ? "Check failed" : "Error"}: ${message}${after}` }
    }
  }
}

export async function serve(config: RecorderConfig, create: (options: StageOptions) => StageLike): Promise<void> {
  const run = commands(config, create)
  const token = crypto.randomUUID()
  let queue: Promise<unknown> = Promise.resolve()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: async (request) => {
      if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("forbidden", { status: 403 })
      const { command, args } = (await request.json()) as { command: string; args: string[] }
      const reply = queue.then(() => run(command, args))
      queue = reply.catch(() => {})
      return Response.json(await reply)
    },
  })
  mkdirSync(path.dirname(STATE), { recursive: true })
  writeFileSync(STATE, JSON.stringify({ port: server.port, token }))
  chmodSync(STATE, 0o600)
  console.error(`Listening on 127.0.0.1:${server.port}`)
}

/** Sends one command to the daemon and prints its reply. */
export async function send(command: string, args: string[]): Promise<number> {
  let state: { port: number; token: string }
  try {
    state = JSON.parse(readFileSync(STATE, "utf8"))
  } catch {
    console.log("Error: the recorder daemon is not running; start it with `tui serve`")
    return 2
  }
  const response = await fetch(`http://127.0.0.1:${state.port}`, {
    method: "POST",
    headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" },
    body: JSON.stringify({ command, args }),
  }).catch((error: Error) => error)
  if (response instanceof Error || !response.ok) {
    console.log(`Error: the recorder daemon did not answer: ${response instanceof Error ? response.message : response.status}`)
    return 2
  }
  const reply = (await response.json()) as Reply
  console.log(reply.output)
  return reply.code
}
