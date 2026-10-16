using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class UserProfileAndGamification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "UserWords",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "CefrLevel",
                table: "Books",
                type: "character varying(2)",
                maxLength: 2,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WordCount",
                table: "Books",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "CefrLevel",
                table: "AspNetUsers",
                type: "character varying(2)",
                maxLength: 2,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CurrentStreak",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "DailyGoalMinutes",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastActivityDate",
                table: "AspNetUsers",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LongestStreak",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "StudyGoal",
                table: "AspNetUsers",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TotalXp",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "DailyActivities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    Date = table.Column<DateTime>(type: "date", nullable: false),
                    MinutesRead = table.Column<int>(type: "integer", nullable: false),
                    WordsReviewed = table.Column<int>(type: "integer", nullable: false),
                    QuizzesDone = table.Column<int>(type: "integer", nullable: false),
                    GoalMet = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyActivities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DailyActivities_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WordLevels",
                columns: table => new
                {
                    Text = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CefrLevel = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    FreqRank = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WordLevels", x => x.Text);
                });

            migrationBuilder.CreateTable(
                name: "XpEvents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    Xp = table.Column<int>(type: "integer", nullable: false),
                    Reason = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_XpEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_XpEvents_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DailyActivities_UserId_Date",
                table: "DailyActivities",
                columns: new[] { "UserId", "Date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WordLevels_CefrLevel",
                table: "WordLevels",
                column: "CefrLevel");

            migrationBuilder.CreateIndex(
                name: "IX_XpEvents_UserId",
                table: "XpEvents",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailyActivities");

            migrationBuilder.DropTable(
                name: "WordLevels");

            migrationBuilder.DropTable(
                name: "XpEvents");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "UserWords");

            migrationBuilder.DropColumn(
                name: "CefrLevel",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "WordCount",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "CefrLevel",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "CurrentStreak",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "DailyGoalMinutes",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "LastActivityDate",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "LongestStreak",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "StudyGoal",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "TotalXp",
                table: "AspNetUsers");
        }
    }
}
