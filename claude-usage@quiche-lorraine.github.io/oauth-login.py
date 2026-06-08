#!/usr/bin/env python3
"""Connexion OAuth dédiée à l'extension gnome-claude-usage.

Modes :
  python3 oauth-login.py              → interactif (terminal)
  python3 oauth-login.py --prepare    → JSON {ok, url} sur stdout, état PKCE sauvegardé
  python3 oauth-login.py --complete CODE  → échange le code, JSON {ok} ou {ok, error}
"""
import base64
import hashlib
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request

CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
AUTH_URL = "https://claude.ai/oauth/authorize"
TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
REDIRECT = "https://platform.claude.com/oauth/code/callback"
SCOPE = "user:profile user:inference user:sessions:claude_code user:mcp_servers"

CFG = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
CRED_DIR = os.path.join(CFG, "gnome-claude-usage")
CRED_PATH = os.path.join(CRED_DIR, "credentials.json")

CACHE = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
STATE_PATH = os.path.join(CACHE, "gnome-claude-usage", "pkce-state.json")


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def build_auth_url(challenge, state):
    from urllib.parse import urlencode
    return AUTH_URL + "?" + urlencode({
        "code": "true",
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT,
        "scope": SCOPE,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    })


def exchange_code(code, verifier, state):
    body = json.dumps({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT,
        "client_id": CLIENT_ID,
        "code_verifier": verifier,
        "state": state,
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=body, headers={
            "Content-Type": "application/json",
            "User-Agent": "claude-code/2.1 (Linux)",
        })
    try:
        return json.load(urllib.request.urlopen(req, timeout=20)), None
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode(errors="replace")
        try:
            msg = json.loads(body_txt).get("error", {}).get("message", body_txt)
        except Exception:
            msg = body_txt
        return None, f"HTTP {e.code} — {msg}"
    except Exception as e:
        return None, str(e)


def save_creds(resp):
    access = resp.get("access_token")
    refresh = resp.get("refresh_token")
    ttl = int(resp.get("expires_in", 28800))
    if not access:
        return None
    os.makedirs(CRED_DIR, exist_ok=True)
    tmp = CRED_PATH + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({
            "accessToken": access,
            "refreshToken": refresh,
            "expiresAt": int(time.time() * 1000) + ttl * 1000,
        }, f)
    os.replace(tmp, CRED_PATH)
    return access


# --- Mode --prepare -----------------------------------------------------------

def cmd_prepare():
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    state = b64url(secrets.token_bytes(32))

    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    fd = os.open(STATE_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"verifier": verifier, "state": state}, f)

    print(json.dumps({"ok": True, "url": build_auth_url(challenge, state)}))


# --- Mode --complete CODE ------------------------------------------------------

def cmd_complete(code_raw):
    try:
        pkce = json.load(open(STATE_PATH))
    except Exception:
        print(json.dumps({"ok": False, "error": "État PKCE introuvable — relance l'étape 1"}))
        return

    code = code_raw.split("#")[0].strip()
    resp, err = exchange_code(code, pkce["verifier"], pkce["state"])
    if err:
        print(json.dumps({"ok": False, "error": err}))
        return

    if not save_creds(resp):
        print(json.dumps({"ok": False, "error": "Réponse sans access_token"}))
        return

    try:
        os.unlink(STATE_PATH)
    except Exception:
        pass
    print(json.dumps({"ok": True}))


# --- Mode interactif (terminal) -----------------------------------------------

def main():
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    state = b64url(secrets.token_bytes(32))
    url = build_auth_url(challenge, state)

    print("\n1) Ouvre cette URL dans ton navigateur et autorise l'accès :\n")
    print("   " + url + "\n")
    try:
        import webbrowser
        webbrowser.open(url)
    except Exception:
        pass

    print("2) Après autorisation, claude.ai affiche un code (format CODE#STATE).")
    raw = input("   Colle-le ici puis Entrée : ").strip()
    if not raw:
        print("✗ Aucun code fourni."); sys.exit(1)

    resp, err = exchange_code(raw.split("#")[0], verifier, state)
    if err:
        print("✗ Échec de l'échange du code :", err); sys.exit(1)

    if not save_creds(resp):
        print("✗ Réponse sans access_token :", resp); sys.exit(1)

    print(f"\n✓ Connecté. Token enregistré dans {CRED_PATH}")
    print("  Les jauges devraient s'activer au prochain rafraîchissement.")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--prepare":
        cmd_prepare()
    elif len(sys.argv) == 3 and sys.argv[1] == "--complete":
        cmd_complete(sys.argv[2])
    else:
        main()
