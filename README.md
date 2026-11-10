# EchoBot guide

**Tip: open `README.html` instead.** It's this same guide with pictures.

EchoBot is your logo turned into a living 3D robot. Pick what you want to do, follow the steps, done.

## New here? Do these three things

1. **Watch the intro:** double-click `EchoBot_intro.mp4` (12 seconds, sound on).
2. **Wake up the pet:** open `desktop-pet\EchoBot Pet Lite` and double-click `EchoBot.exe`.
3. **Play a round** of Echo Hop: open `game\echo-hop.html`.

## What do you want to do?

| I want to… | Open this | Needs |
|---|---|---|
| Edit the 3D model | `EchoBot.blend` | Blender 5.2+ (free) |
| Watch the intro | `EchoBot_intro.mp4` | Nothing |
| Have a desktop pet | `desktop-pet\EchoBot Pet Lite\EchoBot.exe` | Windows |
| Chat with EchoBot | [Playground](https://claude.ai/artifact/GKnQVufzyuSMTVqC68ocdj) | Internet + Claude account |
| Be EchoBot on webcam | `face-cam\EchoBot Face Cam.html` | Chrome/Edge, webcam, internet |
| Add screens to my stream | `streaming\` | OBS Studio (free) |
| Play the game | `game\echo-hop.html` | A browser |
| Use stickers | `sticker-pack\` or `stickers\` | Nothing |
| 3D print it | `print\` | 3D printer or print service |
| See it in AR | `ar\EchoBot.usdz` | iPhone or iPad |

---

## 1. Edit the 3D model (Blender)

1. Open `EchoBot.blend` in Blender.
2. Press **Space** to play. Press again to stop.
3. Grey and plain? Hover over the 3D view, press **Z** and pick **Rendered**.

**Change its mood:** click the **EchoBot** object (the small cross in the middle), open
**Object Properties > Custom Properties** and drag the sliders.

**Make it talk with your voice:** save your voice as a 16-bit `.wav`. In the **Scripting** tab, pick
`EchoBot_talk_from_audio.py` from the text editor's file list (it's saved inside the .blend). Set `AUDIO` to your
file and `START` to the start frame, then **Run Script**.

<details><summary>More</summary>

- **All sliders:** LookX / LookY, Blink, Happy, Sleepy, Surprised, Angry, Sad, Cry, Talk, Blush, Hue (colour), InnerGlow, HoverGlow, RingGlow, Squash, Follow.
- **Animate a slider:** right-click it > Insert Keyframe. With Follow on, drag **LookTarget** and EchoBot watches it.
- **8 built-in moods:** Idle, Look around, Happy, Talk, Surprised, Sleep, Angry, Cry. In the NLA editor, untick Showreel and tick the one you want.
- **Render:** F12 for a picture, Ctrl+F12 for the animation. Cycles looks nicest (slower). Film > Transparent + hide Backdrop for a see-through background.

</details>

Ready-made files from the model: `EchoBot_render.png` (picture), `echobot_showreel.mp4` (all moods),
`echobot_turntable.mp4` (360° spin), `EchoBot_web.glb` (model for Unity, Godot, Spline or any 3D viewer).

## 2. The intro video

1. Double-click `EchoBot_intro.mp4` to watch.
2. Drop it into any video editor, or
3. Add it in OBS as a **Media Source** to open a stream.

To change it, open `intro\EchoBot_intro.blend` (letters are `Letter.0`–`Letter.6`, the bot slides on `Mover`).

## 3. Desktop pet

1. Open `desktop-pet\EchoBot Pet Lite` and double-click **EchoBot.exe**. (It's a single 7.5 MB file. You can copy it anywhere, e.g. your desktop.)
2. If Windows says *"Windows protected your PC"*, click **More info > Run anyway** (it's homemade, so unsigned).
3. EchoBot drops onto your taskbar. **Right-click it** for everything; **Settings and shop…** is where you switch things on and off.

| Do this | EchoBot does |
|---|---|
| Drag it and let go (or fling it) | Falls, bounces, gets thrown across the screen |
| Click it | Happy hop |
| Rub the mouse back and forth over it | Gets petted: hearts, +happiness, a coin |
| Double-click it | Opens the chat (if chat is on), otherwise a random mood |
| Move a window it's sitting on | Rides along on the title bar |
| Press **Ctrl+Alt+E** | Do Not Disturb: hides it. Press again to bring it back |

**What it does on its own:** wanders, hops up onto window title bars, peeks in from the screen edges, follows your
mouse with its eyes, naps when you're away, says good morning, gets sleepy at night, watches your work while you
type, sweats when the computer is busy, and hides while a game or video is fullscreen.

**Right-click menu:** moods · Focus timer · Chat · Feed a battery · your stats and the shop · Throw a ball · Play
(Catch the Echo, Hide and seek, Echo Hop) · Behave · Invite a friend · Settings · Do not disturb · Hide · Quit.

<details><summary>More</summary>

- **Focus timer:** EchoBot puts on headphones and stays quiet for 25 minutes (or 15/50), then celebrates, gives coins and reminds you to take a break. Hover over it to see the time left.
- **Reminders** (Settings › Focus & reminders, off by default): drink water, stand up, and your own daily reminders. Click EchoBot when it reminds you to mark it done.
- **Calendar** (off by default): paste your calendar's private iCal link (Google Calendar: Settings › your calendar › "Secret address in iCal format") or pick an `.ics` file, and EchoBot pops up 10 minutes before each event.
- **Sound** (off by default): "PC music" makes it bob to whatever your computer plays; "Microphone" makes it tilt its head at voices. Nothing is recorded or saved.
- **Chat** (off by default): Settings › Chat › turn it on, then double-click EchoBot. It's free: it talks through the EchoBot website, no key needed (the first message after a quiet spell can take up to a minute while the site wakes up; 10 messages a minute max). Prefer Claude? Pick "Claude (your API key)" and paste a key from console.anthropic.com. It's the same EchoBot as the Playground: it moves, changes colour and remembers your name. This is the only feature that uses the internet.
- **Care and shop:** energy and happiness drift down slowly; petting, batteries and games bring them up. Coins from petting, focus sessions, games and daily visits buy hats (party, beanie, cap, bow, top hat, crown, antenna), outfits (bow tie, scarf, sunglasses, flower, cape) and colours. It levels up, and it never dies or nags.
- **Special days:** Santa hat in December, witch hat at Halloween, party hat at New Year and on your birthday (set it in Settings › Fun & games).
- **Mischief** (off by default: untick **Behave**): sticky notes, cursor chasing, zoomies and edge peeking now and then. It never touches your files, windows or mouse.
- **A friend:** Invite a friend for a second EchoBot in another colour. They say hi when they meet and boing off each other.
- **Personalities:** Calm, Playful or Chaotic in Settings changes how often it talks, wanders and gets up to things.
- **Two versions, same pet:** `EchoBot Pet Lite\EchoBot.exe` (7.5 MB, uses the web engine built into Windows) and `EchoBot Pet\EchoBot.exe` (about 230 MB, carries its own). Both have every feature and passed the same tests; use Lite, and keep the big one as a spare. Run only one at a time. `desktop-pet\source` holds the code, and `EchoBot Pet (backup before upgrade).zip` is the old version.

</details>

## 4. Chat with EchoBot

1. Open the [EchoBot Playground](https://claude.ai/artifact/GKnQVufzyuSMTVqC68ocdj).
2. Type in **Chat with EchoBot**. The first time, allow the page to use Claude (uses your own Claude usage).
3. EchoBot replies in a bubble and reads it aloud.

Try: "dance", "spin", "turn green", tell it your name (it remembers; **Forget me** wipes it), or play
Guess the mood, 20 questions or Quiz me. There are 5 personalities (Cheerful, Sassy, Sleepy, Pirate, Robot) and you
can pick any voice or mute it. `web\index.html` is an offline copy that only repeats your words back.

## 5. Face Cam

1. Open `face-cam\EchoBot Face Cam.html` in Chrome or Edge and press **Start camera**.
2. Relax your face and press **Calibrate face** once.
3. Press **Full view** (or F). Esc goes back.

Your video never leaves your computer. Pick a background (Studio, Night, Green or Blue screen) and a colour.
Untick **Mirror movements** if left and right feel swapped.

## 6. Streaming kit (OBS)

1. In OBS: **+** under Sources > **Browser**.
2. Tick **Local file**, pick `starting-soon.html`, `be-right-back.html` or `ending.html` from `streaming\`.
3. Set the size to 1920 × 1080.

**Change the text:** open the file in Notepad, edit `TITLE` / `SUBTITLE`. In `starting-soon.html`, `MINUTES = 5`
sets a countdown. (Using a URL instead? Add `#night`, `#clear` or `#5`.)

**EchoBot as your avatar:** Face Cam > Green screen > Full view. In OBS add a **Window Capture** of it, then
right-click > Filters > + > **Chroma Key**. For Zoom/Meet/Discord, click **Start Virtual Camera** in OBS and pick
*OBS Virtual Camera* in the call.

## 7. Echo Hop, the game

1. Open `game\echo-hop.html` (or [play online](https://claude.ai/artifact/U98WEwMXiuSEhCyhG2pP2R)).
2. Steer with arrow keys or A/D. EchoBot bounces by itself.
3. **Space** sends an echo that lights up hidden ledges.

3 echoes, they recharge; gold notes give an extra. Cyan ledges are springy, cracked ones break, pink ones move.

## 8. Stickers and emoji

| For | Folder | How |
|---|---|---|
| Telegram | `sticker-pack\telegram` | Message @Stickers, send `/newvideo`, upload each file |
| WhatsApp | `sticker-pack\whatsapp` | Copy to phone, import with a sticker-maker app (3+ per pack) |
| Discord stickers | `sticker-pack\discord` | Server Settings > Stickers > Upload |
| Discord / Slack emoji | `sticker-pack\emoji` | Discord: Server Settings > Emoji. Slack: Customize workspace > Emoji |
| Anything else | `stickers` | 12 transparent PNGs plus a sheet of all of them |

## 9. 3D print a figure

1. Open `print\EchoBot_figure.stl` in your slicer (60 mm, flat base, no supports).
2. Print in purple: 0.2 mm layers, 15% infill.
3. Print `print\EchoBot_eyes.stl` in black and glue the eyes in. (Or paint the eye pockets.)

## 10. See EchoBot in your room (AR)

1. Send `ar\EchoBot.usdz` to your iPhone or iPad (AirDrop, iCloud or email).
2. Tap it and choose **AR**.
3. Point at a table or floor. Pinch to resize, drag to move.

No iPhone? Open `EchoBot_web.glb` in any 3D viewer, or on Android in a model-viewer app that supports AR.

---

## Folder map

| File or folder | What it is |
|---|---|
| `README.html` / `README.md` | This guide (with pictures / plain text) |
| `EchoBot.blend` | The 3D model, open in Blender to edit |
| `EchoBot_intro.mp4` | The intro video |
| `echobot_showreel.mp4` / `echobot_turntable.mp4` | All the moods / a 360° spin |
| `EchoBot_render.png` | A finished picture |
| `EchoBot_web.glb` | The model for other 3D apps and websites |
| `echobot_build.py` | Recipe that builds the model (only for rebuilding) |
| `desktop-pet\` | Desktop pet: `EchoBot Pet Lite\EchoBot.exe` (use this), the bigger `EchoBot Pet` version, its source and a backup of the old pet |
| `web\` | Offline chat page |
| `face-cam\` | Webcam avatar |
| `streaming\` | OBS screens |
| `game\` | Echo Hop |
| `sticker-pack\`, `stickers\` | Animated and still stickers |
| `print\` | 3D print files |
| `ar\` | AR file |
| `intro\` | The Blender scene the intro was made from |

`echobot-model.js` appears in several folders on purpose, so each folder works on its own.

**Online (private until you share):** [Home page](https://claude.ai/artifact/QsUyB62EtZHGWPZkFCorMX) ·
[Playground](https://claude.ai/artifact/GKnQVufzyuSMTVqC68ocdj) · [Echo Hop](https://claude.ai/artifact/U98WEwMXiuSEhCyhG2pP2R)

<details><summary>For tinkerers: rebuild anything from scratch</summary>

Run from a terminal in this folder with Blender on your PATH:

```
blender -b -P echobot_build.py -- --blend EchoBot.blend          # the main scene
blender -b -P echobot_build.py -- --stickers stickers            # still stickers
blender -b -P echobot_build.py -- --glb EchoBot_web.glb          # web model
blender -b -P intro/echobot_intro.py -- --out intro_render       # intro video
blender -b -P print/echobot_print.py -- --out print --size 80    # an 80 mm figure
blender -b -P ar/echobot_ar.py -- --out ar --width_cm 30         # a bigger AR bot
python sticker-pack/pack_stickers.py <frames folder> sticker-pack  # sticker formats
```

Add `--variant classic` or `--variant visor` to `echobot_build.py` for the two earlier designs.

</details>

## Quick fixes

- **Pet won't open:** More info > Run anyway on the blue Windows message. Keep `EchoBot.exe` in its folder.
- **Pet disappeared:** click the purple icon by the clock (maybe behind the ^ arrow).
- **Face Cam stays grey:** check internet and allow the camera (icon in the address bar).
- **Blender looks grey:** Z > Rendered over the 3D view.
- **Silent in chat:** make sure it isn't muted and pick a voice.
- **OBS screen blank:** 1920 × 1080 and Local file ticked.
