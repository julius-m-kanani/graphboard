# Graphboard

A lightweight, no-install classroom graph-paper workspace for drawing a Cartesian plane as naturally as a student would.

Open `index.html` in a modern browser. It includes graph-paper styles, pan/zoom, grid snapping, coloured ink, pencil, points, straight lines, ruler, compass, protractor, eraser, undo/redo, PNG export, and equation plotting. The compass behaves as a construction tool: click once to plant its needle, then drag the pencil leg around the centre to draw the arc yourself.

The snap setting is flexible: choose **1 unit**, **½ unit** or **Free** from the *Snap to* control so points and lines can be placed anywhere, not just on grid intersections. The coordinate readout (bottom right) always shows the exact pointer position, the endpoints and length of a line while drawing, and the coordinate of the nearest point on any existing line or circle as you hover.

## Classroom geometry set

The toolbar models the standard school kit as individual, usable instruments:

- **Pencil** — freehand graphite-like drawing, with the pencil visible while it moves.
- **Compass** — plant the metal needle, open the pencil leg, and sweep arcs or circles.
- **Dividers** — click two points to hold a span; click a new location to transfer the same distance.
- **15 cm ruler** — a marked transparent ruler guides arbitrary straight lines.
- **45° set square** — constrains a line to a 45° or 90° edge.
- **30°/60° set square** — constrains a line to a 30°, 60° or 90° edge.
- **Protractor** — draws and labels an angle from its baseline.
- **Rubber / eraser** — removes the nearest construction mark.
- **Move** — click any mark (point, line, compass arc, circle, angle, pencil stroke) and drag it to a new position. Marks are moved by the same amount, so a whole construction can be relocated mark by mark.
- **Label** — click a point to rename it with maths notation (e.g. `A`, `A'`, `B''`), or click empty space to place a new labelled point.

The instruments are generic physical school-tool models drawn directly in the workspace, not copied product photographs. This lets them rotate, open, and respond to the drawing action.

## Using the compass in a lesson

1. Select **Compass** (or press `C`) and click a grid intersection to plant the needle.
2. Move to the required radius. The open compass is shown on the paper.
3. Press and hold on the pencil tip, then sweep it around the planted needle. Only the swept arc is drawn, so a full circle requires a full turn.
4. Press `Esc` to lift the compass and choose a new centre.

A quick click (release without sweeping) locks the current opening in place, so you can move the needle to a new centre and sweep an identical arc; press `Esc` to move the needle with the opening held, or `X` to release it.

## Guided perpendicular construction

The **Interactive construction** card supports two versions of the same Euclidean method:

- **On x = 0** starts with the vertical axis as the reference line.
- **On any line** lets a learner click an existing straight line or use the ruler to draw a new one, then choose the point `P` where the perpendicular should pass.

The workspace checks the traditional construction: mark equal-distance points `A` and `B` on the reference line with a compass, keep the same wide compass opening from `A` and `B` to form `C` and `D`, then draw through `C` and `D` using the ruler. It guides the process but never substitutes the finished line for the learner.

For equations, use explicit multiplication: `2*x + 1`, `x^2 - 4`, or `sin(x)` (trigonometric functions use radians).

## Run it locally

The app is plain HTML/CSS/JS, but it uses **ES modules**, so it must be served over HTTP rather than opened from `file://`.

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Architecture — a modular monolith

One deployable app, split internally into focused ES modules (`js/`). Each module imports only what it needs from a shared core, so the whole site remains a single static folder:

- `js/core.js` — shared state, DOM refs, and utilities: coordinate transforms, snapping, distance helpers, toasts, tool tips, and the render loop.
- `js/draw.js` — everything drawn on the canvas: grid, axes, marks, instrument guides, and previews; also `resizeCanvas`.
- `js/construction.js` — the guided perpendicular-construction state machine and its side panel.
- `js/history.js` — `commit`/`undo`/`redo`, history buttons, and the object counter.
- `js/input.js` — all pointer, wheel, keyboard, and button wiring; hit testing, move/label/erase, and the equation plotter.
- `js/main.js` — the thin bootstrap that wires everything and boots the app.

`index.html` is a thin shell that loads `styles.css` and `<script type="module" src="js/main.js">`.

## Classroom setup (one time)

The classroom features need the database before first use. Registration is
open: anybody can sign up as a teacher or student and start right away.

1. In the Supabase dashboard open the SQL editor and run `supabase/schema.sql` (it is idempotent — safe to re-run after updates).
2. Sign up on the site, choosing **I'm a teacher** or **I'm a student**. (Students enter their class join code at registration; teachers need none.)
3. While no administrator exists, a signed-in user gets a one-time **Claim site administrator** banner — the admin manages users and roles.
4. As a teacher: create a class, copy its **join code** from the class card, and hand it to your students.

## Deploying

### GitHub Pages (recommended)

A workflow at `.github/workflows/deploy.yml` builds the static site and publishes it to GitHub Pages on every push to `main`.

1. Push this repository to GitHub.
2. Open **Settings → Pages** and set **Source** to *GitHub Actions*.
3. The next push to `main` deploys the site automatically.

### Netlify

- Build command: *(none — static site)*
- Publish directory: `.` (repo root)
- Then enable **ES modules** — nothing to do, Netlify serves `index.html` over HTTPS.

### Vercel

- Framework preset: *Other*
- Build command: *(none)*
- Output directory: `.`

