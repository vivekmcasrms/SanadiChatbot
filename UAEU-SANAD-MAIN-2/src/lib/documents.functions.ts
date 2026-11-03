import { apiFetch } from "@/lib/auth-token";
import type { DocumentListItem, IssuedLetter, LetterContext } from "./documents/letters.server";
import type { Database } from "@/integrations/supabase/types";

type Call<T>={data:T};
type Template=Database["public"]["Tables"]["document_templates"]["Row"];
export type DocumentVerification={found:boolean;status?:string|null;reference?:string|null;documentType?:string|null;titleEn?:string|null;titleAr?:string|null;language?:string|null;issuedAt?:string|null;expiresAt?:string|null;studentName?:string|null;studentNameAr?:string|null;programme?:string|null;programmeAr?:string|null;college?:string|null;collegeAr?:string|null;isDemoDocument?:boolean|null;documentHash?:string|null;digitallySigned?:boolean|null;rateLimited?:boolean|null};

export const getMyDocumentState=({data}:Call<{search?:string|undefined;page:number;pageSize:number}>)=>apiFetch<{letterContext:LetterContext;documents:DocumentListItem[];total:number;page:number;pageSize:number;pageCount:number}>("/api/documents/state",{method:"POST",body:JSON.stringify(data)});
export const issueMyEnrollmentLetter=({data}:Call<{language?:"en"|"ar"|"bilingual";purpose?:"general"|"embassy_visa"|"bank"|"employer"|"scholarship"|"government"|"other";fields?:{includeProgramme?:boolean;includeCollege?:boolean;includeTerm?:boolean;includeExpectedGraduation?:boolean};conversationId?:string|null}>)=>apiFetch<{letter:IssuedLetter;replayed:boolean}>("/api/documents/issue",{method:"POST",body:JSON.stringify(data)});
export const getDocumentDownloadUrl=({data}:Call<{documentId:string;mode?:"view"|"download"}>)=>apiFetch<{url:string;fileName:string}>("/api/documents/download",{method:"POST",body:JSON.stringify(data)});
export const deleteMyDocument=({data}:Call<{documentId:string}>)=>apiFetch<{reference:string}>("/api/documents/delete",{method:"POST",body:JSON.stringify(data)});
export const getDocumentRetentionPolicies=()=>apiFetch<Array<{document_type:string;retention_days:number;label_en:string|null;label_ar:string|null}>>("/api/documents/retention");
export const updateDocumentRetentionPolicy=({data}:Call<{documentType:string;retentionDays:number}>)=>apiFetch<{ok:boolean}>("/api/documents/retention",{method:"POST",body:JSON.stringify(data)});
export const verifyDocumentToken=({data}:Call<{token:string}>)=>apiFetch<DocumentVerification>(`/api/documents/verify?token=${encodeURIComponent(data.token)}`);
export const getDocumentAdminOverview=()=>apiFetch<{documents:Record<string,unknown>[];events:Record<string,unknown>[];totals:{issued:number;valid:number;revoked:number;downloads:number;verifications:number;failures:number}}>("/api/documents/admin");
export const revokeIssuedDocument=({data}:Call<{documentId:string;reason:string}>)=>apiFetch<{ok:boolean;reference:string}>("/api/documents/revoke",{method:"POST",body:JSON.stringify(data)});
export const listDocumentTemplates=()=>apiFetch<Template[]>("/api/documents/templates");
export const previewDocumentTemplate=({data}:Call<{language:"en"|"ar";title:string;headerText?:string|null;bodyTemplate:string;footerText?:string|null;signatoryBlock?:string|null;disclaimer?:string|null}>)=>apiFetch<{title:string;header:string;body:string;footer:string;signatory:string;disclaimer:string;unknownPlaceholders:string[]}>("/api/documents/templates/preview",{method:"POST",body:JSON.stringify(data)});
export const saveDocumentTemplate=({data}:Call<{id:string;title:string;headerText?:string|null;bodyTemplate:string;footerText?:string|null;signatoryBlock?:string|null;disclaimer?:string|null;validityDays?:number|null;isActive?:boolean}>)=>apiFetch<{ok:boolean}>("/api/documents/templates",{method:"POST",body:JSON.stringify(data)});
