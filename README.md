# mclabs-apps

The shared home of mclabs' games. It holds two things:

- **`docs/`**: the website at **https://apps.mclabs.xyz**. Each game has its own page, privacy policy and support page there. GitHub Pages serves this folder from `main` on every push. It's named `docs/` only because that's the one folder GitHub Pages can publish besides the root. `CNAME` holds the custom domain, and `.nojekyll` makes GitHub serve the files as they are.
- **`events/`**: the event counter at **https://events.mclabs.xyz**, a Cloudflare Worker that keeps anonymous daily counts for every game.

The studio's main site at mclabs.xyz is separate and not in this repo. Contact for everything: **support@mclabs.xyz** (forwards to the owner).

## The site

```
docs/
  index.html           the front page: one card per game
  404.html
  assets/              shared by every page: style.css, Nunito fonts (OFL), favicon.svg
  stitchwork/
    index.html         game page          https://apps.mclabs.xyz/stitchwork/
    privacy/index.html privacy policy     https://apps.mclabs.xyz/stitchwork/privacy/
    support/index.html support page       https://apps.mclabs.xyz/stitchwork/support/
    img/               this game's icon, screenshots and share image
```

Plain HTML and CSS, with no build step and no JavaScript. Nothing loads from third parties: no Google Fonts, no analytics, no embeds. The privacy policies promise this.

To preview: `python -m http.server 8000 --directory docs`, then open http://localhost:8000.

### Adding a game

1. **Copy the folder.** Copy `docs/stitchwork/` to `docs/<game>/`. Use the game's short lowercase name, the same one it uses as `app` in events (for example `castaway`, `askwick`).
2. **Replace the content:**
   - `img/`: `icon.png` (512 px), `icon-180.png`, `favicon.png` (64 px), `shot-1.jpg` …, and `share.jpg` (1200×630).
   - `index.html`: name, one-line pitch, features, screenshots and their alt text, and the `og:` tags.
   - `privacy/index.html`: rewrite it for what *your* game actually does. Keep the same headings, but list your game's own events (or say it sends none), and cover anything else it touches (AI services, accounts, photos). The policy must match the App Store privacy details exactly.
   - `support/index.html`: your game's own FAQ.
3. **Add a card.** Add one `<a class="game">` to `docs/index.html`, newest first.
4. **Use these store URLs:**
   - Privacy: `https://apps.mclabs.xyz/<game>/privacy/`
   - Support: `https://apps.mclabs.xyz/<game>/support/`
   - Marketing: `https://apps.mclabs.xyz/<game>/`
5. **Keep the look.** Write links relative (`../assets/style.css`), so pages also work in the local preview. Reuse the classes in `assets/style.css` (`hero`, `stitch`, `game`, `shots`, `features`, `note`, `doc`, `details`). Add new styles there only if they're generic, and check both light and dark mode at phone width (390 px).

Pushing to `main` publishes within a minute or two.

## Events

One endpoint for every game. It keeps **counts only**. No device, advertising, user or install IDs are sent or stored. No IP addresses are stored, request logs are off, and nothing in the Worker logs.

### Sending

```
POST https://events.mclabs.xyz/v1/events
Content-Type: application/json

{"events": [
  {"app": "stitchwork", "event": "install", "version": "1.0", "date": "2026-10-20"},
  {"app": "stitchwork", "event": "opened",  "version": "1.0", "date": "2026-10-21", "days": 1}
]}
```

A single event object without the `events` wrapper also works.

| Field | Rules |
| --- | --- |
| `app` | One of the allowed apps: `APPS` in `events/wrangler.toml`, currently `stitchwork`, `castaway`, `askwick` and `test`. Add yours there and redeploy. |
| `event` | Lowercase letters, digits and `_`, starting with a letter, at most 32 characters. |
| `version` | The game version, for example `1.0`. Letters, digits, `.`, `+` and `-`, at most 20 characters. |
| `date` | The day in UTC, `YYYY-MM-DD`. Never a time. Accepted from 45 days ago to tomorrow, so events queued offline still count. |
| `days` | **Only** on `opened`: days since install, `0`, `1` or `7`. Refused on any other event. |

Any other field is refused, as are more than 50 events per request. A batch with one bad event counts none (`400` and a reason), so never resend a refused batch. Success is `200 {"ok":true,"counted":N}`.

### The shared event set

Use these names so the games can be compared. Send each one **at most once per install**: remember on the device what's been sent, and send nothing that identifies the install.

| Event | When |
| --- | --- |
| `install` | First launch |
| `tutorial_done` | The game's tutorial is finished (each game defines the moment) |
| `job1_finished` | The first real task, level or quest is done (pick the closest name if "job" doesn't fit, and list it here) |
| `unlock_shown` | The purchase offer is seen for the first time |
| `unlock_bought` | The purchase is made. Not a restore. |
| `opened` with `days` 0, 1 or 7 | The game is opened that many days after install, counted on launch and on return from the background |

### Client rules

- **Release builds only.** Development builds send nothing, or send as `app: "test"` when testing, so they don't skew the real numbers.
- **Queue on the device.** Send in batches, retry later when offline or on a 5xx error, and drop a batch on any 4xx.
- **Declare it.** On the App Store: Data Not Linked to You → Usage Data → Product Interaction, purpose Analytics. Not used for tracking, so no tracking prompt. Add a matching "Anonymous counts" section to your privacy policy.
- **Reference implementation:** `Stitchwork/Stitchwork/Assets/Stitchwork/Runtime/Platform/EventSender.cs` (Unity, C#).

### Reading the counts

- `https://events.mclabs.xyz/?key=<READ_KEY>` shows a table of the last 30 days.
- Add `&app=stitchwork`, `&from=2026-10-01`, `&to=2026-10-31` to narrow it, or `&by=version` to split by version.
- `GET /v1/counts` takes the same parameters and returns JSON. Send the key as `Authorization: Bearer <READ_KEY>`.

The read key is a Worker secret; the owner has it. To change it: `npx wrangler secret put READ_KEY` in `events/`.

### Changing the counter

```
cd events
npx wrangler dev --local --port 8799          # with READ_KEY=… in events/.dev.vars
node test/check.mjs http://127.0.0.1:8799 <key>
npx wrangler deploy                           # then: node test/check.mjs https://events.mclabs.xyz <key>
```

`test/check.mjs` posts as `app: "test"` and checks that IDs, extra fields, bad dates and `days` on the wrong event are all refused. Storage is the D1 database `mclabs-events` (`events/schema.sql`), one row per date, app, event, version and days, holding a count.
