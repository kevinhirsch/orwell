# 0029 — App administrator role & user management

> **Status:** Draft. An **app-level administrator role** for Orwell (the account tier), with a
> **role-based entitlement model**, an **admin-only user manager** in Settings, and **password
> reset** (self for everyone; admin-for-others). The **first account created at setup is the
> administrator**, and admin is **propagable** to other users. Distinct from the game's **God Mode**
> (0016, which is per-sandbox game mechanics, walled from the Vault) — this is about *accounts and
> app settings*. Much of it already exists in Orwell's `AuthManager`; this spec names the model and
> the **gaps** (§8).
> **Executable spec:** [`0029-app-admin-and-user-management.feature`](./0029-app-admin-and-user-management.feature)

## 1. Summary

Orwell is multi-tenant (per-user game sandboxes, 0021), so it needs an account-administration tier:

- **Roles → entitlements.** A user is an **admin** or a regular **user**; entitlements are **named
  permissions** (extensible). **For now, admin grants exactly two:** **manage LLM settings** and
  **manage users.** Everything else is the same for all users.
- **First user is the admin.** The account created by the setup script (first run) is an
  administrator; **admins can promote/demote** other users.
- **Admin-only user manager** in Settings — list users, create, promote/demote, reset passwords,
  rename/delete; **invisible to non-admins**.
- **Password reset.** Every logged-in user can **change their own** password; **admins can reset
  any user's** password (without knowing the current one).

## 2. Scope

**In:** the role/entitlement model + its gates; the first-user-admin + promote/demote; the
admin-only user-manager Settings surface; self password change; admin password reset for others;
gating **LLM settings** to the `manage_llm_settings` entitlement.

**Out:** the game's **God Mode** (0016 — per-sandbox game admin, a separate channel; an app admin
is *not* automatically a God-Mode user, §11); the per-user **game** sandboxes (0021 — orthogonal,
keyed by the same account id); 2FA/session internals (already in `AuthManager`); SSO/external auth.

## 3. Roles & entitlements

- **Entitlements** are named booleans on a user (extending Orwell's existing `privileges`):
  `manage_llm_settings`, `manage_users` (the admin set today; add more later — e.g. `god_mode`,
  `manage_integrations`).
- **`admin`** is the role that carries the admin entitlement set; **`user`** carries none of them.
  The UI and the API both gate on the **entitlement**, not a bare `is_admin` boolean, so finer
  grants are a config change later, not a rewrite. *(Granularity is the §10 open decision; default:
  ship the admin flag now, entitlement-structured.)*

## 4. First admin & propagation

- **First user = admin.** `AuthManager.setup()` (first-run, only if no users) already creates the
  account with `is_admin=True` — keep that.
- **Propagation.** An admin can **promote** a user to admin or **demote** one back — with guardrails
  (§10): you **cannot demote the last remaining admin**, and an admin **cannot demote themselves if
  they're the last admin** (no lockout).

## 5. Admin-only user manager (Settings)

A **Users** section in Settings, shown **only** when the caller has `manage_users`:
- list users (name, role/entitlements, created);
- **create** a user (optionally as admin);
- **promote / demote**;
- **reset password** (set a new one for that user);
- **rename / delete** (already in `AuthManager`, admin-gated).

Non-admins never see the section, and every endpoint **re-checks** the entitlement server-side
(defence in depth — never trust the hidden UI).

## 6. Password reset

- **Self-service (everyone):** a logged-in user changes their own password by supplying the
  **current** one + a new one (`AuthManager.change_password` — exists).
- **Admin-for-others:** an admin sets a **new** password for any account **without** the current one
  (a reset). On reset, **revoke that user's active sessions** (like `delete_user` does) so a
  compromised/old session can't linger.

## 7. LLM settings gated to admins

Changing the **LLM configuration** — default model/endpoint, provider keys, model availability —
requires `manage_llm_settings`. A regular user uses whatever the admin configured; they may keep
their **own non-privileged prefs** (the existing per-user prefs) but cannot change the **global**
model/endpoint config. The Settings → AI/model tab's write actions are gated; reads may stay
visible.

## 8. What Orwell already provides vs the gaps (implementer)

| Capability | State |
|---|---|
| First user = admin (`setup` → `is_admin=True`) | ✅ exists |
| `create_user(is_admin)`, `delete_user`, `rename_user` (admin-gated, session-revoking) | ✅ exists |
| `is_admin`, `list_users`, `get/set_privileges`, `ADMIN/DEFAULT_PRIVILEGES` | ✅ exists |
| Self password change (`change_password`, `/api/auth/change-password`) | ✅ exists |
| `GET/POST /api/auth/users` (admin-gated) + a "users" Settings tab | ✅ exists (verify admin-only) |
| **Promote / demote** an existing user (`set_admin` + endpoint + UI) | ⛔ **gap** |
| **Admin reset another user's password** (no current pwd; revoke sessions) | ⛔ **gap** |
| **LLM/model settings gated** to `manage_llm_settings` (not just any logged-in user) | ⛔ **gap / verify** |
| The user-manager UI surfacing promote/demote + reset | ⛔ **gap** |

## 9. Contracts (stack-agnostic; extends `AuthManager`)

```
AuthManager (additions):
    set_admin(username, is_admin: bool, requesting_user) -> bool   # promote/demote; admin-only; last-admin guard
    admin_reset_password(username, new_password, requesting_admin) -> bool   # no current pwd; revokes target sessions
    has_entitlement(username, name) -> bool                        # gate UI + endpoints on the named entitlement
# Endpoints (admin-gated, server-side re-checked):
    POST /api/auth/users/{u}/role      { is_admin }        # promote/demote
    POST /api/auth/users/{u}/password  { new_password }    # admin reset
# Self (any logged-in user): POST /api/auth/change-password { current_password, new_password }  (exists)
```

## 10. Open decisions (flagged; drafted to defaults)

- **Entitlement granularity.** Default: **ship the `admin` role** carrying `{manage_llm_settings,
  manage_users}` now, but gate on the **named entitlements** so per-permission grants are a later
  config change. (The "role-based entitlements could be cool" path, structured but not yet exposed.)
- **Guardrails.** Default: **cannot demote/delete the last admin**; an admin can demote themselves
  only if another admin remains. Confirm.
- **Reset UX.** Admin reset sets a password directly (default) vs issues a one-time link. Default:
  direct set + force-revoke sessions (simplest, no email dependency).

## 11. Definition of Done

- [ ] The first setup account is admin; admins can **promote/demote** others (with the last-admin
      guard); the role/entitlement gate is enforced **server-side** on every admin endpoint.
- [ ] An **admin-only Users manager** in Settings (list/create/promote/demote/reset/rename/delete),
      invisible to non-admins.
- [ ] **Self password change** works for every user; **admin password reset** works for any account
      and **revokes that user's sessions**.
- [ ] **LLM/global model settings** require `manage_llm_settings`; a regular user can't change them.
- [ ] Name-agnostic tests (roles only): first-user-admin, promote/demote + last-admin guard,
      admin-only visibility + server-side gate, self vs admin password reset, LLM-settings gate.

## 12. Dependencies

Orwell's **`AuthManager`** + auth routes + the Settings UI (extends them); **0021** (the per-user
game sandbox is keyed by the same account id — but is a *separate* axis); **0016** (the game's God
Mode — a *different* admin surface; `god_mode` could become a future entitlement here). No engine
change required — this is the **app/account tier**.

## 13. Traceability

This session's product call (first user = admin; propagable; admin = manage LLM settings + manage
users; role-based entitlements "could be cool"; self password reset; admin reset for others);
Orwell's existing `core/auth.py` (`AuthManager`, `privileges`) and `routes/auth_routes.py`; the
distinction from `docs/features/0016-god-mode-admin.md` (game God Mode, Vault-walled).
