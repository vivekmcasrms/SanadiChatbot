import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { verifyHostelCityFn } from "@/lib/hostel/functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export function HostelStudentDataSettings() {
  const {lang}=useI18n(); const ar=lang === "ar";
  const [studentId,setStudentId]=useState("");const [city,setCity]=useState("");const [source,setSource]=useState("");const [busy,setBusy]=useState(false);
  const save=useServerFn(verifyHostelCityFn);
  const q=useQuery({queryKey:["hostel-student-records"],queryFn:async()=>{
    const {data,error}=await supabase.from("student_profiles").select("user_id,student_number").order("student_number").limit(500);
    if(error)throw error;return data ?? [];
  }});
  return <section className="space-y-3 border-y py-5"><h2 className="font-semibold">{ar ? "بيانات السكن الجامعي الموثقة" : "Verified Hostel Student Data"}</h2>
    <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1"><Label>{ar ? "الرقم الجامعي" : "Student number"}</Label><Select value={studentId} onValueChange={setStudentId}><SelectTrigger aria-label={ar ? "الرقم الجامعي" : "Student number"}><SelectValue /></SelectTrigger><SelectContent>{q.data?.map(s=><SelectItem key={s.user_id} value={s.user_id}><bdi dir="ltr">{s.student_number}</bdi></SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="verified-city">{ar ? "مدينة السكن المسجلة" : "Registered home city"}</Label><Input id="verified-city" value={city} onChange={e=>setCity(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="city-source">{ar ? "مرجع المصدر الجامعي" : "University source reference"}</Label><Input id="city-source" value={source} onChange={e=>setSource(e.target.value)} /></div></div>
    <Button disabled={busy || !studentId || city.trim().length<2 || source.trim().length<3} onClick={async()=>{
      setBusy(true);try{await save({data:{studentId,city,source}});toast.success(ar ? "تم توثيق المدينة" : "Home city verified");setCity("");setSource("");}catch(e){toast.error(e instanceof Error ? e.message : "Unable to verify city");}finally{setBusy(false);}
    }}>{ar ? "توثيق المدينة من السجل الجامعي" : "Verify City from University Record"}</Button>
  </section>;
}