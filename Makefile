UUID := claude-usage@quiche-lorraine.github.io
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC := $(UUID)

.PHONY: install uninstall enable disable reload prefs logs test

install:
	@mkdir -p "$(EXT_DIR)"
	@cp -r $(SRC)/. "$(EXT_DIR)/"
	@chmod +x "$(EXT_DIR)/usage-fetch.sh" "$(EXT_DIR)/pace.py" \
	          "$(EXT_DIR)/resolve-token.py" "$(EXT_DIR)/oauth-login.py"
	@glib-compile-schemas "$(EXT_DIR)/schemas"
	@gnome-extensions enable $(UUID) 2>/dev/null || true
	@gnome-extensions info $(UUID) 2>/dev/null | grep -q "Activé: Oui" || \
	  python3 -c "import subprocess,ast; \
c=subprocess.check_output(['gsettings','get','org.gnome.shell','enabled-extensions']).decode().strip(); \
l=ast.literal_eval(c) if c and c!='@as []' else []; \
l.append('$(UUID)') if '$(UUID)' not in l else None; \
subprocess.run(['gsettings','set','org.gnome.shell','enabled-extensions',str(l)])"
	@echo ""
	@echo "✓ Installé dans $(EXT_DIR)"
	@echo "→ Rechargez GNOME Shell : Alt+F2 puis 'r' (X11) ou déconnexion/reconnexion (Wayland)."

uninstall:
	@gnome-extensions disable $(UUID) || true
	@rm -rf "$(EXT_DIR)"
	@echo "✓ Désinstallé."

enable:
	@gnome-extensions enable $(UUID)

disable:
	@gnome-extensions disable $(UUID)

prefs:
	@gnome-extensions prefs $(UUID)

# Test de la collecte de données seule (sans GNOME)
test:
	@bash $(SRC)/usage-fetch.sh

# Test affichage/alertes avec données factices
test-mock:
	@CLAUDE_TRAY_MOCK=1 bash $(SRC)/usage-fetch.sh

logs:
	@journalctl -f -o cat /usr/bin/gnome-shell | grep -i claude-usage
