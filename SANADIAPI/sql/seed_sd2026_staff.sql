-- SD 2026 service staff roster import
-- Keeps system_admin and student auth.users / roles untouched.
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
BEGIN TRAN;

DECLARE @pwd nvarchar(4000) = N'$2b$12$veJWWmxyOVK9psIUlMYIRutr7vhDuJWKIKwBbpmw6DNxYd1/nEFGC';

IF NOT EXISTS (SELECT 1 FROM dbo.service_units WHERE code = N'ALUMNI_AFFAIRS_DEPARTMENT')
  INSERT INTO dbo.service_units (id, code, name_en, name_ar, is_active)
  VALUES (NEWID(), N'ALUMNI_AFFAIRS_DEPARTMENT', N'Alumni Affairs Department', N'Alumni Affairs Department', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.service_units WHERE code = N'DOIT')
  INSERT INTO dbo.service_units (id, code, name_en, name_ar, is_active)
  VALUES (NEWID(), N'DOIT', N'S&C - DoIT', N'S&C - DoIT', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.service_units WHERE code = N'STUDENT_ACTIVITIES_DEPARTMENT')
  INSERT INTO dbo.service_units (id, code, name_en, name_ar, is_active)
  VALUES (NEWID(), N'STUDENT_ACTIVITIES_DEPARTMENT', N'S&C - Student Activities Department', N'S&C - Student Activities Department', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.service_units WHERE code = N'STUDENT_SERVICES_DEPARTMENT')
  INSERT INTO dbo.service_units (id, code, name_en, name_ar, is_active)
  VALUES (NEWID(), N'STUDENT_SERVICES_DEPARTMENT', N'S&C - Student Services Department', N'S&C - Student Services Department', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.service_units WHERE code = N'FINANCIAL_AFFAIRS_DIVISION')
  INSERT INTO dbo.service_units (id, code, name_en, name_ar, is_active)
  VALUES (NEWID(), N'FINANCIAL_AFFAIRS_DIVISION', N'S&C- Financial Affairs Division', N'S&C- Financial Affairs Division', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.service_units WHERE code = N'REGISTRATION_DEPARTMENT')
  INSERT INTO dbo.service_units (id, code, name_en, name_ar, is_active)
  VALUES (NEWID(), N'REGISTRATION_DEPARTMENT', N'S&C- Registration Department', N'S&C- Registration Department', 1);

IF OBJECT_ID('tempdb..#roster') IS NOT NULL DROP TABLE #roster;
IF OBJECT_ID('tempdb..#membership') IS NOT NULL DROP TABLE #membership;
CREATE TABLE #roster (email nvarchar(320) NOT NULL PRIMARY KEY, full_name nvarchar(450) NOT NULL, home_unit_code nvarchar(256) NOT NULL);
CREATE TABLE #membership (email nvarchar(320) NOT NULL, unit_code nvarchar(256) NOT NULL, PRIMARY KEY (email, unit_code));

INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'a.aljaberi@uaeu.ac.ae', N'Al Anood Bin Tarsh Al Jaberi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'a.aljaberi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'a.alremeithi@uaeu.ac.ae', N'Amna AlRemeithi', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N'a.alremeithi@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'a.fadelmola@uaeu.ac.ae', N'Abdalla FadelMola', N'GENERAL_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'a.fadelmola@uaeu.ac.ae', N'GENERAL_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'a.mohd@uaeu.ac.ae', N'Ali Alantali', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N'a.mohd@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'a_alameri@uaeu.ac.ae', N'Al Maha Alameri', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'a_alameri@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'a_alkaabi@uaeu.ac.ae', N'AbdulAziz AlKaabi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'a_alkaabi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'abdulla.alshiba@uaeu.ac.ae', N'Abdulla AlShiba', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'abdulla.alshiba@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'abdullah.k@uaeu.ac.ae', N'Abdullah Al Kendi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'abdullah.k@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'afra.alkarbi@uaeu.ac.ae', N'Afra Al Karbi', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #membership (email, unit_code) VALUES (N'afra.alkarbi@uaeu.ac.ae', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'afra.k@uaeu.ac.ae', N'Afra Al Farsi', N'ALUMNI_AFFAIRS_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'afra.k@uaeu.ac.ae', N'ALUMNI_AFFAIRS_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'afra.k@uaeu.ac.ae', N'CAREER');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'ahmad.saadi@uaeu.ac.ae', N'Ahmed Al Saadi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'ahmad.saadi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'alanoud.s@uaeu.ac.ae', N'Al Anoud Bin Shamlan', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N'alanoud.s@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'alia.alkaabi@uaeu.ac.ae', N'Alia Saeed Alkaabi', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N'alia.alkaabi@uaeu.ac.ae', N'LIB');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'alia.jamal@uaeu.ac.ae', N'Alia Alshamsi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'alia.jamal@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'alia.s@uaeu.ac.ae', N'Alia Mohammed Bin Awad Al Nuaimi', N'HD');
INSERT INTO #membership (email, unit_code) VALUES (N'alia.s@uaeu.ac.ae', N'HD');
INSERT INTO #membership (email, unit_code) VALUES (N'alia.s@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'aliaateeq@uaeu.ac.ae', N'Alia Al Dhaheri', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'aliaateeq@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'aliaateeq@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'alialshamsi@uaeu.ac.ae', N'Ali Alshamsi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'alialshamsi@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'alkaabi.a@uaeu.ac.ae', N'Aysha Alkaabi', N'REGISTRATION_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'alkaabi.a@uaeu.ac.ae', N'REGISTRATION_DEPARTMENT');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'alreem_alameri@uaeu.ac.ae', N'AL REEM AL AMERI', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N'alreem_alameri@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'alyazia.b@uaeu.ac.ae', N'Al Yazia Althehli', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'alyazia.b@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'amal_m@uaeu.ac.ae', N'Amal Awad Al Nuaimi', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'amal_m@uaeu.ac.ae', N'REG');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'ameera.kaabi@uaeu.ac.ae', N'Amira Al Kaabi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'ameera.kaabi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'amira.hamad@uaeu.ac.ae', N'Ameera Al Ghaithi', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'amira.hamad@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'amna.alnaqbi@uaeu.ac.ae', N'Amna Alnaqbi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'amna.alnaqbi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'amna.ketbi@uaeu.ac.ae', N'Amna AL Ktebi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'amna.ketbi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'amna.s@uaeu.ac.ae', N'Amna Al Dhaheri', N'ALUMNI_AFFAIRS_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'amna.s@uaeu.ac.ae', N'ALUMNI_AFFAIRS_DEPARTMENT');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'anoud_alsaedi@uaeu.ac.ae', N'Anoud AlSaedi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'anoud_alsaedi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'arwadh@uaeu.ac.ae', N'Arwa Al Dhahri', N'CEDU');
INSERT INTO #membership (email, unit_code) VALUES (N'arwadh@uaeu.ac.ae', N'CEDU');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'asharafka@uaeu.ac.ae', N'Asharaf Kannearil Abdul Rahiman', N'UOD_MARKETING');
INSERT INTO #membership (email, unit_code) VALUES (N'asharafka@uaeu.ac.ae', N'UOD_MARKETING');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'asma.s@uaeu.ac.ae', N'Asma AlEissaee', N'FMD');
INSERT INTO #membership (email, unit_code) VALUES (N'asma.s@uaeu.ac.ae', N'FMD');
INSERT INTO #membership (email, unit_code) VALUES (N'asma.s@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'asma_alkatheeri@uaeu.ac.ae', N'Asma Abdulla Bin Mahri Alkatheeri', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N'asma_alkatheeri@uaeu.ac.ae', N'LIB');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'aysha_alshamsi@uaeu.ac.ae', N'Aysha Alshamsi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'aysha_alshamsi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'ayshaalkaabi@uaeu.ac.ae', N'Aysha Al Kaabi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'ayshaalkaabi@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'ayshaalreyashi@uaeu.ac.ae', N'Aisha Alreyashi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'ayshaalreyashi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'ayshas@uaeu.ac.ae', N'Aysha Al Hassani', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'ayshas@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'ayshas@uaeu.ac.ae', N'HR');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'badriyam@uaeu.ac.ae', N'Badriya AlMaawali', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'badriyam@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'badriyam@uaeu.ac.ae', N'HR');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'd_almaamari@uaeu.ac.ae', N'Dalal Al Maamari', N'ALUMNI_AFFAIRS_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'd_almaamari@uaeu.ac.ae', N'ALUMNI_AFFAIRS_DEPARTMENT');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'duha_d@uaeu.ac.ae', N'Duha Al Mansoori', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'duha_d@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'e.alshamisi@uaeu.ac.ae', N'Eiman Shamisi', N'PROVOST_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'e.alshamisi@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'emad.a@uaeu.ac.ae', N'Imad Hamid', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'emad.a@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'f.abuaida@uaeu.ac.ae', N'Fatima Al Zahraa Abu Eida', N'CEC');
INSERT INTO #membership (email, unit_code) VALUES (N'f.abuaida@uaeu.ac.ae', N'CEC');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'f.aldarmaki@uaeu.ac.ae', N'Fatima Al Darmaki', N'PROVOST');
INSERT INTO #membership (email, unit_code) VALUES (N'f.aldarmaki@uaeu.ac.ae', N'PROVOST');
INSERT INTO #membership (email, unit_code) VALUES (N'f.aldarmaki@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'f.alghafri@uaeu.ac.ae', N'Fatima Al Ghafri', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'f.alghafri@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'f.alhajeri@uaeu.ac.ae', N'Fatheya ALHAJERI', N'CAREER');
INSERT INTO #membership (email, unit_code) VALUES (N'f.alhajeri@uaeu.ac.ae', N'CAREER');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'f.alketbi@uaeu.ac.ae', N'Fatima Al Ketbi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'f.alketbi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'f.alnaqbi@uaeu.ac.ae', N'Fahad Al Naqbi', N'FMD');
INSERT INTO #membership (email, unit_code) VALUES (N'f.alnaqbi@uaeu.ac.ae', N'FMD');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'f.saeed@uaeu.ac.ae', N'Fatima Al Maskari', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N'f.saeed@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'fares.m@uaeu.ac.ae', N'Fares Aldhaheri', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'fares.m@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'fatima.aldhaheri@uaeu.ac.ae', N'Fatima Alyabhouni Aldhaheri', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'fatima.aldhaheri@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'fatima.m@uaeu.ac.ae', N'Fatima Al Dhaheri', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'fatima.m@uaeu.ac.ae', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'fatima.m@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'fatima@uaeu.ac.ae', N'Fatima Al Kaabi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'fatima@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'fatimah@uaeu.ac.ae', N'Fatima Alneyadi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'fatimah@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'gahbabi@uaeu.ac.ae', N'Ghalia Alahbabi', N'UOD');
INSERT INTO #membership (email, unit_code) VALUES (N'gahbabi@uaeu.ac.ae', N'UOD');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'gpannikar@uaeu.ac.ae', N'Githanjali Susan Pannikar', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'gpannikar@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'h.alneyadi@uaeu.ac.ae', N'Halima Al Neyadi', N'COLLEGE_OF_SCIENCE_COS');
INSERT INTO #membership (email, unit_code) VALUES (N'h.alneyadi@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE_COS');
INSERT INTO #membership (email, unit_code) VALUES (N'h.alneyadi@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'h.alraeesi@uaeu.ac.ae', N'Hamad AlRaeesi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'h.alraeesi@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'h_alahbabi@uaeu.ac.ae', N'Hessa Al Ahbabi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'h_alahbabi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'h_alkaabi@uaeu.ac.ae', N'Hamda Al Kaabi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'h_alkaabi@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'hakim@uaeu.ac.ae', N'Hakim Boukhriss', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'hakim@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'haleima.a@uaeu.ac.ae', N'Haleimah Aldhanhani', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'haleima.a@uaeu.ac.ae', N'HOUS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'halneyadi@uaeu.ac.ae', N'Hamda Al Neyadi', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'halneyadi@uaeu.ac.ae', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'hamed.albalushi@uaeu.ac.ae', N'Hamad Alblooshi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'hamed.albalushi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'hamed@uaeu.ac.ae', N'Hamed Al Magharebi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'hamed@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'hana.i@uaeu.ac.ae', N'Hana Al Baloushi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'hana.i@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'hanan.s@uaeu.ac.ae', N'Hanan Alsaeedi', N'GENERAL_SUPERVISION_OF');
INSERT INTO #membership (email, unit_code) VALUES (N'hanan.s@uaeu.ac.ae', N'GENERAL_SUPERVISION_OF');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'hoda.mansour@uaeu.ac.ae', N'Hoda Mansour', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N'hoda.mansour@uaeu.ac.ae', N'CMHS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'k.alblooshi@uaeu.ac.ae', N'Khadija Alblooshi', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N'k.alblooshi@uaeu.ac.ae', N'CMHS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'khadija.a@uaeu.ac.ae', N'Khadija Al Naqbi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'khadija.a@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'khafeya.k@uaeu.ac.ae', N'Khafeya Al Marar', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'khafeya.k@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'khaled.s@uaeu.ac.ae', N'Khaled Alblooshi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'khaled.s@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'latifa.alkaabi@uaeu.ac.ae', N'Latifa Juma Saleh Al Kaabi', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N'latifa.alkaabi@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'm.aldhaheri@uaeu.ac.ae', N'Mouza Al Dhaheri', N'PROVOST');
INSERT INTO #membership (email, unit_code) VALUES (N'm.aldhaheri@uaeu.ac.ae', N'PROVOST');
INSERT INTO #membership (email, unit_code) VALUES (N'm.aldhaheri@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'm.alghaithi@uaeu.ac.ae', N'Maitha Al Ghaithi', N'COB');
INSERT INTO #membership (email, unit_code) VALUES (N'm.alghaithi@uaeu.ac.ae', N'COB');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'm.almazrouei@uaeu.ac.ae', N'Muna AlMazrouei', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'm.almazrouei@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'm.saif@uaeu.ac.ae', N'Mariam Al Baloushi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'm.saif@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'm_alyahyaee@uaeu.ac.ae', N'Mariam Al Yahyaee', N'FACILITIES_MANAGEMENT_');
INSERT INTO #membership (email, unit_code) VALUES (N'm_alyahyaee@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'ma_aldhaheri@uaeu.ac.ae', N'Maitha AlDhaheri', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'ma_aldhaheri@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'ma_aldhaheri@uaeu.ac.ae', N'NATIONAL_FELLOW_GROUP');
INSERT INTO #membership (email, unit_code) VALUES (N'ma_aldhaheri@uaeu.ac.ae', N'NATIONAL_FELLOW_RECRUI');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'mahra_m@uaeu.ac.ae', N'Mahra Almazrouei', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'mahra_m@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'maitha.a@uaeu.ac.ae', N'Maitha Al Dhaheri', N'HD');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha.a@uaeu.ac.ae', N'HD');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha.a@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'maitha.m@uaeu.ac.ae', N'Maitha Al Kaabi', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha.m@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'Maitha AlAmeri', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'CEC');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'CEDU');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'COB');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'COLLEGE_OF_CHSS');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'DOIT');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'HR');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'SG');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'TENDER_PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'UNIVERSITY_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'VC_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'REGISTRATION_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'CAREER');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N'maitha_a@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'malbalooshi@uaeu.ac.ae', N'May Al Blooshi', N'DOIT');
INSERT INTO #membership (email, unit_code) VALUES (N'malbalooshi@uaeu.ac.ae', N'DOIT');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'malek.k@uaeu.ac.ae', N'Malek Al Haj Ahmad', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'malek.k@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'maliha_alahbabi@uaeu.ac.ae', N'Maliha Al Ahbabi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'maliha_alahbabi@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'manal.radwan@uaeu.ac.ae', N'Manal Radwan Meshref', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'manal.radwan@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'mariam.mohammed@uaeu.ac.ae', N'Mariam Al Azizi', N'COLLEGE_OF_CHSS');
INSERT INTO #membership (email, unit_code) VALUES (N'mariam.mohammed@uaeu.ac.ae', N'COLLEGE_OF_CHSS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'maryam.masood@uaeu.ac.ae', N'Maryam Masood', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'maryam.masood@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'meera.alneyadi@uaeu.ac.ae', N'Meera Alneyadi', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N'meera.alneyadi@uaeu.ac.ae', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N'meera.alneyadi@uaeu.ac.ae', N'UOD');
INSERT INTO #membership (email, unit_code) VALUES (N'meera.alneyadi@uaeu.ac.ae', N'UOD_IC');
INSERT INTO #membership (email, unit_code) VALUES (N'meera.alneyadi@uaeu.ac.ae', N'UOD_LS');
INSERT INTO #membership (email, unit_code) VALUES (N'meera.alneyadi@uaeu.ac.ae', N'UOD_MARKETING');
INSERT INTO #membership (email, unit_code) VALUES (N'meera.alneyadi@uaeu.ac.ae', N'UOD_MC');
INSERT INTO #membership (email, unit_code) VALUES (N'meera.alneyadi@uaeu.ac.ae', N'UOD_MULTAQA');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'mehra.m@uaeu.ac.ae', N'Mahra Mazyoud Al Shehi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'mehra.m@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'mohammed_abdulla@uaeu.ac.ae', N'Mohammed Al Nuaimi', N'NATIONAL_FELLOW_GROUP');
INSERT INTO #membership (email, unit_code) VALUES (N'mohammed_abdulla@uaeu.ac.ae', N'NATIONAL_FELLOW_GROUP');
INSERT INTO #membership (email, unit_code) VALUES (N'mohammed_abdulla@uaeu.ac.ae', N'NATIONAL_FELLOW_RECRUI');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'mohd.almoree@uaeu.ac.ae', N'Mohamad Moree', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'mohd.almoree@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'mona.m@uaeu.ac.ae', N'Mona Al Hassani', N'ALUMNI_AFFAIRS_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'mona.m@uaeu.ac.ae', N'ALUMNI_AFFAIRS_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'mona.m@uaeu.ac.ae', N'CAREER');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'Mouza AlDhaheri', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'CEC');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'CEDU');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'COB');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'COLLEGE_OF_CHSS');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'DOIT');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'HR');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'SG');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'TENDER_PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'UNIVERSITY_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'VC_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'REGISTRATION_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'CAREER');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N'mouza.aldhaheri@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'n.a.alnuaimi@uaeu.ac.ae', N'Nour AlNuaimi', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N'n.a.alnuaimi@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'n.alhajeri@uaeu.ac.ae', N'Nawal Alhajeri', N'TENDER_PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'n.alhajeri@uaeu.ac.ae', N'TENDER_PROCUREMENT');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'n_aljaberi@uaeu.ac.ae', N'Nasser Aljaberi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'n_aljaberi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'naeema_s@uaeu.ac.ae', N'Naeema Al Ketbi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'naeema_s@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'noura.a@uaeu.ac.ae', N'Noura Al Kaabi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.a@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'Noura Al Nuaimi', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'CEC');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'CEDU');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'COB');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'COLLEGE_OF_CHSS');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'DOIT');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'HR');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'SG');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'TENDER_PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'UNIVERSITY_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'VC_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'REGISTRATION_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'CAREER');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.n@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'noura.s@uaeu.ac.ae', N'Noura Alshamisi', N'DVCSE');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.s@uaeu.ac.ae', N'DVCSE');
INSERT INTO #membership (email, unit_code) VALUES (N'noura.s@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'noura_alkaabi@uaeu.ac.ae', N'Noura Al Kaabi', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N'noura_alkaabi@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'noura_k@uaeu.ac.ae', N'Noura Al Yahyaee', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'noura_k@uaeu.ac.ae', N'HOUS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'nouraalketbi338@uaeu.ac.ae', N'Noura Alketbi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'nouraalketbi338@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'q.khaili@uaeu.ac.ae', N'Qumasha Al Khaili', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'q.khaili@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'reem.ali@uaeu.ac.ae', N'Reem AlDhaheri', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'reem.ali@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'robeenaa@uaeu.ac.ae', N'Robeena Qayed', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N'robeenaa@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'rolifmdhs@uaeu.ac.ae', N'Roli Esimaje', N'FMD');
INSERT INTO #membership (email, unit_code) VALUES (N'rolifmdhs@uaeu.ac.ae', N'FMD');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N's.al-muhairi@uaeu.ac.ae', N'Shamma Al Muhairi', N'CHANCELLOR_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N's.al-muhairi@uaeu.ac.ae', N'CHANCELLOR_OFFICE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N's.al-neyadi@uaeu.ac.ae', N'Shaikha Al Neyadi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N's.al-neyadi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N's.alkaili@uaeu.ac.ae', N'Salma Al Khyeli', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N's.alkaili@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N's.alkhaili@uaeu.ac.ae', N'Shamma Al Khaili', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N's.alkhaili@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N's.alkindi@uaeu.ac.ae', N'Sara AlKindi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N's.alkindi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'Sara Al Zubaidi', N'CES_UNIT');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'CES_UNIT');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'HD');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'CEC');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'CEDU');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'COB');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'COLLEGE_OF_CHSS');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'DOIT');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'HR');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'SG');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'TENDER_PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'UNIVERSITY_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'VC_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'REGISTRATION_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'CAREER');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N's.zubaidi@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N's_alahbabi@uaeu.ac.ae', N'Shahad AlAhbabi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N's_alahbabi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N's_alhassani@uaeu.ac.ae', N'Salama AlHassani', N'NATIONAL_FELLOW_GROUP');
INSERT INTO #membership (email, unit_code) VALUES (N's_alhassani@uaeu.ac.ae', N'NATIONAL_FELLOW_GROUP');
INSERT INTO #membership (email, unit_code) VALUES (N's_alhassani@uaeu.ac.ae', N'NATIONAL_FELLOW_RECRUI');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N's_bani@uaeu.ac.ae', N'Seham Bani Ibrahim', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N's_bani@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'saeed.alshamsi@uaeu.ac.ae', N'Saeed AlSHamsi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'saeed.alshamsi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'Saeeda AlAhbabi', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'CEC');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'CEDU');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'COB');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'COLLEGE_OF_CHSS');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'DOIT');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'HR');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'SG');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'TENDER_PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'UNIVERSITY_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'VC_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'REGISTRATION_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'CAREER');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N'saeeda_h@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'salwa.alameri@uaeu.ac.ae', N'Salwa AlAmeri', N'PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'salwa.alameri@uaeu.ac.ae', N'PROCUREMENT');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'samirh@uaeu.ac.ae', N'Samir Mostafa', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'samirh@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'saraalrashdi@uaeu.ac.ae', N'Sara Alrashdi', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'saraalrashdi@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'saraalshamsi@uaeu.ac.ae', N'Sara Al Shamisi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'saraalshamsi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'saud@uaeu.ac.ae', N'Saoud Al Ameri', N'NATIONAL_FELLOW_GROUP');
INSERT INTO #membership (email, unit_code) VALUES (N'saud@uaeu.ac.ae', N'NATIONAL_FELLOW_GROUP');
INSERT INTO #membership (email, unit_code) VALUES (N'saud@uaeu.ac.ae', N'NATIONAL_FELLOW_RECRUI');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'sghaira_alameri@uaeu.ac.ae', N'Sghaira Al Ameri', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'sghaira_alameri@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'sh.alketbi@uaeu.ac.ae', N'Shamma Alketbi', N'HR_SERVICES');
INSERT INTO #membership (email, unit_code) VALUES (N'sh.alketbi@uaeu.ac.ae', N'HR_SERVICES');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'shaikha.alketbi@uaeu.ac.ae', N'Shaikha AlKetbi', N'COLLEGE_OF_SCIENCE');
INSERT INTO #membership (email, unit_code) VALUES (N'shaikha.alketbi@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'Shama Alkalbani', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'CEC');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'CEDU');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'COB');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'COLLEGE_OF_CHSS');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'DOIT');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'HR');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'SG');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'TENDER_PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'UNIVERSITY_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'VC_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'REGISTRATION_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N'shamma.alkalbani@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'shamsaj@uaeu.ac.ae', N'Shamsa Albaloushi', N'CAREER');
INSERT INTO #membership (email, unit_code) VALUES (N'shamsaj@uaeu.ac.ae', N'CAREER');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'sharefa.ibrahim@uaeu.ac.ae', N'Sharefa Hasan', N'ALUMNI_AFFAIRS_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'sharefa.ibrahim@uaeu.ac.ae', N'ALUMNI_AFFAIRS_DEPARTMENT');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'sherinbaby@uaeu.ac.ae', N'Sherin Baby', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'sherinbaby@uaeu.ac.ae', N'HAPPY');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'Shouq Alharsoosi', N'CES_UNIT');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'CES_UNIT');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'CEC');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'CEDU');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'COB');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'COLLEGE_OF_CHSS');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'DOIT');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'HR');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'SG');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'TENDER_PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'UNIVERSITY_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'VC_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'REGISTRATION_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'CAREER');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N'shouq.alharsoosi@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'sultan.s@uaeu.ac.ae', N'Sultan Alashwal', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'sultan.s@uaeu.ac.ae', N'HOUS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'tahr@uaeu.ac.ae', N'Teaching assisstant HR', N'NATIONAL_FELLOW_GROUP');
INSERT INTO #membership (email, unit_code) VALUES (N'tahr@uaeu.ac.ae', N'NATIONAL_FELLOW_GROUP');
INSERT INTO #membership (email, unit_code) VALUES (N'tahr@uaeu.ac.ae', N'NATIONAL_FELLOW_RECRUI');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'Thurya Alameri', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'CEC');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'CEDU');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'COB');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'COLLEGE_OF_CHSS');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'DOIT');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'HR');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'SG');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'TENDER_PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'UNIVERSITY_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'VC_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'REGISTRATION_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'CAREER');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N'thurya.a@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'Yasmeena Al Badi', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'REG');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'CEC');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'CEDU');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'CMHS');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'COB');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'COLLEGE_OF_CAVM');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'COLLEGE_OF_CHSS');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'COLLEGE_OF_ENGINEERING');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'COLLEGE_OF_GRADUATE_ST');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'DOIT');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'DVCSAE_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'FACILITIES_MANAGEMENT_');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'GENERAL_SERVICES_DEPAR');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'HOUS');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'HR');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'IT_COLLEGE');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'PROVOST_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'SG');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'STUDENT_ACTIVITIES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'STUDENT_SERVICES_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'TENDER_PROCUREMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'LIB');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'VC_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'COLLEGE_OF_SCIENCE');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'DVCRA_RESEARCH_OFFICE');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'FINANCIAL_AFFAIRS_DIVISION');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'REGISTRATION_DEPARTMENT');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'UOD_UNIVERSITY_OUTREAC');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'CAREER');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'COLLEGE_OF_LAW');
INSERT INTO #membership (email, unit_code) VALUES (N'yasmeena@uaeu.ac.ae', N'ITS');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'yousef.h@uaeu.ac.ae', N'Yousef Alhashmi', N'FMD');
INSERT INTO #membership (email, unit_code) VALUES (N'yousef.h@uaeu.ac.ae', N'FMD');
INSERT INTO #roster (email, full_name, home_unit_code) VALUES (N'zsaif@uaeu.ac.ae', N'Zainab Saeed', N'HAPPY');
INSERT INTO #membership (email, unit_code) VALUES (N'zsaif@uaeu.ac.ae', N'HAPPY');

;MERGE auth.users AS t
USING #roster AS s ON LOWER(t.email) = s.email
WHEN MATCHED THEN UPDATE SET
  encrypted_password = @pwd,
  updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN INSERT (id, email, encrypted_password)
  VALUES (NEWID(), s.email, @pwd);

;MERGE dbo.profiles AS t
USING (
  SELECT u.id, r.email, r.full_name
  FROM #roster r JOIN auth.users u ON LOWER(u.email) = r.email
) AS s ON t.id = s.id
WHEN MATCHED THEN UPDATE SET
  full_name = s.full_name, email = s.email, deleted_at = NULL,
  access_revoked_at = NULL, access_revoked_by = NULL, access_revoked_reason = NULL,
  updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN INSERT (id, full_name, email, preferred_language, is_demo_account)
  VALUES (s.id, s.full_name, s.email, N'en', 0);

INSERT INTO dbo.user_roles (id, user_id, role)
SELECT NEWID(), u.id, N'service_officer'
FROM #roster r
JOIN auth.users u ON LOWER(u.email) = r.email
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.user_roles ur WHERE ur.user_id = u.id AND ur.role = N'service_officer'
);

;MERGE dbo.staff_profiles AS t
USING (
  SELECT u.id AS user_id, su.id AS service_unit_id
  FROM #roster r
  JOIN auth.users u ON LOWER(u.email) = r.email
  JOIN dbo.service_units su ON su.code = r.home_unit_code
) AS s ON t.user_id = s.user_id
WHEN MATCHED THEN UPDATE SET
  service_unit_id = s.service_unit_id,
  job_title_en = N'Service Officer',
  job_title_ar = N'موظف خدمة',
  is_active = 1, availability_status = N'available', updated_at = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN INSERT (user_id, service_unit_id, job_title_en, job_title_ar, is_active, availability_status)
  VALUES (s.user_id, s.service_unit_id, N'Service Officer', N'موظف خدمة', 1, N'available');

DELETE FROM dbo.service_staff;
INSERT INTO dbo.service_staff (
  id, staff_profile_id, service_unit_id, role_type, can_receive_cases, can_approve_actions,
  can_view_sensitive_cases, is_active, is_service_owner, can_assign_cases,
  can_approve_normal_resolution, can_escalate, is_demo_record
)
SELECT NEWID(), u.id, su.id, N'officer', 1, 0, 0, 1, 0, 0, 1, 1, 0
FROM #membership m
JOIN auth.users u ON LOWER(u.email) = m.email
JOIN dbo.service_units su ON su.code = m.unit_code;

;WITH first_staff AS (
  SELECT ss.service_unit_id, ss.staff_profile_id,
         ROW_NUMBER() OVER (PARTITION BY ss.service_unit_id ORDER BY p.full_name, ss.staff_profile_id) rn
  FROM dbo.service_staff ss
  JOIN dbo.profiles p ON p.id = ss.staff_profile_id
  WHERE ss.is_active = 1
)
UPDATE su SET primary_service_owner_id = fs.staff_profile_id, updated_at = SYSDATETIMEOFFSET()
FROM dbo.service_units su
JOIN first_staff fs ON fs.service_unit_id = su.id AND fs.rn = 1;

DELETE FROM dbo.service_unit_owners;
INSERT INTO dbo.service_unit_owners (id, service_unit_id, staff_profile_id, ownership_type, is_active, is_demo_record)
SELECT NEWID(), id, primary_service_owner_id, N'primary', 1, 0
FROM dbo.service_units
WHERE primary_service_owner_id IS NOT NULL;

UPDATE ss SET is_service_owner = 1, can_assign_cases = 1, can_approve_actions = 1
FROM dbo.service_staff ss
JOIN dbo.service_units su ON su.id = ss.service_unit_id AND su.primary_service_owner_id = ss.staff_profile_id;

UPDATE sp SET is_active = 0, updated_at = SYSDATETIMEOFFSET()
FROM dbo.staff_profiles sp
WHERE NOT EXISTS (
  SELECT 1 FROM #roster r JOIN auth.users u ON LOWER(u.email)=r.email WHERE u.id = sp.user_id
);

DELETE ur
FROM dbo.user_roles ur
WHERE ur.role IN (N'service_officer', N'service_owner', N'service_manager', N'knowledge_manager')
  AND NOT EXISTS (
    SELECT 1 FROM #roster r JOIN auth.users u ON LOWER(u.email)=r.email WHERE u.id = ur.user_id
  )
  AND NOT EXISTS (SELECT 1 FROM dbo.user_roles a WHERE a.user_id = ur.user_id AND a.role = N'system_admin');

IF NOT EXISTS (SELECT 1 FROM dbo.user_roles WHERE role = N'system_admin') THROW 50010, N'system_admin missing', 1;
IF (SELECT COUNT(*) FROM dbo.user_roles WHERE role = N'student') < 10 THROW 50011, N'student roles missing', 1;
IF (SELECT COUNT(DISTINCT staff_profile_id) FROM dbo.service_staff) < 100 THROW 50012, N'staff import too small', 1;

COMMIT;
SELECT 'ok' AS status,
  (SELECT COUNT(*) FROM dbo.service_units) AS units,
  (SELECT COUNT(*) FROM dbo.service_staff) AS memberships,
  (SELECT COUNT(*) FROM dbo.staff_profiles WHERE is_active=1) AS active_staff,
  (SELECT COUNT(*) FROM dbo.user_roles WHERE role=N'student') AS students,
  (SELECT COUNT(*) FROM dbo.user_roles WHERE role=N'system_admin') AS admins,
  (SELECT COUNT(*) FROM dbo.user_roles WHERE role=N'service_officer') AS officers;
