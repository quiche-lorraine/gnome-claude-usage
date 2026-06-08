import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClaudeUsagePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const _ = this.gettext.bind(this);
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        // --- Claude Connection ---
        const loginGroup = new Adw.PreferencesGroup({ title: _('Claude Connection') });
        page.add(loginGroup);

        const statusRow = new Adw.ActionRow({
            title: _('Status'),
            subtitle: this._connectionStatus(_),
        });
        loginGroup.add(statusRow);

        const browserRow = new Adw.ActionRow({
            title: _('Step 1'),
            subtitle: _('Open the browser to authorize access'),
        });
        const browserBtn = new Gtk.Button({
            label: _('Open browser'),
            valign: Gtk.Align.CENTER,
        });
        browserRow.add_suffix(browserBtn);
        browserRow.set_activatable_widget(browserBtn);
        loginGroup.add(browserRow);

        const codeEntry = new Adw.EntryRow({
            title: _('Step 2 — Paste the code here'),
            show_apply_button: false,
            sensitive: false,
        });
        loginGroup.add(codeEntry);

        const validateRow = new Adw.ActionRow({
            title: _('Step 3'),
            subtitle: _('Validate the code to get your token'),
        });
        const validateBtn = new Gtk.Button({
            label: _('Validate code'),
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

        // Open browser
        browserBtn.connect('clicked', () => {
            browserBtn.set_sensitive(false);
            resultLabel.set_label(_('Generating parameters…'));

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
                    resultLabel.set_label(`✗ ${_('Subprocess error')}`);
                    browserBtn.set_sensitive(true);
                    return;
                }
                let data;
                try { data = JSON.parse(stdout); } catch (e) {
                    resultLabel.set_label(`✗ ${_('Invalid response')}`);
                    browserBtn.set_sensitive(true);
                    return;
                }
                if (!data.ok) {
                    resultLabel.set_label(`✗ ${data.error || _('Unknown error')}`);
                    browserBtn.set_sensitive(true);
                    return;
                }
                try {
                    Gio.AppInfo.launch_default_for_uri(data.url, null);
                } catch (e) {
                    resultLabel.set_label(`URL: ${data.url}`);
                }
                browserBtn.set_sensitive(true);
                codeEntry.set_sensitive(true);
                validateBtn.set_sensitive(true);
                if (!resultLabel.get_label().startsWith('URL'))
                    resultLabel.set_label(_('Browser opened — authorize, then paste the code above'));
            });
        });

        // Enable Validate button when text is entered
        codeEntry.connect('notify::text', () => {
            validateBtn.set_sensitive(codeEntry.get_text().trim().length > 0);
        });

        // Validate the code
        validateBtn.connect('clicked', () => {
            const code = codeEntry.get_text().trim();
            if (!code) return;

            validateBtn.set_sensitive(false);
            resultLabel.set_label(_('Exchanging code…'));

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
                    resultLabel.set_label(`✗ ${_('Subprocess error')}`);
                    validateBtn.set_sensitive(true);
                    return;
                }
                let data;
                try { data = JSON.parse(stdout); } catch (e) {
                    resultLabel.set_label(`✗ ${_('Invalid response')}`);
                    validateBtn.set_sensitive(true);
                    return;
                }
                if (data.ok) {
                    settings.set_uint('last-login', Math.floor(Date.now() / 1000));
                    statusRow.set_subtitle(_('✓ Dedicated login active'));
                    codeEntry.set_text('');
                    codeEntry.set_sensitive(false);
                    validateBtn.set_sensitive(false);
                    resultLabel.set_label(_('✓ Connected — gauges updating…'));
                } else {
                    resultLabel.set_label(`✗ ${data.error || _('Unknown error')}`);
                    validateBtn.set_sensitive(true);
                }
            });
        });

        // --- Alerts ---
        const alertGroup = new Adw.PreferencesGroup({ title: _('Alerts') });
        page.add(alertGroup);

        const notifRow = new Adw.SwitchRow({
            title: _('Notifications'),
            subtitle: _('GNOME notification when thresholds are reached'),
        });
        alertGroup.add(notifRow);
        settings.bind('notifications-enabled', notifRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const warnRow = new Adw.SpinRow({
            title: _('Warning threshold (%)'),
            subtitle: _('Gauge turns orange above this level'),
            adjustment: new Gtk.Adjustment({ lower: 1, upper: 100, step_increment: 1 }),
        });
        alertGroup.add(warnRow);
        settings.bind('threshold-warn', warnRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const critRow = new Adw.SpinRow({
            title: _('Critical threshold (%)'),
            subtitle: _('Gauge turns red above this level'),
            adjustment: new Gtk.Adjustment({ lower: 1, upper: 100, step_increment: 1 }),
        });
        alertGroup.add(critRow);
        settings.bind('threshold-critical', critRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const weekendRow = new Adw.SwitchRow({
            title: _('Ignore weekends (7-day pace)'),
            subtitle: _('Target only progresses on weekdays'),
        });
        alertGroup.add(weekendRow);
        settings.bind('pace-skip-weekends', weekendRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        // --- Refresh ---
        const refreshGroup = new Adw.PreferencesGroup({ title: _('Refresh') });
        page.add(refreshGroup);

        const intervalRow = new Adw.SpinRow({
            title: _('Interval (seconds)'),
            subtitle: _('How often to poll the quota endpoint'),
            adjustment: new Gtk.Adjustment({ lower: 30, upper: 3600, step_increment: 30 }),
        });
        refreshGroup.add(intervalRow);
        settings.bind('poll-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    }

    _connectionStatus(_) {
        const ownPath = GLib.build_filenamev([
            GLib.get_user_config_dir(), 'gnome-claude-usage', 'credentials.json',
        ]);
        const cliPath = GLib.build_filenamev([
            GLib.get_home_dir(), '.claude', '.credentials.json',
        ]);
        if (GLib.file_test(ownPath, GLib.FileTest.EXISTS))
            return _('✓ Dedicated login active');
        if (GLib.file_test(cliPath, GLib.FileTest.EXISTS))
            return _('Via Claude Code CLI (fallback)');
        return _('✗ Not connected — use the steps below');
    }
}
