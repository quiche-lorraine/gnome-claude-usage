import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClaudeUsagePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

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
            title: 'Seuil d’avertissement (%)',
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
            subtitle: 'Fréquence d’interrogation du forfait',
            adjustment: new Gtk.Adjustment({ lower: 30, upper: 3600, step_increment: 30 }),
        });
        refreshGroup.add(intervalRow);
        settings.bind('poll-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    }
}
