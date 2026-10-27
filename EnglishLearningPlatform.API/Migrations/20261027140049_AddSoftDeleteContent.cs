using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class AddSoftDeleteContent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CategoryWords_Categories_CategoryId",
                table: "CategoryWords");

            migrationBuilder.DropForeignKey(
                name: "FK_UserCategoryWordProgresses_CategoryWords_CategoryWordId",
                table: "UserCategoryWordProgresses");

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "Words",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeletedByUserId",
                table: "Words",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "CategoryWords",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeletedByUserId",
                table: "CategoryWords",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "Categories",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeletedByUserId",
                table: "Categories",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "Books",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeletedByUserId",
                table: "Books",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Words_DeletedAt",
                table: "Words",
                column: "DeletedAt");

            migrationBuilder.CreateIndex(
                name: "IX_CategoryWords_DeletedAt",
                table: "CategoryWords",
                column: "DeletedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Categories_DeletedAt",
                table: "Categories",
                column: "DeletedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Books_DeletedAt",
                table: "Books",
                column: "DeletedAt");

            migrationBuilder.AddForeignKey(
                name: "FK_CategoryWords_Categories_CategoryId",
                table: "CategoryWords",
                column: "CategoryId",
                principalTable: "Categories",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_UserCategoryWordProgresses_CategoryWords_CategoryWordId",
                table: "UserCategoryWordProgresses",
                column: "CategoryWordId",
                principalTable: "CategoryWords",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CategoryWords_Categories_CategoryId",
                table: "CategoryWords");

            migrationBuilder.DropForeignKey(
                name: "FK_UserCategoryWordProgresses_CategoryWords_CategoryWordId",
                table: "UserCategoryWordProgresses");

            migrationBuilder.DropIndex(
                name: "IX_Words_DeletedAt",
                table: "Words");

            migrationBuilder.DropIndex(
                name: "IX_CategoryWords_DeletedAt",
                table: "CategoryWords");

            migrationBuilder.DropIndex(
                name: "IX_Categories_DeletedAt",
                table: "Categories");

            migrationBuilder.DropIndex(
                name: "IX_Books_DeletedAt",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Words");

            migrationBuilder.DropColumn(
                name: "DeletedByUserId",
                table: "Words");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "CategoryWords");

            migrationBuilder.DropColumn(
                name: "DeletedByUserId",
                table: "CategoryWords");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Categories");

            migrationBuilder.DropColumn(
                name: "DeletedByUserId",
                table: "Categories");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Books");

            migrationBuilder.DropColumn(
                name: "DeletedByUserId",
                table: "Books");

            migrationBuilder.AddForeignKey(
                name: "FK_CategoryWords_Categories_CategoryId",
                table: "CategoryWords",
                column: "CategoryId",
                principalTable: "Categories",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_UserCategoryWordProgresses_CategoryWords_CategoryWordId",
                table: "UserCategoryWordProgresses",
                column: "CategoryWordId",
                principalTable: "CategoryWords",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
