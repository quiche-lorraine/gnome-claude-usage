#!/usr/bin/env python3
"""Renvoie un access token Claude valide sur stdout (ou rien + code 1).

Ordre de résolution :
  1. Credentials DÉDIÉS de l'extension (~/.config/gnome-claude-usage/credentials.json) :
     rafraîchis automatiquement si expirés (refresh token qui NOUS appartient → sans risque).
  2. Repli sur le CLI (~/.claude/.credentials.json), en lecture seule (Claude Code gère son refresh).
  3. Sinon : rien (l'appelant affichera « indisponible »).
"""
import json
import os
import sys
import time
import urllib.request

CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
TOKEN_URL = "https://platform.claude.com/v1/oauth/token"

CFG = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
OWN = os.path.join(CFG, "gnome-claude-usage", "credentials.json")
CLI = os.path.expanduser("~/.claude/.credentials.json")


def emit(token):
    if token:
        sys.stdout.write(token)
        sys.exit(0)


def save(creds):
    tmp = OWN + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(creds, f)
    os.replace(tmp, OWN)


def refresh(refresh_token):
    body = json.dumps({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CLIENT_ID,
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=body, headers={
            "Content-Type": "application/json",
            "User-Agent": "claude-code/2.1 (Linux)",
        })
    r = json.load(urllib.request.urlopen(req, timeout=15))
    return r


# 1. Credentials dédiés (avec refresh)
if os.path.exists(OWN):
    try:
        c = json.load(open(OWN))
        access = c.get("accessToken")
        exp = c.get("expiresAt", 0)
        ref = c.get("refreshToken")
        now_ms = time.time() * 1000
        if access and now_ms < exp - 60000:
            emit(access)
        if ref:
            r = refresh(ref)
            access = r.get("access_token")
            if access:
                save({
                    "accessToken": access,
                    "refreshToken": r.get("refresh_token", ref),
                    "expiresAt": int(now_ms) + int(r.get("expires_in", 28800)) * 1000,
                })
                emit(access)
    except Exception:
        pass  # on retombe sur le CLI

# 2. Repli CLI (lecture seule)
if os.path.exists(CLI):
    try:
        emit(json.load(open(CLI))["claudeAiOauth"]["accessToken"])
    except Exception:
        pass

# 3. Rien
sys.exit(1)
