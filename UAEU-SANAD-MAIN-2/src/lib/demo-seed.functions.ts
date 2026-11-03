import { apiFetch } from "@/lib/auth-token";

export const getDemoAccessState = () => apiFetch<{ enabled:boolean; requiresCode:boolean }>("/api/demo/access");

export const listDemoAccounts = ({ data }: { data:{ accessCode?:string|null|undefined } }) => apiFetch<{
  studentPassword:string;staffPassword:string;
  students:Array<{email:string;nameEn:string;nameAr:string;scenario:string;program:string}>;
  staff:Array<{email:string;nameEn:string;nameAr:string;display:string;role:string;unit:string|null;jobEn:string|null;jobAr:string|null;isOwner:boolean;scenario:string|null}>;
}>("/api/demo/sign-in-accounts",{method:"POST",body:JSON.stringify(data)});

export const provisionDemoEnvironment = () => apiFetch<{students:number;staff:number;cases:number;alerts:number;suggestions:number}>("/api/demo/provision",{method:"POST"});
