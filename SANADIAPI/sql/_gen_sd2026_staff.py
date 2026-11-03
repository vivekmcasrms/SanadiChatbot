import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent
roster = json.loads((root / "_sd2026_roster.json").read_text(encoding="utf-8"))
units = []
for line in (root / "_units_list.txt").read_text(encoding="utf-8").splitlines():
    if "|" not in line or line.startswith("code") or line.startswith("----"):
        continue
    code, name = line.split("|", 1)
    units.append((code.strip(), name.strip()))

PASSWORD_HASH = r"$2b$12$veJWWmxyOVK9psIUlMYIRutr7vhDuJWKIKwBbpmw6DNxYd1/nEFGC"


def norm(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"^s&c\s*[-–]?\s*", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


ALIASES = {
    "libraries deanship": "library services",
    "uaeu labraries": "library services",
    "student happiness center": "student happiness and engagement",
    "admission department": "admission registration",
    "housing department": "student housing",
    "service desk": "it support",
    "centre for career placement alumni": "center for career placement alumni",
}

unit_by_norm = {norm(n): (c, n) for c, n in units}


def map_group(g: str):
    ng = norm(g)
    hit = unit_by_norm.get(ng)
    if hit:
        return hit
    alias = ALIASES.get(ng)
    if alias:
        return unit_by_norm.get(norm(alias))
    return None


def sql_str(s: str) -> str:
    return "N'" + s.replace("'", "''") + "'"


def make_code(name: str) -> str:
    base = re.sub(r"^S&C\s*[-–]?\s*", "", name, flags=re.I)
    code = re.sub(r"[^A-Za-z0-9]+", "_", base).strip("_").upper()
    return code[:40] or "UNIT"


existing_codes = {c for c, _ in units}
group_to_unit = {}
missing_groups = []
for g in sorted({x for p in roster for x in p["units"]}):
    m = map_group(g)
    if m:
        group_to_unit[g] = m
    else:
        missing_groups.append(g)

for g in missing_groups:
    code = make_code(g)
    base = code
    i = 2
    while code in existing_codes:
        code = f"{base[:36]}_{i}"
        i += 1
    existing_codes.add(code)
    group_to_unit[g] = (code, g)

ar_title = sql_str("موظف خدمة")
parts: list[str] = [
    "-- SD 2026 service staff roster import",
    "-- Keeps system_admin and student auth.users / roles untouched.",
    "SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;",
    "BEGIN TRAN;",
    "",
    f"DECLARE @pwd nvarchar(4000) = {sql_str(PASSWORD_HASH)};",
    "",
]

for g in missing_groups:
    code = group_to_unit[g][0]
    parts += [
        f"IF NOT EXISTS (SELECT 1 FROM dbo.service_units WHERE code = {sql_str(code)})",
        "  INSERT INTO dbo.service_units (id, code, name_en, name_ar, is_active)",
        f"  VALUES (NEWID(), {sql_str(code)}, {sql_str(g)}, {sql_str(g)}, 1);",
        "",
    ]

parts += [
    "IF OBJECT_ID('tempdb..#roster') IS NOT NULL DROP TABLE #roster;",
    "IF OBJECT_ID('tempdb..#membership') IS NOT NULL DROP TABLE #membership;",
    "CREATE TABLE #roster (email nvarchar(320) NOT NULL PRIMARY KEY, full_name nvarchar(450) NOT NULL, home_unit_code nvarchar(256) NOT NULL);",
    "CREATE TABLE #membership (email nvarchar(320) NOT NULL, unit_code nvarchar(256) NOT NULL, PRIMARY KEY (email, unit_code));",
    "",
]

for p in roster:
    email = p["email"].lower().strip()
    name = (p["fullName"] or "").strip() or email
    home = group_to_unit[p["units"][0]][0]
    parts.append(
        f"INSERT INTO #roster (email, full_name, home_unit_code) VALUES ({sql_str(email)}, {sql_str(name)}, {sql_str(home)});"
    )
    seen_codes: set[str] = set()
    for g in p["units"]:
        code = group_to_unit[g][0]
        if code in seen_codes:
            continue
        seen_codes.add(code)
        parts.append(
            f"INSERT INTO #membership (email, unit_code) VALUES ({sql_str(email)}, {sql_str(code)});"
        )

parts += [
    "",
    ";MERGE auth.users AS t",
    "USING #roster AS s ON LOWER(t.email) = s.email",
    "WHEN MATCHED THEN UPDATE SET",
    "  encrypted_password = @pwd,",
    "  updated_at = SYSDATETIMEOFFSET()",
    "WHEN NOT MATCHED THEN INSERT (id, email, encrypted_password)",
    "  VALUES (NEWID(), s.email, @pwd);",
    "",
    ";MERGE dbo.profiles AS t",
    "USING (",
    "  SELECT u.id, r.email, r.full_name",
    "  FROM #roster r JOIN auth.users u ON LOWER(u.email) = r.email",
    ") AS s ON t.id = s.id",
    "WHEN MATCHED THEN UPDATE SET",
    "  full_name = s.full_name, email = s.email, deleted_at = NULL,",
    "  access_revoked_at = NULL, access_revoked_by = NULL, access_revoked_reason = NULL,",
    "  updated_at = SYSDATETIMEOFFSET()",
    "WHEN NOT MATCHED THEN INSERT (id, full_name, email, preferred_language, is_demo_account)",
    "  VALUES (s.id, s.full_name, s.email, N'en', 0);",
    "",
    "INSERT INTO dbo.user_roles (id, user_id, role)",
    "SELECT NEWID(), u.id, N'service_officer'",
    "FROM #roster r",
    "JOIN auth.users u ON LOWER(u.email) = r.email",
    "WHERE NOT EXISTS (",
    "  SELECT 1 FROM dbo.user_roles ur WHERE ur.user_id = u.id AND ur.role = N'service_officer'",
    ");",
    "",
    ";MERGE dbo.staff_profiles AS t",
    "USING (",
    "  SELECT u.id AS user_id, su.id AS service_unit_id",
    "  FROM #roster r",
    "  JOIN auth.users u ON LOWER(u.email) = r.email",
    "  JOIN dbo.service_units su ON su.code = r.home_unit_code",
    ") AS s ON t.user_id = s.user_id",
    "WHEN MATCHED THEN UPDATE SET",
    "  service_unit_id = s.service_unit_id,",
    "  job_title_en = N'Service Officer',",
    f"  job_title_ar = {ar_title},",
    "  is_active = 1, availability_status = N'available', updated_at = SYSDATETIMEOFFSET()",
    "WHEN NOT MATCHED THEN INSERT (user_id, service_unit_id, job_title_en, job_title_ar, is_active, availability_status)",
    f"  VALUES (s.user_id, s.service_unit_id, N'Service Officer', {ar_title}, 1, N'available');",
    "",
    "DELETE FROM dbo.service_staff;",
    "INSERT INTO dbo.service_staff (",
    "  id, staff_profile_id, service_unit_id, role_type, can_receive_cases, can_approve_actions,",
    "  can_view_sensitive_cases, is_active, is_service_owner, can_assign_cases,",
    "  can_approve_normal_resolution, can_escalate, is_demo_record",
    ")",
    "SELECT NEWID(), u.id, su.id, N'officer', 1, 0, 0, 1, 0, 0, 1, 1, 0",
    "FROM #membership m",
    "JOIN auth.users u ON LOWER(u.email) = m.email",
    "JOIN dbo.service_units su ON su.code = m.unit_code;",
    "",
    ";WITH first_staff AS (",
    "  SELECT ss.service_unit_id, ss.staff_profile_id,",
    "         ROW_NUMBER() OVER (PARTITION BY ss.service_unit_id ORDER BY p.full_name, ss.staff_profile_id) rn",
    "  FROM dbo.service_staff ss",
    "  JOIN dbo.profiles p ON p.id = ss.staff_profile_id",
    "  WHERE ss.is_active = 1",
    ")",
    "UPDATE su SET primary_service_owner_id = fs.staff_profile_id, updated_at = SYSDATETIMEOFFSET()",
    "FROM dbo.service_units su",
    "JOIN first_staff fs ON fs.service_unit_id = su.id AND fs.rn = 1;",
    "",
    "DELETE FROM dbo.service_unit_owners;",
    "INSERT INTO dbo.service_unit_owners (id, service_unit_id, staff_profile_id, ownership_type, is_active, is_demo_record)",
    "SELECT NEWID(), id, primary_service_owner_id, N'primary', 1, 0",
    "FROM dbo.service_units",
    "WHERE primary_service_owner_id IS NOT NULL;",
    "",
    "UPDATE ss SET is_service_owner = 1, can_assign_cases = 1, can_approve_actions = 1",
    "FROM dbo.service_staff ss",
    "JOIN dbo.service_units su ON su.id = ss.service_unit_id AND su.primary_service_owner_id = ss.staff_profile_id;",
    "",
    "UPDATE sp SET is_active = 0, updated_at = SYSDATETIMEOFFSET()",
    "FROM dbo.staff_profiles sp",
    "WHERE NOT EXISTS (",
    "  SELECT 1 FROM #roster r JOIN auth.users u ON LOWER(u.email)=r.email WHERE u.id = sp.user_id",
    ");",
    "",
    "DELETE ur",
    "FROM dbo.user_roles ur",
    "WHERE ur.role IN (N'service_officer', N'service_owner', N'service_manager', N'knowledge_manager')",
    "  AND NOT EXISTS (",
    "    SELECT 1 FROM #roster r JOIN auth.users u ON LOWER(u.email)=r.email WHERE u.id = ur.user_id",
    "  )",
    "  AND NOT EXISTS (SELECT 1 FROM dbo.user_roles a WHERE a.user_id = ur.user_id AND a.role = N'system_admin');",
    "",
    "IF NOT EXISTS (SELECT 1 FROM dbo.user_roles WHERE role = N'system_admin') THROW 50010, N'system_admin missing', 1;",
    "IF (SELECT COUNT(*) FROM dbo.user_roles WHERE role = N'student') < 10 THROW 50011, N'student roles missing', 1;",
    "IF (SELECT COUNT(DISTINCT staff_profile_id) FROM dbo.service_staff) < 100 THROW 50012, N'staff import too small', 1;",
    "",
    "COMMIT;",
    "SELECT 'ok' AS status,",
    "  (SELECT COUNT(*) FROM dbo.service_units) AS units,",
    "  (SELECT COUNT(*) FROM dbo.service_staff) AS memberships,",
    "  (SELECT COUNT(*) FROM dbo.staff_profiles WHERE is_active=1) AS active_staff,",
    "  (SELECT COUNT(*) FROM dbo.user_roles WHERE role=N'student') AS students,",
    "  (SELECT COUNT(*) FROM dbo.user_roles WHERE role=N'system_admin') AS admins,",
    "  (SELECT COUNT(*) FROM dbo.user_roles WHERE role=N'service_officer') AS officers;",
]

out = root / "seed_sd2026_staff.sql"
out.write_text("\n".join(parts) + "\n", encoding="utf-8")
print("wrote", out)
print("missing_units", missing_groups)
print("people", len(roster), "membership_rows", sum(len(p["units"]) for p in roster))
