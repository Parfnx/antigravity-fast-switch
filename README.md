# Antigravity Fast Switch

Local `app.asar` patch that adds a `Fast switch` button above `Settings` in the Antigravity sidebar for quick Google account switching.

## Features
- Displays the active account and saved accounts in a theme-adaptive popover.
- Stores credentials isolated in Windows Credential Manager (`gemini:antigravity:fastswitch:*`).
- Switches the active credential (`gemini:antigravity`) and restarts `language_server` without a full IDE restart.
- Automatically creates `app.asar.fast-switch.backup` before patching and verifies SHA-256 integrity + `node --check`.

## Requirements
- Windows 10/11
- Python 3
- Node.js (`node --check` during `app.asar` verification)

## Install
```powershell
git clone https://github.com/Parfnx/antigravity-fast-switch.git
cd antigravity-fast-switch
powershell -ExecutionPolicy Bypass -File .\apply.ps1
```

## Rollback
```powershell
powershell -ExecutionPolicy Bypass -File .\unpatch.ps1
```

## Note
Antigravity auto-updates overwrite `app.asar`. Run `.\unpatch.ps1` before updating if needed, or re-run `.\apply.ps1` after an update.
