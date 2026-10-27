using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class AddXpEventCreatedAtIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_XpEvents_CreatedAt",
                table: "XpEvents",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_XpEvents_CreatedAt",
                table: "XpEvents");
        }
    }
}
