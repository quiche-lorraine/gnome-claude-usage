#!/usr/bin/env bash
# Installe l'extension GNOME "Claude Usage" pour l'utilisateur courant.
# Sans root. Reproductible : git pull && ./install.sh
set -euo pipefail

UUID="claude-usage@quiche-lorraine.github.io"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$UUID"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

# --- Prérequis ---
missing=()
command -v python3 >/dev/null 2>&1 || missing+=("python3")
command -v curl    >/dev/null 2>&1 || missing+=("curl")
command -v gnome-extensions >/dev/null 2>&1 || missing+=("gnome-extensions")
command -v glib-compile-schemas >/dev/null 2>&1 || missing+=("glib-compile-schemas (paquet libglib2.0-bin)")
if [ "${#missing[@]}" -gt 0 ]; then
  echo "✗ Dépendances manquantes : ${missing[*]}" >&2
  echo "  Installez-les puis relancez (ex: sudo apt install python3 curl libglib2.0-bin)." >&2
  exit 1
fi

if [ ! -f "$HOME/.claude/.credentials.json" ]; then
  echo "⚠ ~/.claude/.credentials.json introuvable."
  echo "  Connectez-vous d'abord dans Claude Code ; les jauges afficheront 'indisponible' sinon."
fi

# --- Copie ---
echo "→ Installation dans $EXT_DIR"
mkdir -p "$EXT_DIR"
cp -r "$SRC_DIR/." "$EXT_DIR/"
chmod +x "$EXT_DIR/usage-fetch.sh" "$EXT_DIR/pace.py"

# --- Schéma GSettings ---
glib-compile-schemas "$EXT_DIR/schemas"

# --- Activation ---
# Un dossier fraîchement copié n'est pas encore "découvert" par GNOME Shell :
# `gnome-extensions enable` peut alors échouer. On bascule donc dans tous les cas
# la clé dconf enabled-extensions (équivalent persistant), puis Shell l'activera.
gnome-extensions enable "$UUID" 2>/dev/null || true

if ! gnome-extensions info "$UUID" 2>/dev/null | grep -q "Activé: Oui"; then
  python3 - "$UUID" <<'PY'
import sys, subprocess, ast
uuid = sys.argv[1]
cur = subprocess.check_output(
    ["gsettings", "get", "org.gnome.shell", "enabled-extensions"]).decode().strip()
lst = ast.literal_eval(cur) if cur and cur != "@as []" else []
if uuid not in lst:
    lst.append(uuid)
    subprocess.run(["gsettings", "set", "org.gnome.shell", "enabled-extensions", str(lst)])
PY
fi

echo ""
echo "✓ Extension installée."

if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  echo "⚠ Session Wayland : déconnectez-vous puis reconnectez-vous UNE fois"
  echo "  pour que GNOME Shell charge l'extension."
else
  echo "→ Session X11 : rechargez GNOME Shell avec Alt+F2 puis 'r' (Entrée)."
  echo "  (ou déconnexion/reconnexion)."
fi
echo "  L'extension s'activera automatiquement au rechargement."
echo ""
echo "Vérifier : gnome-extensions info $UUID   (attendu : État ACTIVE)"
echo "Réglages : gnome-extensions prefs $UUID"
