# opencode-tui-recorder

Records the real OpenCode TUI with your plugin to a GIF or PNG: in one command for a demo, or one step at a
time so an agent can act, look at the screen and try again. Sessions are created through OpenCode's API, so no
model runs.

It runs `opencode serve` in a temporary home, opens the TUI through [ttyd](https://github.com/tsl0922/ttyd) in
Chromium, and records the page with Playwright.

## Install

```sh
bun add -d github:igorovh/opencode-tui-recorder#v0.1.1
```

It needs `opencode` (or `OPENCODE_BIN`), `ttyd` (or `TTYD_BIN`), `ffmpeg` and Playwright's Chromium.

```json
"scripts": {
  "record": "opencode-tui-recorder record",
  "tui": "opencode-tui-recorder tui"
}
```

## Configure

`recorder.config.ts` in your repository says how OpenCode loads the plugin and what state to set up:

```ts
import { defineRecorder } from "opencode-tui-recorder"

export default defineRecorder({
  // JSON files for OpenCode's config folder. update: "disable" is added to opencode.json.
  config: ({ plugin, options }) => ({ "cli.json": { plugins: [{ package: plugin, options }] } }),
  // Each project becomes its own git repository; --sessions replaces this list.
  sessions: [{ project: "web", title: "Dark mode for settings" }],
  // Open the first session instead of the home screen.
  attach: true,
  // When your UI has loaded. Titles arrive a moment after the TUI starts.
  ready: { label: "the Links section", test: (lines) => lines.some((line) => line.includes("Links")) },
  // Your plugin's side of the screen, for text that shows in several places.
  match: "rightmost",
  // State to put in place before the TUI starts, such as files or RPC calls.
  async seed({ api, sessions }) {},
  // Steps of your plugin, next to the built-in ones.
  steps: {
    pin: {
      usage: "pin <url>                 pin a link through the plugin's RPC",
      run: (ctx) => ctx.api("/api/rpc/my-plugin/add", { body: { input: { url: ctx.arg } } }),
    },
  },
})
```

## Record in one go

```sh
bun run record -- --out demo.gif --step "hover Dark mode" --step "expect Close tab"
```

`--steps <file>` takes one step per line, `--options <json>` passes plugin options, `--sessions <json or file>`
replaces the sessions, `--width`/`--height` set the window and `--crop` applies your config's `crop`. An `--out`
ending in `.png` saves a screenshot of the end state instead.

Built-in steps:

```text
wait <ms>                 pause
hover <text>              move the pointer onto the row showing <text>
click <text>              left-click that row
middle <text>             middle-click that row
right <text>              right-click that row
drag <text> -> <text>     drag one row onto another
key <keys>                press keys, such as alt+2, ctrl+p or Enter
type <text>               type text, such as /close (add "key Enter" to run it)
expect <text>             fail unless <text> shows within 5 s
expect-not <text>         fail unless <text> is gone within 5 s
expect-above <a> -> <b>   fail unless the row showing <a> is above the one showing <b>
```

A failed check stops the steps, still writes the file, and exits with 1.

## Step by step

```sh
bun run tui serve &                 # keeps one recording open
bun run tui begin --sessions '[{"project":"web","title":"Dark mode"}]'
bun run tui hover Dark mode         # prints the screen after every step
bun run tui rec-start               # the GIF starts here
bun run tui expect Close tab
bun run tui rec-stop --out demo.gif # writes the file and closes the recording
```

`tui screen` prints the screen, `tui end` closes the recording without a file, and `tui help` lists the steps.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | every step passed |
| `1` | a check failed: text never showed, or a row the step needs is not on screen |
| `2` | the recorder broke: an unknown step, a timeout, ffmpeg |

## With tidy's review extras

[tidy](https://github.com/igorovh/tidy/blob/main/docs/extras.md) can let its planning model drive the TUI step
by step, then replay the steps on the pull request and on the base branch. With `before: pr-tools`, the Before
side runs this recorder and your config from the pull request, and loads the plugin from the base checkout at
`/base` (`TIDY_BASE`), so new steps and fixtures work on both sides.

```yaml
review:
  extras:
    - name: Demo
      when: ["src/**"]
      image: node:22-bookworm
      before: pr-tools
      setup: |
        apt-get update -qq && apt-get install -y -qq ffmpeg > /dev/null
        curl -fsSL -o /usr/local/bin/ttyd https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 && chmod +x /usr/local/bin/ttyd
        npm install --global --loglevel=error bun @opencode/cli > /dev/null
        bun install --frozen-lockfile > /dev/null
        if [ -n "$TIDY_BASE" ]; then (cd "$TIDY_BASE" && bun install --frozen-lockfile > /dev/null); fi
        # Steps run as an unprivileged user, so Chromium goes where everyone can read it.
        PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright bunx playwright install --with-deps chromium > /dev/null
      interactive:
        start: ["./node_modules/.bin/opencode-tui-recorder", "tui", "serve"]
        steps:
          begin: ["./node_modules/.bin/opencode-tui-recorder", "tui", "begin"]
          screen: ["./node_modules/.bin/opencode-tui-recorder", "tui", "screen"]
          hover: ["./node_modules/.bin/opencode-tui-recorder", "tui", "hover"]
          expect: ["./node_modules/.bin/opencode-tui-recorder", "tui", "expect"]
          rec-start: ["./node_modules/.bin/opencode-tui-recorder", "tui", "rec-start"]
          rec-stop: ["./node_modules/.bin/opencode-tui-recorder", "tui", "rec-stop", "--out", "{out}/demo.gif"]
```

The recorder finds Chromium in `/opt/ms-playwright` on its own when `PLAYWRIGHT_BROWSERS_PATH` is not set.

## License

MIT
