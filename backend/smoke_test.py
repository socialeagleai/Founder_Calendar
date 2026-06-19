"""End-to-end smoke test hitting every endpoint against the running server + Postgres."""
import sys
import uuid

import requests

BASE = "http://127.0.0.1:8000"
s = requests.Session()
ok = 0
fail = 0


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS  {label}")
    else:
        fail += 1
        print(f"  FAIL  {label}  {detail}")


email = f"founder_{uuid.uuid4().hex[:8]}@test.com"

# --- signup ---
r = s.post(f"{BASE}/api/auth/signup", json={"name": "Ada Founder", "email": email, "password": "secret123"})
check("signup 201", r.status_code == 201, r.text)
token = r.json()["token"]
user = r.json()["user"]
check("signup returns token+user", bool(token) and user["email"] == email)
check("response is camelCase", "id" in user and "name" in user)
H = {"Authorization": f"Bearer {token}"}

# --- duplicate signup ---
r = s.post(f"{BASE}/api/auth/signup", json={"name": "x", "email": email, "password": "secret123"})
check("duplicate signup 409", r.status_code == 409, r.text)

# --- login ---
r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": "secret123"})
check("login 200", r.status_code == 200, r.text)
r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": "wrong"})
check("login bad password 401", r.status_code == 401)

# --- me ---
r = s.get(f"{BASE}/api/auth/me", headers=H)
check("me 200", r.status_code == 200 and r.json()["email"] == email, r.text)
r = s.get(f"{BASE}/api/auth/me")
check("me without token 401", r.status_code == 401)

# --- google demo login ---
r = s.post(f"{BASE}/api/auth/google", json={})
check("google demo login 200", r.status_code == 200 and r.json()["user"]["email"] == "founder@google.demo", r.text)

# --- org: none yet ---
r = s.get(f"{BASE}/api/organization", headers=H)
check("get org returns null before create", r.status_code == 200 and r.json() is None, r.text)

# --- create org ---
r = s.post(f"{BASE}/api/organization", headers=H, json={"name": "Acme Inc.", "description": "We ship."})
check("create org 201", r.status_code == 201, r.text)
org = r.json()
check("org camelCase fields", "createdAt" in org and "ownerId" in org, str(org))

# --- create org again -> conflict ---
r = s.post(f"{BASE}/api/organization", headers=H, json={"name": "Dup", "description": ""})
check("duplicate org 409", r.status_code == 409)

# --- team auto-owner ---
r = s.get(f"{BASE}/api/team", headers=H)
check("team has owner member", r.status_code == 200 and len(r.json()) == 1 and r.json()[0]["role"] == "Owner", r.text)
owner_id = r.json()[0]["id"]

# --- invite member ---
r = s.post(f"{BASE}/api/team", headers=H, json={"name": "Bob", "email": "bob@acme.com", "role": "Member"})
check("invite member 201", r.status_code == 201 and r.json()["status"] == "Invited", r.text)
member_id = r.json()["id"]
r = s.post(f"{BASE}/api/team", headers=H, json={"name": "Bob2", "email": "bob@acme.com", "role": "Member"})
check("duplicate member email 409", r.status_code == 409)
r = s.post(f"{BASE}/api/team", headers=H, json={"name": "X", "email": "x@acme.com", "role": "Owner"})
check("invite Owner rejected 400", r.status_code == 400)

# --- update role ---
r = s.patch(f"{BASE}/api/team/{member_id}", headers=H, json={"role": "Admin"})
check("update role 200", r.status_code == 200 and r.json()["role"] == "Admin", r.text)
r = s.patch(f"{BASE}/api/team/{owner_id}", headers=H, json={"role": "Admin"})
check("cannot change Owner role 400", r.status_code == 400)

# --- remove member ---
r = s.delete(f"{BASE}/api/team/{member_id}", headers=H)
check("remove member 204", r.status_code == 204)
r = s.delete(f"{BASE}/api/team/{owner_id}", headers=H)
check("cannot remove Owner 400", r.status_code == 400)

# --- notes CRUD ---
r = s.get(f"{BASE}/api/notes", headers=H)
check("notes empty initially", r.status_code == 200 and r.json() == [])
r = s.post(f"{BASE}/api/notes", headers=H, json={"date": "2026-06-20", "content": "Ship MVP"})
check("create note 201", r.status_code == 201, r.text)
note = r.json()
check("note camelCase fields", "createdAt" in note and "updatedAt" in note)
note_id = note["id"]
r = s.put(f"{BASE}/api/notes/{note_id}", headers=H, json={"content": "Ship MVP v2"})
check("update note 200", r.status_code == 200 and r.json()["content"] == "Ship MVP v2", r.text)
r = s.post(f"{BASE}/api/notes", headers=H, json={"date": "bad-date", "content": "x"})
check("invalid date rejected 422", r.status_code == 422)
r = s.get(f"{BASE}/api/notes", headers=H)
check("notes list has 1", r.status_code == 200 and len(r.json()) == 1)
r = s.delete(f"{BASE}/api/notes/{note_id}", headers=H)
check("delete note 204", r.status_code == 204)

# --- update profile ---
r = s.patch(f"{BASE}/api/auth/profile", headers=H, json={"name": "Ada Lovelace", "email": email})
check("update profile 200", r.status_code == 200 and r.json()["name"] == "Ada Lovelace", r.text)

# --- delete org cascades team+notes ---
s.post(f"{BASE}/api/notes", headers=H, json={"date": "2026-07-01", "content": "temp"})
r = s.delete(f"{BASE}/api/organization", headers=H)
check("delete org 204", r.status_code == 204)
r = s.get(f"{BASE}/api/organization", headers=H)
check("org gone after delete", r.status_code == 200 and r.json() is None)
r = s.get(f"{BASE}/api/team", headers=H)
check("team 404 after org delete", r.status_code == 404)

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
