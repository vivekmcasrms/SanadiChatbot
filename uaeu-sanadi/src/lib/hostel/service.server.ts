import { DataUnavailableError } from "@/lib/result";
import { auditInsert } from "@/lib/exceptions/handle.server";
import type { Db, ToolContext, ToolDefinition } from "@/lib/agent/tools.server";
import { evaluateHostelEligibility, HOSTEL_RULE_VERSION } from "./rules";

export async function hostelReport(db: Db, userId: string, lang: "en" | "ar") {
  const [record, academic, booking] = await Promise.all([
    db.from("hostel_student_records").select("home_city,verified_at").eq("student_id",userId).maybeSingle(),
    db.from("student_profiles").select("completed_credit_hours,student_number,account_status,program,academic_level").eq("user_id",userId).maybeSingle(),
    db.from("hostel_bookings").select("*,cases(case_number,status)").eq("student_id",userId).order("created_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  if (record.error || academic.error || booking.error) throw new Error(lang === "ar" ? "تعذر استرجاع بيانات السكن. حاول مرة أخرى." : "Your housing records could not be retrieved. Please try again.");
  const city = record.data?.home_city ?? null;
  const credits = academic.data?.completed_credit_hours ?? null;
  const eligibility = evaluateHostelEligibility(city,credits);
  const ar = lang === "ar";
  const existing = booking.data;
  const hasActiveBooking = Boolean(existing && !["cancelled","completed","closed"].includes(existing.stage));
  const canUpgrade = hasActiveBooking
    && eligibility.eligible
    && eligibility.roomType === "single"
    && Boolean(existing) && ["B","C"].includes((existing as {hostel?: string|null}).hostel ?? "");
  let answer: string;
  if (hasActiveBooking && !canUpgrade) {
    answer = formatHostelBooking(existing!,lang);
  } else if (eligibility.reason === "missing_city") {
    answer = ar ? "أحتاج مدينة سكنك المسجلة لتحديد أهلية السكن الجامعي، ولم أتمكن من استرجاعها من سجلك. يرجى طلب تصحيح أو استكمال البيانات لدى القبول والتسجيل؛ لن أستخدم مدينة غير موثقة من المحادثة." : "I need your registered home city to determine hostel eligibility. I could not retrieve it from your student record. Please ask Admission & Registration to verify or correct it; a city supplied in chat cannot override your record.";
  } else if (eligibility.reason === "al_ain") {
    answer = ar ? "أنت غير مؤهل حالياً للسكن الجامعي لأن مدينة السكن المسجلة لديك هي العين. السكن الجامعي مخصص للطلبة القادمين من مدن أخرى. إذا كان السجل غير صحيح، يمكنك طلب تصحيح البيانات لدى القبول والتسجيل." : "You are currently not eligible for university hostel accommodation because your registered home city is Al Ain. Accommodation is available only to students whose home city is outside Al Ain. If your record is incorrect, request a data correction from Admission & Registration.";
  } else if (eligibility.reason === "missing_credits") {
    answer = ar ? "لم أتمكن من استرجاع ساعاتك المكتملة من السجل الأكاديمي، لذلك لا يمكنني تحديد نوع الغرفة. يرجى مراجعة القبول والتسجيل." : "Your completed credit hours are unavailable in your academic record, so I cannot determine single or double room eligibility. Please contact Admission & Registration.";
  } else {
    answer = ar
      ? `أنت مؤهل للسكن الجامعي.\n\n- مدينة السكن المسجلة: ${city}\n- الساعات المكتملة: ${credits}\n- نوع الغرفة: ${eligibility.roomType === "single" ? "فردية" : "مزدوجة"}\n- السكن المؤهل: ${eligibility.hostels.join(" أو ")}\n\n${eligibility.roomType === "single" ? "إكمال 60 ساعة أو أكثر يؤهلك لغرفة فردية في سكن A." : "إكمال أقل من 60 ساعة يؤهلك لغرفة مزدوجة في سكن B أو C."} سيُعالج طلبك وفق الغرف المتاحة؛ لم يتم تأكيد توفر غرفة أو حجزها.`
      : `You are eligible for university hostel accommodation.\n\n- Registered home city: ${city}\n- Completed credits: ${credits}\n- Room type: ${eligibility.roomType === "single" ? "Single Room" : "Double Room"}\n- Eligible hostel: ${eligibility.hostels.map(h => `Hostel ${h}`).join(" or ")}\n\n${eligibility.roomType === "single" ? "60 or more completed credits qualify you for a single room in Hostel A." : "Fewer than 60 completed credits qualify you for a double room in Hostel B or C."} Your request will be processed according to available rooms. No room availability or booking has been confirmed.`;
  }
  let availableRooms: {hostel:string;roomNumber:string;roomType:string;floor:number|null;capacity:number;availableBeds:number}[] = [];
  const canSubmit = eligibility.eligible && (!hasActiveBooking || canUpgrade);
  if (canUpgrade) {
    answer += ar
      ? "\n\nأكملت 60 ساعة أو أكثر، لذلك يمكنك الانتقال إلى غرفة فردية في سكن A. عند حجز غرفة في سكن A يُلغى حجزك الحالي تلقائياً ويُتحرر سريرك لطالب آخر."
      : "\n\nYou have completed 60 or more credits, so you can move to a single room in Hostel A. When you book a Hostel A room, your current booking is cancelled automatically and your bed is released for another student.";
  }
  if (canSubmit) {
    const avail = await db.rpc("list_available_hostel_rooms");
    // A failed availability lookup must never read as "no rooms available".
    if (avail.error) throw new DataUnavailableError("hostel", avail.error.code || "availability_failed");
    if (!avail.error && avail.data && typeof avail.data === "object" && Array.isArray((avail.data as {rooms?: unknown}).rooms)) {
      availableRooms = (avail.data as {rooms: typeof availableRooms}).rooms;
      const list = availableRooms.map(r => ar ? `سكن ${r.hostel} · غرفة ${r.roomNumber} (${r.availableBeds} ${r.availableBeds === 1 ? "سرير متاح" : "أسرة متاحة"})` : `Hostel ${r.hostel} · Room ${r.roomNumber} (${r.availableBeds} bed${r.availableBeds === 1 ? "" : "s"} available)`).join("\n- ");
      answer += availableRooms.length
        ? (ar ? `\n\nالغرف المتاحة الحين (الحجز فوري — الأسبق يحجز):\n- ${list}\n\nاختر غرفة وتُحجز لك مباشرة.` : `\n\nRooms available right now (instant booking — first come, first served):\n- ${list}\n\nPick a room and it is booked for you immediately.`)
        : (ar ? "\n\nلا توجد غرف متاحة حالياً في السكن المؤهل لك." : "\n\nNo rooms are currently available in your eligible hostel.");
    }
  }
  await auditInsert(db, {actor_id:userId,action:"hostel.eligibility_checked",entity_type:"student",entity_id:userId,metadata:{home_city:city,completed_credits:credits,eligible:eligibility.eligible,reason:eligibility.reason,room_type:eligibility.roomType,rule_version:HOSTEL_RULE_VERSION,available_rooms:availableRooms.length}});
  return {answer,eligibility,existing,canSubmit,availableRooms};
}

export function formatHostelBooking(b: {stage:string;hostel:string|null;room_number:string|null;check_in_date:string|null;eligible_room_type:string;cases?: {case_number:string;status:string}|null}, lang:"en"|"ar") {
  const labels: Record<string,[string,string]> = {submitted:["Submitted","تم الإرسال"],room_assigned:["Room assigned — awaiting confirmation","تم تحديد الغرفة — بانتظار التأكيد"],confirmed:["Booking confirmed","تم تأكيد الحجز"],completed:["Completed","مكتمل"],cancelled:["Cancelled","ملغى"]};
  const stage = labels[b.stage]?.[lang === "ar" ? 1 : 0] ?? (lang === "ar" ? "قيد المعالجة" : "In progress");
  return lang === "ar" ? `طلب السكن ${b.cases?.case_number ?? ""}:\n\n- الحالة: ${stage}\n- نوع الغرفة المؤهل: ${b.eligible_room_type === "single" ? "فردية" : "مزدوجة"}\n${b.hostel ? `- السكن: ${b.hostel}\n` : ""}${b.room_number ? `- الغرفة: ${b.room_number}\n` : "- لم يتم تحديد غرفة بعد.\n"}${b.check_in_date ? `- تاريخ الدخول: ${b.check_in_date}\n` : ""}` : `Hostel request ${b.cases?.case_number ?? ""}:\n\n- Status: ${stage}\n- Eligible room type: ${b.eligible_room_type === "single" ? "Single" : "Double"}\n${b.hostel ? `- Hostel: ${b.hostel}\n` : ""}${b.room_number ? `- Room: ${b.room_number}\n` : "- No room has been assigned yet.\n"}${b.check_in_date ? `- Check-in date: ${b.check_in_date}\n` : ""}`;
}

export const hostelTools: ToolDefinition[] = [
  {name:"get_hostel_eligibility",agentType:"query",description:"Read verified hostel eligibility and actual existing booking. Never infer home city or room availability.",parameters:{type:"object",properties:{},additionalProperties:false},risk:"level_0",readOnly:true,confirmationRequired:false,humanApprovalRequired:false,allowedRoles:["student"],async run(ctx){return {ok:true,data:await hostelReport(ctx.db,ctx.userId,ctx.lang)};}},
  {name:"book_hostel_room",agentType:"action",description:"Book ONE available hostel room instantly, first-come-first-served. Only rooms returned by get_hostel_eligibility as currently available may be booked. Backend rechecks verified city, credits and live availability atomically; no arguments can override eligibility.",parameters:{type:"object",properties:{hostel:{type:"string",enum:["A","B","C"],description:"Hostel code of an available room from the eligibility report"},roomNumber:{type:"string",description:"Exact room number of an available room from the eligibility report"}},required:["hostel","roomNumber"],additionalProperties:false},risk:"level_2",readOnly:false,confirmationRequired:false,humanApprovalRequired:false,allowedRoles:["student"],async run(ctx:ToolContext, rawArgs: Record<string, unknown>){
    const args = rawArgs as {hostel?: string; roomNumber?: string};
    const {data,error} = await ctx.db.rpc("book_hostel_room",{_hostel:String(args.hostel ?? ""),_room_number:String(args.roomNumber ?? ""),_lang:ctx.lang});
    if(error) return {ok:false,error:ctx.lang === "ar" ? "تعذر حجز الغرفة. ربما حجزها طالب آخر قبلك — اختر غرفة أخرى من المتاح." : "The room could not be booked. Another student may have booked it first — please choose another available room."};
    const result = data as {caseId:string;reference:string;unitId?:string;existing:boolean;hostel?:string;roomNumber?:string};
    const {routeCase} = await import("@/lib/ops/routing.server");
    if (!result.existing) await routeCase(result.caseId);
    return {ok:true,data:result,reference:{caseId:result.caseId,referenceNumber:result.reference,actionType:"book_hostel_room",unitId:result.unitId ?? null,unitName:ctx.lang === "ar" ? "خدمات السكن الطلابي" : "Student Housing Services",trackingUrl:`/requests/${result.caseId}`,nextStepEn:`Room confirmed instantly: Hostel ${result.hostel ?? ""}, room ${result.roomNumber ?? ""}. Contact Housing for check-in arrangements.`,nextStepAr:`تم تأكيد الغرفة فوراً: سكن ${result.hostel ?? ""}، غرفة ${result.roomNumber ?? ""}. تواصل مع السكن لترتيبات الدخول.`}};
  }},
];