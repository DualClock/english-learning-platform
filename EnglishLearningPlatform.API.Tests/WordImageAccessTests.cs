using System.Security.Claims;
using EnglishLearningPlatform.API.Controllers;
using EnglishLearningPlatform.API.Data;
using EnglishLearningPlatform.API.Models;
using EnglishLearningPlatform.API.Tests.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EnglishLearningPlatform.API.Tests;

public class WordImageAccessTests
{
    [Fact]
    public async Task WordImage_IsServedOnlyToItsOwner()
    {
        var root = Path.Combine(AppContext.BaseDirectory, $"word-image-{Guid.NewGuid():N}");
        var imageDirectory = Path.Combine(root, "uploads", "word-images");
        Directory.CreateDirectory(imageDirectory);

        const string fileName = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
        await File.WriteAllBytesAsync(Path.Combine(imageDirectory, fileName), new byte[] { 1, 2, 3 });

        try
        {
            await using var context = new ApplicationDbContext(
                new DbContextOptionsBuilder<ApplicationDbContext>()
                    .UseInMemoryDatabase(Guid.NewGuid().ToString())
                    .Options);

            var word = new Word { Text = "apple", Language = "en" };
            word.Definitions.Add(new WordDefinition { Definition = "яблоко" });
            context.UserWords.AddRange(
                new UserWord
                {
                    UserId = "user-a",
                    Word = word,
                    ImageUrl = $"/uploads/word-images/{fileName}"
                },
                new UserWord { UserId = "user-b", Word = word });
            await context.SaveChangesAsync();

            var ownerController = CreateControllerForUser(context, root, "user-a");
            var ownerResult = await ownerController.GetWordImage(fileName);
            Assert.IsType<PhysicalFileResult>(ownerResult);

            var strangerController = CreateControllerForUser(context, root, "user-b");
            var strangerResult = await strangerController.GetWordImage(fileName);
            Assert.IsType<NotFoundResult>(strangerResult);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static FilesController CreateControllerForUser(
        ApplicationDbContext context,
        string contentRoot,
        string userId)
    {
        var controller = new FilesController(
            context,
            new TestWebHostEnvironment { ContentRootPath = contentRoot });
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    new[] { new Claim(ClaimTypes.NameIdentifier, userId) },
                    authenticationType: "test"))
            }
        };
        return controller;
    }
}
