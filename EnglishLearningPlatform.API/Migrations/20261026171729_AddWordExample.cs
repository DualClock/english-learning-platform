using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class AddWordExample : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Example",
                table: "WordLevels",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExampleRu",
                table: "WordLevels",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Example",
                table: "WordLevels");

            migrationBuilder.DropColumn(
                name: "ExampleRu",
                table: "WordLevels");
        }
    }
}
