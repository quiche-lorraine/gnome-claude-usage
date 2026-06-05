# Claude Usage — jauges de forfait dans la barre GNOME

Extension GNOME Shell affichant en permanence, dans la barre du haut d'Ubuntu, la
consommation du **forfait Claude** (abonnement Pro/Max) :

- **2 jauges** : fenêtre glissante **5h** et fenêtre **7 jours** (barres de progression colorées) ;
- **cadence cible** sur le 7j : un marqueur indique où vous *devriez* en être, pour repérer si vous consommez trop vite ;
- **détail au clic** : pourcentages exacts, heures de reset, indicateur de cadence ;
- **alertes** : couleur (vert / orange / rouge) + notification GNOME aux seuils, **désactivables** dans les préférences.

```
┌──────────────────────────┐
│ … 5h▕████▏ 7j▕█▏│marqueur ▾ │
└──────────────────────────┘
```

## Prérequis

- Ubuntu avec **GNOME Shell 46+**.
- `python3`, `curl`, `libglib2.0-bin` (présents par défaut sur Ubuntu).
- Être **connecté dans Claude Code** (présence de `~/.claude/.credentials.json`).

## Installation

```bash
git clone https://github.com/quiche-lorraine/gnome-claude-usage.git
cd gnome-claude-usage
./install.sh        # ou : make install
```

Puis, **sous Wayland** (session Ubuntu par défaut), **déconnectez-vous / reconnectez-vous une fois**
pour que GNOME Shell charge l'extension. (Sous X11 : `Alt+F2` → `r`.)

Mise à jour : `git pull && make install`.
Désinstallation : `make uninstall`.

## Réglages

```bash
gnome-extensions prefs claude-usage@quiche-lorraine.github.io
```

- Notifications activées / désactivées
- Seuils d'avertissement (défaut 80 %) et critique (défaut 95 %)
- Intervalle de rafraîchissement (défaut 60 s)

## Comment ça marche

- `usage-fetch.sh` lit le token OAuth local (`~/.claude/.credentials.json`) et interroge
  l'endpoint `GET https://api.anthropic.com/api/oauth/usage` (les mêmes chiffres que `/usage`).
- `pace.py` normalise la réponse et calcule la cadence 7j en **jours ouvrés** (Europe/Paris).
- L'extension lit ce JSON toutes les ~60 s et met à jour les jauges.

> ⚠ L'endpoint OAuth n'est **pas documenté** et peut changer. Toute la logique réseau est isolée
> dans `usage-fetch.sh` / `pace.py` pour être corrigée facilement. En cas d'erreur, les jauges
> affichent « indisponible » sans planter le shell.

## Dépannage

```bash
make test         # teste la collecte de données seule (hors GNOME)
make test-mock    # données factices (vérifie couleurs + notifications)
make logs         # journaux GNOME Shell filtrés sur l'extension
```

- *Jauges « indisponible »* : token absent/expiré → ouvrez Claude Code pour rafraîchir la session,
  ou vérifiez `make test`.
- *Extension absente après install* : relog Wayland nécessaire ; vérifiez
  `gnome-extensions info claude-usage@quiche-lorraine.github.io`.
