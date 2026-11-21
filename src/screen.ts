import { CheckFailed } from "./errors"

export type Match = "leftmost" | "rightmost"

/** The row and column of `text` on screen; with several rows, the leftmost or rightmost match wins. */
export function locate(lines: string[], text: string, match: Match = "leftmost", at: { start?: boolean; char?: string } = {}) {
  let row = -1
  const column = (line: string) => (match === "leftmost" ? line.indexOf(text) : line.lastIndexOf(text))
  lines.forEach((line, index) => {
    if (!line.includes(text)) return
    if (row === -1 || (match === "leftmost" ? column(line) < column(lines[row]!) : column(line) > column(lines[row]!))) row = index
  })
  if (row === -1) throw new CheckFailed(`No row shows "${text}"`)
  const line = lines[row]!
  const start = column(line)
  if (at.char) {
    const col = line.indexOf(at.char, start)
    if (col === -1) throw new CheckFailed(`The row "${text}" shows no ${at.char}`)
    return { row, col }
  }
  return { row, col: at.start ? start : start + Math.floor(text.length / 2) }
}

/** The index of the row showing `text`, or -1. */
export function rowOf(lines: string[], text: string, match: Match = "leftmost"): number {
  try {
    return locate(lines, text, match).row
  } catch {
    return -1
  }
}

export const printable = (lines: string[]) => lines.map((line) => line.trimEnd()).join("\n").replace(/\n+$/, "")

// Playwright names modifiers Control, Alt, Shift and Meta, and keys like Enter and Escape.
const KEY_ALIASES: Record<string, string> = {
  ctrl: "Control", control: "Control", cmd: "Meta", command: "Meta", meta: "Meta", option: "Alt", opt: "Alt",
  esc: "Escape", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
}

export function keyName(key: string): string {
  const alias = KEY_ALIASES[key.toLowerCase()]
  if (alias) return alias
  return key.length === 1 ? key : key[0]!.toUpperCase() + key.slice(1)
}
