import { useState } from "react";
import {requirementLabel} from "@/lib/transfer/labels";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { getTransferCaseFn, reviewTransferFn } from "@/lib/transfer/functions";
import type { TransferReport } from "@/lib/transfer/service.server";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
export function TransferCasePanel({caseId}:{caseId:string}) {
  const {lang}=useI18n();const ar=lang==="ar";const qc=useQueryClient();
  const read=useServerFn(getTransferCaseFn);const review=useServerFn(reviewTransferFn);
  const query=useQuery({queryKey:["transfer-case",caseId],queryFn:()=>read({data:{caseId}})});
  const [note,setNote]=useState("");const [busy,setBusy]=useState(false);
  const row=query.data;if(!row) return null;
  const report=row.analysis_snapshot as unknown as TransferReport;
  const closed=["completed","rejected","cancelled","failed"].includes(row.transfer_status);
  async function act(action:"approve"|"reject"|"complete") {setBusy(true);try {
    await review({data:{caseId,action,note}});
    await Promise.all([["transfer-case",caseId],["case",caseId],["case-timeline",caseId],["case-outcome",caseId],["case-activity",caseId],["my-notifications"]].map(queryKey=>qc.invalidateQueries({queryKey})));
    toast.success(ar?"تم تسجيل القرار":"Decision recorded");
  }catch(error){toast.error(error instanceof Error?error.message:ar?"تعذر تسجيل القرار":"Decision could not be recorded");}finally{setBusy(false);}}
  const unavailable=ar?"غير متاح":"Unavailable";
  return <section className="space-y-4 border-y py-5">
    <h2 className="text-lg font-semibold">{ar?"تحويل البرنامج / الكلية":"Programme / College Transfer"}</h2>
    <p className="text-sm font-medium">{row.transfer_status==="completed"?(ar?"مكتمل":"Completed"):row.transfer_status==="rejected"?(ar?"مرفوض":"Rejected"):row.approved_at?(ar?"تمت الموافقة — بانتظار إكمال الإجراء":"Approved — awaiting completion"):(ar?"بانتظار مراجعة القبول والتسجيل":"Awaiting Registration review")}</p>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">{[
      [ar?"البرنامج الحالي":"Current programme",ar?report.sourceAr:report.source],
      [ar?"البرنامج المستهدف":"Target programme",ar?report.targetAr:report.target],
      [ar?"المعدل":"GPA",report.gpa],[ar?"الساعات المكتملة":"Completed credits",report.credits],
      [ar?"الساعات المحتسبة":"Retained credits",report.retained],[ar?"الساعات غير المحتسبة":"Non-applicable credits",report.nonApplicable],
      [ar?"الساعات غير المحددة":"Unmapped credits",report.unknown],[ar?"السعة عند التأكيد":"Capacity at confirmation",report.seats],
      [ar?"مرات التحويل السابقة":"Previous transfers",report.previousTransfers],[ar?"تأكيد الطالب":"Student confirmation",row.student_confirmed_at?new Date(row.student_confirmed_at).toLocaleString(ar?"ar-AE":"en-GB"):null],
      [ar?"نسخة الشروط":"Rule version",report.ruleVersion],
    ].map(([label,value])=><div key={String(label)}><dt className="text-muted-foreground">{label}</dt><dd>{value??unavailable}</dd></div>)}</dl>
    <p className="text-sm text-muted-foreground">{ar?"التحويل مسموح مرة واحدة. لا يوجد تقدير موثوق لتأخير التخرج حالياً.":"Transfer is permitted only once. A reliable graduation-delay estimate is not currently available."}</p>
    <ul className="space-y-1 text-sm">{report.requirements.map(c=><li key={c.field}>{requirementLabel(c.field,ar)}: {c.actual??unavailable} / {c.minimum??unavailable} · {c.passed?(ar?"مستوفى":"Passed"):(ar?"غير مستوفى":"Not passed")}</li>)}</ul>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-start"><th className="py-2 text-start">{ar?"المقرر":"Course"}</th><th className="text-start">{ar?"الساعات":"Credits"}</th><th className="text-start">{ar?"المحتسبة":"Retained"}</th></tr></thead><tbody>{report.courses.map(c=><tr key={c.code} className="border-b"><td className="py-2"><bdi dir="ltr">{c.code}</bdi></td><td>{c.credits}</td><td>{c.accepted}</td></tr>)}</tbody></table></div>
    {row.owner_notes?<p className="text-sm">{row.owner_notes}</p>:null}
    {row.canReview&&!closed?<div className="space-y-3"><Label htmlFor="transfer-decision-note">{ar?"سبب القرار / مرجع إتمام الإجراء الجامعي":"Decision reason / university completion reference"}</Label><Textarea id="transfer-decision-note" value={note} onChange={e=>setNote(e.target.value)}/><div className="flex flex-wrap gap-2"><Button disabled={busy||note.trim().length<5||!!row.approved_at} onClick={()=>void act("approve")}>{ar?"الموافقة":"Approve"}</Button><Button variant="destructive" disabled={busy||note.trim().length<5} onClick={()=>void act("reject")}>{ar?"الرفض":"Reject"}</Button><Button variant="outline" disabled={busy||note.trim().length<5||!row.approved_at} onClick={()=>void act("complete")}>{ar?"تأكيد إتمام الإجراء الجامعي":"Confirm university completion"}</Button></div></div>:null}
  </section>;
}