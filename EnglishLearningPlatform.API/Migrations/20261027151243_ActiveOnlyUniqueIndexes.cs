using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EnglishLearningPlatform.API.Migrations
{
    /// <inheritdoc />
    public partial class ActiveOnlyUniqueIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CategoryWords_CategoryId_English",
                table: "CategoryWords");

            migrationBuilder.DropIndex(
                name: "IX_Categories_Slug",
                table: "Categories");

            migrationBuilder.CreateIndex(
                name: "IX_CategoryWords_Category_English_Active",
                table: "CategoryWords",
                columns: new[] { "CategoryId", "English" },
                unique: true,
                filter: "\"DeletedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Categories_Slug_Active",
                table: "Categories",
                column: "Slug",
                unique: true,
                filter: "\"DeletedAt\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CategoryWords_Category_English_Active",
                table: "CategoryWords");

            migrationBuilder.DropIndex(
                name: "IX_Categories_Slug_Active",
                table: "Categories");

            migrationBuilder.CreateIndex(
                name: "IX_CategoryWords_CategoryId_English",
                table: "CategoryWords",
                columns: new[] { "CategoryId", "English" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Categories_Slug",
                table: "Categories",
                column: "Slug",
                unique: true);
        }
    }
}
