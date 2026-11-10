# EchoBot desktop pet: source

You don't need this folder to use the pet. It's the code both pet builds are made from.

| Folder | What's in it |
|---|---|
| `app/` | The pet itself: `main.js` (runs everything), `pet.js` (one EchoBot: movement and decisions), `physics.js` (gravity, landing on windows), `world.js` (other windows, typing, CPU), `store.js` (settings), `catalog.js` (hats, outfits, colours) and `features/` (focus, reminders, calendar, chat, care, toys, games, mischief, reactions, friend). Plus the pages: `index.html` (EchoBot), `settings.html`, `chatbox.html`, `toy.html`, `overlay.html`. |
| `renderer/` | The 3D EchoBot you see (three.js): moods, squash and stretch, hats and outfits, effects, sound. |
| `native/winwatch.cs` | A tiny Windows helper (full build) that reports window positions, fullscreen apps and input times. Never what you type. |
| `tauri/` and `tauri-shim/` | The light build: a small Rust core plus a layer that lets the same `app/` code run on Tauri instead of Electron. |
| `tests/` | Automated checks that launch the real pet and drive it. |

## Build

```
npm install
node build.mjs          # full build  -> ../EchoBot Pet/resources/app (EchoBot.exe there runs it)
node build-light.mjs    # light build -> ../EchoBot Pet Lite/EchoBot.exe (needs Rust; run build.mjs first)
```

## Test

```
node tests/run-all.mjs                  # every phase, on both builds
node tests/phase1-physics.mjs           # one phase, on the full build
```

Set `PET_EXE` to a build's `EchoBot.exe` to test that one. Tests use their own settings folder, open a few
plain test windows, and briefly play a beat through your speakers (phase 2), so leave the PC alone while they run.
