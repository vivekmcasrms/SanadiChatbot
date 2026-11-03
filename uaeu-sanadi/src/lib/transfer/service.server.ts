import type { Db, ToolDefinition } from "@/lib/agent/tools.server";
import { matchesProgramme } from "./programme-matching";
export type TransferReport = {
  assessmentId?: string; source: string | null; sourceAr: string | null; target: string | null; targetAr: string | null;
  targetId: string; gpa: number | null; credits: number | null; previousTransfers: number | null;
  academicallyEligible: boolean; canSubmit: boolean; failures: string[]; operational: string[];
  requirements: {field: string; minimum: number | null; actual: number | null; passed: boolean}[];
  seats: number | null; retained: number; nonApplicable: number; unknown: number;
  currentRemaining: number | null; targetRemaining: number | null; additionalCredits: number | null;
  ruleVersion: string; isDemo: boolean; courses: {code:string;credits:number;accepted:number;type:string}[];
};
const reasons: Record<string,[string,string]> = {
  academic_record_unavailable:["Academic record is incomplete or inactive","السجل الأكاديمي غير مكتمل أو غير نشط"],
  credits_unavailable:["Completed credits are unavailable","الساعات المكتملة غير متاحة"],
  below_minimum_credits:["At least 12 completed credits are required","الحد الأدنى 12 ساعة مكتملة"],
  above_maximum_credits:["At most 36 completed credits are permitted","الحد الأقصى 36 ساعة مكتملة"],
  gpa_unavailable:["GPA is unavailable","المعدل غير متاح"],gpa_below_minimum:["GPA must be at least 2.50","يجب ألا يقل المعدل عن 2.50"],
  history_unavailable:["Verified previous-transfer history is unavailable","سجل التحويل السابق الموثق غير متاح"],
  previous_transfer_exists:["You have already used the one permitted transfer","سبق لك استخدام التحويل المسموح مرة واحدة"],
  target_rules_unavailable:["Verified target entry requirements are unavailable","شروط القبول الموثقة للبرنامج المستهدف غير متاحة"],
  conflicting_policy:["Conflicting programme policy needs university review","يوجد تعارض في شروط البرنامج يحتاج مراجعة الجامعة"],
  academic_credit_conflict:["Course credits do not reconcile with the academic record","ساعات المقررات لا تتطابق مع السجل الأكاديمي"],
  service_closed:["The transfer service is currently closed","خدمة التحويل مغلقة حالياً"],
  target_not_accepting:["The target programme is not confirmed to be accepting transfers","لم يتم تأكيد استقبال البرنامج المستهدف لطلبات التحويل"],
  capacity_unavailable:["Verified current-term seat capacity is unavailable","سعة المقاعد الموثقة للفصل الحالي غير متاحة"],
  no_available_seats:["The target programme has no available seats","لا توجد مقاعد متاحة في البرنامج المستهدف"],
  equivalency_unavailable:["Some completed credits have no verified equivalency decision; Registration must complete the analysis before submission","بعض الساعات لا تتوفر لها معادلة موثقة؛ يجب أن يكمل القبول والتسجيل التحليل قبل تقديم الطلب"],
};
export { entryLabels } from "./labels";
import { entryLabels } from "./labels";
export function formatTransferReport(r: TransferReport, lang:"en"|"ar") {
  const ar=lang==="ar"; const t=(en:string,arabic:string)=>ar?arabic:en;
  const unknown=t("Unavailable","غير متاح");
  const lines=[r.isDemo?t("Demo transfer assessment — not real university eligibility or seats","تقييم تحويل تجريبي — ليس أهلية أو مقاعد جامعية فعلية"):t("Programme / College Transfer","تحويل البرنامج / الكلية"),
    `- ${t("Academic eligibility","الأهلية الأكاديمية")}: ${r.academicallyEligible?t("Eligible","مؤهل"):t("Not eligible / incomplete evidence","غير مؤهل / بيانات غير مكتملة")}`,
    `- ${t("Current programme","البرنامج الحالي")}: ${(ar?r.sourceAr:r.source)??unknown}`,
    `- ${t("Target programme","البرنامج المستهدف")}: ${(ar?r.targetAr:r.target)??unknown}`,
    `- ${t("GPA","المعدل")}: ${r.gpa??unknown}`,
    `- ${t("Completed credits","الساعات المكتملة")}: ${r.credits??unknown}`,
    `- ${t("Previous transfers","مرات التحويل السابقة")}: ${r.previousTransfers??unknown}`,
    `- ${t("Available capacity","المقاعد المتاحة")}: ${r.seats??unknown}`];
  for(const code of [...r.failures,...r.operational]) if(!code.startsWith("entry_requirement:")) lines.push(`- ${reasons[code]?.[ar?1:0]??t("University verification is required","يلزم تحقق الجامعة")}`);
  for(const c of r.requirements) lines.push(`- ${entryLabels[c.field]?.[ar?1:0]??c.field}: ${c.actual??unknown} / ${t("required","المطلوب")} ${c.minimum??unknown} — ${c.passed?t("Passed","مستوفى"):t("Not passed / unavailable","غير مستوفى / غير متاح")}`);
  lines.push("",`- ${t("Credits retained","الساعات المحتسبة")}: ${r.retained}`,`- ${t("Credits not applicable","الساعات غير المحتسبة")}: ${r.nonApplicable}`,`- ${t("Credits awaiting verified equivalency","ساعات بانتظار معادلة موثقة")}: ${r.unknown}`);
  if(r.currentRemaining!==null&&r.targetRemaining!==null) lines.push(`- ${t("Current programme credits remaining","الساعات المتبقية للبرنامج الحالي")}: ${r.currentRemaining}`,`- ${t("Target programme credits remaining","الساعات المتبقية للبرنامج المستهدف")}: ${r.targetRemaining}`,`- ${t("Additional credits","الساعات الإضافية")}: ${r.additionalCredits}`);
  lines.push(t("The exact graduation impact cannot yet be determined from the available programme data.","لا يمكن تحديد الأثر الدقيق على التخرج من بيانات البرنامج المتاحة حالياً."),t("Transfer is permitted only once. Submission requests staff review; it does not change your programme.","التحويل مسموح مرة واحدة فقط. تقديم الطلب يطلب مراجعة الموظف ولا يغير برنامجك."));
  return lines.join("\n");
}
export async function prepareTransfer(db:Db,userId:string,text:string,lang:"en"|"ar",fallbackTarget?:string|null) {
  const {data:existing,error:existingError}=await db.from("intercollege_transfer_requests").select("case_id,transfer_number,transfer_status,approved_at").eq("student_id",userId).not("case_id","is",null).not("transfer_status","in","(completed,cancelled,rejected,failed)").limit(1).maybeSingle();
  if(existingError) throw new Error(lang==="ar"?"تعذر قراءة سجل التحويل":"Your transfer history could not be read.");
  if(existing) return {answer:lang==="ar"?`طلب التحويل ${existing.transfer_number} قيد المتابعة لدى القبول والتسجيل. ${existing.approved_at?"تمت الموافقة، بانتظار إكمال الإجراء.":"بانتظار المراجعة؛ لم يتغير برنامجك."}`:`Transfer request ${existing.transfer_number} is being handled by Registration. ${existing.approved_at?"Approved — awaiting completion.":"Awaiting review; your programme has not changed."}`,report:null};
  // Hard eligibility rules are evaluated BEFORE any target-programme question.
  // A student over 36 credits (or below 12, or under GPA 2.50, or with a used
  // transfer) is Not Eligible regardless of target — asking "which programme?"
  // cannot change the result, so the workflow stops here with the exact reason.
  const {data:sp}=await db.from("student_profiles").select("completed_credit_hours,cumulative_gpa").eq("user_id",userId).maybeSingle();
  const {count:completedTransfers}=await db.from("intercollege_transfer_requests").select("id",{count:"exact",head:true}).eq("student_id",userId).eq("transfer_status","completed");
  const hardFailures:string[]=[];
  const credits=sp?.completed_credit_hours??null;
  const gpa=sp?.cumulative_gpa??null;
  if(credits===null) hardFailures.push("credits_unavailable");
  else if(credits<12) hardFailures.push("below_minimum_credits");
  else if(credits>36) hardFailures.push("above_maximum_credits");
  if(gpa===null) hardFailures.push("gpa_unavailable");
  else if(gpa<2.50) hardFailures.push("gpa_below_minimum");
  if((completedTransfers??0)>0) hardFailures.push("previous_transfer_exists");
  if(hardFailures.length){
    const ar=lang==="ar";
    const reasons:string[]=[];
    if(hardFailures.includes("above_maximum_credits")) reasons.push(ar?`أتممت ${credits} ساعة معتمدة، والتحويل مسموح فقط لمن أتم بين 12 و36 ساعة.`:`you have completed ${credits} credit hours — transfer is only permitted between 12 and 36 completed credit hours.`);
    if(hardFailures.includes("below_minimum_credits")) reasons.push(ar?`أتممت ${credits} ساعة فقط، والحد الأدنى للتحويل 12 ساعة.`:`you have completed only ${credits} credit hours — the minimum for transfer is 12.`);
    if(hardFailures.includes("credits_unavailable")) reasons.push(ar?"ساعاتك المكتملة غير موثقة في السجل الجامعي.":"your completed credits are not verified in the university record.");
    if(hardFailures.includes("gpa_below_minimum")) reasons.push(ar?`معدلك التراكمي ${gpa} أقل من الحد الأدنى 2.50.`:`your cumulative GPA of ${gpa} is below the 2.50 minimum.`);
    if(hardFailures.includes("gpa_unavailable")) reasons.push(ar?"معدلك التراكمي غير موثق في السجل الجامعي.":"your cumulative GPA is not verified in the university record.");
    if(hardFailures.includes("previous_transfer_exists")) reasons.push(ar?"استخدمت التحويل سابقاً، والتحويل مسموح مرة واحدة فقط.":"you have already used your one permitted transfer.");
    const answer=(ar?"أنت غير مؤهل للتحويل بين البرامج لأن ":"You are not eligible for programme transfer because ")+reasons.join(ar?" و":" ")+(ar?"\n\nإذا كنت تعتقد أن سجلك الأكاديمي غير صحيح، يمكنني مساعدتك في طلب مراجعته.":"\n\nIf you believe your academic record is incorrect, I can help you request a review.");
    return {answer,report:{academicallyEligible:false,canSubmit:false,credits,gpa,failures:hardFailures,hardStop:true} as unknown as TransferReport};
  }
  const {data:programmes,error}=await db.from("academic_programs").select("id,code,name_en,name_ar,colleges(name_en,name_ar)").eq("is_active",true);
  if(error) throw new Error("Programme records are unavailable.");
  const found=(programmes??[]).filter(p=>matchesProgramme(text,p,p.colleges?.name_en));
  // Prefer the final explicit target phrase, never guess a programme from a college.
  const targetText=text.split(/\bto\b|إلى|الى/i).at(-1)??text;
  const exact=found.filter(p=>matchesProgramme(targetText,p));
  let candidates=exact.length?exact:found;
  // Short follow-ups ("what happens to my credits?") carry no programme name:
  // continue the transfer the student was already discussing.
  if(candidates.length!==1&&fallbackTarget){
    const carried=(programmes??[]).filter(p=>matchesProgramme(fallbackTarget,p,p.colleges?.name_en));
    if(carried.length===1) candidates=carried;
  }
  if(candidates.length!==1) return {answer:(lang==="ar"?"أي برنامج تود التحويل إليه؟":"Which programme would you like to transfer to?")+"\n\n"+(candidates.length?candidates:programmes??[]).map(p=>`- ${lang==="ar"?p.name_ar:p.name_en} (${p.code})`).join("\n"),report:null};
  const target=candidates[0]; if(!target) return {answer:"Programme unavailable",report:null};
  const {data,error:assessmentError}=await db.rpc("prepare_programme_transfer",{_target:target.id});
  if(assessmentError) throw new Error(lang==="ar"?"تعذر التحقق من بيانات التحويل. يرجى مراجعة القبول والتسجيل.":"Transfer records could not be verified. Please contact Admission & Registration.");
  const report=data as unknown as TransferReport;
  return {answer:formatTransferReport(report,lang),report};
}
export const transferTools:ToolDefinition[]=[{
  name:"assess_programme_transfer",agentType:"eligibility",description:"Read deterministic programme transfer eligibility and verified credit impact for the authenticated student. Target programme name or code is required. Never creates a transfer request.",parameters:{type:"object",properties:{target:{type:"string"}},required:["target"],additionalProperties:false},risk:"level_0",readOnly:true,confirmationRequired:false,humanApprovalRequired:false,allowedRoles:["student"],async run(ctx,args){
    if(typeof args["target"]!=="string") return {ok:false,error:"A target programme is required."};
    const result=await prepareTransfer(ctx.db,ctx.userId,`transfer to ${args["target"]}`,ctx.lang);return {ok:true,data:result};
  }
},{
  name:"request_inter_college_transfer",agentType:"action",description:"Submit an explicitly confirmed prepared transfer assessment for Registration review. Does not execute a programme change; backend revalidates all facts.",parameters:{type:"object",properties:{assessmentId:{type:"string"}},required:["assessmentId"],additionalProperties:false},risk:"level_2",readOnly:false,confirmationRequired:true,humanApprovalRequired:false,allowedRoles:["student"],async run(ctx,args){
    if(typeof args["assessmentId"]!=="string") return {ok:false,error:"A verified assessment is required."};
    const {data,error}=await ctx.db.rpc("submit_programme_transfer",{_assessment:args["assessmentId"],_lang:ctx.lang});
    if(error) return {ok:false,error:ctx.lang==="ar"?"لم يتم تقديم الطلب. قد تغيرت بيانات الأهلية أو المعادلات أو المقاعد؛ أعد التقييم وراجع القبول والتسجيل.":"The request was not submitted. Eligibility, equivalencies or capacity may have changed; reassess and contact Registration."};
    const r=data as {caseId:string;reference:string;unitId?:string};
    return {ok:true,data:r,reference:{caseId:r.caseId,referenceNumber:r.reference,actionType:"request_inter_college_transfer",unitId:r.unitId??null,unitName:ctx.lang==="ar"?"القبول والتسجيل":"Admission & Registration",trackingUrl:`/requests/${r.caseId}`,nextStepEn:"Registration staff will review your transfer. Your programme has not changed.",nextStepAr:"سيراجع القبول والتسجيل طلب التحويل. لم يتغير برنامجك."}};
  }
}];