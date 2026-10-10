using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace NotLoL;

/// <summary>
/// Lokální API League klienta (LCU) – stejné rozhraní, přes které importují runy u.gg, Blitz apod.
/// Přihlašovací údaje bere ze souboru "lockfile" ve složce hry.
/// </summary>
sealed class LeagueClient : IDisposable
{
    HttpClient? http;

    public bool Connected => http != null;

    public bool TryConnect()
    {
        if (http != null) return true;
        var lockfile = FindLockfile();
        if (lockfile == null) return false;
        try
        {
            string text;
            using (var fs = new FileStream(lockfile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var reader = new StreamReader(fs))
                text = reader.ReadToEnd();
            // LeagueClient:pid:port:heslo:https
            var parts = text.Split(':');
            if (parts.Length < 5) return false;
            http = LocalHttp.Create(TimeSpan.FromSeconds(5));
            http.BaseAddress = new Uri($"https://127.0.0.1:{parts[2]}/");
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.ASCII.GetBytes("riot:" + parts[3])));
            return true;
        }
        catch
        {
            return false;
        }
    }

    public void Disconnect()
    {
        http?.Dispose();
        http = null;
    }

    public void Dispose() => Disconnect();

    static string? FindLockfile()
    {
        bool running = false;
        foreach (var name in new[] { "LeagueClientUx", "LeagueClient" })
        {
            foreach (var p in Process.GetProcessesByName(name))
            {
                running = true;
                try
                {
                    var dir = Path.GetDirectoryName(p.MainModule?.FileName);
                    var file = dir == null ? null : Path.Combine(dir, "lockfile");
                    if (file != null && File.Exists(file)) return file;
                }
                catch { /* bez přístupu k procesu – zkusíme výchozí cestu */ }
                finally { p.Dispose(); }
            }
        }
        const string fallback = @"C:\Riot Games\League of Legends\lockfile";
        return running && File.Exists(fallback) ? fallback : null;
    }

    // ---------- HTTP ----------

    public async Task<JsonNode?> GetAsync(string path)
    {
        using var r = await Send(HttpMethod.Get, path, null);
        if (!r.IsSuccessStatusCode) return null;
        var body = await r.Content.ReadAsStringAsync();
        return string.IsNullOrWhiteSpace(body) ? null : JsonNode.Parse(body);
    }

    async Task<HttpResponseMessage> Send(HttpMethod method, string path, JsonNode? body)
    {
        var client = http ?? throw new InvalidOperationException("LoL klient není připojený.");
        using var req = new HttpRequestMessage(method, path);
        if (body != null) req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        try
        {
            return await client.SendAsync(req);
        }
        catch (HttpRequestException)
        {
            Disconnect(); // klient se zavřel
            throw;
        }
    }

    async Task<(bool ok, string error)> SendChecked(HttpMethod method, string path, JsonNode? body = null)
    {
        using var r = await Send(method, path, body);
        if (r.IsSuccessStatusCode) return (true, "");
        var text = await r.Content.ReadAsStringAsync();
        try { text = JsonNode.Parse(text)?["message"]?.GetValue<string>() ?? text; } catch { }
        return (false, $"{(int)r.StatusCode} {text}".Trim());
    }

    // ---------- Výběr šampiona ----------

    public sealed record ChampSelectState(int ChampionId, bool Locked, string Position, int Spell1, int Spell2,
        int[] Bench, int[] Team)
    {
        // Pro detekci změn (lavička v ARAMu se mění, když někdo rerollne)
        public string Key => $"{ChampionId}|{Locked}|{Position}|{string.Join(',', Bench)}|{string.Join(',', Team)}";
    }

    public async Task<ChampSelectState?> GetChampSelectAsync()
    {
        var s = await GetAsync("/lol-champ-select/v1/session");
        if (s == null) return null;
        var cell = s["localPlayerCellId"]?.GetValue<long>() ?? -1;
        var me = s["myTeam"]?.AsArray().FirstOrDefault(p => p?["cellId"]?.GetValue<long>() == cell);
        if (me == null) return null;

        int champ = me["championId"]?.GetValue<int>() ?? 0;
        int intent = me["championPickIntent"]?.GetValue<int>() ?? 0;

        // Zamčeno = moje pick akce je dokončená (ARAM a podobné módy pick akce nemají)
        var myPicks = (s["actions"]?.AsArray() ?? new JsonArray())
            .SelectMany(group => group?.AsArray() ?? new JsonArray())
            .Where(a => a?["actorCellId"]?.GetValue<long>() == cell && a?["type"]?.GetValue<string>() == "pick")
            .ToList();
        bool locked = myPicks.Count == 0 ? champ != 0 : myPicks.Any(a => a?["completed"]?.GetValue<bool>() == true);

        // ARAM / Mayhem: šampioni na lavičce (dá se je vzít) a co mají spoluhráči (dá se vyměnit)
        var bench = (s["benchChampions"]?.AsArray() ?? new JsonArray())
            .Select(b => (int)(b?["championId"]?.GetValue<long>() ?? 0))
            .Concat((s["benchChampionIds"]?.AsArray() ?? new JsonArray()).Select(b => (int)(b?.GetValue<long>() ?? 0)))
            .Where(id => id > 0).Distinct().ToArray();
        var team = (s["myTeam"]?.AsArray() ?? new JsonArray())
            .Where(p => p?["cellId"]?.GetValue<long>() != cell)
            .Select(p => (int)(p?["championId"]?.GetValue<long>() ?? 0))
            .Where(id => id > 0).ToArray();

        return new ChampSelectState(
            champ != 0 ? champ : intent,
            locked && champ != 0,
            me["assignedPosition"]?.GetValue<string>() ?? "",
            (int)(me["spell1Id"]?.GetValue<long>() ?? 0),
            (int)(me["spell2Id"]?.GetValue<long>() ?? 0),
            bench,
            team);
    }

    /// <summary>Mód a fronta aktuální hry (např. "ARAM"/450, "CHERRY" = Arena, 2400 = ARAM: Mayhem).</summary>
    public async Task<(string mode, int queueId)> GetGameModeAsync()
    {
        var s = await GetAsync("/lol-gameflow/v1/session");
        var queue = s?["gameData"]?["queue"];
        var mode = queue?["gameMode"]?.GetValue<string>() ?? s?["map"]?["gameMode"]?.GetValue<string>() ?? "";
        return (mode, (int)(queue?["id"]?.GetValue<long>() ?? 0));
    }

    // ---------- Hráči (rank, historie) ----------

    readonly Dictionary<string, string?> puuidCache = new(StringComparer.OrdinalIgnoreCase);

    async Task<string?> PuuidAsync(string gameName, string tagLine)
    {
        var key = gameName + "#" + tagLine;
        if (puuidCache.TryGetValue(key, out var cached)) return cached;
        var alias = await GetAsync($"/lol-summoner/v1/alias/lookup?gameName={Uri.EscapeDataString(gameName)}&tagLine={Uri.EscapeDataString(tagLine)}");
        var puuid = alias?["puuid"]?.GetValue<string>();
        puuidCache[key] = string.IsNullOrEmpty(puuid) ? null : puuid;
        return puuidCache[key];
    }

    static JsonObject? CompactQueue(JsonNode? q)
    {
        var tier = q?["tier"]?.GetValue<string>() ?? "";
        if (q == null) return null;
        return new JsonObject
        {
            ["tier"] = tier is "" or "NONE" ? null : tier,
            ["division"] = q["division"]?.GetValue<string>(),
            ["lp"] = q["leaguePoints"]?.GetValue<int>() ?? 0,
            ["wins"] = q["wins"]?.GetValue<int>() ?? 0,
            ["losses"] = q["losses"]?.GetValue<int>() ?? 0,
            ["prevTier"] = q["previousSeasonEndTier"]?.GetValue<string>(),
            ["prevDivision"] = q["previousSeasonEndDivision"]?.GetValue<string>(),
        };
    }

    /// <summary>Rank hráče podle Riot ID ("Jméno#TAG") – pro panel ve hře.</summary>
    public async Task<JsonObject?> GetRankAsync(string riotId)
    {
        int i = riotId.LastIndexOf('#');
        if (i <= 0) return null;
        var puuid = await PuuidAsync(riotId[..i], riotId[(i + 1)..]);
        if (puuid == null) return null;
        var rs = await GetAsync($"/lol-ranked/v1/ranked-stats/{puuid}");
        return new JsonObject
        {
            ["solo"] = CompactQueue(rs?["queueMap"]?["RANKED_SOLO_5x5"]),
            ["flex"] = CompactQueue(rs?["queueMap"]?["RANKED_FLEX_SR"]),
        };
    }

    /// <summary>
    /// Přihlášený účet: Riot ID, ikona, úroveň a ranky (pro profil vpravo nahoře v appce).
    /// Před přihlášením v klientovi vrátí null.
    /// </summary>
    public async Task<JsonObject?> GetMeAsync()
    {
        var s = await GetAsync("/lol-summoner/v1/current-summoner");
        var puuid = s?["puuid"]?.GetValue<string>();
        var gameName = s?["gameName"]?.GetValue<string>();
        if (string.IsNullOrEmpty(puuid) || string.IsNullOrEmpty(gameName)) return null;
        var ranked = await GetAsync($"/lol-ranked/v1/ranked-stats/{puuid}");
        string? region = null, locale = null;
        try
        {
            var rl = await GetAsync("/riotclient/region-locale");
            region = rl?["region"]?.GetValue<string>();
            locale = rl?["locale"]?.GetValue<string>(); // jazyk hry – podle něj se čtou názvy karet
        }
        catch { /* region a jazyk jsou jen doplněk */ }
        return new JsonObject
        {
            ["puuid"] = puuid,
            ["gameName"] = gameName,
            ["tagLine"] = s!["tagLine"]?.GetValue<string>() ?? "",
            ["profileIconId"] = (int)(s["profileIconId"]?.GetValue<long>() ?? 0),
            ["level"] = (int)(s["summonerLevel"]?.GetValue<long>() ?? 0),
            ["region"] = region,
            ["locale"] = locale,
            ["solo"] = CompactQueue(ranked?["queueMap"]?["RANKED_SOLO_5x5"]),
            ["flex"] = CompactQueue(ranked?["queueMap"]?["RANKED_FLEX_SR"]),
        };
    }

    /// <summary>Profil hráče: účet, ranky a posledních 20 zápasů. Funguje jen pro region, ve kterém je přihlášený klient.</summary>
    public async Task<(bool ok, string message, JsonObject? data)> LookupPlayerAsync(string gameName, string tagLine)
    {
        var puuid = await PuuidAsync(gameName, tagLine);
        if (puuid == null) return (false, Loc.T("playerNotFound", "Hráč {0} nebyl nalezen (hledá se jen na tvém serveru).", $"{gameName}#{tagLine}"), null);

        var summoner = await GetAsync($"/lol-summoner/v2/summoners/puuid/{puuid}");
        var ranked = await GetAsync($"/lol-ranked/v1/ranked-stats/{puuid}");
        var history = await GetAsync($"/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=19");

        return (true, "", new JsonObject
        {
            ["puuid"] = puuid,
            ["gameName"] = summoner?["gameName"]?.GetValue<string>() ?? gameName,
            ["tagLine"] = summoner?["tagLine"]?.GetValue<string>() ?? tagLine,
            ["level"] = summoner?["summonerLevel"]?.GetValue<int>() ?? 0,
            ["profileIconId"] = summoner?["profileIconId"]?.GetValue<int>() ?? 0,
            ["privacy"] = summoner?["privacy"]?.GetValue<string>(),
            ["solo"] = CompactQueue(ranked?["queueMap"]?["RANKED_SOLO_5x5"]),
            ["flex"] = CompactQueue(ranked?["queueMap"]?["RANKED_FLEX_SR"]),
            ["games"] = history?["games"]?["games"]?.DeepClone() ?? new JsonArray(),
        });
    }

    // ---------- Import ----------

    public async Task<(bool ok, string message)> ImportRunesAsync(JsonNode page)
    {
        var pages = (await GetAsync("/lol-perks/v1/pages"))?.AsArray().OfType<JsonNode>().ToList() ?? [];
        var inventory = await GetAsync("/lol-perks/v1/inventory");
        bool Deletable(JsonNode p) => p["isDeletable"]?.GetValue<bool>() == true;

        // Vlastní stránka NotLoL se přepisuje; když není a není ani volné místo, vezmeme aktuálně vybranou
        var target = pages.FirstOrDefault(p => Deletable(p) && (p["name"]?.GetValue<string>() ?? "").StartsWith("NotLoL"));
        string? replaced = null;
        if (target == null && inventory?["canAddCustomPage"]?.GetValue<bool>() == false)
        {
            target = pages.FirstOrDefault(p => Deletable(p) && p["current"]?.GetValue<bool>() == true)
                  ?? pages.FirstOrDefault(Deletable);
            if (target == null) return (false, Loc.T("runesNoPage", "Runy: nemáš žádnou stránku run, kterou jde přepsat."));
            replaced = target["name"]?.GetValue<string>();
        }
        if (target != null)
        {
            var (deleted, delError) = await SendChecked(HttpMethod.Delete, $"/lol-perks/v1/pages/{target["id"]}");
            if (!deleted) return (false, Loc.T("runesFree", "Runy: nepodařilo se uvolnit stránku ({0}).", delError));
        }

        var body = new JsonObject
        {
            ["name"] = page["name"]?.GetValue<string>() ?? "NotLoL",
            ["primaryStyleId"] = page["primaryStyleId"]?.GetValue<int>(),
            ["subStyleId"] = page["subStyleId"]?.GetValue<int>(),
            ["selectedPerkIds"] = page["selectedPerkIds"]?.DeepClone(),
            ["current"] = true,
        };
        var (ok, error) = await SendChecked(HttpMethod.Post, "/lol-perks/v1/pages", body);
        if (!ok) return (false, Loc.T("runesRejected", "Runy: klient je odmítl ({0}).", error));
        return (true, replaced != null
            ? Loc.T("runesReplaced", "Runy nahrány (stránka „{0}“ přepsána, nebyla volná).", replaced)
            : Loc.T("runesOk", "Runy nahrány."));
    }

    public async Task<(bool ok, string message)> ImportSpellsAsync(int spell1, int spell2)
    {
        var cs = await GetChampSelectAsync();
        if (cs == null) return (false, Loc.T("spellsNoSelect", "Kouzla: nejsi ve výběru šampiona."));
        // Flash nechat na klávese, kde ho hráč má
        const int Flash = 4;
        if ((spell1 == Flash && cs.Spell2 == Flash) || (spell2 == Flash && cs.Spell1 == Flash))
            (spell1, spell2) = (spell2, spell1);
        var (ok, error) = await SendChecked(new HttpMethod("PATCH"), "/lol-champ-select/v1/session/my-selection",
            new JsonObject { ["spell1Id"] = spell1, ["spell2Id"] = spell2 });
        return ok ? (true, Loc.T("spellsOk", "Kouzla nastavena.")) : (false, Loc.T("spellsRejected", "Kouzla: klient je odmítl ({0}).", error));
    }

    public async Task<(bool ok, string message)> ImportItemSetAsync(JsonNode set)
    {
        var me = await GetAsync("/lol-summoner/v1/current-summoner");
        var summonerId = me?["summonerId"]?.GetValue<long>();
        if (summonerId == null) return (false, Loc.T("setNoAccount", "Item set: nepodařilo se zjistit účet."));
        var url = $"/lol-item-sets/v1/item-sets/{summonerId}/sets";
        if (await GetAsync(url) is not JsonObject data) return (false, Loc.T("setLoad", "Item set: nepodařilo se načíst item sety."));

        int champ = set["championId"]?.GetValue<int>() ?? 0;
        var sets = data["itemSets"] as JsonArray ?? new JsonArray();
        // Starší NotLoL set pro stejného šampiona nahradíme
        for (int i = sets.Count - 1; i >= 0; i--)
        {
            var title = sets[i]?["title"]?.GetValue<string>() ?? "";
            var champs = sets[i]?["associatedChampions"]?.AsArray().Select(c => c?.GetValue<int>() ?? 0) ?? [];
            if (title.StartsWith("NotLoL") && champs.Contains(champ)) sets.RemoveAt(i);
        }

        var blocks = new JsonArray();
        foreach (var b in set["blocks"]?.AsArray() ?? new JsonArray())
        {
            blocks.Add(new JsonObject
            {
                ["type"] = b?["type"]?.GetValue<string>() ?? "",
                ["items"] = b?["items"]?.DeepClone(),
                ["hideIfSummonerSpell"] = "",
                ["showIfSummonerSpell"] = "",
            });
        }
        sets.Add(new JsonObject
        {
            ["title"] = set["title"]?.GetValue<string>() ?? "NotLoL",
            ["associatedChampions"] = new JsonArray(champ),
            ["associatedMaps"] = set["maps"]?.DeepClone() ?? new JsonArray(11),
            ["blocks"] = blocks,
            ["map"] = "any",
            ["mode"] = "any",
            ["preferredItemSlots"] = new JsonArray(),
            ["sortrank"] = 0,
            ["startedFrom"] = "blank",
            ["type"] = "custom",
            ["uid"] = Guid.NewGuid().ToString(),
        });
        data["itemSets"] = sets;

        var (ok, error) = await SendChecked(HttpMethod.Put, url, data);
        return ok ? (true, Loc.T("setOk", "Item set nahrán (najdeš ho v obchodě ve hře).")) : (false, Loc.T("setRejected", "Item set: klient ho odmítl ({0}).", error));
    }
}

/// <summary>Živá data z běžící hry (oficiální Live Client Data API na portu 2999).</summary>
sealed class LiveGame : IDisposable
{
    readonly HttpClient http = LocalHttp.Create(TimeSpan.FromSeconds(2));

    public sealed record Player(
        string RiotId, string Champion, string Team, string Position, bool IsBot, int Level,
        int Kills, int Deaths, int Assists, int Cs, int[] Items, string[] Spells, bool IsDead, double Respawn,
        string Subteam = "");

    public sealed record Snapshot(
        string Champion, string Position, string GameMode, double GameTime,
        int Level, Dictionary<string, int> Skills, HashSet<int> Items,
        string RiotId = "", List<Player>? Players = null);

    public async Task<Snapshot?> GetAsync()
    {
        try
        {
            var json = await http.GetStringAsync("https://127.0.0.1:2999/liveclientdata/allgamedata");
            var data = JsonNode.Parse(json);
            var active = data?["activePlayer"];
            if (active == null) return null;

            var players = (data!["allPlayers"]?.AsArray() ?? new JsonArray()).OfType<JsonNode>().Select(ParsePlayer).ToList();
            var riotId = Str(active["riotId"]) is { Length: > 0 } rid ? rid : Str(active["summonerName"]);
            var me = players.FirstOrDefault(p => p.RiotId == riotId);
            if (me == null) return null;

            var skills = new Dictionary<string, int>();
            foreach (var key in new[] { "Q", "W", "E", "R" })
                skills[key] = active["abilities"]?[key]?["abilityLevel"]?.GetValue<int>() ?? 0;

            return new Snapshot(
                me.Champion,
                me.Position,
                Str(data["gameData"]?["gameMode"]),
                data["gameData"]?["gameTime"]?.GetValue<double>() ?? 0,
                active["level"]?.GetValue<int>() ?? 1,
                skills,
                me.Items.ToHashSet(),
                riotId,
                players);
        }
        catch
        {
            return null; // hra ještě nenačetla nebo neběží
        }
    }

    static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
    static int Int(JsonNode? n) =>
        n is JsonValue v ? (v.TryGetValue<int>(out var i) ? i : v.TryGetValue<double>(out var d) ? (int)d : 0) : 0;

    static Player ParsePlayer(JsonNode p)
    {
        // "game_character_displayname_MonkeyKing" -> "MonkeyKing" (id z Data Dragonu)
        var raw = Str(p["rawChampionName"]);
        var champion = raw.StartsWith("game_character_displayname_") ? raw["game_character_displayname_".Length..] : raw;
        var items = (p["items"]?.AsArray() ?? new JsonArray())
            .Select(it => Int(it?["itemID"])).Where(id => id > 0).ToArray();
        // "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName" -> "SummonerFlash"
        var spells = new[] { "summonerSpellOne", "summonerSpellTwo" }
            .Select(k => Str(p["summonerSpells"]?[k]?["rawDisplayName"]).Split('_').FirstOrDefault(s => s.StartsWith("Summoner")) ?? "")
            .ToArray();
        var scores = p["scores"];
        var riotId = Str(p["riotId"]) is { Length: > 0 } rid ? rid : Str(p["summonerName"]);
        return new Player(
            riotId, champion, Str(p["team"]), Str(p["position"]), p["isBot"]?.GetValue<bool>() == true,
            Math.Max(1, Int(p["level"])),
            Int(scores?["kills"]), Int(scores?["deaths"]), Int(scores?["assists"]), Int(scores?["creepScore"]),
            items, spells, p["isDead"]?.GetValue<bool>() == true, p["respawnTimer"]?.GetValue<double>() ?? 0,
            // Arena: dvojice (pokud ji hra posílá) – jinak se hráči seskupí podle týmu
            Subteam(p));
    }

    static string Subteam(JsonNode p)
    {
        foreach (var key in new[] { "subteamId", "subTeamId", "subteam", "subTeam" })
        {
            var n = p[key];
            if (n is JsonValue v)
            {
                if (v.TryGetValue<string>(out var s) && s.Length > 0) return s;
                var i = Int(n);
                if (i > 0) return i.ToString();
            }
        }
        return "";
    }

    public void Dispose() => http.Dispose();
}

static class LocalHttp
{
    // LoL klient i hra používají na 127.0.0.1 vlastní certifikát Riotu
    public static HttpClient Create(TimeSpan timeout) => new(new HttpClientHandler
    {
        ServerCertificateCustomValidationCallback = (req, _, _, _) => req.RequestUri?.Host == "127.0.0.1",
    })
    { Timeout = timeout };
}
