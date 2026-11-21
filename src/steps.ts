import type { RecorderConfig, Step, StepContext } from "./config"
import { printable, rowOf, keyName } from "./screen"

const click = (button: "left" | "middle" | "right"): Step["run"] => async (ctx) => {
  const at = await ctx.cell(ctx.arg)
  await ctx.page.mouse.move(at.x, at.y, { steps: 12 })
  await ctx.sleep(300)
  await ctx.page.mouse.click(at.x, at.y, { button })
}

/** Waits up to 5 s for `holds`, then fails the check with the screen in the message. */
async function expectWithin(ctx: StepContext, holds: (lines: string[]) => boolean, failure: string) {
  const end = Date.now() + 5000
  while (Date.now() < end) {
    if (holds(await ctx.screen())) return
    await ctx.sleep(200)
  }
  ctx.fail(`${failure}\n${printable(await ctx.screen())}`)
}

function pair(ctx: StepContext): [string, string] {
  const [a, b] = ctx.arg.split("->").map((part) => part.trim())
  if (!a || !b) throw new Error(`This step needs two texts: <text> -> <text>`)
  return [a, b]
}

export const BUILT_IN: Record<string, Step> = {
  wait: { usage: "wait <ms>                 pause", run: (ctx) => ctx.sleep(Number(ctx.arg)) },
  hover: {
    usage: "hover <text>              move the pointer onto the row showing <text>",
    run: async (ctx) => {
      const at = await ctx.cell(ctx.arg)
      await ctx.page.mouse.move(at.x, at.y, { steps: 12 })
    },
  },
  click: { usage: "click <text>              left-click that row", run: click("left") },
  middle: { usage: "middle <text>             middle-click that row", run: click("middle") },
  right: { usage: "right <text>              right-click that row", run: click("right") },
  drag: {
    usage: "drag <text> -> <text>     drag one row onto another",
    run: async (ctx) => {
      const [from, to] = pair(ctx)
      const start = await ctx.cell(from, { start: true })
      const end = await ctx.cell(to, { start: true })
      await ctx.page.mouse.move(start.x, start.y, { steps: 8 })
      await ctx.page.mouse.down()
      await ctx.page.mouse.move(end.x, end.y, { steps: 20 })
      await ctx.sleep(300)
      await ctx.page.mouse.up()
    },
  },
  key: {
    usage: "key <keys>                press keys, such as alt+2, ctrl+p or Enter",
    run: (ctx) => ctx.page.keyboard.press(ctx.arg.split("+").map(keyName).join("+")),
  },
  type: { usage: 'type <text>               type text, such as /close (add "key Enter" to run it)', run: (ctx) => ctx.page.keyboard.type(ctx.arg, { delay: 60 }) },
  expect: {
    usage: "expect <text>             fail unless <text> shows within 5 s",
    run: (ctx) => expectWithin(ctx, (lines) => lines.some((line) => line.includes(need(ctx))), `The screen never showed "${ctx.arg}"`),
  },
  "expect-not": {
    usage: "expect-not <text>         fail unless <text> is gone within 5 s",
    run: (ctx) => expectWithin(ctx, (lines) => !lines.some((line) => line.includes(need(ctx))), `The screen still shows "${ctx.arg}"`),
  },
  "expect-above": {
    usage: "expect-above <a> -> <b>   fail unless the row showing <a> is above the one showing <b>",
    run: (ctx) => {
      const [upper, lower] = pair(ctx)
      return expectWithin(
        ctx,
        (lines) => {
          const above = rowOf(lines, upper)
          const below = rowOf(lines, lower)
          return above !== -1 && below !== -1 && above < below
        },
        `"${upper}" is not above "${lower}"`,
      )
    },
  },
}

function need(ctx: StepContext): string {
  if (!ctx.arg) throw new Error("This step needs text to match")
  return ctx.arg
}

export const allSteps = (config: RecorderConfig): Record<string, Step> => ({ ...BUILT_IN, ...config.steps })

export const stepsHelp = (config: RecorderConfig) =>
  `Steps:\n${Object.values(allSteps(config)).map((step) => `  ${step.usage}`).join("\n")}`

/** Splits "close Flaky checkout" into the step and its argument; an unknown step is a recorder error. */
export function parseStep(config: RecorderConfig, line: string): { step: Step; arg: string } {
  const [verb = "", ...rest] = line.trim().split(" ")
  const steps = allSteps(config)
  if (!Object.hasOwn(steps, verb)) throw new Error(`Unknown step "${verb}"\n${stepsHelp(config)}`)
  return { step: steps[verb]!, arg: rest.join(" ") }
}
