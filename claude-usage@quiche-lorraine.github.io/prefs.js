import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClaudeUsagePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        // --- Connexion Claude ---
        const loginGroup = new Adw.PreferencesGroup({ title: 'Connexion Claude' });
        page.add(loginGroup);

        const statusRow = new Adw.ActionRow({
            title: 'Statut',
            subtitle: this._connectionStatus(),
        });
        loginGroup.add(statusRow);

        const browserRow = new Adw.ActionRow({
            title: 'Étape 1',
            subtitle: 'Ouvre le navigateur pour autoriser l\'accès',
        });
        const browserBtn = new Gtk.Button({
            label: 'Ouvrir le navigateur',
            valign: Gtk.Align.CENTER,
        });
        browserRow.add_suffix(browserBtn);
        browserRow.set_activatable_widget(browserBtn);
        loginGroup.add(browserRow);

        const codeEntry = new Adw.EntryRow({
            title: 'Étape 2 — Colle le code ici',
            show_apply_button: false,
            sensitive: false,
        });
        loginGroup.add(codeEntry);

        const validateRow = new Adw.ActionRow({
            title: 'Étape 3',
            subtitle: 'Valide le code pour obtenir le token',
        });
        const validateBtn = new Gtk.Button({
            label: 'Valider le code',
            valign: Gtk.Align.CENTER,
            sensitive: false,
            css_classes: ['suggested-action'],
        });
        validateRow.add_suffix(validateBtn);
        validateRow.set_activatable_widget(validateBtn);
        loginGroup.add(validateRow);

        const resultRow = new Adw.ActionRow();
        const resultLabel = new Gtk.Label({
            label: '',
            wrap: true,
            xalign: 0,
            valign: Gtk.Align.CENTER,
        });
        resultRow.add_suffix(resultLabel);
        loginGroup.add(resultRow);

        // Ouvrir le navigateur
        browserBtn.connect('clicked', () => {
            browserBtn.set_sensitive(false);
            resultLabel.set_label('Génération des paramètres…');

            const script = GLib.build_filenamev([this.path, 'oauth-login.py']);
            let proc;
            try {
                proc = Gio.Subprocess.new(
                    ['python3', script, '--prepare'],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            } catch (e) {
                resultLabel.set_label(`✗ ${e.message}`);
                browserBtn.set_sensitive(true);
                return;
            }
            proc.communicate_utf8_async(null, null, (p, res) => {
                let stdout = '';
                try { [, stdout] = p.communicate_utf8_finish(res); } catch (e) {
                    resultLabel.set_label('✗ Erreur subprocess');
                    browserBtn.set_sensitive(true);
                    return;
                }
                let data;
                try { data = JSON.parse(stdout); } catch (e) {
                    resultLabel.set_label('✗ Réponse invalide');
                    browserBtn.set_sensitive(true);
                    return;
                }
                if (!data.ok) {
                    resultLabel.set_label(`✗ ${data.error || 'Erreur inconnue'}`);
                    browserBtn.set_sensitive(true);
                    return;
                }
                try {
                    Gio.AppInfo.launch_default_for_uri(data.url, null);
                } catch (e) {
                    resultLabel.set_label(`URL : ${data.url}`);
                }
                browserBtn.set_sensitive(true);
                codeEntry.set_sensitive(true);
                validateBtn.set_sensitive(true);
                if (!resultLabel.get_label().startsWith('URL'))
                    resultLabel.set_label('Navigateur ouvert — autorise, puis colle le code ci-dessus');
            });
        });

        // Activer le bouton Valider quand du texte est saisi
        codeEntry.connect('notify::text', () => {
            validateBtn.set_sensitive(codeEntry.get_text().trim().length > 0);
        });

        // Valider le code
        validateBtn.connect('clicked', () => {
            const code = codeEntry.get_text().trim();
            if (!code) return;

            validateBtn.set_sensitive(false);
            resultLabel.set_label('Échange du code en cours…');

            const script = GLib.build_filenamev([this.path, 'oauth-login.py']);
            let proc;
            try {
                proc = Gio.Subprocess.new(
                    ['python3', script, '--complete', code],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            } catch (e) {
                resultLabel.set_label(`✗ ${e.message}`);
                validateBtn.set_sensitive(true);
                return;
            }
            proc.communicate_utf8_async(null, null, (p, res) => {
                let stdout = '';
                try { [, stdout] = p.communicate_utf8_finish(res); } catch (e) {
                    resultLabel.set_label('✗ Erreur subprocess');
                    validateBtn.set_sensitive(true);
                    return;
                }
                let data;
                try { data = JSON.parse(stdout); } catch (e) {
                    resultLabel.set_label('✗ Réponse invalide');
                    validateBtn.set_sensitive(true);
                    return;
                }
                if (data.ok) {
                    settings.set_uint('last-login', Math.floor(Date.now() / 1000));
                    statusRow.set_subtitle('✓ Login dédié actif');
                    codeEntry.set_text('');
                    codeEntry.set_sensitive(false);
                    validateBtn.set_sensitive(false);
                    resultLabel.set_label('✓ Connecté — les jauges se mettent à jour…');
                } else {
                    resultLabel.set_label(`✗ ${data.error || 'Erreur inconnue'}`);
                    validateBtn.set_sensitive(true);
                }
            });
        });

        // --- Alertes ---
        const alertGroup = new Adw.PreferencesGroup({ title: 'Alertes' });
        page.add(alertGroup);

        const notifRow = new Adw.SwitchRow({
            title: 'Notifications',
            subtitle: 'Notification GNOME au franchissement des seuils',
        });
        alertGroup.add(notifRow);
        settings.bind('notifications-enabled', notifRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const warnRow = new Adw.SpinRow({
            title: "Seuil d'avertissement (%)",
            subtitle: 'Jauge orange à partir de ce niveau',
            adjustment: new Gtk.Adjustment({ lower: 1, upper: 100, step_increment: 1 }),
        });
        alertGroup.add(warnRow);
        settings.bind('threshold-warn', warnRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const critRow = new Adw.SpinRow({
            title: 'Seuil critique (%)',
            subtitle: 'Jauge rouge à partir de ce niveau',
            adjustment: new Gtk.Adjustment({ lower: 1, upper: 100, step_increment: 1 }),
        });
        alertGroup.add(critRow);
        settings.bind('threshold-critical', critRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        // --- Rafraîchissement ---
        const refreshGroup = new Adw.PreferencesGroup({ title: 'Rafraîchissement' });
        page.add(refreshGroup);

        const intervalRow = new Adw.SpinRow({
            title: 'Intervalle (secondes)',
            subtitle: "Fréquence d'interrogation du forfait",
            adjustment: new Gtk.Adjustment({ lower: 30, upper: 3600, step_increment: 30 }),
        });
        refreshGroup.add(intervalRow);
        settings.bind('poll-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    }

    _connectionStatus() {
        const ownPath = GLib.build_filenamev([
            GLib.get_user_config_dir(), 'gnome-claude-usage', 'credentials.json',
        ]);
        const cliPath = GLib.build_filenamev([
            GLib.get_home_dir(), '.claude', '.credentials.json',
        ]);
        if (GLib.file_test(ownPath, GLib.FileTest.EXISTS))
            return '✓ Login dédié actif';
        if (GLib.file_test(cliPath, GLib.FileTest.EXISTS))
            return 'Via Claude Code CLI (repli)';
        return '✗ Non connecté — utilise les étapes ci-dessous';
    }
}
