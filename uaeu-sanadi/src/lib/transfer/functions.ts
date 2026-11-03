import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
export const getTransferCaseFn=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>z.object({caseId:z.string().uuid()}).parse(input)).handler(async({data,context})=>{
  const {data:allowed,error:caseError}=await context.supabase.from("cases").select("id").eq("id",data.caseId).maybeSingle();
  if(caseError||!allowed) throw new Error("Request unavailable.");
  const {data:row,error}=await context.supabase.from("intercollege_transfer_requests").select("case_id,transfer_status,approved_at,student_confirmed_at,owner_notes,analysis_snapshot").eq("case_id",data.caseId).maybeSingle();
  if(error) throw new Error("Transfer evidence unavailable.");
  const {data:canReview}=await context.supabase.rpc("can_review_programme_transfer",{_case:data.caseId});
  return row ? {...row,canReview:canReview===true} : null;
});
export const reviewTransferFn=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>z.object({caseId:z.string().uuid(),action:z.enum(["approve","reject","complete"]),note:z.string().trim().min(5).max(2000)}).parse(input)).handler(async({data,context})=>{
  const {data:result,error}=await context.supabase.rpc("review_programme_transfer",{_case:data.caseId,_action:data.action,_note:data.note});
  if(error) throw new Error("This decision could not be recorded. Check Registration permissions, current eligibility and capacity; obtain fresh student confirmation if evidence changed.");return result;
});
const score=z.number().nonnegative().max(100).optional();
const scores=z.object({high_school:score,english:score,algebra:score,calculus:score,physics:score,mathematics:score,gpa:z.number().min(0).max(4).optional()}).strict();
export const configureTransferRulesFn=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>z.object({programmeId:z.string().uuid(),version:z.string().trim().min(1),requirements:scores,accepting:z.boolean(),source:z.string().trim().min(5),demo:z.boolean()}).parse(input)).handler(async({data,context})=>{
  const {error}=await context.supabase.rpc("configure_transfer_rules",{_programme:data.programmeId,_version:data.version,_requirements:data.requirements,_accepting:data.accepting,_source:data.source,_demo:data.demo});
  if(error) throw new Error("An authorised administrator must verify programme rules against a university source.");return {ok:true};
});
export const verifyTransferStudentFn=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>z.object({studentId:z.string().uuid(),previous:z.number().int().nonnegative(),scores,source:z.string().trim().min(5)}).parse(input)).handler(async({data,context})=>{
  const {error}=await context.supabase.rpc("verify_transfer_student",{_student:data.studentId,_previous:data.previous,_scores:data.scores,_source:data.source});
  if(error) throw new Error("An authorised administrator must verify student admission scores and transfer history.");return {ok:true};
});
export const configureTransferCapacityFn=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>z.object({programmeId:z.string().uuid(),termId:z.string().uuid(),seats:z.number().int().nonnegative(),source:z.string().trim().min(5),demo:z.boolean()}).parse(input)).handler(async({data,context})=>{
  const {error}=await context.supabase.rpc("configure_transfer_capacity",{_programme:data.programmeId,_term:data.termId,_seats:data.seats,_source:data.source,_demo:data.demo});
  if(error) throw new Error("An authorised administrator must verify capacity; allocated seats cannot be removed.");return {ok:true};
});