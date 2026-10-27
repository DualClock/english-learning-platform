using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class AddUserReminders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "NotifyEnabled",
                table: "AspNetUsers",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "ReminderHour",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 9);

            migrationBuilder.AddColumn<string>(
                name: "TimeZoneId",
                table: "AspNetUsers",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NotifyEnabled",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "ReminderHour",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "TimeZoneId",
                table: "AspNetUsers");
        }
    }
}
