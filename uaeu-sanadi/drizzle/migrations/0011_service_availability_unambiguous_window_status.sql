DO $migration$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('public.get_service_availability(uuid,timestamptz)'::regprocedure) INTO definition;
 definition:=replace(definition,'AND status = ''active''','AND service_availability_windows.status = ''active''');
 EXECUTE definition;
END $migration$;