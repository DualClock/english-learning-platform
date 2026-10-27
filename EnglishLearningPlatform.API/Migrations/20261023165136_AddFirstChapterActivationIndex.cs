using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class AddFirstChapterActivationIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_AnalyticsEvents_FirstChapterPerUser",
                table: "AnalyticsEvents",
                columns: new[] { "UserId", "Event" },
                unique: true,
                filter: "\"Event\" = 'chapter_opened_first'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_AnalyticsEvents_FirstChapterPerUser",
                table: "AnalyticsEvents");
        }
    }
}
