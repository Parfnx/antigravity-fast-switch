// BEGIN LOCAL FAST SWITCH
;
/* Isolated Google account fast switcher; stores credentials in Windows Credential Manager only. */
;(() => {
  'use strict';
  const { app, ipcMain } = require('electron');
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const { execFile } = require('child_process');

  const ACTIVE_TARGET = 'gemini:antigravity';
  const SLOT_PREFIX = 'gemini:antigravity:fastswitch:';
  const metaFile = () => path.join(app.getPath('userData'), 'fast-switch-accounts.json');

  function assertOrigin(event) {
    const sf = event?.senderFrame;
    const sender = event?.sender;
    if (
      !sf ||
      sf.parent ||
      (sender?.mainFrame && sf !== sender.mainFrame) ||
      sender?.getType?.() === 'webview' ||
      !/^https:\/\/127\.0\.0\.1:\d+\//.test(sf.url || '')
    ) {
      throw new Error('Unsupported fast-switch origin');
    }
  }

  let credQueue = Promise.resolve();
  function enqueueCred(fn) {
    const next = credQueue.then(fn, fn);
    credQueue = next.catch(() => {});
    return next;
  }

  const PS_WINCRED = `
$ErrorActionPreference = 'Stop'
$cs = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class FastSwitchWinCred {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public long LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredRead(string target, uint type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredWrite([In] ref CREDENTIAL userCredential, [In] uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredDelete(string target, uint type, int flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern void CredFree([In] IntPtr cred);

    public static bool Exists(string target) {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) return false;
        CredFree(ptr);
        return true;
    }

    public static bool Copy(string srcTarget, string dstTarget) {
        IntPtr ptr;
        if (!CredRead(srcTarget, 1, 0, out ptr)) return false;
        try {
            CREDENTIAL src = Marshal.PtrToStructure<CREDENTIAL>(ptr);
            CREDENTIAL dst = new CREDENTIAL {
                Flags = src.Flags,
                Type = 1,
                TargetName = dstTarget,
                Comment = src.Comment,
                CredentialBlobSize = src.CredentialBlobSize,
                CredentialBlob = src.CredentialBlob,
                Persist = src.Persist != 0 ? src.Persist : 2u,
                AttributeCount = 0,
                Attributes = IntPtr.Zero,
                TargetAlias = src.TargetAlias,
                UserName = src.UserName
            };
            return CredWrite(ref dst, 0);
        } finally {
            CredFree(ptr);
        }
    }

    public static bool Delete(string target) {
        return CredDelete(target, 1, 0);
    }
}
"@
Add-Type -TypeDefinition $cs
$op = $env:FS_CRED_OP
$src = $env:FS_CRED_SRC
$dst = $env:FS_CRED_DST
if ($op -eq 'status') {
    $targets = ($env:FS_CRED_LIST -split "\\|") | Where-Object { $_ }
    $active = [FastSwitchWinCred]::Exists($src)
    $found = @()
    foreach ($t in $targets) {
        if ([FastSwitchWinCred]::Exists($t)) { $found += $t }
    }
    @{ active = $active; slots = $found } | ConvertTo-Json -Compress
} elseif ($op -eq 'copy') {
    if (-not [FastSwitchWinCred]::Copy($src, $dst)) { throw "CredCopyFailed" }
    'ok'
} elseif ($op -eq 'delete') {
    [void][FastSwitchWinCred]::Delete($src)
    'ok'
} else {
    throw "UnknownOp"
}
`;
  const PS_ENC = Buffer.from(PS_WINCRED, 'utf16le').toString('base64');

  function runWinCred(op, { src = '', dst = '', list = [] } = {}) {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32') {
        reject(new Error('Fast switch currently supports Windows Credential Manager only'));
        return;
      }
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', PS_ENC],
        {
          timeout: 15000,
          windowsHide: true,
          env: {
            ...process.env,
            FS_CRED_OP: op,
            FS_CRED_SRC: src,
            FS_CRED_DST: dst,
            FS_CRED_LIST: list.join('|'),
          },
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error((stderr || err.message || 'WinCred error').trim()));
            return;
          }
          resolve(String(stdout || '').trim());
        }
      );
    });
  }

  function accountId(email) {
    return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 16);
  }

  function validId(id) {
    return typeof id === 'string' && /^[a-f0-9]{16}$/.test(id);
  }

  function readStore() {
    try {
      const raw = JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
      const list = Array.isArray(raw?.accounts) ? raw.accounts : [];
      return {
        version: 1,
        accounts: list.filter((a) => a && validId(a.id) && typeof a.email === 'string' && a.email.includes('@')),
      };
    } catch {
      return { version: 1, accounts: [] };
    }
  }

  function writeStore(store) {
    const target = metaFile();
    const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
      fs.renameSync(tmp, target);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch {}
      throw e;
    }
  }

  function upsertAccount(store, user) {
    const email = String(user?.email || '').trim();
    if (!email || !email.includes('@')) return null;
    const id = accountId(email);
    const now = Date.now();
    const cleanStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const name = cleanStr(user?.name, 80);
    const plan = cleanStr(user?.plan, 64);
    const idx = store.accounts.findIndex((a) => a.id === id);
    const prev = idx >= 0 ? store.accounts[idx] : {};
    const entry = {
      id,
      email: email.slice(0, 160),
      name: name || prev.name || email.split('@')[0],
      plan: plan || prev.plan || '',
      addedAt: prev.addedAt || now,
      lastUsedAt: now,
    };
    if (idx >= 0) store.accounts[idx] = entry;
    else store.accounts.push(entry);
    return entry;
  }

  async function snapshotCurrentIfPresent(store, currentUser) {
    if (!currentUser || typeof currentUser.email !== 'string' || !currentUser.email.includes('@')) return null;
    const entry = upsertAccount(store, currentUser);
    if (!entry) return null;
    try {
      await runWinCred('copy', { src: ACTIVE_TARGET, dst: SLOT_PREFIX + entry.id });
      writeStore(store);
      return entry;
    } catch {
      return null;
    }
  }

  async function updateLastLoginStorage(emailOrNull) {
    try {
      const getMgr = global.__fastSwitchStorage;
      const mgr = typeof getMgr === 'function' ? getMgr() : null;
      if (mgr && typeof mgr.updateItems === 'function') {
        await mgr.updateItems({ 'agy.onboarding.lastLoginUsername': emailOrNull || null });
      }
    } catch {}
  }

  async function restartLsOrApp() {
    const fn = global.__fastSwitchRestartLs;
    if (typeof fn === 'function') {
      await fn();
      return;
    }
    app.relaunch();
    app.exit(0);
  }

  ipcMain.handle('fast-switch:list', (event) => {
    assertOrigin(event);
    return enqueueCred(async () => {
      const store = readStore();
      const slotTargets = store.accounts.map((a) => SLOT_PREFIX + a.id);
      let active = false;
      let existingSlots = new Set();
      try {
        const out = await runWinCred('status', { src: ACTIVE_TARGET, list: slotTargets });
        const parsed = JSON.parse(out || '{}');
        active = Boolean(parsed.active);
        if (Array.isArray(parsed.slots)) existingSlots = new Set(parsed.slots);
      } catch {}
      const accounts = store.accounts
        .map((a) => ({ ...a, hasCred: existingSlots.has(SLOT_PREFIX + a.id) }))
        .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
      return { accounts, hasActiveCred: active };
    });
  });

  ipcMain.handle('fast-switch:sync-current', (event, currentUser) => {
    assertOrigin(event);
    return enqueueCred(async () => {
      const store = readStore();
      const entry = await snapshotCurrentIfPresent(store, currentUser);
      return { ok: Boolean(entry), entry };
    });
  });

  ipcMain.handle('fast-switch:switch', (event, payload) => {
    assertOrigin(event);
    return enqueueCred(async () => {
      const id = payload?.id;
      if (!validId(id)) throw new Error('Invalid account id');
      const store = readStore();
      const target = store.accounts.find((a) => a.id === id);
      if (!target) throw new Error('Account not found');
      await snapshotCurrentIfPresent(store, payload?.currentUser);
      await runWinCred('copy', { src: SLOT_PREFIX + id, dst: ACTIVE_TARGET });
      target.lastUsedAt = Date.now();
      writeStore(store);
      await updateLastLoginStorage(target.email);
      await restartLsOrApp();
      return { ok: true };
    });
  });

  ipcMain.handle('fast-switch:add-account', (event, payload) => {
    assertOrigin(event);
    return enqueueCred(async () => {
      const store = readStore();
      await snapshotCurrentIfPresent(store, payload?.currentUser);
      await runWinCred('delete', { src: ACTIVE_TARGET }).catch(() => {});
      await updateLastLoginStorage(null);
      await restartLsOrApp();
      return { ok: true };
    });
  });

  ipcMain.handle('fast-switch:sign-out', (event, payload) => {
    assertOrigin(event);
    return enqueueCred(async () => {
      const store = readStore();
      await snapshotCurrentIfPresent(store, payload?.currentUser);
      await runWinCred('delete', { src: ACTIVE_TARGET }).catch(() => {});
      await updateLastLoginStorage(null);
      await restartLsOrApp();
      return { ok: true };
    });
  });

  ipcMain.handle('fast-switch:remove', (event, payload) => {
    assertOrigin(event);
    return enqueueCred(async () => {
      const id = payload?.id;
      if (!validId(id)) throw new Error('Invalid account id');
      await runWinCred('delete', { src: SLOT_PREFIX + id }).catch(() => {});
      const store = readStore();
      store.accounts = store.accounts.filter((a) => a.id !== id);
      writeStore(store);
      return { ok: true };
    });
  });
})();
// END LOCAL FAST SWITCH
