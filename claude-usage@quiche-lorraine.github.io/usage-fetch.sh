#!/usr/bin/env bash
# Collecte la consommation du forfait Claude via l'endpoint OAuth (non documenté)
# et calcule la cadence cible 7j. Imprime un JSON compact sur stdout.
#
# Sortie :
#   {"ok":true,
#    "five_hour":{"pct":42,"resets_at":1700000000,"target_pct":30},
#    "seven_day":{"pct":18,"resets_at":1700600000,"target_pct":31,"pace_pos":2}}
#   ou {"ok":false,"error":"..."} si aucune donnée connue.
#
# Robustesse : cache disque (TTL) qui évite de marteler l'endpoint et sert la
# dernière valeur connue en cas d'erreur réseau / 429 / token expiré.
#
# CLAUDE_TRAY_MOCK=1 : données factices (test affichage/alertes), sans cache.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRED="$HOME/.claude/.credentials.json"
ENDPOINT="https://api.anthropic.com/api/oauth/usage"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/gnome-claude-usage"
CACHE="$CACHE_DIR/usage.json"
TTL="${CLAUDE_TRAY_TTL:-120}"
mkdir -p "$CACHE_DIR"

# Sert le dernier résultat connu (même périmé), sinon échec explicite.
emit_cache_or_fail() {
  if [ -s "$CACHE" ]; then
    cat "$CACHE"
  else
    echo "{\"ok\":false,\"error\":\"$1\"}"
  fi
}

# --- Données factices ---
if [ "${CLAUDE_TRAY_MOCK:-}" = "1" ]; then
  NOW=$(date +%s)
  R5=$((NOW + 9000)); R7=$((NOW + 345600))
  printf '%s' "{\"five_hour\":{\"utilization\":88,\"resets_at\":$R5},\"seven_day\":{\"utilization\":40,\"resets_at\":$R7}}" \
    | python3 "$SCRIPT_DIR/pace.py"
  exit 0
fi

# --- Cache encore frais : on sert sans appeler l'API ---
if [ -s "$CACHE" ]; then
  NOW=$(date +%s); MTIME=$(stat -c %Y "$CACHE" 2>/dev/null || echo 0)
  if [ $((NOW - MTIME)) -lt "$TTL" ]; then
    cat "$CACHE"; exit 0
  fi
fi

# --- Token OAuth local (jamais affiché) ---
TOKEN=$(python3 -c "import json;print(json.load(open('$CRED'))['claudeAiOauth']['accessToken'])" 2>/dev/null)
if [ -z "${TOKEN:-}" ]; then
  emit_cache_or_fail "no_token"; exit 0
fi

# --- Appel API avec code HTTP ---
RAW=$(curl -s -m 8 -w '\n__HTTP__%{http_code}' "$ENDPOINT" \
  -H "Authorization: Bearer $TOKEN" \
  -H "anthropic-beta: oauth-2025-04-20" 2>/dev/null)
CODE="${RAW##*__HTTP__}"
BODY="${RAW%__HTTP__*}"

if [ "$CODE" != "200" ]; then
  emit_cache_or_fail "http_${CODE:-network}"; exit 0
fi

# --- Normalisation ; pace.py renvoie ok:false si pas de données exploitables ---
NORM=$(printf '%s' "$BODY" | python3 "$SCRIPT_DIR/pace.py")
if printf '%s' "$NORM" | grep -q '"ok": true'; then
  printf '%s\n' "$NORM" | tee "$CACHE"
else
  emit_cache_or_fail "no_data"
fi
