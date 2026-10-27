using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class AddHotQueryIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_UserWords_UserId_NextReviewDate",
                table: "UserWords",
                columns: new[] { "UserId", "NextReviewDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Books_UploadedByUserId",
                table: "Books",
                column: "UploadedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_AnalyticsEvents_CreatedAt",
                table: "AnalyticsEvents",
                column: "CreatedAt");

            // Выраженческий индекс: поиск слова идёт через Text.ToLower() в SQL,
            // обычный индекс по "Text" Postgres в этом случае не используется
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS \"IX_Words_Text_Lower\" ON \"Words\" (lower(\"Text\"));");

        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_UserWords_UserId_NextReviewDate",
                table: "UserWords");

            migrationBuilder.DropIndex(
                name: "IX_Books_UploadedByUserId",
                table: "Books");

            migrationBuilder.DropIndex(
                name: "IX_AnalyticsEvents_CreatedAt",
                table: "AnalyticsEvents");

            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_Words_Text_Lower\";");
        }
    }
}
