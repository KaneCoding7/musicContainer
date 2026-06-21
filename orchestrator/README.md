# musicContainer Dev Orchestrator

A two-bot system for running dev work on this repo:

- **Coordinator** — your interactive Claude Code session, driven by the
  `/dev-queue` skill (`.claude/skills/dev-queue/`). You talk to it; it owns a task
  queue, dispatches the dev bot, surfaces the dev bot's questions to you, and
  records your answers.
- **Dev bot** — the `musiccontainer-dev` agent (`.claude/agents/`). The coordinator
  spawns it in the background, one task at a time. It works in an isolated git
  worktree branched from `origin/main`, ships a **PR** (never commits to main,
  never touches your live working tree), then either marks the task done or parks
  it with a question.

## What's tracked here vs. what's runtime

This `orchestrator/` folder + `.claude/` are the **versioned source** (the skill,
the agent, and the task/question templates). The **live runtime queue is kept
outside the repo** at:

```
/mnt/external/docker/musicContainer-orchestrator/
  queue/{inbox,doing,done,blocked}
  questions/{open,answered}
  log/activity.log
```

It lives outside the repo on purpose, so the nightly hard-reset to `origin/main`
and the dev bot's PRs never touch in-flight task state. If that directory is
missing on a fresh machine, recreate it from `templates/`.

## Task lifecycle

```
inbox ──dispatch──► doing ──success──► done   (PR opened)
                      │
                      └──needs answer──► blocked  (+ questions/open/Q-*.md)
                                            │
                              you answer ───┘──► back to inbox (re-dispatch)
```

## Using it

Run Claude Code from the repo root so the `/dev-queue` skill and
`musiccontainer-dev` agent are discovered, then talk to the coordinator:

- "Add a task: …" → queues it
- "Keep going" → dispatches tasks back-to-back until the inbox is empty
- "Any questions?" → shows what the dev bot is blocked on; your answer unblocks it
- "Status" → what's queued / running / blocked / recently shipped
