using System.Text.Json;
using System.Text.RegularExpressions;

namespace Sanadi.Infrastructure.Career;

/// <summary>
/// Deterministic CV structure extraction (mirrors core heuristicParse + section
/// recovery for education / experience / projects). No LLM — profile + text only.
/// </summary>
public static class CvHeuristicParser
{
    private static readonly Regex HeadingLine = new(
        @"^[A-Z\u0600-\u06FF][A-Za-z\u0600-\u06FF /&'\-]{2,38}:?$",
        RegexOptions.Compiled);

    private static readonly Regex PeriodRe = new(
        @"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{1,2}[/-]\d{4}|\d{4})\s*[–—\-to]+\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{1,2}[/-]\d{4}|\d{4}|Present|Current|Ongoing|Now)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static ParsedCv Parse(string text)
    {
        var lines = text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(l => l.Length > 0).ToArray();
        var email = Regex.Match(text, @"[\w.+-]+@[\w-]+\.[\w.]+").Value;
        var phone = Regex.Match(text, @"\+?\d[\d\s()\-]{7,}\d").Value;
        var links = Regex.Matches(text, @"https?://\S+|www\.\S+")
            .Select(m => m.Value).Distinct(StringComparer.OrdinalIgnoreCase).Take(6).ToList();
        var sections = lines
            .Where(l => l.Length < 40 && HeadingLine.IsMatch(l.TrimEnd(':')))
            .Take(20).ToList();

        var skills = SplitItems(SectionLines(lines, @"^(technical\s+)?skills?\b")).Take(40).ToList();
        var tools = SplitItems(SectionLines(lines, @"^(tools|technologies|software)\b")).Take(30).ToList();
        var certifications = SplitItems(SectionLines(lines, @"^(certifications?|licenses?)\b")).Take(15).ToList();
        var languages = SplitItems(SectionLines(lines, @"^languages?\b")).Take(8).ToList();
        var achievements = SectionLines(lines, @"^(achievements?|awards?|honou?rs)\b")
            .Select(l => Regex.Replace(l, @"^[-–—*\s]+", ""))
            .Where(l => l.Length > 3).Take(12).ToList();

        var education = ParseEducation(SectionLines(lines, @"^education\b"));
        var experience = ParseExperience(SectionLines(lines, @"^(experience|employment|work\s+history|internship)\b"));
        var projects = ParseProjects(SectionLines(lines, @"^(projects?|portfolio|capstone)\b"));

        // Pull skills mentioned under projects/tools into skills if skills section was thin.
        if (skills.Count < 5)
        {
            foreach (var p in projects)
                foreach (var t in p.technologies)
                    if (!skills.Contains(t, StringComparer.OrdinalIgnoreCase))
                        skills.Add(t);
        }

        string? summary = null;
        var summaryLines = SectionLines(lines, @"^(summary|profile|objective|about)\b");
        if (summaryLines.Count > 0)
            summary = string.Join(" ", summaryLines).Trim();
        else if (lines.Length > 2)
        {
            var early = lines.Skip(1).Take(4).Where(l => l.Length > 40 && !HeadingLine.IsMatch(l.TrimEnd(':')));
            var joined = string.Join(" ", early);
            if (joined.Length > 40) summary = joined[..Math.Min(joined.Length, 400)];
        }

        return new ParsedCv
        {
            fullName = lines.FirstOrDefault(),
            email = string.IsNullOrWhiteSpace(email) ? null : email,
            phone = string.IsNullOrWhiteSpace(phone) ? null : phone,
            links = links,
            summary = summary,
            education = education,
            experience = experience,
            projects = projects,
            skills = skills,
            tools = tools,
            certifications = certifications,
            languages = languages,
            achievements = achievements,
            sections = sections,
        };
    }

    public static ParsedCv MergeStored(string? profileJson, string rawText)
    {
        var heuristic = Parse(rawText);
        if (string.IsNullOrWhiteSpace(profileJson)) return heuristic;
        try
        {
            var stored = JsonSerializer.Deserialize<ParsedCv>(profileJson, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
            if (stored is null) return heuristic;
            return Merge(heuristic, stored);
        }
        catch
        {
            return heuristic;
        }
    }

    private static ParsedCv Merge(ParsedCv a, ParsedCv b) => new()
    {
        fullName = b.fullName ?? a.fullName,
        email = b.email ?? a.email,
        phone = b.phone ?? a.phone,
        links = b.links.Count > 0 ? b.links : a.links,
        summary = b.summary ?? a.summary,
        education = b.education.Count > 0 ? b.education : a.education,
        experience = b.experience.Count > 0 ? b.experience : a.experience,
        projects = b.projects.Count > 0 ? b.projects : a.projects,
        skills = b.skills.Count > 0 ? b.skills : a.skills,
        tools = b.tools.Count > 0 ? b.tools : a.tools,
        certifications = b.certifications.Count > 0 ? b.certifications : a.certifications,
        languages = b.languages.Count > 0 ? b.languages : a.languages,
        achievements = b.achievements.Count > 0 ? b.achievements : a.achievements,
        sections = b.sections.Count > 0 ? b.sections : a.sections,
    };

    private static List<string> SectionLines(string[] lines, string headingPattern)
    {
        var match = new Regex(headingPattern, RegexOptions.IgnoreCase);
        var outLines = new List<string>();
        var inside = false;
        foreach (var line in lines)
        {
            var bare = line.TrimEnd(':').Trim();
            if (match.IsMatch(bare))
            {
                inside = true;
                var inline = match.Replace(line, "").Trim().TrimStart(':').Trim();
                if (inline.Length > 0) outLines.Add(inline);
                continue;
            }
            if (!inside) continue;
            if (HeadingLine.IsMatch(bare) && bare.Length < 40) break;
            outLines.Add(line);
        }
        return outLines;
    }

    private static List<string> SplitItems(IEnumerable<string> lines) =>
        lines.SelectMany(l => Regex.Split(l, @"[\n,،|;•·]|(?:\s+/\s+)"))
            .Select(s => Regex.Replace(s, @"^[-–—*\s]+", "").Trim())
            .Where(s => s.Length is > 1 and < 48)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static List<CvEducation> ParseEducation(List<string> lines)
    {
        var items = new List<CvEducation>();
        CvEducation? current = null;
        foreach (var line in lines)
        {
            var period = PeriodRe.Match(line);
            if (period.Success || current is null)
            {
                current = new CvEducation
                {
                    period = period.Success ? period.Value : null,
                    institution = period.Success ? line.Replace(period.Value, "").Trim(' ', '-', '–', ',', '|') : line,
                    qualification = null,
                };
                items.Add(current);
            }
            else if (string.IsNullOrWhiteSpace(current.qualification))
            {
                current.qualification = line;
            }
        }
        return items.Take(6).ToList();
    }

    private static List<CvExperience> ParseExperience(List<string> lines)
    {
        var items = new List<CvExperience>();
        CvExperience? current = null;
        foreach (var line in lines)
        {
            var isBullet = Regex.IsMatch(line, @"^[-–—*•]\s+") || (current is not null && line.Length > 40 && !PeriodRe.IsMatch(line));
            var period = PeriodRe.Match(line);
            if (period.Success || (current is null && !isBullet))
            {
                var rest = period.Success ? line.Replace(period.Value, "").Trim(' ', '-', '–', ',', '|') : line;
                var parts = rest.Split(['|', '·', '@', ','], 2, StringSplitOptions.TrimEntries);
                current = new CvExperience
                {
                    period = period.Success ? period.Value : null,
                    title = parts.ElementAtOrDefault(0),
                    organisation = parts.ElementAtOrDefault(1),
                    bullets = [],
                };
                items.Add(current);
            }
            else if (current is not null)
            {
                var bullet = Regex.Replace(line, @"^[-–—*•\s]+", "").Trim();
                if (bullet.Length > 3) current.bullets.Add(bullet);
            }
        }
        return items.Take(10).ToList();
    }

    private static List<CvProject> ParseProjects(List<string> lines)
    {
        var items = new List<CvProject>();
        CvProject? current = null;
        foreach (var line in lines)
        {
            var isBullet = Regex.IsMatch(line, @"^[-–—*•]\s+");
            if (!isBullet && (current is null || line.Length < 80))
            {
                var tech = SplitItems([line]).Where(t => t.Length < 24).ToList();
                current = new CvProject
                {
                    title = tech.Count > 3 ? line.Split([':', '|', '–', '-'], 2)[0].Trim() : line,
                    description = line,
                    technologies = tech.Count <= 8 ? tech : [],
                };
                items.Add(current);
            }
            else if (current is not null)
            {
                var bullet = Regex.Replace(line, @"^[-–—*•\s]+", "").Trim();
                current.description = string.IsNullOrWhiteSpace(current.description)
                    ? bullet
                    : current.description + " " + bullet;
                foreach (var t in SplitItems([bullet]).Where(x => x.Length < 24))
                    if (!current.technologies.Contains(t, StringComparer.OrdinalIgnoreCase))
                        current.technologies.Add(t);
            }
        }
        return items.Take(10).ToList();
    }
}
