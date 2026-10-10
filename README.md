# NotLoL

A **League of Legends** desktop app for Windows: tier lists, builds, runes and matchups, ARAM, ARAM: Mayhem and Arena – plus integration with the LoL client and the running game.

## Features

- **Tier list** for Ranked Solo/Duo, Flex, Normal Draft, ARAM, ARAM: Mayhem and Arena – always the latest patch, filter by rank and region, table or tier view.
- **Champion page** – runes, summoner spells, skill order, items and matchups. In Arena: augment order, top 10 prismatic items and best duo partners.
- **Import into the LoL client** – runes, spells and item set in one click, or automatically after you lock in.
- **Champ select helper** – in ARAM it shows which bench champion or teammate pick is strongest, in Arena how well you do with your partner.
- **In-game overlay** with skill order and build; **Ctrl+X** opens a panel with all players (rank, KDA, items) and your build.
- **On-screen ratings for augments and prismatic items** (Arena, ARAM: Mayhem) – the app reads the offered cards (Windows OCR) and writes the tier and how well each one fits your champion onto it; the best option gets a gold frame.
- **Players** – search by Riot ID and your own profile in the top right corner (via the LoL client).
- Czech, Slovak, English, German and Polish (follows the Windows language), accent colors, starts with Windows in the background, hourly data backup in case a data source goes down.

## In-game shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl` + `X` | In-game panel – all players, ranks, your build |
| `Ctrl` + `Shift` + `H` | Hide / show the overlay |
| `Ctrl` + `Shift` + `M` | Move the overlay with the mouse |

The game must run in **Borderless** window mode so the overlays can be shown on top of it.

## Building

Requirements: Windows 10 (1809+) or 11, the [.NET 10 SDK](https://dotnet.microsoft.com/download) and the Microsoft Edge WebView2 Runtime (already included in Windows 11).

```bat
build.cmd
```

The result is a single file, `dist\NotLoL.exe` (running it only needs the .NET 10 Desktop Runtime).

The UI lives in `web/` (HTML, CSS, JavaScript) and is embedded in the `.exe`; the desktop part (WinForms + WebView2) is in the `*.cs` files.

## Data

- [u.gg](https://u.gg) – tier lists, builds, runes, matchups, ARAM and Mayhem (unofficial public JSON files)
- [OP.GG](https://op.gg) – Arena (placements, augments, prismatic items)
- Riot Data Dragon and CommunityDragon – names, icons and in-game texts
- LoL client (LCU API) and the Live Client Data API – champ select, live game, profile and player ranks

NotLoL isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc. NotLoL is not affiliated with u.gg or OP.GG.
