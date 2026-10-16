using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class GrammarSection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GrammarUnits",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CefrLevel = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    TheoryHtml = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    ShortDescription = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GrammarUnits", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GrammarExercises",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UnitId = table.Column<int>(type: "integer", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Type = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Prompt = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    OptionsJson = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CorrectAnswer = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Explanation = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GrammarExercises", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GrammarExercises_GrammarUnits_UnitId",
                        column: x => x.UnitId,
                        principalTable: "GrammarUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserGrammarProgresses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    UnitId = table.Column<int>(type: "integer", nullable: false),
                    Score = table.Column<int>(type: "integer", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserGrammarProgresses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserGrammarProgresses_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserGrammarProgresses_GrammarUnits_UnitId",
                        column: x => x.UnitId,
                        principalTable: "GrammarUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GrammarExercises_UnitId",
                table: "GrammarExercises",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_GrammarUnits_Order",
                table: "GrammarUnits",
                column: "Order");

            migrationBuilder.CreateIndex(
                name: "IX_UserGrammarProgresses_UnitId",
                table: "UserGrammarProgresses",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_UserGrammarProgresses_UserId_UnitId",
                table: "UserGrammarProgresses",
                columns: new[] { "UserId", "UnitId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GrammarExercises");

            migrationBuilder.DropTable(
                name: "UserGrammarProgresses");

            migrationBuilder.DropTable(
                name: "GrammarUnits");
        }
    }
}
