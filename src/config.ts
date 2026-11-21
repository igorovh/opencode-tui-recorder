import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Page } from "playwright"
import type { Match } from "./screen"

/** A session created through the API before the TUI opens. Each project is its own git repository. */
export interface SampleSession {
  project: string
  title: string
  /** Amends the project's first commit before this session, which gives the folder a new project ID. */
  rewrite?: boolean
}

export interface Session extends SampleSession {
  id: string
  directory: string
}

export interface ApiInit {
  method?: string
  body?: unknown
  query?: Record<string, string>
}

export interface Context {
  /** Plugin options from --options. */
  options: Record<string, unknown>
  sessions: Session[]
  /** The recording's temporary home, with repos/, config/, data/ and state/ inside. */
  work: string
  /** Calls the OpenCode server with the recording's credentials, such as a plugin's RPC. */
  api(route: string, init?: ApiInit): Promise<Response>
}

export interface StepContext extends Context {
  page: Page
  /** Everything after the step name. */
  arg: string
  screen(): Promise<string[]>
  /** The centre of the cell showing `text`; `char` moves to that character after it, such as a close cross. */
  cell(text: string, at?: { start?: boolean; char?: string }): Promise<{ x: number; y: number }>
  sleep(ms: number): Promise<void>
  /** Throws a failed check (exit code 1), for steps that verify something. */
  fail(message: string): never
}

export interface Step {
  /** Shown in the step list, such as "close <text>   hover that row, then click its close cross". */
  usage: string
  run(ctx: StepContext): Promise<unknown>
}

export interface RecorderConfig {
  /** JSON files for OpenCode's config folder, such as cli.json loading the plugin. update: "disable" is added. */
  config(ctx: { plugin: string; options: Record<string, unknown> }): Record<string, Record<string, unknown>>
  /** The sessions when --sessions is not given. */
  sessions: SampleSession[]
  /** Opens the first session instead of the home screen. */
  attach?: boolean
  viewport?: { width: number; height: number }
  /** When the plugin's UI has loaded, such as a section title showing. Titles arrive a moment after the TUI. */
  ready: { label: string; test(lines: string[], ctx: Context): boolean }
  /** Where several rows show the same text: the plugin's side of the screen. Defaults to leftmost. */
  match?: Match
  /** Runs after the sessions exist and before the TUI starts, to put state in place. */
  seed?(ctx: Context): Promise<void>
  /** Steps of this plugin, next to the built-in ones. */
  steps?: Record<string, Step>
  /** An ffmpeg filter prefix for --crop, such as "crop=600:ih:0:0,". */
  crop?(ctx: StepContext): Promise<string>
}

export const defineRecorder = (config: RecorderConfig) => config

export const CONFIG_FILE = "recorder.config.ts"

export async function loadConfig(dir = process.cwd()): Promise<RecorderConfig> {
  const file = path.join(dir, CONFIG_FILE)
  if (!existsSync(file)) throw new Error(`${CONFIG_FILE} is missing in ${dir}`)
  const config = ((await import(pathToFileURL(file).href)) as { default?: RecorderConfig }).default
  if (!config || typeof config.config !== "function" || !Array.isArray(config.sessions) || !config.ready) {
    throw new Error(`${CONFIG_FILE} must export default defineRecorder({ config, sessions, ready })`)
  }
  return config
}

/** --sessions takes a JSON array, inline or in a file. */
export function parseSessions(value: string, read: (file: string) => string): SampleSession[] {
  const list = JSON.parse(value.trim().startsWith("[") ? value : read(value))
  const valid = (item: Partial<SampleSession> | null) =>
    typeof item?.project === "string" && /^[A-Za-z0-9._-]+$/.test(item.project) && typeof item.title === "string" &&
    (item.rewrite === undefined || typeof item.rewrite === "boolean")
  if (!Array.isArray(list) || !list.length || !list.every(valid)) {
    throw new Error('--sessions must be a non-empty JSON array of { "project": string, "title": string, "rewrite"?: boolean }')
  }
  return list
}
