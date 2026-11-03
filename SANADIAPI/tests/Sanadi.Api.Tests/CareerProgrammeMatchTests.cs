using Sanadi.Api.Controllers;
using Xunit;

namespace Sanadi.Api.Tests;

public class CareerProgrammeMatchTests
{
    private const string DataScience = "BSc Data Science and Artificial Intelligence";

    [Theory]
    [InlineData(DataScience, "BSc Data Science and Artificial Intelligence")]
    [InlineData(DataScience, "Data Science")]
    [InlineData("BSc Mathematical Sciences", "Mathematical Sciences")]
    [InlineData("Bachelor of Business Administration", "Bachelor of Business Administration")]
    public void Matches_when_the_suitable_programme_is_a_phrase_of_the_student_programme(string programme, string suitable)
        => Assert.True(CareerController.ProgrammeMatches(programme, suitable));

    [Theory]
    [InlineData(DataScience, "BSc Mathematical Sciences")]   // shares only "BSc"
    [InlineData(DataScience, "BSc Mechanical Engineering")]
    [InlineData(DataScience, "BSc Computer Science")]         // shares "BSc" and "Science"
    [InlineData(DataScience, "Education")]
    [InlineData("", "Data Science")]
    [InlineData(DataScience, "")]
    public void Does_not_match_on_shared_degree_words_alone(string programme, string suitable)
        => Assert.False(CareerController.ProgrammeMatches(programme, suitable));
}
