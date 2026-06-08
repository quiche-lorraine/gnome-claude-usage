#!/usr/bin/env python3
"""Transforme la réponse de l'endpoint OAuth usage en JSON compact pour l'extension.

Lit la réponse brute de l'API sur stdin, calcule la cadence cible 7j
(port de ercp6/.claude/script/statusline.sh, lignes ~107-175) et imprime
un JSON normalisé sur stdout. Ne lève jamais : en cas de souci -> {"ok": false}.
"""
import os
import sys
import json
import time
import datetime

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Paris")
except Exception:  # pragma: no cover - fallback si tzdata absent
    TZ = None

WEEK = 604800  # 7 jours en secondes


def to_epoch(value):
    """resets_at peut être un epoch (int/float) ou une chaîne ISO 8601."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        s = value.strip()
        if s.isdigit():
            return int(s)
        try:
            s = s.replace("Z", "+00:00")
            return int(datetime.datetime.fromisoformat(s).timestamp())
        except Exception:
            return None
    return None


def to_pct(d):
    v = d.get("utilization")
    if v is None:
        v = d.get("used_percentage")  # tolérance de nommage
    if v is None:
        return None
    try:
        return max(0, min(100, round(float(v))))
    except Exception:
        return None


def local_weekday(ts):
    """0=lundi .. 6=dimanche (datetime.weekday), heure locale Europe/Paris."""
    dt = datetime.datetime.fromtimestamp(ts, TZ) if TZ else datetime.datetime.fromtimestamp(ts)
    return dt.weekday()


def working_days_until(start_ts, deadline_ts):
    """Nombre de jours ouvrés (lun-ven) entre start et deadline inclus."""
    count = 0
    ts = start_ts
    while ts <= deadline_ts:
        if local_weekday(ts) not in (5, 6):  # 5=samedi, 6=dimanche
            count += 1
        ts += 86400
    return count


def working_seconds(start, end):
    """Secondes situées hors samedi/dimanche entre start et end (heure locale)."""
    if end <= start:
        return 0.0
    total = 0.0
    cur = start
    while cur < end:
        dt = datetime.datetime.fromtimestamp(cur, TZ) if TZ else datetime.datetime.fromtimestamp(cur)
        next_mid = (dt.replace(hour=0, minute=0, second=0, microsecond=0)
                    + datetime.timedelta(days=1)).timestamp()
        seg_end = min(next_mid, end)
        if dt.weekday() not in (5, 6):  # 5=samedi, 6=dimanche
            total += seg_end - cur
        cur = seg_end
    return total


def compute_pace(seven_pct, seven_reset, now, skip_weekends=False):
    """Retourne (target_pct, pace_pos) ; pace_pos in 1..5, ou (None, None)."""
    if seven_pct is None or seven_reset is None:
        return None, None

    window_start = seven_reset - WEEK
    elapsed = now - window_start
    if skip_weekends:
        total_work = working_seconds(window_start, seven_reset)
        expected = (working_seconds(window_start, now) / total_work) * 100 if total_work > 0 else 0.0
    else:
        expected = (elapsed / WEEK) * 100 if elapsed > 0 else 0.0
    target_pct = max(0, min(100, round(expected)))

    pace_ratio = (seven_pct / expected) if expected > 2 else -1.0

    # Deadline effective : si le reset tombe le week-end, on l'avance au vendredi.
    reset_dow = local_weekday(seven_reset)  # 0=lun .. 6=dim
    if reset_dow == 6:      # dimanche
        eff_deadline = seven_reset - 2 * 86400
    elif reset_dow == 5:    # samedi
        eff_deadline = seven_reset - 86400
    else:
        eff_deadline = seven_reset

    work_days_left = working_days_until(now, eff_deadline)
    today_is_weekday = local_weekday(now) not in (5, 6)

    if seven_pct >= 90 or pace_ratio >= 2.0:
        pos = 5
    elif pace_ratio >= 1.4:
        pos = 4
    elif pace_ratio >= 0.6:
        pos = 3
    elif today_is_weekday and work_days_left <= 2:
        pos = 1
    elif pace_ratio >= 0.0:
        pos = 2
    else:
        pos = 3

    return target_pct, pos


def main():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
    except Exception:
        print(json.dumps({"ok": False, "error": "bad_json"}))
        return

    # L'API peut éventuellement imbriquer les données ; on cherche aux deux niveaux.
    if "five_hour" not in data and "seven_day" not in data:
        for key in ("usage", "rate_limits", "data"):
            inner = data.get(key)
            if isinstance(inner, dict) and ("five_hour" in inner or "seven_day" in inner):
                data = inner
                break

    fh = data.get("five_hour") or {}
    sd = data.get("seven_day") or {}

    now = time.time()
    five_pct = to_pct(fh)
    seven_pct = to_pct(sd)

    # Aucune donnée d'usage exploitable (corps d'erreur 429/401, format inattendu…)
    if five_pct is None and seven_pct is None:
        print(json.dumps({"ok": False, "error": "no_usage_fields"}))
        return

    five_reset = to_epoch(fh.get("resets_at"))
    seven_reset = to_epoch(sd.get("resets_at"))

    skip_weekends = os.environ.get("CLAUDE_TRAY_SKIP_WEEKEND") == "1"
    target_pct, pace_pos = compute_pace(seven_pct, seven_reset, now, skip_weekends=skip_weekends)

    # Cible 5h : proportion linéaire du temps écoulé dans la fenêtre glissante.
    five_target = None
    if five_pct is not None and five_reset is not None:
        elapsed5 = now - (five_reset - 5 * 3600)
        if elapsed5 > 0:
            five_target = max(0, min(100, round((elapsed5 / (5 * 3600)) * 100)))

    out = {
        "ok": True,
        "five_hour": {"pct": five_pct, "resets_at": five_reset, "target_pct": five_target},
        "seven_day": {
            "pct": seven_pct,
            "resets_at": seven_reset,
            "target_pct": target_pct,
            "pace_pos": pace_pos,
        },
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
