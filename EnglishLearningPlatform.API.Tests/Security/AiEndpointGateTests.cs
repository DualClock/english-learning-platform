using System.Reflection;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Security;
using EnglishLearningPlatform.API.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.Extensions.Logging;

namespace EnglishLearningPlatform.API.Tests.Security;

/// <summary>
/// W1.4.3 (SECURITY_GATE R-06): страховка от класса дефекта, а не от одного URL.
///
/// Фикс 1b1c8c9 поставил <c>[RequireConfirmedEmail]</c> на четыре контроллера по
/// списку в голове автора и потому пропустил `GET /api/books/{id}/parallel`,
/// который переводит страницу книги одним платным вызовом Gemini. Старый тест
/// перебирал захардкоженный массив из четырёх типов — новый эндпоинт с доступом
/// к модели был для него невидим в принципе.
///
/// Здесь список не ведётся нигде:
///  - «AI-сервис» = тип с маркером <see cref="IAiBackedService"/>, плюс всё, что
///    транзитивно получает его в конструкторе (фиксированная точка по DI-графу);
///  - «AI-достижимый экшен» = публичный [Http*]-экшен, в теле которого (или в
///    приватном хелпере того же контроллера, куда он заходит) есть обращение к
///    полю такого типа;
///  - тест падает, если у такого экшена нет гейта — на действии или на классе.
///
/// Разбор тел идёт по синтаксическому дереву исходников контроллеров, а не по
/// IL: async-экшен компилируется в машину состояний, и в IL вызов сервиса лежит
/// не в том методе, который видит MVC.
/// </summary>
public class AiEndpointGateTests
{
    private static readonly Assembly ApiAssembly = typeof(AiService).Assembly;

    private sealed record AiAction(string Controller, string Action, bool Gated, string Reason)
    {
        public string Name => $"{Controller}.{Action}";

        public string Diagnosis => $"{Name}: {Reason}";
    }

    // ---------------------------------------------------------------- детектор

    /// <summary>
    /// Типы, через которые контроллер может дойти до модели: пометившие себя
    /// <see cref="IAiBackedService"/> и всё, что их инжектит.
    /// </summary>
    private static HashSet<Type> AiTaintedTypes(IEnumerable<Type>? extraCandidates = null)
    {
        // Только сервисы: контроллер — потребитель, он не может «заразиться» и
        // потянуть за собой свои же поля (без этого ILogger<BooksController>
        // оказывался AI-полем, и каждая загрузка книги попадала в список)
        var classes = ApiAssembly.GetTypes()
            .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition &&
                        !typeof(ControllerBase).IsAssignableFrom(t))
            .Concat(extraCandidates ?? Array.Empty<Type>())
            .ToList();

        var tainted = new HashSet<Type>(classes.Where(t => typeof(IAiBackedService).IsAssignableFrom(t)));

        var changed = true;
        while (changed)
        {
            changed = false;
            foreach (var type in classes)
            {
                if (tainted.Contains(type)) continue;

                if (type.GetConstructors().Any(c => c.GetParameters().Any(p => DependsOnAi(p.ParameterType, tainted))))
                {
                    tainted.Add(type);
                    changed = true;
                }
            }
        }

        return tainted;
    }

    private static bool DependsOnAi(Type type, HashSet<Type> tainted)
    {
        if (tainted.Contains(type)) return true;

        // Журналирование ничего не стоит: ILogger<AiService> — это не доступ к модели
        if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(ILogger<>)) return false;

        // IEnumerable<AiService>, Task<AiService> и т.п. тоже тянут зависимость
        return type.IsGenericType && type.GetGenericArguments().Any(a => DependsOnAi(a, tainted));
    }

    private static Type[] ControllerTypes() =>
        ApiAssembly.GetTypes()
            .Where(t => t.IsClass && !t.IsAbstract && typeof(ControllerBase).IsAssignableFrom(t))
            .OrderBy(t => t.Name, StringComparer.Ordinal)
            .ToArray();

    private static string ControllersSourceDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory != null)
        {
            var candidate = Path.Combine(directory.FullName, "EnglishLearningPlatform.API", "Controllers");
            if (Directory.Exists(candidate)) return candidate;
            directory = directory.Parent;
        }

        // Молча «пройти», потому что исходников нет, — ровно тот способ, которым
        // такая страховка перестаёт что-либо гарантировать
        throw new DirectoryNotFoundException(
            "Не найден EnglishLearningPlatform.API/Controllers: тест не может определить AI-достижимые экшены");
    }

    private static IReadOnlyList<AiAction> DetectAiReachableActions()
    {
        var tainted = AiTaintedTypes();
        var files = Directory.GetFiles(ControllersSourceDirectory(), "*.cs");
        var trees = files
            .Select(path => CSharpSyntaxTree.ParseText(File.ReadAllText(path), path: path))
            .ToList();

        var detected = new List<AiAction>();

        foreach (var controller in ControllerTypes())
        {
            var classDeclaration = FindClassDeclaration(trees, controller.Name);
            var aiIdentifiers = AiIdentifierNames(controller, tainted);

            if (aiIdentifiers.Count == 0)
            {
                continue;
            }

            var helpers = classDeclaration!.Members
                .OfType<MethodDeclarationSyntax>()
                .GroupBy(m => m.Identifier.Text, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

            var gatedOnController =
                classDeclaration.AttributeLists.Any(HasGate) ||
                controller.GetCustomAttributes(typeof(RequireConfirmedEmailAttribute), inherit: true).Length > 0;

            foreach (var action in classDeclaration.Members.OfType<MethodDeclarationSyntax>().Where(IsHttpAction))
            {
                var reason = WhyReachesAi(action, aiIdentifiers, helpers, new HashSet<MethodDeclarationSyntax>());
                if (reason == null)
                {
                    continue;
                }

                detected.Add(new AiAction(controller.Name, action.Identifier.Text,
                    gatedOnController || HasGateList(action.AttributeLists), reason));
            }
        }

        return detected;
    }

    /// <summary>
    /// Имена, по которым экшен «касается» AI-слоя: поля контроллера нужного типа,
    /// параметры его конструктора (сервис мог быть проброшен дальше без поля) и
    /// сами имена типов — статический вызов или ResolveService&lt;AiService&gt;()
    /// ведут в модель не хуже `_aiService.Translate(...)`.
    /// </summary>
    private static HashSet<string> AiIdentifierNames(Type controller, HashSet<Type> tainted)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);

        foreach (var field in controller.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public))
        {
            if (DependsOnAi(field.FieldType, tainted)) names.Add(field.Name);
        }

        foreach (var parameter in controller.GetConstructors().SelectMany(c => c.GetParameters()))
        {
            if (DependsOnAi(parameter.ParameterType, tainted)) names.Add(parameter.Name);
        }

        foreach (var type in tainted)
        {
            names.Add(type.Name);
        }

        return names;
    }

    private static ClassDeclarationSyntax? FindClassDeclaration(IEnumerable<SyntaxTree> trees, string className) =>
        trees.SelectMany(t => t.GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>())
             .FirstOrDefault(c => c.Identifier.Text == className);

    private static bool IsHttpAction(MethodDeclarationSyntax method)
    {
        if (!method.Modifiers.Any(SyntaxKind.PublicKeyword)) return false;
        if (method.AttributeLists.SelectMany(a => a.Attributes).Any(a => EndsWith(GetAttributeName(a), "NonAction"))) return false;

        return method.AttributeLists
            .SelectMany(list => list.Attributes)
            .Select(GetAttributeName)
            .Any(name => EndsWith(name, "HttpGet") || EndsWith(name, "HttpPost") ||
                         EndsWith(name, "HttpPut") || EndsWith(name, "HttpDelete") ||
                         EndsWith(name, "HttpPatch"));
    }

    private static bool HasGate(AttributeListSyntax list) =>
        list.Attributes.Any(a => EndsWith(GetAttributeName(a), "RequireConfirmedEmail"));

    private static bool HasGateList(SyntaxList<AttributeListSyntax> lists) => lists.Any(HasGate);

    private static string GetAttributeName(AttributeSyntax attribute)
    {
        var name = attribute.Name.ToString();
        return name.Contains('.') ? name.Substring(name.LastIndexOf('.') + 1) : name;
    }

    private static bool EndsWith(string name, string suffix) =>
        name == suffix || name.EndsWith(suffix + "Attribute", StringComparison.Ordinal) || name.EndsWith(suffix, StringComparison.Ordinal);

    /// <summary>
    /// Есть ли в теле обращения к полю AI-сервиса. Заодно проходим через
    /// приватные хелперы того же контроллера: GetParallelPage сам ничего не
    /// вызывает, он зовёт TranslateChunksAsync, а тот — _aiService.
    /// </summary>
    private static string? WhyReachesAi(
        MethodDeclarationSyntax method,
        HashSet<string> aiIdentifiers,
        Dictionary<string, List<MethodDeclarationSyntax>> helpers,
        HashSet<MethodDeclarationSyntax> visiting)
    {
        if (!visiting.Add(method))
        {
            return null;
        }

        // IdentifierName покрывает и `_aiService.Translate(...)`, и передачу поля
        // аргументом, и лямбды внутри метода: они — потомки того же дерева
        var hit = method.DescendantNodes()
            .OfType<IdentifierNameSyntax>()
            .Select(id => id.Identifier.Text)
            .FirstOrDefault(aiIdentifiers.Contains);

        if (hit != null)
        {
            return $"«{hit}» в {method.Identifier.Text}";
        }

        foreach (var invocation in method.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            var name = invocation.Expression switch
            {
                IdentifierNameSyntax id => id.Identifier.Text,
                MemberAccessExpressionSyntax ma when ma.Expression is ThisExpressionSyntax => ma.Name.Identifier.Text,
                _ => null
            };

            if (name == null || !helpers.TryGetValue(name, out var overloads)) continue;

            foreach (var overload in overloads)
            {
                var inner = WhyReachesAi(overload, aiIdentifiers, helpers, visiting);
                if (inner != null)
                {
                    return $"{method.Identifier.Text} → {inner}";
                }
            }
        }

        return null;
    }

    // ------------------------------------------------------------------ тесты

    [Fact]
    public void EveryAiReachableAction_RequiresConfirmedEmail()
    {
        var ungated = DetectAiReachableActions().Where(a => !a.Gated).ToList();

        Assert.True(
            ungated.Count == 0,
            "Экшены ниже доходят до AI-сервиса (Gemini за деньги) и не закрыты [RequireConfirmedEmail]: " +
            string.Join("; ", ungated.Select(a => a.Diagnosis)) +
            ". Платный вызов доступен аккаунту, который не подтвердил почту — SECURITY_GATE R-06.");
    }

    /// <summary>
    /// Позитивный контроль: детектор обязан видеть именно те экшены, которые
    /// видны руками. Без этого теста «зелёно» могло бы означать «разбор сломался».
    /// </summary>
    [Fact]
    public void Detector_SeesEveryKnownAiEntryPoint()
    {
        var detected = DetectAiReachableActions().Select(a => a.Name).ToHashSet(StringComparer.Ordinal);

        // Reader 3.0 удалил GET /parallel вместе со старым постраничным
        // переводом, поэтому «известный вход» проверяем на живых AI-контроллерах:
        // если детектор перестанет их видеть, страховка ослепнет молча.
        foreach (var controller in new[] { "AiController", "AssistantController", "AudioController", "PronunciationController" })
        {
            Assert.Contains(detected, name => name.StartsWith(controller + ".", StringComparison.Ordinal));
        }
    }

    [Fact]
    public void Detector_DoesNotFlagReadPathsThatNeverTouchAModel()
    {
        // Читалка книг и список сборников должны оставаться доступными
        // неподтверждённому аккаунту: если детектор начнёт флаговать всё подряд,
        // «починить» тест поставив атрибут на класс — значит отрезать людям
        // библиотеку. Этот тест держит границу.
        var detected = DetectAiReachableActions().ToDictionary(a => a.Name, a => a.Diagnosis);
        var suspects = new[]
        {
            "BooksController.GetBooks", "BooksController.GetBook", "BooksController.GetBookmarks",
            "BooksController.GetRecommendedBooks", "BooksController.AddStory", "BooksController.UploadBook",
            "ReaderController.GetManifest", "ReaderController.GetChapter", "ReaderController.LookupWord"
        };

        Assert.True(
            suspects.All(s => !detected.ContainsKey(s)),
            "Детектор flagует чтения без модели: " +
            string.Join("; ", suspects.Where(s => detected.ContainsKey(s)).Select(s => detected[s])));
    }

    /// <summary>
    /// Маркер не должен протухать: любой класс, который получает
    /// <see cref="ResilientAiService"/> в конструкторе, обязан сам помечать себя
    /// как AI-слой. Иначе новый обёртка надо Gemini не попадёт в граф, и
    /// страховка ослепнет ровно на том эндпоинте, ради которого написана.
    /// </summary>
    [Fact]
    public void EveryConsumerOfResilientAiService_MarksItselfAiBacked()
    {
        var offenders = ApiAssembly.GetTypes()
            .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition)
            .Where(t => !typeof(IAiBackedService).IsAssignableFrom(t))
            .Where(t => t.GetConstructors().Any(c => c.GetParameters().Any(p => p.ParameterType == typeof(ResilientAiService))))
            .Select(t => t.FullName)
            .ToList();

        Assert.Empty(offenders);
    }

    /// <summary>
    /// Механика без ручного списка: обёртка, которая просто инжектит
    /// AI-сервис, попадает в граф сама. Тест фиксирует, что «новый способ
    /// дойти до модели» не требует править этот файл — ровно то, чего не
    /// хватило фиксу 1b1c8c9.
    /// </summary>
    [Fact]
    public void TaintPropagatesThroughConstructorInjection()
    {
        var tainted = AiTaintedTypes(new[] { typeof(WrapperOverAiService) });

        Assert.Contains(typeof(WrapperOverAiService), tainted);
        Assert.True(DependsOnAi(typeof(WrapperOverAiService), tainted));
    }

    private sealed class WrapperOverAiService
    {
        public WrapperOverAiService(AiService aiService) { }
    }

    [Fact]
    public void LoggerWrapperIsNotMistakenForTheModel()
    {
        // ILogger<AiService> — это журнал, а не платный вызов
        Assert.False(DependsOnAi(typeof(ILogger<AiService>), AiTaintedTypes()));
    }

    [Fact]
    public void AiTaintedTypes_AreTheModelBoundaryAndNothingElse()
    {
        var names = AiTaintedTypes().Select(t => t.Name).OrderBy(n => n, StringComparer.Ordinal).ToList();

        Assert.Contains("ResilientAiService", names);
        Assert.Contains("AiService", names);
        Assert.Contains("AssistantService", names);
        Assert.Contains("SpeechService", names);

        // сеeder'ы, читалка, словарный сервис к модели не ходят — если это
        // изменится, тест заставит пересмотреть список гейтов, а не молчать
        Assert.DoesNotContain("BookAnalyzerService", names);
        Assert.DoesNotContain("StorySeeder", names);
        Assert.DoesNotContain("DictionaryService", names);
        Assert.DoesNotContain("ReaderDifficultyService", names);
    }

    [Fact]
    public void EveryController_SourceIsVisibleToTheScanner()
    {
        // Страховка работает по исходникам: потеря файла контроллера должна
        // падать здесь, а не превращаться в «всё хорошо»
        var directory = ControllersSourceDirectory();
        var sources = Directory.GetFiles(directory, "*.cs")
            .SelectMany(path => CSharpSyntaxTree.ParseText(File.ReadAllText(path))
                .GetRoot().DescendantNodes().OfType<ClassDeclarationSyntax>())
            .Select(c => c.Identifier.Text)
            .ToHashSet(StringComparer.Ordinal);

        var missing = ControllerTypes().Select(t => t.Name).Where(n => !sources.Contains(n)).ToList();

        Assert.True(missing.Count == 0, $"Нет исходника для контроллеров: {string.Join(", ", missing)} в {directory}");
    }
}
