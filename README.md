# NotLoL

A **League of Legends** desktop app for Windows: tier lists, builds, runes and matchups, ARAM, ARAM: Mayhem and Arena – plus integration with the LoL client and the running game.

## Download

**[Download NotLoL-Setup.exe](https://github.com/NotTerraCZ/NotLoL/releases/latest/download/NotLoL-Setup.exe)** – Windows 10 (1809+) or 11.

The installer puts NotLoL in your user account (no administrator rights needed) and adds Start menu and desktop shortcuts. If the .NET 10 Desktop Runtime or the WebView2 Runtime is missing, it downloads and installs it first – Windows asks for permission for that. You can uninstall NotLoL in *Settings → Apps*; that also removes its settings and saved data.

The installer isn't code-signed, so Windows SmartScreen may warn you the first time – click **More info → Run anyway**.

## Features

- **Tier list** for Ranked Solo/Duo, Flex, Normal Draft, ARAM, ARAM: Mayhem and Arena – always the latest patch, filter by rank and region, table or tier view.
- **Champion page** – runes, summoner spells, skill order, items and matchups. In Arena: augment order, top 10 prismatic items and best duo partners.
- **Import into the LoL client** – runes, spells and item set in one click, or automatically after you lock in.
- **Champ select helper** – in ARAM it shows which bench champion or teammate pick is strongest, in Arena how well you do with your partner.
- **In-game overlay** with skill order and build; **Ctrl+X** opens a panel with all players (rank, KDA, items) and your build.
- **On-screen ratings for augments and prismatic items** (Arena, ARAM: Mayhem) – the app reads the offered cards (Windows OCR) and writes the tier and how well each one fits your champion onto it; the best option gets a gold frame.
- **Players** – search by Riot ID and your own profile in the top right corner (via the LoL client).
- **Automatic updates** – new versions download in the background and install the next time NotLoL starts, or right away with the **Update** button.
- Czech, Slovak, English, German and Polish (follows the Windows language), accent colors, starts with Windows in the background, hourly data backup in case a data source goes down.

## In-game shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl` + `X` | In-game panel – all players, ranks, your build |
| `Ctrl` + `Shift` + `H` | Hide / show the overlay |
| `Ctrl` + `Shift` + `M` | Move the overlay with the mouse |

The game must run in **Borderless** window mode so the overlays can be shown on top of it.

## Updates

Installing and updating is handled by [Velopack](https://velopack.io). The installed app checks this repository's [GitHub Releases](https://github.com/NotTerraCZ/NotLoL/releases) a minute after it starts and then every 3 hours (never during a game). A new version is downloaded in the background – usually only a small delta – and installed:

- the next time NotLoL starts (for example after a Windows restart), or
- right away with the **Update** button in the top right corner, in *Settings → Application → Updates*, or from the tray icon menu.

Updates only work in the installed version. A build from `build.cmd` (`dist\NotLoL.exe`) runs without them.

## Releasing a new version

Releases are built by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)). Either:

- open **Actions → Release → Run workflow** and enter the version (e.g. `1.2.0`) and optionally what's new, or
- push a tag: `git tag v1.2.0` and `git push origin v1.2.0`.

The workflow builds the app, packs it with Velopack (installer, portable zip, full and delta update packages) and publishes the GitHub release, including a copy of the installer named `NotLoL-Setup.exe` for the download link above. Every version must be higher than the previous one. A version with a suffix, such as `1.3.0-beta.1`, is published as a pre-release, and installed apps ignore it. The repository has to be public, otherwise installed apps can't download the updates.

If a release run fails halfway, delete the unfinished release (and its tag) on GitHub before running it again.

## Building

Requirements: Windows 10 (1809+) or 11, the [.NET 10 SDK](https://dotnet.microsoft.com/download) and the Microsoft Edge WebView2 Runtime (already included in Windows 11).

```bat
build.cmd
```

The result is a single file, `dist\NotLoL.exe` (running it only needs the .NET 10 Desktop Runtime).

To build the installer locally (output in `releases\`):

```bat
dotnet tool install -g vpk --version 1.2.161
dotnet publish -c Release -o publish
vpk pack -r win-x64 -u NotLoLApp -v 1.1.0 -p publish -e NotLoL.exe -o releases --packTitle NotLoL -i app.ico --framework net10.0-x64-desktop,webview2
```

The UI lives in `web/` (HTML, CSS, JavaScript) and is embedded in the `.exe`; the desktop part (WinForms + WebView2) is in the `*.cs` files, updates in `AppUpdater.cs`.

## Data

- [u.gg](https://u.gg) – tier lists, builds, runes, matchups, ARAM and Mayhem (unofficial public JSON files)
- [OP.GG](https://op.gg) – Arena (placements, augments, prismatic items)
- Riot Data Dragon and CommunityDragon – names, icons and in-game texts
- LoL client (LCU API) and the Live Client Data API – champ select, live game, profile and player ranks

NotLoL isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc. NotLoL is not affiliated with u.gg or OP.GG.
