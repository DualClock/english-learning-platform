using System.Reflection;

// В этом окружении vstest testhost падает на OpenProcess (Win32 access denied),
// не доходя до тестов. Раннер выполняет те же xUnit-факты и теории в процессе,
// поэтому даёт честный результат без зависимости от testhost.
var filter = ReadFilter(args);
var assembly = Assembly.Load("EnglishLearningPlatform.API.Tests");
var passed = 0;
var failed = 0;
var skipped = 0;
var failures = new List<string>();

foreach (var type in assembly.GetTypes()
             .Where(type => type.IsClass && !type.IsAbstract)
             .OrderBy(type => type.FullName, StringComparer.Ordinal))
{
    var methods = type.GetMethods(BindingFlags.Public | BindingFlags.Instance)
        .Where(method => HasAttribute(method, "FactAttribute")
                         || HasAttribute(method, "TheoryAttribute"))
        .OrderBy(method => method.Name, StringComparer.Ordinal)
        .ToList();

    foreach (var method in methods)
    {
        var testName = $"{type.Name}.{method.Name}";
        if (filter != null && !testName.Contains(filter, StringComparison.OrdinalIgnoreCase))
            continue;

        var rows = GetRows(method);
        if (rows == null)
        {
            Console.WriteLine($"SKIP {testName}: неподдерживаемый источник данных теории");
            skipped++;
            continue;
        }

        if (rows.Count == 0) rows.Add(Array.Empty<object>());

        foreach (var row in rows)
        {
            if (row == null)
            {
                Console.WriteLine($"SKIP {testName}: пустая строка данных теории");
                skipped++;
                continue;
            }

            var displayName = row.Length == 0
                ? testName
                : $"{testName}({string.Join(", ", row.Select(value => FormatValue(value)))})";

            var skipReason = ReadString(method.GetCustomAttributes()
                .FirstOrDefault(attribute => attribute.GetType().Name is "FactAttribute" or "TheoryAttribute"), "Skip");
            if (!string.IsNullOrEmpty(skipReason))
            {
                Console.WriteLine($"SKIP {displayName}: {skipReason}");
                skipped++;
                continue;
            }

            object? instance = null;
            try
            {
                instance = Activator.CreateInstance(type);
                var result = method.Invoke(instance, row);
                if (result is Task task) await task;
                else if (result is ValueTask valueTask) await valueTask;

                Console.WriteLine($"PASS {displayName}");
                passed++;
            }
            catch (Exception exception)
            {
                var actual = exception is TargetInvocationException { InnerException: not null }
                    ? exception.InnerException
                    : exception;
                Console.WriteLine($"FAIL {displayName}: {actual.GetType().Name}: {actual.Message}");
                failures.Add($"{displayName}: {actual}");
                failed++;
            }
            finally
            {
                if (instance is IDisposable disposable) disposable.Dispose();
            }
        }
    }
}

Console.WriteLine();
Console.WriteLine($"Итог: {passed} passed, {failed} failed, {skipped} skipped");
if (failures.Count > 0)
{
    Console.WriteLine();
    Console.WriteLine("Провалы:");
    foreach (var failure in failures)
    {
        Console.WriteLine(failure);
    }
}

return failed == 0 ? 0 : 1;

static string? ReadFilter(string[] args)
{
    for (var index = 0; index < args.Length - 1; index++)
    {
        if (args[index] is "--filter" or "-f") return args[index + 1];
    }
    return null;
}

static bool HasAttribute(MemberInfo member, string attributeName) =>
    member.GetCustomAttributes().Any(attribute => attribute.GetType().Name == attributeName);

static List<object[]>? GetRows(MethodInfo method)
{
    if (HasAttribute(method, "FactAttribute")) return new List<object[]>();

    var rows = new List<object[]>();
    foreach (var attribute in method.GetCustomAttributes())
    {
        if (attribute.GetType().Name != "InlineDataAttribute") continue;

        var getData = attribute.GetType().GetMethod(
            "GetData",
            BindingFlags.Public | BindingFlags.Instance,
            binder: null,
            types: new[] { typeof(MethodInfo) },
            modifiers: null);
        if (getData != null)
        {
            if (getData.Invoke(attribute, new object[] { method }) is IEnumerable<object[]> data)
            {
                rows.AddRange(data);
                continue;
            }
        }

        var dataProperty = attribute.GetType().GetProperty("Data");
        if (dataProperty?.GetValue(attribute) is object[] values)
        {
            rows.Add(values);
            continue;
        }

        return null;
    }

    return rows;
}

static string? ReadString(object? source, string propertyName) =>
    source?.GetType().GetProperty(propertyName)?.GetValue(source) as string;

static string FormatValue(object? value) => value switch
{
    null => "null",
    string text => $"\"{text}\"",
    _ => value.ToString() ?? "null"
};
