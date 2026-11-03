/**
 * Campus services directory — a student-facing page listing every university
 * unit, what it handles, how to reach it, and whether it currently publishes
 * appointment availability. Contact details come straight from the service
 * records; nothing is filled in when the university has not published it.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarClock, Clock, Mail, MapPin, Phone, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCampusDirectory, type DirectoryUnit } from "@/lib/services/directory.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/campus-services")({
  head: () => ({
    meta: [
      { title: "Campus services directory — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Find the right UAEU unit before you book: what each service handles, its email, office, opening hours and current appointment availability.",
      },
      { property: "og:title", content: "Campus services directory — Sanadi | UAEU" },
      {
        property: "og:description",
        content: "Every UAEU student service with contact details and live appointment availability.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CampusServicesPage,
});

function CampusServicesPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [term, setTerm] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["campus-directory"],
    queryFn: () => getCampusDirectory(),
    staleTime: 5 * 60 * 1000,
  });

  const units = useMemo(() => {
    const all = data?.units ?? [];
    const q = term.trim().toLowerCase();
    if (!q) return all;
    return all.filter((u) =>
      [u.nameEn, u.nameAr, u.code, u.email, u.descriptionEn, u.descriptionAr, ...u.services.flatMap((s) => [s.nameEn, s.nameAr])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [data, term]);

  const bookable = units.filter((u) => u.openSlots > 0);
  const others = units.filter((u) => u.openSlots === 0);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{ar ? "دليل خدمات الحرم الجامعي" : "Campus services directory"}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {ar
            ? "كل وحدة خدمية في الجامعة، وما تتولاه، وكيفية التواصل معها، والمواعيد المتاحة حالياً. التفاصيل مأخوذة من سجلات الخدمة نفسها التي يستخدمها سندي."
            : "Every university service unit, what it handles, how to reach it, and the appointments it currently publishes. Details come from the same service records Sanadi uses."}
        </p>
      </header>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="ps-9"
          placeholder={ar ? "ابحث عن خدمة أو وحدة" : "Search a service or unit"}
          aria-label={ar ? "ابحث عن خدمة أو وحدة" : "Search a service or unit"}
        />
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p> : null}
      {error ? <p className="text-sm text-destructive">{(error as Error).message}</p> : null}

      {bookable.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {ar ? "مواعيد متاحة الآن" : "Appointments available now"}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {bookable.map((u) => (
              <UnitCard key={u.id} unit={u} ar={ar} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {ar ? "جميع الوحدات" : "All units"}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {others.map((u) => (
            <UnitCard key={u.id} unit={u} ar={ar} />
          ))}
        </div>
        {!isLoading && !units.length ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {ar ? "لا توجد نتائج مطابقة." : "No unit matches your search."}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function UnitCard({ unit, ar }: { unit: DirectoryUnit; ar: boolean }) {
  const name = (ar ? unit.nameAr : unit.nameEn) || unit.nameEn;
  const description = (ar ? unit.descriptionAr : unit.descriptionEn) ?? null;
  const hours = (ar ? unit.hoursAr : unit.hoursEn) ?? null;
  const office = (ar ? unit.officeAr : unit.officeEn) ?? null;
  const nextSlot = unit.nextSlot
    ? new Date(unit.nextSlot).toLocaleString(ar ? "ar-AE" : "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Dubai",
      })
    : null;

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{name}</CardTitle>
          {unit.openSlots > 0 ? (
            <Badge variant="secondary">{ar ? `${unit.openSlots} موعد متاح` : `${unit.openSlots} slots open`}</Badge>
          ) : null}
        </div>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {unit.services.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {unit.services.map((s) => (
              <li key={s.code}>
                <Badge variant="outline" className="font-normal">
                  {(ar ? s.nameAr : s.nameEn) || s.nameEn}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="space-y-1.5 text-muted-foreground">
          <Detail icon={Mail} label={ar ? "البريد" : "Email"}>
            {unit.email ? (
              <a className="text-foreground underline-offset-2 hover:underline" href={`mailto:${unit.email}`}>
                {unit.email}
              </a>
            ) : (
              <span>{ar ? "لم يُنشر بريد للتواصل" : "No contact email published"}</span>
            )}
          </Detail>
          {unit.phoneExtension ? (
            <Detail icon={Phone} label={ar ? "التحويلة" : "Extension"}>
              <span className="text-foreground">{unit.phoneExtension}</span>
            </Detail>
          ) : null}
          {office ? (
            <Detail icon={MapPin} label={ar ? "المكتب" : "Office"}>
              <span className="text-foreground">{office}</span>
            </Detail>
          ) : null}
          {hours ? (
            <Detail icon={Clock} label={ar ? "ساعات العمل" : "Hours"}>
              <span className="text-foreground">{hours}</span>
            </Detail>
          ) : null}
          {nextSlot ? (
            <Detail icon={CalendarClock} label={ar ? "أقرب موعد" : "Next appointment"}>
              <span className="text-foreground">{nextSlot}</span>
            </Detail>
          ) : null}
        </dl>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant={unit.openSlots > 0 ? "default" : "secondary"}>
            <Link
              to="/assistant"
              search={{
                unit: unit.id,
                draft: ar ? `أريد معرفة المزيد عن ${name}` : `Tell me about ${name}`,
              }}
            >
              {unit.openSlots > 0
                ? ar
                  ? "احجز عبر سندي"
                  : "Book through Sanadi"
                : ar
                  ? "اسأل سندي عن هذه الوحدة"
                  : "Ask Sanadi about this unit"}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
