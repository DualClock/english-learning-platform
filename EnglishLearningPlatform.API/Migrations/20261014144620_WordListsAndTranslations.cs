using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class WordListsAndTranslations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TranslationRu",
                table: "WordLevels",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "WordLists",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CefrFrom = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: true),
                    CefrTo = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: true),
                    ItemCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WordLists", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "WordListItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ListId = table.Column<int>(type: "integer", nullable: false),
                    WordText = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CefrLevel = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: true),
                    FreqRank = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WordListItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WordListItems_WordLists_ListId",
                        column: x => x.ListId,
                        principalTable: "WordLists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WordListItems_ListId_FreqRank",
                table: "WordListItems",
                columns: new[] { "ListId", "FreqRank" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WordListItems");

            migrationBuilder.DropTable(
                name: "WordLists");

            migrationBuilder.DropColumn(
                name: "TranslationRu",
                table: "WordLevels");
        }
    }
}
