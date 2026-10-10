# NotLoL

Desktopová appka pro **League of Legends** (Windows): tier listy, buildy, runy a matchupy, ARAM, ARAM: Mayhem a Arena – a k tomu napojení na LoL klient a běžící hru.

## Co umí

- **Tier list** pro Ranked Solo/Duo, Flex, Normal Draft, ARAM, ARAM: Mayhem a Arenu – vždy nejnovější patch, filtr podle ranku a regionu, tabulka i přehled po tierech.
- **Stránka šampiona** – runy, kouzla, pořadí schopností, itemy a matchupy. V Areně pořadí karet (augmentů), top 10 prizmatických itemů a nejlepší parťáci.
- **Import do LoL klienta** – runy, kouzla a item set jedním klikem, nebo automaticky po zamknutí šampiona.
- **Pomocník ve výběru šampiona** – v ARAMu ukáže, kdo z lavičky a spoluhráčů je nejsilnější, v Areně jak ti to jde s parťákem.
- **Overlay ve hře** se skill orderem a buildem, **Ctrl+X** otevře panel se všemi hráči (rank, KDA, itemy) a tvým buildem.
- **Hodnocení karet a prizmatických itemů přímo na obrazovce** (Arena, ARAM: Mayhem) – appka přečte nabízené karty (Windows OCR) a do každé napíše tier a jak se hodí na tvého šampiona; nejlepší z nabídky má zlatý rámeček.
- **Hráči** – vyhledání podle Riot ID a vlastní profil vpravo nahoře (přes LoL klient).
- Čeština, slovenština, angličtina, němčina a polština (podle jazyka Windows), barvy vzhledu, spouštění s Windows na pozadí, hodinová záloha dat pro případ, že zdroj dat nejde.

## Zkratky ve hře

| Zkratka | Akce |
| --- | --- |
| `Ctrl` + `X` | Herní panel – všichni hráči, ranky, tvůj build |
| `Ctrl` + `Shift` + `H` | Skrýt / zobrazit overlay |
| `Ctrl` + `Shift` + `M` | Přesunout overlay myší |

Hra musí běžet v režimu okna **Bez okrajů** (Borderless), aby šly overlaye zobrazit nad ní.

## Sestavení

Potřeba: Windows 10 (1809+) nebo 11, [.NET 10 SDK](https://dotnet.microsoft.com/download) a Microsoft Edge WebView2 Runtime (ve Windows 11 už je).

```bat
build.cmd
```

Výsledek je jeden soubor `dist\NotLoL.exe` (ke spuštění stačí .NET 10 Desktop Runtime).

Rozhraní je v `web/` (HTML, CSS, JavaScript) a je zabalené přímo v `.exe`; desktopová část (WinForms + WebView2) je v souborech `*.cs`.

## Data

- [u.gg](https://u.gg) – tier listy, buildy, runy, matchupy, ARAM a Mayhem (neoficiální veřejné JSON soubory)
- [OP.GG](https://op.gg) – Arena (umístění, karty, prizmatické itemy)
- Riot Data Dragon a CommunityDragon – jména, ikony a texty ze hry
- LoL klient (LCU API) a Live Client Data API – výběr šampiona, živá hra, profil a ranky hráčů

NotLoL isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc. NotLoL není spojený s u.gg ani OP.GG.
