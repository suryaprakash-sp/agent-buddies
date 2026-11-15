# agent-buddies (Claude Code mod)

When 3 or more subagents run at once, a small room opens in the bottom-right corner of Claude Code. Each running agent gets a cute pixel buddy (blob, cat, ghost, frog, chick, robot, bunny, octopus) with a 5-segment progress bar over its head. Buddies wander and bump into each other. Finished ones sparkle for 10 seconds and then leave. Failed ones go grey. Hover over the room to see each agent's name.

The header shows `N working · N done · N%`. The room closes again when fewer than 3 agents are running.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-buddies --marketplace suryaprakash-sp/agent-buddies
```

Answer `y` to add the marketplace, then press Enter to pick the user scope. The mod is active right away.

From a shell instead:

```sh
claude plugin install agent-buddies --marketplace suryaprakash-sp/agent-buddies
```

In the desktop app, where `/plugin` doesn't run: click + next to the prompt box, then Plugins, Add marketplace with `suryaprakash-sp/agent-buddies`, then Add plugin.

Check that it works: type `/buddies demo 8`. Eight demo buddies should appear in the bottom-right corner and finish one by one.

To update later: `claude plugin update agent-buddies`, then `/reload-plugins`.

## Commands

| Command | What it does |
|---|---|
| `/buddies` | Status: on or hidden, how many agents are running |
| `/buddies demo [n]` | Plays an n-agent preview (3 to 40, default 5) |
| `/buddies off` | Hides the room |
| `/buddies on` | Shows it again |
| `/buddies clear` | Empties the room |

## Notes

- It needs a recent Claude Code build that supports mods (function-hook plugins). If `/plugin install` or `/buddies` isn't recognized, run `claude update` first.
- It draws in the terminal and in the desktop app's Code tab.
- It's purely visual: it never blocks or changes a tool call or an agent.
- Tests, from a clone of this repo: `claude plugin test .`
- To remove it: `claude plugin uninstall agent-buddies`.
