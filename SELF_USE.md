# Self-use desktop workflow

This project is currently prepared for trusted self-use on Windows.

## Daily launch

Use the `.exe` under `dist\win-unpacked`.

If the file is missing or the app fails to start, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -Launch
```

That script will:

- set the Electron mirror to `https://npmmirror.com/mirrors/electron/`
- run `npm install`
- check `node_modules\electron\dist\electron.exe`
- run `npm run electron:smoke`
- build `dist\win-unpacked` when needed
- launch the unpacked app when `-Launch` is provided

For a faster repair when dependencies are already installed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -SkipInstall -Launch
```

## Recommended self-checks

Before relying on a new local build:

```powershell
npm run electron:smoke
npm run check
npm test
```

The most important one for daily desktop use is:

```powershell
npm run electron:smoke
```

It rebuilds `better-sqlite3` for the current Node runtime, then verifies that the desktop app can start, recover when port `8787` is occupied, load the UI, call `/api/health`, and quit cleanly.

This rebuild step is intentional: `npm run build:win` rebuilds native modules for Electron, while the smoke test starts the development backend with system Node.

## Node.js version

This workspace is tested with Node.js 22.20.0 and supports Node.js 20 through 22.

After changing or upgrading Node.js, run:

```powershell
npm install
npm run electron:smoke
```

The smoke test rebuilds `better-sqlite3` for the active Node runtime and catches the most common native-module mismatch.

## Data location

The app stores working data outside the repo:

```text
C:\Users\<your-user>\LegalWorkbench
```

Main paths:

```text
C:\Users\<your-user>\LegalWorkbench\data\workbench.sqlite
C:\Users\<your-user>\LegalWorkbench\contracts
C:\Users\<your-user>\LegalWorkbench\files
C:\Users\<your-user>\LegalWorkbench\backups
```

On this machine, the expected root is:

```text
C:\Users\x1462\LegalWorkbench
```

## Backup

The app creates SQLite backups in:

```text
C:\Users\x1462\LegalWorkbench\backups
```

For a manual full backup, close the app first, then copy the whole folder:

```powershell
Copy-Item "$env:USERPROFILE\LegalWorkbench" "$env:USERPROFILE\LegalWorkbench-backup-$(Get-Date -Format yyyyMMdd-HHmmss)" -Recurse
```

This preserves the database, contract archive folders, exported Word files, uploaded versions, and app backups.

## Restore

Close the app before restoring.

To restore the whole workspace:

```powershell
Rename-Item "$env:USERPROFILE\LegalWorkbench" "LegalWorkbench-before-restore-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item "C:\path\to\LegalWorkbench-backup" "$env:USERPROFILE\LegalWorkbench" -Recurse
```

To restore only the SQLite database:

```powershell
Copy-Item "C:\path\to\backup.sqlite" "$env:USERPROFILE\LegalWorkbench\data\workbench.sqlite" -Force
```

Prefer full-folder restore when contract files and exports matter, because the database stores paths to archived files.

## Known self-use notes

- Use the unpacked app first, not the installer, while iterating quickly.
- If `npm install` fails while downloading Electron, rerun `scripts\setup-windows.ps1`; it sets the mirror source.
- If a previous test leaves ports occupied, run `npm run electron:smoke`; it exercises cleanup and makes port problems obvious.
- The portable/installer outputs are in `dist`, but the `.exe` under `dist\win-unpacked` is the preferred self-use entry point.
