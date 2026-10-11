<p align="center">
  <img src="docs/images/banner.png" alt="NotLoL – tier lists, builds and live help for League of Legends">
</p>

<p align="center">
  <a href="https://github.com/NotTerraCZ/NotLoL/releases/latest/download/NotLoL-Setup.exe"><img src="https://img.shields.io/badge/%E2%AC%87%20Download-NotLoL%20for%20Windows-6c8cff?style=for-the-badge&labelColor=1e2536" alt="Download NotLoL for Windows" height="36"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/NotTerraCZ/NotLoL?style=flat-square&label=version&color=6c8cff" alt="Latest version">
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-1e2536?style=flat-square" alt="Windows 10 | 11">
  <img src="https://img.shields.io/badge/price-free-3ee0a0?style=flat-square" alt="Free">
  <img src="https://img.shields.io/badge/languages-CZ%20%C2%B7%20SK%20%C2%B7%20EN%20%C2%B7%20DE%20%C2%B7%20PL-1e2536?style=flat-square" alt="Czech, Slovak, English, German, Polish">
</p>

<p align="center">
  <b>The newest tier lists and builds for every mode, one-click imports into your client<br>and help right inside the game – all in one small Windows app.</b>
</p>

<p align="center">
  <a href="#-whats-inside">What's inside</a> ·
  <a href="#-install">Install</a> ·
  <a href="#-in-game-shortcuts">Shortcuts</a> ·
  <a href="#-faq">FAQ</a>
</p>

![NotLoL tier list for Ranked Solo/Duo](docs/images/tier-list.png)

## ✨ What's inside

### 📊 A tier list for every mode

Ranked Solo/Duo, Flex, Normal Draft, ARAM, ARAM: Mayhem and Arena – always for the newest patch. Pick your rank and region, sort by win rate, pick rate or ban rate, see who counters whom, or switch to the classic tier view.

![Tier view for ARAM: Mayhem](docs/images/tiers.png)

### 🧩 Builds, runes and matchups – imported in one click

Every champion comes with runes, summoner spells, skill order, starting items, the core build and the matchups you win and lose. Hit **Import all** and the runes, spells and item set land straight in your LoL client – or let NotLoL do it on its own the moment you lock in.

![Champion page with runes, skill order and the import bar](docs/images/champion.png)

### 🔥 Arena and ARAM: Mayhem

See which augments to take with your champion, ranked from best to worst. In Arena you also get the top 10 prismatic items and the best duo partners.

![Arena champion page with the augment order](docs/images/arena.png)

### 🎯 Help in champ select

NotLoL opens your champion's build as soon as you pick it. In ARAM it shows whether a bench champion or a teammate's pick is stronger than yours, in Arena how well you do with your partner.

![ARAM champ select helper](docs/images/champ-select.png)

### 🎮 In the game

- A small **overlay** tells you which ability to level up next and shows your build, ticking off the items you've already bought.
- <kbd>Ctrl</kbd> + <kbd>X</kbd> opens a **panel with every player** in the match – rank, account level, form in their last 20 games, how often they play their champion, runes, KDA, items and how strong their champion is – next to your full build.
- In **Arena and ARAM: Mayhem**, NotLoL rates the augments and prismatic items you're offered **right on the cards**: the tier, how well each one fits your champion, and a gold frame around the best pick.

![In-game panel (Ctrl+X), shown with preview data](docs/images/ingame-panel.png)

### ⚙️ Stays out of your way

NotLoL starts quietly with Windows and waits in the tray, updates itself, speaks Czech, Slovak, English, German and Polish, and comes in six accent colors. It keeps an hourly backup of all its data, so it keeps working even when a data source goes down. You can also look up any player by Riot ID and click any match in their history to see every player's damage, gold, CS, vision and items. Your own profile sits in the top right corner.

![Settings](docs/images/settings.png)

## 📥 Install

1. **[Download NotLoL-Setup.exe](https://github.com/NotTerraCZ/NotLoL/releases/latest/download/NotLoL-Setup.exe)**
2. Run it. Windows may say *"Windows protected your PC"* because the app isn't signed – click **More info → Run anyway**.
3. Start League of Legends. NotLoL connects to the client by itself.

That's it – no account and no sign-up. If your PC is missing the .NET 10 Desktop Runtime or WebView2, the installer installs it for you.

**Updates are automatic.** NotLoL downloads new versions in the background and installs them the next time it starts. Want the new version right away? Click **Update** in the top right corner.

> [!TIP]
> For the overlay and the in-game panel, set the game to **Borderless** window mode (in-game *Settings → Video → Window Mode*).

## ⚡ In-game shortcuts

| Shortcut | What it does |
| --- | --- |
| <kbd>Ctrl</kbd> + <kbd>X</kbd> | In-game panel – all players, ranks, your build |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd> | Hide / show the overlay |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> | Move the overlay with the mouse |

## ❓ FAQ

<details>
<summary><b>Is it free?</b></summary>
<br>
Yes. No ads, no account, nothing to pay.
</details>

<details>
<summary><b>Can I get banned for using it?</b></summary>
<br>
NotLoL doesn't touch the game's files or memory. It talks to the LoL client and the game only through their official local interfaces – the same ones apps like u.gg or Blitz use – and it reads the augment cards from the screen, just like a screenshot. Still, it's a fan project that isn't endorsed by Riot Games, so use it at your own risk.
</details>

<details>
<summary><b>Where does the data come from?</b></summary>
<br>
Tier lists, builds, runes and matchups come from <a href="https://u.gg">u.gg</a>, Arena data from <a href="https://op.gg">OP.GG</a>, and names and icons from Riot's Data Dragon and CommunityDragon. NotLoL always shows the newest patch, and you can switch to older ones in the top bar.
</details>

<details>
<summary><b>The overlay doesn't show up in the game.</b></summary>
<br>
Switch the game to <b>Borderless</b> window mode – Windows doesn't draw other apps over a game in exclusive fullscreen. Also check that the overlay is turned on in NotLoL's settings, and press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd> in case you hid it.
</details>

<details>
<summary><b>Why can't I find a player?</b></summary>
<br>
Player search goes through your LoL client, so the client has to be running, and it only finds players on the server you're logged in to.
</details>

<details>
<summary><b>How do I change the language?</b></summary>
<br>
NotLoL follows your Windows language. You can pick a different one in <i>Settings → Language</i>.
</details>

<details>
<summary><b>How do I uninstall it?</b></summary>
<br>
Open Windows <i>Settings → Apps</i>, find NotLoL and click <b>Uninstall</b>. This also removes NotLoL's settings and saved data.
</details>

---

<sub>NotLoL isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc. NotLoL is not affiliated with u.gg or OP.GG.</sub>

<sub>Want to build NotLoL yourself or release a new version? See [DEVELOPMENT.md](DEVELOPMENT.md).</sub>
