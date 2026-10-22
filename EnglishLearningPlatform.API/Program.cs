using System.Text;
using System.Threading.RateLimiting;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Middleware;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Services;
using EnglishLearningPlatform.API.Validators;
using FluentValidation;
using FluentValidation.AspNetCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Extensions.FileProviders;
using Serilog;

// Настройка Serilog
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    // AspNetCore пишет по 5+ INF-строк на запрос; одну сводку даёт
    // UseSerilogRequestLogging, остальное от него не нужно
    .MinimumLevel.Override("Microsoft.AspNetCore", Serilog.Events.LogEventLevel.Warning)
    .WriteTo.Console()
    .WriteTo.File("logs/app-.log", rollingInterval: RollingInterval.Day)
    .CreateLogger();

var builder = WebApplication.CreateBuilder(args);

// Используем Serilog
builder.Host.UseSerilog();

// Add services
builder.Services.AddControllers();

// Наблюдаемость: единый формат ошибок (ProblemDetails) и глобальный обработчик
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();

// Health check с реальной проверкой БД: деплой-скрипты видят падение Postgres
builder.Services.AddHealthChecks()
    .AddCheck<DatabaseHealthCheck>("database");


// FluentValidation
builder.Services.AddFluentValidationAutoValidation();
builder.Services.AddFluentValidationClientsideAdapters();
builder.Services.AddValidatorsFromAssemblyContaining<Program>();

// Swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// CORS для frontend: localhost + домены из env (Cors__Origins, через запятую)
var corsOrigins = new List<string> { "http://localhost:3000" };
var extraOrigins = builder.Configuration["Cors:Origins"];
if (!string.IsNullOrWhiteSpace(extraOrigins))
{
    corsOrigins.AddRange(extraOrigins.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
}

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy.WithOrigins(corsOrigins.ToArray())
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// DbContext
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

// Identity
builder.Services.AddIdentity<User, IdentityRole>(options =>
{
    options.Password.RequireDigit = true;
    options.Password.RequireLowercase = true;
    options.Password.RequireUppercase = true;
    options.Password.RequireNonAlphanumeric = false;
    options.Password.RequiredLength = 6;
})
.AddEntityFrameworkStores<ApplicationDbContext>()
.AddDefaultTokenProviders();

// JWT Authentication
var jwtKey = builder.Configuration["Jwt:Key"];
var jwtIssuer = builder.Configuration["Jwt:Issuer"]!;
var jwtAudience = builder.Configuration["Jwt:Audience"]!;

// Не даём приложению молча стартовать с публичным ключом-заглушкой:
// иначе любой может подделать JWT. В Development это только предупреждение.
if (string.IsNullOrWhiteSpace(jwtKey)
    || jwtKey.StartsWith("SET_IN_ENV", StringComparison.OrdinalIgnoreCase)
    || jwtKey.Length < 32)
{
    if (!builder.Environment.IsDevelopment())
    {
        throw new InvalidOperationException(
            "Jwt:Key не настроен. Задайте секрет длиной не менее 32 символов через переменную окружения Jwt__Key.");
    }

    Log.Warning("Jwt:Key не настроен — используется ключ-заглушка из appsettings.json. Для реальной работы задайте Jwt__Key.");
}

// Проверка почты и ссылок: в Production напоминания без SMTP и FrontendUrl
// молча не доходят, поэтому валидируем на старте. В Development — только предупреждение.
var emailFrom = builder.Configuration["Email:From"];
var frontendUrl = builder.Configuration["App:FrontendUrl"];
var smtpHost = builder.Configuration["Email:Smtp:Host"];
var configProblems = new List<string>();

if (string.IsNullOrWhiteSpace(emailFrom) || !System.Net.Mail.MailAddress.TryCreate(emailFrom, out _))
    configProblems.Add("Email:From должен быть корректным адресом отправителя.");

if (string.IsNullOrWhiteSpace(frontendUrl) || !Uri.TryCreate(frontendUrl, UriKind.Absolute, out _))
    configProblems.Add("App:FrontendUrl должен быть абсолютным URL (ссылки из писем строятся от него).");

if (string.IsNullOrWhiteSpace(smtpHost))
    configProblems.Add("Email:Smtp:Host не задан — письма будут только в журнале, а не на почту.");

if (configProblems.Count > 0)
{
    var message = string.Join(" ", configProblems);
    if (!builder.Environment.IsDevelopment())
    {
        throw new InvalidOperationException(
            "Конфигурация почты неполна: " + message + " Задайте переменные Email__From, App__FrontendUrl, Email__Smtp__Host.");
    }

    Log.Warning("Проверка конфигурации: {ConfigProblems}", message);
}

// Rate limiting: защита логина/регистрации/сброса пароля от брутфорса
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // Обратная связь анонимна: без лимита один человек (или скрипт) может
    // засыпать почту отзывами. Тридцать сообщений за десять минут — с запасом
    // для группы тестеров и без простора для флуда.
    options.AddPolicy("feedback", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(10),
                QueueLimit = 0
            }));
});

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtIssuer,
        ValidAudience = jwtAudience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey!))
    };
});

builder.Services.AddAuthorization();

// Наши сервисы
builder.Services.AddMemoryCache();
builder.Services.AddScoped<AiQuotaService>();
builder.Services.AddSingleton(sp => new ResilientAiService(
    sp.GetRequiredService<IConfiguration>(),
    sp.GetRequiredService<ILogger<ResilientAiService>>(),
    scopeFactory: sp.GetRequiredService<IServiceScopeFactory>()));
builder.Services.AddScoped<DictionaryService>();
builder.Services.AddScoped<SrsService>();
builder.Services.AddScoped<AiService>();
builder.Services.AddScoped<AssistantService>();
builder.Services.AddScoped<SpeechService>();
builder.Services.AddScoped<PronunciationService>();
builder.Services.AddScoped<LemmatizerService>();
builder.Services.AddScoped<ReaderDifficultyService>();
builder.Services.AddScoped<BookService>();
builder.Services.AddScoped<PopularBooksService>();
builder.Services.AddScoped<ActivityService>();
builder.Services.AddScoped<AchievementService>();
builder.Services.AddScoped<EmailSender>();
builder.Services.AddScoped<AuthEmailService>();
builder.Services.AddScoped<ReminderService>();
builder.Services.AddHostedService<ReminderBackgroundService>();
builder.Services.AddScoped<BookAnalyzerService>();
builder.Services.AddScoped<WordListSeeder>();
builder.Services.AddScoped<CategorySeeder>();
builder.Services.AddScoped<GrammarSeeder>();
builder.Services.AddScoped<StorySeeder>();

var app = builder.Build();

// Одна строка на каждый HTTP-запрос в журнал; /health опрашивается часто —
// успешные его пробы не пишем, чтобы не засорять журнал
app.UseSerilogRequestLogging(options =>
{
    options.GetLevel = (httpContext, elapsed, exception) =>
        exception != null || httpContext.Response.StatusCode >= 500
            ? Serilog.Events.LogEventLevel.Error
            : httpContext.Request.Path.StartsWithSegments("/health")
                ? Serilog.Events.LogEventLevel.Verbose
                : Serilog.Events.LogEventLevel.Information;
});

// Ловит необработанные исключения из всего, что ниже по конвейеру
app.UseExceptionHandler();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// app.UseHttpsRedirection();

// Публично раздаём только обложки книг: они не содержат персональных данных.
// Аватары и EPUB отдаёт FilesController с проверкой владельца.
var coversDirectory = Path.Combine(app.Environment.ContentRootPath, "uploads", "covers");
Directory.CreateDirectory(coversDirectory);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(coversDirectory),
    RequestPath = "/uploads/covers"
});

// CORS должен быть ДО UseAuthentication
app.UseCors("Frontend");

app.UseRateLimiter();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

// Health check для деплоя: 200, когда БД отвечает, иначе 503.
// Формат совместим со старой заглушкой: { status: "ok", time }
app.MapHealthChecks("/health", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";
        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            status = report.Status == Microsoft.Extensions.Diagnostics.HealthChecks.HealthStatus.Healthy
                ? "ok"
                : report.Status.ToString().ToLowerInvariant(),
            time = DateTime.UtcNow,
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString().ToLowerInvariant()
            })
        });
        await context.Response.WriteAsync(payload, context.RequestAborted);
    }
});

// В Development засеваем контент при старте. Сидеры идемпотентны, поэтому
// повторный запуск ничего не дублирует. Без этого «Сборники», «Категории»
// и «Грамматика» на фронтенде остаются пустыми, пока кто-нибудь вручную
// не дёрнет /api/admin/seed-* с JWT.
if (app.Environment.IsDevelopment())
{
    using var seedScope = app.Services.CreateScope();
    var seedProvider = seedScope.ServiceProvider;
    var seedLogger = seedProvider.GetRequiredService<ILogger<Program>>();

    try
    {
        var wordListsSeed = await seedProvider.GetRequiredService<WordListSeeder>().SeedAsync();
        var categoriesSeed = await seedProvider.GetRequiredService<CategorySeeder>().SeedAsync();
        var grammarSeed = await seedProvider.GetRequiredService<GrammarSeeder>().SeedAsync();

        seedLogger.LogInformation(
            "Сиды: сборники — {WordLists} (списков {Lists}, слов {Words}), категории — {Categories}, грамматика — {Grammar} (юнитов {Units})",
            wordListsSeed.AlreadySeeded ? "уже были" : "засеяны",
            wordListsSeed.ListsCreated,
            wordListsSeed.WordLevelsSeeded,
            categoriesSeed.AlreadySeeded ? "уже были" : "засеяны",
            grammarSeed.AlreadySeeded ? "уже были" : "засеяны",
            grammarSeed.UnitsCreated);
    }
    catch (Exception ex)
    {
        // Не валим старт API из-за контента: без сидов приложение работает,
        // просто соответствующие разделы будут пустыми.
        seedLogger.LogError(ex, "Автозасев контента не удался, приложение продолжает работу");
    }
}

// Логируем запуск
Log.Information("English Learning Platform API started");

app.Run();