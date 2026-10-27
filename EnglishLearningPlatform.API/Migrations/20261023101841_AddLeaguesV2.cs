using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class AddLeaguesV2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "League",
                table: "AspNetUsers",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "bronze");

            migrationBuilder.CreateTable(
                name: "LeagueHistories",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    WeekStart = table.Column<DateTime>(type: "date", nullable: false),
                    League = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Rank = table.Column<int>(type: "integer", nullable: false),
                    Participants = table.Column<int>(type: "integer", nullable: false),
                    WeeklyXp = table.Column<int>(type: "integer", nullable: false),
                    Outcome = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    NextLeague = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeagueHistories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LeagueHistories_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LeagueWeekStates",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LastProcessedWeekStart = table.Column<DateTime>(type: "date", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeagueWeekStates", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LeagueHistories_UserId_WeekStart",
                table: "LeagueHistories",
                columns: new[] { "UserId", "WeekStart" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LeagueHistories");

            migrationBuilder.DropTable(
                name: "LeagueWeekStates");

            migrationBuilder.DropColumn(
                name: "League",
                table: "AspNetUsers");
        }
    }
}
