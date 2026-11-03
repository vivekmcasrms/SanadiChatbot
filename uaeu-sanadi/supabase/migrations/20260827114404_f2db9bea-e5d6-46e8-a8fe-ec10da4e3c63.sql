UPDATE public.university_services
SET is_active = false, updated_at = now()
WHERE code IN ('SVC-INTERNSHIP','SVC-INTERN-APPLY','HOUSING-REG','SVC-HOUSING','SVC-TRANSFER-ICT','SVC-COLLEGE-TRANSFER');