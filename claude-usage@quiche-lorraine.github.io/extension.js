import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ClaudeUsageIndicator } from './indicator.js';

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this.initTranslations();
        const _ = this.gettext.bind(this);
        this._indicator = new ClaudeUsageIndicator(this, _);
        Main.panel.addToStatusArea('claude-usage', this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
