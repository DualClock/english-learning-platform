using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// W2.4 — таблица гостевой воронки /test. Полностью аддитивная: ни одна
    /// существующая таблица не тронута (гостя нельзя класть в AnalyticsEvents,
    /// где UserId — обязательный внешний ключ на AspNetUsers), поэтому миграция
    /// не блокирует прод и не переписывает строки. nullable поле одно — Level:
    /// уровня нет у открытия теста. Down() удаляет таблицу вместе с индексами,
    /// откат ничего не ломает в остальных метриках.
    /// К боевой базе не применять: здесь только файл миграции.
    /// </summary>
    public partial class AddGuestAnalyticsEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GuestAnalyticsEvents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Event = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    IpHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Level = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    Day = table.Column<DateOnly>(type: "date", nullable: false),
                    Hour = table.Column<int>(type: "integer", nullable: false),
                    DedupeKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GuestAnalyticsEvents", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GuestAnalyticsEvents_Event_Day",
                table: "GuestAnalyticsEvents",
                columns: new[] { "Event", "Day" });

            migrationBuilder.CreateIndex(
                name: "IX_GuestAnalyticsEvents_Event_DedupeKey",
                table: "GuestAnalyticsEvents",
                columns: new[] { "Event", "DedupeKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GuestAnalyticsEvents");
        }
    }
}
