import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { GROUP_TARGET, visibleNav } from "@/lib/nav";

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const groups = visibleNav(roles);
  const commands = groups.flatMap((g) =>
    g.items.length > 0
      ? g.items.map((i) => ({
          code: `${g.code}.${i.code}`,
          label: `${ar ? g.labelAr : g.labelEn} › ${ar ? i.labelAr : i.labelEn}`,
          to: i.to,
          search: i.search,
        }))
      : [
          {
            code: g.code,
            label: ar ? g.labelAr : g.labelEn,
            to: (GROUP_TARGET[g.code] ?? { to: "/dashboard" }).to,
            search: GROUP_TARGET[g.code]?.search,
          },
        ],
  );

  // Record search runs through the caller's own session, so RLS filters unauthorized rows.
  const { data: records } = useQuery({
    queryKey: ["command-search", query],
    enabled: open && query.trim().length >= 2,
    queryFn: async () => {
      const term = `%${query.trim()}%`;
      const [cases, docs, services] = await Promise.all([
        supabase.from("cases").select("id, case_number, title").ilike("title", term).limit(5),
        supabase.from("knowledge_documents").select("id, title").ilike("title", term).limit(5),
        supabase.from("university_services").select("id, name_en").ilike("name_en", term).limit(5),
      ]);
      return {
        cases: cases.data ?? [],
        docs: docs.data ?? [],
        services: services.data ?? [],
      };
    },
  });

  function go(to: string, search?: Record<string, string>) {
    onOpenChange(false);
    setQuery("");
    void navigate({ to, search: search ?? {} });
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={ar ? "ابحث أو انتقل…" : "Search or jump to…"}
      />
      <CommandList>
        <CommandEmpty>{ar ? "لا توجد نتائج" : "No results"}</CommandEmpty>
        <CommandGroup heading={ar ? "الانتقال" : "Navigate"}>
          {commands.map((c) => (
            <CommandItem key={c.code} value={c.label} onSelect={() => go(c.to, c.search)}>
              {c.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {records?.cases.length ? (
          <CommandGroup heading={ar ? "الحالات" : "Cases"}>
            {records.cases.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.case_number} ${c.title}`}
                onSelect={() => {
                  onOpenChange(false);
                  setQuery("");
                  void navigate({ to: "/requests/$caseId", params: { caseId: c.id } });
                }}
              >
                <bdi dir="ltr">{c.case_number}</bdi> — {c.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {records?.docs.length ? (
          <CommandGroup heading={ar ? "الوثائق" : "Documents"}>
            {records.docs.map((d) => (
              <CommandItem key={d.id} value={d.title} onSelect={() => go("/knowledge-center", { tab: "documents" })}>
                {d.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {records?.services.length ? (
          <CommandGroup heading={ar ? "الخدمات" : "Services"}>
            {records.services.map((s) => (
              <CommandItem key={s.id} value={s.name_en} onSelect={() => go("/admin")}>
                {s.name_en}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}
