using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class AddReaderV3 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ContentHash",
                table: "Books",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ContentSnapshotId",
                table: "Books",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ParsedAt",
                table: "Books",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "Page",
                table: "BookBookmarks",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddColumn<string>(
                name: "ChapterId",
                table: "BookBookmarks",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CharOffset",
                table: "BookBookmarks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Excerpt",
                table: "BookBookmarks",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SentenceId",
                table: "BookBookmarks",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BookContentSnapshots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ContentHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ParserVersion = table.Column<int>(type: "integer", nullable: false),
                    JsonGzip = table.Column<byte[]>(type: "bytea", nullable: false),
                    ChapterCount = table.Column<int>(type: "integer", nullable: false),
                    WordCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookContentSnapshots", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReaderPocketWords",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    BookId = table.Column<int>(type: "integer", nullable: false),
                    ChapterId = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    SentenceId = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Word = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NormalizedWord = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SentenceText = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    TranslationRu = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    PartOfSpeech = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PromotedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    KnownAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReaderPocketWords", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReaderPocketWords_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ReaderPocketWords_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserBookProgresses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    BookId = table.Column<int>(type: "integer", nullable: false),
                    ChapterId = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    SentenceId = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    CharOffset = table.Column<int>(type: "integer", nullable: false),
                    MaxPercent = table.Column<double>(type: "double precision", nullable: false),
                    PositionUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserBookProgresses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserBookProgresses_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserBookProgresses_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Books_ContentSnapshotId",
                table: "Books",
                column: "ContentSnapshotId");

            migrationBuilder.CreateIndex(
                name: "IX_BookBookmarks_BookId_UserId_ChapterId_SentenceId",
                table: "BookBookmarks",
                columns: new[] { "BookId", "UserId", "ChapterId", "SentenceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookContentSnapshots_ContentHash_ParserVersion",
                table: "BookContentSnapshots",
                columns: new[] { "ContentHash", "ParserVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReaderPocketWords_BookId",
                table: "ReaderPocketWords",
                column: "BookId");

            migrationBuilder.CreateIndex(
                name: "IX_ReaderPocketWords_UserId_BookId_NormalizedWord",
                table: "ReaderPocketWords",
                columns: new[] { "UserId", "BookId", "NormalizedWord" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReaderPocketWords_UserId_ChapterId",
                table: "ReaderPocketWords",
                columns: new[] { "UserId", "ChapterId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReaderPocketWords_UserId_LastSeenAt",
                table: "ReaderPocketWords",
                columns: new[] { "UserId", "LastSeenAt" });

            migrationBuilder.CreateIndex(
                name: "IX_UserBookProgresses_BookId",
                table: "UserBookProgresses",
                column: "BookId");

            migrationBuilder.CreateIndex(
                name: "IX_UserBookProgresses_UserId_BookId",
                table: "UserBookProgresses",
                columns: new[] { "UserId", "BookId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Books_BookContentSnapshots_ContentSnapshotId",
                table: "Books",
                column: "ContentSnapshotId",
                principalTable: "BookContentSnapshots",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Books_BookContentSnapshots_ContentSnapshotId",
                table: "Books");

            migrationBuilder.DropTable(
                name: "BookContentSnapshots");

            migrationBuilder.DropTable(
                name: "ReaderPocketWords");

            migrationBuilder.DropTable(
                name: "UserBookProgresses");

            migrationBuilder.DropIndex(
                name: "IX_Books_ContentSnapshotId",
                table: "Books");

            migrationBuilder.DropIndex(
                name: "IX_BookBookmarks_BookId_UserId_ChapterId_SentenceId",
                table: "BookBookmarks");

            migrationBuilder.DropColumn(
                name: "ContentHash",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "ContentSnapshotId",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "ParsedAt",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "ChapterId",
                table: "BookBookmarks");

            migrationBuilder.DropColumn(
                name: "CharOffset",
                table: "BookBookmarks");

            migrationBuilder.DropColumn(
                name: "Excerpt",
                table: "BookBookmarks");

            migrationBuilder.DropColumn(
                name: "SentenceId",
                table: "BookBookmarks");

            migrationBuilder.AlterColumn<int>(
                name: "Page",
                table: "BookBookmarks",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);
        }
    }
}
