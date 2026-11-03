namespace Sanadi.Infrastructure.Career;

public sealed class BiText
{
    public string en { get; set; } = "";
    public string ar { get; set; } = "";
}

public sealed class ParsedCv
{
    public string? fullName { get; set; }
    public string? email { get; set; }
    public string? phone { get; set; }
    public List<string> links { get; set; } = [];
    public string? summary { get; set; }
    public List<CvEducation> education { get; set; } = [];
    public List<CvExperience> experience { get; set; } = [];
    public List<CvProject> projects { get; set; } = [];
    public List<string> skills { get; set; } = [];
    public List<string> tools { get; set; } = [];
    public List<string> certifications { get; set; } = [];
    public List<string> languages { get; set; } = [];
    public List<string> achievements { get; set; } = [];
    public List<string> sections { get; set; } = [];
}

public sealed class CvEducation
{
    public string? institution { get; set; }
    public string? qualification { get; set; }
    public string? period { get; set; }
}

public sealed class CvExperience
{
    public string? title { get; set; }
    public string? organisation { get; set; }
    public string? period { get; set; }
    public List<string> bullets { get; set; } = [];
}

public sealed class CvProject
{
    public string? title { get; set; }
    public string? description { get; set; }
    public List<string> technologies { get; set; } = [];
}

public sealed class StudentAtsEvidence
{
    public bool hasProfile { get; set; }
    public string? programmeEn { get; set; }
    public bool hasInternship { get; set; }
    public List<(string code, string title)> completedCourses { get; set; } = [];
}

public sealed class CareerRoleAtsInput
{
    public Guid id { get; set; }
    public string role_code { get; set; } = "";
    public string title_en { get; set; } = "";
    public string title_ar { get; set; } = "";
    public string[] required_hard_skills { get; set; } = [];
    public string[] preferred_hard_skills { get; set; } = [];
    public string[] preferred_tools { get; set; } = [];
    public string[] preferred_courses { get; set; } = [];
    public string[] certifications { get; set; } = [];
    public string[] suitable_programmes { get; set; } = [];
    public string[] ats_keywords { get; set; } = [];
    public string? experience_expectations { get; set; }
    public string? portfolio_expectations { get; set; }
}

public sealed class AtsCategoryDto
{
    public string key { get; set; } = "";
    public string labelEn { get; set; } = "";
    public string labelAr { get; set; } = "";
    public int score { get; set; }
    public int max { get; set; }
    public List<BiText> notes { get; set; } = [];
}

public sealed class AtsBandDto
{
    public int min { get; set; }
    public string labelEn { get; set; } = "";
    public string labelAr { get; set; } = "";
}

public sealed class SkillEvidenceDto
{
    public string skill { get; set; } = "";
    public string strength { get; set; } = "none";
    public string? excerpt { get; set; }
}

public sealed class AtsScoreDto
{
    public string engineVersion { get; set; } = AtsScoringEngine.EngineVersion;
    public string weightsVersion { get; set; } = AtsScoringEngine.WeightsVersion;
    public string? cvVersion { get; set; }
    public string calculatedAt { get; set; } = "";
    public string confidence { get; set; } = "medium";
    public BiText? confidenceNote { get; set; }
    public int overall { get; set; }
    public AtsBandDto band { get; set; } = new();
    public List<AtsCategoryDto> categories { get; set; } = [];
    public List<BiText> strengths { get; set; } = [];
    public List<BiText> improvements { get; set; } = [];
    public List<string> recommendedKeywords { get; set; } = [];
    public List<SkillEvidenceDto> evidence { get; set; } = [];
    public List<BiText> dateIssues { get; set; } = [];
    public BiText disclaimer { get; set; } = AtsScoringEngine.Disclaimer;
}

public sealed class RoleAtsScoreDto
{
    public string roleId { get; set; } = "";
    public string roleCode { get; set; } = "";
    public string titleEn { get; set; } = "";
    public string titleAr { get; set; } = "";
    public int overall { get; set; }
    public AtsBandDto band { get; set; } = new();
    public List<AtsCategoryDto> categories { get; set; } = [];
    public List<SkillEvidenceDto> strongMatches { get; set; } = [];
    public List<string> missingEvidence { get; set; } = [];
    public string engineVersion { get; set; } = AtsScoringEngine.EngineVersion;
    public string weightsVersion { get; set; } = AtsScoringEngine.WeightsVersion;
    public string? cvVersion { get; set; }
    public string calculatedAt { get; set; } = "";
}
