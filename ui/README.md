# ui

MetaAgri dashboard: a multi-level Streamlit view onto the farm digital twin
(Earth → Germany → Oderbruch → Farm → Field).

## Run

```
cd ui
uv sync
uv run streamlit run app.py        # serves on http://localhost:8601 (.streamlit/config.toml)
```

`HUB_URL` env var (default `http://127.0.0.1:8100`) points the dashboard at a running farm hub
(`hub/`). If it's unreachable, the dashboard still renders every page from built-in mock data
(`MOCK_STATE` / `MOCK_LOG` / `MOCK_INBOX` / `MOCK_NOTICES` + mock history/plans/reports, one
coherent "Wed 8 Jul, heatwave + hail warning" day) and shows a warning banner instead of crashing.
The action buttons are disabled while the hub is down.

## Check

`uv run pytest -q` runs the dashboard tests (AppTest against an in-memory fake hub: reject reasons,
buttons disabled mid-tick, hub refusals, the field map, legend colours). To also render every
route headless against a real hub (no browser needed), run this once with the hub up
(`PETAL_MODE=mock uv run uvicorn hub.main:app --port 8100` in `hub/`) and once with it down;
both must print only `OK`:

```bash
cd ui
HUB_URL=http://127.0.0.1:8100 uv run python - <<'EOF'
from streamlit.testing.v1 import AppTest
routes = [{"level": "1"}, {"level": "2"}, {"level": "3"}, {"farm": "lerchenbruch"},
          {"farm": "lerchenbruch", "field": "North"}, {"farm": "lerchenbruch", "field": "West"},
          {"farm": "lerchenbruch", "field": "River"}, {"farm": "rohrdommelsee"}, {"farm": "oderblick"}]
for params in routes:
    at = AppTest.from_file("app.py", default_timeout=60)
    for key, value in params.items():
        at.query_params[key] = value
    at.run()
    print(params, [e.value for e in at.exception] or "OK")
EOF
```

## Navigation

Everything is driven by query params, so every view has a shareable URL:

| URL                              | View                                                    |
|-----------------------------------|----------------------------------------------------------|
| `?level=1` (default)              | 🌍 Earth: world map with the Germany outline             |
| `?level=2`                        | 🇩🇪 Germany: the Oderbruch dot in Brandenburg            |
| `?level=3`                        | 🌾 Oderbruch: the three farms, coloured by status        |
| `?farm=lerchenbruch`                | full dashboard of our farm, Hof Lerchenbruch               |
| `?farm=lerchenbruch&field=River`    | same, with the River field detail open                   |
| `?farm=rohrdommelsee` / `oderblick`  | lighter neighbour view (Gut Rohrdommelsee / Agrarhof Oderblick) |

Unknown values fall back safely (`?level=9` → Earth, `?farm=nope` → map, `?field=nope` is dropped).

## Layout

The hub sends human-friendly names directly (actor values in `/log`, `plan_for`, `plan_rows`,
etc.) - the code names behind them (`hub/thorn.py`, `hub/stem.py`, `agents/petal/`) never show
up in the UI:

| Shown as                             | Code name                                  |
|---------------------------------------|---------------------------------------------|
| Safety check                          | `hub/thorn.py` (Thorn)                     |
| Coordinator                           | `hub/stem.py` (Stem)                       |
| Machinery ring                        | the neighbour-help step in `hub/stem.py`   |
| North / West / River field agent      | `agents/petal/` (one per field)            |
| Farm                                  | the hub server itself                      |
| Farm manager                          | the human approving plans                  |
| Plan for Wed 8 Jul                    | a bundle                                   |
| 🔥 Heatwave / ⛈️ Hail warning          | `/scenario/heatwave`, `/scenario/hail`     |

A handful of labels are UI-only display choices (not sent by the backend): Next day / Restart
season for the tick/reset buttons, "Team conversation" for the log panel, "What buyers &
neighbours see" for the notices expander, "Silo" for storage, "stress below N%" for
`stress_threshold_pct`. The tick counter is never shown - always the date.

Map pages (`?level=1|2|3`): breadcrumb buttons (🌍 Earth › 🇩🇪 Germany › 🌾 Oderbruch), "Go to
Germany ➜" / "Go to Oderbruch ➜", pydeck maps on the CARTO dark basemap with a smooth
`transition_duration`. On level 3 each farm is a glowing dot coloured by `farm_status_color()`
(red if average soil moisture < 35 % or the silo is > 95 % full, amber if < 45 % or > 85 %,
else green) with a tooltip (crops, silo free, combine, soil moisture); click a dot or a card
button below the map to open that farm. Our three fields are drawn as small polygons too.

Farm dashboard (`?farm=lerchenbruch`), top to bottom:

- **Top bar**: "🌾 MetaAgri · Hof Lerchenbruch", the date metric ("Wednesday 8 July"), a
  "synthetic data" badge and an "Agents: Flower SuperGrid" / "Agents: simulated" badge from
  `/status.mode`; below them, on their own row so the labels fit at 1024 px, the ⏭ Next day / 🔥
  Heatwave / ⛈️ Hail warning / 🔄 Restart season buttons. While a tick runs, a banner reads "🧠
  Field agents are thinking… (n/3 done)" (inferred from `/log`) and all four buttons are
  disabled (a reset or scenario mid-tick would land in the middle of that day's plan; the hub
  also answers 409 then). `/tick` is fire-and-forget on a thread, because a grid-mode tick can
  take minutes.
- **Scenario banners**: one per active scenario from `/state.scenario` - red for the heatwave
  (with days left), amber for the hail warning. Then "← Back to Oderbruch".
- **Weather strip**: today + the 3-day forecast (☀️ 🌤️ 🌧️ ⛈️ 🔥, max temp, rain, wind, ET₀);
  the hail day gets a red border and a HAIL chip.
- **Resource strip**: water permit today (red when cut below the normal permit), workers,
  combine, sprayer, silo (free t + a fill bar).
- **Hero row**: (a) the **hero flower** - a pure HTML/SVG panel built in `build_hero_svg()`,
  rendered in a same-origin iframe (`st.iframe`, falling back to `components.html` on older
  Streamlit). One petal per field (North points up, West lower-left, River lower-right), size ∝
  √area, colour by soil moisture vs the crop's stress threshold (rust below it, amber within 10
  points, green comfortable), pale straw once harvested, light green with a cover crop. A petal
  pulses red below its stress threshold and pulses gently when its agent just proposed; ripe,
  unharvested wheat or rapeseed shakes while a hail warning is active. The centre shows the date and 🧑‍🌾
  (the farm manager); the stem grows a red thorn per safety-check block today; 🔥 / ⛈️ flag the
  active scenarios. Today's approved actions (`/state.recent_actions`) are animated, CSS-only and
  under 1.5 s per loop: a grain dot travels petal → centre (the silo) for a harvest, a 💧 falls
  onto the petal for irrigation, a mist ring spreads for spraying, a grain dot leaves to the
  right for a delivery to a neighbour. Clicking a petal adds `?field=X` to the page URL (the
  iframe's sandbox forbids setting `window.parent.location`, so the script clicks a link it
  creates in the parent document). (b) the **field map** - a pydeck `PolygonLayer` of the three
  field polygons in the same colours, a farmyard point, a tooltip (crop, stage, moisture,
  yield); clicking a field sets `?field=X` as well.
- **Farm strip**: one card per farm (ours first): status dot, silo free, combine free/busy,
  average soil moisture.
- **Field detail**: the "Field detail (or click a petal / field)" selectbox is the no-JS fallback
  and stays in sync with `?field`. Shows `field_moisture_chart_svg()` - soil moisture history
  from `/history/{field}`, a dashed 3-day projection (forecast weather, no irrigation), a dashed
  stress-threshold line over a shaded stress band, and rain / irrigation bars - then soil
  moisture / crop health / disease pressure / yield estimate metrics, harvest status, last
  irrigation/spray/rejection, and the field's last 3 plans from `/plans/{field}`.
- **Fields** (left): one tile per field - crop emoji, crop, stage chip, area, a moisture bar with
  a tick at the stress threshold, health, disease, "Ready to harvest" / "N days to harvest",
  yield estimate. A tile pulses rust below its stress threshold and gets a red border + ⛈️ when
  the hail threatens it.
- **Team conversation** (centre): `/log`, newest first, monospace, prefixed with the date,
  colour-coded by level, with an inferred icon per line (🛡️ safety-check block, ✅ approved, ❌
  rejected, 🧭 Coordinator, 🚜 Machinery ring / farm names, 💧 irrigation, 🌾 harvest). A
  rejection reads "Farm manager: rejected the Wed 8 Jul plan: `<reason>`".
- **Inbox** (right): plan cards from `/inbox` - "🧭 Plan for Wed 8 Jul", the resource line
  "Water 6,500→500 m³ · Workers 5→2 · Combine 1→0 · Silo free 330→2 t" from
  `resources_before`/`resources_after` (the sprayer only when the plan uses it), a table (Field |
  Crop | Action | Resources | Confidence bar | Reason), overall confidence (amber "low confidence
  — review carefully" below 0.5), the Coordinator's summary, "🛡️ Safety check blocked:" lines
  with the exact rule, a "🚜 Neighbour help" section listing each farm's `can_share` when the plan
  has `borrow_combine` or `deliver_to`, and ✅ Approve / ❌ Reject. Reject uses a plain-language
  reason dropdown (`REJECT_REASONS`: not enough workers, soil too wet to drive on, wait for better
  weather, wrong priority order, a neighbour farm should help, or "Other" revealing a free-text
  box) with the caption "Your reason is sent back to the field agents and shapes their next plan."
  "Other" with an empty box sends nothing: Reject shows "Type a reason first." instead.
- **Bottom**: a "📣 What buyers & neighbours see" expander rendering `/notices` as cards with an
  audience chip and the date.

Neighbour view (`?farm=rohrdommelsee|oderblick`): ← Back to Oderbruch, tiles (silo free /
capacity, combine, soil moisture, crops), `farm_history_chart_svg()` of free silo space and
average soil moisture since Mon 6 Jul (plus a combine free/busy dot per day) from
`/history/farm/{name}`, the last 3 reports from that farm's agent (`/farm-reports/{name}`), and
the caption "Detailed twin available for Hof Lerchenbruch in this demo."

All charts are hand-rolled SVG/HTML - no `altair` / `pandas` / `st.*_chart`: those are broken
under this project's Python (3.14), where altair's schema module uses `TypedDict(closed=True)`.
Every hub value is read defensively (`.get`, type checks) and all text is HTML-escaped, so a
partial or malformed hub response degrades a widget instead of crashing the page.

The page auto-refreshes every 2 seconds (`streamlit_autorefresh`); actions also trigger an
immediate rerun so the demo feels responsive.
