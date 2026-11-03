import { apiFetch } from "@/lib/auth-token";

export type AppointmentRequestView = {
  id:string; caseId:string|null; reference:string|null; studentId:string; studentName:string|null; studentNumber:string|null;
  unitId:string|null; unitName:string|null; preferredDatetime:string; alternativeDatetime:string|null; confirmedDatetime:string|null;
  assignedStaffId:string|null; assignedStaffName:string|null; assignedStaffEmail:string|null; assignmentMethod:string|null;
  assignedAt:string|null; workloadAtAssignment:number|null; requestStatus:string; confirmationStatus:string; purpose:string|null;
  declineReason:string|null; location:string|null; officeResponseAt:string|null; studentResponseAt:string|null; isMine:boolean;
};

export const getCaseAppointmentRequestFn = ({ data }: { data: { caseId:string } }) =>
  apiFetch<AppointmentRequestView|null>(`/api/appointment-requests/case/${encodeURIComponent(data.caseId)}`);

export const listMyAppointmentRequestsFn = (_input?: unknown) =>
  apiFetch<AppointmentRequestView[]>("/api/appointment-requests/mine");

export type AppointmentResponseInput = {
  requestId:string;
  action:"confirm"|"propose"|"request_info"|"decline"|"student_accept"|"student_cancel";
  alternativeDatetime?:string; location?:string; message?:string;
};

export const respondToAppointmentRequestFn = ({ data }: { data: AppointmentResponseInput }) => {
  const { requestId, ...body } = data;
  return apiFetch<{ok:boolean;status:string}>(`/api/appointment-requests/${encodeURIComponent(requestId)}/respond`, {
    method:"POST", body:JSON.stringify(body),
  });
};
