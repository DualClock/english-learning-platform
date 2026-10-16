using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class BookAnalysis : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BookKeyWords",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BookId = table.Column<int>(type: "integer", nullable: false),
                    WordText = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CefrLevel = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    FreqRank = table.Column<int>(type: "integer", nullable: false),
                    Page = table.Column<int>(type: "integer", nullable: false),
                    Frequency = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookKeyWords", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookKeyWords_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BookKeyWords_BookId_Page",
                table: "BookKeyWords",
                columns: new[] { "BookId", "Page" });

            migrationBuilder.CreateIndex(
                name: "IX_BookKeyWords_BookId_WordText",
                table: "BookKeyWords",
                columns: new[] { "BookId", "WordText" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookKeyWords");
        }
    }
}
