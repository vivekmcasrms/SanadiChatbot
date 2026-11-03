import { apiFetch } from "@/lib/auth-token";
export type StudentBriefing={hasProfile:boolean;headline:string;facts:{label:string;value:string}[]};
export const getStudentBriefing=({data}:{data:{lang:"en"|"ar"}})=>apiFetch<StudentBriefing>(`/api/academic/briefing?lang=${data.lang}`);
