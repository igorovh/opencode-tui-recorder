import { describe, expect, test } from "bun:test"
import { defineRecorder, parseSessions } from "../src/config"
import { commands } from "../src/daemon"
import { CheckFailed, exitCode } from "../src/errors"
import { keyName, locate, printable, rowOf } from "../src/screen"
import { parseStep } from "../src/steps"

const config = defineRecorder({
  config: ({ plugin }) => ({ "cli.json": { plugins: [plugin] } }),
  sessions: [{ project: "api", title: "Fix the login redirect" }],
  ready: { label: "the plugin", test: (lines) => lines.some((line) => line.includes("Links")) },
  steps: { pin: { usage: "pin <url>", run: async () => {} } },
})

describe("exit codes", () => {
  test("a failed check is 1, anything else that breaks is 2", () => {
    expect(exitCode(undefined)).toBe(0)
    expect(exitCode(new CheckFailed("never showed"))).toBe(1)
    expect(exitCode(new Error("ffmpeg failed"))).toBe(2)
  })

  test("a row that is not on screen is a failed check, so a missing tab on the base branch reads as missing behaviour", () => {
    expect(() => locate(["  api", "  web"], "docs")).toThrow(CheckFailed)
    expect(() => locate(["  api ✕"], "web", "leftmost", { char: "✕" })).toThrow(CheckFailed)
  })

  test("an unknown step is a recorder error, not a failed check", () => {
    expect(() => parseStep(config, "teleport api")).toThrow(/Unknown step/)
    try {
      parseStep(config, "teleport api")
    } catch (error) {
      expect(exitCode(error)).toBe(2)
    }
  })
})

describe("screen", () => {
  const lines = ["▾ api            Fix the login", "  Fix the login ✕  main pane: Fix the login"]

  test("picks the leftmost or rightmost match, the side of the screen the plugin draws on", () => {
    expect(locate(lines, "Fix the login", "leftmost", { start: true })).toEqual({ row: 1, col: 2 })
    expect(locate(lines, "Fix the login", "rightmost", { start: true })).toEqual({ row: 1, col: 30 })
    expect(locate(lines, "Fix the login", "leftmost", { char: "✕" })).toEqual({ row: 1, col: 16 })
    expect(rowOf(lines, "api")).toBe(0)
    expect(rowOf(lines, "docs")).toBe(-1)
  })

  test("keys use Playwright's names", () => {
    expect(["ctrl", "alt", "esc", "up", "p", "enter"].map(keyName)).toEqual(["Control", "Alt", "Escape", "ArrowUp", "p", "Enter"])
  })

  test("the printed screen drops trailing blanks", () => {
    expect(printable(["a   ", "b", "", "  "])).toBe("a\nb")
  })
})

describe("steps and sessions", () => {
  test("a step keeps the rest of the line as its argument; plugin steps sit next to the built-in ones", () => {
    expect(parseStep(config, "hover Flaky checkout test").arg).toBe("Flaky checkout test")
    expect(parseStep(config, "pin https://example.com Title").arg).toBe("https://example.com Title")
    expect(() => parseStep(config, "constructor")).toThrow(/Unknown step/)
  })

  test("sessions come inline or from a file, and project names cannot leave the work folder", () => {
    expect(parseSessions('[{"project":"api","title":"A"}]', () => "")).toEqual([{ project: "api", title: "A" }])
    expect(parseSessions("s.json", () => '[{"project":"web","title":"B","rewrite":true}]')[0]?.rewrite).toBe(true)
    expect(() => parseSessions('[{"project":"../etc","title":"A"}]', () => "")).toThrow(/project/)
    expect(() => parseSessions("[]", () => "")).toThrow()
  })
})

describe("tui commands", () => {
  function fakeStage(screen: string[]) {
    const calls: string[] = []
    const stage = {
      begin: async () => void calls.push("begin"),
      screen: async () => screen,
      step: async (line: string) => {
        calls.push(line)
        if (line.startsWith("expect")) throw new CheckFailed(`The screen never showed "x"\n${screen.join("\n")}`)
      },
      markStart: () => void calls.push("rec-start"),
      finish: async (out: string) => void calls.push(`finish ${out}`),
      stop: async () => void calls.push("stop"),
    }
    return { stage, calls }
  }

  test("steps need begin, return the screen, and a failed check exits with 1", async () => {
    const { stage, calls } = fakeStage(["  Links", ""])
    const run = commands(config, () => stage)
    expect((await run("click", ["Links"])).code).toBe(2)
    expect(await run("begin", ["--sessions", '[{"project":"web","title":"B"}]'])).toEqual({ code: 0, output: "  Links" })
    expect(await run("click", ["Links"])).toEqual({ code: 0, output: "  Links" })
    expect((await run("expect", ["x"])).code).toBe(1)
    expect((await run("teleport", [])).code).toBe(0)
    expect(calls).toEqual(["begin", "click Links", "expect x", "teleport"])
  })

  test("rec-stop writes the file and closes the recording", async () => {
    const { stage, calls } = fakeStage(["ok"])
    const run = commands(config, () => stage)
    await run("begin", [])
    await run("rec-start", [])
    expect((await run("rec-stop", ["--out", "/out/demo.gif"])).code).toBe(0)
    expect((await run("screen", [])).code).toBe(2)
    expect(calls).toEqual(["begin", "rec-start", "finish /out/demo.gif"])
  })
})
