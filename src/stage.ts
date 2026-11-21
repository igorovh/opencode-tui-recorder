// One running OpenCode TUI with the plugin: a temporary home, `opencode serve`, ttyd and a Chromium page
// that records video. Sessions are created through the API, so no model runs.
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Browser, BrowserContext, Page } from "playwright"
import type { ApiInit, Context, RecorderConfig, SampleSession, Session, StepContext } from "./config"
import { CheckFailed } from "./errors"
import { locate } from "./screen"
import { parseStep } from "./steps"

export interface StageOptions {
  plugin: string
  options: Record<string, unknown>
  sessions?: SampleSession[]
  width?: number
  height?: number
}

// Setup scripts that install Chromium as root put it here, where an unprivileged user can read it.
const SHARED_BROWSERS = "/opt/ms-playwright"

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class Stage {
  private readonly work = mkdtempSync(path.join(os.tmpdir(), "opencode-tui-recorder-"))
  private readonly children: ChildProcess[] = []
  private readonly log: string[] = []
  private readonly password = crypto.randomUUID()
  // ttyd listens on every interface and the terminal is writable, so keep others on the network out.
  private readonly ttyd = { username: "record", password: crypto.randomUUID() }
  private readonly serverPort = 40000 + Math.floor(Math.random() * 20000)
  private readonly env: NodeJS.ProcessEnv
  private sessions: Session[] = []
  private browser?: Browser
  private context?: BrowserContext
  private page?: Page
  private videoStart = 0
  private from = 0

  constructor(
    private readonly config: RecorderConfig,
    private readonly options: StageOptions,
  ) {
    this.env = {
      ...process.env,
      // The footer shows the project path, so a home of `work` turns it into ~/repos/<project>.
      HOME: this.work,
      USERPROFILE: this.work,
      XDG_CONFIG_HOME: path.join(this.work, "config"),
      XDG_DATA_HOME: path.join(this.work, "data"),
      XDG_STATE_HOME: path.join(this.work, "state"),
      XDG_CACHE_HOME: path.join(this.work, "cache"),
      OPENCODE_SERVER_PASSWORD: this.password,
    }
  }

  private get api() {
    return `http://127.0.0.1:${this.serverPort}`
  }

  private start(bin: string, args: string[], cwd?: string) {
    const child = spawn(bin, args, { env: this.env, cwd, stdio: ["ignore", "ignore", "pipe"] })
    child.stderr!.on("data", (chunk) => this.log.push(`${path.basename(bin)}: ${chunk}`))
    this.children.push(child)
  }

  private async until(label: string, read: () => Promise<unknown>, timeout = 30_000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await read().catch(() => false)) return
      await sleep(250)
    }
    throw new Error(`Timed out waiting for ${label}\n${this.log.join("").slice(-4000)}`)
  }

  private git(project: string, ...args: string[]) {
    spawnSync("git", ["-C", path.join(this.work, "repos", project), "-c", "user.name=demo", "-c", "user.email=demo@example.com", ...args])
  }

  private callApi = (route: string, init: ApiInit = {}) => {
    const query = init.query ? `?${new URLSearchParams(init.query)}` : ""
    return fetch(`${this.api}${route}${query}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { authorization: `Basic ${btoa(`opencode:${this.password}`)}`, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  }

  private ctx(): Context {
    return { options: this.options.options, sessions: this.sessions, work: this.work, api: this.callApi }
  }

  /** Starts OpenCode with the plugin and opens it in the browser, recording from now on. */
  async begin(): Promise<void> {
    const samples = this.options.sessions ?? this.config.sessions
    // Each project needs its own root commit: OpenCode groups sessions by it.
    for (const project of new Set(samples.map((s) => s.project))) {
      mkdirSync(path.join(this.work, "repos", project), { recursive: true })
      this.git(project, "init", "-q")
      this.git(project, "commit", "-q", "--allow-empty", "-m", `init ${project}`)
    }
    const configDir = path.join(this.work, "config", "opencode")
    mkdirSync(configDir, { recursive: true })
    const plugin = path.resolve(this.options.plugin).replaceAll("\\", "/")
    const files = this.config.config({ plugin, options: this.options.options })
    // Otherwise the home screen shows an "/update to install" notice.
    files["opencode.json"] = { ...files["opencode.json"], update: "disable" }
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(configDir, path.basename(name)), JSON.stringify(content))

    const opencode = process.env.OPENCODE_BIN ?? "opencode"
    this.start(opencode, ["serve", "--port", String(this.serverPort)])
    await this.until("the OpenCode server", async () => (await this.callApi("/api/info")).ok)

    for (const sample of samples) {
      const directory = path.join(this.work, "repos", sample.project)
      if (sample.rewrite) this.git(sample.project, "commit", "-q", "--amend", "--allow-empty", "-m", `rewrite ${sample.project}`)
      const response = await this.callApi("/api/session", { body: { title: sample.title, location: { directory } } })
      if (!response.ok) throw new Error(`Creating a session failed: ${response.status} ${await response.text()}`)
      this.sessions.push({ ...sample, directory, id: ((await response.json()) as { data: { id: string } }).data.id })
    }
    await this.config.seed?.(this.ctx())

    const ttydPort = this.serverPort + 1
    const first = this.sessions[0]!
    this.start(
      process.env.TTYD_BIN ?? "ttyd",
      ["-p", String(ttydPort), "-c", `${this.ttyd.username}:${this.ttyd.password}`, "-W", "-t", "fontSize=15", "-t", "disableLeaveAlert=true",
        opencode, "--server", this.api, ...(this.config.attach ? ["--session", first.id] : [])],
      first.directory,
    )
    const auth = { authorization: `Basic ${btoa(`${this.ttyd.username}:${this.ttyd.password}`)}` }
    await this.until("ttyd", async () => (await fetch(`http://127.0.0.1:${ttydPort}`, { headers: auth })).ok)

    if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(SHARED_BROWSERS)) process.env.PLAYWRIGHT_BROWSERS_PATH = SHARED_BROWSERS
    const { chromium } = await import("playwright")
    const width = this.options.width ?? this.config.viewport?.width ?? 1280
    const height = this.options.height ?? this.config.viewport?.height ?? 720
    this.browser = await chromium.launch()
    this.context = await this.browser.newContext({
      httpCredentials: this.ttyd,
      viewport: { width, height },
      recordVideo: { dir: path.join(this.work, "video"), size: { width, height } },
    })
    this.page = await this.context.newPage()
    this.videoStart = Date.now()
    await this.page.goto(`http://127.0.0.1:${ttydPort}`)
    await this.until(this.config.ready.label, async () => this.config.ready.test(await this.screen(), this.ctx()))
    await this.settle()
    this.from = this.offset()
  }

  private offset = () => (Date.now() - this.videoStart) / 1000

  /** Waits until the screen stops changing, up to 10 s: lists still reorder after the titles load. */
  private async settle() {
    let last = ""
    const end = Date.now() + 10_000
    while (Date.now() < end) {
      await sleep(1000)
      const now = (await this.screen()).join("\n")
      if (now === last) return
      last = now
    }
  }

  /** The terminal's visible rows; ttyd exposes its xterm.js instance as window.term. */
  async screen(): Promise<string[]> {
    if (!this.page) throw new Error("No recording is running; run begin first")
    return this.page.evaluate(() => {
      const term = (window as any).term
      if (!term) return []
      const buffer = term.buffer.active
      return Array.from({ length: term.rows }, (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString() ?? "")
    })
  }

  stepContext(arg: string): StepContext {
    const page = this.page
    if (!page) throw new Error("No recording is running; run begin first")
    return {
      ...this.ctx(),
      page,
      arg,
      screen: () => this.screen(),
      sleep,
      fail: (message) => {
        throw new CheckFailed(message)
      },
      cell: async (text, at) => {
        const { row, col } = locate(await this.screen(), text, this.config.match, at)
        const box = await page.evaluate(() => {
          const term = (window as any).term
          const rect = document.querySelector(".xterm-screen")!.getBoundingClientRect()
          return { x: rect.left, y: rect.top, width: rect.width / term.cols, height: rect.height / term.rows }
        })
        return { x: box.x + (col + 0.5) * box.width, y: box.y + (row + 0.5) * box.height }
      },
    }
  }

  async step(line: string): Promise<void> {
    const { step, arg } = parseStep(this.config, line)
    console.error(`> ${line}`)
    await step.run(this.stepContext(arg))
  }

  /** The GIF starts here instead of where the UI became ready. */
  markStart(): void {
    if (!this.page) throw new Error("No recording is running; run begin first")
    this.from = this.offset()
  }

  /** Writes a GIF from the start mark to now, or a PNG of the screen when `out` ends in .png, then stops. */
  async finish(out: string, crop = false): Promise<void> {
    if (!this.page || !this.context) throw new Error("No recording is running; run begin first")
    await sleep(1500)
    const filter = crop && this.config.crop ? await this.config.crop(this.stepContext("")) : ""
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
    if (out.endsWith(".png")) {
      await this.page.screenshot({ path: out })
      return this.stop()
    }
    const duration = this.offset() - this.from
    const video = this.page.video()!
    await this.context.close()
    this.context = undefined
    const ffmpeg = spawnSync(
      "ffmpeg",
      [
        "-y", "-ss", this.from.toFixed(2), "-i", await video.path(), "-t", duration.toFixed(2), "-vf",
        // Terminal colours are flat, so dithering only adds noise; still frames are dropped and held instead.
        `${filter}fps=12,scale='min(960,iw)':-1:flags=lanczos,mpdecimate,split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
        "-fps_mode", "vfr", out,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    )
    await this.stop()
    if (ffmpeg.status !== 0) throw new Error("ffmpeg failed")
  }

  async stop(): Promise<void> {
    await this.context?.close().catch(() => {})
    await this.browser?.close().catch(() => {})
    this.page = undefined
    for (const child of this.children) {
      if (child.exitCode !== null || !child.pid) continue
      if (process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)])
      else child.kill("SIGTERM")
    }
    rmSync(this.work, { recursive: true, force: true, maxRetries: 5 })
  }
}
