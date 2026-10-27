#!/usr/bin/env bash
set -euo pipefail
dotnet run --project EnglishLearningPlatform.TestRunner/EnglishLearningPlatform.TestRunner.csproj -- "$@"
