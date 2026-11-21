import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { loadConfig, parseSessions } from "./config"
import { CheckFailed, exitCode } from "./errors"
import { Stage } from "./stage"
import { stepsHelp } from "./steps"

/** The options `record` and `tui begin` share. */
export const STAGE_OPTIONS = {
  options: { type: "string", default: "{}" },
  sessions: { type: "string" },
  // Defaults to the base checkout tidy mounts for a Before recorded with the pull request's tools.
  plugin: { type: "string" },
  width: { type: "string" },
  height: { type: "string" },
} as const

export function stageOptions(values: { options?: string; sessions?: string; plugin?: string; width?: string; height?: string }) {
  return {
    plugin: values.plugin ?? process.env.TIDY_BASE ?? process.cwd(),
    options: JSON.parse(values.options ?? "{}") as Record<string, unknown>,
    sessions: values.sessions ? parseSessions(values.sessions, (file) => readFileSync(file, "utf8")) : undefined,
    width: values.width ? Number(values.width) : undefined,
    height: values.height ? Number(values.height) : undefined,
  }
}

/** Records the steps in one go. A failed check stops the steps but still writes the file, then exits with 1. */
export async function record(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      ...STAGE_OPTIONS,
      out: { type: "string", default: "demo.gif" },
      step: { type: "string", multiple: true, default: [] },
      steps: { type: "string" },
      crop: { type: "boolean", default: false },
    },
  })
  const config = await loadConfig()
  const steps = [...values.step, ...(values.steps ? readFileSync(values.steps, "utf8").split(/\r?\n/) : [])]
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
  if (!steps.length) console.error(`No steps given, so it shows the plugin at rest.\n${stepsHelp(config)}`)
  const stage = new Stage(config, stageOptions(values))
  let failure: unknown
  try {
    await stage.begin()
    for (const step of steps) {
      try {
        await stage.step(step)
      } catch (error) {
        failure = error
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 700))
    }
    await stage.finish(values.out, values.crop)
    console.error(`Wrote ${values.out}`)
  } catch (error) {
    failure ??= error
  } finally {
    await stage.stop()
  }
  if (failure) console.error(failure instanceof CheckFailed ? `Check failed: ${failure.message}` : failure)
  return exitCode(failure)
}
