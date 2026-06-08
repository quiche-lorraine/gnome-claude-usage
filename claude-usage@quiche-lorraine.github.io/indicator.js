import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Couleurs (RGBA 0..1)
const COLOR_OK = [0.20, 0.82, 0.48];      // vert
const COLOR_WARN = [1.00, 0.47, 0.00];    // orange
const COLOR_CRIT = [0.88, 0.11, 0.14];    // rouge
const COLOR_BG = [1, 1, 1, 0.18];
const COLOR_MARK = [1, 1, 1, 0.95];
const COLOR_DIM = [0.7, 0.7, 0.7, 1];

const BAR_W = 42;
const BAR_H = 12;

const PACE_LABELS = {
    1: 'très lent',
    2: 'lent',
    3: 'parfait',
    4: 'rapide',
    5: 'trop rapide',
};

// Une barre de progression dessinée au Cairo, avec marqueur de cible optionnel.
const UsageBar = GObject.registerClass(
class UsageBar extends St.DrawingArea {
    _init() {
        super._init({
            width: BAR_W,
            height: BAR_H,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-usage-bar',
        });
        this._pct = null;
        this._target = null;
        this._color = COLOR_DIM;
        this.connect('repaint', this._onRepaint.bind(this));
    }

    setData(pct, color, target = null) {
        this._pct = pct;
        this._color = color;
        this._target = target;
        this.queue_repaint();
    }

    _onRepaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();

        // Fond
        cr.setSourceRGBA(...COLOR_BG);
        cr.rectangle(0, 0, w, h);
        cr.fill();

        if (this._pct !== null && this._pct !== undefined) {
            const fillW = Math.max(0, Math.min(1, this._pct / 100)) * w;
            const c = this._color;
            cr.setSourceRGBA(c[0], c[1], c[2], c.length > 3 ? c[3] : 1);
            cr.rectangle(0, 0, fillW, h);
            cr.fill();
        }

        // Marqueur de cible (barre blanche)
        if (this._target !== null && this._target !== undefined) {
            const x = Math.max(0, Math.min(1, this._target / 100)) * w;
            cr.setSourceRGBA(...COLOR_MARK);
            cr.rectangle(Math.max(0, x - 1), -1, 2, h + 2);
            cr.fill();
        }

        cr.$dispose();
    }
});

export const ClaudeUsageIndicator = GObject.registerClass(
class ClaudeUsageIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Claude Usage');
        this._extension = extension;
        this._settings = extension.getSettings();
        this._timeoutId = 0;
        this._cancellable = null;
        this._hasData = false;
        // Niveau d'alerte déjà notifié par fenêtre : 0=aucun, 1=warn, 2=crit
        this._notified = { five: 0, seven: 0 };

        // --- Affichage dans la barre ---
        const box = new St.BoxLayout({ style_class: 'claude-usage-box' });

        // Logo Claude à gauche
        box.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(
                GLib.build_filenamev([extension.path, 'icons', 'claude.svg'])),
            icon_size: 16,
            style_class: 'claude-usage-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        box.add_child(new St.Label({
            text: '5h', style_class: 'claude-usage-tag',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._bar5 = new UsageBar();
        box.add_child(this._bar5);

        box.add_child(new St.Label({
            text: '7j', style_class: 'claude-usage-tag',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._bar7 = new UsageBar();
        box.add_child(this._bar7);

        this.add_child(box);

        // --- Menu (détail) ---
        this._loginItem = new PopupMenu.PopupMenuItem('⚠ Non connecté — Ouvrir les préférences');
        this._loginItem.connect('activate', () => this._extension.openPreferences());
        this._loginItem.hide();
        this.menu.addMenuItem(this._loginItem);

        this._item5 = new PopupMenu.PopupMenuItem('5h : …', { reactive: false });
        this._item7 = new PopupMenu.PopupMenuItem('7j : …', { reactive: false });
        this.menu.addMenuItem(this._item5);
        this.menu.addMenuItem(this._item7);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Actualiser maintenant');
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);

        const prefsItem = new PopupMenu.PopupMenuItem('Préférences…');
        prefsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefsItem);

        // Réagir aux changements de réglages (intervalle notamment)
        this._settingsChangedId = this._settings.connect('changed', (s, key) => {
            if (key === 'poll-interval') this._scheduleTimer();
            if (key === 'last-login') this._refresh();
        });

        this._scheduleTimer();
        this._refresh();
    }

    _scheduleTimer() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        const interval = this._settings.get_int('poll-interval');
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Couleur selon l'avance sur la cible (repère blanc), avec garde-fou
    // rouge si on frôle le plafond absolu.
    _colorFor(pct, target) {
        if (pct === null || pct === undefined)
            return COLOR_DIM;

        const crit = this._settings.get_int('threshold-critical');
        if (pct >= crit)
            return COLOR_CRIT; // proche du plafond -> rouge quoi qu'il arrive

        // Pas de cible fiable (début de fenêtre) -> seuils absolus
        if (target === null || target === undefined || target <= 2) {
            const warn = this._settings.get_int('threshold-warn');
            return pct >= warn ? COLOR_WARN : COLOR_OK;
        }

        const ratio = pct / target;
        if (ratio >= 2.0) return COLOR_CRIT; // très en avance sur la cadence
        if (ratio >= 1.4) return COLOR_WARN; // en avance
        return COLOR_OK;                     // dans les temps / en retard
    }

    _refresh() {
        const script = GLib.build_filenamev([this._extension.path, 'usage-fetch.sh']);
        let proc;
        try {
            proc = Gio.Subprocess.new(
                ['bash', script],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            logError(e, 'claude-usage: spawn failed');
            this._onError();
            return;
        }
        this._cancellable = new Gio.Cancellable();
        proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
            let stdout = '';
            try {
                [, stdout] = p.communicate_utf8_finish(res);
            } catch (e) {
                this._onError();
                return;
            }
            let data = null;
            try {
                data = JSON.parse(stdout);
            } catch (e) {
                this._onError();
                return;
            }
            if (!data || !data.ok) {
                if (data?.error === 'no_token')
                    this._showNotConnected();
                else
                    this._onError();
                return;
            }
            this._update(data);
        });
    }

    // Erreur transitoire (429, réseau, token momentané) : on conserve les
    // dernières valeurs affichées. On ne vide les jauges que si on n'a jamais
    // eu de données depuis l'activation.
    _onError() {
        if (!this._hasData)
            this._showUnavailable();
    }

    _showNotConnected() {
        this._bar5.setData(null, COLOR_DIM, null);
        this._bar7.setData(null, COLOR_DIM, null);
        this._item5.label.text = 'Non connecté';
        this._item7.label.text = 'Ouvre les préférences pour te connecter';
        this._loginItem.show();
        this._notified = { five: 0, seven: 0 };
    }

    _showUnavailable() {
        this._bar5.setData(null, COLOR_DIM, null);
        this._bar7.setData(null, COLOR_DIM, null);
        this._item5.label.text = '5h : indisponible';
        this._item7.label.text = '7j : indisponible';
        this._loginItem.hide();
        this._notified = { five: 0, seven: 0 };
    }

    _update(data) {
        const fh = data.five_hour || {};
        const sd = data.seven_day || {};
        const p5 = fh.pct;
        const p7 = sd.pct;
        const target = sd.target_pct;
        const pacePos = sd.pace_pos;

        this._loginItem.hide();
        this._bar5.setData(p5, this._colorFor(p5, fh.target_pct), fh.target_pct ?? null);
        this._bar7.setData(p7, this._colorFor(p7, target), target);

        let line5 = `5h glissantes : ${this._fmtPct(p5)}`;
        if (fh.target_pct !== null && fh.target_pct !== undefined)
            line5 += ` (cible ${fh.target_pct}%)`;
        line5 += this._fmtReset(fh.resets_at);
        this._item5.label.text = line5;

        let line7 = `7 jours : ${this._fmtPct(p7)}`;
        if (target !== null && target !== undefined)
            line7 += ` (cible ${target}%)`;
        if (pacePos)
            line7 += ` · ${PACE_LABELS[pacePos]}`;
        line7 += this._fmtReset(sd.resets_at);
        this._item7.label.text = line7;

        this._maybeNotify('five', p5);
        this._maybeNotify('seven', p7);

        if (p5 !== null && p5 !== undefined || p7 !== null && p7 !== undefined)
            this._hasData = true;
    }

    _fmtPct(pct) {
        return (pct === null || pct === undefined) ? 'n/a' : `${pct}%`;
    }

    _fmtReset(epoch) {
        if (!epoch) return '';
        const now = GLib.DateTime.new_now_local().to_unix();
        const diff = epoch - now;
        if (diff <= 0) return '';
        const mins = Math.floor(diff / 60);
        const hours = Math.floor(mins / 60);
        const days = Math.floor(hours / 24);
        if (days >= 1)
            return ` · reset dans ${days}j ${hours % 24}h`;
        if (hours >= 1)
            return ` · reset dans ${hours}h${String(mins % 60).padStart(2, '0')}`;
        return ` · reset dans ${mins}m`;
    }

    _maybeNotify(which, pct) {
        if (pct === null || pct === undefined)
            return;
        if (!this._settings.get_boolean('notifications-enabled')) {
            // On garde le suivi du niveau pour ne pas spammer si réactivé
            this._notified[which] = this._levelFor(pct);
            return;
        }
        const level = this._levelFor(pct);
        const prev = this._notified[which];
        if (level > prev) {
            const label = which === 'five' ? 'Fenêtre 5h' : 'Fenêtre 7 jours';
            const word = level === 2 ? 'critique' : 'élevé';
            Main.notify('Forfait Claude', `${label} : ${pct}% (seuil ${word} atteint)`);
        }
        this._notified[which] = level;
    }

    _levelFor(pct) {
        const warn = this._settings.get_int('threshold-warn');
        const crit = this._settings.get_int('threshold-critical');
        if (pct >= crit) return 2;
        if (pct >= warn) return 1;
        return 0;
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        super.destroy();
    }
});
