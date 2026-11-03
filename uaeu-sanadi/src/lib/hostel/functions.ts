import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
export const getHostelBookingFn = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((d:unknown)=>z.object({caseId:z.string().uuid()}).parse(d)).handler(async({data,context})=>{
  const {data:booking,error} = await context.supabase.from("hostel_bookings").select("*").eq("case_id",data.caseId).maybeSingle();
  if(error) throw new Error("Housing record could not be retrieved.");
  return booking;
});
export const updateHostelBookingFn = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((d:unknown)=>z.object({caseId:z.string().uuid(),action:z.enum(["assign","confirm","cancel","complete"]),hostel:z.enum(["A","B","C"]).optional(),room:z.string().trim().min(1).max(50).optional(),checkIn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),note:z.string().max(2000).optional(),verifiedAvailable:z.boolean().default(false)}).parse(d)).handler(async({data,context})=>{
  const {data:result,error}=await context.supabase.rpc("update_hostel_booking",{_case_id:data.caseId,_action:data.action,...(data.hostel ? {_hostel:data.hostel} : {}),...(data.room ? {_room:data.room} : {}),...(data.checkIn ? {_check_in:data.checkIn} : {}),...(data.note ? {_note:data.note} : {}),_verified_available:data.verifiedAvailable});
  if(error) throw new Error("This action could not be completed. Check your permission, current eligibility, room availability and booking stage.");
  return result;
});
export const verifyHostelCityFn = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((d:unknown)=>z.object({studentId:z.string().uuid(),city:z.string().trim().min(2).max(100),source:z.string().trim().min(3).max(500)}).parse(d)).handler(async({data,context})=>{
  const {error}=await context.supabase.rpc("save_hostel_verified_city",{_student_id:data.studentId,_home_city:data.city,_source:data.source});
  if(error) throw new Error("An authorised administrator must verify the city against a university source.");
  return {ok:true};
});
export const listAvailableHostelRoomsFn = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const {data,error}=await context.supabase.rpc("list_available_hostel_rooms");
  if(error) throw new Error("Available rooms could not be retrieved.");
  return data;
});
export const bookHostelRoomFn = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((d:unknown)=>z.object({hostel:z.enum(["A","B","C"]),roomNumber:z.string().trim().min(1).max(50),lang:z.enum(["en","ar"]).default("en")}).parse(d)).handler(async({data,context})=>{
  const {data:result,error}=await context.supabase.rpc("book_hostel_room",{_hostel:data.hostel,_room_number:data.roomNumber,_lang:data.lang});
  if(error) throw new Error(error.message.includes("just booked") ? "This room was just booked by another student. Please choose another available room." : "The room could not be booked. Check your eligibility and the current availability.");
  return result;
});