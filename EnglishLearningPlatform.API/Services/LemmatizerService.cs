using System.Text.RegularExpressions;

namespace EnglishLearningPlatform.API.Services;

/// <summary>
/// Морфологический упроститель без AI: нерегулярные формы + правила
/// -s/-es/-ies/-ed/-ing. Возвращает набор форм токена, а не одну «истинную»
/// лемму: без словаря нельзя гарантировать единственный ответ, зато
/// пересечение по формам даёт устойчивое распознавание в читалке.
/// </summary>
public class LemmatizerService
{
    private const int MaxTokenLength = 40;

    // Нерегулярные глаголы и формы (базовая форма справа)
    private static readonly Dictionary<string, string> Irregular = new(StringComparer.OrdinalIgnoreCase)
    {
        // be / have / do / go
        ["am"] = "be", ["is"] = "be", ["are"] = "be", ["was"] = "be", ["were"] = "be", ["been"] = "be", ["being"] = "be",
        ["has"] = "have", ["had"] = "have", ["having"] = "have",
        ["does"] = "do", ["did"] = "do", ["done"] = "do", ["doing"] = "do",
        ["goes"] = "go", ["went"] = "go", ["gone"] = "go",
        ["says"] = "say", ["said"] = "say",
        ["makes"] = "make", ["made"] = "make",
        ["knows"] = "know", ["knew"] = "know", ["known"] = "know",
        ["thinks"] = "think", ["thought"] = "think",
        ["takes"] = "take", ["took"] = "take", ["taken"] = "take",
        ["sees"] = "see", ["saw"] = "see", ["seen"] = "see",
        ["comes"] = "come", ["came"] = "come",
        ["gives"] = "give", ["gave"] = "give", ["given"] = "give",
        ["finds"] = "find", ["found"] = "find",
        ["tells"] = "tell", ["told"] = "tell",
        ["becomes"] = "become", ["became"] = "become",
        ["leaves"] = "leave", ["left"] = "leave",
        ["feels"] = "feel", ["felt"] = "feel",
        ["puts"] = "put", ["putting"] = "put",
        ["brings"] = "bring", ["brought"] = "bring",
        ["begins"] = "begin", ["began"] = "begin", ["begun"] = "begin",
        ["keeps"] = "keep", ["kept"] = "keep",
        ["holds"] = "hold", ["held"] = "hold",
        ["writes"] = "write", ["wrote"] = "write", ["written"] = "write",
        ["stands"] = "stand", ["stood"] = "stand",
        ["hears"] = "hear", ["heard"] = "hear",
        ["means"] = "mean", ["meant"] = "mean",
        ["meets"] = "meet", ["met"] = "meet",
        ["runs"] = "run", ["ran"] = "run", ["running"] = "run",
        ["pays"] = "pay", ["paid"] = "pay",
        ["sits"] = "sit", ["sat"] = "sit", ["sitting"] = "sit",
        ["speaks"] = "speak", ["spoke"] = "speak", ["spoken"] = "speak",
        ["lies"] = "lie", ["lay"] = "lie", ["lain"] = "lie",
        ["leads"] = "lead", ["led"] = "lead",
        ["reads"] = "read", ["reading"] = "read",
        ["grows"] = "grow", ["grew"] = "grow", ["grown"] = "grow",
        ["loses"] = "lose", ["lost"] = "lose", ["losing"] = "lose",
        ["falls"] = "fall", ["fell"] = "fall", ["fallen"] = "fall",
        ["sends"] = "send", ["sent"] = "send",
        ["builds"] = "build", ["built"] = "build",
        ["understands"] = "understand", ["understood"] = "understand",
        ["draws"] = "draw", ["drew"] = "draw", ["drawn"] = "draw",
        ["breaks"] = "break", ["broke"] = "break", ["broken"] = "break",
        ["spends"] = "spend", ["spent"] = "spend",
        ["cuts"] = "cut", ["cutting"] = "cut",
        ["rises"] = "rise", ["rose"] = "rise", ["risen"] = "rise",
        ["drives"] = "drive", ["drove"] = "drive", ["driven"] = "drive",
        ["buys"] = "buy", ["bought"] = "buy",
        ["wears"] = "wear", ["wore"] = "wear", ["worn"] = "wear",
        ["chooses"] = "choose", ["chose"] = "choose", ["chosen"] = "choose",
        ["eats"] = "eat", ["ate"] = "eat", ["eaten"] = "eat",
        ["drinks"] = "drink", ["drank"] = "drink", ["drunk"] = "drink",
        ["sings"] = "sing", ["sang"] = "sing", ["sung"] = "sing",
        ["swims"] = "swim", ["swam"] = "swim", ["swum"] = "swim",
        ["sleeps"] = "sleep", ["slept"] = "sleep",
        ["teaches"] = "teach", ["taught"] = "teach",
        ["catches"] = "catch", ["caught"] = "catch",
        ["fights"] = "fight", ["fought"] = "fight",
        ["throws"] = "throw", ["threw"] = "throw", ["thrown"] = "throw",
        ["flies"] = "fly", ["flew"] = "fly", ["flown"] = "fly",
        ["forgets"] = "forget", ["forgot"] = "forget", ["forgotten"] = "forget",
        ["forgives"] = "forgive", ["forgave"] = "forgive", ["forgiven"] = "forgive",
        ["hides"] = "hide", ["hid"] = "hide", ["hidden"] = "hide",
        ["hits"] = "hit", ["hitting"] = "hit",
        ["hurts"] = "hurt", ["hurting"] = "hurt",
        ["shuts"] = "shut", ["shutting"] = "shut",
        ["sells"] = "sell", ["sold"] = "sell",
        ["shines"] = "shine", ["shone"] = "shine",
        ["shoots"] = "shoot", ["shot"] = "shoot",
        ["shows"] = "show", ["shown"] = "show",
        ["steals"] = "steal", ["stole"] = "steal", ["stolen"] = "steal",
        ["sticks"] = "stick", ["stuck"] = "stick",
        ["strikes"] = "strike", ["struck"] = "strike",
        ["wakes"] = "wake", ["woke"] = "wake", ["woken"] = "wake",
        ["wins"] = "win", ["won"] = "win", ["winning"] = "win",
        ["bites"] = "bite", ["bit"] = "bite", ["bitten"] = "bite",
        ["blows"] = "blow", ["blew"] = "blow", ["blown"] = "blow",
        ["burns"] = "burn", ["burnt"] = "burn",
        ["deals"] = "deal", ["dealt"] = "deal",
        ["digs"] = "dig", ["dug"] = "dig",
        ["feeds"] = "feed", ["fed"] = "feed",
        ["hangs"] = "hang", ["hung"] = "hang",
        ["lends"] = "lend", ["lent"] = "lend",
        ["rides"] = "ride", ["rode"] = "ride", ["ridden"] = "ride",
        ["rings"] = "ring", ["rang"] = "ring", ["rung"] = "ring",
        ["seeks"] = "seek", ["sought"] = "seek",
        ["shakes"] = "shake", ["shook"] = "shake", ["shaken"] = "shake",
        ["spreads"] = "spread", ["spreading"] = "spread",
        ["tears"] = "tear", ["tore"] = "tear", ["torn"] = "tear",

        // Нерегулярные множественные числа
        ["children"] = "child",
        ["men"] = "man",
        ["women"] = "woman",
        ["feet"] = "foot",
        ["teeth"] = "tooth",
        ["mice"] = "mouse",
        ["geese"] = "goose",
        ["people"] = "person",
        ["lives"] = "life",
        ["wives"] = "wife",
        ["knives"] = "knife",
        ["leaves"] = "leaf",
        ["halves"] = "half",
        ["selves"] = "self",
        ["wolves"] = "wolf",
        ["shelves"] = "shelf",
        ["thieves"] = "thief",
        ["oxen"] = "ox"
    };

    private static readonly Regex TokenPattern = new("[A-Za-z']+", RegexOptions.Compiled);

    /// <summary>
    /// Все разумные формы токена: сам токен, нерегулярная форма и варианты
    /// после отсечения окончаний. Порядок — от точного совпадения к производным.
    /// </summary>
    public IReadOnlyList<string> GetForms(string token)
    {
        var clean = NormalizeToken(token);
        if (clean.Length == 0 || clean.Length > MaxTokenLength)
        {
            return Array.Empty<string>();
        }

        var forms = new List<string>(6) { clean };

        void Add(string? form)
        {
            if (!string.IsNullOrEmpty(form) && form.Length >= 2 && !forms.Contains(form, StringComparer.OrdinalIgnoreCase))
            {
                forms.Add(form);
            }
        }

        if (Irregular.TryGetValue(clean, out var irregular))
        {
            // Нерегулярная форма — сильный кандидат, но правила ниже всё равно
            // добавляют регулярные варианты: «leaves» — это и leave, и leaf
            Add(irregular);
        }

        // Притяжательный падеж: speaker's -> speaker
        if (clean.EndsWith("'s", StringComparison.Ordinal))
        {
            Add(clean[..^2]);
        }

        if (clean.EndsWith("ies", StringComparison.Ordinal) && clean.Length > 4)
        {
            Add(clean[..^3] + "y");
        }

        if (clean.EndsWith("ied", StringComparison.Ordinal) && clean.Length > 4)
        {
            Add(clean[..^3] + "y");
        }

        if (clean.EndsWith("es", StringComparison.Ordinal) && clean.Length > 3)
        {
            var stem = clean[..^2];
            if (stem.EndsWith("s", StringComparison.Ordinal) ||
                stem.EndsWith("x", StringComparison.Ordinal) ||
                stem.EndsWith("z", StringComparison.Ordinal) ||
                stem.EndsWith("ch", StringComparison.Ordinal) ||
                stem.EndsWith("sh", StringComparison.Ordinal))
            {
                Add(stem);
            }
            else
            {
                // hopes -> hope (а не hop)
                Add(stem + "e");
                Add(stem);
            }
        }

        if (clean.EndsWith("s", StringComparison.Ordinal) &&
            !clean.EndsWith("ss", StringComparison.Ordinal) &&
            !clean.EndsWith("us", StringComparison.Ordinal) &&
            !clean.EndsWith("is", StringComparison.Ordinal) &&
            clean.Length > 3)
        {
            Add(clean[..^1]);
        }

        if (clean.EndsWith("ing", StringComparison.Ordinal) && clean.Length > 5)
        {
            var stem = clean[..^3];
            Add(stem);
            Add(stem + "e");
            Add(DropDoubledConsonant(stem));
        }

        if (clean.EndsWith("ed", StringComparison.Ordinal) && clean.Length > 4)
        {
            var stem = clean[..^2];
            Add(stem);
            Add(stem + "e");
            Add(DropDoubledConsonant(stem));
        }

        return forms;
    }

    /// <summary>Основная (самая вероятная) лемма токена.</summary>
    public string Lemmatize(string token)
    {
        var forms = GetForms(token);
        return forms.Count > 0 ? forms[^1] : NormalizeToken(token);
    }

    /// <summary>Токены текста в нижнем регистре без пунктуации.</summary>
    public IEnumerable<string> Tokenize(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            yield break;
        }

        foreach (Match match in TokenPattern.Matches(text))
        {
            var token = NormalizeToken(match.Value);
            if (token.Length >= 2)
            {
                yield return token;
            }
        }
    }

    private static string NormalizeToken(string token)
    {
        var clean = (token ?? string.Empty).ToLowerInvariant().Trim('\'', '"');
        return clean;
    }

    // running -> runn -> run (двойная согласная перед -ing/-ed)
    private static string? DropDoubledConsonant(string stem)
    {
        if (stem.Length < 3)
        {
            return null;
        }

        var last = stem[^1];
        var previous = stem[^2];

        if (last == previous && "bcdfgklmnprstvz".Contains(last))
        {
            return stem[..^1];
        }

        return null;
    }
}
