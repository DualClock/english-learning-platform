# --- Build ---
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY EnglishLearningPlatform.API/*.csproj ./
RUN dotnet restore

COPY EnglishLearningPlatform.API/ ./
RUN dotnet publish -c Release -o /app/publish --no-restore

# --- Runtime ---
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

# Книга/обложки пишутся в uploads — оставляем папку в контейнере
RUN mkdir -p /app/uploads/books /app/uploads/covers

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "EnglishLearningPlatform.API.dll"]
