import { useEffect, useState } from "react";
import { defaultHostel } from "@/lib/ops/staff-workspace";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { getHostelBookingFn, updateHostelBookingFn, listAvailableHostelRoomsFn, bookHostelRoomFn } from "@/lib/hostel/functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function HostelBookingPanel({caseId}:{caseId:string}) {
  const {lang} = useI18n(); const ar = lang === "ar";
  const {roles} = useAuth();
  const staff = roles.some(r=>["service_officer","service_owner","service_manager","system_admin"].includes(r));
  const read = useServerFn(getHostelBookingFn); const update = useServerFn(updateHostelBookingFn);
  const qc = useQueryClient();
  const q = useQuery({queryKey:["hostel-booking",caseId],queryFn:()=>read({data:{caseId}})});
  // No blind "A": the selection starts empty and is set from the student's
  // authoritative eligibility (A for single, B/C for double) once loaded.
  const [hostel,setHostel]=useState<string>("");
  const [room,setRoom]=useState("");const [checkIn,setCheckIn]=useState("");const [note,setNote]=useState("");const [verified,setVerified]=useState(false);const [busy,setBusy]=useState(false);
  async function act(action:"assign"|"confirm"|"cancel"|"complete") {
    setBusy(true);
    try {
      await update({data:{caseId,action,...(action === "assign" ? {hostel:hostel as "A"|"B"|"C",room,...(checkIn ? {checkIn} : {}),verifiedAvailable:verified} : {}),...(note ? {note} : {})}});
      await Promise.all([["hostel-booking",caseId],["case",caseId],["case-ops",caseId],["case-timeline",caseId],["case-outcome",caseId],["my-notifications"]].map(queryKey=>qc.invalidateQueries({queryKey})));
      toast.success(ar ? "تم تحديث طلب السكن" : "Hostel request updated");
    }catch(e){toast.error(e instanceof Error ? e.message : ar ? "تعذر تحديث الطلب" : "Request could not be updated");}finally{setBusy(false);}
  }
  const b=q.data;
  useEffect(()=>{ if(b && !hostel){ const d=defaultHostel(b.eligible_hostels, b.hostel); if(d) setHostel(d); } },[b, hostel]);
  // Only cases with a persisted hostel booking show hostel controls; other services never do.
  if(q.isError) return <section className="border-y py-5" role="alert"><p className="text-sm text-destructive">{ar ? "تعذّر تحميل بيانات حجز السكن. حاول مرة أخرى." : "The hostel booking details could not be loaded. Please try again."}</p><Button size="sm" variant="outline" className="mt-2" onClick={()=>void q.refetch()}>{ar ? "إعادة المحاولة" : "Retry"}</Button></section>;
  if(!b) return null;
  const stages:Record<string,{en:string;ar:string}>={submitted:{en:"Submitted — awaiting room allocation",ar:"تم الإرسال — بانتظار تحديد الغرفة"},room_assigned:{en:"Room assigned — awaiting confirmation",ar:"تم تحديد الغرفة — بانتظار التأكيد"},confirmed:{en:"Booking confirmed",ar:"تم تأكيد الحجز"},completed:{en:"Completed",ar:"مكتمل"},cancelled:{en:"Cancelled",ar:"ملغى"},closed:{en:"Closed",ar:"مغلق"}};
  const active=!["cancelled","completed","closed"].includes(b.stage);
  return <section className="space-y-4 border-y py-5">
    <h2 className="text-lg font-semibold">{ar ? "حجز السكن الجامعي" : "Hostel Room Booking"}</h2>
    <p className="text-sm font-medium">{stages[b.stage]?.[lang] ?? (ar ? "قيد المعالجة" : "In progress")}</p>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">{ar ? "مدينة السكن الموثقة" : "Verified home city"}</dt><dd>{b.home_city}</dd></div>
      <div><dt className="text-muted-foreground">{ar ? "الساعات المكتملة" : "Completed credits"}</dt><dd>{b.completed_credits}</dd></div>
      <div><dt className="text-muted-foreground">{ar ? "نوع الغرفة المؤهل" : "Eligible room type"}</dt><dd>{b.eligible_room_type === "single" ? (ar ? "فردية — سكن A" : "Single — Hostel A") : (ar ? "مزدوجة — سكن B أو C" : "Double — Hostel B or C")}</dd></div>
      <div><dt className="text-muted-foreground">{ar ? "الغرفة المسندة" : "Assigned room"}</dt><dd>{b.room_number ? `${b.hostel} · ${b.room_number}` : ar ? "لم يتم تحديد غرفة بعد" : "No room assigned yet"}</dd></div>
      {b.check_in_date ? <div><dt className="text-muted-foreground">{ar ? "تاريخ الدخول" : "Check-in date"}</dt><dd>{b.check_in_date}</dd></div> : null}
    </dl>
    {staff && active ? <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label>{ar ? "السكن" : "Hostel"}</Label><Select value={hostel} onValueChange={v=>{if(b.eligible_hostels.includes(v as never))setHostel(v);}}><SelectTrigger aria-label={ar ? "السكن" : "Hostel"}><SelectValue placeholder={ar ? "اختر السكن المؤهل" : "Choose an eligible hostel"} /></SelectTrigger><SelectContent>{b.eligible_hostels.map(h=><SelectItem key={h} value={h}>{ar ? "سكن" : "Hostel"} {h}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="hostel-room">{ar ? "رقم الغرفة" : "Room number"}</Label><Input id="hostel-room" value={room} onChange={e=>setRoom(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="hostel-checkin">{ar ? "تاريخ الدخول (اختياري)" : "Check-in date (optional)"}</Label><Input id="hostel-checkin" type="date" value={checkIn} onChange={e=>setCheckIn(e.target.value)} /></div>
      </div>
      <div className="flex items-center gap-2"><Checkbox id="hostel-available" checked={verified} onCheckedChange={v=>setVerified(v === true)} /><Label htmlFor="hostel-available">{ar ? "تحققت من توفر هذه الغرفة فعلياً" : "I verified this room is actually available"}</Label></div>
      <Label htmlFor="hostel-note">{ar ? "ملاحظة الموظف / سبب الإلغاء" : "Staff note / cancellation reason"}</Label><Textarea id="hostel-note" value={note} onChange={e=>setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !verified || !room.trim() || !b.eligible_hostels.includes(hostel as never)} onClick={()=>void act("assign")}>{ar ? "تحديد الغرفة" : "Assign Room"}</Button>
        <Button variant="outline" disabled={busy || b.stage !== "room_assigned"} onClick={()=>void act("confirm")}>{ar ? "تأكيد الحجز" : "Confirm Booking"}</Button>
        <Button variant="outline" disabled={busy || b.stage !== "confirmed"} onClick={()=>void act("complete")}>{ar ? "إكمال الطلب" : "Complete Request"}</Button>
        <Button variant="destructive" disabled={busy || note.trim().length < 5} onClick={()=>void act("cancel")}>{ar ? "إلغاء الحجز" : "Cancel Booking"}</Button>
      </div>
    </div> : null}
  </section>;
}
type AvailableRoom = {hostel:string;roomNumber:string;roomType:string;floor:number|null;capacity:number;availableBeds:number};

export function HostelDirectBooking() {
  const {lang} = useI18n(); const ar = lang === "ar";
  const list = useServerFn(listAvailableHostelRoomsFn); const book = useServerFn(bookHostelRoomFn);
  const qc = useQueryClient();
  const q = useQuery({queryKey:["hostel-available-rooms"],queryFn:()=>list({data:undefined}),refetchInterval:30000});
  const [bookingRoom,setBookingRoom]=useState<string|null>(null);
  const data = q.data as {eligible:boolean;reason?:string;roomType?:string;rooms?:AvailableRoom[]} | undefined;
  async function bookNow(r:AvailableRoom) {
    setBookingRoom(r.roomNumber);
    try {
      const result = await book({data:{hostel:r.hostel as "A"|"B"|"C",roomNumber:r.roomNumber,lang}}) as {caseId:string;reference:string};
      await qc.invalidateQueries({queryKey:["hostel-available-rooms"]});
      toast.success(ar ? `تم حجز غرفتك فوراً: ${result.reference}` : `Your room is booked instantly: ${result.reference}`);
    } catch(e) {
      toast.error(e instanceof Error ? e.message : ar ? "تعذر حجز الغرفة" : "The room could not be booked");
      await qc.invalidateQueries({queryKey:["hostel-available-rooms"]});
    } finally { setBookingRoom(null); }
  }
  if(!data) return null;
  if(!data.eligible) return null;
  const rooms = data.rooms ?? [];
  return <section className="space-y-4 border-y py-5">
    <h2 className="text-lg font-semibold">{ar ? "حجز السكن الجامعي" : "Hostel Room Booking"}</h2>
    <p className="text-sm text-muted-foreground">{ar ? "الغرف المعروضة متاحة فعلياً الحين. الحجز فوري — الأسبق يحجز." : "Only currently available rooms are listed. Booking is instant — first come, first served."}</p>
    {rooms.length === 0 ? <p className="text-sm">{ar ? "لا توجد غرف متاحة حالياً في السكن المؤهل لك." : "No rooms are currently available in your eligible hostel."}</p> :
    <ul className="grid gap-2 sm:grid-cols-2">
      {rooms.map(r=><li key={`${r.hostel}-${r.roomNumber}`} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <div>
          <p className="font-medium">{ar ? `سكن ${r.hostel} · غرفة ${r.roomNumber}` : `Hostel ${r.hostel} · Room ${r.roomNumber}`}</p>
          <p className="text-muted-foreground">{r.roomType} · {ar ? `${r.availableBeds} ${r.availableBeds === 1 ? "سرير متاح" : "أسرة متاحة"}` : `${r.availableBeds} bed${r.availableBeds === 1 ? "" : "s"} left`}</p>
        </div>
        <Button size="sm" disabled={bookingRoom !== null} onClick={()=>void bookNow(r)}>{bookingRoom === r.roomNumber ? (ar ? "جارٍ الحجز…" : "Booking…") : (ar ? "احجز الحين" : "Book now")}</Button>
      </li>)}
    </ul>}
  </section>;
}
