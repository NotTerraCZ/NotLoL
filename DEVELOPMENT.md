# NotLoL – development

How NotLoL is built, updated and released. The player-facing description is in the [README](README.md).

## Project layout

- `web/` – the whole UI (HTML, CSS, JavaScript), embedded in the `.exe` and served to WebView2 from `https://notlol.example/`
- `*.cs` – the desktop part (WinForms + WebView2): main window and tray (`MainForm.cs`), LoL client and live game (`LeagueClient.cs`), overlay (`OverlayForm.cs`), in-game panel (`InGameForm.cs` + `web/ingame.html`), on-screen augment ratings (`AugmentScanner.cs`, `AugmentLabelForm.cs`), Deadlock detection, overlay and buy-order numbers in the shop (`MainForm.Deadlock.cs`, `ShopScanner.cs`, `ShopStepForm.cs`), data backup (`DataCache.cs`), updates (`AppUpdater.cs`)
- `web/js/deadlock.js` – Deadlock pages (hero tier list, hero builds, items) and the build/item ratings sent to the desktop part
- `.github/workflows/release.yml` – builds and publishes a release
- `docs/images/` – pictures for the README

## Building

Requirements: Windows 10 (1809+) or 11, the [.NET 10 SDK](https://dotnet.microsoft.com/download) and the Microsoft Edge WebView2 Runtime (already included in Windows 11).

```bat
build.cmd
```

The result is a single file, `dist\NotLoL.exe` (running it only needs the .NET 10 Desktop Runtime). This build doesn't update itself.

To build the installer locally (output in `releases\`):

```bat
dotnet tool install -g vpk --version 1.2.161
dotnet publish -c Release -o publish
vpk pack -r win-x64 -u NotLoLApp -v 1.1.0 -p publish -e NotLoL.exe -o releases --packTitle NotLoL -i app.ico --framework net10.0-x64-desktop,webview2
```

## Updates

Installing and updating is handled by [Velopack](https://velopack.io). The installed app checks this repository's [GitHub Releases](https://github.com/NotTerraCZ/NotLoL/releases) a minute after it starts and then every 3 hours (never during a game, retrying after 30 minutes when a check fails). A new version is downloaded in the background – usually only a small delta – and installed:

- the next time NotLoL starts (for example after a Windows restart), or
- right away with the **Update** button in the top right corner, in *Settings → Application → Updates*, or from the tray icon menu.

The app installs to `%LOCALAPPDATA%\NotLoLApp`; its settings and data stay in `%LOCALAPPDATA%\NotLoL`. An installed copy closes an older portable `NotLoL.exe` that is already running and takes over starting with Windows. Uninstalling removes the autostart entry and the data folder.

## Releasing a new version

Releases are built by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)). Either:

- open **Actions → Release → Run workflow** and enter the version (e.g. `1.2.0`) and optionally what's new, or
- push a tag: `git tag v1.2.0` and `git push origin v1.2.0`.

The workflow builds the app, packs it with Velopack (installer, portable zip, full and delta update packages) and publishes the GitHub release, including a copy of the installer named `NotLoL-Setup.exe` for the download link in the README. Every version must be higher than the previous one. A version with a suffix, such as `1.3.0-beta.1`, is published as a pre-release, and installed apps ignore it. The repository has to stay public, otherwise installed apps can't download the updates.

If a release run fails halfway, delete the unfinished release (and its tag) on GitHub before running it again.

## Data sources

- [u.gg](https://u.gg) – tier lists, builds, runes, matchups, ARAM and Mayhem (unofficial public JSON files)
- [OP.GG](https://op.gg) – Arena (placements, augments, prismatic items)
- Riot Data Dragon and CommunityDragon – names, icons and in-game texts
- LoL client (LCU API) and the Live Client Data API – champ select, live game, profile and player ranks
- [deadlock-api.com](https://deadlock-api.com) – Deadlock heroes, items, hero and item stats, player builds (`api.deadlock-api.com`, images on `assets-bucket.deadlock-api.com`)
- Deadlock itself has no local API: NotLoL finds it by its process (`deadlock.exe`, `project8.exe` in older builds) and reads the shop from the screen
