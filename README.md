# Claude Usage — quota gauges in the GNOME top bar

GNOME Shell extension that permanently displays your **Claude subscription** quota
(Pro / Max / Team) in the Ubuntu top bar:

- **2 gauges**: sliding **5h** window and **7-day** window (coloured progress bars);
- **pacing target** on the 7-day bar: a white marker shows where you *should* be, so you can spot over-consumption at a glance;
- **click for details**: exact percentages, reset countdowns, pace indicator;
- **alerts**: colour coding (green / orange / red) + GNOME notification at thresholds, **configurable** in preferences.

![Gauges in the top bar](docs/jauges.png)

<details><summary>Detail menu & Preferences</summary>

![Detail menu](docs/menu.png)

![Preferences](docs/prefs.png)

</details>

## Requirements

- Ubuntu with **GNOME Shell 46+**.
- `python3`, `curl`, `libglib2.0-bin`, `gettext` (all present by default on Ubuntu).
- A **Claude Pro / Max / Team account** + one of the token sources below (see [Authentication](#authentication)).

## Installation

```bash
git clone https://github.com/quiche-lorraine/gnome-claude-usage.git
cd gnome-claude-usage
./install.sh        # or: make install
```

Then, **on Wayland** (default Ubuntu session), **log out and back in once** so GNOME Shell
picks up the extension. (On X11: `Alt+F2` → `r`.)

Update: `git pull && make install`.
Uninstall: `make uninstall`.

## Authentication

The extension needs a Claude OAuth token. It accepts **two sources** (in this order):

1. **Dedicated extension login** (recommended, works for everyone):
   open preferences (extension menu → **"Preferences…"**, or
   `gnome-extensions prefs claude-usage@quiche-lorraine.github.io`), section **Claude Connection**:
   1. **Open browser** → authorise access on `claude.ai`;
   2. **paste the code** shown into the field;
   3. **Validate code**.

   The token is stored in `~/.config/gnome-claude-usage/credentials.json` and
   **refreshed automatically** by the extension.

   <details><summary>Command line (alternative)</summary>

   ```bash
   python3 ~/.local/share/gnome-shell/extensions/claude-usage@quiche-lorraine.github.io/oauth-login.py
   ```
   </details>

2. **Claude Code CLI token**: if `~/.claude/.credentials.json` exists (CLI connected),
   the extension uses it with no additional login. It stays fresh as long as you run Claude Code
   occasionally.

> **Claude Desktop** is **not** a usable source: it authenticates via a `claude.ai` web session
> (encrypted cookies), not the OAuth token the endpoint expects. Desktop-only users must use the
> **dedicated login** (option 1).

## Settings

```bash
gnome-extensions prefs claude-usage@quiche-lorraine.github.io
```

- Claude Connection (3-step dedicated login, see [Authentication](#authentication))
- Notifications on / off
- Warning threshold (default 80%) and critical threshold (default 95%)
- Refresh interval (default 180 s)

## How it works

- `oauth-login.py` handles the dedicated login (PKCE flow); preferences call it in two steps
  (`--prepare` for the authorisation URL, `--complete <code>` for the code exchange).
- `resolve-token.py` provides an access token: dedicated credentials (with auto-refresh), falling
  back to the CLI token.
- `usage-fetch.sh` queries `GET https://api.anthropic.com/api/oauth/usage` (the same figures as
  `/usage`), with a **disk cache** (`~/.cache/gnome-claude-usage/`, TTL 120 s) that serves the
  last known value on error / 429.
- `pace.py` normalises the response and computes the 7-day pacing in **business days** (Europe/Paris).
- The extension reads this JSON every ~180 s and updates the gauges.

> ⚠ The OAuth endpoint and login flow are **not documented** by Anthropic and may change;
> the login reuses Claude Code's public OAuth client. All the logic is isolated in
> `resolve-token.py` / `oauth-login.py` / `usage-fetch.sh`. On error, gauges show "unavailable"
> without crashing the shell.

## Troubleshooting

```bash
make test         # test data collection alone (outside GNOME)
make test-mock    # fake data (checks colours + notifications)
make logs         # GNOME Shell logs filtered for this extension
```

- *"unavailable" gauges*: no token → do the **dedicated login** (see Authentication),
  or launch Claude Code if you're using the CLI token. Check with `make test`.
- *Extension missing after install*: Wayland re-login required; check with
  `gnome-extensions info claude-usage@quiche-lorraine.github.io`.
